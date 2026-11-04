# flaky-3 (gl/1103-flaky, commit 2d8feda3f)

- P1/P2 (bundles-cls ca "bộ về chậm"): đã sửa. Dùng page.clock không khả thi trong thử nghiệm (đóng băng đồng hồ làm app không tải được), nên chọn biến thể thay thế: ca addInitScript kéo setTimeout(300ms) của hook lên 6000ms CHỈ trong trang này (PDP_BUNDLES_WAIT_MS khai lại trong spec). Tốc độ máy không còn quyết định; hạn "hết chờ thì thôi" vẫn do vitest của hook phủ. Tên ca/ghi chú đã đặt lại cho đúng mốc.
  - Đột biến `return false` ở use-product-bundles.ts: đỏ 5/5 (CLS 0.0764). Mã thật + E2E_CPU_THROTTLE=6, --repeat-each=10: xanh 10/10. Cả file: 6/6 xanh. Máy load ~170 trong lúc đo.
- P3 (hạn dự phòng): đã sửa. Hạn 5s tính từ lúc request sản phẩm tới, nếu thiếu request phụ thì ghi api.handlerErrors "thiếu request phụ: ..." rồi nhả sản phẩm.
- Lưu ý: ca nền "không có bộ nào" (CLS ~0.027 và page.goto timeout) đỏ khi máy tải cực nặng, không thuộc phát hiện này, không đổi.
