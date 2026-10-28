# 04 Quét tĩnh (GĐ1, chỉ đọc mã)

Nguồn số: `docs/2026-10-28-review/tools/static-scan.json` (bản chạy từ `tools/static-scan-gd1.mjs`; `scripts/uiux/static-scan.mjs` gốc lỗi ENOENT vì thiếu thư mục `scripts/uiux/results/`, không sửa). Chưa chụp ảnh, chưa đo máy.

## 1. Tổng quát (static-scan)
- Mini App: 363 file; hex 5 (chỉ `apps/miniapp/src/utils/storefront-theme.ts`: 5); rgb 0; legacy var 0; emoji 102; 68 file dùng component zmp-ui kiểu DS v2.
- Web: 637 file; hex 80; rgb 5; legacy palette 0; neutral 0; green/red/amber… 0; v2 (forest/sage/stone/honey/terracotta) 3772; emoji 138.

## 2. Error boundary và loading
- Mini App: một ErrorBoundary chung bọc toàn app, `apps/miniapp/src/components/app.tsx:188` (đóng :274). Fallback có nút "Thử lại" (`apps/miniapp/src/components/error-boundary.tsx`, `handleRetry` gọi `window.location.reload()`).
- Mini App: không có boundary riêng theo route. Route lazy bọc một `<Suspense fallback={<RouteFallback />}>` tại `app.tsx:199`; `RouteFallback` là Spinner (`app.tsx:102-108`).
- Web: `apps/web/src/app/` có 55 `page.tsx` ngoài admin (danh sách: `tools/web-pages.txt`). Chỉ có 3 file đặc biệt, đều ở gốc: `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`, `apps/web/src/app/not-found.tsx`. Không có `loading.tsx` ở đâu. Mọi page dùng chung `app/error.tsx` (không có error.tsx theo segment, chưa đếm riêng từng route).

## 3. Màu cứng ngoài token (top theo file)
- Mini App: hex 5, 1 file: `apps/miniapp/src/utils/storefront-theme.ts` (5). Không có màu cứng khác.
- Web (hex 80, rgb 5). Top 7 file có hex, bỏ admin:
  - `apps/web/src/app/cau-chuyen/brand-theme.css` 43 (file token thương hiệu, có thể cố ý)
  - `apps/web/src/components/mini/mini.css` 13
  - `apps/web/src/app/s/[slug]/og-card.tsx` 9 (OG image, không phải UI)
  - `apps/web/src/app/merchant/theme-colors.ts` 6
  - `apps/web/src/components/affiliate/storefront-theme.ts` 5
  - `apps/web/src/components/dealer/dealer-theme.css` 3
  - `apps/web/src/lib/storefront-og.ts` 1
- Admin (riêng): chưa đếm theo dòng; `static-scan` đã gồm cả admin trong `apps/web/src/app/admin` và `components/admin`, nên số hex ở trên có thể gồm admin.
- Lớp Tailwind màu cứng (bg-/text- neutral, green, red, amber...): 0 lần ở web.

## 4. Lỗi không có nút thử lại
- `<ErrorState>`: 90 chỗ dùng trong Mini App (`apps/miniapp/src`, bỏ spec). Quét 10 dòng sau mỗi chỗ tìm `onRetry|refetch|Thử lại|retry`: 0 chỗ thiếu. Đây là quét lỏng, chưa đọc từng chỗ.
- File có `isError` nhưng không có `refetch|onRetry|Thử lại|retry` trong file, nên có khả năng hiện lỗi không có hành động thử lại (chưa đọc từng chỗ):
  - Mini App (7): `apps/miniapp/src/components/home/todo-strip.tsx:97` (chỉ tính settled, không hiện lỗi), `components/home/new-customer-gift.tsx:85-86` (ẩn khối khi lỗi), `components/catalog/filter-sheet.tsx:21`, `pages/about.tsx:85` (lỗi support dùng DEFAULT_SUPPORT; `:279` walletQ lỗi), `components/support-hotline.tsx`, `components/support-contact.tsx`, `components/advisor-paused.tsx`.
  - Web khách (`apps/web/src`, không merchant/admin): `app/gioi-thieu/about-view.tsx:176, :271, :277`, `components/community/post-composer.tsx:194` (lỗi gửi, không phải lỗi tải), `components/address-form.tsx`, `components/orders/subscription-edit-sheet.tsx`, `components/dealer/dealer-apply.tsx`, `components/onboarding-gate.tsx`, `san-pham/[slug]/subscribe-sheet.tsx:2 chỗ`.
  - Web merchant/admin (ngoài phạm vi khách, ghi cho đủ): `app/merchant/merchant-returns.tsx:33, :47`, `app/merchant/fulfil-orders-tab.tsx:108` (không có nút thử lại, chỉ `<p>`), `app/merchant/settlement-tab.tsx:21` (chỉ `<p>`), `app/admin/analytics-tab.tsx:13` (chỉ `<p>`), `components/admin/order-status-actions.tsx`, `components/admin/search-picker.tsx`, `components/admin/product-picker.tsx`, `components/admin/product-edit-drawer.tsx`.
- Chỗ hiện "Không tải được" bằng chữ, không qua ErrorState: `apps/web/src/app/merchant/fulfil-orders-tab.tsx:108`, `apps/web/src/app/merchant/settlement-tab.tsx:21`, `apps/web/src/app/admin/analytics-tab.tsx:13`, `apps/web/src/app/merchant/merchant-returns.tsx:33`, `apps/miniapp/src/pages/edit-profile.tsx:81` (snackbar, không có màn lỗi).

## 5. Spinner thay skeleton ở màn chính
Mười màn: trang chủ, danh mục, chi tiết SP, giỏ, thanh toán, đơn, chi tiết đơn, Điểm Xanh, Ưu đãi, Vườn Xanh, Cá nhân.
- Mini App: không có Spinner toàn trang ở 11 page file tương ứng (`pages/home.tsx`, `browse.tsx`, `product-detail.tsx`, `cart.tsx`, `checkout.tsx`, `orders.tsx`, `order-detail.tsx`, `loyalty.tsx`, `offers.tsx`, `feed.tsx`, `profile.tsx`). Các màn này dùng Skeleton (ví dụ `cart.tsx:169` CartSkeleton; `checkout.tsx:379, 388` CheckoutSkeleton; `loyalty.tsx:138` pageSkeleton; `offers.tsx:63` pageSkeleton; `profile.tsx:170` ProfileSkeleton; `feed.tsx:95, 121`).
- Mini App Spinner còn lại: `components/app.tsx:105` (RouteFallback cho mọi route lazy, tức mọi màn trừ trang chủ) và `pages/ai-advisor.tsx:194` (inline, "Trợ lý đang soạn…").
- Web (chỉ grep `animate-spin`, không đọc từng màn chính): không có spinner toàn trang ở các màn chính. Spinner nằm ở hành động: `tai-khoan/thong-bao/page.tsx:117, 225`, `tai-khoan/ho-so/page.tsx:227, 305`, `thanh-toan/bank-transfer-panel.tsx:271`. Toàn trang: `dang-nhap/callback/page.tsx:75` (không thuộc 10 màn).
- Chưa kiểm: web màn chính có dùng skeleton đầy đủ không (chưa đọc).

## 6. Vùng chạm nhỏ (< 44px)
Mini App không có class Tailwind h-8/w-8 (0 lần; app dùng inline style). Inline 20–43px: 101 chỗ, phần lớn là icon, avatar, thumb. Ứng viên là phần tử bấm được (chưa kiểm hết, cần đọc onClick):
- `apps/miniapp/src/pages/cart.tsx:572-573` 36×36 (chưa kiểm có bấm không)
- `apps/miniapp/src/components/affiliate/ctv-shortcuts.tsx:53-54` 36×36
- `apps/miniapp/src/components/game/game-link-row.tsx:27-28` 36×36
- `apps/miniapp/src/components/checkout/referral-code-box.tsx:33-34` 36×36
- `apps/miniapp/src/components/affiliate/milestone-rewards.tsx:155-156` 32×32
- `apps/miniapp/src/pages/edit-profile.tsx:217-218` 28×28
- `apps/miniapp/src/pages/settings.tsx:240` cao 26 (công tắc, rộng 44)
- `apps/miniapp/src/pages/rewards.tsx:152` 40×40
- Không lỗi: `components/wishlist-heart.tsx:98-99` vùng chạm 44×44, nhìn thấy 32.
- Chưa kiểm: `components/back-button.tsx:110` (icon 24, không thấy kích thước vùng bấm).

Web khách: 0 lần h-8/w-8 kèm button/onClick trực tiếp. Ứng viên:
- `apps/web/src/components/order-mobile/mobile-ui.tsx:33, 37, 40` ô chọn h-6 w-6 (24px) ở khổ điện thoại (`max-md:`)
- `apps/web/src/components/orders/order-card.tsx:48` `max-md:min-h-6` (24px), link mã đơn
- `apps/web/src/app/san-pham/[slug]/product-reviews.tsx:243` h-8 w-8 (32px, chưa kiểm có bấm không)
- `apps/web/src/components/bottom-nav.tsx:70, 74` icon h-6 (vùng bấm bọc icon chưa kiểm)

## Chưa kiểm
- Số lượng ảnh, đo kích thước thật, và từng màn ErrorState/hành động thử lại trên máy: chưa làm (quét tĩnh).
