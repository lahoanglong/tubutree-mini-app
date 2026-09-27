# Audit environment (isolated, screenshot-ready)

A fully local copy of Tubu Tree with realistic Vietnamese test data, used to screenshot every screen
as real personas. It never touches the owner's dev setup.

| Piece | Audit env | Owner's dev (never touched) |
|---|---|---|
| Postgres (`tubu_pg`, host port 5434) | database **`tubutree_audit`** | database `tubutree` |
| Redis (`tubu_redis`, localhost:6381) | **DB index 5** (`redis://localhost:6381/5`) | DB 0 |
| API (NestJS) | **http://localhost:3201/api**, compiled to `.audit/api-dist`, CWD `.audit/api-run` | :3001, `apps/api/dist` |
| Miniapp (Vite) | **http://localhost:3213**, cache `.audit/vite-cache` | :3113, `apps/miniapp/node_modules/.vite` |
| Web (Next.js) | **http://localhost:3212**, snapshot copy `.audit/web` (own `.next`) | :3112, `apps/web/.next` |
| JWT secrets | dedicated random secret in `.audit/api.env` | `apps/api/.env` |

All third-party integrations are blank in the audit API (Pancake, Zalo/ZNS/OA, ZaloPay, AccessTrade,
DeepSeek/Gemini, Gomdon, SMTP/SMS). Features that need them show their "not configured" state:
address geo-picker (Pancake geo), AI advisor, ZaloPay checkout, Zalo OAuth on the web, Gomdon waybill
creation.

## Files

| File | Purpose |
|---|---|
| `build-audit-env.mjs` | Builds `.audit/api.env` (+ `.audit/api-run/.env`) from `apps/api/.env`: DB → `tubutree_audit`, Redis DB 5, PORT 3201, CORS for :3213/:3212, integration keys blanked, dedicated JWT secret. `--print-db` prints only the audit `DATABASE_URL`. |
| `api-preload.cjs` | `node -r` preload for the audit API. Copies **every** key of `.audit/api.env` into `process.env` (blank values included) *before* `@prisma/client` loads — the generated client auto-loads `apps/api/.env` for any missing key (that would be the owner's DB/Redis/keys). Refuses to start unless db=`tubutree_audit`, port=3201, redis db=5. Also disables the ThrottlerGuard unless `-KeepThrottle`. |
| `tsconfig.audit-api.json` | Compiles `apps/api/src` into `.audit/api-dist`. |
| `vite.audit.config.mts` | Wraps `apps/miniapp/vite.config.mts`: port 3213 (strict), own cache dir, loopback bind. |
| `seed-audit-personas.ts` | Idempotent persona seed (refuses unless the DB is `tubutree_audit`); rewrites `personas.json` + `routes.json`; `--tokens-only` re-mints tokens only. |
| `start-audit-env.ps1` / `stop-audit-env.ps1` | Start detached (logs in `.audit/logs`, PIDs in `.audit/pids.json`) / stop exactly those PIDs. |
| `personas.json` | Per persona: userId, role, tokens, exact storage/cookie entries. **Generated.** |
| `routes.json` | Every miniapp + web route with concrete params, personas and query variants. **Generated.** |

## Rebuild the database from scratch

PowerShell (repo root):

```powershell
node scripts/audit/build-audit-env.mjs
docker exec tubu_pg psql -U tubu -d postgres -c "DROP DATABASE IF EXISTS tubutree_audit" -c "CREATE DATABASE tubutree_audit"
docker exec tubu_redis redis-cli -n 5 FLUSHDB          # only DB 5 (audit); never FLUSHALL
cd apps/api
$env:DATABASE_URL = node ../../scripts/audit/build-audit-env.mjs --print-db   # …/tubutree_audit?schema=public
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm exec tsx ../../scripts/audit/seed-audit-personas.ts
Remove-Item Env:DATABASE_URL
cd ../..
```

Git Bash: prefix the `docker exec` lines with `MSYS_NO_PATHCONV=1` and use
`export DATABASE_URL="$(node ../../scripts/audit/build-audit-env.mjs --print-db)"`.

`DATABASE_URL` must be set in the environment (not only in a file) for `prisma` and `tsx`: the
generated Prisma client otherwise falls back to `apps/api/.env` = the owner's DB. The persona seed
reads `.audit/api.env` itself if `DATABASE_URL` is unset, and exits unless the database name is
exactly `tubutree_audit`.

Re-running only `seed-audit-personas.ts` is safe at any time (the API can stay up): it deletes what
the audit users own and recreates it with dates relative to "now" (e.g. "delivered 3 days ago"
stays inside the 7-day return window), then re-mints tokens and regenerates `personas.json` and
`routes.json` (order codes change with the dates).

## Start / stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\start-audit-env.ps1            # build API + start + wait for health
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\start-audit-env.ps1 -SkipBuild # reuse .audit/api-dist
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\stop-audit-env.ps1
```

* Start refuses if the recorded PIDs are still alive or a port (3201/3212/3213) is taken.
* Health: `http://127.0.0.1:3201/api/health`, `http://127.0.0.1:3213/`, `http://127.0.0.1:3212/`.
  First boot is slow on a busy machine (API module load + first Next/Vite compile: several minutes).
* The web runs from a **snapshot** of `apps/web` synced on every start — restart to pick up web
  source changes. Miniapp and API also reflect the source at start time (API is compiled once).
* `.audit/web/node_modules` is a **junction** to `apps/web/node_modules`. To delete `.audit/web`,
  first remove the junction with `cmd /c rmdir .audit\web\node_modules` (never `Remove-Item -Recurse`
  on it — Windows PowerShell 5.1 can follow the junction and empty the real folder).
* Logs: `.audit/logs/{api,miniapp,web}.{out,err}.log`.
* Rate limits (60 req/min per endpoint, 5/min on `/auth/*`) are **disabled** in the audit API by
  default — otherwise a fast screenshot run gets 429 on `/auth/refresh` and the miniapp silently
  falls back to a *guest* login. `-KeepThrottle` keeps the real limits.

## Personas

| name | who | highlights |
|---|---|---|
| `guest` | no row | miniapp logs in as a brand-new guest via `POST /auth/guest` (onboarding quiz overlay) |
| `new_customer` | Trần Minh Khoa, 0900000001 | onboarded, no orders, welcome voucher |
| `active_customer` | Nguyễn Thị Thu Hà, 0900000002, tier Lộc Biếc | orders in every status (bank-transfer PENDING_PAYMENT, CONFIRMED, PACKED, SHIPPING with GHN tracking + history, DELIVERED, CANCELLED, RETURNED, open return request, Gomdon recycling pickup, paid-with-xu), points ledger, TubuXu, wallet, coupons, wishlist, cart, subscriptions, refill, notifications, game streak 12, season pass, check-in streak, referral, community Q&A, reviews, cashback |
| `ctv` | Lê Hoàng Mai, 0900000003, AFFILIATE | published storefront (3 collections incl. combo), commissions PAID/APPROVED/LOCKED/PENDING/REJECTED, tier "Đồng", 3M milestone claimable, payout history, links + clicks, academy progress, "lên đơn hộ" order |
| `dealer` | Phạm Văn Đức, 0900000004, DEALER_2 | paid + credit orders, backorder (sold-out Can 5L), credit ledger (ORDER/PAYMENT/QUARTER_BONUS), reward claims PENDING/APPROVED/REJECTED/PAID + one claimable, merchant store with a product pending review |
| `brand_owner` | Võ Thanh Tâm, 0900000005 | owns brand Fuwa3e (verified, promotions) |
| `staff` | Đặng Ngọc Lan, 0900000006, STAFF | shifts (approved/pending/rejected/cancelled), closed attendance sessions (one late), payroll (last month PAID), expert answers, POS credit |
| `admin` | Bùi Quốc Anh, 0900000007, ADMIN | admin notifications, grants, everything in /admin |

Background users 0900000011–15 fill the CTV/admin screens (orders via the CTV store, pending dealer
applications, a pending community post + reports, a recycling order needing attention).

## Log a browser in as a persona (outside Zalo)

Always use the hostname **`localhost`** (not 127.0.0.1): zmp-sdk only enables storage when
`location.hostname` contains `localhost`, and the web refresh cookie is host-only for `localhost`.

### How sessions work

* **Miniapp**: access token lives in memory only. On load `restore()` reads the refresh token from
  zmp-sdk storage (= `localStorage["tubu_refresh_token"]`, value encoded as
  `btoa(encodeURIComponent(JSON.stringify(token)))`) and calls `POST /api/auth/refresh`. Without a
  stored token it tries Zalo login (fails in a normal browser) and falls back to `POST /auth/guest`.
* **Web**: refresh token is an HttpOnly cookie `tubu_rt` (path `/api/auth`) set by the API; the web
  only calls `POST /api/auth/refresh` (with `x-client: web`, credentials included) when
  `localStorage["tubu_web_session"] === "1"`.
* Refresh tokens are **single-use** (rotated). Presenting an already-used one makes the API revoke
  **all** sessions of that user. `personas.json` therefore ships a pool of 25 fresh refresh tokens
  per persona: use one per new browser context (or keep one context per persona and navigate inside
  it sequentially). Burned them? `pnpm exec tsx ../../scripts/audit/seed-audit-personas.ts --tokens-only`
  (from `apps/api`) re-mints everything.

### Playwright — storage/cookie method (real refresh flow)

```js
const persona = personas.find((p) => p.name === 'active_customer');
const i = 0; // pool index, one per new context
const miniCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await miniCtx.addInitScript(({ v }) => {
  if (localStorage.getItem('__audit_injected') !== '1') {        // inject ONCE — never re-inject a rotated token
    localStorage.setItem('tubu_refresh_token', v);
    localStorage.setItem('__audit_injected', '1');
  }
}, { v: btoa(encodeURIComponent(JSON.stringify(persona.tokens.refreshTokens[i]))) });
await (await miniCtx.newPage()).goto('http://localhost:3213/profile');

const webCtx = await browser.newContext();
await webCtx.addCookies([{ name: 'tubu_rt', value: persona.tokens.refreshTokens[i + 1], domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
await webCtx.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
await (await webCtx.newPage()).goto('http://localhost:3212/admin');
```

`persona.miniapp.localStorage` / `persona.web.cookies` contain ready-made entries for pool index 0
(miniapp) and 1 (web).

### Playwright — interception method (parallel-safe, no token consumption)

Keep any dummy `tubu_refresh_token` in storage (miniapp) / set `tubu_web_session=1` (web) and answer
the refresh call yourself; every other request goes to the real API with a real 7-day access token:

```js
const alt = persona.miniapp.interceptAlternative; // or persona.web.interceptAlternative
await ctx.route(alt.url, (route) => route.request().method() === 'OPTIONS'
  ? route.continue()
  : route.fulfill({ status: 200, contentType: 'application/json', headers: alt.corsHeaders, body: JSON.stringify(alt.responseBody) }));
```

### Guest

No storage at all → a brand-new guest user each time (onboarding overlay). For an already-onboarded
guest set `localStorage["tubu_device_id"]` to `personas.json → guest.miniapp.variantOnboardedGuest`.

## Routes

`routes.json` lists every miniapp route (`apps/miniapp/src/components/app.tsx`) and web route
(`apps/web/src/app/**`) with concrete parameters from the audit DB (product slugs, an order code per
status, storefront/brand slugs, post and course ids, the bank-payment code), the personas each route
makes sense for, and query variants such as `/admin?tab=orders&recycling=attention` and every
`/admin?tab=…`.

## Notes

* `.audit/` is **not** in `.gitignore` — it holds logs, the generated env (with the audit JWT
  secret), the web snapshot and proofs; do not commit it.
* The audit API keeps running the real cron jobs against the audit DB (e.g. hourly commission
  approval, welcome vouchers, cart reminders); seeded dates are chosen so these do not flip the
  showcased states, but notifications may grow over time. Re-seed to reset.
* `app.miniapp_base_url` is set to `http://localhost:3213` and POS credit is enabled in the audit
  DB's system config so share links and `/admin/pos` are usable.
