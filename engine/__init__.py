"""Event-driven backtester (milestone 2).

Public surface:
    RunSpec, Backtester, BacktestResult, run_backtest, EngineError
    Strategy, BuyAndHold, ExposureOverlay
    BarContext, Bar
    adjusted_bars

Canonical fill convention (declared in ``costs.model``, enforced here): a
signal computed on bar *t*'s CLOSE executes at bar *t+1*'s OPEN. Backtests run
on ADJUSTED prices (``engine.prices``) and every fill is charged through
``costs.apply_costs``. There is no gross mode.
"""

from engine.backtest import (
    Backtester,
    BacktestResult,
    EngineError,
    RunSpec,
    load_adjusted_universe,
    run_backtest,
    verify_shared_calendar,
    zero_cost_spec,
)
from engine.context import Bar, BarContext, ContextError
from engine.prices import PriceError, adjusted_bars
from engine.strategy import BuyAndHold, ExposureOverlay, Strategy

__all__ = [
    "Backtester",
    "BacktestResult",
    "EngineError",
    "RunSpec",
    "load_adjusted_universe",
    "run_backtest",
    "verify_shared_calendar",
    "zero_cost_spec",
    "Bar",
    "BarContext",
    "ContextError",
    "PriceError",
    "adjusted_bars",
    "BuyAndHold",
    "ExposureOverlay",
    "Strategy",
]
