# D7 — Đánh giá giao diện từ ảnh chụp thật

Nhánh D7, launch review 2026-10-18. Bổ sung cho D5 (đọc mã). Chỉ ghi những gì **thấy được trên ảnh**; mục nào D5 đã có thì chỉ dẫn ID D5, không viết lại.
Nguồn: 120 ảnh miniapp và 44 ảnh web ở `docs/2026-10-review/screens/`, viewport 390px, chụp toàn trang; số đo lấy từ `scripts/uiux/results/{miniapp,web}.jsonl`. Ảnh dài được cắt thành lát 844–1.300px để xem đủ độ phân giải. Đường dẫn file tính từ `apps/`.

## 1. Tóm tắt

- **Mức "trông như đã hoàn thiện": khoảng 75%.** Luồng mua lõi của miniapp (duyệt, chi tiết SP, giỏ) đạt 4/5, sạch và nhất quán. Màn CTV, đối tác, cộng đồng, ví và điểm chỉ đạt 2,5–3/5: nhiều chữ, nhiều nút, nhìn như công cụ nội bộ. Web khách đạt 3–3,5/5. Admin web ở màn 390px đạt 2,5–3/5.
- **Lỗ hổng 1: thương hiệu bị tách đôi, chữ không có luật.** Logo thật (ô vàng-cam, lá xanh nõn, chữ cam) chỉ xuất hiện ở đầu Trang chủ miniapp, cao 30px nên dòng "Sống xanh an lành" không đọc được. Web dùng một icon cây chung trong ô xanh, trang đăng nhập web lại dùng một icon cây khác. Bảng màu giao diện (xanh rừng, kem, gỉ sắt) và font serif Fraunces không lấy gì từ logo. Font serif lúc dùng cho tiêu đề mục, lúc không. Web viết Hoa Mỗi Chữ, còn miniapp viết hoa đầu câu. Có 26 dòng chữ giao diện chứa emoji, đặt lẫn với icon nét.
- **Lỗ hổng 2: thiếu các mẫu quen thuộc với khách quen Shopee/TikTok Shop ở đúng chỗ quyết định mua.** Khách mới mở Trang chủ không thấy lời hứa giá trị hay voucher chào mừng. Phần giới thiệu thương hiệu bị đặt cuối trang, danh mục ở khối thứ 6. Thẻ đơn "Chờ thanh toán" không có nút Thanh toán. Thanh dưới trang chi tiết SP không có nút Chat. Giỏ và thanh toán trên web không có thanh CTA dính. Trang chủ web không có danh mục.
- **Lỗ hổng 3: các màn "giữ chân" và màn đối tác quá tải.** Trang CTV dồn mã giới thiệu, nút chia sẻ, gian hàng và rút tiền xuống cuối một trang dài 3.200px. Ví, Điểm Xanh và khối điểm ở thanh toán giải thích luật bằng 3–5 dòng chữ xám. Mỗi bài cộng đồng tốn khoảng 200px chỉ cho thẻ sản phẩm và hashtag. Danh sách khuyến mãi của chủ nhãn bị vỡ cột.
- Phần làm tốt: lưới thẻ SP đồng đều; thanh "Thêm vào giỏ / Mua ngay" dính ở chi tiết SP; chip sắp xếp và bộ lọc ở tìm kiếm; trang 404 và trang lỗi của web; trang Cài đặt có chọn cỡ chữ; giỏ có thanh tiến độ freeship.
- Chưa kiểm được: ảnh web `/s/<slug>` và `/brand/<slug>` chỉ ra trang 404, vì máy chụp không có dữ liệu SSR. Ảnh `/tai-khoan` ở cả ba trạng thái đều là trang lỗi kèm lớp phủ dev "4 errors". Admin trên màn máy tính chưa có ảnh.

## 2. Các chỗ lạ do dữ liệu giả (đã loại, không chấm)

Trong ảnh có những chỗ trông như lỗi nhưng mã cho thấy do dữ liệu giả gây ra. Các chỗ đó không được chấm:
- Tên hạng CTV "Nội dung mẫu" hiện chữ to ba dòng, vì trường `tier.emoji` của dữ liệu giả chứa chữ (`pages/affiliate.tsx:430`).
- Trạng thái "ACTIVE" trong admin không có trong `enum OrderStatus` (`api/prisma/schema.prisma:882`).
- Hoá đơn VAT hiện "Phát hành lỗi" vì trạng thái lạ rơi vào nhánh else (`pages/order-detail.tsx:586-591`).
- Thẻ đơn hiện icon hộp vì dữ liệu giả không có `thumbnail` (`components/orders/order-card.tsx:71-74`).
- Cả 4 trả lời đều gắn nhãn "hay nhất"; "Ngân hàng: Nhãn xanh"; "-0.12%".
- Chưa kiểm: thông báo nào cũng có tiêu đề "Thông báo" và cùng một icon chuông, có thể do dữ liệu giả thiếu loại.

## 3. Chấm từng màn — miniapp (state normal)

Thang điểm: 5 = sẵn sàng ra mắt. "RC" = file đang bị phiên đổi-rác sửa (quy ước của D5).

| Màn | Điểm | Vấn đề thấy trên ảnh (vị trí) | Đề xuất cụ thể |
|---|---|---|---|
| Trang chủ `/` | 3,5 | (1) Màn đầu chỉ có logo, ô tìm, kệ "Mua lại"; logo cao 30px, dòng tagline trong logo chỉ cỡ ~5px. (2) Tiêu đề "🌿 Ưu đãi giờ vàng", "🔔 Sắp diễn ra", nút "✅ Đã đặt nhắc" trộn emoji với icon nét. (3) Ô giờ vàng hiện "Còn 0h 00m", thẻ "Sắp diễn ra" hiện "Bắt đầu sau 0h 00m", thanh tiến độ ghi "Đã bán 400%". (4) Khối "Thiên nhiên Việt cho cả nhà" (lời chào + Điểm Xanh + hành trình nguyên liệu) xếp cuối trang, sau 9 khối | Logo ngang không tagline, cao 28–32px. Bỏ emoji khỏi tiêu đề và nút, dùng icon lucide 16px. Hết giờ thì ẩn hoặc đổi thành "Đang diễn ra"; kẹp % ≤ 100. Khách mới xem mục 6 việc 1 |
| Trang chủ khách mới | 3 | Đầu trang là "Kỳ định kỳ kế tiếp", rồi giờ vàng. Không có voucher chào mừng, không có "vì sao mua trực tiếp" | Khối thứ 2: thẻ "Quà chào mừng 30.000đ + Freeship từ 200k + Tích Điểm Xanh" (số đọc từ cấu hình, D5-10), một nút "Nhận mã" |
| Danh mục / tìm `/browse` | 4 | 7 ô danh mục cùng một icon lưới, tên bị cắt ("Mỹ phẩm thiên …", "Nông sản & Thự…"). Chip sắp xếp + "Bộ lọc" làm tốt | Icon hoặc ảnh riêng cho từng danh mục (tròn 40px), lưới 4 cột chữ 12px hai dòng, không cắt chữ |
| Chi tiết SP | 4 | (1) Tiêu đề mục lẫn font: "Đánh giá" là serif, "Mô tả sản phẩm", "Thường mua kèm", "Cam kết Tubu" là sans. (2) Tên SP 16px chữ thường, yếu hơn giá 24px đậm. (3) Thanh dưới chỉ có giỏ + Thêm + Mua ngay, không có Chat. (4) Chưa kiểm: ★/Đã bán cạnh giá khi SP đã có đánh giá (ảnh này SP chưa có) | Tên SP 17px/600. Tiêu đề mục thống nhất Inter 16/600. Thêm icon Chat (Zalo OA) vào `StickyActionBar` (`pages/product-detail.tsx:822`); `openOAChat` đã có ở `components/support-contact.tsx:44` |
| Giỏ hàng | 4 | Gọn. Dòng SP chỉ hiện đơn giá khi SL > 1. Footer dính tốt | Thêm dòng thành tiền nhỏ khi SL > 1. Còn lại như D5-18/21 |
| Thanh toán (RC) | 3,5 | (1) Liệt kê mọi địa chỉ thành thẻ; ô cảnh báo "địa giới cũ" màu vàng nằm riêng dưới thẻ thứ 2, không rõ thuộc địa chỉ nào. (2) Khối Điểm Xanh 4 dòng chữ xám 13px. (3) "Tổng cộng" cùng cỡ với "Tạm tính". (4) Không có dòng dự kiến giao | Chỉ hiện địa chỉ đang chọn + "Đổi"; cảnh báo nằm trong thẻ (như web đã làm). Điểm: 1 dòng "Dùng 65.048 điểm (−65.048đ)" + nút (i). Tổng 18px/700 màu thương hiệu. Thêm "Dự kiến giao: 2–4 ngày" |
| Chuyển khoản | 3 | Ngoài D5-02: hàng tiêu đề khác mọi màn (nút quay lại một dòng, tiêu đề một dòng); hướng dẫn "Giữ nguyên nội dung…" là chữ đỏ căn giữa, như báo lỗi; không có số tiền và mã đơn nổi ở đầu | Tiêu đề cùng hàng nút quay lại. Hướng dẫn đặt trong hộp thông tin màu vàng, đánh số 3 bước. Số tiền 24px + mã đơn ngay dưới QR |
| Đơn hàng | 3,5 | Thẻ "Chờ thanh toán" không có nút; thẻ đã giao/huỷ lại có "Mua lại" (`components/orders/order-card.tsx:89-98`) | Thẻ chờ thanh toán: nút chính "Thanh toán" + chữ "Hạn …"; dùng `vi.orders.payNow` có sẵn |
| Chi tiết đơn | 4 | Bố cục rõ: dải trạng thái, hành trình, nút Huỷ/Thanh toán dính. Email CSKH `tubutree@gmail.com` làm giảm tin cậy | Dùng email tên miền (vd. hello@tubutree.com) trong cấu hình `support.email` (`api/prisma/seed.ts:76`) |
| Cộng đồng `/feed` | 3 | (1) Tên tác giả bị gãy hai dòng vì hai huy hiệu chen cùng hàng (`components/community/post-card.tsx:73-81`). (2) Mỗi bài vừa có 2 thẻ SP vừa có 4 chip hashtag dài, chip tràn mép phải (`:171-185`, Chip không có maxWidth). (3) Phần đầu gồm 2 nút chỉ có icon (cúp, pháo hoa) + ô tìm + 2 hàng chip, mất ~300px trước bài đầu | Tên 1 dòng, cắt bằng dấu …; huy hiệu xuống dòng thời gian. Chỉ giữ thẻ SP, hashtag tối đa 2 chip, maxWidth 60%. Nút có chữ: "Xếp hạng", "Sự kiện"; gộp hai hàng chip thành một |
| Chi tiết bài | 3 | 3 ảnh xếp dọc, mỗi ảnh ~360px; hàng tác giả ở trả lời cũng bị chen như trên | Ảnh dạng carousel có số "1/3". Sửa hàng tác giả chung với post-card |
| Điểm Xanh `/loyalty` (RC) | 3 | 7 khối trên 3.100px: thẻ hạng, mã giảm giá, điểm danh, lối tắt, các hạng, đổi điểm, lịch sử. Hạn dùng của mã lúc một dòng, lúc gãy hai dòng. Mã giảm giá không có nút "Dùng" | Chia 3 tab: Ưu đãi / Đổi điểm / Lịch sử. Mã có nút "Dùng ngay", bấm mở `/browse` |
| Ví Tubu | 3 | (1) Thẻ Điểm Xanh: số "130.000 / điểm" gãy hai dòng vì cột giữa hẹp (icon trái + chip phải; `pages/wallet.tsx:153`, cỡ display-lg). (2) Có 3 đoạn chữ xám giải thích luật. (3) Một trang gộp 4 khái niệm: ví, điểm, hoa hồng, hoàn tiền. (4) "Mời thêm -2 bạn" (`:245`) | Số 24px một dòng, chip xuống dưới. Luật đưa vào nút (i). Thứ tự: số dư + Rút → lịch sử → hoa hồng/hoàn tiền; mời bạn tách sang thẻ riêng. Kẹp `remaining` ≥ 0 |
| Vườn Xanh `/game` (RC) | 2,5 | Hơn 12 nút to trên một trang ("Hồi sinh", "Tưới cây", "Góp quỹ", "Mua", "Hứng giọt sương", "Nhận thưởng" ×4…); nút "Điểm d…" bị cắt chữ (`components/game/checkin-streak.tsx:49`); "Quay ngay (1250000 Điểm Xanh)" thiếu dấu phân cách | Chỉ một hành động chính mỗi tab; nhiệm vụ thành danh sách gọn + "Nhận tất cả". Nút điểm danh có minWidth. Định dạng số bằng `formatNumber` |
| CTV `/affiliate` | 3 | (1) Mã giới thiệu + nút Chia sẻ + caption nằm cuối trang (~2.600px). "Gian hàng của tôi", "Rút hoa hồng", "CTV Academy" là 3 nút nhạt full-width ở ~2.400px. (2) Thưởng mốc là 5–8 thẻ, mỗi thẻ một nút "Nhận thưởng" to. (3) Hai ô số liệu "Đang chờ" có nền trắng, "Có thể rút" không có nền | Ngay dưới thẻ hoa hồng: hàng 4 lối tắt (Chia sẻ link, Gian hàng, Lên đơn hộ, Rút tiền). Thưởng mốc gọn thành dòng + "Nhận tất cả". Hai ô cùng một kiểu thẻ |
| Gian hàng của tôi | 3 | Ô ảnh bìa là khung trắng trống ~170px; mỗi dòng SP có 3 icon (ghim, mắt, thùng rác đỏ) + link "Nội dung" + trích dẫn in nghiêng, không có ảnh SP | Ô bìa trống: nền kem + icon ảnh + "Thêm ảnh bìa". Dòng SP có ảnh 40px; gom các thao tác vào menu "⋯", chỉ để ghim nổi bên ngoài |
| Gian hàng công khai `/s/:slug` | 3 | Ngoài D5-09: chip "Nội dung mẫu …" tràn mép phải; lời giới thiệu của CTV là hộp xanh tách khỏi thẻ, mỗi SP cao gấp đôi; trước hộp có một chấm 6px lạc | Lời CTV thành một dòng nghiêng trong thẻ ("CTV: …", 2 dòng, cắt …) hoặc chỉ hiện ở chi tiết SP |
| Trang nhãn `/brand/:slug` | 3 | (1) "Chia sẻ nhãn này — nhận tới % hoa hồng" thiếu số khi tỉ lệ rỗng (`pages/brand-view.tsx:159`). (2) 4 thẻ khuyến mãi viền cam, mỗi thẻ ~150px. (3) Khối "Chương trình đại lý" + "Vào kênh đại lý" nằm giữa trang của khách. (4) Tên nhãn trên thẻ SP không giới hạn dòng (gãy 3 dòng khi tên dài) | Ẩn câu khi rate ≤ 0 (như `storefront-builder.tsx:730`). Khuyến mãi thành một dải vé ngang cuộn được. Khối đại lý chỉ hiện cho tài khoản đại lý/CTV, hoặc thu gọn cuối trang. Tên nhãn 1 dòng, cắt … |
| Chủ nhãn | 2,5 | Danh sách khuyến mãi vỡ cột: hai nút "Sửa"/"Xoá" giãn rộng, ép chữ còn ~110px, mỗi dòng 1–2 từ (`pages/brand-owner.tsx:232-240`). Ô ngày hiện "mm/dd/yyyy" (trình duyệt chụp là en-US; chưa kiểm trên Zalo) | Dùng IconButton (bút/thùng rác) 44px hoặc `size="sm"` + `flexShrink:0`. Ngày dùng bộ chọn dd/mm/yyyy |
| Kênh đại lý `/dealer` | 3,5 | Có chủ đích dùng màu riêng (thẻ xanh navy, nền xám lạnh `--color-dealer-*`, `pages/dealer.tsx:72,145`) nên trông như app khác; tên SP bị cắt "Nội dung mẫu · Nội dung …" | Giữ nền B2B nhưng nút chính và accent dùng xanh thương hiệu; tên SP 2 dòng |
| Thông báo | 3,5 | Mọi mục cùng icon chuông; mục chưa đọc dùng nền xanh nhạt + chấm (ổn). Chưa kiểm phân loại | Icon theo loại (đơn/ưu đãi/cộng đồng/ví) |
| Cá nhân `/profile` | 4 | Số "130.000 điểm", "130.000đ" in serif (Fraunces, số kiểu cổ), khó đọc; hàng thẻ 2 + 1 lệch ("4 mã" nằm riêng); không có hàng trạng thái đơn kiểu Shopee | 3 thẻ một hàng, số dùng Inter tabular. Thêm hàng 4 icon: Chờ thanh toán / Đang xử lý / Đang giao / Đánh giá, có badge số |
| Cài đặt | 4,5 | Gọn, có cỡ chữ | — |
| Quản trị `/admin` | 3,5 | Nút huỷ có hai kiểu màu: "Thu hồi" đỏ, "Huỷ" xanh; dòng chờ chỉ có nền nhạt, không có thẻ | Mọi hành động huỷ/thu hồi dùng `tone=danger` ghost; dòng chờ dùng cùng Card |
| Duyệt cộng đồng | 3,5 | Ảnh bài to (~200px) làm danh sách duyệt chậm; "Từ chối" là nút đỏ đặc ngang hàng "Duyệt" | Ảnh nhỏ 64px, bấm để phóng to; "Từ chối" dùng viền đỏ |
| Mua chung | 3 | Nhóm hết hạn chiếm chỗ với nút xám to "Nhóm đã hết hạn" | Nhóm hết hạn dời xuống cuối, thu gọn, không có nút |
| Trợ lý AI, Yêu thích, Học viện, Về Tubu, 404 | 4–4,5 | Sạch. Trang Về Tubu đã có mục "Điều khoản & Chính sách" (3 link) | Như D5-12 |

## 4. Chấm từng màn — web (state normal, 390px)

| Màn | Điểm | Vấn đề thấy trên ảnh | Đề xuất cụ thể |
|---|---|---|---|
| Trang chủ `/` | 3,5 | (1) Logo là icon cây chung trong ô xanh, không phải logo thật (`web/src/components/site-header.tsx:23-35`). (2) Viết Hoa Mỗi Chữ: "Mỹ Phẩm & Tiêu Dùng Sinh Học Thuần Khiết", "Danh Mục Thương Hiệu", "Giao Hàng Nhanh Toàn Quốc" (`web/src/app/page.tsx:62,104,117,127`). (3) Không có danh mục, chỉ có chip lọc theo nhãn (grep "categor" trong `page.tsx`: rỗng). (4) 3 thẻ cam kết xếp dọc tốn ~260px. (5) Danh sách dài 4.900px, phân trang ở cuối | Dùng logo thật. Viết hoa đầu câu. Thêm hàng danh mục cuộn ngang dưới hero. Cam kết gom thành một hàng 3 icon. Tải thêm khi cuộn, hoặc nút "Xem thêm" |
| Chi tiết SP | 3 | Ngoài D5-04: khi API đánh giá lỗi, trang hiện 2 dòng chữ đỏ ("Chưa kiểm tra được quyền đánh giá", "Không tải được đánh giá", `web/src/lib/reviews-client.ts:132`, `web/src/app/san-pham/[slug]/product-reviews.tsx:201`). Không có dòng freeship, mã giảm giá, SP liên quan như miniapp | Mục phụ lỗi thì ẩn hoặc một dòng xám; thêm dòng freeship + "Cùng nhãn" giống miniapp |
| Giỏ `/gio-hang` | 3,5 | Tên SP gãy 3 dòng vì cột giá bên phải; 3 phiếu giảm giá viền đứt mỗi phiếu ~100px nằm trước "Tổng" và nút; checkbox 20×20 (số đo) | Thanh dưới dính: Tổng + "Thanh toán (6)". Mã giảm giá gọn thành một dòng "Chọn mã (3) ›" mở ngăn kéo. Checkbox 24px, nhãn 44px |
| Thanh toán `/thanh-toan` | 3,5 | Làm tốt: cảnh báo địa giới nằm trong từng thẻ địa chỉ, điểm chỉ một dòng. Chưa tốt: lặp lại 3 phiếu giảm giá; nút "Đặt hàng" không kèm số tiền và không dính; radio 13–16px; axe: tương phản 2,8:1 ở phiếu bị mờ | "Đặt hàng · 798.000đ" dính dưới. Phiếu gọn như ở giỏ. Radio 20px + hàng 44px. Phiếu bị mờ dùng màu chữ đủ 4,5:1 thay `opacity-60` |
| Đăng nhập | 3 | Lời nói "có thể mua ngay trong Zalo Mini App" nhưng không có nút hay mã QR; câu dài chữ đỏ; icon cây thứ ba khác header | Nút phụ "Mở Tubu Tree trên Zalo" (deep link) + QR trên máy tính; dùng logo thật |
| 404, lỗi, giỏ rỗng | 4,5 | Có icon, tiêu đề serif, mô tả, nút chính; là mẫu tốt nhất của cả hệ thống | Đem mẫu này sang miniapp (mục 5) |
| `/s/<slug>`, `/brand/<slug>`, `/tai-khoan` | chưa kiểm | Ảnh là 404 hoặc trang lỗi do lúc chụp thiếu dữ liệu | Chụp lại với dữ liệu SSR giả |
| Admin (390px) | 2,5–3 | Header của khách (ô tìm SP, giỏ có badge 6) vẫn hiện trên admin/merchant/POS (`web/src/app/layout.tsx:30`; chỉ footer được ẩn). Bảng Đơn 3 cột chật, mỗi dòng ~150px. 3 hàng chip lọc. Ô ngày mm/dd/yyyy. Tab Cấu hình: D5-06. Flash Sale: form dài 3.400px, nút "Xoá" nhỏ (16 điểm chạm < 44) | Header riêng cho cổng nội bộ: logo + "Quản trị" + người dùng + "Về cửa hàng". Bảng Đơn ở màn hẹp đổi thành thẻ. Admin chưa kiểm trên máy tính |
| Merchant | 3 | Logo và ảnh bìa nhập bằng ô URL, đang hiện chuỗi "data:image/svg+xml,…" (`web/src/app/merchant/page.tsx:576,586`); trộn tiếng Anh và Title Case ("Theme Color", "Live Preview", "Xanh Navy Hiện Đại"); hàng thẻ số liệu 2 + 1 lệch. Khung "Mô phỏng mobile" làm tốt | Tải ảnh lên + xem trước + cắt (miniapp chủ nhãn đã có "Đổi ảnh khác"). Nhãn tiếng Việt viết hoa đầu câu. Lưới 3 ô |
| Merchant bị từ chối | 3,5 | Sạch nhưng không có nút | "Mở Mini App để đăng ký" + QR |
| POS thu ngân | 3,5 | Header của khách làm phân tâm; placeholder dùng font mono | Header cổng nội bộ; ô quét to, focus sẵn |

## 5. Trạng thái rỗng và lỗi (10 màn đông khách)

| Màn | Rỗng | Lỗi | Nhận xét |
|---|---|---|---|
| Trang chủ | 4 (hiện khối danh mục + lời chào + lối tắt) | 2,5 | Lỗi: **6 thẻ "Máy chủ đang bận, thử lại nhé. [Thử lại]" giống hệt nhau xếp chồng** (`components/home/home-section.tsx:40`, `home-block-error.tsx`). Nên có một dải lỗi cấp trang + một nút thử lại, các kệ lỗi thì ẩn |
| Duyệt/tìm | 3,5 | 3,5 | Rỗng "Chưa có sản phẩm" không có nút; tìm không ra nên gợi ý từ khoá hoặc bán chạy |
| Chi tiết SP | 2,5 | 3 | "Không tìm thấy sản phẩm này." + "Về trang chủ", căn trên, 700px trống phía dưới. Khách từ link sàn/CTV gặp màn này là mất. Nên thêm kệ "Có thể bạn thích" + ô tìm |
| Giỏ | 4 | 3 | Giỏ rỗng có minh hoạ + "Khám phá ngay" (tốt); nên thêm kệ gợi ý như Shopee |
| Thanh toán | 3,5 | 3 | Rỗng dùng lại chữ của giỏ ("Giỏ còn trống đấy"), chấp nhận được |
| Đơn hàng | 4 | 3 | Rỗng có nút "Bắt đầu mua" (số cứng: D5-10) |
| Chi tiết đơn | 3 | 3 | Không thấy đơn: không có lối sang "Đơn của tôi" |
| Cộng đồng | 3,5 | 3 | Như D5-07 |
| Thông báo | 3,5 | 3 | Rỗng ổn |
| Chuyển khoản | — | 3,5 | Lỗi có 2 nút (Thử lại + Xem đơn hàng) nhưng không có icon; khác kiểu các màn khác |
| Gian hàng công khai | 2 | 2,5 | Rỗng "Không tìm thấy dữ liệu." + "Thử lại": thử lại không giúp gì khi gian hàng không tồn tại; không có tiêu đề trang (h1 = 0 theo số đo). Là cửa vào của link CTV (D5-09) |

**Quy luật chung của miniapp:** cùng một chiếc lá xanh dùng cho cả rỗng, không tìm thấy và lỗi máy chủ, nên khách không phân biệt được "chưa có gì" với "hỏng". Thông báo không có tiêu đề, chỉ một câu. Khối nằm sát trên, phần còn lại của màn trống. Web làm đúng hơn: icon cảnh báo màu vàng + tiêu đề + mô tả + nút chính (`web/src/app/error.tsx`, `not-found.tsx`). Nên chuẩn hoá ErrorState của miniapp theo mẫu web, thêm dòng "Cần hỗ trợ? Gọi …", và dời khối xuống khoảng 30% chiều cao màn.

## 6. Nhận xét xuyên suốt

- **Thương hiệu.** Bảng màu giao diện (xanh rừng `--forest-600 #245E3E`, nền kem, đất nung `--clay-*` cho khuyến mãi; `packages/design-tokens/src/tokens.css:12,39`) cộng với Fraunces cho cảm giác "hữu cơ, điềm tĩnh, đáng tin". Nhìn cả hệ thống thì đạt hướng "xanh/tin cậy" ở mức khá. Nhưng logo thật (`miniapp/src/assets/tubu-logo.png`: ô vàng-cam, lá xanh nõn, chữ cam) có giọng vui tươi, bình dân, không ăn với giao diện, và web hoàn toàn không dùng logo này. Ngoài ra còn hai "giao diện con": Kênh đại lý (navy) và Hoàn tiền (gradient gỉ sắt). Khách đi từ fanpage hay sàn (thường thấy logo vàng-cam) sang web sẽ thấy một thương hiệu khác.
- **Typography.** Thân chữ Inter 13–15px, dễ đọc. Số chữ 11px: trang chi tiết đơn 20, chi tiết SP 17, Trang chủ 16, câu chuyện thương hiệu 29 (số đo `tinyText`). `Heading` luôn là serif (`components/ui/text.tsx:65`), nhưng checkout, chi tiết SP, chi tiết đơn, ví, đơn hàng không dùng `Heading` nào (đếm `<Heading` = 0). Vì vậy tiêu đề mục lúc serif, lúc sans tuỳ trang. **Luật đề xuất:** serif chỉ cho tiêu đề trang (h1) và hero; tiêu đề mục Inter 16/600; mọi số tiền và điểm dùng Inter `font-variant-numeric: tabular-nums`; cả web lẫn miniapp viết hoa đầu câu.
- **Icon.** Icon lucide nét 1,5–2px nhất quán, nhưng `i18n/vi.ts` có 26 dòng chứa emoji (vd. `:92,99,101,102,757`), và game, bảng xếp hạng, CTV dùng emoji làm icon. Emoji hiện khác nhau giữa iOS và Android, kéo cảm giác "cao cấp" xuống. Chỉ nên giữ emoji trong caption chia sẻ và nội dung người dùng.
- **Góc bo, khoảng trắng.** Thẻ bo ~16px, nút ~12px, chip tròn: nhất quán trên cả hai nền. Lề 16px đều. Đang có hai kiểu dàn trang song song: "danh sách nhóm" (dải xám 8px giữa các khối, ở chi tiết SP và thanh toán) và "thẻ nổi trên nền kem" (Ví, Điểm Xanh, CTV). Nên chọn một kiểu cho mỗi loại màn: giao dịch dùng dải, tài sản/cộng đồng dùng thẻ.
- **Độ dày thông tin.** Luồng mua: vừa phải, tốt. Luồng tài sản, CTV, game: quá nhiều đoạn chữ xám giải thích luật (ví ~6 đoạn, CTV ~4 đoạn, điểm ở thanh toán 4 dòng) và quá nhiều nút chính trên một màn. Khách quen Shopee lướt qua chứ không đọc luật. Luật nên vào nút (i) mở bottom sheet, và mỗi màn chỉ nên có một hành động chính.
- **So với Shopee/TikTok Shop**, khách sẽ thấy thiếu: banner hoặc voucher chào mừng ở màn đầu; danh mục có ảnh; hàng ★ + "Đã bán" ngay dưới giá (chưa kiểm với dữ liệu thật); nút Chat với shop; nút "Thanh toán" ngay trên thẻ đơn chờ; hàng trạng thái đơn ở trang Cá nhân; kệ gợi ý ở màn rỗng; mã giảm giá dạng dải vé ngang; thanh CTA dính trên web. Phần **hơn** sàn: cảm giác thương hiệu riêng, lời hứa nguồn gốc, Điểm Xanh, định kỳ. Những thứ này hiện chưa được đẩy lên màn đầu.
- **Thanh tab:** ô giữa nổi bật là "Vườn Xanh" (game). Với khách mới từ sàn, chữ này chưa có nghĩa gì. Xem câu hỏi 2.

## 7. Top 12 việc giao diện trước ra mắt

Xếp theo tác động lên (a) tỉ lệ khách từ sàn mua đơn đầu và (b) cảm giác hoàn thiện. Đã trừ những việc D5 đã có (D5-01..24), trừ khi ghi "bổ sung D5-xx".

| # | Việc | Mức | Vai trò | File nghi là nguồn | Công sức | RC? | Cần chủ dự án quyết? |
|---|---|---|---|---|---|---|---|
| 1 | **Màn đầu cho khách mới (miniapp + web):** miniapp đưa khối chào mừng (voucher + 3 lợi ích mua trực tiếp, số đọc từ cấu hình) lên ngay sau ô tìm, danh mục có icon lên trước giờ vàng; web thêm hàng danh mục, gom cam kết thành một hàng | P1 | khách, marketing | `miniapp/src/components/home/home-blocks.ts:16-18` (thứ tự NEW), `miniapp/src/pages/home.tsx:112-127` (CategoryGrid, extras), `miniapp/src/components/catalog/category-grid.tsx:27`, `web/src/app/page.tsx:94-127` | M | Không | Y: đổi thứ tự spec 5b.1 cho khách mới (mặc định: có) |
| 2 | **Nút "Thanh toán" + hạn trên thẻ đơn chờ thanh toán** | P1 | khách | `miniapp/src/components/orders/order-card.tsx:89-98`, `vi.orders.payNow` (`i18n/vi.ts:308`) | S | Không | N |
| 3 | **Chi tiết SP miniapp: icon Chat Zalo OA trong thanh dưới; tên SP 17/600; tiêu đề mục cùng một kiểu** | P1 | khách, CSKH | `miniapp/src/pages/product-detail.tsx:822` (StickyActionBar), `miniapp/src/components/support-contact.tsx:44` (`openOAChat`) | S | Không | N (ẩn khi `hasOA()` false) |
| 4 | **Web giỏ + thanh toán: thanh CTA dính (Tổng + nút có số tiền), mã giảm giá gọn thành một dòng mở ngăn kéo, checkbox/radio 24px; trang đăng nhập có nút "Mở trên Zalo"** (bổ sung D5-04, chỗ đó chỉ nói về chi tiết SP) | P1 | khách | `web/src/app/gio-hang/page.tsx`, `web/src/app/thanh-toan/page.tsx` (grep sticky: không có), `web/src/components/coupon-box.tsx`, `web/src/app/dang-nhap/page.tsx` | M | Không | N |
| 5 | **Thống nhất logo:** logo thật ở header, đăng nhập, footer, favicon của web; làm bản logo ngang không tagline cho chỗ cao ≤ 32px | P1 | khách, marketing | `web/src/components/site-header.tsx:23-35`, `web/src/app/dang-nhap/page.tsx`, `miniapp/src/components/home/home-header.tsx:11-21`, `miniapp/src/assets/tubu-logo.png` | S–M | Không | Y: có đưa cam/vàng của logo vào màu nhấn không (câu 1) |
| 6 | **Luật typography:** serif chỉ cho h1/hero; tiêu đề mục Inter 16/600; số tiền và điểm dùng Inter tabular; bỏ Title Case trên web | P2 | khách | `miniapp/src/components/ui/text.tsx:65`, `miniapp/src/css/tokens.css:72-83`, `miniapp/src/pages/profile.tsx`, `web/src/app/page.tsx:62,104,117,127`, `web/src/app/merchant/page.tsx` | S–M | Có một phần (checkout, loyalty) | N |
| 7 | **Trạng thái lỗi/rỗng miniapp theo mẫu web:** một dải lỗi cấp trang ở Trang chủ thay cho 6 thẻ; icon lỗi khác icon rỗng; có tiêu đề + hotline; kệ "Có thể bạn thích" ở giỏ rỗng, SP không tìm thấy, gian hàng không tồn tại | P1 | khách | `miniapp/src/components/home/home-section.tsx:40`, `home-block-error.tsx`, `miniapp/src/components/ui/empty-state.tsx`, `miniapp/src/i18n/vi.ts:28`, `miniapp/src/pages/storefront-view.tsx:31` | S–M | Không | N |
| 8 | **Thẻ bài cộng đồng gọn:** tên 1 dòng + huy hiệu xuống dòng; bỏ trùng thẻ SP và hashtag, Chip có maxWidth và cắt …; nút có chữ "Xếp hạng/Sự kiện"; ảnh chi tiết bài dạng carousel | P2 | khách, marketing | `miniapp/src/components/community/post-card.tsx:73-81,171-185`, `miniapp/src/pages/feed.tsx`, `miniapp/src/pages/post-detail.tsx` | S–M | Không | N |
| 9 | **Trang CTV đổi thứ tự:** hàng 4 lối tắt (Chia sẻ link/mã, Gian hàng, Lên đơn hộ, Rút) ngay dưới thẻ hoa hồng; thưởng mốc thành danh sách gọn + "Nhận tất cả"; hai ô số liệu cùng kiểu | P1 | đại lý/CTV | `miniapp/src/pages/affiliate.tsx` (1.226 dòng) | M | Không | N |
| 10 | **Màn đối tác:** sửa danh sách khuyến mãi vỡ cột; merchant web tải ảnh lên thay vì dán URL; ô bìa trống trong trình dựng gian hàng có placeholder; dòng SP có ảnh 40px và menu "⋯"; header riêng cho admin/merchant/POS | P1 | đại lý, admin, kho | `miniapp/src/pages/brand-owner.tsx:232-240`, `web/src/app/merchant/page.tsx:576,586`, `miniapp/src/pages/storefront-builder.tsx`, `web/src/app/layout.tsx:30` | M | Không | N |
| 11 | **Giảm chữ luật:** ví, Điểm Xanh và khối điểm ở thanh toán còn 1 dòng + (i); thanh toán miniapp chỉ hiện địa chỉ đang chọn, cảnh báo nằm trong thẻ, Tổng 18/700, dòng dự kiến giao; Điểm Xanh chia 3 tab | P2 | khách | `miniapp/src/pages/wallet.tsx:140-250`, `miniapp/src/pages/checkout.tsx` (RC), `miniapp/src/pages/loyalty.tsx` (RC) | M | **Có** (checkout, loyalty) | N |
| 12 | **Chặn hiển thị biên + bỏ emoji ở chữ giao diện:** kẹp "Đã bán %" ≤ 100; hết giờ thì ẩn "Còn 0h 00m"/"Bắt đầu sau 0h 00m"; kẹp "Mời thêm" ≥ 0; ẩn "% hoa hồng" khi rỗng; định dạng số ở vòng quay; nút "Điểm danh" không cắt chữ; 26 chuỗi emoji đổi sang icon | P2 | khách | `miniapp/src/components/flash-sale.tsx:99,107,203`, `miniapp/src/pages/wallet.tsx:245`, `miniapp/src/pages/brand-view.tsx:159`, `miniapp/src/components/wheel.tsx`, `miniapp/src/components/game/checkin-streak.tsx:49`, `miniapp/src/i18n/vi.ts:92-102` | S | Có (wheel, game) | N |

Ngoài top 12 (P2/P3): Kênh đại lý dùng accent xanh thương hiệu; danh mục `/browse` có icon riêng và không cắt chữ; hàng trạng thái đơn ở Cá nhân; nút huỷ cùng một màu trong admin miniapp; ảnh nhỏ ở trang duyệt cộng đồng; email CSKH dùng tên miền; chụp lại ảnh `/s`, `/brand`, `/tai-khoan` của web với dữ liệu SSR giả, chụp admin ở màn máy tính.

Thứ tự làm đề xuất: 2, 3, 12 (S, làm ngay) → 1, 4, 7 (chuyển đổi) → 5, 6 (thương hiệu, nên làm một lượt cùng một người) → 9, 10 (mục tiêu 4) → 8 → 11 (sau khi phiên đổi-rác merge).

## 8. Câu hỏi cho chủ dự án

| # | Câu hỏi | Mặc định khuyên dùng |
|---|---|---|
| 1 | Logo vàng-cam hiện tại có phải nhận diện chính thức cho mọi kênh không? Giao diện đang theo bảng xanh rừng + kem | Giữ logo; làm bản ngang không tagline; dùng cam của logo làm màu khuyến mãi thay gỉ sắt, để logo và giao diện "nói cùng một giọng". Web dùng logo thật |
| 2 | Ô giữa thanh tab là "Vườn Xanh" (game). Khách mới từ sàn chưa hiểu đó là gì. Giữ hay đổi? | Giữ vị trí nhưng đổi nhãn thành "Quà xanh" hoặc thêm gợi ý lần đầu; xem tỉ lệ bấm sau 4 tuần |
| 3 | Đồng ý đổi thứ tự Trang chủ cho khách mới (spec 5b.1): khối chào mừng + danh mục lên trước giờ vàng? | Có. Khách cũ giữ thứ tự hiện tại |
| 4 | Email CSKH công khai là `tubutree@gmail.com`. Có hộp thư theo tên miền không? | Dùng hello@tubutree.com (hoặc tương đương) trong cấu hình `support.email` |

## 9. Hạn chế

- Ảnh chụp bằng trình duyệt headless ở 390px với dữ liệu giả; không chụp trên máy Zalo thật (vùng an toàn, ô ngày, emoji theo hệ điều hành: chưa kiểm).
- Không có ảnh màn máy tính, nên admin và merchant chỉ được chấm ở bố cục điện thoại.
- Không chấm ảnh SP, tên, giá, nội dung. Những chỗ mã cho thấy do dữ liệu giả đã liệt kê ở mục 2.
