# Flash Sale Engine (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Xây engine flash sale theo khung giờ (giá ưu đãi có hiệu lực start/end + quota + giới hạn mua/user) ở backend, tích hợp vào giá giỏ/checkout server-authoritative + API admin CRUD.

**Architecture:** Module mới `apps/api/src/modules/flash-sale`. 3 model (`FlashSale`/`FlashSaleItem`/`FlashSalePurchase`). `FlashSaleService` resolve giá đọc + consume/restore quota ghi (atomic `updateMany` guard). Hook vào `cart.getCart` (giá + coupon base loại flash) và `checkout` (server-authoritative, consume quota trong tx đặt đơn, `PRICE_CHANGED` khi flash hết giữa chừng). Restore quota khi huỷ/hoàn. API admin CRUD dưới `@Roles('ADMIN')`.

**Tech Stack:** NestJS 10 + Prisma 5 + PostgreSQL, Jest (mock Prisma như các spec hiện có).

**Scope:** CHỈ backend. FE (miniapp `flash-sale.tsx`, product-detail, web-admin tab) = plan riêng tiếp theo. Spec nguồn: `docs/superpowers/specs/2026-07-05-flash-sale-engine-design.md`.

## Global Constraints

- **Atomic quyết định (không TOCTOU):** mọi thay đổi `stock`, `FlashSaleItem.soldCount`, `FlashSalePurchase.quantity` bằng `updateMany` guard trong `$transaction` của `placeOrder`. Kẻ thua race thấy `count===0` → throw rollback (giống pattern trừ stock hiện có ở `checkout.service.ts:120-128`).
- **Server-authoritative giá:** giá flash tính lại ở checkout, không tin client. `resolveEffective` chỉ trả flash khi `isActive && startAt<=now<endAt && soldCount<quota`.
- **Coupon KHÔNG áp lên flash item; combo KHÔNG gộp flash item.** Điểm + freeship vẫn áp trên toàn đơn (gồm flash). Điểm tích + hoa hồng trên giá thực trả (flash).
- **Huỷ/hoàn → restore** `soldCount` + `FlashSalePurchase.quantity` (mirror restock ở `orders.service.ts:107-112` + `admin.service` reviewReturn).
- **Fallback:** variation KHÔNG có flash active → giá cũ `salePrice ?? retailPrice` (không đổi hành vi).
- Auth admin: `@Roles('ADMIN')` (như `admin.controller.ts`). Config đọc `SystemConfigService.get(key, fallback)`.
- Lệnh: BE test `pnpm --filter @tubutree/api test -- <path>`; migrate `pnpm --filter @tubutree/api exec prisma migrate dev --name <x>`; typecheck `pnpm --filter @tubutree/api typecheck`.
- Thời gian: `startAt/endAt` là `DateTime` (Postgres lưu UTC). So sánh dùng `new Date()` phía server.

---

### Task 1: Schema — 3 model + OrderItem.flashSaleItemId + migration + seed config

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (3 model mới + back-relation `Variation` + field `OrderItem.flashSaleItemId`)
- Modify: `apps/api/prisma/seed.ts` (2 config `flashsale.*`)
- Create: migration `..._flash_sale_engine`

**Interfaces produces:** `FlashSale`, `FlashSaleItem`, `FlashSalePurchase` (shape ở Step 1).

- [ ] **Step 1: Thêm 3 model + relations vào `schema.prisma`**

```prisma
model FlashSale {
  id        String          @id @default(cuid())
  title     String
  startAt   DateTime
  endAt     DateTime
  isActive  Boolean         @default(true)
  createdBy String
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  items     FlashSaleItem[]

  @@index([isActive, startAt, endAt])
  @@map("flash_sales")
}

model FlashSaleItem {
  id           String              @id @default(cuid())
  flashSaleId  String
  flashSale    FlashSale           @relation(fields: [flashSaleId], references: [id], onDelete: Cascade)
  variationId  String
  variation    Variation           @relation(fields: [variationId], references: [id])
  flashPrice   Int
  quota        Int
  soldCount    Int                 @default(0)
  perUserLimit Int
  purchases    FlashSalePurchase[]

  @@unique([flashSaleId, variationId])
  @@index([variationId])
  @@map("flash_sale_items")
}

model FlashSalePurchase {
  id              String        @id @default(cuid())
  flashSaleItemId String
  item            FlashSaleItem @relation(fields: [flashSaleItemId], references: [id], onDelete: Cascade)
  userId          String
  quantity        Int           @default(0)
  updatedAt       DateTime      @updatedAt

  @@unique([flashSaleItemId, userId])
  @@map("flash_sale_purchases")
}
```

Trong model `Variation` thêm back-relation (cạnh `cartItems`):
```prisma
  flashSaleItems FlashSaleItem[]
```

Trong model `OrderItem` thêm field (nullable — line thường = null):
```prisma
  flashSaleItemId String?
```

- [ ] **Step 2: Thêm 2 config vào `seed.ts` `SYSTEM_CONFIGS`** (cạnh block wallet/coins)

```ts
  { key: 'flashsale.default_per_user_limit', value: 5, category: 'flashsale', description: 'Giới hạn mua mặc định/user/item flash' },
  { key: 'flashsale.min_discount_pct', value: 0, category: 'flashsale', description: 'Mức giảm tối thiểu để tạo item flash (0 = tắt validate)' },
```

- [ ] **Step 3: Tạo + áp migration**

Run: `pnpm --filter @tubutree/api exec prisma migrate dev --name flash_sale_engine`
Expected: tạo 3 bảng + cột `order_items.flashSaleItemId`, apply sạch, Client generated. (Model mới + cột nullable → không đụng dữ liệu cũ.)

- [ ] **Step 4: Verify generate + typecheck**

Run: `pnpm --filter @tubutree/api exec prisma generate && pnpm --filter @tubutree/api typecheck`
Expected: sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/seed.ts apps/api/prisma/migrations
git commit -m "feat(flash-sale): schema FlashSale/Item/Purchase + OrderItem.flashSaleItemId + config"
```

---

### Task 2: FlashSaleService.resolveEffective + listActive (read-side)

**Files:**
- Create: `apps/api/src/modules/flash-sale/flash-sale.service.ts`
- Create: `apps/api/src/modules/flash-sale/flash-sale.module.ts`
- Test: `apps/api/src/modules/flash-sale/flash-sale.service.spec.ts`

**Interfaces produces:**
- `resolveEffective(variationIds: string[], now?: Date): Promise<Map<string, { flashPrice: number; itemId: string; endAt: Date; soldCount: number; quota: number }>>` — chỉ chứa variation ĐANG có flash active còn quota.
- `listActive(now?: Date)` — mảng item active kèm variation+product cho FE.

- [ ] **Step 1: Viết test (fail)** — `flash-sale.service.spec.ts`

```ts
import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const NOW = new Date('2026-07-05T10:00:00Z');
const activeItem = (over: Record<string, unknown> = {}) => ({
  id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
  flashSale: { startAt: new Date('2026-07-05T09:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z'), isActive: true },
  ...over,
});

describe('FlashSaleService.resolveEffective', () => {
  it('variation có flash ACTIVE còn quota → trả flashPrice + metadata', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem()]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(map.get('v1')).toMatchObject({ flashPrice: 80000, itemId: 'fi1', soldCount: 3, quota: 10 });
  });

  it('variation không có item active → không có trong map (caller tự fallback)', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v9'], NOW);
    expect(map.has('v9')).toBe(false);
  });

  it('variationIds rỗng → map rỗng, KHÔNG query', async () => {
    const findMany = jest.fn();
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective([], NOW);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`Cannot find module './flash-sale.service'`)

Run: `pnpm --filter @tubutree/api test -- flash-sale.service`
Expected: FAIL.

- [ ] **Step 3: Viết `flash-sale.service.ts`** (phần read-side)

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface EffectivePrice {
  flashPrice: number;
  itemId: string;
  endAt: Date;
  soldCount: number;
  quota: number;
}

@Injectable()
export class FlashSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** Query FlashSaleItem của các variation thuộc FlashSale đang ACTIVE + còn quota. */
  private activeWhere(variationIds: string[], now: Date): Prisma.FlashSaleItemWhereInput {
    return {
      variationId: { in: variationIds },
      soldCount: { lt: this.prisma.flashSaleItem.fields.quota }, // xem note: dùng filter thủ công dưới
      flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
    };
  }

  async resolveEffective(variationIds: string[], now: Date = new Date()): Promise<Map<string, EffectivePrice>> {
    const map = new Map<string, EffectivePrice>();
    if (variationIds.length === 0) return map;
    // Prisma không so sánh 2 cột trực tiếp trong where → lọc soldCount<quota bằng JS sau khi lấy item active.
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variationId: { in: variationIds },
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      include: { flashSale: { select: { endAt: true } } },
    });
    for (const it of items) {
      if (it.soldCount >= it.quota) continue; // hết suất → coi như không có flash
      // 1 variation chỉ 1 flash active (validate lúc tạo) → gán trực tiếp.
      map.set(it.variationId, {
        flashPrice: it.flashPrice,
        itemId: it.id,
        endAt: it.flashSale.endAt,
        soldCount: it.soldCount,
        quota: it.quota,
      });
    }
    return map;
  }

  async listActive(now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: { flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
      include: {
        flashSale: { select: { endAt: true } },
        variation: { include: { product: { select: { slug: true, name: true, thumbnail: true } } } },
      },
    });
    return items
      .filter((it) => it.soldCount < it.quota)
      .map((it) => ({
        itemId: it.id,
        variationId: it.variationId,
        productSlug: it.variation.product.slug,
        productName: it.variation.product.name,
        thumbnail: it.variation.product.thumbnail,
        flashPrice: it.flashPrice,
        retailPrice: it.variation.retailPrice,
        soldCount: it.soldCount,
        quota: it.quota,
        endAt: it.flashSale.endAt,
      }));
  }
}
```
> Xoá helper `activeWhere` (không dùng — Prisma không so 2 cột). Chỉ giữ `resolveEffective`/`listActive` như trên.

- [ ] **Step 4: Viết `flash-sale.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';

@Module({
  providers: [FlashSaleService],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
```

- [ ] **Step 5: Run test → PASS**

Run: `pnpm --filter @tubutree/api test -- flash-sale.service`
Expected: PASS (3 test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/flash-sale
git commit -m "feat(flash-sale): FlashSaleService resolveEffective + listActive (read-side)"
```

---

### Task 3: FlashSaleService.consumeQuota + restore (write-side, atomic, money-critical)

**Files:**
- Modify: `apps/api/src/modules/flash-sale/flash-sale.service.ts`
- Test: `apps/api/src/modules/flash-sale/flash-sale.service.spec.ts`

**Interfaces produces:**
- `consumeQuota(tx, itemId, userId, qty, now): Promise<void>` — trừ `soldCount` (guard `soldCount+qty<=quota` + flash còn active) và tăng `FlashSalePurchase.quantity` (guard `<=perUserLimit`); fail → throw `BadRequestException`.
- `restore(tx, itemId, userId, qty): Promise<void>` — hoàn `soldCount` + `FlashSalePurchase.quantity` (guard `gte`).

- [ ] **Step 1: Thêm test (fail)** vào spec

```ts
describe('FlashSaleService.consumeQuota', () => {
  const now = new Date('2026-07-05T10:00:00Z');
  const mkTx = (soldHit: number, itemRow: any, purchaseHit: number, existing: any) => ({
    flashSaleItem: {
      updateMany: jest.fn().mockResolvedValue({ count: soldHit }),
      findUnique: jest.fn().mockResolvedValue(itemRow),
    },
    flashSalePurchase: {
      findUnique: jest.fn().mockResolvedValue(existing),
      updateMany: jest.fn().mockResolvedValue({ count: purchaseHit }),
      create: jest.fn().mockResolvedValue({}),
    },
  });

  it('còn quota + trong giới hạn → trừ soldCount + tăng purchase', async () => {
    const tx = mkTx(1, { perUserLimit: 5 }, 1, { quantity: 1 });
    await new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now);
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'fi1' }) }),
    );
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalled();
  });

  it('hết quota (soldCount+qty>quota) → count=0 → throw "Hết suất ưu đãi."', async () => {
    const tx = mkTx(0, { perUserLimit: 5 }, 1, { quantity: 0 });
    await expect(
      new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now),
    ).rejects.toThrow('Hết suất ưu đãi.');
  });

  it('vượt perUserLimit → throw "Vượt giới hạn mua ưu đãi."', async () => {
    // đã mua 4, limit 5, mua thêm 2 → updateMany guard quantity+2<=5 fail (count=0)
    const tx = mkTx(1, { perUserLimit: 5 }, 0, { quantity: 4 });
    await expect(
      new FlashSaleService({} as any, config).consumeQuota(tx as any, 'fi1', 'u1', 2, now),
    ).rejects.toThrow('Vượt giới hạn mua ưu đãi.');
  });
});

describe('FlashSaleService.restore', () => {
  it('hoàn soldCount + purchase.quantity (guard gte)', async () => {
    const tx = {
      flashSaleItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      flashSalePurchase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await new FlashSaleService({} as any, config).restore(tx as any, 'fi1', 'u1', 2);
    expect(tx.flashSaleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { soldCount: { decrement: 2 } } }),
    );
    expect(tx.flashSalePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { decrement: 2 } } }),
    );
  });
});
```

- [ ] **Step 2: Run → FAIL** (`consumeQuota is not a function`)

Run: `pnpm --filter @tubutree/api test -- flash-sale.service`
Expected: FAIL.

- [ ] **Step 3: Thêm `consumeQuota` + `restore`** vào `FlashSaleService`

```ts
import { BadRequestException } from '@nestjs/common';
// ... trong class:

  /**
   * Trừ 1 suất flash ATOMIC trong tx đặt đơn. Guard kép:
   *  (a) soldCount+qty<=quota + flash còn active → chống oversell/hết-giờ (count=0 → hết suất).
   *  (b) FlashSalePurchase.quantity+qty<=perUserLimit → chống vượt giới hạn mua.
   * Fail bất kỳ guard nào → throw (rollback toàn bộ đơn ở caller).
   */
  async consumeQuota(
    tx: Prisma.TransactionClient,
    itemId: string,
    userId: string,
    qty: number,
    now: Date = new Date(),
  ): Promise<void> {
    // (a) trừ soldCount có điều kiện quota + còn active (join qua relation trong updateMany where).
    const sold = await tx.flashSaleItem.updateMany({
      where: {
        id: itemId,
        quota: { gte: qty }, // sơ loại
        soldCount: { lte: this.remainingGuard(qty) as never }, // xem note dưới — thay bằng raw guard
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      data: { soldCount: { increment: qty } },
    });
    if (sold.count === 0) throw new BadRequestException('Hết suất ưu đãi.');

    // (b) perUserLimit: đọc limit từ item, rồi upsert-guard purchase.
    const item = await tx.flashSaleItem.findUnique({ where: { id: itemId }, select: { perUserLimit: true } });
    const limit = item?.perUserLimit ?? 0;
    const existing = await tx.flashSalePurchase.findUnique({
      where: { flashSaleItemId_userId: { flashSaleItemId: itemId, userId } },
    });
    if (existing) {
      const bumped = await tx.flashSalePurchase.updateMany({
        where: { flashSaleItemId: itemId, userId, quantity: { lte: limit - qty } },
        data: { quantity: { increment: qty } },
      });
      if (bumped.count === 0) {
        // rollback soldCount đã trừ ở (a) để không "khoá" suất khi vượt giới hạn
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException('Vượt giới hạn mua ưu đãi.');
      }
    } else {
      if (qty > limit) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException('Vượt giới hạn mua ưu đãi.');
      }
      await tx.flashSalePurchase.create({ data: { flashSaleItemId: itemId, userId, quantity: qty } });
    }
  }

  async restore(tx: Prisma.TransactionClient, itemId: string, userId: string, qty: number): Promise<void> {
    await tx.flashSaleItem.updateMany({
      where: { id: itemId, soldCount: { gte: qty } },
      data: { soldCount: { decrement: qty } },
    });
    await tx.flashSalePurchase.updateMany({
      where: { flashSaleItemId: itemId, userId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
  }
```

> **NOTE quan trọng về guard soldCount+qty<=quota:** Prisma `updateMany.where` KHÔNG so 2 cột (`soldCount` vs `quota`). Thay dòng `soldCount: { lte: ... }` giả ở trên bằng cách dùng **raw SQL** cho bước (a):
> ```ts
> const sold = await tx.$executeRaw`UPDATE flash_sale_items SET "soldCount" = "soldCount" + ${qty}
>   WHERE id = ${itemId} AND "soldCount" + ${qty} <= quota
>   AND EXISTS (SELECT 1 FROM flash_sales fs WHERE fs.id = "flashSaleId"
>     AND fs."isActive" = true AND fs."startAt" <= ${now} AND fs."endAt" > ${now})`;
> if (sold === 0) throw new BadRequestException('Hết suất ưu đãi.');
> ```
> `$executeRaw` trả số row affected (0/1) → dùng làm guard atomic thay `updateMany`. Sửa test Step 1 cho nhánh (a) mock `tx.$executeRaw` trả 1 (còn suất) / 0 (hết) thay cho `flashSaleItem.updateMany`.

- [ ] **Step 4: Cập nhật test cho `$executeRaw`** (nhánh a)

Thay `flashSaleItem.updateMany` trong `mkTx` bằng `$executeRaw: jest.fn().mockResolvedValue(soldHit)`; assert `tx.$executeRaw` được gọi. Giữ nguyên nhánh (b) purchase.

- [ ] **Step 5: Run → PASS**

Run: `pnpm --filter @tubutree/api test -- flash-sale.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/flash-sale/flash-sale.service.ts apps/api/src/modules/flash-sale/flash-sale.service.spec.ts
git commit -m "feat(flash-sale): consumeQuota (atomic quota+perUserLimit) + restore"
```

---

### Task 4: Hook cart.getCart — giá flash + coupon base loại flash

**Files:**
- Modify: `apps/api/src/modules/cart/cart.service.ts`
- Modify: `apps/api/src/modules/cart/cart.module.ts` (import `FlashSaleModule`)
- Test: `apps/api/src/modules/cart/cart.service.spec.ts` (tạo nếu chưa có; nếu có, thêm case)

**Interfaces:** `getCart` trả line thêm `isFlash: boolean`, `flashSaleItemId: string | null`, `flashEndAt: Date | null`, `soldPct: number | null`; coupon validate trên `couponBase` (subtotal các line KHÔNG flash).

- [ ] **Step 1: Test (fail)** — line flash lấy flashPrice + coupon base loại flash

```ts
// cart.service.spec.ts — mock prisma.cart.findUniqueOrThrow trả 2 item (v1 flash, v2 thường),
// FlashSaleService.resolveEffective trả Map{v1→{flashPrice:80000,...}}.
// Kỳ vọng: line v1.unitPrice=80000 & isFlash=true; couponBase truyền vào coupons.validateAndCompute
// = tổng v2 (không gồm v1).
it('line flash dùng flashPrice + coupon base loại flash item', async () => {
  const validateAndCompute = jest.fn().mockResolvedValue({ discount: 0, freeship: false });
  const prisma = {
    cart: {
      upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'c1', couponCode: 'SALE',
        items: [
          { id: 'ci1', variationId: 'v1', quantity: 1, variation: { productId: 'p1', salePrice: null, retailPrice: 100000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null } } },
          { id: 'ci2', variationId: 'v2', quantity: 2, variation: { productId: 'p2', salePrice: null, retailPrice: 50000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null } } },
        ],
      }),
    },
  } as any;
  const flash = { resolveEffective: jest.fn().mockResolvedValue(new Map([['v1', { flashPrice: 80000, itemId: 'fi1', endAt: new Date(), soldCount: 3, quota: 10 }]])) } as any;
  const coupons = { validateAndCompute } as any;
  const config = { get: async <T>(_k: string, fb?: T) => fb as T } as any;
  const cart = await new CartService(prisma, coupons, config, flash).getCart('u1');
  const l1 = cart.items.find((l: any) => l.variationId === 'v1');
  expect(l1.unitPrice).toBe(80000);
  expect(l1.isFlash).toBe(true);
  expect(validateAndCompute).toHaveBeenCalledWith('SALE', 'u1', 100000); // = v2 total (2×50000), KHÔNG gồm v1
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @tubutree/api test -- cart.service`
Expected: FAIL (constructor arity / isFlash undefined).

- [ ] **Step 3: Sửa `cart.service.ts`**

Inject `FlashSaleService`:
```ts
import { FlashSaleService } from '../flash-sale/flash-sale.service';
// constructor thêm: private readonly flashSale: FlashSaleService,
```
Trong `getCart`, thay block `lines`/`subtotal`/coupon:
```ts
    const now = new Date();
    const flashMap = await this.flashSale.resolveEffective(
      cart.items.map((it) => it.variationId),
      now,
    );
    const lines = cart.items.map((it) => {
      const flash = flashMap.get(it.variationId);
      const unitPrice = flash ? flash.flashPrice : (it.variation.salePrice ?? it.variation.retailPrice);
      return {
        id: it.id,
        variationId: it.variationId,
        productId: it.variation.productId,
        productName: it.variation.product.name,
        variationName: it.variation.name,
        slug: it.variation.product.slug,
        thumbnail: it.variation.product.thumbnail,
        unitPrice,
        quantity: it.quantity,
        stock: it.variation.stock,
        total: unitPrice * it.quantity,
        isFlash: !!flash,
        flashSaleItemId: flash?.itemId ?? null,
        flashEndAt: flash?.endAt ?? null,
        soldPct: flash ? Math.round((flash.soldCount / flash.quota) * 100) : null,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    // Coupon base LOẠI flash item (spec §quyết-định-2) → giảm hiển thị ở giỏ khớp checkout.
    const couponBase = lines.filter((l) => !l.isFlash).reduce((s, l) => s + l.total, 0);

    let discount = 0;
    let freeship = false;
    let couponCode = cart.couponCode;
    if (couponCode) {
      try {
        const r = await this.coupons.validateAndCompute(couponCode, userId, couponBase);
        discount = r.discount;
        freeship = r.freeship;
      } catch {
        await this.prisma.cart.update({ where: { id: cartId }, data: { couponCode: null } });
        couponCode = null;
      }
    }
```
(Giữ nguyên phần `freeshipThreshold` + return, return giữ `subtotal` như cũ.)

- [ ] **Step 4: Import `FlashSaleModule` vào `cart.module.ts`** (thêm vào `imports: [...]`).

- [ ] **Step 5: Run → PASS** + typecheck

Run: `pnpm --filter @tubutree/api test -- cart.service && pnpm --filter @tubutree/api typecheck`
Expected: PASS + sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/cart
git commit -m "feat(flash-sale): cart hiển thị giá flash + coupon base loại flash item"
```

---

### Task 5: Hook checkout — server-authoritative + consumeQuota trong tx + PRICE_CHANGED

**Files:**
- Modify: `apps/api/src/modules/checkout/checkout.service.ts`
- Modify: `apps/api/src/modules/checkout/checkout.module.ts` (import `FlashSaleModule`)
- Test: `apps/api/src/modules/checkout/checkout.service.spec.ts` (thêm case)

**Interfaces:** `compute()` loại flash line khỏi combo input + coupon base; điểm/ship/total giữ trên toàn đơn. `placeOrder` tx: consumeQuota mỗi flash line; fail → rollback; OrderItem lưu `flashSaleItemId`.

- [ ] **Step 1: Test (fail)** — 2 case:
  1. Combo + coupon base loại flash (compute): giỏ 1 flash line + 1 thường → `combo.computeForStorefront` nhận CHỈ line thường; `coupons.validateAndCompute` base = tổng line thường.
  2. `placeOrder`: line flash → gọi `flashSale.consumeQuota(tx, itemId, userId, qty, now)`; OrderItem create có `flashSaleItemId`.

```ts
// (bổ sung vào checkout.service.spec.ts — theo pattern mock hiện có của file này)
it('compute: flash line loại khỏi combo input + coupon base', async () => {
  // cart.getCart trả 2 line: v1 isFlash true total 80000; v2 thường total 100000
  // → combo.computeForStorefront nhận chỉ [{variationId:v2,...}]; validateAndCompute base=100000
  // (assert qua mock.calls) 
});
it('placeOrder: line flash consumeQuota + OrderItem.flashSaleItemId', async () => {
  // flash.consumeQuota mock resolved; assert được gọi với (tx,'fi1','u1',qty,now)
  // assert order.create data.items.create[0].flashSaleItemId==='fi1'
});
```
> (Viết đầy đủ mock theo khung `checkout.service.spec.ts` sẵn có — copy 1 test hiện hữu làm mẫu, thêm field `isFlash/flashSaleItemId` vào cart line mock và stub `flashSale`.)

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @tubutree/api test -- checkout.service`
Expected: FAIL.

- [ ] **Step 3: Sửa `compute()`** — loại flash khỏi combo + coupon base

Inject `FlashSaleService` (constructor). Trong `compute()`, sau khi có `cart.items` (đã kèm `isFlash`/`flashSaleItemId` từ getCart):
```ts
    const nonFlash = cart.items.filter((l) => !(l as any).isFlash);
    const flashSubtotal = cart.items.filter((l) => (l as any).isFlash).reduce((s, l) => s + l.total, 0);
    // Combo CHỈ trên line không-flash
    const combo = await this.combo.computeForStorefront(
      storefrontSlug,
      nonFlash.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total })),
    );
    const nonFlashSubtotal = nonFlash.reduce((s, l) => s + l.total, 0);
    const goodsAfterCombo = Math.max(0, nonFlashSubtotal - combo.total); // coupon base (loại flash)
```
Coupon block giữ nguyên nhưng chạy trên `goodsAfterCombo` mới. Sau coupon:
```ts
    const goodsAfterCoupon = Math.max(0, goodsAfterCombo - discount);
    // Điểm áp trên TOÀN đơn (gồm flash) → base điểm = goodsAfterCoupon(non-flash) + flashSubtotal
    const redeemBase = goodsAfterCoupon + flashSubtotal;
    const redemption = await this.pricing.resolvePointsRedemption(pointsToUse ?? 0, user.pointsBalance, redeemBase);
    const goodsAfterAll = Math.max(0, redeemBase - redemption.discount);
```
Ship giữ `cart.subtotal` (gồm flash). `pointsEarned = calcPointsEarned(goodsAfterAll, multiplier)`. `total = goodsAfterAll + shippingFee`.

- [ ] **Step 4: Sửa `placeOrder` tx** — consumeQuota + OrderItem.flashSaleItemId

Trong vòng lặp trừ stock (sau khi trừ stock mỗi line), với line flash:
```ts
        const now = new Date();
        for (const line of cart.items) {
          const stockHit = await tx.variation.updateMany({
            where: { id: line.variationId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (stockHit.count === 0) throw new BadRequestException(`Sản phẩm "${line.productName}" không đủ tồn kho.`);
          const fid = (line as any).flashSaleItemId as string | null;
          if (fid) {
            try {
              await this.flashSale.consumeQuota(tx, fid, userId, line.quantity, now);
            } catch (e) {
              // Flash hết giờ/hết suất giữa chừng → KHÔNG tính giá flash âm thầm.
              throw new BadRequestException('PRICE_CHANGED');
            }
          }
        }
```
OrderItem create thêm `flashSaleItemId`:
```ts
              create: cart.items.map((l) => ({
                variationId: l.variationId,
                productName: l.productName,
                variationName: l.variationName,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                total: l.total - (computed.comboPerLine[l.variationId] ?? 0),
                flashSaleItemId: (l as any).flashSaleItemId ?? null,
              })),
```
> `consumeQuota` ném `BadRequestException('Hết suất…'/'Vượt giới hạn…')`; ta bọc lại thành `'PRICE_CHANGED'` để FE nhận diện (hoặc giữ nguyên message nếu muốn hiển thị lý do — chọn `PRICE_CHANGED` cho nhất quán spec). Controller trả 400 với message này.

- [ ] **Step 5: Import `FlashSaleModule` vào `checkout.module.ts`.**

- [ ] **Step 6: Run → PASS** (checkout + cart + flash-sale) + typecheck

Run: `pnpm --filter @tubutree/api test -- checkout.service cart.service flash-sale.service && pnpm --filter @tubutree/api typecheck`
Expected: PASS + sạch.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/checkout
git commit -m "feat(flash-sale): checkout server-authoritative + consumeQuota + PRICE_CHANGED"
```

---

### Task 6: Restore quota khi huỷ/hoàn đơn

**Files:**
- Modify: `apps/api/src/modules/orders/orders.service.ts` (cancel — sau restock loop `:107-112`)
- Modify: `apps/api/src/modules/admin/admin.service.ts` (reviewReturn khi APPROVE RETURNED — cạnh restock)
- Modify: `orders.module.ts` + `admin.module.ts` (import `FlashSaleModule`)
- Test: `orders.service.spec.ts` + `admin.service.spec.ts` (thêm case)

**Interfaces:** khi huỷ/hoàn, mỗi `OrderItem.flashSaleItemId != null` → `flashSale.restore(tx, flashSaleItemId, userId, quantity)` trong CÙNG tx (nhánh thắng race).

- [ ] **Step 1: Test (fail)** — cancel đơn có flash item → gọi `restore`

```ts
// orders.service.spec.ts: order.items có 1 item flashSaleItemId='fi1' qty 2
// → sau restock, flash.restore(tx,'fi1', userId, 2) được gọi.
it('huỷ đơn có flash item → restore quota', async () => {
  // ... mock won-race tx; assert flash.restore called với ('fi1', 'u1', 2)
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @tubutree/api test -- orders.service`
Expected: FAIL.

- [ ] **Step 3: Sửa `orders.service.ts`** — inject `FlashSaleService`; trong restock loop:

```ts
      for (const item of order.items) {
        await tx.variation.update({
          where: { id: item.variationId },
          data: { stock: { increment: item.quantity } },
        });
        if (item.flashSaleItemId) {
          await this.flashSale.restore(tx, item.flashSaleItemId, userId, item.quantity);
        }
      }
```

- [ ] **Step 4: Sửa `admin.service.ts` reviewReturn** — tương tự trong nhánh restock khi APPROVE trả hàng (thêm `if (item.flashSaleItemId) await this.flashSale.restore(tx, item.flashSaleItemId, order.userId, item.quantity);`). Inject `FlashSaleService`.

- [ ] **Step 5: Import `FlashSaleModule`** vào `orders.module.ts` + `admin.module.ts`.

- [ ] **Step 6: Run → PASS** (orders + admin) + typecheck

Run: `pnpm --filter @tubutree/api test -- orders.service admin.service && pnpm --filter @tubutree/api typecheck`
Expected: PASS + sạch.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/orders apps/api/src/modules/admin
git commit -m "feat(flash-sale): restore quota khi huỷ/hoàn đơn"
```

---

### Task 7: API — public listActive + admin CRUD + validate

**Files:**
- Create: `apps/api/src/modules/flash-sale/flash-sale.controller.ts` (public `GET /flash-sales/active`)
- Create: `apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts` (admin CRUD, `@Roles('ADMIN')`)
- Modify: `flash-sale.service.ts` (thêm admin methods: `createSale`, `updateSale`, `listSales`, `addItem`, `removeItem`)
- Modify: `flash-sale.module.ts` (khai báo 2 controller)
- Test: `flash-sale.service.spec.ts` (validate addItem)

**Interfaces produces (admin service methods):**
- `createSale(adminId, {title,startAt,endAt})` · `updateSale(id, {title?,startAt?,endAt?,isActive?})` · `listSales()` (kèm soldCount tổng) · `addItem(saleId, {variationId,flashPrice,quota,perUserLimit?})` · `removeItem(itemId)`.

- [ ] **Step 1: Test (fail)** — validate `addItem`

```ts
describe('FlashSaleService.addItem (validate)', () => {
  const base = () => ({
    variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', retailPrice: 100000, stock: 10 }) },
    flashSaleItem: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'fi1' }) },
  });
  it('flashPrice >= retailPrice → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 120000, quota: 5 }))
      .rejects.toThrow('Giá flash phải thấp hơn giá bán lẻ.');
  });
  it('quota > stock → reject', async () => {
    const prisma = base() as any;
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 999 }))
      .rejects.toThrow('Quota vượt tồn kho.');
  });
  it('variation đã có flash active khác → reject', async () => {
    const prisma = base() as any;
    prisma.flashSaleItem.findFirst.mockResolvedValue({ id: 'other' });
    await expect(new FlashSaleService(prisma, config).addItem('s1', { variationId: 'v1', flashPrice: 80000, quota: 5 }))
      .rejects.toThrow('Sản phẩm đã có trong đợt flash khác.');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @tubutree/api test -- flash-sale.service`
Expected: FAIL.

- [ ] **Step 3: Thêm admin methods vào `FlashSaleService`**

```ts
  async createSale(adminId: string, dto: { title: string; startAt: string; endAt: string }) {
    const startAt = new Date(dto.startAt), endAt = new Date(dto.endAt);
    if (!(startAt < endAt)) throw new BadRequestException('startAt phải trước endAt.');
    return this.prisma.flashSale.create({ data: { title: dto.title, startAt, endAt, createdBy: adminId } });
  }

  async updateSale(id: string, dto: { title?: string; startAt?: string; endAt?: string; isActive?: boolean }) {
    return this.prisma.flashSale.update({
      where: { id },
      data: {
        title: dto.title,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async listSales() {
    return this.prisma.flashSale.findMany({
      orderBy: { startAt: 'desc' },
      include: { items: { select: { id: true, variationId: true, flashPrice: true, quota: true, soldCount: true, perUserLimit: true } } },
    });
  }

  async addItem(saleId: string, dto: { variationId: string; flashPrice: number; quota: number; perUserLimit?: number }) {
    const variation = await this.prisma.variation.findUnique({ where: { id: dto.variationId } });
    if (!variation) throw new BadRequestException('Variation không tồn tại.');
    if (dto.flashPrice >= variation.retailPrice) throw new BadRequestException('Giá flash phải thấp hơn giá bán lẻ.');
    const minPct = await this.config.get<number>('flashsale.min_discount_pct', 0);
    if (minPct > 0 && dto.flashPrice > variation.retailPrice * (1 - minPct)) {
      throw new BadRequestException(`Mức giảm phải ≥ ${Math.round(minPct * 100)}%.`);
    }
    if (dto.quota > variation.stock) throw new BadRequestException('Quota vượt tồn kho.');
    // Không cho variation nằm trong 2 đợt flash CHỒNG THỜI GIAN (đơn giản hoá: có bất kỳ item nào
    // của variation thuộc sale endAt tương lai → reject).
    const clash = await this.prisma.flashSaleItem.findFirst({
      where: { variationId: dto.variationId, flashSale: { endAt: { gt: new Date() } } },
    });
    if (clash) throw new BadRequestException('Sản phẩm đã có trong đợt flash khác.');
    const perUserLimit = dto.perUserLimit ?? (await this.config.get<number>('flashsale.default_per_user_limit', 5));
    return this.prisma.flashSaleItem.create({
      data: { flashSaleId: saleId, variationId: dto.variationId, flashPrice: dto.flashPrice, quota: dto.quota, perUserLimit },
    });
  }

  async removeItem(itemId: string) {
    await this.prisma.flashSaleItem.delete({ where: { id: itemId } });
    return { ok: true };
  }
```

- [ ] **Step 4: Viết `flash-sale.controller.ts`** (public)

```ts
import { Controller, Get } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';

@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Get('active')
  active() {
    return this.flashSale.listActive();
  }
}
```

- [ ] **Step 5: Viết `flash-sale-admin.controller.ts`** (theo pattern `admin.controller.ts`)

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsBoolean, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FlashSaleService } from './flash-sale.service';

class CreateSaleDto { @IsString() title!: string; @IsString() startAt!: string; @IsString() endAt!: string; }
class UpdateSaleDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AddItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) flashPrice!: number;
  @IsInt() @Min(1) quota!: number;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
}

@Roles('ADMIN')
@Controller('admin/flash-sales')
export class FlashSaleAdminController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Get() list() { return this.flashSale.listSales(); }
  @Post() create(@CurrentUser('sub') adminId: string, @Body() dto: CreateSaleDto) { return this.flashSale.createSale(adminId, dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateSaleDto) { return this.flashSale.updateSale(id, dto); }
  @Post(':id/items') addItem(@Param('id') id: string, @Body() dto: AddItemDto) { return this.flashSale.addItem(id, dto); }
  @Delete('items/:itemId') removeItem(@Param('itemId') itemId: string) { return this.flashSale.removeItem(itemId); }
}
```

- [ ] **Step 6: Khai báo controller trong `flash-sale.module.ts`** (`controllers: [FlashSaleController, FlashSaleAdminController]`) và đảm bảo `FlashSaleModule` nằm trong `app.module.ts` imports.

- [ ] **Step 7: Run → PASS + typecheck + build**

Run: `pnpm --filter @tubutree/api test -- flash-sale.service && pnpm --filter @tubutree/api typecheck && pnpm --filter @tubutree/api build`
Expected: PASS + sạch.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/flash-sale apps/api/src/app.module.ts
git commit -m "feat(flash-sale): API public listActive + admin CRUD + validate"
```

---

### Task 8: E2E smoke (integration) + full test gate

**Files:**
- Test: chạy toàn bộ test suite BE (không thêm file nếu Task 2-7 đã phủ; tuỳ chọn thêm 1 e2e ở `apps/e2e` nếu team có pattern).

- [ ] **Step 1: Run toàn bộ test BE**

Run: `pnpm --filter @tubutree/api test`
Expected: PASS toàn bộ (không hồi quy checkout/cart/orders/admin).

- [ ] **Step 2: Verify migration + seed sạch trên DB dev**

Run: `pnpm --filter @tubutree/api exec prisma migrate reset --force && pnpm --filter @tubutree/api exec prisma db seed`
Expected: apply migration flash_sale_engine + seed 2 config `flashsale.*` không lỗi.

- [ ] **Step 3: Commit (nếu có chỉnh)**

```bash
git commit -am "test(flash-sale): full BE gate xanh" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- FlashSale/FlashSaleItem/FlashSalePurchase + OrderItem.flashSaleItemId → Task 1 ✅
- resolveEffective/listActive → Task 2 ✅
- consumeQuota (quota + perUserLimit atomic) + restore → Task 3 ✅
- Cart giá flash + coupon base loại flash → Task 4 ✅
- Checkout server-authoritative + combo/coupon loại flash + điểm toàn đơn + consumeQuota tx + PRICE_CHANGED + OrderItem.flashSaleItemId → Task 5 ✅
- Restore khi huỷ/hoàn → Task 6 ✅
- Admin CRUD + validate (flashPrice<retail, quota≤stock, không trùng đợt) + public listActive → Task 7 ✅
- Điểm tích + hoa hồng trên giá flash: tự động (compute dùng `goodsAfterAll` gồm giá flash thực trả; commission đọc `OrderItem.total`) — phủ ở Task 5 ✅
- Config `flashsale.*` → Task 1 ✅
- **Ngoài phạm vi plan này (FE):** `flash-sale.tsx` rewrite, product-detail, web-admin tab, `PRICE_CHANGED` UX sheet → **plan FE riêng tiếp theo**.

**Placeholder scan:** Task 5 Step 1 để mô tả test (không code đầy đủ) vì phải bám khung mock lớn của `checkout.service.spec.ts` sẵn có — engineer copy 1 test hiện hữu làm mẫu. Đây là điểm cần lưu ý (không phải placeholder logic, mà là "theo mẫu file"). Mọi bước code khác đều đủ code.

**Type consistency:** `flashSaleItemId` dùng nhất quán ở OrderItem create (Task 5), restore (Task 6), resolveEffective trả `itemId` (Task 2) → consumeQuota/restore nhận `itemId` (Task 3). `isFlash`/`flashSaleItemId`/`flashEndAt`/`soldPct` thêm ở cart line (Task 4) và đọc ở checkout (Task 5). ✅

**Rủi ro kỹ thuật đã ghi rõ:** guard `soldCount+qty<=quota` phải dùng `$executeRaw` (Prisma không so 2 cột) — nêu trong Task 3 NOTE.
