"""Price preparation for the backtester (milestone 2).

THE ADJUSTED-PRICE DECISION (documented on purpose)
---------------------------------------------------
Backtests run on **split- and dividend-ADJUSTED** prices. The snapshot schema
(``data.loader``) stores raw ``open/high/low/close/volume`` plus an adjusted
``adj_close`` (yfinance ``auto_adjust=False``). Only the close is adjusted at
source, so we reconstruct the adjusted OHLC with the per-bar ratio

    factor[t] = adj_close[t] / close[t]
    adj_open[t]  = open[t]  * factor[t]      (same for high and low)

Why adjusted, everywhere, without an opt-out:
  * A total-return series is the only one where "buy and hold" means what a
    real holder experiences. On raw prices every dividend and every split is
    an artificial gap DOWN, so a raw-price backtest silently understates
    buy-and-hold and hands any short/flat rule a fake edge.
  * The reconstruction is exact for splits and is the standard
    dividend-reinvestment approximation (the dividend is reinvested at the
    ex-date close). It is an approximation of *when* the cash is reinvested,
    not of *how much*, and it is the same approximation the benchmark uses,
    so strategy-vs-benchmark comparisons are apples to apples.
  * The milestone-1 random-timing null deliberately used UNADJUSTED opens.
    That was fine there (a null needs a price series, not a total-return
    series) but it is wrong for a real backtest, so this layer exists and the
    engine has no raw-price mode.

Caveat kept visible: adjusted history is retroactively revised whenever a new
dividend/split lands, which is exactly why every run is pinned to an
immutable snapshot id (``data.loader``). Adjusted prices are also not
point-in-time *levels* — the level a trader saw on 2016-01-04 was the raw
price. We trade notional, never share counts pinned to a price level, so
returns are unaffected; anything that ever keys off an absolute price level
must use the raw column and say so.

VOLUME / ADV
------------
Slippage size-impact needs a volume denominator in the same share units as
the quantities we trade. Adjusted shares are raw shares scaled by
``1/factor``, so the invariant is dollar volume:

    adv_shares_adjusted[t] = volume[t] * close[t] / adj_close[t]

participation = qty_adj / adv_adj = order_notional / dollar_volume — a pure
dollar participation, immune to the adjustment factor.

ADV is a 20-day rolling mean **lagged one bar** (identical convention to
``costs.random_timing_sim``): only volume history that was already printed
before the fill bar can price that fill's impact. Using the fill bar's own
volume would be a one-bar lookahead.
"""

from __future__ import annotations

import pandas as pd

ADV_WINDOW = 20  # bars; matches costs.random_timing_sim.ADV_WINDOW on purpose

ADJUSTED_COLUMNS = ("open", "high", "low", "close", "volume", "adv", "raw_close")


class PriceError(ValueError):
    """Malformed or unusable price data. Always raised loudly, never patched over."""


def adjusted_bars(raw: pd.DataFrame, adv_window: int = ADV_WINDOW) -> pd.DataFrame:
    """Turn one symbol's snapshot OHLCV into the adjusted frame the engine trades.

    Input: a frame from ``data.loader.load_symbol`` (columns
    ``open, high, low, close, adj_close, volume``, indexed by trading date).

    Output columns:
        open, high, low, close : ADJUSTED prices (total-return basis)
        volume                 : adjusted-share volume for that bar
        adv                    : 20-bar rolling mean of ``volume``, LAGGED one
                                 bar (NaN on bar 0 — no prior history exists)
        raw_close              : the unadjusted close, carried through so
                                 anything that legitimately needs a real price
                                 LEVEL has to ask for it explicitly

    Raises PriceError on anything it cannot honestly adjust.
    """
    required = ("open", "high", "low", "close", "adj_close", "volume")
    missing = [c for c in required if c not in raw.columns]
    if missing:
        raise PriceError(f"price frame missing required columns {missing}")
    if raw.empty:
        raise PriceError("price frame is empty")
    if not raw.index.is_monotonic_increasing or raw.index.has_duplicates:
        raise PriceError("price frame index must be strictly increasing and unique")

    close = raw["close"].astype(float)
    adj_close = raw["adj_close"].astype(float)
    if (close <= 0).any() or (adj_close <= 0).any():
        raise PriceError("close and adj_close must be strictly positive on every bar")

    factor = adj_close / close
    if not factor.replace([float("inf"), float("-inf")], pd.NA).notna().all():
        raise PriceError("adjustment factor adj_close/close is not finite on every bar")

    out = pd.DataFrame(index=raw.index.copy())
    out["open"] = raw["open"].astype(float) * factor
    out["high"] = raw["high"].astype(float) * factor
    out["low"] = raw["low"].astype(float) * factor
    out["close"] = adj_close
    if (out[["open", "high", "low", "close"]] <= 0).any().any():
        raise PriceError("adjusted OHLC contains non-positive prices")

    # Adjusted-share volume: preserves dollar volume across the adjustment.
    out["volume"] = raw["volume"].astype(float) / factor
    out["adv"] = out["volume"].rolling(adv_window, min_periods=1).mean().shift(1)
    out["raw_close"] = close
    return out[list(ADJUSTED_COLUMNS)]
