# Rà vùng Đơn hàng, Đổi trả, Thông báo, Chat CSKH (gl-1103)

Ngày rà: 03/11/2026. Người rà: auditor vùng donhang. Chỉ đọc và đo, không sửa mã, không commit, không động PROD.
Môi trường: lane 5 (API 3251, web 3252, Mini 3253), persona `returning`.

## 1. Kết luận ngắn

- Không có P0 và không có P1 trong vùng này. Luồng tiền (huỷ đơn, hoàn ví, hoàn ngân hàng), đổi trả, thông báo, chat chạy đúng trên Mini 375 ở mọi nhánh đã thử.
- 4 điểm P2 (khách có thể vấp) và 10 điểm P3 (chữ, nhịp bố cục, lệch Mini/web nhỏ). Danh sách ở mục 3.
- Web 375 và web 1280: chỉ kiểm được ảnh chụp mặc định (trạng thái `ok`) và đọc mã. Máy quá tải (load 80 đến 170, web dev server 3252 treo vì nhiều auditor cùng chụp, xem mục 5) nên KHÔNG đi được luồng thao tác trên web và KHÔNG chụp được trạng thái loading, lỗi, offline, rỗng, chữ dài của web.

## 2. Đã kiểm gì

### 2.1 Mini 375 (kiểm bằng trình duyệt thật, có ảnh)

| Việc | Kết quả | Ảnh |
|---|---|---|
| Danh sách đơn, 6 tab, thẻ đơn, "Thanh toán ngay", "Mua lại" | Đúng. Chữ dài cắt bằng ellipsis. | `docs/2026-10-28-review/screens/mini375-longtext/orders__returning__mini375-longtext__s1.png` |
| Chi tiết đơn: Đã giao còn hạn đổi trả (DN01), Đang giao có vận chuyển (DN04), Đã giao quá hạn đổi trả tên dài (DN05), Đã huỷ (DN02, DN03) | Đúng. Không tràn ngang (scrollWidth 375). Không console error. | `screens/donhang-flow/detail-mini-TUBU20261103DN04-full.png`, `detail-mini-TUBU20261103DN05-full.png` |
| Huỷ đơn COD, huỷ đơn đã trả bằng Ví (hoàn về Ví), nhánh chọn tài khoản ngân hàng, kiểm lỗi chưa chọn lý do, kiểm lỗi ngân hàng | Đúng. API trả đúng, đơn sang Đã huỷ, thông báo hoàn tiền tới ngay. | `screens/donhang-flow/cancel-mini-cod-01..06.png`, `cancel-mini-paid-01..06.png`, `cancel-mini-paidw-*.png` |
| Đổi trả: mở sheet, kiểm lỗi để trống, chọn dòng, lý do, ước tính hoàn | Đúng. | `screens/donhang-flow/return-mini-01..04.png`, `return-mini-03b-form-open-full.png` |
| Mua lại: mở sheet từ đơn đã huỷ (không bấm Thêm vào giỏ) | Đúng. | `screens/donhang-flow/reorder-mini-TUBU20261103DN02-01-sheet.png` |
| Thông báo: danh sách, mở chi tiết, nút "Xem chi tiết đơn hàng", quay lại, "Đọc tất cả" (chuông và số chưa đọc cập nhật bằng 2 lần GET sau đó) | Đúng. | `screens/donhang-flow/notif-mini-01..04.png` |
| Chat: câu hỏi nhanh, tin dài không khoảng trắng, nhân viên trả lời qua poll 5 giây, mất mạng rồi "Gửi lại" | Đúng. | `screens/donhang-flow/chat-mini-01..06.png` |
| Chat tắt (`chat.enabled=false`) có và không có lịch sử, chặn phản hồi bằng Playwright, không đụng DB | Đúng, luôn có số hotline. | `screens/donhang-flow/chat-closed-mini-empty.png`, `chat-closed-mini-history.png` |
| Trạng thái loading, lỗi 500, offline, rỗng, chữ dài của Orders, Order-code, Notifications, Chat | Lỗi 500 và offline có "Thử lại" và hotline. Rỗng có CTA. Không pageError. | `screens/mini375-error500/`, `mini375-offline/`, `mini375-empty/`, `mini375-loading/`, `mini375-longtext/` (khoá `orders`, `order-code`, `notifications`, `chat`) |

### 2.2 Web 375 và web 1280 (chỉ ảnh `ok` và đọc mã)

- Ảnh: `screens/web375/` và `screens/web1280/` các khoá `orders`, `order-code`, `notifications`, `chat`, `subscriptions`. Đã xem order-code, notifications, chat ở cả hai khổ.
- So Mini 375 với web 375: chi tiết đơn, thông báo, chat khớp về thứ tự khối, màu, chữ. Lệch nhỏ ghi ở DONHANG-11 và các mục P3.
- Web 1280: chi tiết đơn, thông báo có sidebar tài khoản. Chat nằm ngoài sidebar (card giữa trang rộng 720px), không lỗi.

### 2.3 Đọc mã

- Mini: `pages/orders.tsx`, `order-detail.tsx`, `notifications.tsx`, `support-chat.tsx`, `components/orders/*`, `components/support-chat/*`, `components/support-contact.tsx`, `components/reorder/reorder-sheet.tsx`.
- Web: `app/tai-khoan/don-hang/*`, `app/tai-khoan/thong-bao`, `app/ho-tro/chat`, `components/support-chat/*`, `components/header-bell.tsx`.
- app-core: `notification-route.ts`, `support-copy.ts`, `support-chat-view.ts`, `cancel-reasons.ts`, `api/me-summary.ts`.
- API: `orders.controller.ts`, `orders.service.ts` (huỷ đơn có khoá dòng, chống huỷ đôi, hoàn ví cùng giao dịch), `order-returns.service.ts` (cửa sổ 7 ngày, chỉ mục duy nhất chống gửi đôi, ảnh), `dto/return-request.dto.ts`, `return-images.ts`, `common/uploaded-image.ts`, `common/throttle/throttle.config.ts`, `notifications.*`, `support-chat.*`.
- Bảo mật đã xem: quyền sở hữu đơn (`order.userId !== userId` trả 404), URL chat chỉ nhận Cloudinary, ảnh đổi trả chỉ raster, đường dẫn thông báo chặn `//host`, mã ảnh đổi trả gắn id và chỉ số. Không thấy lỗi.

## 3. Phát hiện

Mọi `file:dòng` tính từ gốc worktree `gl-1103-docs`.

### P2

**DONHANG-01. Mini, danh sách đơn: bấm "Xem thêm" lỗi thì im lặng.**
- Vấn đề: khi trang kế tiếp tải lỗi, nút quay về trạng thái nhàn rỗi, không có chữ báo. Web và Thông báo Mini đều có.
- Chứng cứ: `apps/miniapp/src/pages/orders.tsx:159-169` (không đọc `isFetchNextPageError`). So: `apps/web/src/app/tai-khoan/don-hang/page.tsx:118-120` dùng `loadMoreFailed('đơn hàng')`; `apps/miniapp/src/pages/notifications.tsx:332-335` dùng `loadMoreFailed('thông báo')`. Chưa tái hiện trên trình duyệt vì lane 5 chỉ có một trang đơn (kiểm bằng đọc mã).
- Đề xuất: thêm khối `orders.isFetchNextPageError` giống Thông báo, chữ từ `loadMoreFailed`.
- Công: S. Chủ: 2a.

**DONHANG-02. Web 375, chi tiết đơn: liên kết "Viết đánh giá" cao 24px.**
- Vấn đề: vùng chạm dưới 44px. Mini giữ 44px nhờ `tubu-hit-44`.
- Chứng cứ: `docs/2026-10-28-review/screens/index-web375.jsonl` (khoá `order-code__returning__web375`, smallTargets: "Viết đánh giá" 96x24). Mã: `apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:336` có `max-md:min-h-0 max-md:py-1 max-md:text-xs`. Mini: `apps/miniapp/src/pages/order-detail.tsx:404` `tubu-hit-44`. Mini đo ở `flow-detail.mjs` thấy phần tử 101x18 nhưng vùng chạm mở rộng 44px.
- Đề xuất: bỏ `max-md:min-h-0 max-md:py-1`, hoặc dùng cùng kỹ thuật vùng chạm mở rộng (`::after` inset âm) như Mini.
- Công: S. Chủ: 2a.

**DONHANG-03. Chat Mini và web: ô nhập không tự cao lên, tin dài chỉ thấy 2 dòng cuối.**
- Vấn đề: `rows=1`, cao 45px, không co giãn. Khách gõ tin dài (mô tả lỗi hàng, tối đa 1000 ký tự) không đọc lại được phần đã gõ trước khi gửi.
- Chứng cứ: `docs/2026-10-28-review/screens/donhang-flow/chat-mini-02-composer-long.png` (chỉ thấy "aaa..." hai dòng cuối). Mã: `apps/miniapp/src/components/support-chat/composer.tsx:67-74` và `apps/web/src/components/support-chat/composer.tsx:66-73` (`rows={1}`, `minHeight 44`, `maxHeight 120`, không có tự co giãn). Đo trên Mini: textarea h=45, w=227.
- Đề xuất: tự tăng chiều cao tới `maxHeight` 120px (`field-sizing: content` hoặc đặt `height` theo `scrollHeight` trong `onChange`). Web chưa chạy trình duyệt (kiểm bằng đọc mã, cùng mã với Mini).
- Công: S. Chủ: 2a.

**DONHANG-04. Mini và web: ô nhập chữ nhỏ hơn 16px, iOS sẽ tự phóng to khi chạm vào.**
- Vấn đề: viewport không cấm zoom (`width=device-width, initial-scale=1.0, viewport-fit=cover`). Khung chat Mini 15px, lý do đổi trả 14px, lý do huỷ 14px. Web: `ui.field` là `text-sm` 14px, không có ghi đè toàn cục.
- Chứng cứ: Mini đo bằng Playwright (`measure.mjs mini /chat`): textarea `fontSize 15px`, `bodyFont 15px`. Mã: `apps/miniapp/src/components/orders/return-request-sheet.tsx:231` (`fontSize: 14`), `apps/miniapp/src/components/orders/cancel-reason-picker.tsx:43` (`fontSize: 14`), `apps/miniapp/src/components/support-chat/composer.tsx:77` (`font: inherit` = 15px). Web: `apps/web/src/lib/guest-ui.ts:2` (`FIELD_BASE ... text-sm`), `apps/web/src/app/layout.tsx:27` (viewport không có `maximumScale`), `apps/web/src/app/globals.css` không có quy tắc 16px cho input. CHƯA kiểm trên iPhone thật (Playwright chromium không phóng to). Có thể trùng với auditor vùng khác ở các ô nhập khác, cần gộp khi xử lý.
- Đề xuất: ép `font-size: 16px` cho input, textarea, select ở khổ điện thoại (Mini: ba chỗ trên; web: `max-md:text-base` trong `FIELD_BASE`).
- Công: M (đổi toàn cục web). Chủ: 2a.

### P3

**DONHANG-05. Thông báo: tiêu đề "Cập nhật đơn hàng" dùng chung cho mọi tin đơn khác loại.**
- Vấn đề: đơn đã huỷ, chờ thanh toán, hết hạn thanh toán, đã đóng gói, hoàn trả đều cùng tiêu đề. Quét danh sách không phân biệt được.
- Chứng cứ: `docs/2026-10-28-review/screens/mini375-longtext/notifications__returning__mini375-longtext__s1.png` (3 hàng liền nhau tiêu đề giống nhau, nội dung khác: huỷ, huỷ, chờ thanh toán). Mã: `packages/app-core/src/notification-route.ts:47` (`code.startsWith('ORDER')`).
- Đề xuất: thêm nhánh tiêu đề riêng: `ORDER_CANCELLED` "Đơn đã huỷ", `ORDER_AWAITING_PAYMENT` "Chờ thanh toán", `ORDER_PAYMENT_EXPIRED` "Đơn hết hạn thanh toán", `ORDER_PACKED` "Đã đóng gói". Dùng chung cho Mini và web.
- Công: S. Chủ: 2a.

**DONHANG-06. Thông báo huỷ đơn nói "đã bị huỷ" cả khi chính khách tự huỷ.**
- Vấn đề: câu "Đơn X đã bị huỷ" đọc như có người khác huỷ.
- Chứng cứ: `docs/2026-10-28-review/screens/donhang-flow/notif-mini-04-after-read-all.png` ("Đơn TUBU20261103DN03 đã bị huỷ. Đã hoàn 258.000đ vào Ví Tubu." trong khi khách vừa tự huỷ). Mẫu: `apps/api/prisma/seed.ts:772` (`ORDER_CANCELLED`).
- Đề xuất: đổi thành "Đơn X đã huỷ.{{refund_note}}". Mẫu nằm trong DB nên cần cập nhật dữ liệu mẫu (kiểu `20261102200000_customer_templates_voice`), không đổi schema.
- Công: S. Chủ: 2a.

**DONHANG-07. Huỷ đơn xong: chữ xác nhận Mini và web khác hẳn nhau.**
- Vấn đề: Mini "Đã huỷ đơn cho bạn" (ngắn, "cho bạn" nghe như người khác huỷ giúp, không nói về hoàn lại). Web "Đã huỷ đơn hàng. Hàng, điểm và tiền đã dùng cho đơn này được hoàn lại theo quy định."
- Chứng cứ: `apps/miniapp/src/i18n/vi.ts:336`; `apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx:134`.
- Đề xuất: thống nhất một câu trong app-core, ví dụ "Đã huỷ đơn. Hàng, điểm và tiền đã dùng được hoàn lại." Giữ giọng wave-8 (không "Vui lòng", không "chúng tôi").
- Công: S. Chủ: 2a.

**DONHANG-08. Chữ "24h" và "24 giờ" lẫn nhau cho cùng một lời hẹn phản hồi đổi trả.**
- Vấn đề: Mini và mẫu thông báo API ghi "24h", web ghi "24 giờ".
- Chứng cứ: `apps/miniapp/src/components/orders/return-request-sheet.tsx:116,135`; `apps/api/prisma/seed.ts:781` (`RETURN_REQUESTED`); web `apps/web/src/app/tai-khoan/don-hang/[code]/return-request-form.tsx:125`, `order-actions.tsx:250`. Có thể giao với việc "client copy vs API" của gl-1103, chỉ cần đưa câu về app-core.
- Đề xuất: dùng "24 giờ" ở mọi nơi, hoặc một hằng `RETURN_REPLY_TIME` trong app-core.
- Công: S. Chủ: 2a.

**DONHANG-09. Khoảng thời gian hoàn tiền viết "1-3 ngày" bằng gạch nối, trong khi toàn app dùng gạch ngang dài.**
- Vấn đề: "8:00–21:00" và "30/10 – 01/11" dùng gạch ngang dài, "1-3 ngày làm việc" dùng gạch nối.
- Chứng cứ: `apps/api/src/modules/orders/order-returns.service.ts:159` hàm `refundNote` ("trong 1-3 ngày làm việc"); `apps/api/prisma/seed.ts:799,801,802` (`REFUND_BANK_REQUESTED`, `REFUND_LATE_PAYMENT`, `REFUND_OVERPAYMENT`).
- Đề xuất: đổi thành "1–3 ngày làm việc". Mẫu trong DB cần cập nhật dữ liệu mẫu, cùng đợt với DONHANG-06.
- Công: S. Chủ: 2a.

**DONHANG-10. Mini, Thông báo: danh sách nhảy 18px khi nút "Đọc tất cả" xuất hiện hoặc biến mất.**
- Vấn đề: tiêu đề cao hơn khi có nút hành động. Bấm "Đọc tất cả" xong nút biến mất, danh sách bật lên 18px.
- Chứng cứ: `mini375-longtext/notifications__returning__mini375-longtext__s1.png` (thẻ đầu tiên top y=177 ở 2x, có nút) và `screens/donhang-flow/notif-mini-04-after-read-all.png` (top y=141 ở 2x, không nút): lệch 36px ở 2x = 18px. Mã: `apps/miniapp/src/pages/notifications.tsx:249-262` (`unreadCount > 0 ? <Button ...> : null`).
- Đề xuất: giữ chỗ cao cố định cho khe hành động (ẩn bằng `visibility`, hoặc đặt `minHeight` cho tiêu đề).
- Công: S. Chủ: 2a.

**DONHANG-11. Web 375, "Hành trình đơn hàng": bước có giờ cao 60px, Mini đều 44px.**
- Vấn đề: bước có dòng giờ cao 60px, bước không có giờ cao 44px, nên nhịp không đều và cả khối cao hơn Mini khoảng 48px với 4 bước.
- Chứng cứ: Mini `mini375-longtext/order-code__returning__mini375-longtext__s1.png` (4 bước cách nhau 88px ở 2x = 44px). Web `web375/order-code__returning__web375__s1.png` (bước đầu 428 đến 548 ở 2x = 60px). Mã: `apps/web/src/app/tai-khoan/don-hang/[code]/order-timeline.tsx:58` (`pb-4 max-md:pb-6`).
- Đề xuất: giảm `max-md:pb-6` để mỗi bước 44px như Mini, hoặc cho bước không có giờ cùng chiều cao.
- Công: S. Chủ: 2a.

**DONHANG-12. Mini, chat: trò chuyện dài thì tiêu đề trôi mất, còn lại dải trắng 54px chỉ có nút Quay lại.**
- Vấn đề: `PageHeader` không dính. Chat tự cuộn xuống tin mới, tiêu đề "Chat với Tubu Tree" biến mất, còn dải trắng cao 54px trên cùng. Mất ngữ cảnh đang ở màn nào.
- Chứng cứ: `screens/donhang-flow/chat-mini-06-after-retry.png` và `mini375-longtext/chat__returning__mini375-longtext__s1.png`. Mã: `apps/miniapp/src/components/ui/page-header.tsx` (không `position: sticky`), `apps/miniapp/src/pages/support-chat.tsx:293` (`PageHeader` trong `Page`).
- Đề xuất: cho tiêu đề chat dính trên cùng (`position: sticky; top: 0`) hoặc ghim lại dải trắng. Web 375 chưa kiểm trên trình duyệt (kiểm ở ảnh mặc định thì chưa dài tới mức cuộn).
- Công: S. Chủ: 2a.

**DONHANG-13. Mini, chat: mỗi tin ghi đủ ngày giờ "Đã gửi 15:38 03/11/2026".**
- Vấn đề: dòng phụ dài, lặp ngày trên từng tin. Ứng dụng chat thường chỉ ghi giờ cho tin hôm nay và gộp theo mốc.
- Chứng cứ: `screens/donhang-flow/chat-mini-03-after-long-send.png` (hai tin liên tiếp đều ghi đủ ngày giờ). Mã: `apps/miniapp/src/components/support-chat/message-list.tsx` (`formatDateTime` ở dòng 63 và 66).
- Đề xuất: tin hôm nay chỉ ghi "15:38", tin cũ ghi ngày ở dải phân cách theo ngày.
- Công: S. Chủ: 2a.

**DONHANG-14. Mini, đổi trả: nhãn ảnh minh chứng có hai cặp ngoặc "(khuyến khích, tối đa 3) (0/3)".**
- Vấn đề: nhãn tự ghép thêm "(đếm)" sau ngoặc có sẵn.
- Chứng cứ: `screens/donhang-flow/return-mini-03b-form-open-full.png` ("Ảnh minh chứng (khuyến khích, tối đa 3) (0/3)"). Mã: `apps/miniapp/src/components/orders/return-request-sheet.tsx:239` truyền `label="Ảnh minh chứng (khuyến khích, tối đa 3)"`. Web ghép tương tự ở `apps/web/src/components/evidence-upload.tsx:85-87`.
- Đề xuất: nhãn chỉ "Ảnh minh chứng (khuyến khích)", để "(0/3)" thể hiện giới hạn.
- Công: S. Chủ: 2a.

## 4. Đã xem và thấy ổn (không cần sửa)

- Huỷ đơn: khoá dòng, chống huỷ đôi, hoàn ví cùng giao dịch, chặn CTV huỷ đơn lên hộ, chặn khi Pancake đã gửi hàng.
- Đổi trả: chỉ mục duy nhất `REQUESTED` chống gửi đôi, cửa sổ ngày, ảnh chỉ raster, giới hạn 1,5 triệu ký tự mỗi ảnh và 6 ảnh, trần body 10MB.
- Chuông: `/me/summary` là nguồn duy nhất, đọc tin làm mới `['notifications']` và kéo theo `['me-summary']`.
- Chat tắt: có số hotline, nút chat ẩn ở `SupportContact` khi cờ tắt.
- Chữ giọng wave-8 trong vùng: không có "Vui lòng", "chúng tôi", "..." ba chấm trong chữ hiển thị; "Giờ vàng" viết đúng.
- API trả `referrerUserId`/`paymentTxnId` cho người mua (đã xem, ít giá trị, không báo).

## 5. Chưa kiểm được

- Web 375 và web 1280: luồng thao tác (đổi trả inline, huỷ trong alertdialog, Sheet thông báo, chat). Web dev server 3252 không phản hồi trong 280 giây (`state/lane-5/logs/web.log` dừng ở `Compiling /tai-khoan`, load máy 80 đến 170, nhiều auditor cùng gọi). Tôi không kill hay khởi động lại tiến trình không phải của mình.
- Web: trạng thái loading, lỗi 500, offline, rỗng, chữ dài (chụp web375 của vùng khác cũng thất bại vì cùng nguyên nhân).
- iOS thật (focus zoom DONHANG-04), trình đọc màn hình, `prefers-reduced-motion`.
- DONHANG-01 chưa tái hiện trên trình duyệt (cần lane có trên 1 trang đơn).
- Dữ liệu giả của seed: ngày ở "hero" khác ngày ở timeline cho đơn TUBU2026102553697 (15/09 và 25/10), hành trình vận chuyển của đơn đã giao dừng ở "Đang giao hàng". Không phải lỗi sản phẩm, không báo.
- Lỗi 429 `/auth/refresh` trên một số ảnh chụp mặc định là do nhiều auditor dùng chung persona `returning` trên lane 5, không phải lỗi sản phẩm.

## 6. Dữ liệu thử đã tạo trên lane 5 (không phải PROD)

- 5 đơn `TUBU20261103DN01` đến `DN05` (DN02, DN03 đã huỷ qua luồng thật; DN01 chưa gửi yêu cầu đổi trả, chỉ thử kiểm lỗi).
- Tin chat có tiền tố `[audit]` trong hội thoại `cmvrfk9tc00hbxu8szz2sl7vd`; `flow-chat.mjs` xoá chúng khi chạy lần sau (`DELETE FROM support_messages WHERE body LIKE '[audit]%'`).
- Đã bấm "Đọc tất cả" trên Mini lúc cuối: chuông và số chưa đọc của persona `returning` về 0 từ lúc đó. Các auditor sau sẽ thấy huy hiệu chuông 0.

## 7. Lệnh để tái hiện

Công cụ ở `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/315ed69b-80dc-466e-bece-22ee1ad7bd37/scratchpad/donhang/`:

```
node flow-detail.mjs mini TUBU20261103DN04 TUBU20261103DN05 TUBU20261103DN01
node flow-return.mjs mini TUBU20261103DN01
node flow-cancel.mjs mini <mã đơn> <nhãn> [bank]
node flow-reorder.mjs mini TUBU20261103DN02
node flow-notif.mjs mini            # thêm READALL=1 để bấm "Đọc tất cả"
node flow-chat.mjs mini
node flow-chat-closed.mjs empty|history
node measure.mjs mini /chat
```

Chụp hàng loạt: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375 --state loading,error500,offline,empty,longtext --keys orders,order-code,notifications,chat --force`.
