"""CLI: run a backtest and print the standard report (milestone 2).

    python -m engine.run --snapshot fixture --symbol SPY
    python -m engine.run --snapshot fixture --symbol SPY --check-benchmark

``--check-benchmark`` additionally prints the milestone-2 definition-of-done
proof: the engine's buy-and-hold beside the engine-free arithmetic reference,
with the delta fully decomposed (see ``reports.benchmark``).

Only buy-and-hold is runnable from here on purpose. Strategy sleeves are
milestone 5+; the spec's build order puts the evaluation gauntlet before any
strategy, and a convenient CLI is exactly how that ordering gets broken.
"""

from __future__ import annotations

import argparse
import json

from engine.backtest import Backtester, RunSpec
from engine.strategy import BuyAndHold
from reports.benchmark import buy_and_hold_reference, explain_buy_and_hold_delta
from reports.report import build_report, format_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a backtest and print the report.")
    parser.add_argument("--snapshot", default="fixture")
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--start", default=None)
    parser.add_argument("--end", default=None)
    parser.add_argument("--cash", type=float, default=100_000.0)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--check-benchmark", action="store_true",
                        help="print the DoD buy-and-hold reproduction proof")
    parser.add_argument("--json", action="store_true", help="print the report as JSON too")
    args = parser.parse_args(argv)

    spec = RunSpec(
        symbols=(args.symbol,),
        snapshot=args.snapshot,
        start=args.start,
        end=args.end,
        initial_cash=args.cash,
        seed=args.seed,
    )
    engine = Backtester(spec)
    result = engine.run(BuyAndHold())
    bench = engine.run(BuyAndHold())
    report = build_report(result, bench)
    print(format_report(report))

    if args.check_benchmark:
        reference = buy_and_hold_reference(engine.frames[args.symbol], symbol=args.symbol)
        delta = explain_buy_and_hold_delta(reference, result)
        print()
        print("DEFINITION OF DONE — buy-and-hold reproduction")
        print("  engine-free reference (GROSS, validation only, never reported as performance):")
        for k, v in reference.to_dict().items():
            print(f"    {k:<24} {v}")
        print("  delta decomposition:")
        print(json.dumps(delta, indent=4, default=str))

    if args.json:
        print()
        print(report.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
