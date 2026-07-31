"""The reporting surface: the mandated metric set, always beside buy-and-hold.

CLAUDE.md: "Every result report includes, alongside the strategy: net CAGR,
Sharpe, Sortino, max drawdown, Calmar, trade count, turnover, % time in market
— and the same metrics for buy-and-hold over the identical window." These
tests make that literal rather than aspirational.
"""

import pytest

from data.loader import load_symbol
from engine.backtest import RunSpec
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold
from reports.report import format_report, run_and_report
from tests.test_engine import ConstantStrategy

SYMBOL = "SPY"

MANDATED = (
    "cagr",
    "sharpe",
    "sortino",
    "max_drawdown",
    "calmar",
    "trade_count",
    "turnover_annual",
    "pct_time_in_market",
)


@pytest.fixture(scope="module")
def frames():
    return {SYMBOL: adjusted_bars(load_symbol(SYMBOL, "fixture"))}


@pytest.fixture(scope="module")
def spec():
    return RunSpec(symbols=(SYMBOL,), snapshot="fixture")


@pytest.fixture(scope="module")
def flat_report(spec, frames):
    """A strategy that never invests, reported against buy-and-hold."""
    return run_and_report(spec, ConstantStrategy({SYMBOL: 0.0}), frames=frames)


class TestMandatedMetricSet:
    def test_every_mandated_metric_is_present_for_both_columns(self, flat_report):
        report, _, _ = flat_report
        for attr in MANDATED:
            assert hasattr(report.strategy, attr), f"strategy metric '{attr}' missing"
            assert hasattr(report.benchmark, attr), f"benchmark metric '{attr}' missing"

    def test_the_benchmark_column_is_real_and_net(self, flat_report):
        report, _, bench = flat_report
        assert report.benchmark.label == "buy_and_hold"
        assert report.benchmark.trade_count == 1
        assert report.benchmark.total_costs > 0  # net, not gross
        assert report.benchmark.cagr > 0.10  # SPY 2016-2026

    def test_the_flat_strategy_is_honestly_reported_as_doing_nothing(self, flat_report):
        report, result, _ = flat_report
        assert report.strategy.trade_count == 0
        assert report.strategy.total_return == 0.0
        assert report.strategy.pct_time_in_market == 0.0
        assert report.strategy.turnover_annual == 0.0
        # ...and the degenerate metrics say so instead of printing 0.0
        assert any("zero daily volatility" in w for w in report.strategy.warnings)

    def test_rendered_table_shows_both_columns_and_the_notes(self, flat_report):
        report, _, _ = flat_report
        text = format_report(report)
        for label in ("net CAGR", "Sharpe", "Sortino", "max drawdown", "Calmar",
                      "trade count", "turnover", "% time in market"):
            assert label in text
        assert "buy_and_hold" in text
        assert "difference" in text
        assert "NOTES" in text
        assert "n/a" in text  # NaN metrics are shown as n/a, never as 0

    def test_report_records_the_conventions_it_was_produced_under(self, flat_report):
        report, _, _ = flat_report
        assert report.price_basis == "adjusted"
        assert report.fill_convention == "signal on bar t's close -> fill at bar t+1's open"
        assert report.snapshot == "fixture"
        assert report.spec_fingerprint


class Rebalancer(ConstantStrategy):
    """Holds 50%, then asks for 53%. Under a wide band that ask is refused."""

    name = "rebalancer"

    def target_weights(self, ctx):
        return {SYMBOL: 0.50 if ctx.bar_index < 100 else 0.53}


@pytest.fixture(scope="module")
def suppressed_report(frames):
    """A 50% -> 53% rebalance under a 500 bp band: fully suppressed."""
    spec = RunSpec(symbols=(SYMBOL,), snapshot="fixture", min_trade_bps=500.0)
    return run_and_report(spec, Rebalancer({SYMBOL: 0.5}), frames=frames)


class TestSuppressedTradesReachTheReport:
    """A strategy author must be able to SEE that the engine declined to
    execute what they asked for. A counter buried in the result object that no
    report ever reads is not visibility."""

    def test_the_report_carries_the_suppression_counts(self, suppressed_report):
        report, result, _ = suppressed_report
        assert result.suppressed_trades > 0
        assert report.suppressed_trades == result.suppressed_trades
        assert report.suppression.largest_suppressed_bps > 0
        assert report.suppression.largest_suppressed_symbol == SYMBOL
        assert report.suppression.largest_target_weight == pytest.approx(0.53)

    def test_the_rendered_table_says_so_out_loud(self, suppressed_report):
        report, _, _ = suppressed_report
        text = format_report(report)
        assert "trades SUPPRESSED" in text
        assert "DECLINED" in text
        assert "wanted weight" in text
        assert "SUPPRESSED" in text.upper()

    def test_it_survives_serialization(self, suppressed_report):
        report, _, _ = suppressed_report
        d = report.to_dict()
        assert d["suppression"]["suppressed_trades"] > 0
        assert "benchmark_suppression" in d
        assert "suppression" in report.to_json()

    def test_a_clean_run_says_nothing_was_overridden(self, flat_report):
        report, _, _ = flat_report
        assert report.suppressed_trades == 0
        assert report.benchmark_suppression.suppressed_trades == 0
        text = format_report(report)
        assert "trades SUPPRESSED" in text  # the row is ALWAYS shown...
        assert "rounding dust" in text  # ...and states the benign verdict


class TestBenchmarkCannotBeOmitted:
    def test_report_construction_requires_a_benchmark_result(self):
        import inspect

        from reports.report import Report, build_report

        params = inspect.signature(build_report).parameters
        assert "benchmark_result" in params
        assert params["benchmark_result"].default is inspect.Parameter.empty
        assert "benchmark" in Report.__dataclass_fields__

    def test_run_and_report_defaults_the_benchmark_to_buy_and_hold(self, spec, frames):
        report, _, bench = run_and_report(spec, BuyAndHold(name="strat"), frames=frames)
        assert report.strategy.label == "strat"
        assert report.benchmark.label == "buy_and_hold"
        assert bench.strategy_config["class"] == "BuyAndHold"

    def test_the_benchmark_runs_without_the_strategy_overlays(self, spec, frames):
        class Veto:
            name = "veto"

            def __call__(self, ctx, desired):
                return {k: 0.0 for k in desired}

        report, result, bench = run_and_report(
            spec, BuyAndHold(), overlays=[Veto()], frames=frames
        )
        assert result.trade_count == 0  # the overlay vetoed the strategy
        assert bench.trade_count == 1  # ...but not the passive alternative
        assert report.overlay_names == ("veto",)
