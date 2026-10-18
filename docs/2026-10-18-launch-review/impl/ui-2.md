# Gói ui-2 (nhánh lr2/ui)

## A10 bỏ lời hứa tuyệt đối "100%"
- Web trang chủ: "100% Thuần Chay & Lành Tính" thành "Thuần Chay & Lành Tính"; "100% NGUYÊN BẢN VIỆT NAM" thành "NGUỒN GỐC VIỆT NAM".
- Gian hàng `/s/[slug]`: "100% Chính hãng" và "Xuất kho tận gốc" đã được bỏ từ trước (test hiện có giữ nguyên), không cần sửa.
- Gợi ý nhập: placeholder merchant và admin bỏ "100%"; seed `certifications` "Nguyên chất 100%" thành "Nguyên chất".
- Cố ý giữ: "100%" là luật tính (điểm quy đổi tới 100% giá trị hàng, phần trăm thành phần trong seed, "Tubu Tree tài trợ 100% phí thu gom" là điều kiện dịch vụ có thật).
- Test: `page.spec.tsx` thêm ca trang chủ không chứa "100%".

## B10 màu khuyến mãi = cam logo
- Hex lấy từ chữ "Tubu Tree" của `design_handoff/assets/tubu-logo.png`: `#E38E1E` (cũ `#E08C1C`).
- `packages/design-tokens`: `--tubu-orange` đổi hex; thêm `--orange-50 #FDF1DE`, `--orange-800 #7A4300`; `--color-promo-*` và `--color-flash-*` trỏ vào cam. Chữ trắng trên cam chỉ 2,58:1 nên nền đặc đi kèm chữ `stone-900` (6,75:1); chữ nhỏ dùng `orange-800` (7,15:1 trên nền cam nhạt). Preset Tailwind thêm họ `orange`.
- Web: `promo` trong `tailwind.config.ts` đọc từ `orange`; nhãn giảm giá ở product-card, flash-price, gian hàng đổi `text-stone-0` thành `text-stone-900`. Miniapp dùng token nên đổi theo, không sửa component.
- Logo thật trên web: header và footer dùng `src/assets/tubu-logo.png` (bản trong design_handoff); `icon.svg` thay bằng `icon.png`, `apple-icon.png`, `favicon.ico` (PNG 48px) và `opengraph-image.png` 1200x630 dựng từ logo thật.
- Test: `tailwind.config.spec.ts` (tương phản stone-900/promo-solid và promo-fg/promo-bg), `ds-v2-guest.spec.ts`, `tokens.spec.ts`, `layout.spec.tsx`, `site-header.spec.tsx`.

## B12 bóng gợi ý tab Vườn Xanh
- Giữ tên tab. `components/garden-hint-bubble.tsx` + `utils/garden-hint.ts`, gắn trong `bottom-nav.tsx`; chữ ở `vi.nav.gardenHint`.
- Hiện một lần mỗi máy (localStorage `tubu_garden_hint_seen`, ghi ngay lúc hiện để tắt app giữa chừng cũng không lặp). Tắt khi bấm bóng hoặc mở tab Vườn Xanh. Storage vắng hoặc ném thì coi như đã xem (không hiện). Không đụng `pages/game.tsx`.
- "Mỗi người dùng" được hiểu theo máy: khoá không gắn user id, đổi tài khoản trên cùng máy không hiện lại.
- Test: `bottom-nav.spec.tsx` (5 ca).

## Kênh cộng đồng
- Khoá `community.zalo_group_url`, `community.facebook_url`, `community.tiktok_url` (mặc định rỗng). Luật ghi trong `system-config.service.ts` (JSON_RULES) dùng `community-links.ts`: rỗng hoặc https đúng tên miền zalo.me, facebook.com, fb.com, tiktok.com (cho subdomain, cấm user:pass, cổng, http, tên miền giả như zalo.me.evil.com).
- `GET /config/public` trả `community.{zaloGroupUrl,facebookUrl,tiktokUrl}` (null khi trống hoặc giá trị sót không hợp lệ), cùng khối `community` đã có.
- Miniapp: `components/community/community-channels.tsx` dưới tiêu đề trang Cộng đồng (`pages/feed.tsx`, cả màn xem trước và cổng đăng nhập), mở bằng `openExternal` (openWebview của Zalo SDK). Web: khối "Kênh cộng đồng" ở footer, `target=_blank rel="noopener noreferrer"`; `getPublicSupport` chỉ nhận link https.
- Reference-data: tiền tố `community` đã được duyệt nạp; thêm ba khoá vào danh sách duyệt trong `reference-config-selection.spec.ts` và `extraKeys` của `reference-seed.race-spec.ts` (chưa chạy spec race, cần DB).
- Test: `system-config.service.spec.ts`, `system-config.controller.spec.ts`, `site-footer.spec.tsx`, `public-support.spec.ts`, `feed.spec.tsx`.

## Chưa làm
- Chưa xem trực quan (không chụp màn hình), chưa chạy Playwright và spec race.
- URL thật của ba kênh chủ shop chưa cung cấp: để rỗng, nhập ở admin tab Cấu hình.
