"""The reporting surface (milestone 2).

ONE RULE, MADE STRUCTURAL
-------------------------
The spec (section 5) and CLAUDE.md both say: every result report includes the
mandated metric set **and the same metrics for buy-and-hold over the identical
window**. So a ``Report`` cannot be constructed without a benchmark, and
``run_and_report`` produces the benchmark by running ``BuyAndHold`` through
the *same* ``Backtester`` object — same bars, same window, same cost model,
same fill convention. There is no path that emits strategy numbers alone, and
no forked benchmark implementation that could quietly differ.

Both columns are NET. The engine has no gross mode (golden rule 3).

Everything here is deterministic: ``to_json()`` of two identical runs is
byte-identical, which is what ``tests/test_determinism.py`` asserts.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Mapping, Sequence

import pandas as pd

from engine.backtest import Backtester, BacktestResult, RunSpec
from engine.strategy import BuyAndHold, ExposureOverlay, Strategy
from reports.metrics import PerformanceMetrics, metrics_from_result

FILL_CONVENTION = "signal on bar t's close -> fill at bar t+1's open"


@dataclass(frozen=True)
class Report:
    """A strategy's mandated metrics beside buy-and-hold's, same window."""

    snapshot: str
    symbols: tuple[str, ...]
    seed: int
    price_basis: str
    fill_convention: str
    spec_fingerprint: str
    strategy: PerformanceMetrics
    benchmark: PerformanceMetrics
    strategy_config: dict
    benchmark_config: dict
    overlay_names: tuple[str, ...]
    engine_warnings: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "snapshot": self.snapshot,
            "symbols": list(self.symbols),
            "seed": self.seed,
            "price_basis": self.price_basis,
            "fill_convention": self.fill_convention,
            "spec_fingerprint": self.spec_fingerprint,
            "strategy": self.strategy.to_dict(),
            "benchmark": self.benchmark.to_dict(),
            "strategy_config": self.strategy_config,
            "benchmark_config": self.benchmark_config,
            "overlay_names": list(self.overlay_names),
            "engine_warnings": list(self.engine_warnings),
        }

    def to_json(self) -> str:
        """Deterministic serialization — sorted keys, fixed separators."""
        return json.dumps(self.to_dict(), sort_keys=True, indent=2, default=str)


def build_report(
    result: BacktestResult,
    benchmark_result: BacktestResult,
    risk_free_annual: float = 0.0,
) -> Report:
    """Assemble a report from a strategy run and its benchmark run.

    Refuses to pair runs that do not cover the identical window — an
    apples-to-oranges comparison is worse than no comparison.
    """
    if not result.equity.index.equals(benchmark_result.equity.index):
        raise ValueError(
            "strategy and benchmark cover different windows "
            f"({result.equity.index[0].date()}..{result.equity.index[-1].date()} vs "
            f"{benchmark_result.equity.index[0].date()}..{benchmark_result.equity.index[-1].date()}) "
            "— the spec requires the benchmark over the IDENTICAL window."
        )
    return Report(
        snapshot=result.spec.snapshot,
        symbols=tuple(result.spec.symbols),
        seed=result.spec.seed,
        price_basis=result.spec.price_basis,
        fill_convention=FILL_CONVENTION,
        spec_fingerprint=result.spec.fingerprint(),
        strategy=metrics_from_result(result, risk_free_annual=risk_free_annual),
        benchmark=metrics_from_result(
            benchmark_result, label="buy_and_hold", risk_free_annual=risk_free_annual
        ),
        strategy_config=result.strategy_config,
        benchmark_config=benchmark_result.strategy_config,
        overlay_names=result.overlay_names,
        engine_warnings=tuple(result.warnings) + tuple(
            f"[benchmark] {w}" for w in benchmark_result.warnings
        ),
    )


def run_and_report(
    spec: RunSpec,
    strategy: Strategy,
    overlays: Sequence[ExposureOverlay] = (),
    frames: Mapping[str, pd.DataFrame] | None = None,
    benchmark: Strategy | None = None,
    risk_free_annual: float = 0.0,
    snapshots_dir=None,
) -> tuple[Report, BacktestResult, BacktestResult]:
    """Run a strategy AND its buy-and-hold benchmark through one engine.

    Returns ``(report, strategy_result, benchmark_result)``. The benchmark runs
    with NO overlays: it is the passive alternative the strategy must justify
    itself against, not a risk-managed variant of itself.
    """
    engine = Backtester(spec, frames=frames, snapshots_dir=snapshots_dir)
    result = engine.run(strategy, overlays)
    bench_result = engine.run(benchmark or BuyAndHold())
    return build_report(result, bench_result, risk_free_annual=risk_free_annual), result, bench_result


_ROWS = (
    ("net CAGR", "cagr", "pct"),
    ("Sharpe", "sharpe", "num"),
    ("Sortino", "sortino", "num"),
    ("max drawdown", "max_drawdown", "pct"),
    ("Calmar", "calmar", "num"),
    ("trade count", "trade_count", "int"),
    ("turnover (x/yr)", "turnover_annual", "num"),
    ("% time in market", "pct_time_in_market", "pct_raw"),
    ("--", None, None),
    ("total return", "total_return", "pct"),
    ("ann. volatility", "ann_volatility", "pct"),
    ("final equity", "final_equity", "money"),
    ("total costs paid", "total_costs", "money"),
    ("cost drag (% init)", "cost_drag_pct_of_initial", "pct_raw"),
)


def _fmt(value, kind: str) -> str:
    if value is None:
        return ""
    if kind == "int":
        return f"{int(value):,d}"
    if isinstance(value, float) and value != value:  # NaN
        return "n/a"
    if kind == "pct":
        return f"{value * 100:+.2f}%"
    if kind == "pct_raw":
        return f"{value:.2f}%"
    if kind == "money":
        return f"{value:,.2f}"
    return f"{value:.3f}"


def format_report(report: Report) -> str:
    """Human-readable side-by-side table. Strategy | buy-and-hold | difference."""
    s, b = report.strategy, report.benchmark
    width = 22
    lines = [
        f"RUN  snapshot={report.snapshot}  symbols={list(report.symbols)}  seed={report.seed}",
        f"     prices={report.price_basis}  fills={report.fill_convention}",
        f"     window={s.start_date} .. {s.end_date}  ({s.n_bars} bars, {s.years:.2f}y)"
        f"  fingerprint={report.spec_fingerprint}",
        f"     overlays={list(report.overlay_names) or 'none'}",
        "",
        f"{'metric (NET of costs)':<{width}} {s.label:>16} {'buy_and_hold':>16} {'difference':>14}",
        "-" * (width + 50),
    ]
    for title, attr, kind in _ROWS:
        if attr is None:
            lines.append("-" * (width + 50))
            continue
        sv, bv = getattr(s, attr), getattr(b, attr)
        diff = ""
        if kind in ("pct", "num", "pct_raw", "money") and isinstance(sv, float) and isinstance(bv, float):
            if sv == sv and bv == bv:
                d = sv - bv
                diff = f"{d * 100:+.2f}pp" if kind == "pct" else (
                    f"{d:+.2f}pp" if kind == "pct_raw" else f"{d:+.3f}" if kind == "num" else f"{d:+,.2f}"
                )
        elif kind == "int":
            diff = f"{int(sv) - int(bv):+,d}"
        lines.append(f"{title:<{width}} {_fmt(sv, kind):>16} {_fmt(bv, kind):>16} {diff:>14}")

    notes = list(s.warnings) + [f"[benchmark] {w}" for w in b.warnings] + list(report.engine_warnings)
    if notes:
        lines.append("")
        lines.append("NOTES (nothing here is suppressed):")
        lines.extend(f"  * {n}" for n in notes)
    return "\n".join(lines)
