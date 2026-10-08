# Deployment — seo-checker

## VPS layout

- Code: `/home/admin/projects/seo-checker` (git clone of this repo)
- Service: pm2 process `seo-checker` on `127.0.0.1:5310` (`ecosystem.config.cjs`)
- DB: `data/seo-checker.db` (SQLite, WAL mode)

## Steps

```bash
# on the VPS, as root
cd /home/admin/projects/seo-checker
npm ci
mkdir -p data
pm2 start ecosystem.config.cjs
pm2 save
```

## Reverse proxy (OpenLiteSpeed)

Add a context to the arcadiawebsolutions.com vhost (WebAdmin → Virtual Host →
Context → add Proxy):

- URI: `/audit/`
- Web Server: `http://127.0.0.1:5310`
- (ensure Express sees the `/audit` prefix — set env `TRUST_PROXY=1` and mount
  the app under the prefix, or rewrite the prefix off at the proxy)

Then the tool lives at `https://arcadiawebsolutions.com/audit/`.

## Backups (nightly, joins existing rotation)

```cron
15 3 * * * sqlite3 /home/admin/projects/seo-checker/data/seo-checker.db ".backup '/root/backups/seo-checker-$(date +\%F).db'"
```

Leads are in the `leads` table — the DB file is the critical asset.
