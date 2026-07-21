# Research: Indicator & Confluence Evidence Review

**Date:** 2026-07-21
**Method:** 6 parallel research agents, one per factor family, instructed to weight peer-reviewed, data-snooping-corrected, out-of-sample evidence over practitioner content. Status: **all 6 complete.**
**Question:** Do MACD, RSI, volume, moving averages, crossovers, VIX, cross-index signals — alone or in confluence — carry real, retail-harvestable edge? Which conditions (day, time, volatility regime) matter?

---

## 1. Headline verdict

**The gold in this mountain is not in the indicators — it is in the regimes.** Across ~40,000 rules tested in the corrected academic literature, essentially **zero classic indicator rules (and zero AND-combinations of them) survive data-snooping correction plus transaction costs on liquid US instruments.** What genuinely survives is a small set of *regime-conditioning* results with economic mechanisms:

| Survives scrutiny | Debunked |
|---|---|
| Volatility targeting as **risk control** (tail/drawdown reduction) | MACD(12,26,9) standalone signals |
| Momentum **gated by market state and volatility** (crash filter) | RSI(14) 70/30 overbought/oversold |
| Short-term **mean reversion conditional on high VIX** (paid liquidity provision) | RSI divergences (not even definable ex ante) |
| 10-month SMA trend filter as **drawdown reducer** (not return enhancer) | Golden cross / daily MA crossovers as alpha |
| Volume as a **conditioner** on momentum (prefer low-turnover winners) | OBV rules (no corrected US evidence) |
| Index-ETF dip-buying signals: RSI(2), IBS — post-publication survivors, decaying | "High-volume breakout" reliability (no citable evidence) |
| VIX backwardation / credit-spread trend as **binary stress flags** | VWAP mean-reversion as a retail signal |
| Triple-witching / quarter-end as a **de-risk (volatility) flag** | Daily Dow/S&P/Nasdaq/Russell lead-lag (HFT-arbitraged) |
| Overnight *reversal* after selloffs (structural) | Asia/Europe overnight predicting US (causality runs US→world) |
| Halloween / turn-of-month as a **mild seasonal tilt** (weak) | Intraday MA/MACD anything (7,846 rules, zero survivors on 5-min SPY) |
| | Multi-oscillator confluence (MACD+RSI+volume AND-gates) |
| | Pre-FOMC drift (gone post-2015); overnight *drift* (gone post-2021) |
| | Monday effect / day-of-week; January effect (large caps) |
| | Any calendar rule as standalone alpha (9,452 rules, zero survivors) |

---

## 2. Family-by-family summary

### 2.1 MACD & moving-average crossovers
The canonical arc: Brock-Lakonishok-LeBaron (1992) legitimized MA rules on 1897–1986 Dow data; Sullivan-Timmermann-White (1999) showed the best rule failed out-of-sample 1987–1996; Bajgrowicz-Scaillet (2012, JFE) showed that over 115 years no investor could have picked the working rules ex ante and **modest transaction costs erase even the in-sample profits**. Modern MACD studies find win rates below 50%; default (12,26,9) parameters have no special status. Rules stopped working almost exactly when tradable ETFs made them tradable (Hsu-Hsu-Kuan 2010) — edge death by tradability.

**What survives:** the 10-month SMA (≈200-day) filter on a broad index, monthly cadence (Faber's timing model) — out-of-sample since 2007 it delivered the *risk* claim (halved drawdowns, avoided 2008) but not the *return* claim (whipsawed 2010–2021, lagged buy-and-hold). Diversified 12-month time-series momentum across many assets (Moskowitz-Ooi-Pedersen) is the institutional survivor, but requires multi-asset breadth and had a losing decade before 2022. MA rules are **bear-market insurance with a whipsaw premium, not an alpha machine.**

### 2.2 RSI & short-term mean reversion
Single-stock short-term reversal (Jegadeesh/Lehmann) was real and was arbitraged from ~50%/yr gross (1995) to single digits by 2007 (Khandani-Lo); not retail-implementable after costs. The mechanism that remains is **Nagel (2012, RFS): reversal profit = payment for providing liquidity in panics, and it rises sharply with VIX.** Index daily autocorrelation flipped negative around 1998–2000 — index-ETF dip-buying is a post-2000 regime, not a law of nature; monitor it.

**What survives (blog-grade but consistently replicated post-publication):**
- **Connors RSI(2) < 5–10 on SPY above its 200-day SMA** — one of very few published rules with 15+ years of positive post-publication replication (~9% CAGR at ~28% market exposure, ~75% win rate) — but per-trade edge decayed by roughly half, equity curve depends on a handful of crisis rebounds, and the structural fat left tail is real (−11.5% in 2011, ugly Feb–Mar 2020). Stops destroy this strategy class; size small instead.
- **IBS (internal bar strength) on index ETFs**: buy close when (close−low)/(high−low) < 0.2, exit when > 0.8. Next-day spread ≈ +0.35% vs −0.13%, multi-market, ~30 years.
- **VIX-conditioned dip-buying**: the same entries taken only when VIX is elevated — the one peer-reviewed, mechanism-backed amplifier of this family.

RSI(14) 70/30 and RSI divergences: debunked / no evidence. The "sell overbought" side actively loses against equity drift.

### 2.3 Volume
Three academically real effects: the **high-volume return premium** (Gervais-Kaniel-Mingelgrin 2001; replicated in 41 countries; still detectable 2020–2024 but small-cap-tilted and haircut ~50% post-publication), **volume-conditioned momentum** (Lee-Swaminathan 2000: prefer low-turnover winners), and **intraday momentum stronger on high-volume days** (Gao et al. 2018). Everything else in the practitioner canon — OBV, volume-confirmed breakouts, VWAP reversion — has no corrected, cost-adjusted evidence.

Modern caveat: **over 50% of US volume is now off-exchange/internalized** (2025), and dark flow is less informed than lit flow — classic 1990s volume interpretation is structurally broken. Any volume rule must use *abnormal* volume normalized to the stock's own distribution and the intraday U-curve, validated on post-2015 data only. Best use of the U-curve: scheduling our own executions (cost reduction — the most reliable "edge" volume offers).

### 2.4 VIX, volatility regimes & cross-index signals
The strongest filter family:
1. **Conditional volatility targeting** (Harvey et al. 2018; Bongaerts et al. 2020): scale exposure down only in the extreme high-vol tail (top decile/quintile of trailing realized vol). Raises Sharpe modestly for equities, reliably cuts vol-of-vol, kurtosis, and left tails, with low turnover. Note: Moreira-Muir's stronger "vol-managed alpha everywhere" claim failed real-time replication (Cederburg et al. 2020) — keep this as risk control, not alpha.
2. **Momentum-crash filter** (Cooper et al. 2004; Wang-Xu 2015; Barroso & Santa-Clara 2015; Daniel-Moskowitz 2016): run momentum only after up-markets and when vol is not elevated, or scale it to a ~12% vol target — roughly doubles momentum's Sharpe by removing its crashes. Multiple independent teams, still working post-publication.
3. **VIX-percentile strategy switch**: high VIX (>~80th rolling percentile) ⇒ favor mean reversion / liquidity provision (Nagel); low-to-mid VIX after up-markets ⇒ favor momentum/trend. Use rolling percentiles, not fixed levels like "30."
4. **VIX term-structure backwardation** as a rare binary stress flag → cut gross exposure. Never trade short-vol products on it (XIV lost 96% in ~50 minutes on Feb 5, 2018).
5. **HY credit-spread level + trend (or the Fed's EBP)** as a slow monthly confirming risk-off input (Gilchrist-Zakrajšek 2012).
6. **Breadth thrust** (Zweig) as re-risking confirmation only — perfect but tiny-n record (~15 signals since 1950).

Debunked: daily index lead-lag (Dirac delta at lag zero — HFT territory), overnight Asia/Europe → US prediction (causality runs US → world; Rapach et al. 2013), "buy VIX>30" as standalone alpha (risk compensation, not edge), fixed breadth thresholds.

### 2.5 Confluence (the methodological verdict)
**AND-gating correlated indicators is an overfitting multiplier, not an edge source.** MACD, RSI, and MA-distance are all functions of the same recent price changes (ρ ≈ 0.5–0.9); "confirmation" is double-counting, while the sample shrinks and the search space explodes. The most flexible confluence search ever run academically — genetic programming over arbitrary indicator combinations (Allen-Karjalainen 1999, JFE) — found nothing that beat buy-and-hold out-of-sample after costs. ML studies (Gu-Kelly-Xiu 2020) prove nonlinear interactions *exist*, but the profits concentrate in microcaps/high-turnover reversal that retail cannot harvest after costs (Avramov et al. 2023).

What professionals actually combine is **weakly correlated return sources at the portfolio level** (trend + value + carry, ρ ≈ 0), where Sharpe compounds by diversification — not correlated oscillators at the signal level.

### 2.6 Calendar & time-of-day
The benchmark to beat is Sullivan-Timmermann-White (2001): ~9,452 calendar rules tested against a data-snooping Reality Check, **none survive** as standalone timing rules. Everything below is therefore a weak *conditioner/filter*, sized small, never standalone alpha — and the strongest ones have a mechanism (dealer inventory, forced rebalancing, options gamma), which is the best defense against the STW critique.

The dominant theme is **post-publication decay, rescued only conditionally**:
- **Overnight drift** (the famous "the market makes all its money while closed"; Boyarchenko et al., NY Fed): historically ~3.7%/yr concentrated in a 2–3am ET futures window — but **≈ zero since 2021** (NY Fed's own "Disappearing Overnight Drift," July 2026) and never cost-survivable retail (the NightShares night-effect ETFs launched 2022, badly underperformed, liquidated 2023). Do **not** try to harvest it. What survives is the overnight **reversal after intraday selloffs**, amplified when VIX rises — structural, usable as context not as a standalone trade.
- **Pre-FOMC drift** (Lucca-Moench: once ~49 bps in the 24h before FOMC, ~80% of the equity premium): **vanished after 2015** (Kurov et al.). Dead — textbook decay.
- **Intraday last-30-min momentum** (Gao et al. 2018): significant in-sample 1993–2013, but **disappears out-of-sample post-2018** unless conditioned on high-vol/high-volume/macro days. Fragile; the same H10 candidate flagged elsewhere.
- **10:00am–12:00pm ET** (your original window): the **lunchtime lull** — documented dead drift and low liquidity. The evidence says this is a *stand-aside* window, not a drift-harvesting one.
- **Turn-of-month** (McConnell-Xu: once the strongest calendar effect, positive in 31 of 35 countries): **shrank to insignificance in US large caps since ~2015** ("arbitraged away"); a faint long tilt at best, stronger internationally.
- **Halloween / "sell in May"** (Nov–Apr > May–Oct): best long-horizon pedigree of the seasonals (Zhang-Jacobsen, 323 years) but US-specific, post-cost, recent case is specification-sensitive. Mild seasonal tilt only.
- **Triple-witching / quarter-end** (3rd Friday Mar/Jun/Sep/Dec): the most *mechanically reliable* survivor, but its robust feature is **elevated volatility and flow-dominance, not direction** — so it's a **de-risk / cut-size flag**, not a directional signal.
- **Debunked:** Monday effect, Turnaround Tuesday, day-of-week (dead in 2015–2026 data); January effect (dead in large caps, weak micro-cap residual); Santa Claus rally (statistically real but tiny/noisy — folklore-adjacent tilt).

Net: no calendar effect is tradable as alpha; the useful outputs are (a) a **de-risk flag** around witching/quarter-end, (b) confirmation that **10am–12pm is dead drift** (stand aside), and (c) the meta-lesson that these effects are **state-dependent** — flat unconditionally, sometimes alive in high-vol states — so every one must be re-tested on 2016–2026 data, net of costs, conditioned on VIX.

**The multiple-testing math for our own planned search:** a 6-family × parameters × filters grid is nominally 10⁵–10⁶ trials, effectively ~500–5,000 independent ones after correlation clustering. On 10 years of daily data, **pure noise will hand that search a Sharpe ≈ 1.0–1.2 "discovery."** A backtest Sharpe of 1 from an uncontrolled sweep is evidence of nothing.

---

## 3. The evaluation protocol our backtester must implement

(From the confluence agent; this is the project's constitution.)

1. **Trial registry**: append-only log of every configuration ever evaluated (including abandoned ones). N in all corrections = total logged trials.
2. **Pre-committed search grids**: define the grid before running; prefer ≤ ~1,000 nominal trials per research question; estimate effective N by clustering the trial-return correlation matrix.
3. **Discovery hurdle**: Deflated Sharpe Ratio ≥ 0.95 given effective N (Bailey & López de Prado), sanity-checked with Harvey-Liu haircut Sharpe / FDR at 5%; mined signals need t ≥ 3.0 (Harvey-Liu-Zhu).
4. **Universe test**: White's Reality Check / Hansen SPA (stepwise) over the whole grid — benchmark is "best of everything tried," not "this rule vs zero."
5. **Walk-forward + untouched holdout**: expanding-window walk-forward for selection; final 2–3 years touched exactly once after the strategy is frozen; consulting it twice makes it training data.
6. **Probability of Backtest Overfitting** (CSCV): reject candidates with PBO > 10–20%.
7. **Costs first-class**: all evaluation net of spread + slippage + commissions; require performance in the most recent third of the sample.
8. **Interactions as pre-registered hypotheses**: a claim "A works conditional on B" needs a mechanism stated ex ante, is tested as the *difference* between conditional and unconditional performance, counts every variant examined as a trial, and needs ≥100 trades per conditional cell.
9. **Combine at the portfolio level**: independently validated, low-correlation signals get capital allocations; they do not get AND-ed.
10. **Random-timing null** (from our own simulation, `scratchpad/random_timing_sim.py`): every candidate must beat ≥95% of random-entry strategies matched on trade frequency and costs.

---

## 4. Hypothesis backlog for the build (ranked)

The architecture the evidence supports is **filters over signals**: a risk backbone deciding *how much* exposure, a regime switch deciding *which* sleeve trades, and a small set of validated sleeves.

**Risk backbone (strongest evidence):**
- H1. Conditional vol targeting: scale exposure toward target_vol/realized_vol only when trailing realized vol is in its top decile-quintile; cap leverage at 1.
- H2. 10-month SMA filter on the index sleeve, monthly evaluation — expect drawdown reduction, not outperformance.
- H3. Stress flags gating gross exposure: VIX backwardation; HY OAS rising trend; **triple-witching week / quarter-end as a de-risk (cut-size) flag**.

**Strategy sleeves (test in this order):**
- H4. VIX-conditioned index dip-buying: RSI(2)<10 or IBS<0.2 on SPY, only when VIX > rolling 80th percentile; exit first up-close/3–5 days; no stops, small size.
- H5. IBS mean reversion on a basket of index ETFs (unconditional baseline vs H4 to measure the VIX interaction honestly).
- H6. Connors RSI(2) classic (above 200-day SMA) — test 2010+ separately; expect decay.
- H7. Cross-sectional or sector momentum, 6–12 month, gated by market state + vol (the Daniel-Moskowitz filter), low-turnover-winner preference (Lee-Swaminathan).
- H8. Diversified 12-month time-series momentum across ETFs (equities/bonds/gold/commodities), monthly, vol-scaled — the portfolio-level diversifier.

**Research-only (weak/expensive):**
- H9. High-volume return premium, long side, liquid small caps (assume 50% haircut; cost-model brutally).
- H10. Market intraday momentum on SPY (first 30 min → last 30 min, high-volume days only) — the sole intraday candidate with peer-reviewed support; verify post-2018 persistence before caring.

**Explicitly out of scope:** anything from the debunked column; anything intraday other than H10; short-vol; single-stock short-term reversal; overnight-gap/overnight-drift harvesting (dead post-2021, cost-negative); pre-FOMC drift (dead post-2015); day-of-week and January-effect timing. If H10 (or any intraday work) ever runs, avoid the **10am–12pm ET dead-drift window** — stand aside there rather than demand a signal.

---

## 5. Status

All six factor families complete (MACD/MA, RSI/mean-reversion, volume, VIX/cross-index, confluence, calendar/time-of-day). The calendar family confirmed the prior expectation: no calendar effect is standalone alpha (STW 2001: ~9,452 rules, zero survivors), the famous overnight-drift and pre-FOMC-drift edges have decayed to zero in real time, and the only usable outputs are a witching/quarter-end **de-risk flag** and confirmation that the **10am–12pm ET window is dead drift**. Next step is not more research — it is building the backtester per the §3 protocol and running the H1–H10 backlog against it, out-of-sample on 2016–2026 data and net of realistic costs.
