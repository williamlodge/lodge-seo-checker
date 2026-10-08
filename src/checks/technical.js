const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'CCBot'];
const mk = (checkId, severity, o) => ({ checkId, severity, ...o });

export function runTechnicalChecks(crawlResult, robotsInfo = {}) {
  const { pages } = crawlResult;
  const findings = [];
  const home = pages[0];
  const ok = (p) => p.statusCode === 200;

  // TQ-1: HTTPS / mixed content
  const httpPages = pages.filter((p) => p.url.startsWith('http://'));
  const mixed = pages.filter((p) => (p.mixedContent ?? 0) > 0);
  if (httpPages.length || mixed.length) {
    findings.push(mk('TQ-1', 'error', {
      title: `${httpPages.length} page${httpPages.length === 1 ? ' is' : 's are'} served over plain HTTP${mixed.length ? `, plus ${mixed.reduce((s, p) => s + p.mixedContent, 0)} mixed-content resources` : ''}`,
      why: 'HTTPS is a confirmed lightweight ranking signal, and browsers flag mixed content as insecure — eroding both rankings and visitor trust.',
      fix: 'Serve every page over HTTPS (301 redirect HTTP→HTTPS), enable HSTS, and rewrite all http:// subresource URLs (images, scripts, stylesheets) to https://.',
      evidence: [
        ...httpPages.map((p) => `${p.url} → plain HTTP`),
        ...mixed.map((p) => `${p.url} → ${p.mixedContent} mixed-content resource(s)`),
      ],
      affectedUrls: [...httpPages, ...mixed].map((p) => p.url),
      impact: 3, effort: 2,
    }));
  }

  // TQ-2: security headers (informational)
  if (home && !(home.headers ?? {})['strict-transport-security']) {
    findings.push(mk('TQ-2', 'opportunity', {
      title: 'Baseline security headers not fully set',
      why: 'Headers like HSTS, X-Content-Type-Options and a Referrer-Policy harden the site cheaply and are table stakes for a trustworthy domain.',
      fix: 'Add at minimum: Strict-Transport-Security: max-age=31536000, X-Content-Type-Options: nosniff, and a Referrer-Policy.',
      evidence: ['No HSTS header observed on the homepage response'],
      affectedUrls: home ? [home.url] : [],
      impact: 1, effort: 1,
    }));
  }

  // TQ-3: oversized images / heavy HTML
  const heavyPages = pages.filter((p) => ok(p) && p.bytesHtml > 3 * 1024 * 1024);
  const largeImgs = pages.flatMap((p) => (p.bigImageSrcs ?? []).map((src) => ({ page: p.url, src })));
  if (heavyPages.length || largeImgs.length) {
    findings.push(mk('TQ-3', 'warning', {
      title: `${heavyPages.length} oversized HTML page${heavyPages.length === 1 ? '' : 's'}${largeImgs.length ? ` and ${largeImgs.length} image${largeImgs.length === 1 ? '' : 's'} over 500 KB` : ''}`,
      why: 'Heavy pages and unoptimized images are the most common cause of slow LCP — the Core Web Vital users feel first.',
      fix: 'Compress images to WebP/AVIF with sensible dimensions, add loading="lazy" below the fold, and trim embedded inline bloat from HTML.',
      evidence: [
        ...heavyPages.map((p) => `${p.url} → ${(p.bytesHtml / 1024 / 1024).toFixed(1)} MB HTML`),
        ...(pages.filter((p) => (p.largeImages ?? 0) > 0).map((p) => `${p.url} → ${p.largeImages} image(s) over 500 KB`)),
        ...largeImgs.map((i) => `${i.page} → ${i.src} (>500 KB)`),
      ],
      affectedUrls: [...new Set([...heavyPages.map((p) => p.url), ...largeImgs.map((i) => i.page)])],
      impact: 2, effort: 2,
    }));
  }

  // TQ-4: viewport
  const noViewport = pages.filter((p) => ok(p) && p.hasViewport === false);
  if (noViewport.length) {
    findings.push(mk('TQ-4', 'warning', {
      title: `${noViewport.length} page${noViewport.length === 1 ? ' lacks' : 's lack'} a viewport meta tag`,
      why: 'Without <meta name="viewport">, mobile browsers render at desktop width — the page fails Google\'s mobile-friendly assessment.',
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to every page <head>.',
      evidence: noViewport.map((p) => `${p.url} → no viewport meta tag`),
      affectedUrls: noViewport.map((p) => p.url),
      impact: 2, effort: 1,
    }));
  }

  // TQ-5: robots.txt health
  if (robotsInfo.fetchError) {
    findings.push(mk('TQ-5', 'warning', {
      title: 'robots.txt could not be fetched',
      why: 'A missing or erroring robots.txt means crawlers fall back to default behavior and you lose control over crawl directives — and cannot declare your sitemap.',
      fix: 'Serve a valid robots.txt at the domain root returning HTTP 200, and reference your sitemap from it.',
      evidence: [robotsInfo.fetchError],
      affectedUrls: [],
      impact: 2, effort: 1,
    }));
  }

  // TQ-6: sitemap presence
  if (!robotsInfo.fetchError && !(crawlResult.sitemapUrls ?? []).length) {
    findings.push(mk('TQ-6', 'warning', {
      title: 'No sitemap discovered',
      why: 'Without a sitemap, discovery of new and updated pages depends purely on links; isolated pages may never be found.',
      fix: 'Publish /sitemap.xml listing all indexable final URLs and add "Sitemap: https://yourdomain.com/sitemap.xml" to robots.txt.',
      evidence: ['No Sitemap directive in robots.txt and /sitemap.xml not found'],
      affectedUrls: [],
      impact: 2, effort: 1,
    }));
  }

  // TQ-7: invalid JSON-LD
  const badLd = pages.filter((p) => ok(p) && p.invalidJsonld);
  if (badLd.length) {
    findings.push(mk('TQ-7', 'warning', {
      title: `${badLd.length} page${badLd.length === 1 ? ' has' : 's have'} invalid structured data (JSON-LD)`,
      why: 'Broken JSON-LD is silently ignored by search engines, so any rich-result eligibility it was meant to provide is lost.',
      fix: 'Fix the JSON syntax in the ld+json script block and validate with Google\'s Rich Results Test.',
      evidence: badLd.map((p) => `${p.url} → JSON parse error in <script type="application/ld+json">`),
      affectedUrls: badLd.map((p) => p.url),
      impact: 1, effort: 1,
    }));
  }

  // TQ-8: GEO — AI crawlers blocked
  const robotsTxt = robotsInfo.robotsTxt ?? '';
  if (robotsTxt) {
    const blocked = AI_CRAWLERS.filter((bot) => blocksBot(robotsTxt, bot));
    if (blocked.length) {
      findings.push(mk('TQ-8', 'opportunity', {
        title: `robots.txt blocks ${blocked.length} AI crawler${blocked.length > 1 ? 's' : ''} (${blocked.join(', ')}) — invisible to AI search`,
        why: 'Blocking GPTBot, ClaudeBot, PerplexityBot or CCBot means AI engines cannot read your content and will never cite it — a growing share of discovery ("GEO") alongside classic SEO.',
        fix: `Remove the Disallow: / rules for ${blocked.join(', ')} if you want AI assistants and answer engines to reference your site.`,
        evidence: blocked.map((b) => `robots.txt: "User-agent: ${b}" with "Disallow: /"`),
        affectedUrls: [],
        impact: 2, effort: 1,
      }));
    }
  }

  return findings;
}

function blocksBot(robotsTxt, bot) {
  // find a User-agent section matching bot (exact or *-prefixed match), then a bare Disallow: /
  const sections = robotsTxt.split(/(?=User-agent:)/i);
  for (const sec of sections) {
    const uaMatch = sec.match(/User-agent:\s*(\S+)/i);
    if (!uaMatch) continue;
    const ua = uaMatch[1].toLowerCase();
    if (!ua.includes(bot.toLowerCase())) continue;
    const body = sec.split(/\n(?=User-agent:)/i)[0];
    if (/^\s*Disallow:\s*\/\s*$/im.test(body)) return true;
  }
  return false;
}
