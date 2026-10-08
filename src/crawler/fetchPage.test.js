import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fetchPage } from './fetchPage.js';

let server, base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = req.url;
    if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>ok</body></html>'); }
    else if (p === '/r1') { res.writeHead(301, { location: '/r2' }); res.end(); }
    else if (p === '/r2') { res.writeHead(302, { location: '/' }); res.end(); }
    else if (p === '/hop1') { res.writeHead(302, { location: '/hop2' }); res.end(); }
    else if (p === '/hop2') { res.writeHead(302, { location: '/hop3' }); res.end(); }
    else if (p === '/hop3') { res.writeHead(302, { location: '/hop4' }); res.end(); }
    else if (p === '/hop4') { res.writeHead(302, { location: '/hop5' }); res.end(); }
    else if (p === '/hop5') { res.writeHead(302, { location: '/hop6' }); res.end(); }
    else if (p === '/hop6') { res.writeHead(302, { location: '/' }); res.end(); }
    else if (p === '/loop-a') { res.writeHead(302, { location: '/loop-b' }); res.end(); }
    else if (p === '/loop-b') { res.writeHead(302, { location: '/loop-a' }); res.end(); }
    else if (p === '/missing') { res.writeHead(404); res.end('gone'); }
    else if (p === '/slow') { /* never responds */ }
    else if (p === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>' + 'x'.repeat(6 * 1024 * 1024) + '</body></html>');
    }
    else { res.writeHead(200); res.end('<html></html>'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

describe('fetchPage', () => {
  it('returns final URL, status, headers, body', async () => {
    const r = await fetchPage(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe(`${base}/`);
    expect(r.body).toContain('ok');
    expect(r.error).toBeUndefined();
  });

  it('follows a 3-hop chain recording each hop', async () => {
    const r = await fetchPage(`${base}/r1`);
    expect(r.status).toBe(200);
    expect(r.redirectChain.length).toBeGreaterThanOrEqual(3);
    expect(r.redirectChain[0]).toContain('/r1');
    expect(r.redirectChain.at(-1)).toBe(r.finalUrl);
  });

  it('stops after 6 hops (MAX_REDIRECTS=5 follows) and marks truncation of chain', async () => {
    const r = await fetchPage(`${base}/hop1`);
    expect(r.redirectChain.length).toBe(6);
    expect(r.status).toBe(302);
  });

  it('stops redirect loops without hanging', async () => {
    const r = await fetchPage(`${base}/loop-a`);
    expect(r.status).toBe(302);
    expect(r.redirectChain.length).toBeLessThanOrEqual(6);
  });

  it('records 404 status without throwing', async () => {
    const r = await fetchPage(`${base}/missing`);
    expect(r.status).toBe(404);
  });

  it('returns error field on timeout instead of throwing', async () => {
    const r = await fetchPage(`${base}/slow`, { timeoutMs: 300 });
    expect(r.error).toBeTruthy();
  });

  it('truncates bodies over 5MB and flags truncated', async () => {
    const r = await fetchPage(`${base}/big`);
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
