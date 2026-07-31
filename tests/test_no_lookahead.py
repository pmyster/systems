"""THE no-lookahead proof (milestone 2 definition of done, golden rule 5).

Four independent locks are tested here:

  1. **The view cannot reach forward.** A ``BarContext`` frozen at bar *i*
     never returns bar *i+1*, not even if the strategy stores it and asks
     later.
  1b. **Nor can it reach forward through an ALIASED BUFFER.** Lock 1 counts
     rows; this one follows numpy's public ``.base`` chain out of whatever
     the context handed back and checks where that memory actually ends. A
     pandas slice is a view, so before this was pinned,
     ``ctx.history(sym, lookback=1)["close"].values.base`` walked to the full
     2651-row column and a strategy built on it returned +63,231% against
     buy-and-hold's +341% — with no private attributes, no disk access and no
     module globals. Row counts alone would never have caught it.
  2. **The fill cannot happen on the signal bar.** Every fill price equals the
     ADJUSTED OPEN of the bar AFTER the one that produced the signal.
  3. **A strategy that only pays if lock 2 breaks gets exactly nothing.** This
     is the important one: locks 1 and 2 could both be implemented and still
     leak value through some accounting seam. So we build a market where
     same-bar execution would be a riskless money machine and show the engine
     hands the strategy a gross return of EXACTLY zero.
"""

from typing import Mapping

import numpy as np
import pytest

from engine.backtest import EngineError, RunSpec, zero_cost_spec
from engine.context import BarContext
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold, Strategy
from tests.synthetic import engine_for, oracle_trap, raw_frame

SYMBOL = "TEST"


class RecordingStrategy(Strategy):
    """Stays flat; records what the context showed it on every bar."""

    name = "recorder"

    def __init__(self):
        self.seen: list[tuple[int, int, object, BarContext]] = []

    def target_weights(self, ctx: BarContext) -> Mapping[str, float]:
        hist = ctx.history(SYMBOL)
        self.seen.append((ctx.bar_index, len(hist), hist.index[-1], ctx))
        return {SYMBOL: 0.0}


class OracleCloseStrategy(Strategy):
    """Acts on bar t's close — legal — and would print money if the engine
    let it transact on bar t. Under the canonical convention it cannot."""

    name = "oracle_close"

    def target_weights(self, ctx: BarContext) -> Mapping[str, float]:
        return {SYMBOL: 1.0 if ctx.close(SYMBOL) > ctx.open(SYMBOL) else 0.0}


# --------------------------------------------------------------- lock 1
class TestContextCannotSeeTheFuture:
    def test_history_always_ends_on_the_current_bar(self):
        eng = engine_for(raw_frame(range(100, 140), range(101, 141)), SYMBOL)
        strat = RecordingStrategy()
        result = eng.run(strat)
        assert len(strat.seen) == len(result.equity)
        for i, n_rows, last_date, _ctx in strat.seen:
            assert n_rows == i + 1, f"bar {i} was shown {n_rows} rows"
            assert last_date == eng.index[i]

    def test_a_stored_context_stays_frozen_after_the_run(self):
        """The classic leak: hold a reference, read it once more data exists."""
        eng = engine_for(raw_frame(range(100, 140), range(101, 141)), SYMBOL)
        strat = RecordingStrategy()
        eng.run(strat)
        _, _, _, ctx_at_10 = strat.seen[10]
        assert ctx_at_10.bar_index == 10
        assert len(ctx_at_10.history(SYMBOL)) == 11
        assert ctx_at_10.history(SYMBOL).index[-1] == eng.index[10]
        assert ctx_at_10.date == eng.index[10]

    def test_lookback_cannot_extend_forward(self):
        eng = engine_for(raw_frame(range(100, 140), range(101, 141)), SYMBOL)
        strat = RecordingStrategy()
        eng.run(strat)
        _, _, _, ctx = strat.seen[5]
        assert len(ctx.history(SYMBOL, lookback=1_000_000)) == 6
        with pytest.raises(Exception):
            ctx.history(SYMBOL, lookback=0)

    def test_context_refuses_unknown_symbols(self):
        eng = engine_for(raw_frame(range(100, 140), range(101, 141)), SYMBOL)
        strat = RecordingStrategy()
        eng.run(strat)
        _, _, _, ctx = strat.seen[5]
        with pytest.raises(Exception, match="not in this run's universe"):
            ctx.history("NOPE")


# -------------------------------------------------------------- lock 1b
def _walk_base_chain(array):
    """Every numpy buffer reachable from ``array`` through PUBLIC API.

    ``ndarray.base`` is documented, public numpy: it is the object the array
    borrows its memory from. Following it out of a pandas view lands you in
    the parent frame's block — the whole price history, future included.
    """
    buffers = []
    cur = array
    hops = 0
    while isinstance(cur, np.ndarray):
        buffers.append(cur)
        cur = cur.base
        hops += 1
        if hops > 32:  # pragma: no cover - defensive against a cyclic base
            break
    return buffers


def _public_arrays(hist):
    """Everything a strategy can get out of a returned frame WITHOUT touching a
    single underscore. If any of these aliases the parent, the guarantee in
    ``engine/context.py`` is false."""
    return {
        "frame.values": hist.values,
        "frame.to_numpy()": hist.to_numpy(),
        "frame.index.values": hist.index.values,
        "frame['close'].values": hist["close"].values,
        "frame['close'].to_numpy()": hist["close"].to_numpy(),
        "frame['open'].values": hist["open"].values,
        "np.asarray(frame['close'])": np.asarray(hist["close"]),
    }


class ProbeStrategy(Strategy):
    """Stays flat; on every bar it tries to escape the window it was given."""

    name = "aliasing_probe"

    def __init__(self, columns: int):
        self.columns = columns
        #: (excess_elements, bar, path, elements, allowed) — the worst OVERRUN,
        #: not the biggest buffer: the legitimate window grows with the bar, so
        #: absolute size proves nothing.
        self.worst = (0, 0, "none", 0, self.columns)
        self.leaked_values: set[float] = set()

    def target_weights(self, ctx: BarContext) -> Mapping[str, float]:
        allowed_elements = (ctx.bar_index + 1) * self.columns
        for lookback in (1, 5, None):
            hist = ctx.history(SYMBOL, lookback=lookback)
            for path, array in _public_arrays(hist).items():
                for buf in _walk_base_chain(array):
                    excess = int(buf.size) - allowed_elements
                    if excess > self.worst[0]:
                        self.worst = (
                            excess, ctx.bar_index, path, int(buf.size), allowed_elements
                        )
                    if excess > 0 and buf.dtype.kind == "f":
                        self.leaked_values.update(np.ravel(buf).tolist())
        return {SYMBOL: 0.0}


class TestAliasedBuffersCannotReachTheFuture:
    """The leak that row-counting misses: the numpy buffer behind the frame."""

    def test_no_public_buffer_reaches_past_the_current_bar(self):
        n = 60
        raw = raw_frame(range(100, 100 + n), range(1000, 1000 + n))
        eng = engine_for(raw, SYMBOL)
        columns = eng.frames[SYMBOL].shape[1]
        probe = ProbeStrategy(columns=columns)
        eng.run(probe)

        excess, bar, path, elements, allowed = probe.worst
        assert excess <= 0, (
            "FUTURE-REACHABILITY LEAK: at bar {bar} the context was asked for at "
            "most {rows} row(s), but walking numpy's public `.base` chain out of "
            "`{path}` reaches a buffer of {elements} elements - {extra} more than "
            "the {allowed} ({rows} rows x {columns} columns) the strategy is "
            "allowed to see. That extra memory is the PARENT frame, which holds "
            "every bar of the run, so a strategy can read tomorrow's price using "
            "nothing but public pandas/numpy API. The usual cause is returning "
            "`frame.iloc[start:stop]` (a VIEW) instead of a deep copy from "
            "BarContext.history(). Row counts cannot catch this; only following "
            "the buffer can.".format(
                bar=bar, rows=bar + 1, path=path, elements=elements,
                extra=excess, allowed=allowed, columns=columns,
            )
        )

    def test_no_future_price_value_is_reachable(self):
        """Belt and braces: even if a buffer were oversized, it must not
        CONTAIN a price from after the current bar. Closes are 1000, 1001, ...
        so equality is unambiguous."""
        n = 60
        raw = raw_frame(range(100, 100 + n), range(1000, 1000 + n))
        eng = engine_for(raw, SYMBOL)
        probe = ProbeStrategy(columns=eng.frames[SYMBOL].shape[1])
        eng.run(probe)
        assert not probe.leaked_values, (
            "FUTURE-REACHABILITY LEAK: values from outside the granted window are "
            f"reachable, e.g. {sorted(probe.leaked_values)[:5]}. A strategy reading "
            "them is trading on bars that had not happened yet."
        )

    def test_the_returned_window_is_not_a_view_of_the_engines_prices(self):
        """The same alias, in the other direction: if the frame were a view, a
        strategy could SCRIBBLE ON the engine's price data."""
        eng = engine_for(raw_frame(range(100, 140), range(1000, 1040)), SYMBOL)
        strat = RecordingStrategy()
        eng.run(strat)
        _, _, _, ctx = strat.seen[10]
        before = eng.frames[SYMBOL]["close"].to_numpy(dtype=float).copy()
        hist = ctx.history(SYMBOL)
        hist.iloc[:, :] = -1.0
        after = eng.frames[SYMBOL]["close"].to_numpy(dtype=float)
        assert (before == after).all(), (
            "the frame handed to a strategy aliases the engine's prices: mutating "
            "it corrupted the run's data"
        )


# --------------------------------------------------------------- lock 2
class TestFillsLandOnTheNextBarOpen:
    def test_every_fill_price_is_the_next_bar_adjusted_open(self):
        from data.loader import load_symbol

        frames = {"SPY": adjusted_bars(load_symbol("SPY", "fixture"))}
        spec = RunSpec(symbols=("SPY",), snapshot="fixture")
        from engine.backtest import Backtester

        result = Backtester(spec, frames=frames).run(BuyAndHold())
        assert len(result.fills) >= 1
        opens = frames["SPY"]["open"]
        for _, fill in result.fills.iterrows():
            i = int(fill["bar_index"])
            assert fill["signal_bar_index"] == i - 1
            assert fill["price"] == pytest.approx(opens.iloc[i], rel=0, abs=0)
            assert fill["date"] == opens.index[i]
            assert fill["signal_date"] == opens.index[i - 1]

    def test_nothing_can_fill_on_bar_zero(self):
        """Bar 0 has no preceding close, so it can have no signal and no fill."""
        eng = engine_for(oracle_trap(n=60), SYMBOL)
        result = eng.run(OracleCloseStrategy())
        assert (result.fills["bar_index"] >= 1).all()
        assert result.positions.iloc[0].sum() == 0.0
        assert result.equity.iloc[0] == result.spec.initial_cash


# --------------------------------------------------------------- lock 3
@pytest.fixture(scope="module")
def bars():
    """The market: every OPEN is 100.00; only closes move +/-2%."""
    return oracle_trap(n=200, move=0.02, seed=7)


class TestSameBarExecutionWouldPayAndDoesNot:
    def test_the_cheat_would_be_enormous(self, bars):
        """Sanity on the test itself: if the oracle could act on bar t (buy at
        that bar's open knowing its close), it would compound ~2% per up bar.
        Without this check, 'the engine gave it nothing' would be unfalsifiable."""
        adj = adjusted_bars(bars)
        up = (adj["close"] > adj["open"]).sum()
        cheat_growth = 1.02 ** up
        assert up > 50
        assert cheat_growth > 5.0  # >400% on a flat market — unmissable if it leaked

    def test_engine_gives_the_oracle_exactly_zero_gross(self, bars):
        """Costs zeroed to isolate the mechanism: the only thing left that
        could produce P&L is lookahead. The answer must be exactly 0."""
        eng = engine_for(bars, SYMBOL)
        free = zero_cost_spec(eng.spec)
        from engine.backtest import Backtester

        result = Backtester(free, frames=eng.frames).run(OracleCloseStrategy())
        assert result.trade_count > 50, "the oracle must actually be trading"
        assert result.total_costs == 0.0
        assert result.equity.iloc[-1] == pytest.approx(free.initial_cash, rel=1e-12)

    def test_all_oracle_fills_happen_at_the_same_flat_price(self, bars):
        eng = engine_for(bars, SYMBOL)
        result = eng.run(OracleCloseStrategy())
        assert set(result.fills["price"].round(9)) == {100.0}

    def test_with_real_costs_the_oracle_simply_loses(self, bars):
        """Zero gross edge, hundreds of fills, a real cost model: the only
        possible outcome is a loss proportional to the trading."""
        eng = engine_for(bars, SYMBOL)
        result = eng.run(OracleCloseStrategy())
        final = result.equity.iloc[-1]
        assert final < eng.spec.initial_cash
        assert final == pytest.approx(eng.spec.initial_cash - result.total_costs, rel=1e-12)


class TestStrategyCannotNameAPrice:
    def test_weights_outside_the_universe_are_refused(self):
        class Sneaky(Strategy):
            name = "sneaky"

            def target_weights(self, ctx):
                return {SYMBOL: 0.5, "SPY": 0.5}

        eng = engine_for(raw_frame(range(100, 140), range(101, 141)), SYMBOL)
        with pytest.raises(EngineError, match="outside the universe"):
            eng.run(Sneaky())
