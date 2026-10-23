# D5-tin-nhan-khach — Tin nhắn gửi khách (ZNS, Zalo OA, thư)

## Tóm tắt

- P0: không có.
- P1: một. ZNS gửi số điện thoại dạng `0xxxxxxxxx`, còn ví dụ của Zalo dùng `84xxxxxxxxx`. Nếu đúng vậy, mọi tin ZNS sẽ lỗi vĩnh viễn ngay khi chủ chuyển một mẫu sang ZNS (3 mẫu đang chuẩn bị nộp, hoặc ORDER_CONFIRMED/ORDER_SHIPPING theo playbook).
- Bản trong app luôn được lưu trước nên vẫn tới khách. Đơn hàng và thanh toán không bị ảnh hưởng.
- Phần còn lại của luồng gửi đạt yêu cầu:
  - Tin đi đúng người (`order.userId`, chủ gian hàng, chỉ tài khoản ADMIN chưa bị khoá).
  - Chống trùng bằng claim nguyên tử hoặc `dedupeKey` cùng advisory lock. ZNS dùng `jobId=zns-<logId>`.
  - Không gửi tin bên trong giao dịch tiền.
  - Công tắc notifyPromo/notifyGarden được đọc ở server (C-022 đã sửa).
  - Số điểm đi qua formatPoints/toLocaleString. Số tiền không bị đôi chữ "đ".
  - Không mẫu nào ghi "xu" trừ XU_CONVERTED (cố ý, đã render lại ×1.000 trong migration points_1d).
  - Thiếu khoá ZNS hoặc mã mẫu thì gửi lỗi êm: lý do được ghi log và hiện ở danh sách mẫu trong admin, không ném lỗi.
- Còn mở:
  - Chưa có giờ yên tĩnh và chưa có trần 2 tin/khách/tháng cho tin hậu mãi (A3-22 cũ, D2-05).
  - Một số tin hứa Điểm Xanh chưa được cộng (câu trả lời hay nhất khi vượt trần ngày).
  - Tài liệu ZNS còn ghi sai mẫu và chưa liệt kê tên tham số.
  - GROUP_BUY_SUCCESS thiếu trường cho mẫu ZNS.
  - Webhook OA không xác minh được chữ ký thật của Zalo.
  - Các mục nhỏ khác ở P3.

## Phạm vi đã đọc (coverage)

Đọc đầy đủ:
- notifications.service.ts, notifications.processor.ts, notification-categories.ts, notification-templates-admin.service.ts
- zns.client.ts, zns-result.ts
- zalo-oa-token.service/util/cron, zalo-oa-webhook.controller.ts, zalo-oa-events.processor.ts, zalo-oa-message.client.ts
- common/notify-admins.ts, merchant-order-notify.ts, wallet/referral-notify.ts
- lifecycle.service.ts, review-invite.service.ts, waste-notifier.service.ts
- Các phần notify của groupbuy; vouchers.grant; cashback.settleConfirmed
- Các khối notify của checkout, order-status, orders
- external-claim-release (notify trong giao dịch chỉ có khoá)
- community-feed best-answer/event-winner/comment; community-reward.rewardWithDailyCap; reward-points.grant
- common/phone.ts, format-points, formatVnd
- Migration pd3_xu_converted_notice và points_1d (phần thông báo)

Đã chạy:
- SELECT trên `notification_templates` ở UAT (qua Prisma client, vì máy không có psql): 101 mẫu. ORDER_CONFIRMED/ORDER_SHIPPING là ZNS nhưng chưa có mã mẫu, còn lại là INAPP. Bảng `users` và `notification_logs` trống nên không kiểm được dạng SĐT từ dữ liệu.
- `npx jest src/modules/integrations/zns/zns.client.spec.ts`: 4/4 đạt. Test khẳng định `phone:'0910087109'` được gửi nguyên.

Tài liệu đã đọc:
- GO-LIVE-KEYS.md (phần ZNS/OA)
- pilot-order-playbook.md (Phần 1)
- so-tay-van-hanh/marketing.md
- 03-cau-hoi-sang.md (nhóm C ZNS)
- D2/D4 launch-review
- Bản nháp thể lệ Desktop/doi-rac-ban-nhap/01 (số khớp seed: 15.000/10.000/3/14 ngày/20kg/50cm)

Chưa đọc hết:
- Từng điểm gọi ở affiliate/dealer/merchant/subscriptions/external-points (chỉ xem dữ liệu truyền và định dạng)
- ops-email (chỉ nội bộ)
- 3 thư 02–04 trong doi-rac-ban-nhap
- Hiển thị thông báo trên web/Mini App (vùng phiên web)

Chưa kiểm chứng với Zalo thật:
- Dạng SĐT của ZNS
- `template_data` có khoá thừa có được nhận không
- Cơ chế chữ ký webhook OA
- Quy định giờ gửi của Zalo (developers.zalo.me chỉ trả về tiêu đề trang; ví dụ drupal.org/project/zalo_zns dùng 84937662221)

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D5-01 | P1 | PLAUSIBLE | agent sửa ngay | UAT | `apps/api/src/modules/integrations/zns/zns.client.ts:47`; `apps/api/src/modules/notifications/notifications.service.ts:116-117`; `apps/api/src/common/phone.ts:4-5,22-31`; `apps/api/src/modules/integrations/zns/zns.client.spec.ts:37` | ZNS gửi SĐT dạng `0xxxxxxxxx`, ví dụ của Zalo dùng `84xxxxxxxxx`: mọi tin ZNS có thể lỗi vĩnh viễn. Xem mục chi tiết bên dưới. | Trong `ZnsClient.sendTemplate` đổi số 0+9 chữ số thành 84+9 chữ số trước khi gửi (giữ số gốc cho maskPhone/log). Viết test đỏ trước: `sendTemplate('0910087109', …)` phải gửi `84910087109`; số đã bắt đầu bằng 84 giữ nguyên. Cập nhật ghi chú giả định ở `pilot-order-playbook.md:217`. |
| D5-02 | P2 | chưa soát | cần chủ quyết | UAT | `apps/api/src/modules/notifications/notifications.service.ts:61-119`; `apps/api/src/modules/vouchers/vouchers.service.ts:196,242,290,332`; `apps/api/src/modules/lifecycle/lifecycle.service.ts:71,174`; `apps/api/src/modules/lifecycle/remarketing.service.ts:43,127`; `apps/api/src/modules/groupbuy/groupbuy.cron.ts:12`; `apps/api/src/modules/notifications/notification-templates-admin.service.ts:150-157` | Không có giờ yên tĩnh và không có trần 2 tin hậu mãi/khách/tháng; cron marketing chạy 01:00–05:00 và mỗi giờ, cả ngày đêm. Theo D2-05, chủ đăng ký ZNS cho REORDER_REMINDER và WINBACK_VOUCHER, admin nhập mã mẫu. Cron nhắc mua lại 04:00 và winback 02:00 (giờ VN) gửi ZNS ban đêm. Một khách có thể nhận CART_ABANDONED mỗi giờ, cộng VOUCHER_EXPIRING (05:00), REORDER, WINBACK trong một tháng, không giới hạn. GROUP_BUY_FAILED (một trong 3 mẫu sắp nộp) do cron 15 phút gửi vào bất kỳ giờ nào nhóm hết hạn, ví dụ 02:15. `notify()` chỉ kiểm dedupe và prefs, không có khung giờ, không đếm. Luật đã chốt "Tin hậu mãi tối đa 2 tin/khách/tháng" (`03-cau-hoi-sang.md:127`) chưa được thực thi ở đâu. | Thêm một lớp trong `dispatchZns` (in-app không đổi): (1) khung giờ VN (ví dụ 08:00–21:00) làm trễ job ZNS (BullMQ delay) thay vì bỏ; (2) danh sách mã hậu mãi đếm theo user theo tháng VN từ `notification_logs` channel=ZNS status in (PENDING,RETRYING,SENT), bỏ ZNS khi đủ 2. Chủ phải chốt khung giờ và mã nào tính là hậu mãi. Test đỏ: notify REORDER_REMINDER lúc 02:00 VN thì job ZNS có delay>0; tin hậu mãi thứ 3 trong tháng thì không có log ZNS, chỉ có INAPP. |
| D5-03 | P2 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/feed/community-feed.service.ts:969-990,1471-1482`; `apps/api/src/modules/feed/community-reward.service.ts:115-121,67`; `apps/api/prisma/seed.ts:829` | Tin câu trả lời hay nhất hứa Điểm Xanh dù không cộng gì (chạm trần ngày, thưởng 0, lỗi grant). Ví dụ: user A có câu trả lời được 4 người hỏi chọn hay nhất trong cùng ngày VN (`community.daily_best_answer_cap` = 3). Lần chọn thứ 4, `rewardWithDailyCap` thấy count >= cap và thoát không cộng (dòng 67), nhưng `selectBestAnswer` vẫn gửi COMMUNITY_BEST_ANSWER "Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm Điểm Xanh thưởng." A xem ví không thấy điểm và phàn nàn. Tương tự khi `community.best_answer_reward_points` = 0 (`rewardBestAnswer` thoát ở dòng 118) hoặc khi `rewardBestAnswer` ném lỗi (bắt ở dòng 971). `pickWinner` cũng vậy: nếu `rewardEventWinner` lỗi (bắt ở dòng 1474), tin vẫn ghi "Bạn được thưởng X Điểm Xanh". | Cho `rewardWithDailyCap`/`rewardBestAnswer` trả boolean (đã cộng hay chưa). Ở `selectBestAnswer` truyền `{reward_note}` vào mẫu: " Bạn nhận thêm X Điểm Xanh thưởng." khi đã cộng, "" khi chưa (mẫu thành `...hay nhất! 🌿{{reward_note}}`; migration/seed phải cập nhật nội dung vì mẫu này không phải createOnly). `pickWinner`: chỉ dựng phần thưởng khi `rewardEventWinner` không ném lỗi. Test đỏ: cap=3, đã có 3 dòng COMMUNITY_BEST trong ngày, gọi `selectBestAnswer` thì dữ liệu notify không có cụm điểm. |
| D5-04 | P2 | chưa soát | cần chủ quyết | chung | `docs/GO-LIVE-KEYS.md:81-87`; `docs/launch/pilot-order-playbook.md:187-205`; `apps/api/src/modules/groupbuy/groupbuy.service.ts:223,347`; `apps/api/src/modules/lifecycle/review-invite.service.ts:132-137`; `apps/api/src/modules/notifications/notifications.service.ts:117,165` | Tài liệu ZNS vẫn nêu ORDER_CONFIRMED/ORDER_SHIPPING, không liệt kê tên tham số cho 3 mẫu đã chốt, và GROUP_BUY_SUCCESS chỉ gửi `discount`. Chủ nộp 3 mẫu đã chốt (`03-cau-hoi-sang.md:127`: mời đánh giá, mua chung thành công, mua chung thất bại), nhưng `GO-LIVE-KEYS.md:83-86` và playbook hướng tới đăng ký ORDER_CONFIRMED/ORDER_SHIPPING. Cả hai không nói tên tham số mẫu phải khớp đúng khoá mã gửi (cảnh báo này chỉ có cho `order_code` ở playbook:195). Nếu mẫu "mua chung thành công" dùng `<product_name>`, `<coupon_code>`, `<expiry>` thì mọi lần gửi đều lỗi, vì mã chỉ gửi `{discount: '30.000'}` (`groupbuy.service.ts:223`), không có tên SP, mã coupon (`groupBuyCouponCode`) hay hạn dùng, dù `grantCoupon` có đủ. Tin trong app cũng không nói mã dành cho SP nào. Khoá thật: REVIEW_REQUEST {order_code, product, product_slug}; GROUP_BUY_FAILED {product, product_slug}. | Agent: thêm `product` (tên), `code` (mã coupon), `expires` (formatVnDate) vào dữ liệu GROUP_BUY_SUCCESS, và viết bảng tham số cho 3 mẫu (khoá → ý nghĩa, ví dụ) ở `GO-LIVE-KEYS.md` mục 2 bước D, khớp quyết định. Chủ: chọn mẫu nộp và đăng ký tên tham số đúng như bảng. Test: `grantAllMembers` thì dữ liệu notify có product/code/expires. |
| D5-05 | P3 | chưa soát | cần chủ quyết | UAT | `apps/api/src/modules/integrations/zalo-oa/zalo-oa-webhook.controller.ts:36-38,57-68`; `docs/GO-LIVE-KEYS.md:179-183` | Webhook OA kiểm header tự đặt `x-webhook-token`, Zalo không gửi header này (Zalo dùng chữ ký riêng): tự trả lời có thể không chạy ở production. Ở production có `ZALO_OA_WEBHOOK_SECRET`, sự kiện thật của Zalo (`user_send_text`) tới không có header `x-webhook-token` (bảng OA chỉ nhận URL; Zalo ký bằng `X-ZEvent-Signature`) thì trả 401, không có trả lời nhanh hay lời chào, và Zalo có thể tắt webhook sau nhiều lần lỗi. Không có secret thì production cũng trả 401. Ngoài ra controller không lọc `event_name`: sự kiện do chính OA gửi (ví dụ `oa_send_text`) bị lưu như tin khách và chạy khớp từ khoá, lời chào cho id của OA. | Trước khi bật tự trả lời CSKH: kiểm tài liệu Zalo, chuyển sang xác minh `X-ZEvent-Signature` (sha256(appId+rawBody+timestamp+OA secret)), chỉ nhận `event_name` dạng `user_send_*`. Test: request ký đúng thì 200 và được lưu; chữ ký sai thì 401; sự kiện `oa_send_text` thì không lưu. |
| D5-06 | P3 | chưa soát | cần chủ quyết | UAT | `apps/api/src/modules/notifications/notification-categories.ts:24`; `apps/api/src/modules/game/game-gift.service.ts:117`; `apps/api/src/modules/feed/community-feed.service.ts:870-878` | Tắt công tắc Vườn Xanh không chặn GAME_WATER_GIFT và COMMUNITY_NEW_ANSWER, và NEW_ANSWER không được gộp theo 60 phút. Khách tắt "Vườn Xanh" trong Cài đặt. Bạn gửi nước thì họ vẫn nhận "🎁 Một người bạn vừa tặng bạn 5💧 … Vào tưới cây ngay nhé" (tin kéo quay lại, giống GAME_TREE_THIRSTY). Câu hỏi có 30 câu trả lời thì người hỏi nhận 30 tin COMMUNITY_NEW_ANSWER, không có `dedupeWithinMs`; quyết định "gộp tối đa 1 tin mỗi bài mỗi 60 phút" chỉ áp cho LIKED/COMMENTED. | Chủ quyết GAME_WATER_GIFT và COMMUNITY_NEW_ANSWER có thuộc nhóm GARDEN không, và NEW_ANSWER có gộp không (`dedupeKey` theo bài + `dedupeWithinMs` 60 phút). Test trong `notification-prefs.spec.ts`. |
| D5-07 | P3 | chưa soát | agent sửa ngay | UAT | `apps/api/src/modules/cashback/cashback.service.ts:333-350` | CASHBACK_PAID có thể gửi "Hoàn tiền 0đ … đã vào Ví Tubu". Giao dịch cashback có `userReward = 0` (mã tự xử lý ở dòng 333 `if (tx.userReward > 0)` và bỏ qua cộng ví) được chốt thì `settled=true`, rồi notify CASHBACK_PAID {amount:'0'}, ra "Hoàn tiền 0đ từ mua sắm sàn ngoài đã vào Ví Tubu 🌿". | Chỉ notify khi `settled && tx.userReward > 0`. Test: `settleConfirmed` với `userReward` 0 thì không gọi notify. |

## Chi tiết P0/P1

### D5-01 (P1, PLAUSIBLE) — ZNS gửi SĐT dạng 0xxxxxxxxx

Kịch bản:
- Admin chuyển REVIEW_REQUEST (hoặc ORDER_CONFIRMED theo `pilot-order-playbook` 1.4) sang "ZNS + trong app" và nhập mã mẫu đã được Zalo duyệt.
- `User.phone` luôn lưu dạng `0910087109` (`normalizeZaloPhone` đổi 84 thành 0).
- `notify()` gọi `dispatchZns`, rồi `ZnsClient.sendTemplate` gửi `{phone:'0910087109', template_id, template_data}` không đổi.
- Nếu Zalo yêu cầu `84910087109` (nhiều khả năng), Zalo trả lỗi số điện thoại (-108).
- Mã lỗi này không nằm trong `RETRYABLE_ZNS_CODES` (`zns-result.ts:20`), nên log chuyển FAILED ngay và khách không bao giờ nhận tin Zalo.
- Bản trong app vẫn được lưu (`notifications.service.ts:96-101`), nên giao dịch chính không bị ảnh hưởng.

Bằng chứng:
- `zns.client.ts:47` gửi `{ phone, template_id: templateId, template_data: templateData, ...}` không chuyển đổi.
- `phone.ts:4`: "SĐT Việt Nam về dạng nội địa 0xxxxxxxxx (cùng dạng User.phone luôn lưu)".
- `zns.client.spec.ts:37` khẳng định `phone: '0910087109'` (chạy `npx jest zns.client.spec.ts`: 4/4 đạt).
- `pilot-order-playbook.md:217` đã ghi "Giả định cần xác nhận: Tubu gửi nguyên 0xxxxxxxxx… Chưa ai xác nhận Zalo chấp nhận dạng đầu 0".
- Ví dụ công khai (drupal.org/project/zalo_zns) dùng 84937662221.
- Chưa kiểm chứng với Zalo thật.

Lý do soát chéo (PLAUSIBLE, giữ P1):
- Xác nhận trong mã: `zns.client.ts:47` gửi `phone` đúng như nhận.
- Cả hai nơi gọi, `notifications.service.ts:144` (gửi trực tiếp) và `:188` (job hàng đợi), truyền `User.phone`, lưu dạng 0xxxxxxxxx (`phone.ts:28` đổi 84 thành 0).
- `zns.client.spec.ts:37` khoá dạng 0910087109.
- Grep mọi nơi gọi `sendTemplate` không thấy lớp chuyển đổi nào sang 84.
- `seed.ts:733-734` đã đặt ORDER_CONFIRMED/ORDER_SHIPPING là kênh ZNS, nên lỗi phát sinh ngay khi chủ nhập `zaloTemplateId`.
- Chưa có bản sửa: commit mới nhất chạm file, a49c3042, chỉ đổi timeout và `tracking_id`.
- Không có trong `findings-catalog`, nơi chỉ ghi A3-01 (duyệt mẫu).
- `pilot-order-playbook.md:217` gọi đây là "giả định cần xác nhận" và dặn sửa mã nếu Zalo báo lỗi số điện thoại, nên là rủi ro đã biết, chưa đóng.
- Không chứng minh được Zalo từ chối đầu 0 (không truy cập được Zalo thật; tìm web chỉ thấy bên thứ ba dùng 84 hoặc +84, không phải đặc tả chính thức), nên kết luận là PLAUSIBLE, không phải CONFIRMED.
- Giữ P1 vì nếu giả định sai, mọi tin ZNS ở kênh trả phí đều lỗi vĩnh viễn (mã lỗi lạ hoặc lỗi số điện thoại không nằm trong `RETRYABLE_ZNS_CODES`, `zns-result.ts:20`).
- Không lên P0: bản trong app vẫn gửi (`notifications.service.ts:96-101`), không mất tiền, không chặn mua.
- Có thể lập luận hạ xuống P2 vì playbook đã có cách bắt lỗi trong giai đoạn thử, nhưng mỗi tin lỗi trong giai đoạn đó vẫn làm mất một thông báo của khách.
- Chuyển 0+9 chữ số thành 84+9 chữ số trong `ZnsClient.sendTemplate` rẻ và không ảnh hưởng chỗ khác dùng `User.phone`.

## Bỏ sót do soát chéo phát hiện

Không có.

## Đã bác bỏ

Không có.
