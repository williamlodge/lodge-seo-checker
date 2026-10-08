# SEO Checker Webapp v1 实施计划

> **面向 Agent 执行者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 按任务逐项实现本计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 一个 Node/Express + SQLite 的 SEO 站点审计服务：访客提交域名 → 爬取 → 26 项检查 → 按 impact×effort 排序的优先任务列表报告，完整报告用 email 门控解锁。

**架构：** 单个 Node 服务承载 API 与静态前端；爬虫模块（BFS、robots 尊重、限额）产出页面记录，分析器是纯函数集合（页面记录集 → findings），SQLite 按 domain→scan→findings 持久化（为付费层预留形状）。

**技术栈：** Node 18+, Express, better-sqlite3, cheerio, robots-parser, vitest, supertest。前端无构建步骤（原生 ES modules + Preact via CDN）。

**规格：** `docs/superpowers/specs/2026-10-07-seo-checker-design.md`（执行者必读，尤其第 4 节检查目录、第 5 节 Finding 模型、第 6 节数据模型、第 7 节限额数值）。

## 全局约束

- 爬取上限：最多 100 页、最大深度 5、单次扫描硬超时 3 分钟、单请求超时 10 秒、重定向最多跟随 5 跳（链路记录）。
- 礼貌限速：每主机不低于 1 req / 2s，robots crawl-delay 若更大则遵从。
- 并发扫描上限 2；每 IP 限流 3 次扫描/小时。
- User-Agent：`Mozilla/5.0 (compatible; ArcadiaAudit/1.0; +https://arcadiawebsolutions.com/audit/bot)`。
- 仅同 host 爬取（v1 排除子域）；URL 规范化去掉 fragment、默认端口、host 小写。
- Finding 字段与 severity 取值（error|warning|opportunity）、impact/effort 1-3、evidence 数组、affectedUrls 在 UI 截断为 50 条，均以规格第 5 节为准。
- 报告顶部输出 = 任务列表按 impact 降序、effort 升序；不得输出无来源的汇总"SEO 分数"。
- 每次扫描前检查 denylist（本机自有域名清单存配置文件）。
- 测试框架 vitest；每个检查函数必须有 fixture 驱动的单元测试。

## Review Focus

- 非法/恶意提交的 URL（非 http(s)、内网地址 127.0.0.1/10.x/192.168.x/169.254.x、`file:`、端口怪异）→ 必须在创建扫描时被拒绝 400，绝不发起爬取。
- robots.txt 缺失/500/格式损坏 → 视为无限制继续爬，不得让扫描失败（TQ-5 出 finding）。
- 重定向循环与超长链 → 记录链路并停止跟随，不得挂死扫描（IDX-4 出 finding）。
- 巨大页面/巨大 HTML（>5 MB）→ 截断处理或跳过解析，不得 OOM。
- 重复扫描与限流绕过（同 IP 换 URL 重复提交）→ 第 4 次/小时内请求返回 429，扫描不创建。

---

### 任务 1：项目脚手架 + URL 规范化

**文件：**
- 新建：`package.json`, `vitest.config.ts`, `src/config.js`
- 新建：`src/lib/normalize.js`, `src/lib/normalize.test.js`

**接口：**
- 产出：`normalizeUrl(input: string) => { href: string, host: string, origin: string }`（去 fragment、剥默认端口、host 小写、无尾斜杠归一——根路径 `/` 保留）；`isPublicHttpUrl(input: string) => boolean`（拒绝非 http(s)、私有/环回 IP、`file:` 等）；`sameHost(a: string, b: string) => boolean`。

- [ ] **步骤 1：初始化项目**

`npm init -y` 后安装 `express better-sqlite3 cheerio robots-parser vitest supertest`（dev: 后两者）。`src/config.js` 导出规格数值常量：`MAX_PAGES=100, MAX_DEPTH=5, SCAN_TIMEOUT_MS=180000, REQUEST_TIMEOUT_MS=10000, MAX_REDIRECTS=5, POLITENESS_MS=2000, MAX_CONCURRENT_SCANS=2, SCAN_RATE_PER_HOUR=3, USER_AGENT`。`npm test` 脚本指向 vitest run。

- [ ] **步骤 2：编写失败的测试**

覆盖：`https://Example.com:443/a#frag` → `https://example.com/a`；`http://example.com` → `http://example.com/`；`isPublicHttpUrl` 对 `https://example.com` 真，对 `file:///etc/passwd`、`https://127.0.0.1/x`、`https://192.168.1.1/`、`https://10.0.0.1/`、`ftp://x/`、`not a url` 假；`sameHost('https://a.com/x','https://a.com/y')` 真、与 `https://sub.a.com/` 假。

- [ ] **步骤 3：运行确认失败 → 实现 → 运行确认通过 → 提交**

运行：`npx vitest run src/lib/normalize.test.js`（预期先 FAIL "cannot find module"，实现后 PASS）。提交 `feat: scaffold + url normalization`。

### 任务 2：SQLite 数据层

**文件：**
- 新建：`src/db/index.js`, `src/db/schema.sql`
- 测试：`src/db/index.test.js`

**接口：**
- 产出：`openDb(path: string) => Database`（执行 schema.sql，幂等）；导出 prepared statements 的薄封装：`upsertDomain(host) => {id}`、`createScan({domainId, requestedUrl, options}) => {id, share_token}`、`updateScanStatus(id, patch)`、`insertPages(scanId, pageRecords[])`、`insertFindings(scanId, findings[])`、`getScan(id)`、`getReportByToken(token)`、`getPages(scanId)`、`getFindings(scanId)`、`insertLead({scanId, email, domainId, ipHash})`。表结构逐字按规格第 6 节（domains/scans/pages/findings/leads）。

- [ ] **步骤 1：失败测试** — 内存库（`openDb(':memory:')`）跑 insert→get 往返：createScan 返回 share_token（22 字符随机）；insertFindings 后 getFindings 按 scanId 取回 payload_json 反序列化结果。
- [ ] **步骤 2：确认失败 → 实现 schema + 封装 → 通过 → 提交** `feat: sqlite data layer`。

### 任务 3：robots.txt 处理

**文件：**
- 新建：`src/crawler/robots.js`, `src/crawler/robots.test.js`

**接口：**
- 产出：`loadRobots(origin: string) => { isAllowed(url): boolean, crawlDelayMs: number, sitemapUrls: string[], fetchError?: string }`。用 robots-parser；robots 请求失败/404/解析异常时 `isAllowed` 恒 true、`crawlDelayMs=0`、`fetchError` 记录原因（供 TQ-5）。请求超时 10s、带 USER_AGENT。

- [ ] **步骤 1：失败测试** — 用 vitest 内置 http server：serve `User-agent: *\nDisallow: /private\nCrawl-delay: 5\nSitemap: https://x/s.xml` → `/private/a` false、`/` true、crawlDelayMs=5000；404 时 isAllowed 恒 true。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: robots loader`。

### 任务 4：单页抓取器（重定向链 + 截断保护）

**文件：**
- 新建：`src/crawler/fetchPage.js`, `src/crawler/fetchPage.test.js`

**接口：**
- 产出：`fetchPage(url: string) => Promise<{ finalUrl: string, status: number, redirectChain: string[], headers: object, body: string, truncated: boolean, error?: string }>`。手动跟随重定向（逐跳记录 URL+status 进 redirectChain，最多 5 跳，超出停止并标记）；body 超 5 MB 停止读取、`truncated=true`；10s 超时；网络错误不 throw，返回 `error` 字段。

- [ ] **步骤 1：失败测试** — 本地 server：200 页、3 跳链、6 跳链（第 6 跳未请求且链长 6 标记截断）、循环 a→b→a（停止）、404、超时（server 不响应）。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: page fetcher with redirect chains`。

### 任务 5：页面解析（HTML → PageRecord）

**文件：**
- 新建：`src/crawler/parsePage.js`, `src/crawler/parsePage.test.js`, `test/fixtures/html/*.html`

**接口：**
- 消费：任务 4 的 fetchPage 结果。
- 产出：`parsePage({ url, finalUrl, status, redirectChain, headers, body }) => PageRecord`，字段=规格 pages 表：title、metaDesc、canonical、robotsMeta（合并 meta 与 X-Robots-Tag）、h1Count、wordCount（去脚本样式后文本）、lang、hreflang[]、simhash（页文本 64-bit Simhash）、linksOut[]（绝对化后同 host 过滤前的全集）、imagesMissingAlt 计数、bytesHtml、jsonld[]（解析成功者；坏 JSON 记录 `invalidJsonld: true`）、mixedContent 计数（HTTPS 页面上 http:// 子资源）。

- [ ] **步骤 1：失败测试** — fixture 覆盖：正常页、缺 title/canonical/lang、多 H1、noindex、坏 JSON-LD、http 图片在 https 页（mixedContent=1）、hreflang 无 reciprocal。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: page parser`。

### 任务 6：爬取编排器（BFS 队列 + 限额）

**文件：**
- 新建：`src/crawler/crawl.js`, `src/crawler/crawl.test.js`

**接口：**
- 消费：任务 1 的 normalize/sameHost、任务 3 loadRobots、任务 4 fetchPage、任务 5 parsePage、config 常量。
- 产出：`crawl(startUrl, { onProgress }) => Promise<{ pages: PageRecord[], sitemapUrls: string[], crawlLimitHit: boolean, robotsFetchError?: string }>`。BFS 按 depth，MAX_DEPTH=5；跳过非 GET 内容类型；队列去重（规范化 URL）；每请求间隔 max(POLITENESS_MS, crawlDelay)；整 Scan 超时 SCAN_TIMEOUT_MS 到期即返回已得页面并标 `crawlLimitHit`；同时抓取 robots 里声明的 sitemap（XML 解析取 <loc>，限 5000 条，失败则 sitemapUrls=[]）。

- [ ] **步骤 1：失败测试** — 本地 fixture 站（嵌套链接树）：验证 BFS 顺序与深度截断、100 页上限（构造 120 链接页面）crawlLimitHit=true、robots disallow 的路径不入队、3 分钟超时用注入的假 timer/极小 SCAN_TIMEOUT_MS 值测试。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: crawl orchestrator`。

### 任务 7：检查器 — Indexability（IDX-1..7）

**文件：**
- 新建：`src/checks/indexability.js`, `src/checks/indexability.test.js`, `test/fixtures/checks/*.json`

**接口：**
- 消费：`crawl()` 结果（pages + sitemapUrls）。
- 产出：`runIndexabilityChecks(crawlResult) => Finding[]`，Finding 结构逐字按规格第 5 节；checkId/severity 逐字按规格第 4 节 IDX 表。IDX-6 孤儿页 = 在 sitemap 但全站 inlinks 为 0；IDX-7 限 401/403 且被站内链接。

- [ ] **步骤 1：失败测试** — 每个 IDX 一组 fixture：构造小型 pages/sitemap 数据断言 severity、affectedUrls、evidence 内容。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: indexability checks`。

### 任务 8：检查器 — On-page（ON-1..11）

**文件：**
- 新建：`src/checks/onpage.js`, `src/checks/onpage.test.js`

**接口：**
- 产出：`runOnPageChecks(crawlResult) => Finding[]`，规格第 4 节 ON 表逐字（title <30 / >60、字数 <150 thin、URL 超 3 级目录/大写/长 query、ON-7 近重复用 simhash 海明距离 ≤3 判重）。

- [ ] **步骤 1：失败测试** — 每项 ON 一组断言；ON-7 用两份 simhash 距离 2 的 fixture 页判重、距离 8 不判。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: on-page checks`。

### 任务 9：检查器 — Technical（TQ-1..8）

**文件：**
- 新建：`src/checks/technical.js`, `src/checks/technical.test.js`

**接口：**
- 产出：`runTechnicalChecks(crawlResult, robotsInfo) => Finding[]`，规格第 4 节 TQ 表逐字。TQ-8：robots.txt 内容匹配 `GPTBot|ClaudeBot|PerplexityBot|CCBot` 的 Disallow: / → opportunity 级 GEO 告警，evidence 引用具体行。TQ-3 阈值：图片 >500 KB、HTML >3 MB。TQ-1 混合内容已由 PageRecord.mixedContent 提供。

- [ ] **步骤 1：失败测试** — 每项 TQ 一组 fixture（含 TQ-8 的 robots 文本两种：封禁/未封禁）。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: technical checks`。

### 任务 10：优先级排序 + 报告组装 + teaser 截断

**文件：**
- 新建：`src/report/build.js`, `src/report/build.test.js`

**接口：**
- 消费：任务 7-9 的 Finding 数组。
- 产出：`buildReport(findings, { unlocked }) => { taskList, health: {errors, warnings, opportunities}, teaser, full }`。taskList 排序 impact desc → effort asc → checkId；impact/effort 赋值按规格第 5 节启发式（indexability error=3；warning 覆盖 >10% 页面 +1，上限 3；effort 每检查常量：meta 类=2、canonical 类=3、alt 类=1）；teaser = 前 3 项任务（evidence 截 3 条、affectedUrls 截 5 条）+ 严重度计数，`unlocked=false` 时 full 为 null；affectedUrls UI 截断 50 条带总数。
- 另产出：`diffFindings(prev: Finding[], next: Finding[]) => { new, resolved, regressed }`（阶段 2 用，先落函数与测试）。

- [ ] **步骤 1：失败测试** — 排序（impact/effort 组合）、impact 启发式（同一 warning 影响 12% 页面 bump）、teaser 截断规则、diffFindings 新增/消失/加重三态。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: report builder`。

### 任务 11：扫描服务 + API 路由 + 限流与 denylist

**文件：**
- 新建：`src/server.js`, `src/routes/scan.js`, `src/routes/report.js`, `src/lib/rateLimit.js`, `src/server.test.js`, `denylist.json`

**接口：**
- 消费：任务 1-10 全部产物。
- 产出：Express app。
  - `POST /api/scan {url}` — isPublicHttpUrl 校验（否则 400）、denylist host（400）、每 IP 3 次/小时（第 4 次 429，内存计数即可）、并发 2（超出排队，仍 202 返回 scan id）；异步执行 crawl→checks→buildReport→写库；`onProgress` 更新 scans.status（queued|crawling|analyzing|done|error）与 pages_crawled。
  - `GET /api/scan/:id` — status + 进度计数（done 前不含 findings）。
  - `GET /api/report/:token` — 未解锁返回 teaser；`POST /api/report/:token/unlock {email}` — 校验 email、写 leads、标 unlocked_at、通知邮件（`notifyLead(lead)` 用 nodemailer，SMTP 参数从 env 读，env 缺失时 log 而不报错）、返回 full。
  - 静态服务 `public/`。
- 429/400 的错误体 JSON `{error: string}`。

- [ ] **步骤 1：失败测试（supertest）** — 拒绝 `https://127.0.0.1`（400）；mock crawl（注入 fake）后全流程：创建→轮询 done→teaser 无 full→unlock 后 full 有 taskList；第 4 次创建 429；denylist 域 400。
- [ ] **步骤 2：确认失败 → 实现 → 通过 → 提交** `feat: scan api + rate limiting`。

### 任务 12：前端（无构建）

**文件：**
- 新建：`public/index.html`, `public/app.js`, `public/styles.css`

**接口：**
- 消费：任务 11 的 API。
- 产出：三屏流：落地（URL 表单）→ 进度（轮询 `/api/scan/:id`，显示已爬页数/状态）→ 报告（teaser + 解锁表单 → full：按 severity/类别筛选、URL 搜索、每条 finding 展开 evidence/fix、impact×effort 徽标、Arcadia CTA 面板）。Preact via CDN（esm.sh），终端风样式对齐 arcadiawebsolutions.com 现有设计系统（深底/等宽/绿色强调）。

- [ ] **步骤 1：实现页面**（纯静态 + JS，无测试框架；正确性由任务 13 的 E2E 覆盖）
- [ ] **步骤 2：手动验证** — `npm start` 后浏览器走通三屏（fixture 站或任一低风险真实站）
- [ ] **步骤 3：提交** `feat: frontend`。

### 任务 13：E2E 冒烟 + 部署配置

**文件：**
- 新建：`test/e2e.smoke.test.js`, `ecosystem.config.js`, `deploy/README.md`

**接口：**
- 消费：完整 app。
- 产出：E2E：起 app（随机端口）+ 本地 fixture 站（含 robots、sitemap、若干缺陷页）→ POST /api/scan → 轮询 done → teaser → unlock → 断言 full.taskList 非空且首条为最高 impact。`ecosystem.config.js`：pm2 名 `seo-checker`、端口 5310、`cwd` 指向仓库。deploy/README 记录：VPS 路径 `/home/admin/projects/seo-checker`、LiteSpeed `/audit` 反代 context、夜间 `sqlite3 .backup` 入现有备份轮换。

- [ ] **步骤 1：失败测试 → 实现/接线 → 通过**；运行 `npx vitest run`（全套，预期 PASS）
- [ ] **步骤 2：提交** `feat: e2e smoke + deploy config`。
