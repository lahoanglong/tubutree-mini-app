# Analytics nền (dự án con 2) — Design

Ngày: 2026-09-27. Trạng thái: đã duyệt thiết kế (Lã Hoàng Long). Dự án con 2 trong lộ trình
"hoàn thiện xuất sắc" (xem memory `project_excellence_roadmap`). Input: audit
`docs/audit-2026-09/07-tech-analytics.md` mục 7 + `00-MASTER-SUMMARY.md` mục "Nền tảng cho
analytics (dự án con 2)". Số dòng tham chiếu trong audit theo commit `1e7fda7`; nhánh hiện tại
`feat/complete-wip-2026-09` đã có thêm 2 commit P0 (`2c59b2e`, `4d91cbc`) — **verify lại dòng lúc
viết code**, không tin số dòng ở tài liệu này là tuyệt đối.

## Mục tiêu

Dựng hạ tầng đo north-star (**% khách có đơn 2 trong ≤30 ngày**, đơn/khách/tháng) và các KPI phễu/
retention đi kèm, để mọi quyết định ở dự án con 3–8 (Design System, redesign, CTV/đại lý, hardening)
so được trước/sau. Hiện trạng: **0 SDK analytics, 0 request log**, số liệu CTV duy nhất đang có
(`totalConversions`) sai (luôn = 0). Không làm việc này trước thì mọi con số retention sau redesign
đều là đoán.

## Hiện trạng liên quan (đã xác minh lại trong phiên này, không chỉ dựa vào audit)

- **A7-01 (phiên khách bị đổi tài khoản) ĐÃ VÁ** ở batch P0 trước (commit `2c59b2e`,
  `apps/api/src/modules/auth/auth.service.ts:145-352`): `ensurePhoneForCurrentUser()` tự nâng cấp
  tại chỗ hoặc gộp (`mergeGuestInto()`) khi phiên khách xác thực được danh tính Zalo đã tồn tại/mới.
  Từ nay một thiết bị luôn hội tụ về **một** `userId` khi khách xác thực Zalo — không cần làm lại
  phần gộp danh tính, chỉ cần dựa vào `userId` (đã gộp) cho analytics.
- `Order` (`schema.prisma:799-866`) hiện có `type` (RETAIL/DEALER), `placedForCustomer` (Boolean),
  `paymentStatus` (UNPAID/PAID/REFUNDED/FAILED), `deliveredAt`, nhưng **chưa có** `source`,
  `platform`, `paidAt`, `subscriptionId`, `endCustomerKey` — đúng 5 khiếm khuyết audit đã nêu.
- `RefreshToken` (`schema.prisma:288-299`) không có cột `deviceId` riêng — guest dùng
  `zaloId = guest_<deviceId>` nên deviceId đã nằm trong `User.zaloId` của tài khoản khách, không
  cần thêm cột mới cho việc này.
- Game (điểm danh vườn, tưới cây, quay) hiện chỉ ghi đè (`lastCheckInAt`/`lastWateredAt`) — không
  có lịch sử. Audit đề xuất thêm bảng lịch sử riêng cho game; **thiết kế này thay bằng cách khác**
  (xem "Quyết định kiến trúc" bên dưới) — không sửa game module.

## Quyết định nghiệp vụ (chốt trong phiên brainstorming 2026-09-27)

1. **Đơn CTV "lên đơn hộ"**: tính vào north-star cho **khách nhận hàng**, quy theo
   `endCustomerKey` (hash SĐT người nhận), không tính cho CTV.
2. **Đơn đại lý (DEALER)**: **loại khỏi** north-star — kênh B2B khác bản chất mua lẻ.
3. **Mua tại quầy (POS, `pos_point_credits`)**: **có tính** là một đơn hợp lệ trong north-star.
4. **Gộp guest→Zalo**: tự động theo thiết bị — **đã có sẵn** (xem mục trên), không cần quyết định
   thêm cho dự án con này.
5. **Mốc "30 ngày"**: tính từ lúc **đặt đơn** (không phải lúc giao).
6. **"Khách"**: là **người**, gộp theo SĐT chuẩn hoá (không phải theo tài khoản thuần).
7. **Dashboard MVP**: trang mới trong `apps/web` admin, tính theo **lô hằng ngày** (batch đêm),
   không real-time.
8. **Lưu trữ sự kiện thô**: giữ **13 tháng** trước khi cân nhắc nén/xoá.

`customer_key` áp dụng thống nhất cho mọi tính toán north-star/retention:

```
customer_key =
  nếu order.placedForCustomer && order.endCustomerKey không rỗng → order.endCustomerKey
  else nếu user.phone không rỗng → normalizePhone(user.phone)
  else → order.userId
```

Đơn hợp lệ cho north-star = `type = RETAIL AND status NOT IN (CANCELLED, RETURNED)` — vẫn giữ cả
đơn `placedForCustomer = true`, chỉ đổi cách **quy về ai** (qua `customer_key`) chứ không loại đơn
đó ra. Đơn POS (`pos_point_credits`) được gộp thêm vào chuỗi đơn theo `customer_key` ở bước tính
(không phải bảng `orders`, xem "Bảng tổng hợp" bên dưới).

## Quyết định kiến trúc: giao sự kiện

| | **Ghi trong transaction (chọn)** | Outbox + worker riêng | Gọi thẳng SaaS ngoài (PostHog/Segment...) |
|---|---|---|---|
| Cách làm | Ghi 1 dòng `analytics_events` **cùng transaction Prisma** với nghiệp vụ | Bảng `outbox` + cron/queue đẩy sang nơi khác | Gọi SDK ngoài sau khi commit |
| Không mất sự kiện | Có, atomic với đơn/tiền | Có, nhưng thêm một lớp vận hành (queue, retry, dedup) | Không — lỗi mạng sau commit là mất, không dò lại được |
| Phù hợp quy mô | Đúng — một Postgres, VPS, chưa cần queue | Overkill cho quy mô hiện tại | Vi phạm quyết định roadmap ("tự xây trong BE"); dữ liệu tiền/khách ra ngoài biên giới, đụng Nghị định 13/2023 |

**Chọn ghi trong transaction.** Sự kiện tiền/đơn/sổ cái (10 sự kiện nguồn BE) ghi thẳng vào
`analytics_events` trong transaction Prisma sẵn có của nghiệp vụ đó (append thêm 1 lệnh `tx.
analyticsEvent.create()` vào transaction hiện có — không transaction mới, không lời gọi async
rời). Sự kiện ý định/hiển thị (8 sự kiện nguồn FE) gửi qua `POST /events` gộp lô, best-effort,
không cần atomic vì không phải tiền.

## Data model

### Bảng sự kiện thô

```prisma
model AnalyticsEvent {
  id            String   @id @default(cuid())
  eventId       String   @unique // uuid do nơi phát sinh — chống trùng khi FE gửi lại lúc retry
  eventName     String
  occurredAt    DateTime // thời điểm nghiệp vụ xảy ra (BE: lúc transaction; FE: lúc client ghi nhận)
  receivedAt    DateTime @default(now()) // thời điểm BE nhận (lệch với occurredAt nếu FE gửi trễ/gộp lô)
  userId        String?
  anonymousId   String? // tubu_device_id — có cả khi đã đăng nhập, để nối phiên trước/sau login
  sessionId     String?
  platform      String // miniapp | web | admin | pos | system
  appVersion    String?
  entrySource   String? // organic | zns | oa | inapp_notification | share_product | share_referral | ctv_storefront | brand_page | qr
  notificationId String?
  refCode       String?
  storefrontSlug String?
  props         Json // thuộc tính riêng của từng loại sự kiện (xem bảng 18 sự kiện)

  @@index([eventName, occurredAt])
  @@index([userId, occurredAt])
  @@index([anonymousId])
  @@map("analytics_events")
}
```

Không partition theo tháng ở MVP — quy mô hiện tại (VPS, vài nghìn đơn/tháng) chưa cần; ghi chú lại
để dự án con 8 (hardening) xét lại nếu số dòng vượt vài triệu.

### Cột mới trên `Order`

```prisma
// trong model Order, thêm:
source          String?   // checkout | buy_now | repurchase | subscription | ctv_assisted | dealer | pos
platform        String?   // miniapp | web | pos — null cho đơn cũ (không backfill được chính xác)
paidAt          DateTime? // lúc paymentStatus chuyển sang PAID — set tại nơi lật trạng thái, không suy ra từ updatedAt
subscriptionId  String?   // gắn khi đơn được tạo từ subscriptions.service chạy kỳ
endCustomerKey  String?   // hash SĐT người nhận — CHỈ set khi placedForCustomer = true
```

Cả 5 cột nullable, migration additive — deploy không cần backfill trước, không chặn ghi đơn mới.

### Bảng tổng hợp (đọc bởi dashboard, ghi bởi cron đêm)

```prisma
model RetentionDailySnapshot {
  date                 DateTime @id // 00:00 giờ VN của ngày snapshot
  newBuyers            Int // số customer_key có đơn hợp lệ ĐẦU TIÊN trong ngày
  activeBuyers         Int // số customer_key có ≥1 đơn hợp lệ trong ngày
  ordersCount          Int
  ordersPerBuyerMtd    Decimal // NS-2 luỹ kế từ đầu tháng chứa `date`
  dauProxyRefreshToken Int // COUNT DISTINCT userId trong refresh_tokens của ngày (proxy tạm)
  dauEventBased        Int? // COUNT DISTINCT (userId ?? anonymousId) của app_opened — null tới khi đủ dữ liệu
  computedAt           DateTime @default(now())

  @@map("retention_daily_snapshot")
}

model CohortRepeatSnapshot {
  id                  String   @id @default(cuid())
  cohortMonth         DateTime // ngày 1 đầu tháng của cohort (tháng có đơn ĐẦU TIÊN)
  newBuyersInCohort   Int
  repeat30dCount       Int
  repeat30dComplete    Boolean // cohort đã đủ 30 ngày tuổi để số này đáng tin
  repeat60dCount       Int
  repeat60dComplete    Boolean
  repeat90dCount       Int
  repeat90dComplete    Boolean
  medianDaysToSecondOrder Decimal?
  computedAt           DateTime @default(now())

  @@unique([cohortMonth])
  @@map("cohort_repeat_snapshot")
}

model FunnelDailySnapshot {
  id          String   @id @default(cuid())
  date        DateTime
  step        String // app_opened | product_viewed | add_to_cart | checkout_started | order_placed | order_paid | order_delivered
  entrySource String? // null = gộp mọi nguồn
  count       Int

  @@unique([date, step, entrySource])
  @@map("funnel_daily_snapshot")
}
```

Cron đêm (`analytics-aggregation.service.ts`, chạy sau nửa đêm giờ VN) tính lại snapshot của **hôm
qua** từ `orders` + `analytics_events` + `pos_point_credits`, ghi đè (upsert) — không tính real-time
lúc xem dashboard (đúng quyết định #7). `CohortRepeatSnapshot` tính lại **mọi** cohort chưa đủ tuổi
mỗi đêm (số nhỏ, rẻ) cộng cohort vừa đủ mốc 30/60/90 ngày hôm đó.

## 18 sự kiện tối thiểu

Giữ nguyên danh sách + thuộc tính + KPI đã soạn ở audit `07-tech-analytics.md` §7.4 (bảng 18 sự
kiện, phong bì chung, KPI→sự kiện→đòn bẩy) — không lặp lại toàn văn ở đây, xem file đó làm nguồn
tham chiếu khi viết plan/code. Khác biệt duy nhất so với audit: sự kiện `engagement_action` (điểm
danh/tưới/quay) **thay thế hoàn toàn** cho việc thêm bảng lịch sử riêng ở game module — bản thân
dòng sự kiện trong `analytics_events` chính là lịch sử (mỗi lần điểm danh/tưới ghi 1 dòng
`engagement_action`, không cần sửa `game-economy.service.ts`/`game.service.ts` để giữ history).

Điểm phát BE (10 sự kiện, ghi trong transaction sẵn có — xem file:line trong audit §7.4 để định vị,
verify lại lúc code): `add_to_cart` (cart.service), `checkout_started`/`order_placed`/
`order_place_failed` (checkout.service), `order_paid` (zalopay.service, pancake.processor,
dealer.service, hoặc lúc COD→DELIVERED), `order_status_changed` (order-status.service),
`notification_sent` (notifications.service), `subscription_changed` (subscriptions.service),
`engagement_action` (game-economy/game/loyalty/feed/reviews/flash-sale service), `coupon_applied`
(cart.service + CouponRedemption), `referral_touched` (affiliate.service).

Điểm phát FE (8 sự kiện, qua `POST /events` gộp lô): `app_opened`, `screen_viewed`,
`product_viewed`, `search_performed`, `checkout_started` (bản ghi ý định — trùng tên với bản BE ở
bước quote thành công đầu tiên, khác nguồn), `notification_opened`, `share_clicked`,
`client_error`.

## Module & luồng dữ liệu

- `apps/api/src/modules/analytics/` (mới): `analytics-events.service.ts` (hàm `record(tx, event)`
  gọi từ trong transaction của module khác — không phụ thuộc ngược, các module khác import service
  này), `analytics.controller.ts` (`POST /events` nhận lô ≤50 từ FE, throttle theo `X-Device-Id`
  header — KHÔNG dùng hạn mức 60/phút/IP mặc định của `@nestjs/throttler`, tránh lặp lỗi A7-02),
  `analytics-aggregation.service.ts` (cron đêm), `analytics-admin.controller.ts` (API đọc snapshot
  cho web admin, bảo vệ bằng RBAC admin — theo đúng pattern các controller admin khác).
- `apps/web`: trang mới trong khu admin (menu "Analytics" hoặc "Báo cáo"), đọc snapshot đã tính sẵn
  — không query nặng lúc xem trang.
- `apps/miniapp`: `services/analytics.ts` (hàng đợi gộp lô trong bộ nhớ, flush theo interval ~10s
  hoặc đủ 50 sự kiện hoặc khi `visibilitychange`), route tracker gắn vào `<ZMPRouter>`
  (`components/app.tsx`), thêm lời gọi tại các điểm đã tồn tại sẵn (PDP, tìm kiếm, bắt đầu thanh
  toán, trang thông báo, các nút chia sẻ, error boundary + `window.onerror`/`unhandledrejection`).

**Rủi ro kỹ thuật cần xác minh lúc code** (không chặn thiết kế, nhưng ảnh hưởng cách viết
`analytics.ts` phía FE): Zalo Mini App webview có hỗ trợ `navigator.sendBeacon` đầy đủ không —
UNKNOWN, cần thử trên thiết bị thật; nếu không, fallback `fetch(..., {keepalive: true})` lúc
`visibilitychange`.

## Rollout

1. Migration additive: bảng `analytics_events` + 3 bảng snapshot + 5 cột `Order`. An toàn deploy
   ngay, không cần backfill để chạy.
2. Chạy ngay 3 câu SQL backfill có sẵn ở audit §7.2 (NS-1/repeat theo cohort, NS-2, DAU proxy qua
   `refresh_tokens`) → có baseline north-star trong tuần đầu, không cần chờ code sự kiện xong.
3. Nối 10 sự kiện nguồn BE (trong transaction sẵn có của từng module).
4. Nối 8 sự kiện nguồn FE + endpoint `POST /events` + route tracker.
5. Cron tổng hợp đêm (3 bảng snapshot) + trang dashboard admin.
6. Script backfill một lần cho 5 cột `Order` mới trên dữ liệu lịch sử (best-effort, có giới hạn ghi
   rõ trong script: `source`/`platform` suy từ `subscriptionId`/`storefrontSlug`/`type`/`note` nên
   không chính xác 100% cho đơn cũ. `paidAt` **không backfill được đáng tin cậy** cho đơn thanh
   toán online (ZALOPAY/BANK_TRANSFER/VNPAY) trước ngày migration — `order_status_history` chưa
   từng ghi lúc lật `paymentStatus`, đúng gap #4 audit đã nêu, nên không có nguồn nào để suy ngược;
   để trống, không fabricate. Riêng đơn COD: `paidAt := deliveredAt` (COD coi như thanh toán lúc
   giao) vì đó là suy luận nghiệp vụ đúng, không phải đoán.

## Kiểm thử

- Unit cho `analytics-aggregation.service` (fixture đơn giả, so số snapshot ra đúng công thức
  NS-1/NS-2/cohort).
- Integration Postgres thật cho tính atomic: giả lập rollback một transaction đặt đơn → assert
  KHÔNG có dòng `analytics_events` mồ côi cho `order_placed` đó (cùng cách test race condition
  Postgres thật đã dùng ở các dự án con trước).
- Throttle `POST /events` theo device: 2 thiết bị khác nhau không đụng hạn mức của nhau; 1 thiết bị
  gửi > giới hạn bị từ chối nhẹ nhàng (không rơi vào lỗi 429 cứng làm mất toàn bộ lô).
- Playwright cho trang dashboard admin mới (đúng quyết định "chỉ Playwright" của roadmap): trang
  tải được, hiển thị số liệu snapshot mới nhất, không crash khi chưa có dữ liệu (ngày đầu triển
  khai, snapshot rỗng).

## Ngoài phạm vi (để dự án con khác)

Sentry/GlitchTip + telemetry lỗi client đầy đủ (A7-06 — dự án con 8, hardening; `client_error` ở
đây chỉ ghi vào `analytics_events`, không phải một hệ thống theo dõi lỗi đầy đủ). Ảnh
Cloudinary/R2 (A7-07). Throttle theo Cloudflare cho `/auth/*` (A7-02 — vẫn dùng throttle theo IP cũ
cho auth, chỉ endpoint `/events` mới dùng deviceId). Mọi hạng mục UI/hiệu năng/i18n khác của báo
cáo A7 (điều hướng tức thì, bundle, a11y, câu chữ lỗi) — thuộc dự án con 5 (redesign) và 8
(hardening).

## Câu hỏi còn mở (không chặn bắt đầu, cần trả lời trước khi tính NS-1 "chính thức" cho báo cáo ra
ngoài)

- Đơn hoàn tiền sàn ngoài (Shopee/Lazada/TikTok, nếu có ghi nhận riêng) có tính là "mua lặp" không?
  Chưa thấy bảng riêng trong schema hiện tại nên tạm coi là không phát sinh — nếu về sau có, cần
  quyết định.
- 13 tháng lưu sự kiện thô: chưa quyết cơ chế xoá (cron riêng hay archive sang bảng nén) — để dự án
  con 8 thiết kế khi dữ liệu thật gần chạm mốc.
