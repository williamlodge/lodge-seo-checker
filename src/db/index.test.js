import { describe, it, expect } from 'vitest';
import { openDb } from './index.js';

function freshDb() {
  const db = openDb(':memory:');
  const d = db.upsertDomain('example.com');
  const scan = db.createScan({ domainId: d.id, requestedUrl: 'https://example.com/', options: { maxPages: 100 } });
  return { db, d, scan };
}

describe('db layer', () => {
  it('createScan returns id and 22-char share_token', () => {
    const { scan } = freshDb();
    expect(scan.id).toBeGreaterThan(0);
    expect(scan.share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('upsertDomain is idempotent by host', () => {
    const { db, d } = freshDb();
    const again = db.upsertDomain('example.com');
    expect(again.id).toBe(d.id);
  });

  it('insertPages/getPages roundtrip arrays as JSON', () => {
    const { db, scan } = freshDb();
    db.insertPages(scan.id, [
      { url: 'https://example.com/', status_code: 200, redirect_chain: ['https://example.com'], links_out: ['/a'] },
    ]);
    const pages = db.getPages(scan.id);
    expect(pages).toHaveLength(1);
    expect(pages[0].redirect_chain).toEqual(['https://example.com']);
    expect(pages[0].links_out).toEqual(['/a']);
  });

  it('insertFindings/getFindings roundtrip payload_json', () => {
    const { db, scan } = freshDb();
    db.insertFindings(scan.id, [
      { checkId: 'IDX-2', severity: 'error', impact: 3, effort: 2, payload: { urls: ['/x'] } },
    ]);
    const f = db.getFindings(scan.id);
    expect(f[0].check_id).toBe('IDX-2');
    expect(f[0].payload).toEqual({ urls: ['/x'] });
  });

  it('updateScanStatus patches and getScan returns row', () => {
    const { db, scan } = freshDb();
    db.updateScanStatus(scan.id, { status: 'done', pages_crawled: 7 });
    const s = db.getScan(scan.id);
    expect(s.status).toBe('done');
    expect(s.pages_crawled).toBe(7);
  });

  it('insertLead and getReportByToken', () => {
    const { db, d, scan } = freshDb();
    db.insertLead({ scanId: scan.id, email: 'a@b.co', domainId: d.id, ipHash: 'h' });
    const r = db.getReportByToken(scan.share_token);
    expect(r.id).toBe(scan.id);
    expect(r.unlocked_at).toBeNull();
  });
});
