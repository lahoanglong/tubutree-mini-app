# Bản nháp 4 trang pháp lý Tubu Tree

Soạn ngày 2026-10-18, nhánh `lr2/legal`. Chưa luật sư nào xem. Đây là nháp để chủ dự án đọc, sửa rồi dán vào Admin → Cấu hình.

| File | Khoá cấu hình | Trang web |
|---|---|---|
| `dieu-khoan.md` | `legal.dieu-khoan` | `/chinh-sach/dieu-khoan` |
| `bao-mat.md` | `legal.bao-mat` | `/chinh-sach/bao-mat` |
| `doi-tra.md` | `legal.doi-tra` | `/chinh-sach/doi-tra` |
| `van-chuyen.md` | `legal.van-chuyen` | `/chinh-sach/van-chuyen` |

## 1. Trang hiển thị thế nào (vì sao dùng markdown)

- `GET /config/legal/:loai` trả `content` là chuỗi thô lấy từ khoá `legal.<loai>`; rỗng thì `content: null` (`apps/api/src/modules/system-config/legal-config.controller.ts:11-16`, `:49`).
- Trang web `apps/web/src/app/chinh-sach/[loai]/page.tsx:30` coi `content === null` là bản nháp: hiện biển "BẢN NHÁP" (`:36`) và đặt `noindex` (`:22`). Có nội dung rồi thì biển biến mất và trang được lập chỉ mục. Trang cache ISR 300 giây.
- Nội dung đi qua bộ dựng markdown tối giản `apps/web/src/components/legal-markdown.tsx` (regex ở `:10-13`, `:57`). Nó chỉ hiểu: tiêu đề `##` và `###`, đoạn văn, danh sách gạch đầu dòng và đánh số MỘT cấp, `**đậm**`, liên kết `[chữ](đường dẫn)` tới `/chinh-sach/...`, `https://`, `mailto:`, `tel:`, đường kẻ `---`. Không có bảng, in nghiêng, danh sách lồng nhau, trích dẫn. HTML thô bị escape. Tiêu đề trang (h1) do web tự đặt, nên file bắt đầu từ `##`.
- Giới hạn: tối đa 50.000 ký tự mỗi khoá (`apps/api/src/modules/system-config/system-config.service.ts:26`, `:311-314`). Bốn file dài 4,5k đến 12k ký tự.
- Khung nhập: khoá `legal.*` ở Cấu hình là ô nhiều dòng, lưu chữ thô, không cần escape (`apps/web/src/components/admin/config-item.tsx:14`).
- Đã kiểm: cả bốn file được đưa qua đúng component `LegalMarkdown` bằng `react-dom/server` (esbuild, React 18.3.1 của repo chính). Kết quả: không còn ký tự markdown chưa dựng (`**`, `](`, gạch đầu dòng trần), mọi liên kết đều là `/chinh-sach/...`. Script nằm ở thư mục tạm của phiên, không đưa vào repo.

## 2. Cách dán

1. Điền hết chỗ trống (mục 3) và xử lý các chỗ `[cần luật sư kiểm]` (mục 4), rồi xoá luôn các dấu đó.
2. Kiểm trước khi dán, lệnh không được in ra dòng nào:
   `grep -nE '\[(NGÀY|SỐ|NGƯỜI|cần)' docs/legal-drafts/*.md`
3. Mở file, chép toàn bộ nội dung. Vào Admin → Cấu hình, tìm khoá tương ứng (nhóm `legal`), dán, lưu.
4. Mở `/chinh-sach/<loai>` (chờ tối đa 5 phút cache). Biển "BẢN NHÁP" phải biến mất. Bấm thử các liên kết chéo giữa bốn trang.
5. Mini App chỉ có bản tóm tắt cũ trong `apps/miniapp/src/pages/about.tsx:28-41`, kèm nút "Xem bản đầy đủ trên web". Xem mục 6 về chỗ tóm tắt này lệch với trang mới.

## 3. Chỗ trống còn lại (chủ dự án điền)

| Dấu | Có ở | Ghi chú |
|---|---|---|
| `[NGÀY HIỆU LỰC]` | cả 4 file, dòng đầu | ngày mở bán hoặc ngày dán |
| `[SỐ HOTLINE]` | cả 4 file | trong mã đang mặc định `0984 606 774` (`apps/api/src/modules/system-config/public-config.ts:66`, `apps/api/prisma/seed.ts:80`, `apps/web/src/lib/api.ts:336`). Nếu đó là số thật, điền số này và nhớ khoá `support.hotline` phải trùng |
| `[NGƯỜI ĐẠI DIỆN]` | cả 4 file | người đại diện theo pháp luật theo giấy phép kinh doanh |
| `[SỐ NGÀY GIAO NỘI THÀNH]`, `[SỐ NGÀY GIAO TỈNH KHÁC]` | `van-chuyen.md` mục 5 | chưa có quy tắc nào trong mã: `shipping.eta_min_days` và `shipping.eta_max_days` mặc định null nên app ẩn dòng "Giao dự kiến" (`apps/api/prisma/seed.ts:222-223`) |
| `[SỐ XÁC NHẬN THÔNG BÁO / ĐĂNG KÝ]` | `dieu-khoan.md` mục 18 | số thông báo hoặc đăng ký website với Bộ Công Thương. Câu hỏi A9 vẫn chưa có trả lời. Chưa có thì xoá cả dòng, nhưng nên hỏi luật sư trước |

## 4. Chỗ cần luật sư kiểm (`[cần luật sư kiểm]` trong bài)

`dieu-khoan.md`
- Mục 1: vai trò Tubu Tree với gian hàng đối tác (người bán hay sàn trung gian), ai đứng tên trách nhiệm.
- Mục 2 và `bao-mat.md` mục 10: mốc 16 tuổi và cách xin đồng ý của cha mẹ.
- Mục 6: bản chất Ví Tubu. Ví chỉ nhận tiền hoàn, hoa hồng, thưởng (không có nạp tiền: `apps/api/src/modules/wallet/wallet.controller.ts:30-61` không có route nạp) và cho rút về ngân hàng (`wallet.controller.ts:40`). Cần xác nhận không rơi vào dịch vụ ví điện tử phải có giấy phép.
- Mục 9: điều khoản CTV, đại lý, gian hàng; khấu trừ TNCN 10%. Trong mã thuế chỉ khấu trừ khi một lần rút từ 2.000.000đ (`apps/api/prisma/seed.ts:148-149`, `apps/api/src/modules/affiliate/affiliate.service.ts:92-93`, `:543-548`), còn chủ dự án nói "10% theo quy định hiện hành" và quyết định B17 còn chờ kế toán (`docs/2026-10-18-launch-review/03-cau-hoi-sang.md:51`, `:114`). Đại lý là doanh nghiệp hay hộ kinh doanh có phải trừ không? Luật Thuế TNCN mới có hiệu lực từ 2026 nên cần kiểm lại ngưỡng.
- Mục 14: giới hạn trách nhiệm không được trái quyền người tiêu dùng.
- Mục 15: cách ghi cơ quan, tổ chức hỗ trợ và thẩm quyền Toà án.
- Mục 18: danh sách văn bản (xem mục 7 dưới đây) và nghĩa vụ thông báo/đăng ký với Bộ Công Thương theo Luật Thương mại điện tử 2025.

`bao-mat.md`
- Mục 1: dùng Luật 91/2025/QH15 và Nghị định 356/2025/NĐ-CP, đã thay Nghị định 13/2023 (bản nháp mặc định trong `apps/web/src/lib/legal.ts` còn dẫn Nghị định 13/2023).
- Mục 5: chuyển dữ liệu ra nước ngoài (nhà cung cấp AI, Cloudinary, nơi lưu sao lưu). Cần hồ sơ đánh giá tác động hoặc thủ tục nào.
- Mục 6: câu "website không dùng cookie quảng cáo hay công cụ phân tích bên thứ ba" đúng ở thời điểm soạn (không có `<Script>` hay SDK nào trong `apps/web/src`). Thêm Google Analytics hay Meta Pixel sau này phải sửa câu này và có biểu ngữ cookie.
- Mục 7: thời hạn giữ chứng từ kế toán, thuế (số năm cụ thể) và phần được giữ nguyên MST, tên công ty, địa chỉ trên hoá đơn đã xuất.
- Mục 9: thời hạn phản hồi từng quyền theo Nghị định 356/2025. Không đọc được toàn văn nên bài không ghi con số luật định, chỉ ghi 3 ngày làm việc của quy trình xoá tài khoản trong mã.
- Mục 13: tên cơ quan nhận khiếu nại về dữ liệu cá nhân.

`doi-tra.md`
- Mục 3: chính sách đang chỉ nhận lỗi, hỏng, giao sai, bể vỡ, hết hạn, sai mô tả; "lý do khác" tuỳ Tubu Tree. Cần luật sư xác nhận Luật Bảo vệ quyền lợi người tiêu dùng 2023 và Nghị định 55/2024/NĐ-CP có buộc quyền trả hàng không cần lý do với giao dịch từ xa hay không. Tìm kiếm của tôi không đọc được điều khoản này nên không khẳng định.

## 5. Quy tắc nghiệp vụ trong bài và nơi đọc trong mã

Xác nhận trong mã:

| Nội dung trong bài | Nguồn |
|---|---|
| Đơn từ 199.000đ miễn phí ship, dưới đó 19.000đ cho kiện Tubu giao | `apps/api/prisma/seed.ts:218-219`; `apps/api/src/modules/pricing/pricing.service.ts:17-24`, `:83-90` |
| Ngưỡng tính trên tiền hàng của kiện TRƯỚC khi trừ mã giảm giá, Điểm Xanh | `apps/api/src/modules/checkout/checkout-split.ts:282`; `checkout.service.ts:1191-1230` |
| Hạng thành viên freeship sớm hơn (Lộc Biếc từ 99.000đ, Đại Thụ và Cổ Thụ mọi đơn) | `apps/api/prisma/seed.ts:224`; `pricing.service.ts:17-24`. Bài không ghi con số, chỉ ghi "hiển thị ở giỏ hàng" |
| Freeship đơn đầu: chỉ kiện Tubu, đơn đầu không tính đơn huỷ, có ngưỡng cấu hình | `pricing.service.ts:26-54`; `apps/api/src/common/first-order.ts:32` |
| Kiện đối tác: phí do gian hàng đặt, mặc định 30.000đ; miễn khi đạt `freeShipFrom`; mã freeship Tubu không áp | `apps/api/src/modules/merchant/merchant-config.ts:5`; `checkout.service.ts:1191-1230` |
| Gian hàng xác nhận trong 24 giờ, bàn giao trong 48 giờ | `merchant-config.ts:13`, `:15` |
| Đơn tách theo nơi giao, mỗi kiện một phí | `checkout.service.ts:1103-1160` |
| Thanh toán: COD, chuyển khoản, Ví Tubu (ZaloPay có trong mã nhưng cần khoá, không bắt buộc cho ra mắt nên bài không nhắc) | `apps/api/src/modules/checkout/dto/checkout.dto.ts` (`CHECKOUT_PAYMENT_METHODS`); `docs/ZALOPAY-SETUP.md:3-4` |
| COD tối đa 5.000.000đ mỗi kiện; hàng đối tác và đơn nhiều nơi giao chỉ COD hoặc Ví | `checkout-split.ts:328`, `:355-373` |
| Đơn chuyển khoản chưa trả sau 24 giờ tự huỷ (cấu hình `orders.pending_payment_ttl_hours`) | `apps/api/src/modules/orders/pending-payment-ttl.ts:5` |
| Khách tự huỷ khi PENDING_PAYMENT, CONFIRMED, PACKED và chưa bàn giao vận chuyển | `apps/api/src/modules/orders/orders.service.ts:107`, `:135-170`; `order-transition.ts:149-170` |
| Đổi trả 7 ngày kể từ lúc giao, quá hạn bị từ chối | `apps/api/prisma/seed.ts:257`; `order-returns.service.ts:195-201` |
| Lý do: lỗi, giao sai, bể vỡ, hết hạn (lỗi phía shop), lý do khác (cần mô tả từ 5 ký tự) | `apps/api/src/modules/orders/return-reasons.ts:2-8`; `order-returns.service.ts:206-210` |
| Tối đa 6 ảnh; chỉ một yêu cầu chờ xử lý mỗi đơn; đơn đại lý chỉ trả cả đơn; trả một phần được | `return-images.ts:4`; `order-returns.service.ts:203-204`, `:215-219` |
| Hoàn phí ship khi trả cả đơn hoặc lỗi phía shop, không hoàn khi trả một phần vì lý do khác | `apps/api/src/modules/orders/refund-allocation.ts:162` |
| Tiền hoàn tính theo số khách thực trả từng dòng; hoàn Điểm Xanh đã dùng, thu hồi điểm đã tích | `refund-allocation.ts:1-17` |
| Hoàn về Ví ngay khi duyệt, hoặc chuyển khoản 1-3 ngày làm việc, miễn phí; đơn trả bằng Ví chỉ về Ví; được đổi nơi nhận tới khi bắt đầu chuyển | `order-returns.service.ts:150-157`, `:163`; `apps/api/src/modules/orders/refund-destination.ts:19`; `apps/web/src/lib/refund-rules.ts:196-209` |
| Tubu phản hồi đổi trả trong 24 giờ | `apps/web/src/app/tai-khoan/don-hang/[code]/return-request-form.tsx:123` |
| Điểm Xanh hết hạn 12 tháng, nhắc trước 7 ngày; điểm không trừ vào phí ship | `apps/api/prisma/seed.ts:26-27`; `apps/api/src/modules/loyalty/points-expiry-date.ts:2`, `:17`; `loyalty-expiry.service.ts:436-449`; `pricing.service.ts:127` |
| Trần dùng điểm 20% giá trị đơn (bài ghi "hiện là 20%") | `apps/api/prisma/seed.ts:25`; `pricing.service.ts:98-101` |
| Ví Tubu: rút tối thiểu 100.000đ, phí 3.000đ mỗi lần (bài ghi "hiện là") | `apps/api/prisma/seed.ts:72-73`; `apps/api/src/modules/wallet/wallet.service.ts:10` |
| Hoa hồng: bỏ sản phẩm bị chặn CTV; tự mua không có hoa hồng; giữ tối thiểu bằng hạn đổi trả | `apps/api/src/modules/affiliate/affiliate.service.ts:886`, `:895-912`, `:1305-1311` |
| Tin khuyến mãi tắt được ở Cài đặt "Khuyến mãi & mã giảm giá"; tin giao dịch luôn gửi | `apps/api/src/modules/notifications/notification-categories.ts:3`, `:12`; `apps/miniapp/src/pages/settings.tsx:111` |
| Xoá tài khoản: Mini App → "Về Tubu Tree & Hỗ trợ" → "Xóa tài khoản" → "Gửi yêu cầu xóa"; CSKH xử lý trong 3 ngày làm việc; chưa xoá ngay | `apps/miniapp/src/pages/profile.tsx:75`; `about.tsx:98-107`, `:273-295`; `apps/api/src/modules/users/users.service.ts:199`, `:220`; `users.controller.ts:35` |
| Điều kiện chặn xoá (số dư Ví, đơn đang xử lý, hoàn tiền, rút tiền, hoa hồng, công nợ...) | `apps/api/src/modules/users/account-deletion.service.ts:258-283` |
| Xoá là ẨN DANH, không xoá cứng; giữ đơn, hoa hồng, sổ Ví, lệnh rút, hoá đơn VAT vì luật kế toán và thuế | `account-deletion.service.ts:65-73`, `:288-339` |
| Thời gian giữ log: sự kiện 395 ngày, thông báo 180 ngày, webhook và tin OA 90 ngày, phiên 30 ngày | `apps/api/src/modules/data-retention/data-retention.service.ts:16-22`; `apps/api/prisma/seed.ts:298-301` |
| Dữ liệu thu thập: Zalo ID, SĐT qua Zalo, địa chỉ, tài khoản ngân hàng hoàn tiền, MST/CCCD của CTV | `apps/api/src/modules/auth/zalo.service.ts:111`; `refund-destination.ts:32-43`; `affiliate.service.ts:515-540`; `account-deletion.service.ts:288-335` |
| Pancake nhận tên, SĐT, địa chỉ để xử lý đơn và đối soát chuyển khoản | `apps/api/src/modules/integrations/pancake/pancake-order-body.ts:298-313`; `apps/api/src/modules/integrations/payment/vietqr.ts:2-5` |
| Ảnh tải lên Cloudinary | `apps/api/src/common/uploaded-image.ts:5-8` |
| Trợ lý AI gửi câu hỏi, tối đa 6 lượt lịch sử, danh mục và FAQ; không gửi hồ sơ người dùng; không có bảng lưu hội thoại | `apps/api/src/modules/ai-advisor/ai-advisor.service.ts:28`, `:68-72` |
| Cookie web: phiên HttpOnly, `tubu_ft` 30 ngày, localStorage/sessionStorage; không có script bên thứ ba | `apps/web/src/lib/auth-context.tsx:98-99`; `apps/web/src/lib/entry-source.ts:15-16`; `apps/web/src/lib/client-api.ts:5-10`; `saved-invoice.ts:14`, `storefront-context.ts:34`, `checkout-selection.ts:16` |
| Kiểm duyệt bài cộng đồng: người đáng tin tự đăng, bài bị cờ vào hàng chờ | `apps/api/src/modules/feed/community-feed.service.ts:577-580` |

Chỉ có từ chủ dự án (chưa thấy trong mã ở nhánh này):

- Freeship đơn đầu từ 199.000đ. Mã mặc định là TẮT và ngưỡng 0 (`apps/api/prisma/migrations/20261018150010_claim_freeship_config/migration.sql:3-5`). Phải vào Cấu hình đặt `shipping.first_order_free_enabled` = true và `shipping.first_order_free_min_subtotal` = 199000, nếu không bài hứa điều hệ thống không làm.
- Điểm Xanh kiểu mới (1 điểm = 1đ, 2% nhân hạng tới 4%, đơn sàn 1% sau 14 ngày, đơn CSKH tự cộng theo SĐT, giữ 30 ngày). Mã ở nhánh này vẫn tích 1 điểm cho 10.000đ và đổi 1 điểm = 1.000đ (`apps/api/prisma/seed.ts:23-24`, `pricing.service.ts:93`, `:98-101`). Bài viết theo quyết định của chủ dự án; nếu việc đổi công thức chưa lên thì chưa được dán mục 7 của điều khoản.
- Hoa hồng giữ 10 ngày sau giao: seed vẫn `affiliate.hold_days` = 20 (`apps/api/prisma/seed.ts:60`). Phải đổi thành 10 trong Cấu hình.
- Không trả hoa hồng cho hàng gian hàng đối tác (A3): không tìm thấy chặn riêng trong `createCommissionForOrder` ở nhánh này, chỉ có chặn sản phẩm `affiliateBlocked` và hàng ký gửi của chính người giới thiệu.
- Tài khoản nhận tiền: bài ghi 8386790906 theo chủ dự án, nhưng DB và seed vẫn có `payment.bank_account_no` = 9984606774 (`apps/api/prisma/seed.ts:197-200`, `apps/api/prisma/migrations/20260625070000_payment_bank_config/migration.sql:5`) và go-live check coi đó là số mẫu (`apps/api/src/config/go-live/db-checks.ts:101`). Phải sửa 4 khoá `payment.bank_*` trong Cấu hình trước khi mở bán, nếu không QR trên màn thanh toán khác với số trong điều khoản.
- Ngưỡng 199.000đ và phí 19.000đ chỉ là mặc định trong mã. Chủ dự án chưa xác nhận con số này, nên go-live check còn cảnh báo (`apps/api/prisma/reference-data/config-selection.ts:56-57`). Bài ghi cứng hai số, nên nếu sửa `shipping.free_threshold` hoặc `shipping.flat_fee_below_threshold` thì phải sửa cả `van-chuyen.md`.
- Hoa hồng và TNCN: xem mục 4.
- Duyệt bài cộng đồng 4 giờ làm việc (B8): mã chỉ có kiểm duyệt lai, chưa có hạn 4 giờ.
- Nhà cung cấp AI: mã gọi DeepSeek và Gemini (`apps/api/src/modules/ai-advisor/llm.client.ts:12`), chủ dự án nói Antigravity CLI. Bài chỉ nói "nhà cung cấp mô hình AI", không nêu tên.
- Sao lưu lưu trên Google Drive (A11), nên bài nhắc "dịch vụ sao lưu" ở mục chuyển ra nước ngoài.
- Thời gian giao hàng, số hotline, người đại diện: xem mục 3.
- Ai chịu phí gửi hàng trả về: mã không có quy tắc phí gửi trả. Bài dùng câu của app ("Tubu chịu phí ship 2 chiều cho lỗi từ nhà sản xuất", `apps/miniapp/src/pages/about.tsx:39`) và "lý do khác thì báo chi phí trước".
- Không có luồng đổi sang sản phẩm khác trong mã (chỉ trả hàng và hoàn tiền), dù trang chủ web ghi "đổi mới hoặc hoàn tiền" (`apps/web/src/app/page.tsx:40`). Bài ghi đúng theo mã.

## 6. Chỗ khác trong app đang lệch với bài mới (nên sửa cùng đợt)

- `apps/miniapp/src/pages/about.tsx:28-41` (tóm tắt trong Mini App): nói chỉ nhận lỗi nhà sản xuất, hoàn tiền "vào Ví Tubu", "KHÔNG ... chia sẻ dữ liệu cho bên thứ ba ngoài đối tác vận chuyển/thanh toán". Mã nhận cả "lý do khác", cho hoàn ngân hàng, và dữ liệu còn đi tới Zalo, Pancake, Cloudinary, nhà cung cấp AI.
- `apps/miniapp/src/pages/about-data.ts:74` và `apps/web/src/app/page.tsx:38-40`: cùng ý, còn nói "đổi mới".
- `apps/web/src/lib/legal.ts` (bản nháp mặc định) vẫn dẫn Nghị định 13/2023/NĐ-CP, hoàn tiền "sau khi nhận lại và kiểm tra hàng" (mã hoàn ngay khi duyệt, trước khi hàng về), và mẫu COD "đơn giá trị cao". Không còn hiện sau khi dán nội dung, nên chỉ cần biết.
- Web chưa có nút xoá tài khoản; chỉ Mini App có (`apps/miniapp/src/pages/about.tsx:273-295`). Bài hướng dẫn người dùng web gửi email hoặc gọi hotline.
- Chữ "100% Thuần Chay & Lành Tính" ở `apps/web/src/app/page.tsx:36` (quyết định A10 bỏ chữ "100%") không thuộc bốn trang pháp lý nên chưa sửa ở đây.

## 7. Văn bản pháp luật đã dẫn và mức chắc chắn

Kiểm bằng tìm kiếm web ngày 2026-10-18, chưa đọc được toàn văn (các trang thuvienphapluat.vn và PwC chặn truy cập tự động).

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
