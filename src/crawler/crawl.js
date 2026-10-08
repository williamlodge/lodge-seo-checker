import { normalizeUrl, sameHost } from '../lib/normalize.js';
import { checkUrlHost } from '../lib/safeFetch.js';
import { loadRobots } from './robots.js';
import { fetchPage } from './fetchPage.js';
import { parsePage } from './parsePage.js';
import { MAX_PAGES, MAX_DEPTH, SCAN_TIMEOUT_MS, POLITENESS_MS } from '../config.js';

const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 1024 * 1024;

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: true };
  const dec = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text, truncated: false };
    text += dec.decode(value, { stream: true });
    if (text.length > maxBytes) return { text: text.slice(0, maxBytes), truncated: true };
  }
}

async function fetchSitemaps(sitemapUrls, timeoutMs, { allowPrivate = false } = {}) {
  const urls = [];
  for (const loc of sitemapUrls.slice(0, 5)) {
    try {
      if (!allowPrivate && !(await checkUrlHost(loc))) continue;
      const res = await fetch(loc, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_SITEMAP_BYTES) continue;
      const { text: xml } = await readCapped(res, MAX_SITEMAP_BYTES);
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
      urls.push(...locs.slice(0, 5000));
      if (urls.length >= 5000) break;
    } catch { /* sitemap optional */ }
  }
  return urls.slice(0, 5000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function crawl(startUrl, opts = {}) {
  const {
    maxPages = MAX_PAGES,
    maxDepth = MAX_DEPTH,
    scanTimeoutMs = SCAN_TIMEOUT_MS,
    politenessMs = POLITENESS_MS,
    onProgress = () => {},
    allowPrivate = false,
  } = opts;

  const start = normalizeUrl(startUrl);
  const robots = await loadRobots(start.origin, { allowPrivate });
  const sitemapUrls = await fetchSitemaps(robots.sitemapUrls, 10000, { allowPrivate });

  const deadline = Date.now() + scanTimeoutMs;
  const pages = [];
  const robotsBlockedUrls = [];
  const seen = new Set([start.href]);
  const queue = [{ url: start.href, depth: 0 }];
  let crawlLimitHit = false;
  let lastRequestAt = 0;
  const minGap = Math.max(politenessMs, robots.crawlDelayMs || 0);

  while (queue.length) {
    if (Date.now() > deadline) { crawlLimitHit = true; break; }
    if (pages.length >= maxPages) { crawlLimitHit = true; break; }

    const { url, depth } = queue.shift();
    if (!robots.isAllowed(url)) { robotsBlockedUrls.push(url); continue; }

    const wait = lastRequestAt + minGap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const raw = await fetchPage(url, { allowPrivate });
    const page = parsePage({ ...raw, url });
    page.depth = depth;
    pages.push(page);
    onProgress(pages.length, queue.length);

    if (raw.error || raw.status >= 400 || !raw.body) continue;

    for (const link of page.linksOut) {
      let norm;
      try {
        norm = normalizeUrl(link);
      } catch { continue; }
      if (!sameHost(norm.href, start.href)) continue;
      if (seen.has(norm.href)) continue;
      if (depth + 1 > maxDepth && !sitemapUrls.includes(norm.href)) continue;
      seen.add(norm.href);
      queue.push({ url: norm.href, depth: depth + 1 });
      if (pages.length + queue.length > maxPages * 3) break; // queue explosion guard
    }
  }

  if (Date.now() > deadline) crawlLimitHit = true;

  return {
    pages,
    sitemapUrls,
    crawlLimitHit,
    robotsBlockedUrls,
    robotsFetchError: robots.fetchError,
    robotsRaw: robots,
  };
}
