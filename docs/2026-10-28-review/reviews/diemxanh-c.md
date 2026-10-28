# diemxanh đợt C

mergeable=True

## Review 1

KẾT LUẬN: chưa merge

- [P2] `apps/api/prisma/migrations/20261028110000_tier_drop_notice/` — Thư mục migration chưa đổi tên. Nhánh `review/1028-muahang` có `20261028110000_welcome30_new_customer_only` và `review/1028-ctv` có `20261028110000_affiliate_auto_wallet_transfer`, nên ba nhánh đang trùng mốc. Cách sửa: dùng `git mv` để đổi thành `20261028120000_tier_drop_notice`, sửa báo cáo `diemxanh-b.md` và mọi chỗ khác còn ghi tên cũ, rồi chạy lại `migrate deploy` trên DB race.
- [P2] `apps/api/src/modules/notifications/notification-categories.ts:21` — `TIER_DROP_NOTICE` đang nằm trong `PROMO_CODES`. Hậu quả: khách tắt Khuyến mãi (`notifyPromo=false`) thì `isAllowedByPrefs` chặn tin. Tệ hơn, `notify` thoát lặng lẽ mà không ném lỗi, nên `tier-drop-notice.service.ts` đã ghi `tierDropNoticeFor=until` coi như đã báo. Khách bị hạ hạng mà không được báo, và bật lại Khuyến mãi cũng không nhận lại tin của kỳ đó. Cách sửa: bỏ mã này khỏi `PROMO_CODES` để nó rơi về nhóm TRANSACTIONAL. Test cần có ca "`notifyPromo=false` vẫn nhận tin".
- [P2] Ảnh slow5s và error500 sau sửa của game, offers, loyalty còn thiếu. Worker tự ghi "Chưa chụp ảnh các trạng thái lỗi/chậm". `screens-diemxanh/` chỉ có ảnh `ok__s1`. Ảnh trong `screens/mini375-slow5s` và `screens/web375-error500` là ảnh trước, chụp ở GĐ2. Cách sửa: chụp ảnh sau cho 3 màn × 2 trạng thái (slow5s, error500), cả Mini và web 375, rồi so từng cặp.
- [P3] `apps/api/src/modules/loyalty/tier-drop-notice.service.ts:128-137` — Tin trong app có thể gửi trùng. `notify()` lưu tin trong app trước, rồi mới `dispatchZns`. Nếu bước ZNS ném lỗi (lỗi DB ở `promoCap` hoặc lỗi thêm việc vào hàng đợi), khối catch trả `tierDropNoticeFor` về giá trị cũ. Đêm sau khách lại nhận thêm một tin trong app cho cùng kỳ. Cách sửa: truyền `dedupeKey: \`tier-drop:${until.toISOString()}\`` vào `notify`, hoặc không trả đánh dấu một khi tin trong app đã lưu.
- [P3] `apps/api/src/modules/loyalty/loyalty.service.ts:1248-1259`, ngày chuyển đổi — Khách có chuỗi Điểm Xanh cũ cao hơn chuỗi nước bị mất tiến độ ngay trong ngày chuyển. Ví dụ: hôm qua chuỗi cũ ở N6, chuỗi nước ở 1. Hôm nay khách được ngày 2 với 1.000 điểm, thay vì N7 với 2.000 điểm. Như vậy là trái câu "chuyển đổi không ai mất". Worker ghi là chủ đã duyệt nhưng không có bằng chứng. Cách sửa: trong ngày chuyển lấy ngày lớn hơn của hai chuỗi, hoặc ghi rõ quyết định này cho chủ xác nhận.
- [P3] `apps/api/src/modules/loyalty/loyalty.controller.ts:75-78` — `POST /me/loyalty/check-in` vẫn mở và chỉ cộng điểm, không cập nhật chuỗi chung. Gọi thẳng endpoint này vào ngày lỡ đúng 1 ngày mà còn vé giữ lửa thì khách nhận điểm của ngày nối chuỗi mà không bị trừ vé. Ngoài ra, ai chỉ gọi endpoint này thì chuỗi không bao giờ tăng. Hiện không còn client nào dùng endpoint. Cách sửa: chuyển endpoint sang `DailyCheckInService.run`, hoặc bỏ hẳn.
- [P3] `apps/api/src/modules/loyalty/loyalty.service.ts:1299` và `apps/api/src/modules/auth/auth.service.ts:535` — Hai comment đã sai sau khi gộp chuỗi. Một chỗ ghi "không dùng GameProfile", chỗ kia ghi "Chuỗi tính từ dòng loyalty_check_ins có dayKey lớn nhất". Giờ chuỗi tính từ hồ sơ Vườn. Cách sửa: viết lại cho đúng.
- [P3] `apps/miniapp/src/pages/game.tsx:159` (web `vuon-xanh/page.tsx:141` cũng vậy) — Điều kiện `checkInSeeds ? … : fallback` coi `todayWater=0` (bình đầy) là chưa có số. Khi đó sheet Kiếm nước hiện "+60💧" dù bình không nhận thêm. Cách sửa: đổi thành `checkInSeeds !== undefined ? …`.

Đã kiểm lại bằng chạy test:
- 3 file jest `checkin-streak`, `tier-drop-notice.service` và `daily-check-in.service` chạy lại: 45/45 qua.
- Race test trên Postgres thì đọc mã thấy đủ ca (5 lời gọi song song, vé giữ lửa, ngày chuyển đổi), nhưng chưa chạy lại vì không có DB.

Phần lõi đã đọc mã, không thấy lỗi:
- **Gộp chuỗi:** gọi theo thứ tự nào hay song song thì Điểm Xanh và giọt nước vẫn ra cùng một ngày. Không cộng điểm hai lần trong ngày, có unique `(userId, dayKey)` chặn.
- **Bảng điểm, giọt, giá quà:** không đổi.
- **Migration:** chỉ thêm, không sửa hay xoá gì.

## Sửa trước review 2 (head df1017f1c)

Nhánh review/1028-diemxanh (worktree r1028-diemxanh), chưa push. Commit mới sau lượt review:
23191aaae fix(hang): tin báo hạ hạng là tin tài khoản + dedupeKey; đổi mốc migration 20261028120000
08ee9756a test(hang): bắt kịp dedupeKey
5c1d47a2f fix(diem-danh): bỏ POST /me/loyalty/check-in cũ; sheet Kiếm nước không hứa số khi bình đầy; sửa 2 comment
cbfa76e31 test(diem-danh): spec controller bỏ POST cũ
df1017f1c test(e2e): web hoàn tiền cờ tắt cho phép lời gọi của trang chủ

Từng phát hiện:
- P2 migration trùng mốc: ĐÃ SỬA. git mv thành 20261028120000_tier_drop_notice. Không còn chỗ nào khác ghi tên cũ trong repo. migrate deploy trên DB race (35730) chạy mới từ đầu, đã áp xong. DB lane 4: đổi tên dòng trong _prisma_migrations rồi migrate deploy báo "No pending". Việc đổi tên migration của ctv (thành 20261028130000) KHÔNG làm ở đây, thuộc nhánh khác.
- P2 TIER_DROP_NOTICE nằm trong PROMO: ĐÃ SỬA. Bỏ khỏi PROMO_CODES nên thành tin giao dịch. Test đỏ trước rồi xanh. Thêm ca "notifyPromo=false vẫn nhận tin". Không có cờ "tắt mọi thông báo" trong schema nên không có gì để tôn trọng thêm.
- P2 ảnh slow5s/error500: ĐÃ CHỤP và xem từng ảnh. 3 màn (game, offers, loyalty) x 2 trạng thái x Mini/web 375, 6 ảnh ghép ở screens-diemxanh/*__slow5s__s1.png và *__error500__s1.png. Offers lỗi: tiêu đề giờ "Chưa tải được lịch điểm danh", lời nói rõ hơn, web khớp Mini. Loyalty/game lỗi giống nhau hai nền. Skeleton khi chậm: Mini dùng khối, web dùng thẻ (loading.tsx chung của web), trước và sau đều như vậy, chưa sửa vì nằm ngoài phạm vi gói.
- P3 tin báo gửi trùng: ĐÃ SỬA. notify nhận dedupeKey tier-drop:<hạn>. Cập nhật test.
- P3 khách mất tiến độ ngày chuyển đổi (chuỗi cũ cao hơn chuỗi nước): KHÔNG LÀM. Lấy max hai chuỗi phải sửa cả economy.checkIn và đụng giọt nước/thưởng mốc 3/7 ngày, trái luật cấm đổi số giọt; cần chủ xác nhận.
- P3 POST /me/loyalty/check-in: ĐÃ SỬA bằng cách bỏ endpoint (không còn client nào gọi; GET trạng thái giữ lại). Điểm danh thật chỉ qua POST /me/daily-check-in. Spec controller cập nhật và thêm ca khẳng định không còn route.
- P3 2 comment sai: ĐÃ SỬA (loyalty.service dailyCheckIn, auth.service bước 4).
- P3 checkInSeeds với todayWater=0: ĐÃ SỬA ở Mini game.tsx và web vuon-xanh/page.tsx. Dùng !== undefined, và 0 thì không hiện số (null). Test mới đỏ trước, xanh sau.
- Thêm: loyalty.web.spec.ts ca "Hoàn tiền cờ tắt" đỏ do trang chủ gọi 4 API chưa mock; thêm allowUnmocked (lỗi này có từ commit trước của gói).

Kiểm thật:
- API: pnpm typecheck sạch; jest toàn bộ 11260/11260 qua; eslint loyalty, notifications, auth.service sạch.
- Race Postgres 35730 (DB tubutree_it, đã migrate sạch): daily-check-in, game-first-checkin, game-order-water: 3 suite, 40/40 qua (daily-check-in: 5 lời gọi song song, rows=1, balance=1000, seeds=15). Đã dừng cụm.
- tsc: miniapp, web sạch. eslint game.tsx, game-newbie.spec, vuon-xanh/page.tsx sạch.
- vitest: miniapp 4874/4874 (313 file), thêm TZ=UTC 4874/4874; web 7448/7448 (442 file); app-core 932/932 (72 file).
- pnpm lint:parity: xanh, 0 mục pending.
- Playwright Mini App toàn bộ (cổng 3733): 205 qua, 10 skipped, 0 đỏ. Web gate game.web, loyalty.web, visual-g2.game.web: 67 qua, 1 đỏ (đã sửa), chạy lại loyalty.web 32 qua, 8 skipped.
- vite build Mini App + bundle-report: entry 711 KB raw / 222 KB gz (bằng baseline 711), tổng 1916 KB raw / 739 KB gz. Số tổng baseline không đọc được từ baseline.json nên chưa so được tổng.

Chưa kiểm: web next build và First Load (thay đổi web chỉ một dòng); không chạy perf/run-all theo lệnh. Đã dừng lane 4, các cổng 37xx, PG 35730; khôi phục routes.json, xoá params-l4.json.

Cần chủ quyết: (1) ngày chuyển đổi chuỗi như P3 ở trên; (2) đổi tên migration ctv thành 20261028130000 do nhánh ctv làm.

## Review 2

KẾT LUẬN: merge được

Cả 8 phát hiện của lượt 1 đã được kiểm lại, và ba việc bắt buộc thêm đều đã làm. Không còn P0, P1 hay P2. Còn lại 4 mục P3.

**Kiểm từng phát hiện của lượt 1:**
- Migration: chỉ còn `apps/api/prisma/migrations/20261028120000_tier_drop_notice/`, không file nào còn ghi tên cũ (đã `git grep`). Migration vẫn chỉ thêm: một ALTER ADD COLUMN và một INSERT có ON CONFLICT DO NOTHING.
- `TIER_DROP_NOTICE` không còn nằm trong `PROMO_CODES`, nên mặc định là tin giao dịch (`notification-categories.ts:12-22`). Đã có ca "notifyPromo=false vẫn nhận tin" (`notification-prefs.spec.ts:124`).
- dedupeKey `tier-drop:<hạn>` đã truyền vào `notify` (`tier-drop-notice.service.ts:133`).
- `POST /me/loyalty/check-in` đã bị bỏ. Không client nào gọi nó, kể cả bản ở mốc gốc 1384ff38, vì client đã dùng `/me/daily-check-in`.
- Hai comment đã sửa. `checkInSeeds !== undefined` đã sửa ở `game.tsx:159` và `vuon-xanh/page.tsx:141`.
- Ảnh slow5s và error500 của game, offers, loyalty đã có trong `screens-diemxanh/`. Tôi mở xem 3 ảnh (offers error500, game error500, loyalty slow5s): Mini và web khớp nhau. Khung chờ khác nhau (Mini dùng khối, web dùng thẻ) đã có từ trước, không do gói này gây ra.
- Đã chạy lại:
  - jest 8 suite (tier-drop, prefs, zns-gate, controller, daily-check-in, checkin-streak, economy): 167/167 qua.
  - vitest Mini App `game-newbie` và `loyalty-behavior`: 86/86 qua.
  - vitest web `vuon-xanh` và `diem-xanh`: 121/121 qua.
  - Race test trên Postgres chưa chạy lại vì không có DB. Đã đọc mã: có đủ ca 5 lời gọi song song, vé giữ lửa, sang vòng 7 ngày và ngày chuyển đổi.

**Các mục P3 còn lại:**
- [P3] `apps/api/src/modules/loyalty/loyalty.service.ts:1314` (ngày chuyển đổi): vẫn chưa sửa, worker đã chuyển cho chủ quyết. Ví dụ: chuỗi cũ của khách ở N6 và chuỗi nước ở 1 thì ngày chuyển khách nhận 1.000 điểm thay vì 2.000. Như vậy trái câu "chuyển đổi không ai mất". Lý do worker đưa ra đúng: muốn sửa thì phải đổi chuỗi nước, mà luật cấm đổi số giọt. Cách sửa: chủ xác nhận chấp nhận mất tối đa một ngày tiến độ, rồi ghi quyết định đó vào PROGRESS trước khi merge.
- [P3] `apps/api/src/modules/loyalty/loyalty.service.ts:644-650` (`tierKeepGap`, cũng là số mà `tierGraceLine` hiển thị): số tiền còn thiếu được tính trên khung 12 tháng tính từ hôm nay. Đến ngày hết hạn giữ hạng thì khung đã trượt, các đơn cũ trong khoảng `[now-12m, until-12m)` rơi ra ngoài. Ví dụ: khách có đơn 1 triệu giao cách đây 11,8 tháng, mua thêm đúng số tin báo vào sát hạn mà vẫn bị hạ hạng. Cách sửa: lấy mốc `since = until - 12 tháng` để tính phần còn thiếu, hoặc đổi câu thành "mua thêm ngay".
- [P3] `apps/api/src/modules/loyalty/tier-drop-notice.service.ts:128-137`: tin ZNS có thể mất mà không ai biết. Cách chạy: tin trong app đã lưu, rồi `dispatchZns` ném lỗi, nên khối catch trả `tierDropNoticeFor` về giá trị cũ. Đêm sau `notify` gặp dedupeKey thì thoát sớm, ZNS không bao giờ gửi, vậy mà `sent++` vẫn tính là đã báo. Cách sửa: gom lỗi ZNS lại để ghi log hoặc cảnh báo riêng, hoặc chấp nhận rồi ghi rõ trong comment.
- [P3] Khung chờ của web (dạng thẻ, lấy từ `loading.tsx` chung) khác Mini App (dạng khối) ở màn loyalty và game khi chậm 5 giây. Lỗi này đã có trước gói và nằm ngoài phạm vi. Cách sửa: ghi vào backlog.

**Phần lõi đã đọc mã, không thấy lỗi:**
- `projectCheckIn` là nguồn chung cho cả `dailyCheckIn` lẫn `economy.checkIn`. Dù bên nào chạy trước, hai bên vẫn cho cùng một ngày, kể cả khi dùng vé giữ lửa.
- Unique `(userId, dayKey)` vẫn là chốt chặn chống cộng hai lần.
- Lệnh claim `updateMany` theo `tierGraceUntil` và `tierDropNoticeFor` chặn được các lượt cron chạy song song, và cả khi lượt tính lại hạng chen vào giữa.
- Tin ZNS lúc 03:45 vẫn bị dời theo giờ yên tĩnh.
