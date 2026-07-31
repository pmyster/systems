"""Costs are charged on every fill, and zero-edge trading loses in proportion
to trade count (milestone-2 DoD; golden rule 3; spec section 4).

This extends the milestone-1 acceptance gate from the standalone
``costs.random_timing_sim`` into the engine itself: same idea, same cost
model, but now every fill flows through the real bar loop, the real sizing and
the real accounting. If the engine leaked a free trade anywhere, these fail.

Why synthetic prices instead of SPY: milestone 1 had to DEMEAN real returns to
strip the index drift out of the null (see the spec's milestone-1 amendment).
Here we can do better — build a market whose drift is exactly zero by
construction, so the expected gross P&L of any timing rule is exactly zero and
the net result is exactly minus the costs. No demeaning, no approximation, no
future information.
"""

from typing import Mapping

import pytest

from costs.model import CostParams
from engine.backtest import Backtester, RunSpec, zero_cost_spec
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold, Strategy
from tests.synthetic import driftless_walk, engine_for, flat_market

SYMBOL = "TEST"
FLIP_PROBS = (0.05, 0.15, 0.40)


class RandomFlipStrategy(Strategy):
    """Zero-edge timing: flip flat<->fully-long with probability ``flip_prob``.

    Randomness comes from ``ctx.rng`` — the run's seeded generator — because a
    global/unseeded source would break R7 reproducibility.
    """

    def __init__(self, flip_prob: float, symbol: str = SYMBOL):
        self.flip_prob = float(flip_prob)
        self.symbol = symbol
        self.state = 0.0
        self.name = f"random_flip_p{flip_prob}"

    def on_start(self, symbols):
        self.state = 0.0

    def target_weights(self, ctx) -> Mapping[str, float]:
        if ctx.rng.random() < self.flip_prob:
            self.state = 1.0 - self.state
        return {self.symbol: self.state}

    def describe(self):
        return {"name": self.name, "class": type(self).__name__, "flip_prob": self.flip_prob}


def _run(bars, strategy, spec_kwargs=None, zero_cost=False):
    eng = engine_for(bars, SYMBOL, **(spec_kwargs or {}))
    if zero_cost:
        eng = Backtester(zero_cost_spec(eng.spec), frames=eng.frames)
    return eng.run(strategy)


@pytest.fixture(scope="module")
def flat():
    return flat_market(n=500, price=100.0)


@pytest.fixture(scope="module")
def flat_runs(flat):
    """One run per frequency, computed once (each run costs every fill through
    the real cost model, which is not free)."""
    return {p: _run(flat, RandomFlipStrategy(p)) for p in FLIP_PROBS}


@pytest.fixture(scope="module")
def walk():
    return driftless_walk(n=500, sigma=0.0005, seed=11)


class TestEveryFillIsCharged:
    def test_no_fill_escapes_the_cost_model(self, flat):
        r = _run(flat, RandomFlipStrategy(0.40))
        assert r.trade_count > 100
        assert (r.fills["total_cost"] > 0).all(), "a fill was executed free of charge"
        assert (r.fills["spread_cost"] > 0).all()
        assert (r.fills["slippage_cost"] > 0).all()
        assert r.total_costs == pytest.approx(r.fills["total_cost"].sum())

    def test_engine_has_no_gross_mode(self):
        """Golden rule 3 made structural: the default cost params are the real
        ones, and the run API exposes no switch that could turn costs off.
        ``zero_cost_spec`` is an explicit test tool that rewrites the cost
        PARAMS — visible in the spec it returns and in the fingerprint, and
        never used by the reporting surface."""
        import inspect

        from engine.backtest import Backtester

        spec = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        assert spec.cost_params_for(SYMBOL) == CostParams()
        assert spec.cost_params_for(SYMBOL).half_spread_bps > 0

        # the only knobs on a run are the strategy and the overlays
        assert set(inspect.signature(Backtester.run).parameters) == {
            "self", "strategy", "overlays"
        }
        # ...and no RunSpec field is a cost on/off flag
        assert not [
            f for f in RunSpec.__dataclass_fields__ if f.startswith(("charge_", "skip_", "use_"))
        ]
        free = zero_cost_spec(spec)
        assert free.cost_params_for(SYMBOL).half_spread_bps == 0.0
        assert free.fingerprint() != spec.fingerprint(), (
            "zeroing costs must change the run fingerprint, so a gross run can "
            "never be mistaken for the real one in the trial registry"
        )

    def test_per_symbol_cost_overrides_are_honoured(self, flat):
        wide = RunSpec(
            symbols=(SYMBOL,),
            snapshot="synthetic",
            symbol_cost_params=((SYMBOL, CostParams(half_spread_bps=10.0)),),
        )
        frames = {SYMBOL: adjusted_bars(flat)}
        tight_r = Backtester(RunSpec(symbols=(SYMBOL,), snapshot="synthetic"), frames=frames).run(
            RandomFlipStrategy(0.20)
        )
        wide_r = Backtester(wide, frames=frames).run(RandomFlipStrategy(0.20))
        assert wide_r.trade_count == tight_r.trade_count
        assert wide_r.total_costs > tight_r.total_costs
        assert wide_r.equity.iloc[-1] < tight_r.equity.iloc[-1]


class TestZeroEdgeTradingLosesInProportionToTradeCount:
    """On a market where every open and every close is the same price, gross
    P&L is EXACTLY zero for any strategy, so net equity is exactly initial
    capital minus the costs paid. Nothing is approximate here."""

    def test_flat_market_net_equals_initial_minus_costs_exactly(self, flat_runs):
        for p, r in flat_runs.items():
            initial = r.spec.initial_cash
            assert r.equity.iloc[-1] == pytest.approx(initial - r.total_costs, rel=1e-12), (
                f"flip_prob={p}: equity does not reconcile to initial minus costs"
            )
            assert r.equity.iloc[-1] < initial

    def test_loss_grows_with_trade_count(self, flat_runs):
        runs = [flat_runs[p] for p in FLIP_PROBS]
        trades = [r.trade_count for r in runs]
        losses = [r.spec.initial_cash - r.equity.iloc[-1] for r in runs]
        assert trades == sorted(trades) and trades[0] < trades[-1]
        for lo, hi in zip(losses, losses[1:]):
            assert hi > lo, f"loss did not grow with trade count: {list(zip(trades, losses))}"

    def test_loss_is_proportional_not_merely_monotone(self, flat_runs):
        """Cost per fill must be roughly constant, i.e. the loss scales with
        the NUMBER of trades rather than merely happening to increase."""
        runs = [flat_runs[p] for p in FLIP_PROBS]
        per_trade = [
            (r.spec.initial_cash - r.equity.iloc[-1]) / r.trade_count for r in runs
        ]
        assert max(per_trade) / min(per_trade) < 1.15

    def test_zero_cost_flat_market_is_exactly_break_even(self, flat):
        """Proves the loss above comes from apply_costs, not from the engine."""
        r = _run(flat, RandomFlipStrategy(0.40), zero_cost=True)
        assert r.trade_count > 100
        assert r.total_costs == 0.0
        assert r.equity.iloc[-1] == pytest.approx(r.spec.initial_cash, rel=1e-12)

    def test_buy_and_hold_pays_far_less_than_frequent_trading(self, flat, flat_runs):
        bh = _run(flat, BuyAndHold())
        churn = flat_runs[0.40]
        assert bh.trade_count == 1
        assert churn.trade_count > 50 * bh.trade_count
        assert churn.total_costs > 50 * bh.total_costs


class TestDriftlessRandomWalk:
    """Same gate on a market that actually moves, with realized drift removed
    by construction — the martingale null of spec section 1.1."""

    def test_random_timing_loses_net_at_every_frequency(self, walk):
        for p in FLIP_PROBS:
            r = _run(walk, RandomFlipStrategy(p))
            assert r.equity.iloc[-1] < r.spec.initial_cash, (
                f"flip_prob={p}: random timing showed a net PROFIT on a driftless "
                f"market — the cost model or the engine is wrong"
            )

    def test_costs_dominate_timing_luck_at_high_frequency(self, walk):
        r = _run(walk, RandomFlipStrategy(0.40))
        free = _run(walk, RandomFlipStrategy(0.40), zero_cost=True)
        gross_pnl = free.equity.iloc[-1] - free.spec.initial_cash
        assert abs(gross_pnl) < 0.25 * r.total_costs
