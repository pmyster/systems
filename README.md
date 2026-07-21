# systems
Personal Repository

## Trading research — Milestone 1 (data + cost model)

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
