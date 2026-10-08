import robotsParser from 'robots-parser';
import { REQUEST_TIMEOUT_MS, USER_AGENT } from '../config.js';
import { checkUrlHost } from '../lib/safeFetch.js';

const MAX_ROBOTS_BYTES = 1024 * 1024;

export async function loadRobots(origin, { allowPrivate = false } = {}) {
  const fallback = (fetchError) => ({
    isAllowed: () => true,
    crawlDelayMs: 0,
    sitemapUrls: [],
    fetchError,
  });

  if (!allowPrivate && !(await checkUrlHost(`${origin}/robots.txt`))) {
    return fallback('blocked: non-public host');
  }

  let res;
  try {
    res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT },
    });
  } catch (err) {
    return fallback(String(err?.cause ?? err?.message ?? err));
  }

  if (res.status >= 400) {
    return fallback(`robots.txt HTTP ${res.status}`);
  }

  let text;
  try {
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_ROBOTS_BYTES) return fallback('robots.txt too large (>1MB)');
    const reader = res.body?.getReader();
    if (!reader) { text = ''; }
    else {
      const dec = new TextDecoder();
      text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (text.length > MAX_ROBOTS_BYTES) { await reader.cancel(); break; }
      }
    }
  } catch (err) {
    return fallback(String(err?.message ?? err));
  }

  try {
    const parser = robotsParser(`${origin}/robots.txt`, text);
    return {
      isAllowed: (url) => parser.isAllowed(url, USER_AGENT) !== false,
      crawlDelayMs: Math.round((parser.getCrawlDelay(USER_AGENT) ?? 0) * 1000),
      sitemapUrls: parser.getSitemaps ? parser.getSitemaps() : parser.sitemaps ?? [],
      robotsTxt: text,
    };
  } catch (err) {
    return fallback(`robots parse error: ${err?.message ?? err}`);
  }
}
