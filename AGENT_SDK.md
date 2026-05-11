# Claude Agent SDK — Opportunities for Bull-Generator (Patent Boolean Search)

## Where you are today

- Chrome extension generating Boolean search queries for patent search systems
- Input: natural language → Output: Boolean query with wildcards, synonyms, Porter stemming, field selection, broad/moderate/narrow modes
- Stack: React + TypeScript + Firebase + Stripe + Cloud Functions (per MarkItUp's QUICKSTART citing Bull-Generator as reference)
- Target: patent examiners, patent attorneys, patent searchers, prior art researchers, R&D IP teams

**Why this is your most defensible opportunity of the four products.** Patent professionals bill $200–600/hour. A tool that saves them 2 hours of search iteration is worth $400 to them. Digital product sellers on Etsy will haggle over $4.99.

## Where single-shot hits its ceiling

Today you generate a query. The user runs it themselves on USPTO/EPO/Google Patents/PatFT. They look through results, decide what's relevant, refine, re-run. That iteration is where the time goes.

An agent can close the loop: generate → search → read results → refine → report.

## Four agents to consider (highest-leverage opportunity of all four products)

### 1. Prior Art Hunter Agent (build first — $29–99 per run, or credit-based)

**Flow:** User describes an invention → agent:
1. Uses your existing Boolean generator to produce 3 queries: broad, moderate, narrow
2. Runs each against Google Patents public search (WebSearch + WebFetch of results pages)
3. Reads the top 20 hits across the three queries
4. Deduplicates and ranks by relevance to the invention description
5. For each top 10: extracts title, publication number, abstract, key claims, filing date, assignee
6. Writes a prior art report: "here are the 10 closest prior art references, here's how they relate, here are the gaps"

**Price:** $29 per run for a short report, $99 for a detailed analysis with claim-by-claim relevance scoring.

**Why this works:** this is what patent search firms charge $500–2000 for. You're not replacing them — you're giving solo inventors + small firms a "pre-search" that tells them if it's worth paying for a pro search.

### 2. Claim Analyzer Agent ($49 per application)

**Flow:** User uploads a patent application draft or issued patent → agent:
1. Extracts each independent claim
2. For each claim, generates Boolean queries targeting the claim's elements
3. Searches prior art
4. Assesses: is this claim novel? What's the closest reference? What element would need to change?
5. Outputs claim-by-claim analysis with suggested rewording for weak claims

**Why this works:** solo inventors prosecuting their own applications need this desperately. Patent attorneys charge $500/hour for this kind of review.

### 3. Freedom-to-Operate (FTO) Agent ($99–299 per product)

**Flow:** User describes a product they want to sell → agent:
1. Identifies key product features
2. Generates Boolean queries for each feature
3. Searches active (unexpired) patents only
4. For each hit, assesses infringement risk: high/medium/low
5. Outputs FTO report with risk matrix

**Why this works:** FTO analyses from law firms run $5K–50K. Your $299 version is a pre-screen that tells a founder if they need to pay for the real thing.

**Caveat:** aggressively disclaim this is NOT legal advice. Mark every output "for initial screening only — consult a registered patent attorney before acting."

### 4. Technology Landscape Agent ($199 per report)

**Flow:** User names a technology area ("solid-state batteries for wearables") → agent:
1. Generates a family of Boolean queries covering the area
2. Runs searches, aggregates results
3. Identifies: top assignees (who owns the IP), filing trends (is filing accelerating?), key inventors, white space (unfiled subareas)
4. Outputs executive-level landscape report

**Why this works:** R&D teams and VCs pay $10K–50K for these reports from specialty firms. Your $199 version is a screening tool for VCs evaluating deeptech companies.

## Why your target market changes the math

The other three products (BulkListingPro, JackpotKeywords, MarkItUp) sell to price-sensitive solo operators. **Bull-Generator sells to knowledge workers with billable hours.** That shifts everything:

| | Etsy sellers | Patent professionals |
|---|---|---|
| Willingness to pay per action | $0.50–$5 | $30–$300 |
| Time value | High sensitivity | Extreme sensitivity |
| Trust threshold | "Good enough" | Citations required |
| Churn | High | Very low (once in workflow) |
| LTV | $20–$200 | $1000–$10000+ |

This is the product where an Agent SDK investment pays back the fastest.

## Architecture integration

You have the pieces (Firebase/Stripe/Cloud Functions per references). The key new capabilities:

1. **Custom MCP tool: your existing Boolean generator** — expose `generate_boolean_query(description, mode, system)` so the agent can call your proprietary logic
2. **Custom MCP tool: patent search** — wrap Google Patents API or public search endpoints for USPTO/EPO/WIPO
3. **Optional: PDF parser** — for the Claim Analyzer, parse uploaded patent PDFs

Directory structure (suggested):
```
extension-src/               # existing React extension
functions/
  api/                       # existing endpoints
  agents/                    # NEW
    priorArtHunter.ts
    claimAnalyzer.ts
    fto.ts
    landscape.ts
  tools/                     # NEW MCP tools
    booleanGenerator.ts      # wraps your existing logic
    patentSearch.ts          # Google Patents / public PAIR
    parsePatentPdf.ts
```

## Starter code (Prior Art Hunter)

```typescript
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { generateSearch } from "../extension-src/src/components/booleanSearchUtils";
import { searchGooglePatents } from "./tools/patentSearch";

const patentTools = createSdkMcpServer({
  name: "patents",
  version: "1.0.0",
  tools: [
    tool(
      "generate_boolean_query",
      "Generate an optimized Boolean patent search query. Mode controls specificity.",
      {
        description: z.string(),
        mode: z.enum(["broad", "moderate", "narrow"]),
        system: z.enum(["uspto", "epo", "google_patents"])
      },
      async ({ description, mode, system }) => {
        const query = await generateSearch(description, mode, system);
        return { content: [{ type: "text", text: query }] };
      }
    ),
    tool(
      "search_patents",
      "Run a Boolean query against Google Patents. Returns top 20 results with title, number, abstract, filing date, assignee.",
      { query: z.string(), limit: z.number().default(20) },
      async ({ query, limit }) => {
        const results = await searchGooglePatents(query, limit);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      }
    )
  ]
});

export const priorArtHunt = async (userId, inventionDescription) => {
  const result = query({
    prompt: `A user is doing a prior art search for this invention:

    "${inventionDescription}"

    Your job:
    1. Use generate_boolean_query three times: mode=broad, moderate, narrow, system=google_patents
    2. For each query, use search_patents (limit=20)
    3. Deduplicate results across the three queries by publication number
    4. Rank the top 15 by relevance to the invention (judge on abstract + title match)
    5. For the top 10, WebFetch the Google Patents page to extract independent claim 1
    6. Write /tmp/prior-art-{userId}.md with:
       - Executive summary (is the invention likely novel? key risks)
       - For each of 10 top references: citation, relevance score 1-10, why it's relevant, differentiating feature of the user's invention
       - Gaps: what design space appears unexplored?

    Every claim of relevance MUST cite the publication number. Never invent a reference.`,
    options: {
      allowedTools: [
        "WebFetch", "Write",
        "mcp__patents__generate_boolean_query",
        "mcp__patents__search_patents"
      ],
      mcpServers: { patents: patentTools },
      permissionMode: "acceptEdits",
      maxTurns: 50
    }
  });

  for await (const msg of result) {
    await streamToUser(userId, msg);
  }
};
```

## Pricing math

Prior Art Hunter per run:
- 3 Boolean generator calls (negligible — local logic)
- 3 patent searches (~$0.01–0.05 depending on API)
- 10 WebFetches of patent pages (~50K tokens = $0.75)
- Output generation (~20K tokens = $0.30)
- Reasoning through relevance scoring (Opus-grade work, ~30K tokens = $2.25)
- **Total: ~$3.50 per run**

At $29 per run, 88% margin. At $99 for detailed analysis, 96% margin.

## Risks specific to patent domain

1. **Accuracy is existential** — one hallucinated reference destroys user trust. Pin every output to real publication numbers. Add a verification step: "for each cited publication, WebFetch to confirm it exists before including."
2. **Legal disclaimer** — every output must state "not legal advice, consult registered patent counsel." Don't skip this.
3. **Google Patents ToS** — public search is scrape-friendly, but at volume you may need a commercial API (Google Patents BigQuery dataset, PatSnap, or LexisNexis TotalPatent). Budget for this.
4. **Claim interpretation is hard** — prose claim analysis by an LLM is a different animal from query generation. Start with the Prior Art Hunter (easier) and only build Claim Analyzer after you've proven quality.
5. **USPTO has its own rules** — if targeting examiners, their workflow is specific. Talk to 3 before building.

## First concrete step

1. **Don't build anything yet.** Email 5 patent professionals (attorneys, searchers, solo inventors you can find on LinkedIn) and ask:
   - "If a tool ran a pre-search for your invention and returned 10 ranked prior art references in 10 minutes for $29, would you use it?"
   - "What would break your trust?"
2. If yes to 3 of 5 → build Prior Art Hunter as a CLI script first. Run on 5 real invention descriptions. Have a human expert review quality.
3. If the outputs pass expert review → productionize and put up a landing page. Pre-sell 10 runs at $29 each before writing UI code.
4. If they don't pass review → fix the prompt, add more verification steps, repeat.

**Don't skip user interviews for this product.** The buyer is too sophisticated and the stakes too high to guess.

## Why this might be the highest-leverage pivot across your portfolio

You built Bull-Generator as a utility. Nov 2024 privacy policy date suggests it's been live for ~18 months. If it has active users but low revenue, that's a **pricing/packaging problem, not a product problem**. An agent layer converts the utility into a research workflow and the per-transaction price jumps 20–100x.

Rank-order priority across your 4 products based on this review:
1. **Bull-Generator** — highest per-transaction price ceiling, sophisticated buyer
2. **BulkListingPro** — existing paying users, proven credit model, fastest to ship
3. **JackpotKeywords** — clear upsell path ($9.99 → $29), existing infra
4. **MarkItUp** — still needs base product built before agents make sense

## Related research

- `C:\Projects\ideas\claude-code-research\agent-sdk.md` — full SDK deep dive
- https://code.claude.com/docs/en/agent-sdk/mcp — custom MCP tools (how to wrap your Boolean generator)
- https://patents.google.com/?xl — Google Patents (public search)
- https://www.uspto.gov/patents/search — USPTO Patent Public Search
- https://github.com/anthropics/claude-agent-sdk-demos
