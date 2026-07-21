# Research: "Claude Built Me a Profitable Trading Bot" — Are the Claims True?

**Date:** 2026-07-21
**Method:** 4 parallel research agents — (1) Reddit/HN/forums, (2) YouTube/Medium/blogs, (3) verifiable evidence (GitHub, live benchmarks, academic papers), (4) Facebook/Claude community groups.
**Purpose:** Pre-build research for our own trading system. No code yet — this document decides what's worth building.

---

## 1. Verdict (TL;DR)

**The viral claims are, as stated, not true.** Not a single claim found — across ~30 distinct claims on Reddit, YouTube, Medium, Facebook, X, and GitHub — clears the bar of *"live profitable over a statistically meaningful period with verifiable records."*

But the picture has three distinct layers, and they must not be conflated:

| Layer | Claim | Evidence says |
|---|---|---|
| **LLM as trader** ("Claude makes the trading decisions") | Profitable | **False.** Every controlled real-money test shows losses. |
| **Claude as coder** ("Claude wrote my bot") | Profitable | **Half-true.** Claude builds excellent *infrastructure* fast; the strategies it generates mostly lose after fees (14 of 15 in the best-documented experiment). |
| **Mechanical arbitrage executed by AI-written code** (Polymarket sports arb etc.) | $1 → $3.3M | **Partially real, misattributed.** On-chain P&L exists for a few outlier wallets, but the edge is latency/market-structure, not AI — and the hype material contained fabricated screenshots. |

---

## 2. The hard evidence

### 2.1 LLMs trading real money lose (the cleanest data available)

**Alpha Arena (nof1.ai)** — real $10k per model, live crypto perps on Hyperliquid, on-chain, no human intervention:

- **Season 1** (Oct–Nov 2025): Qwen3 Max +22.3% and DeepSeek +4.9% were the only winners. **Claude Sonnet 4.5: −30.8%** (100% long the entire contest, no hedging, no dynamic stops, $482 in fees on $10k). GPT-5 −62.7%, Gemini −56.7%.
- **Season 1.5** (stocks + crypto): Claude around **−35%**.
- **Season 2** (ended Dec 2025): **all 8 models finished negative** (best −2.29%, worst −55.79%); only 6 of 32 sessions profitable; overtrading rampant (one model: 1,418 trades).

Sources: nof1.ai; protos.com ("LLM crypto trading contest finds LLMs can't trade crypto"); iweaver.ai/blog/alpha-arena-ai-trading-season-1-results; datawallet.com/crypto/alpha-arena-nof1-ai-explained; bitget.com/news/detail/12560605084827

**Academic corroboration:**

- **FINSABER** (KDD 2026, arxiv.org/abs/2505.07078): re-tested FinMem/FinAgent/FinCon/FinRL over **20 years, 100+ symbols** with survivorship/lookahead controls — reported LLM advantages **vanish; no statistically significant alpha (all p > 0.34)**. LLM agents are too conservative in bull markets and control risk badly in bear markets.
- **StockBench** (arxiv.org/abs/2510.02209): contamination-free live-window test — most LLM agents fail to beat a simple baseline; none beat it in downturns.
- **LiveTradeBench** (trade-bench.live): 50-day live eval of 21 LLMs — LMArena rank does not predict trading outcomes; returns roughly flat.
- **Look-Ahead-Bench** (arxiv.org/abs/2601.13770): LLMs recall in-cutoff prices verbatim → **any backtest of an LLM decision-maker over its training window is contaminated** — a new form of lookahead bias unique to LLM trading.
- **Agent Market Arena** (arxiv.org/abs/2510.11695): agent architecture (memory, risk framework) drives outcomes far more than which model backbone is used.
- Execution-realism study (arxiv.org/abs/2606.08285): most LLM-trading papers don't model fills; under realistic execution, slippage costs explode ~16x. "An LLM decision is not yet a trade."

### 2.2 Claude as code generator — the honest experiments

- **dev.to "14 Sessions, 961 Tool Calls"**: Claude Code generated a 27-file crypto bot in ~3 hours. **15 strategies backtested; 14 lost money once fees/slippage were included.** The lone survivor won by trading *least*. One showcased strategy had a 60% win rate and **net −$39.20** (inverted risk/reward).
- **gr8monk3ys/trading-bot** (the most honest README found): its strategy returned **+53% vs SPY's +95%** (2020–2024) on a bias-free test — the author's stated real value is *drawdown control, not outperformance*.
- **Jake Nesler "$100k with Claude Code, beat the market"** (Medium + Claude_Prophet repo): honest experiment, but **paper trading on Alpaca, one month** — statistically meaningless; author himself warns not to use real money.
- Community sanity check: of 12 famous strategies Claude implemented against BTC, **only 1 beat buy-and-hold**.
- **No public GitHub repo found pairs a "Claude built this" claim with reproducible, cost-adjusted, live-verified profits.**

### 2.3 The Polymarket outliers

- **sovereign2013** ("$1 → $3.3M"): the wallet's P&L is on-chain and real, but the edge is high-frequency **sports-bet arbitrage** (speed + market microstructure). "Claude-powered" is a self-reported/promoter assertion; a promotional PDF touting a "68.4% win rate" Claude trader was found to contain **fabricated screenshots** (tribuna.com, 2026-05-18). "Started from $1" is implausible for arbitrage.
- Base rate: **92.4% of Polymarket wallets lose money.** Arbitrage windows compressed from ~12.3s (2024) to ~2.7s (2026) — the edge decays fast and is capacity-constrained.
- Even if fully real: the AI wrote the plumbing; the profit comes from infrastructure speed, which cloning the code does not replicate.

---

## 3. Patterns across all claims (the anatomy of the genre)

1. **Claim size inversely correlates with evidence quality.** The +773%, "3,345% backtest", "$238k in 11 days" claims have zero methodology; the careful experiments report break-even or 1-of-15 survivors.
2. **The claim IS the product.** Nearly every big-number claimant monetizes: paid community, newsletter, YouTube funnel, course, exchange content marketing, or scam repo.
3. **Paper trading marketed with live-money framing.** The two biggest "honest" headlines (Nesler's $100k, "2.1x in 18 days") were both paper money — disclosed in the body, hidden in the headline.
4. **Bull-market beta sold as AI alpha.** The claim wave (Mar–Jul 2026) coincides with rising markets; long-biased bots "work" until the regime turns (exactly what Alpha Arena exposed).
5. **Dollar headlines, never risk metrics.** No capital base, no Sharpe, no max drawdown, no benchmark. Nobody publishes a losing-month video.
6. **Backtest mining at scale.** "Claude generated 10,123 strategies, best one +3,345%" is a pure multiple-testing exercise — with 10k draws, a monster outlier is expected by chance and near-certain to fail out-of-sample.
7. **Outright fabrication exists** — the 68.4%-win-rate PDF with fake screenshots is documented, not hypothetical.

### Facebook specifically

- The Claude Facebook groups are dominated by **questions** ("has anyone built one?"), not success claims; the few affirmative posts ("her Claude bot makes $3k/month") are unverifiable engagement-bait.
- Facebook is the **single worst venue** for this genre: FTC (Apr 2026) reports more scam losses originate on Facebook than any other platform; social-media investment scams = $1.1B in 2025 losses. The "Quantum AI" deepfake-celebrity scam template is endemic.
- **Active malware campaigns**: 30+ fake Claude/Claude Code installer pages across 88 domains delivering infostealers (Graphika, Malwarebytes); "download my Claude trading bot" GitHub links are frequently key/wallet-drainer fronts (e.g., repos impersonating nof1's Alpha Arena, keyword-stuffed "zero fees" bots). **Never run a cloned trading-bot repo without a full read; never paste API keys into one.**

---

## 4. What's actually worth implementing in ours

Ranked by strength of evidentiary support:

1. **Claude for code, not for calls.** Use Claude Code to build data pipelines, backtester, execution, monitoring — its demonstrated strength. Do **not** put an LLM in the per-trade decision loop; every rigorous test says that loses.
2. **Hard-coded risk layer outside any LLM** (direct spec from Alpha Arena's failure modes): position caps, mandatory stop-losses, max-drawdown kill switch, exposure/leverage limits, turnover caps, and a human-approval gate for anything unusual. The risk gate must be non-bypassable by the strategy layer.
3. **Model fees and slippage before anything else.** Cost modeling single-handedly killed 14/15 strategies in the best experiment and drove most Alpha Arena losses (fee churn). Prefer low-trade-frequency strategies by construction.
4. **Evaluation discipline** (this is where retail bots die):
   - Point-in-time data only; no survivorship-biased universes
   - Walk-forward / out-of-sample splits; never iterate "improve this" against one test set
   - Deflated-Sharpe-style correction for multiple testing (every strategy tried counts as a draw)
   - Always benchmark against buy-and-hold on **risk-adjusted** metrics
   - If any LLM signal is ever tested: **post-knowledge-cutoff data only** (Look-Ahead-Bench)
5. **Paper-trade first, by default.** Alpaca paper API (equities) is the sane starting stack. Promotion to live money requires a pre-defined statistical bar, not vibes.
6. **Spec-first prompting workflow:** make Claude interrogate the strategy (sizing, sessions, slippage assumptions) *before* writing code; keep persistent context in CLAUDE.md. (Consistent tip from the 900-hour/1,200-hour practitioner logs.)
7. **Adversarial review, not self-iteration:** have a second model (or a second Claude session with a skeptic prompt) attack every strategy; treat "one parameter change transformed the results" as an overfitting alarm. (Rogue Quant; multi-LLM consensus-gate pattern.)
8. **Optional patterns worth borrowing:** trade-experience memory (SQLite vector DB of past scenarios, from Claude_Prophet); Telegram/alert reporting; regime-aware volatility targeting (FINSABER's explicit recommendation).
9. **Set an honest goal.** The best-documented AI-assisted retail system underperformed SPY but cut drawdowns. **Drawdown control and process quality — not alpha — is the realistically achievable win.** If we ever chase a real edge, it will be a mechanical/structural one (and those decay and are capacity-constrained), not "the LLM predicts the market."

## 5. Useful reference repos/frameworks (vetted as non-scam, read before running)

- Lumiwealth/lumibot — backtesting/broker framework (1.8k stars)
- Trade-With-Claude/cbt-framework — Claude Code backtesting workflow
- alpacahq/alpaca-mcp-server — broker access via MCP
- JakeNesler/Claude_Prophet — memory-layer pattern reference
- FINSABER (waylonli/FINSABER) — evaluation-framework reference

**Do NOT run:** alpha-arena-nof1-ai/nof1ai-alpha-arena (impersonation), gpt-trade-bot/chatgpt-trading-agent, Cortex-AI-Network/polymarket-copy-trading-bot-* (scam pattern, key-harvesting risk).
