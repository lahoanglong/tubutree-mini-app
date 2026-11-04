# Gói pdp, lượt 1 (nhánh gl/1103-pdp, gốc 52fd5cd65, chưa push)

Commit:
- 5ce5143e2 fix(pdp): giữ chỗ ghi chú hết suất Giờ vàng để allowance về muộn không đẩy phần dưới (Mini, web)
- 5174651d4 refactor(pdp): thứ tự khối PDP web dùng lớp tubu-pdp-order-N, hạ baseline max-md (page 43→36, add-to-cart 12→8)
- 5dfad7377 test(e2e): chiều cao phiếu mã giảm giá web 375px, dùng chung bộ mock và phép đo với Mini

## Mục 1 CLS ghi chú hết suất (làm)
Chọn: giữ chỗ cố định 2 dòng caption (+ đệm dưới) ở vùng `[data-section="pdp-flash-limit"]` CHỈ khi khách đã đăng nhập và phân loại đang chọn đang trong Giờ vàng. Khách chưa đăng nhập, PDP không có Giờ vàng: cao 0 (có test). Lý do: cùng cách bảng chọn đã dùng (`reserveNote`); chữ thay vào chỗ đã có nên không đẩy phần dưới. Web: lớp `tubu-pdp-flash-note` ở mini.css (máy tính 28px, điện thoại 2 dòng caption + đệm). Mini: minHeight inline, thêm data-section cho đối xứng web.
Test: `pdp-flash-note-cls.miniapp.spec.ts` (allowance trễ 1 s, 3 s; vị trí/chiều cao vùng không đổi, CLS do ghi chú = 0; PDP không Giờ vàng cao 0), ca tương ứng ở `flash-sheet-price.web.spec.ts`; vitest hai app (giữ chỗ khi allowance treo, không giữ khi khách).
Đỏ với mã cũ: ca Mini đỏ khi tắt giữ chỗ (ghi chú tự chèn vào vùng cao 0). Lưu ý: ca đỏ này chỉ xác nhận gián tiếp (xem rủi ro).

## Mục 2 ds-ratchet PDP web (làm một phần)
`max-md:order-N` (13 chỗ ở page.tsx + add-to-cart.tsx) đổi thành lớp `tubu-pdp-order-N` trong mini.css (đúng tiền lệ `tubu-phone-secondary`, không thêm max-md). Baseline: page.tsx 43→36, add-to-cart.tsx 12→8 (đã hạ, chỉ hai dòng này). Specs đọc order theo lớp mới. Hình giống nhau về lý thuyết (cùng `order` dưới 768px). Chưa làm: px viết tay, pdp-extras, pdp-sections. CHƯA so pixel ảnh trước/sau (xem rủi ro).

## Mục 3 e2e phiếu mã web 375 (làm)
`voucher-ticket-height.web.spec.ts` (3 ca 375px: Mã của tôi, Nhận mã, tên 40 ký tự); bộ mock và phép đo tách ra `support/voucher-ticket-checks.ts`, Mini spec import lại (không đổi số đo 88/98/138). Chưa chạy được (xem dưới).

## Kiểm (số thật)
- tsc web, tsc miniapp: sạch. eslint file đã sửa (web 2, mini 1): sạch.
- `pnpm lint:parity`: xanh (px 3769/399 file, max-md 1003/103 file).
- vitest web toàn bộ: 562 file, 9576/9576 pass. vitest miniapp toàn bộ TZ=UTC: 3-4 ca đỏ chập chờn do tải máy (load 100-140; 2 lần chạy ra các ca khác nhau, flash-sale.spec, offers.spec, product-detail-flash "hết giờ"); chạy lại riêng 3 file: 93/93 pass.
- Playwright Mini: pdp-flash-note-cls + flash-sheet-price + voucher-ticket-height = 17/17 pass (workers 2, timeout 120 s, retries 1).
- Playwright web qua web-gate.sh: KHÔNG chạy được. 3 lần đều "Timed out waiting ... from config.webServer" (build Next prod >10 phút, API `nest start --watch` >180 s) do máy quá tải. Ca web mới (flash CLS 1 s/3 s, không dải trống khi chưa đăng nhập, voucher web) viết xong nhưng CHƯA CHẠY.
- Bundle Mini (vite build + bundle-report): chưa đo (build Mini lỗi ở lần đầu vì chưa có tham số; sau đó máy tải). Thay đổi Mini chỉ là 1 style inline, dự kiến +vài chục byte.
- Ảnh trước/sau, so pixel: chưa làm (cần lane 3 + web, không dựng được khi tải cao).

## Còn lại / rủi ro
1. Chạy `web-gate.sh tests/flash-sheet-price.web.spec.ts tests/voucher-ticket-height.web.spec.ts` khi máy rảnh; có thể cần chỉnh số đo voucher web nếu khác Mini.
2. So pixel 375/1280 PDP web trước/sau mục 2, đo bundle Mini, ảnh vào screens-pdp.
3. Giữ chỗ trên máy tính 1280 (28px) là thêm ngoài brief; nếu không muốn, bỏ `min-height: 1.75rem` ở mini.css.
4. Ca "đỏ với mã cũ" của Mini do thiếu data-section ở mã cũ nên đỏ cả vì selector; đã xác nhận riêng bằng cách tắt giữ chỗ (ghi chú chèn vào làm test đỏ).
5. Chưa phát hiện cần sửa API; không đụng vùng của phiên db.
