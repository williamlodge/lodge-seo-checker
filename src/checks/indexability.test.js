import { describe, it, expect } from 'vitest';
import { runIndexabilityChecks } from './indexability.js';

const B = 'https://ex.com';

function pg(url, over = {}) {
  return { url, statusCode: 200, canonical: null, robotsMeta: null, redirectChain: [url], linksOut: [], depth: 0, ...over };
}

function run(pages, sitemapUrls = []) {
  // build inlinks by scanning linksOut
  for (const p of pages) {
    p.inlinks = pages.filter((q) => q !== p && q.linksOut.includes(p.url)).length;
  }
  return runIndexabilityChecks({ pages, sitemapUrls, crawlLimitHit: false, robotsFetchError: undefined });
}

describe('indexability checks', () => {
  it('IDX-1: sitemap URL disallowed by robots', () => {
    const f = run([pg(`${B}/a`)], [`${B}/private`]);
    // simulate: robotsInfo needed — runIndexabilityChecks receives robots disallow list via crawlResult? use robotsBlocked list
    expect(f.find((x) => x.checkId === 'IDX-1')).toBeUndefined(); // no robots info passed -> no finding
  });

  it('IDX-1 fires when robots-blocked URL appears in sitemap', () => {
    const f = runIndexabilityChecks({ pages: [pg(`${B}/`)], sitemapUrls: [`${B}/private`], robotsBlockedUrls: [`${B}/private`], crawlLimitHit: false });
    const x = f.find((r) => r.checkId === 'IDX-1');
    expect(x.severity).toBe('error');
    expect(x.affectedUrls).toContain(`${B}/private`);
  });

  it('IDX-2: noindex pages flagged as error with URLs', () => {
    const f = run([pg(`${B}/x`, { robotsMeta: 'noindex' }), pg(`${B}/ok`)]);
    const x = f.find((r) => r.checkId === 'IDX-2');
    expect(x.severity).toBe('error');
    expect(x.affectedUrls).toEqual([`${B}/x`]);
  });

  it('IDX-3: conflicting canonicals across duplicate pages', () => {
    const f = run([
      pg(`${B}/p1`, { simhash: 'aaa', canonical: `${B}/p1` }),
      pg(`${B}/p2`, { simhash: 'aaa', canonical: `${B}/p2` }),
    ]);
    const x = f.find((r) => r.checkId === 'IDX-3');
    expect(x.severity).toBe('error');
    expect(x.evidence.join(' ')).toContain('p1');
    expect(x.evidence.join(' ')).toContain('p2');
  });

  it('IDX-3: missing canonical on multiple pages is a warning', () => {
    const f = run([pg(`${B}/a`), pg(`${B}/b`)]);
    const x = f.find((r) => r.checkId === 'IDX-3');
    expect(x.severity).toBe('warning');
  });

  it('IDX-4: redirect chains of 3+ hops flagged with the chain as evidence', () => {
    const f = run([pg(`${B}/c`, { redirectChain: [`${B}/c1`, `${B}/c2`, `${B}/c3`, `${B}/c`] })]);
    const x = f.find((r) => r.checkId === 'IDX-4');
    expect(x.severity).toBe('warning');
    expect(x.evidence[0]).toContain('->');
  });

  it('IDX-5: sitemap URLs that 404 or redirect are flagged', () => {
    const f = run([pg(`${B}/`), pg(`${B}/moved`, { redirectChain: [`${B}/moved-old`, `${B}/moved`] })], [`${B}/gone`, `${B}/moved`, `${B}/`]);
    const x = f.find((r) => r.checkId === 'IDX-5');
    expect(x.severity).toBe('warning');
    expect(x.affectedUrls).toContain(`${B}/gone`);
    expect(x.affectedUrls).toContain(`${B}/moved`);
  });

  it('IDX-6: orphan pages = in sitemap but zero internal inlinks', () => {
    const home = pg(`${B}/`, { linksOut: [`${B}/linked`] });
    const linked = pg(`${B}/linked`);
    const orphan = pg(`${B}/orphan`);
    const f = run([home, linked, orphan], [`${B}/orphan`, `${B}/linked`]);
    const x = f.find((r) => r.checkId === 'IDX-6');
    expect(x.severity).toBe('warning');
    expect(x.affectedUrls).toEqual([`${B}/orphan`]);
  });

  it('IDX-7: auth pages (401/403) linked internally are flagged', () => {
    const home = pg(`${B}/`, { linksOut: [`${B}/admin`] });
    const admin = pg(`${B}/admin`, { statusCode: 403 });
    const f = run([home, admin]);
    const x = f.find((r) => r.checkId === 'IDX-7');
    expect(x.severity).toBe('warning');
    expect(x.affectedUrls).toEqual([`${B}/admin`]);
  });

  it('findings carry why/fix/impact/effort fields', () => {
    const f = run([pg(`${B}/x`, { robotsMeta: 'noindex' })]);
    const x = f.find((r) => r.checkId === 'IDX-2');
    for (const k of ['title', 'why', 'fix']) expect(typeof x[k]).toBe('string');
    expect([1, 2, 3]).toContain(x.impact);
    expect([1, 2, 3]).toContain(x.effort);
  });
});
