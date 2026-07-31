"""The engine-free buy-and-hold reference (milestone 2 definition of done).

The DoD says the engine must "reproduce buy-and-hold SPY to a known
benchmark". A benchmark computed BY the engine would prove nothing, so this
module computes it with plain arithmetic on the adjusted price series — no
engine, no portfolio, no loop — and the test asserts the engine matches it to
machine precision once the one unavoidable difference (the entry cost) is
accounted for.

WHAT THE REFERENCE IS
---------------------
Enter at bar 1's ADJUSTED OPEN — the earliest fill the canonical convention
allows, because the decision to hold is made on bar 0's close — and mark to
market at the final bar's ADJUSTED CLOSE. On adjusted (total-return) prices
this is buy-and-hold *with dividends reinvested*.

THIS NUMBER IS GROSS AND IS NOT A PERFORMANCE REPORT
----------------------------------------------------
Every field here is named ``gross_*`` on purpose. Golden rule 3 forbids
reporting gross numbers as performance; this reference exists only to validate
the engine. The buy-and-hold column in an actual report comes from running
``BuyAndHold`` through the same engine and the same cost model as the strategy
(see ``reports.report``), which is net.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import pandas as pd

DAYS_PER_YEAR = 365.25


class BenchmarkError(ValueError):
    """Loud failure when the reference cannot be computed."""


@dataclass(frozen=True)
class BuyAndHoldReference:
    """Engine-free arithmetic reference. GROSS (no costs) — validation only."""

    symbol: str
    entry_date: str
    entry_price: float  # adjusted open of bar 1
    exit_date: str
    exit_price: float  # adjusted close of the last bar
    n_bars: int
    years: float
    gross_total_return: float
    gross_cagr: float

    def to_dict(self) -> dict:
        return asdict(self)


def buy_and_hold_reference(bars: pd.DataFrame, symbol: str = "?") -> BuyAndHoldReference:
    """Compute the reference from an ADJUSTED bar frame (``engine.prices``)."""
    if len(bars) < 2:
        raise BenchmarkError(f"need at least 2 bars for a reference, got {len(bars)}")
    for col in ("open", "close"):
        if col not in bars.columns:
            raise BenchmarkError(f"bar frame missing '{col}' column")

    entry_price = float(bars["open"].iloc[1])
    exit_price = float(bars["close"].iloc[-1])
    if entry_price <= 0 or exit_price <= 0:
        raise BenchmarkError("reference prices must be positive")

    entry_date = bars.index[1]
    exit_date = bars.index[-1]
    days = (exit_date - entry_date).days
    if days <= 0:
        raise BenchmarkError(f"reference window spans {days} calendar days")
    years = days / DAYS_PER_YEAR

    gross_total_return = exit_price / entry_price - 1.0
    gross_cagr = (exit_price / entry_price) ** (1.0 / years) - 1.0

    return BuyAndHoldReference(
        symbol=symbol,
        entry_date=str(pd.Timestamp(entry_date).date()),
        entry_price=entry_price,
        exit_date=str(pd.Timestamp(exit_date).date()),
        exit_price=exit_price,
        n_bars=int(len(bars)),
        years=float(years),
        gross_total_return=float(gross_total_return),
        gross_cagr=float(gross_cagr),
    )


def explain_buy_and_hold_delta(reference: BuyAndHoldReference, result) -> dict:
    """Decompose the gap between the gross reference and the engine's NET run.

    The engine's buy-and-hold does exactly one thing the reference does not:
    it pays to get in. Writing E for initial cash, c for the entry cost and u
    for the cash left unused after sizing,

        1 + r_engine = (qty * P_exit + u) / E ,  qty = (E - c - u) / P_entry

    which rearranges to

        r_engine = (1 - (c + u)/E) * r_ref  -  c/E

    so the whole delta is

        r_ref - r_engine = ((c + u)/E) * r_ref  +  c/E
                           \\_ growth forgone _/   \\_ the cost _/

    ``residual`` is what the identity fails to explain. It must be ~0 (float
    noise). Anything else means the engine did something the fill log does not
    account for, and the test that calls this fails.
    """
    fills = result.fills
    if len(fills) != 1:
        raise BenchmarkError(
            f"buy-and-hold should produce exactly ONE fill; got {len(fills)}. "
            f"Something rebalanced that should not have."
        )
    initial = float(result.equity.iloc[0])
    final = float(result.equity.iloc[-1])
    entry_cost = float(fills["total_cost"].iloc[0])
    qty = float(fills["qty"].iloc[0])
    fill_price = float(fills["price"].iloc[0])
    unused_cash = initial - qty * fill_price - entry_cost

    engine_total_return = final / initial - 1.0
    r_ref = reference.gross_total_return

    growth_forgone = ((entry_cost + unused_cash) / initial) * r_ref
    cost_share = entry_cost / initial
    predicted_delta = growth_forgone + cost_share
    actual_delta = r_ref - engine_total_return

    return {
        "reference_gross_total_return": r_ref,
        "engine_net_total_return": engine_total_return,
        "delta": actual_delta,
        "entry_cost_dollars": entry_cost,
        "entry_cost_pct_of_initial": cost_share * 100.0,
        "unused_cash_dollars": unused_cash,
        "fill_price": fill_price,
        "reference_entry_price": reference.entry_price,
        "fill_matches_reference_entry": fill_price == reference.entry_price,
        "explained": {
            "growth_forgone_on_uninvested_capital": growth_forgone,
            "entry_cost": cost_share,
            "total": predicted_delta,
        },
        "residual": actual_delta - predicted_delta,
    }
