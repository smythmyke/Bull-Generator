# Workflows Tab — Unbuilt Agents: Ranking & Sequencing

> **Date:** 2026-06-03
> **Scope:** The four un-built Workflows-tab agents — Prior Art Hunter (W1), Claim Analyzer (W2), Freedom-to-Operate (W3/FTO), Technology Landscape (W4).
> **Companion docs:** `research/fto-build-plan.md` (full 6-stage FTO spec), `~/.claude/.../memory/research_w1_prior_art_hunter.md` (W1 cost analysis), `ROADMAP.md`.
> **Status of the tab:** Patent Risk Profile (DD-1) is LIVE (synchronous, ~8s). These four are not built.

---

## Infra context that shapes every ranking

1. **Full-tab workflow report viewer already exists** (`report.html` / `WorkflowReportPage.tsx`), built for the Risk Profile. But Risk Profile runs **synchronously (~8s)** — none of these four can.
2. **Shared async-job tax:** Firestore job doc + progress streaming + minutes-long runtime. The *first* of these four to ship pays it; the rest inherit it cheaply.
3. **Big fork in approach:**
   - **FTO, Claim Analyzer, Landscape = deterministic Gemini pipelines** (predictable cost).
   - **Prior Art Hunter = Claude Agent SDK loop** (Opus + MCP tool wrappers + variable per-run cost) — a separate infra + margin problem nothing else needs.
4. **New reusable assets since the plans were written:** the `legal-bundle` aggregator (active-status / litigation / challenges) and the §12 Claim Chart element decomposition — both directly reusable by FTO and Claim Analyzer.

---

## Sort 1 — Difficulty to build (easiest → hardest)

| Rank | Feature | Why |
|---|---|---|
| 1 (easiest) | **Technology Landscape** | No claim-level analysis, no citation verification, no legal-advice exposure. Search → aggregate assignees/dates/CPC → chart + light AI for white-space. **Ceiling = data, not AI:** a credible landscape needs hundreds of patents; BigQuery is banned + Google Patents rate-limits at scale. |
| 2 | **Claim Analyzer** | Reuses §12 Claim Chart decomposition. Single-application scope; rewording is pure LLM. Hard part: recall-sensitive prior-art retrieval to ground the novelty call. |
| 3 | **Freedom-to-Operate** | Fully specced (6-stage Gemini pipeline); now reuses legal-bundle (active-status) + Claim Chart (element grounding). But recall-critical, verification stage, jurisdiction separation, 4–15 min runs. Biggest deterministic build. |
| 4 (hardest) | **Prior Art Hunter** | Agent loop (Agent SDK, Opus, MCP tools) + the only **variable per-run cost** ($7–15 realistic vs $3.50 happy-path) → needs concurrency caps, spend ceilings, caching, refund policy. Internally **deferred to last**. |

## Sort 2 — Value to the patent professional (highest → lowest)

| Rank | Feature | Why |
|---|---|---|
| 1 | **Prior Art Hunter** | Most universal, highest-frequency task — every application + every invalidity matter needs it. Core daily wheelhouse. |
| 2 | **Freedom-to-Operate** | Highest dollar stakes (firms bill $5K–50K/opinion), but periodic and buyer skews product/founder/R&D, not the prosecutor. |
| 3 | **Claim Analyzer** | Directly useful in drafting/amendment — high value, narrower (per-application, prosecution-phase). |
| 4 | **Technology Landscape** | Real but strategic/occasional; usually owned by IP-strategy/in-house analysts, not the prosecuting attorney. |

## Sort 3 — Competitor value (how monetized / popular)

| Rank | Feature | Market signal |
|---|---|---|
| 1 (tie) | **Claim Analyzer** | Hottest, best-funded patent-AI category — DeepIP, Solve Intelligence, Henry AI, Rowan, Edge. Strong WTP validation. |
| 1 (tie) | **Prior Art Hunter** | The other hot category — Patlytics, IPRally, PatSnap (Eureka/Hero AI), Amplified, Lens, Questel. Heavily marketed, premium-priced. |
| 3 | **Freedom-to-Operate** | Validated + lucrative (PatSnap/Questel/Clarivate modules; firm opinions $5K–50K); AI pure-plays still emerging. Less crowded. |
| 4 | **Technology Landscape** | Mature, well-monetized, but **dominated by data-moated incumbents** (PatSnap built its business here; Innography, Derwent). Hardest to differentiate without their dataset. |

> **Sort 3 caveat:** competitor names/tiers are solid from general 2024–26 knowledge; exact current price points are NOT verified. Run a deep-research pass for cited numbers before pricing.

---

## Synthesis — sequencing decision

The sorts disagree productively: **market wants** Prior Art Hunter + Claim Analyzer (Sorts 2 & 3); **build-readiness/safety points** at FTO + Landscape (Sort 1).

**Adopted sequence: FTO → Claim Analyzer → (Prior Art Hunter | Landscape).**
- **FTO first:** only finished build plan; reuses two assets that post-date the plan (legal-bundle + claim chart); pays the shared async-job tax; Gemini-cost-predictable (no Agent-SDK margin gamble); strongest price anchor.
- **Claim Analyzer fast-follow:** most reuse (§12), hottest funded category, best "we do prosecution, not just search" wedge.
- **Prior Art Hunter last** (per existing decision) — validate WTP + lock cost controls first.
- This order also climbs the infra ladder correctly: async pipeline before agent loop.

---

## Decisions layered on top (2026-06-03)

### D1 — Technology Landscape ships FREE
Offer Technology Landscape as a **free** feature.
- **Rationale (legal):** Landscape produces *descriptive analytics* (assignees, filing trends, white-space) — **not a legal conclusion**. It carries none of the unauthorized-practice-of-law / "is this legal advice?" liability that gates FTO, Claim Analyzer, and Prior Art Hunter (all of which assert quasi-legal conclusions: "free to operate," "novel," "this is prior art"). Offering it free further removes any "paid legal work-product" liability surface.
- **Strategic upside:** free + low-liability = ideal **top-of-funnel acquisition** feature; descriptive output also sidesteps the disclaimer-heavy framing the paid agents need.
- **Open question:** the data-volume ceiling (no BigQuery, Google Patents rate limits) still bounds how deep a free Landscape can credibly go — scope the MVP to what the GP XHR endpoint can sustain.
