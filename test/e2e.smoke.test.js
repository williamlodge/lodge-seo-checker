import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import { createApp } from '../src/server.js';

let fixture;
let fbase;

beforeAll(async () => {
  const page = (t, links = [], extraHead = '') =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">${extraHead}<title>${t}</title></head><body><h1>${t}</h1><p>${'text '.repeat(60)}</p>${links.map((l) => `<a href="${l}">x</a>`).join('')}</body></html>`;
  fixture = http.createServer((req, res) => {
    const p = req.url;
    const send = (s, body, type = 'text/html') => { res.writeHead(s, { 'content-type': type }); res.end(body); };
    if (p === '/robots.txt') return send(200, `User-agent: *\nDisallow: /private\nUser-agent: GPTBot\nDisallow: /\nSitemap: ${fbase}/sitemap.xml`, 'text/plain');
    if (p === '/sitemap.xml') return send(200, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${fbase}/</loc></url><url><loc>${fbase}/broken</loc></url></urlset>`, 'application/xml');
    if (p === '/') return send(200, page('Home', ['/about', '/private/x']));
    if (p === '/about') return send(200, page('About', ['/'], '<meta name="robots" content="noindex">'));
    if (p === '/broken') return send(404, 'gone');
    return send(200, page('Page'));
  });
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  fbase = `http://127.0.0.1:${fixture.address().port}`;
});

afterAll(async () => { await new Promise((r) => fixture.close(r)); });

describe('E2E smoke', () => {
  it('fixture site scan produces a gated report whose top item is max impact', async () => {
    // NOTE: fixture is 127.0.0.1 — the public-URL guard would reject it.
    // E2E uses the real crawler against a local fixture, so bypass the guard via allowPrivate flag.
    const app = createApp({ dbPath: ':memory:', allowPrivate: true });
    const created = await request(app).post('/api/scan').send({ url: `${fbase}/` });
    expect(created.status).toBe(202);

    let scan;
    for (let i = 0; i < 100; i++) {
      scan = (await request(app).get(`/api/scan/${created.body.id}`)).body;
      if (scan.status === 'done' || scan.status === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(scan.status).toBe('done');
    expect(scan.pages_crawled).toBeGreaterThanOrEqual(2);

    const teaser = (await request(app).get(`/api/report/${created.body.token}`)).body;
    expect(teaser.unlocked).toBe(false);
    expect(teaser.health.errors).toBeGreaterThanOrEqual(1); // noindex + TQ-8? (TQ-8 is opportunity) noindex is error

    const unlocked = await request(app)
      .post(`/api/report/${created.body.token}/unlock`)
      .send({ email: 'e2e@example.com' });
    expect(unlocked.status).toBe(200);
    const top = unlocked.body.full.taskList[0];
    expect(top.impact).toBe(3);
    expect(top.severity).toBe('error');

    // GEO finding present (GPTBot blocked)
    const all = unlocked.body.full.taskList.map((f) => f.checkId);
    expect(all).toContain('TQ-8');
  }, 30000);
});
