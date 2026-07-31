"""Standardized result reporting (spec section 8, ``/reports``).

Every report shows the mandated metric set for the strategy AND for
buy-and-hold over the identical window, both NET of the cost model. See
``reports.report`` for why that pairing is structural rather than a
convention someone has to remember.
"""

from reports.benchmark import (
    BenchmarkError,
    BuyAndHoldReference,
    buy_and_hold_reference,
    explain_buy_and_hold_delta,
)
from reports.metrics import (
    MetricsError,
    PerformanceMetrics,
    compute_metrics,
    max_drawdown,
    metrics_from_result,
)
from reports.report import Report, build_report, format_report, run_and_report

__all__ = [
    "BenchmarkError",
    "BuyAndHoldReference",
    "buy_and_hold_reference",
    "explain_buy_and_hold_delta",
    "MetricsError",
    "PerformanceMetrics",
    "compute_metrics",
    "max_drawdown",
    "metrics_from_result",
    "Report",
    "build_report",
    "format_report",
    "run_and_report",
]
