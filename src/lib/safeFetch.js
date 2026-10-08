import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^192\.0\.0\./,
];

export function isPublicAddress(addr) {
  const v = isIP(addr);
  if (v === 4) return !PRIVATE_V4.some((re) => re.test(addr));
  if (v === 6) {
    const low = addr.toLowerCase();
    if (low === '::' || low === '::1') return false;
    if (low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')) return false;
    if (low.startsWith('::ffff:')) return isPublicAddress(low.slice(7));
    return true;
  }
  return false;
}

// Reject non-default ports: v1 policy (plan Review Focus: 端口怪异).
function hasAllowedPort(u) {
  const p = u.port;
  if (!p) return true;
  return (u.protocol === 'https:' && p === '443') || (u.protocol === 'http:' && p === '80');
}

export async function checkUrlHost(url, { lookup } = {}) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!hasAllowedPort(u)) return false;
  const host = u.hostname;
  if (host.startsWith('[')) return isPublicAddress(host.slice(1, -1)); // IPv6 literal
  if (isIP(host)) return isPublicAddress(host);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return false;
  const resolve = lookup ?? ((h, o) => dns.lookup(h, o));
  try {
    const addrs = await resolve(host, { all: true });
    return addrs.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}
