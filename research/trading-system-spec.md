# Personal Trading System — Theory & Build Specification

**Version:** 1.0 (2026-07-21)
**Audience:** the developer / coding agent who will build this. Self-contained — you should not need to read anything else to start. Companion evidence lives in `research/claude-trading-bot-claims.md` and `research/indicator-confluence-evidence.md`, but this document is the source of truth for *what to build*.
**Status:** greenfield. No code exists yet. This spec defines Phase 1 (backtesting + paper trading). No real money is in scope.

---

## 0. One-paragraph summary

Build a **research and paper-trading backtester** for US equity ETFs that treats the market honestly: an LLM writes the code but never makes a trade decision; every candidate strategy must survive a rigorous anti-overfitting gauntlet before it is believed; transaction costs are modeled first, not last; and the realistic goal is **drawdown control and process discipline, not beating the market**. The architecture is "filters over signals": a risk layer decides *how much* exposure, a regime switch decides *which* strategy is active, and a small set of evidence-backed strategy sleeves generate entries. Everything is measured against buy-and-hold on a risk-adjusted basis, and against a random-trading null.

---

## 1. Core theory (first principles, each with its evidentiary reason)

These are the beliefs the system is built on. They come from the research. Treat them as design axioms.

1. **Markets are near-efficient at retail-accessible timeframes.** At seconds-to-minutes horizons, price is approximately a martingale (a coin flip). Expected gross profit of a blindly-timed trade is ~zero; volatility gives you variance, not edge. → *Do not build anything that assumes short-horizon price prediction.*

2. **Costs are the dominant force, and they do not invert.** Fees + spread + slippage are paid on every trade in both directions. In the best-documented AI experiment, 14 of 15 generated strategies were profitable gross and *unprofitable net*; the one survivor won by trading least. → *Model costs before signals. Prefer low turnover by construction. You cannot fix a losing strategy by inverting it — the inverse pays the same costs.*

3. **Most technical indicators are debunked as standalone signals.** Across ~40,000 rules in the data-snooping-corrected academic literature (Sullivan-Timmermann-White; Bajgrowicz-Scaillet), essentially none survive correction plus costs on liquid US instruments. MACD, RSI(14) 70/30, OBV, VWAP-reversion, golden-cross: no defensible edge. → *Do not implement these as alpha sources.*

4. **Confluence (AND-gating indicators) multiplies overfitting, it does not create edge.** MACD/RSI/stochastics are all functions of the same recent prices (ρ ≈ 0.5–0.9); combining them double-counts while shrinking the sample and exploding the search space. The most flexible confluence search ever run academically (genetic programming) found nothing that beat buy-and-hold out-of-sample. → *Never combine correlated signals at the signal level. Combine weakly-correlated strategies at the portfolio level instead.*

5. **What survives is regime-conditioning with a mechanism, not indicators.** The defensible edges are: volatility targeting as risk control; momentum gated by market-state/volatility (crash filter); short-term mean-reversion conditional on high VIX (paid liquidity provision). Each has an economic mechanism, which is the best defense against data-mining. → *Build the system as regimes + a few mechanism-backed sleeves.*

6. **Published edges decay.** Expect a ~26% haircut out-of-sample and ~58% post-publication (McLean-Pontiff). The overnight-drift and pre-FOMC-drift anomalies literally decayed to zero in real time (2021 and 2015 respectively). → *Weight recent out-of-sample data. Any effect must still work on 2016–2026.*

7. **A backtest that isn't corrected for multiple testing is evidence of nothing.** A search over our planned grid (~10⁵–10⁶ nominal trials) will, from pure noise, hand you a Sharpe ≈ 1.0–1.2 "discovery" on 10 years of data. → *The evaluation protocol (§5) is not optional; it is the core of the system.*

8. **The honest goal is drawdown control, not alpha.** The best-documented AI-assisted retail system underperformed SPY (+53% vs +95%) but cut drawdowns materially. That is the realistically achievable win. → *Optimize and report on risk-adjusted metrics and drawdown, not raw return.*

---

## 2. Non-negotiable rules (hard constraints — enforce in code)

- **R1. No LLM in the trade-decision loop.** LLMs may write/refactor code, generate hypotheses, and analyze results offline. They must never be called to decide a position, size, entry, or exit at runtime. Every rigorous real-money test of LLM traders (Alpha Arena: all 8 models negative in Season 2) shows this loses.
- **R2. The risk layer is non-bypassable.** Strategies emit *desired* positions; a separate risk module can only ever reduce/veto exposure, never increase it. A strategy cannot override a stop, a position cap, or the kill switch.
- **R3. All backtest results are net of a realistic cost model (§4).** Gross-only numbers are never reported as performance.
- **R4. Paper trading only in Phase 1.** No live brokerage credentials, no real orders. The path to real money requires passing a pre-defined statistical bar (§5) and is a separate, later decision.
- **R5. Every evaluated configuration is logged to an append-only trial registry (§5.1).** Multiple-testing corrections use the *total* count, including abandoned experiments.
- **R6. A frozen holdout is touched exactly once.** The most recent 2–3 years (and ideally out-of-universe assets) are quarantined until a strategy is final. Consulting the holdout twice reclassifies it as training data.
- **R7. Reproducibility.** Every backtest run is seeded, versioned (code + data snapshot), and re-runnable to identical output. No `Math.random()`/wall-clock nondeterminism in the engine.

---

## 3. System architecture — "filters over signals"

Three layers. Data flows up; exposure authority flows down.

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3 — RISK BACKBONE (decides HOW MUCH total exposure)   │
│   • conditional volatility target                            │
│   • drawdown kill switch, position caps, leverage cap ≤ 1    │
│   • stress flags: VIX backwardation, HY-spread trend,        │
│     triple-witching/quarter-end de-risk                      │
│   → can only REDUCE or VETO. Never increases exposure. (R2)  │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2 — REGIME SWITCH (decides WHICH sleeve is active)    │
│   • VIX percentile: high → mean-reversion; low/mid → trend  │
│   • market-state (above/below long MA) gates momentum        │
├─────────────────────────────────────────────────────────────┤
│ LAYER 1 — STRATEGY SLEEVES (emit DESIRED positions)         │
│   • a small set of mechanism-backed sleeves (H4–H8)          │
│   • each emits target weights; NO risk logic inside          │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
          ┌───────────────────────────────┐
          │ DATA + COST MODEL + BACKTESTER │
          │ (point-in-time, net-of-cost)   │
          └───────────────────────────────┘
```

**Design intent:** the strategy sleeves are deliberately dumb and honest — they express a single mechanism each. Intelligence lives in *when to stand aside* (Layer 2) and *how much to risk* (Layer 3), which is where the surviving evidence actually is.

**Combine at the portfolio level, never the signal level.** If two sleeves each independently pass the §5 gauntlet and have low return correlation, allocate capital across them. Never AND their signals together.

---

## 4. Cost model (build this first, before any strategy)

A strategy is not believed until it is net of all of this. Implement as a single `apply_costs(fills)` function used by the backtester and paper trader identically.

- **Commission:** parameterize (default $0 for commission-free equity ETFs; keep the hook for futures later).
- **Spread:** half-spread paid on entry and exit. Use per-instrument estimates: liquid large-cap ETFs (SPY/QQQ/IWM) ≈ 1 bp; sector/country ETFs wider. Do **not** assume mid-price fills.
- **Slippage:** model as a function of order size vs. average volume; for retail-size on liquid ETFs a small fixed bp plus a size term is acceptable. Adverse (always costs you), in both directions.
- **Financing/borrow:** if any short or leverage is ever modeled, include borrow/financing. (Phase 1 is long-only; keep the hook.)
- **Fill realism:** no lookahead fills. A signal computed on bar *t*'s close executes at bar *t+1*'s open (or a modeled fill), never at the same close that generated it.

**Acceptance test for the cost model:** re-run the "random timing" simulation (see `scratchpad/random_timing_sim.py`, port it into the repo as a test) and confirm a high-frequency random strategy loses money in proportion to trade count. If a frequent random strategy shows profit, the cost model is wrong.

**Amendment (Milestone 1, 2026-07-21):** the acceptance test runs on **demeaned** open-to-open returns, not raw returns. On long-only US equities the literal raw-return gate is unsatisfiable: random long-only trading captures roughly half the index drift — at ~151 trades/yr random trading still nets ≈ +$5k raw over 2016–2026 — so only a wrongly-inflated cost model could force raw-return losses. Demeaning removes that drift beta and isolates the cost drag the gate is meant to measure: a zero-cost model correctly FAILS the demeaned gate (no drag to detect), while an honest cost model passes it.

---

## 5. The evaluation protocol (the heart of the system — implement fully)

No strategy is "real" until it clears this gauntlet. This is what separates this project from the "+3,345% best of 10,123 backtests" garbage.

### 5.1 Trial registry
Append-only log (SQLite or JSONL) of **every** configuration ever evaluated: indicator, parameters, universe, date range, filters, exits, and resulting metrics — including abandoned runs. `N` in every correction below = total registry count. This file is sacred; never rewrite history.

### 5.2 Pre-committed, capped search grids
Define the grid **before** running it. Prefer ≤ ~1,000 nominal trials per research question. Estimate the *effective* number of independent trials by clustering the correlation matrix of trial returns (neighboring parameters are ~ρ 0.9; families sharing price input ~ρ 0.5–0.8).

### 5.3 Discovery hurdle
A candidate must clear **all** of:
- **Deflated Sharpe Ratio (DSR) ≥ 0.95** given effective `N` (Bailey & López de Prado), with skew/kurtosis adjustment (trend strategies are fat-tailed).
- Sanity check: observed Sharpe > `E[max Sharpe | N_eff]` + ~2 standard errors. On 10y daily data, SE(annualized Sharpe) ≈ 0.32; noise alone yields ~1.0 at N_eff≈1,000, so the bar rises with N.
- Harvey-Liu-Zhu style: a mined signal needs t ≥ 3.0.

### 5.4 Universe test, not best-rule test
Run **White's Reality Check / Hansen SPA** (stepwise Romano-Wolf variant) over the *whole* grid. The benchmark is "best of everything I tried," not "this rule vs. zero."

### 5.5 Walk-forward + frozen holdout
- Anchored/expanding-window walk-forward for selection (e.g., expanding train, 1-year test steps).
- A final holdout (most recent 2–3 years, ideally + out-of-universe assets) touched **exactly once**, after the strategy is frozen (R6).

### 5.6 Probability of Backtest Overfitting (PBO)
Compute PBO via CSCV (Bailey-Borwein-López de Prado-Zhu). **Reject any candidate with PBO > 10–20%.**

### 5.7 Random-trading null
Every candidate must beat **≥95%** of random-entry strategies matched on trade frequency, holding period, and cost model. (Port `scratchpad/random_timing_sim.py`.) If it can't beat coin-flips with the same turnover, its "edge" is noise.

### 5.8 Cost & recency gates
- All metrics net of the §4 cost model.
- Require the effect to hold in the **most recent third** of the sample (post-publication decay is the norm).
- If any LLM-derived signal is ever tested: **post-model-knowledge-cutoff data only** (LLMs memorize in-cutoff prices → contaminated backtests).

### 5.9 Interactions as pre-registered hypotheses
"A works conditional on B" must: state a mechanism ex ante; be tested as the *difference* between conditional and unconditional performance; count every conditioning variant as a trial; and have ≥100 trades per conditional cell or the cell is unreportable.

**Reporting:** for every candidate, always report — net CAGR, Sharpe, Sortino, max drawdown, Calmar, trade count, turnover, % time in market, and the same metrics for **buy-and-hold** over the identical window. Raw return without these is not a result.

---

## 6. Strategy hypothesis backlog (implement and test in this order)

Each is a Layer-1 sleeve or a Layer-2/3 filter. All long-only, US ETFs, daily bars, next-open or next-close execution unless noted. **None is assumed to work — each must pass §5.** Ranked by strength of prior evidence.

**Risk backbone (build first — strongest evidence):**
- **H1 — Conditional volatility target.** Compute trailing realized vol (1–3 months daily). When it's in the top decile–quintile of its own history, scale exposure toward `target_vol / realized_vol` (cap at 1). Evidence: multi-asset, 90+ years; survives as *risk control* (tail/drawdown reduction). This is the backbone filter.
- **H2 — Long-trend filter.** Hold the index sleeve only when price > 10-month (≈200-day) SMA, monthly evaluation. Expect drawdown reduction, *not* outperformance; it will whipsaw and lag in V-recoveries. Report it honestly.
- **H3 — Stress flags (de-risk only).** Cut gross exposure when: VIX term structure is in backwardation; HY credit-spread (e.g., BAMLH0A0HYM2) trend is rising; or it's a triple-witching week / quarter-end. Binary risk-off inputs, never directional.

**Strategy sleeves (test after the backbone works):**
- **H4 — VIX-conditioned index dip-buying.** Buy SPY when RSI(2) < 10 **or** IBS = (close−low)/(high−low) < 0.2, **only when VIX > its rolling ~80th percentile**; exit on first up-close or after 3–5 days. No stops (stops destroy this class — size small instead). Mechanism: paid liquidity provision in panics (Nagel 2012). Highest-conviction sleeve.
- **H5 — IBS mean-reversion (unconditional baseline).** Same IBS entry on a basket of index ETFs, *without* the VIX condition. Purpose: measure the H4 interaction honestly (conditional minus unconditional per §5.9).
- **H6 — Connors RSI(2) classic.** RSI(2) < 5–10 on SPY above its 200-day SMA; exit RSI(2) > 70 or close > 5-day MA. Test 2010+ separately; expect decayed per-trade edge and a fat left tail (2011, Mar-2020).
- **H7 — Momentum, crash-filtered.** 6–12 month cross-sectional or sector momentum, gated by market-state (above long MA) and scaled by trailing vol to a ~12% target; prefer low-turnover winners. Mechanism: Daniel-Moskowitz crash filter ~doubles momentum Sharpe.
- **H8 — Diversified time-series momentum.** 12-month TSMOM across lowly-correlated ETFs (equities, bonds, gold, broad commodities), monthly, vol-scaled. This is the portfolio-level diversifier — the "combination" that actually works.

**Research-only (weak / expensive — low priority):**
- **H9 — High-volume return premium (long side)**, liquid small caps; assume 50% haircut, cost-model brutally.
- **H10 — Market intraday momentum** on SPY (first 30-min → last 30-min, high-volume days only). The *only* intraday candidate with peer-reviewed support, and it may have decayed post-2018. If built, **avoid the 10am–12pm ET dead-drift window**.

---

## 7. Explicitly OUT OF SCOPE (do not build)

- Any LLM making trade decisions at runtime (R1).
- Crypto and prediction markets (user decision: not interested; also the most expensive/elusive venues).
- Real-money live trading in Phase 1 (R4).
- Standalone MACD, RSI(14) 70/30, RSI divergences, OBV, VWAP-reversion, golden-cross as alpha (debunked).
- Multi-oscillator confluence / AND-gates (overfitting multiplier).
- Overnight-drift and pre-FOMC-drift harvesting (decayed to ~zero; cost-negative).
- Day-of-week, Turnaround Tuesday, January-effect timing (dead).
- Short volatility / VIX-product selling (unbounded left tail — XIV lost 96% in ~50 min in 2018).
- Single-stock short-term reversal (arbitraged away; not retail-viable after costs).
- High-frequency / seconds-to-minutes prediction (efficient; HFT is your counterparty).
- Cloning any third-party "trading bot" repo without a full read (malware/key-harvesting risk; see the claims report). Never feed live credentials to unreviewed code.

---

## 8. Suggested tech stack & project structure

Language/stack is the developer's call, but the research assumed Python. A sane default:

- **Python 3.11+**, `pandas`/`numpy`, `polars` optional for speed.
- **Data:** a point-in-time provider for daily OHLCV on liquid US ETFs; VIX, VIX futures term structure, HY OAS (FRED). Store immutable local snapshots (versioned) so backtests are reproducible.
- **Backtester:** either a vetted library (e.g., `vectorbt`, `backtrader`) or a small custom event-driven engine. Custom is fine and often clearer; if custom, the cost model and no-lookahead fill discipline are the parts to get right.
- **Broker (paper):** Alpaca paper API is the assumed target for the paper-trading harness — liquid equities, well-documented, free paper accounts.
- **Stats:** implement DSR, PBO/CSCV, White's Reality Check as a reusable `evaluation/` module (these are the crown jewels — test them independently).

Suggested layout:
```
/data          immutable point-in-time snapshots + loaders
/costs         cost model (§4) + tests
/strategies    Layer-1 sleeves (H4–H10), each pure: bars -> target weights
/regime        Layer-2 switches (VIX percentile, market state)
/risk          Layer-3 backbone (vol target, kill switch, caps, stress flags)
/engine        backtester (event-driven, seeded, no-lookahead)
/evaluation    DSR, PBO, reality-check, walk-forward, random-null, trial registry
/paper         Alpaca paper-trading harness (reuses strategies/regime/risk verbatim)
/reports       standardized metric + tearsheet output (always vs buy-and-hold)
/registry      append-only trial log (§5.1)
```
**Critical:** `/strategies`, `/regime`, `/risk` are shared *verbatim* between `/engine` (backtest) and `/paper` (live paper). No forked logic — the paper trader must run the exact code the backtest validated.

---

## 9. Build order (milestones, each with a definition of done)

1. **Data + cost model.** DoD: reproducible point-in-time loader; `apply_costs` passes the random-timing sanity test (§4).
2. **Backtester engine.** DoD: seeded, no-lookahead, reproduces buy-and-hold SPY to a known benchmark; unit-tested fill/timing.
3. **Evaluation module.** DoD: DSR, PBO/CSCV, White's Reality Check, walk-forward harness, and random-null all implemented and unit-tested against known inputs. Trial registry writes on every run.
4. **Risk backbone (H1–H3).** DoD: vol-target + kill switch + caps + stress flags demonstrably reduce max drawdown of a buy-and-hold baseline without a lookahead. Report drawdown reduction honestly.
5. **First sleeve (H4).** DoD: passes (or fails) the full §5 gauntlet on 2016–2026 with the holdout untouched until frozen. Whatever the verdict, it's reported truthfully — a clean "this doesn't beat buy-and-hold risk-adjusted" is a successful, valuable result.
6. **Remaining sleeves (H5–H8), then H9–H10 if warranted.** DoD: each through the gauntlet; portfolio-level combination only of independently-passing, low-correlation sleeves.
7. **Paper-trading harness.** DoD: runs the frozen, validated stack on Alpaca paper, reusing strategy/regime/risk code verbatim; logs live vs. expected.

**Promotion to real money is explicitly not in this spec.** It is a later, separate decision requiring a pre-defined out-of-sample paper-trading track record that matches backtested expectations.

---

## 10. Definition of success

Not "beat the market." Success for Phase 1 is:
- A backtester and evaluation module that make it **hard to fool ourselves** (the gauntlet works: it rejects overfit junk and the random null passes).
- An honest, cost-accurate answer for each hypothesis — including "no edge," which is the expected outcome for most.
- If anything survives: a low-turnover, drawdown-controlled sleeve or portfolio that is **competitive with buy-and-hold on risk-adjusted terms** (Sharpe/Calmar), with smaller drawdowns — validated out-of-sample and paper-traded before a single real dollar is considered.

The deliverable is a disciplined research machine, not a money printer. If it tells us "just hold an index," that is a correct and valuable answer.
