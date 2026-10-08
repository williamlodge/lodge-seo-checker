import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './server.js';

const fakeCrawl = async (url) => ({
  pages: [
    {
      url, finalUrl: url, statusCode: 200, redirectChain: [url], depth: 0,
      title: null, metaDesc: null, canonical: null, robotsMeta: 'noindex', h1Count: 2,
      wordCount: 30, lang: null, hreflang: [], simhash: 'abc', linksOut: [], headings: ['h1', 'h1'],
      imagesMissingAlt: 1, imgTotal: 2, imageSrcs: [], hasViewport: false, bytesHtml: 1000,
      jsonld: [], invalidJsonld: false, mixedContent: 0,
    },
  ],
  sitemapUrls: [],
  crawlLimitHit: false,
  robotsFetchError: undefined,
  robotsBlockedUrls: [],
  robotsRaw: {},
});

function makeApp() {
  return createApp({
    dbPath: ':memory:',
    crawlImpl: fakeCrawl,
    notify: async () => {},
    imageSampler: async () => new Map(),
  });
}

describe('scan API', () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  it('rejects private/invalid URLs with 400', async () => {
    for (const url of ['https://127.0.0.1/x', 'ftp://x/', 'not a url']) {
      const r = await request(app).post('/api/scan').send({ url });
      expect(r.status).toBe(400);
      expect(r.body.error).toBeTruthy();
    }
  });

  it('rejects denylisted hosts with 400', async () => {
    const r = await request(app).post('/api/scan').send({ url: 'https://denylisted.example.com/' });
    expect(r.status).toBe(400);
  });

  it('full flow: create → done → teaser → unlock → full', async () => {
    const created = await request(app).post('/api/scan').send({ url: 'https://scannable.example.com/' });
    expect(created.status).toBe(202);
    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // poll until done
    let scan;
    for (let i = 0; i < 50; i++) {
      scan = (await request(app).get(`/api/scan/${created.body.id}`)).body;
      if (scan.status === 'done' || scan.status === 'error') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(scan.status).toBe('done');

    const teaser = (await request(app).get(`/api/report/${created.body.token}`)).body;
    expect(teaser.unlocked).toBe(false);
    expect(teaser.teaser.items.length).toBeGreaterThan(0);
    expect(teaser.full ?? teaser.taskList ?? null).toBeNull();

    const unlocked = await request(app)
      .post(`/api/report/${created.body.token}/unlock`)
      .send({ email: 'lead@example.com' });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.full.taskList.length).toBeGreaterThan(0);
    expect(unlocked.body.full.taskList[0].impact).toBeGreaterThanOrEqual(1);

    const after = (await request(app).get(`/api/report/${created.body.token}`)).body;
    expect(after.unlocked).toBe(true);
  });

  it('rejects bad emails on unlock', async () => {
    const created = await request(app).post('/api/scan').send({ url: 'https://mail.example.com/' });
    for (let i = 0; i < 50; i++) {
      const s = (await request(app).get(`/api/scan/${created.body.id}`)).body;
      if (s.status === 'done' || s.status === 'error') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const r = await request(app).post(`/api/report/${created.body.token}/unlock`).send({ email: 'nope' });
    expect(r.status).toBe(400);
  });

  it('4th scan from same IP within an hour returns 429', async () => {
    const app1 = makeApp();
    for (let i = 0; i < 3; i++) {
      const r = await request(app1).post('/api/scan').send({ url: `https://rate${i}.example.com/` });
      expect(r.status).toBe(202);
    }
    const r4 = await request(app1).post('/api/scan').send({ url: 'https://over.example.com/' });
    expect(r4.status).toBe(429);
  });

  it('unknown token 404s', async () => {
    const r = await request(app).get('/api/report/doesnotexist1234567890');
    expect(r.status).toBe(404);
  });
});
