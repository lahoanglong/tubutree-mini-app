# Cashback provider-agnostic + reconciliation — Design

Ngày: 2026-07-04. Trạng thái: đã duyệt (Lã Hoàng Long). Refactor BE (không đụng FE, không đụng money flow).

## Mục tiêu
Bóc tách AccessTrade (đang **hard-code**) trong module `cashback` ra sau một interface
`CashbackProvider` để **không lock-in vendor** — cắm nhà cung cấp thứ 2 sau này (Involve Asia,
direct Shopee…) mà không sửa lõi. Đồng thời thêm **reconciliation cron** kéo `GET /transactions`
từ provider để bắt postback rớt (dòng tiền chắc hơn, bớt phụ thuộc webhook).

Đây là **refactor** quanh code đang chạy tốt (module `cashback` đã hoàn chỉnh, có test), **không
phải build mới**. Lõi state-machine tài chính + money flow giữ nguyên hành vi.

## Bối cảnh hiện trạng (giữ nguyên)
Luồng cashback sàn ngoài đã có: `createClick` → deeplink AT → `handlePostback` (AT postback) →
state machine `PENDING → CONFIRMED → REJECTED/PAID` → `settleConfirmed` cron chuyển
`User.cashbackPending` sang `User.walletBalance` (Ví tiền thật) sau `hold_days`. Cashback của user
về **Ví tiền thật**; user tự đổi Ví→TubuXu (×1.2) hoặc rút. Thưởng **referral** là xu, trigger ở
mốc CONFIRMED (`coins.grantReferralCoins`). **Không đổi các ngữ nghĩa này.**

## 6 điểm hard-code AT cần bóc ra
1. `interface AccesstradePostback` (field `utm_content`/`order_id`/`status: pending|approved|rejected`).
2. `PostbackDto` trong controller (cùng shape).
3. Route `/webhooks/accesstrade` + header `x-accesstrade-token` + 1 env secret duy nhất.
4. `buildDeeplink` dùng convention `{{clickId}}` + `&url=` của AT.
5. `userReward = commission × merchant_user_share` (giả định 1 kiểu report).
6. `CashbackMerchant`/`CashbackTransaction` chưa có field `provider` (mặc định 1 nhà cung cấp).

## Kiến trúc: Interface + DI Registry (tag provider theo merchant)
Mỗi provider là `@Injectable` implement `CashbackProvider`, gom vào registry theo `key`; merchant
mang field `provider` → biết dùng adapter nào. Chạy được **nhiều provider song song** (đúng thực tế
multi-home). (Phương án loại: 1 provider active chọn bằng env — không cho phép đa provider, mâu
thuẫn mục tiêu.)

### Provider contract
```ts
// Sự kiện cashback đã chuẩn hoá — lõi CHỈ làm việc với cái này
interface NormalizedCashbackEvent {
  clickRef: string;         // khớp CashbackClick.utmTraceId
  merchantOrderId: string;  // id đơn của sàn (idempotency key, trong phạm vi provider)
  orderAmount: number;      // VND, ≥ 0
  commission: number;       // VND, ≥ 0
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  raw: unknown;             // payload gốc → lưu postbackPayload
}

interface CashbackProvider {
  readonly key: string;                                          // 'accesstrade'
  buildDeeplink(template: string, clickId: string, productUrl?: string): string;
  verifyWebhook(headers: Record<string, string | undefined>, body: unknown): boolean;
  parseWebhook(body: unknown): NormalizedCashbackEvent | null;   // null = sai shape → bỏ qua
  isReconcileEnabled(): boolean;                                 // AT: !!ACCESSTRADE_TOKEN
  fetchTransactions(since: Date): Promise<NormalizedCashbackEvent[]>;
}
```

### Registry + wiring
- `CashbackProviderRegistry` nhận mảng providers qua DI token `CASHBACK_PROVIDERS`, dựng
  `Map<key, provider>`; `get(key)` không thấy → `NotFoundException`.
- `CashbackModule` đăng ký `AccessTradeProvider` vào token đó. Thêm provider sau = thêm 1 class +
  1 dòng provider, **không đụng lõi**.

## Thay đổi từng phần

### Lõi service (`CashbackService`)
- `createClick()` → lookup merchant (có `provider`) → `registry.get(merchant.provider).buildDeeplink(...)`.
  Rate-limit (`cashback.click_rate_limit_seconds`) giữ nguyên.
- `handlePostback(...)` → tách thành **`ingest(event: NormalizedCashbackEvent, providerKey: string)`**:
  chính là body `handlePostback` hiện tại nhưng đọc field chuẩn hoá. Giữ nguyên toàn bộ:
  optimistic CAS atomic theo status, chống double-credit (P2002), chuyển trạng thái
  (PENDING→CONFIRMED cộng `cashbackPending`, CONFIRMED→REJECTED trừ lại), reset `confirmedAt` khi
  REJECTED→CONFIRMED, bỏ qua khi đã `PAID`, thưởng referral `coins.grantReferralCoins` (side-effect
  `.catch`) khi CONFIRMED lần đầu. `userReward = floor(commission × merchant_user_share)` giữ nguyên.
- `settleConfirmed` cron **giữ nguyên** (không đụng).

### Controller / webhook
- Route generic: `POST /webhooks/cashback/:provider` → `registry.get(provider)` →
  `verifyWebhook(headers, body)` (fail-closed ở production, y nguyên chính sách) → `parseWebhook` →
  `ingest(event, provider)`. Body là `unknown` → **provider tự validate phòng thủ** trong
  `parseWebhook` (guard số âm/sai kiểu), thay cho class-validator ở controller.
- Giữ `POST /webhooks/accesstrade` làm **alias tương thích ngược (deprecated)** trỏ cùng luồng với
  `provider='accesstrade'`.
- `AccessTradeProvider.verifyWebhook`: shared-token `x-accesstrade-token` timing-safe (như cũ).
  Interface cho phép HMAC-over-raw-body sau này (bật raw-body middleware khi cần — YAGNI giờ).

### Schema (Prisma) + migration tay
- `CashbackMerchant.provider String @default("accesstrade")`.
- `CashbackTransaction.provider String @default("accesstrade")` (set lúc ingest; phục vụ reconcile +
  báo cáo).
- Đổi unique: bỏ `merchantOrderId @unique`, thêm **`@@unique([provider, merchantOrderId])`**
  (idempotency key đúng cho đa provider). Cập nhật `findFirst`/`create`/`updateMany` kèm `provider`.
- Migration tay: thêm 2 cột default `'accesstrade'` (tự back-fill row cũ) + drop unique cũ + tạo
  composite unique. Không cần data migration.
- Seed: thêm `provider: 'accesstrade'` cho 3 merchant (Shopee/Lazada/TikTok Shop).

### Reconciliation cron (gated)
- Cron mới `reconcile()`: duyệt mọi provider; provider `isReconcileEnabled()` mới chạy, còn lại
  **log & skip** (không có `ACCESSTRADE_TOKEN` → no-op — đúng như đã chốt).
- `provider.fetchTransactions(since)` → GET `${ACCESSTRADE_BASE_URL}/.../transactions?since=`
  (Bearer `ACCESSTRADE_TOKEN`) → map `NormalizedCashbackEvent[]` → **feed lại vào `ingest()`**
  (tự idempotent nhờ composite unique + CAS). Bắt được postback rớt (tạo mới) lẫn chuyển trạng thái
  bị miss.
- `since = now − reconcile_lookback_days`.
- Endpoint/format chính xác của AT là chi tiết **gated theo tài liệu API AccessTrade**, cô lập trong
  `AccessTradeProvider.fetchTransactions` nên dễ chỉnh khi có key.

### Config (seed, chỉnh runtime)
Giữ nguyên: `cashback.merchant_user_share` (0.7), `merchant_tubu_share` (0.3), `hold_days` (30),
`click_rate_limit_seconds` (30)… Thêm:
- `cashback.reconcile_interval_hours` = 6
- `cashback.reconcile_lookback_days` = 45 (phủ hold window + biên)

### Env
Không thêm env mới. Reconcile gate bằng `ACCESSTRADE_TOKEN` (đã có, default rỗng).
`ACCESSTRADE_WEBHOOK_SECRET` vẫn bắt buộc ở production (giữ superRefine hiện có).

## Bất biến (không đổi)
- `coinsBalance == SUM(CoinTransaction.delta)`; mọi thay đổi số dư atomic bằng `updateMany` guard `gte`.
- Idempotency cashback qua composite unique `[provider, merchantOrderId]` (thay `merchantOrderId @unique`).
- Reconcile dùng chung path `ingest()` với webhook → cùng đảm bảo idempotent + không double-credit.
- Money flow: cashback user → Ví (sau hold); referral → xu (mốc CONFIRMED).

## Testing
- Di chuyển bộ test state-machine (`cashback.service.spec.ts`) sang gọi `ingest(normalized)` — đổi
  helper `payload()` (AT shape) → normalized shape; logic assert giữ nguyên (userReward, cộng/trừ
  pending, CAS race, thưởng referral, PAID không đụng số dư…).
- Thêm `access-trade.provider.spec.ts`: `parseWebhook` map đúng AT→normalized (kể cả guard âm →
  null), `verifyWebhook` timing-safe (đúng/sai/độ dài khác), `buildDeeplink` (`{{clickId}}` + `&url=`).
- Thêm test `reconcile`: kết quả `fetchTransactions` chạy qua `ingest`; provider disabled bị skip.
- `settleConfirmed` test giữ nguyên.

## ⚠️ Giới hạn có chủ đích (ngoài phạm vi)
- **Claw-back sau settle:** đã `PAID` (tiền về Ví) → postback/reconcile `REJECTED` đến sau **bị bỏ
  qua, không claw-back** (chính sách hiện tại, reconcile kế thừa). Giảm thiểu: giữ
  `cashback.hold_days` ≥ cửa sổ đảo soát thực của AccessTrade. Ghi nợ/âm ví để claw-back sau settle
  = việc sau nếu cần.
- **Raw-body signature (HMAC):** interface cho phép nhưng chưa bật middleware raw-body (chỉ cần khi
  thêm provider dùng chữ ký thay shared-token).
- **Provider thứ 2 thật** (Involve Asia/direct): không làm lần này — abstraction sẵn sàng để cắm.
- **Admin UI** gán `provider` cho merchant: seed đặt sẵn `'accesstrade'`; quản trị merchant qua UI
  là việc riêng.

## Phạm vi file dự kiến chạm
- `apps/api/src/modules/cashback/cashback.service.ts` (tách `ingest`, `createClick` qua registry, cron `reconcile`)
- `apps/api/src/modules/cashback/cashback.controller.ts` (route generic + alias)
- `apps/api/src/modules/cashback/cashback.module.ts` (đăng ký registry + AccessTradeProvider)
- MỚI: `.../providers/cashback-provider.interface.ts`, `.../providers/cashback-provider.registry.ts`,
  `.../providers/access-trade.provider.ts`
- `apps/api/prisma/schema.prisma` + migration tay mới
- `apps/api/prisma/seed.ts` (provider merchant + 2 config reconcile)
- Tests: `cashback.service.spec.ts` (cập nhật), MỚI `access-trade.provider.spec.ts`
