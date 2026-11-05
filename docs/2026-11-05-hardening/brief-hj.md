# Gói hj (đợt 4): kiểm chiến dịch trước khi bật + xem trước banner trên admin

Worktree: `.claude/worktrees/hard-1105-hj`, nhánh `hard/1105-hj`, gốc `hard/1105-w4`. PG race: cổng 46541. Luật chung: `hard-1105-rules.md`. Trước khi sửa giao diện: gọi skill `tubu-ui`.

## Vì sao
Admin tạo chiến dịch (banner đầu Trang chủ / Ưu đãi + trang `/campaign/:slug`) mà không biết trước khách sẽ thấy gì. Lỗi hiện tại chỉ lộ sau khi bật:
- Đích sản phẩm/danh mục sai hoặc đã ẩn: banner dẫn tới trang lỗi.
- Slug 121–240 ký tự: Mini App bản cũ âm thầm bỏ banner (runbook §1.23).
- Quá 5 banner cùng chỗ (`CAMPAIGN_SLIDES_MAX`): banner thứ 6 trở đi không hiện.
- Ảnh sai tỉ lệ bị cắt.
- Mã giảm giá gắn kèm đã hết hạn hoặc hết lượt.
- Trang chiến dịch không còn sản phẩm nào hiển thị.

## Thiết kế (điều phối đã chốt)
1. **API kiểm sức khoẻ chiến dịch**, một nguồn dùng cho cả form lẫn danh sách:
   - `POST /admin/campaigns/check`: body giống create/update, kèm `id` tuỳ chọn khi sửa. Dùng cho form chưa lưu.
   - Danh sách admin: mỗi chiến dịch kèm `health: { blockers: n, warnings: n }`. Tính theo lô, không N+1.
   - Kết quả: mảng `{ code, level: 'BLOCK'|'WARN', message }`, câu tiếng Việt nêu cách sửa.
   - BLOCK (không cho bật `isActive = true`, lưu nháp tắt thì vẫn được):
     - `linkType` PRODUCT/CATEGORY trỏ tới slug không tồn tại, hoặc sản phẩm/danh mục không hiển thị với khách. Dùng đúng điều kiện storefront đang lọc; tìm hàm có sẵn, không tự viết lại.
     - `CAMPAIGN_PAGE` không còn sản phẩm hiển thị nào và cũng không có mã giảm giá dùng được (trang trống).
   - WARN:
     - slug đích dài hơn 120 ký tự (Mini App bản cũ không hiện banner; dẫn §1.23);
     - `endAt` đã qua;
     - cùng `placement` có hơn `CAMPAIGN_SLIDES_MAX` chiến dịch chạy chồng thời gian, và chiến dịch này rơi ra ngoài theo thứ tự hiển thị thật (dùng đúng hàm sắp xếp của app-core/API);
     - mã gắn kèm hết hạn, tắt, hết lượt, hoặc hết hạn trước `endAt` của chiến dịch;
     - sản phẩm gắn kèm đã ẩn hoặc hết hàng (đếm, nêu tối đa 3 tên).
   - Bật chiến dịch qua create/update/toggle mà còn BLOCK: 400 kèm câu đầu tiên. Kiểm lại trong cùng request, không tin client.
   - Route mới thêm vào `staff-permissions.matrix.spec.ts`, cùng quyền với route chiến dịch hiện có.
2. **Admin form** (`apps/web/src/components/admin/campaign-form.tsx`):
   - Khối "Kiểm trước khi bật": gọi `check` (debounce, khi đổi đích/ảnh/ngày/mã/sản phẩm). Hiện BLOCK đỏ, WARN vàng, "Sẵn sàng" xanh. BLOCK thì nút bật/lưu-đang-bật bị khoá kèm lý do.
   - **Xem trước banner**: hai khung, "Điện thoại 375px" và "Máy tính". Dựng bằng component banner thật của web (`apps/web/src/components/campaign/campaign-banner.tsx` / `BannerCarousel`) với ảnh, tiêu đề, phụ đề, tỉ lệ khung đúng như khách thấy (`--banner-ratio`, `WIDE_RATIO` desktop). Không chép CSS. Web khổ điện thoại = Mini App, nên khung 375px đại diện cho Mini App.
   - Kiểm ảnh ở trình duyệt (`naturalWidth/Height`): lệch tỉ lệ khung > 10% thì WARN "ảnh sẽ bị cắt", kèm tỉ lệ đề nghị. Ảnh không tải được thì WARN.
3. **Danh sách chiến dịch** (`campaigns-tab.tsx`): huy hiệu "n lỗi chặn / n cảnh báo" mỗi dòng. Lọc nhanh "Có vấn đề".

## Test bắt buộc (đỏ trước)
- API unit + race/integration trên PG thật:
  - mỗi mã BLOCK/WARN có ca đỏ/xanh;
  - bật chiến dịch còn BLOCK → 400, lưu nháp tắt → 200;
  - danh sách trả `health` không N+1 (đếm truy vấn hoặc kiểm `findMany` theo lô).
- vitest web: khối kiểm hiển thị đúng mức; nút bị khoá khi BLOCK; xem trước dùng component banner thật (2 khung); cảnh báo tỉ lệ ảnh.
- Playwright web admin: tạo chiến dịch đích sai → thấy BLOCK, không bật được; sửa đích → "Sẵn sàng" → bật được. Viết spec, KHÔNG chạy Playwright: điều phối chạy.

## Ngoài phạm vi
- Không đổi cách Mini App/web hiển thị banner cho khách.
- Không đổi schema Campaign (không cần migration). Cần thì dừng, báo.
- `packages/app-core`, `packages/shared-types`: chỉ được THÊM hàm/hằng thuần (không đổi chữ ký hàm có sẵn) nếu cần dùng chung thứ tự slide hay điều kiện hiển thị. Ghi rõ trong báo cáo.
