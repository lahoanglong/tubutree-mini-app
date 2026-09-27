# Analytics nền (dự án con 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng hạ tầng `analytics_events` + 18 sự kiện tối thiểu + 5 cột `Order` mới + 2 bảng
snapshot + dashboard admin, để đo north-star (% khách có đơn 2 ≤30 ngày) và các KPI phễu/retention
đi kèm, theo đúng spec đã duyệt.

**Architecture:** Ghi sự kiện tiền/đơn trong transaction Prisma sẵn có (không outbox riêng, không
SaaS ngoài). Cron đêm tổng hợp `orders` + `analytics_events` + `pos_point_credits` thành 3 bảng
snapshot; dashboard admin đọc snapshot (không query nặng lúc xem). FE miniapp gộp lô sự kiện ý
định/hiển thị qua `POST /events`.

**Tech Stack:** NestJS + Prisma (`apps/api`), Next.js + TanStack Query (`apps/web`), Zalo Mini App
React + axios + TanStack Query (`apps/miniapp`), Jest (BE), Vitest (miniapp FE), Playwright
(`apps/e2e`).

**Nguồn:** `docs/superpowers/specs/2026-09-27-analytics-foundation-design.md` (đã user duyệt,
commit `0a4f6a0` + sửa `cb310ae`). Số dòng dưới đây đã **verify lại trực tiếp trên nhánh
`feat/complete-wip-2026-09` tại thời điểm viết plan này** (không chỉ dựa vào audit cũ) — nhưng vẫn
đọc lại file trước khi sửa vì có thể trôi nếu có commit khác chen vào.

---

## File Structure

**Mới — BE (`apps/api/src/modules/analytics/`):**
- `analytics.module.ts` — `@Global()`, export `AnalyticsEventsService`.
- `analytics-events.service.ts` — `record(tx, input)` (ghi trong transaction có sẵn) +
  `recordBestEffort(input)` (tự bắt lỗi, không bao giờ làm hỏng luồng gọi).
- `analytics-events.service.spec.ts`.
- `order-error-classifier.ts` — heuristic map message lỗi đặt-đơn → `error_code`.
- `order-error-classifier.spec.ts`.
- `dto/ingest-events.dto.ts` — DTO validate lô sự kiện FE gửi lên.
- `device-throttler.guard.ts` — throttle theo `X-Device-Id` thay vì IP cho riêng `/events`.
- `analytics.controller.ts` — `POST /events`.
- `analytics.controller.spec.ts`.
- `analytics-aggregation.service.ts` — cron đêm tính 3 bảng snapshot.
- `analytics-aggregation.service.spec.ts`.
- `analytics-admin.controller.ts` — `GET /admin/analytics/*` đọc snapshot cho web admin.

**Sửa — BE (điểm phát 10 sự kiện nguồn BE + wiring):**
- `apps/api/src/app.module.ts` — đăng ký `AnalyticsModule`.
- `apps/api/prisma/schema.prisma` — 4 model mới + 5 cột `Order`.
- `apps/api/src/modules/cart/cart.service.ts` — `add_to_cart`.
- `apps/api/src/modules/checkout/checkout.service.ts` — `order_placed`, `order_paid` (nhánh
  WALLET/XU trả ngay), `order_place_failed`, `coupon_applied`.
- `apps/api/src/modules/checkout/checkout.controller.ts` — nhận header `X-Client-Platform`.
- `apps/api/src/modules/integrations/payment/zalopay.service.ts` — `order_paid`.
- `apps/api/src/modules/integrations/pancake/pancake.processor.ts` — `order_paid`.
- `apps/api/src/modules/dealer/dealer.service.ts` — `order_paid` (xác nhận thanh toán đại lý).
- `apps/api/src/modules/orders/order-status.service.ts` — `order_status_changed`.
- `apps/api/src/modules/notifications/notifications.service.ts` — `notification_sent`.
- `apps/api/src/modules/subscriptions/subscriptions.service.ts` — `subscription_changed` +
  `order_placed` (đơn định kỳ tạo trực tiếp, không qua checkout.service).
- `apps/api/src/modules/game/game-economy.service.ts`, `game.service.ts` — `engagement_action`.
- `apps/api/src/modules/loyalty/loyalty.service.ts` — `engagement_action`.
- `apps/api/src/modules/feed/community-feed.service.ts` — `engagement_action`.
- `apps/api/src/modules/reviews/reviews.service.ts` — `engagement_action`.
- `apps/api/src/modules/affiliate/affiliate.service.ts` — `referral_touched`.

**Mới — script backfill một lần:** `apps/api/scripts/backfill-analytics-2026-09.ts`.

**Mới — FE miniapp (`apps/miniapp/src/`):**
- `services/analytics.ts` — hàng đợi gộp lô + envelope + flush.
- `services/analytics.spec.ts`.
- `hooks/use-screen-tracker.ts` — route tracker gắn vào `ZMPRouter`.

**Sửa — FE miniapp:**
- `services/api.ts` — thêm header `X-Device-Id` + `X-Client-Platform: miniapp`.
- `store/auth.ts` — export `getDeviceId()` để `analytics.ts`/`api.ts` dùng chung, tránh vòng import.
- `components/app.tsx` — gắn `useScreenTracker()` + phát `app_opened`.
- `pages/product-detail.tsx` — phát `product_viewed`.
- `pages/browse.tsx` — phát `search_performed`.
- `pages/checkout.tsx` — phát `checkout_started`.
- `pages/notifications.tsx` — phát `notification_opened`.
- `components/error-boundary.tsx` — phát `client_error` + gắn `window.onerror`/`unhandledrejection`.

**Sửa — FE web admin:**
- `apps/web/src/lib/client-api.ts` — thêm header `X-Client-Platform: web`.
- `apps/web/src/lib/admin-client.ts` — thêm hàm gọi `GET /admin/analytics/*`.
- `apps/web/src/app/admin/analytics-tab.tsx` (mới) — component dashboard.
- `apps/web/src/app/admin/page.tsx` — thêm tab `'analytics'` (3 chỗ: `Tab` union, `TABS`, render
  branch) + 1 dòng import.

**Mới — test tích hợp/E2E:**
- `apps/api/test/integration-race/analytics-atomicity.race-spec.ts`.
- `apps/e2e/tests/admin-analytics.spec.ts`.

---

## Task 1: Schema Prisma — 4 model mới + 5 cột Order

**Files:**
- Modify: `apps/api/prisma/schema.prisma:799-866` (model `Order`) và cuối file (thêm model mới).

- [ ] **Step 1: Thêm 5 cột vào `model Order`**

Mở `apps/api/prisma/schema.prisma`, tìm khối `model Order { ... }` (dòng 799-866). Thêm 5 dòng sau
dòng `commission Int @default(0)` (dòng 831):

```prisma
  source            String?        // checkout | buy_now | ctv_assisted | subscription | dealer
  platform          String?        // miniapp | web — null cho đơn cũ trước migration này
  paidAt            DateTime?      // lúc paymentStatus chuyển PAID — set tại nơi lật trạng thái
  subscriptionId    String?        // gắn khi đơn tạo từ subscriptions.service (cron chạy kỳ)
  endCustomerKey    String?        // SĐT người nhận đã chuẩn hoá (chỉ số) — CHỈ set khi placedForCustomer = true
```

Đây là scalar thường (không phải Prisma relation) — không cần sửa `model Subscription`.

- [ ] **Step 2: Thêm 4 model mới**

Thêm vào cuối `schema.prisma` (sau model cuối cùng của file):

```prisma
model AnalyticsEvent {
  id             String   @id @default(cuid())
  eventId        String   @unique
  eventName      String
  occurredAt     DateTime
  receivedAt     DateTime @default(now())
  userId         String?
  anonymousId    String?
  sessionId      String?
  platform       String
  appVersion     String?
  entrySource    String?
  notificationId String?
  refCode        String?
  storefrontSlug String?
  props          Json

  @@index([eventName, occurredAt])
  @@index([userId, occurredAt])
  @@index([anonymousId])
  @@map("analytics_events")
}

model RetentionDailySnapshot {
  date                 DateTime @id
  newBuyers            Int
  activeBuyers         Int
  ordersCount          Int
  ordersPerBuyerMtd    Decimal
  dauProxyRefreshToken Int
  dauEventBased        Int?
  computedAt           DateTime @default(now())

  @@map("retention_daily_snapshot")
}

model CohortRepeatSnapshot {
  id                      String   @id @default(cuid())
  cohortMonth             DateTime
  newBuyersInCohort       Int
  repeat30dCount          Int
  repeat30dComplete       Boolean
  repeat60dCount          Int
  repeat60dComplete       Boolean
  repeat90dCount          Int
  repeat90dComplete       Boolean
  medianDaysToSecondOrder Decimal?
  computedAt              DateTime @default(now())

  @@unique([cohortMonth])
  @@map("cohort_repeat_snapshot")
}

model FunnelDailySnapshot {
  id          String   @id @default(cuid())
  date        DateTime
  step        String
  entrySource String?
  count       Int

  @@unique([date, step, entrySource])
  @@map("funnel_daily_snapshot")
}
```

- [ ] **Step 3: Format + generate migration**

Chạy từ `apps/api/`:

```bash
npx prisma format
npm run prisma:migrate -- --name analytics_foundation
```

Expected: prompt đặt tên migration đã có sẵn qua `--name`, tạo file
`apps/api/prisma/migrations/<timestamp>_analytics_foundation/migration.sql`, exit 0, không có
cảnh báo "data loss" (toàn bộ thay đổi additive: bảng mới + cột nullable).

- [ ] **Step 4: `npm run prisma:generate` rồi build thử để chắc chắn không lỗi type**

```bash
npm run prisma:generate
npx tsc --noEmit -p apps/api
```

Expected: cả 2 lệnh exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(analytics): thêm bảng analytics_events + 2 bảng snapshot + 5 cột Order"
```

---

## Task 2: `AnalyticsEventsService` + `AnalyticsModule`

**Files:**
- Create: `apps/api/src/modules/analytics/analytics-events.service.ts`
- Create: `apps/api/src/modules/analytics/analytics-events.service.spec.ts`
- Create: `apps/api/src/modules/analytics/analytics.module.ts`
- Modify: `apps/api/src/app.module.ts:9` (thêm import), `apps/api/src/app.module.ts:65` (thêm vào
  mảng `imports`, ngay sau `NotificationsModule`)

- [ ] **Step 1: Viết test trước (thất bại vì file chưa tồn tại)**

```typescript
// apps/api/src/modules/analytics/analytics-events.service.spec.ts
import { AnalyticsEventsService } from './analytics-events.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsEventsService.record', () => {
  it('ghi đủ 13 trường vào tx.analyticsEvent.create, tự sinh eventId nếu không truyền', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);

    await svc.record(tx, {
      eventName: 'order_placed',
      userId: 'u1',
      platform: 'miniapp',
      props: { orderId: 'o1' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0].data;
    expect(arg.eventName).toBe('order_placed');
    expect(arg.userId).toBe('u1');
    expect(arg.platform).toBe('miniapp');
    expect(arg.props).toEqual({ orderId: 'o1' });
    expect(typeof arg.eventId).toBe('string');
    expect(arg.eventId.length).toBeGreaterThan(10);
    expect(arg.anonymousId).toBeNull();
    expect(arg.occurredAt).toBeInstanceOf(Date);
  });

  it('dùng eventId truyền vào nếu có, không tự sinh mới', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService({} as PrismaService);

    await svc.record(tx, { eventId: 'fixed-id', eventName: 'app_opened', platform: 'miniapp' });

    expect(create.mock.calls[0][0].data.eventId).toBe('fixed-id');
  });
});

describe('AnalyticsEventsService.recordBestEffort', () => {
  it('lỗi khi ghi DB bị nuốt, không throw ra ngoài', async () => {
    const create = jest.fn().mockRejectedValue(new Error('DB down'));
    const prisma = { analyticsEvent: { create } } as unknown as PrismaService;
    const svc = new AnalyticsEventsService(prisma);

    await expect(
      svc.recordBestEffort({ eventName: 'client_error', platform: 'miniapp' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL vì thiếu file**

```bash
cd apps/api && npx jest src/modules/analytics/analytics-events.service.spec.ts
```

Expected: FAIL — `Cannot find module './analytics-events.service'`.

- [ ] **Step 3: Viết `analytics-events.service.ts`**

```typescript
// apps/api/src/modules/analytics/analytics-events.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnalyticsEventInput {
  eventId?: string;
  eventName: string;
  occurredAt?: Date;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  platform: 'miniapp' | 'web' | 'admin' | 'pos' | 'system';
  appVersion?: string | null;
  entrySource?: string | null;
  notificationId?: string | null;
  refCode?: string | null;
  storefrontSlug?: string | null;
  props?: Record<string, unknown>;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AnalyticsEventsService {
  private readonly logger = new Logger(AnalyticsEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ghi sự kiện — gọi với `tx` khi cần atomic với nghiệp vụ đang chạy trong transaction đó. */
  async record(db: Db, input: AnalyticsEventInput): Promise<void> {
    await db.analyticsEvent.create({
      data: {
        eventId: input.eventId ?? randomUUID(),
        eventName: input.eventName,
        occurredAt: input.occurredAt ?? new Date(),
        userId: input.userId ?? null,
        anonymousId: input.anonymousId ?? null,
        sessionId: input.sessionId ?? null,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        entrySource: input.entrySource ?? null,
        notificationId: input.notificationId ?? null,
        refCode: input.refCode ?? null,
        storefrontSlug: input.storefrontSlug ?? null,
        props: (input.props ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Ghi best-effort NGOÀI transaction — không bao giờ throw, dùng cho sự kiện không phải tiền. */
  async recordBestEffort(input: AnalyticsEventInput): Promise<void> {
    try {
      await this.record(this.prisma, input);
    } catch (err) {
      this.logger.warn(`Ghi analytics event thất bại (bỏ qua): ${input.eventName} — ${err}`);
    }
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
cd apps/api && npx jest src/modules/analytics/analytics-events.service.spec.ts
```

Expected: PASS, 3/3 test.

- [ ] **Step 5: Viết `analytics.module.ts`**

```typescript
// apps/api/src/modules/analytics/analytics.module.ts
import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';

@Global()
@Module({
  providers: [AnalyticsEventsService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 6: Đăng ký vào `app.module.ts`**

Thêm import (ngay sau dòng `import { NotificationsModule } from './modules/notifications/notifications.module';`, dòng 13):

```typescript
import { AnalyticsModule } from './modules/analytics/analytics.module';
```

Thêm vào mảng `imports`, ngay sau `NotificationsModule,` (dòng 65, trong nhóm "Global cross-cutting"):

```typescript
    AnalyticsModule,
```

- [ ] **Step 7: Build thử toàn bộ + chạy lại test cũ đảm bảo không vỡ gì**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/analytics
```

Expected: cả 2 lệnh exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/analytics apps/api/src/app.module.ts
git commit -m "feat(analytics): AnalyticsEventsService + AnalyticsModule global"
```

---

## Task 3: Order error classifier (cho `order_place_failed`)

**Files:**
- Create: `apps/api/src/modules/analytics/order-error-classifier.ts`
- Create: `apps/api/src/modules/analytics/order-error-classifier.spec.ts`

- [ ] **Step 1: Viết test trước**

```typescript
// apps/api/src/modules/analytics/order-error-classifier.spec.ts
import { classifyOrderError } from './order-error-classifier';

describe('classifyOrderError', () => {
  it('message chứa "tồn kho" → OUT_OF_STOCK', () => {
    expect(classifyOrderError('Sản phẩm "A" không đủ tồn kho.')).toBe('OUT_OF_STOCK');
  });
  it('message === PRICE_CHANGED → PRICE_CHANGED', () => {
    expect(classifyOrderError('PRICE_CHANGED')).toBe('PRICE_CHANGED');
  });
  it('message chứa "Địa chỉ giao hàng" → ADDRESS_INVALID', () => {
    expect(classifyOrderError('Địa chỉ giao hàng không hợp lệ.')).toBe('ADDRESS_INVALID');
  });
  it('message chứa "Số dư"/"Điểm Xanh"/"COD" → BALANCE', () => {
    expect(classifyOrderError('Số dư Ví Tubu không đủ.')).toBe('BALANCE');
    expect(classifyOrderError('Số điểm Xanh không đủ (hiện có 10 điểm).')).toBe('BALANCE');
    expect(classifyOrderError('Đơn vượt hạn mức COD, vui lòng chọn phương thức khác.')).toBe('BALANCE');
  });
  it('message chứa "Idempotency" → VALIDATION', () => {
    expect(classifyOrderError('Idempotency-Key không hợp lệ.')).toBe('VALIDATION');
  });
  it('message không khớp gì → VALIDATION (mặc định)', () => {
    expect(classifyOrderError('Lỗi lạ chưa từng thấy')).toBe('VALIDATION');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

```bash
cd apps/api && npx jest src/modules/analytics/order-error-classifier.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Viết implementation**

```typescript
// apps/api/src/modules/analytics/order-error-classifier.ts
/**
 * Heuristic map message lỗi tiếng Việt (throw ở checkout.service.ts quote/placeOrder) sang
 * error_code chuẩn hoá cho sự kiện `order_place_failed` — không chính xác 100% cho message mới
 * chưa liệt kê, mặc định rơi về VALIDATION.
 */
export function classifyOrderError(message: string): string {
  if (message.includes('tồn kho')) return 'OUT_OF_STOCK';
  if (message === 'PRICE_CHANGED' || message.includes('giá')) return 'PRICE_CHANGED';
  if (message.includes('Địa chỉ giao hàng')) return 'ADDRESS_INVALID';
  if (message.includes('Số dư') || message.includes('Điểm Xanh') || message.includes('COD')) {
    return 'BALANCE';
  }
  return 'VALIDATION';
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
cd apps/api && npx jest src/modules/analytics/order-error-classifier.spec.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/analytics/order-error-classifier.ts apps/api/src/modules/analytics/order-error-classifier.spec.ts
git commit -m "feat(analytics): classifier lỗi đặt-đơn cho sự kiện order_place_failed"
```

---

## Task 4: `checkout.service.ts` — `order_placed`, `order_paid` (WALLET/XU), `coupon_applied`

**Files:**
- Modify: `apps/api/src/modules/checkout/checkout.service.ts`
- Modify: `apps/api/src/modules/checkout/checkout.controller.ts`

- [ ] **Step 1: Thêm `AnalyticsEventsService` vào constructor**

Đọc đầu `checkout.service.ts`, tìm khối `constructor(...)`. Thêm tham số:

```typescript
    private readonly analytics: AnalyticsEventsService,
```

Thêm import ở đầu file:

```typescript
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
```

- [ ] **Step 2: Thêm `platform` vào `placeOrder`**

Sửa chữ ký hiện tại (dòng 95):

```typescript
  async placeOrder(userId: string, dto: PlaceOrderDto, idempotencyKey?: string) {
```

thành:

```typescript
  async placeOrder(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey?: string,
    platform: 'miniapp' | 'web' = 'miniapp',
  ) {
```

- [ ] **Step 3: Tính `source` và set `paidAt`/`platform`/`source` vào `tx.order.create`**

Ngay TRƯỚC dòng `const code = await this.generateCode();` (dòng 152), thêm:

```typescript
    const orderSource = storefrontSlug ? 'ctv_assisted' : dto.itemIds?.length ? 'buy_now' : 'checkout';
```

Trong khối `data: { ... }` của `tx.order.create` (dòng 182-225), thêm 3 trường sau dòng
`storefrontSlug,` (dòng 201):

```typescript
            source: orderSource,
            platform,
            paidAt: paid ? new Date() : null,
```

- [ ] **Step 4: Phát `order_placed` (và `order_paid` nếu trả ngay) — trong transaction**

Ngay TRƯỚC dòng `return created;` (dòng 279, bên trong `$transaction(async (tx) => {...})`),
thêm:

```typescript
        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId,
          platform,
          storefrontSlug: storefrontSlug ?? null,
          refCode: dto.referralCode ?? null,
          props: {
            orderId: created.id,
            total: computed.total,
            subtotal: cart.subtotal,
            discount: computed.discount + computed.comboDiscount + computed.pointsDiscount + computed.tierDiscount,
            shippingFee: computed.shippingFee,
            itemCount: cart.items.length,
            paymentMethod: dto.paymentMethod,
            couponCode: computed.couponApplied ? cart.couponCode : null,
            pointsUsed: computed.pointsUsed,
            orderSource,
          },
        });
        if (paid) {
          await this.analytics.record(tx, {
            eventName: 'order_paid',
            userId,
            platform,
            props: { orderId: created.id, method: dto.paymentMethod, amount: computed.total, secsFromPlaced: 0 },
          });
        }
```

- [ ] **Step 5: Phát `coupon_applied` ngay sau khi redeem thành công**

Sửa khối hiện tại (dòng 276-278):

```typescript
        if (cart.couponCode && computed.couponApplied) {
          await this.coupons.redeem(cart.couponCode, userId, created.id, tx);
        }
```

thành:

```typescript
        if (cart.couponCode && computed.couponApplied) {
          await this.coupons.redeem(cart.couponCode, userId, created.id, tx);
          await this.analytics.record(tx, {
            eventName: 'coupon_applied',
            userId,
            platform,
            props: {
              couponCode: cart.couponCode,
              orderId: created.id,
              discount: computed.discount,
            },
          });
        }
```

- [ ] **Step 6: Phát `order_place_failed` khi `quote`/`placeOrder` ném lỗi nghiệp vụ**

Bọc THÊM một lớp try/catch quanh TOÀN BỘ thân `placeOrder` (không phải quanh riêng
`$transaction` đã có ở Step 4/5) — đổi tên thân hàm hiện tại thành một private method rồi wrap:

Đổi dòng `async placeOrder(...) {` thành `private async placeOrderInner(...) {` (giữ nguyên toàn
bộ thân hàm y hệt, bao gồm cả `$transaction` ở Step 4/5), rồi thêm method public mới ngay phía
trên nó:

```typescript
  async placeOrder(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey?: string,
    platform: 'miniapp' | 'web' = 'miniapp',
  ) {
    try {
      return await this.placeOrderInner(userId, dto, idempotencyKey, platform);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const message = typeof err.getResponse() === 'string'
          ? (err.getResponse() as string)
          : (err.getResponse() as { message?: string }).message ?? err.message;
        await this.analytics.recordBestEffort({
          eventName: 'order_place_failed',
          userId,
          platform,
          props: { step: 'place', errorCode: classifyOrderError(message) },
        });
      }
      throw err;
    }
  }

  private async placeOrderInner(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey?: string,
    platform: 'miniapp' | 'web' = 'miniapp',
  ) {
```

Thêm import ở đầu file:

```typescript
import { classifyOrderError } from '../analytics/order-error-classifier';
```

- [ ] **Step 7: Áp dụng tương tự cho `quote()` (chỉ `order_place_failed`, không có order_placed)**

Đọc `quote()` hiện tại (dòng 73-93), bọc thân hàm bằng try/catch giống Step 6 (đổi tên thân thành
`quoteInner`, method `quote` public mới gọi `quoteInner` trong try/catch, catch chỉ ghi
`order_place_failed` với `step: 'quote'`, KHÔNG cần đụng tới `platform` vì `quote()` không tạo đơn
— truyền `platform: 'miniapp'` cố định là đủ, vì đây chỉ là tín hiệu chất lượng, không phải dữ
liệu tiền).

- [ ] **Step 8: Controller — nhận header `X-Client-Platform`, truyền xuống**

Sửa `apps/api/src/modules/checkout/checkout.controller.ts`:

```typescript
import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  quote(@CurrentUser('sub') userId: string, @Body() dto: QuoteDto) {
    return this.checkout.quote(userId, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('place-order')
  placeOrder(
    @CurrentUser('sub') userId: string,
    @Body() dto: PlaceOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-client-platform') clientPlatform?: string,
  ) {
    const platform = clientPlatform === 'web' ? 'web' : 'miniapp';
    return this.checkout.placeOrder(userId, dto, idempotencyKey, platform);
  }
}
```

- [ ] **Step 9: Chạy test hiện có của checkout (không viết test mới ở bước này — logic transaction
      quá phức tạp để mock rẻ tiền; atomicity được test thật ở Task 15 với Postgres thật)**

```bash
cd apps/api && npx jest src/modules/checkout
```

Expected: PASS toàn bộ test cũ (không có test nào assert số lượng tham số của `placeOrder`/`quote`
theo cách vỡ khi thêm tham số có default).

- [ ] **Step 10: `tsc --noEmit` để bắt lỗi kiểu**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/checkout
git commit -m "feat(analytics): order_placed/order_paid/coupon_applied/order_place_failed ở checkout"
```

---

## Task 5: `order_paid` ở webhook thanh toán (ZaloPay, Pancake, đại lý)

**Files:**
- Modify: `apps/api/src/modules/integrations/payment/zalopay.service.ts:150-160`
- Modify: `apps/api/src/modules/integrations/pancake/pancake.processor.ts:181-189`
- Modify: `apps/api/src/modules/dealer/dealer.service.ts:1028-1052`

- [ ] **Step 1: `zalopay.service.ts` — đọc lại đoạn `handleCallback` hiện tại quanh dòng 150-160,
      bọc `updateMany` thành transaction tương tác + thêm event**

Trước khi sửa, đọc file để lấy đúng biến (`orderId`/`order`/`amount` đang có sẵn trong scope của
`handleCallback`). Đổi:

```typescript
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, paymentStatus: 'UNPAID', status: { notIn: [...] } },
      data: { paymentStatus: 'PAID' },
    });
```

thành:

```typescript
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'UNPAID', status: { notIn: [...] } },
        data: { paymentStatus: 'PAID', paidAt: new Date() },
      });
      if (r.count > 0) {
        await this.analytics.record(tx, {
          eventName: 'order_paid',
          userId: order.userId,
          platform: order.platform === 'web' ? 'web' : 'miniapp',
          props: { orderId: order.id, method: 'ZALOPAY', amount: order.total },
        });
      }
      return r;
    });
```

Giữ nguyên phần `where`/mảng `notIn` y hệt bản gốc (chỉ đọc lại để chép đúng, không đoán). Thêm
`private readonly analytics: AnalyticsEventsService` vào constructor + import
`'../../analytics/analytics-events.service'` (2 cấp `../..` vì file này ở
`modules/integrations/payment/`).

- [ ] **Step 2: `pancake.processor.ts` — làm tương tự cho cả 2 nhánh (dòng 181-183 và 186-189)**

Đọc file để lấy đúng tên biến `order`/`amount` trong `onPaymentReconcile`. Áp dụng cùng pattern:
bọc từng `updateMany` bằng `$transaction`, set `paidAt: new Date()`, phát `order_paid` với
`method: 'BANK_TRANSFER'` (hoặc giá trị `order.paymentMethod` thật nếu đã có sẵn trong scope —
ưu tiên đọc field thật thay vì hard-code). Import
`'../../analytics/analytics-events.service'`.

- [ ] **Step 3: `dealer.service.ts` — thêm vào transaction ĐÃ CÓ SẴN (dòng 1028-1052)**

Đọc `confirmDealerOrderPayment` hiện tại. Bên trong khối `$transaction(async (tx) => {...})` đã
tồn tại, ngay sau lệnh set `paymentStatus: 'PAID'`, thêm:

```typescript
      await this.analytics.record(tx, {
        eventName: 'order_paid',
        userId: order.userId,
        platform: 'web',
        props: { orderId: order.id, method: 'BANK_TRANSFER', amount: order.total, orderSource: 'dealer' },
      });
```

(đơn đại lý luôn qua web/admin xác nhận, không qua miniapp — `platform: 'web'` cố định hợp lý ở
đây). Import `'../analytics/analytics-events.service'` (1 cấp, cùng độ sâu `modules/dealer/`).

- [ ] **Step 4: Build + test hiện có**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/integrations src/modules/dealer
```

Expected: exit 0, test cũ vẫn PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/integrations/payment/zalopay.service.ts apps/api/src/modules/integrations/pancake/pancake.processor.ts apps/api/src/modules/dealer/dealer.service.ts
git commit -m "feat(analytics): order_paid ở webhook ZaloPay/Pancake + xác nhận đại lý"
```

---

## Task 6: `order_status_changed`

**Files:**
- Modify: `apps/api/src/modules/orders/order-status.service.ts:51-133`

- [ ] **Step 1: Thêm vào transaction có sẵn của `setStatus`**

Đọc `setStatus(orderId, targetStatus, opts)` hiện tại (dòng 51-133), transaction ở dòng 73-106.
Ngay sau lệnh ghi `order_status_history` bên trong transaction đó, thêm:

```typescript
      await this.analytics.record(tx, {
        eventName: 'order_status_changed',
        userId: updatedOrder.userId,
        platform: 'system',
        props: {
          orderId,
          from: fromStatus,
          to: targetStatus,
          actorType: opts.actorType ?? 'SYSTEM',
          reason: opts.note ?? null,
        },
      });
```

(dùng đúng tên biến đang có trong scope thật của hàm — đọc lại trước khi chép, `updatedOrder`/
`fromStatus` ở trên là tên GIẢ ĐỊNH theo ngữ cảnh, phải khớp tên biến thật trong file). Thêm
`AnalyticsEventsService` vào constructor + import `'../analytics/analytics-events.service'`.

- [ ] **Step 2: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/orders
```

Expected: exit 0, PASS toàn bộ.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/orders/order-status.service.ts
git commit -m "feat(analytics): order_status_changed trong setStatus (mọi call site dùng chung)"
```

---

## Task 7: `notification_sent`

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts:37-82`

- [ ] **Step 1: Thêm sau khi ghi `NotificationLog` thành công**

Đọc `notify(userId, templateCode, data)` hiện tại. Sau khối tạo `NotificationLog` INAPP (dòng
53-55) — best-effort, KHÔNG cần transaction (không phải tiền) — thêm:

```typescript
    await this.analytics.recordBestEffort({
      eventName: 'notification_sent',
      userId,
      platform: 'system',
      notificationId: log.id,
      props: { templateCode, channel: 'INAPP' },
    });
```

(`log` = biến giữ kết quả `create()` NotificationLog vừa tạo — đọc lại tên thật trong file). Nếu
có nhánh tạo thêm bản ghi ZNS (dòng 60-68), thêm một lời gọi tương tự với `channel: 'ZNS'` sau
nhánh đó. Thêm `AnalyticsEventsService` vào constructor + import.

- [ ] **Step 2: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/notifications
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(analytics): notification_sent (INAPP + ZNS)"
```

---

## Task 8: `subscription_changed` + `order_placed` cho đơn định kỳ

**Files:**
- Modify: `apps/api/src/modules/subscriptions/subscriptions.service.ts`

- [ ] **Step 1: `create()` (dòng 47-66) — bọc transaction + phát `action: 'created'`**

Hàm hiện không có transaction (1 lệnh `subscription.create`). Bọc lại:

```typescript
  async create(userId: string, dto: CreateSubInput) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({ data: { userId, ...dto } }); // giữ nguyên field thật, đọc lại trước khi chép
      await this.analytics.record(tx, {
        eventName: 'subscription_changed',
        userId,
        platform: 'miniapp',
        props: { subscriptionId: sub.id, action: 'created', variationId: dto.variationId, intervalWeeks: dto.intervalWeeks },
      });
      return sub;
    });
  }
```

- [ ] **Step 2: `setStatus()` (dòng 116-125) — bọc transaction + phát `action` khớp status**

```typescript
  async setStatus(userId: string, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({ where: { id, userId }, data: { status } }); // giữ where/data thật của bản gốc
      await this.analytics.record(tx, {
        eventName: 'subscription_changed',
        userId,
        platform: 'miniapp',
        props: {
          subscriptionId: id,
          action: status === 'ACTIVE' ? 'resumed' : status === 'PAUSED' ? 'paused' : 'cancelled',
        },
      });
      return sub;
    });
  }
```

- [ ] **Step 3: `createOrderFor(sub)` (dòng 177-292) — đã verify lại thật (2026-09-27): transaction
      hiện có ở dòng 232-269 return TRỰC TIẾP `tx.order.create({...})` (không có biến trung
      gian). Đổi sang chép kết quả ra biến rồi phát sự kiện TRƯỚC KHI return, y hệt pattern đã áp
      dụng ở Task 10 Step 0:**

```typescript
      order = await this.prisma.$transaction(async (tx) => {
        const stockHit = await reserveVariationStock(tx, variation.id, sub.quantity);
        if (!stockHit) {
          throw new SubscriptionOutOfStockError(
            `Sản phẩm "${variation.product.name}" không đủ tồn kho cho đơn định kỳ.`,
          );
        }
        const created = await tx.order.create({
          data: {
            code,
            userId: sub.userId,
            type: 'RETAIL',
            status: 'CONFIRMED',
            subtotal,
            discount,
            shippingFee,
            total,
            pointsEarned,
            paymentMethod: 'COD',
            paymentStatus: 'UNPAID',
            shippingAddress: address,
            note: 'Đơn đặt định kỳ (Subscribe & Save)',
            source: 'subscription',
            platform: 'system',
            subscriptionId: sub.id,
            items: {
              create: [
                {
                  variationId: variation.id,
                  productName: variation.product.name,
                  productSlug: variation.product.slug,
                  variationName: variation.name,
                  unitPrice,
                  quantity: sub.quantity,
                  total: subtotal,
                },
              ],
            },
          },
        });
        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId: sub.userId,
          platform: 'system',
          props: { orderId: created.id, orderSource: 'subscription', subscriptionId: sub.id, total },
        });
        await this.analytics.record(tx, {
          eventName: 'subscription_changed',
          userId: sub.userId,
          platform: 'system',
          props: { subscriptionId: sub.id, action: 'order_created', orderId: created.id },
        });
        return created;
      });
```

(chỉ đổi khối `data:` và phần cuối callback so với bản gốc — 2 lệnh `notifications.notify`/
`pancakeOrder.enqueuePush` sau `catch` giữ nguyên 100%, không đụng tới).

Nhánh lỗi (hết hàng — throw `SubscriptionOutOfStockError`, bắt ở `catch` dòng 270-279; hoặc SP/địa
chỉ không hợp lệ — early `return` ở dòng 188-199 trước khi vào transaction) đã tự rollback/không
tạo order, thêm `subscription_changed` action `order_failed` ở catch/early-return đó (best-effort
qua `recordBestEffort`, ngoài transaction vì transaction đã rollback hoặc chưa từng mở):

```typescript
      await this.analytics.recordBestEffort({
        eventName: 'subscription_changed',
        userId: sub.userId,
        platform: 'system',
        props: { subscriptionId: sub.id, action: 'order_failed', reason: 'out_of_stock' }, // hoặc 'inactive_product'/'invalid_address' tuỳ nhánh
      });
```

- [ ] **Step 4: Constructor + import**

Thêm `AnalyticsEventsService` vào constructor + `import { AnalyticsEventsService } from '../analytics/analytics-events.service';`.

- [ ] **Step 5: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/subscriptions
```

Expected: exit 0, PASS toàn bộ test cũ (đặc biệt test nào mock `prisma.subscription.create` trực
tiếp thay vì qua `$transaction` — nếu có test cũ mock kiểu đó sẽ FAIL, cần sửa test đó để mock
`prisma.$transaction` trả về kết quả callback, theo đúng pattern đã dùng ở
`flash-sale.service.spec.ts`/các service khác trong repo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/subscriptions/subscriptions.service.ts
git commit -m "feat(analytics): subscription_changed + order_placed cho đơn định kỳ"
```

---

## Task 9: `engagement_action` (game, loyalty, cộng đồng, đánh giá)

**Files:**
- Modify: `apps/api/src/modules/game/game-economy.service.ts` (checkIn, dòng ~37-116)
- Modify: `apps/api/src/modules/game/game.service.ts` (spin dòng ~103, waterTree dòng ~163-250)
- Modify: `apps/api/src/modules/loyalty/loyalty.service.ts` (dailyCheckIn, dòng ~742)
- Modify: `apps/api/src/modules/feed/community-feed.service.ts` (toggleReaction dòng ~597,
  addComment dòng ~623)
- Modify: `apps/api/src/modules/reviews/reviews.service.ts` (create, dòng ~42)

Với MỖI file trên: đọc method thật trước, thêm `AnalyticsEventsService` vào constructor + import
`'../analytics/analytics-events.service'` (đường dẫn tương đối 1 cấp `../` vì cùng độ sâu
`modules/<name>/`). **Đã verify lại trực tiếp trên nhánh (2026-09-27, trong lúc chờ Task 5) 6
method thật — 3/6 đã CÓ SẴN `$transaction`, không phải best-effort như phỏng đoán ban đầu:**
`game-economy.checkIn` (không có tx — `recordBestEffort` đúng), `game.service.spin` (**CÓ**
`$transaction`, dòng ~113 `return this.prisma.$transaction(async (tx) => {...})` — dùng
`record(tx,...)`), `game.service.waterTree` (có tx, đã đúng ở Step 3), `loyalty.dailyCheckIn`
(**CÓ** `$transaction`, dòng ~756 — dùng `record(tx,...)`), `community-feed.toggleReaction`/
`addComment` (không có tx — `recordBestEffort` đúng), `reviews.create` (**CÓ** `$transaction`,
dòng ~70 `review = await this.prisma.$transaction(async (tx) => {...})` — dùng `record(tx,...)`).
Nguyên tắc: có tx sẵn trong scope thì LUÔN dùng `record(tx,...)` (miễn phí, atomic hơn) thay vì
`recordBestEffort` — chỉ dùng `recordBestEffort` khi thật sự không có transaction bao quanh.

- [ ] **Step 1: `game-economy.service.ts` — sau `gameProfile.updateMany` guard `lastCheckInAt`
      thành công (count > 0)**

```typescript
      await this.analytics.recordBestEffort({
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'garden_checkin', streakDays: updated.streakDays ?? null }, // đọc field streak thật nếu có, else bỏ key này
      });
```

- [ ] **Step 2: `game.service.ts` `spin()` — bên trong `$transaction` đã có (dòng ~113), NGAY SAU
      `tx.gameSpin.create(...)` và TRƯỚC `return { prize: {...} };` cuối callback, dùng `tx`
      không phải `recordBestEffort`**

```typescript
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'spin', prizeId: prize.id, rewardType: prize.rewardType, rewardRefId },
      });
```

- [ ] **Step 3: `game.service.ts` `waterTree()` — bên trong transaction Serializable đã có, ngay
      sau khi set `lastWateredAt`**

```typescript
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'water_tree', drops },
      });
```

- [ ] **Step 4: `loyalty.service.ts` `dailyCheckIn()` — bên trong `$transaction` đã có (dòng
      ~756), NGAY TRƯỚC câu `return { success: true, cycleDay, ... };` cuối callback (dòng
      ~782-792), dùng `tx` không phải `recordBestEffort`**

```typescript
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'loyalty_checkin', cycleDay, streakDays, pointsEarned: points },
      });
```

- [ ] **Step 5: `community-feed.service.ts` `toggleReaction()`/`addComment()` — sau khi ghi thành
      công (chỉ phát khi TẠO reaction/comment, không phát khi toggle-off/xoá)**

```typescript
      await this.analytics.recordBestEffort({
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'feed_reaction', postId }, // hoặc action: 'feed_comment' ở addComment
      });
```

- [ ] **Step 6: `reviews.service.ts` `create()` — bên trong `$transaction` đã có (dòng ~70), NGAY
      TRƯỚC `return r;` cuối callback (sau `this.recomputeRating(product.id, tx)`, dòng ~93-94),
      dùng `tx` không phải `recordBestEffort`**

```typescript
      await this.analytics.record(tx, {
        eventName: 'engagement_action',
        userId,
        platform: 'miniapp',
        props: { action: 'review_created', productSlug: slug, pointsEarned },
      });
```

- [ ] **Step 7: Build + test toàn bộ 5 module**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/game src/modules/loyalty src/modules/feed src/modules/reviews
```

Expected: exit 0, PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/game apps/api/src/modules/loyalty/loyalty.service.ts apps/api/src/modules/feed/community-feed.service.ts apps/api/src/modules/reviews/reviews.service.ts
git commit -m "feat(analytics): engagement_action cho game/loyalty/cộng đồng/đánh giá"
```

---

## Task 10: `referral_touched` + `order_placed` cho đơn CTV "lên đơn hộ"

**Files:**
- Modify: `apps/api/src/modules/affiliate/affiliate.service.ts` (`recordTouch` dòng ~75-101,
  `placeOrderForCustomer` dòng ~234-367)

**Phát hiện khi verify lại plan (2026-09-27, trong lúc chờ Task 5):** `placeOrderForCustomer()` là
một đường tạo `Order` HOÀN TOÀN RIÊNG, không đi qua `checkout.service.ts` (đã sửa ở Task 4). Nếu
không thêm việc này vào đây, đơn CTV lên đơn hộ sẽ KHÔNG BAO GIỜ phát `order_placed`, và 3 cột mới
(`source`/`platform`/`endCustomerKey`) sẽ KHÔNG BAO GIỜ được set cho loại đơn này — đúng loại đơn
mà quyết định nghiệp vụ "tính cho khách nhận hàng qua endCustomerKey" (đã chốt lúc brainstorm) áp
dụng. Thiếu bước này thì quyết định đó lặng lẽ không có hiệu lực (customer_key rơi về `userId` =
CTV, đúng lỗi cũ audit đã cảnh báo). Sửa lại thuật ngữ: `endCustomerKey` KHÔNG PHẢI hash mật mã —
là SĐT người nhận đã CHUẨN HOÁ (chỉ giữ chữ số), CÙNG kiểu chuẩn hoá với `regexp_replace(phone,
'\D','','g')` mà Task 14 dùng cho `user.phone` — để 2 giá trị có thể so khớp trực tiếp nếu sau này
người nhận đó cũng là một tài khoản thật.

- [ ] **Step 0 (MỚI): `placeOrderForCustomer()` — set 3 cột mới + phát `order_placed`**

Đọc lại hàm thật trước khi sửa (chữ ký, transaction, biến `order`/`code`/`storefrontSlug` đã có sẵn
trong scope — xác nhận khớp với đoạn dưới, KHÔNG đoán nếu có sai khác).

Thêm 3 trường vào khối `data: {...}` của `tx.order.create` (ngay sau dòng `placedForCustomer:
true,`):

```typescript
            source: 'ctv_assisted',
            platform: 'miniapp',
            endCustomerKey: dto.customer.phone.replace(/\D/g, '') || null,
```

Đổi khối transaction từ `return tx.order.create({...});` (dòng cuối callback) sang chép kết quả
vào biến rồi phát sự kiện TRƯỚC KHI return (vẫn trong cùng `tx`, atomic với đơn):

```typescript
        const created = await tx.order.create({
          data: {
            // ... y hệt các trường đã có, cộng 3 trường mới ở trên ...
          },
        });
        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId: ctvId,
          platform: 'miniapp',
          storefrontSlug,
          props: {
            orderId: created.id,
            total,
            subtotal: goods,
            discount: 0,
            shippingFee,
            itemCount: lines.length,
            paymentMethod: dto.paymentMethod,
            orderSource: 'ctv_assisted',
          },
        });
        return created;
```

Không cần phát `order_paid` ở đây — đơn CTV chỉ dùng COD (không PAID lúc tạo, xem Task 6 đã phủ
qua `order-status.service.ts` chung cho mọi đơn) hoặc chuyển khoản (Pancake reconcile, đã phủ ở
Task 5 — hoạt động cho MỌI đơn bất kể service nào tạo ra, không cần sửa gì thêm ở đây).

- [ ] **Step 1: Thêm sau `referralTouch.upsert` thành công**

Đọc `recordTouch(userId, dto, now)` hiện tại (upsert ở dòng ~101). Sau lệnh upsert:

```typescript
    await this.analytics.recordBestEffort({
      eventName: 'referral_touched',
      userId,
      platform: 'miniapp',
      refCode: dto.referralCode ?? null,
      storefrontSlug: dto.storefrontSlug ?? null,
      props: { kind: dto.kind ?? 'ctv' }, // đọc field thật của dto, tên tham số ở đây là giả định theo mô tả — khớp lại tên thật khi sửa
    });
```

Thêm `AnalyticsEventsService` vào constructor + import.

- [ ] **Step 2: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/affiliate
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/affiliate/affiliate.service.ts
git commit -m "feat(analytics): referral_touched khi ghi nhận chạm giới thiệu"
```

---

## Task 11: `add_to_cart` (bọc `cart.service.ts addItem` bằng transaction)

**Files:**
- Modify: `apps/api/src/modules/cart/cart.service.ts:111-143`
- Modify: `apps/api/src/modules/cart/dto/cart.dto.ts` (thêm `addSource`)
- Modify: `apps/api/src/modules/cart/cart.controller.ts` (nếu cần truyền `platform`)

- [ ] **Step 1: Thêm `addSource` optional vào `AddItemDto`**

```typescript
  @IsOptional()
  @IsIn(['pdp', 'buy_now', 'repurchase', 'wishlist', 'ctv_sheet', 'reorder_notification'])
  addSource?: string;
```

- [ ] **Step 2: Đã verify lại `addItem(userId, dto)` thật (2026-09-27, trong lúc chờ Task 5) —
      KHÁC với phỏng đoán ban đầu của brief này: hàm KHÔNG chỉ có 3 lệnh Prisma tuần tự, nó còn
      gọi `this.ensureCart(userId)` đầu hàm và kết thúc bằng `return this.getCart(userId);` (một
      view giỏ hàng đầy đủ, KHÔNG PHẢI kết quả thô của `upsert`). Bọc CẢ HÀM vào `$transaction`
      như dự tính ban đầu sẽ làm sai giá trị trả về (vỡ hợp đồng API). Chỉ bọc ĐÚNG lệnh
      `cartItem.upsert` + sự kiện analytics vào một transaction nhỏ, giữ nguyên 100% phần còn lại
      (thứ tự gọi, `ensureCart`, 2 lệnh đọc, `getCart` cuối hàm) y hệt bản gốc:**

```typescript
  async addItem(userId: string, dto: AddItemDto) {
    const cartId = await this.ensureCart(userId);
    const variation = await this.prisma.variation.findUnique({
      where: { id: dto.variationId },
      include: { product: { select: { approvalStatus: true } } },
    });
    if (!variation || !variation.isActive || variation.product.approvalStatus !== 'APPROVED') {
      throw new NotFoundException('Sản phẩm không khả dụng.');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variationId: { cartId, variationId: dto.variationId } },
    });
    const newQty = (existing?.quantity ?? 0) + dto.quantity;
    if (newQty > variation.stock) {
      throw new BadRequestException(`Chỉ còn ${variation.stock} sản phẩm trong kho.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.upsert({
        where: { cartId_variationId: { cartId, variationId: dto.variationId } },
        update: { quantity: { increment: dto.quantity } },
        create: { cartId, variationId: dto.variationId, quantity: dto.quantity },
      });
      await this.analytics.record(tx, {
        eventName: 'add_to_cart',
        userId,
        platform: 'miniapp',
        props: {
          variationId: dto.variationId,
          quantity: dto.quantity,
          addSource: dto.addSource ?? 'pdp',
        },
      });
    });
    return this.getCart(userId);
  }
```

Toàn bộ code trên (trừ khối `$transaction` mới) đã được chép NGUYÊN VĂN từ file thật — không cần
đoán tên biến nữa. Chỉ áp dụng thay đổi ở khối `$transaction` cho đúng `cartItem.upsert` hiện có.

- [ ] **Step 3: Constructor + import**

Thêm `AnalyticsEventsService` vào constructor + import `'../analytics/analytics-events.service'`.

- [ ] **Step 4: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest src/modules/cart
```

Expected: exit 0. Nếu test cũ mock `this.prisma.variation.findUnique` trực tiếp (không qua
`$transaction`), sửa mock đó để trả qua `prisma.$transaction: (cb) => cb(mockTx)` theo đúng pattern
đã thấy ở các service khác trong repo (vd `flash-sale.service.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cart
git commit -m "feat(analytics): add_to_cart (bọc addItem bằng transaction để ghi atomic)"
```

---

## Task 12: `POST /events` — DTO, guard throttle theo device, controller

**Files:**
- Create: `apps/api/src/modules/analytics/dto/ingest-events.dto.ts`
- Create: `apps/api/src/modules/analytics/device-throttler.guard.ts`
- Create: `apps/api/src/modules/analytics/analytics.controller.ts`
- Create: `apps/api/src/modules/analytics/analytics.controller.spec.ts`
- Modify: `apps/api/src/modules/analytics/analytics.module.ts`

- [ ] **Step 1: DTO**

```typescript
// apps/api/src/modules/analytics/dto/ingest-events.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID,
  ValidateNested,
} from 'class-validator';

export class EventEnvelopeDto {
  @IsUUID() eventId!: string;
  @IsString() eventName!: string;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsString() anonymousId?: string;
  @IsOptional() @IsString() sessionId?: string;
  @IsIn(['miniapp', 'web']) platform!: 'miniapp' | 'web';
  @IsOptional() @IsString() appVersion?: string;
  @IsOptional() @IsString() entrySource?: string;
  @IsOptional() @IsString() notificationId?: string;
  @IsOptional() @IsString() refCode?: string;
  @IsOptional() @IsString() storefrontSlug?: string;
  @IsOptional() @IsObject() props?: Record<string, unknown>;
}

export class IngestEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EventEnvelopeDto)
  events!: EventEnvelopeDto[];
}
```

- [ ] **Step 2: Guard throttle theo device**

```typescript
// apps/api/src/modules/analytics/device-throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Throttle /events theo X-Device-Id thay vì IP — Wi-Fi cửa hàng/CGNAT dùng chung IP (A7-02) không
 *  được lấy hết hạn mức của nhau ở endpoint này. */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: { headers: Record<string, unknown>; user?: { sub?: string }; ip?: string }): Promise<string> {
    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId === 'string' && deviceId.length > 0) return deviceId;
    return req.user?.sub ?? req.ip ?? 'unknown';
  }
}
```

- [ ] **Step 3: Controller**

```typescript
// apps/api/src/modules/analytics/analytics.controller.ts
import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsEventsService } from './analytics-events.service';
import { IngestEventsDto } from './dto/ingest-events.dto';
import { DeviceThrottlerGuard } from './device-throttler.guard';

@Controller('events')
@UseGuards(DeviceThrottlerGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsEventsService) {}

  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  @Post()
  async ingest(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: IngestEventsDto,
    @Headers('x-device-id') deviceId?: string,
  ): Promise<{ accepted: number }> {
    for (const e of dto.events) {
      await this.analytics.recordBestEffort({
        eventId: e.eventId,
        eventName: e.eventName,
        occurredAt: new Date(e.occurredAt),
        userId: user?.sub ?? null,
        anonymousId: e.anonymousId ?? deviceId ?? null,
        sessionId: e.sessionId ?? null,
        platform: e.platform,
        appVersion: e.appVersion ?? null,
        entrySource: e.entrySource ?? null,
        notificationId: e.notificationId ?? null,
        refCode: e.refCode ?? null,
        storefrontSlug: e.storefrontSlug ?? null,
        props: e.props ?? {},
      });
    }
    return { accepted: dto.events.length };
  }
}
```

- [ ] **Step 4: Test controller (mock service, xác nhận map đúng field + userId từ JWT)**

```typescript
// apps/api/src/modules/analytics/analytics.controller.spec.ts
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsEventsService } from './analytics-events.service';

describe('AnalyticsController.ingest', () => {
  it('map userId từ JWT, anonymousId ưu tiên body rồi mới tới header', async () => {
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    const res = await ctrl.ingest(
      { sub: 'u1', role: 'CUSTOMER' } as JwtPayload,
      {
        events: [
          { eventId: 'e1', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' },
        ],
      },
      'device-header-1',
    );

    expect(res).toEqual({ accepted: 1 });
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', anonymousId: 'device-header-1', eventName: 'app_opened' }),
    );
  });

  it('user undefined (edge case) → userId null, không throw', async () => {
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    await ctrl.ingest(undefined, {
      events: [{ eventId: 'e2', eventName: 'client_error', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }],
    });

    expect(recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

```bash
cd apps/api && npx jest src/modules/analytics/analytics.controller.spec.ts
```

Expected: PASS 2/2.

- [ ] **Step 6: Đăng ký controller vào module**

Sửa `analytics.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { AnalyticsEventsService } from './analytics-events.service';
import { AnalyticsController } from './analytics.controller';

@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsEventsService],
  exports: [AnalyticsEventsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 7: Build**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/analytics
git commit -m "feat(analytics): POST /events — ingest lô sự kiện FE, throttle theo device"
```

---

## Task 13: Backfill script (5 cột Order + 3 SQL baseline)

**Files:**
- Create: `apps/api/scripts/backfill-analytics-2026-09.ts`

- [ ] **Step 1: Viết script chạy 1 lần (không phải migration — chạy tay qua `ts-node`)**

```typescript
// apps/api/scripts/backfill-analytics-2026-09.ts
// Chạy 1 LẦN sau khi đã áp migration analytics_foundation. KHÔNG chạy trong CI/migrate deploy.
// Usage: cd apps/api && npx tsx scripts/backfill-analytics-2026-09.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) source/platform best-effort cho đơn cũ — không chính xác 100%, xem spec §Rollout.
  //    LƯU Ý: KHÔNG dùng `"subscriptionId" IS NOT NULL` để nhận diện đơn định kỳ CŨ — cột này
  //    chỉ được Task 8 set cho đơn TẠO SAU migration, nên với dữ liệu lịch sử luôn NULL và điều
  //    kiện đó khớp 0 dòng (verify lại code thật lúc soát plan: subscriptions.service.ts luôn
  //    hard-code `note: 'Đơn đặt định kỳ (Subscribe & Save)'`, đó mới là dấu hiệu nhận diện được
  //    cho đơn cũ). Đơn tạo SAU migration đã có `subscriptionId` set trực tiếp bởi Task 8, không
  //    cần dòng UPDATE này chạm tới.
  await prisma.$executeRaw`
    UPDATE orders SET source = 'subscription', platform = 'system'
    WHERE note = 'Đơn đặt định kỳ (Subscribe & Save)' AND source IS NULL
  `;
  await prisma.$executeRaw`
    UPDATE orders SET source = 'dealer', platform = 'web'
    WHERE type = 'DEALER' AND source IS NULL
  `;
  // "ctv_assisted" gồm 2 luồng khác nhau (phân biệt được qua placedForCustomer nếu cần phân
  // tích sâu hơn sau này): khách tự chọn mua trên gian hàng CTV (storefrontSlug có giá trị) HOẶC
  // CTV tự lên đơn hộ khách (placedForCustomer=true — CTV cũ có thể CHƯA có gian hàng riêng nên
  // storefrontSlug vẫn null, riêng điều kiện storefrontSlug sẽ bỏ sót nhóm này — phát hiện ở
  // review Task 10).
  await prisma.$executeRaw`
    UPDATE orders SET source = 'ctv_assisted', platform = 'miniapp'
    WHERE ("storefrontSlug" IS NOT NULL OR "placedForCustomer" = true) AND source IS NULL
  `;
  await prisma.$executeRaw`
    UPDATE orders SET source = 'checkout', platform = 'miniapp'
    WHERE source IS NULL
  `;

  // 2) paidAt — CHỈ COD (paidAt := deliveredAt, suy luận nghiệp vụ đúng). Đơn online cũ không
  //    backfill được đáng tin cậy (order_status_history chưa từng ghi lúc lật PAID) — để trống.
  await prisma.$executeRaw`
    UPDATE orders SET "paidAt" = "deliveredAt"
    WHERE "paymentMethod" = 'COD' AND "paymentStatus" = 'PAID' AND "deliveredAt" IS NOT NULL AND "paidAt" IS NULL
  `;

  // 2b) endCustomerKey cho đơn CTV lên-đơn-hộ CŨ (trước khi Task 10 kịp set cho đơn mới) — lấy
  //     từ shippingAddress->>'phone' (JSON snapshot luôn có field `phone`, xem
  //     checkout.service.ts addressSnapshot() / affiliate.service.ts customerSnapshot()).
  //     QUAN TRỌNG (phát hiện ở review Task 10): CTV order-sheet FE chấp nhận CẢ 2 dạng nhập
  //     `0xxxxxxxxx` VÀ `+84xxxxxxxxx` — nếu chỉ strip ký tự không phải số thì SĐT dạng `84...`
  //     (11 chữ số) sẽ KHÔNG khớp `user.phone` (luôn ở dạng `0...`, 10 chữ số — xem
  //     zalo.service.ts/loyalty.service.ts đã tự quy đổi 84→0). Phải quy đổi CÙNG kiểu ở đây,
  //     khớp đúng helper `normalizeToLocalPhone()` Task 10 đã thêm vào affiliate.service.ts.
  await prisma.$executeRaw`
    UPDATE orders SET "endCustomerKey" = NULLIF(
      regexp_replace(
        regexp_replace("shippingAddress"->>'phone', '\\D', '', 'g'),
        '^84(\\d{9})$', '0\\1'
      ), ''
    )
    WHERE "placedForCustomer" = true AND "endCustomerKey" IS NULL AND "shippingAddress"->>'phone' IS NOT NULL
  `;

  // 3) baseline NS-1/repeat theo cohort — CHỈ ĐỌC, in ra console để lưu snapshot tay lần đầu.
  const baseline = await prisma.$queryRaw<Array<{ cohort: Date; new_buyers: bigint; repeat_30d: number }>>`
    WITH v AS (
      SELECT
        COALESCE(
          CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
          NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
          o."userId"
        ) AS customer_key,
        (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS t,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(
            CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
            NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
            o."userId"
          )
          ORDER BY o."createdAt", o.id
        ) AS n
      FROM orders o
      JOIN users u ON u.id = o."userId"
      WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
    ), f AS (
      SELECT a.customer_key, a.t AS t1, b.t AS t2
      FROM v a LEFT JOIN v b ON b.customer_key = a.customer_key AND b.n = 2
      WHERE a.n = 1
    )
    SELECT date_trunc('month', t1) AS cohort, COUNT(*) AS new_buyers,
           AVG(CASE WHEN t2 <= t1 + interval '30 days' THEN 1.0 ELSE 0 END) AS repeat_30d
    FROM f
    WHERE t1 < now() AT TIME ZONE 'Asia/Ho_Chi_Minh' - interval '30 days'
    GROUP BY 1 ORDER BY 1;
  `;
  console.log('Baseline NS-1 theo cohort:', baseline);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Chạy thử trên DB dev/staging (KHÔNG chạy thẳng prod ở bước này)**

```bash
cd apps/api && npx tsx scripts/backfill-analytics-2026-09.ts
```

Expected: exit 0, in ra bảng `baseline` (có thể rỗng nếu DB dev chưa có đơn nào đủ 30 ngày tuổi —
chấp nhận được, script vẫn chạy đúng logic).

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/backfill-analytics-2026-09.ts
git commit -m "feat(analytics): script backfill 1 lần cho source/platform/paidAt + baseline NS-1"
```

---

## Task 14: Cron tổng hợp đêm — `analytics-aggregation.service.ts`

**Files:**
- Create: `apps/api/src/modules/analytics/analytics-aggregation.service.ts`
- Create: `apps/api/src/modules/analytics/analytics-aggregation.service.spec.ts`
- Modify: `apps/api/src/modules/analytics/analytics.module.ts`

- [ ] **Step 1: Viết test trước — kiểm tra công thức tính, KHÔNG kiểm tra SQL thật (mock $queryRaw)**

```typescript
// apps/api/src/modules/analytics/analytics-aggregation.service.spec.ts
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsAggregationService.computeRetentionSnapshot', () => {
  it('tính đúng ordersPerBuyerMtd = tổng đơn / số buyer distinct trong tháng (chia không tròn)', async () => {
    const queryRawUnsafe = jest.fn()
      .mockResolvedValueOnce([{ new_buyers: 5n, active_buyers: 8n, orders_count: 12n }]) // ngày đang tính
      .mockResolvedValueOnce([{ orders_count: 41n, distinct_buyers: 10n }]) // luỹ kế tháng — CỐ Ý không chia tròn để bắt lỗi bigint-division
      .mockResolvedValueOnce([{ dau: 30n }]); // refresh_tokens proxy
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      retentionDailySnapshot: { upsert },
    } as unknown as PrismaService;

    const svc = new AnalyticsAggregationService(prisma);
    const result = await svc.computeRetentionSnapshot('2026-09-26');

    expect(result.newBuyers).toBe(5);
    expect(result.activeBuyers).toBe(8);
    expect(result.ordersCount).toBe(12);
    expect(result.ordersPerBuyerMtd).toBeCloseTo(4.1); // 41n/10n phải ra 4.1 (số thực), KHÔNG phải 4 (chia nguyên BigInt)
    expect(result.dauProxyRefreshToken).toBe(30);
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(1, expect.any(String), '2026-09-26');
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(2, expect.any(String), '2026-09-26');
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(3, expect.any(String), '2026-09-26');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: new Date('2026-09-26') },
        create: expect.objectContaining({ date: new Date('2026-09-26'), dauEventBased: null }),
        update: expect.objectContaining({ computedAt: expect.any(Date) }),
      }),
    );
  });

  it('distinct_buyers = 0 (chưa có đơn tháng này) → ordersPerBuyerMtd = 0, không chia cho 0', async () => {
    const queryRawUnsafe = jest.fn()
      .mockResolvedValueOnce([{ new_buyers: 0n, active_buyers: 0n, orders_count: 0n }])
      .mockResolvedValueOnce([{ orders_count: 0n, distinct_buyers: 0n }])
      .mockResolvedValueOnce([{ dau: 0n }]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      retentionDailySnapshot: { upsert: jest.fn().mockResolvedValue(undefined) },
    } as unknown as PrismaService;

    const svc = new AnalyticsAggregationService(prisma);
    const result = await svc.computeRetentionSnapshot('2026-09-01');

    expect(result.ordersPerBuyerMtd).toBe(0);
  });
});

describe('AnalyticsAggregationService.runNightly', () => {
  it('tính snapshot cho ngày VN hôm qua và log thành công', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      retentionDailySnapshot: { upsert },
    } as unknown as PrismaService;
    const svc = new AnalyticsAggregationService(prisma);

    await svc.runNightly();

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('computeRetentionSnapshot throw → runNightly bắt lỗi, không throw ra ngoài (cron không được crash)', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('DB tạm thời không kết nối được')),
      retentionDailySnapshot: { upsert: jest.fn() },
    } as unknown as PrismaService;
    const svc = new AnalyticsAggregationService(prisma);

    await expect(svc.runNightly()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

```bash
cd apps/api && npx jest src/modules/analytics/analytics-aggregation.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Viết implementation**

```typescript
// apps/api/src/modules/analytics/analytics-aggregation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

interface RetentionResult {
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
}

const CUSTOMER_KEY_SQL = `
  COALESCE(
    CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
    NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
    o."userId"
  )
`;

@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 3h sáng GIỜ VIỆT NAM (chốt cứng `timeZone`, không phụ thuộc giờ hệ điều hành host —
   * xem finding review Task 14: tính "hôm qua" bằng UTC-24h chỉ đúng nếu host cũng chạy UTC;
   * nếu host chạy giờ VN, kết quả lùi thêm 1 ngày).
   */
  @Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async runNightly(): Promise<void> {
    // Ngày VN hôm qua, tính TƯỜNG MINH bằng offset +7h thay vì phụ thuộc giờ host (cùng cách
    // game-economy.service.ts/loyalty.service.ts đã dùng cho "ngày VN" ở nơi khác).
    const dateKey = new Date(Date.now() + 7 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
    try {
      await this.computeRetentionSnapshot(dateKey);
      this.logger.log(`Đã tính retention_daily_snapshot cho ${dateKey}`);
    } catch (err) {
      this.logger.error(`Tính retention_daily_snapshot cho ${dateKey} thất bại: ${err instanceof Error ? err.stack : err}`);
    }
  }

  /** `day` là chuỗi 'YYYY-MM-DD' (ngày VN) — KHÔNG nhận `Date` để tránh nhầm lẫn UTC/VN ở caller. */
  async computeRetentionSnapshot(dateKey: string): Promise<RetentionResult> {
    const dailyRows = await this.prisma.$queryRawUnsafe<
      Array<{ new_buyers: bigint; active_buyers: bigint; orders_count: bigint }>
    >(`
      WITH v AS (
        SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
               ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
               ROW_NUMBER() OVER (PARTITION BY ${CUSTOMER_KEY_SQL} ORDER BY o."createdAt", o.id) AS n
        FROM orders o JOIN users u ON u.id = o."userId"
        WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
      )
      SELECT
        COUNT(*) FILTER (WHERE d = $1::date AND n = 1) AS new_buyers,
        COUNT(DISTINCT customer_key) FILTER (WHERE d = $1::date) AS active_buyers,
        COUNT(*) FILTER (WHERE d = $1::date) AS orders_count
      FROM v
    `, dateKey);
    const daily = dailyRows[0] ?? { new_buyers: 0n, active_buyers: 0n, orders_count: 0n };

    const mtdRows = await this.prisma.$queryRawUnsafe<
      Array<{ orders_count: bigint; distinct_buyers: bigint }>
    >(`
      WITH v AS (
        SELECT ${CUSTOMER_KEY_SQL} AS customer_key,
               ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t
        FROM orders o JOIN users u ON u.id = o."userId"
        WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
      )
      SELECT COUNT(*) AS orders_count, COUNT(DISTINCT customer_key) AS distinct_buyers
      FROM v
      WHERE date_trunc('month', t) = date_trunc('month', $1::date) AND t::date <= $1::date
    `, dateKey);
    const mtd = mtdRows[0] ?? { orders_count: 0n, distinct_buyers: 0n };

    const dauRows = await this.prisma.$queryRawUnsafe<Array<{ dau: bigint }>>(`
      SELECT COUNT(DISTINCT "userId") AS dau FROM refresh_tokens
      WHERE (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
    `, dateKey);
    const dau = dauRows[0]?.dau ?? 0n;

    const result: RetentionResult = {
      newBuyers: Number(daily.new_buyers),
      activeBuyers: Number(daily.active_buyers),
      ordersCount: Number(daily.orders_count),
      ordersPerBuyerMtd: Number(mtd.distinct_buyers) > 0 ? Number(mtd.orders_count) / Number(mtd.distinct_buyers) : 0,
      dauProxyRefreshToken: Number(dau),
    };

    await this.prisma.retentionDailySnapshot.upsert({
      where: { date: new Date(dateKey) },
      create: { date: new Date(dateKey), ...result, dauEventBased: null },
      update: { ...result, computedAt: new Date() },
    });

    return result;
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
cd apps/api && npx jest src/modules/analytics/analytics-aggregation.service.spec.ts
```

Expected: PASS 4/4.

- [ ] **Step 5: Đăng ký vào module**

Sửa `analytics.module.ts`, thêm `AnalyticsAggregationService` vào `providers`.

- [ ] **Step 6: Build**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/analytics
git commit -m "feat(analytics): cron đêm tính retention_daily_snapshot"
```

**Ghi chú phạm vi:** `CohortRepeatSnapshot`/`FunnelDailySnapshot` (repeat 30/60/90 theo cohort +
phễu từng bước) dùng CÙNG customer_key SQL ở trên nhưng là 2 job riêng, phức tạp hơn (cohort cần
quét lại mọi cohort chưa đủ tuổi, funnel cần join `analytics_events`). Ngoài phạm vi task này —
theo dõi ở Task 20 (mở rộng dashboard) nếu cần trước khi merge, hoặc để lại như TODO tracked rõ
ràng trong `analytics-aggregation.service.ts` (comment `// TODO(dự án con 2, phase 2): cohort +
funnel snapshot`) nếu quyết định ship MVP chỉ với `RetentionDailySnapshot` trước.

---

## Task 15: Test atomicity thật trên Postgres (rollback → không có event mồ côi)

**Files:**
- Create: `apps/api/test/integration-race/analytics-atomicity.race-spec.ts`

- [ ] **Step 1: Viết test dùng TestingModule thật + Postgres thật, theo đúng pattern
      `dealer.race-spec.ts`**

```typescript
// apps/api/test/integration-race/analytics-atomicity.race-spec.ts
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsModule } from '../../src/modules/analytics/analytics.module';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import './setup-env'; // guard DATABASE_URL phải trỏ tubutree_it, theo đúng convention có sẵn

describe('AnalyticsEventsService — atomic với transaction rollback (Postgres thật)', () => {
  it('transaction rollback → KHÔNG có dòng analytics_events mồ côi', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, AnalyticsModule] }).compile();
    const prisma = moduleRef.get(PrismaService);
    const analytics = moduleRef.get(AnalyticsEventsService);
    const eventId = `test-rollback-${Date.now()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await analytics.record(tx, { eventId, eventName: 'order_placed', platform: 'miniapp' });
        throw new Error('giả lập lỗi nghiệp vụ sau khi ghi event — phải rollback CẢ event');
      }),
    ).rejects.toThrow('giả lập lỗi nghiệp vụ');

    const orphan = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    expect(orphan).toBeNull();

    await moduleRef.close();
  });

  it('transaction commit thành công → dòng analytics_events tồn tại', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, AnalyticsModule] }).compile();
    const prisma = moduleRef.get(PrismaService);
    const analytics = moduleRef.get(AnalyticsEventsService);
    const eventId = `test-commit-${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      await analytics.record(tx, { eventId, eventName: 'order_placed', platform: 'miniapp' });
    });

    const saved = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    expect(saved).not.toBeNull();

    await prisma.analyticsEvent.delete({ where: { eventId } }); // dọn dữ liệu test
    await moduleRef.close();
  });
});
```

- [ ] **Step 2: Chạy test với DB throwaway `tubutree_it` (đúng convention có sẵn trong repo)**

```bash
cd apps/api
DATABASE_URL="postgresql://tubu:<pass>@localhost:5432/tubutree_it" npx jest -c test/integration-race/jest.config.js --runInBand analytics-atomicity
```

Expected: PASS 2/2. Nếu DB `tubutree_it` chưa tồn tại, tạo trước bằng
`createdb tubutree_it && DATABASE_URL=... npx prisma migrate deploy` (đúng giá trị `DATABASE_URL`
dùng ở lệnh test).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration-race/analytics-atomicity.race-spec.ts
git commit -m "test(analytics): xác nhận atomic thật — rollback không để lại event mồ côi"
```

---

## Task 16: FE miniapp — header `X-Device-Id`/`X-Client-Platform` + export `getDeviceId`

**Files:**
- Modify: `apps/miniapp/src/store/auth.ts:21-29`
- Modify: `apps/miniapp/src/services/api.ts:54-68`

- [ ] **Step 1: Export `getDeviceId` từ `store/auth.ts`**

Đọc hàm `getDeviceId()` hiện tại (dòng 21-29, không export). Đổi `async function getDeviceId()`
thành `export async function getDeviceId()`. Giữ nguyên toàn bộ thân hàm.

- [ ] **Step 2: Thêm 2 header vào interceptor của `api.ts`**

Đọc interceptor hiện tại (dòng 54-68). Import ở đầu file (dùng `import type` để tránh vòng phụ
thuộc thật sự — `store/auth.ts` chỉ cung cấp hàm thuần, không import ngược `api.ts` từ đây, nhưng
`store/auth.ts` ĐANG import `api.ts` ở nơi khác cho các call login — kiểm tra lại: nếu
`store/auth.ts` top-level import từ `api.ts`, dùng **dynamic import** trong interceptor thay vì
static import để chắc chắn không vòng lặp):

```typescript
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (authReady && !config.url?.includes('/auth/')) {
    const pending = authReady;
    await Promise.race([
      pending.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, AUTH_READY_TIMEOUT_MS)),
    ]);
  }
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  // Guard riêng (không dùng chung khối try/catch của authReady phía trên) — nếu bridge storage
  // lỗi (zmp-sdk phiên bản cũ, quota, bridge chưa sẵn sàng...) thì CHỈ mất header thiết bị (dữ
  // liệu phân tích), KHÔNG được làm hỏng TOÀN BỘ request mạng của app (phát hiện ở review Task
  // 16: trước đây getDeviceId() chỉ chạy trong luồng đăng nhập khách, có try/catch riêng; giờ
  // chạy ở MỌI request nên bán kính ảnh hưởng nếu lỗi lớn hơn hẳn).
  const { getDeviceId } = await import('../store/auth');
  const deviceId = await getDeviceId().catch(() => undefined);
  if (deviceId) config.headers.set('X-Device-Id', deviceId);
  config.headers.set('X-Client-Platform', 'miniapp');
  return config;
});
```

- [ ] **Step 3: Chạy test hiện có của `api.ts`/`auth.ts`**

```bash
cd apps/miniapp && npx vitest run src/services/api.spec.ts
```

Expected: PASS toàn bộ (test hiện có không assert số header cố định, chỉ test `getErrorMessage`).

- [ ] **Step 4: Build thử**

```bash
cd apps/miniapp && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/store/auth.ts apps/miniapp/src/services/api.ts
git commit -m "feat(analytics): gắn X-Device-Id + X-Client-Platform vào mọi request miniapp"
```

---

## Task 17: FE miniapp — `services/analytics.ts` (hàng đợi gộp lô)

**Files:**
- Create: `apps/miniapp/src/services/analytics.ts`
- Create: `apps/miniapp/src/services/analytics.spec.ts`

- [ ] **Step 1: Viết test trước**

```typescript
// apps/miniapp/src/services/analytics.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: { accepted: 1 } }) } }));

import { trackEvent, flushEventQueue, flushEventQueueOnHide, __resetQueueForTest } from './analytics';
import { api } from './api';

describe('trackEvent / flushEventQueue', () => {
  beforeEach(() => __resetQueueForTest());
  afterEach(() => vi.clearAllMocks());

  it('gom sự kiện vào hàng đợi, chưa gửi ngay', () => {
    trackEvent('app_opened', 'miniapp', {});
    expect(api.post).not.toHaveBeenCalled();
  });

  it('flush gửi đúng payload, mỗi sự kiện có eventId dạng uuid', async () => {
    trackEvent('screen_viewed', 'miniapp', { route: '/home' });
    await flushEventQueue();
    expect(api.post).toHaveBeenCalledTimes(1);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventName).toBe('screen_viewed');
    expect(body.events[0].eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('flush khi hàng đợi rỗng → không gọi API', async () => {
    await flushEventQueue();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('đủ 50 sự kiện → tự flush ngay không cần gọi thủ công', () => {
    for (let i = 0; i < 50; i++) trackEvent('screen_viewed', 'miniapp', { i });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('flush lỗi mạng → không throw ra ngoài (best-effort, CHẤP NHẬN mất lô này, không giữ lại)', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    trackEvent('client_error', 'miniapp', {});
    await expect(flushEventQueue()).resolves.toBeUndefined();
  });
});

describe('flushEventQueueOnHide', () => {
  beforeEach(() => __resetQueueForTest());
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('sendBeacon thành công → KHÔNG gọi api.post (đã gửi bằng beacon)', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    trackEvent('client_error', 'miniapp', {});

    flushEventQueueOnHide();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sendBeacon thất bại (trả false) → PHẢI gửi lại batch đã lấy ra qua api.post, không rơi mất', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    vi.stubGlobal('navigator', { sendBeacon });
    trackEvent('client_error', 'miniapp', { foo: 'bar' });

    flushEventQueueOnHide();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].props).toEqual({ foo: 'bar' });
  });

  it('không có navigator.sendBeacon (môi trường không hỗ trợ) → gửi thẳng qua api.post', () => {
    vi.stubGlobal('navigator', {});
    trackEvent('client_error', 'miniapp', {});

    flushEventQueueOnHide();

    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

```bash
cd apps/miniapp && npx vitest run src/services/analytics.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Viết implementation**

```typescript
// apps/miniapp/src/services/analytics.ts
import { api } from './api';

interface QueuedEvent {
  eventId: string;
  eventName: string;
  occurredAt: string;
  platform: 'miniapp';
  props: Record<string, unknown>;
  entrySource?: string;
  notificationId?: string;
  refCode?: string;
  storefrontSlug?: string;
}

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 10_000;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function newEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function trackEvent(
  eventName: string,
  platform: 'miniapp',
  props: Record<string, unknown>,
  extra?: Partial<Pick<QueuedEvent, 'entrySource' | 'notificationId' | 'refCode' | 'storefrontSlug'>>,
): void {
  queue.push({
    eventId: newEventId(),
    eventName,
    occurredAt: new Date().toISOString(),
    platform,
    props,
    ...extra,
  });
  if (queue.length >= MAX_BATCH) void flushEventQueue();
  ensureTimer();
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushEventQueue(), FLUSH_INTERVAL_MS);
}

export async function flushEventQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await api.post('/events', { events: batch });
  } catch {
    // best-effort — không throw, không dồn lại vô hạn (tránh rò rỉ bộ nhớ nếu mất mạng dài hạn);
    // chấp nhận mất lô này, đúng bản chất "best-effort" của sự kiện không phải tiền.
  }
}

export function flushEventQueueOnHide(): void {
  if (queue.length === 0) return;
  // Lấy batch ra khỏi queue MỘT LẦN rồi giữ biến cục bộ — KHÔNG được gọi flushEventQueue() ở
  // nhánh dự phòng bên dưới vì queue module-level đã rỗng ngay sau splice() này (phát hiện ở
  // review Task 17: gọi lại flushEventQueue() sau khi đã splice queue rỗng khiến nhánh dự
  // phòng — chính xác lúc sendBeacon thất bại/không có — là no-op câm lặng, mất trắng dữ liệu).
  const batch = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ events: batch });
  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const ok = navigator.sendBeacon('/api/events', body);
    if (ok) return;
  }
  // sendBeacon không khả dụng hoặc thất bại — gửi lại bằng chính `batch` đã lấy ra ở trên qua
  // fetch thường (best-effort, không throw).
  void api.post('/events', { events: batch }).catch(() => {});
}

export function __resetQueueForTest(): void {
  queue = [];
  if (timer) clearInterval(timer);
  timer = null;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
cd apps/miniapp && npx vitest run src/services/analytics.spec.ts
```

Expected: PASS 8/8 (5 test cũ + 3 test mới cho `flushEventQueueOnHide`).

- [ ] **Step 5: `tsc --noEmit`**

```bash
cd apps/miniapp && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/services/analytics.ts apps/miniapp/src/services/analytics.spec.ts
git commit -m "feat(analytics): hàng đợi gộp lô sự kiện FE miniapp"
```

**Đã sửa ở review Task 17:** nhánh dự phòng khi `sendBeacon` thất bại/không có giờ gửi THẲNG
`batch` đã lấy ra qua `api.post()` (dùng đúng `baseURL` cấu hình của `api.ts`) thay vì gọi lại
`flushEventQueue()` trên `queue` module-level đã bị splice rỗng — trước đó là mất trắng dữ liệu
câm lặng ở đúng nhánh này.

**Rủi ro kỹ thuật còn lại, cần xác minh khi có thiết bị Zalo thật** (không chặn merge):
`sendBeacon` (khi thật sự gọi được) vẫn dùng path tuyệt đối hard-code `/api/events` — `sendBeacon`
không dùng được instance axios của `api.ts` (cần 1 chuỗi URL, không phải request qua axios), nên
không thể tái dùng `baseURL` trực tiếp; cần đọc `baseURL` thật (biến môi trường `VITE_API_BASE_URL`
mà `api.ts` dùng) rồi ghép thủ công thành URL đầy đủ TRƯỚC khi bật tính năng này trên production.
Nếu Zalo webview không hỗ trợ `sendBeacon` (thường gặp), nhánh `api.post` fallback đã sửa vẫn chạy
được nhưng bản thân đó là 1 request bất đồng bộ có thể bị trình duyệt huỷ giữa chừng lúc trang ẩn
(hạn chế vốn có của kiến trúc "gửi lúc unload", không phải bug riêng của code này) — chấp nhận mất
một phần sự kiện cuối phiên (đã là best-effort).

---

## Task 18: FE miniapp — route tracker + `app_opened`

**Files:**
- Create: `apps/miniapp/src/hooks/use-screen-tracker.ts`
- Modify: `apps/miniapp/src/components/app.tsx`

- [ ] **Step 1: Viết hook route tracker**

```typescript
// apps/miniapp/src/hooks/use-screen-tracker.ts
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackEvent } from '../services/analytics';

export function useScreenTracker(): void {
  const location = useLocation();
  const prevRoute = useRef<string | null>(null);
  const mountedAt = useRef<number>(Date.now());

  useEffect(() => {
    trackEvent('screen_viewed', 'miniapp', {
      route: location.pathname,
      prevRoute: prevRoute.current,
      msToContent: Date.now() - mountedAt.current,
    });
    prevRoute.current = location.pathname;
    mountedAt.current = Date.now();
  }, [location.pathname]);
}
```

- [ ] **Step 2: Gắn vào `app.tsx` + phát `app_opened` lúc mount**

Đọc `components/app.tsx` hiện tại (khối `<ZMPRouter>` dòng 152-204). `useScreenTracker()` phải gọi
BÊN TRONG một component con render trong `<ZMPRouter>` (vì `useLocation()` cần context Router) —
KHÔNG gọi được ở component `App` cấp cao nhất bên ngoài `ZMPRouter`. Thêm một component nhỏ ngay
trong file:

```typescript
function ScreenTracker() {
  useScreenTracker();
  return null;
}
```

Thêm `<ScreenTracker />` làm phần tử ĐẦU TIÊN bên trong `<ZMPRouter>` (ngay sau dòng mở
`<ZMPRouter>`, trước `<Suspense>`). Thêm import `useScreenTracker` + `trackEvent`.

Thêm phát `app_opened` trong `useEffect` mount của component `App` (component cấp cao nhất, đã có
sẵn `useEffect` khởi tạo — nếu chưa có, thêm mới ngay sau khai báo component):

```typescript
  useEffect(() => {
    void trackEvent('app_opened', 'miniapp', { entrySource: 'organic' });
  }, []);
```

- [ ] **Step 3: Test hook (mock react-router-dom's useLocation)**

```typescript
// apps/miniapp/src/hooks/use-screen-tracker.spec.ts (mới)
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useScreenTracker } from './use-screen-tracker';

vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
import { trackEvent } from '../services/analytics';

describe('useScreenTracker', () => {
  it('phát screen_viewed với route hiện tại khi mount', () => {
    renderHook(() => useScreenTracker(), { wrapper: ({ children }) => <MemoryRouter initialEntries={['/home']}>{children}</MemoryRouter> });
    expect(trackEvent).toHaveBeenCalledWith('screen_viewed', 'miniapp', expect.objectContaining({ route: '/home' }));
  });
});
```

- [ ] **Step 4: Chạy test**

```bash
cd apps/miniapp && npx vitest run src/hooks/use-screen-tracker.spec.ts
```

Expected: PASS 1/1 (nếu repo chưa có `@testing-library/react` đã cài, kiểm tra `package.json` — nếu
thiếu, dùng cách test đơn giản hơn: gọi trực tiếp logic không qua `renderHook`, hoặc thêm dependency
`@testing-library/react` vào `devDependencies` trước).

- [ ] **Step 5: Build**

```bash
cd apps/miniapp && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/hooks/use-screen-tracker.ts apps/miniapp/src/hooks/use-screen-tracker.spec.ts apps/miniapp/src/components/app.tsx
git commit -m "feat(analytics): route tracker (screen_viewed) + app_opened"
```

---

## Task 19: FE miniapp — 5 điểm phát còn lại (product_viewed, search_performed, checkout_started, notification_opened, client_error)

**Files:**
- Modify: `apps/miniapp/src/pages/product-detail.tsx`
- Modify: `apps/miniapp/src/pages/browse.tsx`
- Modify: `apps/miniapp/src/pages/checkout.tsx`
- Modify: `apps/miniapp/src/pages/notifications.tsx`
- Modify: `apps/miniapp/src/components/error-boundary.tsx`

Với mỗi file: đọc điểm đã xác định trong spec/audit (PDP khi `product.isSuccess`; browse khi trang
1 trả về với `debouncedQ`; checkout khi quote thành công lần đầu; notifications khi chạm 1 thông
báo; error-boundary trong `componentDidCatch` + thêm `window.onerror`/`unhandledrejection` global),
thêm lời gọi `trackEvent(...)` tương ứng với thuộc tính đúng bảng 18 sự kiện (audit §7.4). Mỗi
điểm là 1 bước, KHÔNG viết test riêng cho từng điểm phát (đã test kỹ `trackEvent` ở Task 17) — chỉ
cần build sạch + smoke test thủ công ở Task 21.

- [ ] **Step 1: `product-detail.tsx` — đã verify lại thật (2026-09-27, trong lúc chờ Task 5):
      KHÔNG dùng `product.data.variations?.[0]` (biến thể ĐẦU danh sách) — component đã tự tính
      sẵn biến thể ĐANG CHỌN đúng (`selected`, dòng ~124-130: ưu tiên `selectedId`, else biến thể
      còn hàng đầu tiên, else phần tử đầu) và giá flash đã resolve sẵn (`flashItem`/`price`, dòng
      ~133/203) — dùng LẠI các biến này, không tính lại. `VariationDetail` (`shop-api.ts:25-33`)
      KHÔNG có field `flashPrice` (giá flash nằm ở `flashItem.flashPrice`, một object riêng từ
      `flashQ`, không phải thuộc tính tĩnh của variation).**

**Sửa lại sau review (2026-09-28) — 2 vấn đề thật đều liên quan tới VỊ TRÍ đặt effect và tần suất
phát:**

1. **Rules of Hooks:** trang có early-return loading/error TRƯỚC chỗ khai báo `price` (dòng
   ~203-220 → `price` khai báo sau) — đặt hook sau early-return làm số lượng hook đổi giữa các lần
   render, React sẽ throw. Phải đặt effect TRƯỚC 2 early-return đó, và tính lại công thức giá y hệt
   `price` bằng chính `product.data`/`selected`/`flashItem` (đều đã có trong scope ở vị trí đó),
   KHÔNG dùng biến `price`/`location` (biến `location` cũng không tồn tại trong file — chỉ có
   `navState` từ `useLocation().state`).
2. **Phát trùng/phát sai do `flashQ` refetch mỗi 60s:** `flashQ` (giờ vàng) có
   `refetchInterval: 60_000`, mỗi lần trả về vẫn tạo object `flashItem` MỚI (React Query structural
   sharing đổi khi `soldCount` đổi) dù người dùng không thao tác gì — nếu deps effect theo tham
   chiếu `flashItem` thì khách đứng yên trên trang giờ vàng vẫn phát `product_viewed` lặp lại mỗi
   phút, làm sai tỉ lệ chuyển đổi PDP→giỏ của đúng nhóm hàng giờ vàng cần đo nhất. Kèm race lúc vào
   trang lần đầu: nếu `flashQ` chưa có cache, sự kiện đầu tiên phát `isFlash:false`, rồi phát thêm
   lần 2 `isFlash:true` khi `flashQ` resolve. Sửa: chờ `flashQ.isPending` xong mới phát, và chỉ phát
   1 LẦN cho mỗi cặp (sản phẩm, biến thể) bằng một `useRef` khoá theo `${productId}:${variationId}`.

```typescript
  const trackedViewKey = useRef<string | null>(null);
  useEffect(() => {
    // ĐẶT Ở ĐÂY (trước early-return loading/error bên dưới), KHÔNG đặt cạnh biến `price` (khai
    // báo sau early-return) — xem lý do Rules of Hooks ở trên. Tính lại công thức giá y hệt
    // `price`, dùng `product.data` (đã guard non-null) thay vì biến `p`.
    if (!product.isSuccess || !product.data || !selected || flashQ.isPending) return;
    const viewKey = `${product.data.id}:${selected.id}`;
    if (trackedViewKey.current === viewKey) return;
    trackedViewKey.current = viewKey;
    const baseSelectedPrice = selected.salePrice ?? selected.retailPrice ?? product.data.basePrice;
    const viewPrice = flashItem ? Math.min(flashItem.flashPrice, baseSelectedPrice) : baseSelectedPrice;
    void trackEvent('product_viewed', 'miniapp', {
      productId: product.data.id,
      variationId: selected.id,
      price: viewPrice,
      isFlash: Boolean(flashItem),
      inStock: selected.stock > 0,
      listSource: navState?.listSource ?? 'browse',
    });
  }, [product.isSuccess, product.data, selected, flashItem, flashQ.isPending]);
```

- [ ] **Step 2: `browse.tsx` — khi trang 1 trả về với `debouncedQ`. Đã verify lại thật
      (2026-09-27): tên biến query là `products` (`useInfiniteQuery`, dòng ~90), KHÔNG PHẢI
      `data`; kiểu trang là `PageResponse<T> = { data: T[]; meta: { page, limit, total } }`
      (`shop-api.ts:5-7`) — mảng SP nằm ở field `data`, KHÔNG PHẢI `items`, và `meta.total` luôn
      có sẵn (không cần fallback `?.length`).**

**Sửa lại sau review (2026-09-28):** deps theo cả mảng `products.data?.pages` phát lại mỗi lần
khách bấm "Xem thêm" (`fetchNextPage` tạo mảng `pages` MỚI khi nối thêm trang, dù trang 1 bên trong
không đổi) — làm phồng số liệu tìm kiếm thành công (đúng nhóm tìm ra kết quả và cuộn thêm), trong
khi KPI chính của sự kiện này (tỉ lệ tìm KHÔNG ra kết quả, §7.4) không bao giờ phân trang nên không
bị ảnh hưởng — nhưng vẫn nên phát đúng 1 lần/lượt tìm. Sửa deps sang PHẦN TỬ trang 1
(`products.data?.pages?.[0]`), không phải cả mảng — React Query giữ nguyên tham chiếu các trang đã
tải khi `fetchNextPage` chỉ nối thêm, nên trang 1 không đổi tham chiếu qua các lần cuộn thêm, chỉ
đổi khi chính trang 1 thật sự refetch:

```typescript
  useEffect(() => {
    const firstPage = products.data?.pages?.[0];
    if (!debouncedQ || !firstPage) return;
    void trackEvent('search_performed', 'miniapp', {
      q: debouncedQ,
      resultsCount: firstPage.meta.total,
    });
  }, [debouncedQ, products.data?.pages?.[0]]);
```

- [ ] **Step 3: `checkout.tsx` — lần quote thành công đầu tiên**

Thêm `useRef<boolean>(false)` đánh dấu đã phát chưa (tránh phát lại mỗi lần quote refetch), phát
trong effect khi `quote.isSuccess` chuyển từ false→true lần đầu. Đã verify lại thật (2026-09-27):
`cart` ở trang này cũng là kết quả `useQuery` (giống `product-detail.tsx`) — giỏ hàng nằm ở
`cart.data.items`, KHÔNG PHẢI `cart.items` trực tiếp; `itemIds`/`quote` là 2 biến thật đã xác nhận
(dòng ~100, ~116):

```typescript
  const trackedCheckoutStarted = useRef(false);
  useEffect(() => {
    if (!quote.isSuccess || trackedCheckoutStarted.current) return;
    trackedCheckoutStarted.current = true;
    void trackEvent('checkout_started', 'miniapp', {
      itemCount: itemIds?.length ?? cart.data?.items?.length ?? 0,
      subtotal: quote.data?.subtotal ?? 0,
      entry: itemIds ? 'buy_now' : 'cart',
      isSubset: !!itemIds,
    });
  }, [quote.isSuccess]);
```

**Hạn chế đã biết, CHẤP NHẬN cho MVP này (phát hiện ở review 2026-09-28, không sửa trong task
này):** `entry: itemIds ? 'buy_now' : 'cart'` không phân biệt được "Mua ngay" (PDP, luôn có
`itemIds` 1 phần tử) với "checkout MỘT PHẦN giỏ" (trang Giỏ, khách bỏ chọn vài món — `cart.tsx`
cũng gửi `itemIds` khi `!allSelected`) — cả 2 đều có `itemIds` nên đều bị gắn nhãn `buy_now`. Muốn
phân biệt đúng cần thêm 1 cờ tường minh (`checkoutEntry`) truyền qua navigation state ở CẢ 2 nơi
điều hướng tới `/checkout` (`product-detail.tsx` nút "Mua ngay" VÀ `cart.tsx` nút "Thanh toán"),
cộng thêm việc mở rộng `utils/checkout-selection.ts` để cờ đó sống sót qua reload trang (giống cơ
chế `rememberCheckoutSelection`/`recallCheckoutSelection` đã có cho `itemIds`) — phạm vi rộng hơn 1
task, để dành cho whole-branch review hoặc 1 task riêng nếu quyết định làm. Trường `isSubset` thêm
ở trên là bước trung gian rẻ tiền: tối thiểu phân biệt được "có chọn tập con" hay không, dù nhãn
`entry` tự nó vẫn chưa hoàn toàn chính xác.

- [ ] **Step 4: `notifications.tsx` — khi chạm 1 thông báo**

Tìm handler `onClick`/`onPress` hiện có của item thông báo, thêm ngay đầu handler:

```typescript
    void trackEvent('notification_opened', 'miniapp', { notificationId: n.id, templateCode: n.templateCode });
```

- [ ] **Step 5: `error-boundary.tsx` — `componentDidCatch` + global handler**

Trong `componentDidCatch(error, info)` (đã có `console.error`), thêm ngay sau:

```typescript
    // KHÔNG dùng error.message trực tiếp — React truyền NGUYÊN VĂN bất kỳ giá trị nào bị throw,
    // không chỉ instance Error thật (vd `throw 'chuỗi lỗi'`, `throw undefined`). Nếu error không
    // phải Error, `.message` là undefined và hashMessage(undefined) throw ngay TRONG
    // componentDidCatch — lỗi trong chính error boundary duy nhất của app sẽ đẩy lên React, làm
    // unmount CẢ CÂY, tức đúng màn hình trắng mà component này được viết ra để tránh (phát hiện ở
    // review Task 19). Luôn ép về string trước khi hash, giống cách 2 global handler bên dưới đã
    // làm với String(...).
    void trackEvent('client_error', 'miniapp', {
      kind: 'render',
      route: window.location.pathname,
      messageHash: hashMessage(error instanceof Error ? error.message : String(error)),
    });
```

Thêm hàm `hashMessage` đơn giản (không cần crypto mạnh, chỉ để gom nhóm lỗi giống nhau, không lộ
message thật ra ngoài event log dài hạn):

```typescript
function hashMessage(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
```

Thêm global handler ở file khởi tạo app (`components/app.tsx`, trong `useEffect` mount đã thêm ở
Task 18 Step 2):

```typescript
    // window.addEventListener('error', ...) chứ KHÔNG gán window.onerror = ... — gán trực tiếp
    // GHI ĐÈ bất kỳ handler nào khác đã/sẽ gán vào window.onerror (kể cả của thư viện bên thứ 3),
    // addEventListener cho phép nhiều listener cùng tồn tại (phát hiện ở review Task 19).
    window.addEventListener('error', (e) => {
      void trackEvent('client_error', 'miniapp', { kind: 'render', messageHash: hashMessage(String(e.message)) });
    });
    window.addEventListener('unhandledrejection', (e) => {
      void trackEvent('client_error', 'miniapp', { kind: 'api', messageHash: hashMessage(String(e.reason)) });
    });
```

(import `hashMessage` từ `error-boundary.tsx` — export nó thay vì để private).

- [ ] **Step 6: Build toàn bộ**

```bash
cd apps/miniapp && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Chạy test hiện có (không được vỡ)**

```bash
cd apps/miniapp && npx vitest run
```

Expected: PASS toàn bộ suite hiện có.

- [ ] **Step 8: Commit**

```bash
git add apps/miniapp/src/pages/product-detail.tsx apps/miniapp/src/pages/browse.tsx apps/miniapp/src/pages/checkout.tsx apps/miniapp/src/pages/notifications.tsx apps/miniapp/src/components/error-boundary.tsx apps/miniapp/src/components/app.tsx
git commit -m "feat(analytics): product_viewed/search_performed/checkout_started/notification_opened/client_error"
```

---

## Task 20: Web admin — API client + trang dashboard

**Files:**
- Modify: `apps/web/src/lib/client-api.ts` (thêm header platform)
- Modify: `apps/web/src/lib/admin-client.ts` (thêm hàm gọi API mới)
- Create: `apps/web/src/app/admin/analytics-tab.tsx`
- Modify: `apps/web/src/app/admin/page.tsx` (3 chỗ + 1 import)

- [ ] **Step 1: Backend — endpoint đọc dashboard**

```typescript
// apps/api/src/modules/analytics/analytics-admin.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin/analytics')
@Roles('ADMIN')
export class AnalyticsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('retention-daily')
  async retentionDaily(@Query('days') days = '30') {
    const n = Math.min(90, Math.max(1, Number(days) || 30));
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - n);
    return this.prisma.retentionDailySnapshot.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
    });
  }
}
```

Đăng ký vào `analytics.module.ts` (`controllers: [AnalyticsController, AnalyticsAdminController]`).

- [ ] **Step 2: Test controller (mock prisma, xác nhận clamp `days` 1..90)**

```typescript
// apps/api/src/modules/analytics/analytics-admin.controller.spec.ts
import { AnalyticsAdminController } from './analytics-admin.controller';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsAdminController.retentionDaily', () => {
  it('days=200 bị clamp về 90', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma).retentionDaily('200');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(91);
    expect(diffDays).toBeGreaterThanOrEqual(89);
  });

  it('days không hợp lệ (NaN) → mặc định 30', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma).retentionDaily('abc');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(31);
    expect(diffDays).toBeGreaterThanOrEqual(29);
  });
});
```

- [ ] **Step 3: Chạy test BE**

```bash
cd apps/api && npx jest src/modules/analytics/analytics-admin.controller.spec.ts
```

Expected: PASS 2/2.

- [ ] **Step 4: FE — thêm header platform vào `client-api.ts`**

Đọc `apiFetch` hiện tại trong `client-api.ts`. Thêm vào object headers đang xây dựng (bất kể tên
biến thật là gì — đọc lại trước khi sửa):

```typescript
    'X-Client-Platform': 'web',
```

- [ ] **Step 5: FE — hàm gọi API mới trong `admin-client.ts`**

Thêm cuối file (theo đúng convention `export const fn = (...) => apiFetch<T>(path)` đã thấy):

```typescript
export interface RetentionDailyRow {
  date: string;
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
  dauEventBased: number | null;
}
export const getRetentionDaily = (days = 30) =>
  apiFetch<RetentionDailyRow[]>(`/admin/analytics/retention-daily?days=${days}`);
```

- [ ] **Step 6: Component dashboard**

```typescript
// apps/web/src/app/admin/analytics-tab.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getRetentionDaily } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';

export function AnalyticsTab() {
  const q = useQuery({ queryKey: ['admin-analytics-retention'], queryFn: () => getRetentionDaily(30) });

  if (q.isLoading) return <p className="text-sm text-neutral-500">Đang tải…</p>;
  if (q.isError) return <p className="text-sm text-red-600">Không tải được số liệu retention.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Chưa có snapshot nào — cron tính lúc 3h sáng, quay lại sau.</p>;
  }
  const latest = rows[rows.length - 1];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Khách mới hôm qua" value={latest.newBuyers} />
        <StatCard label="Khách hoạt động hôm qua" value={latest.activeBuyers} />
        <StatCard label="Đơn hôm qua" value={latest.ordersCount} />
        <StatCard label="Đơn/khách/tháng (luỹ kế)" value={latest.ordersPerBuyerMtd.toFixed(2)} />
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-1">Ngày</th>
            <th>Khách mới</th>
            <th>Đơn</th>
            <th>DAU (proxy)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-t border-neutral-100">
              <td className="py-1">{new Date(r.date).toLocaleDateString('vi-VN')}</td>
              <td>{r.newBuyers}</td>
              <td>{r.ordersCount}</td>
              <td>{r.dauProxyRefreshToken}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
```

(giữ `formatVnd` import chỉ nếu dùng — nếu không hiển thị tiền ở MVP này thì bỏ import đó để tránh
lỗi unused-import khi build).

- [ ] **Step 7: Wire vào `page.tsx` — 3 chỗ + 1 import**

Thêm import (đầu file, cạnh các import khác):

```typescript
import { AnalyticsTab } from './analytics-tab';
```

Sửa `Tab` union (dòng 95-113), thêm 1 dòng trước dấu `;` đóng:

```typescript
  | 'posCredits'
  | 'analytics';
```

Sửa `TABS` array (dòng 114-133), thêm entry cuối trước dấu `]`:

```typescript
  { k: 'posCredits', label: 'Tích điểm tại quầy' },
  { k: 'analytics', label: 'Retention & North-star' },
```

Sửa render branch (dòng 221-240), thêm dòng cuối trước `</div>`:

```typescript
        {tab === 'quickReplies' && <QuickReplyTab />}
        {tab === 'analytics' && <AnalyticsTab />}
```

- [ ] **Step 8: Build web**

```bash
cd apps/web && npx tsc --noEmit && npx next build
```

Expected: cả 2 lệnh exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/analytics/analytics-admin.controller.ts apps/api/src/modules/analytics/analytics-admin.controller.spec.ts apps/api/src/modules/analytics/analytics.module.ts apps/web/src/lib/client-api.ts apps/web/src/lib/admin-client.ts apps/web/src/app/admin/analytics-tab.tsx apps/web/src/app/admin/page.tsx
git commit -m "feat(analytics): dashboard admin — tab Retention & North-star"
```

---

## Task 21: Playwright — trang dashboard mới

**Files:**
- Create: `apps/e2e/tests/admin-analytics.spec.ts`

**Đã verify lại thật (2026-09-27, trong lúc chờ Task 5) — bản nháp ban đầu của brief này giả định
SAI:** `apps/e2e/tests/admin.spec.ts` KHÔNG có helper kiểu `loginAsAdmin(page)`. Bộ test e2e ở đây
dùng 1 fixture mock-api dùng chung (`./support/mock-api`): MỌI request `/api/**` phải được mock
tường minh, không khớp mock nào → fixture tự FAIL test (404 `E2E_UNMOCKED`) thay vì âm thầm gọi ra
API dev thật. "Đăng nhập" ở đây thực chất là mock `POST /auth/refresh` trả về user ADMIN + đặt cờ
`tubu_web_session` vào `localStorage` TRƯỚC khi trang tải (qua `addInitScript`), không phải điền
form đăng nhập thật.

- [ ] **Step 1: Viết test theo ĐÚNG pattern thật của `admin.spec.ts` (đã đọc trực tiếp file đó) —
      không dùng helper không tồn tại**

```typescript
// apps/e2e/tests/admin-analytics.spec.ts
import { test, expect, type MockApi } from './support/mock-api';
import type { RetentionDailyRow } from '../../web/src/lib/admin-client';

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: {
    id: 'admin-1',
    role: 'ADMIN',
    fullName: 'Test Admin',
    avatarUrl: null,
    pointsBalance: 0,
    walletBalance: 0,
    referralCode: 'ADMIN1',
  },
};

/** Phiên admin giả — cùng cơ chế `mockAdminSession` đã dùng trong admin.spec.ts (không export
 *  được nên chép lại tối thiểu ở đây, không import chéo giữa 2 file test). */
function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 0,
    itemCount: 0,
  });
}

test.describe('Admin — tab Retention & North-star', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('có snapshot → hiển thị số liệu ngày mới nhất', async ({ page: p, api }) => {
    const rows: RetentionDailyRow[] = [
      {
        date: '2026-09-26T00:00:00.000Z',
        newBuyers: 5,
        activeBuyers: 8,
        ordersCount: 12,
        ordersPerBuyerMtd: 4.1,
        dauProxyRefreshToken: 30,
        dauEventBased: null,
      },
    ];
    api.get('/admin/analytics/retention-daily', rows);

    await p.goto('/admin?tab=analytics');

    await expect(p.getByText('Retention & North-star')).toBeVisible();
    await expect(p.getByText('Khách mới hôm qua')).toBeVisible();
    await expect(p.getByText('5', { exact: true })).toBeVisible();
  });

  test('snapshot rỗng (cron chưa chạy lần nào) → hiện thông báo, KHÔNG crash', async ({ page: p, api }) => {
    api.get('/admin/analytics/retention-daily', []);

    await p.goto('/admin?tab=analytics');

    await expect(p.getByText('Retention & North-star')).toBeVisible();
    await expect(p.getByText('Chưa có snapshot nào')).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy test**

```bash
cd apps/e2e && npx playwright test admin-analytics.spec.ts --project="Web Admin"
```

Expected: PASS 2/2. Nếu fixture báo `E2E_UNMOCKED` cho một request khác (vd trang admin còn gọi
thêm API nào đó lúc mount ngoài `/auth/refresh`, `/cart`, `/admin/analytics/retention-daily`), đọc
log lỗi để biết đúng path cần mock thêm — KHÔNG nới lỏng fixture, chỉ thêm mock còn thiếu.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/admin-analytics.spec.ts
git commit -m "test(analytics): Playwright cho tab dashboard admin mới"
```

---

## Task 22: Cập nhật ghi chú deploy

**Files:**
- Modify: `docs/2026-09-27-wip-completion-deploy-notes.md` (hoặc file ghi chú deploy hiện hành mới
  nhất trên nhánh — đọc lại tên file thật, có thể đã đổi tên/thêm file mới sau audit).

- [ ] **Step 1: Thêm mục "Dự án con 2 — Analytics nền" vào ghi chú deploy**

Thêm đoạn:

```markdown
## Dự án con 2 — Analytics nền

- Migration mới: `analytics_foundation` (bảng `analytics_events`, `retention_daily_snapshot`,
  `cohort_repeat_snapshot`, `funnel_daily_snapshot` + 5 cột `Order`) — additive, an toàn deploy.
  Chạy `prisma migrate deploy` TRƯỚC khi restart API — `AnalyticsAggregationService` chạm bảng
  `retention_daily_snapshot` ngay từ lần cron đầu tiên sau khi service khởi động.
- Sau khi `prisma migrate deploy`: chạy **1 lần**
  `npx tsx apps/api/scripts/backfill-analytics-2026-09.ts` (KHÔNG dùng `ts-node` — không chạy
  được trong repo này, xem comment đầu file script) để backfill `source`/`platform`/`paidAt`/
  `endCustomerKey` lịch sử + in baseline NS-1 ra log (lưu lại log này làm baseline tuần đầu).
  Đây là backfill dữ liệu, không phải migration — không chạy tự động trong `migrate deploy`.
- Cron `AnalyticsAggregationService.runNightly()` đã chốt cứng
  `@Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })` — chạy đúng 3h sáng giờ VN BẤT KỂ giờ hệ
  điều hành host, không cần chỉnh gì thêm khi deploy.
- Dashboard: `/admin?tab=analytics` — cần ≥1 lần cron chạy mới có dữ liệu, trang không crash khi
  rỗng (đã có Playwright test cho cả 2 trạng thái, Task 21).
- **Giới hạn đã biết (không chặn deploy, cần biết trước khi đọc số liệu):**
  - `checkout_started.entry` chưa phân biệt được "Mua ngay" với "checkout một phần giỏ" (cả 2 đều
    gắn nhãn `buy_now`) — đã thêm `isSubset` làm tín hiệu phụ, xem ghi chú PARKED trong lịch sử
    review Task 19 nếu muốn làm đúng hẳn (cần sửa thêm `cart.tsx` + `utils/checkout-selection.ts`).
  - `CohortRepeatSnapshot`/`FunnelDailySnapshot` (repeat 30/60/90 theo cohort + phễu từng bước)
    mới có schema, CHƯA có cron tính — chỉ `RetentionDailySnapshot` (NS-1/NS-2/DAU) đang chạy.
  - Phát hiện ngoài phạm vi dự án con này: `apps/e2e/tests/admin.spec.ts` có 1 test lỗi từ TRƯỚC
    (không liên quan tới thay đổi của dự án con 2) — không phải regression mới, nhưng nên xử lý
    riêng.
```

- [ ] **Step 2: Commit**

```bash
git add docs/2026-09-27-wip-completion-deploy-notes.md
git commit -m "docs: ghi chú deploy cho dự án con 2 (analytics nền)"
```

---

## Self-Review (đã chạy trước khi bàn giao)

**Spec coverage:** 5 cột Order (Task 1) · analytics_events + 2 bảng snapshot (Task 1, funnel/cohort
snapshot job ghi chú TODO rõ ở Task 14 nếu không kịp làm đủ trong 1 lượt) · kiến trúc ghi-trong-tx
(Task 4-11) · 10 sự kiện BE (Task 4,5,6,7,8,9,10,11) · 8 sự kiện FE (Task 18,19) · POST /events +
throttle theo device (Task 12) · backfill (Task 13) · cron dashboard (Task 14,20) · test atomicity
Postgres thật (Task 15) · Playwright (Task 21) · ghi chú deploy (Task 22). Ngoài phạm vi (Sentry,
Cloudinary, Cloudflare) — không có task, đúng như spec đã loại trừ.

**Gap tự nhận:** `CohortRepeatSnapshot`/`FunnelDailySnapshot` (repeat 30/60/90 + phễu từng bước)
chưa có task implementation riêng — chỉ có schema (Task 1) và ghi chú TODO (Task 14). Đây là phần
phức tạp nhất về SQL (cohort ma trận + join `analytics_events`) và cố tình để lại quyết định "làm
tiếp trong plan này hay tách phase 2" cho lúc thực thi, vì `RetentionDailySnapshot` (NS-1/NS-2/DAU)
đã đủ để có dashboard MVP hoạt động và baseline north-star — đúng ưu tiên cao nhất của spec
("Nền đo lường v0, làm trước mọi redesign"). Nếu subagent thực thi thấy còn dư sức, mở rộng Task 14
theo đúng công thức đã có ở spec + backfill script (Task 13) trước khi coi dự án con 2 là "xong".

**Type consistency:** `AnalyticsEventInput.platform` dùng union `'miniapp'|'web'|'admin'|'pos'|
'system'` nhất quán xuyên suốt Task 2 → Task 4-14. `classifyOrderError` trả `string` (không phải
union hẹp) vì message lỗi tương lai chưa liệt kê hết — nhất quán với việc `order_place_failed.
errorCode` trong props cũng là `string` tự do, không ép enum ở tầng Prisma/TS.
