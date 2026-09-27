# Audit toàn diện Tubu Tree — tổng hợp (dự án con 1)

> Tổng hợp từ 7 báo cáo audit (`01`–`07` trong thư mục này) + một đợt xác minh trực quan trực tiếp (ảnh chụp thật, không phải suy đoán) chạy sau khi 7 báo cáo đã viết xong. Tài liệu này được viết để chủ shop **không cần đọc cả 3.308 dòng của 7 báo cáo gốc** mà vẫn quyết định được việc cần làm trước dự án con 2–8. Mọi số liệu trong tài liệu này đều truy được về báo cáo gốc (ghi rõ báo cáo nào) hoặc về bằng chứng tôi tự kiểm chứng (ghi rõ lệnh/ảnh).

---

## Kết luận điều hành

Tubu Tree có gần đủ mọi cơ chế giữ chân mà một sàn hàng tiêu dùng cần — 38 cơ chế thưởng/hạng/game/CTV/đại lý đã liệt kê ở báo cáo 03 — nhưng phần quyết định north-star (tỉ lệ khách có đơn thứ 2 trong 30 ngày) lại đứt ở đúng các mắt xích quan trọng nhất: không có kênh nào chạm khách ngoài app (ZNS/OA chưa cấu hình xong), lời nhắc mua lại tự động duy nhất (`REORDER_REMINDER`) là ngõ cụt không nút bấm và dùng một chu kỳ chung ~51 ngày cho mọi sản phẩm — trễ hơn chính cửa sổ 30 ngày cần đo — còn cron gửi lời nhắc đó sẽ **tự tắt vĩnh viễn** khi tệp khách vượt 500 cặp đã nhắc. Không có kệ "Mua lại" ở bất kỳ đâu trong app hay web; "Dành cho bạn" thậm chí chủ động loại các sản phẩm khách đã mua. Song song đó, 22 lỗi P0 (đã gộp trùng lặp giữa các báo cáo) đe doạ trực tiếp tiền và lòng tin: thanh toán chuyển khoản qua gian hàng CTV chảy vào tài khoản cá nhân CTV thay vì Tubu (bị 3 báo cáo độc lập phát hiện cùng một lỗi), sản phẩm đối tác chưa qua duyệt vẫn bán được, CTV tự đánh dấu đơn "đã giao" để nhận hoa hồng giả, web cho chọn chuyển khoản nhưng không bao giờ hiện mã QR, và duyệt hoàn tiền đơn COD trong admin không thực sự trả lại tiền cho khách. Hiện chưa có analytics hành vi nào đang chạy, và ngay cả khi dựng xong, 5 lỗ hổng định danh dữ liệu (đơn CTV "lên hộ" bị tính nhầm thành một khách siêu trung thành, tài khoản khách vãng lai và tài khoản Zalo không bao giờ gộp...) sẽ làm sai mọi con số north-star nếu không sửa trước. Về thị giác, giao diện vẫn dùng cam/lime kiểu "chợ xanh vui tươi", chưa theo hướng "premium natural green" chủ shop muốn; 137 nút hiện màu xanh Zalo mặc định vì chưa theme ZaUI, và một bộ token/component thiết kế đã dựng sẵn nhưng gần như 0% được dùng. Tổng thể: sản phẩm đủ tính năng để bán đơn đầu, nhưng gần như không có hạ tầng chủ động để tạo ra đơn thứ hai — đây phải là trọng tâm xuyên suốt các dự án con 2–8.

---

## Con số

### Đối chiếu tự-báo-cáo và đếm lại

Phương pháp đếm lại: với mỗi báo cáo, lấy toàn bộ dòng bảng "Phát hiện" có ID đúng định dạng của báo cáo đó (`A<n>-<số>`), đọc cột "Mức", rồi lấy **ký hiệu P0/P1/P2 xuất hiện đầu tiên** trong ô đó (xử lý đúng các ô có ghi chú kèm theo như `P0 (có điều kiện)` hay `P1 (thành **P0** nếu bật proxy Cloudflare)` — trường hợp sau được tính là P1, đúng như cách 07 tự cộng tổng). Lệnh dùng `awk` trên chính 7 file `.md`, chạy trực tiếp trong phiên này.

| Báo cáo | Tự báo cáo (P0/P1/P2) | Đếm lại (P0/P1/P2) | Ghi chú |
|---|---|---|---|
| 01-ia-navigation | 3 / 23 / 15 | 3 / 23 / 15 | Khớp tuyệt đối. |
| 02-purchase-funnel | 3 / 28 / 26 | 3 / 28 / 26 | Khớp tuyệt đối. Tổng chỉ được công bố trong đoạn "Kết luận" ở đầu bài, không có dòng "Tổng:" riêng cạnh bảng như 4 báo cáo khác. |
| 03-retention-loops | 5 / 26 / 16 | 5 / 26 / 16 | Khớp tuyệt đối. |
| 04-design-system | 0 / 6 / 23 | 0 / 6 / 23 | Khớp tuyệt đối. |
| 05-ctv-dealer-staff | **Không công bố dòng tổng.** Đoạn mở đầu chỉ nói "sửa 11 lỗi P0 trước khi tuyển thêm CTV". | 11 / 25 / 18 | Con số P0 tôi đếm lại (11) khớp đúng con số nêu trong lời văn — nhưng báo cáo **không hề công bố** tổng P1/P2/tổng số phát hiện ở bất kỳ đâu, dù chính Phụ lục của báo cáo này có 3 dòng lệnh đếm ghi chú "xem tổng kết" mà kết quả chưa từng được điền vào bài. Đây là khoảng trống tài liệu duy nhất tôi thấy, không phải sai số. |
| 06-web | 7 / 30 / 14 | 7 / 30 / 14 | Khớp tuyệt đối. |
| 07-tech-analytics | 1 / 9 / 14 | 1 / 9 / 14 | Khớp tuyệt đối. |

**Không có báo cáo nào lệch quá 1–2 dòng so với đếm lại của tôi** — bất ngờ so với kỳ vọng ban đầu của việc "đếm lại để bắt sai số", nhưng đây là tín hiệu tốt: cả 7 báo cáo đều tự đếm chính xác theo đúng cú pháp bảng của chính chúng. Khoảng trống duy nhất là báo cáo 05 không tổng hợp con số cuối, dù dữ liệu để tổng hợp đã có sẵn.

### Tổng số phát hiện gốc và sau khi gộp trùng

- **Tổng số dòng phát hiện gốc (7 báo cáo cộng lại): 303** (41 + 57 + 47 + 29 + 54 + 51 + 24).
- **13 cụm trùng lặp** được xác nhận bằng cách đọc kỹ và đối chiếu `file:line` (không chỉ khớp từ khoá) — xem bảng "13 cụm đã gộp" ngay dưới.
- Sau khi gộp (mỗi cụm còn lại 1 dòng, giữ mức độ cao nhất trong cụm nếu các báo cáo chấm điểm khác nhau): **303 → 286 phát hiện DUY NHẤT** (giảm 17 dòng).
- Phân bổ theo mức độ sau gộp: **P0 = 22 · P1 = 139 · P2 = 125** (22 + 139 + 125 = 286).

### 13 cụm trùng lặp đã gộp

| # | ID gốc (đã gộp) | Mức (sau gộp) | Chủ đề chung | Bằng chứng dùng chung |
|---|---|---|---|---|
| 1 | A2-01 = A5-02 = A6-03 | P0 | CTV tự khai STK → tiền chuyển khoản của khách vào TK cá nhân CTV thay vì Tubu | `bank-transfer.service.ts:7-9,38-51`; `storefront.service.ts:103-141`/`241-249` |
| 2 | A2-03 = A5-06 = A6-04 | P0 | SP đối tác/merchant chưa duyệt (`PENDING_REVIEW`) vẫn `isActive:true` nên hiện và bán được | `merchant.service.ts:238-240`; `catalog.service.ts:56,88-103` |
| 3 | A2-02 = A6-01 | P0 | Web chọn chuyển khoản nhưng không bao giờ hiện QR/STK; đơn kẹt vĩnh viễn | `web/app/thanh-toan/page.tsx:127-153,185-193` |
| 4 | A5-03 = A6-02 | P0 | CTV/merchant tự chuyển trạng thái đơn sang DELIVERED trên web `/merchant` ("giao ảo") | `merchant.controller.ts:178-181`; `merchant.service.ts:375-400,429-458` |
| 5 | A5-04 = A6-36 | P0 (A5 chấm P0, A6 chấm P1 — lấy mức cao hơn) | `GET /merchant/orders` lộ đầy đủ tên/SĐT/địa chỉ khách cho CTV | `merchant.service.ts:404-427` |
| 6 | A1-01 = A2-06 = A3-02 | P0 (A2-06 tự chấm P1 — lấy mức cao hơn) | `REORDER_REMINDER` là ngõ cụt: không CTA, thiếu slug, chu kỳ chung sai | `lifecycle.service.ts:44-46,103` |
| 7 | A2-07 = A3-03 = A6-31 | P0 (A3-03 chấm P0; A2-07/A6-31 chấm P1 — lấy mức cao hơn) | Cron nhắc mua lại `LIMIT 500` không `ORDER BY` → tự dừng vĩnh viễn khi vượt 500 cặp đã nhắc | `lifecycle.service.ts:49-59,68` |
| 8 | A5-08 = A6-05 | P0 | Lệnh rút tiền (hoa hồng CTV / Ví) tạo `Payout REQUESTED` nhưng không có quy trình xử lý nào | `affiliate.service.ts:639-653,670`; `wallet.service.ts:170-184` |
| 9 | A3-07 = A6-30 | P1 | Một chu kỳ nhắc mua lại toàn cục ~51 ngày cho mọi SKU (liên quan chặt tới cụm #6) | `lifecycle.service.ts:44-46` |
| 10 | A4-06 = A5-40 | P1 (A4 chấm P1, A5 chấm P2 — lấy mức cao hơn) | Gian hàng CTV/trang nhãn tự vẽ lại thẻ SP, thiếu giá flash & trạng thái hết hàng | `storefront-view.tsx:69-100`; `brand-view.tsx:209-231`; `product-card.tsx:30-42` |
| 11 | A5-27 = A7-10 (một phần) | P1 | Đơn "lên đơn hộ" ghi `userId` = CTV làm sai lệch mọi số liệu đo lường mua lặp | `affiliate.service.ts:298-316` |
| 12 | A5-21 = A6-15 | P1 | Domain `shop.` (mặc định code) vs `app.` (hạ tầng thật) + middleware rewrite làm hỏng cả link CTV lẫn SEO canonical | `web/lib/site.ts:7`; `web/middleware.ts:19-46` |
| 13 | A6-13 = A7-02 | P1 (A7-02 tự ghi "có thể thành P0 nếu bật Cloudflare") | Throttle đăng nhập theo IP (không theo thiết bị) làm mất phiên hàng loạt ở IP dùng chung (Wi-Fi cửa hàng, CGNAT) | `app.module.ts:57`; `auth.controller.ts:92-93` |

Một cụm được **gợi ý trong đề bài nhưng xác minh lại KHÔNG tồn tại**: *"refund-not-processed-on-COD-return xuất hiện ở 06 và có thể cả báo cáo khác"*. Tôi đã đọc toàn văn 07 và grep `reverseFinancials`/`COD…hoàn` trên cả 7 file: phát hiện này (A6-06) **chỉ có ở báo cáo 06**, không lặp lại ở nơi khác. Câu 07 nhắc tới "COD → PAID khi DELIVERED" chỉ là một dòng trong đề xuất *thiết kế sự kiện analytics tương lai*, không phải một phát hiện lỗi hiện tại — không tính là trùng lặp.

---

## P0 — phải sửa trước khi làm bất cứ việc gì khác (tất cả, đã gộp trùng)

22 phát hiện duy nhất, mức P0, sau khi gộp 8 cụm trùng lặp có chứa ít nhất một mã P0 (xem bảng cụm ở trên).

| ID(s) | Mô tả (1 dòng) | file:line trọng yếu | Báo cáo có chi tiết đầy đủ | Tác động tiền/dữ liệu/niềm tin |
|---|---|---|---|---|
| A2-01 = A5-02 = A6-03 | Đơn chuyển khoản gắn `storefrontSlug` của CTV sinh QR/STK vào **tài khoản ngân hàng CTV tự khai** thay vì Tubu; đối soát Pancake không bao giờ khớp nên đơn kẹt "Chờ thanh toán" dù khách đã trả tiền | `bank-transfer.service.ts:7-9,38-51` | 02, 05, 06 | Tiền: khách mất tiền, đơn không lên PAID. Đây là lỗi bị 3 báo cáo độc lập phát hiện cùng lúc — mức độ nghiêm trọng cao nhất toàn bộ audit |
| A2-03 = A5-06 = A6-04 | SP đối tác/merchant tạo với `approvalStatus:'PENDING_REVIEW'` nhưng `isActive:true`; mọi truy vấn catalog công khai chỉ lọc `isActive` nên SP **chưa duyệt hoặc đã bị từ chối** vẫn hiện & mua được | `merchant.service.ts:238-240`; `catalog.service.ts:56,88-103` | 02, 05, 06 | Dữ liệu/niềm tin: phá lời hứa "chuẩn xanh đã kiểm định" |
| A2-02 = A6-01 | Web `/thanh-toan` cho chọn "Chuyển khoản ngân hàng" nhưng sau khi đặt **không hiện QR/STK/nội dung CK** ở bất kỳ đâu; đơn giữ `PENDING_PAYMENT` vô thời hạn (không có cron huỷ) | `web/app/thanh-toan/page.tsx:127-153,185-193` | 02, 06 | Tiền: khách web không có cách nào trả được tiền cho đơn đã đặt — chặn đơn đầu hoàn toàn trên web |
| A5-03 = A6-02 | CTV/đại lý tự bấm chuyển đơn "Đã đóng gói→Đang giao→Đã giao" (cả CANCELLED/RETURNED) cho **mọi** đơn gắn gian hàng của mình trên web `/merchant`, kể cả đơn do kho Tubu giao; hệ thống khoá hoa hồng/cộng điểm/báo khách "đã giao" dù hàng chưa giao | `merchant.controller.ts:178-181`; `merchant.service.ts:375-400,429-458` | 05, 06 | Dữ liệu/tiền: "giao ảo" tạo hoa hồng giả, làm sai mọi số liệu mua lặp |
| A5-04 = A6-36 | `GET /merchant/orders` trả về & hiển thị họ tên, SĐT, **địa chỉ giao hàng đầy đủ** của mọi khách mua qua gian hàng CTV — kể cả khách chỉ "chạm" link 3 ngày mà không biết mình đang mua qua CTV | `merchant.service.ts:404-427` | 05, 06 | Dữ liệu cá nhân: rủi ro pháp lý + niềm tin |
| A1-01 = A2-06 = A3-02 | `REORDER_REMINDER` — đòn bẩy mua lại tự động DUY NHẤT đang chạy — là ngõ cụt: payload chỉ có tên SP (không slug/variationId) nên không nhánh CTA nào khớp, không nút bấm; chu kỳ tính `60 ngày × 0,85 ≈ 51 ngày` áp DÙNG CHUNG cho mọi SKU, trễ hơn cửa sổ 30 ngày cần đo | `lifecycle.service.ts:44-46,103` | 01, 02, 03 | North-star trực tiếp: cơ chế được thiết kế để tạo đơn 2 nhưng chuyển đổi ≈ 0% |
| A2-07 = A3-03 = A6-31 | SQL cron nhắc mua lại `LIMIT 500` không `ORDER BY`, không loại cặp (khách×SKU) đã nhắc; khi số cặp quá hạn vượt 500, lô 500 lấy ra có thể toàn cặp cũ → cron `continue` qua hết → **không khách mới nào được nhắc nữa**, không lỗi, không log (cùng lớp lỗi đã từng xảy ra và đã sửa ở voucher chào mừng) | `lifecycle.service.ts:49-59,68` | 02, 03, 06 | North-star: cơ chế nhắc mua lại tự tắt đúng lúc tệp khách đủ lớn để cần nó nhất |
| A5-08 = A6-05 | Lệnh rút tiền (hoa hồng CTV hoặc Ví) tạo `Payout REQUESTED` và đánh dấu "Đã trả" NGAY LẬP TỨC, nhưng **không có endpoint hay màn admin nào** để xem/duyệt/chuyển/từ chối Payout | `affiliate.service.ts:639-653,670`; `wallet.service.ts:170-184` | 05, 06 | Tiền/niềm tin: tiền "biến mất" khỏi hệ thống theo dõi, CTV không nhận được |
| A1-02 | Thẻ nhiệm vụ Vườn Xanh hiện "+20đ/+30đ/+50đ" và dấu ✓ khi đạt điều kiện, nhưng **không có dòng code nào cộng thưởng** (`MissionProgress` không được ghi, không có nút "Nhận") | `game.tsx:943-991`; `game.service.ts:395-433` | 01 | Niềm tin: hứa mà không trả; đây lẽ ra là nhiệm vụ duy nhất gắn với "đơn thứ 2" |
| A1-03 | Nút "Gửi yêu cầu xoá tài khoản" chỉ hiện snackbar giả, không gọi API nào; BE không có endpoint xoá tài khoản dù chính sách bảo mật hứa xoá được | `about.tsx:216-221`; 0 kết quả grep endpoint xoá tài khoản | 01 | Pháp lý/dữ liệu cá nhân: rủi ro tuân thủ luật bảo vệ dữ liệu cá nhân |
| A3-01 | **Không có kênh thông báo nào chạm khách ngoài app**: cả 39 mẫu chỉ ghi in-app; 2 mẫu "ZNS" trong seed không có `zaloTemplateId` và không có UI để đặt; miniapp không gọi `followOA`/`requestSendNotification` dù SDK có sẵn | `notifications.service.ts:52-59`; `seed.ts:627-628` | 03 (01/02 nhắc lại) | North-star: mọi cơ chế nhắc mua lại chỉ chạm được người đã tự mở app |
| A3-04 | Voucher sinh nhật cấp qua khoá idempotency `BIRTHDAY-<năm>-<tháng>`+userId; sửa ngày sinh sang "ngày mai" mỗi tháng = voucher 50.000đ/tháng không giới hạn (tối đa 600k/năm/tài khoản), không cần đơn thật | `users.service.ts:18-35`; `vouchers.service.ts:139-149` | 03 | Tiền: rò ngân sách khuyến mãi, không tạo đơn thật |
| A3-05 | Quyền lợi hạng thành viên hiển thị cho khách (VD "Cổ Thụ: freeship + giảm 5% mọi đơn") nhưng **không được thực thi trong code tính giá**; mọi hạng nhận voucher sinh nhật 50k như nhau dù seed hứa 150k/300k | `pricing.service.ts:21-73`; `seed.ts:245,255,264-265` | 03 | Niềm tin: đúng nhóm khách chi tiêu nhiều nhất (khả năng mua lặp cao nhất) bị hứa suông |
| A5-01 | Mua qua gian hàng CTV **mở trong Zalo** không bao giờ ghi hoa hồng: slug gian hàng dùng làm `referralCode` bị hạ chữ thường, trong khi BE tra khớp CHÍNH XÁC (mã gốc lưu chữ hoa) → referrer luôn null | `storefront.service.ts:52`; `auth.service.ts:317` | 05 | Tiền/niềm tin: CTV bán hàng nhưng không được trả công → ngừng chia sẻ, mất kênh khách mới lẫn khách quay lại |
| A5-05 | `GET /merchant/products` trả nguyên `variations: true` gồm `dealerPrices` (giá sỉ mọi bậc đại lý), `affiliateRate`, tồn kho thật — đăng ký CTV chỉ 1 chạm nên **bất kỳ ai cũng đọc được bảng giá sỉ nội bộ** | `merchant.service.ts:300-306` | 05 | Dữ liệu/tiền: lộ biên lợi nhuận, phá giá kênh đại lý |
| A5-07 | Rút hoa hồng CTV về Ví được nhân hệ số **×1,5** (1 triệu hoa hồng → 1,497 triệu tiền mặt rút được), không ràng buộc nguồn tiền — về bản chất là in tiền | `affiliate.service.ts:527,579-606`; `seed.ts:38` | 05 | Tiền: lỗ hổng tài chính trực tiếp, có thể bị khai thác quy mô lớn |
| A5-09 | Đại lý tự bấm "Báo đã CK" xoá ngay một dòng nợ trong sổ công nợ, **không có bước xác nhận ngân hàng thật**, API không chặn số tiền lớn hơn dư nợ | `dealer.service.ts:305-357`; `dealer.tsx:722-733` | 05 | Tiền: bảo vệ vốn của shop |
| A5-10 | DTO đăng ký đại lý bắt ảnh CCCD là URL, nhưng component upload fallback sang base64 khi thiếu cấu hình Cloudinary (biến này không tồn tại ở bất kỳ `.env` nào trong repo) → validator chặn base64 dài → **có thể không ai đăng ký đại lý được** (lỗi 400 tiếng Anh) | `dealer.dto.ts:24-25`; `image-upload.tsx:6-8,57-58` | 05 | Vận hành: cần xác nhận cấu hình build thật trên Zalo (UNKNOWN) — nếu đúng, kênh tuyển đại lý mới đang tắc hoàn toàn |
| A5-11 | "Hoa hồng tháng này/Hôm nay" trên dashboard CTV cộng cả commission đã REJECTED (đơn huỷ/trả) — số lớn nhất màn hình không bao giờ giảm khi đơn bị huỷ | `affiliate.service.ts:139-141,788-794` | 05 | Niềm tin: CTV thấy số tiền ảo, mất niềm tin khi đối chiếu thực nhận |
| A6-06 | Nút "Duyệt hoàn tiền" trong admin **không thực sự hoàn tiền cho đơn COD** (`reverseFinancials` chỉ hoàn khi `paymentStatus=PAID`, nhưng không có luồng nào lật COD sang PAID); khách vẫn nhận thông báo "đã hoàn tiền" | `order-reversal.service.ts:50-68`; `admin.service.ts:150,417-419` | 06 | Tiền/niềm tin: khách trả hàng mà mất tiền gần như chắc chắn không mua lại |
| A6-07 | Tab "Duyệt SP đối tác" trong web admin **crash hoàn toàn** (API trả `{data,meta}` nhưng FE khai kiểu mảng rồi gọi `.map` trực tiếp) | `admin-client.ts:607-608`; `admin/page.tsx:2669-2693` | 06 | Vận hành: khoá luôn quy trình duyệt SP hợp pháp — càng khó vá A2-03/A5-06/A6-04 |
| A7-01 | Phiên khách (guest) bị **âm thầm đổi sang một tài khoản Zalo khác** ngay lúc khách bấm "Đặt hàng" và xin SĐT (`ensurePhone` đăng nhập lại, nhận token của user khác); giỏ/địa chỉ vẫn thuộc user khách cũ nên BE báo "Địa chỉ giao hàng không hợp lệ" | `store/auth.ts:166-177`; `api/auth/auth.service.ts:30-36,72-99` | 07 | Tiền/dữ liệu: mất đơn đúng lúc ý định mua cao nhất; danh tính tách đôi khiến "đơn 2 trong 30 ngày" bị đếm THẤP hơn thực tế |

---

## Top 15 theo tác động north-star (không chỉ P0)

Xếp theo mức độ ảnh hưởng trực tiếp tới **tỉ lệ khách có đơn 2 trong 30 ngày** và **đơn/khách/tháng** — không phải "cải thiện UX chung chung".

| # | Phát hiện | Vì sao ảnh hưởng trực tiếp tới mua lại |
|---|---|---|
| 1 | A1-08 = A3-01 — Không kênh nào chạm khách ngoài app (ZNS/OA chưa cấu hình) | Là điều kiện tiên quyết của MỌI mục còn lại trong danh sách này: không có kênh thì không lời nhắc nào tới được người chưa tự mở app |
| 2 | A1-01 = A2-06 = A3-02 (+A3-07/A6-30) — `REORDER_REMINDER` ngõ cụt + chu kỳ chung ~51 ngày sai cho mọi SKU | Đây là cơ chế DUY NHẤT được thiết kế để tạo đơn 2 theo đúng hành vi hàng tiêu dùng, nhưng hiện chuyển đổi ≈ 0% và bắn trễ hơn cửa sổ 30 ngày |
| 3 | A1-04 = A2-04 = A3-08 — Không có kệ "Mua lại" ở Home/Cá nhân; "Dành cho bạn" chủ động loại SP đã mua | Đây là thay đổi UI đơn giản nhất có tác động north-star lớn nhất (Amazon "Buy it again" tăng CTR ~7% theo dẫn chứng của báo cáo 01) |
| 4 | A2-07 = A3-03 = A6-31 — Cron nhắc mua lại tự dừng vĩnh viễn khi vượt 500 cặp đã nhắc | Cơ chế retention duy nhất sẽ tắt lịm đúng lúc số khách đủ lớn để cần nó nhất, không cảnh báo |
| 5 | A2-01 = A5-02 = A6-03 — CTV tự khai STK chặn dòng tiền chuyển khoản | Khách bị mất tiền hoặc đơn kẹt vĩnh viễn ngay ở đơn đầu (hoặc đơn lặp qua CTV) — không có niềm tin thì không có đơn 2 |
| 6 | A1-40 = A2-05 — "Mua lại đơn này" tốn 6 chạm, đổ hết giỏ (không chỉ dòng vừa thêm), âm thầm bỏ SP hết hàng | Cơ chế mua lại thủ công DUY NHẤT đang chạy đủ vụng về để khách bỏ ngang giữa chừng |
| 7 | A2-10 = A3-09 = A3-10 — Đặt định kỳ không giao đơn đầu ngay (chờ 4–10 tuần), chỉ COD, không nhắc trước | Đòn bẩy lý thuyết mạnh nhất cho đơn lặp tự động (Subscribe & Save) đang bị chính thiết kế làm hỏng |
| 8 | A2-03 = A5-06 = A6-04 — SP đối tác/merchant chưa duyệt vẫn bán được | Phá lời hứa "chuẩn xanh đã kiểm định" là nền tảng lòng tin để khách quay lại mua thêm |
| 9 | A3-29 = A6-28 = A7-10 — Không có analytics hành vi + 5 lỗ hổng định danh sẽ làm sai north-star nếu back-fill thô | Không đo được thì không sửa được gì trong 4 mục trên một cách có cơ sở — chặn toàn bộ dự án con 2–8 |
| 10 | A1-14 = A3-18 = A3-19 — ≥12 loại số dư/tiền tệ chồng chéo, Xu phải trả đủ 100% đơn (không trừ một phần) | Quá tải nhận thức làm khách không dùng hết phần thưởng đã tích — thưởng không quy đổi được thành lý do quay lại |
| 11 | A3-05 — Quyền lợi hạng hiển thị nhưng không thực thi | Đúng nhóm khách hạng cao (khả năng mua lặp cao nhất) đang bị hứa suông, giảm động lực giữ hạng bằng cách mua thêm |
| 12 | A3-14 = A3-18 — Game/streak thưởng việc mở app chứ không thưởng việc mua; xu thưởng quá nhỏ để trả đơn | Cơ chế thói quen hằng ngày (điểm danh, tưới cây) tồn tại nhưng chưa từng chuyển hoá thành một giao dịch |
| 13 | A5-12 = A5-13 — CTV mất công sau 3 ngày, không có sổ khách, không có nút "nhắc mua lại" | CTV lẽ ra là kênh con người duy nhất biết khách dùng gì và khi nào hết hàng — hiện chỉ phục vụ đơn đầu |
| 14 | A1-23 = A2-11 = A3-06 = A3-23 — Màn đặt hàng thành công không mời đánh giá/định kỳ; không ưu đãi nào cho "đơn 2 trong 30 ngày" | Đúng lúc khách hài lòng nhất (vừa thanh toán xong) lại là lúc không có cầu nối nào sang đơn kế tiếp |
| 15 | A6-08 = A6-10 — Web không có trang danh sách/tìm kiếm sản phẩm và không có "Mua lại" ở đâu cả | Một kênh nguyên vẹn (web) hiện không có khả năng tạo ra đơn thứ hai |

---

## Bản đồ vòng giữ chân hiện tại (rút gọn từ 03) — nêu rõ chỗ đứt

Vòng lý tưởng: **1. Thu hút → 2. Kích hoạt → 3. Đơn đầu → 4. Thưởng → 5. Tái kích hoạt → 6. Mua lại → (quay lại 3)**, song song với vòng game (điểm danh/tưới cây). Báo cáo 03 có sơ đồ Mermaid đầy đủ; dưới đây là 5 chỗ đứt chính (ký hiệu ĐỨT 1–5 giữ nguyên từ báo cáo gốc để tiện tra cứu) cộng 3 chỗ đứt phụ:

| Chỗ đứt | Mô tả | ID liên quan (đã gộp ở trên nếu có) |
|---|---|---|
| **ĐỨT 1** | Từ ngày 0 tới ngày ~51 (khi lời nhắc mua lại mới bắn), không có voucher/nhịp nào riêng cho **đơn thứ 2**; không mời đánh giá chủ động | A3-06, A3-23 |
| **ĐỨT 2** | Mọi thông báo chỉ nằm trong hộp thư in-app; không ZNS thật, không xin quan tâm OA, không xin quyền thông báo | **A3-01** (P0, xem bảng P0) |
| **ĐỨT 3** | Cron nhắc mua lại tự dừng khi vượt 500 cặp khách×SKU đã nhắc | **A2-07 = A3-03 = A6-31** (P0, cụm #7) |
| **ĐỨT 4** | Ngay cả khi tin được gửi, tin nhắc mua lại/báo giảm giá không có nút — khách phải tự đi tìm lại sản phẩm | **A1-01 = A2-06 = A3-02** (P0, cụm #6), A3-31 |
| **ĐỨT 5** | Vòng game (điểm danh, sương, quiz, tưới cây) thưởng việc **mở app**, không thưởng việc **mua**; xu thưởng nhỏ không tiêu được cho đơn (Xu phải trả đủ 100%) | A3-14, A3-18 |
| Phụ 1 | "Dành cho bạn" loại mọi SP đã mua; không có kệ "Mua lại" ở đâu | A1-04 = A2-04 = A3-08 |
| Phụ 2 | Subscribe & Save không giao đơn đầu ngay, không nhắc trước khi tạo đơn kỳ tới (rủi ro "bom COD") | A2-10 = A3-09 = A3-10 |
| Phụ 3 | Giới thiệu bạn bè chỉ thưởng khi bạn có **cashback sàn ngoài** (Shopee/Lazada/TikTok) được xác nhận — tức đang dạy khách mua ở sàn khác, không có nhánh nào thưởng theo đơn thứ 2 của người được mời | A3-17 |

**Thứ tự sửa đề xuất (từ báo cáo 03, khớp với Top 15 ở trên):** (1) mở kênh ngoài app + orchestrator → (2) engine "sắp hết → mua lại 1 chạm" theo SKU → (3) chương trình "đơn thứ 2 trong 30 ngày" → (4) Subscribe & Save 2.0 → (5) đơn giản hoá tiền tệ (1 tiền tiêu + 1 thước hạng) → (6) gắn game/giới thiệu vào hành vi mua thật.

---

## Đề xuất cho design system v2 (rút gọn từ 04)

**Hiện trạng đo được (không phải cảm tính):** `tokens.css` có 84 biến nhưng 93,7% tham chiếu màu trong code trỏ thẳng bậc primitive (bỏ qua lớp semantic); 7 token spacing có 0 lần dùng; bộ component dùng chung (`Txt/Stack/Row/Card/Btn/Badge/Chip/SectionHeader/StickyActionBar/ListRow`, `Price`) có **0 trang sản phẩm nào import**. Hệ quả nhìn thấy ngay: ZaUI chưa được theme nên 137/255 nút hiện màu xanh Zalo mặc định (gồm cả nút "Thêm vào giỏ" và "Mua lại"); CTA cam hiện tại chỉ đạt tương phản 2,65:1 (chuẩn AA cần 4,5:1); 96/110 nút có `loading` không bao giờ hiện spinner; 9 trang con không có tiêu đề. Không có lỗi P0 ở tầng giao diện (giá do server quyết định).

**Hướng màu:** chuyển màu hành động chính từ cam logo `#E08C1C` sang **xanh rừng trầm `forest-600 #245E3E`** (đạt 7,65:1 trên nền trắng — AAA), giữ cam chỉ cho logo/minh hoạ. Bỏ `--leaf-400` (lime `#95D222`) khỏi mọi UI chức năng — hiện đang tạo cảm giác "chợ xanh vui tươi" thay vì "tiệm thảo mộc cao cấp". Nền chuyển từ trắng tinh sang trung tính ấm (`stone-50 #F6F4EF`). Bỏ toàn bộ 31 gradient trên thẻ nội dung. Bảng màu ứng viên đầy đủ (đã tính tương phản WCAG cho từng cặp) nằm ở mục "Đầu vào cho Design System v2" của báo cáo 04.

**Kiến trúc token 3 lớp** (đề xuất, chưa triển khai):
1. **Primitive** — chỉ nằm trong file token, trang/component không được dùng trực tiếp (`--p-forest-*`, `--p-stone-*`, `--p-clay-*`...).
2. **Semantic** — thứ duy nhất trang/component được tham chiếu (`color.action.primary.bg`, `color.text.tertiary`, `space.stack-md`...).
3. **Component + cầu nối ZaUI** — gán lại toàn bộ biến `--zaui-light-*` (307 biến, hiện 0 biến nào được ghi đè) về token semantic.

**12 component ưu tiên** (xếp theo số trang sẽ được sửa, thứ tự migrate theo north-star): `Button` (40/41 trang) → `Text/Heading` (41/41) → `PageHeader` (41/41, 9 trang hiện không có tiêu đề) → `PriceTag/Money/Points/Xu` (21 trang, hiện có 60 kiểu trình bày giá khác nhau) → `BottomSheet/Dialog` (48 sheet lắp tay ở 23 file) → `Card` (47 thẻ tự vẽ) → `Badge/StatusPill` (34 pill tự vẽ) → `IconButton` (31 vòng icon tự vẽ, 17 thiếu `aria-label`) → `ListRow/KeyValueRow` → `ProductTile` (tác động north-star cao nhất — cần biến thể `action:'rebuy'` cho nút "Mua lại" ngay trên thẻ) → `Chip/SegmentedTabs` → `StickyActionBar`.

**Thứ tự redesign theo trang:** PDP → giỏ → thanh toán → chi tiết/danh sách đơn → home/browse → gian hàng CTV/trang nhãn (gộp thành 1 template `StorePage`) → đặt định kỳ → điểm/ví → game → CTV/đại lý → admin/staff (chỉ cần bậc theme-bridge, không cần cầu kỳ).

---

## Đề xuất kiến trúc thông tin mục tiêu (rút gọn từ 01)

**Vấn đề gốc:** 42 route nhưng chỉ ~15 phục vụ vòng mua cốt lõi; hub Cá nhân có 17–21 mục lẫn lộn; mua lại một đơn cũ tốn 6 chạm; tab thứ 4 dành cho "Ví & HH" trong khi phần lớn khách B2C thấy 3/6 con số luôn là 0đ.

**Tab bar mục tiêu (5 tab, chủ shop quyết định phương án cuối):**

| Vị trí | Tab | Nội dung | Lý do |
|---|---|---|---|
| 1 | Trang chủ | Khách quay lại thấy: **Mua lại** (rail đầu tiên) → Đơn đang giao/kỳ định kỳ kế tiếp → Voucher sắp hết → Giờ vàng → Dành cho bạn (gồm cả SP đã mua) | Mua lại ngay từ màn mở app đầu tiên |
| 2 | Danh mục | Danh mục thật theo `/categories` (không phải 4 phân khúc gõ cứng hiện tại), tìm kiếm có gợi ý + "đã mua gần đây" | Tìm lại hàng tiêu hao nhanh |
| 3 (giữa) | Vườn Xanh | Vườn · Nhiệm vụ hôm nay (gộp 1 điểm danh, quiz, vòng quay, nhiệm vụ "đơn 2") · Mùa · Xếp hạng · Đổi vỏ | Giữ thói quen mở app, gắn dần vào mua hàng |
| 4 | **Đơn hàng** (thay "Ví & HH") | Mua lại (lưới SP đã mua) · Theo trạng thái (có badge) · Định kỳ · Đổi trả | Tab cố định cho đúng hành vi lặp lại |
| 5 | Tài khoản | Xem cấu trúc dưới | Gom 17–21 mục còn ~10 |

Giỏ hàng chuyển thành icon cố định trên header ở mọi trang mua sắm thay vì chiếm 1 tab.

**Hub Tài khoản mục tiêu (8 nhóm):** (1) Header avatar/tên/chip hạng · (2) Hàng tài sản 3 ô 1 chạm: Điểm Xanh · Voucher (n) · Ví (VNĐ+xu), mở ra "Ví & Ưu đãi" có sổ giao dịch · (3) Mua sắm của tôi: Yêu thích · Sổ địa chỉ · Chờ đánh giá · (4) Ưu đãi: Hạng & quyền lợi · Mời bạn · Thẻ QR · (5) **Kiếm thêm cùng Tubu** (1 mục gộp): CTV · Hoàn tiền sàn · Đại lý · Quản lý nhãn, hiện theo vai trò · (6) Hỗ trợ: Chat OA · Trợ giúp/`FAQ` · Về Tubu Tree (gộp `/about` + `/brand-story`) · (7) Cài đặt (lưu tuỳ chọn thông báo ở BE, không chỉ local) · (8) Không gian làm việc — chỉ hiện với STAFF/ADMIN.

**Gộp/chuyển/bỏ chính:** 2 điểm danh (Hạng + Vườn) → còn 1; `/wallet` rời khỏi tab bar; `/cashback`, `/refill` chuyển vào "Kiếm thêm"/Vườn; `/feed/leaderboard`+`/feed/events` thành tab trong `/feed`; `/about`+`/brand-story` gộp; `/orders`+`/subscriptions` gộp vào tab "Đơn hàng"; `/admin`,`/admin/community` chuyển hẳn sang web admin; `/brand/:slug` (hiện mồ côi, không ai trong app dẫn tới được) cần được nối từ PDP/thẻ SP/chip nhãn.

---

## Nền tảng cho analytics (dự án con 2) — danh sách sự kiện tối thiểu (rút gọn từ 07)

**Hiện trạng:** 0 SDK analytics, 0 lời gọi `track/logEvent/gtag/posthog...` ở cả 3 app (miniapp, web, api). API không có request log. Cách duy nhất đo gián tiếp DAU hiện nay là đếm dòng `refresh_tokens` (không chính xác, không phân biệt web/miniapp).

**5 lỗ hổng định danh/nguồn phải sửa TRƯỚC khi tin bất kỳ con số back-fill nào** (nếu không sửa, mọi số liệu north-star sẽ sai theo hướng khó lường):
1. Đơn "lên đơn hộ" của CTV ghi `userId` = CTV → một CTV lên hộ 20 khách trông như 1 khách siêu trung thành.
2. Tài khoản khách vãng lai (guest) và tài khoản Zalo thật của cùng một người **không bao giờ được gộp** → đếm thấp tỉ lệ mua lặp thật.
3. `Order` không có cột `source`/`platform` → không tách được web/miniapp/POS/định kỳ/"Mua lại".
4. Không có `paidAt`; việc lật trạng thái sang PAID (ZaloPay, chuyển khoản) không để lại dấu vết trong `order_status_history`.
5. Điểm danh Vườn Xanh và hành động tưới cây không có lịch sử (chỉ ghi đè), nên không đo được game có kéo được đơn 2 hay không.

**18 sự kiện tối thiểu đề xuất** (chi tiết đầy đủ về nơi phát/thuộc tính/KPI nằm ở báo cáo 07, mục 7.4):

| # | Sự kiện | Mục đích chính |
|---|---|---|
| 1 | `app_opened` | DAU/WAU/MAU, tỉ lệ mở từ thông báo |
| 2 | `screen_viewed` | Phễu từng bước, điểm rơi rớt |
| 3 | `product_viewed` | PDP → giỏ theo nguồn (Home/tìm/gợi ý/thông báo/mua lại...) |
| 4 | `search_performed` | Tỉ lệ tìm không ra kết quả |
| 5 | `add_to_cart` | Có trường `add_source` để biết bao nhiêu % dùng "Mua lại" |
| 6 | `checkout_started` | Giỏ → thanh toán |
| 7 | `order_placed` | **Cốt lõi north-star**: có `order_index`, `days_since_prev_order`, `order_source` |
| 8 | `order_place_failed` | Tỉ lệ lỗi ở bước cuối, theo mã lỗi |
| 9 | `order_paid` | Tỉ lệ hoàn tất chuyển khoản |
| 10 | `order_status_changed` | Tỉ lệ giao/huỷ/hoàn; lúc `DELIVERED` là mốc bắt đầu tính "sắp hết" |
| 11 | `notification_sent` | Độ phủ theo template/kênh |
| 12 | `notification_opened` | CTR, gán đơn cho tin nhắn cụ thể |
| 13 | `subscription_changed` | Tỉ lệ giữ gói Subscribe & Save tới kỳ 3 |
| 14 | `engagement_action` | So sánh tỉ lệ đơn 2 giữa nhóm chơi game và không chơi |
| 15 | `coupon_applied` | Chi phí khuyến mãi trên mỗi đơn 2 tăng thêm |
| 16 | `share_clicked` | Chia sẻ → chạm → đơn đầu của người được mời |
| 17 | `referral_touched` | Gán đơn cho CTV/nhãn giới thiệu |
| 18 | `client_error` | Tỉ lệ phiên có lỗi chặn phễu (bổ trợ Sentry) |

Nguyên tắc triển khai: sự kiện tiền/đơn phát ở **BE, cùng transaction** với nghiệp vụ (outbox — không mất, không trùng); FE chỉ phát sự kiện ý định/hiển thị, gom lô. Báo cáo 07 đã soạn sẵn 3 câu SQL back-fill (NS-1 % đơn 2 ≤30 ngày theo cohort, NS-2 đơn/khách/tháng, DAU proxy) — **chưa chạy, chưa chạm DB**, nhưng dùng được ngay để có baseline trong tuần đầu của dự án con 2.

---

## Phát hiện thêm từ xác minh trực quan (mục A ở trên)

**A4-NEW-01 (P2) — Nút nổi của bottom-nav che chữ dòng cuối trong "Tài sản" ở trang Cá nhân.**

Xem ảnh `.audit/proof/admin.png` (chụp thật, trang `/profile` của persona `admin` trong môi trường audit cô lập, cổng 3213). Mô tả chính xác những gì nhìn thấy: cuộn xuống cuối trang Cá nhân, khối "TÀI SẢN" có một dòng menu bắt đầu bằng chữ "Hạng thành viên" — nhưng đoạn giữa của nhãn dòng này (khoảng "& Đ") bị **nút tròn nổi màu xanh lá đậm (biểu tượng mầm cây, chính là tab giữa "Vườn Xanh" của thanh điều hướng dưới)** đè hoàn toàn lên trên, chỉ còn đọc được rời rạc "Hạng thành viên" ở đầu dòng và "iểm Xanh" ở cuối dòng nhô ra bên phải nút. Nút nổi này không trong suốt và nằm trên cùng một mặt phẳng z-index với nội dung cuộn, không có khoảng đệm đáy (safe-area) dành riêng cho nó.

Đối chiếu với 01 và 04: báo cáo 01 tự nhận rõ trong Phụ lục B rằng "vị trí pixel ở màn 375px" là điều **chưa xác minh được** (UNKNOWN) vì không chạy app trên thiết bị thật. Báo cáo 04 có bàn tới thiếu khoảng đệm safe-area (A4-21: "3 thanh CTA dính đáy không chừa safe-area", cho `storefront-view.tsx`/`brand-view.tsx`/`storefront-builder.tsx`) và tới các thanh CTA dính đáy nói chung, nhưng **không có phát hiện nào nói cụ thể về việc chính nút nổi giữa bottom-nav che nội dung cuộn của trang `/profile`**. Vì vậy đây là một phát hiện mới, bổ sung cho A4-21 cùng họ lỗi (thiếu khoảng đệm quanh phần tử nổi cố định), không phải trùng lặp.

- Bằng chứng: `.audit/proof/admin.png`; `apps/miniapp/src/components/bottom-nav.tsx:19-25` (nút tròn nổi giữa); `apps/miniapp/src/pages/profile.tsx` (khối "Tài sản" cuối trang).
- Đề xuất: thêm `padding-bottom` bằng chiều cao nút nổi + `--safe-bottom` cho phần nội dung cuộn của mọi trang có bottom-nav, hoặc nâng z-index/kích thước vùng chạm an toàn quanh nút nổi.
- Công: S. Tác động north-star: gián tiếp (nhỏ) — chữ bị che nằm ngay tại lối vào "Hạng thành viên & Điểm Xanh", một trong các cơ chế giữ chân.

*(Lưu ý: một sự cố khác từng xuất hiện trong đợt xác minh — trang tài khoản web của persona `new_customer` bị timeout ở trạng thái "Đang tải" — đã được điều tra trực tiếp và xác nhận là do một refresh token thử nghiệm cũ/đã xoay vòng bị dùng lại nhiều lần trong DB audit dùng chung, KHÔNG phải lỗi sản phẩm có thể tái hiện. Mục này cố tình không được đưa vào danh sách phát hiện, đúng theo kết luận điều tra đó.)*

**A7-NEW-01 (chưa rõ mức độ — cần xác minh trên staging thật) — Phiên web admin có thể mất ngay khi chuyển từ "Tài khoản" sang "Quản trị", trong CÙNG một lượt duyệt.**

Quan sát trực tiếp qua `verify-personas.mjs` (cùng một browser context, không tiêm lại cookie giữa hai bước): persona `admin` mở `/tai-khoan` trước — xác thực thành công, hiện đúng tên "Bùi Quốc Anh" và nút "Đăng xuất" (`.audit/proof/admin-web.png`, `verify.json: web.verified=true`). Ngay sau đó, TRONG CÙNG session đó, điều hướng tiếp sang `/admin` thì nhận màn "Cần đăng nhập quản trị. Đăng nhập" — tức phiên bị coi là **chưa đăng nhập**, không phải "thiếu quyền ADMIN" (`.audit/proof/admin-web-admin.png`, `verify.json: admin.verified=false`, `adminError: "locator.waitFor: Timeout 120000ms exceeded."`). Đọc code xác nhận `/admin` và `/tai-khoan` dùng chung một `useAuth()`/`AuthProvider` (`apps/web/src/app/admin/page.tsx:160,185-190`), nên về nguyên tắc không có lý do phiên đứng ở trang này mà mất ở trang kia — trừ khi việc **xoay vòng refresh token** (rotate-on-use, `apps/api/src/modules/auth/auth.service.ts:202-221`) sau lần gọi `/auth/refresh` thành công ở `/tai-khoan` không được trình duyệt lưu lại kịp cho lần điều hướng kế tiếp.

Đáng chú ý: chính code đã tự ghi chú một họ lỗi liên quan (`apps/api/src/modules/auth/refresh-cookie.ts:16-19`): *"nếu API ở `api.tubutree.com` còn web ở `tubutree.com` thì web không đọc được nó (trừ khi khai `AUTH_COOKIE_DOMAIN`) — một cái bẫy im lặng khiến web luôn tưởng chưa đăng nhập."* Tôi **chưa xác nhận được cơ chế chính xác** (không có công cụ để đọc header `Set-Cookie` thô của lượt refresh đầu trong phiên trình duyệt cô lập này — httpOnly nên không đọc được bằng JS, và không có cách bơm cookie thủ công qua công cụ trình duyệt sẵn có để dựng lại từng bước). Đây là quan sát THẬT, có bằng chứng (2 ảnh + `verify.json`), lặp lại nhất quán trong lần chạy này, nhưng khác hẳn tính chất với vụ `new_customer` đã loại ở trên (vụ đó là dùng lại token cũ giữa NHIỀU lần chạy script; vụ này xảy ra NGAY TRONG một lượt duyệt liên tục, không có gì để "dùng lại"). Vì thế tôi xếp nó là "cần xác minh trên staging thật" thay vì khẳng định là bug sản phẩm — mức độ nghiêm trọng phụ thuộc hoàn toàn vào việc `AUTH_COOKIE_DOMAIN` có được khai đúng trên prod hay không, và việc này không thể trả lời chỉ bằng đọc code.

- Bằng chứng: `.audit/proof/admin-web.png`, `.audit/proof/admin-web-admin.png`, `.audit/proof/verify.json` (đoạn `"name": "admin"`); `apps/web/src/app/admin/page.tsx:160,185-190`; `apps/web/src/lib/auth-context.tsx:73-99`; `apps/api/src/modules/auth/refresh-cookie.ts` (toàn file, đặc biệt dòng 16-19 và 71-90); `apps/api/src/modules/auth/auth.service.ts:202-221`.
- Đề xuất kiểm chứng (không phải sửa ngay): trên staging/prod thật, đăng nhập admin qua `/dang-nhap`, vào `/tai-khoan`, rồi bấm sang `/admin` — xem có bị đá về "Cần đăng nhập" không. Nếu có, kiểm tra biến môi trường `AUTH_COOKIE_DOMAIN` và `AUTH_COOKIE_SAMESITE` của API đã khai đúng cho domain thật (`.tubutree.com`) chưa; nếu chưa từng cấu hình, đây gần như chắc chắn là lỗi thật và ảnh hưởng MỌI phiên web (khách lẫn admin), không riêng gì `/admin`.
- Tác động north-star: nếu xác nhận là lỗi thật, ảnh hưởng trực tiếp — khách web bị đăng xuất giữa chừng lúc chuyển trang là một trong 4 kiểu "ngõ cụt độ bền" mà báo cáo 07 đã liệt kê (mục 3), chỉ là chưa ai bắt được đúng dạng "mất ngay ở lượt điều hướng kế tiếp" này.

---

## Câu hỏi cần chủ shop quyết định TRƯỚC khi bắt đầu dự án con 2–8

Gộp toàn bộ mục "Câu hỏi cho chủ shop" của cả 7 báo cáo, khử trùng lặp, nhóm theo chủ đề. **In đậm** = phương án mặc định được một báo cáo đề xuất.

### A. Tiền & mô hình CTV/đại lý/đối tác
1. Ai thu tiền chuyển khoản của đơn qua CTV/đối tác? — **Mặc định đề xuất: đơn bán lẻ luôn dùng tài khoản Tubu; chỉ đối tác đã ký hợp đồng (MERCHANT) mới được tự thu, có đối soát riêng** (02, 06).
2. Sản phẩm đối tác có bán trong catalog chung không, hay chỉ trong gian hàng riêng? SP chưa duyệt/bị từ chối chắc chắn phải ẩn — xác nhận. (02)
3. Thời hạn ràng buộc khách–CTV (hiện 3 ngày) nên là bao lâu — 30/90 ngày/trọn đời? Hoa hồng đơn lặp bằng hay thấp hơn đơn đầu? (05)
4. CTV có được tự "lên đơn hộ" cho chính mình để hưởng hoa hồng (thành "giá CTV" ngầm) không? Có giới hạn không? (05)
5. Hệ số ×1,5 khi rút hoa hồng về Ví: giữ hay bỏ? — **Mặc định đề xuất: bỏ, hoặc chuyển phần chênh lệch thành xu không rút được** (05).
6. Ai chi trả lệnh rút ngân hàng và trong bao lâu? Có khấu trừ thuế TNCN trên hoa hồng không? Cần nộp CCCD/MST trước lần rút đầu không? (05)
7. Mô hình "đối tác tự giao hàng, tự thu tiền" (Merchant) có còn cần không? Nếu không: gỡ `/merchant` cho CTV. Nếu có: ai giao, đối soát ra sao? (05, 06)
8. CTV có được đăng sản phẩm riêng không, hay chỉ đại lý/đối tác đã ký? (05)
9. Công nợ đại lý: ai xác nhận thanh toán (kế toán)? NET 15/30 có áp thật (khoá ghi nợ khi quá hạn) không? Có MOQ không? (05)
10. Một người có được vừa là CTV vừa là đại lý/nhân viên không? (05)
11. Bậc CTV nên reset theo tháng hay trượt 90 ngày? Có quyền lợi thật (tăng % hoa hồng) hay chỉ là danh hiệu? (05)
12. CTV có được xem họ tên/SĐT/địa chỉ đầy đủ của khách mua qua mình không? Có cần khách đồng ý? (05, 06)
13. Chủ nhãn có được tự tạo mã giảm giá không, hay cần Tubu duyệt trước? (05)

### B. Mô hình dữ liệu điểm/xu/tiền tệ
14. Tỷ lệ tích điểm hiện 10–20% giá trị đơn có phải chủ đích? Biên lợi nhuận gộp theo ngành hàng và ngân sách retention/tháng là bao nhiêu? (03)
15. "Cây thật" cam kết mỗi lần thu hoạch: Tubu có thực sự chi tiền trồng không? Nếu không, phải đổi nội dung hiển thị ngay. (03)
16. Hoàn tiền sàn ngoài (Shopee/Lazada/TikTok): giữ, thu nhỏ hay bỏ — vì nó đang dạy khách mua ở sàn khác? (03)
17. Có đồng ý gộp Điểm Xanh + TubuXu thành **một** tiền tệ (trừ một phần đơn, có hạn dùng, báo trước 30 ngày) không? (01, 03)
18. Mức ưu đãi cho "đơn thứ 2 trong 30 ngày" nên là bao nhiêu (VD 30k/đơn từ 199k hay 10%)? (03)
19. Quyền lợi hạng thành viên đang hiển thị sai (VD giảm 5% Cổ Thụ không chạy): làm thật ngay hay gỡ khỏi màn hình ngay? (03)
20. Season Pass/mùa: có mở mùa mới không? Ai vận hành live-ops? Nếu không ai vận hành, có bỏ tính năng? (03)
21. Bỏ điểm danh ở trang Hạng thành viên, chỉ giữ 1 điểm danh trong Vườn Xanh (thưởng cả 💧 lẫn Điểm Xanh)? (01)
22. Nhiệm vụ game: trả thưởng hồi tố cho người đã đạt điều kiện hay ẩn tính năng cho tới khi làm xong? Có thêm nhiệm vụ "đơn thứ 2 trong 30 ngày" không? (01)

### C. Kiến trúc thông tin / gộp trang
23. Tab thứ 4 nên là "Đơn hàng" (khuyến nghị) hay "Giỏ hàng"? Có chấp nhận đưa Ví ra khỏi tab bar không? (01, 03)
24. Giữ Vườn Xanh ở nút giữa hay đổi thành hub "Ưu đãi"? (01, 03)
25. Có đồng ý gộp CTV + Hoàn tiền sàn + Đại lý + Quản lý nhãn vào 1 mục "Kiếm thêm" không? (01)
26. Có chuyển toàn bộ công cụ quản trị (cấp quyền, duyệt ca, lương, duyệt đổi vỏ, kiểm duyệt) sang web admin không? Chấm công có bắt buộc làm trên điện thoại không? (01, 06)
27. Giữ, hạ cấp hay bỏ hẳn Mua chung, Trợ lý AI, Beta? (01)
28. Có bỏ `/merchant` cho AFFILIATE (CTV chỉ dùng trình dựng gian hàng trong miniapp), portal web chỉ giữ cho MERCHANT nếu còn giữ mô hình marketplace? (05, 06)
29. Có gộp `/affiliate` + `/storefront` + `/academy` thành một hub "Kênh CTV" có tab không? (05)

### D. Thiết kế / Design System v2
30. Xác nhận chuyển màu hành động chính từ cam logo sang xanh rừng trầm (`#245E3E`)? Cam logo chỉ giữ ở logo/minh hoạ. (04)
31. Chữ: chỉ dùng Plus Jakarta Sans (ít thay đổi) hay thêm serif Fraunces cho tiêu đề lớn (cảm giác "tiệm thảo mộc" cao cấp hơn)? (04)
32. Emoji ở hạng/game/onboarding: giữ hay đầu tư một bộ minh hoạ riêng — ai vẽ, ngân sách bao nhiêu? (04)
33. Giữ ZaUI làm nền (theme lại) hay tự dựng dần component riêng? — **Khuyến nghị: giữ ZaUI, theme lại** (04).
34. Có đồng ý gộp `/s/:slug` và `/brand/:slug` thành một template `StorePage` chung không? (04)
35. Có đồng ý xoá `design-system/tubu-tree/MASTER.md` (đang có nội dung sai hoàn toàn — cyan/Rubik/"Language Learning App") và chốt 1 nguồn thiết kế duy nhất? (04)
36. Có mở lại pinch-zoom không? Chế độ "Chữ to" nên nhân ×1,25 hay ×1,5? (04, 07)
37. Giữ minh hoạ "Bản đồ Gỗ 3D" ở Hành trình nguyên liệu hay vẽ lại phẳng theo bảng màu mới? (04)
38. Có giữ theme navy riêng cho đại lý không? (04)

### E. Nội dung, danh mục, vận hành
39. Shop có thực sự bán cây cảnh không? Nếu không, có đổi danh mục/copy Cộng đồng theo đúng catalog thật (Da, Mẹ & bé, Nhà sạch, Cà phê, Thực phẩm) không? (01, 03)
40. Có ngân sách ZNS cho các nhắc tái kích hoạt (mua lại, giỏ bỏ quên, win-back, giờ vàng) không? Ưu tiên mẫu nào trước? (01, 03, 05, 06)
41. "Đổi vỏ chai": có mạng lưới cửa hàng thật để hiện danh sách không? Có định bán gói refill không? (01)
42. Giữ hay bỏ quiz onboarding? Có dùng kết quả để cá nhân hoá Home không? (01)
43. Quy trình xoá tài khoản theo pháp luật: ai xử lý, SLA bao lâu? Hotline "1900 1234" có phải số thật? ID Zalo OA dùng cho production là gì? (01)
44. Một hay hai chương trình giới thiệu (khách mời khách nhận xu, và CTV nhận hoa hồng)? (01)
45. Cây danh mục mong muốn cho khách duyệt (VD Da mặt/Tóc/Cơ thể; Giặt/Rửa chén/Lau nhà; Mẹ & bé; Cà phê; Thực phẩm)? (02)
46. Chính sách đổi trả: giữ "chỉ lỗi nhà sản xuất, 7 ngày" hay nới cho "đổi ý" với hàng chưa mở? (02)
47. Chu kỳ tiêu dùng theo từng SKU: ai cung cấp số ngày dùng hết (theo dung tích/nhóm hàng)? (02, 06)
48. Đặt định kỳ: có giao đơn đầu ngay không? Thanh toán các kỳ sau bằng gì ngoài COD? (02)
49. Các tuyên bố "100% thuần chay/nguyên bản Việt Nam/đạt chuẩn kiểm định/chính hãng" có căn cứ/chứng từ cho toàn bộ danh mục không? Cần footer pháp lý + đăng ký Bộ Công Thương cho web không? (02, 06)
50. Vai trò web shop: chỉ là kênh SEO + đẩy khách sang miniapp, hay phải đầu tư ngang miniapp? (02, 06)
51. Domain chính thức là `shop.` hay `app.tubutree.com`? Có làm subdomain `*.tubutree.com` cho gian hàng CTV thật (DNS/SSL wildcard, callback Zalo) hay bỏ hẳn? (02, 05, 06)
52. Có cho mua không cần đăng nhập trên web (SĐT + OTP) hay chỉ đăng nhập Zalo? (06)
53. Có cần tách vai trò nội bộ trong admin (CSKH/kho/kế toán/marketing) thay vì chỉ "toàn quyền hoặc không có gì"? (06)
54. Academy/Content Kit: ai soạn nội dung? Có thưởng khi CTV học xong khoá không? (05)

### F. Đo lường / định nghĩa north-star (phải chốt trước dự án con 2)
55. Định nghĩa chính thức của north-star: (a) đơn CTV "lên đơn hộ" tính cho ai — người nhận theo SĐT hay loại hẳn? (b) đơn đại lý có loại không? (c) đơn huỷ/hoàn có loại không? (d) "30 ngày" đếm từ lúc đặt hay lúc giao đơn 1? (e) mua tại quầy (POS) có tính là một đơn không? (f) "khách" là một tài khoản hay một người (gộp theo SĐT)? (07)
56. Gộp tài khoản khách vãng lai sang tài khoản Zalo có được làm tự động khi cùng thiết bị đăng nhập không? (lưu ý thiết bị dùng chung như tablet cửa hàng có thể gộp nhầm) (07)
57. Lưu ảnh người dùng tải lên ở đâu — Cloudinary (trả phí khi vượt gói miễn phí) hay VPS/R2 tự quản? Ngân sách/tháng? (07)
58. Có bật proxy Cloudflare cho `api.tubutree.com` không? (quyết định cách lấy IP thật cho việc chống spam đăng nhập) (07)
59. Theo dõi lỗi/sự kiện hành vi: dùng SaaS (Sentry, dữ liệu ra nước ngoài) hay tự host? Có cần thông báo/xin đồng ý theo Nghị định 13/2023 trước khi ghi sự kiện không? Giữ dữ liệu thô bao lâu? (07)
60. Ngân sách hiệu năng chấp nhận được (VD entry ≤120kB gzip, chạm thẻ→PDP có nội dung ≤1s trên 4G)? Máy Android tầm thấp nào làm chuẩn đo? (07)

---

## Việc không xác minh được (tổng hợp UNKNOWN từ cả 7 báo cáo + việc audit)

Không báo cáo nào chạm được database production hay chạy app trên thiết bị thật/webview Zalo thật — mọi UNKNOWN dưới đây cần chủ shop hoặc một lượt kiểm tra trên máy thật để trả lời.

**Cấu hình môi trường production (ảnh hưởng nhiều phát hiện):**
- Giá trị thật của `VITE_ZALO_OA_ID`, `VITE_WEB_BASE_URL`, `VITE_CLOUDINARY_*`, `app.miniapp_base_url`, `zaloTemplateId` của các mẫu ZNS trên bản build đang chạy trên Zalo (01, 02, 05, 06, 07). Đây là gốc rễ của nhiều UNKNOWN khác: nếu thiếu, ảnh sẽ rơi về base64 (A7-07), link chia sẻ CTV sẽ chết (A5-20/A5-21), nút hỗ trợ OA sẽ ẩn.
- `ACCESSTRADE_TOKEN`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_OA_ID` trong `.env` production thật (chỉ đọc được bản `.env.vietnix.deploy` cục bộ, chỉ kiểm tra có/không, không đọc giá trị) (03).
- TZ thực tế của container production (container không đặt `TZ`, mặc định UTC — ảnh hưởng mọi giờ cron) (03).
- DNS wildcard `*.tubutree.com` và việc Zalo OAuth có chấp nhận `redirect_uri` động trên subdomain hay không (05, 06).

**Trạng thái dữ liệu production:**
- Có gian hàng CTV nào đã khai STK chưa; có `Payout REQUESTED` nào đang tồn đọng chưa; có khoá học/Content Kit nào đã tạo chưa (05).
- Số cặp (khách×SKU) hiện có ở production — tức lỗi cron `LIMIT 500` (cụm #7 ở trên) đã thực sự xảy ra chưa (03).
- `reorder.default_cycle_days`/`reorder.remind_ratio` có bị admin đổi khỏi mặc định 60/0,85 chưa (02).
- Tên nhãn thật trên production (đồng bộ từ Pancake) so với nội dung chép cứng ở trang "Hành trình nguyên liệu" (01).
- Đã chạy seed bản mới nhất chưa; có SP đối tác nào đang `PENDING_REVIEW`/`REJECTED` đang thực sự hiển thị công khai không (03, 05).

**Hành vi trên thiết bị/webview thật (chỉ đo được trên Chromium trong audit, chưa đo iOS WKWebView/Android WebView cũ):**
- Vị trí pixel chính xác ở màn 375px cho mọi ước tính "khối thứ N nằm ở ~Xpx" (01, 02, 04) — **một phần đã được xác minh trực tiếp qua ảnh chụp thật ở mục "Phát hiện thêm từ xác minh trực quan" bên trên, nhưng chỉ cho đúng 2 màn đã chụp (`/profile` và `/tai-khoan`), không đại diện cho toàn bộ ước tính pixel trong 7 báo cáo**.
- Giá trị `env(safe-area-inset-top/bottom)` thật trên thiết bị Zalo (04).
- Zalo có chấp nhận `path` tuyệt đối trong `openShareSheet` hay không; hành vi thật của `history.pushState` thủ công ở trang thông báo (01).
- Zalo có cho tải `fonts.googleapis.com` lúc chạy không, và tốc độ ra sao (04).

**Nghiệp vụ/pháp lý cần chủ shop xác nhận (không phải lỗi kỹ thuật):**
- Biên lợi nhuận gộp theo ngành hàng và ngân sách retention/tháng (03).
- Tubu có thực sự chi tiền trồng cây cho mỗi lần "cam kết" trong game không (03).
- Các tuyên bố tuyệt đối trên web ("100% thuần chay", "100% nguyên bản Việt Nam"...) có chứng từ không (02, 06).
- Pancake xử lý đơn có SP với `pancakeId` giả dạng `MCH_…` (từ merchant tự đăng) như thế nào (05, 06).

---

## Chi tiết đầy đủ

| Báo cáo | Chủ đề | Tóm tắt 1 dòng |
|---|---|---|
| [`01-ia-navigation.md`](./01-ia-navigation.md) | Kiến trúc thông tin & điều hướng (Zalo Mini App) | 42 route, chỉ ~15 phục vụ vòng mua cốt lõi; mua lại tốn 6 chạm; đề xuất IA mục tiêu 5 tab lấy "Đơn hàng/Mua lại" làm trục. 3 P0 · 23 P1 · 15 P2. |
| [`02-purchase-funnel.md`](./02-purchase-funnel.md) | Phễu mua hàng (mini app là chính, có so sánh web) | Đường mua đơn đầu gọn và an toàn, nhưng phễu gần như không có vòng mua lại; 3 P0 ở đường tiền/catalog. 3 P0 · 28 P1 · 26 P2. |
| [`03-retention-loops.md`](./03-retention-loops.md) | Vòng lặp giữ chân & mua lặp lại | Kiểm kê 38 cơ chế thưởng/game/CTV; vòng giữ chân đứt ở 5 chỗ quyết định; đề xuất mô hình 1 tiền tệ + 1 hạng. 5 P0 · 26 P1 · 16 P2. |
| [`04-design-system.md`](./04-design-system.md) | Design System & nhất quán thị giác | Có bảng màu, chưa có design system; 0% component dùng chung được import; đề xuất token 3 lớp + palette xanh premium. 0 P0 · 6 P1 · 23 P2. |
| [`05-ctv-dealer-staff.md`](./05-ctv-dealer-staff.md) | Bề mặt đối tác: CTV/affiliate, đại lý, chủ nhãn, nhân sự | Đường tiền CTV không đáng tin (11 lỗi P0), quyền quá rộng so với đăng ký 1 chạm; kênh CTV hiện chỉ phục vụ đơn đầu. 11 P0 · 25 P1 · 18 P2 (đếm lại — báo cáo gốc không công bố tổng). |
| [`06-web.md`](./06-web.md) | Web (web shop · admin · cổng đối tác) | Web shop tối giản (không tìm kiếm/danh mục/mua lại), admin thiếu công cụ giữ chân khách, cổng đối tác cho CTV tự đổi trạng thái đơn & nhận tiền trực tiếp. 7 P0 · 30 P1 · 14 P2. |
| [`07-tech-analytics.md`](./07-tech-analytics.md) | Chất lượng kỹ thuật cảm nhận được & nền đo lường | Bundle ổn (1,38MB) nhưng thác request nhiều; 4 lỗi độ bền (đổi danh tính khách, mất phiên, offline hiện rỗng, chunk lỗi sập app); 0 analytics + đề xuất 18 sự kiện tối thiểu. 1 P0 · 9 P1 · 14 P2. |

---

*Nguồn: 7 báo cáo trên (đọc toàn văn), `.audit/proof/verify.json`, `.audit/proof/admin.png`, `.audit/proof/admin-web.png`. Đếm lại severity bằng lệnh `awk` chạy trực tiếp trên 7 file `.md` trong phiên tổng hợp này (27/09/2026). Không có phát hiện nào trong tài liệu này vượt ra ngoài nội dung của 7 báo cáo gốc, ngoại trừ đúng một mục ở phần "Phát hiện thêm từ xác minh trực quan".*
