import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db/index.js';
import { isPublicHttpUrl, normalizeUrl } from './lib/normalize.js';
import { rateLimit, ipHash } from './lib/rateLimit.js';
import { checkUrlHost } from './lib/safeFetch.js';
import { crawl as defaultCrawl } from './crawler/crawl.js';
import { runIndexabilityChecks } from './checks/indexability.js';
import { runOnPageChecks } from './checks/onpage.js';
import { runTechnicalChecks } from './checks/technical.js';
import { buildReport } from './report/build.js';
import { SCAN_RATE_PER_HOUR, MAX_CONCURRENT_SCANS } from './config.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pageRow(p) {
  return {
    url: p.url,
    status_code: p.statusCode,
    redirect_chain: p.redirectChain,
    depth: p.depth,
    title: p.title,
    meta_desc: p.metaDesc,
    canonical: p.canonical,
    robots_meta: p.robotsMeta,
    h1_count: p.h1Count,
    word_count: p.wordCount,
    lang: p.lang,
    hreflang: p.hreflang,
    simhash: p.simhash,
    links_out: p.linksOut,
    images_missing_alt: p.imagesMissingAlt,
    bytes_html: p.bytesHtml,
  };
}

async function defaultImageSampler(pages, { allowPrivate = false } = {}) {
  // HEAD-sample up to 30 unique image URLs; record those over 500 KB per page
  const perPage = new Map();
  const seen = new Set();
  const todo = [];
  for (const p of pages) {
    for (const src of p.imageSrcs ?? []) {
      if (!seen.has(src) && todo.length < 30) { seen.add(src); todo.push(src); }
    }
  }
  const big = new Set();
  await Promise.all(todo.map(async (src) => {
    try {
      if (!allowPrivate && !(await checkUrlHost(src))) return;
      const res = await fetch(src, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > 500 * 1024) big.add(src);
    } catch { /* ignore */ }
  }));
  for (const p of pages) {
    const bigs = (p.imageSrcs ?? []).filter((s) => big.has(s));
    if (bigs.length) perPage.set(p.url, bigs);
  }
  return perPage;
}

function defaultNotify(lead) {
  // Replaced by SMTP path when env is configured; log otherwise.
  console.log('[lead] scan', lead.scanId);
}

export function createApp(opts = {}) {
  const {
    dbPath = process.env.SEOCHECKER_DB ?? join(process.cwd(), 'data', 'seo-checker.db'),
    crawlImpl = defaultCrawl,
    imageSampler = defaultImageSampler,
    notify = defaultNotify,
    allowPrivate = false,
    hostValidator = checkUrlHost,
  } = opts;
  // thread the private-host bypass into every outbound path

  const db = openDb(dbPath);
  const app = express();
  const base = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
  app.set('trust proxy', 1); // loopback LiteSpeed reverse proxy
  app.use(express.json());

  const router = express.Router();

  // ---- scan queue: max N concurrent, overflow waits (still accepted 202) ----
  let running = 0;
  const waiting = [];
  function acquireSlot(run) {
    return new Promise((resolve) => {
      const job = { run, resolve };
      if (running < MAX_CONCURRENT_SCANS) { running++; resolve(); }
      else waiting.push(job);
    });
  }
  function releaseSlot() {
    const next = waiting.shift();
    if (next) next.resolve();
    else running = Math.max(0, running - 1);
  }

  async function runScan(scanId, url) {
    await acquireSlot();
    try {
      db.updateScanStatus(scanId, { status: 'crawling', started_at: new Date().toISOString() });
      const result = await crawlImpl(url, {
        allowPrivate,
        onProgress: (crawled, queued) => {
          db.updateScanStatus(scanId, { pages_crawled: crawled, pages_discovered: crawled + queued });
        },
      });
      db.updateScanStatus(scanId, { status: 'analyzing' });

      const bigImages = await imageSampler(result.pages, { allowPrivate });
      for (const p of result.pages) {
        const srcs = bigImages.get(p.url) ?? [];
        p.bigImageSrcs = srcs;
        p.largeImages = srcs.length;
      }

      const findings = [
        ...runIndexabilityChecks(result),
        ...runOnPageChecks(result),
        ...runTechnicalChecks(result, result.robotsRaw ?? {}),
      ];
      db.insertPages(scanId, result.pages.map(pageRow));
      db.insertFindings(scanId, findings);
      db.updateScanStatus(scanId, {
        status: 'done',
        finished_at: new Date().toISOString(),
        pages_crawled: result.pages.length,
        crawl_limit_hit: result.crawlLimitHit ? 1 : 0,
      });
    } catch (err) {
      db.updateScanStatus(scanId, { status: 'error', finished_at: new Date().toISOString() });
      console.error('[scan error]', scanId, err);
    } finally {
      releaseSlot();
    }
  }

  const scanLimiter = rateLimit({
    windowMs: 3600_000,
    max: SCAN_RATE_PER_HOUR,
    keyFn: (req) => `scan:${ipHash(req)}`,
  });

  router.post('/api/scan', async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!isPublicHttpUrl(url) && !(allowPrivate && /^https?:\/\//.test(url))) {
      return res.status(400).json({ error: 'Provide a valid public http(s) URL' });
    }
    const norm = normalizeUrl(url);
    if (!allowPrivate && !(await hostValidator(norm.href))) {
      return res.status(400).json({ error: 'This host cannot be scanned' });
    }
    const rl = scanLimiter.check(req);
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded — try again later' });
    if (waiting.length >= 10) return res.status(503).json({ error: 'Audit queue is full — try again later' });
    rl.record();
    const d = db.upsertDomain(norm.host);
    const scan = db.createScan({ domainId: d.id, requestedUrl: norm.href, options: {} });
    runScan(scan.id, norm.href); // async, does not block response
    res.status(202).json({ id: scan.id, token: scan.share_token });
  });

  router.get('/api/scan/:id', (req, res) => {
    const s = db.getScan(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Scan not found' });
    res.json({
      id: s.id, status: s.status,
      pages_crawled: s.pages_crawled, pages_discovered: s.pages_discovered,
      crawl_limit_hit: !!s.crawl_limit_hit,
    });
  });

  function reportPayload(token) {
    const s = db.getReportByToken(token);
    if (!s) return null;
    const rawFindings = db.getFindings(s.id);
    const findings = rawFindings.map((f) => ({
      checkId: f.check_id, severity: f.severity, ...f.payload,
      impact: f.impact, effort: f.effort,
    }));
    const report = buildReport(findings, { unlocked: !!s.unlocked_at, totalPages: s.pages_crawled });
    return { scan: s, report };
  }

  router.get('/api/report/:token', (req, res) => {
    const p = reportPayload(req.params.token);
    if (!p) return res.status(404).json({ error: 'Report not found' });
    const { scan, report } = p;
    res.json({
      unlocked: !!scan.unlocked_at,
      health: report.health,
      teaser: report.teaser,
      full: report.full,
      meta: {
        requested_url: scan.requested_url,
        finished_at: scan.finished_at,
        pages_crawled: scan.pages_crawled,
        crawl_limit_hit: !!scan.crawl_limit_hit,
      },
    });
  });

  router.post('/api/report/:token/unlock', async (req, res) => {
    const s = db.getReportByToken(req.params.token);
    if (!s) return res.status(404).json({ error: 'Report not found' });
    const email = String(req.body?.email ?? '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Provide a valid email address' });
    if (!s.unlocked_at) {
      db.insertLead({ scanId: s.id, email, domainId: s.domain_id, ipHash: ipHash(req) });
      db.updateScanStatus(s.id, { unlocked_at: new Date().toISOString() });
      try { await notify({ email, scanId: s.id, url: s.requested_url }); } catch (e) { console.error('[notify]', e); }
    }
    const p = reportPayload(req.params.token);
    res.json({
      unlocked: true,
      health: p.report.health,
      full: p.report.full,
      meta: { requested_url: s.requested_url, finished_at: s.finished_at, pages_crawled: s.pages_crawled, crawl_limit_hit: !!s.crawl_limit_hit },
    });
  });

  const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(base, express.static(pub));
  // SPA deep link for shared reports: /r/<token>
  router.get('/r/:token', (req, res) => res.sendFile(join(pub, 'index.html')));
  app.use(base, router);

  return app;
}

// direct start (npm start / pm2 fork): run the listener when this file is the
// entry script. pm2 rewrites process.argv, so test both argv and pm_id.
const isEntry = (process.argv[1] && process.argv[1].endsWith('server.js')) || !!process.env.pm_id;
if (isEntry) {
  const port = Number(process.env.PORT ?? 5310);
  createApp().listen(port, '127.0.0.1', () => console.log(`seo-checker listening on 127.0.0.1:${port}`));
}
