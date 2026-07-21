# CLAUDE.md — Personal Trading System

You are building a **US-equity-ETF research backtester + paper-trading harness**. Read this first, then `research/trading-system-spec.md` — that spec is the **source of truth for what to build**. This file is the quick orientation and the guardrails.

## What this repo is
A disciplined research machine, **not** a money-printer. The realistic goal is drawdown control and process quality, not beating the market. If the honest answer turns out to be "just hold an index," that is a correct and successful result.

Phase 1 (all that's in scope now): **backtesting + paper trading only. No real money.**

## The golden rules (do not violate — they're enforced design constraints)
1. **No LLM in the trade-decision loop.** LLMs write/refactor code and generate hypotheses offline. They never decide a position, size, entry, or exit at runtime. (Every real-money LLM-trading test loses.)
2. **The risk layer is non-bypassable.** Strategies emit *desired* positions; the risk module can only reduce or veto exposure, never increase it.
3. **Everything is net of a realistic cost model** (commission + spread + slippage), built *before* any strategy. Gross-only numbers are never reported as performance.
4. **No strategy is believed until it passes the evaluation gauntlet** (§5 of the spec): trial registry, capped grids, Deflated Sharpe ≥ 0.95, White's Reality Check, walk-forward + a touch-once holdout, PBO < 20%, and a random-trading null. An uncorrected backtest is evidence of nothing.
5. **No lookahead, ever.** Signal on bar *t*'s close executes at *t+1*. Backtests are seeded and reproducible.
6. **Log every evaluated config to the append-only trial registry.** Multiple-testing corrections use the total count, including abandoned runs.
7. **Paper-trading code reuses backtest strategy/regime/risk code verbatim.** No forked logic between backtest and paper.

## Architecture (one line)
"Filters over signals": a **risk backbone** (how much exposure) over a **regime switch** (which sleeve is active) over small, mechanism-backed **strategy sleeves** (entries). Combine strategies at the portfolio level, never AND-gate indicators at the signal level.

## Do NOT build
LLM runtime decisions · crypto/prediction markets · real-money trading (Phase 1) · standalone MACD/RSI(14)/OBV/VWAP-reversion/golden-cross · multi-oscillator confluence · overnight-drift or pre-FOMC-drift harvesting · day-of-week/January-effect timing · short-vol · single-stock short-term reversal · HFT/seconds-horizon prediction. (Rationale for each is in the spec + `research/indicator-confluence-evidence.md`.)

## Build order (see spec §9 for definitions of done)
1. Data + cost model → 2. Backtester engine → 3. Evaluation module → 4. Risk backbone (H1–H3) → 5. First sleeve (H4) → 6. Remaining sleeves → 7. Paper harness.

Start at step 1. Don't jump ahead to strategies before the cost model and evaluation module exist — that ordering is the whole point.

## Reference docs
- `research/trading-system-spec.md` — full theory, rules, cost model, evaluation protocol, H1–H10 hypothesis backlog, project structure. **Read in full before writing code.**
- `research/indicator-confluence-evidence.md` — the evidence behind every "build/don't build" call.
- `research/claude-trading-bot-claims.md` — why the viral "profitable AI bot" claims don't hold up (context/motivation).

## Working conventions
- Prefer a small, clear, well-tested custom engine over a heavy framework if it makes the cost model and no-lookahead discipline easier to verify.
- Test the evaluation module (Deflated Sharpe, PBO/CSCV, Reality Check, random null) independently against known inputs — these are the crown jewels; if they're wrong, everything downstream is.
- Every result report includes, alongside the strategy: net CAGR, Sharpe, Sortino, max drawdown, Calmar, trade count, turnover, % time in market — **and the same metrics for buy-and-hold** over the identical window.
- Paper broker target: Alpaca paper API. No live credentials in Phase 1.
