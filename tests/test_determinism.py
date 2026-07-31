"""Reproducibility (R7, golden rule 5): same inputs => byte-identical output.

"Byte-identical" is taken literally. It is not enough for two runs to agree to
six decimals: a backtest that drifts is a backtest whose results cannot be
audited, re-derived, or compared across the trial registry. So the assertions
here compare serialized bytes — the CSV of the equity curve and the JSON of
the report — not just numbers.

The engine has no wall clock, no global RNG and no unordered iteration.
Strategies that need randomness draw from ``ctx.rng``, which is seeded from
``RunSpec.seed``; a different seed must therefore give a different answer, and
that is asserted too (a "deterministic" engine that ignores its seed would
pass every other test here).
"""

import pandas as pd
import pytest

from data.loader import load_symbol
from engine.backtest import Backtester, RunSpec
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold
from reports.report import build_report, run_and_report
from tests.synthetic import driftless_walk
from tests.test_engine_costs import RandomFlipStrategy

SYMBOL = "SPY"


@pytest.fixture(scope="module")
def frames():
    return {SYMBOL: adjusted_bars(load_symbol(SYMBOL, "fixture"))}


@pytest.fixture(scope="module")
def spec():
    return RunSpec(symbols=(SYMBOL,), snapshot="fixture", seed=20260721)


def _run(spec, frames, strategy):
    return Backtester(spec, frames=frames).run(strategy)


class TestDeterministicStrategy:
    def test_equity_curves_are_byte_identical(self, spec, frames):
        a = _run(spec, frames, BuyAndHold())
        b = _run(spec, frames, BuyAndHold())
        assert a.equity.to_csv().encode() == b.equity.to_csv().encode()
        pd.testing.assert_series_equal(a.equity, b.equity, check_exact=True)

    def test_fill_logs_are_identical(self, spec, frames):
        a = _run(spec, frames, BuyAndHold())
        b = _run(spec, frames, BuyAndHold())
        pd.testing.assert_frame_equal(a.fills, b.fills, check_exact=True)
        pd.testing.assert_frame_equal(a.positions, b.positions, check_exact=True)
        pd.testing.assert_frame_equal(a.weights, b.weights, check_exact=True)
        pd.testing.assert_frame_equal(a.targets, b.targets, check_exact=True)

    def test_reports_serialize_byte_identically(self, spec, frames):
        report_a, _, _ = run_and_report(spec, BuyAndHold(), frames=frames)
        report_b, _, _ = run_and_report(spec, BuyAndHold(), frames=frames)
        assert report_a.to_json() == report_b.to_json()
        assert report_a.to_json().encode() == report_b.to_json().encode()

    def test_a_fresh_engine_object_changes_nothing(self, spec, frames):
        """No hidden state survives between engines or between runs."""
        engine = Backtester(spec, frames=frames)
        first = engine.run(BuyAndHold())
        second = engine.run(BuyAndHold())  # same engine, reused
        third = Backtester(spec, frames=frames).run(BuyAndHold())  # fresh engine
        pd.testing.assert_series_equal(first.equity, second.equity, check_exact=True)
        pd.testing.assert_series_equal(first.equity, third.equity, check_exact=True)


@pytest.fixture(scope="module")
def walk_frames():
    return {"TEST": adjusted_bars(driftless_walk(n=250, seed=3))}


class TestSeededRandomStrategy:
    """A strategy that uses ``ctx.rng`` must be reproducible AND seed-sensitive."""

    def test_same_seed_same_run(self, walk_frames):
        spec = RunSpec(symbols=("TEST",), snapshot="synthetic", seed=99)
        a = Backtester(spec, frames=walk_frames).run(RandomFlipStrategy(0.3, "TEST"))
        b = Backtester(spec, frames=walk_frames).run(RandomFlipStrategy(0.3, "TEST"))
        assert a.equity.to_csv() == b.equity.to_csv()
        assert a.trade_count == b.trade_count
        pd.testing.assert_frame_equal(a.fills, b.fills, check_exact=True)

    def test_different_seed_different_run(self, walk_frames):
        s1 = RunSpec(symbols=("TEST",), snapshot="synthetic", seed=99)
        s2 = RunSpec(symbols=("TEST",), snapshot="synthetic", seed=100)
        a = Backtester(s1, frames=walk_frames).run(RandomFlipStrategy(0.3, "TEST"))
        b = Backtester(s2, frames=walk_frames).run(RandomFlipStrategy(0.3, "TEST"))
        assert a.equity.iloc[-1] != b.equity.iloc[-1]
        assert s1.fingerprint() != s2.fingerprint()

    def test_the_seed_reaches_the_strategy(self, walk_frames):
        spec = RunSpec(symbols=("TEST",), snapshot="synthetic", seed=4242)
        seen = []

        class SeedPeek(RandomFlipStrategy):
            def target_weights(self, ctx):
                seen.append(ctx.seed)
                return super().target_weights(ctx)

        Backtester(spec, frames=walk_frames).run(SeedPeek(0.3, "TEST"))
        assert set(seen) == {4242}


class TestNoHiddenNondeterminism:
    def test_report_json_is_stable_across_python_dict_ordering(self, spec, frames):
        """Sorted keys, so the JSON cannot reorder between interpreter runs."""
        report, _, _ = run_and_report(spec, BuyAndHold(), frames=frames)
        blob = report.to_json()
        assert blob == report.to_json()
        keys = [line.split('"')[1] for line in blob.splitlines() if line.startswith('  "')]
        assert keys == sorted(keys)

    def test_fingerprint_is_stable_and_recorded_in_the_report(self, spec, frames):
        report, result, bench = run_and_report(spec, BuyAndHold(), frames=frames)
        assert report.spec_fingerprint == spec.fingerprint()
        assert report.spec_fingerprint == build_report(result, bench).spec_fingerprint
