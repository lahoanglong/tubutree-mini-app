# Design System v2 — follow-ups for sub-project 4+

Carried over from the sub-project 3 review ledger (deleted after completion).

## Must-do early in sub-project 4
- Migrate the remaining ~35 miniapp pages and the web shop, then delete the temporary "legacy v1 -> v2 alias" block in `apps/miniapp/src/css/tokens.css`.
- Guard against pilot pages / `components/ui` using old variable names (`--neutral-*`, `--primary-*`, ...). — started in 4a (Task 22, 4a files only)
- Button label `overflow:hidden` clips ~1.3px off double-diacritic capitals ("Ẩ", "Ấ", "Ổ"): add `padding-block:3px; margin-block:-3px` to the label rule in `tokens.css` (`.tubu-btn` label) before migrating buttons such as "Ẩn". — done in 4a (Task 8)
- Button: put `aria-busy`/`aria-disabled` before the props spread so callers can override; add a synchronous `useRef` lock with timeout fallback for the double-tap race (backend idempotency key is the current backstop). — aria-order half done in 4a (Task 8); the `useRef` lock half is still open
- Keyboard a11y helper for clickable non-button elements (role/tabIndex/Enter+Space); recurring pattern in cart/order rows and cart badge.
- Narrow the `--zaui-*` allowlist in `scripts/check-undefined-css-vars.mjs` to `zaui-safe-area-`. — done in 4a (Task 8)
- Sticky-bar e2e at 320px and on order-detail ("Hủy đơn" + "Thanh toán ngay"). — done in 4a (Task 24)

## Deferred review findings
- I2: Tailwind preflight is loaded globally in the miniapp which uses no Tailwind classes; consider `preflight: false` after a screenshot sweep.
- I3: 6 of 8 pilot pages still use ZaUI `Text`; `order-detail.tsx` still hand-builds two ZaUI `Sheet`s.
- I4: pinch-zoom still blocked in `index.html`; no "no inline fontSize" lint rule; no contrast/snapshot Playwright checks; dealer theme is charcoal not navy; logo asset recolor (forest-800/900 + honey dots) not done.
- I5: `tubu-ds/no-raw-color` is bypassable (ternaries, template strings, `border` shorthand, named colors).
- Inter ships weights 400/500 only (bold is synthesized); Chip (32/36px) is under the 44px touch target (`SegmentedTabs` is now 44px, fixed in 4a Task 18); `STATUS_COLOR`/`STATUS_TONE` parallel maps; dead `Txt/Stack/Row/Btn` in `primitives.tsx`; brand grid labels use `b.name` not `product.brand`; wishlist heart 32x32 hit area.

## Buy-flow 4a follow-ups
- PDP `CartButton` / `useCartCount` swap is deferred to 4c (spec §3.5); the PDP still uses its own cart badge.
- Orders tab list deviates from the spec: an extra "Chờ thanh toán" tab, and grouped "Đang xử lý" / "Đã hủy/hoàn" tabs.
- The Orders tab selection is local state and is not URL-synced (`?tab=` is read once on mount).
- `OrderCard` reorder wrapper leaves a dead zone: the full-width wrapper sits beside the "Mua lại" button and taps there do nothing.
- Order detail cancel flow has a stale window: await the refetch before closing the sheet, and show the error state only for `order.isError && !order.data`.
- `ReorderSheet` minors: content empties during the close animation, one frame of stale selection after the target changes, `onClose` is called inside the try/catch.
- Notifications reminder minors: a stale async action can still resolve after navigation, the ref guard should reset in try/finally, and the lookup should use `items.find(variationId)`.
- Purchased-rail sheet unmounts if the refetch empties the rail while the sheet is open.
- `TILE_HEIGHT = 337` in `purchased-rail.tsx` is a magic number tied to the tile layout; derive it or re-measure when the tile changes.
- Flaky-under-load unit specs (`subscriptions-panel` "Hủy" sheet test, `cart-button`): raise the timeouts or split the tests.
- Optional: prefetch the Orders route chunk on `/orders` navigation intent.
- For-you candidate query uses `take: 200` over an unordered window; add an ordering or a bounded, deterministic window.
- `RANGES` validation for the `shipping.eta_min_days` / `shipping.eta_max_days` config keys is missing.
- The Button `useRef` double-tap lock half (see "Must-do") is still open.
- Pre-existing, unrelated to 4a: `order-cancel.race-spec.ts` case (b) fails intermittently with Prisma P2028 (transaction start timeout) when 20 concurrent transactions hit the local pool; reproduced on the pre-4a baseline `fdd5550`.

## Deploy notes
- New public field `inStock` on storefront/brand product payloads (additive; miniapp treats a missing field as in stock). Deploy API before miniapp.
- Order-success ETA line (spec 4a.5) is OFF until the owner sets two config keys; there is deliberately no seed default (Ruling 9) and the admin "Cấu hình" tab only lists existing rows, so set them with the admin config write (ADMIN role, JWT): `PUT /api/admin/config` with body `{"key":"shipping.eta_min_days","value":2}` and again with `{"key":"shipping.eta_max_days","value":4}` (example values; the owner decides). Rules: integer days, 0-60 (the API rejects anything outside; `SystemConfigService.RANGES`), both keys required and `min <= max`, otherwise the public config returns `shippingEta: null` and the miniapp hides the line. Deploy the API (public config `shippingEta` + RANGES) before the miniapp.
- The 4a miniapp sends `group=processing|closed` to `GET /orders` for the "Đang xử lý" and "Đã hủy/hoàn" tabs. An API older than 4a answers 400 (global ValidationPipe `forbidNonWhitelisted`), so those two tabs show the error state. Deploy the API first, and do NOT roll the API back below 4a while the 4a miniapp is live.
- Web keeps its old palette and default Tailwind spacing; the shared preset no longer overrides spacing.
- Branch is not pushed or deployed.
