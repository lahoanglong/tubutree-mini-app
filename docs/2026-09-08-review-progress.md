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

### Phase 1 — Audit chức năng — HOÀN THÀNH CẢ 4 MẢNG
- [x] Đơn hàng/tồn kho — 4 P0 + 4 P1 + 5 P2 + 3 P3 đã xác nhận bằng đọc code thật.
- [x] Xã hội/nội dung — 2 P0 + 5 P1 + 6 P2 + 6 P3 đã xác nhận (46 file đọc).
- [x] Tiền/giá — 1 P0 + 1 P1 + 4 P2 + 2 P3 đã xác nhận (53 file đọc).
- [x] Quyền/danh tính — 3 P0 + 3 P1 + 4 P2 đã xác nhận (52 file đọc, 301 route soát; lần chạy
  đầu bị stall 600s, chạy lại lần 2 thành công).

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
- [x] Verify cuối cùng toàn workspace: `pnpm typecheck` (5/5) + `pnpm lint` (5/5) +
  `pnpm test:ci` (api 93/1309, web 1/14) + `pnpm --filter @tubutree/miniapp test` (6/6, 36/36)
  — TẤT CẢ SẠCH.
  - Tổng kết: 8 commit, đã push `origin/main`. 13 lỗi P0/P1 đã sửa (7 P0, 6 P1) trên cả 4
    domain, mỗi lỗi có test đỏ→xanh. Chi tiết đầy đủ + việc cần người + hướng tiếp tục:
    `docs/2026-09-08-overnight-session-report.md`.
- Phase 2 (coherence UX), Phase 4 bước 2+ (design system), Phase 5-7: KHÔNG kịp làm trong
  phiên này — ưu tiên "chất lượng > số lượng" dồn hết cho audit + sửa lỗi P0/P1 bảo mật/tiền
  thật đã tìm thấy, thay vì dàn mỏng sang UI/tính năng mới. Lý do đầy đủ trong overnight report.

---

# Phiên tiếp theo — 2026-09-11

Tiếp đúng danh sách "việc rẻ/nhanh còn lại" mà overnight report để lại: 4 lỗi P1 xã hội/cộng
đồng + 1 drift schema phát hiện trong lúc làm.

## Đã sửa

1. **P1-2 xã hội — farm xu qua best-answer.** `rewardBestAnswer` idempotent theo `postId` nên
   chỉ chặn farm trên CÙNG 1 bài; tài khoản phụ đăng N bài QUESTION rồi chọn best-answer cho
   nhau ở cả N bài vẫn ăn N×500 xu (mỗi bài 1 reason khác nhau, unique index không bao giờ
   chạm). → cho đi qua `rewardWithDailyCap` như 2 reward anh em, trần
   `community.daily_best_answer_cap` (mặc định 5/ngày). 2 test mới.

2. **P1-4 xã hội — sửa bài sau khi được duyệt không quay lại kiểm duyệt.** `editPost` chỉ
   `select: { userId }`, không hề đọc `status`. Bài hiền lành được duyệt (đồng thời tác giả
   được gắn `isTrusted` VĨNH VIỄN), sau đó tác giả PATCH thành spam: bài vẫn PUBLISHED, giữ
   nguyên ghim/best-answer, và không bao giờ xuất hiện lại trong hàng chờ duyệt. → đổi nội
   dung (body/title/ảnh) của bài PUBLISHED bởi tác giả chưa tin cậy ⇒ đưa về PENDING.
   Controller truyền thêm `role`. 3 test mới.

3. **P1-1 xã hội — reputation farm không trần, không idempotent, không đảo được.** Trước đây
   `bumpReputation` increment thẳng vào `community_profiles`: không đếm được theo ngày (bình
   luận liên tục +2 rep/lần → lên top BXH trong vài phút), retry cộng 2 lần, và `deletePost`
   chỉ set REMOVED nên đăng-ăn-điểm-rồi-xoá giữ nguyên hạng mà không còn nội dung để kiểm
   chứng. → thêm bảng sổ cái `ReputationEvent` (unique `userId+reason+refId`), cộng điểm
   đếm-rồi-quyết trong transaction **Serializable** với trần `community.daily_rep_cap`
   (mặc định 30 điểm/ngày), + `reverseReputationForPost` trừ lại đúng tổng khi gỡ bài (dòng
   âm `REVERSE_POST`, unique chặn trừ 2 lần). 4 call site truyền `reason`+`refId`. 11 test mới.

4. **P1-3 xã hội — không có đường nào gỡ 1 bình luận.** Cả bảng `feed_comments` chỉ có
   create/findMany/isAccepted; hub kiểm duyệt chỉ hiện nút ẩn cho `targetType='POST'` vì
   backend không có endpoint cho COMMENT → bình luận bị báo cáo hiển thị vĩnh viễn, chính tác
   giả cũng không xoá được. → cột `isRemoved` (ẩn mềm, giữ dấu vết kiểm duyệt) +
   `removeComment(userId, role, commentId)` (tác giả hoặc ADMIN) + `getComments` lọc
   `isRemoved: false` + gỡ luôn cờ best-answer/`bestCommentId` nếu comment đó đang là best.
   Route `DELETE /feed/comments/:commentId`. FE: hub kiểm duyệt gọi đúng endpoint theo
   `targetType`, và post-detail có nút tự gỡ bình luận của mình. 6 test mới.

5. **DRIFT SCHEMA CÓ SẴN TỪ TRƯỚC (phát hiện tình cờ, quan trọng).** `prisma migrate dev` báo
   drift → đối chiếu bằng `prisma migrate diff`: commit `0572e74` (trước cả phiên overnight)
   thêm một loạt field vào `schema.prisma` mà **KHÔNG tạo migration nào**:
   - `products.approvalStatus / rejectReason / storefrontId` + enum `ProductApprovalStatus`
     + `StorefrontType.MERCHANT` + 2 index + FK
   - `storefronts.subdomain / customDomain / themeColor / bank* / warehouse*` + index
     + 2 unique index
   DB local thật sự THIẾU đúng những cột đó (đã xác nhận bằng `information_schema.columns`:
   bảng `storefronts` chỉ có 14 cột). Nghĩa là mọi DB cập nhật bằng `prisma migrate deploy`
   (gồm prod nếu deploy theo runbook) đều không có các cột này, trong khi code đọc/ghi chúng.
   → viết migration bù `20260911020100_storefront_merchant_columns_drift_fix` (toàn bộ lệnh
   idempotent: `IF NOT EXISTS` / `DO $$ EXCEPTION`), kèm cảnh báo + câu SQL kiểm tra trùng
   subdomain/customDomain phải chạy TRƯỚC trên prod. Sau khi áp: `prisma migrate diff` trả
   **"This is an empty migration"** = lịch sử migration khớp schema 100%.

## Verify (lệnh thật đã chạy)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | 5/5 task pass |
| `pnpm lint` | 5/5 task pass |
| `pnpm test:ci` | api **93 suite / 1327 test pass** (từ 93/1309), web 1/14 |
| `pnpm --filter @tubutree/miniapp test` | 6/6 suite, 36/36 test |
| `nest build` | sạch |
| `prisma migrate deploy` (DB local) | 2 migration mới applied |
| `prisma migrate diff` (migrations ↔ schema) | "This is an empty migration" (drift = 0) |
| API thật (`nest start`, cổng 3009) | health 200, 0 lỗi DI |

Smoke test trên API + DB thật (không chỉ mock):
- `DELETE /api/feed/comments/<id-không-tồn-tại>` → 404 `"Bình luận không tồn tại."` (đúng
  service, không phải route-miss); không token → 401.
- Tạo bài → bình luận → `DELETE` → đọc lại: **1 bình luận → 0 bình luận**.
- `reputation_events`: câu truy vấn tổng-điểm-trong-ngày chạy đúng; INSERT trùng
  `(userId, reason, refId)` bị chặn bởi unique constraint thật (đã dọn dữ liệu test).

## Đợt 2 cùng phiên — P0-3 (thu hẹp) + 4 lỗi P2

6. **P0-3 — thu hẹp phần chắc chắn an toàn, phần còn lại bị chặn bởi 1 sự thật ngoài repo.**
   Cú quét toàn bộ catalog lúc boot (`onModuleInit`, không có `updatedSince`) là chỗ ghi đè
   nguy hiểm nhất: mỗi lần restart/deploy là đặt lại `stock` của MỌI sản phẩm theo số Pancake,
   kể cả khi đơn cục bộ vừa trừ kho mà Pancake chưa phản ánh → hồi sinh hàng đã bán hết. Đã
   đổi boot sang chế độ `skipStock` (chỉ đồng bộ giá/metadata; variation MỚI vẫn lấy tồn kho
   ban đầu). Sync 15 phút + webhook giữ nguyên. **Phần còn lại chưa làm** vì phụ thuộc câu hỏi
   *"Pancake có tự trừ `remain_quantity` khi ta tạo đơn qua API không?"* — repo không trả lời
   được và `pancake_webhook_events` ở DB dev trống 0 dòng nên không có bằng chứng hành vi.
   Hai thiết kế khả dĩ KHÔNG tương thích nhau, chọn sai thì hoặc oversell hoặc báo hết hàng ảo.
   → viết brief riêng: `docs/2026-09-11-P0-3-pancake-stock-decision-brief.md` (câu hỏi chặn,
   thí nghiệm 30 phút trên prod để chốt, thiết kế đầy đủ cho từng nhánh). 3 test mới.

7. **P2 — hiển thị tỉ lệ hoàn tiền sai 100 lần.** `baseRate` lưu dạng phân số (Shopee 0.035 =
   3,5%) và KHÔNG được API dùng để tính gì cả — chỉ để hiển thị. FE render thẳng
   `{Number(baseRate)}%` nên mọi ô sàn hiện "0.035%". → helper `formatRatePct` (dấu phẩy thập
   phân kiểu Việt, bỏ ",0", trả "0%" cho giá trị rỗng/rác) dùng ở cả 2 chỗ. 4 test mới.

8. **P2 — voucher mốc chi tiêu cấp 2 lần ở ranh giới tháng.** Cửa sổ gom là 30 ngày TRƯỢT
   nhưng khoá idempotency theo THÁNG DƯƠNG LỊCH → cùng một lần chi tiêu sinh khoá khác khi
   sang tháng mới, cấp voucher lần 2. → cho cả hai dùng chung tháng dương lịch, tính theo
   **giờ VN** (container chạy UTC nên lấy mốc tháng từ giờ server sẽ lệch 7 tiếng, gom nhầm
   đơn đặt cuối ngày 1 và ngày cuối tháng). 2 test mới.

9. **P2 — hạng thành viên tính theo điểm CÒN LẠI.** `recalcTier` so `user.pointsBalance` với
   `minPoints`: tiêu điểm lúc thanh toán (hoặc điểm hết hạn) kéo số dư xuống dưới mốc → hết ân
   hạn là bị hạ hạng, mất ×1,5 điểm + freeship. Dùng đúng loyalty currency lại bị phạt, trong
   khi doc-comment lẫn FE ("từ X điểm") đều mô tả là điểm TÍCH LUỸ. → xét theo tổng điểm DƯƠNG
   đã tích trong 12 tháng (`PointsTransaction`), cùng cửa sổ với tiêu chí chi tiêu nên hạng
   vẫn phản ánh hoạt động gần đây chứ không thành hạng vĩnh viễn. 2 test mới.

10. **P2 — `convert-xu` không có Idempotency-Key.** Endpoint tiền DUY NHẤT thiếu, trong khi
    chiều đổi là MỘT CHIỀU (xu không rút được, không có đường về ví) → double-tap "Đổi ngay"
    là mất vĩnh viễn phần tiền rút được đã đổi dư (react-query không dedupe `mutate()`,
    `disabled` chỉ ăn sau re-render nên 2 request thật sự lọt). → khoá lưu ở
    `CoinTransaction.refId` (refType='CONVERT') + partial unique index làm guard cứng
    (migration `20260911030000_coin_convert_idempotency`); replay trả kết quả cũ không đụng số
    dư; key của user khác bị từ chối; thua race unique = replay. FE gửi key + regenerate sau
    khi đổi thành công (mirror luồng rút ngay cạnh đó). 5 test mới.

### Verify đợt 2

`pnpm typecheck` 5/5 · `pnpm lint` 5/5 · API **93 suite / 1338 test** · miniapp **7 file /
40 test** · `prisma migrate deploy` áp sạch 3 migration mới của phiên.

## Còn lại cho phiên sau (thứ tự đề xuất)

1. **P0-3 phần còn lại (sync 15 phút vẫn ghi đè `stock`)** — CHỈ cần 1 câu trả lời để mở khoá,
   xem `docs/2026-09-11-P0-3-pancake-stock-decision-brief.md`. Đây là việc P0 duy nhất còn treo.
2. **P2 còn lại**: guest login dùng `Math.random()`, refresh token web trong localStorage,
   zalopay `paymentTxnId` bị ghi đè giữa các lần thử (cần bảng `PaymentAttempt` riêng),
   vài chỗ thiếu `@ArrayMaxSize`.
3. **P1-4 (đơn hàng)**: `subscriptions.service.ts` và `dealer.service.ts` vẫn KHÔNG đẩy đơn
   sang Pancake — kho vật lý không bao giờ thấy 2 loại đơn này. (Cũng là điều kiện tiên quyết
   nếu chọn Hướng 1 của P0-3.)
4. **Phase 2 (coherence audit UX)** → **Phase 4-5 (design system)** → Phase 6 → Phase 7.

## Việc cần người

- **Migration mới cần chạy khi deploy** (3 cái — thêm
  `20260911030000_coin_convert_idempotency`, an toàn, chỉ thêm partial unique index): `20260911020000_community_reputation_ledger_and_comment_moderation`
  (an toàn, thuần thêm mới) và `20260911020100_storefront_merchant_columns_drift_fix`
  (**đọc phần cảnh báo trong file .sql trước**: chạy 2 câu SELECT kiểm tra trùng
  subdomain/customDomain trên prod, nếu có trùng phải đổi tên thủ công 1 bên rồi mới chạy).
- Vẫn chưa deploy BE/WEB lên VM prod và chưa deploy miniapp lên Zalo.

---

# Phiên 2026-09-11/12 (tiếp) — Phase 2 coherence + Phase 4 nền UI

## Phase 2 — Audit mạch lạc UX (ĐÃ CHẠY, 2 agent đọc code thật)

- **B2C (2 hành trình khách)** — ~52 file: 3 P0, 8 P1, 12 P2, ~8 P3.
- **Đối tác (CTV/đại lý + nhãn hàng)** — ~53 file: 5 P0, 9 P1, 7 P2, 6 P3.

### Đã sửa từ audit mạch lạc

1. **P0 (CTV) — gian hàng CTV KHÔNG BAO GIỜ mở được qua link công khai.** `slug` lưu từ
   `referralCode` (luôn IN HOA), còn `getPublicBySlug` hạ chữ mã tra cứu rồi so khớp CHÍNH XÁC.
   Đã kiểm trên DB thật: `SELECT 'ABC' = 'abc'` → `f`, và cột `slug` không có collation
   case-insensitive. Nghĩa là mọi link `/s/<slug>` CTV gửi khách đều trả "gian hàng không tồn
   tại". → ghi chữ thường tại nguồn + đọc `mode: 'insensitive'` (cứu link đã phát cho khách mà
   không phải chờ backfill) + migration hạ chữ dữ liệu cũ (chỉ khi không đụng trùng).
2. **P0 (CTV) — nút "Chia sẻ qua Zalo" làm MẤT mã giới thiệu** (chỉ nút "Sao chép link" có
   `?ref=`) → khách mua qua link chia sẻ, CTV không được hoa hồng. Cùng 1 sheet, 2 kết quả tiền
   bạc khác nhau. → truyền `sharePath` có `?ref=` cho cả hai lối.
3. **P0 (B2C) — đơn chuyển khoản không có đường quay lại màn QR.** `/bank-payment/:code` chỉ
   tới được đúng 1 lần ngay sau khi đặt. Rời đi là mất QR/số tài khoản → chỉ còn cách huỷ đơn.
   → nút "Thanh toán ngay" ở chi tiết đơn + ở màn thành công của đơn CTV lên hộ khách.
4. **P0 (B2C) — số dư ở checkout lấy từ auth store, không bao giờ làm mới trong phiên.** Vừa
   đổi Ví→xu hoặc vừa tiêu xu trong Vườn Xanh → checkout vẫn thấy số cũ: hoặc không chọn được
   cách trả tiền vừa nạp, hoặc chọn được rồi BE từ chối. → đọc từ query `['wallet']`/`['loyalty']`
   (được invalidate sau mọi thao tác tiền) + bổ sung invalidate còn thiếu ở checkout/game.
5. **P0 (B2C) — hoa hồng "có thể rút" là ngõ cụt.** Thẻ chỉ để đọc, nằm ngay cạnh "Ví: 0đ";
   bấm Rút thì báo chưa đủ mốc, không chỗ nào nói phải sang trang CTV bấm "Nhận về ví".
   → thẻ thành nút dẫn sang `/affiliate` kèm dòng gợi ý.
6. **P1 (B2C) — vòng đánh giá đứt cả hai đầu.** Nhận hàng xong không có lối nào để đánh giá
   (OrderItem không lưu slug nên từ đơn không mở được trang SP), trong khi nút "Viết đánh giá"
   ở trang SP lại mở cho MỌI user đăng nhập — khách chưa mua upload 3 ảnh + 1 video xong mới
   bị từ chối. → thêm cột `OrderItem.productSlug` (4 nơi tạo đơn đều ghi, migration backfill),
   nút đánh giá từng món trên đơn DELIVERED, và endpoint `GET .../reviews/can-review` để FE hỏi
   TRƯỚC khi mở ô soạn.
7. **P1 (B2C) — cùng 1 sản phẩm hiện 2 giá trên cùng màn hình.** Dải "Ưu đãi giờ vàng" hiện giá
   flash, lưới bên dưới hiện giá thường vì `ProductCard` không biết flash là gì. Bấm thẻ flash
   còn làm mất `variationId` → mở PDP ra giá thường, không badge, không đếm ngược.
   → thẻ đọc chung query flash (không thêm request), truyền `variationId` qua state, PDP mở
   đúng phân loại đang giảm.
8. **P1 (B2C)** — thông báo giờ vàng là ngõ cụt (không có nút đi tiếp) + gọi sai tên
   ("Flash Sale" vs "Ưu đãi giờ vàng" trong app); `/notifications` không chờ auth nên mở từ push
   là kẹt màn lỗi; danh sách đơn thiếu tab "Chờ thanh toán"; chuông trang chủ không có badge.
9. **P1 (CTV)** — bộ sưu tập không đổi tên/xoá được (API có sẵn, FE không gọi) và tạo mới bị
   hardcode tên "Bộ sưu tập mới"; builder không hiện nháp/đã đăng nên "Xem trước" lúc còn nháp
   rơi vào màn lỗi; portal web nuốt lỗi đổi trạng thái đơn (không onError, không disable) và
   thiếu địa chỉ giao trong bảng đơn (không ghi được vận đơn).
10. **P2** — chi tiết đơn gộp điểm Xanh vào "Giảm giá" (nay tách dòng), thiếu nhãn `XU`, nút
    ghi "Về trang chủ" nhưng đi tới danh sách đơn; checkout hứa "+điểm Xanh" cho đơn trả bằng
    xu (BE luôn cho 0); nhãn "Hoàn tiền đang chờ" ≠ danh sách "Chờ duyệt" ngay dưới.

## Phase 4 — Tầng component nền (bước 4 của prompt gốc)

Dựng `components/ui/primitives.tsx` + `price.tsx`: `Txt` (tone đặt theo Ý NGHĨA), `Stack`/`Row`,
`Card`, `Btn` (vùng chạm tối thiểu bake sẵn, loading ⇒ disabled), `Badge`, `Chip`,
`SectionHeader`, `StickyActionBar` (tự chừa safe-area), `ListRow`, `Price`/`DiscountPct`.
Bật test DOM cho miniapp (`environmentMatchGlobs` → jsdom cho `.spec.tsx`; test logic vẫn chạy
node cho nhanh) — 18 test cho chính những chỗ dễ sai thầm lặng: phân biệt tone, chiều cao vùng
chạm, safe-area, `aria-pressed`, làm tròn % giảm.
**CHƯA chuyển trang nào sang primitive** — làm theo lô để soi được từng màn.

## Phase 6 — Đo hiệu năng (bắt đầu)

Bật `log_min_duration_statement=0` trên Postgres thật, đếm số câu SQL mỗi endpoint rồi tắt lại:
`/products` 3 · `/feed` 7 · `/cart` 6 · `/orders` 2 · `/me/coins` 5 · `/game/profile` 7 ·
`/me/wishlist` 1 · `/categories` 1.

**Kết luận (đã kiểm lại):** KHÔNG có N+1 trên các đường đọc nóng. Ban đầu tôi ghi
"`SystemConfigService` không cache" vì thấy `/game/profile` đọc `system_configs` 6 lần — **ghi
nhận đó SAI**. Gọi lại endpoint 3 lần liên tiếp: lần 1 = 6 truy vấn, lần 2 và 3 = **0**. Service
đã có cache in-memory TTL 60s theo từng key; 6 truy vấn chỉ là cold-start cho 6 key khác nhau,
đúng như thiết kế. Các endpoint còn lại cũng dùng `findMany` gom `in: [...]` chứ không truy vấn
theo từng dòng (đã đọc `catalog.service.ts`, `community-feed.service.ts`).

Còn đáng làm ở Phase 6: đo lại trên DB có DỮ LIỆU THẬT (DB dev gần như rỗng nên số đo chỉ phản
ánh chi phí cố định, không lộ được chỗ tăng theo N), và đo kích thước bundle FE.

## Verify cuối lượt

`pnpm typecheck` 5/5 · `pnpm lint` 5/5 · API **93 suite / 1354 test** · miniapp **9 file /
61 test** · 6 migration mới đã áp sạch trên DB local · smoke test API thật:
`can-review` trả `NOT_PURCHASED` cho SP chưa mua, 404 cho SP không tồn tại.

---

# Phiên 2026-09-12 — đóng nốt các phát hiện mạch lạc

Mọi phát hiện của hai lượt audit mạch lạc (B2C và CTV) đã được sửa, trừ P0-3 (Pancake ghi đè
tồn kho) vẫn chờ một dữ kiện bên ngoài — xem `docs/2026-09-11-P0-3-pancake-stock-decision-brief.md`.

## Số nghiệp vụ không còn chép cứng ở FE

`GET /config/public` nay trả thêm `subscribeDiscountPct`, `affiliateWalletMultiplier`,
`affiliateMinWithdrawBank`. Hook dùng chung `hooks/use-public-config.ts` trả kèm `isLoaded` để
màn nào HỨA một con số cụ thể với khách (ngưỡng freeship ở trang sản phẩm) chờ dữ liệu thật
thay vì hiện giá trị mặc định. Đã thay: "tiết kiệm 12%" (3 nơi), "Ví Tubu ×1.5" và "tối thiểu
50k" (mô tả quyền lợi, chip chọn phương thức, điều kiện hợp lệ của form rút, nhãn số tiền trên
nút). Giá trong Vườn Xanh (vé giữ lửa, gói nước, cây thật) đọc từ `/game/profile`.

## Lỗi tiền

- **Thanh toán tập con bị mất khi tải lại trang.** Lựa chọn "thanh toán món nào" chỉ nằm trong
  navigation state; Zalo Mini App tải lại trang là mất, màn thanh toán âm thầm chuyển sang TOÀN
  GIỎ. Nay ghi nhớ ở sessionStorage + đối chiếu lại với giỏ thật (`utils/checkout-selection.ts`,
  9 test).
- **Huỷ đơn đại lý "Ghi công nợ" không đảo sổ.** `DealerCreditLedger` giữ nguyên khoản nợ của
  một đơn không còn tồn tại, và khoản nợ ảo đó ăn vào hạn mức nên chặn luôn các đơn sau. Nay
  `OrderReversalService` ghi dòng đối ứng âm (`refType='ORDER_CANCEL'`, idempotent nhờ unique
  `(userId, refType, refId)`) — chạy cho mọi lối đưa đơn về CANCELLED/RETURNED.
- **27 nút chỉ có `loading` không chặn được cú chạm thứ hai.** zmp-ui `Button` gọi `onClick` kể
  cả khi `loading` bật (đã đọc `node_modules/zmp-ui/cjs/components/button/index.js`); chỉ
  `disabled` mới chặn. Đã thêm `disabled` cho cả 27, kèm test quét mã nguồn
  (`components/ui/button-guard.spec.ts`) để lỗi không quay lại ở nút mới.

## Tính năng có BE mà thiếu UI

- **Hồ sơ gian hàng CTV** (avatar/ảnh bìa/lời nhắn) và **lý do giới thiệu từng sản phẩm** —
  hai nhiệm vụ "Hành trình gian hàng" (2.000 + 1.500 xu) trước đây KHÔNG THỂ hoàn thành vì
  builder không có ô nhập, dù trang gian hàng công khai đã render sẵn cả bốn trường.
- **`BrandPromotion.couponCode`** có trong schema và trong payload công khai nhưng không màn
  nào nhập hay hiện — banner "MUA 2 TẶNG 1" là lời quảng cáo không hành động được. Nay chủ nhãn
  nhập được mã, trang nhãn hiện mã chạm-để-chép.
- **Chủ nhãn không xem trước được trang nhãn**; **đơn đại lý không bấm được** nên đơn "Trả
  trước" (PENDING_PAYMENT/BANK_TRANSFER) không có đường nào tới màn QR.
- **Bộ nội dung bán hàng** chỉ mở được từ trình dựng gian hàng — nay có ở trang sản phẩm cho CTV.

## Mạch lạc

Một huy hiệu giỏ hàng duy nhất (`components/ui/cart-badge.tsx`) thay vì hai màu; một bảng nhãn
trạng thái đơn (`vi.orderStatus`) thay vì hai bảng lệch nhau ở DELIVERED; một bộ từ vựng cho
hoa hồng ("Đang chờ" ở cả thẻ tổng lẫn từng dòng); `['coupons']` là queryKey duy nhất cho
`/me/coupons`; khoá học Học viện có URL riêng nên nút back của Zalo quay về danh sách và gửi
link được; ô tìm kiếm ở Trang chủ mở thẳng bàn phím ở ô thật bên `/browse`.

## Verify

`pnpm typecheck` 5/5 · `pnpm lint` 5/5 · API **93 suite / 1360 test** · miniapp **11 file /
83 test**. 7 commit đã push `origin/main`.

## Lượt audit thứ hai (5 mảng chưa từng soi) — 2026-09-12

Chạy 5 agent audit đọc-chỉ-đọc, mỗi phát hiện bắt buộc kèm file:dòng + trích đoạn: nhân sự/HRM,
cộng đồng, cashback + quản trị, tác vụ nền + thông báo, và ứng dụng web Next.js. Mọi phát hiện
dưới đây đã được TỰ KIỂM CHỨNG lại trong code trước khi sửa (agent có thể bịa; artifact máy
kiểm được mới tin).

### Tiền
- **Chấm công ca chưa tới.** `checkin` nhận bất kỳ ca đã duyệt nào, không xét giờ → checkin vào
  ca NGÀY MAI lúc 17:05 hôm nay, cron chỉ đóng phiên khi quá giờ hết ca ⇒ 9 giờ công cho một
  ngày không đi làm. Nay phải nằm trong cửa sổ của chính ca (`attendance.checkin_early_min`).
- **Đơn giá lương áp ngược quá khứ.** `recomputeDay` luôn đọc rate hiện tại, `recomputeStaffMonth`
  tính lại mọi ngày ⇒ đổi đơn giá ngày 11 định giá lại cả 10 ngày đã làm. Nay khoá theo ngày;
  định giá lại phải có chủ đích (`reprice=1`).
- **Phạt huỷ ca chưa bao giờ bị trừ.** `net` kẹp ≥ 0 theo TỪNG NGÀY, ngày huỷ ca gross = 0 ⇒ phạt
  bị nuốt; bảng lương hiện "Phạt: 30.000" cạnh "Thực nhận" không đổi. Nay kẹp ở mức THÁNG.
- **Đơn vị config không có biên.** `cashback.merchant_user_share` là phân số 0.7 nhưng mô tả ghi
  "70%" — gõ 80 là nhân payout ~114 lần, gõ số âm là trừ ngược ví. Nay có bảng biên theo từng khoá.
- **Huỷ đơn đại lý không đảo sổ công nợ** (đã nêu ở phần trên).
- **Postback cashback bị vứt im lặng** khi hoa hồng lẻ hoặc số gửi dạng chuỗi; **một event hỏng
  giết cả lô đối soát**; **settleConfirmed nạp không giới hạn** kèm JSON payload.
- **Farm xu cộng đồng trên bài chưa duyệt** (đã nêu ở phần trên).

### Khoá cứng / ngõ cụt
- Admin **tự hạ quyền chính mình** hoặc hạ **admin cuối cùng** → khôi phục chỉ bằng SQL.
- Bảng lương **FINALIZED là ngõ cụt**: không có đường về OPEN, mà sửa giờ vẫn ghi đè PayrollDay
  trong khi tổng tháng đứng yên. Nay có `reopen` + chặn ghi khi tháng đã khoá.
- **Cashback kẹt PENDING vĩnh viễn**: không có endpoint admin nào, reconcile tắt khi thiếu API
  key. Nay có `GET/POST /admin/cashback/transactions` + tab "Hoàn tiền sàn ngoài" ở portal web.
- **Đơn đẩy Pancake hỏng không đẩy lại được**: `jobId=orderId` + BullMQ giữ job hash sau khi
  xong/thất bại ⇒ `add()` là no-op, cron cứu hộ in log mãi mà không chạy gì.

### Dữ liệu nói sai sự thật
Thẻ sản phẩm web khoe ★5.0 cứng · trang chủ hứa "hoàn tiền nếu không hài lòng" rộng hơn chính
sách thật · đếm bình luận tính cả bình luận đã gỡ · thông báo in nguyên văn mã template ·
`heartbeat_stale_min` mô tả "auto checkout" nhưng không được dùng · admin duyệt hoàn tiền mà
không thấy số tiền đang hoàn.

### Lạm dụng
Nộp bài sự kiện sau hạn · thả tim cho bài chưa duyệt · báo cáo vi phạm với id bịa (không kiểm
tra, không chống trùng) · không có giới hạn tốc độ riêng cho đăng bài/bình luận · voucher tạo từ
web luôn không giới hạn lượt và không trần giảm · CSV xuất đơn chạy công thức Excel từ ghi chú
của khách · `/cashback/merchants` công khai lộ deeplink affiliate và fullRate.

### Web
Mở `/merchant` lúc đã đăng nhập gây đua refresh token ⇒ BE coi là reuse ⇒ **thu hồi toàn bộ phiên
của user** (văng khỏi cả web lẫn Mini App) · web mất sạch attribution gian hàng CTV và không áp
combo · robots/sitemap/noindex chưa có · ngày hiệu lực voucher lệch 7 tiếng do parse UTC.

### Còn lại (chưa làm)
Phân trang bình luận · `viewCount` ghi DB mỗi lượt xem · `eventPosts` giới hạn cứng 20 · nhắc
game/price-drop/recalcAllTiers chưa phân trang · claim-rồi-gửi làm mất thông báo khi gửi lỗi ·
admin thêm phiên chấm công chồng giờ · sửa phiên qua đêm ở màn admin · lịch sử chấm công của
"Lương của tôi" lấy biên UTC · `copyWeek` copy cả ca đã bị từ chối · chưa có sổ ghi vết đổi
trạng thái đơn · web chưa dùng được voucher/Điểm Xanh khi thanh toán · refresh token vẫn ở
localStorage (cần httpOnly cookie).

## Phase 6 — đo kích thước bundle Mini App (2026-09-12)

`pnpm --filter @tubutree/miniapp build`:

- Vendor chung: **498 kB thô / 156 kB gzip** — đây là con số quyết định thời gian mở app lần đầu.
- Mọi route đều tách chunk riêng nhờ lazy: lớn nhất là Vườn Xanh 36 kB (9,8 kB gzip), trang sản
  phẩm 28 kB (8,9 kB gzip), CTV 29 kB (8,3 kB gzip). Phần còn lại 3–7 kB gzip mỗi trang.

**Kết luận: không cần can thiệp.** 156 kB gzip cho React + ReactDOM + zmp-ui + router là mức
bình thường, và việc tách route đã làm tốt — mở một trang bất kỳ chỉ tải thêm dưới 10 kB. Chưa
tìm thấy thư viện nặng nào bị kéo vào nhầm (kiểm chuỗi trong bundle: không có recharts/framer;
lucide-react được tree-shake theo từng icon).

## Tự review lại diff của chính phiên (2026-09-12)

Sau khi sửa xong, chạy hai agent đọc lại TOÀN BỘ diff của phiên (145 file, +5400/−598) với yêu
cầu tìm **regression do chính đợt sửa gây ra**, không liệt kê lại lỗi cũ. Mỗi phát hiện đều được
tự kiểm chứng trong code trước khi sửa — agent có thể bịa, artifact máy kiểm được mới tin.

**11 lỗi do chính đợt này gây ra, đã sửa hết.** Đáng chú ý:

- **Tính năng vừa thêm không dùng được:** ô "Dùng Điểm Xanh" trên web KHÔNG BAO GIỜ hiện vì số dư
  lưu bằng `useRef` — ghi vào ref không kích hoạt render, mà render có quote chính là render cuối
  của luồng khởi động.
- **Sửa một lỗi tiền, tạo ra lỗi tiền khác:** nhánh suy-ngày-hôm-sau cho ca qua đêm dùng `co <= ci`
  (có dấu bằng); ô giờ ra của phiên đang mở được khởi tạo bằng đúng giờ vào, nên "Lưu giờ" ghi
  thành ca **24 tiếng** và payroll trả tiền cho ngần ấy.
- **Guard đặt sai lớp:** chặn sửa tháng đã chốt nằm ở `recomputeDay`, chạy SAU lần ghi và không
  chung transaction — phiên đã đổi trong DB rồi API mới trả 400.
- **Bịt lỗ này, mở lỗ kia:** `enqueuePush` xoá job cũ bất kể trạng thái; nhưng `pushOrder` chỉ ghi
  `pancakeOrderId` khi Pancake TRẢ VỀ id, nên đơn đã tạo mà response thiếu id sẽ bị cron cứu hộ
  đẩy lại **mỗi 15 phút, vô thời hạn** → đơn trùng ở kho vật lý.
- **Comment nói sai sự thật:** tôi ghi "ANSWER + BEST_ANSWER đều theo refId = commentId" trong khi
  BEST_ANSWER ghi theo postId — gỡ bình luận chỉ đảo được một nửa số điểm, và vì `removeComment`
  đặt `bestCommentId = null` nên vòng chọn–gỡ–chọn lại farm được điểm.
- **Khoá quá rộng:** đưa `updateMany` không điều kiện vào transaction để đạt tính nguyên tử, nhưng
  nó khoá MỌI dòng `products` suốt transaction — đủ chặn cron đồng bộ Pancake cùng nổ lúc 03:00.
- **Chặn nhầm luồng hợp lệ:** kiểm chồng giờ coi phiên chưa đóng là vô hạn (chặn đúng tình huống
  quản lý cần bù giờ); đóng sổ nhắc giờ vàng theo `isActive` (admin tắt sale 30 phút để sửa giá là
  mất sạch nhắc); nút "Kiểm tra" ở màn chuyển khoản bị disable theo nhịp poll nền 4 giây.

Bài học ghi lại cho phiên sau: **mọi guard phải đặt ở lớp GHI, không phải lớp tính lại sau đó**;
và sau một đợt sửa lớn thì đọc lại diff của chính mình là bước bắt buộc, không phải tuỳ chọn.

## Đóng nốt hai việc chặn của phiên (2026-09-12, lượt sau)

Hai mục "cần người quyết" trong runbook đã xử lý xong bằng code; chỉ còn API key và một vòng bấm
tay trên Zalo thật là thực sự cần người.

### P0-3 — tồn kho Pancake: thoát thế bí bằng thiết kế đúng với CẢ HAI câu trả lời

Hai phiên trước dừng ở câu hỏi *"Pancake có tự trừ `remain_quantity` khi ta tạo đơn qua API
không?"* và soạn hai hướng sửa tuỳ theo câu trả lời. Lượt này bỏ hẳn câu hỏi đó: có một thiết kế
cho ra số đúng ở cả hai trường hợp.

Thêm `Variation.pancakeStock` (số Pancake báo lần gần nhất) và `Variation.reservedStock` (số ta
đã bán mà Pancake chưa phản ánh). `stock` **giữ nguyên** nghĩa "tồn kho bán được", nên **không
một chỗ đọc nào phải sửa** — khác hẳn "Hướng 2" trong brief vốn đòi đổi mọi nơi hiển thị/kiểm
tồn sang `stock - reservedStock`. Đồng bộ nhả phần GIẢM của số Pancake khỏi giữ chỗ rồi đặt
`stock = số mới − giữ chỗ còn lại`:

- Pancake CÓ tự trừ ⇒ số giảm đúng bằng đơn của ta ⇒ giữ chỗ nhả hết ⇒ không trừ hai lần.
- Pancake KHÔNG tự trừ ⇒ số đứng yên ⇒ giữ chỗ còn nguyên ⇒ không hồi sinh hàng đã bán.

Ba thao tác gói trong `catalog/variation-stock.ts`, mỗi thao tác là MỘT câu `UPDATE` (không có
khe hở đọc-rồi-ghi giữa checkout và cron 15 phút). Webhook `variation.stock_changed` — cùng lớp
lỗi, trước đây cũng ghi tuyệt đối — nay dùng chung công thức. Bỏ luôn chế độ `skipStock` vì quét
toàn bộ lúc boot không còn nguy hiểm.

Dữ liệu cũ để `pancakeStock = NULL`: lượt sync đầu sau deploy CHỈ ghi mốc, không đụng `stock`,
nên không có cú đặt lại tồn kho hàng loạt ngay sau khi lên bản mới.

**Kiểm chứng trên Postgres thật, 11/11 kịch bản** (không phải mock): có tự trừ · không tự trừ ·
sync hai lần không cộng dồn · nhập thêm hàng · huỷ đơn sau khi giữ chỗ đã nhả (kẹp ở 0, không
âm) · dữ liệu cũ chỉ ghi mốc · hết hàng thì 0 dòng bị sửa · số Pancake tụt sâu thì `stock` kẹp 0.

### Phát hiện thêm khi làm P0-3: đơn đại lý in ra tồn kho

`DealerService.placeOrder` là đường tạo đơn DUY NHẤT không trừ kho, nhưng đường huỷ đơn dùng
chung `OrderReversalService` thì CỘNG kho cho mọi item. Đặt một đơn đại lý rồi huỷ là tạo tồn
kho từ không khí; trước lúc huỷ thì khách lẻ vẫn thấy hàng đã bán cho đại lý là "còn". Nay trừ
kho như mọi đường khác (test đỏ trước khi sửa). Đổi hành vi: đơn đại lý vượt tồn bị từ chối —
ghi trong runbook mục 4.2 để chủ shop quyết có cần cơ chế đặt-trước riêng không.

### Refresh token của web: localStorage → cookie HttpOnly

Refresh token sống 30 ngày và đổi được thành access token bất cứ lúc nào, nên một lỗ XSS ở web
là mất tài khoản vĩnh viễn — đổi mật khẩu cũng không cứu vì token đã bị copy đi. Nay BE set
cookie `HttpOnly; Secure; SameSite` (`refresh-cookie.ts`), JS không đọc được kể cả JS của mình.

Ba điểm thiết kế đáng ghi:

1. **Mini App không đổi.** Chế độ cookie chỉ bật khi client gửi `x-client: web`; webview Zalo là
   origin khác và không giữ cookie bên thứ ba ổn định nên vẫn nhận token trong thân response.
2. **Header đó cũng là lớp chống CSRF.** Cookie chỉ được ĐỌC khi có header tuỳ biến, mà header
   tuỳ biến ép trình duyệt preflight và preflight bị CORS allowlist chặn. Không có lớp này thì
   (với `SameSite=None` khi web và API khác site) một trang lạ ép được nạn nhân xoay token.
3. **Web vẫn cần biết "có phiên không"** ở lần render đầu mà không đọc được cookie thật, nên có
   thêm cờ `tubu_web_session=1` — cookie thường, không chứa bí mật. Refresh hỏng thì BE xoá cả
   hai, web xoá nốt cờ, để không thử khôi phục vô hạn mỗi lần mở trang.

Deploy sẽ **đăng xuất toàn bộ phiên web hiện có** (token cũ ở localStorage, code mới không đọc
nữa) — runbook mục 4.1, kèm hai biến env mới `AUTH_COOKIE_SAMESITE` / `AUTH_COOKIE_DOMAIN`.
