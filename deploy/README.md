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

## Reverse proxy (OpenLiteSpeed) — DEPLOYED 2026-10-10

Live at `https://arcadiawebsolutions.com/audit/`. The proxy context is injected
into the arcadia vhosts of `/usr/local/directadmin/data/users/admin/openlitespeed.conf`
(DirectAdmin regenerates this file, so do NOT hand-edit for permanence):

- `arcadiawebsolutions.com.cust_openlitespeed` holds the declarative copy (for
  the next DA template rebuild).
- `/root/ensure_seochecker_ols.sh` (cron, every 10 min) re-injects the block
  and restarts OLS if DA's rewrite drops it.

pm2 start command actually used (ecosystem file's env lacked BASE_PATH):

    BASE_PATH=/audit PORT=5310 SEOCHECKER_DB=/home/admin/projects/seo-checker/data/seo-checker.db \
      pm2 start src/server.js --name seo-checker

Ops notes learned during deploy:
- pm2 rewrites process.argv — the server's entry guard checks `process.env.pm_id` too.
- VPS resolv.conf was pointing only at Tailscale MagicDNS (100.100.100.100) which
  intermittently fails public lookups; public resolvers (1.1.1.1, 8.8.8.8) were
  put first. The scanner's DNS-level SSRF check depends on working resolution.

## Backups (nightly, joins existing rotation)

```cron
15 3 * * * sqlite3 /home/admin/projects/seo-checker/data/seo-checker.db ".backup '/root/backups/seo-checker-$(date +\%F).db'"
```

Leads are in the `leads` table — the DB file is the critical asset.
