# Design System v2 — follow-ups for sub-project 4+

Carried over from the sub-project 3 review ledger (deleted after completion).

## Must-do early in sub-project 4
- Migrate the remaining ~35 miniapp pages and the web shop, then delete the temporary "legacy v1 -> v2 alias" block in `apps/miniapp/src/css/tokens.css`.
- Guard against pilot pages / `components/ui` using old variable names (`--neutral-*`, `--primary-*`, ...).
- Button label `overflow:hidden` clips ~1.3px off double-diacritic capitals ("Ẩ", "Ấ", "Ổ"): add `padding-block:3px; margin-block:-3px` to the label rule in `tokens.css` (`.tubu-btn` label) before migrating buttons such as "Ẩn".
- Button: put `aria-busy`/`aria-disabled` before the props spread so callers can override; add a synchronous `useRef` lock with timeout fallback for the double-tap race (backend idempotency key is the current backstop).
- Keyboard a11y helper for clickable non-button elements (role/tabIndex/Enter+Space); recurring pattern in cart/order rows and cart badge.
- Narrow the `--zaui-*` allowlist in `scripts/check-undefined-css-vars.mjs` to `zaui-safe-area-`.
- Sticky-bar e2e at 320px and on order-detail ("Hủy đơn" + "Thanh toán ngay").

## Deferred review findings
- I2: Tailwind preflight is loaded globally in the miniapp which uses no Tailwind classes; consider `preflight: false` after a screenshot sweep.
- I3: 6 of 8 pilot pages still use ZaUI `Text`; `order-detail.tsx` still hand-builds two ZaUI `Sheet`s.
- I4: pinch-zoom still blocked in `index.html`; no "no inline fontSize" lint rule; no contrast/snapshot Playwright checks; dealer theme is charcoal not navy; logo asset recolor (forest-800/900 + honey dots) not done.
- I5: `tubu-ds/no-raw-color` is bypassable (ternaries, template strings, `border` shorthand, named colors).
- Inter ships weights 400/500 only (bold is synthesized); Chip (32/36px) and SegmentedTabs (40px) are under the 44px touch target; `STATUS_COLOR`/`STATUS_TONE` parallel maps; dead `Txt/Stack/Row/Btn` in `primitives.tsx`; brand grid labels use `b.name` not `product.brand`; wishlist heart 32x32 hit area.

## Deploy notes
- New public field `inStock` on storefront/brand product payloads (additive; miniapp treats a missing field as in stock). Deploy API before miniapp.
- Web keeps its old palette and default Tailwind spacing; the shared preset no longer overrides spacing.
- Branch is not pushed or deployed.
