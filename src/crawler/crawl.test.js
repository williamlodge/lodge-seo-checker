import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { crawl } from './crawl.js';

let server, base;

// site: / links to /a, /b; /a links to /a1,/a2; /b links to /b1; /b1 -> /deep1 -> /deep2 -> /deep3 -> /deep4 (depth 5 ok) ; /private/secret disallowed by robots
let hits = {};
beforeAll(async () => {
  const page = (links, extra = '') => `<html><head><title>t</title></head><body>${links.map((l) => `<a href="${l}">x</a>`).join('')}${extra}</body></html>`;
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    const p = req.url;
    if (p === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`User-agent: *\nDisallow: /private\nSitemap: ${base}/sitemap.xml`);
      return;
    }
    if (p === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url><url><loc>${base}/a</loc></url><url><loc>${base}/orphan</loc></url></urlset>`);
      return;
    }
    if (p === '/private/secret') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page([])); return; }
    if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/a', '/b', '/private/secret'])); return; }
    if (p === '/a') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/a1', '/a2'])); return; }
    if (p === '/b') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/b1'])); return; }
    if (p === '/b1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/deep1'])); return; }
    if (p === '/deep1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/deep2'])); return; }
    if (p === '/deep2') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/deep3'])); return; }
    if (p === '/deep3') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/deep4'])); return; }
    if (p === '/deep4') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(['/deep5'])); return; } // depth 6 -> not crawled
    if (p === '/deep5') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page([])); return; }
    if (p === '/many') {
      const ls = Array.from({ length: 120 }, (_, i) => `/m${i}`);
      res.end(page(ls));
      return;
    }
    for (let i = 0; i < 120; i++) if (p === `/m${i}`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page([])); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page([]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

describe('crawl', () => {
  it('BFS respects depth 5 and robots disallow, parses sitemap', async () => {
    const r = await crawl(`${base}/`, { politenessMs: 1 });
    const urls = r.pages.map((p) => p.url);
    expect(urls).toContain(`${base}/`);
    expect(urls).toContain(`${base}/a1`);
    expect(urls).toContain(`${base}/deep3`); // depth 5
    expect(urls).not.toContain(`${base}/deep4`); // depth 6 excluded
    expect(urls).not.toContain(`${base}/deep5`);
    expect(urls).not.toContain(`${base}/private/secret`);
    expect(r.sitemapUrls.length).toBe(3);
    expect(r.sitemapUrls).toContain(`${base}/orphan`);
    expect(r.crawlLimitHit).toBe(false);
    // each URL fetched exactly once
    expect(Object.values(hits).every((n) => n === 1)).toBe(true);
  });

  it('caps at maxPages and flags crawlLimitHit', async () => {
    const r = await crawl(`${base}/many`, { politenessMs: 1, maxPages: 10 });
    expect(r.pages.length).toBe(10);
    expect(r.crawlLimitHit).toBe(true);
  });

  it('stops at scan deadline and returns what it has', async () => {
    const r = await crawl(`${base}/a`, { politenessMs: 50, scanTimeoutMs: 60 });
    expect(r.pages.length).toBeGreaterThanOrEqual(1);
    expect(r.crawlLimitHit).toBe(true);
  });
});
