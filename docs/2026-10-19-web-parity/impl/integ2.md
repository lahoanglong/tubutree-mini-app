# Lane integ2: nối các route đã mở

## 1. Đã làm
| Mục | Commit | File chính |
|---|---|---|
| shop:9 đặt định kỳ chuyển khoản sang trang chuyển khoản (helper `bankPaymentHref`) | 095b105a | `apps/web/src/lib/order-view.ts`, `subscribe-sheet` |
| order:5 nút Thanh toán hub `/tai-khoan` sang trang chuyển khoản | 095b105a | `apps/web/src/app/tai-khoan/orders-section.tsx`, `orders-list.spec.tsx` |
| order:5 xét hạn + xử lý tay (`canPayNow`), chữ "Thanh toán ngay", in hạn | 9b91a9ce | `orders-section.tsx`, `orders-list.spec.tsx` |
| order:5 giữ link Xem chi tiết cạnh Thanh toán ngay; sửa mã commit trong sổ câu hỏi | d61e949b | `orders-section.tsx`, `98-cau-hoi-va-chua-kiem-chung.md` |
| Khoá đích rẽ nhánh theo `isWebRouteReady` | a1bb2cca | `route-map.spec.ts` |
| Cập nhật spec a11y trang tài khoản theo đích mới | 3b2a823e | `guest-pages.a11y.spec.tsx` |
| Ghi sổ shop:9, order:5, affiliate:2, core-shell:5 | c842c8d1 | `98-cau-hoi-va-chua-kiem-chung.md` |

- affiliate:2: không sửa code, `ctv-order-sheet.tsx:249-266` đã đúng, test `ctv-order-sheet.spec.tsx:273` khoá cả hai nhánh.
- core-shell:5: đã xử lý trước ở b8a738bb (sitemap bỏ `/hoan-tien` khi `CASHBACK_ENABLED` tắt).
- Route web đã bỏ pending: lane này không mở route mới; chỉ nối chỗ dùng các route đã mở. Còn pending: `/dai-ly`, `/doi-rac/*`, `/nhan-vien`, `/nhan-vien/bang-luong`, `/chu-thuong-hieu`.

## 2. Kiểm chứng (summary.txt gate cuối, xanh)
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  40 passed (40)       Tests  484 passed (484)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  330 passed (330)       Tests  5332 passed (5332)
web-test-utc rc=0  Test Files  330 passed (330)       Tests  5332 passed (5332)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (13 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```
Test đỏ trước khi sửa: 2 ở `order-view.spec.ts`/`subscribe-sheet.spec.tsx`, 1 ở `orders-list.spec.tsx`. Mini App không sửa, 4214 test không giảm.

## 3. Review
Lượt 1:
- MAJOR nút Thanh toán hub dùng `canPayAgain` không xét hạn: đã sửa ở 9b91a9ce (dùng `canPayNow`, thêm ca quá hạn và manualHandling).
- MINOR thiếu test quá hạn/manualHandling: sửa ở 9b91a9ce.
- MINOR chữ "Thanh toán" và không in hạn: sửa ở 9b91a9ce.
- MINOR bảng rà thiếu `tai-khoan/page.tsx:123`, `vuon-xanh/page.tsx:82-83`, route-map.spec thiếu route pending: sửa ở bảng dưới và `route-map.spec.ts` (9b91a9ce/3b2a823e).
Lượt 2:
- MINOR hub mất link Xem chi tiết khi hiện Thanh toán ngay: sửa ở d61e949b (assertion đỏ trước, xanh sau).
- MINOR mã commit sai trong 98-cau-hoi cho order:5, affiliate:2: sửa ở d61e949b.
- Ghi nhận ngoài lane, không sửa: `tai-khoan/don-hang/[code]/page.tsx:188-190` hiện khung QR theo `canPayAgain` không xét hạn (Mini App dùng `canPayOrderNow`). Thuộc lane order.

## 4. Chưa làm / cố ý để lại / chưa kiểm chứng
- `order-card.tsx:78` và `thanh-toan/page.tsx` vẫn tự nối chuỗi `/thanh-toan/chuyen-khoan/...` (giá trị đúng, chưa gom về `bankPaymentHref`).
- `guest-pages.a11y.spec.tsx:267` chưa đổi tên cho khớp ("mỗi đơn dẫn tới trang chi tiết").
- Trang chi tiết đơn web xét hạn QR: chưa sửa (lane order).
- Không chạy Playwright; chưa kiểm chứng trên trình duyệt thật.

## 5. Câu hỏi cho chủ dự án
- Trang chi tiết đơn web có nên ẩn khung QR khi đơn quá hạn như `canPayOrderNow` của Mini App? Mặc định: chưa đổi, chỉ ghi nhận.
- Gom mọi chỗ nối `/thanh-toan/chuyen-khoan/...` về `bankPaymentHref`? Mặc định: chưa gom (không đổi hành vi).

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
