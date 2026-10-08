import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePage } from './parsePage.js';

const fx = (f) => readFileSync(`test/fixtures/html/${f}`, 'utf8');

describe('parsePage', () => {
  it('extracts full field set from a normal page', () => {
    const r = parsePage({ url: 'https://ex.com/normal', finalUrl: 'https://ex.com/normal', status: 200, redirectChain: ['https://ex.com/normal'], headers: {}, body: fx('normal.html') });
    expect(r.title).toBe('Normal Page');
    expect(r.metaDesc).toBe('A normal page about widgets');
    expect(r.canonical).toBe('https://ex.com/normal');
    expect(r.h1Count).toBe(1);
    expect(r.wordCount).toBeGreaterThan(5);
    expect(r.lang).toBe('en');
    expect(r.imagesMissingAlt).toBe(1);
    expect(r.jsonld).toEqual([{ '@type': 'WebPage' }]);
    expect(r.invalidJsonld).toBe(false);
    expect(r.linksOut.includes('https://ex.com/other')).toBe(true);
    expect(r.linksOut.includes('https://elsewhere.com/x')).toBe(true);
    expect(r.bytesHtml).toBeGreaterThan(100);
  });

  it('missing title/canonical/lang become null', () => {
    const r = parsePage({ url: 'https://ex.com/broken', finalUrl: 'https://ex.com/broken', status: 200, redirectChain: [], headers: {}, body: fx('broken.html') });
    expect(r.title).toBe('Broken'); // has title
    expect(r.canonical).toBeNull();
    expect(r.lang).toBeNull();
    expect(r.h1Count).toBe(2);
  });

  it('robotsMeta merges meta robots', () => {
    const r = parsePage({ url: 'https://ex.com/broken', finalUrl: 'https://ex.com/broken', status: 200, redirectChain: [], headers: {}, body: fx('broken.html') });
    expect(r.robotsMeta).toContain('noindex');
  });

  it('X-Robots-Tag header merges into robotsMeta', () => {
    const r = parsePage({ url: 'u', finalUrl: 'u', status: 200, redirectChain: [], headers: { 'x-robots-tag': 'noindex, nofollow' }, body: fx('normal.html') });
    expect(r.robotsMeta).toContain('noindex');
    expect(r.robotsMeta).toContain('nofollow');
  });

  it('invalid JSON-LD flags invalidJsonld and excludes it', () => {
    const r = parsePage({ url: 'https://ex.com/broken', finalUrl: 'https://ex.com/broken', status: 200, redirectChain: [], headers: {}, body: fx('broken.html') });
    expect(r.invalidJsonld).toBe(true);
    expect(r.jsonld).toEqual([]);
  });

  it('mixedContent counts http subresources on https pages', () => {
    const r = parsePage({ url: 'https://ex.com/m', finalUrl: 'https://ex.com/m', status: 200, redirectChain: [], headers: {}, body: fx('https-mixed.html') });
    expect(r.mixedContent).toBe(1);
  });

  it('no mixed content flag on http pages', () => {
    const r = parsePage({ url: 'http://ex.com/m', finalUrl: 'http://ex.com/m', status: 200, redirectChain: [], headers: {}, body: fx('https-mixed.html') });
    expect(r.mixedContent).toBe(0);
  });

  it('identical text yields identical simhash; different text differs', () => {
    const mk = (t) => parsePage({ url: 'https://ex.com/x', finalUrl: 'https://ex.com/x', status: 200, redirectChain: [], headers: {}, body: `<html><body><p>${t}</p></body></html>` });
    const a1 = mk('alpha beta gamma delta epsilon zeta eta theta');
    const a2 = mk('alpha beta gamma delta epsilon zeta eta theta');
    const b = mk('completely different words here nothing alike at all');
    expect(a1.simhash).toBe(a2.simhash);
    expect(a1.simhash).not.toBe(b.simhash);
  });
});

describe('parsePage heading/image inventory', () => {
  it('collects heading tag names in order and total image count', () => {
    const r = parsePage({ url: 'https://ex.com/h', finalUrl: 'https://ex.com/h', status: 200, redirectChain: [], headers: {}, body: '<html><body><h1>T</h1><h3>x</h3><h2>y</h2><img src="a.png" alt="a"><img src="b.png"></body></html>' });
    expect(r.headings).toEqual(['h1', 'h3', 'h2']);
    expect(r.imgTotal).toBe(2);
    expect(r.imagesMissingAlt).toBe(1);
  });
});

describe('parsePage viewport and image srcs', () => {
  it('detects viewport meta and lists image srcs', () => {
    const withVp = parsePage({ url: 'https://ex.com/i', finalUrl: 'https://ex.com/i', status: 200, redirectChain: [], headers: {}, body: '<html><head><meta name="viewport" content="width=device-width"></head><body><img src="/a.png" alt="x"><img src="/b.png"></body></html>' });
    expect(withVp.hasViewport).toBe(true);
    expect(withVp.imageSrcs).toEqual(['https://ex.com/a.png', 'https://ex.com/b.png']);
    const noVp = parsePage({ url: 'https://ex.com/i', finalUrl: 'https://ex.com/i', status: 200, redirectChain: [], headers: {}, body: '<html><body></body></html>' });
    expect(noVp.hasViewport).toBe(false);
    expect(noVp.imageSrcs).toEqual([]);
  });
});
