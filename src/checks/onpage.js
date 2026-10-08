import { hammingDistance } from '../crawler/parsePage.js';

const mk = (checkId, severity, o) => ({ checkId, severity, ...o });

export function runOnPageChecks(crawlResult) {
  const { pages } = crawlResult;
  const findings = [];
  const ok = (p) => p.statusCode === 200;

  // ON-1 missing title
  const noTitle = pages.filter((p) => ok(p) && !p.title);
  if (noTitle.length) findings.push(mk('ON-1', 'error', {
    title: `${noTitle.length} page${noTitle.length > 1 ? 's have' : ' has'} no title tag`,
    why: 'The title tag is the single strongest on-page relevance signal and the clickable headline in search results. A missing title usually becomes the URL — nobody clicks that.',
    fix: `Give each page a unique, descriptive title of 30-60 characters containing the primary keyword. Example: <title>Blue Widgets — Buy Online | Example Co</title>.`,
    evidence: noTitle.map((p) => `${p.url} → no <title> element`),
    affectedUrls: noTitle.map((p) => p.url),
    impact: 2, effort: 1,
  }));

  // ON-2 duplicate titles
  const byTitle = new Map();
  for (const p of pages) {
    if (!ok(p) || !p.title) continue;
    const t = p.title.trim().toLowerCase();
    byTitle.set(t, [...(byTitle.get(t) ?? []), p]);
  }
  const dupTitles = [...byTitle.values()].filter((g) => g.length > 1);
  if (dupTitles.length) findings.push(mk('ON-2', 'warning', {
    title: `${dupTitles.length} title${dupTitles.length > 1 ? 's are' : ' is'} used on multiple pages`,
    why: 'Duplicate titles force search engines to guess which page matches which query, and the pages compete with each other in results.',
    fix: 'Rewrite each duplicate title to be unique and specific to its page content.',
    evidence: dupTitles.map((g) => `"${g[0].title}" on ${g.length} pages: ${g.map((p) => p.url).join(', ')}`),
    affectedUrls: dupTitles.flat().map((p) => p.url),
    impact: 2, effort: 2,
  }));

  // ON-3 title length
  const badLen = pages.filter((p) => ok(p) && p.title && (p.title.length < 30 || p.title.length > 60));
  if (badLen.length) findings.push(mk('ON-3', 'opportunity', {
    title: `${badLen.length} title${badLen.length > 1 ? 's are' : ' is'} too short or too long`,
    why: 'Titles under ~30 characters waste space; over ~60 they get truncated in results. Both reduce click-through.',
    fix: 'Adjust title length to 30-60 characters, front-loading the important words.',
    evidence: badLen.map((p) => `${p.url} → ${p.title.length} chars (${p.title.length < 30 ? 'short' : 'long'}): "${p.title}"`),
    affectedUrls: badLen.map((p) => p.url),
    impact: 1, effort: 1,
  }));

  // ON-4 meta descriptions
  const badDesc = pages.filter((p) => ok(p) && (!p.metaDesc || p.metaDesc.length < 50 || p.metaDesc.length > 160));
  if (badDesc.length) findings.push(mk('ON-4', 'opportunity', {
    title: `${badDesc.length} page${badDesc.length > 1 ? 's need' : ' needs'} a better meta description`,
    why: 'The meta description is your ad copy in search results. Missing or off-length descriptions get auto-generated snippets you do not control.',
    fix: `Write a unique 50-160 character description per page with a reason to click. Example: <meta name="description" content="Compare 12 blue widgets with real buyer reviews and free shipping over $50.">`,
    evidence: badDesc.map((p) => `${p.url} → ${p.metaDesc ? `${p.metaDesc.length} chars` : 'missing'}`),
    affectedUrls: badDesc.map((p) => p.url),
    impact: 1, effort: 2,
  }));

  // ON-5 headings
  const badHead = pages.filter((p) => ok(p) && (p.h1Count !== 1 || hasHeadingSkip(p.headings)));
  if (badHead.length) findings.push(mk('ON-5', 'warning', {
    title: `${badHead.length} page${badHead.length > 1 ? 's have' : ' has'} heading structure problems`,
    why: 'Exactly one H1 and hierarchically ordered headings (h2 under h1, h3 under h2) help both accessibility and search engines understand page structure.',
    fix: 'Use a single H1 with the page topic, then nest sections in h2/h3 without skipping levels.',
    evidence: badHead.map((p) => {
      const probs = [];
      if (p.h1Count !== 1) probs.push(`${p.h1Count} H1 tags`);
      if (hasHeadingSkip(p.headings)) probs.push('skipped heading level');
      return `${p.url} → ${probs.join(', ')}`;
    }),
    affectedUrls: badHead.map((p) => p.url),
    impact: 1, effort: 2,
  }));

  // ON-6 thin content
  const thin = pages.filter((p) => ok(p) && p.wordCount < 150 && !isUtilityPage(p.url));
  if (thin.length) findings.push(mk('ON-6', 'opportunity', {
    title: `${thin.length} page${thin.length > 1 ? 's have' : ' has'} thin content (<150 words)`,
    why: 'Pages with very little text rarely answer a query well enough to rank, and clusters of them drag down site-wide quality perception.',
    fix: 'Expand thin pages with substantive, original content, or consolidate them into a stronger page and redirect. Delete pure placeholder pages.',
    evidence: thin.map((p) => `${p.url} → ${p.wordCount} words`),
    affectedUrls: thin.map((p) => p.url),
    impact: 1, effort: 3,
  }));

  // ON-7 near-duplicate content (simhash hamming <= 3)
  const dupGroups = [];
  const matched = new Set();
  for (let i = 0; i < pages.length; i++) {
    if (matched.has(i) || !pages[i].simhash || !ok(pages[i])) continue;
    const g = [pages[i]]; matched.add(i);
    for (let j = i + 1; j < pages.length; j++) {
      if (matched.has(j) || !pages[j].simhash || !ok(pages[j])) continue;
      if (hammingDistance(pages[i].simhash, pages[j].simhash) <= 3) { g.push(pages[j]); matched.add(j); }
    }
    if (g.length > 1) dupGroups.push(g);
  }
  if (dupGroups.length) findings.push(mk('ON-7', 'warning', {
    title: `${dupGroups.length} group${dupGroups.length > 1 ? 's' : ''} of near-duplicate content`,
    why: 'Near-identical pages split ranking signals across copies and can trigger content-quality filters. Only one version tends to rank — rarely the one you want.',
    fix: 'Consolidate duplicates into a single strong page (301 the rest), or differentiate them genuinely (unique intro, data, formatting).',
    evidence: dupGroups.map((g) => g.map((p) => `${p.url} (${p.wordCount}w)`).join(' ≈ ')),
    affectedUrls: dupGroups.flat().map((p) => p.url),
    impact: 2, effort: 3,
  }));

  // ON-8 image alt text
  const badAlt = pages.filter((p) => ok(p) && p.imagesMissingAlt > 0);
  if (badAlt.length) {
    const total = badAlt.reduce((s, p) => s + p.imagesMissingAlt, 0);
    findings.push(mk('ON-8', 'opportunity', {
      title: `${total} image${total > 1 ? 's' : ''} missing alt text across ${badAlt.length} page${badAlt.length > 1 ? 's' : ''}`,
      why: 'Alt text is how search engines and screen readers understand images; it also lets images rank in image search.',
      fix: 'Describe each image in a few words (decorative images get alt=""). Example: <img src="blue-widget.jpg" alt="Blue titanium widget on workbench">',
      evidence: badAlt.map((p) => `${p.url} → ${p.imagesMissingAlt}/${p.imgTotal ?? '?'} images missing alt`),
      affectedUrls: badAlt.map((p) => p.url),
      impact: 1, effort: 1,
    }));
  }

  // ON-9 non-descriptive URLs
  const ugly = pages.filter((p) => ok(p) && isUglyUrl(p.url));
  if (ugly.length) findings.push(mk('ON-9', 'opportunity', {
    title: `${ugly.length} URL${ugly.length > 1 ? 's are' : ' is'} not descriptive`,
    why: 'Deep paths, uppercase letters, and long query strings make URLs harder to read, link, and trust — for users and crawlers alike.',
    fix: 'Keep URLs lowercase, under 3 directory levels, with hyphenated keywords instead of parameters where possible.',
    evidence: ugly.map((p) => `${p.url} → ${urlProblems(p.url).join(', ')}`),
    affectedUrls: ugly.map((p) => p.url),
    impact: 1, effort: 2,
  }));

  // ON-10 internal links to redirects / broken targets
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const badLinks = new Map();
  for (const p of pages) {
    for (const l of p.linksOut) {
      const t = byUrl.get(l);
      if (!t) continue;
      if (t.statusCode >= 400 || t.redirectChain.length > 1) {
        badLinks.set(l, { from: p.url, to: t });
      }
    }
  }
  if (badLinks.size) findings.push(mk('ON-10', 'error', {
    title: `${badLinks.size} internal link${badLinks.size > 1 ? 's point' : ' points'} to redirects or broken pages`,
    why: 'Internal links to 4xx pages waste PageRank and break user journeys; links through redirects leak equity at every hop.',
    fix: 'Update the link to point at the final 200-OK URL. Example: link to the redirect target, not the old URL.',
    evidence: [...badLinks.entries()].map(([l, v]) => `${v.from} → ${l} (HTTP ${v.to.statusCode}${v.to.redirectChain.length > 1 ? ', redirected' : ''})`),
    affectedUrls: [...badLinks.keys()],
    impact: 3, effort: 1,
  }));

  // ON-11 lang / hreflang
  const langProblems = [];
  for (const p of pages) {
    if (!ok(p)) continue;
    if (!p.lang) langProblems.push(`${p.url} → no lang attribute`);
    if ((p.hreflang ?? []).length && !hasReciprocal(p, pages)) {
      langProblems.push(`${p.url} → hreflang ${p.hreflang.join(',')} without reciprocal link`);
    }
  }
  if (langProblems.length) findings.push(mk('ON-11', 'warning', {
    title: `${langProblems.length} language annotation problem${langProblems.length > 1 ? 's' : ''}`,
    why: 'A missing lang attribute hurts accessibility and language detection; hreflang without reciprocal annotations is ignored by search engines.',
    fix: 'Add lang="xx" to <html>, and ensure every hreflang pair references its counterparts with return-link tags.',
    evidence: langProblems,
    affectedUrls: [],
    impact: 1, effort: 2,
  }));

  return findings;
}

function hasHeadingSkip(headings = []) {
  const levels = headings.map((h) => Number(String(h).replace(/\D/g, ''))).filter((n) => n >= 1 && n <= 6);
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) return true;
  return false;
}

function isUtilityPage(url) {
  return /\.(css|js|ico|png|jpe?g|gif|svg|pdf|xml|txt|zip)$/i.test(url) || /\/(wp-admin|cart|checkout|login)\b/i.test(url);
}

function isUglyUrl(url) { return urlProblems(url).length > 0; }

function urlProblems(url) {
  const probs = [];
  try {
    const u = new URL(url);
    if (u.pathname.split('/').filter(Boolean).length > 3) probs.push('deep path');
    if (/[A-Z]/.test(u.pathname)) probs.push('uppercase');
    if ([...u.searchParams].length >= 2 || u.search.length > 40) probs.push('long query string');
  } catch { /* ignore */ }
  return probs;
}

function hasReciprocal(page, pages) {
  // heuristic: an hreflang declaration is only "reciprocal" if the page links
  // to at least one other crawled page (the alternate version); the full
  // verification needs the alternate page to declare back, but cross-page
  // hreflang lives in <head> link tags which we model as linksOut=none.
  return page.linksOut.some((l) => pages.some((p) => p.url === l));
}
