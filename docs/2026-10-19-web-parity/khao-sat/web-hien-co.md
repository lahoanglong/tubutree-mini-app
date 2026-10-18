# Khảo sát scout: web-hien-co

(Báo cáo nguyên văn của agent quét, chưa kiểm chứng từng dòng.)

Web parity survey, worktree /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity (read-only). Partial: route fetch calls and layout details are from grep, not full reads. Unverified items are marked.

1. ROUTES (apps/web/src/app). S=server, C=client. Auth/roles are not all verified per route.
- / (page.tsx) S, revalidate=300. Home storefront. Mirrors Mini App "/".
- /browse, /cart, /feed, /rewards, /wallet etc.: no web route. Mini App routes are in apps/miniapp/src/components/app.tsx:189-242.
- /san-pham/[slug] (page.tsx) S, revalidate=300. Product detail. Mirrors Mini App /product/:slug. Also product-reviews.tsx (C).
- /product/[slug]/route.ts: route handler (GET, not read in detail). Redirect or legacy product link (unverified).
- /s/[slug] (page.tsx) S, revalidate=300. Storefront view, reached via middleware subdomain rewrite. Mirrors Mini App /s/:slug.
- /s/[slug]/opengraph-image.tsx S, revalidate=300. OG image.
- /brand/[slug] (page.tsx) S, revalidate=300. Brand page. Mirrors /brand/:slug.
- /chinh-sach/[loai] (page.tsx) S, revalidate=300. Legal docs via getLegalDoc (lib/api.ts:388). No Mini App mirror found.
- /gio-hang (page.tsx) C, layout.tsx S. Cart. Mirrors /cart. Guest-capable (sticky-bar.spec.tsx). Calls apiFetch('/cart...') (4 sites).
- /thanh-toan (page.tsx) C, layout.tsx S. Checkout. Mirrors /checkout. Calls apiFetch('/checkout/place-order') (3 sites).
- /tai-khoan (page.tsx) C, layout.tsx S. Account. Auth required. Mirrors /profile. Calls apiFetch('/me'), '/me/addresses'.
- /tai-khoan/don-hang/[code] (page.tsx) C. Order detail. Calls /orders/${code}, /cancel, /return-request, /return-estimate, /repurchase, /orders/me/refunds. Mirrors /order/:code.
- /tai-khoan/dia-chi, /tai-khoan/diem-xanh, /tai-khoan/vi-tubu: C pages with S layouts. Address, loyalty points, wallet. Mirror /addresses, /loyalty, /wallet. Wallet calls /me/wallet/transactions.
- /dang-nhap (page.tsx) C, layout.tsx S. Zalo login button. Mirrors Mini App login implicitly.
- /dang-nhap/callback (page.tsx) C. Reads Zalo code, exchanges via auth-context.
- /merchant (page.tsx) C, layout.tsx S. Merchant portal, web-only. Tabs: store | fulfil | products | settlement | shipping | payoutAccount | orders (merchant/page.tsx:84). Roles: restricted = user.role==='CUSTOMER' (merchant/page.tsx:163). Calls /merchant/store, /merchant/products, /merchant/orders/${id}/status, /merchant/returns/${id}/received, /merchant/fulfil-orders/${id}/${action}.
- /admin (page.tsx) C, layout.tsx S. Admin portal, web-only. Tab keys include: dashboard, orders, returns, users, brands, coupons, flash-sales, faqs, dealers, dealer-claims, cashback, academy, community, engagement, config, attendance, analytics, payouts, quick-replies, ops-access. Calls /admin/* (see API list in section 3 of the grep; e.g. /admin/waste/*, /admin/brands, /admin/flash-sales, /admin/faqs, /admin/users/${id}/unblock).
- /admin/pos (page.tsx) C. POS cashier "Thu ngân · Tích Điểm Xanh tại quầy" (pos/page.tsx:27). Web-only.
- /admin/community: Mini App has the same path (app.tsx:242). Web has community tab in admin.
- /apps/web/src/app/not-found.tsx S. error.tsx C. global-error.tsx C. session-unavailable.spec.tsx exists. No loading.tsx found in the file list.
- robots.ts S. sitemap.ts S, revalidate=3600.
- layout.tsx S (root). providers.tsx (C). apple-icon.png, icon.png, opengraph-image.png, favicon.ico.
- Other route handlers: none beyond product/[slug]/route.ts found (find output).

2. LAYOUT / NAV
- Header: components/site-header.tsx:21. sticky top-0 z-40, safe-area top via env(safe-area-inset-top). Links: / (21-26), /gio-hang with cart count (36-50), /tai-khoan (53-63), /dang-nhap (65-70). Nav aria-label "Điều hướng chính" (35). Uses sm: breakpoint (sm:gap-3), not md.
- Footer: components/site-footer.tsx. tel:, mailto:, external links, /chinh-sach/${slug} (71). No bottom nav found.
- Bottom action bar: components/sticky-action-bar.tsx:42 fixed inset-x-0 bottom-0 z-30 md:hidden. So mobile-only below md (768px). Safe area via safeAreaPadX from lib/safe-area and paddingBottom max(0.75rem, env(safe-area-inset-bottom)). Body class has-sticky-bar and --sticky-bar-h (sticky-action-bar.tsx:22-32).
- viewport-fit=cover set in app/layout.tsx:21 for safe-area.
- Side drawer: components/admin/side-drawer.tsx, user-detail-drawer.tsx, admin-nav.tsx (admin only). No storefront drawer found.
- Mobile vs desktop: md:hidden on sticky bar is the main split. Header is responsive but not split into separate components.

3. AUTH
- lib/auth-context.tsx: React context. accessToken held in React state (useState, line ~29, 180). Refresh token is HttpOnly cookie set by API, JS cannot read it (line 30-31, client-api.ts:5-10). localStorage flag 'tubu_web_session' only says whether to try restore (client-api.ts:9-58). sessionStorage holds PKCE verifier and state (auth-context.tsx:152-192).
- auth-phase.ts:1-20: useAuthPhase() returns 'loading' | 'guest' | 'unavailable' | 'authenticated'.
- client-api.ts (299 lines): apiFetch adds Bearer header (225). On 401, refresh once if session marker exists (243). refreshSession (113) dedupes in-flight and uses a cross-tab lock 'tubu_web_refresh' (75). Refresh 400/401/403 clears marker. Other errors keep it.
- lib/api.ts (412 lines): SSR/public fetches (getProduct 175, getStorefront 210, getLegalDoc 388). BASE from API_BASE_URL or NEXT_PUBLIC_API_BASE_URL, default http://localhost:3001/api (api.ts:8). ApiUnavailableError (20).
- lib/api-ssr.ts: DOES NOT EXIST in this worktree (checked).
- Zalo OAuth: /dang-nhap calls startZaloLogin() (dang-nhap/page.tsx:44) which stores PKCE verifier and state in sessionStorage, then redirects. /dang-nhap/callback exchanges code via /auth/zalo-oauth (client-api.ts:240, opt auth:false). Button says "Đăng nhập với Zalo" (dang-nhap/page.tsx:63). Shows a paused state when zaloLoginConfigured===false (line 24, 80).
- Guest support: yes. Cart and checkout work as guest (gio-hang, thanh-toan). Guest auth gate: app/guest-auth-gate.spec.tsx. Auth-required pages use useAuthPhase.
- 401 handling: described above. Failed refresh gives 'guest' phase, not redirect (unverified whether a redirect exists).
- middleware.ts:1-48: skips /_next, /api, /static, and paths with a dot. Subdomain via lib/tenant-subdomain: sets x-tenant-subdomain header; on "/" rewrites to /s/${subdomain}. No auth redirects in middleware. matcher excludes api, _next/static, _next/image, favicon.ico.

4. DESIGN SYSTEM
- ds-v2-guest.spec.ts: "bánh cóc" (ratchet) list of MIGRATED files to Design System v2 (packages/design-tokens). Migrated files may not regress to v1 palette (orange/lime/neutral), hex literals, or text under 12px. Covers app/page.tsx, app/layout.tsx, app/globals.css, site-header, site-footer, and more. Imports tokens from design-tokens/src/tokens.css (line 71).
- ds-palette-pc11.spec.ts: same ratchet for admin, merchant, brand (PC-11/PD-1). Does not check font size for admin (dense 11px tables allowed). Bans emoji as icons.
- lib/guest-ui.ts:1-35: exports ui (card, pageTitle, sectionTitle, backLink, field, fieldError, btnPrimary, btnSecondary, btnText, error) and uiBar. Min tap target min-h-11 (44px). Uses rounded-control, rounded-card, shadow-card, stone-450 border for WCAG 1.4.11.
- tailwind.config.ts:3,81-82: presets [tailwindPreset] from @tubutree/design-tokens. content ./src/**/*.{ts,tsx}. Colors forest/sage/stone/honey/terracotta, promo and danger/success tokens. Legacy block for admin/merchant. plugins: [] (line 91).
- Icons: lucide-react only (63 imports).
- globals.css:1-2 imports design-tokens fonts.css and tokens.css.
- UI primitives in components/: add-to-cart, address-form, coupon-box, empty-state, flash-price, geo-picker, login-required, pdp-price, pdp-selection, product-card, product-gallery, product-pagination, referral-code-box, settlement-table, share-button, site-header, site-footer, site-search, sticky-action-bar, storefront-tracker, legal-markdown, copy-button, evidence-upload. components/admin/ has ~50 tab/panel components plus admin-nav.tsx and confirm-dialog.tsx. No components/ui/ folder.

5. ADMIN / MERCHANT / POS
- /admin: see route list above (tabs from admin/page.tsx). admin/layout.tsx S. Side drawer nav admin-nav.tsx.
- /merchant: tabs store | fulfil ("Đơn cần giao") | products ("Sản phẩm") | orders ("Đơn qua gian hàng") | settlement ("Đối soát") | shipping | payoutAccount. Customer-role gets only settlement/fulfil (restricted).
- /admin/pos: cashier view for in-store Điểm Xanh.

6. TESTS
- vitest.config.mts: environment node, alias @ -> src, include src/**/*.spec.ts(x) and tailwind.config.spec.ts. esbuild jsx automatic. No separate test-utils file found in grep (unverified).
- 189 spec files under apps/web/src, about 36,000 lines total (about 190 lines per spec). Spec naming: colocated, <name>.spec.tsx next to source (e.g. app/gio-hang/page.spec.tsx). Some route specs use -<topic> suffix.
- Count of `it(`/`test(` declarations at line start: 2241. (A looser grep gave 188 matching lines, which is the wrong measure.)
- a11y: app/guest-pages.a11y.spec.tsx. Ratchet specs: ds-v2-guest, ds-palette-pc11, merchant-no-guest-entry, middleware.spec, page-titles.spec, sitemap.spec.

7. SEO
- metadata: generateMetadata/metadata used on public routes (not enumerated per file).
- noindex: lib/home-seo.ts comment mentions search page noindex. gio-hang/layout.tsx:3 and thanh-toan/layout.tsx:3 say they block indexing "như /tai-khoan (xem app/robots.ts)".
- robots.ts: disallow PRIVATE_PATHS and each with trailing slash (robots.ts:10-16). PRIVATE_PATHS (lib/site.ts:16) = /admin, /merchant, /tai-khoan, /gio-hang, /thanh-toan, /dang-nhap. sitemap at ${SITE_URL}/sitemap.xml.
- sitemap.ts:23-37: home (priority 1, daily), /san-pham/${slug} (priority 0.7, weekly), /s/${slug} storefronts (updatedAt from getStorefrontList). Revalidate 3600.

Gaps: not every route layout was read. Mini App mirror mapping is by path name only, not checked by file. Auth redirect behaviour for logged-out users on /tai-khoan is unverified.
