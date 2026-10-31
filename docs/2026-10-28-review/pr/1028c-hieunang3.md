TITLE: perf(api): /home/me khách mới bớt 3 câu SQL; admin duyệt sửa SP làm mới danh sách ảnh (R-82, R-159)

## Vấn đề
- R-82 (phần còn lại): khi Trang chủ của khách mới gọi `/home/me`, `getNewCustomerOffer` đọc lại khách và đơn mà `HomeService` đã có sẵn. Kết quả là 14 câu SQL.
- R-159 (phần admin): khi admin duyệt yêu cầu sửa sản phẩm, ảnh mới được ghi vào DB nhưng danh sách ảnh được phép đổi cỡ không được làm mới. Ảnh mới có thể báo 404 tới khi danh sách tự tải lại.

## Có gì trong PR
- R-82:
  - `loyalty.getNewCustomerOffer(userId, known?)` đọc khách một lần, đủ cột, rồi dùng lại kết quả cho `getAvailableCoupons`.
  - Khi `HomeService` đã có số đếm đơn (`userFacts`), bỏ hai lần đọc `orders.id`.
  - Khi `userFacts` hết giờ, hàm truyền `{}` và đọc lại như cũ.
  - Các controller `/loyalty/new-customer-offer`, `/loyalty/coupons` và checkout gọi không có `known`, nên giữ nguyên hành vi.
  - Không đổi luật quà khách mới hay mã chỉ dành cho khách mới.
- R-159:
  - `AdminService.reviewProductEdit` gọi `imageResize.invalidateRegistry()` khi duyệt, không gọi khi từ chối. Cách làm giống `product-admin.service`.
  - `CatalogModule` export `ImageResizeService`.

## Cách kiểm
- Đếm SQL bằng `sql-compare` trên lane 9 (lần đo thứ hai):
  - `/home/me` của khách mới: 14 xuống 11 câu. Khách mới chưa có số điện thoại cũng 14 xuống 11.
  - Khách quay lại giữ 12 câu; `/cart` giữ nguyên.
  - `sql-compare --diff`: 6/6 phản hồi giống hệt trước/sau.
- Test mới:
  - loyalty: `priorOrder: true` cùng `known false` vẫn hiện voucher.
  - admin: duyệt thì gọi `invalidateRegistry` một lần, từ chối thì không.
  - Cả hai đỏ nếu bỏ phần sửa.
- Reviewer Opus kết luận "merge được": chạy lại 3 spec đã đổi, 352 test đạt.
- Gate đầy đủ trên nhánh đã gộp main `2ca045580`: 0 FAIL. Gate gồm:
  - tsc 5 gói, eslint.
  - vitest: app-core 1283, Mini App 5270 (thêm một lượt giờ UTC), web 8060.
  - jest API: 505 suite / 11807 test.
  - lint:parity, vite build.
- Ba commit của worker đã gộp thành một, vì hai commit giữa làm tsc đỏ ở spec.

## Còn lại (P3, không chặn merge)
- Phép so thân JSON chưa phủ nhánh có mã `newCustomerOnly`, vì DB lane 9 không có mã WELCOME. Nhánh đó chỉ có unit test.
- Ảnh mới từ đồng bộ Pancake (`pancake-sync.service.ts:414`) và từ đối tác tạo sản phẩm (`merchant.service.ts:595`) không làm mới danh sách ảnh. Ảnh có thể báo 404 tối đa khoảng 30 giây, sau đó `isRegistered` tự tải lại. Chủ chốt ghi backlog, chưa sửa.
- `admin.service.spec` gán `imageResize` thẳng vào instance, nên không kiểm phần nối DI. API đã khởi động được với `sql-compare`.

## Deploy và migration
Không có migration. Chỉ đổi API.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
