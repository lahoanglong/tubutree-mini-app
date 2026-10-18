# Gói catmap: gán danh mục cho sản phẩm đồng bộ Pancake (A5)

Nhánh `lr2/catmap`. Quyết định A5: tắt 44 sản phẩm demo, GIỮ danh mục, đồng bộ toàn bộ sản phẩm từ Pancake. Khoảng trống: đồng bộ không ghi `categoryIds`, nên hàng Pancake không vào trang danh mục và danh mục giữ lại bị Mini App ẩn.

## 1. Pancake cho gì về danh mục
- Liên kết sản phẩm-danh mục của Tubu là cột mảng `Product.categoryIds` (GIN index), danh mục là bảng `Category`. Không có bảng nối.
- Open API Pancake (`docs.pancake.biz/pos/api/openapi.json`, đọc 2026-10-18): schema `Product` có `category_ids` (mảng số nguyên) và `tags` (mảng số nguyên); `GET /shops/{SHOP_ID}/categories` trả cây `{id, text, nodes[]}`. Phản hồi `GET /shops/{SHOP_ID}/products` KHÔNG có schema trong tài liệu (chỉ có body tạo sản phẩm), nên việc danh sách sản phẩm có trả `category_ids` là SUY RA từ schema, chưa kiểm với shop thật. Không có fixture nào trong repo mang trường này.
- Vì vậy mã đọc phòng thủ `category_ids` (số hoặc chuỗi) và `categories` (đối tượng `{id,name|text}` hoặc giá trị đơn); thiếu thì bản đồ không làm gì.

## 2. Đã làm
- Gán hàng loạt (bắt buộc): `GET /admin/product-categories/products` (lọc `q`, `uncategorized`, `source=pancake|all`, `categoryId`, keyset theo tên+id) và `POST /admin/product-categories/assign` `{productIds ≤500, categoryId, mode: ADD|REMOVE}`. Kiểm: danh mục tồn tại, mọi sản phẩm tồn tại, khử trùng id. Ghi bằng một câu `UPDATE` nguyên tử (`array_append`/`array_remove`, chỉ dòng cần đổi, cập nhật `updatedAt`). Chỉ ADMIN (không nhóm nhân viên nào quản lý sản phẩm; `products/sold-external` cũng ADMIN). Mã: `catalog/product-category-admin.{controller,service}.ts`.
- Màn web "Danh mục sản phẩm" (nhóm "Người bán"): lọc, chọn nhiều, gán/gỡ có xác nhận, hiện danh mục đã gán, khung nhóm hàng Pancake.
- Đồng bộ không đè danh mục: `upsertProduct` chỉ ghi `categoryIds` khi sản phẩm chưa có danh mục nào (trước đó đồng bộ không bao giờ ghi cột này, nên đã không đè).
- Tự gán: khoá `pancake.category_map` `{mã hoặc tên nhóm Pancake (không phân biệt hoa thường) → id danh mục Tubu}`; mặc định `{}`; luật ghi ở `SystemConfigService.JSON_RULES` (`categoryMapProblem`); nạp ở reference-data. `upsertProduct` bỏ id danh mục Tubu không còn tồn tại (cache 60 giây), lỗi đọc cấu hình chỉ log và bỏ qua. Không truy vấn thêm khi payload không mang nhóm hàng.
- Trợ giúp: `GET /admin/pancake/categories` (ADMIN) làm phẳng cây nhóm hàng Pancake kèm danh mục Tubu đang ánh xạ; web hiển thị ở cuối màn "Danh mục sản phẩm". Soạn bản đồ dùng tab Cấu hình có sẵn.
- Runbook 1.6.1 bước 6 (và 6b) thay cho cách SQL.

## 3. Giới hạn
- Sản phẩm đã được bản đồ gán thì sửa bản đồ sau không đổi lại (không phân biệt được "bản đồ gán" với "admin gán"); gỡ danh mục ở màn Danh mục sản phẩm rồi đồng bộ lại.
- Không có "gán cho toàn bộ kết quả lọc": chỉ các sản phẩm đã tải trên màn (tối đa 500 mỗi lần).
- Danh mục Mini App ghi nhớ ~60 giây, không invalidate.

## 4. Kiểm
Xem báo cáo cuối của phiên. `reference-seed.race-spec.ts` (DB C) đỏ sẵn trên nền (nhận 13, cần 16, trước khi thêm khoá này); sau thay đổi nhận 14, cần 17.
