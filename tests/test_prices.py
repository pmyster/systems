"""Adjusted-price construction and point-in-time ADV (engine/prices.py)."""

import numpy as np
import pandas as pd
import pytest

from data.loader import load_symbol
from engine.prices import ADV_WINDOW, PriceError, adjusted_bars
from tests.synthetic import raw_frame


class TestAdjustment:
    def test_factor_of_one_is_a_no_op(self):
        raw = raw_frame([100, 101, 102], [101, 102, 103])
        adj = adjusted_bars(raw)
        assert adj["open"].tolist() == [100.0, 101.0, 102.0]
        assert adj["close"].tolist() == [101.0, 102.0, 103.0]

    def test_ohlc_is_scaled_by_the_close_ratio(self):
        """adj_close/close is applied to open/high/low too — otherwise the bar
        is internally inconsistent (an 'adjusted' close beside a raw open)."""
        raw = raw_frame([100.0, 100.0], [100.0, 100.0], factor=[0.9, 1.0])
        adj = adjusted_bars(raw)
        assert adj["open"].iloc[0] == pytest.approx(90.0)
        assert adj["high"].iloc[0] == pytest.approx(100.1 * 0.9)
        assert adj["low"].iloc[0] == pytest.approx(99.9 * 0.9)
        assert adj["close"].iloc[0] == pytest.approx(90.0)
        assert adj["open"].iloc[1] == pytest.approx(100.0)

    def test_raw_close_is_carried_through(self):
        raw = raw_frame([100.0], [100.0], factor=[0.5])
        adj = adjusted_bars(raw)
        assert adj["raw_close"].iloc[0] == 100.0
        assert adj["close"].iloc[0] == 50.0

    def test_dollar_volume_is_preserved(self):
        """Adjusted-share volume must keep dollar volume invariant, so
        participation (qty/adv) means the same thing before and after."""
        raw = raw_frame([100.0], [100.0], volume=1_000.0, factor=[0.5])
        adj = adjusted_bars(raw)
        assert adj["volume"].iloc[0] * adj["close"].iloc[0] == pytest.approx(1_000.0 * 100.0)

    def test_real_snapshot_adjusts_cleanly(self):
        adj = adjusted_bars(load_symbol("SPY", "fixture"))
        raw = load_symbol("SPY", "fixture")
        assert len(adj) == len(raw)
        # the final bar has no adjustments left to apply -> adjusted == raw
        assert adj["close"].iloc[-1] == pytest.approx(raw["close"].iloc[-1])
        # early bars are adjusted DOWN by the dividends paid since
        assert adj["close"].iloc[0] < raw["close"].iloc[0]
        assert (adj[["open", "high", "low", "close"]] > 0).all().all()


class TestPointInTimeADV:
    def test_adv_is_lagged_one_bar(self):
        """The fill bar's own volume is not available when the fill happens."""
        raw = raw_frame([100.0] * 5, [100.0] * 5)
        raw["volume"] = [10.0, 20.0, 30.0, 40.0, 50.0]
        adj = adjusted_bars(raw)
        assert np.isnan(adj["adv"].iloc[0])  # nothing precedes bar 0
        assert adj["adv"].iloc[1] == pytest.approx(10.0)
        assert adj["adv"].iloc[2] == pytest.approx(15.0)
        assert adj["adv"].iloc[3] == pytest.approx(20.0)

    def test_window_matches_the_random_timing_sim(self):
        from costs.random_timing_sim import ADV_WINDOW as SIM_WINDOW

        assert ADV_WINDOW == SIM_WINDOW

    def test_adv_never_uses_future_volume(self):
        raw = raw_frame([100.0] * 60, [100.0] * 60)
        raw["volume"] = np.arange(1.0, 61.0)
        adj = adjusted_bars(raw)
        for i in range(1, 60):
            prior = raw["volume"].iloc[max(0, i - ADV_WINDOW): i]
            assert adj["adv"].iloc[i] == pytest.approx(prior.mean())


class TestLoudFailures:
    def test_missing_column(self):
        raw = raw_frame([100.0], [100.0]).drop(columns=["adj_close"])
        with pytest.raises(PriceError, match="missing required columns"):
            adjusted_bars(raw)

    def test_non_positive_close(self):
        raw = raw_frame([100.0, 100.0], [100.0, 100.0])
        raw.iloc[1, raw.columns.get_loc("close")] = 0.0
        with pytest.raises(PriceError, match="strictly positive"):
            adjusted_bars(raw)

    def test_unsorted_index(self):
        raw = raw_frame([100.0, 101.0], [100.0, 101.0])
        raw = raw.iloc[::-1]
        with pytest.raises(PriceError, match="strictly increasing"):
            adjusted_bars(raw)

    def test_empty_frame(self):
        with pytest.raises(PriceError, match="empty"):
            adjusted_bars(raw_frame([100.0], [100.0]).iloc[0:0])
