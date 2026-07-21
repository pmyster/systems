"""Random-timing simulation — the acceptance test for the cost model (spec §4).

The spec's `random_timing_sim.py` was referenced but never committed; this is
the fresh, in-repo implementation.

What it does
------------
Runs many seeded random-entry / random-exit long-only strategies on real
snapshot data, charges every fill through ``costs.apply_costs``, and measures
expected net P&L as a function of trade frequency.

The gate: **expected net P&L of random trading must be negative, and the loss
must grow with trade count.** If a frequent random strategy shows a profit,
the cost model is wrong.

Timing (canonical convention — see costs.model)
-----------------------------------------------
The random state for day *t* is decided on bar *t-1*'s CLOSE and executed at
bar *t*'s OPEN. Holding day *t* therefore earns the open(t) -> open(t+1)
return. No fill ever uses information from its own bar. No lookahead.

The drift subtlety (why we demean)
----------------------------------
On raw prices, a long-only random strategy captures roughly half of the
underlying ETF's drift — that is beta you could buy for one round trip, not
timing skill, and in a bull decade it can exceed the cost drag at low trade
counts. The null hypothesis we are testing is spec §1.1: at blind-timing
horizons price is ~a martingale, so expected GROSS timing P&L is ~0 and
expected NET is minus the costs. We therefore evaluate the null on DEMEANED
open-to-open returns (drift removed). Raw-series results are also reported
for honesty, never as the gate.

Point-in-time ADV: slippage uses a 20-day rolling mean of volume lagged one
day (only data available before the fill).

Run it:
    python -m costs.random_timing_sim --snapshot fixture --symbol SPY
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
import pandas as pd

from costs.model import CostParams, apply_costs
from data.loader import load_symbol

DEFAULT_FLIP_PROBS = (0.05, 0.15, 0.30, 0.60)
ADV_WINDOW = 20
TRADING_DAYS = 252


@dataclass(frozen=True)
class FrequencyResult:
    flip_prob: float
    n_paths: int
    mean_trades_per_year: float
    mean_gross_demeaned: float   # $ per path, drift removed — expect ~0
    mean_cost: float             # $ per path, always > 0
    mean_net_demeaned: float     # $ per path — THE gate: must be < 0
    mean_net_raw: float          # $ per path on raw returns (reported, not the gate)
    pct_paths_net_negative_demeaned: float


def _point_in_time_adv(volume: pd.Series) -> pd.Series:
    """20-day rolling mean volume, lagged one day: only history known at the fill."""
    return volume.rolling(ADV_WINDOW, min_periods=1).mean().shift(1)


def run_random_timing(
    prices: pd.DataFrame,
    flip_prob: float,
    n_paths: int,
    seed: int,
    notional: float = 10_000.0,
    params: CostParams | None = None,
    _uniforms: np.ndarray | None = None,
    _initial_state: np.ndarray | None = None,
) -> FrequencyResult:
    """Simulate ``n_paths`` random strategies at one trade frequency.

    Each day the strategy flips state (flat<->long) with probability
    ``flip_prob`` (symmetric entry/exit). Position for day t is decided at
    close t-1 and executed at open t; each transition is one fill of fixed
    ``notional`` charged through apply_costs.

    ``_uniforms`` lets the frequency sweep reuse one seeded uniform draw
    across all frequencies (common random numbers): the timing luck is then
    shared between frequencies, so differences between them isolate the cost
    drag instead of Monte Carlo noise.
    """
    if params is None:
        params = CostParams()
    if not 0.0 < flip_prob <= 1.0:
        raise ValueError(f"flip_prob must be in (0, 1], got {flip_prob}")

    opens = prices["open"].to_numpy(dtype=float)
    n_days = len(opens) - 1  # day t earns open[t] -> open[t+1]; last open is exit-only
    if n_days < 50:
        raise ValueError(f"need at least ~50 bars for a meaningful sim, got {n_days + 1}")

    r_raw = opens[1:] / opens[:-1] - 1.0            # open-to-open simple returns, day t
    r_dem = r_raw - r_raw.mean()                    # drift removed (martingale null)
    # .copy(): pandas 3.0 copy-on-write can hand back a read-only view.
    adv = _point_in_time_adv(prices["volume"]).to_numpy(dtype=float)[: n_days + 1].copy()
    # First bar has no lagged ADV; backfill with the first known value (fills
    # on bar 0 are impossible anyway — state starts flat and flips execute
    # from bar 1 onward — but keep the array total, not NaN).
    if np.isnan(adv[0]):
        adv[0] = adv[~np.isnan(adv)][0]

    if _uniforms is None:
        rng = np.random.default_rng(seed)
        _initial_state = (rng.random(n_paths) < 0.5).astype(np.int8)
        _uniforms = rng.random((n_paths, n_days))
    if _uniforms.shape != (n_paths, n_days):
        raise ValueError(f"_uniforms shape {_uniforms.shape} != {(n_paths, n_days)}")
    if _initial_state is None or _initial_state.shape != (n_paths,):
        raise ValueError("_initial_state must accompany _uniforms with shape (n_paths,)")
    # State h[t] in {0, 1}: long during day t. The symmetric flip chain's
    # stationary distribution is P(long) = 1/2, so paths START there (long
    # with prob 1/2, entry fill at the first open): otherwise a flat start
    # ramps exposure up over the early sample and correlates time-in-market
    # with the drift profile — a bias, not timing skill. Flip decisions are
    # made at each close and take effect at the NEXT open.
    flips = _uniforms < flip_prob
    h = np.zeros((n_paths, n_days), dtype=np.int8)
    state = _initial_state.copy()
    for t in range(n_days):
        state = np.where(flips[:, t], 1 - state, state)
        h[:, t] = state

    gross_dem = notional * (h * r_dem).sum(axis=1)
    gross_raw = notional * (h * r_raw).sum(axis=1)

    # Fills: every state transition (including a forced final exit if still long).
    prev = np.concatenate([np.zeros((n_paths, 1), dtype=np.int8), h], axis=1)
    trans = np.diff(prev, axis=1)                   # +1 entry at open t, -1 exit at open t
    path_idx, day_idx = np.nonzero(trans)
    sides = trans[path_idx, day_idx]
    # Forced final exit at the last open for paths still long on the last day.
    still_long = np.nonzero(h[:, -1] == 1)[0]
    path_idx = np.concatenate([path_idx, still_long])
    day_idx = np.concatenate([day_idx, np.full(len(still_long), n_days, dtype=day_idx.dtype)])
    sides = np.concatenate([sides, np.full(len(still_long), -1, dtype=sides.dtype)])

    fill_prices = opens[day_idx]
    fills = pd.DataFrame(
        {
            "side": sides.astype(int),
            "qty": notional / fill_prices,
            "price": fill_prices,
            "adv": adv[day_idx],
        }
    )
    costed = apply_costs(fills, params)
    cost_per_path = (
        pd.Series(costed["total_cost"].to_numpy(), index=path_idx)
        .groupby(level=0)
        .sum()
        .reindex(range(n_paths), fill_value=0.0)
        .to_numpy()
    )
    trades_per_path = (
        pd.Series(1, index=path_idx).groupby(level=0).sum().reindex(range(n_paths), fill_value=0).to_numpy()
    )

    net_dem = gross_dem - cost_per_path
    net_raw = gross_raw - cost_per_path
    years = n_days / TRADING_DAYS

    return FrequencyResult(
        flip_prob=flip_prob,
        n_paths=n_paths,
        mean_trades_per_year=float(trades_per_path.mean() / years),
        mean_gross_demeaned=float(gross_dem.mean()),
        mean_cost=float(cost_per_path.mean()),
        mean_net_demeaned=float(net_dem.mean()),
        mean_net_raw=float(net_raw.mean()),
        pct_paths_net_negative_demeaned=float((net_dem < 0).mean() * 100.0),
    )


def run_frequency_sweep(
    prices: pd.DataFrame,
    flip_probs: tuple[float, ...] = DEFAULT_FLIP_PROBS,
    n_paths: int = 2000,
    seed: int = 20260721,
    notional: float = 10_000.0,
    params: CostParams | None = None,
) -> list[FrequencyResult]:
    """Run the sim at several trade frequencies (seeded, reproducible).

    One seeded uniform draw is shared across all frequencies (common random
    numbers), so cross-frequency comparisons isolate the cost drag.
    """
    n_days = len(prices) - 1
    rng = np.random.default_rng(seed)
    initial_state = (rng.random(n_paths) < 0.5).astype(np.int8)
    uniforms = rng.random((n_paths, n_days))
    return [
        run_random_timing(
            prices,
            fp,
            n_paths=n_paths,
            seed=seed,
            notional=notional,
            params=params,
            _uniforms=uniforms,
            _initial_state=initial_state,
        )
        for fp in flip_probs
    ]


def format_table(results: list[FrequencyResult], notional: float = 10_000.0) -> str:
    lines = [
        f"Random-timing sim ($ {notional:,.0f} notional per position, net of full cost model)",
        f"{'flip_p':>7} {'trades/yr':>10} {'gross(dem)$':>12} {'cost$':>10} "
        f"{'NET(dem)$':>11} {'net(raw)$':>10} {'%paths<0':>9}",
    ]
    for r in results:
        lines.append(
            f"{r.flip_prob:>7.2f} {r.mean_trades_per_year:>10.1f} {r.mean_gross_demeaned:>12.2f} "
            f"{r.mean_cost:>10.2f} {r.mean_net_demeaned:>11.2f} {r.mean_net_raw:>10.2f} "
            f"{r.pct_paths_net_negative_demeaned:>8.1f}%"
        )
    lines.append("Gate: NET(dem) < 0 at every frequency and the loss grows with trade count.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Random-timing cost-model acceptance sim")
    parser.add_argument("--snapshot", default="fixture")
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--paths", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=20260721)
    args = parser.parse_args(argv)

    prices = load_symbol(args.symbol, args.snapshot)
    results = run_frequency_sweep(prices, n_paths=args.paths, seed=args.seed)
    print(f"snapshot={args.snapshot} symbol={args.symbol} bars={len(prices)} paths={args.paths} seed={args.seed}")
    print(format_table(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
