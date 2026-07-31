"""Unit tests for the point-in-time loader: reproducibility, immutability,
and loud failure on anything malformed or missing."""

import pandas as pd
import pytest

from data.loader import (
    LoaderError,
    SnapshotExistsError,
    list_snapshots,
    load_fred_series,
    load_ohlcv,
    load_symbol,
)
from data.refresh import write_snapshot

FIXTURE = "fixture"


class TestReproducibility:
    def test_same_snapshot_same_bytes(self):
        """Loading the same symbol from the same snapshot twice must yield
        byte-identical frames — the reproducibility contract (R7)."""
        a = load_symbol("SPY", FIXTURE)
        b = load_symbol("SPY", FIXTURE)
        pd.testing.assert_frame_equal(a, b)
        assert a.to_csv() == b.to_csv()  # byte-identical serialization

    def test_schema_and_dates(self):
        df = load_symbol("SPY", FIXTURE)
        assert list(df.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
        assert df.index.name == "date"
        assert df.index.tz is None  # tz-naive NYSE trading dates, documented
        assert df.index.is_monotonic_increasing and not df.index.has_duplicates
        assert len(df) > 2000  # fixture carries 2016 -> mid-2026 SPY

    def test_date_window_slicing(self):
        df = load_symbol("SPY", FIXTURE, start="2020-01-01", end="2020-12-31")
        assert df.index[0].year == 2020 and df.index[-1].year == 2020

    def test_multi_symbol_load(self):
        frames = load_ohlcv(["SPY", "QQQ"], FIXTURE)
        assert set(frames) == {"SPY", "QQQ"}
        assert all(not f.empty for f in frames.values())

    def test_fred_series_loads_with_visible_gaps(self):
        s = load_fred_series("BAMLH0A0HYM2", FIXTURE)
        assert s.index.is_monotonic_increasing
        assert len(s) > 500
        # FRED holidays are stored as NaN — visible, not silently dropped.
        assert s.notna().sum() > 0


class TestLoudFailures:
    def test_missing_snapshot(self):
        with pytest.raises(LoaderError, match="snapshot 'no-such-snapshot' not found"):
            load_symbol("SPY", "no-such-snapshot")

    def test_missing_symbol_lists_what_exists(self):
        with pytest.raises(LoaderError, match="Symbols present"):
            load_symbol("TSLA", FIXTURE)

    def test_empty_window_refused(self):
        with pytest.raises(LoaderError, match="no rows in requested window"):
            load_symbol("SPY", FIXTURE, start="1990-01-01", end="1990-12-31")

    def test_empty_symbol_list_refused(self):
        with pytest.raises(LoaderError, match="empty symbol list"):
            load_ohlcv([], FIXTURE)

    def test_malformed_file_refused(self, tmp_path):
        snap = tmp_path / "bad-snap"
        snap.mkdir()
        (snap / "XXX.csv").write_text("date,open,close\n2020-01-02,1,2\n", encoding="utf-8")
        with pytest.raises(LoaderError, match="missing required columns"):
            load_symbol("XXX", "bad-snap", snapshots_dir=tmp_path)

    def test_duplicate_dates_refused(self, tmp_path):
        snap = tmp_path / "dup-snap"
        snap.mkdir()
        row = "2020-01-02,1,2,0.5,1.5,1.4,100\n"
        (snap / "XXX.csv").write_text(
            "date,open,high,low,close,adj_close,volume\n" + row + row, encoding="utf-8"
        )
        with pytest.raises(LoaderError, match="strictly increasing and unique"):
            load_symbol("XXX", "dup-snap", snapshots_dir=tmp_path)


class TestSnapshotImmutability:
    def dummy_frames(self, value=1.0):
        df = pd.DataFrame(
            {
                "date": ["2020-01-02", "2020-01-03"],
                "open": [value, value],
                "high": [value, value],
                "low": [value, value],
                "close": [value, value],
                "adj_close": [value, value],
                "volume": [100, 100],
            }
        )
        return {"DUMMY": df}

    def test_refresh_never_overwrites(self, tmp_path):
        """Re-running refresh with the same snapshot id must FAIL and leave
        the original snapshot byte-for-byte untouched."""
        write_snapshot(self.dummy_frames(1.0), "2020-06-30", snapshots_dir=tmp_path)
        original = (tmp_path / "2020-06-30" / "DUMMY.csv").read_bytes()

        with pytest.raises(SnapshotExistsError, match="immutable"):
            write_snapshot(self.dummy_frames(999.0), "2020-06-30", snapshots_dir=tmp_path)

        assert (tmp_path / "2020-06-30" / "DUMMY.csv").read_bytes() == original

    def test_new_snapshot_id_creates_sibling(self, tmp_path):
        write_snapshot(self.dummy_frames(), "2020-06-30", snapshots_dir=tmp_path)
        write_snapshot(self.dummy_frames(), "2020-07-01", snapshots_dir=tmp_path)
        assert list_snapshots(tmp_path) == ["2020-06-30", "2020-07-01"]

    def test_written_snapshot_roundtrips_through_loader(self, tmp_path):
        write_snapshot(self.dummy_frames(42.0), "rt", snapshots_dir=tmp_path)
        df = load_symbol("DUMMY", "rt", snapshots_dir=tmp_path)
        assert df.loc["2020-01-02", "close"] == 42.0
