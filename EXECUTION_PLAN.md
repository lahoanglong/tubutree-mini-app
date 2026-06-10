# EXECUTION PLAN — Đêm 2026-06-10

Mission: đưa miniapp lên chất lượng reference-case. Chất lượng > số lượng.
Trạng thái vào đêm: backend 20 modules hoàn chỉnh (typecheck sạch, 8/8 test pass),
miniapp 9 trang ở mức **skeleton Pass-1** (functional, chưa polish).

## Chẩn đoán nhanh (audit codebase trước khi làm)

| Vấn đề | Mức | Ở đâu |
|--------|-----|-------|
| Token palette SAI so với logo đã chốt (#E08C1C primary) — đang dùng green #2E7D4F | 🔴 Brand | `css/tokens.css` |
| String hard-code trong JSX, vi phạm spec §7.5 (yêu cầu i18n file) | 🔴 | mọi page |
| Spinner full-page thay vì skeleton (vi phạm §7.7) | 🔴 UX | mọi page |
| Empty state chỉ là text/emoji, không illustration + CTA | 🔴 UX | cart, orders, browse |
| Error message lấy thẳng `Error.message` (axios "Request failed with status code 500") | 🔴 UX | mọi mutation |
| Cart qty update không optimistic, không rollback, spam tap = race | 🔴 Bug | cart.tsx |
| Cart qty xuống 0 → gửi PATCH qty=0 (backend reject hoặc xóa ngầm?) | 🔴 Bug | cart.tsx Stepper |
| Checkout không gửi Idempotency-Key dù backend hỗ trợ → double-submit tạo 2 đơn | 🔴 Bug | checkout.tsx |
| Checkout không có points redeem / note / invoice — backend có sẵn | 🟡 Gap | checkout.tsx |
| Form địa chỉ không validate (submit được form rỗng) | 🔴 Bug | checkout.tsx |
| PDP không có gallery (chỉ thumbnail), không qty, không share | 🟡 Gap | product-detail.tsx |
| Touch target < 44pt (nút −/+ 28px, link "Xóa" là Text) | 🔴 A11y | cart.tsx |
| Order detail không có timeline (spec yêu cầu §6.4) | 🟡 Gap | order-detail.tsx |
| Không có animation/microinteraction nào (spec §7.6) | 🟡 Delight | toàn app |
| Cancel đơn không có confirm — 1 tap nhầm là hủy | 🔴 UX | order-detail.tsx |

## Thứ tự thực hiện

### Phase F — Foundation (làm trước, mọi feature phụ thuộc)
- F1 `css/tokens.css` — palette đúng logo (orange #E08C1C primary, green #509018 secondary,
  scale từ M2 design system), motion tokens (200/300ms ease-out), shimmer keyframes,
  `prefers-reduced-motion`, safe-area.
- F2 `i18n/vi.ts` — toàn bộ UI copy theo Voice & Tone §7.5 (bảng từ vựng bắt buộc).
- F3 `services/api.ts` — chuẩn hóa lỗi: AxiosError → message Việt thân thiện
  (timeout → "Hơi chậm tí…", 500 → "Có chút trục trặc…", network → "Mất kết nối…").
- F4 Primitives: `Skeleton`, `EmptyState`, `haptic.ts` (zmp-sdk vibrate), `PriceText`.

### Tier S (đêm nay, 5-pass mỗi feature)
| # | Feature | Lý do ưu tiên |
|---|---------|---------------|
| S1 | Home | First impression của Persona A |
| S2 | PDP | Decision moment — gallery, variation, stock |
| S3 | Cart | Transaction critical — optimistic + race-free |
| S4 | Checkout | Tiền thật — idempotency, validation, success moment |
| S5 | Orders + Detail | Trust building — timeline, cancel an toàn |

### Tier A (nếu còn thời gian / phiên sau)
- Vườn Xanh polish (FULL CREATIVE LICENSE) — game.tsx hiện 207 dòng cơ bản.
- Affiliate Dashboard (API sẵn, FE chưa có).
- Loyalty visual (cây phát triển) trong profile.

### Tier B/C (phiên sau)
- Profile mở rộng, Notifications, Wishlist, Search nâng cao.
- Dealer mode (theme navy riêng), Cashback UI.

## Định nghĩa Done cho mỗi feature
1. Typecheck + lint sạch, build pass.
2. Mọi async có skeleton/loading + error state thân thiện + retry.
3. Empty state có illustration (SVG inline) + copy đúng §7.7 + CTA.
4. Touch target ≥ 44pt, aria-label cho icon-only.
5. Copy 100% từ `i18n/vi.ts`, đúng bảng từ vựng.
6. Animation 200-400ms ease-out, tôn trọng reduced-motion.
7. Không race condition khi double-tap (disabled/pending guard).

## Quyết định scope có chủ đích
- KHÔNG đổi backend đêm nay (đã verify sạch) — trừ khi FE cần endpoint thiếu.
- KHÔNG thêm thư viện animation nặng (bundle <1MB) — CSS transitions + zmp-ui là đủ.
- Checkout giữ single-page sections (không 3 màn riêng) — xem DESIGN_IMPROVEMENTS.md #2.
- Vitest cho miniapp để phiên sau (ưu tiên UX trước, build+typecheck là verify gate đêm nay).
