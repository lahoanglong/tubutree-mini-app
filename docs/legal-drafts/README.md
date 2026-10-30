# Bản nháp 4 trang pháp lý Tubu Tree

Soạn ngày 2026-10-18, nhánh `lr2/legal`. Soát lại ngày 2026-10-30 theo mã ở main `d489574bf` (nhánh `docs/legal-sync-2026-10-30`), xem mục 8. Chưa luật sư nào xem. Đây là nháp để chủ dự án đọc, sửa rồi dán vào Quản trị → Cấu hình.

Việc này đang chặn mở bán: go-live PROD còn FAIL `db.legal_policies` (bốn khoá `legal.*` còn trống) và `db.company_identity` (ba khoá `company.*` còn trống), xem `apps/api/src/config/go-live/db-checks.ts:465-486`. Điền mục 3 và dán bốn file là gỡ được cả hai.

| File | Khoá cấu hình | Trang web | Trong Mini App |
|---|---|---|---|
| `dieu-khoan.md` | `legal.dieu-khoan` | `/chinh-sach/dieu-khoan` | popup "Điều khoản sử dụng" |
| `bao-mat.md` | `legal.bao-mat` | `/chinh-sach/bao-mat` | popup "Chính sách bảo mật" |
| `doi-tra.md` | `legal.doi-tra` | `/chinh-sach/doi-tra` | popup "Chính sách đổi trả" |
| `van-chuyen.md` | `legal.van-chuyen` | `/chinh-sach/van-chuyen` | popup "Chính sách vận chuyển" |

## 1. Trang hiển thị thế nào (vì sao dùng markdown)

- `GET /config/legal/:loai` trả `content` là chuỗi thô lấy từ khoá `legal.<loai>`; rỗng thì `content: null` (`apps/api/src/modules/system-config/legal-config.controller.ts:13-18`, `:55`). Kèm `vars` (hạn đổi trả, ngưỡng freeship, phí ship, `company.*`) chỉ để dựng bản nháp mặc định (`:57-64`).
- Web: `apps/web/src/app/chinh-sach/[loai]/page.tsx:31` coi `content === null` là bản nháp: hiện biển "BẢN NHÁP" (`:37-45`), dùng bản mặc định `defaultLegalContent` (`:32`) và đặt `noindex` (`:23`). Có nội dung rồi thì biển biến mất và trang được lập chỉ mục. Trang cache ISR 300 giây (`:9`).
- Mini App: cùng nội dung hiện trong popup `apps/miniapp/src/components/policy-sheet.tsx:22-76` (không rời Mini App). Chưa có nội dung thì popup cũng hiện biển "BẢN NHÁP" và bản mặc định (`:58-72`).
- Bản mặc định khách đang thấy nằm ở `packages/app-core/src/legal.ts` (web `apps/web/src/lib/legal.ts` chỉ re-export). Xem mục 6 về chỗ bản này nói sai.
- Bộ dựng markdown tối giản: web `apps/web/src/components/legal-markdown.tsx` (regex `:10-13`, `:57`, lọc link `:61-68`), Mini App `apps/miniapp/src/components/legal-markdown.tsx`. Chỉ hiểu: tiêu đề `##` và `###`, đoạn văn, danh sách gạch đầu dòng và đánh số MỘT cấp, `**đậm**`, liên kết `[chữ](đường dẫn)`, đường kẻ `---`. Không có bảng, in nghiêng, danh sách lồng, trích dẫn, mã `` ` ``. HTML thô bị escape. Tiêu đề trang (h1) do app tự đặt, nên file bắt đầu từ `##`.
- Liên kết: web nhận `/chinh-sach/...`, `https://`, `mailto:`, `tel:`. Mini App chỉ mở được `/chinh-sach/<loại>` (mở popup chính sách đó), liên kết ngoài chỉ hiện chữ (`apps/miniapp/src/components/legal-markdown.tsx:60-62`). Bốn file chỉ dùng liên kết `/chinh-sach/...`.
- Giới hạn: tối đa 50.000 ký tự mỗi khoá (`apps/api/src/modules/system-config/system-config.service.ts:42`, `:46`). Bốn file dài 5k đến 15k ký tự.
- Khung nhập: tab Cấu hình có thẻ "Thông tin cửa hàng & chính sách" gồm bốn khoá `company.*` và bốn ô chính sách, mỗi ô có nút "Xem trước" và "Lưu", lưu chữ thô, không cần escape (`apps/web/src/components/admin/shop-info-card.tsx:11-16`, `:100-132`; gắn ở `apps/web/src/app/admin/page.tsx:2573`). Ô JSON chung của khoá `legal.*` cũng là ô nhiều dòng (`apps/web/src/components/admin/config-item.tsx:54`, `:98`).
- Ngày 18/10 đã đưa cả bốn file qua đúng component `LegalMarkdown` của web bằng `react-dom/server`: không còn ký tự markdown chưa dựng, mọi liên kết là `/chinh-sach/...`. Đợt 30/10 không chạy lại (chỉ sửa chữ, không thêm cú pháp mới). Các dấu `[chủ quyết: ...]` có `` ` `` quanh tên khoá, phải xoá trước khi dán.

## 2. Cách dán

1. Điền hết chỗ trống (mục 3), xử lý các chỗ `[cần luật sư kiểm]` (mục 4) và `[chủ quyết: ...]` (mục 8), rồi xoá luôn các dấu đó.
2. Kiểm trước khi dán, lệnh không được in ra dòng nào:
   `grep -nE '\[(NGÀY|SỐ|NGƯỜI|NƠI|cần|chủ quyết)' docs/legal-drafts/{dieu-khoan,bao-mat,doi-tra,van-chuyen}.md`
3. Điền các khoá `company.*` và `support.*` ở mục 3 trước (Quản trị → Cấu hình, thẻ "Thông tin cửa hàng & chính sách"; `support.*` ở nhóm `support`), để chân trang và bài khớp nhau.
4. Mở file, chép toàn bộ nội dung. Trong cùng thẻ đó, dán vào ô của chính sách tương ứng, bấm "Xem trước" để soát, rồi "Lưu".
5. Mở `/chinh-sach/<loai>` (chờ tối đa 5 phút cache) và popup chính sách trong Mini App (Cá nhân → "Về Tubu Tree & Hỗ trợ"). Biển "BẢN NHÁP" phải biến mất. Bấm thử các liên kết chéo giữa bốn trang ở cả hai nơi.
6. Chạy lại go-live check: `db.legal_policies` và `db.company_identity` phải PASS.

## 3. Chỗ trống chủ dự án điền

Mỗi dòng là một thông tin. Cột "Khoá cấu hình" là chỗ app đọc cùng thông tin đó: điền ở Cấu hình đúng như trong bài, để chân trang, popup Mini App, màn thanh toán và bài không lệch nhau.

| Thông tin | Dấu trong bài / giá trị bài đang ghi | Có ở | Khoá cấu hình | Ghi chú |
|---|---|---|---|---|
| Tên công ty | `CÔNG TY TNHH TUBU TREE` (đã ghi) | cả 4 file | `company.legal_name` (đang trống, go-live FAIL) | Đúng tên trên giấy đăng ký doanh nghiệp. Hiện ở chân trang web và trang Về Tubu Tree |
| Mã số thuế | `0319585995` (đã ghi) | cả 4 file | `company.tax_code` (đang trống, go-live FAIL) | |
| Địa chỉ trụ sở | `Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh, Việt Nam` (đã ghi) | cả 4 file | `company.address` (đang trống, go-live FAIL) | Địa chỉ theo giấy đăng ký, sau sáp nhập phường 2025 |
| Số giấy chứng nhận đăng ký doanh nghiệp | `[SỐ ĐKDN]` | `dieu-khoan.md` mục 1 | không có | Với công ty, mã số doanh nghiệp thường trùng MST. Chép đúng từ giấy |
| Ngày cấp lần đầu | `[NGÀY CẤP ĐKDN]` | `dieu-khoan.md` mục 1 | không có | |
| Nơi cấp | `[NƠI CẤP ĐKDN]` | `dieu-khoan.md` mục 1 | không có | Cơ quan đăng ký kinh doanh ghi trên giấy |
| Người đại diện theo pháp luật | `[NGƯỜI ĐẠI DIỆN]` | `dieu-khoan.md`, `bao-mat.md`, `doi-tra.md`, `van-chuyen.md` | không có | Họ tên và chức danh theo giấy đăng ký |
| Hotline | `[SỐ HOTLINE]` | cả 4 file | `support.hotline` (mặc định `0984 606 774`: `apps/api/prisma/seed.ts:81`, `apps/api/src/modules/system-config/public-config.ts:98`, `packages/app-core/src/legal.ts:47`) | Số trong bài phải trùng khoá |
| Email | `tubutree@gmail.com` (đã ghi) | cả 4 file | `support.email` (mặc định đúng số này: `seed.ts:82`) | Đổi email thì sửa cả bài |
| Ngày hiệu lực | `[NGÀY HIỆU LỰC]` | cả 4 file, dòng đầu | không có | Ngày mở bán hoặc ngày dán |
| Tài khoản nhận chuyển khoản | `8386790906`, Techcombank, `CONG TY TNHH TUBU TREE` (đã ghi) | `dieu-khoan.md` mục 5 | `payment.bank_account_no`, `payment.bank_bin` (970407), `payment.bank_account_name`, `payment.bank_name` | Mã đã đổi sang số này (`seed.ts:221-224`, migration `20261018200000_launch_owner_config`). Chỉ cần kiểm PROD trùng; go-live `db.bank_account` cảnh báo nếu còn số mẫu cũ |
| Ngưỡng miễn phí ship và phí dưới ngưỡng | `199.000đ` và `19.000đ` (đã ghi) | `van-chuyen.md` mục 1, 4 | `shipping.free_threshold`, `shipping.flat_fee_below_threshold` | Hai khoá không được seed-reference nạp (`apps/api/prisma/reference-data/config-selection.ts:61-62`), PROD đang dùng mặc định trong mã. Go-live `db.shipping_rates` cảnh báo tới khi chủ ghi rõ. Đổi số thì sửa cả bài |
| Số ngày giao dự kiến | `[SỐ NGÀY GIAO NỘI THÀNH]`, `[SỐ NGÀY GIAO TỈNH KHÁC]` | `van-chuyen.md` mục 5 | `shipping.eta_min_days`, `shipping.eta_max_days` (đang trống nên app ẩn dòng "Giao dự kiến") | App chỉ có MỘT khoảng chung cho mọi địa chỉ (`apps/api/src/modules/system-config/shipping-eta.ts:6-14`), bài có hai vùng. Xem dấu `[chủ quyết]` trong bài |
| Thông báo website với Bộ Công Thương | `[SỐ XÁC NHẬN THÔNG BÁO / ĐĂNG KÝ]` | `dieu-khoan.md` mục 18 | `company.bct_notice_url` (link, không bắt buộc; có thì chân trang hiện dòng "Đã thông báo Bộ Công Thương") | Chưa có thì xoá cả dòng, nhưng nên hỏi luật sư trước |

## 4. Chỗ cần luật sư kiểm (`[cần luật sư kiểm]` trong bài)

`dieu-khoan.md`
- Mục 1: vai trò Tubu Tree với gian hàng đối tác (người bán hay sàn trung gian), ai đứng tên trách nhiệm. Dòng giấy chứng nhận đăng ký doanh nghiệp có bắt buộc ghi trên website theo Luật Thương mại điện tử 2025 không.
- Mục 2 và `bao-mat.md` mục 10: mốc 16 tuổi và cách xin đồng ý của cha mẹ.
- Mục 6: bản chất Ví Tubu. Ví chỉ nhận tiền hoàn, hoa hồng, thưởng (không có route nạp: `apps/api/src/modules/wallet/wallet.controller.ts:14-42`, loại giao dịch `apps/api/prisma/schema.prisma:1311-1325`) và không cho rút về ngân hàng (`wallet.controller.ts:24-28` trả 410; hoa hồng chỉ vào Ví 1:1, `apps/api/src/modules/affiliate/affiliate.controller.ts:118-120`). Cần xác nhận không rơi vào dịch vụ ví điện tử phải có giấy phép.
- Mục 9: điều khoản CTV, đại lý, gian hàng; khấu trừ TNCN 10%. Trong mã thuế khấu trừ khi tổng hoa hồng chuyển vào Ví trong tháng (giờ VN) từ 5.000.000đ, theo Nghị định 253/2026/NĐ-CP (`apps/api/src/modules/affiliate/affiliate.service.ts:111-112`, `:622-645`). Quyết định B17 còn chờ kế toán (`docs/2026-10-18-launch-review/03-cau-hoi-sang.md:51`, `:114`). Đại lý là doanh nghiệp hay hộ kinh doanh có phải trừ không.
- Mục 9 (mới, E-43): trừ thẳng Ví CTV khi thu hồi hoa hồng, cho Ví âm, và chặn thanh toán bằng Ví, chặn xoá tài khoản khi Ví âm. Cần xem đây có phải điều khoản bù trừ nghĩa vụ hợp lệ với CTV không, và phần thuế TNCN đã khấu trừ của khoản bị thu hồi phải xử lý thế nào (kê khai lại, hoàn, bù trừ).
- Mục 14: giới hạn trách nhiệm không được trái quyền người tiêu dùng.
- Mục 15: cách ghi cơ quan, tổ chức hỗ trợ và thẩm quyền Toà án.
- Mục 18: danh sách văn bản (mục 7 dưới đây) và nghĩa vụ thông báo/đăng ký với Bộ Công Thương theo Luật Thương mại điện tử 2025.

`bao-mat.md`
- Mục 1: dùng Luật 91/2025/QH15 và Nghị định 356/2025/NĐ-CP, đã thay Nghị định 13/2023 (bản mặc định `packages/app-core/src/legal.ts:171` còn dẫn Nghị định 13/2023).
- Mục 3 (mới): tin khuyến mãi bật sẵn khi tạo tài khoản (`apps/api/prisma/schema.prisma:268`, `notifyPromo @default(true)`), khách tự tắt. Cần xem có phải xin đồng ý riêng (chọn tham gia) cho tin tiếp thị không.
- Mục 4 (mới): chat CSKH đi qua một tài khoản Zalo cá nhân làm cầu nối vào nhóm Zalo nội bộ (`apps/zalo-bridge`, `apps/api/src/modules/support-chat/forward-format.ts:23-35`). Cần xem cách ghi bên nhận và cơ sở xử lý.
- Mục 5: chuyển dữ liệu ra nước ngoài (nhà cung cấp AI, Cloudinary, Sentry, nơi lưu sao lưu). Cần hồ sơ đánh giá tác động hoặc thủ tục nào.
- Mục 6: câu "website không dùng cookie quảng cáo hay công cụ phân tích bên thứ ba" đúng ở thời điểm soạn (web chỉ có Sentry ghi lỗi, không có gtag, Meta Pixel). Thêm công cụ như vậy sau này phải sửa câu này và có biểu ngữ cookie.
- Mục 7: thời hạn giữ chứng từ kế toán, thuế (số năm cụ thể) và phần được giữ nguyên MST, tên công ty, địa chỉ trên hoá đơn đã xuất.
- Mục 9: thời hạn phản hồi từng quyền theo Nghị định 356/2025. Bài không ghi con số luật định, chỉ ghi 3 ngày làm việc của quy trình xoá tài khoản trong mã.
- Mục 13: tên cơ quan nhận khiếu nại về dữ liệu cá nhân.

`doi-tra.md`
- Mục 3: chính sách đang chỉ nhận lỗi, hỏng, giao sai, bể vỡ, hết hạn, sai mô tả; "lý do khác" tuỳ Tubu Tree. Cần luật sư xác nhận Luật Bảo vệ quyền lợi người tiêu dùng 2023 và Nghị định 55/2024/NĐ-CP có buộc quyền trả hàng không cần lý do với giao dịch từ xa hay không.

## 5. Quy tắc nghiệp vụ trong bài và nơi đọc trong mã

Kiểm lại từng dòng ngày 30/10 trên main `d489574bf`. Đường dẫn rút gọn: `api/` = `apps/api/src/modules/`, `seed.ts` = `apps/api/prisma/seed.ts`, `config-selection.ts` = `apps/api/prisma/reference-data/config-selection.ts`.

Xác nhận trong mã:

| Nội dung trong bài | Nguồn |
|---|---|
| Đơn từ 199.000đ miễn phí ship, dưới đó 19.000đ cho kiện Tubu giao | `api/pricing/pricing.service.ts:15`, `:91-96`; `seed.ts:242-243`. PROD dùng mặc định trong mã (`config-selection.ts:61-62`) |
| Ngưỡng tính trên tiền hàng của kiện TRƯỚC khi trừ mã giảm giá, Điểm Xanh | `api/checkout/checkout-split.ts:282`; `api/checkout/checkout.service.ts:1251-1262`, `:1280` |
| Hạng thành viên freeship sớm hơn | `api/pricing/pricing.service.ts:17-27`. Mặc định trong mã `{}` (không hạng nào). Seed `{ LOC_BIEC: 99000, DAI_THU: 0, CO_THU: 0 }` (`seed.ts:248`) nạp cùng bảng hạng khi chạy cờ `--with-business-defaults` (`config-selection.ts:77`, `apps/api/prisma/seed-reference.ts:80-82`). Cờ này bắt buộc ở lần deploy đầu theo quyết định A8 (`docs/launch/deploy-rollback-runbook.md:749-752`) |
| Freeship đơn đầu từ 199.000đ: chỉ kiện Tubu, chỉ tài khoản đã đăng nhập Zalo, đơn đầu không tính đơn huỷ | `api/pricing/pricing.service.ts:30-54` (`:49` chặn khách vãng lai); `apps/api/src/common/first-order.ts:19`, `:32`; migration `20261018200000_launch_owner_config` bật `true`, ngưỡng 199000 |
| Kiện đối tác: phí do gian hàng đặt, mặc định 30.000đ; miễn khi đạt `freeShipFrom`; mã freeship Tubu không áp | `api/merchant/merchant-config.ts:5`; `api/checkout/checkout.service.ts:1251-1300` |
| Gian hàng xác nhận trong 24 giờ, bàn giao trong 48 giờ | `api/merchant/merchant-config.ts:13`, `:15`; `api/merchant/merchant-fulfilment.service.ts:396-397` |
| Đơn tách theo nơi giao, mỗi kiện một phí | `api/checkout/checkout-split.ts:107`; `checkout.service.ts:1251-1300` |
| Thanh toán: COD, chuyển khoản, Ví Tubu. ZaloPay có trong mã, chỉ chạy khi có khoá `ZALOPAY_*` | `api/checkout/dto/checkout.dto.ts:42`; `api/integrations/payment/zalopay.service.ts:89` |
| COD tối đa 5.000.000đ mỗi kiện; hàng đối tác và đơn nhiều nơi giao chỉ COD hoặc Ví | `api/checkout/checkout-split.ts:328`, `:339-345`, `:355-360` |
| Đơn chuyển khoản chưa trả sau 24 giờ tự huỷ (`orders.pending_payment_ttl_hours`) | `api/orders/pending-payment-ttl.ts:4-5` |
| Khách tự huỷ khi PENDING_PAYMENT, CONFIRMED, PACKED (đơn đại lý: hai trạng thái đầu) | `api/orders/orders.service.ts:118-119`, `:149-150`; huỷ chọn nơi nhận tiền `:394` |
| Đổi trả 7 ngày kể từ lúc giao, quá hạn bị từ chối | `seed.ts:281`; `api/orders/order-returns.service.ts:200-206` |
| Lý do: lỗi, giao sai, bể vỡ, hết hạn (lỗi phía shop), lý do khác (mô tả từ 5 ký tự) | `api/orders/return-reasons.ts:2-8`; `order-returns.service.ts:211-214` |
| Tối đa 6 ảnh; một yêu cầu chờ mỗi đơn; đơn đại lý chỉ trả cả đơn; trả một phần và trả thêm được | `api/orders/return-images.ts:4`; `order-returns.service.ts:207-208`, `:220-223`; nút "Trả thêm sản phẩm" `apps/miniapp/src/pages/order-detail.tsx:746`, `apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx:231` |
| Hoàn phí ship khi trả cả đơn hoặc lỗi phía shop (người duyệt chốt), không hoàn khi trả một phần vì lý do khác | `api/orders/refund-allocation.ts:162`; `order-returns.service.ts:415` |
| Tiền hoàn tính theo số khách thực trả từng dòng; hoàn Điểm Xanh đã dùng | `api/orders/refund-allocation.ts:145-170` |
| Hoàn về Ví ngay khi duyệt, hoặc chuyển khoản 1-3 ngày làm việc, miễn phí; đơn trả bằng Ví chỉ về Ví; đổi nơi nhận tới khi bắt đầu chuyển | `order-returns.service.ts:154-162`, `:715-721`; `api/orders/refund-destination.ts:19`; `apps/web/src/lib/refund-rules.ts:154`, `:200`; `apps/miniapp/src/utils/refund-rules.ts:126`, `:160`; `api/orders/orders.controller.ts:94` |
| Đơn CTV đặt hộ: tiền hoàn cho người nhận, vào Ví nếu SĐT có tài khoản, không thì chuyển tay theo SĐT | `api/orders/order-reversal.service.ts:226-231`, `:876-906`; `api/orders/customer-refunds.service.ts:46-49` |
| Tubu phản hồi đổi trả trong 24 giờ | `apps/web/src/app/tai-khoan/don-hang/[code]/return-request-form.tsx:125`; `order-actions.tsx:249`; `apps/miniapp/src/utils/refund-rules.ts:233` |
| Thu hồi điểm đã tích tối đa bằng số dư; thu thưởng đánh giá của sản phẩm trả; thu thưởng giới thiệu theo tỷ lệ | `api/loyalty/loyalty.service.ts:264-285`; `api/orders/order-reversal.service.ts:491-518`, `:599-617` |
| Mã giảm giá trả lượt dùng khi mọi kiện của lần đặt bị huỷ/trả hết; trả một phần thì không | `api/orders/order-reversal.service.ts:275-277`, `:743-762` |
| Điểm Xanh 1 điểm = 1đ; đơn trong app tích 2% sau giảm giá, không tính ship, nhân hệ số hạng 1 / 1,2 / 1,5 / 2 (2% đến 4%) | `api/loyalty/earn-rates.ts:2-3`; `seed.ts:26-27`, `:355-399`; `api/pricing/pricing.service.ts:98-102` |
| Đơn sàn 1%, không nhân hạng, chờ 14 ngày sau giao; có trần ngày, tháng, tuổi đơn. Cờ đang TẮT | `api/loyalty/earn-rates.ts:6-9`; `api/external-points/external-claim.config.ts:30-40`; `config-selection.ts:128-135` (`loyalty.marketplace_claim_enabled` = false). Bài ghi "khi tính năng này được mở" |
| Đơn chat/điện thoại cộng theo SĐT, cùng tỷ lệ và hệ số hạng, giữ 30 ngày cho SĐT chưa là thành viên. Cờ đang TẮT | `api/external-points/external-chat.config.ts:36-44`; `api/external-points/external-chat.claim.ts:57`; `config-selection.ts:136-142` (`loyalty.chat_order_points_enabled` = false) |
| Điểm danh, nhiệm vụ, trò chơi: Điểm Xanh chỉ cho tài khoản đã đăng nhập Zalo; khách vãng lai vẫn nhận giọt nước (E-2) | `apps/api/src/common/real-user.ts:3-35`; `api/loyalty/loyalty.service.ts:1306`, `:1354-1355`; `api/game/game.service.ts:338-341`, `:851`; `api/game/season-pass.service.ts:82`, `:127` |
| Khách vãng lai không nhận quà khách mới, mã công khai, mua chung, không đăng ký CTV, không vào Đổi rác, không chia sẻ lên Cộng đồng | `real-user.ts:3-9`, `:26-27`; `api/loyalty/loyalty.service.ts:796`, `:1054`; `api/affiliate/affiliate.service.ts:154`; `api/waste-exchange/core/waste-access.service.ts:32`; `api/game/game.service.ts:535` |
| Gộp tài khoản khách vãng lai vào tài khoản Zalo (giỏ, địa chỉ, điểm, đơn); không cộng bù điểm danh | `api/auth/auth.service.ts:258-315`; `docs/2026-10-29-p3/goi/e2-diem-khach.md:3` |
| Hạng xét theo tiền mua 12 tháng của đơn tự mua đã giao, trừ phần đã hoàn; giữ hạng 30 ngày trước khi hạ | `api/loyalty/loyalty.service.ts:334-371`, `:381-410`; `seed.ts:31` |
| Điểm Xanh hết hạn 12 tháng, nhắc trước 7 ngày; điểm không trừ vào phí ship | `seed.ts:29-30`; `api/loyalty/points-expiry-date.ts:2`, `:17`; `api/loyalty/loyalty-expiry.service.ts:488`; `api/pricing/pricing.service.ts:128-136` |
| Trần dùng điểm 20% giá trị đơn (bài ghi "hiện là 20%") | `seed.ts:28`; `api/pricing/pricing.service.ts:105-109` |
| Ví Tubu chỉ dùng trả tiền hàng, không nạp, không rút; hoa hồng chỉ vào Ví 1:1 | `api/wallet/wallet.controller.ts:24-28`; `api/affiliate/affiliate.controller.ts:118-120`; `apps/api/prisma/schema.prisma:1311-1325` |
| Hoa hồng: chỉ AFFILIATE, DEALER; sản phẩm bị chặn và hàng gian hàng đối tác 0% trừ khi đặt % riêng; tự mua không có hoa hồng | `config-selection.ts:119-120`; `api/affiliate/commission-rate.ts:38-45`; `api/affiliate/affiliate.service.ts:1036` |
| Giữ hoa hồng max(10 ngày, hạn đổi trả) rồi duyệt và tự chuyển vào Ví | `api/affiliate/affiliate.service.ts:1605-1614`; `seed.ts:65`; `config-selection.ts:121` (`affiliate.auto_wallet_transfer_enabled` = true) |
| Thu hồi hoa hồng khi huỷ/trả cả đơn, kể cả đã duyệt hoặc đã vào Ví (E-43) | `api/affiliate/affiliate.service.ts:1127-1199`; `api/wallet/commission-wallet-reversal.ts:6-20` |
| Trả một phần cắt hoa hồng theo dòng trả, kể cả đã duyệt/đã vào Ví; món 0% không cắt (E-43) | `api/orders/order-reversal.service.ts:523-597` |
| Trừ Ví phần CTV thực nhận sau thuế; mỗi lần thu hồi một dòng sổ, chạy lại không trừ hai lần | `api/wallet/commission-wallet-reversal.ts:77-90`, `:123-167` |
| Ví chỉ được âm vì dòng COMMISSION_REVERSAL; hoa hồng mới bù dần số âm | `api/wallet/wallet-ledger.service.ts:45-46`, `:71-72` |
| Ví âm thì chặn thanh toán bằng Ví và chặn xoá tài khoản | `api/checkout/checkout.service.ts:415-420`; `api/users/account-deletion.service.ts:341` |
| Phần thuế TNCN của khoản thu hồi chỉ báo kế toán, không tự xử lý | `api/affiliate/affiliate.service.ts:1201-1260`. Bài có dấu `[chủ quyết]` |
| Khấu trừ TNCN 10% từ 5.000.000đ/tháng; MST hoặc CCCD khi bị khấu trừ | `api/affiliate/affiliate.service.ts:111-112`, `:576-595`, `:622-645` |
| Tin khuyến mãi tắt được ở Cài đặt "Khuyến mãi & mã giảm giá" (Mini App và web); tin giao dịch luôn gửi; mặc định bật | `api/notifications/notification-categories.ts:1-20`; `apps/miniapp/src/pages/settings.tsx:114`; `apps/web/src/app/tai-khoan/cai-dat/page.tsx:106`; `schema.prisma:268` |
| Xoá tài khoản: Mini App (Cá nhân) hoặc web (Tài khoản) → "Về Tubu Tree & Hỗ trợ" → "Xoá tài khoản" → "Gửi yêu cầu xoá"; CSKH xử lý trong 3 ngày làm việc | `apps/miniapp/src/pages/profile.tsx:82`; `apps/miniapp/src/pages/about.tsx:260-315`; `apps/web/src/components/account/account-menu.ts:72`; `apps/web/src/app/gioi-thieu/about-view.tsx:244-312`; `api/users/users.service.ts:259`, `:277`; `api/users/users.controller.ts:37` |
| Điều kiện chặn xoá (số dư Ví, Ví âm, điểm không hết hạn, đơn đang xử lý, hạn đổi trả, hoàn tiền, Đổi rác, hoa hồng chưa vào Ví, công nợ...) | `api/users/account-deletion.service.ts:334-367` |
| Xoá là ẨN DANH, không xoá cứng; xoá cả MST cá nhân, ghi chú đơn, email hoá đơn; xoá hẳn chat CSKH | `api/users/account-deletion.service.ts:396-455` |
| Thời gian giữ log: sự kiện 395 ngày, thông báo 180 ngày, webhook và tin OA 90 ngày, chat CSKH 365 ngày, phiên 30 ngày; SĐT đơn ngoài app xoá theo hạn webhook hoặc 7 ngày sau khi xong | `api/data-retention/data-retention.service.ts:15-27`, `:148-202`; `seed.ts:322-331` |
| Dữ liệu thu thập: Zalo ID, SĐT qua Zalo, địa chỉ, tài khoản ngân hàng hoàn tiền, MST/CCCD của CTV, hồ sơ đại lý | `api/auth/zalo.service.ts:111`; `api/orders/refund-destination.ts:33-43`; `api/affiliate/affiliate.service.ts:576-590`; `api/dealer/dto/dealer.dto.ts:50-62` |
| Khách vãng lai: mã thiết bị ngẫu nhiên, máy chủ chỉ lưu bản băm | `api/auth/device-id.ts:4-15`; `apps/miniapp/src/store/auth.ts:32-40` |
| Sửa hồ sơ: họ tên, email, ảnh, ngày sinh đặt một lần, SĐT chỉ xem | `apps/web/src/app/tai-khoan/ho-so/page.tsx:243-276`; `apps/miniapp/src/pages/edit-profile.tsx:249-300` |
| Pancake nhận tên, SĐT, địa chỉ, ghi chú, yêu cầu hoá đơn | `api/integrations/pancake/pancake-order-body.ts:290-330` |
| Đơn ngoài app (sàn, chat) đồng bộ từ Pancake, chỉ giữ mã, vận đơn, tiền, trạng thái, SĐT | `apps/api/prisma/schema.prisma:3294-3324`; `api/external-points/external-order.mapper.ts:233-236`; `config-selection.ts:126` |
| Chat CSKH chuyển vào nhóm Zalo kèm tên, SĐT che, hạng, đơn/sản phẩm, link ảnh | `api/support-chat/forward-format.ts:12-35`; `apps/zalo-bridge/src/zalo-client.ts:637`; cờ `chat.enabled` = false `seed.ts:327` |
| Gomdon nhận tên, SĐT, địa chỉ khi đơn có thu gom vỏ | `api/integrations/gomdon/gomdon-order.service.ts:979-995`; `api/checkout/checkout.service.ts:111`, `:421-425` |
| Đổi rác: dữ liệu yêu cầu, điểm nhận thấy tên và SĐT đã che, ghi thời điểm đồng ý thể lệ. Cờ `waste.enabled` = false | `apps/api/prisma/schema.prisma:3626-3671`; `api/waste-exchange/core/waste-mask.ts:4-14`; `api/waste-exchange/receiving/waste-desk.service.ts:142-152`; `api/waste-exchange/customer/waste-requests.service.ts:259-260`; `seed.ts:332` |
| ZaloPay nhận mã đơn, số tiền, id người dùng nội bộ | `api/integrations/payment/zalopay.service.ts:104-127` |
| Ảnh tải lên Cloudinary (thiếu cấu hình thì lưu base64 trong DB của Tubu) | `apps/api/src/common/uploaded-image.ts:4-14`; `api/dealer/dto/dealer.dto.ts:56-58` |
| Trợ lý AI gửi câu hỏi, tối đa 6 lượt lịch sử, danh mục và FAQ; không gửi hồ sơ; không lưu hội thoại | `api/ai-advisor/ai-advisor.service.ts:32`, `:89-98`; nhà cung cấp `api/ai-advisor/advisor-config.ts:25-36` |
| Sentry: tắt PII, bỏ cookie, thân request, query trước khi gửi | `apps/web/src/lib/sentry-client.ts:7-18`; `apps/web/src/lib/sentry-scrub.ts`; `apps/api/src/config/sentry.ts:15-40` |
| Cookie web: refresh HttpOnly, `tubu_web_session` và `tubu_home_hint` (không bí mật), `tubu_ft` 30 ngày; localStorage/sessionStorage; không có script quảng cáo, phân tích bên thứ ba | `api/auth/refresh-cookie.ts:22`; `apps/web/src/lib/client-api.ts:5-14`, `:29-41`; `apps/web/src/lib/home-restore-hint.ts:8-9`; `apps/web/src/lib/entry-source.ts:15-16`; `apps/web/src/lib/recently-viewed.ts:2`; `apps/web/src/lib/saved-invoice.ts:4` |
| Kiểm duyệt bài cộng đồng: người đáng tin tự đăng, bài bị cờ vào hàng chờ | `api/feed/community-feed.service.ts:586-592` |

Chỉ có từ chủ dự án (chưa thấy trong mã):

- Duyệt bài cộng đồng trong 4 giờ làm việc (B8): mã chỉ có kiểm duyệt lai, không có hạn 4 giờ.
- Nhà cung cấp AI: mã gọi Antigravity, DeepSeek, Gemini theo cái nào có khoá (`api/ai-advisor/advisor-config.ts:25-36`). Bài chỉ nói "nhà cung cấp mô hình AI", không nêu tên.
- Sao lưu lưu trên Google Drive (A11), nên bài nhắc "dịch vụ sao lưu" ở mục chuyển ra nước ngoài.
- Ai chịu phí gửi hàng trả về: mã không có quy tắc phí gửi trả. Bài dùng câu "lỗi phía Tubu Tree, nhà sản xuất, vận chuyển thì Tubu Tree chịu, còn lại báo chi phí trước".
- Không có luồng đổi sang sản phẩm khác trong mã (chỉ trả hàng và hoàn tiền). Bài ghi đúng theo mã.
- Không cộng bù Điểm Xanh điểm danh khi khách vãng lai liên kết Zalo: chủ chốt 29/10 (E-2). Mã không có đường cộng bù nên khớp.
- Thời gian giao hàng, hotline, người đại diện, giấy đăng ký doanh nghiệp: xem mục 3.

## 6. Chỗ khác trong app đang lệch với bài (nên sửa cùng đợt)

Bản mặc định khách đang thấy (`packages/app-core/src/legal.ts`, hiện ở web và popup Mini App khi khoá `legal.*` trống). Hết hiện khi đã dán bài, nhưng tới lúc đó khách vẫn đọc các câu sau:

- `legal.ts:62-64`: chưa điền `company.*` thì khách thấy nguyên chữ "[Tên công ty]", "[Mã số thuế]", "[Địa chỉ trụ sở]". PROD đang như vậy (go-live FAIL `db.company_identity`).
- `legal.ts:70-127` (điều khoản): không có mục Ví Tubu và CTV. Không nói Ví không rút được, không nói hoa hồng có thể bị thu hồi sau khi đã vào Ví, Ví có thể bị trừ tới âm và bị chặn thanh toán (E-43, mã ở mục 5). Không nói gì về khách vãng lai (`:79` chỉ ghi "đăng nhập bằng tài khoản Zalo").
- `legal.ts:147`: "Thông tin khuyến mãi chỉ gửi khi bạn đồng ý nhận". Mã bật sẵn tin khuyến mãi khi tạo tài khoản (`apps/api/prisma/schema.prisma:268`), khách tự tắt.
- `legal.ts:154-156`: danh sách bên nhận dữ liệu chỉ có vận chuyển, ngân hàng, "nhà cung cấp hạ tầng". Thiếu Zalo (đăng nhập, ZNS, chat CSKH qua nhóm Zalo), Pancake, Gomdon, Cloudinary, nhà cung cấp AI, Sentry, gian hàng đối tác.
- `legal.ts:171`: dẫn Nghị định 13/2023/NĐ-CP (đã bị thay). "Bạn có thể tự sửa họ tên": nay sửa được cả email, ảnh, ngày sinh; xoá tài khoản gửi được ngay trong app.
- `legal.ts:198-200`: chỉ liệt kê lỗi, giao sai, không đúng mô tả. Mã nhận thêm "Lý do khác" (`apps/api/src/modules/orders/return-reasons.ts:7`).
- `legal.ts:219`: "7 ngày làm việc kể từ khi Tubu Tree nhận lại và kiểm tra sản phẩm". Mã hoàn Ví ngay khi duyệt, ngân hàng 1-3 ngày làm việc từ khi duyệt, trước khi hàng về (`apps/api/src/modules/orders/order-returns.service.ts:154-162`).
- `legal.ts:257-258`: "Nội thành: [số ngày]", "Tỉnh thành khác: [số ngày]" hiện nguyên dấu ngoặc cho khách.
- `legal.ts:268`: "Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao)". Luật thật là trần 5.000.000đ mỗi kiện (`apps/api/src/modules/checkout/checkout-split.ts:328`). Không sai, chỉ mơ hồ.
- `legal.ts:47`, `:49`: số mặc định (hotline `0984 606 774`, hạn đổi trả 7, ngưỡng 199.000đ, phí 19.000đ) khớp seed và mặc định API. Không lệch.

Chỗ khác:

- `apps/miniapp/src/pages/about-data.ts:75` và `apps/web/src/lib/faq-fallback.ts:67` (FAQ dự phòng, hiện khi bảng FAQ trống hoặc lỗi): "Chỉ đổi/trả khi sản phẩm bị lỗi nhà sản xuất ... Tubu chịu phí ship 2 chiều". Mã nhận cả "Lý do khác", và không có quy tắc phí gửi trả.
- Quyền lợi hạng (`apps/api/prisma/seed.ts:375`, `:386`, `:397`: "Freeship đơn ≥ 99k", "Freeship toàn shop") và khoá `shipping.tier_freeship_overrides` cùng được nạp bằng cờ `--with-business-defaults` (`apps/api/prisma/seed-reference.ts:80-82`). Deploy đúng runbook thì khớp. Không phải lệch trong mã, chỉ nên kiểm ở Cấu hình PROD là khoá có giá trị: thiếu khoá thì thẻ hạng hứa freeship mà giỏ không áp, và câu freeship theo hạng trong `van-chuyen.md` mục 4 thành sai.
- `apps/api/src/modules/affiliate/affiliate.service.ts:1605-1608`: comment còn ghi APPROVED là "điểm không-đảo-được", nay E-43 đã đảo được. Chỉ là comment, không ảnh hưởng khách.
- `apps/api/src/common/uploaded-image.ts:10-12` ghi PROD chưa cấu hình Cloudinary nên ảnh lưu base64 trong DB. Bài bảo mật vẫn đúng (ghi Cloudinary là nơi lưu ảnh khi có), nhưng nên kiểm PROD.
- Đã sửa từ 18/10, không còn lệch: tóm tắt cũ trong `apps/miniapp/src/pages/about.tsx` đã thay bằng popup chính sách đầy đủ; câu "đổi mới", "100% Thuần Chay" ở `apps/web/src/app/page.tsx` đã bỏ; web đã có nút xoá tài khoản.

## 7. Văn bản pháp luật đã dẫn và mức chắc chắn

Kiểm bằng tìm kiếm web ngày 2026-10-18, chưa đọc được toàn văn (các trang thuvienphapluat.vn và PwC chặn truy cập tự động). Đợt 30/10 không kiểm lại phần này.

| Văn bản | Dẫn trong bài | Kết quả kiểm |
|---|---|---|
| Luật Bảo vệ quyền lợi người tiêu dùng 2023, số 19/2023/QH15, hiệu lực 1/7/2024 | `dieu-khoan.md` mục 18 | Số hiệu và ngày hiệu lực khớp nhiều nguồn |
| Luật Thương mại điện tử 2025, số 122/2025/QH15, thông qua 10/12/2025, hiệu lực 1/7/2026 | `dieu-khoan.md` mục 18 | Khớp nhiều nguồn |
| Luật Bảo vệ dữ liệu cá nhân 2025, số 91/2025/QH15, hiệu lực 1/1/2026 | `dieu-khoan.md` mục 18, `bao-mat.md` mục 1 | Khớp nhiều nguồn, kể cả bài của Bộ Công an |
| Nghị định 356/2025/NĐ-CP (31/12/2025, hiệu lực 1/1/2026, thay Nghị định 13/2023) | `bao-mat.md` mục 1 | Số hiệu khớp; việc thay thế Nghị định 13/2023 chỉ thấy ở bài của PwC. Có đánh dấu luật sư |
| Nghị định 248/2026/NĐ-CP (30/6/2026, hiệu lực 1/7/2026, hướng dẫn Luật TMĐT 2025) | KHÔNG dẫn trong bài | Số hiệu có nhiều nguồn, nhưng việc nó thay Nghị định 52/2013 và 85/2021 chỉ có một nguồn. Luật sư cần xác nhận rồi mới thêm |
| Nghị định 55/2024/NĐ-CP (hướng dẫn Luật BVQLNTD 2023) | KHÔNG dẫn trong bài | Chỉ nêu ở mục 4 để luật sư kiểm quyền trả hàng |
| Nghị định 52/2013/NĐ-CP, 85/2021/NĐ-CP | KHÔNG dẫn trong bài | Có thể đã hết hiệu lực từ 1/7/2026; không dẫn để tránh sai |

Không xác nhận được: thời hạn luật định cho từng quyền dữ liệu và thông báo vi phạm, quyền đơn phương trả hàng của người tiêu dùng trong giao dịch từ xa, số năm lưu chứng từ kế toán, điều kiện chuyển dữ liệu ra nước ngoài, danh mục thông tin phải công khai theo Luật TMĐT 2025. Bài cố ý không ghi số điều, số năm, số giờ cho các điểm này.

## 8. Thay đổi 30/10

Soát bốn bài với mã main `d489574bf`. Chỉ ghi điều mã đang làm hoặc chủ đã chốt; chỗ chưa rõ để dấu `[chủ quyết: ...]`.

`dieu-khoan.md`
- Mục 1: thêm dòng giấy chứng nhận đăng ký doanh nghiệp (số, ngày cấp, nơi cấp) để chủ điền. Lý do: thông tin người bán thường phải công khai, cần luật sư xác nhận.
- Mục 2: thêm khách vãng lai. Lý do: Mini App cho dùng khi chưa đăng nhập Zalo, và chủ chốt E-2 ngày 29/10 (không Điểm Xanh từ điểm danh, nhiệm vụ; vẫn nhận giọt nước).
- Mục 6: thêm Ví có thể bị trừ tới âm vì thu hồi hoa hồng, Ví âm thì không trả bằng Ví. Lý do: E-43.
- Mục 7: đơn sàn và đơn chat ghi "khi tính năng được mở". Lý do: hai cờ đang tắt trên PROD.
- Mục 7: thêm điểm danh, nhiệm vụ, trò chơi chỉ cho tài khoản Zalo. Lý do: E-2.
- Mục 7: thêm cách xét hạng (tiền mua 12 tháng, trừ phần đã hoàn, giữ hạng 30 ngày). Lý do: trả hàng làm giảm mức xét hạng.
- Mục 7: thu hồi điểm tích tối đa bằng số dư, thu thưởng đánh giá và thưởng giới thiệu khi trả hàng. Lý do: mã đang làm vậy.
- Mục 7: ưu đãi khách mới chỉ cho tài khoản đã đăng nhập Zalo, không tính đơn huỷ. Lý do: `isRealUser`, `first-order.ts`.
- Mục 9: cần đăng nhập Zalo để đăng ký CTV. Hàng gian hàng đối tác 0% trừ khi có % riêng (trước ghi "không có"). Hoa hồng giữ max(10 ngày, hạn đổi trả), rồi duyệt và chuyển vào Ví (tự chuyển, không còn bấm tay).
- Mục 9: thêm thu hồi hoa hồng khi huỷ/trả cả đơn hoặc một phần, kể cả đã duyệt hoặc đã vào Ví; trừ Ví phần thực nhận sau thuế; Ví âm chặn thanh toán bằng Ví và xoá tài khoản. Lý do: E-43, chủ chốt 29/10.
- Mục 9: câu thuế TNCN đổi "khi bạn chuyển" thành "khi hoa hồng được chuyển", ngưỡng xem ở trang CTV. Lý do: hoa hồng tự chuyển.

`bao-mat.md`
- Mục 2: thêm ảnh đại diện; mã thiết bị đã băm của khách vãng lai; thông tin người nhận khi CTV đặt hộ; đơn sàn và đơn chat đồng bộ từ Pancake; tin nhắn và ảnh chat CSKH; dữ liệu Đổi rác lấy quà; lịch sử hoa hồng, thuế, khoản thu hồi.
- Mục 2: bỏ "tài khoản ngân hàng nhận hoa hồng" của CTV (hoa hồng chỉ vào Ví), thay bằng tài khoản nhận tiền đối soát của chủ gian hàng đối tác.
- Mục 3: ghi rõ tin khuyến mãi bật sẵn, tự tắt được. Lý do: `notifyPromo` mặc định true.
- Mục 4: thêm kênh chat CSKH qua nhóm Zalo, ghi chú và hoá đơn gửi Pancake, tên Gomdon, điểm nhận Đổi rác, ZaloPay, các loại ảnh lên Cloudinary, Sentry.
- Mục 5: thêm dịch vụ ghi nhận lỗi vào danh sách có thể ở nước ngoài.
- Mục 6: thêm cookie `tubu_web_session`, `tubu_home_hint` và "sản phẩm xem gần đây" trong bộ nhớ trình duyệt.
- Mục 7: thêm hạn giữ chat CSKH (khoảng 12 tháng) và SĐT đơn ngoài app.
- Mục 8: web đã có nút xoá tài khoản; sửa tên tab "Cá nhân" và chữ nút "Xoá tài khoản", "Gửi yêu cầu xoá" theo app; thêm điều kiện Ví không âm, không còn điểm không hết hạn, không còn yêu cầu Đổi rác; thêm MST cá nhân, ghi chú đơn bị ẩn danh và chat bị xoá hẳn.
- Mục 9: sửa được email, ảnh, ngày sinh đặt một lần trên cả hai nền; tắt tin khuyến mãi được trên web; thêm công tắc "Nhắc nhở Vườn Xanh & tương tác bài viết".

`doi-tra.md`
- Mục 5: đường vào theo tab Cá nhân (Mini App) và Tài khoản (web); nút "Trả thêm sản phẩm"; trả thêm phần khác trong hạn.
- Mục 7: thêm hoàn tiền đơn CTV đặt hộ cho người nhận; thu hồi điểm tối đa bằng số dư và thưởng đánh giá; phần hoàn không tính vào hạng; mã giảm giá chỉ trả lượt khi mọi kiện bị huỷ/trả hết; hoa hồng CTV bị thu hồi không ảnh hưởng tiền hoàn.

`van-chuyen.md`
- Mục 1 và 4: freeship đơn đầu chỉ cho tài khoản đã đăng nhập Zalo. Lý do: `pricing.service.ts:49`.
- Mục 4: giữ câu freeship theo hạng. Lý do: chủ chốt A8 nạp bộ giá trị kinh doanh, gồm freeship theo hạng (xem mục 6 để kiểm PROD).
- Mục 5: dấu `[chủ quyết]` về khoảng "Giao dự kiến" chung trong app so với hai vùng trong bài.

`README.md`
- Mục 3 gộp thành một bảng, có khoá cấu hình cho từng dòng. Mục 1, 2, 4, 5, 6 cập nhật file:dòng theo main `d489574bf`. Lệnh kiểm trước khi dán bắt thêm `NƠI` và `chủ quyết`.

Dấu `[chủ quyết]` mới:
- `dieu-khoan.md` mục 9: phần thuế TNCN đã khấu trừ của khoản hoa hồng bị thu hồi xử lý thế nào.
- `van-chuyen.md` mục 5: khoảng "Giao dự kiến" chung trong app phải bao được hai vùng trong bài.

Việc chủ cần biết thêm, không đặt dấu trong bài:
- ZaloPay: bài không liệt kê ZaloPay ở cách thanh toán. Nếu đặt khoá `ZALOPAY_*` trên PROD thì thêm ZaloPay vào `dieu-khoan.md` mục 5. `bao-mat.md` đã ghi ZaloPay ở dạng "chỉ khi bạn chọn".
- Sentry: `bao-mat.md` ghi Sentry là bên nhận. Nếu PROD không đặt `SENTRY_DSN` và `NEXT_PUBLIC_SENTRY_DSN` thì có thể bỏ dòng đó (giữ cũng không sai).
- Chat CSKH và Đổi rác lấy quà đang tắt (`chat.enabled`, `waste.enabled`). Bài viết ở dạng "nếu bạn dùng", nên đúng cả khi tắt.
