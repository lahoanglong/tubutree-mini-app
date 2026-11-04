# parity lượt 2 (nhánh gl/1103-parity)
Commit: 1b058e180 (R-23 web + spec TZ + e2e), fe7a6caac (e2e đọc DOM thật), + chore hạ baseline max-md thanh-toan 69→68.
- P1 R-23 web: ĐÃ SỬA. Bỏ bộ đếm (chỉ hiện từ 450/500 để khách biết khi sắp bị cắt; chọn khác Mini có chủ đích). Placeholder, ô VAT bên phải, câu Điểm Xanh, câu đồng ý sát nút: đã khớp từ code đợt 7-8 (e2e xác nhận trên web và Mini). Spec đơn vị checkout-parity/address-note đã sửa. Test mới: vitest web thanh-toan 298/298.
- R-132: xong từ gốc (next.config.mjs:91, route-map.json:48), không đổi.
- P2 R-109: ĐÃ SỬA. Thêm apps/miniapp/src/utils/vn-timezone.spec.ts đổi process.env.TZ lúc chạy (NY, UTC, Auckland): với mã cũ (HEAD~1 của wallet-rules/shipping-eta/dob-input) đỏ 7/15, với mã mới 15/15. Comment globalSetup đã sửa. Không đổi dữ liệu order-detail.
- P3: ĐÃ SỬA. vatLabel/pointsTitle đọc từ DOM; vị trí VAT đo bằng vị trí chữ; pointsSubtext lấy qua phần tử cha + regex (không xpath sibling; không có testid sẵn, tránh sửa UI); bỏ console.log.
- Kiểm: ds-parity.shop.spec Mini 10/10, web (Web Customer Mobile) 10/10; lint:parity xanh; tsc web/miniapp/e2e sạch; vitest miniapp TZ=UTC 6545 (3 file timeout do tải, chạy lại riêng 60/60).
- Ảnh: screens-parity/checkout-form-{miniapp,web}375.png (một persona mock). Chưa chụp 1280 và persona returning/new, chưa trước/sau: không làm.
- Lưu ý: web-gate.sh không khởi động được API ở máy tải cao (nest watch quá 180s); phải build API/web trước rồi chạy bằng script thay thế ở scratchpad. Không đổi script repo.
