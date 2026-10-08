import { describe, it, expect } from 'vitest';
import { runTechnicalChecks } from './technical.js';

const B = 'https://ex.com';
const pg = (url, over = {}) => ({ url, statusCode: 200, depth: 0, linksOut: [], redirectChain: [url], ...over });

describe('technical checks', () => {
  it('TQ-1 http-only or mixed content is error', () => {
    const r = runTechnicalChecks(
      { pages: [pg('http://ex.com/', { mixedContent: 0 }), pg(`${B}/m`, { mixedContent: 3 })], sitemapUrls: [], crawlLimitHit: false },
      {}
    );
    const f = r.find((x) => x.checkId === 'TQ-1');
    expect(f.severity).toBe('error');
    expect(f.evidence.join(' ')).toMatch(/http:\/\//);
    expect(f.evidence.join(' ')).toMatch(/mixed/i);
  });

  it('TQ-2 security headers are informational opportunity', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [], crawlLimitHit: false }, {});
    const f = r.find((x) => x.checkId === 'TQ-2');
    expect(f.severity).toBe('opportunity');
    expect(f.evidence.join(' ')).toMatch(/hsts/i);
  });

  it('TQ-3 large images and heavy HTML are warnings with evidence', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/a`, { largeImages: 2, bytesHtml: 4 * 1024 * 1024, bigImageSrcs: ['x.png'] })], sitemapUrls: [], crawlLimitHit: false }, {});
    const f = r.find((x) => x.checkId === 'TQ-3');
    expect(f.severity).toBe('warning');
    expect(f.evidence.join(' ')).toMatch(/2/);
    expect(f.evidence.join(' ')).toMatch(/MB/);
  });

  it('TQ-4 missing viewport is warning', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/a`, { hasViewport: false })], sitemapUrls: [], crawlLimitHit: false }, {});
    expect(r.find((x) => x.checkId === 'TQ-4').severity).toBe('warning');
  });

  it('TQ-5 robots missing/error is warning using robotsFetchError', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [], crawlLimitHit: false }, { fetchError: 'robots.txt HTTP 500' });
    const f = r.find((x) => x.checkId === 'TQ-5');
    expect(f.severity).toBe('warning');
    expect(f.evidence.join(' ')).toContain('500');
  });

  it('TQ-6 sitemap missing is warning; present is not', () => {
    const noSm = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [], crawlLimitHit: false }, {});
    expect(noSm.find((x) => x.checkId === 'TQ-6').severity).toBe('warning');
    const withSm = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [`${B}/s.xml`], crawlLimitHit: false }, {});
    expect(withSm.find((x) => x.checkId === 'TQ-6')).toBeUndefined();
  });

  it('TQ-7 invalid JSON-LD is warning', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/a`, { invalidJsonld: true })], sitemapUrls: [`${B}/s.xml`], crawlLimitHit: false }, {});
    const f = r.find((x) => x.checkId === 'TQ-7');
    expect(f.severity).toBe('warning');
    expect(f.affectedUrls).toEqual([`${B}/a`]);
  });

  it('TQ-8 robots blocking AI crawlers raises GEO opportunity', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [`${B}/s.xml`], crawlLimitHit: false }, {
      robotsTxt: 'User-agent: *\nDisallow: /x\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /',
    });
    const f = r.find((x) => x.checkId === 'TQ-8');
    expect(f.severity).toBe('opportunity');
    expect(f.evidence.join(' ')).toContain('GPTBot');
    expect(f.evidence.join(' ')).toContain('ClaudeBot');
  });

  it('TQ-8 does not fire when AI crawlers allowed', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/`)], sitemapUrls: [`${B}/s.xml`], crawlLimitHit: false }, {
      robotsTxt: 'User-agent: *\nDisallow: /private',
    });
    expect(r.find((x) => x.checkId === 'TQ-8')).toBeUndefined();
  });

  it('all findings carry why/fix/impact/effort', () => {
    const r = runTechnicalChecks({ pages: [pg('http://ex.com/')], sitemapUrls: [], crawlLimitHit: false }, {});
    for (const x of r) {
      for (const k of ['title', 'why', 'fix']) expect(typeof x[k]).toBe('string');
      expect([1, 2, 3]).toContain(x.impact);
      expect([1, 2, 3]).toContain(x.effort);
    }
  });
});

describe('TQ-2 with real headers', () => {
  it('does not fire when HSTS is present', () => {
    const r = runTechnicalChecks({ pages: [pg(`${B}/`, { headers: { 'strict-transport-security': 'max-age=31536000' } })], sitemapUrls: [`${B}/s.xml`], crawlLimitHit: false }, {});
    expect(r.find((x) => x.checkId === 'TQ-2')).toBeUndefined();
  });
});
