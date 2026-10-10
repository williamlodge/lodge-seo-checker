# Lodge SEO Checker

A self-hosted SEO site-audit tool built for the AI-search era. A visitor
enters a domain, the server crawls it politely, and the tool returns a
**prioritized, evidence-backed task list** — not a vague "SEO score."

Live example: [arcadiawebsolutions.com/audit](https://arcadiawebsolutions.com/audit/)

## Why another SEO checker

- **Prioritized tasks, not scores.** Every finding includes severity, affected
  URLs, why it matters, the exact evidence observed, a concrete fix with an
  example, and estimated impact/effort. Every number traces to something
  verifiable.
- **GEO checks built in.** It flags when `robots.txt` blocks AI crawlers
  (GPTBot, ClaudeBot, PerplexityBot, CCBot) — a signal commodity checkers
  don't surface.
- **Open methodology.** The full check catalog lives in this repo
  ([spec](docs/superpowers/specs/2026-10-07-seo-checker-design.md)). Nothing
  is a black box.
- **Email-gated reports.** Designed as a lead magnet for agencies: teaser
  results are free, the full report unlocks with an email that lands in your
  SQLite `leads` table.

## What it checks (26 checks, 3 categories)

| Category | Examples |
|---|---|
| **Indexability** (IDX-1..7) | robots/sitemap conflicts, `noindex` accidents, conflicting canonicals, redirect chains, orphan pages, auth-walled links |
| **On-page** (ON-1..11) | missing/duplicate/length titles & metas, heading structure, thin content, near-duplicates (Simhash), image alt text, broken internal links, hreflang |
| **Technical** (TQ-1..8) | HTTPS & mixed content, sitemap health, oversized pages/images, viewport, invalid JSON-LD, **AI-crawler blocking (GEO alert)** |

## Stack

Node 18+ · Express · better-sqlite3 · cheerio · vanilla-ESM Preact frontend
(no build step) · vitest (124 tests)

## Run it

```bash
npm ci
npm test
BASE_PATH= PORT=5310 npm start          # serves at http://127.0.0.1:5310/
BASE_PATH=/audit PORT=5310 npm start    # serves under a subdirectory
```

Database file defaults to `data/seo-checker.db` (override with
`SEOCHECKER_DB`). Leads are stored in the `leads` table — back it up.

## Deployment notes

- Crawler is polite by design: robots.txt respected (including crawl-delay),
  max 100 pages, depth 5, 1 request/2s per host, 3-minute scan deadline,
  10s per-request timeout.
- Abuse controls: 3 scans/hour/IP, 2 concurrent scans, DNS-level SSRF guard
  (rejects private/loopback/link-local targets on every fetch path, including
  redirect hops and sitemaps).
- See [deploy/README.md](deploy/README.md) for the OpenLiteSpeed/DirectAdmin
  reverse-proxy setup used in production.

## Design documents

- [Design spec](docs/superpowers/specs/2026-10-07-seo-checker-design.md) — full
  check catalog with thresholds, scoring model, data model
- [Implementation plan](docs/superpowers/plans/2026-10-07-seo-checker-v1.md)

## License

MIT — see [LICENSE](LICENSE). Deploy it for your own agency; the
differentiation is your fix-the-findings service, not the code.

---

By [William Lodge](https://williamlodge.com) / [Arcadia Web Solutions](https://arcadiawebsolutions.com)
