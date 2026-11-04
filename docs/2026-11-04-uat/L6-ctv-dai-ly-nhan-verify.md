# Kiểm lại lane 6 (L6-ctv-dai-ly-nhan): reviewer đối kháng

Ngày 04/11/2026, khoảng 05:30 đến 05:50 giờ máy. Mã: worktree `uat-1104`, SHA `98803f006` (giống PROD). Lane 6 đang bật sẵn (API 3261, web 3262, Mini 3263), giữ DB, không dựng lại.
Cách làm: chạy lại đúng lệnh repro của từng FAIL từ gốc `uat-1104`, đọc mã ở chỗ nghi ngờ, so với luật đã chốt (brief UAT: web 375 giống Mini cả chữ lẫn bố cục; lỗi chung API "Đã có lỗi xảy ra. Bạn thử lại nhé.").
Không sửa mã ứng dụng, không push. Chạy lại script làm `results.jsonl` có thêm dòng mới (build-report lấy dòng cuối mỗi ID, kết quả các ca trong danh sách không đổi) và ghi đè ảnh cùng tên trong `shots/L6-ctv-dai-ly-nhan/`.

## Kết luận

| ID | Lane xếp | Kết luận | Mức sau kiểm | Chỗ lỗi thật |
|---|---|---|---|---|
| L6-B07 | P2 | CONFIRMED | P2 | `apps/api/src/modules/dealer/dealer.service.ts:391` |
| L6-B01 | P2 | CONFIRMED | P2 | `apps/web/src/components/brand-owner/sales-tab.tsx:18` |
| L6-B02 | P2 | CONFIRMED | P2 | `apps/web/src/app/s/[slug]/page.tsx:51` |
| L6-B03 | P3 | CONFIRMED | P3 | `apps/web/src/components/affiliate/storefront-sheets.tsx:257` |
| L6-B04 | P3 | CONFIRMED | P3 | `apps/miniapp/src/components/storefront-builder/stats-panel.tsx:16`, `apps/web/src/components/affiliate/storefront-panels.tsx:22` |
| L6-B05 | P3 | CONFIRMED | P3 | `apps/miniapp/src/pages/dealer.tsx:935`, `apps/web/src/components/dealer/credit-tab.tsx:62` |
| L6-B06 | P3 | CONFIRMED | P3 | `apps/web/src/components/geo-picker.tsx:45` và `:75` |

Không bác được lỗi nào. B03 và B06 lane ghi kèm "CẦN CHỦ" chọn chữ chuẩn; tôi xếp CONFIRMED vì luật đã chốt là web khổ điện thoại phải giống Mini cả chữ, nên Mini là chuẩn, không cần chủ chọn lại.

## Chi tiết

### L6-B07: CONFIRMED, P2

- Chạy lại `c23-dealer-credit-race.mjs`: tái hiện. V11 trạng thái `500,500,201,500`; V12 ba lần từ chối đều `500:Lỗi cơ sở dữ liệu.`; V15 `201 | 500`; V16 (cùng Idempotency-Key) `201 | 500`. V13, V14, V17 PASS (không đơn mồ côi, nợ về 0).
- Log lane (`state/lane-6/logs/api.log` dòng 962 đến 979): `Prisma P2010 on POST /api/dealer/orders ... Raw query failed. Code: 40001. Message: could not serialize access due to concurrent update`.
- Mã: tx `Serializable` cho đơn CREDIT (`dealer.service.ts:387`); trong tx có hai câu raw `$queryRaw` trên `variations`: `lockVariationsInIdOrder` (`apps/api/src/modules/catalog/variation-stock.ts:57`, chỉ chạy khi có từ 2 biến thể) và `reserveAvailableVariationStock` (`variation-stock.ts:242`). Câu raw thua tranh trong Serializable ném `40001` dưới mã Prisma `P2010`, không phải `P2034`. Khối `catch` ở `dealer.service.ts:389-401` chỉ nhận `P2034` và `P2002`, nên lỗi rơi xuống `apps/api/src/common/filters/prisma-exception.filter.ts:76-80` thành 500 "Lỗi cơ sở dữ liệu.".
- Với V16: bên thua chết vì `40001` trước khi tới `P2002`, nên nhánh "trả lại đơn theo khoá" không chạy; đại lý thấy lỗi dù đơn đã tạo.
- Mức: tiền và công nợ không lệch (khoá Serializable vẫn đúng); UI tự chặn bấm đúp (U43, U44 PASS). Giữ P2.
- Sửa: trong `catch`, coi `P2010` có `meta.code === '40001'` (hoặc message chứa `40001`) như `P2034`; trước khi ném lỗi bận, nếu có `key` thì tra `order.findUnique({ idempotencyKey: key })` và trả lại đơn đã có. Tốt hơn: chạy lại cả tx một lần khi gặp 40001/P2034. Thêm `40001` vào `isLockBusy` trong `apps/api/src/common/lock-busy.ts`. Phụ: bộ lọc Prisma chung trả "Lỗi cơ sở dữ liệu." không theo chữ lỗi chung đã chốt "Đã có lỗi xảy ra. Bạn thử lại nhé." (`prisma-exception.filter.ts:80`).

### L6-B01: CONFIRMED, P2

- Chạy lại `c9-ui-flows.mjs` (không đặt `CLICK`, dừng trước bước ghi Ví): U25 FAIL. Thứ tự Mini `Doanh thu|10.282.000đ|Doanh thu|20|Số đơn|39|Sản phẩm đã bán`, web 375 `Doanh thu|Doanh thu|10.282.000đ|Số đơn|20|...`.
- Ảnh mới chụp xác nhận: Mini biểu tượng trên, số lớn chữ có chân, nhãn dưới; "Sản phẩm bán chạy" là danh sách phẳng. Web 375 biểu tượng tròn bên trái, nhãn trên số, số không chân; "Sản phẩm đã bán" xuống hai dòng; danh sách SP nằm trong thẻ trắng.
- Mã: web `Stat` ở `apps/web/src/components/brand-owner/sales-tab.tsx:18-29` (`flex items-center gap-3`, nhãn trước số). Mini dùng `StatTile` từ `apps/miniapp/src/components/ui/tiles` (`apps/miniapp/src/pages/brand-owner-sales.tsx:50-53`).
- Luật: web 375 phải giống Mini cả bố cục (brief; chủ dặn). Lệch parity rõ, đúng P2.
- Sửa: dựng `Stat` web theo bố cục `StatTile` Mini (biểu tượng trên, số dùng font tiêu đề, nhãn dưới) ở `max-md`, bỏ thẻ trắng của danh sách bán chạy ở `max-md`; giữ bố cục rộng cho `lg`.

### L6-B02: CONFIRMED, P2

- Chạy lại `c7-ui.mjs`: U05 FAIL. Web 375 `/s/uatctvpending` hiện 404 chung "Không tìm thấy trang / Trang này lạc vào vườn rồi"; Mini hiện "Gian hàng / Không tìm thấy / Gian hàng này không tồn tại hoặc đã ngừng hoạt động. / Về trang chủ / Cần hỗ trợ? / Có thể bạn thích" kèm sản phẩm gợi ý.
- Mã: `apps/web/src/app/s/[slug]/page.tsx:51` gọi `notFound()`; thư mục `apps/web/src/app/s/[slug]/` không có `not-found.tsx` (có ở `apps/web/src/app/brand/[slug]/not-found.tsx`). Chữ Mini: `apps/miniapp/src/i18n/vi.ts:586`.
- Luật: parity chữ lẫn bố cục với Mini. Web vẫn có nút về trang chủ nên khách không kẹt, nhưng chữ và khối gợi ý khác rõ. Giữ P2.
- Sửa: thêm `apps/web/src/app/s/[slug]/not-found.tsx` theo mẫu `brand/[slug]/not-found.tsx`, dùng chữ Mini và khối "Có thể bạn thích".
- Ghi chú phụ: lần chạy lại này U01 và U13 cũng FAIL vì số dư Ví của `uat_ctv` đã đổi sau các script chạy sau c7 (script viết để chạy sớm theo thứ tự). Đó là trôi trạng thái lane, không phải lỗi mới.

### L6-B03: CONFIRMED, P3

- Chạy lại `c13-sf-settings-copy.mjs`: U26 FAIL, Mini "Cài đặt gian hàng", web "Cấu hình gian hàng"; hai nút trong sheet giống nhau.
- Mã: `apps/miniapp/src/pages/storefront-builder.tsx:58` (`CONFIG_TITLE = 'Cài đặt gian hàng'`), `apps/web/src/components/affiliate/storefront-sheets.tsx:257` (`title="Cấu hình gian hàng"`).
- Luật: web giống Mini cả chữ; Mini là chuẩn và nút mở sheet ở cả hai nơi là "Cài đặt", nên "Cài đặt gian hàng" khớp hơn. Không cần chủ chọn.
- Sửa: web đổi tiêu đề sheet thành "Cài đặt gian hàng", tốt nhất dùng chung một hằng trong `packages/app-core` (ví dụ `BUILDER_COPY`) cho cả hai app.

### L6-B04: CONFIRMED, P3

- Chạy lại `c16-layout-375.mjs`: U27 FAIL với số thật của lane: ô giữa "1.052.000đ" 2 dòng ở cả Mini và web (ô rộng 78px). Ảnh Mini thấy "1.052.000" rồi "đ" ở dòng riêng, ô cao hơn hai ô bên cạnh.
- Mã: Mini `StatBox` ở `apps/miniapp/src/components/storefront-builder/stats-panel.tsx:13-19` (`padding: 10`, `overflowWrap: 'anywhere'` ở dòng 16); web `StatBox` ở `apps/web/src/components/affiliate/storefront-panels.tsx:19-26` (`break-words` ở dòng 22).
- Sửa: cho giá trị `whiteSpace: 'nowrap'` và co chữ khi dài (giảm cỡ chữ theo độ dài chuỗi hoặc dùng số rút gọn "1,05 tr"), hoặc giảm padding ngang; giữ giống nhau ở hai app.

### L6-B05: CONFIRMED, P3

- Chạy lại `c16-layout-375.mjs`: Mini đo `need 136 / room 74 / ô 98px`, ảnh hiện "Số tiền đã". Lần đó web trả `null` vì cú bấm tab "Công nợ" chạy trước khi trang web nhận sự kiện (ảnh web vẫn ở tab Bảng giá), là lỗi thời gian của script. Tôi đo lại web riêng, chờ 8 giây rồi bấm tab: `need 119 / room 90 / ô 114px`, nên web cũng bị cắt.
- Mã: Mini `apps/miniapp/src/pages/dealer.tsx:935-941` (hàng `display: flex, gap: 8`, `Input` co, `Button` giữ cỡ); web `apps/web/src/components/dealer/credit-tab.tsx:62-73` (`mt-3 flex gap-2`, nút `flex-none`). Ô nhập Mini chỉ có placeholder, không nhãn hay `aria-label`.
- Sửa: tách ô nhập và nút thành hai dòng ở khổ hẹp, hoặc thêm nhãn nhìn thấy "Số tiền đã chuyển" phía trên ô và để placeholder ngắn (ví dụ "Nhập số tiền"); làm giống nhau ở hai app.

### L6-B06: CONFIRMED, P3

- Chạy lại `c17-order-sheet-ui.mjs`: U30 FAIL, chỉ Mini có `Tỉnh/Thành phố`, `Phường/Xã`; mọi chữ khác giống nhau.
- Mã: web `apps/web/src/components/geo-picker.tsx:45` và `:75` chỉ có `aria-label`; Mini `apps/miniapp/src/components/geo-picker.tsx:68` và `:94` có `label`. Trong chính form web `apps/web/src/components/affiliate/ctv-order-sheet.tsx:329-343`, các ô Tên người nhận, Số điện thoại, Địa chỉ đều có nhãn nhìn thấy (`Field label`), chỉ hai ô địa chỉ thiếu. Vậy không phải web cố ý dùng kiểu chỉ có placeholder, và Mini là chuẩn.
- `GeoPicker` web còn dùng ở `apps/web/src/components/address-form.tsx:98` (sổ địa chỉ, thanh toán) nên lệch này có ở cả các form đó.
- Sửa: thêm nhãn nhìn thấy "Tỉnh/Thành phố" và "Phường/Xã" trong `GeoPicker` web (bọc `label` như `Field`), giữ `aria-label` hoặc nối `htmlFor`.

## Ngoài danh sách (không kết luận)

- Chạy lại `c9-ui-flows.mjs` làm U21 (tab Báo cáo đại lý ở web 375) FAIL dù lần chạy của lane PASS. Dạng lỗi giống lần đầu đo B05 trên web: cú bấm tab chạy trước khi trang nhận sự kiện. Nhiều khả năng do script và tải máy; chưa kiểm riêng.

## Dọn dẹp

Chạy `docs/2026-10-20-uat/tools/uat-harness/lane-down.sh 6` (không `--drop`). Script đo web riêng cho B05 nằm ở thư mục nháp của phiên, không ghi vào repo.
