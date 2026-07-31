"""Strategy and overlay interfaces (milestone 2).

LAYERING (spec section 3, golden rule 2)
----------------------------------------
    LAYER 1  strategy sleeve  -> emits DESIRED weights
    LAYER 2  regime switch    -> (milestone 4+) selects/zeroes sleeves
    LAYER 3  risk backbone    -> (milestone 4+) can only REDUCE exposure
    ENGINE                    -> executes whatever survives, at t+1's open

Milestone 2 builds Layer 1's interface, the engine, and the *seam* layers 2-3
plug into (``ExposureOverlay``). It deliberately builds NO strategy logic
beyond buy-and-hold plus the test instruments the definition of done needs —
strategies are milestone 5 and later, and building them before the evaluation
gauntlet exists is the exact mistake the spec's build order forbids.

WHY A STRATEGY ONLY RETURNS WEIGHTS
-----------------------------------
A strategy names *how much of the portfolio it wants in each symbol* and
nothing else. It cannot name a price, a quantity, a bar, or an order type.
That is what makes the fill convention structurally unbreakable: there is no
channel through which a strategy could ask to be filled at the close that
generated its signal.

THE OVERLAY SEAM (golden rule 2 — "the risk layer is non-bypassable")
---------------------------------------------------------------------
An overlay maps (context, desired weights) -> allowed weights. The engine
clamps every overlay's output to ``min(previous, output)`` element-wise and
floors it at 0, so an overlay can veto or shrink exposure and can NEVER add
it — even if it tries. Milestone 4 fills this seam with the vol target, the
drawdown kill switch, the caps and the stress flags; nothing is implemented
here beyond the enforcement itself.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Mapping, Protocol, runtime_checkable

from engine.context import BarContext


class Strategy(ABC):
    """Layer-1 sleeve: bars in, desired target weights out. Pure and stateless
    with respect to the engine's books — it may keep its own state, but it can
    only read the portfolio through the context.

    Contract for ``target_weights``:
      * return a mapping ``symbol -> weight``; omitted symbols mean 0.0
      * weights are fractions of total equity, >= 0 (Phase 1 is long-only)
      * the sum may not exceed the run's ``max_gross`` (default 1.0 — the
        spec's leverage cap)
      * violations raise loudly in the engine; nothing is silently clipped
    """

    #: human-readable label used in reports and (later) the trial registry
    name: str = "strategy"

    def on_start(self, symbols: tuple[str, ...]) -> None:
        """Optional hook, called once before the first bar. No data is given:
        anything you need must come from the per-bar context."""

    @abstractmethod
    def target_weights(self, ctx: BarContext) -> Mapping[str, float]:
        """Desired weights, decided on ``ctx``'s close, executed at the NEXT
        bar's open."""

    def describe(self) -> dict:
        """Config for reports and the (milestone-3) trial registry. Override to
        expose parameters; every knob you add here becomes a logged trial."""
        return {"name": self.name, "class": type(self).__name__}


@runtime_checkable
class ExposureOverlay(Protocol):
    """Layer-2/3 seam. Reduce-only by construction (the engine enforces it)."""

    name: str

    def __call__(
        self, ctx: BarContext, desired: Mapping[str, float]
    ) -> Mapping[str, float]:  # pragma: no cover - protocol
        ...


class BuyAndHold(Strategy):
    """Buy the target weights on the first possible fill and never trade again.

    This is the benchmark every report is measured against (spec section 5,
    "Reporting"), and it is run through the SAME engine and the SAME cost
    model as any strategy — no forked benchmark path, no gross-mode shortcut.

    With the default ``weights=None`` it holds an equal-weighted, fully
    invested basket of the run's universe. It emits a constant target, so
    after the initial fill the engine's rebalance threshold keeps it dormant
    (it is a *hold*, not a daily rebalance).
    """

    def __init__(self, weights: Mapping[str, float] | None = None, name: str = "buy_and_hold"):
        self._weights = dict(weights) if weights is not None else None
        self.name = name

    def target_weights(self, ctx: BarContext) -> Mapping[str, float]:
        if self._weights is not None:
            return dict(self._weights)
        symbols = ctx.symbols
        return {s: 1.0 / len(symbols) for s in symbols}

    def describe(self) -> dict:
        return {
            "name": self.name,
            "class": type(self).__name__,
            "weights": "equal_weight_full_invest" if self._weights is None else dict(self._weights),
        }
