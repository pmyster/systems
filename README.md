# systems
Personal Repository

## Trading research — Milestones 1-2 (data + cost model + backtester)

US-equity-ETF research backtester, Phase 1 (paper only). Read `CLAUDE.md`
and `research/trading-system-spec.md` first — the spec is the source of
truth. **Canonical fill convention:** a signal computed on bar *t*'s close
executes at bar *t+1*'s open. No lookahead, ever.

### Setup (Windows)

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

### Create a data snapshot

```powershell
.venv\Scripts\python -m data.refresh              # -> data/snapshots/YYYY-MM-DD/
.venv\Scripts\python -m data.refresh --snapshot-id 2026-07-21b   # second one same day
```

Snapshots are **immutable**: a refresh always creates a NEW dated directory
and refuses to touch an existing one. Backtests reference a snapshot id, so
every run is reproducible against frozen data. (yfinance adjusted prices are
retroactively revised — that is exactly why we snapshot.) Snapshots stay out
of git; the small committed `fixture` snapshot (real SPY/QQQ/HY-OAS data)
lets the test suite run from a fresh clone with no network.

Known data caveats: FRED's keyless CSV endpoint currently caps history at
~3 years (fine for the H3 trend input; a free FRED API key lifts it later).

### Run the tests

```powershell
.venv\Scripts\python -m pytest
```

The suite includes the milestone-1 acceptance gate: seeded random-timing
strategies on real data must LOSE money net of `costs.apply_costs`, with the
loss growing with trade count. Print the loss table directly:

```powershell
.venv\Scripts\python -m costs.random_timing_sim --snapshot fixture --symbol SPY
```

### Run a backtest (milestone 2)

```powershell
.venv\Scripts\python -m engine.run --snapshot fixture --symbol SPY --check-benchmark
```

Prints the standard report — the strategy's net CAGR, Sharpe, Sortino, max
drawdown, Calmar, trade count, turnover and % time in market **beside the same
metrics for buy-and-hold over the identical window** — and, with
`--check-benchmark`, the definition-of-done proof that the engine reproduces
buy-and-hold.

Layout:

| package | what it is |
| --- | --- |
| `engine/prices.py` | raw snapshot OHLCV -> **adjusted** (total-return) bars + point-in-time ADV |
| `engine/context.py` | `BarContext`, the frozen no-lookahead view a strategy sees |
| `engine/strategy.py` | `Strategy` (weights only), `BuyAndHold`, the reduce-only overlay seam |
| `engine/backtest.py` | the bar loop, sizing, fills, accounting |
| `reports/metrics.py` | the mandated metric set |
| `reports/benchmark.py` | engine-free buy-and-hold arithmetic reference (validation only) |
| `reports/report.py` | strategy vs buy-and-hold, always |

Decisions worth knowing before reading the code (each is documented at length
in the module that owns it):

- **Prices are adjusted.** Backtests run on split/dividend-adjusted prices
  reconstructed as `open * adj_close/close`. There is no raw-price mode.
- **Costs are unavoidable.** Every fill goes through `costs.apply_costs`.
  There is no gross mode and no `charge_costs=False`.
- **Strategies emit weights, never orders.** They cannot name a price, a size
  or a bar, which is what makes the t+1-open fill convention unbreakable.
- **The risk layer is reduce-only.** Overlays (milestone 4) are clamped to
  `min(previous, proposed)`; an overlay that tries to add exposure is clamped
  and the attempt is recorded in the report.
- **Rebalance band.** Trades below `max(min_trade_notional, min_trade_bps *
  equity)` are skipped and counted; a target of exactly zero always liquidates
  in full.
- **Reproducible.** Same spec + snapshot + strategy => byte-identical output.

Not built yet, deliberately: strategy sleeves (milestone 5+) and the
evaluation gauntlet / trial registry (milestone 3). The spec's build order
puts the gauntlet before any strategy; `RunSpec.fingerprint()` is the hook the
registry will key on.
