"""Metrics tested against inputs whose answers are known by construction.

The spec calls the evaluation code "the crown jewels — if they're wrong,
everything downstream is". The same logic applies one level down: if CAGR or
max drawdown is wrong, every gauntlet verdict built on top of them is wrong
too. So nothing here is checked against the implementation; each case has an
answer derivable on paper.
"""

import numpy as np
import pandas as pd
import pytest

from reports.metrics import (
    DAYS_PER_YEAR,
    TRADING_DAYS,
    MetricsError,
    compute_metrics,
    max_drawdown,
)


def curve(values, start="2020-01-01", freq="D"):
    idx = pd.date_range(start=start, periods=len(values), freq=freq)
    return pd.Series(np.asarray(values, dtype=float), index=idx, name="equity")


def fills(notionals, costs):
    return pd.DataFrame({"notional": notionals, "total_cost": costs})


class TestReturnsAndCAGR:
    def test_doubling_over_exactly_one_year(self):
        idx = pd.DatetimeIndex(["2020-01-01", "2020-12-31"])
        # 365 days = 0.99932 years, so CAGR is very slightly above 100%
        m = compute_metrics(pd.Series([100.0, 200.0], index=idx), label="x")
        assert m.total_return == pytest.approx(1.0)
        assert m.years == pytest.approx(365 / DAYS_PER_YEAR)
        assert m.cagr == pytest.approx(2 ** (DAYS_PER_YEAR / 365) - 1)

    def test_cagr_compounds_over_multiple_years(self):
        idx = pd.DatetimeIndex(["2016-01-01", "2020-01-01"])  # 1461 days = 4.0 years
        m = compute_metrics(pd.Series([100.0, 100.0 * 1.1**4], index=idx), label="x")
        assert m.years == pytest.approx(4.0, abs=1e-3)
        assert m.cagr == pytest.approx(0.1, abs=1e-4)

    def test_a_flat_curve_has_zero_return(self):
        m = compute_metrics(curve([100.0] * 50), label="x")
        assert m.total_return == 0.0
        assert m.cagr == pytest.approx(0.0)


class TestRiskMetrics:
    def test_max_drawdown_is_peak_to_trough(self):
        assert max_drawdown(curve([100, 120, 60, 90])) == pytest.approx(-0.5)

    def test_max_drawdown_of_a_monotone_curve_is_zero(self):
        assert max_drawdown(curve([100, 110, 120])) == 0.0

    def test_drawdown_measures_from_the_peak_not_the_start(self):
        assert max_drawdown(curve([100, 50, 200, 150])) == pytest.approx(-0.5)

    def test_sharpe_matches_the_textbook_formula(self):
        rng = np.random.default_rng(0)
        r = rng.normal(0.0005, 0.01, 500)
        eq = curve(100.0 * np.cumprod(1 + np.concatenate([[0.0], r])))
        m = compute_metrics(eq, label="x")
        expected = r.mean() / r.std(ddof=1) * np.sqrt(TRADING_DAYS)
        assert m.sharpe == pytest.approx(expected, rel=1e-9)

    def test_risk_free_rate_lowers_sharpe(self):
        rng = np.random.default_rng(1)
        r = rng.normal(0.0005, 0.01, 500)
        eq = curve(100.0 * np.cumprod(1 + np.concatenate([[0.0], r])))
        assert compute_metrics(eq, "x", risk_free_annual=0.04).sharpe < compute_metrics(
            eq, "x"
        ).sharpe

    def test_sortino_exceeds_sharpe_for_a_right_skewed_curve(self):
        """Downside deviation < total deviation when losses are the small side."""
        r = np.array([0.05] * 20 + [-0.005] * 80)
        eq = curve(100.0 * np.cumprod(1 + np.concatenate([[0.0], r])))
        m = compute_metrics(eq, label="x")
        assert m.sortino > m.sharpe

    def test_calmar_is_cagr_over_max_drawdown(self):
        rng = np.random.default_rng(2)
        r = rng.normal(0.0003, 0.01, 800)
        eq = curve(100.0 * np.cumprod(1 + np.concatenate([[0.0], r])))
        m = compute_metrics(eq, label="x")
        assert m.calmar == pytest.approx(m.cagr / abs(m.max_drawdown))

    def test_annual_volatility_annualizes_by_root_252(self):
        rng = np.random.default_rng(3)
        r = rng.normal(0.0, 0.01, 1000)
        eq = curve(100.0 * np.cumprod(1 + np.concatenate([[0.0], r])))
        m = compute_metrics(eq, label="x")
        assert m.ann_volatility == pytest.approx(r.std(ddof=1) * np.sqrt(TRADING_DAYS))


class TestTradeMetrics:
    def test_trade_count_is_the_number_of_fills(self):
        m = compute_metrics(curve([100.0] * 30), "x", fills=fills([10.0] * 7, [0.1] * 7))
        assert m.trade_count == 7
        assert m.total_costs == pytest.approx(0.7)

    def test_turnover_is_notional_over_mean_equity_per_year(self):
        idx = pd.DatetimeIndex(["2020-01-01", "2021-12-31"])  # 730 days ~ 2 years
        eq = pd.Series([100.0, 100.0], index=idx)
        m = compute_metrics(eq, "x", fills=fills([100.0, 100.0], [0.0, 0.0]))
        years = 730 / DAYS_PER_YEAR
        assert m.turnover_annual == pytest.approx(200.0 / 100.0 / years)

    def test_pct_time_in_market(self):
        w = pd.DataFrame({"A": [0.0, 0.0, 1.0, 1.0, 0.0]},
                         index=pd.date_range("2020-01-01", periods=5, freq="D"))
        m = compute_metrics(curve([100.0] * 5), "x", weights=w)
        assert m.pct_time_in_market == pytest.approx(40.0)

    def test_cost_drag_is_relative_to_starting_equity(self):
        m = compute_metrics(curve([1000.0] * 10), "x", fills=fills([100.0] * 5, [2.0] * 5))
        assert m.cost_drag_pct_of_initial == pytest.approx(1.0)


class TestDegenerateCasesAreVisible:
    def test_zero_volatility_gives_nan_sharpe_and_says_so(self):
        m = compute_metrics(curve([100.0] * 40), label="flat")
        assert np.isnan(m.sharpe)
        assert any("zero daily volatility" in w for w in m.warnings)

    def test_zero_drawdown_gives_nan_calmar_and_says_so(self):
        m = compute_metrics(curve(np.linspace(100, 200, 50)), label="up")
        assert np.isnan(m.calmar)
        assert any("max drawdown is exactly zero" in w for w in m.warnings)

    def test_no_down_days_gives_nan_sortino_and_says_so(self):
        m = compute_metrics(curve(np.linspace(100, 200, 50)), label="up")
        assert np.isnan(m.sortino)
        assert any("Sortino" in w for w in m.warnings)

    def test_two_point_curve_cannot_estimate_volatility(self):
        """One return observation => undefined sample variance. Declared, not
        emitted as a numpy RuntimeWarning and a silent NaN."""
        idx = pd.DatetimeIndex(["2020-01-01", "2021-01-01"])
        m = compute_metrics(pd.Series([100.0, 150.0], index=idx), label="x")
        assert m.total_return == pytest.approx(0.5)
        assert np.isnan(m.sharpe) and np.isnan(m.sortino) and np.isnan(m.ann_volatility)
        assert any("return observation" in w for w in m.warnings)

    def test_missing_fills_and_weights_are_declared_not_faked(self):
        m = compute_metrics(curve([100.0, 101.0, 102.0]), label="bare")
        assert np.isnan(m.turnover_annual)
        assert np.isnan(m.pct_time_in_market)
        assert np.isnan(m.total_costs)
        assert len(m.warnings) >= 2


class TestLoudFailures:
    def test_single_point_curve(self):
        with pytest.raises(MetricsError, match="at least 2"):
            compute_metrics(curve([100.0]), label="x")

    def test_empty_curve(self):
        with pytest.raises(MetricsError, match="non-empty"):
            compute_metrics(pd.Series([], dtype=float), label="x")

    def test_non_positive_equity(self):
        with pytest.raises(MetricsError, match="non-positive"):
            compute_metrics(curve([100.0, 0.0, 50.0]), label="x")

    def test_same_day_window_cannot_annualize(self):
        idx = pd.DatetimeIndex(["2020-01-01", "2020-01-01"])
        with pytest.raises(MetricsError, match="cannot annualize"):
            compute_metrics(pd.Series([100.0, 101.0], index=idx), label="x")

    def test_unsorted_index(self):
        idx = pd.DatetimeIndex(["2020-01-02", "2020-01-01"])
        with pytest.raises(MetricsError, match="increasing"):
            compute_metrics(pd.Series([100.0, 101.0], index=idx), label="x")


class TestSerialization:
    def test_to_dict_round_trips_through_json(self):
        import json

        m = compute_metrics(curve([100.0, 101.0, 99.0, 105.0]), "x",
                            fills=fills([10.0], [0.1]))
        blob = json.dumps(m.to_dict(), sort_keys=True)
        assert json.loads(blob)["label"] == "x"
        assert json.loads(blob)["trade_count"] == 1
