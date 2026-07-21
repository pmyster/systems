"""Transaction cost model (spec section 4).

CANONICAL FILL CONVENTION (single source of truth for the whole repo)
---------------------------------------------------------------------
A signal computed on bar *t*'s CLOSE executes at bar *t+1*'s OPEN.
Never at the same close that generated it. No lookahead, anywhere, ever.
Everything downstream (backtester, paper harness, the random-timing sim)
must use this exact convention; do not fork it.

What is charged per fill
------------------------
- **Commission**: parameterized hook, default $0 (commission-free US equity
  ETFs). Per-fill and per-share hooks both exist for futures later.
- **Half-spread**: paid on entry AND on exit (each fill pays one half-spread).
  Default 1 bp per side for very liquid large-cap ETFs (SPY/QQQ/IWM);
  parameterize wider for anything else. We never assume mid-price fills.
- **Slippage**: a small fixed bp plus a size-impact term that grows with
  order size relative to average daily volume (participation). ALWAYS
  adverse — it costs you in both directions, never helps.
- **Financing/borrow**: hook only. Phase 1 is long-only, unlevered, so the
  default rate is 0 — but the hook exists so shorts/leverage can never be
  modeled cost-free by accident.

Reporting rule (golden rule 3): gross numbers may exist internally, but any
reporting surface shows NET of this model. Gross-only is never "performance".
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

REQUIRED_FILL_COLUMNS = ("side", "qty", "price")
VALID_SIDES = (1, -1)  # +1 = buy, -1 = sell


class CostModelError(ValueError):
    """Raised loudly on malformed fills. We never silently drop or guess."""


@dataclass(frozen=True)
class CostParams:
    """Parameters of the cost model. Defaults = liquid US large-cap ETFs.

    half_spread_bps        : half-spread paid per fill (per side), in bps.
    slippage_base_bps      : small fixed adverse slippage per fill, in bps.
    slippage_impact_bps    : additional adverse bps per unit of participation
                             (order qty / average daily volume). Linear size
                             penalty; always adverse.
    commission_per_fill    : flat $ per fill (hook; default 0).
    commission_per_share   : $ per share (hook; default 0).
    financing_rate_annual  : annualized financing/borrow rate (hook; Phase 1
                             long-only => 0). If nonzero, fills must carry a
                             'holding_days' column.
    """

    half_spread_bps: float = 1.0
    slippage_base_bps: float = 0.5
    slippage_impact_bps: float = 25.0
    commission_per_fill: float = 0.0
    commission_per_share: float = 0.0
    financing_rate_annual: float = 0.0


def apply_costs(fills: pd.DataFrame, params: CostParams | None = None) -> pd.DataFrame:
    """Charge the full cost model to a frame of fills. Returns a NEW frame.

    Input columns (required):
        side  : +1 buy / -1 sell (anything else raises — loud, never silent)
        qty   : shares, strictly positive
        price : reference fill price (bar t+1's open per the canonical
                convention), strictly positive
    Input columns (conditionally required):
        adv          : average daily volume in shares, strictly positive.
                       Required when slippage_impact_bps > 0 — we refuse to
                       price impact without a volume denominator.
        holding_days : required when financing_rate_annual != 0.

    Output columns added:
        notional, commission, spread_cost, slippage_cost, financing_cost,
        total_cost, effective_price (adverse-adjusted: buys pay more, sells
        receive less).

    All costs are >= 0 (adverse). total_cost is what you subtract from gross.
    """
    if params is None:
        params = CostParams()

    missing = [c for c in REQUIRED_FILL_COLUMNS if c not in fills.columns]
    if missing:
        raise CostModelError(f"fills frame is missing required columns: {missing}")

    out = fills.copy()

    side = out["side"]
    if not side.isin(VALID_SIDES).all():
        bad = sorted(side[~side.isin(VALID_SIDES)].unique().tolist())
        raise CostModelError(f"unknown fill side values {bad}; only +1 (buy) / -1 (sell) allowed")
    if (out["qty"] <= 0).any() or out["qty"].isna().any():
        raise CostModelError("qty must be strictly positive and non-NaN for every fill")
    if (out["price"] <= 0).any() or out["price"].isna().any():
        raise CostModelError("price must be strictly positive and non-NaN for every fill")

    notional = out["qty"] * out["price"]

    # --- commission (hook; default 0) ---
    commission = params.commission_per_fill + params.commission_per_share * out["qty"]

    # --- half-spread, paid on every fill (entry AND exit) ---
    spread_cost = notional * (params.half_spread_bps / 1e4)

    # --- slippage: fixed base + linear size impact vs volume; always adverse ---
    slippage_bps = pd.Series(params.slippage_base_bps, index=out.index, dtype=float)
    if params.slippage_impact_bps > 0:
        if "adv" not in out.columns:
            raise CostModelError(
                "slippage_impact_bps > 0 requires an 'adv' column (average daily "
                "volume in shares); refusing to price size impact without it"
            )
        if (out["adv"] <= 0).any() or out["adv"].isna().any():
            raise CostModelError("adv must be strictly positive and non-NaN for every fill")
        participation = out["qty"] / out["adv"]
        slippage_bps = slippage_bps + params.slippage_impact_bps * participation
    slippage_cost = notional * (slippage_bps / 1e4)

    # --- financing hook (Phase 1 long-only => rate 0 => cost 0) ---
    if params.financing_rate_annual != 0.0:
        if "holding_days" not in out.columns:
            raise CostModelError(
                "financing_rate_annual != 0 requires a 'holding_days' column"
            )
        financing_cost = (
            notional * params.financing_rate_annual * out["holding_days"] / 365.0
        )
    else:
        financing_cost = pd.Series(0.0, index=out.index)

    total_cost = commission + spread_cost + slippage_cost + financing_cost

    # Adverse effective price: buys fill higher, sells fill lower.
    adverse_bps = params.half_spread_bps / 1e4 + slippage_bps / 1e4
    effective_price = out["price"] * (1.0 + side * adverse_bps)

    out["notional"] = notional
    out["commission"] = commission
    out["spread_cost"] = spread_cost
    out["slippage_cost"] = slippage_cost
    out["financing_cost"] = financing_cost
    out["total_cost"] = total_cost
    out["effective_price"] = effective_price
    return out
