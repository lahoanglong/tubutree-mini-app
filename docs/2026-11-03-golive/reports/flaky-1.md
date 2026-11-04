# Gói flaky, lượt 1

Nhánh gl/1103-flaky (gốc 52fd5cd65), chưa push. Chỉ sửa test; không đụng mã app.

## Commit
- bf6378658 test(web): nạp sẵn bảng chọn phân loại và chờ theo thời gian ở add-to-cart.spec
- (commit thứ hai) test(e2e): bundles-cls đo CLS không phụ thuộc tốc độ máy, thêm E2E_CPU_THROTTLE (xem `git log`)

## Mục 2: add-to-cart.spec.tsx (làm xong)
- Gốc: bảng phân loại nạp bằng next/dynamic; `sheetReady` chỉ chờ 40 nhịp `flush()`, nạp chậm hơn thì đỏ.
- Sửa: `beforeAll` nạp sẵn `./variation-sheet` trong khối "khổ điện thoại, từ 2 phân loại"; `sheetReady` chờ theo thời gian thật (5 s).
- Chứng minh: mô-đun giả chậm 300 ms: bản cũ đỏ 3/3 (ca "Thêm vào giỏ mở bảng chọn"), bản mới xanh 20/20 (96 test mỗi lượt). Bỏ giả lập: 96/96.

## Mục 1: bundles-cls.miniapp.spec.ts (làm xong phần test; có phát hiện về app)
- Thêm `E2E_CPU_THROTTLE` (CDP `Emulation.setCPUThrottlingRate`), mặc định tắt.
- Gốc tìm được bằng nhật ký nguồn layout-shift ở CPU 6x: KHÔNG phải do Combo/Mua kèm. Ở nền không có bộ nào CLS đã 0,0271: khối "Số lượng" bị đẩy xuống 76px vì dòng Vận chuyển (ngưỡng freeship, `/config/public`) và các dòng phụ chèn muộn khi dữ liệu về sau sản phẩm. Lượt xấu hơn (0,07 đến 0,26): khung chờ PDP_BUNDLES_WAIT_MS=300ms hết trước khi bộ về nên khối chèn sau.
- Trước sửa (CPU 6x): ca "không có bộ nào" và ca "bộ về chậm" đỏ ở hầu hết lượt (CLS 0,0271 / 0,0764 / 0,1728 / 0,2575); lượt 10x: 15 đỏ trên 60.
- Sửa test: sản phẩm chỉ trả sau khi cấu hình công khai, Giờ vàng, đánh giá đã về (`auxiliaryBeforeProduct`); export `productDetail` ở support/discovery-mocks.ts.
- Sau sửa: 60 lượt (10 lần cả file, CPU 6x, 2 worker): 0 ca đỏ vì CLS. 6 ca đỏ khác đều là timeout môi trường (goto 90 s, heading chờ 15 s, aria-label 5 s) khi máy tải 100 đến 160 (12 lõi), ở cả ca không đo CLS. KHÔNG đạt được "10/10 xanh" thật vì máy quá tải; cần chạy lại khi máy rảnh.
- Phát hiện app (ngoài phạm vi gói, báo lại cho gói pdp): vào thẳng PDP, dòng Vận chuyển (freeship) chèn muộn sau `usePublicConfig` gây CLS ~0,027 trên máy chậm. Nên giữ chỗ hoặc chờ cấu hình như `useBundlesWait`. Ngoài ra khung chờ bộ cố định 300 ms đồng hồ tường nên trên máy rất chậm bộ vẫn chèn sau (thiết kế chấp nhận, không sửa).

## Mục 3: CI 7 ngày (`gh run list --branch main --limit 40`)
4 lượt đỏ, đều không thuộc test Mini/web khách chập chờn:
- 41507715224 (0aa8af5d1): jest API `image-resize.service.spec.ts` (24 s), `app-throttler.guard.spec.ts` (56 s): nghi timeout do tải CI. Thuộc API.
- 41486539553 / 41486476546 (353ecc86, 3fd54e26): jest API `subscriptions.service.spec.ts` 1 ca. Thuộc API (vùng db).
- 41408170301 (eb4fafa8, Playwright E2E): không có bước/log lỗi; cùng SHA chạy CI xanh. Chưa xác định ca.
Không sửa gì ở mục này (API là vùng phiên db; chưa đủ log cho Playwright).

## Kiểm
- vitest add-to-cart.spec: 96/96 (và 20/20 lượt chậm giả). eslint web file đó: sạch. tsc web, tsc apps/e2e: sạch.
- eslint cho file e2e: không chạy được (không có binary ở apps/e2e); chưa kiểm.
- Chưa chạy vitest toàn bộ web/app-core: máy tải 160, chỉ đổi 1 spec; Playwright chỉ chạy bundles-cls.
- Không đổi mã app: không có bundle, ảnh, lane.
