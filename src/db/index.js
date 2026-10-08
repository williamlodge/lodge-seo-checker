import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

const PAGE_JSON_FIELDS = ['redirect_chain', 'hreflang', 'links_out'];

function token22() {
  return crypto.randomBytes(17).toString('base64url').slice(0, 22); // 22 chars, url-safe
}

export function openDb(path) {
  const db = new Database(path);
  db.exec(SCHEMA);
  db.pragma('journal_mode = WAL');

  const api = {
    upsertDomain(host) {
      const info = db.prepare(
        `INSERT INTO domains (host, first_seen) VALUES (?, datetime('now'))
         ON CONFLICT(host) DO UPDATE SET last_scanned = last_scanned RETURNING id, host`
      ).get(host);
      return info ?? db.prepare('SELECT id, host FROM domains WHERE host = ?').get(host);
    },

    createScan({ domainId, requestedUrl, options }) {
      const share_token = token22();
      const info = db.prepare(
        `INSERT INTO scans (domain_id, requested_url, status, options_json, share_token, created_via)
         VALUES (?, ?, 'queued', ?, ?, 'web')`
      ).run(domainId, requestedUrl, JSON.stringify(options ?? {}), share_token);
      return { id: info.lastInsertRowid, share_token };
    },

    updateScanStatus(id, patch) {
      const cols = [];
      const vals = [];
      for (const [k, v] of Object.entries(patch)) {
        cols.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      db.prepare(`UPDATE scans SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
    },

    getScan(id) {
      return db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
    },

    getReportByToken(token) {
      return db.prepare('SELECT * FROM scans WHERE share_token = ?').get(token);
    },

    insertPages(scanId, pageRecords) {
      const stmt = db.prepare(
        `INSERT INTO pages (scan_id, url, status_code, redirect_chain, depth, title, meta_desc,
           canonical, robots_meta, h1_count, word_count, lang, hreflang, simhash, links_out,
           images_missing_alt, bytes_html, fetched_at)
         VALUES (@scan_id, @url, @status_code, @redirect_chain, @depth, @title, @meta_desc,
           @canonical, @robots_meta, @h1_count, @word_count, @lang, @hreflang, @simhash, @links_out,
           @images_missing_alt, @bytes_html, @fetched_at)`
      );
      const run = db.transaction((rows) => {
        for (const r of rows) {
          const row = { scan_id: scanId, fetched_at: new Date().toISOString(), ...r };
          row.depth ??= 0;
          row.status_code ??= null;
          for (const k of ['title', 'meta_desc', 'canonical', 'robots_meta', 'lang', 'simhash']) row[k] ??= null;
          for (const k of ['h1_count', 'word_count', 'images_missing_alt', 'bytes_html']) row[k] ??= 0;
          for (const f of PAGE_JSON_FIELDS) row[f] = JSON.stringify(row[f] ?? []);
          stmt.run(row);
        }
      });
      run(pageRecords);
    },

    getPages(scanId) {
      const rows = db.prepare('SELECT * FROM pages WHERE scan_id = ?').all(scanId);
      for (const r of rows) for (const f of PAGE_JSON_FIELDS) r[f] = JSON.parse(r[f] ?? '[]');
      return rows;
    },

    insertFindings(scanId, findings) {
      const stmt = db.prepare(
        `INSERT INTO findings (scan_id, check_id, severity, payload_json, impact, effort)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const run = db.transaction((rows) => {
        for (const f of rows) {
          stmt.run(scanId, f.checkId, f.severity, JSON.stringify(f.payload ?? f), f.impact, f.effort);
        }
      });
      run(findings);
    },

    getFindings(scanId) {
      const rows = db.prepare('SELECT * FROM findings WHERE scan_id = ?').all(scanId);
      for (const r of rows) r.payload = JSON.parse(r.payload_json ?? '{}');
      return rows;
    },

    insertLead({ scanId, email, domainId, ipHash }) {
      db.prepare(
        `INSERT INTO leads (scan_id, email, domain_id, ip_hash, source) VALUES (?, ?, ?, ?, 'web')`
      ).run(scanId, email, domainId, ipHash);
    },
  };

  return api;
}
