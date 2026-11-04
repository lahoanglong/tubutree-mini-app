# flaky-4: bundles-cls đỏ trên CI Linux (CLS 0,0231)

## Nguồn xê dịch (có bằng chứng)
- Là đổi phông chữ (font-display: swap), không phải khối bộ, không phải mock.
- Trace CI (run 41653972137): `inter-400.woff2` tải sớm; `inter-500/600/700.woff2` chỉ được yêu cầu ở mốc 1673641, ngay sau khi
  /products/:slug trả (bắt đầu 1672637 + 921ms). Khung chờ không có chữ nên trình duyệt không tải phông; chữ sản phẩm vẽ lần đầu bằng phông dự phòng.
- Ảnh chụp trace: khung ...895198 tiêu đề "Nước Rửa Chén Sinh Học Tubu 500ml" xuống 2 dòng (phông dự phòng rộng), khung ...895224 còn 1 dòng
  (Inter đã tải) và các dòng dưới nhích lên: đó là ~0,023.
- Vì sao chỉ ở nhánh này: trên main, request /config/public, Giờ vàng, đánh giá về rải rác nên chữ (và phông) đã được dùng sớm; ở nhánh này giữ sản phẩm
  tới khi 3 request phụ về, nên toàn bộ chữ vẽ một lượt trước khi phông 500/600/700 kịp tải. Hai lần chạy CI cho cùng dấu vết (cả hai trace khớp).
- Trên Mac không tái hiện (phông dự phòng hẹp hơn, CLS 0 cả khi trễ woff2 800ms), nên bằng chứng là trace + thời điểm tải phông, không phải chạy lại cục bộ.
- Lỗi này là hành vi thật của app trên lần tải lạnh (không có size-adjust cho phông dự phòng); nằm ngoài gói bộ, KHÔNG sửa ở đây. Ghi nhận cho điều phối.

## Cách sửa (chỉ test)
- `auxiliaryBeforeProduct(api, page)`: sau khi 3 request phụ về, giữ sản phẩm thêm tới khi mọi `document.fonts` đã `load()` (allSettled: một phông lỗi không làm đổ test);
  hạn dự phòng 5s sẵn có vẫn báo thiếu. Giống khách đã có phông trong bộ nhớ đệm.
- `trackLayoutShift` ghi `sources` (node, previousRect -> currentRect, thời điểm); câu báo lỗi của 3 ca đo CLS in kèm danh sách này.
- Ngưỡng 0,02 giữ nguyên.

## Số chạy thật (cục bộ, --workers=1, cổng 3953)
- `--repeat-each=5` cả file: 30/30 xanh (1,4 phút).
- `E2E_CPU_THROTTLE=6`: 6/6 xanh. (Lần đầu đỏ vì `Promise.all` gặp NetworkError của một phông; đổi allSettled rồi xanh.)
- Đột biến `return false` ở use-product-bundles.ts (bỏ khung chờ): ca "bộ về sau sản phẩm" ĐỎ, CLS 0,0764; ca nền xanh. Đã khôi phục mã nguồn.
- Chưa chạy được CI Linux: cần push để xác nhận.
