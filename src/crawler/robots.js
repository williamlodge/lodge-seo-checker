import robotsParser from 'robots-parser';
import { REQUEST_TIMEOUT_MS, USER_AGENT } from '../config.js';

export async function loadRobots(origin) {
  const fallback = (fetchError) => ({
    isAllowed: () => true,
    crawlDelayMs: 0,
    sitemapUrls: [],
    fetchError,
  });

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
    text = await res.text();
  } catch (err) {
    return fallback(String(err?.message ?? err));
  }

  try {
    const parser = robotsParser(`${origin}/robots.txt`, text);
    return {
      isAllowed: (url) => parser.isAllowed(url, USER_AGENT) !== false,
      crawlDelayMs: Math.round((parser.getCrawlDelay(USER_AGENT) ?? 0) * 1000),
      sitemapUrls: parser.getSitemaps ? parser.getSitemaps() : parser.sitemaps ?? [],
    };
  } catch (err) {
    return fallback(`robots parse error: ${err?.message ?? err}`);
  }
}
