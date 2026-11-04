# Audit hard/1105 — phát hiện theo làn (snapshot d79ceeb85)

## L2 — tiền, idempotency, webhook (Opus, 04/11 ~17:10)

- **L2-01 MAJOR**: cashback AccessTrade đi lùi từ CONFIRMED về PENDING.
  - Nguyên nhân: postback muộn, hoặc trạng thái lạ bị map thành PENDING ở `access-trade.provider.ts:74`. `applyToExisting` (`cashback.service.ts:249-277`) và nhánh P2002 (`122-137`) không chặn đi lùi.
  - Hậu quả: khoản đó không bao giờ settle về Ví.
  - Sửa:
    - Chỉ cho đi tiến; đưa tập trạng thái "từ" hợp lệ vào where.
    - Provider gặp trạng thái lạ thì trả null.
  - Test: unit + race.
- **L2-02 MAJOR, CẦN CHỦ**: Kế toán đã từ chối (REJECTED) mà postback hoặc reconcile tới thì lật lại thành CONFIRMED, rồi settle vào Ví (`cashback.service.ts:207-233,249-277,384-419,110-116`).
  - Sửa: thêm cột dấu `adminReviewedAt`/`adminStatus`; ingest bỏ qua dòng đã có quyết định admin; cảnh báo khi lệch.
  - Câu hỏi chủ: giữ quyết định Kế toán (chỉ báo lệch), hay theo AccessTrade?
- **L2-03 MINOR**: ZNS gửi đôi khi `update(SENT)` lỗi sau lúc gửi thành công (`notifications.service.ts:417-433`).
  - Sửa: thử lại ghi SENT rồi nuốt lỗi; hoặc thêm trạng thái SENDING.
- **L2-04 MINOR**: rút/cron chuyển hoa hồng không kiểm đơn còn DELIVERED. Khe hở giữa lúc RETURNED commit và `reverseCommissionsForOrder` (`affiliate.service.ts:1478-1481,1679-1684`).
  - Sửa: JOIN `orders.status = 'DELIVERED'` ở cả hai chỗ.
- **L2-05 MINOR, CẦN CHỦ**: voucher mốc cấp chồng nhiều bậc trong cùng tháng, trái comment "chỉ mốc cao nhất" (`vouchers.service.ts:365,411-413,80-82`).
  - Câu hỏi chủ: đạt 1tr rồi 3tr trong tháng thì được cả hai voucher (30k + 100k), hay chỉ voucher mốc cao nhất?
- **L2-06 MINOR**: voucher mốc bị cấp lại sau khi cron dọn xoá mã, nếu `coupons.personal_expired_retention_days` thấp (sàn 30) (`coupon-cleanup.cron.ts:88-99`).
  - Sửa: loại `MILESTONE%` khỏi cron dọn, hoặc lưu khoá chống trùng ở bảng riêng.
- **L2-07 MINOR**: hai tab admin review cùng một cashback: tab thua vẫn nhận 200, log sai.
  - Sửa: `applyToExisting` trả count; trả 409 khi count = 0.
- **L2-08 MINOR**: AccessTrade báo "rejected" sau PAID thì bị bỏ qua im lặng (`cashback.service.ts:244`).
  - Sửa: log warn, báo admin, lưu payload.
- **L2-09 MINOR**: `cashbackPending` lệch vì trừ theo `userReward` cũ đọc ngoài tx.
  - Sửa: thêm `userReward` vào where của CAS.
## L1 — phiên, RBAC, admin (Opus, 04/11 ~17:16)

- **L1-01 MAJOR, CẦN CHỦ, do chính nhánh này gây ra (W8 gói c)**: lý do `ATTENTION_PAYMENT_UNLINKED(_CLOSED)` nằm trong ô `pancakeAttention`.
  - Ô này chỉ hiện cho KHO (`ops-inbox.service.ts:116`). KHO gọi `POST /admin/orders/:id/pancake-attention/resolve` thì xoá được, vì chốt duy nhất là khoản hoàn COD UNVERIFIED, mà W8 không tạo khoản hoàn.
  - Dòng lịch sử PANCAKE chặn ghim lại, nên tiền khách chuyển cho đơn huỷ rời mọi hàng đợi.
  - KE_TOAN bấm resolve thì 403. Đơn đã đóng: confirm-payment chặn nhân viên (`admin.service.ts:1198`), nên thực tế chỉ ADMIN xử lý được.
  - Sửa: STAFF không xoá được lý do `ATTENTION_PAYMENT_UNLINKED*`; hộp việc thêm audience KE_TOAN cho bản chưa đóng; bản CLOSED chỉ ADMIN; sửa chữ "Kế toán" của bản CLOSED.
  - Test: unit (KHO resolve → 403, không update) + race (webhook is_paid đơn huỷ chưa gắn rồi KHO resolve → attention còn).
  - Câu hỏi chủ: bản CLOSED do ai đóng — chỉ ADMIN, hay mở thêm quyền ghi tiền về muộn cho Kế toán?
- **L1-02 MINOR**: `setUserRole` hạ quyền: `revokeGrantsAbove` chạy ngoài tx và nuốt lỗi (`admin.service.ts:688,695`). Lần refresh kế, `applyGrants` (`auth.service.ts:1005`) nâng role lại; cửa sổ đua giữa commit và revoke.
  - Sửa: đưa vào cùng tx sau `lockAdminRoster`, ném lỗi; `applyGrants` khoá dòng users rồi đọc lại grant.
  - Test: unit rollback + race 20 refresh song song.
- **L1-03 MINOR**: access token còn dùng được tới 15 phút sau reuse-detect, sau gộp khách (`mergedIntoId`), và token đã xoay mở phiên mới sau logout trong 30 s ân hạn.
  - Chỗ: `jwt.strategy.ts:28`, `session-state.service.ts:36`, `auth.service.ts:958-984,779`.
  - Sửa: SessionState select `sessionsRevokedAt`, `mergedIntoId`; JwtStrategy 401 khi `iat` < `sessionsRevokedAt` hoặc đã gộp; logout thu hồi luôn token cùng họ trong khoảng ân hạn.
- **L1-04 MINOR, CẦN CHỦ**: không có "đăng xuất mọi thiết bị" cho khách; admin muốn cắt phiên phải khoá rồi mở.
  - Sửa: `POST /auth/logout-all`; `POST /admin/users/:id/revoke-sessions` (ADMIN, lý do, event SESSIONS_REVOKED).
- **L1-05 MINOR, CẦN CHỦ**: lời mời quyền ADMIN/STAFF theo SĐT chưa có tài khoản không hết hạn (`rbac.service.ts:100,118`). Ai sau này có số đó thành ADMIN.
  - Sửa: cột `expiresAt`; có thể chặn mời ADMIN cho số chưa có tài khoản; tab Nhân sự hiện lời mời chờ + nút thu hồi.
- **L1-06 MINOR, CẦN CHỦ**: CSKH lật trang được toàn bộ `/admin/users` (SĐT đủ, số dư), tương đương bản xuất chỉ ADMIN có.
  - Sửa: STAFF bắt buộc search, page ≤ 5, limit ≤ 20, throttle riêng ~30/phút.
- **L1-07 MINOR**: các bản xuất CSV (tax, payouts, users, orders) không ghi ai xuất, lúc nào, bộ lọc gì.
  - Sửa: bảng `admin_export_logs` hoặc interceptor cho mọi route `*/export*`.
- **L1-08 MINOR**: đổi vai trò, nhóm việc, mở khoá, cấp/thu hồi quyền không bắt buộc lý do. Đổi % hoa hồng chỉ ghi stdout (`commission-admin.service.ts:224`).
  - Sửa: `reason` bắt buộc ở các DTO đó; bảng `commission_rate_history`.
- OK: 321 route có `@Roles`, khớp `staff-permissions.matrix.spec.ts`; tự thao tác lên mình bị chặn ở mọi đường tiền; trần MARKETING; IDOR các controller đổi từ 42050c881; rate limit auth.

## L4 — Mini App + admin UI (Opus, 04/11 ~17:15)

- **L4-01 MAJOR, CẦN CHỦ**: request ảnh base64 vẫn chỉ có timeout 15 s, nên khách mạng yếu không gửi được yêu cầu đổi/trả, đánh giá có ảnh hay hồ sơ đại lý.
  - Chỗ: `miniapp/services/http.ts:135`, `api.ts:12`, `shop-api.ts:795`, `dealer-api.ts:60`.
  - Sửa: các POST mang ảnh dùng `config.timeout` riêng, 60–90 s.
  - Câu hỏi chủ: Mini App V31 trên PROD có build với `VITE_CLOUDINARY_*` không?
- **L4-02 MINOR**: hồ sơ đại lý: mất phản hồi rồi bấm lại thì nhận 400 "đã có đơn chờ duyệt", mà màn vẫn đứng ở form (`dealer.tsx:140,147`).
  - Sửa: làm mới `['dealer-me']`; API trả code `DEALER_APPLICATION_PENDING`.
- **L4-03 MINOR**: ô nhập Mini App và admin thiếu `maxLength` khớp trần DTO (bảng khoảng 30 ô); lỗi 400 hiện tên trường tiếng Anh («companyName», «businessName»…).
  - Chỗ: `validation-pipe.ts:9,84`.
  - Sửa: thêm `maxLength`; bổ sung `FIELD_LABELS`.
- **L4-04 MINOR**: Mini App quản trị: sheet giờ công và sheet ca chuẩn không có trạng thái lỗi; sheet ca chuẩn rỗng nên admin có thể thêm trùng (`admin.tsx:379,414,986,1035`).
- **L4-05 MINOR**: sao kê Ví và danh sách Đơn dùng phân trang offset trong infinite query, không khử trùng: trang sau lặp hoặc sót dòng (`wallet.tsx:45`, `orders.tsx:63,146`).
  - Sửa: chuyển sang cursor, hoặc khử trùng theo id.
- **L4-06 MINOR**: tab Giờ vàng của admin tải toàn bộ đợt flash sale kèm items, không `take` (`flash-sale.service.ts:666`, `admin/page.tsx:3175`).
  - Sửa: API nhận `?status&take&cursor`.
- Phần OK:
  - QueryClient hai app; idempotency đặt hàng và các nút tiền; poll dừng khi tab ẩn; lời lỗi không lộ tiếng Anh thô (trừ L4-03); lazy bundle.
  - Chưa đo bundle thật.

## L3 — hiệu năng API/DB (Opus, 04/11 ~17:25)

Mọi mục dưới đây là MAJOR.

**L3-01 (CẦN CHỦ: xin đọc PROD 1 câu).** PDP `findUnique({include})` kéo cả mảng ảnh base64, rồi md5 + giải mã từng ảnh ở mỗi lượt xem (`catalog.service.ts:516-557`, `public-image.ts:28-35`). Heap API chỉ 512 MB.
- Sửa: cột `products.imageRefs` cập nhật bằng trigger (theo mẫu D1); PDP dùng select tường minh.

**L3-02.** Hàng chờ duyệt sản phẩm đối tác trả nguyên dòng kèm ảnh base64 cả bản sống lẫn bản nháp, 100 dòng mỗi trang; thêm N+1 `describePancakeLink` (`admin.service.ts:1904-1934`). Có thể OOM.
- Sửa: select cột cần, ảnh trả dạng ref, gom link lại, limit 20.

**L3-03.** Danh sách review của admin chọn `images` base64 (`admin.service.ts:558-577`).
- Sửa: dùng `imageVersions` + ref, giống phía công khai.

**L3-04.** `GET /admin/ops/inbox` chạy khoảng 35 count song song, không cache.
- Các count nặng:
  - `payouts` không có index theo status.
  - `countStoresToSettle` gọi `statementFor` tuần tự, khoảng 9 query × số gian hàng.
- Nhiều tab admin cùng mở thì checkout dính P2028.
- Sửa: cache 20–30 s, p-limit 4, partial index payouts, cache settle 60 s.

**L3-05.** Postgres chưa đặt `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`; tx dùng maxWait mặc định 2 s.
- Sửa:
  - `ALTER ROLE` đặt 30s/10s/30s; đây là thay đổi hạ tầng, gửi 4f.
  - `transactionOptions.maxWait` = 5000.

**L3-06.** Hàng notifications chỉ có concurrency 1, ZNS timeout 25 s; INAPP_RETRY chung hàng.
- Sửa: concurrency 5 + limiter, tách INAPP_RETRY, ZNS timeout 10 s.

**L3-07.** Khi Redis sập, mỗi notify/enqueue chờ đủ 2 s, không có breaker. Cron nhắc giờ vàng chạy chồng, chỉ xét hạn sau mỗi trang 500.
- Sửa: breaker 30 s, `runExclusive`, xét hạn theo từng dòng.

**L3-08.** `GET /me/coupons/history` Seq Scan coupons: `scopeMeta` path ra `#>`, OR + EXISTS.
- Sửa: tách 3 truy vấn.

**L3-09.** `listUsers` và dashboard đếm toàn bảng users mỗi lượt.
- Sửa: cache 60 s, partial index guest.

**MINOR, L3-10 → L3-21:**
- index notification_logs INAPP;
- index points_transactions (userId, createdAt, id);
- `flashUpcoming` không có take/horizon;
- reviews: index + `@PublicCache`;
- index feed;
- coupon `usedCount` thay cho count;
- template `distinct` → DISTINCT ON;
- payroll/brands select gọn;
- page ≤ 1000;
- `recomputeSoldCounts` chỉ update dòng đổi, chia lô;
- external claims select gọn;
- `streamCsv` xử lý `close`.

**Danh sách EXPLAIN cần chạy:** xem report L3 (12 câu); chạy trên DB seed lớn ở Pha D.

## Quyết định chủ (04/11 ~17:25)

- **L1-01:** chỉ ADMIN đóng, sửa trong PR hiện tại, làm thành gói k trên `sec/1104-k`.
- **L2-02:** giữ quyết định của Kế toán, báo khi lệch.
- **L2-05:** bù chênh lệch, để tổng nhận bằng thưởng bậc cao nhất.
- **L1-05:** lời mời hết hạn sau 7 ngày; không cho mời ADMIN với SĐT chưa có tài khoản; tab Nhân sự hiện lời mời đang chờ.
- **L4-01:** đã tự kiểm. `apps/miniapp/.env.production` (bản build V31 ở mini-rel) KHÔNG có `VITE_CLOUDINARY_*`, nên Mini App PROD đang tải ảnh base64. Timeout 15 s là lỗi thật; sửa ở Pha D.

## Quyết định chủ (04/11, vòng 2)

**L1-04 — làm cả hai nút:**
- Khách: "Đăng xuất mọi thiết bị" ở cả Mini App và web.
- Admin: "Cắt phiên", bắt buộc ghi lý do.
- Gộp với L1-03: access token cũ chết ngay.

**L1-06 — CSKH phải tìm mới thấy:**
- Điều kiện tìm: SĐT đủ 10 số, hoặc id, hoặc tên từ 3 ký tự.
- Giới hạn: page ≤ 5, limit ≤ 20.
- ADMIN không đổi.

**L3-01 — chủ cho đọc PROD 1 câu chỉ-đọc (04/11):**
- Kết quả: 111 SP active; 0 có ảnh base64; `pg_column_size(images)` max 1128 B, avg 291 B.
- Hạ xuống MINOR, chỉ còn tính phòng thủ: PDP chọn cột tường minh.
- L3-02 (ảnh SP đối tác) và L3-03 (ảnh review) vẫn MAJOR, vì đó là nội dung do người dùng tải lên. Mini App không có Cloudinary nên ảnh lên dạng base64.

**L3-05 — options timeout đưa vào `DATABASE_URL` qua runbook; 4f áp khi deploy hard/1105:**
- `statement_timeout=30s`, `lock_timeout=10s`, `idle_in_transaction_session_timeout=30s`.
- Code: `maxWait` 5000.
- Job dài và migrate dùng `SET LOCAL`, đặt cao hơn.

## Chung
- Bảng đường tiền: đa số OK.
  - Ba chỗ không OK đã nằm trong các mục trên: cashback ingest, voucher mốc, zns-send.
  - Đường rút hoa hồng cũng ghi chưa OK: đó là L2-04.
