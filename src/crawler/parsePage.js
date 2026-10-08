import * as cheerio from 'cheerio';

function simhash64(text) {
  // Token -> 64-bit hash (FNV-1a-ish with two different primes for 64 bits)
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const bits = new Array(64).fill(0);
  for (const tok of tokens) {
    let h1 = 0xcbf29ce484222325n;
    let h2 = 0x9e3779b97f4a7c15n;
    for (let i = 0; i < tok.length; i++) {
      const c = BigInt(tok.charCodeAt(i));
      h1 = (h1 ^ c) * 0x100000001b3n & 0xffffffffffffffffn;
      h2 = (h2 + c) * 0x100000001b3n & 0xffffffffffffffffn;
    }
    const h = (h1 ^ ((h2 << 32n | h2 >> 32n) & 0xffffffffffffffffn)) & 0xffffffffffffffffn;
    for (let b = 0; b < 64; b++) {
      if ((h >> BigInt(b)) & 1n) bits[b]++; else bits[b]--;
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (bits[b] > 0) out |= (1n << BigInt(b));
  return out.toString(16).padStart(16, '0');
}

export function hammingDistance(aHex, bHex) {
  if (!aHex || !bHex) return 64;
  let x = BigInt(`0x${aHex}`) ^ BigInt(`0x${bHex}`);
  let d = 0;
  while (x) { d += Number(x & 1n); x >>= 1n; }
  return d;
}

export function parsePage({ url, finalUrl, status, redirectChain, headers, body }) {
  const $ = cheerio.load(body ?? '');
  $('script, style, noscript, template').remove();

  const title = $('head title').first().text().trim() || $('title').first().text().trim() || null;
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const h1Count = $('h1').length;

  const robotsParts = [];
  const metaRobots = $('meta[name="robots"]').attr('content');
  if (metaRobots) robotsParts.push(metaRobots.trim());
  const xr = headers?.['x-robots-tag'];
  if (xr) robotsParts.push(String(xr).trim());
  const robotsMeta = robotsParts.length ? robotsParts.join(', ') : null;

  const lang = $('html').attr('lang')?.trim()
    || $('meta[http-equiv="content-language"]').attr('content')?.trim()
    || null;

  const hreflang = [];
  $('link[rel="alternate"][hreflang], a[hreflang]').each((_, el) => {
    const v = $(el).attr('hreflang');
    if (v) hreflang.push(v);
  });

  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(' ').length : 0;

  const linksOut = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) return;
    try {
      const abs = new URL(raw, finalUrl || url).href;
      linksOut.push({ href: abs, anchor: $(el).text().trim() });
    } catch { /* skip malformed */ }
  });

  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => headings.push(el.tagName.toLowerCase()));

  let imagesMissingAlt = 0;
  const imgTotal = $('img').length;
  const imageSrcs = [];
  $('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined || !alt.trim()) imagesMissingAlt++;
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:')) {
      try { imageSrcs.push(new URL(src, finalUrl || url).href); } catch { /* skip */ }
    }
  });
  const hasViewport = $('meta[name="viewport"]').length > 0;

  const jsonld = [];
  let invalidJsonld = false;
  const $$ = cheerio.load(body ?? '');
  $$('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonld.push(JSON.parse($$(el).text()));
    } catch {
      invalidJsonld = true;
    }
  });

  let mixedContent = 0;
  const isHttps = (finalUrl || url).startsWith('https:');
  if (isHttps) {
    $$('img[src], script[src], link[rel="stylesheet"][href], iframe[src]').each((_, el) => {
      const v = $$(el).attr('src') || $$(el).attr('href');
      if (v && v.startsWith('http://')) mixedContent++;
    });
  }

  return {
    url,
    finalUrl: finalUrl || url,
    statusCode: status,
    redirectChain: redirectChain ?? [],
    depth: 0,
    title,
    metaDesc,
    canonical,
    robotsMeta,
    h1Count,
    wordCount,
    lang,
    hreflang,
    simhash: simhash64(text),
    linksOut: linksOut.map((l) => l.href),
    headings,
    imagesMissingAlt,
    imgTotal,
    imageSrcs,
    hasViewport,
    headers: {
      'strict-transport-security': headers?.['strict-transport-security'] ?? headers?.['Strict-Transport-Security'] ?? null,
    },
    bytesHtml: (body ?? '').length,
    jsonld,
    invalidJsonld,
    mixedContent,
  };
}
