"""The no-lookahead view of the world handed to a strategy (milestone 2).

STRUCTURAL NO-LOOKAHEAD
-----------------------
A ``BarContext`` is created by the engine at the CLOSE of bar *i* and frozen
there. Everything it can answer is a function of bars ``0..i`` only. There is
no API on it that returns bar ``i+1`` — not a price, not a date, not a row
count. A strategy that stashes a context and consults it later still sees the
world as of bar *i*, because ``i`` is baked into the object (see
``test_no_lookahead.py``).

The second half of the guarantee lives in the engine: a strategy returns
DESIRED WEIGHTS and nothing else. It cannot name a fill price, a quantity, or
a bar. The engine executes those weights at bar ``i+1``'s OPEN — the canonical
convention declared in ``costs.model``. So the strategy can neither *see* the
future nor *transact* on the bar that generated its signal.

SCOPE OF THE GUARANTEE — STATED HONESTLY
----------------------------------------
This is an API-level guarantee, and it is worth being precise about where it
ends, because an overclaim here is worse than no claim at all.

What IS guaranteed: no public accessor on this object returns, or *aliases*,
data past bar ``i``. That second word carries real weight. ``history()``
returns a DEEP COPY of the requested window, not a pandas view of the parent
frame. An un-copied ``frame.iloc[start:stop]`` shares the parent's numpy
buffer, and that buffer is reachable through entirely public API —
``hist["close"].values.base`` walks straight to the full column, future bars
included, using no private attributes at all. An adversarial verifier used
exactly that path to build a strategy returning +63,231% against
buy-and-hold's +341% on the SPY fixture. It also came back WRITABLE, so the
same alias let a strategy corrupt the engine's price data. Hence the copy, and
hence ``TestAliasedBuffersCannotReachTheFuture`` in
``tests/test_no_lookahead.py``, which pins it shut.

What is NOT guaranteed, and cannot be in Python:
  * private attributes (``ctx._frames``) are reachable by anyone who types an
    underscore. Python has no enforced privacy;
  * a strategy can simply re-read the snapshot off disk (``data.loader``) or
    import the frames itself. Nothing in this process can stop that, and we do
    not pretend otherwise.

So the honest claim is: **accidental** lookahead is structurally impossible,
and that is the failure mode that actually happens in research code.
Deliberate cheating is out of scope for the engine and is caught, if at all,
by review and by the milestone-3 evaluation gauntlet.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

import numpy as np
import pandas as pd


class ContextError(RuntimeError):
    """Raised loudly when a strategy asks the context something it must not."""


@dataclass(frozen=True)
class Bar:
    """One fully-completed (adjusted) bar. Known in its entirety at its close."""

    date: pd.Timestamp
    open: float
    high: float
    low: float
    close: float
    volume: float


class BarContext:
    """Read-only world state as of bar ``bar_index``'s close.

    Construct only from the engine. ``frames`` maps symbol -> the FULL adjusted
    price frame; the context never exposes more than ``bar_index + 1`` rows of
    it.
    """

    __slots__ = (
        "_frames",
        "_i",
        "_date",
        "_cash",
        "_equity",
        "_positions",
        "_weights",
        "_rng",
        "_seed",
    )

    def __init__(
        self,
        frames: Mapping[str, pd.DataFrame],
        bar_index: int,
        cash: float,
        equity: float,
        positions: Mapping[str, float],
        weights: Mapping[str, float],
        rng: np.random.Generator,
        seed: int,
    ) -> None:
        if bar_index < 0:
            raise ContextError(f"bar_index must be >= 0, got {bar_index}")
        self._frames = frames
        self._i = int(bar_index)
        self._date = next(iter(frames.values())).index[bar_index]
        self._cash = float(cash)
        self._equity = float(equity)
        self._positions = MappingProxyType(dict(positions))
        self._weights = MappingProxyType(dict(weights))
        self._rng = rng
        self._seed = int(seed)

    # --- identity of "now" -------------------------------------------------
    @property
    def bar_index(self) -> int:
        """Index of the bar whose CLOSE we are standing on."""
        return self._i

    @property
    def date(self) -> pd.Timestamp:
        return self._date

    @property
    def symbols(self) -> tuple[str, ...]:
        return tuple(self._frames)

    # --- portfolio state (as of this close) --------------------------------
    @property
    def cash(self) -> float:
        return self._cash

    @property
    def equity(self) -> float:
        """Mark-to-market equity at this bar's close."""
        return self._equity

    @property
    def positions(self) -> Mapping[str, float]:
        """symbol -> shares currently held (read-only)."""
        return self._positions

    @property
    def weights(self) -> Mapping[str, float]:
        """symbol -> current portfolio weight at this close (read-only)."""
        return self._weights

    # --- seeded randomness (R7: no wall-clock / global RNG anywhere) -------
    @property
    def rng(self) -> np.random.Generator:
        """The run's seeded generator. Any strategy needing randomness MUST use
        this one — a global/unseeded source breaks reproducibility (R7)."""
        return self._rng

    @property
    def seed(self) -> int:
        return self._seed

    # --- history (never past this bar) -------------------------------------
    def history(self, symbol: str, lookback: int | None = None) -> pd.DataFrame:
        """Adjusted bars ``0..bar_index`` inclusive for ``symbol``.

        ``lookback`` trims to the most recent N bars. The frame ALWAYS ends on
        this bar; there is no argument that can extend it forward.

        THE RETURNED FRAME IS A DEEP COPY, AND THAT IS LOAD-BEARING.
        ``frame.iloc[start:stop]`` is a pandas *view*: its numpy buffer is
        still the parent's, so ``returned["close"].values.base`` reaches the
        whole column — every future bar — through 100% public API. The copy
        severs that alias (and, as a bonus, means a strategy cannot scribble
        on the engine's prices through the same handle). Copying the index too
        is deliberate: a shared DatetimeIndex buffer leaks future *dates*,
        which is less exploitable but still information from after ``i``.
        """
        if lookback is not None and int(lookback) <= 0:
            raise ContextError(f"lookback must be positive, got {lookback}")
        frame = self._frame(symbol)
        stop = self._i + 1
        start = 0 if lookback is None else max(0, stop - int(lookback))
        window = frame.iloc[start:stop].copy(deep=True)
        # ``copy(deep=True)`` copies the block values; the index is rebuilt
        # from a copied numpy buffer because pandas is free to keep sharing an
        # Index object, and a shared index buffer is the same class of alias.
        idx = frame.index[start:stop]
        window.index = pd.Index(idx.to_numpy().copy(), name=idx.name)
        return window

    def bar(self, symbol: str) -> Bar:
        """This bar in full — legal, because we are standing on its close."""
        row = self._frame(symbol).iloc[self._i]
        return Bar(
            date=self._date,
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        )

    def close(self, symbol: str) -> float:
        return float(self._frame(symbol)["close"].iloc[self._i])

    def open(self, symbol: str) -> float:
        return float(self._frame(symbol)["open"].iloc[self._i])

    def _frame(self, symbol: str) -> pd.DataFrame:
        try:
            return self._frames[symbol]
        except KeyError:
            raise ContextError(
                f"symbol '{symbol}' is not in this run's universe {list(self._frames)}"
            ) from None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"BarContext(bar_index={self._i}, date={self._date.date()}, "
            f"equity={self._equity:,.2f}, positions={dict(self._positions)})"
        )
