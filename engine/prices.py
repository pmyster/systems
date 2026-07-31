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

WHY EVERY CHECK HERE IS A FINITENESS CHECK, NOT JUST A POSITIVITY CHECK
-----------------------------------------------------------------------
``NaN <= 0`` is ``False``. A positivity gate therefore waves NaN straight
through, and NaN is *worse* than a negative price because it does not raise
downstream — it propagates. A NaN open reached the engine, made pre-trade
equity NaN, made every target delta NaN, and NaN is neither ``> 0`` nor
``< 0``, so every symbol fell out of both the buy branch and the sell branch:
the bar was skipped with no fill, no warning, and no counter moved. That is
the exact silent-drop failure this codebase forbids. So every numeric column
is checked with ``np.isfinite`` and the offending dates are named.
"""

from __future__ import annotations

import numpy as np
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

    Raises PriceError on anything it cannot honestly adjust — including any
    non-finite value, which a positivity test alone would let through.
    """
    required = ("open", "high", "low", "close", "adj_close", "volume")
    missing = [c for c in required if c not in raw.columns]
    if missing:
        raise PriceError(f"price frame missing required columns {missing}")
    if raw.empty:
        raise PriceError("price frame is empty")
    if not raw.index.is_monotonic_increasing or raw.index.has_duplicates:
        raise PriceError("price frame index must be strictly increasing and unique")

    _require_finite(raw[list(required)].astype(float), "raw")

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
    # Finiteness BEFORE positivity: `NaN <= 0` is False, so the positivity
    # test on its own is blind to exactly the value that then propagates
    # silently through the engine (see the module docstring).
    _require_finite(out[["open", "high", "low", "close"]], "adjusted")
    if (out[["open", "high", "low", "close"]] <= 0).any().any():
        raise PriceError("adjusted OHLC contains non-positive prices")

    # Adjusted-share volume: preserves dollar volume across the adjustment.
    out["volume"] = raw["volume"].astype(float) / factor
    # Zero volume is legal here (it is priced later, loudly, when a fill needs
    # an ADV denominator); a non-finite volume is not, because it would poison
    # the rolling ADV and take the slippage model down with it.
    _require_finite(out[["volume"]], "adjusted")
    out["adv"] = out["volume"].rolling(adv_window, min_periods=1).mean().shift(1)
    out["raw_close"] = close
    return out[list(ADJUSTED_COLUMNS)]


def _require_finite(frame: pd.DataFrame, label: str) -> None:
    """Raise naming the offending bars if anything is NaN or +/-inf.

    Loud by design. The alternative — dropping, forward-filling or simply
    letting NaN through — is the silent-corruption failure mode that produces
    fake edges and unexplained skipped trades.
    """
    bad = ~np.isfinite(frame.to_numpy(dtype=float))
    if not bad.any():
        return
    rows, cols = np.nonzero(bad)
    offenders = [
        f"{frame.index[r].date()} {frame.columns[c]}={frame.iat[r, c]!r}"
        for r, c in list(zip(rows, cols))[:5]
    ]
    raise PriceError(
        f"{label} price data contains {int(bad.sum())} non-finite value(s) "
        f"(NaN or inf) across columns {sorted({frame.columns[c] for c in cols})}. "
        f"First offenders: {offenders}. Refusing to build bars from them: a NaN "
        f"price is not caught by a positivity test, and downstream it makes "
        f"equity, deltas and every buy/sell classification NaN — so the bar is "
        f"skipped with no fill and no warning instead of failing here."
    )
