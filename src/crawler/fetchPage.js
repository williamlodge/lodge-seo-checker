import { REQUEST_TIMEOUT_MS, USER_AGENT } from '../config.js';
import { checkUrlHost } from '../lib/safeFetch.js';

const MAX_BODY = 5 * 1024 * 1024;

export async function fetchPage(url, { timeoutMs = REQUEST_TIMEOUT_MS, maxRedirects = 5, allowPrivate = false } = {}) {
  const redirectChain = [];
  let current = url;
  let truncated = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!allowPrivate && !(await checkUrlHost(current))) {
      return { finalUrl: current, status: 0, redirectChain, headers: {}, body: '', truncated, error: `blocked: non-public host ${new URL(current).hostname}` };
    }
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
    } catch (err) {
      return {
        finalUrl: current, status: 0, redirectChain, headers: {}, body: '', truncated,
        error: String(err?.cause?.code ?? err?.cause ?? err?.message ?? err),
      };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      redirectChain.push(current);
      let next;
      try {
        next = new URL(res.headers.get('location'), current).href;
      } catch {
        redirectChain.push(current);
        return { finalUrl: current, status: res.status, redirectChain, headers: Object.fromEntries(res.headers), body: '', truncated, error: 'invalid redirect location' };
      }
      // loop guard
      if (redirectChain.includes(next)) {
        redirectChain.push(next);
        return { finalUrl: next, status: res.status, redirectChain, headers: Object.fromEntries(res.headers), body: '', truncated, error: 'redirect loop' };
      }
      current = next;
      continue;
    }

    redirectChain.push(current);

    // read body with cap
    let body = '';
    const reader = res.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          body += dec.decode(value, { stream: true });
          if (body.length > MAX_BODY) {
            body = body.slice(0, MAX_BODY);
            truncated = true;
            await reader.cancel();
            break;
          }
        }
      } catch (err) {
        return { finalUrl: current, status: res.status, redirectChain, headers: Object.fromEntries(res.headers), body, truncated, error: `body read: ${err?.message ?? err}` };
      }
    }

    return {
      finalUrl: current,
      status: res.status,
      redirectChain,
      headers: Object.fromEntries(res.headers),
      body,
      truncated,
    };
  }

  // exceeded max redirects; current points at the URL we refused to fetch
  return { finalUrl: current, status: 302, redirectChain, headers: {}, body: '', truncated, error: 'too many redirects' };
}
