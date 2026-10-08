const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
];

export function normalizeUrl(input) {
  const u = new URL(input);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') ||
      (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }
  // Root path keeps its slash; deeper paths keep theirs as given.
  return { href: u.href, host: u.hostname, origin: u.origin };
}

export function isPublicHttpUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false;
  if (h.includes(':')) return false; // IPv6 literals: no allowlist support in v1
  for (const re of PRIVATE_IPV4) {
    if (re.test(h)) return false;
  }
  if (!h.includes('.')) return false; // bare hostnames
  return true;
}

export function sameHost(a, b) {
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
  } catch {
    return false;
  }
}
