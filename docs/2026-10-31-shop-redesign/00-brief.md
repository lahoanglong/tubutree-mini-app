# Đợt review + nâng cấp gian hàng (2026-10-31): brief chung cho agent

## Vì sao
Chủ dự án thấy bố cục gian hàng và cách hiển thị sản phẩm đang rối: quá nhiều sản phẩm dàn trải. Mục tiêu: Mini App mua sắm "chuẩn tầm cỡ Shopee" (gọn, có điểm nhấn, dễ tìm, hấp dẫn), rồi web theo cùng chuẩn. Thêm một cơ chế để màn hoặc chức năng làm sau này vẫn khớp hệ thống hiện tại.

## Phạm vi (chủ đã chọn)
Màn, ưu tiên Mini App khổ 375px trước, web sau (web khổ điện thoại phải trông như Mini App; máy tính thì giãn rộng):
- Trang chủ `/`, Danh mục + tìm kiếm `/browse`, chi tiết sản phẩm `/product/:slug`.
- Gian hàng CTV `/s/:slug` và màn dựng gian hàng `/storefront`.
- Trang thương hiệu `/brand/:slug`.
- Ưu đãi `/offers` và khu Giờ vàng (flash sale).

Chức năng sẽ thêm (cả Mini App và web, có màn quản trị khi cần):
1. Flash sale theo khung giờ (thanh % đã bán, trang riêng) + bảng Top bán chạy theo danh mục.
2. Nhãn trên thẻ sản phẩm (Mới, Freeship, Yêu thích, sao đánh giá, đã bán) + lưới "Gợi ý hôm nay" cuộn vô tận.
3. Banner chiến dịch xoay ở đầu trang + trang chiến dịch + kho voucher gom một chỗ.
4. Combo + mua kèm giảm giá ở chi tiết sản phẩm và giỏ hàng.

Cửa hàng thật có trên 100 sản phẩm đang bán.

## Đã có sẵn (đọc trước khi đề xuất, đừng đề xuất lại cái đã có)
- Thứ tự khối Trang chủ dùng chung: `packages/app-core/src/home-layout.ts`. Khối Mini App: `apps/miniapp/src/components/home/`.
- Giờ vàng: `apps/miniapp/src/components/flash-sale.tsx`, model `FlashSale*` trong `apps/api/prisma/schema.prisma`, `docs/flash-sale-QA-guide.md`.
- Kệ Bán chạy: `apps/miniapp/src/components/home/best-seller-rail.tsx`. Danh mục: `apps/miniapp/src/components/catalog/`.
- Thành phần giao diện: `apps/miniapp/src/components/ui/` (product-tile, price-tag, badge, chip, scroll-row...). Token: `apps/miniapp/src/css/tokens.css`, gói `packages/design-tokens`. Web: `apps/web/src/components/`.
- Bài kiểm giao diện tự động đã có: `apps/miniapp/src/ds-*.spec.ts`, `css/contrast.spec.ts`, `components/ui/hit-target-guard.spec.tsx`, `apps/web/src/ds-*.spec.ts`, `pnpm lint:parity`.
- Thiết kế gốc: `design_handoff/` (brief, build spec, M2 design system), `DESIGN_IMPROVEMENTS.md`.
- Review trước: `docs/2026-10-25-ux-review/`, `docs/2026-10-28-review/10-findings.md`, `20-backlog.md`. Đừng báo lại lỗi đã sửa ở đó trừ khi còn thấy trên mã hiện tại.
- Quy tắc hai nền tảng: `AGENTS.md` (logic ở app-core, `route-map.json`, `PlatformBridge`).

## Ảnh chụp
Ảnh của mã hiện tại (main 13536d955) nằm ở `docs/2026-10-31-shop-redesign/screens/` khi agent chụp xong; mục lục `screens/INDEX.md`. Ảnh sản phẩm trong dữ liệu mẫu có thể trống (chỉ khung lá): đừng chấm điểm việc thiếu ảnh thật, chấm bố cục.

## Ràng buộc
- Chỉ đọc mã. Agent review KHÔNG sửa mã sản phẩm, KHÔNG commit, KHÔNG push. Chỉ ghi file báo cáo của mình.
- Không đọc hay ghi PROD. Không deploy.
- Không kill tiến trình không phải của mình. Cổng lane 7 (3271–3278) dành cho agent chụp ảnh.
- Mọi lệnh node cần `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.

## Báo cáo
Viết tiếng Việt, gọn. Mỗi phát hiện: mức (P0 chặn trải nghiệm / P1 nên sửa đợt này / P2 tinh chỉnh), màn, bằng chứng (`file:dòng` hoặc tên ảnh), vấn đề, đề xuất cụ thể (đủ để người làm code không phải hỏi lại). Đề xuất phải dùng token và thành phần có sẵn khi được; nói rõ khi cần thành phần mới.
