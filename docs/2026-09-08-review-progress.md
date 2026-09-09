# Phiên review toàn dự án — nhật ký tiến độ (2026-09-08 → 09)

Prompt điều khiển phiên: `docs/2026-09-08-full-project-review-prompt.md`.
Quyền hạn user cấp: code + test + commit + push `main`. KHÔNG chạm prod DB, KHÔNG deploy.
Ưu tiên: chất lượng > số lượng. Được redesign design-system toàn app. Được build tính năng mới
kể cả tính năng tăng trưởng.

## Baseline Phase 0 (đo lúc bắt đầu)

Lệnh đã chạy và kết quả thật:

| Lệnh | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` | `Already up to date` |
| `pnpm typecheck` | 5/5 task pass |
| `pnpm lint` | 5/5 task pass, `No ESLint warnings or errors` |
| `pnpm test:ci` | `Test Suites: 86 passed, 86 total` · `Tests: 1204 passed, 1204 total` |

Môi trường dev đang chạy: API `http://localhost:3001/api` (health 200), Postgres `tubu_pg:5434`,
Redis `tubu_redis:6381`, miniapp dev `http://localhost:3113`.

## Quy mô dự án (đếm bằng script, không ước lượng)

- API: 38 module, 301 route, 85 file spec, 34.036 dòng TypeScript.
- Prisma: 95 model. Model không được truy cập ở code API ngoài test: `MissionProgress` (1).
- Miniapp: 41 trang, tất cả đều được đăng ký trong `components/app.tsx`.
- FE→API: 298 route API riêng biệt, 271 call site FE riêng biệt, **0 call trỏ tới route không
  tồn tại**, 33 route không có FE nào gọi (phần lớn là webhook/health — cần lọc thủ công).
- UI miniapp: 119 file, 25.212 dòng; **2.095 chỗ dùng `style={{`**; 53 hex hard-code
  (160 lần), 30 literal rgb/rgba (74 lần), 34 giá trị px khác nhau (475 lần).

Chi tiết trong `docs/2026-09-08-feature-map.md`.

## Nhận định ban đầu về UI

Design system đã có nền tốt: `apps/miniapp/src/css/tokens.css` (407 dòng) có palette theo logo,
thang spacing 4/8, radius, shadow tint nâu, motion + `prefers-reduced-motion`, safe-area, type
scale. Vấn đề không phải thiếu token mà là **thiếu tầng component**: chỉ có 4 primitive trong
`components/ui/` (empty-state, skeleton, quantity-selector, time-input), nên 2.095 inline style
tự chế rải khắp 41 trang → trôi dạt thị giác. Hướng xử lý: dựng bộ primitive rồi chuyển trang
theo lô, ưu tiên lô doanh thu.

## Nhật ký theo phase

### Phase 0 — Nền tảng & bản đồ ✅
- [x] Baseline xanh, số liệu ghi ở trên.
- [x] `docs/2026-09-08-feature-map.md`: bảng module, đối chiếu route FE↔API, audit hard-code UI.
- [x] Môi trường dev chạy được để verify thật (API + miniapp).

### Phase 1 — Audit chức năng
- [x] 4 audit song song xong: tiền/giá (đang verify) · đơn hàng/tồn kho (xong, verify) · quyền/danh tính (đang chạy) · xã hội/nội dung (xong, verify).
- Đơn hàng/tồn kho — 4 P0 + 4 P1 + 5 P2 + 3 P3 đã xác nhận bằng đọc code thật (không phải suy đoán).
- Xã hội/nội dung — 2 P0 + 5 P1 + 6 P2 + 6 P3 đã xác nhận.
- Tiền/giá: chạy lại thành công, đang chờ kết quả.
- Quyền/danh tính: chạy lại 1 lần bị stall (600s không tiến triển, agent tự stop) — cần chạy lại lần 2.

### Phase 2 — Audit mạch lạc & liên kết
- [ ] Chưa bắt đầu — làm sau khi P0 đơn hàng đã sạch.

### Phase 3 — Sửa P0→P1→P2 (đơn hàng/tồn kho)
- [x] **P0-1 + P0-4 + P1-1 (đơn hàng)** — commit: xem `git log`. Root cause chung: 4 nơi ghi
  `Order.status` (orders.service.cancel, admin.service.updateOrderStatus,
  merchant.service.updateMerchantOrderStatus, pancake.processor webhook) không dùng chung một
  bảng chuyển trạng thái, và 3/4 nơi không restock/hoàn tiền khi hủy.
  - `order-transition.ts` — bảng chuyển trạng thái dùng chung (forward-chain + terminal lock,
    cho phép Pancake/POS nhảy cóc PACKED/SHIPPING nhưng chặn lùi và chặn thoát khỏi
    CANCELLED/RETURNED). 9 test.
  - `order-reversal.service.ts` — khối restock + hoàn ví/xu + release flash quota dùng chung,
    trích từ `orders.service.cancel` (bản đúng nhất trước đó). 6 test.
  - `order-status.service.ts` — nguồn ghi status DUY NHẤT cho admin/merchant/pancake: guard
    transition + atomic flip (updateMany race-safe) + side-effect điểm/hoa hồng đầy đủ. 8 test.
  - `admin.service.ts` (reviewReturn + updateOrderStatus), `merchant.service.ts`
    (updateMerchantOrderStatus), `pancake.processor.ts` (onStatusUpdated/onCancelled) — tất cả
    ủy quyền cho 2 service trên thay vì tự ghi status.
  - Bonus tìm thấy khi refactor: `orders.service.cancel` (khách tự hủy) thiếu
    `affiliate.reverseCommissionsForOrder` — CTV giữ hoa hồng PENDING vĩnh viễn cho đơn khách
    tự hủy trước khi giao. Đã thêm + test.
  - Verify: `pnpm --filter @tubutree/api typecheck` sạch, `pnpm --filter @tubutree/api lint`
    sạch, `nest build` sạch, full suite **89 suite / 1232 test pass** (baseline 86/1204, +3
    suite +28 test). Tự boot `nest start` xác nhận Nest DI graph resolve đúng (không
    `UnknownDependenciesException`) — nghẽn ở Redis/Postgres do Docker Desktop chưa chạy lại
    sau restart phiên, không phải lỗi wiring.
  - Việc cần người: khởi động lại Docker Desktop + `docker compose -f docker-compose.dev.yml
    up -d` trước khi verify UI/luồng thật.
- [x] **P0-2 (đơn hàng)** — đẩy đơn → Pancake fire-and-forget, lỗi chỉ log rồi mất vĩnh viễn.
  - `jobs/queues.ts` + `jobs/queue.module.ts`: queue mới `QUEUE_PANCAKE_PUSH` (retry 5 lần,
    exponential backoff — dùng chung defaultJobOptions đã có sẵn cho mọi queue).
  - `pancake-order.service.ts`: thêm `enqueuePush()` (jobId=orderId, dedupe); `pushOrder()`
    giữ nguyên (đã idempotent qua guard `pancakeOrderId`).
  - `pancake-push.processor.ts` (mới): worker gọi `pushOrder`, ném lỗi tiếp để BullMQ retry.
  - `pancake-push-reconcile.service.ts` (mới): cron 15 phút quét đơn `pancakeOrderId=null`
    (trừ CANCELLED) cũ hơn 15 phút → re-enqueue — lưới an toàn nếu enqueue-lúc-checkout cũng
    lỗi (Redis blip) hoặc job hết cả 5 lần retry.
  - `checkout.service.ts` + `affiliate.service.ts` (CTV lên đơn hộ): đổi `pushOrder()` trực
    tiếp → `enqueuePush()`.
  - 26 test mới (pancake-order/push-processor/push-reconcile + cập nhật mock checkout/affiliate).
  - Verify: typecheck/lint sạch, **92 suite / 1244 test pass** (tăng từ 89/1232), `nest build`
    sạch, tự boot `nest start` xác nhận DI graph resolve đúng (dừng ở Postgres/Redis
    ECONNREFUSED vì Docker Desktop chưa chạy lại sau restart phiên — không phải lỗi wiring).
  - Chưa làm trong lượt này (P1-4, ghi nhận để phiên sau): `subscriptions.service.ts` và
    `dealer.service.ts` vẫn KHÔNG đẩy Pancake ở bất kỳ đường nào — đây là tính năng còn thiếu,
    không phải regression của lượt sửa này.

- [ ] P0-3 (Pancake sync ghi đè tuyệt đối `stock`, có thể xóa mất số đã trừ cục bộ) — chưa sửa,
  cần quyết định kiến trúc (reservedStock riêng hay Pancake-là-nguồn-chân-lý) trước khi làm,
  không phải fix 1 dòng — để lại cho phiên có nhiều thời gian hơn thay vì làm vội.
- [x] **P0-1 (xã hội/game) — xu→coupon arbitrage** — `waterTree` không giới hạn số coupon
  thu hoạch/ngày trong khi xu mua nước rẻ hơn giá trị coupon hàng chục lần → in coupon vô hạn.
  - Trần cứng `game.harvest_coupon_daily_cap` (mặc định 3/ngày) BẰNG CODE, không chỉ dựa vào
    admin cấu hình đúng giá xu/coupon — cây vẫn trồng đủ (cosmetic), chỉ coupon (tiền) bị chặn.
  - Đếm-rồi-quyết chuyển vào TRONG transaction + nâng `isolationLevel: 'Serializable'` (dùng
    lại đúng pattern đã có ở `community-reward.service.ts` cho race đếm-trần) — 2 request song
    song không thể cùng lọt qua trần; P2034 → BadRequest rõ ràng cho client thử lại.
  - Bonus cùng file: mirror guard `eco.target<=0` từ `game-garden.service.ts` sang `waterTree`
    (P2-4) — chặn vòng lặp vô hạn nếu config `game.tree_default_target` bị set sai.
  - 4 test mới, full suite game 35/35.
- [x] **P0-2 (xã hội/nội dung) — group buy mint coupon miễn phí** — coupon cấp khi nhóm mua
  chung đủ người KHÔNG có `minOrder`/product restriction → dùng được trên bất kỳ đơn nào,
  không cần mua gì (tự làm đủ member bằng tài khoản phụ).
  - `grantCoupon` bắt buộc nhận `minOrder = unitPrice` của nhóm — coupon chỉ đổi được trên đơn
    thật ≥ đúng giá nhóm mua chung, không còn là tiền miễn phí.
  - Thêm trần `groupbuy.max_open_per_user` (mặc định 3) chống spam mở nhóm hàng loạt.
  - 4 test mới, full suite groupbuy 21/21.
  - Verify chung 2 mục trên: typecheck/lint sạch, **92 suite / 1251 test pass** (tăng từ
    92/1244 — soát lại đúng 1248 sau P0-2 game rồi 1251 sau groupbuy).
- [x] **P1-5 (game quiz) — trần số câu/ngày không được thực thi thật.** `answerQuiz()` chỉ
  chặn trả lời TRÙNG 1 câu/ngày (unique `userId+quizId+dayKey`) — không chặn số CÂU KHÁC NHAU
  trả lời/ngày; `getTodayQuiz()` chỉ là gợi ý hiển thị (`take` N câu), gọi thẳng
  `POST /game/quiz/:id/answer` cho quizId bất kỳ vẫn qua, nên có thể trả lời hết ngân hàng câu
  hỏi trong 1 ngày thay vì đúng `game.quiz_daily_count` câu như thiết kế.
  - Đếm attempt hôm nay TRƯỚC khi tạo mới, chặn nếu đã đạt trần. KHÔNG dùng Serializable
    transaction như `game.service.waterTree` (chấp nhận 1 khe hở đua hẹp giữa 2 request song
    song cho 2 quizId khác nhau) — phần thưởng mỗi câu chỉ vài giọt nước, giá trị thấp hơn
    nhiều so với coupon 30k/lần đã được xử lý kỹ hơn; ghi rõ đánh đổi này trong code.
  - 2 test mới + sửa 2 fixture cũ thiếu `gameQuizAttempt.count` (lộ ra ngay khi thêm lệnh gọi
    mới). Verify: typecheck/lint/`nest build` sạch, **93 suite / 1309 test pass** (từ 93/1307).
- [ ] Còn lại xã hội/nội dung chưa sửa (P1 reputation farming không trần, P1 best-answer
  farming không trần, P1 comment không có endpoint ẩn/kiểm duyệt, P1 edit sau duyệt không
  reset về PENDING) — để lại cho lượt tiếp, đã hết các mục nhanh/rẻ của domain này.
- [ ] P0 đơn hàng còn lại: P0-3 (Pancake sync ghi đè stock — cần quyết định kiến trúc).

### Audit tiền/giá — XONG (53 file đọc)
1 P0 + 1 P1 + 4 P2 + 2 P3. P0: CTV tự đăng ký (không cần duyệt) + tự đặt `comboDiscountPct`
gian hàng của mình tới 100% → đơn thật 0đ, shop trả tiền. Đã sửa (xem dưới). P1: hủy đơn không
hoàn coupon — đã sửa. P2/P3 còn lại (milestone voucher cấp 2 lần ở ranh giới tháng, cashback
rate hiển thị ×100 sai ở FE, hạng thành viên tính theo điểm CÒN LẠI thay vì điểm đã tích lũy
nên tiêu điểm bị tụt hạng, flash-sale line định giá lại cao hơn giá thường vẫn tính là flash,
free-ship tính trên subtotal GỐC thay vì sau giảm giá, ví coin không có Idempotency-Key) — chưa
sửa, để lại phiên sau.

### Audit quyền/danh tính — XONG (52 file đọc, 301 route soát)
3 P0 + 3 P1 + 4 P2. Không route nào thiếu guard — lỗ hổng nằm ở tầng authorization logic:
- **P0-1**: `slug`/`subdomain`/`customDomain` của storefront mỗi cột unique riêng nhưng mọi
  chỗ ĐỌC lại trộn cả 3 bằng `OR`, còn chỗ GHI chỉ check trùng trong CHÍNH cột đó → CTV có thể
  chiếm `subdomain`/`customDomain` trùng `slug` của gian hàng khác, giả mạo QR ngân hàng/gian
  hàng người khác.
- **P0-2**: `GET/PUT /merchant/orders` xác định "đơn của tôi" bằng list slug string
  (`[store.slug, store.subdomain]`), không phải khoá ngoại → cùng lỗ P0-1 lộ đơn/đổi trạng thái
  đơn của merchant khác (thấy SĐT/tên khách, hủy/giao đơn đối thủ).
- **P0-3**: `admin.setUserRole` hạ quyền không thu hồi `RoleGrant` — lần refresh token tiếp
  theo, `applyGrants` (chỉ nâng không hạ) tự phục hồi quyền ADMIN đã bị thu hồi.
- P1: IDOR `addResellProduct` (collectionId không check chủ sở hữu), refresh-token bị dùng lại
  chỉ chặn đúng token đó chứ không revoke cả chuỗi, AFFILIATE tự cấp được nên `@Roles` không
  còn là biên quyền thật.
- [x] **P0-1 + P0-2 (một phần) + P0-3 — đã sửa.**
  - `storefront/identifier-validation.ts` (mới) — `normalizeSubdomain`/`normalizeCustomDomain`/
    `assertIdentifierAvailable` DÙNG CHUNG cho cả `merchant.service.ts` (updateStore) và
    `storefront.service.ts` (updateMine), thay 2 bản chép tay lệch nhau. Kiểm trùng giờ CHÉO
    cả 3 cột slug/subdomain/customDomain (trước chỉ kiểm trùng trong chính cột đang ghi).
    `customDomain` trước đây HOÀN TOÀN không validate/kiểm trùng — giờ bắt buộc đúng định dạng
    tên miền (≥1 dấu chấm) + kiểm trùng chéo; subdomain bắt buộc KHÔNG dấu chấm — 2 quy tắc này
    tự nhiên tách biệt 2 không gian tên (customDomain không bao giờ trùng ký tự với subdomain/
    slug thuần chữ). Đóng nguồn gốc của P0-1 VÀ đường khai thác P0-2 đã mô tả (đơn hàng lộ qua
    slug trùng) — vì P0-2 phụ thuộc vào việc tạo được collision ở P0-1 trước; ngăn collision mới
    thì đường khai thác đó không còn tái tạo được. **CHƯA làm**: đổi model dữ liệu đơn hàng sang
    khoá ngoại `Order.storefrontId` (khuyến nghị dài hạn của audit) — để lại follow-up, không
    phải regression của lần sửa này (dữ liệu prod cũ có collision từ trước, nếu có, vẫn tồn tại
    tới khi ai đó chạy soát + dọn — xem "Việc cần người" bên dưới).
  - `RbacService.revokeGrantsAbove` (mới) — `AdminService.setUserRole` giờ gọi hàm này sau khi
    hạ role, thu hồi mọi `RoleGrant` (STAFF/ADMIN) xếp hạng cao hơn role vừa gán. Trước đây hạ
    quyền qua `POST /admin/users/role` không đụng `RoleGrant`, nên lần refresh token tiếp theo
    `applyGrants` (chỉ nâng không hạ) tự phục hồi quyền đã bị thu hồi.
  - 24 test mới (identifier-validation 12, merchant.service +5, storefront.service +2,
    rbac.service +4, admin.service +2, admin.module wiring). Verify: typecheck/lint/`nest
    build` sạch, **93 suite / 1295 test pass** (từ 92/1270). Tự boot `nest start` xác nhận DI
    graph resolve đúng sau khi AdminModule import thêm StaffModule (không tạo cycle).
- [x] **P1-1 (IDOR addResellProduct)** — `collectionId` từ body giờ phải thuộc CHÍNH gian
  hàng của caller (check qua `store.collections` đã include sẵn, không tốn query thêm).
  2 test mới.
- [x] **P1-2 (refresh-token reuse chỉ chặn 1 token, không revoke cả chuỗi)** —
  `AuthService.refresh` phát hiện reuse (`revoked.count===0`) giờ thu hồi TOÀN BỘ refresh
  token còn active của user đó, không chỉ token vừa bị replay — trước đây nếu kẻ trộm đã
  rotate 1 lần trước khi nạn nhân refresh lại, chuỗi của kẻ trộm sống nguyên 30 ngày. 2 test
  mới (thu hồi cả chuỗi khi reuse; KHÔNG thu hồi thừa khi rotation bình thường).
  - Verify chung 2 mục trên: typecheck/lint/`nest build` sạch, **93 suite / 1299 test pass**.
- [ ] Chưa sửa (quyết định nghiệp vụ, không phải bug — để nguyên): P1-3 AFFILIATE tự cấp được
  không cần duyệt — audit tự nhận đây có thể là lựa chọn sản phẩm hợp lý (giảm ma sát đăng ký
  CTV); rủi ro thực sự đã bị chặn ở nguồn tại bản vá combo-cap + storefront-identifier phía
  trên. Nếu muốn siết, cần thêm cờ "đã duyệt" tách khỏi role tự cấp — để user quyết định.
- [ ] Chưa sửa (P2, để lại phiên sau): guest login dùng `Math.random()` cho deviceId (nên đổi
  `crypto.getRandomValues`), refresh token web lưu localStorage (nên chuyển httpOnly cookie),
  vài DTO thiếu `@ArrayMaxSize`, tiền không có rate-limit riêng ngoài global 60/min.

- [x] **P1-3 (đơn hàng) — tiền chuyển khoản tới SAU khi đơn đã hủy/trả vẫn bị lật PAID êm.**
  Cả 2 kênh chuyển khoản đều có cùng lỗi: chỉ check `paymentStatus !== 'PAID'`, không check
  `status` — đơn CANCELLED/RETURNED vẫn bị ghi `paymentStatus: 'PAID'` khi tiền tới trễ, không
  cơ chế nào tự phát hiện cần hoàn tiền thật cho khách.
  - `pancake.processor.ts` (`onPaymentReconcile`) + `zalopay.service.ts` (`handleCallback`) —
    thêm guard `status IN (CANCELLED, RETURNED)` → bỏ qua việc lật PAID, log cảnh báo RÕ RÀNG
    "CẦN HOÀN TIỀN THỦ CÔNG" để vận hành biết mà xử lý tay (tiền đã về TK thật, hệ thống không
    tự động hoàn được vì đơn không còn tồn tại về nghiệp vụ).
  - `bank-transfer.service.ts` (`getBankQr`) — chặn TỪ GỐC: không sinh QR sống cho đơn đã
    hủy/trả nữa (trước đây không kiểm status chút nào), giảm khả năng khách lỡ quét QR cũ.
  - 7 test mới (bank-transfer 2, pancake onPaymentReconcile 4 — trước đây KHÔNG có test nào
    cho hàm này, zalopay 2). Verify: typecheck/lint/`nest build` sạch, **93 suite / 1307 test
    pass** (từ 93/1299).
- [ ] Chưa làm (P2-4 gốc, cần schema mới — để lại phiên sau): `zalopay.paymentTxnId` bị ghi đè
  giữa các lần thử thanh toán khác nhau của cùng đơn (cột không unique, chỉ giữ lần cuối) —
  callback của lần thử TRƯỚC đó không khớp được `app_trans_id` nữa nếu khách thử lại. Cần bảng
  `PaymentAttempt` riêng để không phá vỡ tương thích ngược trong 1 lượt sửa nhanh.
- [ ] **Việc cần người** (không tự làm được, cần quyết định/quyền hạn ngoài phạm vi code):
  chạy `SELECT count(*) FROM storefronts WHERE (subdomain IS NOT NULL AND subdomain NOT IN
  (SELECT slug FROM storefronts)) OR (custom_domain IS NOT NULL AND custom_domain IN (SELECT
  slug FROM storefronts UNION SELECT subdomain FROM storefronts))` (điều chỉnh tên cột theo
  @@map thật) trên DB thật để biết có collision nào đã tồn tại TRƯỚC bản vá này không — nếu
  có, cần xử lý thủ công (đổi tên 1 bên) vì code mới chỉ chặn collision MỚI, không tự dọn
  collision cũ.

- [x] **P0 (combo mint tiền) + P1 (coupon không hoàn khi hủy)** — cả hai từ audit tiền/giá.
  - `StorefrontService.clampComboPct` — trần `storefront.max_combo_pct` (mặc định 30%) áp ở
    CẢ createCollection và updateCollection, clamp thay vì reject (thân thiện hơn cho CTV lỡ
    tay). `ComboService.computeForStorefront` tự clamp LẦN 2 khi tính tiền (defense in depth,
    phòng dữ liệu cũ/ghi thẳng DB).
  - `CouponsService.release()` mới — đối xứng với `redeem()`: xóa `CouponRedemption` của đơn
    + giảm `usedCount` (nếu có usageLimit), idempotent. Wired vào
    `OrderReversalService.reverseFinancials` — tự động hoàn coupon ở CẢ 3 luồng hủy/trả
    (khách tự hủy, admin duyệt trả, Pancake/merchant/admin đổi trạng thái) vì tất cả đã đi qua
    class này từ đợt sửa P0-1/P0-4.
  - **P1-2 (đơn hàng, dtrước đó bỏ sót)** — `PlaceOrderDto.paymentMethod` giờ chỉ chấp nhận
    COD/BANK_TRANSFER/WALLET/XU/ZALOPAY (bỏ VNPAY — không có service/webhook nào xử lý, lặp
    đặt đơn VNPAY khóa chết tồn kho vì không cron nào hết hạn PENDING_PAYMENT).
  - 19 test mới (checkout DTO 6, storefront combo cap 4, combo.service defense-in-depth 1,
    coupons.release 6, order-reversal 2). Verify: typecheck/lint/`nest build` sạch,
    **92 suite / 1270 test pass** (từ 92/1251).

### Phase 4 — Design system
- [x] Bước 1 audit hiện trạng (số liệu ở trên).
- [ ] Các bước còn lại.

### Phase 5 — Áp design system theo lô
- [ ] Chưa bắt đầu.

### Phase 6 — Hiệu năng & độ tin cậy
- [ ] Chưa bắt đầu.

### Phase 7 — Đóng gap & tính năng tăng trưởng
- [ ] Chưa bắt đầu.

### Phase 8 — Chốt phiên
- [ ] Chưa bắt đầu.
