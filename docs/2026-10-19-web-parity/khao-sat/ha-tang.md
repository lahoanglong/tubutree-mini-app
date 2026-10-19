# Khảo sát scout: ha-tang

(Báo cáo nguyên văn của agent quét, chưa kiểm chứng từng dòng.)

Worktree: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity. Read-only. Secrets not printed.

1. Zalo App ID
- Mini App: no env var. appId is in /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity/apps/miniapp/app-config.json:4 (`"appId": "2070857098114207963"`). apps/miniapp/.env is NOT present in this worktree (docs say it holds APP_ID, ZMP_TOKEN: docs/audit-2026-09/01-ia-navigation.md:83). vite.config.mts reads only VITE_API_TARGET.
- API: `ZALO_APP_ID` declared at apps/api/src/config/env.validation.ts:35 (default ''), read at apps/api/src/modules/auth/zalo.service.ts:42. Also ZALO_APP_SECRET (:43, :112). Listed in apps/api/.env.example:19 and .env.production.example:38.
- Web: `NEXT_PUBLIC_ZALO_APP_ID` read at apps/web/src/lib/auth-context.tsx:68 and apps/web/src/lib/zalo-mini-app.ts:9. Build-time inlined; apps/web/Dockerfile:23-38 fails the build if empty unless ALLOW_EMPTY_ZALO_APP_ID=1. Compose maps ZALO_APP_ID to it: docker-compose.prod.yml:89, docker-compose.vietnix.yml:112.
- Docs: DEPLOY_ZALO.md:16 (appId same value), docs/GO-LIVE-KEYS.md:69 and :96.
- Match: API ZALO_APP_ID value (.env.production.example:38) and Mini App app-config appId are the SAME value (2070857098114207963). They are different variables, not one shared var. Web's NEXT_PUBLIC value is not in the repo; PROD value is an open question (docs/2026-10-18-launch-review/impl/webconv.md:80). Unverified: the web value equals the Mini App id.

2. Token to user id (apps/api/src/modules/auth/zalo.service.ts)
- Mini App: client sends accessToken (from zmp getAccessToken) to POST /auth/zalo-mini-app. getUserInfo() at :74-96 calls GET https://graph.zalo.me/v2.0/me (:76, params fields id,name,picture) with header `access_token`. zaloId = data.id (:93).
- Web OAuth: exchangeOAuthCode() at :41-68 POSTs https://oauth.zaloapp.com/v4/access_token (:50) with app_id, code, code_verifier (PKCE) and header secret_key, gets access_token. auth.service.ts:833-834 then calls getUserInfo(accessToken), i.e. the SAME /me graph call.
- Both flows read `id` from the same endpoint. Whether that id is identical across Mini App and web tokens is a Zalo-side fact not decidable from this repo: unverified.

3. HTTP clients
- apps/miniapp/src/services/api.ts: axios.create({baseURL: VITE_API_BASE_URL ?? localhost:3001/api, timeout 15s}) (:6-13). Token in memory (:23, setAccessToken). Request interceptor (:90-108) waits up to 15s for authReady, then sets `Authorization: Bearer`, X-Device-Id, X-Client-Platform: miniapp. Response interceptor (:110-145): retries GET/HEAD once on 429 if Retry-After <=5s (:116-128); on 401 (not /auth/*) calls onUnauthorized refresh once, deduped via refreshInFlight (:132-142). Refresh token in ZMP storage (store/auth.ts:51). Call shape: `loginZaloMiniApp(code, zaloAccessToken, phoneToken?, referralCode?, firstTouch?) => Promise<LoginResponse>` (:195); also loginGuest, refreshTokens, ensurePhoneApi. Errors: raw AxiosError; getErrorMessage (:152) maps to Vietnamese strings; isOutcomeUnknown (:181), getErrorCode (:188).
- apps/web/src/lib/api.ts (SSR/server, no auth): BASE = API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? localhost:3001/api (:5-6). Plain fetch with serverInit(revalidate) (:39, :57). Throws `ApiUnavailableError(path, status|null)` (:20, :44, :64). Typical call: `getProduct(slug): Promise<ProductDetail|null>` (:175). There is NO apps/web/src/lib/api-ssr.ts (find returned nothing).
- apps/web/src/lib/client-api.ts (client): module-level in-memory accessToken (:28). apiFetch<T>(path, {method, body, auth, cache}) (~:207): sets `Authorization: Bearer` unless auth===false (:225), credentials:'include' (:234) so the HttpOnly refresh cookie goes along. On 401 with session marker, one refreshSession (cookie, lock REFRESH_LOCK :75, dedupe :110-118), then retry (:246). Errors: `ApiError(message, status, code)` (class ~:140; thrown ~:250), `NetworkError` (~:152), 20s timeout (:162). apiDownload (~:257) for file downloads.
- apps/web/src/lib/auth-context.tsx: PKCE verifier and state in sessionStorage (:69, :151-155); starts Zalo login at oauth.zaloapp.com/v4/permission (:158); exchanges code via apiFetch('/auth/zalo-oauth', auth:false) (:174); logout via apiFetch('/auth/logout') (:199). Session marker `tubu_web_session` in localStorage (client-api.ts:9).

4. Duplicated client logic (miniapp <-> web)
- services/cart-key.ts <-> lib/cart-key.ts: DIVERGED. Miniapp uses zustand useStorefrontContext (miniapp cart-key.ts:1,5,19); web uses useSyncExternalStore with ctvSlugFor/getStorefrontContext.
- utils/checkout-rules.ts (157 lines) <-> lib/checkout-rules.ts (92): DIVERGED (web is a subset; miniapp has extra logic).
- utils/checkout-selection.ts (66) <-> lib/checkout-selection.ts (59): DIVERGED (27 changed lines).
- utils/coupon-name.ts <-> lib/coupon-name.ts: IDENTICAL (cmp).
- Money formatting: miniapp utils/format.ts:24 formatVnd (+formatVndShort :108) <-> web lib/format-vnd.ts:2 formatVnd: same name, bodies not diffed here: UNVERIFIED.
- Dates: web lib/format-date.ts (formatDate :24, formatDateTime :30); miniapp equivalent not located by name: no pair found.
- Phone: miniapp utils/phone.ts:6 formatPhoneDisplay; no web phone file by that name: no pair found.
- Points: web lib/checkout-points.ts (pointsSummary :14, checkoutPointsOffer :64, pointsCapState :108); miniapp utils/points-lots.ts, loyalty-copy.ts: no same-named pair: unverified.
- Balances: web lib/balances.ts:8-10 (query keys, invalidateBalances); no miniapp twin found.
- Coupon view: web lib/coupon-view.ts:5 couponValueLabel; no miniapp twin by name.
- Order status labels: miniapp utils/order-status.ts (STATUS_COLOR :12, buyerStatusLabel :136); no web file by that name.
- Ledger labels: web lib/ledger-labels.ts (pointsReasonLabel :101); no miniapp twin by name.
- i18n: miniapp src/i18n/vi.ts (imported by api.ts:3); web has none by that name: web strings are inline.

5. Shared packages
- packages/shared-types/package.json: main ./dist/index.js, types ./dist/index.d.ts, exports "." -> dist; BUILT (needs `build`, tsc). private.
- packages/design-tokens/package.json: main and exports "." -> ./src/index.ts (SOURCE TS); "./css" -> ./src/tokens.css; "./src/fonts.css". peerDep tailwindcss.
- Web: apps/web/next.config.mjs:65 `transpilePackages: ['@tubutree/shared-types']` only (design-tokens not listed). apps/web/tsconfig.json: paths only "@/*" -> ./src/* (:6). Vitest alias '@' at apps/web/vitest.config.mts:8.
- Miniapp: vite.config.mts has no alias or transpile config (only proxy :16); resolves workspace packages through node_modules. Tsconfig extends @tubutree/typescript-config/react.json.
- For packages/app-core importable by both apps and vitest: package.json main/exports to source (like design-tokens) so no build is needed, or dist plus turbo build dependsOn; add "@tubutree/app-core": "workspace:*" to both apps; add it to web next.config transpilePackages if it ships TS source; keep it free of window/React/zmp-sdk/process.env imports so both vitest configs (web vitest.config.mts, miniapp vitest.config.mts) load it without aliases. Web vitest needs the '@' alias only for '@/' imports.

6. Build and CI
- turbo.json: tasks build (dependsOn ^build; outputs dist/**, .next/**), lint/typecheck/test (dependsOn ^build), dev (cache false, persistent), prisma:generate (cache false); globalDependencies tsconfig.base.json and .env.
- pnpm-workspace.yaml: packages apps/*, packages/*. mini_app/ excluded on purpose.
- Root package.json scripts: build, dev, lint, typecheck, test, test:ci (= turbo test --filter=!@tubutree/e2e), format, lint:vars, db:*.
- .github/workflows/ci.yml: triggers workflow_dispatch, push main, pull_request (:7-11). Steps: pnpm install --frozen-lockfile (:36), pnpm db:generate (:39), pnpm typecheck (:42), pnpm lint (:45), pnpm test:ci (:49), pnpm build (:52), bundle budget warning only (:54-57).
- e2e.yml: branches main/master; docker compose -f docker-compose.dev.yml up -d --wait (:44), playwright install (:37), pnpm --filter @tubutree/e2e test (:77).

7. E2E (apps/e2e)
- playwright.config.ts: WEB_URL http://localhost:3112 (:40s), MINIAPP_URL :3113; API port from apps/api/.env PORT (default 3001, :38; E2E_API_PORT overrides).
- Projects (~:80-98): "API" (api.spec.ts), "Web Admin" (admin*.spec.ts), "Web Customer" (testMatch /.*\.web\.spec\.ts/), "Zalo Mini App" (/.*miniapp\.spec\.ts/, iPhone 12).
- E2E_SCOPE: `miniapp` or npm_lifecycle_event test:miniapp (package.json:7) => only the Mini App project and only the Vite webServer (playwright.config.ts:45, :115).
- webServers (~:50-72): api `pnpm --filter @tubutree/api dev` with env PORT; web `pnpm --filter @tubutree/web dev` (web dev script -p 3112, apps/web/package.json:6) with NEXT_PUBLIC_API_BASE_URL; reuseExistingServer = !CI (so a local dev server already on those ports is reused, whatever DB it uses).
- global-setup.ts: miniapp scope returns early with no DB (:102-105). Otherwise reads apps/api/.env JWT_ACCESS_SECRET and DATABASE_URL (:121; process.env wins), seeds an E2E user via seedE2eUser (upsert into that DB), signs a JWT.
- *.web.spec.ts (web-checkout, web-customer): mock API responses in-spec (e.g. web-checkout.web.spec.ts:43, :68); host must be localhost (header comment).
- Safe isolated run: E2E_SCOPE=miniapp (no DB touched) for miniapp specs. For web specs, point DATABASE_URL at a throwaway DB, set E2E_API_PORT to a free port, and CI=1 so no stale server is reused. Do not run them with the default apps/api/.env DATABASE_URL.

8. apps/miniapp/src/services/zmp-bridge.ts (line refs)
- getZaloAccessToken() :59: zmpLogin + getAccessToken, 3 tries, 3s timeout each; breaks at -1401 or timeout. Outside Zalo: throws, caller falls back to guest.
- requestZaloPhoneToken() :84: getPhoneNumber token; outside Zalo or refused: null.
- requestZaloLocation() :97: {token} or null on any error.
- requestZaloLocationStrict() :108: same, but rethrows SDK errors.
- getZaloUserInfo() :115: getUserInfo({autoRequestPermission}); throws on failure, no fallback.
- callPhone(phone) :121: openPhone; fallback window.location.href = tel:.
- isCancelMessage(text) :133: pure, whole-word match against cancel/huy words.
- scanCode() :146: scanQRCode -> {kind:'ok',content} | cancelled (if message is a cancel word) | failed (other errors, or empty content). No throw.
- openExternal(url) :159: openWebview; fallback window.location.href = url.
- openAffiliateLink(url) :168: copies url to clipboard (errors ignored), then location.href; fallback openWebview.
- OA_ID, hasOA :181-182: from VITE_ZALO_OA_ID; empty means hidden.
- openOAChat(message?) :185: no-op without OA id; openChat otherwise; throws on SDK error.
- followOA(oaId=OA_ID) :198: zmpFollowOA; returns false if no id or error; never throws.
- requestNotifyPermission() :212: zmpRequestSendNotification; boolean; never throws.
- getOaPromptState() :236 / setOaPromptState(patch) :250: ZMP storage JSON under tubu_oa_prompt; on error returns default {promptSeen:false,followed:false} / silent no-op.
- shouldShowFollowOaPrompt(params) :269: pure boolean.
- getLaunchReferral() :281: ?ref from location.search or hash query; undefined otherwise.
- shareLink(params) :321: openShareSheet zmp_deep_link with clipped title/description and fallback thumbnail; no try/catch: throws on SDK error.
