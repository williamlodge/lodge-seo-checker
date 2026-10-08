import { describe, it, expect } from 'vitest';
import { isPublicAddress, checkUrlHost } from './safeFetch.js';

describe('isPublicAddress', () => {
  it.each(['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.5','169.254.169.254','0.0.0.0','::1','fe80::1','fd00::1'])('rejects %s', (a) => expect(isPublicAddress(a)).toBe(false));
  it.each(['93.184.216.34','8.8.8.8','2606:2800:220:1:248:1893:25c8:1946'])('accepts %s', (a) => expect(isPublicAddress(a)).toBe(true));
});

describe('checkUrlHost', () => {
  it('rejects when any resolved address is private (DNS rebinding)', async () => {
    expect(await checkUrlHost('https://evil.example.com/', { lookup: async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }] })).toBe(false);
  });
  it('accepts all-public resolutions', async () => {
    expect(await checkUrlHost('https://good.example.com/', { lookup: async () => [{ address: '93.184.216.34' }] })).toBe(true);
  });
  it('rejects odd ports', async () => {
    expect(await checkUrlHost('https://example.com:8080/', { lookup: async () => [{ address: '93.184.216.34' }] })).toBe(false);
  });
  it('accepts default ports', async () => {
    expect(await checkUrlHost('https://example.com:443/', { lookup: async () => [{ address: '93.184.216.34' }] })).toBe(true);
  });
});
