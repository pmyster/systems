"""THE acceptance test for the cost model (spec section 4, milestone 1 DoD).

Seeded random-entry/random-exit strategies at multiple trade frequencies,
run on real snapshot data (committed fixture: SPY 2016 -> mid-2026), every
fill charged through apply_costs.

The gate: expected net P&L of random trading is NEGATIVE, and the loss grows
with trade count. If a frequent random strategy shows a profit, the cost
model is wrong.

Why the gate is evaluated on demeaned returns: a long-only random strategy
on raw SPY captures ~half the index drift — that is beta (buyable with one
round trip), not timing skill. The martingale null of spec section 1.1 says
blind timing has ~zero expected GROSS P&L; removing the drift tests exactly
that, so expected NET = minus the cost drag. Raw-series numbers are reported
alongside for honesty but are not the gate.

Everything here is seeded and deterministic (R7): same run, same numbers.
"""

import numpy as np
import pytest

from costs.model import CostParams
from costs.random_timing_sim import (
    DEFAULT_FLIP_PROBS,
    format_table,
    run_frequency_sweep,
    run_random_timing,
)
from data.loader import load_symbol

SEED = 20260721
N_PATHS = 2000
NOTIONAL = 10_000.0


@pytest.fixture(scope="module")
def spy():
    return load_symbol("SPY", "fixture")


@pytest.fixture(scope="module")
def sweep(spy):
    return run_frequency_sweep(
        spy, flip_probs=DEFAULT_FLIP_PROBS, n_paths=N_PATHS, seed=SEED, notional=NOTIONAL
    )


class TestTheGate:
    def test_random_trading_loses_net_at_every_frequency(self, sweep):
        """Expected net P&L of random timing must be negative — full stop."""
        for r in sweep:
            assert r.mean_net_demeaned < 0, (
                f"flip_prob={r.flip_prob}: random trading shows a net PROFIT "
                f"({r.mean_net_demeaned:+.2f} $) — the cost model is wrong"
            )

    def test_loss_scales_with_trade_count(self, sweep):
        """More trades => strictly bigger expected loss."""
        ordered = sorted(sweep, key=lambda r: r.mean_trades_per_year)
        trades = [r.mean_trades_per_year for r in ordered]
        losses = [-r.mean_net_demeaned for r in ordered]
        assert trades == sorted(trades)
        for lo, hi in zip(losses, losses[1:]):
            assert hi > lo, f"loss did not grow with trade count: {losses}"

    def test_cost_drag_is_roughly_proportional_to_trades(self, sweep):
        """Cost per trade should be about constant across frequencies
        (fixed notional => spread+slippage scale with fill count)."""
        per_trade = [
            r.mean_cost / (r.mean_trades_per_year * 10.0)  # fixture spans ~10.5y
            for r in sweep
        ]
        assert max(per_trade) / min(per_trade) < 1.25

    def test_majority_of_frequent_random_paths_lose(self, sweep):
        """At the highest frequency a clear majority of random paths must
        lose net. (Not ~100%: over 10.5y the per-path timing-luck stdev is
        a few $1000s against a ~$2.4k mean cost drag, so ~20% of paths get
        lucky gross — the MEAN gate above is the primary assertion.)"""
        highest = max(sweep, key=lambda r: r.mean_trades_per_year)
        assert highest.pct_paths_net_negative_demeaned > 75.0

    def test_gross_timing_is_noise_not_edge(self, sweep):
        """Demeaned gross (pure timing luck) must be small next to the cost
        drag at high frequency — costs dominate, luck does not."""
        highest = max(sweep, key=lambda r: r.mean_trades_per_year)
        assert abs(highest.mean_gross_demeaned) < 0.25 * highest.mean_cost


class TestReproducibility:
    def test_same_seed_same_numbers(self, spy):
        a = run_random_timing(spy, 0.30, n_paths=200, seed=SEED)
        b = run_random_timing(spy, 0.30, n_paths=200, seed=SEED)
        assert a == b

    def test_different_seed_different_numbers(self, spy):
        a = run_random_timing(spy, 0.30, n_paths=200, seed=SEED)
        b = run_random_timing(spy, 0.30, n_paths=200, seed=SEED + 1)
        assert a.mean_net_demeaned != b.mean_net_demeaned


class TestNoFreeLunchKnobs:
    def test_zero_cost_model_shows_no_drag(self, spy):
        """Sanity: with every cost zeroed, mean net == mean gross. Proves the
        loss in the gate comes from apply_costs, not from the sim itself."""
        free = CostParams(
            half_spread_bps=0.0, slippage_base_bps=0.0, slippage_impact_bps=0.0
        )
        r = run_random_timing(spy, 0.30, n_paths=200, seed=SEED, params=free)
        assert r.mean_cost == 0.0
        assert r.mean_net_demeaned == pytest.approx(r.mean_gross_demeaned)

    def test_wider_spread_loses_more(self, spy):
        tight = run_random_timing(spy, 0.30, n_paths=500, seed=SEED)
        wide = run_random_timing(
            spy, 0.30, n_paths=500, seed=SEED, params=CostParams(half_spread_bps=5.0)
        )
        assert wide.mean_net_demeaned < tight.mean_net_demeaned


def test_print_results_table(sweep):
    """Not an assertion — prints the loss-scaling table into the pytest
    output so every run shows the numbers (run with -s or -rA to see it)."""
    print()
    print(format_table(sweep, NOTIONAL))
