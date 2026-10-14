import { h, render } from './vendor/preact.module.js';
import { useState, useEffect, useCallback, useMemo } from './vendor/hooks.module.js';
import htm from './vendor/htm.module.js';
// alias htm bound to preact h
const html = htm.bind(h);

const api = async (path, opts) => {
  const res = await fetch(path, opts && { headers: { 'content-type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};

function Landing({ onStart }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onStart(await api('api/scan', { method: 'POST', body: JSON.stringify({ url }) })); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };
  return html`
    <div class="wrap">
      <p class="brand">WL — 02 / WEB TOOL</p>
      <h1>See what your site<br /><em>is missing.</em></h1>
      <p class="sub">Scan up to 100 pages for search, technical and AI crawler issues. Get a prioritized task list with the affected URLs, evidence and a concrete fix for every finding.</p>
      <div class="panel">
        <form class="prompt" onSubmit=${submit}>
          <input placeholder="https://yourdomain.com" value=${url}
                 onInput=${(e) => setUrl(e.target.value)} autofocus />
          <button disabled=${busy || !url}>${busy ? 'starting…' : 'audit site'}</button>
        </form>
        ${err && html`<p class="err">${err}</p>`}
      </div>
      <p class="muted">Free to start. Most small sites take about a minute. The full report unlocks with your email.</p>
      <div class="footer">
        Methodology transparency: we check crawling, indexing, on-page and technical signals from raw HTML.
        We do not measure Core Web Vitals field data, backlinks, or keyword rankings.
      </div>
    </div>`;
}

function Progress({ id, onDone }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const st = await api(`api/scan/${id}`);
        setS(st);
        if (st.status === 'done' || st.status === 'error') { clearInterval(t); onDone(st); }
      } catch { /* retry */ }
    }, 700);
    return () => clearInterval(t);
  }, [id]);
  return html`
    <div class="wrap">
      <p class="brand">WL — 02 / AUDIT IN PROGRESS</p>
      <div class="panel">
        <p class="term">
          <b>$</b> lodge-audit --crawl --respect-robots<span class="spin">▊</span>
          ${'\n'}status: ${s?.status ?? 'queued'}
          ${s?.pages_crawled ? `\npages crawled: ${s.pages_crawled}` : ''}
          ${s?.status === 'error' ? '\nsomething went wrong — try again' : ''}
        </p>
      </div>
      <p class="muted">Crawling politely: ~1 request every 2 seconds. Typical small sites finish in under a minute.</p>
    </div>`;
}

function Finding({ f }) {
  return html`
    <details class="finding">
      <summary>
        <span class="badge ${f.severity}">${f.severity}</span>
        <h3>${f.title}</h3>
        <span class="kv">impact <b>${'▲'.repeat(f.impact)}</span>
        <span class="kv">effort <b>${'●'.repeat(f.effort)}</span>
      </summary>
      <div class="body">
        <p class="why">${f.why}</p>
        <p class="fix">${f.fix}</p>
        <div class="evidence">${f.evidence.map((e) => html`<div>${e}</div>`)}</div>
        ${f.affectedUrlCount > 0 && html`<p class="kv" style="margin-top:8px">${f.affectedUrlCount} affected URL${f.affectedUrlCount > 1 ? 's' : ''}${f.affectedUrls.length < f.affectedUrlCount ? ` (showing first ${f.affectedUrls.length})` : ''}</p>`}
        <div class="evidence" style="margin-top:6px">${f.affectedUrls.map((u) => html`<div>${u}</div>`)}</div>
      </div>
    </details>`;
}

function TaskList({ items }) {
  return html`<div>${items.map((f) => html`<${Finding} f=${f} />`)}</div>`;
}

function Health({ health }) {
  return html`
    <div class="counts">
      <div class="count c-error"><b>${health.errors}</b>errors</div>
      <div class="count c-warning"><b>${health.warnings}</b>warnings</div>
      <div class="count c-opportunity"><b>${health.opportunities}</b>opportunities</div>
    </div>`;
}

function Cta() {
  return html`
    <div class="cta">
      <b>Want help fixing these?</b> William Lodge builds and improves sites, search systems and AI workflows —
      <a href="https://williamlodge.com/contact.html">start a conversation</a>.
    </div>`;
}

function Report({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [sev, setSev] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setData(await api(`api/report/${token}`)), [token]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const unlock = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { setData(await api(`api/report/${token}/unlock`, { method: 'POST', body: JSON.stringify({ email }) })); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  const items = useMemo(() => {
    const list = data?.full?.taskList ?? data?.teaser?.items ?? [];
    return list.filter((f) =>
      (sev === 'all' || f.severity === sev) &&
      (!q || f.title.toLowerCase().includes(q.toLowerCase()) || (f.affectedUrls ?? []).some((u) => u.includes(q))));
  }, [data, sev, q]);

  if (err) return html`<div class="wrap"><p class="err">${err}</p></div>`;
  if (!data) return html`<div class="wrap"><p class="term">loading report…</p></div>`;

  return html`
    <div class="wrap">
      <p class="brand">WL — 02 / SITE AUDIT REPORT</p>
      <p class="muted">${data.meta.requested_url} · ${data.meta.pages_crawled} pages crawled
        ${data.meta.crawl_limit_hit ? ' · page limit reached' : ''}</p>
      <${Health} health=${data.health} />

      ${!data.unlocked ? html`
        <div class="panel gate">
          <h2>${data.teaser.items.length ? 'Preview of your top fixes:' : 'No critical issues found.'}</h2>
          <div class="locked-blur"><${TaskList} items=${data.teaser.items} /></div>
          <p>Enter your email to unlock the full prioritized report
             (${data.health.errors + data.health.warnings + data.health.opportunities} findings).</p>
          <form onSubmit=${unlock}>
            <input type="email" placeholder="you@company.com" value=${email}
                   onInput=${(e) => setEmail(e.target.value)} />
            <button disabled=${busy || !email}>${busy ? 'unlocking…' : 'unlock full report'}</button>
          </form>
          <p class="privacy-note">Your email and audited domain are stored with this report so William can follow up about the findings. No newsletter signup. <a href="mailto:hello@williamlodge.com?subject=Audit%20data%20removal">Request removal</a>.</p>
          ${err && html`<p class="err">${err}</p>`}
        </div>` : html`
        <div class="toolbar">
          <select value=${sev} onChange=${(e) => setSev(e.target.value)}>
            <option value="all">all severities</option>
            <option value="error">errors</option>
            <option value="warning">warnings</option>
            <option value="opportunity">opportunities</option>
          </select>
          <input placeholder="search title or URL…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        </div>
        <${TaskList} items=${items} />
        <${Cta} />`}
      <div class="footer">
        Every finding traces to verifiable evidence observed during the crawl. Lighthouse lab data, CrUX field data,
        backlinks and keyword rankings are out of scope for this report.
      </div>
    </div>`;
}

function App() {
  const [scan, setScan] = useState(null); // {id, token}
  const [phase, setPhase] = useState('landing');
  useEffect(() => {
    const m = location.pathname.match(/\/r\/([A-Za-z0-9_-]+)\/?$/);
    if (m) { setScan({ token: m[1] }); setPhase('report'); }
  }, []);
  const content = phase === 'landing'
    ? html`<${Landing} onStart=${(s) => { setScan(s); setPhase('progress'); }} />`
    : phase === 'progress'
      ? html`<${Progress} id=${scan.id} onDone=${() => setPhase('report')} />`
      : html`<${Report} token=${scan.token} />`;
  return html`<div>
    <a class="skip-link" href="#root-content">Skip to audit</a>
    <header class="site-nav">
      <a class="site-brand" href="https://williamlodge.com/"><span class="site-mark">◉</span> WILLIAM LODGE <span class="site-slash">/</span> TOOLS</a>
      <nav aria-label="William Lodge"><a href="https://williamlodge.com/builds.html">Builds</a><a href="https://williamlodge.com/contact.html">Contact</a></nav>
      <a class="site-cta" href="https://williamlodge.com/contact.html">Work with William ↗</a>
    </header>
    <main id="root-content">${content}</main>
  </div>`;
}

render(html`<${App} />`, document.getElementById('root'));
