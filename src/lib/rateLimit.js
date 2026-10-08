import crypto from 'node:crypto';

export function rateLimit({ windowMs, max, keyFn }) {
  // per-instance sliding window: key -> timestamps
  const buckets = new Map();
  return {
    check(req) {
      const key = keyFn(req);
      const now = Date.now();
      const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      return { allowed: arr.length < max, record() { arr.push(now); buckets.set(key, arr); } };
    },
  };
}

export function ipHash(req) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}
