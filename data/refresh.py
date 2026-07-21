"""Create a NEW immutable point-in-time snapshot (never overwrites).

Usage:
    python -m data.refresh                        # snapshot named today (YYYY-MM-DD)
    python -m data.refresh --snapshot-id 2026-07-21b
    python -m data.refresh --start 2016-01-01 --symbols SPY QQQ IWM

Downloads daily OHLCV (unadjusted + adjusted close) for the default universe
via yfinance, plus the FRED HY OAS series via FRED's keyless CSV endpoint,
into ``data/snapshots/<snapshot_id>/``. If that directory already exists the
run FAILS with SnapshotExistsError — snapshots are immutable; a re-download
is a NEW snapshot. A ``manifest.json`` records what/when/how for provenance.

Caveat recorded here on purpose: yfinance adjusted prices are retroactively
revised (dividends/splits/restatements), which is exactly why we freeze
snapshots instead of re-downloading inside backtests.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import pandas as pd

from data.loader import SNAPSHOTS_DIR, OHLCV_COLUMNS, SnapshotExistsError

DEFAULT_SYMBOLS = ("SPY", "QQQ", "IWM", "TLT", "GLD", "^VIX")
DEFAULT_START = "2016-01-01"
FRED_SERIES = ("BAMLH0A0HYM2",)  # ICE BofA US High Yield OAS (risk backbone input, H3)
# KNOWN LIMITATION (observed 2026-07-21): the keyless fredgraph endpoint now
# caps history at roughly the last 3 years and IGNORES cosd (we pass it
# anyway in case the cap is lifted). The ~3y window is enough for the H3
# stress-flag *trend* input; longer history will need the free FRED API key
# when the risk backbone is built. Recorded in the snapshot manifest.
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}"


def fetch_yfinance_daily(symbol: str, start: str) -> pd.DataFrame:
    """Download daily OHLCV for one symbol; normalize to the snapshot schema."""
    import yfinance as yf

    raw = yf.download(
        symbol,
        start=start,
        interval="1d",
        auto_adjust=False,  # keep BOTH raw close and adjusted close
        actions=False,
        progress=False,
    )
    if raw is None or raw.empty:
        raise RuntimeError(f"yfinance returned no data for {symbol!r} (start={start})")

    # yfinance >= 0.2 returns MultiIndex (Price, Ticker) columns even for one symbol.
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    rename = {
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Adj Close": "adj_close",
        "Volume": "volume",
    }
    missing = [c for c in rename if c not in raw.columns]
    if missing:
        raise RuntimeError(f"{symbol}: yfinance frame missing columns {missing}; got {list(raw.columns)}")
    df = raw.rename(columns=rename)[list(OHLCV_COLUMNS)].copy()

    # Index -> tz-naive trading dates.
    idx = pd.to_datetime(df.index)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    df.index = idx.normalize()
    df.index.name = "date"
    df = df.sort_index()
    if df.index.has_duplicates:
        raise RuntimeError(f"{symbol}: duplicate dates from yfinance — refusing to snapshot")
    # Drop rows with all-NaN prices (Yahoo pads some non-trading days), but
    # fail loudly if a *partial* NaN row remains — that's corrupt data.
    price_cols = ["open", "high", "low", "close", "adj_close"]
    all_nan = df[price_cols].isna().all(axis=1)
    df = df[~all_nan]
    if df[price_cols].isna().any().any():
        bad = df.index[df[price_cols].isna().any(axis=1)]
        raise RuntimeError(f"{symbol}: partial-NaN price rows at {list(bad[:5])} — refusing to snapshot")
    return df


def fetch_fred_csv(series_id: str, start: str = DEFAULT_START) -> pd.DataFrame:
    """Fetch a FRED series via the keyless fredgraph CSV endpoint -> (date, value)."""
    import io

    import requests

    url = FRED_CSV_URL.format(series_id=series_id, start=start)
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text))
    if df.shape[1] != 2:
        raise RuntimeError(f"FRED {series_id}: expected 2 columns, got {list(df.columns)}")
    df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    # FRED encodes missing observations as '.'; keep them as empty (-> NaN on
    # load) so gaps stay VISIBLE instead of being silently dropped.
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df


def write_snapshot(
    frames: dict[str, pd.DataFrame],
    snapshot_id: str,
    snapshots_dir: Path | None = None,
    manifest_extra: dict | None = None,
) -> Path:
    """Write frames into a NEW snapshot directory. Immutability is enforced:
    if the directory already exists, raise SnapshotExistsError and touch
    nothing. (Unit-testable without network.)"""
    root = snapshots_dir if snapshots_dir is not None else SNAPSHOTS_DIR
    target = root / snapshot_id
    if target.exists():
        raise SnapshotExistsError(
            f"snapshot '{snapshot_id}' already exists at {target} — snapshots are "
            f"immutable. Use a new --snapshot-id to create another one."
        )
    target.mkdir(parents=True)

    manifest: dict = {
        "snapshot_id": snapshot_id,
        "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "files": {},
    }
    if manifest_extra:
        manifest.update(manifest_extra)

    for name, df in frames.items():
        path = target / f"{name}.csv"
        out = df.reset_index() if df.index.name == "date" else df
        if "date" in out.columns and not pd.api.types.is_string_dtype(out["date"]):
            out = out.copy()
            out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")
        out.to_csv(path, index=False, lineterminator="\n")
        manifest["files"][f"{name}.csv"] = {"rows": int(len(out))}

    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a new immutable data snapshot.")
    parser.add_argument("--symbols", nargs="+", default=list(DEFAULT_SYMBOLS))
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument(
        "--snapshot-id",
        default=dt.date.today().isoformat(),
        help="snapshot directory name (default: today, YYYY-MM-DD). Must not exist yet.",
    )
    parser.add_argument("--skip-fred", action="store_true", help="skip the FRED HY OAS series")
    args = parser.parse_args(argv)

    import yfinance

    frames: dict[str, pd.DataFrame] = {}
    for sym in args.symbols:
        print(f"downloading {sym} from {args.start} ...")
        frames[sym] = fetch_yfinance_daily(sym, args.start)
        print(f"  {len(frames[sym])} rows ({frames[sym].index[0].date()} -> {frames[sym].index[-1].date()})")

    fred_status: dict[str, str] = {}
    if not args.skip_fred:
        for series_id in FRED_SERIES:
            try:
                print(f"downloading FRED {series_id} ...")
                frames[series_id] = fetch_fred_csv(series_id, start=args.start)
                print(f"  {len(frames[series_id])} rows")
                fred_status[series_id] = "ok"
            except Exception as exc:  # loud, recorded, but not fatal: not needed until the risk backbone
                print(f"  WARNING: FRED {series_id} download FAILED: {exc}")
                fred_status[series_id] = f"FAILED: {exc}"

    manifest_extra = {
        "source": {"ohlcv": f"yfinance {yfinance.__version__} (auto_adjust=False)", "fred": fred_status},
        "start": args.start,
        "symbols": args.symbols,
        "caveat": (
            "yfinance adjusted prices are retroactively revised (dividends/splits/"
            "restatements); this snapshot freezes what was observed on created_utc."
        ),
    }
    target = write_snapshot(frames, args.snapshot_id, manifest_extra=manifest_extra)
    print(f"snapshot written: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
