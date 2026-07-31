"""Performance metrics (milestone 2).

The spec (section 5, "Reporting") and golden rule "every result report" fix the
required set exactly:

    net CAGR · Sharpe · Sortino · max drawdown · Calmar · trade count ·
    turnover · % time in market

...and the SAME metrics for buy-and-hold over the identical window. That
second half is enforced by ``reports.report``, which cannot build a report
without a benchmark. Everything here is computed on a NET equity curve — the
engine has no gross mode, so there is nothing else to compute it on.

DEFINITIONS (stated, so nobody has to guess later)
--------------------------------------------------
* **returns** — simple daily returns of the mark-to-market equity curve.
* **years** — calendar years, ``(last_date - first_date).days / 365.25``.
  Calendar, not trading days, because CAGR is a *compound annual* rate.
* **CAGR** — ``(final/initial)**(1/years) - 1``.
* **annualization** — ``sqrt(252)`` for volatility-like quantities. 252 is the
  US trading-day convention; it is the only place trading days are used.
* **Sharpe** — ``mean(r)/std(r, ddof=1) * sqrt(252)``, excess over
  ``risk_free_annual`` (default 0.0). Rule: a Sharpe quoted anywhere in this
  repo is net and zero-rf unless it says otherwise.
* **Sortino** — same numerator, denominator = downside deviation
  ``sqrt(mean(min(r - mar, 0)**2))`` over ALL observations (the standard
  full-length denominator, not just down days), ``mar=0`` daily.
* **max drawdown** — most negative value of ``equity/cummax(equity) - 1``.
  Reported as a negative number.
* **Calmar** — ``CAGR / |max drawdown|``.
* **trade count** — number of FILLS (one-way). A round trip is two.
* **turnover** — annualized: ``sum(|fill notional|) / mean(equity) / years``.
  1.0 means the portfolio's average value was traded once per year.
* **% time in market** — share of bars with gross exposure above
  ``exposure_floor`` (default 1e-9), measured at each bar's close.

DEGENERATE CASES ARE VISIBLE, NOT SILENT
----------------------------------------
Zero volatility, zero drawdown, a single bar: the affected metric comes back
as NaN **and** a human-readable line is appended to ``warnings``, which the
report prints. Nothing is quietly replaced with 0.0.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

TRADING_DAYS = 252
DAYS_PER_YEAR = 365.25
EXPOSURE_FLOOR = 1e-9


class MetricsError(ValueError):
    """Raised when metrics cannot be computed at all. Loud, never a fake 0.0."""


@dataclass(frozen=True)
class PerformanceMetrics:
    """The spec-mandated metric set for one equity curve. All net of costs."""

    label: str
    start_date: str
    end_date: str
    n_bars: int
    years: float
    initial_equity: float
    final_equity: float
    total_return: float
    cagr: float
    ann_volatility: float
    sharpe: float
    sortino: float
    max_drawdown: float
    calmar: float
    trade_count: int
    turnover_annual: float
    pct_time_in_market: float
    total_costs: float
    cost_drag_pct_of_initial: float
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["warnings"] = list(self.warnings)
        return d


def _daily_returns(equity: pd.Series) -> np.ndarray:
    values = equity.to_numpy(dtype=float)
    if (values <= 0).any():
        raise MetricsError("equity curve contains non-positive values; cannot compute returns")
    return values[1:] / values[:-1] - 1.0


def max_drawdown(equity: pd.Series) -> float:
    values = equity.to_numpy(dtype=float)
    peak = np.maximum.accumulate(values)
    return float((values / peak - 1.0).min())


def compute_metrics(
    equity: pd.Series,
    label: str,
    fills: pd.DataFrame | None = None,
    weights: pd.DataFrame | None = None,
    risk_free_annual: float = 0.0,
    exposure_floor: float = EXPOSURE_FLOOR,
) -> PerformanceMetrics:
    """Compute the full mandated metric set for one NET equity curve.

    ``fills`` supplies trade count / turnover / total costs; ``weights``
    supplies % time in market. Both are optional only so a pure reference
    curve (``reports.benchmark``) can be measured; an engine result always has
    them, and their absence is recorded in ``warnings`` rather than faked.
    """
    if not isinstance(equity, pd.Series) or equity.empty:
        raise MetricsError("equity must be a non-empty pandas Series")
    if len(equity) < 2:
        raise MetricsError(f"need at least 2 equity points, got {len(equity)}")
    if not equity.index.is_monotonic_increasing:
        raise MetricsError("equity index must be increasing")

    warnings: list[str] = []
    start, end = equity.index[0], equity.index[-1]
    days = (end - start).days
    if days <= 0:
        raise MetricsError(f"equity window spans {days} calendar days; cannot annualize")
    years = days / DAYS_PER_YEAR

    initial = float(equity.iloc[0])
    final = float(equity.iloc[-1])
    total_return = final / initial - 1.0
    cagr = (final / initial) ** (1.0 / years) - 1.0

    r = _daily_returns(equity)
    rf_daily = risk_free_annual / TRADING_DAYS
    excess = r - rf_daily

    if len(r) < 2:
        # one return observation: sample variance is undefined. Say so rather
        # than let numpy emit a RuntimeWarning and hand back a silent NaN.
        sd = float("nan")
        ann_vol = float("nan")
        sharpe = float("nan")
        sortino = float("nan")
        warnings.append(
            f"only {len(r)} return observation(s): volatility, Sharpe and Sortino are "
            f"undefined and reported as NaN."
        )
    else:
        sd = float(np.std(r, ddof=1))
        ann_vol = sd * np.sqrt(TRADING_DAYS)
        if sd == 0.0:
            sharpe = float("nan")
            warnings.append("Sharpe is NaN: the equity curve has zero daily volatility.")
        else:
            sharpe = float(np.mean(excess) / sd * np.sqrt(TRADING_DAYS))

        downside = np.minimum(excess, 0.0)
        dd_dev = float(np.sqrt(np.mean(downside**2)))
        if dd_dev == 0.0:
            sortino = float("nan")
            warnings.append("Sortino is NaN: no downside deviation (never a negative day).")
        else:
            sortino = float(np.mean(excess) / dd_dev * np.sqrt(TRADING_DAYS))

    mdd = max_drawdown(equity)
    if mdd == 0.0:
        calmar = float("nan")
        warnings.append("Calmar is NaN: max drawdown is exactly zero.")
    else:
        calmar = float(cagr / abs(mdd))

    if fills is None:
        trade_count = 0
        turnover = float("nan")
        total_costs = float("nan")
        warnings.append(
            "no fill log supplied: trade count, turnover and total costs are not measured "
            "(this curve is a reference, not an executed run)."
        )
    else:
        trade_count = int(len(fills))
        total_costs = float(fills["total_cost"].sum()) if trade_count else 0.0
        traded_notional = float(fills["notional"].sum()) if trade_count else 0.0
        mean_equity = float(equity.mean())
        turnover = traded_notional / mean_equity / years if mean_equity > 0 else float("nan")

    if weights is None:
        pct_in_market = float("nan")
        warnings.append("no weight history supplied: % time in market is not measured.")
    else:
        gross = weights.abs().sum(axis=1)
        pct_in_market = float((gross > exposure_floor).mean() * 100.0)

    cost_drag = (total_costs / initial * 100.0) if np.isfinite(total_costs) else float("nan")

    return PerformanceMetrics(
        label=label,
        start_date=str(pd.Timestamp(start).date()),
        end_date=str(pd.Timestamp(end).date()),
        n_bars=int(len(equity)),
        years=float(years),
        initial_equity=initial,
        final_equity=final,
        total_return=float(total_return),
        cagr=float(cagr),
        ann_volatility=float(ann_vol),
        sharpe=sharpe,
        sortino=sortino,
        max_drawdown=float(mdd),
        calmar=calmar,
        trade_count=trade_count,
        turnover_annual=float(turnover),
        pct_time_in_market=pct_in_market,
        total_costs=float(total_costs),
        cost_drag_pct_of_initial=float(cost_drag),
        warnings=tuple(warnings),
    )


def metrics_from_result(result, label: str | None = None, **kwargs) -> PerformanceMetrics:
    """Metrics for a ``BacktestResult`` — the normal entry point."""
    return compute_metrics(
        result.equity,
        label=label or result.strategy_name,
        fills=result.fills,
        weights=result.weights,
        **kwargs,
    )
