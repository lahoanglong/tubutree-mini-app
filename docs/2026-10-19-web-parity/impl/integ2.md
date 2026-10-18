# Lane integ2: nối các route đã mở

## Đã sửa
- shop:9 (095b105a): đặt định kỳ chuyển khoản sang `/thanh-toan/chuyen-khoan/<code>` qua helper mới `bankPaymentHref` (`apps/web/src/lib/order-view.ts`), như `apps/miniapp/src/components/subscribe-sheet.tsx:86`.
- order:5 (095b105a): nút "Thanh toán" của `orders-section.tsx` (hub `/tai-khoan`) sang trang chuyển khoản như `orders.tsx:118` của Mini App; đơn COD/ví/PAID không có nút, mã đặc biệt được encode (test `orders-list.spec.tsx`).
- affiliate:2: `ctv-order-sheet.tsx:249-266` đã trỏ đúng khi route mở; test `ctv-order-sheet.spec.tsx:273` khoá.
- core-shell:5: đã xử lý trước ở b8a738bb (`sitemap.ts` đọc `CASHBACK_ENABLED`, `sitemap.spec.ts:42`); ghi nhận.

## Rà isWebRouteReady (a1bb2cca khoá bằng `route-map.spec.ts`)
| Chỗ dùng | Route | Giống Mini App |
|---|---|---|
| order-strip.tsx:91 | /tai-khoan/don-hang?tab=subscriptions | đã mở, giống |
| home-view.tsx:180 | /tai-khoan/thong-bao | đã mở, giống |
| home-extras.tsx:59,106 | /tu-van, /cong-dong | đã mở, giống |
| feed-view.tsx:179,184 | /cong-dong/xep-hang, /su-kien | đã mở, giống |
| diem-xanh/page.tsx:177,179 | /vuon-xanh, /kho-qua | đã mở, giống |
| diem-xanh/page.tsx:178 | /doi-rac | pending, giữ ẩn |
| vi-tubu/page.tsx:156 | /ctv | đã mở, giống `wallet.tsx:284` |
| ctv/page.tsx:363,444 | /ctv/gian-hang, /hoc-vien | đã mở, giống |
| ctv-order-sheet.tsx:249-295 | chuyen-khoan, don-hang | đã mở, giống |
| notification-view.ts:77, web-nav.ts:29 | theo route map | đã mở trừ pro/recycle |
| brand-actions.tsx:267 | /dai-ly | pending, giữ ẩn |
| order-extras.tsx:43, thanh-toan/page.tsx:115 | /doi-rac/* | pending, giữ dự phòng |
| storefront-owner.tsx:18, diem-xanh:412 | /san-pham | đã mở, giống |
| tai-khoan/page.tsx:123 | menu tài khoản: /dai-ly, /nhan-vien, /chu-thuong-hieu | pending, giữ ẩn như Mini App chưa có trang web; các mục còn lại đã mở, giống |
| vuon-xanh/page.tsx:82-83 | /doi-rac (cần cấu hình waste bật), /cong-dong | /doi-rac pending, giữ ẩn; /cong-dong đã mở, giống |
