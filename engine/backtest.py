"""Event-driven backtester (milestone 2).

Small, clear, custom — the spec's stated preference (section 8) — because the
two things that must be provably right are the cost model and the no-lookahead
fill discipline, and those are far easier to verify in 300 readable lines than
inside a framework.

THE BAR LOOP (this is the whole engine)
---------------------------------------
For each bar ``i`` of the run:

  1. EXECUTE the target weights that were decided at bar ``i-1``'s CLOSE, at
     bar ``i``'s OPEN. Every resulting fill is priced through
     ``costs.apply_costs``. Bar 0 can never execute anything: nothing has been
     decided yet.
  2. MARK TO MARKET at bar ``i``'s close and record equity / positions /
     weights.
  3. ASK the strategy, through a ``BarContext`` frozen at bar ``i``, for its
     desired weights. Store them as pending. They are executed in step 1 of
     bar ``i+1``.

The target decided on the FINAL bar is never executed — there is no bar after
it. That is recorded in the result (``unexecuted_final_target``) instead of
being quietly dropped.

WHY THIS CANNOT LOOK AHEAD
--------------------------
  * the strategy is only ever handed a context frozen at bar ``i`` — no public
    accessor on it reaches bar ``i+1`` (``engine.context``);
  * the strategy returns weights only — it cannot name a price, a size, or a
    bar, so it has no channel through which to request a same-bar fill;
  * execution is a separate step that runs on the NEXT iteration of the loop
    against that bar's open.
Break any one of the three and the tests in ``tests/test_no_lookahead.py``
fail.

COSTS ARE NOT OPTIONAL
----------------------
Every fill goes through ``costs.apply_costs``. There is no gross mode, no
``charge_costs=False``, no "backtest without frictions" switch: golden rule 3
says gross numbers are never reported as performance, and the cheapest way to
guarantee that is for the engine to be incapable of producing them. (Tests may
pass an explicitly-zeroed ``CostParams`` to isolate a mechanism — that is a
deliberate, visible choice in a test, not a mode of the engine.)

ACCOUNTING CONVENTIONS (all deliberate, all documented)
-------------------------------------------------------
  * **Sizing basis**: target weights apply to PRE-TRADE mark-to-market equity
    at the fill bar's open.
  * **Costs are paid from cash**, on top of the traded notional. A fill's
    share exchange uses the fill ``price``; ``total_cost`` is deducted
    separately. (``apply_costs`` also returns an equivalent adverse
    ``effective_price``; using both would double-count, so the engine uses the
    cash form.)
  * **No leverage, no overdraft**: buys are scaled down so cash never goes
    negative once costs are paid, which is why a 100%-target strategy ends up
    ~99.99% invested rather than exactly 100%. Long-only in Phase 1: negative
    weights are refused loudly.
  * **Fractional shares** are allowed (the Alpaca paper target supports them).
  * **Sells execute before buys** within a bar, so proceeds fund purchases;
    within each group, symbols are processed in sorted order for determinism.
  * **Rebalance band**: a rebalance smaller than
    ``max(min_trade_notional, min_trade_bps * equity)`` is skipped and counted
    (``dust_skipped``). Without it a fully-invested target is unreachable — the
    costs of getting to 100% leave you at 99.99%, and a naive engine buys the
    remainder again every single bar, inventing turnover that no real account
    would pay. The band is a fraction of EQUITY, not a fixed dollar amount, so
    it does not silently change meaning as the account grows. Tradeoff, stated:
    actual weights may sit up to ``min_trade_bps`` away from target.
    **Exits are exempt** — a target of exactly zero always liquidates in full,
    so no position can ever be stranded below the band.
  * **Terminal position**: the equity curve is mark-to-market, so the exit
    cost of a still-open final position is NOT charged (you still hold it).
    The engine reports what that exit would cost
    (``terminal_liquidation_cost``) so the number is visible rather than
    assumed away.

REPRODUCIBILITY (R7)
--------------------
No wall clock, no global RNG, no iteration over unordered sets. Strategies
that need randomness must draw from ``ctx.rng``, which is seeded from
``RunSpec.seed``. Same spec + same snapshot + same strategy => byte-identical
output (``tests/test_determinism.py``).

SEAMS LEFT FOR LATER MILESTONES (built as hooks, not as logic)
--------------------------------------------------------------
  * ``overlays``: the reduce-only Layer-2/3 seam (milestone 4). The engine
    clamps every overlay's output to ``min(previous, output)`` and floors it
    at zero, so the risk layer is non-bypassable by construction (rule 2).
  * ``RunSpec.fingerprint()``: a stable hash of the run configuration, ready
    for the append-only trial registry (milestone 3, rule 6). The registry
    itself is NOT built here.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, replace
from typing import Mapping, Sequence

import numpy as np
import pandas as pd

from costs.model import CostParams, apply_costs
from data.loader import load_symbol
from engine.context import BarContext
from engine.prices import ADV_WINDOW, adjusted_bars
from engine.strategy import ExposureOverlay, Strategy

FILL_COLUMNS = (
    "date",
    "bar_index",
    "signal_bar_index",
    "signal_date",
    "symbol",
    "side",
    "qty",
    "price",
    "adv",
    "notional",
    "commission",
    "spread_cost",
    "slippage_cost",
    "financing_cost",
    "total_cost",
    "effective_price",
)

#: Buy-affordability fixed point: stop once a further step would move less
#: than this fraction of available cash (1e-7 => a cent on a $100k account).
#: Any capital left uninvested by the stop is carried in the accounting
#: exactly, so this is a precision knob, never a leak.
AFFORD_TOL = 1e-7
AFFORD_MAX_ITERS = 6
WEIGHT_TOL = 1e-9


class EngineError(RuntimeError):
    """Any backtest failure. Loud, actionable, never swallowed."""


@dataclass(frozen=True)
class RunSpec:
    """Everything that determines a run's output. Hashable, serializable, and
    the unit the (milestone-3) trial registry will log."""

    symbols: tuple[str, ...]
    snapshot: str = "fixture"
    start: str | None = None
    end: str | None = None
    initial_cash: float = 100_000.0
    seed: int = 20260721
    max_gross: float = 1.0
    #: absolute floor for the rebalance band, in dollars
    min_trade_notional: float = 0.01
    #: rebalance band as bps of equity (1.0 bp on $100k = $10). See the module
    #: docstring: without it a 100% target churns forever against its own costs.
    min_trade_bps: float = 1.0
    adv_window: int = ADV_WINDOW
    default_cost_params: CostParams = field(default_factory=CostParams)
    #: per-symbol cost overrides, e.g. (("XLE", CostParams(half_spread_bps=3.0)),)
    symbol_cost_params: tuple[tuple[str, CostParams], ...] = ()
    #: documented, not a knob: backtests run on adjusted (total-return) prices.
    price_basis: str = "adjusted"

    def __post_init__(self) -> None:
        if not self.symbols:
            raise EngineError("RunSpec needs at least one symbol")
        if len(set(self.symbols)) != len(self.symbols):
            raise EngineError(f"duplicate symbols in universe: {self.symbols}")
        if self.initial_cash <= 0:
            raise EngineError(f"initial_cash must be positive, got {self.initial_cash}")
        if not 0 < self.max_gross <= 1.0:
            raise EngineError(
                f"max_gross must be in (0, 1] — Phase 1 caps leverage at 1 (spec section 3); got {self.max_gross}"
            )
        if self.min_trade_notional < 0:
            raise EngineError("min_trade_notional must be >= 0")
        if self.min_trade_bps < 0:
            raise EngineError("min_trade_bps must be >= 0")
        if self.price_basis != "adjusted":
            raise EngineError(
                f"price_basis='{self.price_basis}' is not supported. Backtests run on "
                f"adjusted (total-return) prices; see engine/prices.py for why there is "
                f"no raw-price mode."
            )
        unknown = [s for s, _ in self.symbol_cost_params if s not in self.symbols]
        if unknown:
            raise EngineError(f"cost overrides for symbols not in the universe: {unknown}")

    def cost_params_for(self, symbol: str) -> CostParams:
        for sym, params in self.symbol_cost_params:
            if sym == symbol:
                return params
        return self.default_cost_params

    def to_dict(self) -> dict:
        d = asdict(self)
        d["symbols"] = list(self.symbols)
        d["symbol_cost_params"] = {s: asdict(p) for s, p in self.symbol_cost_params}
        return d

    def fingerprint(self) -> str:
        """Stable hash of the configuration — the trial-registry key (rule 6)."""
        blob = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class BacktestResult:
    """Everything a run produced. Prices/costs already applied; no gross view."""

    spec: RunSpec
    strategy_name: str
    strategy_config: dict
    overlay_names: tuple[str, ...]
    equity: pd.Series  # mark-to-market at each bar's close
    cash: pd.Series
    positions: pd.DataFrame  # shares held during each bar (post-open fills)
    weights: pd.DataFrame  # actual weights at each bar's close
    targets: pd.DataFrame  # weights DECIDED at each bar's close (executed next bar)
    fills: pd.DataFrame
    warnings: tuple[str, ...]
    dust_skipped: int
    unexecuted_final_target: dict
    terminal_liquidation_cost: float

    @property
    def trade_count(self) -> int:
        return int(len(self.fills))

    @property
    def total_costs(self) -> float:
        return float(self.fills["total_cost"].sum()) if len(self.fills) else 0.0


def verify_shared_calendar(
    frames: Mapping[str, pd.DataFrame], symbols: Sequence[str]
) -> pd.DatetimeIndex:
    """Every symbol must sit on the identical bar index. Returns that index.

    Mismatches raise instead of being silently aligned: a quietly dropped or
    forward-filled bar is exactly the kind of invisible corruption that
    produces a fake edge. Multi-calendar handling (needed for H8's cross-asset
    sleeve) is a deliberate later decision, not a default.
    """
    reference_symbol = symbols[0]
    reference = frames[reference_symbol].index
    for sym in symbols:
        frame = frames[sym]
        if not frame.index.equals(reference):
            only_ref = reference.difference(frame.index)
            only_sym = frame.index.difference(reference)
            raise EngineError(
                f"calendar mismatch: '{sym}' has {len(frame)} bars vs "
                f"'{reference_symbol}' {len(reference)}. Missing from '{sym}': "
                f"{[str(d.date()) for d in only_ref[:5]]}; extra in '{sym}': "
                f"{[str(d.date()) for d in only_sym[:5]]}. Refusing to align silently."
            )
    return reference


def load_adjusted_universe(spec: RunSpec, snapshots_dir=None) -> dict[str, pd.DataFrame]:
    """Load + adjust every symbol in the spec and verify a shared calendar."""
    frames: dict[str, pd.DataFrame] = {}
    for sym in spec.symbols:
        raw = load_symbol(
            sym, spec.snapshot, start=spec.start, end=spec.end, snapshots_dir=snapshots_dir
        )
        frames[sym] = adjusted_bars(raw, adv_window=spec.adv_window)
    verify_shared_calendar(frames, spec.symbols)
    return frames


class Backtester:
    """Runs one strategy over one universe. Reusable across runs (stateless
    between ``run`` calls) so a benchmark can be run through the exact same
    object as the strategy."""

    def __init__(self, spec: RunSpec, frames: Mapping[str, pd.DataFrame] | None = None,
                 snapshots_dir=None):
        self.spec = spec
        self.frames: dict[str, pd.DataFrame] = (
            dict(frames) if frames is not None
            else load_adjusted_universe(spec, snapshots_dir=snapshots_dir)
        )
        missing = [s for s in spec.symbols if s not in self.frames]
        if missing:
            raise EngineError(f"frames missing for universe symbols {missing}")
        required = {"open", "close", "adv"}
        for sym in spec.symbols:
            absent = required - set(self.frames[sym].columns)
            if absent:
                raise EngineError(
                    f"'{sym}' frame is missing {sorted(absent)} — pass ADJUSTED bars "
                    f"from engine.prices.adjusted_bars(), not a raw snapshot frame"
                )
        # checked here, not only in the loader: caller-supplied frames must
        # face the same gate as loaded ones
        self.index: pd.DatetimeIndex = verify_shared_calendar(self.frames, spec.symbols)
        if len(self.index) < 2:
            raise EngineError(
                f"need at least 2 bars to run (signal on bar t, fill on bar t+1); "
                f"got {len(self.index)}"
            )

    # ------------------------------------------------------------------ run
    def run(
        self, strategy: Strategy, overlays: Sequence[ExposureOverlay] = ()
    ) -> BacktestResult:
        spec = self.spec
        symbols = tuple(spec.symbols)
        n = len(self.index)
        rng = np.random.default_rng(spec.seed)
        warnings: list[str] = []
        dust_skipped = 0

        # numpy views: hot loop reads these, never the DataFrames
        opens = {s: self.frames[s]["open"].to_numpy(dtype=float) for s in symbols}
        closes = {s: self.frames[s]["close"].to_numpy(dtype=float) for s in symbols}
        advs = {s: self.frames[s]["adv"].to_numpy(dtype=float) for s in symbols}

        cash = float(spec.initial_cash)
        shares = {s: 0.0 for s in symbols}
        pending: dict[str, float] | None = None

        equity_curve = np.empty(n, dtype=float)
        cash_curve = np.empty(n, dtype=float)
        pos_curve = {s: np.zeros(n, dtype=float) for s in symbols}
        weight_curve = {s: np.zeros(n, dtype=float) for s in symbols}
        target_curve = {s: np.zeros(n, dtype=float) for s in symbols}
        fill_records: list[dict] = []

        strategy.on_start(symbols)

        for i in range(n):
            # --- 1. execute what was decided at the previous close ---------
            if pending is not None:
                cash, n_dust = self._execute(
                    i, pending, cash, shares, opens, advs, fill_records, warnings
                )
                dust_skipped += n_dust

            # --- 2. mark to market at this close ---------------------------
            position_value = sum(shares[s] * closes[s][i] for s in symbols)
            equity = cash + position_value
            if equity <= 0:
                raise EngineError(
                    f"equity hit {equity:,.2f} at bar {i} ({self.index[i].date()}) — "
                    f"the account is wiped out; refusing to continue silently"
                )
            equity_curve[i] = equity
            cash_curve[i] = cash
            for s in symbols:
                pos_curve[s][i] = shares[s]
                weight_curve[s][i] = shares[s] * closes[s][i] / equity

            # --- 3. ask the strategy (frozen view of bars 0..i) ------------
            ctx = BarContext(
                frames=self.frames,
                bar_index=i,
                cash=cash,
                equity=equity,
                positions={s: shares[s] for s in symbols},
                weights={s: weight_curve[s][i] for s in symbols},
                rng=rng,
                seed=spec.seed,
            )
            desired = self._validate_weights(strategy.target_weights(ctx), i, strategy.name)
            desired = self._apply_overlays(overlays, ctx, desired, i, warnings)
            for s in symbols:
                target_curve[s][i] = desired[s]
            pending = desired

        # the final bar's target can never be executed — record it, loudly
        unexecuted = {s: pending[s] for s in symbols} if pending else {}
        if any(v > 0 for v in unexecuted.values()):
            warnings.append(
                f"target decided on the final bar ({self.index[-1].date()}) was never "
                f"executed: no bar t+1 exists. Weights: "
                f"{ {k: round(v, 6) for k, v in unexecuted.items() if v > 0} }"
            )

        terminal_liq = self._terminal_liquidation_cost(n - 1, shares, opens, closes, advs)
        if terminal_liq > 0:
            warnings.append(
                f"a position is still open on the last bar; the equity curve is "
                f"mark-to-market and does NOT include the ${terminal_liq:,.2f} it would "
                f"cost to exit it."
            )

        fills = pd.DataFrame(fill_records, columns=list(FILL_COLUMNS))
        return BacktestResult(
            spec=spec,
            strategy_name=strategy.name,
            strategy_config=strategy.describe(),
            overlay_names=tuple(getattr(o, "name", type(o).__name__) for o in overlays),
            equity=pd.Series(equity_curve, index=self.index, name="equity"),
            cash=pd.Series(cash_curve, index=self.index, name="cash"),
            positions=pd.DataFrame(pos_curve, index=self.index),
            weights=pd.DataFrame(weight_curve, index=self.index),
            targets=pd.DataFrame(target_curve, index=self.index),
            fills=fills,
            warnings=tuple(warnings),
            dust_skipped=dust_skipped,
            unexecuted_final_target=unexecuted,
            terminal_liquidation_cost=terminal_liq,
        )

    # ------------------------------------------------------- weight checks
    def _validate_weights(
        self, raw: Mapping[str, float], bar: int, strategy_name: str
    ) -> dict[str, float]:
        if not isinstance(raw, Mapping):
            raise EngineError(
                f"strategy '{strategy_name}' returned {type(raw).__name__}; "
                f"target_weights must return a mapping symbol -> weight"
            )
        unknown = [s for s in raw if s not in self.spec.symbols]
        if unknown:
            raise EngineError(
                f"strategy '{strategy_name}' asked for symbols outside the universe "
                f"{list(self.spec.symbols)}: {unknown}"
            )
        out: dict[str, float] = {}
        for s in self.spec.symbols:
            w = float(raw.get(s, 0.0))
            if not np.isfinite(w):
                raise EngineError(
                    f"strategy '{strategy_name}' returned a non-finite weight for {s} "
                    f"at bar {bar} ({self.index[bar].date()}): {w}"
                )
            if w < 0.0:
                raise EngineError(
                    f"strategy '{strategy_name}' returned a negative weight for {s} "
                    f"at bar {bar} ({self.index[bar].date()}): {w}. Phase 1 is long-only "
                    f"(spec section 6); shorts need the financing hook enabled first."
                )
            out[s] = w
        gross = sum(out.values())
        if gross > self.spec.max_gross + WEIGHT_TOL:
            raise EngineError(
                f"strategy '{strategy_name}' asked for gross exposure {gross:.6f} at bar "
                f"{bar} ({self.index[bar].date()}), above max_gross={self.spec.max_gross}. "
                f"Refusing to clip silently — fix the strategy or the cap."
            )
        return out

    def _apply_overlays(
        self,
        overlays: Sequence[ExposureOverlay],
        ctx: BarContext,
        desired: dict[str, float],
        bar: int,
        warnings: list[str],
    ) -> dict[str, float]:
        """Run the reduce-only seam. An overlay CANNOT increase exposure: its
        output is clamped to min(previous, output) and floored at 0. If an
        overlay tries, the clamp bites and the attempt is recorded — visibly,
        never silently (golden rule 2)."""
        current = desired
        for overlay in overlays:
            name = getattr(overlay, "name", type(overlay).__name__)
            proposed = overlay(ctx, dict(current))
            if not isinstance(proposed, Mapping):
                raise EngineError(
                    f"overlay '{name}' returned {type(proposed).__name__}; expected a mapping"
                )
            unknown = [s for s in proposed if s not in self.spec.symbols]
            if unknown:
                raise EngineError(f"overlay '{name}' returned unknown symbols {unknown}")
            clamped: dict[str, float] = {}
            increased: list[str] = []
            for s in self.spec.symbols:
                w = float(proposed.get(s, 0.0))
                if not np.isfinite(w):
                    raise EngineError(f"overlay '{name}' returned a non-finite weight for {s}")
                if w > current[s] + WEIGHT_TOL:
                    increased.append(f"{s}: {current[s]:.6f} -> {w:.6f}")
                clamped[s] = max(0.0, min(current[s], w))
            if increased:
                msg = (
                    f"overlay '{name}' tried to INCREASE exposure at bar {bar} "
                    f"({self.index[bar].date()}): {increased}. Clamped — the risk layer "
                    f"can only reduce (rule 2)."
                )
                if msg not in warnings:
                    warnings.append(msg)
            current = clamped
        return current

    # ----------------------------------------------------------- execution
    def _execute(
        self,
        i: int,
        targets: Mapping[str, float],
        cash: float,
        shares: dict[str, float],
        opens: Mapping[str, np.ndarray],
        advs: Mapping[str, np.ndarray],
        fill_records: list[dict],
        warnings: list[str],
    ) -> tuple[float, int]:
        """Execute ``targets`` at bar ``i``'s OPEN. Returns (cash, dust_skipped)."""
        if i == 0:  # pragma: no cover - structurally unreachable
            raise EngineError("bar 0 can never execute: no signal precedes it")
        spec = self.spec
        symbols = tuple(spec.symbols)
        prices = {s: opens[s][i] for s in symbols}
        equity_pre = cash + sum(shares[s] * prices[s] for s in symbols)

        band = max(spec.min_trade_notional, spec.min_trade_bps / 1e4 * equity_pre)

        deltas: dict[str, float] = {}
        dust = 0
        for s in symbols:
            desired_shares = targets[s] * equity_pre / prices[s]
            delta = desired_shares - shares[s]
            if delta == 0.0:
                continue
            # Going flat is never dust: a target of exactly zero always
            # liquidates in full, so the band can never strand a position.
            full_exit = targets[s] == 0.0 and shares[s] > 0.0
            if not full_exit and abs(delta) * prices[s] < band:
                dust += 1
                continue
            deltas[s] = delta

        sells = sorted((s for s, d in deltas.items() if d < 0))
        buys = sorted((s for s, d in deltas.items() if d > 0))

        # --- sells first: proceeds fund the buys ---------------------------
        for s in sells:
            qty = -deltas[s]
            cost = self._charge(i, s, side=-1, qty=qty, price=prices[s], advs=advs,
                                fill_records=fill_records)
            shares[s] += deltas[s]
            cash += qty * prices[s] - cost

        # --- buys, scaled so cash never goes negative once costs are paid --
        if buys:
            base = {s: deltas[s] for s in buys}
            gross_notional = sum(base[s] * prices[s] for s in buys)
            if cash <= 0.0:
                warnings.append(
                    f"bar {i} ({self.index[i].date()}): no cash available; buys "
                    f"{sorted(buys)} skipped entirely."
                )
                return cash, dust
            scale = self._solve_buy_scale(i, base, prices, cash, advs)
            if scale <= 0.0:
                warnings.append(
                    f"bar {i} ({self.index[i].date()}): buys {sorted(buys)} unaffordable "
                    f"after costs; skipped."
                )
                return cash, dust
            if scale < 1.0 - 1e-9:
                # Normal and expected at a 100% target (costs must come from
                # somewhere). Only worth a warning when it is a real shortfall.
                if scale < 0.999:
                    warnings.append(
                        f"bar {i} ({self.index[i].date()}): buys scaled to "
                        f"{scale:.6f} of target — insufficient cash after costs."
                    )
            for s in buys:
                qty = base[s] * scale
                if qty * prices[s] < spec.min_trade_notional:
                    dust += 1
                    continue
                cost = self._charge(i, s, side=1, qty=qty, price=prices[s], advs=advs,
                                    fill_records=fill_records)
                shares[s] += qty
                cash -= qty * prices[s] + cost
            if cash < -1e-6:  # pragma: no cover - the solve prevents this
                raise EngineError(
                    f"bar {i}: cash went negative ({cash:.6f}) after buys — the "
                    f"no-overdraft invariant is broken"
                )
        return cash, dust

    def _solve_buy_scale(
        self,
        i: int,
        base: Mapping[str, float],
        prices: Mapping[str, float],
        cash: float,
        advs: Mapping[str, np.ndarray],
    ) -> float:
        """Largest scale in (0, 1] such that notional + costs <= cash.

        Total cost is increasing in scale, so evaluating it at too large a
        scale always yields a CONSERVATIVE next guess: the iterate straddles
        the fixed point and contracts by roughly the cost rate (~1.5 bp) each
        step, so two evaluations already put us within ~1e-8 of fully
        invested. ``best`` only ever holds a scale that was VERIFIED
        affordable. Loud failure if it does not converge.
        """
        gross = sum(base[s] * prices[s] for s in base)
        if gross <= 0:
            return 0.0

        def cost_at(scale: float) -> float:
            return sum(
                self._cost_of(i, s, side=1, qty=base[s] * scale, price=prices[s], advs=advs)
                for s in sorted(base)
            )

        best = 0.0
        scale = min(1.0, cash / gross)
        for _ in range(AFFORD_MAX_ITERS):
            cost = cost_at(scale)
            if gross * scale + cost <= cash:
                if scale >= 1.0:
                    return 1.0
                best = max(best, scale)
            proposal = min(1.0, (cash - cost) / gross)
            if proposal <= 0.0:
                return best
            step = abs(proposal - scale) * gross
            scale = proposal
            if best > 0.0 and step <= AFFORD_TOL * cash:
                return best
        if best > 0.0:
            return best
        raise EngineError(
            f"bar {i} ({self.index[i].date()}): buy sizing failed to converge "
            f"(cash={cash:.6f}, gross={gross:.6f}). Refusing to guess."
        )

    # --------------------------------------------------------------- costs
    def _fill_frame(self, i: int, symbol: str, side: int, qty: float, price: float,
                    advs: Mapping[str, np.ndarray]) -> pd.DataFrame:
        adv = advs[symbol][i]
        if not np.isfinite(adv) or adv <= 0:
            raise EngineError(
                f"bar {i} ({self.index[i].date()}) {symbol}: point-in-time ADV is "
                f"{adv!r}. Slippage impact cannot be priced without a positive volume "
                f"denominator — refusing to fill uncosted."
            )
        return pd.DataFrame(
            {"side": [int(side)], "qty": [float(qty)], "price": [float(price)], "adv": [float(adv)]}
        )

    def _cost_of(self, i: int, symbol: str, side: int, qty: float, price: float,
                 advs: Mapping[str, np.ndarray]) -> float:
        """Price a hypothetical fill (sizing only — records nothing)."""
        if qty <= 0:
            return 0.0
        costed = apply_costs(
            self._fill_frame(i, symbol, side, qty, price, advs),
            self.spec.cost_params_for(symbol),
        )
        return float(costed["total_cost"].iloc[0])

    def _charge(self, i: int, symbol: str, side: int, qty: float, price: float,
                advs: Mapping[str, np.ndarray], fill_records: list[dict]) -> float:
        """Cost a REAL fill through ``costs.apply_costs`` and record it."""
        costed = apply_costs(
            self._fill_frame(i, symbol, side, qty, price, advs),
            self.spec.cost_params_for(symbol),
        )
        row = costed.iloc[0]
        fill_records.append(
            {
                "date": self.index[i],
                "bar_index": i,
                "signal_bar_index": i - 1,
                "signal_date": self.index[i - 1],
                "symbol": symbol,
                "side": int(side),
                "qty": float(row["qty"]),
                "price": float(row["price"]),
                "adv": float(row["adv"]),
                "notional": float(row["notional"]),
                "commission": float(row["commission"]),
                "spread_cost": float(row["spread_cost"]),
                "slippage_cost": float(row["slippage_cost"]),
                "financing_cost": float(row["financing_cost"]),
                "total_cost": float(row["total_cost"]),
                "effective_price": float(row["effective_price"]),
            }
        )
        return float(row["total_cost"])

    def _terminal_liquidation_cost(
        self,
        last: int,
        shares: Mapping[str, float],
        opens: Mapping[str, np.ndarray],
        closes: Mapping[str, np.ndarray],
        advs: Mapping[str, np.ndarray],
    ) -> float:
        """What it WOULD cost to flatten everything still held on the last bar.

        Reported, not charged: the equity curve is mark-to-market and you do
        still own the position. Priced at the last close with the last
        available point-in-time ADV, so it is an estimate — labelled as one.
        """
        total = 0.0
        for s in sorted(shares):
            qty = shares[s]
            if qty <= 0:
                continue
            adv = advs[s][last]
            if not np.isfinite(adv) or adv <= 0:  # pragma: no cover - defensive
                return float("nan")
            costed = apply_costs(
                pd.DataFrame(
                    {"side": [-1], "qty": [float(qty)], "price": [float(closes[s][last])],
                     "adv": [float(adv)]}
                ),
                self.spec.cost_params_for(s),
            )
            total += float(costed["total_cost"].iloc[0])
        return total


def run_backtest(
    spec: RunSpec,
    strategy: Strategy,
    overlays: Sequence[ExposureOverlay] = (),
    frames: Mapping[str, pd.DataFrame] | None = None,
    snapshots_dir=None,
) -> BacktestResult:
    """Convenience wrapper: build the engine, run one strategy."""
    return Backtester(spec, frames=frames, snapshots_dir=snapshots_dir).run(strategy, overlays)


def zero_cost_spec(spec: RunSpec) -> RunSpec:
    """A copy of ``spec`` with every cost zeroed.

    ISOLATION TOOL, NOT A MODE. It exists so tests can prove that a result's
    loss comes from ``apply_costs`` and not from the engine. It is never used
    by the reporting surface, and a gross number produced with it must never
    be presented as performance (golden rule 3).
    """
    free = CostParams(
        half_spread_bps=0.0,
        slippage_base_bps=0.0,
        slippage_impact_bps=0.0,
        commission_per_fill=0.0,
        commission_per_share=0.0,
        financing_rate_annual=0.0,
    )
    return replace(spec, default_cost_params=free, symbol_cost_params=())
