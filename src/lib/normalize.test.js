import { describe, it, expect } from 'vitest';
import { normalizeUrl, isPublicHttpUrl, sameHost } from './normalize.js';

describe('normalizeUrl', () => {
  it('lowercases host, strips default port and fragment', () => {
    expect(normalizeUrl('https://Example.com:443/a#frag')).toEqual({
      href: 'https://example.com/a',
      host: 'example.com',
      origin: 'https://example.com',
    });
  });

  it('keeps root slash for bare origin', () => {
    expect(normalizeUrl('http://example.com').href).toBe('http://example.com/');
  });

  it('strips http default port 80', () => {
    expect(normalizeUrl('http://example.com:80/x').href).toBe('http://example.com/x');
  });

  it('does not strip non-default ports', () => {
    expect(normalizeUrl('http://example.com:8080/x').href).toBe('http://example.com:8080/x');
  });
});

describe('isPublicHttpUrl', () => {
  it.each([
    'https://example.com',
    'http://example.org/page?q=1',
  ])('accepts %s', (u) => expect(isPublicHttpUrl(u)).toBe(true));

  it.each([
    'file:///etc/passwd',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://192.168.1.1/',
    'https://10.0.0.1/',
    'https://172.16.0.5/',
    'https://169.254.169.254/',
    'ftp://x/',
    'not a url',
    '',
  ])('rejects %s', (u) => expect(isPublicHttpUrl(u)).toBe(false));
});

describe('sameHost', () => {
  it('true for same host', () => {
    expect(sameHost('https://a.com/x', 'https://a.com/y')).toBe(true);
  });
  it('false for subdomain', () => {
    expect(sameHost('https://a.com/x', 'https://sub.a.com/')).toBe(false);
  });
  it('false for different host', () => {
    expect(sameHost('https://a.com/', 'https://b.com/')).toBe(false);
  });
});

describe('isPublicHttpUrl port policy', () => {
  it('rejects non-default ports', () => {
    expect(isPublicHttpUrl('https://example.com:8080/')).toBe(false);
    expect(isPublicHttpUrl('http://example.com:9000/')).toBe(false);
  });
  it('accepts default and absent ports', () => {
    expect(isPublicHttpUrl('https://example.com:443/')).toBe(true);
    expect(isPublicHttpUrl('https://example.com/')).toBe(true);
  });
});
