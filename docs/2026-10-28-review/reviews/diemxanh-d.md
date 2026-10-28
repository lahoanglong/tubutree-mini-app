# diemxanh đợt D

mergeable=True

## Sửa D1 (head b65fffcb5)

Nhánh review/1028-diemxanh (worktree r1028-diemxanh), chưa push. Hai commit mới, chỉ đụng API:
- 9a037b7ed fix(hang): số còn thiếu để giữ hạng tính trên khung 12 tháng kết thúc ở ngày hết hạn
- b65fffcb5 fix(hang): ZNS lỗi sau khi tin trong app đã lưu thì không tính là đã báo, đêm sau chỉ gửi nốt ZNS

Từng việc:
(1) P3 tierKeepGap: ĐÃ LÀM (9a037b7ed).
- tierKeepGap(userId, tier, until) tính trên khung [until − 12 tháng, now]. Dòng giữ hạng (getOverview.tierGrace) giờ gọi chính hàm này nên hai nơi cùng một số.
- Test mới có đơn 355 ngày trước (còn trong khung trượt từ hôm nay nhưng rơi ra trước ngày hết hạn). Đỏ trước (nhận 200.000, cần 1.200.000), xanh sau.
(2) P3 ZNS lỗi sau khi tin trong app đã lưu: ĐÃ LÀM (b65fffcb5).
- notify có tuỳ chọn retryZns, chỉ tier-drop bật. Log ZNS mang cùng dedupeKey. Lần gọi lại thấy tin trong app đã có mà chưa có log ZNS thì chỉ gửi nốt ZNS, không lưu thêm tin trong app. Ném lỗi thì khách chưa tính là đã báo (sent không tăng, claim trả lại).
- Không bật retryZns thì notify hành xử y như cũ.
- Unit: 4 ca mới ở notifications.service.spec.
- Race thật, tier-drop-notice-zns.race-spec.ts mới, NotificationsService thật trên Postgres, không có hàng đợi. Đêm 1 ZNS ném lỗi: sent 0, tin trong app = 1, ZNS = 0. Đêm 2: sent 1, tin trong app vẫn 1, ZNS = 1. Đêm 3 không gửi thêm. Đỏ khi tắt retryZns, xanh khi bật.
- Hạn chế: retryZns dựa vào claim tierDropNoticeFor để tuần tự hoá. Hai lượt song song không qua claim đều thấy "chưa có log ZNS" và có thể gửi ZNS đôi. Đã ghi trong comment của notify.
(3) P3 khung chờ web loyalty/game khác Mini: KHÔNG SỬA, ghi backlog (bên dưới).
(4) Ngày chuyển đổi chuỗi: KHÔNG ĐỔI. Người giao báo chủ: khách N6 cũ mà chuỗi nước đang 1 thì ngày chuyển nhận 1.000 điểm thay vì 2.000, tức mất tối đa một ngày tiến độ. Muốn sửa phải đổi chuỗi nước, trái luật cấm đổi giọt. Cần chủ chấp nhận mất tối đa một ngày tiến độ và ghi vào PROGRESS trước khi merge.
Không còn P0/P1/P2 nào trong Review 2 (kết luận "merge được").

Kiểm thật:
- pnpm typecheck API: sạch. eslint 6 file đã sửa: sạch.
- jest API toàn bộ: 486 suite, 11265/11265 qua.
- Race Postgres nhúng 35730 (tubutree_it, migrate deploy sạch), 10 suite: daily-check-in, game-first-checkin, game-order-water, loyalty, loyalty-tier-own-retail, notification-prefs, tier-drop-notice, tier-drop-notice-zns, partial-return-commission-tier, external-chat-points. 104/104 qua. Đã dừng cụm.
- Không chạy lượt này: vitest, Playwright, lint:parity, vite build, bundle-report, ảnh. Lý do: không đổi web, Mini App hay hợp đồng API (tierGrace giữ nguyên hình dạng). Số của lượt trước giữ nguyên, tức bundle entry 711 KB, lúc đó vitest miniapp 4874, web 7448, app-core 932 đều xanh. Chưa chạy web next build và First Load như lượt trước đã ghi.
- Không chạy perf/run-all, không push. prettier --check báo kiểu code ở 20 file trong thư mục loyalty (đã có từ trước, repo không ép), không format lại.

GHI BACKLOG:
- Khung chờ web khác Mini ở loyalty và game khi chậm: web dùng thẻ (loading.tsx chung), Mini dùng khối. Có từ trước gói, nằm ngoài phạm vi gói. Cần làm skeleton riêng cho hai màn web.
- Nếu sau này có nhiều kênh gửi dùng dedupeKey, cân nhắc đưa dedupe theo kênh vào notify làm mặc định thay vì cờ retryZns.

## Review D1

KẾT LUẬN: merge được

Không còn lỗi P0, P1 hay P2. Cả hai commit đã có trong diff. Ba file spec bị đụng (notifications.service, tier-drop-notice.service, loyalty.service) tôi chạy lại: 136/136 qua. Phần điểm, giọt, giá quà và migration không đổi. Còn ba lỗi P3:

- [P3] apps/api/src/modules/notifications/notifications.service.ts:228-235 (gọi từ :166) — Việc (2) mới sửa được nửa. Trên production có hàng đợi (`@InjectQueue`, :85). Khi Redis lỗi hoặc `queue.add` quá giờ, lỗi bị bắt tại chỗ: log ZNS chuyển `FAILED` nhưng vẫn mang `dedupeKey`, và `notify` không ném lỗi. Hậu quả: phần đánh dấu đã báo vẫn giữ nguyên, `sent++`. Đêm sau, bước kiểm ZNS ở :113 (`dedupeWhere(..., 'ZNS')`, không lọc theo trạng thái) gặp log FAILED đó và bỏ qua, nên ZNS không bao giờ được gửi lại. Đây chính là lỗi "thêm việc vào hàng đợi" mà diemxanh-c.md:12 đã nêu. Ngoài ra, race spec tier-drop-notice-zns.race-spec.ts chạy với queue `null`, tức nhánh gửi ngay tại chỗ, nhánh mà production không chạy. Cách sửa: khi bật `retryZns`, bước kiểm ZNS chỉ tính log có `status in [PENDING, RETRYING, SENT]`. Hoặc khi `queue.add` lỗi thì ném lỗi ra ngoài thay vì nuốt. Thêm một race test có queue giả mà `add` ném lỗi.

- [P3] apps/api/src/modules/loyalty/loyalty.service.ts:650-651 — Khung `[until − 12 tháng, now]` không khớp với lượt thật sự hạ hạng. Việc hạ hạng do cron 03:15 chạy ở lần đầu tiên sau `until`, và lượt đó lấy `since = lúc chạy − 12 tháng` (:329-330). Mà `until` có thể rơi vào bất kỳ giờ nào, vì `recalcTier` còn chạy theo sự kiện đơn. Ví dụ: `until` = 07/11/2026 14:00, đơn tạo 07/11/2025 20:00. Đơn này được tính vào số "còn thiếu", nhưng lượt 08/11/2026 03:15 không tính nó. Khách mua đúng số được báo vẫn bị hạ. Cách sửa: tính `since` từ lần chạy cron 03:15 giờ VN đầu tiên từ `until` trở đi, trừ 12 tháng. Thêm test có đơn nằm trong khoảng hở vài giờ đó.

- [P3] apps/api/src/modules/loyalty/loyalty.service.ts:642-643 — Comment ghi "khách mua đúng số báo vẫn bị hạ" là sai. Theo `decideTier`, chỉ cần khung trượt đạt mốc là bỏ ngay hạn giữ hạng (qualOrder ≥ curOrder → graceUntil null). Với số theo khung trượt cũ, khách mua đủ thì được bỏ hạn, sau đó vào một kỳ giữ hạng mới 30 ngày, chứ không bị hạ đúng `until`. Kéo theo một chuyện về chữ cho PM: theo ví dụ trong test, dòng giữ hạng và tin báo bảo "Mua thêm 1.200.000đ", trong khi mua 200.000đ là dòng cảnh báo đã biến mất. Số mới là đủ, nhưng không phải số nhỏ nhất. Cách sửa: sửa comment cho đúng, và người giao xác nhận với chủ là chấp nhận báo con số dư như vậy.

Ghi chú (không phải lỗi):
- Hạn chế của `retryZns`: hai lượt chạy song song mà không đi qua bước nhận phần việc thì có thể gửi ZNS đôi. Worker đã ghi rõ trong comment. Nơi gọi duy nhất là tier-drop, có bước nhận phần việc và cờ `running`, nên chấp nhận được.
- Việc (4), ngày chuyển chuỗi (khách N6 cũ, chuỗi nước đang 1): đúng như báo cáo, không đổi. Cần chủ chấp nhận mất tối đa một ngày tiến độ trước khi merge.
