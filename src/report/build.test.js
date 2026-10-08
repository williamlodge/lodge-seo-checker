import { describe, it, expect } from 'vitest';
import { buildReport, diffFindings } from './build.js';

const F = (over) => ({
  checkId: 'IDX-2', severity: 'error', title: 't', why: 'w', fix: 'f',
  evidence: ['e1', 'e2', 'e3', 'e4'], affectedUrls: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
  impact: 3, effort: 2, ...over,
});

describe('buildReport', () => {
  it('orders task list by impact desc then effort asc then checkId', () => {
    const a = F({ checkId: 'A', impact: 3, effort: 2 });
    const b = F({ checkId: 'B', impact: 3, effort: 1 });
    const c = F({ checkId: 'C', severity: 'opportunity', impact: 1, effort: 1 });
    const r = buildReport([c, a, b], { unlocked: true });
    expect(r.taskList.map((t) => t.checkId)).toEqual(['B', 'A', 'C']);
  });

  it('health counts by severity', () => {
    const r = buildReport([
      F({ severity: 'error' }), F({ severity: 'warning' }), F({ severity: 'warning' }), F({ severity: 'opportunity' }),
    ], { unlocked: true });
    expect(r.health).toEqual({ errors: 1, warnings: 2, opportunities: 1 });
  });

  it('teaser = top 3 items with evidence capped at 3, urls at 5, plus health counts', () => {
    const items = [1, 2, 3, 4].map((i) => F({ checkId: `X${i}` }));
    const r = buildReport(items, { unlocked: false });
    expect(r.teaser.items).toHaveLength(3);
    expect(r.teaser.items[0].evidence).toHaveLength(3);
    expect(r.teaser.items[0].affectedUrls).toHaveLength(5);
    expect(r.teaser.health).toBeDefined();
    expect(r.full).toBeNull();
  });

  it('unlocked report truncates affectedUrls display at 50 with total count', () => {
    const big = F({ affectedUrls: Array.from({ length: 80 }, (_, i) => `u${i}`) });
    const r = buildReport([big], { unlocked: true });
    expect(r.taskList[0].affectedUrls).toHaveLength(50);
    expect(r.taskList[0].affectedUrlCount).toBe(80);
  });

  it('impact heuristic: warning covering >10% of pages bumps impact by 1 (max 3)', () => {
    // 12% of pages affected (12 urls on a 100-page site)
    const w = F({ severity: 'warning', impact: 1, affectedUrls: Array.from({ length: 12 }, (_, i) => `u${i}`) });
    const r = buildReport([w], { unlocked: true, totalPages: 100 });
    expect(r.taskList[0].impact).toBe(2);
  });

  it('empty findings yields empty but valid report', () => {
    const r = buildReport([], { unlocked: true });
    expect(r.taskList).toEqual([]);
    expect(r.health).toEqual({ errors: 0, warnings: 0, opportunities: 0 });
  });
});

describe('diffFindings', () => {
  const mk = (id, urls) => F({ checkId: id, affectedUrls: urls });
  it('new / resolved / regressed by checkId', () => {
    const prev = [mk('A', ['u1']), mk('B', ['u2']), mk('C', ['u1', 'u2'])];
    const next = [mk('B', ['u2', 'u3']), mk('C', ['u2']), mk('D', ['u9'])];
    const d = diffFindings(prev, next);
    expect(d.new.map((f) => f.checkId)).toEqual(['D']);
    expect(d.resolved.map((f) => f.checkId)).toEqual(['A']);
    expect(d.regressed.map((f) => f.checkId)).toEqual(['B']);
  });

  it('identical sets diff to empty', () => {
    const s = [mk('A', ['u1'])];
    const d = diffFindings(s, s);
    expect(d).toEqual({ new: [], resolved: [], regressed: [] });
  });
});
