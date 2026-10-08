import { hammingDistance } from '../crawler/parsePage.js';

function finding(checkId, severity, { title, why, fix, evidence, affectedUrls, impact, effort }) {
  return { checkId, severity, title, why, fix, evidence, affectedUrls, impact, effort };
}

export function runIndexabilityChecks(crawlResult) {
  const { pages, sitemapUrls = [], robotsBlockedUrls = [] } = crawlResult;
  const findings = [];
  const smSet = new Set(sitemapUrls);

  // IDX-1: robots.txt blocks a URL that is in the sitemap
  const blockedInSitemap = robotsBlockedUrls.filter((u) => smSet.has(u));
  if (blockedInSitemap.length) {
    findings.push(finding('IDX-1', 'error', {
      title: `${blockedInSitemap.length} URL${blockedInSitemap.length > 1 ? 's' : ''} in your sitemap are blocked by robots.txt`,
      why: 'Search engines see the URL in the sitemap but are forbidden from crawling it — mixed signals waste crawl budget and the pages will not be indexed.',
      fix: `Either remove these URLs from the sitemap or remove their Disallow rule in robots.txt, depending on whether they should be public. Example: remove <url><loc>${blockedInSitemap[0]}</loc></url> from the sitemap.`,
      evidence: blockedInSitemap.map((u) => `robots.txt Disallow matches sitemap entry ${u}`),
      affectedUrls: blockedInSitemap,
      impact: 3, effort: 1,
    }));
  }

  // IDX-2: noindex on pages
  const noindexed = pages.filter((p) => p.robotsMeta && /noindex/i.test(p.robotsMeta));
  if (noindexed.length) {
    findings.push(finding('IDX-2', 'error', {
      title: `${noindexed.length} page${noindexed.length > 1 ? 's are' : ' is'} marked noindex`,
      why: 'A noindex tag tells search engines to drop the page from results entirely. If these pages should rank, this is an accidental de-indexing — one of the most damaging silent SEO errors.',
      fix: `Remove the noindex from the robots meta tag (or X-Robots-Tag header) on these pages. Example for ${noindexed[0].url}: change <meta name="robots" content="noindex"> to <meta name="robots" content="index,follow"> — or delete the tag.`,
      evidence: noindexed.map((p) => `${p.url} → robots="${p.robotsMeta}"`),
      affectedUrls: noindexed.map((p) => p.url),
      impact: 3, effort: 1,
    }));
  }

  // IDX-3: canonical problems — missing canonicals (warning) and conflicting canonicals among near-duplicates (error)
  const missingCanonical = pages.filter((p) => !p.canonical && p.statusCode === 200);
  const groups = [];
  const matched = new Set();
  for (let i = 0; i < pages.length; i++) {
    if (matched.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < pages.length; j++) {
      if (matched.has(j)) continue;
      if (pages[i].simhash && hammingDistance(pages[i].simhash, pages[j].simhash) <= 3) {
        group.push(j); matched.add(j);
      }
    }
    if (group.length > 1) groups.push(group.map((k) => pages[k]));
    matched.add(i);
  }
  const conflicts = groups.filter((g) => new Set(g.map((p) => p.canonical || p.url)).size > 1);
  if (conflicts.length) {
    const urls = conflicts.flat().map((p) => p.url);
    findings.push(finding('IDX-3', 'error', {
      title: `${conflicts.length} group${conflicts.length > 1 ? 's' : ''} of duplicate pages point to conflicting canonicals`,
      why: 'Near-identical pages each claiming a different canonical URL tell search engines conflicting stories about which version to index — they may pick the wrong one or index all copies.',
      fix: `Pick one URL per duplicate group as the single canonical version and point every copy at it with an absolute URL. Example: ${conflicts[0].map((p) => p.url).join(' and ')} should both carry <link rel="canonical" href="${conflicts[0][0].canonical || conflicts[0][0].url}">.`,
      evidence: conflicts.map((g) => g.map((p) => `${p.url} canonical→ ${p.canonical || '(none/self)'}`).join(' | ')),
      affectedUrls: urls,
      impact: 3, effort: 3,
    }));
  } else if (missingCanonical.length) {
    findings.push(finding('IDX-3', 'warning', {
      title: `${missingCanonical.length} page${missingCanonical.length > 1 ? 's have' : ' has'} no canonical tag`,
      why: 'Without a canonical, near-duplicate or parameterised URLs can each be indexed separately, splitting ranking signals across copies.',
      fix: `Add a self-referencing canonical to every indexable page. Example for ${missingCanonical[0].url}: <link rel="canonical" href="${missingCanonical[0].url}"> in <head>.`,
      evidence: missingCanonical.map((p) => `${p.url} → no canonical tag`),
      affectedUrls: missingCanonical.map((p) => p.url),
      impact: 1, effort: 2,
    }));
  }

  // IDX-4: redirect chains 3+ hops
  const chained = pages.filter((p) => p.redirectChain.length >= 3);
  if (chained.length) {
    findings.push(finding('IDX-4', 'warning', {
      title: `${chained.length} URL${chained.length > 1 ? 's' : ''} redirect through chains of 3+ hops`,
      why: 'Each redirect hop wastes crawl budget, delays page load, and dilutes link equity. Search engines may stop following after a few hops.',
      fix: 'Update internal links to point at the final URL instead of the start of the chain, and collapse multi-hop redirects to a single 301 at server config level.',
      evidence: chained.map((p) => p.redirectChain.join(' -> ')),
      affectedUrls: chained.map((p) => p.url),
      impact: 2, effort: 2,
    }));
  }

  // IDX-5: sitemap hygiene — sitemap URLs that 404 or redirect.
  // Only judge URLs the crawl actually verified; when the page cap was hit,
  // uncrawled sitemap URLs are unknown — flagging them would be noise.
  const crawlCapped = crawlResult.crawlLimitHit === true;
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const badSitemap = [...smSet].filter((u) => {
    const p = byUrl.get(u);
    if (!p) return !crawlCapped; // in sitemap, never fetched — flagged only for complete crawls
    return p.statusCode >= 400 || p.redirectChain.length > 1;
  });
  if (badSitemap.length) {
    findings.push(finding('IDX-5', 'warning', {
      title: `${badSitemap.length} sitemap URL${badSitemap.length > 1 ? 's' : ''} return errors or redirects`,
      why: 'A sitemap should list only final, 200-OK, indexable URLs. Errors and redirects in the sitemap undermine trust in it and waste crawler time.',
      fix: `Remove non-200 URLs from the sitemap (or fix the pages). Example: remove ${badSitemap[0]} or make it return 200 directly.`,
      evidence: badSitemap.map((u) => {
        const p = byUrl.get(u);
        return p ? `${u} → HTTP ${p.statusCode}${p.redirectChain.length > 1 ? ' (redirected)' : ''}` : `${u} → not reachable in crawl`;
      }),
      affectedUrls: badSitemap,
      impact: 2, effort: 1,
    }));
  }

  // IDX-6: orphan pages — in sitemap but zero internal inlinks
  const inlinks = new Map();
  for (const p of pages) for (const l of p.linksOut) inlinks.set(l, (inlinks.get(l) ?? 0) + 1);
  const orphans = crawlCapped
    ? [] // orphan detection is unreliable on a capped crawl
    : [...smSet].filter((u) => (inlinks.get(u) ?? 0) === 0);
  if (orphans.length) {
    findings.push(finding('IDX-6', 'warning', {
      title: `${orphans.length} orphan page${orphans.length > 1 ? 's' : ''} — in the sitemap but not linked internally`,
      why: 'Pages with no internal links rely entirely on the sitemap for discovery. They accumulate no internal link equity and rank poorly.',
      fix: 'Link to each orphan page from at least one relevant existing page (navigation, hub page, or in-content link), and use descriptive anchor text.',
      evidence: orphans.map((u) => `${u} → 0 internal inlinks`),
      affectedUrls: orphans,
      impact: 2, effort: 2,
    }));
  }

  // IDX-7: auth-required pages linked internally
  const authPages = pages.filter((p) => p.statusCode === 401 || p.statusCode === 403);
  if (authPages.length) {
    findings.push(finding('IDX-7', 'warning', {
      title: `${authPages.length} linked page${authPages.length > 1 ? 's require' : ' requires'} authentication (${authPages[0].statusCode})`,
      why: 'Crawlers and visitors hit a login wall on these URLs. Linked-but-locked pages leak crawl budget and create poor landing experiences from search.',
      fix: 'Remove the links from public navigation/templates, or replace them with a crawlable landing page that describes what is behind the login.',
      evidence: authPages.map((p) => `${p.url} → HTTP ${p.statusCode}`),
      affectedUrls: authPages.map((p) => p.url),
      impact: 1, effort: 2,
    }));
  }

  return findings;
}
