"""Unit tests for the cost model — hand-computed examples, exact to the cent."""

import pandas as pd
import pytest

from costs.model import CostModelError, CostParams, apply_costs

# Default params under test: half_spread 1.0 bp, slippage base 0.5 bp,
# slippage impact 25 bp per unit participation, commissions 0, financing 0.
PARAMS = CostParams()


def one_fill(side=1, qty=100.0, price=500.0, adv=1_000_000.0):
    return pd.DataFrame({"side": [side], "qty": [qty], "price": [price], "adv": [adv]})


class TestHandComputedExample:
    """Buy 100 shares @ $500 (notional $50,000), ADV 1,000,000 shares.

    spread    = 50,000 * 1.0bp             = $5.00
    slippage  = 50,000 * (0.5 + 25*(100/1,000,000))bp
              = 50,000 * 0.5025bp          = $2.5125
    total     =                              $7.5125
    effective = 500 * (1 + 1.5025bp)       = $500.075125
    """

    def test_exact_costs(self):
        out = apply_costs(one_fill(), PARAMS)
        assert out.loc[0, "notional"] == pytest.approx(50_000.0)
        assert out.loc[0, "commission"] == 0.0
        assert out.loc[0, "spread_cost"] == pytest.approx(5.0)
        assert out.loc[0, "slippage_cost"] == pytest.approx(2.5125)
        assert out.loc[0, "financing_cost"] == 0.0
        assert out.loc[0, "total_cost"] == pytest.approx(7.5125)
        assert out.loc[0, "effective_price"] == pytest.approx(500.075125)

    def test_sell_is_equally_adverse(self):
        """Costs never invert: a sell pays the same, via a LOWER fill price."""
        out = apply_costs(one_fill(side=-1), PARAMS)
        assert out.loc[0, "total_cost"] == pytest.approx(7.5125)
        assert out.loc[0, "effective_price"] == pytest.approx(500.0 * (1 - 1.5025e-4))
        assert out.loc[0, "effective_price"] < 500.0

    def test_buy_fills_above_reference(self):
        out = apply_costs(one_fill(side=1), PARAMS)
        assert out.loc[0, "effective_price"] > 500.0

    def test_size_impact_scales_with_participation(self):
        """10x the order size vs same ADV => strictly more slippage bps."""
        small = apply_costs(one_fill(qty=100.0), PARAMS)
        big = apply_costs(one_fill(qty=1000.0), PARAMS)
        small_bps = small.loc[0, "slippage_cost"] / small.loc[0, "notional"] * 1e4
        big_bps = big.loc[0, "slippage_cost"] / big.loc[0, "notional"] * 1e4
        assert big_bps > small_bps
        assert big_bps == pytest.approx(0.5 + 25.0 * (1000.0 / 1_000_000.0))

    def test_commission_hooks(self):
        params = CostParams(commission_per_fill=1.50, commission_per_share=0.01)
        out = apply_costs(one_fill(), params)
        assert out.loc[0, "commission"] == pytest.approx(1.50 + 0.01 * 100)
        assert out.loc[0, "total_cost"] == pytest.approx(7.5125 + 2.50)

    def test_financing_hook(self):
        """Long-only Phase 1 default is 0, but the hook must charge when armed."""
        params = CostParams(financing_rate_annual=0.05)
        fills = one_fill()
        fills["holding_days"] = 73  # 1/5 year
        out = apply_costs(fills, params)
        assert out.loc[0, "financing_cost"] == pytest.approx(50_000 * 0.05 * 73 / 365)  # $500

    def test_all_costs_are_adverse_nonnegative(self):
        out = apply_costs(one_fill(side=-1), PARAMS)
        for col in ("commission", "spread_cost", "slippage_cost", "financing_cost", "total_cost"):
            assert (out[col] >= 0).all()


class TestLoudFailures:
    """Malformed fills must raise — never a silent default branch."""

    def test_unknown_side_rejected(self):
        with pytest.raises(CostModelError, match="unknown fill side"):
            apply_costs(one_fill(side=0), PARAMS)

    def test_negative_qty_rejected(self):
        with pytest.raises(CostModelError, match="qty must be strictly positive"):
            apply_costs(one_fill(qty=-5.0), PARAMS)

    def test_zero_price_rejected(self):
        with pytest.raises(CostModelError, match="price must be strictly positive"):
            apply_costs(one_fill(price=0.0), PARAMS)

    def test_missing_required_column_rejected(self):
        with pytest.raises(CostModelError, match="missing required columns"):
            apply_costs(pd.DataFrame({"side": [1], "qty": [1.0]}), PARAMS)

    def test_impact_without_adv_rejected(self):
        fills = one_fill().drop(columns=["adv"])
        with pytest.raises(CostModelError, match="requires an 'adv' column"):
            apply_costs(fills, PARAMS)

    def test_zero_impact_permits_missing_adv(self):
        fills = one_fill().drop(columns=["adv"])
        params = CostParams(slippage_impact_bps=0.0)
        out = apply_costs(fills, params)
        assert out.loc[0, "slippage_cost"] == pytest.approx(50_000 * 0.5e-4)

    def test_financing_armed_without_holding_days_rejected(self):
        with pytest.raises(CostModelError, match="holding_days"):
            apply_costs(one_fill(), CostParams(financing_rate_annual=0.05))

    def test_input_frame_not_mutated(self):
        fills = one_fill()
        before = fills.copy()
        apply_costs(fills, PARAMS)
        pd.testing.assert_frame_equal(fills, before)
