import { describe, it, expect } from 'vitest';
import { runOnPageChecks } from './onpage.js';

const B = 'https://ex.com';
const pg = (url, over = {}) => ({ url, statusCode: 200, depth: 0, linksOut: [], redirectChain: [url], ...over });

const run = (pages) => runOnPageChecks({ pages, sitemapUrls: [], crawlLimitHit: false });

describe('on-page checks', () => {
  it('ON-1 missing title is error', () => {
    const f = run([pg(`${B}/a`, { title: null })]).find((r) => r.checkId === 'ON-1');
    expect(f.severity).toBe('error');
    expect(f.affectedUrls).toEqual([`${B}/a`]);
  });

  it('ON-2 duplicate titles warning', () => {
    const f = run([pg(`${B}/a`, { title: 'Same' }), pg(`${B}/b`, { title: 'Same' })]).find((r) => r.checkId === 'ON-2');
    expect(f.severity).toBe('warning');
    expect(f.evidence.join(' ')).toContain('Same');
  });

  it('ON-3 short and long titles are opportunities with counts', () => {
    const f = run([pg(`${B}/a`, { title: 'x'.repeat(10) }), pg(`${B}/b`, { title: 'x'.repeat(80) })]).find((r) => r.checkId === 'ON-3');
    expect(f.severity).toBe('opportunity');
    expect(f.evidence.filter((e) => e.includes('short')).length).toBe(1);
    expect(f.evidence.filter((e) => e.includes('long')).length).toBe(1);
  });

  it('ON-4 missing meta descriptions opportunity', () => {
    const f = run([pg(`${B}/a`), pg(`${B}/b`, { metaDesc: 'x'.repeat(60) })]).find((r) => r.checkId === 'ON-4');
    expect(f.severity).toBe('opportunity');
    expect(f.affectedUrls).toEqual([`${B}/a`]);
  });

  it('ON-5 multiple H1 and skipped heading levels', () => {
    const f = run([pg(`${B}/a`, { h1Count: 2, headings: ['h1', 'h1', 'h3'] })]).find((r) => r.checkId === 'ON-5');
    expect(f.severity).toBe('warning');
    expect(f.evidence.join(' ')).toContain('2');
  });

  it('ON-6 thin content under 150 words on text pages', () => {
    const f = run([pg(`${B}/a`, { wordCount: 40 }), pg(`${B}/b`, { wordCount: 400 })]).find((r) => r.checkId === 'ON-6');
    expect(f.severity).toBe('opportunity');
    expect(f.affectedUrls).toEqual([`${B}/a`]);
  });

  it('ON-7 near-duplicate pages by simhash distance <= 3', () => {
    const f = run([
      pg(`${B}/d1`, { simhash: '0000000000000001', wordCount: 500 }),
      pg(`${B}/d2`, { simhash: '0000000000000004', wordCount: 500 }), // distance 2
      pg(`${B}/d3`, { simhash: 'ffffffffffffffff', wordCount: 500 }), // distance ~64
    ]).find((r) => r.checkId === 'ON-7');
    expect(f.severity).toBe('warning');
    expect(f.affectedUrls).toContain(`${B}/d1`);
    expect(f.affectedUrls).toContain(`${B}/d2`);
    expect(f.affectedUrls).not.toContain(`${B}/d3`);
  });

  it('ON-8 images missing alt text', () => {
    const f = run([pg(`${B}/a`, { imagesMissingAlt: 4, imgTotal: 10 })]).find((r) => r.checkId === 'ON-8');
    expect(f.severity).toBe('opportunity');
    expect(f.evidence.join(' ')).toContain('4');
  });

  it('ON-9 non-descriptive URLs', () => {
    const f = run([pg(`${B}/a/b/c/d/e/page?id=999999999&session=abc`)]).find((r) => r.checkId === 'ON-9');
    expect(f.severity).toBe('opportunity');
    expect(f.evidence.join(' ')).toMatch(/deep|query/i);
  });

  it('ON-10 internal links to redirects or 4xx are errors', () => {
    const home = pg(`${B}/`, { linksOut: [`${B}/moved`, `${B}/gone`] });
    const moved = pg(`${B}/moved`, { redirectChain: [`${B}/old`, `${B}/moved`] });
    const gone = pg(`${B}/gone`, { statusCode: 404 });
    const f = run([home, moved, gone]).find((r) => r.checkId === 'ON-10');
    expect(f.severity).toBe('error');
    expect(f.evidence.join(' ')).toContain(`${B}/moved`);
    expect(f.evidence.join(' ')).toContain(`${B}/gone`);
  });

  it('ON-11 missing lang and hreflang without reciprocal', () => {
    const f = run([
      pg(`${B}/a`, { lang: null }),
      pg(`${B}/en`, { lang: 'en', hreflang: ['fr'], linksOut: [] }),
    ]).find((r) => r.checkId === 'ON-11');
    expect(f.severity).toBe('warning');
    expect(f.evidence.join(' ')).toMatch(/lang/);
  });

  it('all findings carry why/fix/impact/effort', () => {
    const f = run([pg(`${B}/a`, { title: null })]);
    const x = f[0];
    for (const k of ['title', 'why', 'fix']) expect(typeof x[k]).toBe('string');
    expect([1, 2, 3]).toContain(x.impact);
    expect([1, 2, 3]).toContain(x.effort);
  });
});
