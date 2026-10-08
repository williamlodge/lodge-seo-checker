import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { loadRobots } from './robots.js';

let server;
let base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\nCrawl-delay: 5\nSitemap: https://x.example/s.xml');
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

describe('loadRobots', () => {
  it('parses disallow, crawl-delay and sitemap', async () => {
    const r = await loadRobots(base);
    expect(r.isAllowed(`${base}/`)).toBe(true);
    expect(r.isAllowed(`${base}/private/a`)).toBe(false);
    expect(r.crawlDelayMs).toBe(5000);
    expect(r.sitemapUrls).toEqual(['https://x.example/s.xml']);
    expect(r.fetchError).toBeUndefined();
  });

  it('404 robots means allow-all and records fetchError', async () => {
    const r = await loadRobots(`${base}/nonexistent-origin`);
    // simulate by pointing at a path that 404s: use a server that always 404s
    expect(r.isAllowed('http://whatever.example/')).toBe(true);
    expect(r.fetchError).toBeTruthy();
  });

  it('connection failure means allow-all and records fetchError', async () => {
    const r = await loadRobots('http://127.0.0.1:1');
    expect(r.isAllowed('http://whatever.example/')).toBe(true);
    expect(r.fetchError).toBeTruthy();
  });
});
