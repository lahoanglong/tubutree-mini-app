# Gói `orders`: bộ lọc đơn, danh sách đại lý và bậc, so tổng Pancake

Nhánh `lr/orders` (worktree `lr-orders`), tách từ `review/2026-10-18-launch` (0bc7588b), đã gộp lại bản mới nhất của nhánh đó (`5b646c79`). Mỗi mục một commit. Chưa push.

| Mục | Commit |
|---|---|
| D1-17 bộ lọc danh sách đơn | `ac0bf475` |
| D1-06 tab Đại lý & công nợ, quản lý bậc | `75d52e96` |
| D1-03 so tổng tiền Pancake | `bd5a8998` |
| Sửa sau review: công tắc `pancake.total_mismatch_check` ghi được từ admin | `19920473` |
| Sửa sau review: `toLocaleString` trong web (CI đỏ) | `3b60ec19` |
| Sửa sau review: sửa bậc không ghi đè im lặng (409) | `6b242f89` |
| Sửa sau review: ghi lý do lệch tổng nguyên tử | `0506d63f` |
| Sửa sau review: cách đọc tổng không cộng ship | `7c7cac8c` |
| Sửa sau review: đổi tên hai migration | `83cd48c4` |

## 1. Đã làm

### D1-17: bộ lọc danh sách đơn admin (`ac0bf475`)
- Lọc thêm: loại đơn (lẻ / CTV / đại lý / CTV lên hộ / gian hàng), tình trạng thanh toán (chưa trả / đã trả / đã hoàn / thất bại), nền tảng (miniapp / web), CTV giới thiệu (theo id), gian hàng (theo slug hoặc subdomain, không phân biệt hoa thường), thứ tự (mới nhất hoặc cũ nhất trước). Cùng bộ lọc áp cho file CSV.
- Năm loại đơn loại trừ nhau theo thứ tự ưu tiên đại lý > CTV lên hộ > gian hàng > CTV > lẻ, nên mỗi đơn rơi đúng một nhóm (có test chứng minh tổng các nhóm bằng toàn bộ đơn).
- Gian hàng không tồn tại trả danh sách rỗng, không bỏ lọc (không lộ mọi đơn).
- Index: `orders_paymentStatus_createdAt_idx`, `orders_type_createdAt_idx`, `orders_platform_createdAt_idx`, `orders_placedForCustomer_createdAt_idx` (migration `20261018170100_lr_orders_filter_indexes`). Đo trên 300k đơn tổng hợp: đại lý + thất bại + web từ 63 ms xuống 6 ms. Hai index một phần thử thêm rồi bỏ vì đo không có lợi. Index tạo không `CONCURRENTLY`: chấp nhận vì bảng `orders` gần rỗng lúc ra mắt (cùng cách gói `reports` đã ghi); nếu chạy trên bảng đã lớn thì tạo tay `CONCURRENTLY` trước rồi để `IF NOT EXISTS` bỏ qua.
- Khoá inbox "VAT chờ xuất" đã có từ gói community nên không thêm. Khoá "đánh giá chờ duyệt" **không thêm** vì chưa có trạng thái chờ duyệt (`Review.isVisible` mặc định true).
- File chính: `apps/api/src/modules/admin/admin-order-filter.ts`, `admin.service.ts` (`listOrders`, `orderCsv`), `admin.controller.ts` (DTO `ListOrdersQuery`, `ExportOrdersQuery`); web `components/admin/order-extra-filters.tsx`, `lib/admin-client.ts`, `app/admin/page.tsx` (OrdersTab, +17 dòng).

### D1-06: tab "Đại lý & công nợ" và quản lý bậc đại lý (`75d52e96`)
- Tab mới (file mới `components/admin/dealer-accounts-tab.tsx`, mục "Đại lý & công nợ" trong nhóm Người bán): đại lý đã duyệt với bậc, dư nợ so với hạn mức (nhãn "Vượt hạn mức"), doanh số tháng đã chốt và chờ chốt, tổng nợ toàn bộ; lọc theo tên/SĐT, bậc, chỉ đại lý còn nợ; phân trang; trạng thái tải, lỗi (Thử lại), rỗng.
- Nút "Ghi nhận thanh toán" mở lại `DealerCreditPanel` và API `credit-payment` đã có (không thêm đường ghi tiền mới). Khoá khi đại lý hết nợ.
- Quản lý bậc (`dealer-tiers-section.tsx`, nằm cuối tab): tạo và sửa bậc (mã, tên, doanh số tối thiểu, chiết khấu %, hạn mức công nợ, điều kiện thanh toán PREPAID / NET n). Chưa có bậc nào thì hiện trạng thái trống kèm nút "Tạo bậc đầu tiên". Sửa bậc hiện hộp xác nhận liệt kê từng thay đổi. Lịch sử thay đổi xem được trong tab.
- API (tất cả `@Roles('ADMIN')`, không `@AllowStaff`): `GET admin/dealers/accounts`, `GET admin/dealer-tiers/manage`, `GET admin/dealer-tiers/history`, `POST admin/dealer-tiers`, `PUT admin/dealer-tiers/:id`. Kiểm khoảng giá trị, chiết khấu không vượt `dealer.max_discount_pct`, mã bậc trùng trả 409, vai trò khác 403, DTO chặn trường lạ.
- Lịch sử: bảng mới `dealer_tier_history` (migration `20261018170200_lr_dealer_tier_history`) ghi cũ → mới và người đổi; sửa đồng thời được khoá `FOR UPDATE` nên chuỗi lịch sử liền mạch (có race test).
- Sửa bậc không ghi đè im lặng (`6b242f89`): `PUT admin/dealer-tiers/:id` bắt buộc kèm `expected` (giá trị bậc lúc người sửa mở form). Sau khi khoá dòng, server so `expected` với giá trị hiện tại; khác thì trả 409 và không ghi (bảng `dealer_tiers` không có `updatedAt` nên so giá trị, không cần migration). Gửi lên đúng giá trị đang có thì trả về như cũ, không báo xung đột. Web hiện "Bậc này vừa được người khác sửa — tải lại." kèm nút "Tải lại giá trị mới"; giữ nguyên những gì người dùng đã gõ cho tới khi bấm tải lại. Có race test hai người sửa cùng lúc (kịch bản: A mở form, B hạ hạn mức, A chỉ đổi tên).
- Hai lỗi có sẵn được sửa kèm vì tab mới dựa vào: khối công nợ ở web tô ngược dấu (dư nợ dương bị tô xanh) và `DealerService.creditLedger()` cộng dư nợ từ 200 dòng gần nhất nên đại lý có sổ dài hiện sai. Giờ lấy tổng bằng aggregate trên toàn sổ (có test với sổ trên 200 dòng).
- File chính: `apps/api/src/modules/dealer/dealer-accounts-admin.{service,controller}.ts`, `dealer-tier-input.ts`, `dealer.module.ts`; web `lib/dealer-accounts-client.ts`, hai component trên, `dealer-credit-panel.tsx`; `app/admin/page.tsx` đúng 1 dòng menu, 1 dòng render, 1 import, 1 giá trị type; `page.spec.tsx` đổi số mục menu 33 thành 34.

### D1-03: so tổng tiền Pancake với `order.total` (`bd5a8998`)
- Mỗi sự kiện đơn (`orders`, `order`, `order.status_updated`, `order.updated`) so tổng Pancake đọc từ payload với `order.total`. Lệch thì ghi lý do vào hàng đợi "Cần xử lý Pancake": `Tổng tiền Pancake lệch với Tubu: Pancake ghi 319.000đ, Tubu ghi 269.000đ, lệch +50.000đ. ...` và báo ADMIN in-app. **Không bao giờ sửa đơn Tubu** (có test khẳng định chỉ ghi hai cột hàng đợi).
- Bỏ qua: đơn đã huỷ/trả, sự kiện hoàn/huỷ/xoá của Pancake, đơn có dòng đối tác tự giao (tổng Pancake thấp hơn là đúng thiết kế), payload không có số tổng. Không ghi đè lý do khác đang chờ (hàng đợi chỉ có một ô lý do). Lý do tự gỡ khi Pancake báo lại đúng tổng. Lỗi khi so chỉ ghi log, không chặn xử lý trạng thái/thanh toán/vận chuyển.
- Công tắc `SystemConfig pancake.total_mismatch_check` (mặc định bật, mặc định nằm trong mã, không đụng `seed.ts`). Tắt được bằng `PUT admin/config` (`{ "key": "pancake.total_mismatch_check", "value": false }`; `SystemConfigService.JSON_RULES` chỉ nhận boolean, chuỗi "false" bị từ chối 400 vì chỉ `false` thật mới tắt). Khoá hiện ở tab Cấu hình sau khi chạy `seed:reference`.
- Ghi lý do nguyên tử (`0506d63f`): điều kiện ghi nằm trong chính câu `updateMany` (ô lý do trống hoặc đang là lý do lệch tổng), nên job khác ghi lý do chen vào giữa lúc đọc đơn và lúc ghi thì lý do đó còn nguyên (race test chèn lý do bằng cách bắt `findFirst`).
- Cách đọc tổng thứ ba (`total_price_after_sub_discount` không cộng ship) chỉ được nhận khi Pancake không gửi `shipping_fee` hoặc phí đó bằng phí ship của đơn Tubu (`7c7cac8c`). Nhờ vậy đơn freeship 269.000 mà nhân viên thêm ship 30.000 trên Pancake được báo lệch +30.000 (trước đó bị che vì vẫn ra 269.000). Có test ca này.
- Test dùng payload theo schema "Đơn hàng" của Pancake POS Open API, và một test dựng lại tổng từ chính body `buildPancakeOrderBody` để chứng minh đơn vừa đẩy xong không bị báo lệch.
- Sổ tay `docs/launch/so-tay-van-hanh/`: quy tắc "không sửa đơn trên Pancake, huỷ rồi đặt lại" đã có ở README mục 5; bổ sung cách xử lý khi thấy lý do mới (README mục 4 và 5, `kho.md`, `cskh.md`) và bỏ chữ "chưa cảnh báo lệch".
- File chính: `apps/api/src/modules/integrations/pancake/pancake-total.ts` (mới), `pancake.processor.ts` (`onTotalReconcile`), `pancake-attention.ts` (`ATTENTION_TOTAL_MISMATCH`).

## 2. Kiểm chứng

Chạy lại sau các sửa, ở tip `83cd48c4`, trong `lr-orders`; Postgres race `lr-orders-pg` (cổng 5577), `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. DB `tubutree_it` được xoá và tạo lại trước khi chạy.

| Lệnh | Kết quả |
|---|---|
| `npx prisma migrate deploy` trên DB `tubutree_it` mới | "All migrations have been successfully applied." |
| `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code` | "No difference detected", exit 0 |
| race `dealer-accounts-admin.race-spec.ts` | Tests: 12 passed, 12 total |
| race `pancake-total-mismatch.race-spec.ts` | Tests: 5 passed, 5 total |
| race `admin-order-list-filters.race-spec.ts` | Tests: 6 passed, 6 total |
| race `pancake-push.race-spec.ts` | Tests: 5 passed, 5 total |
| race `dealer-bonus.race-spec.ts` | Tests: 4 passed, 4 total |
| `npx jest src/modules/admin src/modules/dealer src/modules/integrations src/common src/modules/system-config` (apps/api) | Test Suites: 119 passed, 119 total. Tests: 2230 passed, 2230 total |
| `npx jest prisma/reference-data` (apps/api) | "No tests found": `rootDir` của jest là `src`, thư mục này không có spec. Không đụng `config-selection.ts` |
| `npx tsc --noEmit` api và web | exit 0 cả hai |
| `npx vitest run` toàn bộ (apps/web) | Test Files 164 passed (164). Tests 2518 passed (2518) |
| `npx eslint` trên mọi file `.ts`/`.tsx` đổi từ sau lần gộp (api và web) | exit 0, không cảnh báo |

Về hai race spec có sẵn: ở lượt trước, `dealer-bonus.race-spec.ts` ca (g) trượt 3 lần liên tiếp với `P2028` khi load máy ~60, và `pancake-push.race-spec.ts` trượt 1 lần khi chạy chung 14 suite. Lượt này cả hai xanh ở load ~45 chạy riêng từng file, nên đó là do máy quá tải, không phải do diff (diff không đụng đường mã của hai spec này). Hai spec này vẫn nhạy với load máy cao.

## 3. Chưa làm hoặc cố ý để lại

- **D1-17**: không thêm khoá inbox "đánh giá chờ duyệt" (chưa có trạng thái chờ duyệt). Không thêm lọc theo phương thức thanh toán (đề bài chỉ nêu tình trạng thanh toán). Lọc CTV nhận id người dùng, chưa có ô tìm CTV theo tên/SĐT.
- **D1-06**: không có xoá bậc (chưa ai yêu cầu) và không có màn gán bậc cho đại lý (luồng duyệt hồ sơ đã có). `paymentTerms` chỉ là thông tin hiển thị, luồng đặt hàng chưa dựa vào nó. Tab và API chỉ ADMIN; nhóm nhân viên (kế toán, quản lý đại lý) chưa xem được, để gói `roles` quyết định cấp quyền.
- **D1-03**: chưa làm "sửa địa chỉ khi đơn chưa PACKED rồi đẩy lại Pancake" (cỡ M, ghi là bước sau). Chỉ phát hiện lệch **tổng tiền**: sửa địa chỉ, hoặc đổi món mà tổng không đổi thì không thấy. Đơn có dòng đối tác tự giao bị bỏ qua có chủ đích nên không được kiểm.
- Migration: hai thư mục của gói đã đổi tên sang `20261018170100_lr_orders_filter_indexes` và `20261018170200_lr_dealer_tier_history` vì `lr/roles` đã dùng mốc `20261018160000` (`coupon_actor`) và `lr/storefront` đã dùng `20261018170000` (`lr_storefront_moderation`); chưa DB thật nào áp tên cũ. Thứ tự áp dụng giữa các gói không phụ thuộc nhau (index và bảng lịch sử độc lập).
- Năm route mới của gói (`GET admin/dealers/accounts`, `GET admin/dealer-tiers/manage`, `GET admin/dealer-tiers/history`, `POST admin/dealer-tiers`, `PUT admin/dealer-tiers/:id`) chưa vào bảng quyền của `lr/roles`; việc này làm lúc gộp.
- Số mục menu trong `page.spec.tsx` là 34 (33 + 1). Nếu gói khác cũng thêm mục thì phải đếm lại lúc gộp nhánh.

## 4. Câu hỏi cho chủ dự án

1. **Field tổng tiền thật của webhook Pancake.** Repo chưa từng có payload webhook thật (cùng tình trạng `prepaid`/`bank_payment`). Mặc định đã dùng: chấp nhận ba cách đọc tổng (cách thứ ba chỉ khi phí ship Pancake vắng hoặc bằng phí ship đơn Tubu), khớp một trong ba là không báo, công tắc `pancake.total_mismatch_check` tắt được bằng `PUT admin/config` mà không cần deploy. Đề nghị: với đơn thử đầu tiên, sửa tay một món trên Pancake rồi xem có ra lý do đúng không, và mở một đơn nguyên vẹn xem có bị báo nhầm không. Nếu báo nhầm hàng loạt thì tắt công tắc và gửi payload cho kỹ thuật chỉnh `pancake-total.ts`.
2. **Bấm "Đã xử lý" mà Pancake vẫn lệch.** Mặc định: lần webhook kế tiếp báo lại. Nếu muốn "chấp nhận lệch" một đơn thì cần thêm cờ riêng.
3. **Lọc "CTV".** Mặc định: đơn có người giới thiệu và không qua gian hàng; khách thường chia sẻ link cũng được ghi người giới thiệu nên lọt vào nhóm này dù không có hoa hồng. Nếu muốn chỉ CTV thật, cần nối bảng vai trò vào truy vấn.
4. **Ai được xem công nợ đại lý.** Mặc định: chỉ ADMIN. Kế toán và quản lý đại lý có cần xem không, và có được ghi nhận thanh toán không (hiện nút ghi tiền đi qua API chỉ ADMIN)?
5. **Điều kiện thanh toán của bậc (PREPAID / NET n).** Mặc định: chỉ hiển thị. Có muốn đơn đại lý bị chặn ghi công nợ khi bậc là PREPAID không?
