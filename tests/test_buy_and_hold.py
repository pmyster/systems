"""Milestone-2 DoD: the engine reproduces buy-and-hold SPY to a known benchmark.

The "known benchmark" is computed with plain arithmetic on the adjusted price
series, with no engine involved (``reports.benchmark``): enter at bar 1's
adjusted open, mark to market at the last adjusted close.

The engine's buy-and-hold cannot equal that number, and SHOULD not: the
reference does not pay to get in. The DoD is met by showing the entire gap is
accounted for, to machine precision, by the one entry fill — not by waving at
a "small difference".
"""

import numpy as np
import pytest

from data.loader import load_symbol
from engine.backtest import Backtester, RunSpec, zero_cost_spec
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold
from reports.benchmark import buy_and_hold_reference, explain_buy_and_hold_delta
from reports.metrics import compute_metrics, metrics_from_result

SNAPSHOT = "fixture"
SYMBOL = "SPY"
INITIAL = 100_000.0


@pytest.fixture(scope="module")
def frames():
    return {SYMBOL: adjusted_bars(load_symbol(SYMBOL, SNAPSHOT))}


@pytest.fixture(scope="module")
def spec():
    return RunSpec(symbols=(SYMBOL,), snapshot=SNAPSHOT, initial_cash=INITIAL)


@pytest.fixture(scope="module")
def result(spec, frames):
    return Backtester(spec, frames=frames).run(BuyAndHold())


@pytest.fixture(scope="module")
def reference(frames):
    return buy_and_hold_reference(frames[SYMBOL], symbol=SYMBOL)


class TestBuyAndHoldReproduction:
    def test_it_trades_exactly_once(self, result):
        """A HOLD is one fill. If the engine churns, turnover and cost numbers
        for every future strategy are wrong too."""
        assert len(result.fills) == 1
        assert int(result.fills["side"].iloc[0]) == 1
        assert int(result.fills["bar_index"].iloc[0]) == 1

    def test_entry_is_the_reference_entry_price(self, result, reference):
        assert result.fills["price"].iloc[0] == reference.entry_price

    def test_the_whole_delta_is_explained(self, result, reference):
        """r_ref - r_engine = (c+u)/E * r_ref + c/E, residual ~ 0."""
        d = explain_buy_and_hold_delta(reference, result)
        assert d["fill_matches_reference_entry"]
        # sizing leaves a sliver of cash uninvested (the fixed point stops a
        # cent short of perfection); it is carried in the identity, not lost
        assert abs(d["unused_cash_dollars"]) / INITIAL < 1e-7
        assert d["residual"] == pytest.approx(0.0, abs=1e-12)
        assert d["delta"] == pytest.approx(d["explained"]["total"], rel=1e-9)
        # the delta is small and entirely frictional, not a modelling gap
        assert 0 < d["delta"] < 0.01
        assert d["entry_cost_pct_of_initial"] == pytest.approx(0.015, abs=0.005)

    def test_zero_cost_run_matches_the_reference_exactly(self, spec, frames, reference):
        """Strip the only difference (the entry cost) and the engine must land
        on the arithmetic reference to machine precision. This is the actual
        'reproduces buy-and-hold' assertion."""
        free = zero_cost_spec(spec)
        r = Backtester(free, frames=frames).run(BuyAndHold())
        engine_return = r.equity.iloc[-1] / r.equity.iloc[0] - 1.0
        assert r.total_costs == 0.0
        assert engine_return == pytest.approx(reference.gross_total_return, rel=1e-12)

    def test_equity_curve_tracks_the_price_series(self, result, frames):
        """After entry the curve is just the adjusted close, scaled."""
        closes = frames[SYMBOL]["close"]
        held = result.equity.iloc[1:]
        ratio = held / closes.iloc[1:]
        # constant share count => constant ratio, up to the sliver of
        # uninvested cash riding along at a fixed dollar value
        assert ratio.std() / ratio.mean() < 1e-7

    def test_cagr_matches_the_reference_cagr_to_within_the_cost(self, result, reference):
        """Two known, tiny sources of difference and nothing else:
        (a) the entry cost (~1.5 bp once, ~1.5e-5/yr annualized), and
        (b) the window — the engine's curve starts on bar 0 (all cash, one day
            earlier) while the reference starts at the bar-1 entry, so the
            engine annualizes the same growth over one extra calendar day.
        Both are sub-basis-point per year. The exact identity is asserted in
        ``test_the_whole_delta_is_explained``; this is the sanity band."""
        m = metrics_from_result(result)
        assert m.cagr == pytest.approx(reference.gross_cagr, abs=2e-4)
        assert m.cagr < reference.gross_cagr  # costs and the extra day both drag
        assert m.trade_count == 1
        assert m.pct_time_in_market == pytest.approx(
            (len(result.equity) - 1) / len(result.equity) * 100.0
        )

    def test_reported_numbers_are_sane(self, result):
        """A guard against a silently-broken metric block: SPY 2016-2026 is a
        ~15%/yr, ~18%-vol, ~-34%-drawdown series. Wide bands on purpose —
        this catches an order-of-magnitude bug, not a rounding difference."""
        m = metrics_from_result(result)
        assert 0.10 < m.cagr < 0.20
        assert 0.12 < m.ann_volatility < 0.25
        assert -0.45 < m.max_drawdown < -0.25
        assert 0.5 < m.sharpe < 1.3
        assert m.sortino > m.sharpe
        assert m.calmar == pytest.approx(m.cagr / abs(m.max_drawdown))
        assert m.total_costs > 0


class TestBenchmarkIsAlwaysPresent:
    def test_report_pairs_strategy_with_buy_and_hold_over_the_same_window(self, spec, frames):
        from reports.report import run_and_report

        report, res, bench = run_and_report(spec, BuyAndHold(), frames=frames)
        assert report.benchmark.label == "buy_and_hold"
        assert report.benchmark.start_date == report.strategy.start_date
        assert report.benchmark.end_date == report.strategy.end_date
        assert report.benchmark.n_bars == report.strategy.n_bars
        # both columns are NET: the benchmark paid the same entry cost
        assert report.benchmark.total_costs > 0

    def test_mismatched_windows_are_refused(self, spec, frames):
        from reports.report import build_report

        long_run = Backtester(spec, frames=frames).run(BuyAndHold())
        short_spec = RunSpec(symbols=(SYMBOL,), snapshot=SNAPSHOT, initial_cash=INITIAL,
                             end="2020-01-01")
        short_frames = {SYMBOL: frames[SYMBOL].loc[:"2020-01-01"]}
        short_run = Backtester(short_spec, frames=short_frames).run(BuyAndHold())
        with pytest.raises(ValueError, match="IDENTICAL window"):
            build_report(long_run, short_run)


class TestReferenceIsEngineFree:
    def test_reference_uses_only_arithmetic(self, frames, reference):
        bars = frames[SYMBOL]
        assert reference.entry_price == float(bars["open"].iloc[1])
        assert reference.exit_price == float(bars["close"].iloc[-1])
        expected = bars["close"].iloc[-1] / bars["open"].iloc[1] - 1.0
        assert reference.gross_total_return == pytest.approx(expected, rel=1e-15)

    def test_reference_metrics_flag_their_own_gaps(self, frames):
        """A bare price curve has no fills and no weights; the metric block
        must SAY so rather than report 0 trades and 0% time in market as if
        they were measured."""
        curve = frames[SYMBOL]["close"].iloc[1:]
        m = compute_metrics(curve, label="reference")
        assert np.isnan(m.turnover_annual)
        assert np.isnan(m.pct_time_in_market)
        assert any("no fill log" in w for w in m.warnings)
        assert any("% time in market" in w for w in m.warnings)
