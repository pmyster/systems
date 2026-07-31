"""Synthetic price fixtures for engine tests (not a test module).

Real market data is great for realism and terrible for proofs: you can never
assert an exact number on it. These builders make series where the correct
answer is known to the last bit, so the no-lookahead and cost tests assert
equality rather than "looks about right".

Everything returned is in the RAW snapshot schema (``open, high, low, close,
adj_close, volume``) so tests exercise the real
``data.loader`` -> ``engine.prices.adjusted_bars`` -> engine path. Unless a
builder says otherwise, ``adj_close == close`` so the adjustment factor is
exactly 1 and prices survive the round trip unchanged.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def raw_frame(
    opens, closes, volume: float = 1e9, start: str = "2020-01-02", factor=None
) -> pd.DataFrame:
    """Build a raw-schema OHLCV frame from open/close arrays on business days.

    ``factor`` (optional array) sets ``adj_close = close * factor`` so tests can
    exercise a non-trivial adjustment.
    """
    opens = np.asarray(opens, dtype=float)
    closes = np.asarray(closes, dtype=float)
    if opens.shape != closes.shape:
        raise ValueError("opens and closes must be the same length")
    idx = pd.bdate_range(start=start, periods=len(opens), name="date")
    high = np.maximum(opens, closes) * 1.001
    low = np.minimum(opens, closes) * 0.999
    adj = closes if factor is None else closes * np.asarray(factor, dtype=float)
    return pd.DataFrame(
        {
            "open": opens,
            "high": high,
            "low": low,
            "close": closes,
            "adj_close": adj,
            "volume": np.full(len(opens), float(volume)),
        },
        index=idx,
    )


def flat_market(n: int = 300, price: float = 100.0, **kwargs) -> pd.DataFrame:
    """Every open and every close equal. Gross P&L of ANY strategy is exactly
    zero, so net P&L is exactly minus the costs — the cleanest possible cost
    test."""
    return raw_frame(np.full(n, price), np.full(n, price), **kwargs)


def oracle_trap(n: int = 200, price: float = 100.0, move: float = 0.02, seed: int = 7) -> pd.DataFrame:
    """Every OPEN is identical; only the closes move.

    A strategy that could fill at the close it computed its signal on (or at
    that bar's open, knowing the close) would harvest ``move`` on every up bar
    — an enormous, riskless edge. Under the canonical convention every fill
    lands on an open, and every open is the same price, so the achievable
    gross P&L is exactly ZERO. That gap is the no-lookahead proof.

    The last two bars close flat so no mark-to-market residue is left in the
    final equity: the answer is exactly zero, not approximately.
    """
    rng = np.random.default_rng(seed)
    signs = rng.choice([1.0, -1.0], size=n)
    signs[-2:] = 0.0
    closes = price * (1.0 + move * signs)
    return raw_frame(np.full(n, price), closes)


def engine_for(raw: pd.DataFrame, symbol: str = "TEST", **spec_kwargs):
    """Wrap a raw synthetic frame in a ``Backtester`` (adjusted, in-memory).

    Imported lazily so this module stays importable without the engine.
    """
    from engine.backtest import Backtester, RunSpec
    from engine.prices import adjusted_bars

    spec_kwargs.setdefault("snapshot", "synthetic")
    spec = RunSpec(symbols=(symbol,), **spec_kwargs)
    return Backtester(spec, frames={symbol: adjusted_bars(raw)})


def driftless_walk(n: int = 400, price: float = 100.0, sigma: float = 0.0005,
                   seed: int = 11) -> pd.DataFrame:
    """A seeded random walk whose realized drift is EXACTLY zero.

    Log increments are demeaned so the path returns to its starting level, and
    the volatility is deliberately small so the cost drag dominates timing luck
    — the martingale null of spec section 1.1 with the noise turned down far
    enough to assert on.
    """
    rng = np.random.default_rng(seed)
    steps = rng.normal(0.0, sigma, size=2 * n)
    steps = steps - steps.mean()  # realized drift is exactly zero
    path = price * np.exp(np.concatenate([[0.0], np.cumsum(steps)]))
    return raw_frame(path[0 : 2 * n : 2], path[1 : 2 * n : 2])
