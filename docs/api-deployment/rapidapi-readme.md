# AI Patent Search Generator API

**US patent intelligence from USPTO public data.** Turn a patent number into a full dossier — plus a legal-intelligence layer most patent APIs don't offer: **PTAB validity challenges**, **district-court litigation history**, and a **company-litigation reverse lookup**.

## Why this API

- 🗂️ **One call, full dossier** — bibliographic data, full claims tree, citations, family, and CPC.
- ⚖️ **Legal intelligence** — answer *"Has this patent been attacked, and did it survive?"* and *"Who's been sued over it, and by whom?"*
- 🔁 **Reverse lookup** — every patent suit a company has been involved in (plaintiff or defendant).
- 🏛️ **Public-domain data** — sourced from the USPTO (Open Data Portal + Patent Litigation Dataset). US patents.

## Quick start

Subscribe to a plan, then POST a US patent number to any endpoint. RapidAPI adds your `X-RapidAPI-Key` / `X-RapidAPI-Host` headers automatically.

```bash
curl -X POST 'https://<your-rapidapi-host>/v1/challenges' \
  -H 'X-RapidAPI-Key: <YOUR_KEY>' \
  -H 'X-RapidAPI-Host: <your-rapidapi-host>' \
  -H 'Content-Type: application/json' \
  -d '{"patentNumber": "US8724622B2"}'
```

## Endpoints

### Patent
| Endpoint | What it returns | Credits |
|---|---|---|
| `POST /v1/dossier` | Full dossier — biblio, claims, citations, family, CPC | 50 |
| `POST /v1/dossier-summary` | AI executive summary + claim-scope rating | free |
| `POST /v1/claims` | Claims tree (independent + dependent) | 10 |
| `POST /v1/citations` | Backward citations (patent + NPL), examiner-flagged | free |
| `POST /v1/family` | US family / continuity (CON/DIV/CIP) | free |
| `POST /v1/examiner-stats` | Examiner, art unit, allowance rate, pendency | free |
| `POST /v1/oa-analyze` | AI Office Action analysis | 25 |

### Legal Intelligence
| Endpoint | What it returns | Credits |
|---|---|---|
| `POST /v1/challenges` | PTAB challenges (IPR/PGR/CBM): petitioner, owner, **outcome** | 35 |
| `POST /v1/litigation` | District-court infringement suits — who sued whom, court, cause | 35 |
| `POST /v1/company-litigation` | Reverse lookup — all patent suits involving a **company** | 35 |
| `POST /v1/legal-status` | In-force vs lapsed/expired + maintenance-fee history | 10 |
| `POST /v1/assignments` | Chain of title — conveyances, reel/frame, current owner | 10 |

### Enrichment
| Endpoint | What it returns | Credits |
|---|---|---|
| `POST /v1/term` | Patent Term Adjustment + adjusted expiration | 10 |
| `POST /v1/prosecution-timeline` | Full chronological USPTO event log | 10 |
| `POST /v1/attorney` | Attorneys of record (name + USPTO reg #) + docket | 10 |
| `POST /v1/entity-status` | Small / micro / large entity | 5 |
| `POST /v1/pregrant-pub` | As-filed publication (abstract + claims) | 15 |

## Example — PTAB challenges (`/v1/challenges`)

**Request**
```json
{ "patentNumber": "US8724622B2" }
```

**Response (abridged)**
```json
{
  "data": {
    "patentNumber": "US8724622B2",
    "challengeCount": 15,
    "challenges": [
      {
        "trialNumber": "IPR2019-01559",
        "type": "IPR",
        "petitioner": "Microsoft Corporation",
        "patentOwner": "Uniloc 2017 LLC",
        "status": "Institution Denied",
        "outcome": "patent_survived"
      }
    ]
  }
}
```

## Company lookup example (`/v1/company-litigation`)
```json
{ "company": "Apple", "limit": 25 }
```
Returns Apple's patent suits (as plaintiff/defendant) with the patents, opposing parties, court, and cause — plus related-entity suggestions.

## Coverage & limitations

- **US patents only.**
- **Litigation:** comprehensive for cases filed **2003–2016**, partial to 2020 — no cases after 2020. An empty result means *not litigated on record*, not an error.
- **PTAB, prosecution, ownership, and dossier data:** current.

## Billing

Each call is metered against the **`Credits`** quota; the cost is shown in every endpoint's description. **Bad input (4xx) and server failures (≥500) are not billed.**

## Notes & links

- Factual public-record data — **not legal advice.**
- MCP server (for AI agents): https://github.com/smythmyke/patent-search-mcp-server
