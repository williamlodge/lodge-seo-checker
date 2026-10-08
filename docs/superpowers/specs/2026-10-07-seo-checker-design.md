# SEO Checker Webapp — Design Spec

**Date:** 2026-10-07
**Status:** Draft for review
**Owner:** William Lodge / Arcadia Web Solutions

## 1. Purpose

A free SEO site-audit tool hosted on the Arcadia web properties that acts as a
lead magnet: a visitor enters a domain, the tool crawls and audits it, and
produces a **prioritized, evidence-backed findings report**. The full report is
gated behind an email capture. Every lead is stored for Arcadia follow-up.

Core product principle (from the product brief): **no vague "SEO score."** The
primary output is a prioritized task list — "Fix 12 accidentally non-indexable
product pages — high impact, low effort" — where every number traces back to
concrete, verifiable findings.

## 2. Goals / Non-goals

### Goals (v1)

- Crawl a visitor-submitted site (respecting robots.txt) with configurable
  page limit, depth, and politeness/Speed.
- Detect indexability problems, on-page SEO issues, and basic technical
  quality problems (check catalog below).
- Produce findings with: severity, affected URLs, why it matters, exact
  evidence, a clear fix with an example, estimated impact and effort.
- Email-gated full report; teaser results before the gate.
- Persist every scan and its findings in a **paid-tier-ready data model**
  (per-domain scan history addressable over time).
- Deploy as a pm2 Node service on the existing VPS (187.124.235.228),
  proxied from the Arcadia site.

### Non-goals (v1 — deliberately deferred)

- User accounts, billing, Stripe
- Scheduled/recurring scans and alerts
- Google Search Console / Bing integrations, keyword data
- Log-file analysis, competitor comparison, backlink monitoring
- JS-rendering comparison (headless browser crawling) — v1 crawls raw HTML
- PDF export / white-label reports
- Public API
- Core Web Vitals field data / CrUX (Lighthouse lab runs may be a later add)

These are phase 2/3 candidates; the data model must not preclude them.

## 3. Architecture

Fresh Node.js service (Node 18+), matching the stack of the other pm2 apps.

```
Browser
  │
  ▼
LiteSpeed vhost (arcadiawebsolutions.com/audit/* or subdomain)
  │  reverse proxy
  ▼
Node service (Express)  ──►  SQLite DB (scans, findings, leads)
  │
  ├─ POST /api/scan            → create scan job (validate URL, enqueue)
  ├─ GET  /api/scan/:id        → poll status (queued/crawling/analyzing/done)
  ├─ POST /api/report/unlock   → email capture → returns full report
  └─ GET  /api/report/:id      → report data (teaser fields w/o unlock)
  │
  ├─ Crawler module            → fetch queue, robots.txt, redirect chains,
  │                              link extraction, sitemap fetch
  └─ Analyzer module           → pure functions: page data → findings
```

**Why SQLite:** zero-ops on the existing VPS, adequate for this write volume,
trivially backed up (single file), and fully capable of the scan-history
queries needed for phase 2. The VPS already runs a Postgres container, but
introducing it here adds coupling for no v1 benefit.

**Why raw HTML, no headless browser in v1:** keeps resource usage predictable
on a shared VPS (this tool will crawl *other people's sites* on request).
JS-render comparison is a phase 2+ feature with its own resource budget.

### Process flow

1. Visitor submits a URL. Server normalizes it, fetches robots.txt, and
   creates a `scan` row (status `queued`).
2. An in-process job runner (simple async queue, max 1–2 concurrent scans,
   per-scan page cap of **100 pages / max 3-minute crawl budget** in v1)
   crawls: homepage first, BFS by click depth, same-origin only, respecting
   robots.txt disallow rules and a 1 req/2s per-host politeness floor
   (configurable).
3. Each fetched page is parsed (cheerio) into a normalized `page_record`
   (status, redirects, title, meta, headings, canonical, robots meta,
   links in/out, images/alts, word count, lang/hreflang, schema presence).
4. The analyzer runs pure check functions over the page set + sitemap +
   robots data, emitting findings.
5. The prioritizer scores findings (impact × effort) and the report renders.

## 4. Check catalog (v1)

Grouped by Google's crawl/index/serve framing, per the product brief.

### Indexability (highest severity ceiling)
| ID | Check | Severity range |
|----|-------|----------------|
| IDX-1 | robots.txt-disallowed URLs that are also in the sitemap | error |
| IDX-2 | `noindex` meta / X-Robots-Tag on indexable-intent pages | error |
| IDX-3 | Missing canonical; conflicting/differing canonicals across duplicates | error/warning |
| IDX-4 | Redirect chains (3+ hops) and loops | warning |
| IDX-5 | URLs in sitemap that 404/redirect/not in crawl (sitemap hygiene) | warning |
| IDX-6 | Orphan pages: in sitemap but zero internal inlinks found | warning |
| IDX-7 | Pages requiring auth (401/403) linked in nav | warning |

### On-page SEO
| ID | Check | Severity |
|----|-------|----------|
| ON-1 | Missing title | error |
| ON-2 | Duplicate titles | warning |
| ON-3 | Title too short (<30 chars) / too long (>60) | opportunity |
| ON-4 | Missing / duplicate / off-length meta descriptions | opportunity |
| ON-5 | Missing or multiple H1; heading-order skips | warning |
| ON-6 | Thin content (<150 words on indexable text pages) | opportunity |
| ON-7 | Near-duplicate content (Simhash over page text, same shingles) | warning |
| ON-8 | Images missing alt text | opportunity |
| ON-9 | Non-descriptive URLs (>3 levels deep, uppercase, long query strings) | opportunity |
| ON-10 | Internal links to redirects or 4xx (broken links) | error |
| ON-11 | `lang` missing; hreflang without reciprocal | warning |

### Technical quality
| ID | Check | Severity |
|----|-------|----------|
| TQ-1 | No HTTPS / mixed content on HTTPS pages | error |
| TQ-2 | Missing security headers baseline report (informational only) | opportunity |
| TQ-3 | Oversized images (>500 KB) / pages > 3 MB HTML weight | warning |
| TQ-4 | viewport meta missing (mobile-unfriendly marker) | warning |
| TQ-5 | robots.txt missing or returning error status | warning |
| TQ-6 | Sitemap missing / malformed / not referenced in robots.txt | warning |
| TQ-7 | JSON-LD structured data present but invalid JSON | warning |
| TQ-8 | **robots.txt blocks AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) — GEO alert** | opportunity |

TQ-8 is a deliberate differentiator: a "GEO readiness" signal no commodity
checker surfaces.

## 5. Finding & report model

```ts
Finding {
  checkId: string;            // "IDX-2"
  severity: "error" | "warning" | "opportunity";
  title: string;              // human summary, count embedded when useful
  why: string;                // why it matters
  evidence: string[];         // exact observed data (URL, excerpt, values)
  fix: string;                // concrete instruction + example
  impact: 1|2|3;              // estimated (heuristics per check, see below)
  effort: 1|2|3;
  affectedUrls: string[];     // capped at 50 per finding in UI, count shown
}
```

**Impact heuristics (v1, documented in-code so they're auditable):**
indexability errors = impact 3; warnings on >10% of pages bump +1; thin
content/opportunities default impact 1. Effort: per-check constants (e.g.
adding meta descriptions = 2, fixing canonical conflicts = 3). The report's
top line is a **task list sorted by impact desc, effort asc**, with a small
"site health" roll-up (counts by severity, trend vs. previous scan when one
exists — phase 2 UI shows new/resolved/regressed).

**Teaser vs. full:** before email unlock, the visitor sees severity counts,
the top 3 task-list items (evidence truncated), and a blurred/locked
remainder. After unlock, the full report with filters (severity, category,
URL search) is shown. Reports remain accessible afterward via a signed
share URL (token, no account needed).

## 6. Data model (paid-tier-ready)

```sql
domains(id, host, first_seen, last_scanned)
scans(id, domain_id, requested_url, status, started_at, finished_at,
      pages_crawled, pages_discovered, crawl_limit_hit, options_json,
      share_token, unlocked_at, created_via)
pages(id, scan_id, url, status_code, redirect_chain_json, depth,
      title, meta_desc, canonical, robots_meta, h1_count, word_count,
      lang, hreflang_json, simhash, links_out_json, images_missing_alt,
      bytes_html, fetched_at)
findings(id, scan_id, check_id, severity, payload_json, impact, effort)
leads(id, scan_id, email, domain_id, created_at, source, ip_hash)
```

Rationale: scans hang off `domains`, so "rescan this domain and diff" and
"scheduled scans per account" (phase 2/3) are additive columns/tables, not
migrations of shape. Phase 2's new/resolved/regressed is computed by
diffing `findings` between consecutive `scans` of a domain.

## 7. Crawler details & abuse control

- URL normalization (strip fragments, default ports; case-insensitive host).
- Same-host only (subdomains excluded in v1), max depth 5, max 100 pages.
- robots.txt parsed and honored for our UA string; crawl-delay respected.
- Per-scan timeout 3 min hard; per-request timeout 10 s; redirects followed
  max 5 (chain recorded).
- **Abuse controls (public tool):** per-IP rate limit (3 scans/hour),
  optional CAPTCHA hook, a denylist for the user's own hosted domains
  (don't let the tool be used to hammer our own box), and a global
  concurrent-scan cap of 2. Email gate sits *after* the scan, not before —
  the crawl itself is the value delivery.
- User-Agent identifies the tool: `Mozilla/5.0 (compatible; ArcadiaAudit/1.0; +https://arcadiawebsolutions.com/audit/bot)`.

## 8. Frontend & branding

- Server-served single-page app (no build step preferred: plain ES modules +
  a small reactive helper, or Preact via CDN). Terminal aesthetic matching
  the existing Arcadia design system.
- Screens: landing → scan progress (live page count, crawl stats) → teaser
  report → email gate → full report (filterable task list) → per-finding
  detail with evidence and fix.
- Every weak category ends with an Arcadia CTA: "Want this fixed?
  Arcadia handles it — book a call."
- Footer credits methodology transparency note: what we check, what we
  don't (no CrUX, no link data).

## 9. Deployment

- Code lives at `/home/admin/projects/seo-checker` on the VPS (fresh git
  repo, deployed via the existing `arcadia_vps` deploy key flow).
- pm2 process name: `seo-checker` (port 127.0.0.1:53xx, next free).
- LiteSpeed reverse-proxy context on the Arcadia vhost at `/audit` (or a
  subdomain if preferred) — decision needed at implementation time.
- SQLite file + backups: nightly `sqlite3 .backup` to the existing backup
  rotation; DB and leads are the critical data.

## 10. Testing

- **Analyzer:** unit tests (vitest) for every check function with fixture
  HTML/JSON — this is where correctness lives; every check has fixtures for
  pass/fail/edge cases.
- **Crawler:** integration test against a local fixture site (a static
  directory served by the test runner) covering robots disallow, redirect
  chains, depth caps, and page limits.
- **Prioritizer/report:** snapshot tests of finding ordering and teaser
  truncation.
- A smoke script: scan a real low-stakes domain from staging before deploy.

## 11. Phases

- **Phase 1 (this spec):** everything above. Free tool, email gate, no
  accounts.
- **Phase 2:** scan history UI (new/resolved/regressed), PDF export,
  multiple scans per domain, optional Lighthouse lab runs for performance
  numbers.
- **Phase 3:** accounts + Stripe, scheduled scans + email alerts, GSC
  integration, higher page caps as paid limits.
- Trigger to build phase 2/3: returning visitors / inbound "can it re-check
  monthly?" requests.

## 12. Open questions

1. Hosting path: `arcadiawebsolutions.com/audit/` subdirectory vs. a
   subdomain (e.g. `seo.arcadiawebsolutions.com`). Subdirectory is better
   for the domain's own SEO; subdomain is cleaner for proxying. → decide at
   implementation.
2. Where do leads go beyond the DB — email notification to the owner on
   each unlock? (Assumed yes, via the existing mail path on the VPS.)
3. Product name — placeholder "Arcadia Site Audit" pending decision.
