"""Point-in-time snapshot loader (spec section 8, milestone 1).

Discipline
----------
- Data lives in **immutable, versioned local snapshots**:
  ``data/snapshots/<snapshot_id>/<symbol>.csv`` where ``snapshot_id`` is
  normally the download date (``YYYY-MM-DD``). A snapshot is written once by
  ``data.refresh`` and NEVER modified afterwards; a refresh creates a NEW
  dated snapshot directory. Every backtest therefore runs against a frozen,
  named dataset and is exactly reproducible (golden rule 5 / R7).
- The special committed snapshot ``fixture`` is a small slice of real data
  kept in git so the test suite runs from a fresh clone with no network.

Date semantics (documented, deliberate)
---------------------------------------
Dates are NYSE trading dates stored as tz-naive ``YYYY-MM-DD``. There are no
intraday timestamps in this layer; intraday ordering is expressed solely by
the repo's canonical fill convention (signal on bar t's close -> execution at
bar t+1's open — see ``costs.model``). Column names are standardized
lowercase: ``open, high, low, close, adj_close, volume``.

Known caveat (why we snapshot at all)
-------------------------------------
yfinance's *adjusted* prices are retroactively revised when new dividends/
splits occur, and Yahoo occasionally restates history. A live re-download is
therefore NOT reproducible. Snapshots freeze what we saw on a given day;
backtests reference the snapshot id, never "whatever Yahoo says today".

Failure policy
--------------
Loud, never silent: unknown snapshot, missing symbol, malformed file, empty
date-range slice — all raise ``LoaderError`` with an actionable message.
Nothing is ever skipped-and-continued.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOTS_DIR = REPO_ROOT / "data" / "snapshots"

OHLCV_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")


class LoaderError(RuntimeError):
    """Any data-loading failure. Always raised loudly, never swallowed."""


class SnapshotExistsError(RuntimeError):
    """Raised when a write would touch an existing snapshot (immutability)."""


def snapshot_path(snapshot_id: str, snapshots_dir: Path | None = None) -> Path:
    """Resolve a snapshot id to its directory; raise loudly if absent."""
    root = snapshots_dir if snapshots_dir is not None else SNAPSHOTS_DIR
    path = root / snapshot_id
    if not path.is_dir():
        available = list_snapshots(root)
        raise LoaderError(
            f"snapshot '{snapshot_id}' not found under {root}. "
            f"Available snapshots: {available or 'NONE (run python -m data.refresh)'}"
        )
    return path


def list_snapshots(snapshots_dir: Path | None = None) -> list[str]:
    """Names of all snapshots on disk (sorted)."""
    root = snapshots_dir if snapshots_dir is not None else SNAPSHOTS_DIR
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def load_symbol(
    symbol: str,
    snapshot: str,
    start: str | None = None,
    end: str | None = None,
    snapshots_dir: Path | None = None,
) -> pd.DataFrame:
    """Load one symbol's daily OHLCV from a named snapshot.

    Returns a DataFrame indexed by tz-naive trading date (sorted, unique)
    with columns exactly ``open, high, low, close, adj_close, volume``.
    Raises LoaderError on: unknown snapshot, missing symbol file, malformed
    or non-monotonic dates, NaNs in required columns, or an empty slice for
    the requested [start, end] window.
    """
    snap = snapshot_path(snapshot, snapshots_dir)
    csv_path = snap / f"{symbol}.csv"
    if not csv_path.is_file():
        available = sorted(p.stem for p in snap.glob("*.csv"))
        raise LoaderError(
            f"symbol '{symbol}' not in snapshot '{snapshot}' ({csv_path} missing). "
            f"Symbols present: {available}"
        )

    df = pd.read_csv(csv_path)
    if "date" not in df.columns:
        raise LoaderError(f"{csv_path}: missing 'date' column; not a valid OHLCV snapshot file")
    missing = [c for c in OHLCV_COLUMNS if c not in df.columns]
    if missing:
        raise LoaderError(f"{csv_path}: missing required columns {missing}")

    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    df = df.set_index("date")[list(OHLCV_COLUMNS)]

    if df.empty:
        raise LoaderError(f"{csv_path}: file contains no rows")
    if not df.index.is_monotonic_increasing or df.index.has_duplicates:
        raise LoaderError(f"{csv_path}: dates must be strictly increasing and unique")
    if df[["open", "high", "low", "close", "adj_close"]].isna().any().any():
        bad = df.index[df[["open", "high", "low", "close", "adj_close"]].isna().any(axis=1)]
        raise LoaderError(f"{csv_path}: NaN prices at {list(bad[:5])}{'...' if len(bad) > 5 else ''}")

    if start is not None or end is not None:
        df = df.loc[slice(start, end)]
        if df.empty:
            raise LoaderError(
                f"symbol '{symbol}' snapshot '{snapshot}': no rows in requested window "
                f"[{start}, {end}] — refusing to return an empty frame silently"
            )
    return df


def load_ohlcv(
    symbols: list[str] | tuple[str, ...],
    snapshot: str,
    start: str | None = None,
    end: str | None = None,
    snapshots_dir: Path | None = None,
) -> dict[str, pd.DataFrame]:
    """Load several symbols from one snapshot. All-or-nothing: any missing
    symbol raises (no silent partial universe)."""
    if not symbols:
        raise LoaderError("load_ohlcv called with an empty symbol list")
    return {
        sym: load_symbol(sym, snapshot, start=start, end=end, snapshots_dir=snapshots_dir)
        for sym in symbols
    }


def load_fred_series(
    series_id: str,
    snapshot: str,
    snapshots_dir: Path | None = None,
) -> pd.Series:
    """Load a FRED series (e.g. HY OAS 'BAMLH0A0HYM2') from a snapshot.

    Stored as ``<series_id>.csv`` with columns ``date,value``; missing
    observations (FRED's '.') are stored as empty and returned as NaN —
    visible, not dropped.
    """
    snap = snapshot_path(snapshot, snapshots_dir)
    csv_path = snap / f"{series_id}.csv"
    if not csv_path.is_file():
        raise LoaderError(f"FRED series '{series_id}' not in snapshot '{snapshot}' ({csv_path} missing)")
    df = pd.read_csv(csv_path)
    if list(df.columns) != ["date", "value"]:
        raise LoaderError(f"{csv_path}: expected columns ['date', 'value'], got {list(df.columns)}")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    s = df.set_index("date")["value"].astype(float)
    if s.empty:
        raise LoaderError(f"{csv_path}: file contains no rows")
    if not s.index.is_monotonic_increasing or s.index.has_duplicates:
        raise LoaderError(f"{csv_path}: dates must be strictly increasing and unique")
    return s
