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
from dataclasses import asdict, dataclass
from typing import Mapping, Sequence

import pandas as pd

from engine.backtest import Backtester, BacktestResult, RunSpec
from engine.strategy import BuyAndHold, ExposureOverlay, Strategy
from reports.metrics import PerformanceMetrics, metrics_from_result

FILL_CONVENTION = "signal on bar t's close -> fill at bar t+1's open"


@dataclass(frozen=True)
class SuppressionSummary:
    """What the rebalance band declined to execute, for one run.

    The band is a licence to ignore the strategy, so the report states how
    often it was used and how big the biggest override was. ``dust`` is the
    sub-materiality rounding residue the band exists to absorb (expected to be
    large and boring); ``suppressed_trades`` is the count of REAL intended
    trades that never happened (expected to be zero, and alarming if not).
    """

    dust: int
    suppressed_trades: int
    largest_suppressed_bps: float
    largest_suppressed_notional: float
    largest_suppressed_symbol: str
    largest_suppressed_date: str
    largest_target_weight: float
    largest_actual_weight: float

    @classmethod
    def from_result(cls, result) -> "SuppressionSummary":
        worst = result.largest_suppressed
        return cls(
            dust=int(result.dust_only_skipped),
            suppressed_trades=int(result.suppressed_trades),
            largest_suppressed_bps=float(worst["skipped_weight_bps"]) if worst else 0.0,
            largest_suppressed_notional=float(worst["skipped_notional"]) if worst else 0.0,
            largest_suppressed_symbol=str(worst["symbol"]) if worst else "",
            largest_suppressed_date=str(pd.Timestamp(worst["date"]).date()) if worst else "",
            largest_target_weight=float(worst["target_weight"]) if worst else 0.0,
            largest_actual_weight=float(worst["current_weight"]) if worst else 0.0,
        )

    def to_dict(self) -> dict:
        return asdict(self)


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
    #: what the engine refused to execute — see ``SuppressionSummary``
    suppression: SuppressionSummary
    benchmark_suppression: SuppressionSummary

    @property
    def suppressed_trades(self) -> int:
        """Shorthand for the number a strategy author actually looks for."""
        return self.suppression.suppressed_trades

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
            "suppression": self.suppression.to_dict(),
            "benchmark_suppression": self.benchmark_suppression.to_dict(),
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
        suppression=SuppressionSummary.from_result(result),
        benchmark_suppression=SuppressionSummary.from_result(benchmark_result),
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

    # --- what the engine DECLINED to do (never only in a counter) ----------
    sup, bsup = report.suppression, report.benchmark_suppression
    lines.append("-" * (width + 50))
    lines.append(
        f"{'trades SUPPRESSED':<{width}} {sup.suppressed_trades:>16,d} "
        f"{bsup.suppressed_trades:>16,d} "
        f"{sup.suppressed_trades - bsup.suppressed_trades:>+14,d}"
    )
    lines.append(
        f"{'  (dust skipped)':<{width}} {sup.dust:>16,d} {bsup.dust:>16,d} "
        f"{sup.dust - bsup.dust:>+14,d}"
    )
    if sup.suppressed_trades or bsup.suppressed_trades:
        for label, x in (("strategy", sup), ("buy_and_hold", bsup)):
            if not x.suppressed_trades:
                continue
            lines.append(
                f"  !! {label}: the rebalance band DECLINED {x.suppressed_trades} "
                f"intended trade(s). Largest: {x.largest_suppressed_symbol} on "
                f"{x.largest_suppressed_date} — wanted weight "
                f"{x.largest_target_weight:.4f}, held {x.largest_actual_weight:.4f} "
                f"({x.largest_suppressed_bps:.1f} bp / "
                f"{x.largest_suppressed_notional:,.2f} not executed)."
            )
    else:
        lines.append(
            "  (the band only absorbed sub-materiality rounding dust; no intended "
            "trade was overridden)"
        )

    notes = list(s.warnings) + [f"[benchmark] {w}" for w in b.warnings] + list(report.engine_warnings)
    if notes:
        lines.append("")
        lines.append("NOTES (nothing here is suppressed):")
        lines.extend(f"  * {n}" for n in notes)
    return "\n".join(lines)
