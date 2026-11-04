# sec lượt 3 (nhánh gl/1103-sec, commit d5fbf713a)

- P1 editPost: SỬA. Chặn bài REMOVED (404) + updateMany có where status != REMOVED (count 0 -> 404). Jest mới: sửa bài REMOVED có ảnh data: -> 404 không ghi; DELETE thắng giữa đọc và ghi -> 404. Test đỏ với mã cũ (8 ca editPost đỏ), xanh sau sửa. Jest feed 503/503.
- P2 normalizeTaxCode: SỬA. Không còn bỏ '-' ; dạng có '-' phải đúng 10-3. Thêm '0101234567-01', '010123456-701', '0101-234567-001' vào ca sai. app-core vitest 2603/2603.
- P3 lỗi hiện từ phím đầu: SỬA. shouldShowTaxCodeError (>=10 số hoặc ký tự lạ) dùng ở Mini và web; web bỏ role=alert, thêm aria-invalid + aria-describedby.
- P3 ảnh/bundle: KHÔNG làm (chưa chụp ảnh mini375/web375/web1280, chưa đo bundle-report); checkout tải lười nên entry không đổi, chưa có số đo.
- Kiểm: tsc miniapp + web sạch; lint:parity xanh; miniapp vitest checkout/tax/invoice 290/290; web thanh-toan/checkout 395/395. Miniapp full: 6529/6531 (2 fail không xác định, chạy tải nặng, chưa tái lập riêng).
