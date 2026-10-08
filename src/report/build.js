const SEVERITY_KEY = { error: 0, warning: 1, opportunity: 2 };

function displayFinding(f, { full = false } = {}) {
  return {
    checkId: f.checkId,
    severity: f.severity,
    title: f.title,
    why: f.why,
    fix: f.fix,
    evidence: full ? f.evidence : (f.evidence ?? []).slice(0, 3),
    affectedUrls: full ? (f.affectedUrls ?? []).slice(0, 50) : (f.affectedUrls ?? []).slice(0, 5),
    affectedUrlCount: (f.affectedUrls ?? []).length,
    impact: f.impact,
    effort: f.effort,
  };
}

function applyImpactHeuristics(findings, totalPages) {
  return findings.map((f) => {
    let impact = f.impact;
    if (f.severity === 'error') impact = 3;
    if (f.severity === 'warning' && totalPages > 0) {
      const frac = (f.affectedUrls ?? []).length / totalPages;
      if (frac > 0.1) impact = Math.min(3, impact + 1);
    }
    return { ...f, impact: Math.max(1, Math.min(3, impact)) };
  });
}

export function buildReport(findings, { unlocked, totalPages = 0 } = {}) {
  const scored = applyImpactHeuristics(findings, totalPages);
  const sorted = [...scored].sort((a, b) =>
    b.impact - a.impact ||
    a.effort - b.effort ||
    a.checkId.localeCompare(b.checkId)
  );
  const health = {
    errors: scored.filter((f) => f.severity === 'error').length,
    warnings: scored.filter((f) => f.severity === 'warning').length,
    opportunities: scored.filter((f) => f.severity === 'opportunity').length,
  };
  const taskList = sorted.map((f) => displayFinding(f, { full: true }));
  const teaser = {
    items: sorted.slice(0, 3).map((f) => displayFinding(f, { full: false })),
    health,
  };
  return { taskList, health, teaser, full: unlocked ? { taskList } : null };
}

export function diffFindings(prev = [], next = []) {
  const key = (f) => f.checkId;
  const prevMap = new Map(prev.map((f) => [key(f), f]));
  const nextMap = new Map(next.map((f) => [key(f), f]));
  const added = [];
  const resolved = [];
  const regressed = [];
  for (const [k, f] of nextMap) {
    if (!prevMap.has(k)) added.push(f);
    else if ((f.affectedUrls ?? []).length > (prevMap.get(k).affectedUrls ?? []).length) regressed.push(f);
  }
  for (const [k, f] of prevMap) if (!nextMap.has(k)) resolved.push(f);
  return { new: added, resolved, regressed };
}
