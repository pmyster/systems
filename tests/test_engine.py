"""Engine mechanics: validation, the reduce-only overlay seam, sizing,
the rebalance band, and the loud-failure policy.

The rule these tests encode: when the engine meets something it does not
understand or cannot honour, it says so. It never clips, aligns, guesses or
skips in silence.
"""

from typing import Mapping

import numpy as np
import pandas as pd
import pytest

from costs.model import CostParams
from engine.backtest import (
    SUPPRESSED_COLUMNS,
    Backtester,
    EngineError,
    RunSpec,
    load_adjusted_universe,
)
from engine.prices import adjusted_bars
from engine.strategy import BuyAndHold, Strategy
from tests.synthetic import engine_for, flat_market, raw_frame

SYMBOL = "TEST"


class ConstantStrategy(Strategy):
    name = "constant"

    def __init__(self, weights):
        self._w = dict(weights)

    def target_weights(self, ctx):
        return dict(self._w)


class CallableStrategy(Strategy):
    name = "callable"

    def __init__(self, fn):
        self._fn = fn

    def target_weights(self, ctx):
        return self._fn(ctx)


def _bars(n=60):
    return raw_frame(np.linspace(100, 120, n), np.linspace(100.5, 120.5, n))


# ------------------------------------------------------------------ weights
class TestWeightValidation:
    def test_negative_weight_is_refused(self):
        eng = engine_for(_bars(), SYMBOL)
        with pytest.raises(EngineError, match="long-only"):
            eng.run(ConstantStrategy({SYMBOL: -0.5}))

    def test_gross_above_the_cap_is_refused_not_clipped(self):
        eng = engine_for(_bars(), SYMBOL)
        with pytest.raises(EngineError, match="above max_gross"):
            eng.run(ConstantStrategy({SYMBOL: 1.5}))

    def test_leverage_above_one_is_refused_at_spec_time(self):
        with pytest.raises(EngineError, match="caps leverage at 1"):
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", max_gross=1.5)

    def test_nan_weight_is_refused(self):
        eng = engine_for(_bars(), SYMBOL)
        with pytest.raises(EngineError, match="non-finite"):
            eng.run(ConstantStrategy({SYMBOL: float("nan")}))

    def test_non_mapping_return_is_refused(self):
        eng = engine_for(_bars(), SYMBOL)
        with pytest.raises(EngineError, match="must return a mapping"):
            eng.run(CallableStrategy(lambda ctx: 1.0))

    def test_omitted_symbols_mean_zero(self):
        eng = engine_for(_bars(), SYMBOL)
        result = eng.run(ConstantStrategy({}))
        assert result.trade_count == 0
        assert (result.weights[SYMBOL] == 0).all()


# ----------------------------------------------------------------- overlays
class _Overlay:
    def __init__(self, name, fn):
        self.name = name
        self._fn = fn

    def __call__(self, ctx, desired: Mapping[str, float]) -> Mapping[str, float]:
        return self._fn(ctx, desired)


class TestReduceOnlyOverlaySeam:
    def test_an_overlay_can_reduce_exposure(self):
        eng = engine_for(_bars(), SYMBOL)
        half = _Overlay("half", lambda ctx, w: {k: v * 0.5 for k, v in w.items()})
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}), overlays=[half])
        assert result.targets[SYMBOL].max() == pytest.approx(0.5)
        assert result.overlay_names == ("half",)

    def test_an_overlay_can_veto_entirely(self):
        eng = engine_for(_bars(), SYMBOL)
        veto = _Overlay("veto", lambda ctx, w: {k: 0.0 for k in w})
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}), overlays=[veto])
        assert result.trade_count == 0
        assert result.targets[SYMBOL].max() == 0.0

    def test_an_overlay_CANNOT_increase_exposure(self):
        """Golden rule 2. The clamp bites and the attempt is recorded."""
        eng = engine_for(_bars(), SYMBOL)
        greedy = _Overlay("greedy", lambda ctx, w: {k: v * 3.0 + 0.5 for k, v in w.items()})
        result = eng.run(ConstantStrategy({SYMBOL: 0.25}), overlays=[greedy])
        assert result.targets[SYMBOL].max() == pytest.approx(0.25)
        assert any("tried to INCREASE exposure" in w for w in result.warnings)

    def test_overlays_compose_and_only_ever_shrink(self):
        eng = engine_for(_bars(), SYMBOL)
        half = _Overlay("half", lambda ctx, w: {k: v * 0.5 for k, v in w.items()})
        greedy = _Overlay("greedy", lambda ctx, w: {k: 1.0 for k in w})
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}), overlays=[half, greedy])
        assert result.targets[SYMBOL].max() == pytest.approx(0.5)

    def test_overlay_returning_unknown_symbol_is_refused(self):
        eng = engine_for(_bars(), SYMBOL)
        bad = _Overlay("bad", lambda ctx, w: {"SPY": 1.0})
        with pytest.raises(EngineError, match="unknown symbols"):
            eng.run(ConstantStrategy({SYMBOL: 1.0}), overlays=[bad])


# ------------------------------------------------------------------ sizing
class TestSizingAndAccounting:
    def test_cash_never_goes_negative(self):
        eng = engine_for(flat_market(n=100), SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        assert (result.cash >= -1e-9).all()

    def test_a_full_weight_target_lands_just_under_fully_invested(self):
        eng = engine_for(flat_market(n=100), SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        w = result.weights[SYMBOL].iloc[-1]
        assert 0.9999 < w <= 1.0

    def test_wider_costs_do_not_create_extra_churn(self):
        """A 100% target is unreachable once costs are paid, so without the
        band the engine re-buys the shortfall and a HOLD reports itself as
        many trades. This pins the reported count at 1 for any cost level.

        Scope claim, kept honest: the band protects the trade-count and
        turnover statistics, not the P&L — with the band off, buy-and-hold on
        the SPY fixture returns the same CAGR, turnover and costs to six
        decimals (see the note in ``engine.backtest``)."""
        frames = {SYMBOL: adjusted_bars(flat_market(n=200))}
        counts = []
        for hs in (1.0, 10.0, 50.0):
            spec = RunSpec(
                symbols=(SYMBOL,),
                snapshot="synthetic",
                symbol_cost_params=((SYMBOL, CostParams(half_spread_bps=hs)),),
            )
            counts.append(Backtester(spec, frames=frames).run(ConstantStrategy({SYMBOL: 1.0})).trade_count)
        assert counts == [1, 1, 1], f"cost level changed the trade count: {counts}"

    def test_rebalance_band_skips_dust_but_counts_it(self):
        eng = engine_for(flat_market(n=50), SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        assert result.trade_count == 1
        assert result.dust_skipped > 0  # visible, not hidden


class TestTheBandCannotOverrideIntentSilently:
    """``dust_skipped`` alone increments on ~every bar of a plain hold, so it
    can neither prove nor disprove that anything real was suppressed. These
    tests pin the two buckets apart and require the material one to be loud."""

    def _wide_band_engine(self, n=40, min_trade_bps=500.0):
        frames = {SYMBOL: adjusted_bars(flat_market(n=n))}
        spec = RunSpec(symbols=(SYMBOL,), snapshot="synthetic", min_trade_bps=min_trade_bps)
        return Backtester(spec, frames=frames)

    def test_a_plain_hold_reports_dust_and_zero_suppression(self):
        """The base case that made the old counter useless: thousands of
        sub-cent skips, not one of them a real trade."""
        eng = engine_for(flat_market(n=200), SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        assert result.dust_skipped > 100
        assert result.suppressed_trades == 0
        assert result.largest_suppressed == {}
        assert result.dust_only_skipped == result.dust_skipped

    def test_a_suppressed_rebalance_is_counted_named_and_warned_about(self):
        """The demonstrated defect: 50% -> 53% under a 500 bp band vanished
        with zero fills and no warning."""
        def fn(ctx):
            return {SYMBOL: 0.50 if ctx.bar_index < 20 else 0.53}

        result = self._wide_band_engine().run(CallableStrategy(fn))

        # the rebalance genuinely did not happen...
        assert result.weights[SYMBOL].iloc[-1] == pytest.approx(0.50, abs=1e-3)
        # ...and that is now impossible to miss.
        assert result.suppressed_trades > 0
        worst = result.largest_suppressed
        assert worst["symbol"] == SYMBOL
        assert worst["target_weight"] == pytest.approx(0.53)
        assert worst["current_weight"] == pytest.approx(0.50, abs=1e-3)
        assert worst["skipped_weight_bps"] == pytest.approx(300.0, rel=0.05)
        assert worst["reason"] == "rebalance_band"
        assert any("SUPPRESSED" in w for w in result.warnings)
        assert any("min_trade_bps" in w for w in result.warnings)

    def test_dust_and_suppression_are_separate_buckets(self):
        """Both fire in the same run and neither hides the other."""
        def fn(ctx):
            return {SYMBOL: 0.50 if ctx.bar_index < 20 else 0.53}

        result = self._wide_band_engine(n=60).run(CallableStrategy(fn))
        assert result.suppressed_trades > 0
        assert result.dust_only_skipped > 0
        assert result.dust_skipped == result.suppressed_trades + result.dust_only_skipped

    def test_the_suppression_log_is_a_full_record_not_just_a_count(self):
        def fn(ctx):
            return {SYMBOL: 0.50 if ctx.bar_index < 20 else 0.53}

        result = self._wide_band_engine().run(CallableStrategy(fn))
        log = result.suppressed
        assert list(log.columns) == list(SUPPRESSED_COLUMNS)
        assert (log["symbol"] == SYMBOL).all()
        assert (log["skipped_notional"] > 0).all()
        assert (log["band_notional"] >= log["skipped_notional"]).all()
        assert log["bar_index"].is_monotonic_increasing  # deterministic order

    def test_materiality_floor_must_be_positive(self):
        with pytest.raises(EngineError, match="material_weight_bps"):
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", material_weight_bps=0.0)

    def test_raising_the_materiality_floor_reclassifies_as_dust(self):
        """The floor is a knob, not a hardcoded snapshot: set it above the
        skipped size and the same skip is honestly called dust again."""
        def fn(ctx):
            return {SYMBOL: 0.50 if ctx.bar_index < 20 else 0.53}

        frames = {SYMBOL: adjusted_bars(flat_market(n=40))}
        loud = RunSpec(symbols=(SYMBOL,), snapshot="synthetic", min_trade_bps=500.0)
        quiet = RunSpec(
            symbols=(SYMBOL,), snapshot="synthetic", min_trade_bps=500.0,
            material_weight_bps=1_000.0,
        )
        assert Backtester(loud, frames=frames).run(CallableStrategy(fn)).suppressed_trades > 0
        quiet_result = Backtester(quiet, frames=frames).run(CallableStrategy(fn))
        assert quiet_result.suppressed_trades == 0
        assert quiet_result.dust_skipped > 0  # still counted, just not material

    def test_a_zero_target_always_liquidates_in_full(self):
        """The band must never strand a position: going flat is exempt."""
        def fn(ctx):
            return {SYMBOL: 1.0 if ctx.bar_index < 10 else 0.0}

        eng = engine_for(flat_market(n=40), SYMBOL)
        result = eng.run(CallableStrategy(fn))
        assert result.trade_count == 2
        assert result.positions[SYMBOL].iloc[-1] == 0.0
        assert result.weights[SYMBOL].iloc[-1] == 0.0

    def test_sells_execute_before_buys(self):
        """Proceeds must fund purchases, or a rotation would be unaffordable."""
        raw_a = flat_market(n=40, price=100.0)
        raw_b = flat_market(n=40, price=50.0)
        frames = {"A": adjusted_bars(raw_a), "B": adjusted_bars(raw_b)}
        spec = RunSpec(symbols=("A", "B"), snapshot="synthetic")

        def fn(ctx):
            return {"A": 1.0, "B": 0.0} if ctx.bar_index < 10 else {"A": 0.0, "B": 1.0}

        result = Backtester(spec, frames=frames).run(CallableStrategy(fn))
        rotation = result.fills[result.fills["bar_index"] == 11]
        assert list(rotation["symbol"]) == ["A", "B"]
        assert list(rotation["side"]) == [-1, 1]
        assert result.weights["B"].iloc[-1] > 0.999

    def test_equity_is_marked_at_the_close(self):
        raw = raw_frame([100.0, 100.0, 100.0], [100.0, 100.0, 200.0])
        eng = engine_for(raw, SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        # bar 2 closes at 200 with a position bought at 100 -> equity ~doubles
        assert result.equity.iloc[2] / result.equity.iloc[1] == pytest.approx(2.0, rel=1e-4)

    def test_terminal_liquidation_cost_is_reported_not_charged(self):
        eng = engine_for(flat_market(n=50), SYMBOL)
        result = eng.run(ConstantStrategy({SYMBOL: 1.0}))
        assert result.terminal_liquidation_cost > 0
        assert any("mark-to-market" in w for w in result.warnings)
        # the equity curve itself does NOT include it
        assert result.equity.iloc[-1] == pytest.approx(
            eng.spec.initial_cash - result.total_costs, rel=1e-12
        )


# ------------------------------------------------------------ loud failures
class TestLoudFailures:
    def test_calendar_mismatch_is_refused_not_aligned(self):
        frames = {
            "A": adjusted_bars(flat_market(n=40)),
            "B": adjusted_bars(flat_market(n=39)),
        }
        spec = RunSpec(symbols=("A", "B"), snapshot="synthetic")
        with pytest.raises(EngineError, match="calendar mismatch"):
            Backtester(spec, frames=frames)

    def test_single_bar_run_is_refused(self):
        frames = {SYMBOL: adjusted_bars(flat_market(n=1))}
        spec = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        with pytest.raises(EngineError, match="at least 2 bars"):
            Backtester(spec, frames=frames)

    def test_zero_volume_makes_slippage_unpriceable_and_raises(self):
        raw = flat_market(n=40)
        raw["volume"] = 0.0
        frames = {SYMBOL: adjusted_bars(raw)}
        spec = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        with pytest.raises(EngineError, match="refusing to fill uncosted"):
            Backtester(spec, frames=frames).run(ConstantStrategy({SYMBOL: 1.0}))

    def test_duplicate_symbols_refused(self):
        with pytest.raises(EngineError, match="duplicate symbols"):
            RunSpec(symbols=(SYMBOL, SYMBOL), snapshot="synthetic")

    def test_raw_price_basis_is_refused(self):
        with pytest.raises(EngineError, match="adjusted"):
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", price_basis="raw")

    def test_cost_override_for_unknown_symbol_refused(self):
        with pytest.raises(EngineError, match="not in the universe"):
            RunSpec(
                symbols=(SYMBOL,),
                snapshot="synthetic",
                symbol_cost_params=(("NOPE", CostParams()),),
            )

    def test_missing_snapshot_symbol_raises_from_the_loader(self):
        spec = RunSpec(symbols=("NOTASYMBOL",), snapshot="fixture")
        with pytest.raises(Exception, match="not in snapshot"):
            load_adjusted_universe(spec)


# -------------------------------------------------------------- fingerprint
class TestFingerprint:
    def test_same_config_same_fingerprint(self):
        a = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        b = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        assert a.fingerprint() == b.fingerprint()

    def test_any_knob_changes_the_fingerprint(self):
        base = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        variants = [
            RunSpec(symbols=(SYMBOL,), snapshot="fixture"),
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", seed=1),
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", start="2020-01-01"),
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", initial_cash=1.0),
            RunSpec(symbols=(SYMBOL,), snapshot="synthetic", max_gross=0.5),
            RunSpec(
                symbols=(SYMBOL,),
                snapshot="synthetic",
                default_cost_params=CostParams(half_spread_bps=2.0),
            ),
        ]
        prints = {base.fingerprint()} | {v.fingerprint() for v in variants}
        assert len(prints) == len(variants) + 1

    def test_fingerprint_is_serializable_config(self):
        spec = RunSpec(symbols=(SYMBOL,), snapshot="synthetic")
        d = spec.to_dict()
        assert d["symbols"] == [SYMBOL]
        assert d["price_basis"] == "adjusted"
        assert d["default_cost_params"]["half_spread_bps"] == 1.0


class TestMultiSymbol:
    def test_equal_weight_buy_and_hold_across_two_symbols(self):
        frames = {
            "A": adjusted_bars(flat_market(n=60, price=100.0)),
            "B": adjusted_bars(flat_market(n=60, price=25.0)),
        }
        spec = RunSpec(symbols=("A", "B"), snapshot="synthetic")
        result = Backtester(spec, frames=frames).run(BuyAndHold())
        assert result.trade_count == 2
        assert result.weights["A"].iloc[-1] == pytest.approx(0.5, abs=1e-3)
        assert result.weights["B"].iloc[-1] == pytest.approx(0.5, abs=1e-3)
        assert set(result.fills["symbol"]) == {"A", "B"}
