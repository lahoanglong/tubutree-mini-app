
## Lỗi

| ID | Mức | Khổ | Tên lỗi | Ca |
|---|---|---|---|---|
| L6-B01 | P2 | web 375 | Tab Doanh thu của Chủ nhãn bố cục khác Mini | L6-U25 |
| L6-B02 | P2 | web 375, web 1280 | Gian hàng CTV chưa duyệt hoặc không có: web hiện trang 404 chung, Mini hiện trang riêng có hướng dẫn | L6-U05 |
| L6-B03 | P3 | web 375 | Tên sheet cài đặt gian hàng khác nhau: Mini "Cài đặt gian hàng", web "Cấu hình gian hàng" | L6-U26 |
| L6-B04 | P3 | Mini 375, web 375 | Ô "Doanh thu" thống kê 30 ngày: số từ 1.000.000đ trở lên rớt chữ "đ" xuống dòng riêng | L6-U27 |
| L6-B05 | P3 | Mini 375, web 375 | Tab Công nợ đại lý: chữ gợi ý "Số tiền đã chuyển" bị cắt trong ô nhập | L6-U28 |
| L6-B06 | P3 | web 375 | Form Lên đơn hộ khách: web thiếu nhãn "Tỉnh/Thành phố" và "Phường/Xã" mà Mini có | L6-U30 |
| L6-B07 | P2 | API (Mini và web dùng chung) | Hai đơn Ghi công nợ của đại lý đến cùng lúc: bên thua nhận 500 "Lỗi cơ sở dữ liệu." thay vì lỗi thử lại được | L6-V12, L6-V15, L6-V16 |

### L6-B01 (P2) Tab Doanh thu của Chủ nhãn: web 375 bố cục khác Mini

- Khổ: web 375 (Mini 375 làm chuẩn). Persona `brand`.
- Thấy gì: ba ô số liệu và danh sách sản phẩm bán chạy xếp khác hẳn. Mini: biểu tượng ở trên, số lớn chữ có chân, nhãn ở dưới, danh sách sản phẩm phẳng. Web 375: biểu tượng bên trái, nhãn nhỏ ở trên, số chữ không chân, danh sách sản phẩm nằm trong thẻ trắng. Số liệu đúng (khớp API và SQL, ca L6-U23 PASS), chỉ khác cách trình bày. Chủ đã dặn web khổ điện thoại phải giống Mini cả giao diện.
- Nghi ngờ: `apps/web/src/components/brand-owner/sales-tab.tsx:18` (hàm `Stat`, `flex items-center gap-3`) so với `apps/miniapp/src/pages/brand-owner-sales.tsx:48` (`StatTile`, lưới hai cột).
- Tái hiện: bật lane 6, đăng nhập persona `brand`, mở Mini `/brand-owner` rồi bấm tab "Doanh thu"; mở web 375 `/chu-thuong-hieu` rồi bấm cùng tab; so hai ảnh.
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c9-ui-flows.mjs` (ca L6-U25; thư mục script nằm trong worktree `gl-1103-docs`, đường dẫn đầy đủ ở phần kết quả trả về).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-chu-nhan-tab-doanh-thu.png`, `shots/L6-ctv-dai-ly-nhan/web375-chu-nhan-tab-doanh-thu.png`.

### L6-B02 (P2) Gian hàng CTV chưa duyệt hoặc không tồn tại: web hiện 404 chung

- Khổ: web 375 và web 1280. Persona khách chưa đăng nhập, mở `/s/uatctvpending` (gian hàng đăng lần đầu, đang chờ Tubu duyệt).
- Thấy gì: API trả đúng 404 và khách không thấy gian hàng (đúng luật duyệt lần đầu). Mini hiện trang riêng: "Gian hàng", "Không tìm thấy", "Gian hàng này không tồn tại hoặc đã ngừng hoạt động.", "Có thể bạn thích". Web hiện trang 404 chung của cả site ("Không tìm thấy trang"). Trang thương hiệu `/brand/<slug>` trên web đã có `not-found.tsx` riêng giống Mini, còn `/s/<slug>` chưa có, nên khách bấm vào link CTV chưa duyệt không được gợi ý đi tiếp.
- Nghi ngờ: `apps/web/src/app/s/[slug]/page.tsx:51` (`if (!sf) notFound();` mà thư mục `apps/web/src/app/s/[slug]/` không có `not-found.tsx`); mẫu cần theo: `apps/web/src/app/brand/[slug]/not-found.tsx`; chữ Mini: `apps/miniapp/src/i18n/vi.ts:586`.
- Tái hiện: mở `http://localhost:3262/s/uatctvpending` (web) và `/s/uatctvpending` trên Mini 3263 khi không đăng nhập.
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c7-ui.mjs` (ca L6-U05).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-cong-khai-cho-duyet.png`, `shots/L6-ctv-dai-ly-nhan/web375-cong-khai-cho-duyet.png`, `shots/L6-ctv-dai-ly-nhan/web1280-cong-khai-cho-duyet.png`.

### L6-B03 (P3) Tên sheet cài đặt gian hàng khác nhau giữa Mini và web

- Khổ: web 375. Persona `ctv` (gian hàng đã duyệt).
- Thấy gì: bấm "Cài đặt" ở màn Gian hàng của tôi. Mini mở sheet tên "Cài đặt gian hàng", web mở sheet tên "Cấu hình gian hàng". Nút lưu ở cả hai nơi đều là "Lưu cấu hình gian hàng", nút gỡ đều là "Gỡ đăng gian hàng". Chưa có luật nói nên giữ cách gọi nào, xem mục CẦN CHỦ.
- Nghi ngờ: `apps/miniapp/src/pages/storefront-builder.tsx:58` (`CONFIG_TITLE`) và `apps/web/src/components/affiliate/storefront-sheets.tsx:257` (`title="Cấu hình gian hàng"`).
- Tái hiện: persona `ctv`, Mini `/storefront` và web 375 `/ctv/gian-hang`, bấm "Cài đặt", đọc tiêu đề sheet.
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c13-sf-settings-copy.mjs` (ca L6-U26).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-gian-hang-cai-dat-tieu-de.png`, `shots/L6-ctv-dai-ly-nhan/web375-gian-hang-cai-dat-tieu-de.png`.

### L6-B04 (P3) Ô Doanh thu 30 ngày: chữ "đ" rớt xuống dòng riêng ở khổ 375

- Khổ: Mini 375 và web 375. Persona `ctv`, màn Gian hàng của tôi, khối "Thống kê 30 ngày".
- Thấy gì: ba ô số liệu mỗi ô rộng 78px. Doanh thu từ 1.000.000đ trở lên (dạng "1.052.000đ", trường hợp thường gặp của CTV đang bán) không vừa một dòng, chữ "đ" xuống dòng riêng, ô cao hơn hai ô bên cạnh. Với doanh thu dưới 1 triệu ("836.000đ") thì vừa. Ca L6-U27 đo bằng DOM (số dòng của ô) trên số thật của lane và trên chuỗi thử "1.476.000đ".
- Nghi ngờ: `apps/miniapp/src/components/storefront-builder/stats-panel.tsx:13` (`StatBox`, `padding: 10`, `overflowWrap: 'anywhere'`) và `apps/web/src/components/affiliate/storefront-panels.tsx:19` (`StatBox`, `break-words`). Cho phép ngắt ở bất kỳ ký tự nào nên "đ" bị tách khỏi số.
- Tái hiện: mở màn Gian hàng của tôi ở 375 khi CTV có doanh thu 30 ngày từ 1 triệu trở lên.
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c16-layout-375.mjs` (ca L6-U27).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-do-o-thong-ke.png`, `shots/L6-ctv-dai-ly-nhan/web375-do-o-thong-ke.png`, `shots/L6-ctv-dai-ly-nhan/web1280-gian-hang-sua-ho-so.png` (thấy ô "1.476.000 / đ").

### L6-B05 (P3) Tab Công nợ đại lý: chữ gợi ý ô nhập bị cắt

- Khổ: Mini 375 và web 375. Persona `dealer`, Kênh đại lý, tab "Công nợ".
- Thấy gì: ô "Số tiền đã chuyển" nằm cùng hàng với nút "Báo đã chuyển khoản" (nút không co lại), nên ô chỉ còn 98px trên Mini và 114px trên web. Chữ gợi ý cần 136px (Mini) và 119px (web) nhưng chỗ trống chỉ 74px và 90px, nên hiện "Số tiền đã" (Mini) và bị cắt (web). Người dùng không biết ô này để nhập gì cho tới khi gõ.
- Nghi ngờ: `apps/miniapp/src/pages/dealer.tsx:934` (khối `display: 'flex', gap: 8` chứa `Input` và `Button` `flex: '0 0 auto'`) và `apps/web/src/components/dealer/credit-tab.tsx:63` (`mt-3 flex gap-2`, nút `flex-none`).
- Tái hiện: persona `dealer`, Mini `/dealer`, web 375 `/dai-ly`, bấm tab "Công nợ".
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c16-layout-375.mjs` (ca L6-U28).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-do-o-nhap-cong-no.png`, `shots/L6-ctv-dai-ly-nhan/web375-do-o-nhap-cong-no.png`.

### L6-B06 (P3) Form Lên đơn hộ khách: web thiếu nhãn hai ô chọn địa chỉ

- Khổ: web 375 (cũng gặp ở web 1280). Persona `ctv`, bấm "Lên đơn hộ".
- Thấy gì: Mini có nhãn nhìn thấy "Tỉnh/Thành phố" và "Phường/Xã" phía trên hai ô chọn; web chỉ có chữ gợi ý trong ô ("Chọn tỉnh/thành", "Chọn tỉnh/thành trước") và đặt tên ô ("Tỉnh/thành", "Phường/xã") trong `aria-label`, không hiện nhãn. Khi ô đã chọn xong thì người dùng web không còn thấy ô này là gì. Mọi chữ còn lại của sheet giống nhau (đã so từng dòng, đã bỏ chữ liệt kê tỉnh của ô chọn gốc).
- Nghi ngờ: `apps/web/src/components/geo-picker.tsx:44` và `:74` (chỉ `aria-label`) so với `apps/miniapp/src/components/geo-picker.tsx:68` (`label="Tỉnh/Thành phố"`) và dòng tương ứng của ô Phường/Xã.
- Tái hiện: persona `ctv`, Mini `/affiliate` và web 375 `/ctv`, bấm "Lên đơn hộ", so hai nhóm ô địa chỉ.
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c17-order-sheet-ui.mjs` (ca L6-U30).
- Ảnh: `shots/L6-ctv-dai-ly-nhan/mini375-len-don-ho-trong.png`, `shots/L6-ctv-dai-ly-nhan/web375-len-don-ho-trong.png`, `shots/L6-ctv-dai-ly-nhan/mini375-len-don-ho-loi.png`, `shots/L6-ctv-dai-ly-nhan/web375-len-don-ho-loi.png`.

### L6-B07 (P2) Đơn đại lý Ghi công nợ đến cùng lúc: bên thua nhận 500 "Lỗi cơ sở dữ liệu."

- Khổ: API (Mini và web gọi chung `POST /dealer/orders`). Persona `dealer`, thanh toán `CREDIT` (Ghi công nợ).
- Thấy gì: bắn song song nhiều đơn Ghi công nợ thì đơn thắng tạo bình thường, đơn thua trả 500 `{"message":"Lỗi cơ sở dữ liệu."}`. Tiền vẫn an toàn: tổng nợ không bao giờ vượt hạn mức 20.000.000đ, mỗi đơn 201 có đúng một dòng sổ, không đơn mồ côi (ca L6-V11, V13, V14 PASS). Lỗi ở chỗ ba kiểu gọi hợp lệ đều dính:
  - bốn đơn mỗi đơn 7.465.500đ, khác khoá, hạn mức chỉ đủ hai: kết quả 201, 201, 500, 500 (ca L6-V12);
  - hai đơn nhỏ 3.118.500đ, khác khoá, tổng còn xa hạn mức: một đơn 201, một đơn 500 dù cả hai đều hợp lệ (ca L6-V15);
  - hai lệnh cùng Idempotency-Key chạy song song (bấm đúp hoặc ứng dụng gửi lại khi mạng chậm): một 201, một 500 thay vì nhận lại đúng đơn đã tạo (ca L6-V16). Đại lý thấy báo lỗi trong khi đơn đã được tạo, dễ đặt lại và nợ đôi.
  So sánh: đơn trả trước (`PREPAID`) song song cho kết quả 201, 201; ghi nhận tiền về của kế toán song song (cùng mã báo cáo hoặc cùng khoá) trả 201 hoặc 400 "Hệ thống đang bận xử lý công nợ đại lý này, bạn thử lại nhé." đúng như thiết kế (ca L6-V21, V22 PASS). Chỉ đường đặt đơn công nợ bị lệch.
- Nguyên nhân (đọc mã + log API lane 6): câu raw `reserveAvailableVariationStock` (`WITH old AS (SELECT ... FOR UPDATE) UPDATE variations`) chạy trong transaction `Serializable` của đơn công nợ và nổ Postgres `40001 could not serialize access due to concurrent update`. Prisma gói thành `P2010` (log: "Prisma P2010 on POST /api/dealer/orders ... Raw query failed. Code: `40001`"), còn khối `catch` chỉ nhận `code === 'P2034'`, nên không vào nhánh "Hệ thống đang bận xử lý đơn công nợ, bạn thử lại nhé." và cũng không vào nhánh P2002 nhận lại đơn theo khoá; lỗi rơi xuống bộ lọc Prisma chung và thành 500 với chữ kỹ thuật "Lỗi cơ sở dữ liệu." (chữ chung chuẩn là "Đã có lỗi xảy ra. Bạn thử lại nhé.").
- Nghi ngờ: `apps/api/src/modules/dealer/dealer.service.ts:391` (nhánh `catch` chỉ dò `P2034`) và `apps/api/src/modules/catalog/variation-stock.ts:242` (câu raw ném `40001` dưới dạng `P2010`); `apps/api/src/common/lock-busy.ts` đã có kiểu dò mã SQLSTATE trong message cho `40P01`, chưa có `40001`.
- Tái hiện: bật lane 6, chạy script (tự dọn nợ, tạo và huỷ đơn thử, trả nợ về như trước). Ca L6-V12, L6-V15, L6-V16 FAIL; xem log lane `state/lane-6/logs/api.log`, tìm "P2010 on POST /api/dealer/orders".
- Script: `node docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/c23-dealer-credit-race.mjs`.
- Ghi chú về mức độ: bấm đúp nút "Ghi công nợ" trên Mini 375 và web 375 chỉ tạo một đơn và không hiện lỗi (ca L6-U43, U44 PASS, script `c27-dealer-doubleclick-ui.mjs`), nên giao diện tự khoá lần bấm thứ hai. Lỗi chỉ lộ khi hai lệnh đến máy chủ cùng lúc từ hai thiết bị hoặc hai tab (Mini và web cùng đăng nhập một đại lý), khi ứng dụng gửi lại do mạng chậm, hoặc khi gọi API trực tiếp. Vì tiền không lệch và thử lại là qua nên xếp P2.
- Ảnh: không có cho lỗi này (lỗi API); ảnh bấm đúp ở `shots/L6-ctv-dai-ly-nhan/mini375-dai-ly-bam-dup.png`, `shots/L6-ctv-dai-ly-nhan/web375-dai-ly-bam-dup.png`.

## Đối soát SQL cuối lane

Chạy trên DB `tubutree_uat_l6` sau toàn bộ ca (lệnh đọc, không sửa):

| Mục | Kết quả |
|---|---|
| `apps/api/scripts/reconcile-points.ts` (dry-run) | Lô STANDARD 0 user lệch, lô CONVERTED 0 user lệch. |
| `apps/api/scripts/reconcile-wallet.ts` | 0 user lệch, chênh ròng 0đ. |
| Ví và sổ ví | `uat_ctv` ví 2.485.950đ = Σ sổ 2.485.950đ; `uat_new` 575.000đ = 575.000đ; `uat_returning` 11.900đ = 11.900đ (đo lại sau ca V18 đến V23 và script c27). |
| CTV `uat_ctv` | Σ dòng `COMMISSION_PAYOUT` 6.666.408đ (9 dòng) = Σ `payouts.amount` 6.666.408đ (thuế TNCN đã khấu trừ 740.712đ, tổng gốc 7.407.120đ); Σ `COMMISSION_REVERSAL` −4.180.458đ (5 dòng); 6.666.408 − 4.180.458 = 2.485.950đ = số dư ví. Hoa hồng: 7 PAID (2.758.080đ), 2 PENDING (12.640đ), 6 REJECTED (4.668.000đ). |
| Mốc thưởng tháng | `ctv_milestone_claims`: `uat_ctv` có milestone-3m và milestone-10m, `uat_ctv_pending` có milestone-3m; không dòng nào đang ở trạng thái đã thu hồi (`revokedAt` rỗng), `revokeDebt` 0; milestone-10m ghi `revokeTaken` 200.000 điểm từ lần thu hồi của nhóm ca E. Từng bước thu hồi, nợ và nhận lại đã đối chiếu `points_transactions` trong ca E01 đến E08. |
| Công nợ đại lý `uat_dealer` | Σ `dealer_credit_ledgers` = 0đ (41 dòng): ORDER +71.437.200 (18 dòng), ORDER_CANCEL −61.363.200 (15 dòng), PAYMENT −10.011.630 (6 dòng), QUARTER_BONUS −249.480, QUARTER_BONUS_ADJ +187.110; 71.437.200 − 61.363.200 − 10.011.630 − 249.480 + 187.110 = 0. Dư nợ 0 vì các ca V21 đến V23 trả hết nợ nền khi chạy xong; số này khớp màn Công nợ (ca L6-U36, U45). |

## Hạn chế bộ khung

Các điểm dưới đây do bộ khung giả hoặc cách chạy lane, không tính FAIL.

- `run-job.mjs` đôi khi thoát mã 1 sau khi đã in kết quả (worker BullMQ báo "Connection is closed" lúc đóng Redis); hàm `runJob` trong `common.mjs` đọc stdout và thử lại tối đa 3 lần.
- `seed-data.mjs all` kết thúc bằng lỗi ở bước `extra` (`list.slice is not a function`) vì tính năng Đổi rác lấy quà đang tắt trong lane (`/waste/items` trả 403). Các bước seed chính đã xong, số migration 267 và dữ liệu đủ cho mọi ca.
- `lane-db create --fresh` không xoá trạng thái Pancake giả (`state/lane-6/pancake/app-orders.json`). Lần chạy thử đầu, mã đơn ngẫu nhiên của đơn mới trùng một mã còn trong kho giả từ lần dựng cũ, webhook "đã giao" đến nhầm đơn Pancake cũ, nên ca C18 báo FAIL giả (API đã ghi log "bỏ qua cập nhật" và báo động đúng). Từ lần dựng sạch, script dựng lane của tôi xoá file này trước khi bật Pancake giả; sau đó C18 PASS.
- Đơn đại lý hết hàng chuyển thành đặt trước không được đẩy lên Pancake giả, nên webhook giao hàng không dùng được cho các đơn đó; các ca c5 và c15 dùng đơn đủ kho.
- Zalo, ZNS, OA, Gomdon, ZaloPay đều tắt trong lane; bằng chứng thông báo duy nhất là bảng `notification_logs`. Không kiểm được việc gửi thật.
- Ảnh sản phẩm trong lane để trống nên ảnh chụp có ô ảnh xám.
- Ô ngày hiển thị mm/dd/yyyy vì trình duyệt không đầu dùng ngôn ngữ mặc định; không phản ánh bản địa hoá thật.
- Ảnh chụp web có biểu tượng "N" của Next dev ở góc; ảnh chụp toàn trang có thanh dưới cố định xuất hiện giữa trang; ảnh Mini toàn trang chụp bằng khung cao 1900px.
- Mốc thời gian chạy bằng SQL và tham số: duyệt hoa hồng bằng cách lùi `lockedAt` 11 ngày rồi chạy `AffiliateService.approveDueCommissions`; cổng giờ 08:00 của lượt tự chuyển Ví và quý thưởng đại lý chạy bằng tham số `now` của `run-job`. `DealerService.settledVisibleBy` kẹp `now` theo giờ thật nên script c15 chờ 66 giây sau khi chốt đơn mới thấy doanh số (đúng thiết kế, biên 60 giây).
- Vai trò đổi bằng SQL hoặc `POST /admin/users/role` cần chờ khoảng 6 đến 7 giây để bộ nhớ đệm quyền hết hạn; các script đã có chờ.

## CẦN CHỦ

Các mục chưa có luật rõ; không tính FAIL.

1. **L6-E07, chữ khi nhận lại mốc mà nợ thu hồi ăn hết thưởng.** Khi nợ thu hồi bằng đúng cả phần thưởng, màn mốc hiện "nhận lại 0 Điểm Xanh" kèm nút nhận 0 điểm ("Bạn nhận lại 0 Điểm Xanh từ Mốc Khởi Động 3 Triệu (đã trừ 50.000 điểm chưa thu hết lần trước)"). Tiền và điểm đúng sổ. Chưa có chữ chuẩn cho trường hợp này; cần chủ chốt chữ hoặc ẩn nút khi phần nhận bằng 0.
2. **Nhiệm vụ gian hàng "Đăng gian hàng" (1.000 Điểm Xanh) nhận được ngay khi CTV bấm đăng, trước khi Tubu duyệt lần đầu.** Điều kiện hiện chỉ là cờ đăng của chủ gian hàng (`isPublished`), nên CTV mới có thể nhận điểm cho gian hàng khách chưa thấy được. Cần chủ quyết có đợi duyệt hay không.
3. **Bảng kê thuế năm vẫn tính thu nhập gộp của hoa hồng đã bị thu hồi về sau.** Đã được ghi nhận là để kế toán xử lý qua cảnh báo vận hành; cần chủ xác nhận cách xử lý này là chốt.
4. **L6-B03, gọi tên sheet là "Cài đặt gian hàng" (Mini) hay "Cấu hình gian hàng" (web).** Nút vào sheet ở cả hai nơi là "Cài đặt", nút lưu ở cả hai nơi là "Lưu cấu hình gian hàng", nên chưa biết nên theo bên nào.
5. **L6-B06, nhãn hai ô chọn địa chỉ.** Web có thể cố ý bỏ nhãn vì đã có chữ gợi ý trong ô; cần chủ cho biết Mini hay web là chuẩn.

## Đã làm và chưa làm

Đã làm (243 ca: 233 PASS, 9 FAIL, 1 CẦN CHỦ; chạy trên lane dựng mới, 267 migration, đủ ba khổ cho các màn chính của luồng cũ, riêng các luồng giao diện thêm sau chỉ ở 375):

- **Hoa hồng CTV đầu cuối (C01 đến C21):** mã giới thiệu và thời hạn gắn khách, hoa hồng 8% và theo `Variation.affiliateRate`, hoa hồng giữ theo `affiliate.hold_days` rồi tự chuyển Ví từ 08:00 một lần mỗi ngày, chuyển Ví bằng tay với Idempotency-Key và 5 yêu cầu song song, CTV tự mua không hưởng, khách thường và sản phẩm chặn affiliate không sinh hoa hồng.
- **Thuế TNCN và mốc thưởng (D01 đến D24):** khấu trừ 10% khi tổng tháng đạt 5.000.000đ, thông báo `COMMISSION_TAX_ID_NEEDED` một lần mỗi tháng, bảng bậc CTV và mốc thưởng tháng, nhận mốc một lần dù gọi song song.
- **Thu hồi (E01 đến E08, J01 đến J08, V18 đến V20):** trả hoặc huỷ đơn thu hồi hoa hồng và mốc, nợ thu hồi `revokeDebt`/`revokeTaken`, thông báo `COMMISSION_MILESTONE_REVOKED`, trả một phần cắt hoa hồng theo tỉ lệ từng dòng và dòng hoa hồng 0%; ba webhook `returned` trùng nhau chạy song song chỉ thu hồi một lần (Ví, điểm khách, kho giống hệt đơn đối chứng).
- **Gian hàng CTV (F01 đến F26, Q01 đến Q06, R01 đến R09, X01 đến X03, U40 đến U42):** dựng gian hàng (cả bằng trình dựng trên Mini và web: Thêm khối, Lưới, Tạo và thêm món, thêm một sản phẩm, trang công khai hiện khối và món), từ chối tên miền phụ trùng từ khoá hoặc sai dạng và ảnh nguy hiểm (`javascript:`, `http:`, SVG, `text/html`), duyệt lần đầu, đổi nội dung sau duyệt, gỡ và khôi phục, ghi công qua slug, lời nhắn có URL và HTML hiện thành chữ, nhiệm vụ nhận một lần, ma trận quyền 187 lệnh gọi, chống truy cập chéo gian hàng và đơn.
- **Lên đơn hộ khách (M01 đến M11, U29 đến U32, U37 đến U39):** API (báo giá, COD tối đa 5.000.000đ, SĐT khác CTV, Idempotency-Key, kho trừ một lần) và giao diện form (mở được, chữ, báo lỗi từng ô, điền đủ, chọn tỉnh và phường, chọn phân loại, bấm Tạo đơn hộ khách trên Mini và web, đơn khớp SQL, hoa hồng 8%, huỷ đơn thử trả kho và đóng hoa hồng).
- **Đại lý (G01 đến G21, V01 đến V17, V21 đến V23, W01 đến W10, U33 đến U36, U43 đến U45):** giá sỉ theo bậc, giá riêng theo bậc, trần chiết khấu, đơn tối thiểu 3.000.000đ, phí giao, hạn mức công nợ và kỳ hạn, đơn công nợ, thu hồi, nhập giá hàng loạt, mẫu đơn, thưởng doanh số quý, thu hồi phần biên khi huỷ đơn, thưởng mốc tour và quà (gửi, duyệt, từ chối, mở lại, chi), đặt đơn bằng giao diện (Dán đơn với SKU viết thường, dòng trùng, SKU lạ; thanh đặt hàng; Ghi công nợ; bấm đúp), đơn công nợ song song (xem L6-B07) và ghi nhận tiền về song song. Chống truy cập chéo giữa hai đại lý (R06 đến R09): đại lý thứ hai là persona `new` được đổi vai tạm, không thấy danh sách đơn, sổ công nợ, mẫu đơn của đại lý thứ nhất, xem, huỷ đơn và xoá mẫu của họ đều bị từ chối.
- **Chủ nhãn (H01 đến H27):** quyền, công khai khi đăng, sửa hồ sơ trong danh sách cho phép (cả bằng giao diện Mini và web, ký tự HTML hiện thành chữ), khuyến mãi, theo dõi, doanh thu theo kỳ và không lộ thông tin khách.
- **Giao diện (U01 đến U45):** các màn CTV, gian hàng, đại lý, chủ nhãn, gian hàng công khai ở Mini 375, web 375 và web 1280, chữ so với SQL, so Mini với web, chữ cấm, và đối soát số trên màn với SQL; bấm "Chuyển vào Ví" thật trên Mini (khả dụng 378.400đ, thuế 37.840đ, Ví +340.560đ, màn hiện số dư mới).
- Đối soát: `reconcile-points.ts`, `reconcile-wallet.ts` và các truy vấn SQL ở mục trên.

Chưa làm:

- Tải ảnh đại diện và ảnh bìa gian hàng lên thật bằng giao diện (chỉ kiểm từ chối giá trị nguy hiểm ở mức API); kéo thả đổi thứ tự khối.
- Các luồng giao diện mới (U33 đến U45, H25 đến H26) chỉ chạy ở web 375 và Mini 375, chưa chạy ở web 1280.
- Gửi thông báo thật qua Zalo, ZNS và OA, và webhook Pancake thật (lane dùng giả).
- Tải lớn và chạy song song nhiều hơn 5 yêu cầu.
