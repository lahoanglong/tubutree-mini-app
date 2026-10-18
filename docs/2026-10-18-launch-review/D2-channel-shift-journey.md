# D2 — Kéo khách từ sàn về kênh trực tiếp + hành trình khách đầu-cuối

Nhánh discovery D2, đợt launch review 2026-10-18. Chỉ đọc mã ở worktree `launch-review` (cùng cây main 0cc2fe62), cộng thêm một lần WebFetch `hello.tubutree.com`. Không chạy test, build hay DB. Mọi đường dẫn tính từ gốc repo.

## 1. Tóm tắt

- **Mức hoàn thiện ước tính: khoảng 40%.** Luồng mua cơ bản (mở app, giỏ, thanh toán COD/CK/Ví, theo dõi đơn, đánh giá, điểm, định kỳ, mua lại) xong khoảng 80%. Phần dành riêng cho việc chuyển khách từ sàn chỉ khoảng 20–25%. Phần đo lường khoảng 20%.
- Mini-app đã có những đòn bẩy tốt mà sàn không có, nhưng khách không thấy chúng lúc ra quyết định:
  - Tích điểm khoảng 10% giá trị đơn (10.000đ chi = 1 điểm, 1 điểm = 1.000đ, `apps/api/prisma/seed.ts:22-24`).
  - Đặt định kỳ giảm 12–15% (`seed.ts:106`).
  - Voucher chào mừng, voucher đơn thứ 2 và voucher quay lại (`vouchers.service.ts:157,373`).
- **Lỗ hổng lớn 1: không đo được nguồn khách.** App gửi cứng `entrySource:'organic'` (`apps/miniapp/src/components/app.tsx:120`). UTM bị bỏ qua. Web không phát sự kiện nào. Không có báo cáo phễu hay cohort theo nguồn. Vì vậy không biết mục tiêu 1 có đạt hay không.
- **Lỗ hổng lớn 2: không có cầu nối từ đơn sàn.** Chưa có mã ẩn cho thẻ trong hộp hàng, chưa có điều kiện "khách mới", chưa có cách nhận mã qua QR, chưa có cách ghép đơn sàn để tích điểm. Khách sàn không có đường vào nào được thiết kế riêng.
- **Lỗ hổng lớn 3: tin giữ chân chỉ hiện trong app.** Nhắc mua lại, voucher đơn 2, winback và giỏ bỏ dở chỉ gửi kênh INAPP. App xin quyền thông báo và mời theo dõi OA với lời hứa "ưu đãi mới", nhưng backend không có đường gửi. Khách không mở app thì vòng mua lại đứt.
- Phí ship 19k cho đơn dưới 200k, cộng thang hạng bắt đầu từ 5 triệu, là hai lý do kinh tế khiến khách sàn (quen freeship) không chuyển.
- `hello.tubutree.com` có 6 link Shopee nhưng không có link mini-app hay website, và không có lời mời mua trực tiếp.
- Các việc nên làm trước ra mắt đều nhỏ (S): ghi nguồn khách, khối ưu đãi khách mới, cấp voucher chào mừng ngay khi tạo tài khoản, freeship đơn đầu, và đưa mini-app lên link bio.

## 2. hello.tubutree.com — kênh bán hiện tại (WebFetch 2026-10-17)

- **Thông điệp:** "Sống xanh An Lành", "đơn vị phân phối chính hãng" sản phẩm tự nhiên sản xuất tại Việt Nam. Dòng Fuwa3e là "Tẩy rửa từ vỏ dứa", không hoá chất độc hại. Có lời mời hợp tác đại lý, CTV và xuất khẩu.
- **Link theo thứ tự trên trang:**
  - Hàng theo dõi: Zalo `zalo.me/v/@tubutree`, TikTok @tubutree.com, Instagram, X, YouTube, Facebook, TikTok @fuwa3e.com, Lazada.
  - Mục cửa hàng: 6 link Shopee (`s.shopee.vn/...`, `shopee.vn/fuwa3e_store`, `shopee.vn/pineboo`, `shopee.vn/sokfarm_mathoadua`…), Lazada `lazada.vn/shop/tubu-tree`, Zalo Fuwa3e `zalo.me/fuwa3e_official`.
- **Thiếu:** link mini-app hay website `app.tubutree.com`, mọi lời mời mua trực tiếp (ưu đãi, freeship, thành viên), và việc phân biệt kênh nào là kênh chính.
- **Ngành hàng:** hàng tiêu dùng xanh, dùng hết rồi mua lại (tẩy rửa, mật hoa dừa…). Điều này hợp với nhắc mua lại và đặt định kỳ.
- WebSearch "Tubu Tree" không ra kết quả liên quan, nên không có thêm thông tin công khai.

## 3. Hành trình khách sàn → mini-app

Cột "Lý do không chuyển" ghi lý do khách sàn sẽ ở lại sàn, theo bốn nhóm: giá, ship, tin cậy, tiện.

| # | Bước | Có sẵn (bằng chứng) | Gãy / thiếu / yếu | Lý do không chuyển |
|---|---|---|---|---|
| 1 | Điểm chạm: thẻ QR trong hộp hàng sàn | Không có gì riêng. Deep link Mini App `zalo.me/s/<appId>` dùng được với `?s=` và `?ref=` (`app.tsx:150-160`) | Không có landing "khách từ Shopee". Không có tham số nguồn. Không có mã kích hoạt (D2-01, D2-03) | Thẻ không nói lợi ích cụ thể nên khách không quét |
| 1b | Link Zalo OA / link bio | OA tự trả lời theo từ khoá và chào tin đầu (`zalo-oa-events.processor.ts:35-42`) | Bỏ qua sự kiện follow (`zalo-oa-webhook.controller.ts:68`). Không gửi link mini-app kèm quà khi khách theo dõi. Link bio không có mini-app (mục 2) | Tiện: khách không biết có app |
| 1c | Chia sẻ CTV / bạn bè | Gian hàng `/s/:slug`, `?ref=`, "chạm" giới thiệu lưu 7 ngày (`affiliate.service.ts:172`), ô nhập mã ở checkout (`checkout.tsx:575`) | Khách giới thiệu khách chỉ được 5 điểm, và người được mời không có quà riêng (D2-10) | Người nhận link không thấy lợi ích |
| 2 | Mở app / đăng nhập | Mini App đăng nhập Zalo im lặng, lỗi thì rơi về khách vãng lai (`apps/miniapp/src/store/auth.ts:116-136`); gộp khách vãng lai vào tài khoản khi lấy SĐT (`auth.service.ts:222-283`) | Web bắt đăng nhập Zalo OAuth mới cho thêm giỏ (`apps/web/src/app/gio-hang/page.tsx:85`, `dang-nhap/page.tsx:41-66`) (D2-14) | Tiện: link FB/TikTok mở bằng trình duyệt ngoài gặp rào |
| 3 | Ưu đãi đơn đầu | Voucher chào mừng 30k cho đơn ≥199k, hạn 30 ngày (`vouchers.service.ts:163-189`), chỉ cấp cho tài khoản thật (`common/real-user.ts`) | Cron chạy mỗi giờ (`vouchers.service.ts:157`), nên lần mở đầu có thể chưa có mã. Chỉ báo INAPP (`seed.ts:749`). Trang chủ không có khối "Quà khách mới" (`home-blocks.ts:11-18`) (D2-07) | Giá: không thấy lợi gì so với voucher shop trên sàn |
| 4 | Xem SP / tin cậy | "Đã bán" cộng số admin nhập từ sàn (`schema.prisma:431-432`), 3 cam kết (`product-detail.tsx:735`), badge freeship (`:469-474`), "Đặt định kỳ — tiết kiệm 12%" (`:579`) | Đánh giá chỉ lấy từ app (`schema.prisma:429-430`), nên lúc ra mắt mọi SP có 0 đánh giá. PDP không cho thấy số Điểm Xanh sẽ nhận (D2-07, D2-12) | Tin cậy: sàn có hàng nghìn đánh giá và chính sách đảm bảo của sàn |
| 5 | Giỏ | Thanh tiến độ freeship (`cart.tsx:658-687`), ví voucher có xem trước mức giảm (`voucher-sheet.tsx`), nhập mã (`cart.controller.ts:38`) | Không có combo hay giá riêng ở cửa hàng chính; combo chỉ áp trong gian hàng (`checkout.service.ts:984`) (D2-13) | Giá: sàn có combo và voucher Xtra |
| 6 | Thanh toán | COD, chuyển khoản, Ví (`checkout.tsx:361-366`); điểm trừ tối đa 20% đơn (`seed.ts:24`); ship 19k cho đơn dưới 200k (`seed.ts:211-212`) | ZaloPay đang ẩn (`checkout.tsx:363-364`). Ship 19k với đơn 1 món (D2-08) | Ship: sàn thường có freeship |
| 7 | Theo dõi đơn | Mã vận đơn và link tra cứu (`order-detail.tsx:480-526`); ZNS cho ORDER_CONFIRMED/SHIPPING (`seed.ts:696-697`) | ZNS chưa có template ID (A3-01 còn mở, việc của chủ dự án) | — |
| 8 | Đánh giá | Mời đánh giá 48 giờ sau giao, kèm Điểm Xanh (`review-invite.service.ts:48-73`, `reviews.service.ts:208`) | Lời mời chỉ đi INAPP (`seed.ts:754`) | — |
| 9 | Điểm / hạng | 10% điểm; hạng ×1.2/×1.5/×2 kèm freeship (`seed.ts:288-330`) | Hạng đầu cần chi 5 triệu trong 12 tháng (`seed.ts:306`; `loyalty.service.ts:594-596`) (D2-09) | Khách mới không có quyền lợi nào trong tầm với |
| 10 | Mua lại | Kệ "Mua lại", nhắc mua lại vào ngày 24 (`lifecycle.service.ts:81-82`), voucher đơn 2 (`vouchers.service.ts:373-444`), winback 60 ngày, đặt định kỳ (`subscriptions.service.ts`) | Một chu kỳ cho mọi SP. Mọi nhắc chỉ đi INAPP (`seed.ts:738,751,753,790`). Web không có đặt định kỳ (D2-05, D2-11) | Khách không mở app thì quay lại sàn theo thói quen |
| 11 | Giới thiệu bạn | Khối "Mời bạn" ở màn Ví (`wallet.tsx:222-268`); người mời nhận 5 điểm khi bạn có đơn 2 ≥200k trong 30 ngày (`seed.ts:71-73`) | Lối vào bị chôn trong màn Ví, thưởng thấp và một chiều (D2-10) | — |

## 4. So với cơ chế giữ chân của sàn

| Cơ chế sàn | Mini-app đang có | Thiếu để cạnh tranh |
|---|---|---|
| Shopee Xu / hoàn xu | Điểm Xanh khoảng 10% (`seed.ts:22-24`), mạnh hơn mức hoàn xu thông thường | Chưa nói ra ở PDP, Trang chủ hay link bio |
| Freeship Xtra / mã freeship | Freeship đơn từ 200k; theo hạng từ 99k hoặc 0đ (`seed.ts:211-217`) | Chưa có freeship đơn đầu cho khách mới. Voucher chào mừng là loại giảm tiền, không phải freeship |
| Voucher shop / voucher theo dõi shop | Voucher chào mừng, đơn 2, winback, sinh nhật, mốc chi tiêu, mã công khai | Chưa có mã ẩn chỉ người cầm thẻ dùng được, chưa có "chỉ khách mới", chưa có nhận mã qua link, chưa có thưởng khi theo dõi OA |
| Livestream / feed | Cộng đồng, sự kiện, game, mua chung (ngoài phạm vi D2) | — |
| Nhắc mua lại / push app sàn | Nhắc mua lại, nhắc giỏ, nhắc voucher sắp hết hạn, nhưng chỉ INAPP | ZNS hậu mãi / tin OA; chu kỳ theo từng SP |
| Đảm bảo hoàn tiền của sàn | COD; dòng chữ "Đổi trả trong 7 ngày nếu lỗi"; quy trình đổi/trả có sẵn | Chưa có huy hiệu "cam kết hoàn tiền" rõ ràng ở checkout |
| Cái sàn KHÔNG có | Đặt định kỳ giảm 12–15%, tư vấn qua Zalo OA, cộng đồng, đổi rác (phiên khác) | Cần gom thành một lời hứa "Mua trực tiếp được gì" |

## 5. Đo lường

| Câu hỏi | Hiện trạng | Bằng chứng |
|---|---|---|
| Có ghi nguồn khách (UTM, thẻ hộp hàng, sàn) không? | Không. `app_opened` gửi `{entrySource:'organic'}` vào `props`; trường `entrySource` của envelope không bao giờ được gán. App chỉ đọc `s` và `ref`; UTM chỉ được giữ nguyên trên URL | `app.tsx:120,158-160`; `ingest-events.dto.ts:43`; `utils/search-state.ts:58-61` |
| Nguồn có gắn vào khách hay đơn không? | Không. `User` không có cột nguồn. `Order.source` là kênh đặt (`checkout`, `buy_now`, `ctv_assisted`…), không phải nguồn khách. `order_placed` chỉ có `refCode` và `storefrontSlug` | `schema.prisma:217-321,978`; `checkout.service.ts:603-608` |
| Có phễu chuyển đổi không? | Không. Sự kiện được ghi vào `analytics_events` nhưng không có chỗ nào đọc; admin chỉ có `retention-daily`. `FunnelDailySnapshot` @deprecated, không có job ghi (C-108 vẫn còn) | `analytics-admin.controller.ts:10`; `schema.prisma:3031-3041` |
| Có cohort mua lại không? | Một phần: NS-1 (đơn 2 trong 30 ngày, theo cohort ngày) đã lên admin (`components/admin/ns1-card.tsx`). `CohortRepeatSnapshot` theo tháng và theo nguồn: chưa có (C-108) | `analytics-aggregation.service.ts:27-31,265-276` |
| Web có đo không? | Không phát sự kiện nào (grep `/events` và `trackEvent` trong `apps/web/src` không ra kết quả) | — |

## 6. Bảng phát hiện

| ID | Mức | Vai trò | Hiện trạng + bằng chứng | Đề xuất | Công sức | Cần chủ dự án quyết? |
|---|---|---|---|---|---|---|
| D2-01 | P1 (thành P0 nếu in thẻ cho đợt ra mắt: QR in ra không mang nguồn thì mất số liệu vĩnh viễn) | marketing, admin | Nguồn khách không được ghi: `app.tsx:120` gửi cứng `organic`; `app.tsx:158-160` chỉ đọc `s`/`ref`; User không có cột nguồn (`schema.prisma:217-321`); `order_placed` thiếu entrySource (`checkout.service.ts:603-608`) | Đọc `src`, `utm_source`, `utm_campaign`, `card` lúc mở app, gắn vào envelope mọi sự kiện của phiên; lưu nguồn chạm đầu khi tạo tài khoản (cột mới hoặc `User.metadata`); ghi vào `order_placed`. Web làm tương tự | S–M | Y. Chốt bộ mã nguồn: `shopee`/`lazada`/`tiktok`/`fb`/`oa`/`linkbio`/`ctv`/`card-<đợt>`. Mặc định: dùng đúng danh sách này |
| D2-02 | P1 | marketing, admin | Không có báo cáo theo nguồn hay phễu: chỉ có `retention-daily` (`analytics-admin.controller.ts:10`); `FunnelDailySnapshot` và `CohortRepeatSnapshot` không có job ghi (C-108); web không phát sự kiện | Một bảng admin theo nguồn × tuần: khách mới, đơn đầu, đơn 2 trong 30 ngày (tái dùng truy vấn NS-1), doanh thu. Một phễu mở app → xem SP → giỏ → checkout → đặt đơn | M | N |
| D2-03 | P1 | khách, marketing | Chưa có mã cho thẻ hộp hàng: mã PUBLIC tự hiện trong ví của mọi khách (`loyalty.service.ts:677`, `coupon-scope.ts:21`); Coupon không có cờ "chỉ khách mới" hay "ẩn" (`schema.prisma:1306-1330`); scope INVITE luôn bị từ chối (`coupon-scope.ts:33`); chỉ nhận mã bằng cách gõ tay ở giỏ (`cart.controller.ts:38`); admin chỉ tạo từng mã (`admin.controller.ts:586-596`) | Thêm scope ẩn (chỉ hiện sau khi nhận) và cờ `newCustomerOnly` (chưa có đơn nào); deep link `?claim=CODE` tự lưu mã vào ví sau đăng nhập; sinh lô mã duy nhất và xuất CSV để in | M | Y. Mức ưu đãi; mã chung theo sàn hay mã riêng mỗi thẻ; ngân sách mỗi khách chuyển |
| D2-04 | P1 | khách, CSKH | Chưa ghép được đơn sàn. Có mảnh dùng lại được: tích điểm tại quầy do nhân viên nhập, `receiptId` duy nhất (`schema.prisma:1197-1214`, `loyalty.controller.ts:75`), đang tắt (`seed.ts:30`). Pancake có `searchOrders` (`pancake.client.ts:170`) nhưng DTO không có nguồn sàn (`pancake.types.ts:106-114`); chưa kiểm sàn có nối vào cùng shop Pancake không | Bước 1 (S): bật tích điểm tại quầy cho CSKH, quy ước `receiptId = SHOPEE-<mã đơn>` (chặn ghép trùng sẵn có). Bước 2 (M): khách tự gửi mã đơn kèm ảnh, CSKH duyệt. Bước 3 (L): tự xác minh qua Pancake hoặc API sàn | S→L | Y. Đơn sàn được tích điểm không, tỷ lệ bao nhiêu, có tính hạng không? Shopee/Lazada có nối vào Pancake không? |
| D2-05 | P1 | khách, CSKH, marketing | Tin giữ chân chỉ INAPP: WELCOME, REORDER, WINBACK, SECOND_ORDER, REVIEW, CART_ABANDONED, VOUCHER_EXPIRING (`seed.ts:738,749,751,753,754,790,791`). ZNS chỉ gửi khi mẫu là ZNS, khách có SĐT và có template ID (`notifications.service.ts:109`) | Đăng ký mẫu ZNS chăm sóc/hậu mãi cho nhắc mua lại, voucher đơn 2 và winback (kiểm chính sách mẫu ZNS hiện hành); trần tần suất mỗi khách | M (cộng thời gian Zalo duyệt) | Y. Ngân sách ZNS/tháng. Mặc định: 3 mẫu, tối đa 2 tin/khách/tháng |
| D2-06 | P2 | khách | Hứa nhưng không gửi: mời theo dõi OA "Nhận thông báo… và ưu đãi mới" (`order-detail.tsx:320`) và xin quyền thông báo (`zmp-bridge.ts:183`, gọi ở `order-detail.tsx:179`, `settings.tsx:289`). Backend chỉ dùng tin OA để tự trả lời (`zalo-oa-events.processor.ts:42`), bỏ qua follow (`zalo-oa-webhook.controller.ts:68`), không có map từ `User.zaloId` (ID theo app) sang ID người theo dõi OA | Ngắn hạn (S): sửa lời thành "cập nhật đơn và tư vấn". Dài hạn (M): đường gửi tin OA kèm map ID, thưởng nhỏ khi theo dõi | S / M | Y. Có dùng OA làm kênh khuyến mãi không? |
| D2-07 | P1 | khách | Ưu đãi đơn đầu "vô hình": voucher chào mừng cấp bằng cron mỗi giờ (`vouchers.service.ts:157-189`); Trang chủ không có khối khách mới hay lợi ích kênh (`home-blocks.ts:11-18`, `home-extras.tsx:43-44`); PDP không ghi số Điểm Xanh sẽ nhận; web home chỉ có thông điệp thương hiệu (`apps/web/src/app/page.tsx:55-120`) | Cấp voucher chào mừng ngay khi tạo tài khoản thật (mã tất định sẵn có nên an toàn khi gọi trùng), giữ cron làm lưới. Khối "Quà khách mới" đầu Trang chủ. Dòng "Nhận N Điểm Xanh (≈N.000đ)" ở PDP | S | N |
| D2-08 | P1 | khách | Phí ship là rào kinh tế: 19k cho đơn dưới 200k (`seed.ts:211-212`, `pricing.service.ts:15`); voucher chào mừng là loại giảm tiền cho đơn ≥199k (`vouchers.service.ts:163-164`); khách mua 1 món 100–150k vẫn trả ship | Đơn đầu freeship (không ngưỡng, hoặc từ 99k) cho khách mới, tốt nhất là khách có nguồn sàn hoặc thẻ | S | Y. Chi phí ship đơn đầu chấp nhận được |
| D2-09 | P2 | khách | Hạng ngoài tầm: Lộc Biếc 5 triệu, Đại Thụ 20 triệu, Cổ Thụ 50 triệu trong 12 tháng (`seed.ts:288-330`) | Hạ ngưỡng hạng 2 (khoảng 1–1,5 triệu), hoặc cho quyền lợi "thành viên trực tiếp" ngay sau đơn đầu (vd freeship từ 99k trong 60 ngày) | S | Y |
| D2-10 | P2 | khách, marketing | Giới thiệu yếu và một chiều: 5 điểm (= 5.000đ) khi bạn có đơn 2 (`seed.ts:71-73`); người được mời không có quà; lối vào ở màn Ví (`wallet.tsx:222`); lời chia sẻ không nói người nhận được gì (`wallet.tsx:101`) | Thưởng hai chiều: người được mời có quà đơn đầu, người mời được thưởng khi đơn đầu giao. Đưa lối vào lên Hồ sơ và màn đặt đơn thành công | S–M | Y. Mức thưởng |
| D2-11 | P2 | khách | Nhắc mua lại dùng một chu kỳ cho mọi SP (`lifecycle.service.ts:73-82`; mã tự ghi chú là chưa có chu kỳ theo SP); khách sàn không có lịch sử nên không vào luồng nhắc | Thêm `reorderCycleDays` theo SP do admin nhập; đơn sàn ghép được (D2-04) cũng tạo nhắc mua lại | M | Y. Chu kỳ dùng thật của từng SP |
| D2-12 | P2 | khách | Thiếu bằng chứng xã hội khi ra mắt: "đã bán" có số từ sàn (`schema.prisma:431`), còn đánh giá thì không (`:429-430`) | Ô admin "Đánh giá trên sàn" (điểm, số lượt, ghi rõ nguồn), hoặc nhập lọc đánh giá thật, có ghi nguồn | S | Y. Điều khoản sàn có cho trích không |
| D2-13 | P2 | khách | Không có combo hay giá riêng ở cửa hàng chính: combo chỉ áp trong gian hàng (`checkout.service.ts:984`) | Cho phép combo ở cửa hàng chính (vd bộ Fuwa3e) làm ưu đãi riêng của kênh trực tiếp | M | Y. Có chấp nhận giá trực tiếp thấp hơn sàn không |
| D2-14 | P2 | khách | Web bắt đăng nhập Zalo mới cho thêm giỏ (`gio-hang/page.tsx:85`), không có định kỳ; đã biết một phần (A1-014) | Giỏ cho khách vãng lai trên web; nút "Mở trong Zalo" nổi bật | M | N |
| D2-15 | P1 (việc ngoài repo) | marketing | `hello.tubutree.com` không có mini-app/website, 6 link Shopee nổi bật (mục 2) | Đưa mini-app lên đầu, kèm ưu đãi khách mới và `?src=linkbio` | S | N |
| D2-16 | P3 | marketing | Hoàn tiền sàn ngoài có seed Shopee/Lazada (`seed.ts:848-849`), đang tắt (`apps/miniapp/src/utils/features.ts:10`); đã biết (Q-15, A1-026) | Giữ tắt: bật lên là đẩy khách ngược về sàn | — | N |
| D2-17 | P3 | khách | ZaloPay ẩn (`checkout.tsx:363-364`) dù đã có `zalopay.service.ts` | Giữ ẩn tới khi có tài khoản merchant; COD đủ cho đợt đầu | — | N |

## 7. Đề xuất tính năng mới (xếp theo tác động lên tỷ lệ khách sàn mua trực tiếp)

1. **Bộ khởi động "Khách từ sàn" (D2-01, D2-07, D2-08, D2-15). Công sức S. Mục tiêu 1.**
   - QR và link mang `src`.
   - Voucher chào mừng cấp ngay khi tạo tài khoản.
   - Freeship đơn đầu.
   - Khối "Quà khách mới" đầu Trang chủ.
   - Dòng điểm sẽ nhận ở PDP.
   - Mini-app lên đầu link bio.

   Lý do xếp đầu: không có nó thì mọi đòn bẩy khác vô hình và không đo được.
2. **Mã kích hoạt từ thẻ trong hộp hàng (D2-03). Công sức M. Mục tiêu 1.**
   - Mã ẩn, chỉ khách mới dùng được, nhận qua QR `?claim=`.
   - MVP: một mã cho mỗi sàn. Bản sau: lô mã duy nhất xuất CSV.

   Lý do: đây là kênh rẻ nhất chạm đúng khách đã mua và dùng thử sản phẩm.
3. **Báo cáo nguồn → đơn đầu → đơn 2 (D2-02). Công sức M. Mục tiêu 1 và 5.**
   - Marketing tự xem được hiệu quả từng đợt thẻ, không phải xuất dữ liệu ra ngoài.
4. **Kênh nhắn chủ động: ZNS hậu mãi, sau đó tin OA (D2-05, D2-06). Công sức M. Mục tiêu 1 và 3.**
   - Đưa nhắc mua lại, voucher đơn 2 và winback tới khách không mở app.
5. **Ghép đơn sàn → Điểm Xanh / thành viên (D2-04). Công sức S→L. Mục tiêu 1.**
   - Bắt đầu bằng việc CSKH nhập qua chức năng tích điểm tại quầy, để khách sàn có "số dư" kéo về app.
6. **Giới thiệu hai chiều và hạng đầu trong tầm với (D2-10, D2-09). Công sức S–M. Mục tiêu 1 và 3.**
7. **Chu kỳ mua lại theo SP và combo kênh trực tiếp (D2-11, D2-13). Công sức M. Mục tiêu 1.**
8. **Bằng chứng xã hội từ sàn (D2-12). Công sức S. Mục tiêu 1.**

## 8. Chiến lược kéo khách sàn

**Nguyên tắc:** không đánh nhau về giá niêm yết với sàn. Bán lời hứa "mua trực tiếp ở Tubu được nhiều hơn", gồm 4 điểm có thật trong mã:
1. Quà đơn đầu và freeship.
2. Hoàn khoảng 10% bằng Điểm Xanh mỗi đơn.
3. Đặt định kỳ giảm 12–15% và nhắc khi sắp hết hàng.
4. Tư vấn trực tiếp qua Zalo, cộng với cộng đồng.

Câu chữ cần thống nhất một nơi và lặp lại ở thẻ, link bio, Trang chủ và PDP.

**Điểm chạm, theo thứ tự chi phí thấp dần:**
1. **Thẻ trong hộp hàng sàn.**
   - Lời: "Kích hoạt thành viên Tubu Tree, nhận quà và tích điểm". Không ghi "rẻ hơn sàn".
   - Lưu ý: chính sách sàn cấm lôi kéo giao dịch ra ngoài sàn. Chủ dự án cần kiểm điều khoản hiện hành của Shopee, Lazada và TikTok Shop trước khi in. Đây là rủi ro bị phạt điểm shop.
2. **Zalo OA:** lời chào kèm link mini-app có `src=oa`; thưởng khi theo dõi (D2-06).
3. **Link bio `hello.tubutree.com`:** mini-app đứng đầu.
4. **CTV:** đã có gian hàng, link `?ref=` và hoa hồng.

**Phễu cần đo (sau D2-01 và D2-02):**
- Quét thẻ / số đơn sàn đã gửi.
- Quét → đơn đầu trực tiếp trong 30 ngày.
- Đơn đầu → đơn 2 trong 30 ngày (NS-1) theo nguồn.
- Chi phí quà trên mỗi khách chuyển.

Ngưỡng chấp nhận: chi phí mỗi khách chuyển ≤ (phí sàn tiết kiệm mỗi đơn × số đơn trực tiếp kỳ vọng trong 6 tháng). Phí sàn thật (hoa hồng, thanh toán, gói Freeship/Voucher Xtra) chủ dự án cần lấy từ hoá đơn sàn. Báo cáo này không có số đó.

**Lộ trình:**
- **Trước ra mắt (khoảng 1–2 tuần, toàn S):**
  - D2-01: ghi nguồn khách.
  - D2-07: voucher ngay khi tạo tài khoản, khối khách mới, điểm ở PDP.
  - D2-08: freeship đơn đầu.
  - D2-15: link bio.
  - D2-03 bản tối giản: một mã ẩn cho mỗi sàn, dùng tạm mã PUBLIC loại FREESHIP giới hạn 1 lượt/người nếu chưa kịp làm scope ẩn. Chấp nhận việc mã hiện trong ví của mọi người.
- **Tháng 1:** D2-02 báo cáo nguồn, D2-05 ZNS hậu mãi, D2-04 bước 1 (CSKH ghép đơn sàn), D2-10 giới thiệu hai chiều.
- **Tháng 2–3:** D2-03 lô mã duy nhất, D2-04 bước 2–3, D2-11 chu kỳ theo SP, D2-13 combo, D2-06 tin OA.

**Ngân sách:** chỉ gồm các hạng mục do chủ dự án quyết (giá trị quà mỗi khách mới, chi phí ship đơn đầu, ZNS mỗi tin, chi phí in thẻ). Mọi tham số tiền đã là SystemConfig nên chỉnh được không cần deploy (`voucher.welcome_*`, `shipping.*`, `referral.*`, `loyalty.*`).

## 9. Câu hỏi cho chủ dự án

Chỉ gồm câu hỏi đổi được quyết định. Mỗi câu kèm phương án mặc định tôi khuyên.

1. **Thẻ trong hộp hàng sàn:** có chấp nhận rủi ro chính sách sàn không, sau khi đã kiểm điều khoản?
   Mặc định: in thẻ với lời "kích hoạt thành viên + quà", không nhắc giá, không nhắc "mua ngoài sàn".
2. **Ưu đãi đơn đầu cho khách từ sàn hoặc thẻ:** mức nào?
   Mặc định: freeship đơn đầu không ngưỡng + giữ voucher 30k cho đơn ≥199k, hạn 30 ngày, chỉ tài khoản Zalo thật.
3. **Mã thẻ:** mã chung theo sàn hay mã duy nhất mỗi thẻ?
   Mặc định: mã chung theo sàn cho đợt ra mắt (S); chuyển sang mã duy nhất khi số thẻ/tháng lớn hoặc thấy lộ mã.
4. **Đơn sàn có được tích Điểm Xanh hay tính hạng không?**
   Mặc định: tích điểm một lần khi ghép đơn đầu (thưởng kích hoạt), không tính vào hạng.
5. **Ngân sách ZNS/tháng cho tin hậu mãi?**
   Mặc định: 3 mẫu (nhắc mua lại, voucher đơn 2, winback), tối đa 2 tin/khách/tháng.
6. **Thang hạng:** có thêm quyền lợi ngay sau đơn trực tiếp đầu, hoặc hạ ngưỡng Lộc Biếc không?
   Mặc định: hạ Lộc Biếc xuống 1,5 triệu/12 tháng.
7. **Giá kênh trực tiếp:** có chấp nhận combo hoặc giá thấp hơn sàn không?
   Mặc định: giữ giá niêm yết bằng sàn, tạo khác biệt bằng điểm, định kỳ và combo riêng.
8. **(Câu hỏi về sự thật):** shop Shopee/Lazada/TikTok có nối vào cùng shop Pancake không?
   Nếu có, D2-04 bước 3 làm được bằng tra cứu Pancake.

## Phạm vi đã kiểm / chưa kiểm

- **Đã kiểm (đọc mã):**
  - API: `vouchers`, `coupons`, `loyalty`, `lifecycle`, `notifications`, `subscriptions` (một phần), `affiliate` (một phần), `cashback`, `analytics`, `integrations/{pancake,zalo-oa}` (một phần), `auth`, `checkout`, `pricing`.
  - Seed SystemConfig và mẫu thông báo.
  - Miniapp: `app.tsx`, Trang chủ, PDP, giỏ, checkout, chi tiết đơn, Ví.
  - Web: trang chủ, đăng nhập, giỏ, storefront tracker.
- **Chưa kiểm:**
  - Giá trị SystemConfig thật trên PROD (chưa deploy).
  - Pancake có đơn sàn không.
  - Chính sách sàn về thẻ trong hộp hàng và chính sách mẫu ZNS hiện hành.
  - Giá thực tế trên sàn so với giá trong app.
  - Phí sàn thật.
  - Chưa chạy app hay test nào (theo luật brief).
