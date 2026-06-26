# Storefront Lớp 1 — Lõi gian hàng CTV (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CTV dựng được gian hàng cá nhân (chọn SP từ catalog → sắp xếp → đăng) và khách xem qua link công khai — full-stack, có test.

**Architecture:** Một block-renderer dùng chung (Storefront → Collection → Item). Lớp 1 làm nhánh CTV + dựng sẵn `Brand` entity (để Lớp 3 dùng, không phải migrate lại). Backend NestJS + Prisma (TDD jest), FE miniapp ZaUI (verify qua tsc/lint/build). Combo/share-kit/dashboard/brand-page để các lớp sau.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest (ts-jest), React + zmp-ui + Vite, react-query, axios.

**Spec:** `docs/superpowers/specs/2026-06-26-ctv-brand-storefront-design.md` (§5 data model, §6.1–6.2 bố cục, §7.1 publish).

**Quy ước chủ chốt (đã verify từ codebase):**
- Module: `@Module({ controllers, providers })`; `PrismaService` auto-inject (PrismaModule `@Global()`) — chỉ cần `constructor(private readonly prisma: PrismaService)`.
- Auth: `@CurrentUser('sub')` lấy userId; `@Public()` cho route công khai; `@Roles('ADMIN')` cho admin.
- DTO: class-validator inline trong controller (`@IsString`, `@IsInt`, `@IsOptional`, `@IsIn`, `@IsBoolean`, `@Min`, `@Type`); ValidationPipe `whitelist:true, forbidNonWhitelisted:true`.
- Test: file `*.service.spec.ts`, đầu file `import 'reflect-metadata';`, mock Prisma `{ table: { method: jest.fn() } } as unknown as PrismaService`. Chạy: `cd apps/api && npm run test -- --testPathPattern=storefront`.
- Prisma: sửa `schema.prisma` → `npm run prisma:migrate <tên>` (tạo migration) → `npm run prisma:generate`. Migration name: timestamp 14 số + tên.
- FE miniapp: route lazy trong `apps/miniapp/src/components/app.tsx`; service `apps/miniapp/src/services/*-api.ts` (`api.get(...).then((r)=>r.data)`); copy ở `i18n/vi.ts`; tái dùng `ProductCard`, `ImageUpload`, `back-button`, `ui/empty-state`, `ui/skeleton`, `haptic`, `formatVnd`, `useSnackbar`, `getErrorMessage`. FE không có unit test trang → verify bằng `npm run -w @tubutree/miniapp typecheck && lint && build` (hoặc script tương đương trong package.json).

---

## File Structure

**Backend (apps/api):**
- Modify: `prisma/schema.prisma` — thêm models/enums + Product fields + User back-relation.
- Create: `prisma/migrations/<ts>_storefront_core/migration.sql` (auto qua prisma:migrate).
- Create: `prisma/migrations/<ts>_brand_backfill/migration.sql` (data backfill — viết tay, idempotent).
- Create: `src/modules/storefront/storefront.module.ts`
- Create: `src/modules/storefront/storefront.service.ts`
- Create: `src/modules/storefront/storefront.service.spec.ts`
- Create: `src/modules/storefront/storefront.controller.ts`
- Modify: `src/app.module.ts` — đăng ký `StorefrontModule`.

**FE miniapp (apps/miniapp):**
- Create: `src/services/storefront-api.ts`
- Create: `src/pages/storefront-builder.tsx` (CTV sửa)
- Create: `src/pages/storefront-view.tsx` (khách xem `/s/:slug`)
- Modify: `src/components/app.tsx` — route `/storefront` (builder) + `/s/:slug` (view).
- Modify: `src/pages/affiliate.tsx` — thêm nút "Gian hàng của tôi" → `/storefront`.
- Modify: `src/i18n/vi.ts` — thêm `vi.storefront`.

---

## Task 1: Prisma — models, enums, fields, back-relations

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Thêm enums (cuối khu vực enum, gần CommissionStatus)**

```prisma
enum StorefrontType {
  CTV
  BRAND
}

enum CollectionKind {
  NORMAL
  COMBO
}

enum CollectionLayout {
  GRID
  CAROUSEL
  STACK
}
```

- [ ] **Step 2: Thêm model `Brand` (sau model Product)**

```prisma
model Brand {
  id             String     @id @default(cuid())
  slug           String     @unique
  name           String     @unique
  logoUrl        String?
  coverUrl       String?
  tagline        String?
  story          String?    @db.Text
  storyImages    String[]
  origin         String?
  certifications Json?
  isVerified     Boolean    @default(false)
  isPublished    Boolean    @default(false)
  ownerUserId    String?
  followerCount  Int        @default(0)
  products       Product[]
  storefront     Storefront?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@map("brands")
}
```

- [ ] **Step 3: Thêm field vào model `Product`** (trong block `model Product { ... }`, cạnh `brand String`)

```prisma
  brandId         String?
  brandRef        Brand?   @relation(fields: [brandId], references: [id])
  affiliateBlocked Boolean @default(false)
```

(thêm `@@index([brandId])` vào cuối block Product, cạnh các @@index khác)

- [ ] **Step 4: Thêm 3 model storefront (sau model Brand)**

```prisma
model Storefront {
  id          String                 @id @default(cuid())
  type        StorefrontType
  slug        String                 @unique
  ownerUserId String?
  owner       User?                  @relation(fields: [ownerUserId], references: [id])
  brandId     String?                @unique
  brand       Brand?                 @relation(fields: [brandId], references: [id])
  title       String
  headerNote  String?
  avatarUrl   String?
  coverUrl    String?
  theme       String                 @default("leaf-orange")
  isPublished Boolean                @default(false)
  publishedAt DateTime?
  collections StorefrontCollection[]
  createdAt   DateTime               @default(now())
  updatedAt   DateTime               @updatedAt

  @@index([ownerUserId])
  @@map("storefronts")
}

model StorefrontCollection {
  id               String           @id @default(cuid())
  storefrontId     String
  storefront       Storefront       @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  title            String
  kind             CollectionKind   @default(NORMAL)
  layout           CollectionLayout @default(CAROUSEL)
  sortOrder        Int              @default(0)
  comboDiscountPct Int?
  items            StorefrontItem[]

  @@index([storefrontId])
  @@map("storefront_collections")
}

model StorefrontItem {
  id           String               @id @default(cuid())
  collectionId String
  collection   StorefrontCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  productId    String
  variationId  String?
  note         String?
  sortOrder    Int                  @default(0)
  isPinned     Boolean              @default(false)
  isHidden     Boolean              @default(false)

  @@index([collectionId])
  @@map("storefront_items")
}
```

- [ ] **Step 5: Thêm back-relation vào model `User`** (trong block `model User { ... }`, khu back-relations cạnh `commissions Commission[]`)

```prisma
  storefronts         Storefront[]
```

- [ ] **Step 6: Validate schema**

Run: `cd apps/api && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 7: Tạo migration + generate client**

Run: `cd apps/api && npm run prisma:migrate -- --name storefront_core`
Expected: migration mới tạo dưới `prisma/migrations/<ts>_storefront_core/`, áp lên DB dev OK.
Run: `cd apps/api && npm run prisma:generate`
Expected: `Generated Prisma Client`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(storefront): prisma models Brand + Storefront/Collection/Item (Lớp 1)"
```

---

## Task 2: Backfill `Brand` từ `Product.brand`

**Files:**
- Create: `apps/api/prisma/migrations/<ts>_brand_backfill/migration.sql`

Mục tiêu: sinh `Brand` cho mỗi giá trị `Product.brand` distinct + set `Product.brandId`. Idempotent (chạy lại không nhân đôi). `slug` = lower-kebab của name.

- [ ] **Step 1: Tạo thư mục + file migration thủ công**

Tạo file `apps/api/prisma/migrations/<ts>_brand_backfill/migration.sql` (thay `<ts>` bằng timestamp 14 số > migration trước):

```sql
-- Backfill Brand entity từ Product.brand (idempotent)
INSERT INTO "brands" ("id", "slug", "name", "isPublished", "isVerified", "createdAt", "updatedAt")
SELECT
  md5(p."brand"),
  lower(regexp_replace(regexp_replace(p."brand", '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')),
  p."brand",
  false,
  false,
  now(),
  now()
FROM (SELECT DISTINCT "brand" FROM "products" WHERE "brand" IS NOT NULL AND "brand" <> '') p
ON CONFLICT ("name") DO NOTHING;

-- Set Product.brandId theo tên brand
UPDATE "products" pr
SET "brandId" = b."id"
FROM "brands" b
WHERE pr."brand" = b."name" AND pr."brandId" IS NULL;
```

- [ ] **Step 2: Áp migration**

Run: `cd apps/api && npm run prisma:migrate -- --name brand_backfill`
Expected: nếu prisma báo "migration already exists / db in sync", dùng `npx prisma migrate deploy` để áp file vừa tạo. Mọi product có brand → có brandId; mỗi brand distinct → 1 row `brands`.

- [ ] **Step 3: Verify bằng SQL nhanh**

Run: `cd apps/api && npx prisma db execute --stdin <<< 'SELECT (SELECT count(*) FROM brands) AS brands, (SELECT count(*) FROM products WHERE "brandId" IS NULL) AS products_no_brand;'`
Expected: `brands` > 0; `products_no_brand` = 0 (hoặc chỉ những product brand rỗng).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations
git commit -m "feat(storefront): backfill Brand entity từ Product.brand"
```

---

## Task 3: StorefrontService — khởi tạo + lấy gian hàng của tôi (TDD)

**Files:**
- Create: `apps/api/src/modules/storefront/storefront.service.ts`
- Test: `apps/api/src/modules/storefront/storefront.service.spec.ts`

Method:
- `getOrCreateMine(userId)`: nếu user chưa có Storefront type=CTV → tạo draft (slug = `referralCode` của user; title mặc định `Cửa hàng của <fullName|"bạn">`). Chỉ cho role AFFILIATE/ADMIN. Trả Storefront.
- `getMine(userId)`: trả Storefront (kèm collections+items, gồm cả isHidden — để sửa), order theo sortOrder.

- [ ] **Step 1: Viết test thất bại**

```typescript
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(over: Record<string, any> = {}) {
  return {
    user: { findUniqueOrThrow: jest.fn() },
    storefront: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    ...over,
  } as unknown as PrismaService;
}

describe('StorefrontService.getOrCreateMine', () => {
  it('tạo gian hàng draft cho CTV nếu chưa có', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'u1', role: 'AFFILIATE', referralCode: 'LINH123', fullName: 'Linh',
    });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.storefront.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const svc = new StorefrontService(prisma);
    const sf = await svc.getOrCreateMine('u1');

    expect(prisma.storefront.create).toHaveBeenCalled();
    expect(sf.slug).toBe('LINH123');
    expect(sf.type).toBe('CTV');
    expect(sf.title).toContain('Linh');
  });

  it('trả gian hàng có sẵn, không tạo mới', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'AFFILIATE', referralCode: 'L', fullName: 'L' });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', type: 'CTV' });

    const svc = new StorefrontService(prisma);
    const sf = await svc.getOrCreateMine('u1');

    expect(sf.id).toBe('s1');
    expect(prisma.storefront.create).not.toHaveBeenCalled();
  });

  it('từ chối user không phải CTV', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'CUSTOMER', referralCode: 'L' });
    const svc = new StorefrontService(prisma);
    await expect(svc.getOrCreateMine('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`
Expected: FAIL (`Cannot find module './storefront.service'`).

- [ ] **Step 3: Viết service tối thiểu**

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateMine(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'AFFILIATE' && user.role !== 'ADMIN') {
      throw new BadRequestException('Chỉ CTV mới tạo được gian hàng.');
    }
    const existing = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (existing) return existing;
    return this.prisma.storefront.create({
      data: {
        type: 'CTV',
        slug: user.referralCode,
        ownerUserId: userId,
        title: `Cửa hàng của ${user.fullName ?? 'bạn'}`,
      },
    });
  }

  async getMine(userId: string) {
    const sf = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId, type: 'CTV' },
      include: {
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: { items: { orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }] } },
        },
      },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
  }

  // helper dùng lại ở các task sau
  private async assertOwnedStorefront(userId: string) {
    const sf = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
  }

  private async assertOwnedCollection(userId: string, collectionId: string) {
    const col = await this.prisma.storefrontCollection.findUnique({
      where: { id: collectionId },
      include: { storefront: true },
    });
    if (!col || col.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return col;
  }

  private async assertOwnedItem(userId: string, itemId: string) {
    const item = await this.prisma.storefrontItem.findUnique({
      where: { id: itemId },
      include: { collection: { include: { storefront: true } } },
    });
    if (!item || item.collection.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return item;
  }
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): getOrCreateMine + getMine + ownership helpers (TDD)"
```

---

## Task 4: updateMine + publishMine (TDD)

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts`
- Modify: `apps/api/src/modules/storefront/storefront.service.spec.ts`

- [ ] **Step 1: Thêm test**

```typescript
describe('StorefrontService.updateMine/publishMine', () => {
  it('cập nhật title/note/theme', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma);
    const r = await svc.updateMine('u1', { title: 'Shop Linh', headerNote: 'xin chào', theme: 'leaf-orange' });
    expect(r.title).toBe('Shop Linh');
    expect(prisma.storefront.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  it('publish set isPublished + publishedAt', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma);
    const r = await svc.publishMine('u1', true);
    expect(r.isPublished).toBe(true);
    expect(r.publishedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Chạy test — FAIL** (`updateMine is not a function`)

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 3: Thêm method vào service**

```typescript
  async updateMine(
    userId: string,
    dto: { title?: string; headerNote?: string; avatarUrl?: string; coverUrl?: string; theme?: string },
  ) {
    const sf = await this.assertOwnedStorefront(userId);
    return this.prisma.storefront.update({ where: { id: sf.id }, data: dto });
  }

  async publishMine(userId: string, isPublished: boolean) {
    const sf = await this.assertOwnedStorefront(userId);
    return this.prisma.storefront.update({
      where: { id: sf.id },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
  }
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): updateMine + publishMine (TDD)"
```

---

## Task 5: Collections CRUD + reorder (TDD)

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts`
- Modify: `apps/api/src/modules/storefront/storefront.service.spec.ts`

Methods: `createCollection`, `updateCollection`, `deleteCollection`, `reorderCollections(userId, orderedIds[])`.

- [ ] **Step 1: Thêm test**

```typescript
describe('StorefrontService collections', () => {
  it('createCollection gắn vào storefront của tôi, sortOrder kế tiếp', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { count: jest.fn().mockResolvedValue(2), create: jest.fn().mockImplementation(({ data }) => ({ id: 'c3', ...data })) },
    });
    const svc = new StorefrontService(prisma);
    const c = await svc.createCollection('u1', { title: 'Skincare' });
    expect(c.storefrontId).toBe('s1');
    expect(c.sortOrder).toBe(2);
    expect(c.kind).toBe('NORMAL');
  });

  it('reorderCollections cập nhật sortOrder theo thứ tự mảng', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), update: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    });
    const svc = new StorefrontService(prisma);
    await svc.reorderCollections('u1', ['b', 'a']);
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sortOrder: 1 } });
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 3: Thêm methods**

```typescript
  async createCollection(
    userId: string,
    dto: { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
  ) {
    const sf = await this.assertOwnedStorefront(userId);
    const count = await this.prisma.storefrontCollection.count({ where: { storefrontId: sf.id } });
    return this.prisma.storefrontCollection.create({
      data: {
        storefrontId: sf.id,
        title: dto.title,
        kind: dto.kind ?? 'NORMAL',
        layout: dto.layout ?? 'CAROUSEL',
        comboDiscountPct: dto.kind === 'COMBO' ? dto.comboDiscountPct ?? 0 : null,
        sortOrder: count,
      },
    });
  }

  async updateCollection(
    userId: string,
    collectionId: string,
    dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
  ) {
    await this.assertOwnedCollection(userId, collectionId);
    return this.prisma.storefrontCollection.update({ where: { id: collectionId }, data: dto });
  }

  async deleteCollection(userId: string, collectionId: string) {
    await this.assertOwnedCollection(userId, collectionId);
    await this.prisma.storefrontCollection.delete({ where: { id: collectionId } });
    return { ok: true };
  }

  async reorderCollections(userId: string, orderedIds: string[]) {
    const sf = await this.assertOwnedStorefront(userId);
    const owned = await this.prisma.storefrontCollection.findMany({
      where: { storefrontId: sf.id }, select: { id: true },
    });
    const ownedSet = new Set(owned.map((c) => c.id));
    const ops = orderedIds
      .filter((id) => ownedSet.has(id))
      .map((id, i) => this.prisma.storefrontCollection.update({ where: { id }, data: { sortOrder: i } }));
    await this.prisma.$transaction(ops);
    return { ok: true };
  }
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): collections CRUD + reorder (TDD)"
```

---

## Task 6: Items CRUD + reorder (TDD)

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts`
- Modify: `apps/api/src/modules/storefront/storefront.service.spec.ts`

Methods: `addItem`, `updateItem` (note/isPinned/isHidden), `removeItem`, `reorderItems(userId, collectionId, orderedItemIds[])`.

- [ ] **Step 1: Thêm test**

```typescript
describe('StorefrontService items', () => {
  it('addItem gắn vào collection của tôi', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      storefrontItem: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockImplementation(({ data }) => ({ id: 'i2', ...data })) },
    });
    const svc = new StorefrontService(prisma);
    const it = await svc.addItem('u1', 'c1', { productId: 'p1', note: 'thích' });
    expect(it.collectionId).toBe('c1');
    expect(it.productId).toBe('p1');
    expect(it.sortOrder).toBe(1);
  });

  it('updateItem chặn người không sở hữu', async () => {
    const prisma = makePrisma({
      storefrontItem: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', collection: { storefront: { ownerUserId: 'OTHER' } } }) },
    });
    const svc = new StorefrontService(prisma);
    await expect(svc.updateItem('u1', 'i1', { isHidden: true })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 3: Thêm methods**

```typescript
  async addItem(
    userId: string,
    collectionId: string,
    dto: { productId: string; variationId?: string; note?: string },
  ) {
    await this.assertOwnedCollection(userId, collectionId);
    const count = await this.prisma.storefrontItem.count({ where: { collectionId } });
    return this.prisma.storefrontItem.create({
      data: { collectionId, productId: dto.productId, variationId: dto.variationId ?? null, note: dto.note ?? null, sortOrder: count },
    });
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: { note?: string; isPinned?: boolean; isHidden?: boolean },
  ) {
    await this.assertOwnedItem(userId, itemId);
    return this.prisma.storefrontItem.update({ where: { id: itemId }, data: dto });
  }

  async removeItem(userId: string, itemId: string) {
    await this.assertOwnedItem(userId, itemId);
    await this.prisma.storefrontItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async reorderItems(userId: string, collectionId: string, orderedItemIds: string[]) {
    await this.assertOwnedCollection(userId, collectionId);
    const owned = await this.prisma.storefrontItem.findMany({ where: { collectionId }, select: { id: true } });
    const ownedSet = new Set(owned.map((i) => i.id));
    const ops = orderedItemIds
      .filter((id) => ownedSet.has(id))
      .map((id, i) => this.prisma.storefrontItem.update({ where: { id }, data: { sortOrder: i } }));
    await this.prisma.$transaction(ops);
    return { ok: true };
  }
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): items CRUD + reorder + ownership guard (TDD)"
```

---

## Task 7: Catalog picker — `pickerProducts` (TDD)

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts`
- Modify: `apps/api/src/modules/storefront/storefront.service.spec.ts`

`pickerProducts(userId, { search?, page?, limit? })`: trả product active, **loại `affiliateBlocked=true`**, kèm `affiliateRate` cao nhất trong variations (badge "+% HH") + `ratingAvg`/`reviewCount`/`thumbnail`/giá. Lọc theo search tên (insensitive).

- [ ] **Step 1: Thêm test**

```typescript
describe('StorefrontService.pickerProducts', () => {
  it('loại SP affiliateBlocked, trả maxRate', async () => {
    const prisma = makePrisma({
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Dầu gội', slug: 'dau-goi', thumbnail: 't', basePrice: 189000, salePrice: null, ratingAvg: 4.8, reviewCount: 42,
          variations: [{ affiliateRate: '8' }, { affiliateRate: '10' }] },
      ]) },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.pickerProducts('u1', { search: 'dầu' });
    expect((prisma.product.findMany as jest.Mock).mock.calls[0][0].where.affiliateBlocked).toBe(false);
    expect(r[0].maxAffiliateRate).toBe(10);
    expect(r[0].name).toBe('Dầu gội');
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 3: Thêm method**

```typescript
  async pickerProducts(_userId: string, q: { search?: string; page?: number; limit?: number }) {
    const take = Math.min(q.limit ?? 20, 50);
    const skip = ((q.page ?? 1) - 1) * take;
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        affiliateBlocked: false,
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take,
      skip,
      select: {
        id: true, name: true, slug: true, thumbnail: true, brand: true,
        basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true,
        variations: { select: { affiliateRate: true } },
      },
    });
    return products.map((p) => ({
      ...p,
      maxAffiliateRate: p.variations.reduce(
        (m, v) => Math.max(m, v.affiliateRate ? Number(v.affiliateRate) : 0), 0,
      ),
    }));
  }
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): catalog picker products + maxAffiliateRate (TDD)"
```

---

## Task 8: Public render — `getPublicBySlug` (TDD)

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts`
- Modify: `apps/api/src/modules/storefront/storefront.service.spec.ts`

`getPublicBySlug(slug)`: chỉ trả storefront `isPublished=true`; ẩn item `isHidden=true` và product không active; hydrate thông tin product (tên/giá/ảnh/rating) cho từng item; **KHÔNG** trả `affiliateRate` (không lộ % cho khách).

- [ ] **Step 1: Thêm test**

```typescript
describe('StorefrontService.getPublicBySlug', () => {
  it('404 nếu chưa publish', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new StorefrontService(prisma);
    await expect(svc.getPublicBySlug('x')).rejects.toThrow();
  });

  it('ẩn item isHidden + không trả affiliateRate', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true,
        collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0,
          items: [
            { id: 'i1', isHidden: false, isPinned: false, sortOrder: 0, note: null, variationId: null,
              product: { id: 'p1', name: 'P1', slug: 'p1', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 4.5, reviewCount: 3, isActive: true } },
            { id: 'i2', isHidden: true, isPinned: false, sortOrder: 1, note: null, variationId: null,
              product: { id: 'p2', name: 'P2', slug: 'p2', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true } },
          ] }],
      }) },
    });
    const svc = new StorefrontService(prisma);
    const r = await svc.getPublicBySlug('linh');
    expect(r.collections[0].items).toHaveLength(1);
    expect(r.collections[0].items[0].id).toBe('i1');
    expect(JSON.stringify(r)).not.toContain('affiliateRate');
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 3: Thêm method**

```typescript
  async getPublicBySlug(slug: string) {
    const sf = await this.prisma.storefront.findFirst({
      where: { slug, isPublished: true },
      include: {
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
              include: {
                product: {
                  select: {
                    id: true, name: true, slug: true, thumbnail: true, brand: true,
                    basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true, isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sf) throw new NotFoundException('Gian hàng không tồn tại hoặc chưa đăng.');
    return {
      id: sf.id, slug: sf.slug, type: sf.type, title: sf.title, headerNote: sf.headerNote,
      avatarUrl: sf.avatarUrl, coverUrl: sf.coverUrl, theme: sf.theme,
      collections: sf.collections.map((c) => ({
        id: c.id, title: c.title, kind: c.kind, layout: c.layout, comboDiscountPct: c.comboDiscountPct,
        items: c.items
          .filter((i) => !i.isHidden && i.product.isActive)
          .map((i) => ({
            id: i.id, note: i.note, variationId: i.variationId,
            product: {
              id: i.product.id, name: i.product.name, slug: i.product.slug, thumbnail: i.product.thumbnail,
              brand: i.product.brand, basePrice: i.product.basePrice, salePrice: i.product.salePrice,
              ratingAvg: i.product.ratingAvg, reviewCount: i.product.reviewCount,
            },
          })),
      })),
    };
  }
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront
git commit -m "feat(storefront): public render getPublicBySlug, ẩn hidden + giấu %HH (TDD)"
```

---

## Task 9: Controller + đăng ký module + smoke runtime

**Files:**
- Create: `apps/api/src/modules/storefront/storefront.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Viết controller**

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StorefrontService } from './storefront.service';

class UpdateStorefrontDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() headerNote?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() theme?: string;
}
class PublishDto { @IsBoolean() isPublished!: boolean; }
class CreateCollectionDto {
  @IsString() title!: string;
  @IsOptional() @IsIn(['NORMAL', 'COMBO']) kind?: 'NORMAL' | 'COMBO';
  @IsOptional() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @IsOptional() @IsInt() @Min(0) comboDiscountPct?: number;
}
class UpdateCollectionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @IsOptional() @IsInt() @Min(0) comboDiscountPct?: number;
}
class AddItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variationId?: string;
  @IsOptional() @IsString() note?: string;
}
class UpdateItemDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isPinned?: boolean;
  @IsOptional() @IsBoolean() isHidden?: boolean;
}
class ReorderDto { @IsArray() @IsString({ each: true }) orderedIds!: string[]; }
class PickerQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly svc: StorefrontService) {}

  @Post() create(@CurrentUser('sub') uid: string) { return this.svc.getOrCreateMine(uid); }
  @Get('me') me(@CurrentUser('sub') uid: string) { return this.svc.getMine(uid); }
  @Patch('me') update(@CurrentUser('sub') uid: string, @Body() dto: UpdateStorefrontDto) { return this.svc.updateMine(uid, dto); }
  @Post('me/publish') publish(@CurrentUser('sub') uid: string, @Body() dto: PublishDto) { return this.svc.publishMine(uid, dto.isPublished); }

  @Post('me/collections') addCol(@CurrentUser('sub') uid: string, @Body() dto: CreateCollectionDto) { return this.svc.createCollection(uid, dto); }
  @Patch('me/collections/:id') updCol(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateCollectionDto) { return this.svc.updateCollection(uid, id, dto); }
  @Delete('me/collections/:id') delCol(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.deleteCollection(uid, id); }
  @Post('me/collections/reorder') reorderCol(@CurrentUser('sub') uid: string, @Body() dto: ReorderDto) { return this.svc.reorderCollections(uid, dto.orderedIds); }

  @Post('me/collections/:id/items') addItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: AddItemDto) { return this.svc.addItem(uid, id, dto); }
  @Patch('me/items/:id') updItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateItemDto) { return this.svc.updateItem(uid, id, dto); }
  @Delete('me/items/:id') delItem(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.removeItem(uid, id); }
  @Post('me/collections/:id/items/reorder') reorderItems(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: ReorderDto) { return this.svc.reorderItems(uid, id, dto.orderedIds); }

  @Get('me/products') picker(@CurrentUser('sub') uid: string, @Query() q: PickerQuery) { return this.svc.pickerProducts(uid, q); }

  @Public() @Get('public/:slug') publicView(@Param('slug') slug: string) { return this.svc.getPublicBySlug(slug); }
}
```

> Kiểm tra path import decorator: mở `apps/api/src/common/decorators/` xác nhận tên file `current-user.decorator.ts` và `public.decorator.ts` (theo Task explorer). Nếu khác, sửa import cho khớp.

- [ ] **Step 2: Tạo module + đăng ký**

Create `apps/api/src/modules/storefront/storefront.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  controllers: [StorefrontController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
```

Modify `apps/api/src/app.module.ts`: thêm `import { StorefrontModule } from './modules/storefront/storefront.module';` và thêm `StorefrontModule` vào mảng `imports`.

- [ ] **Step 3: Build + boot + smoke**

Run: `cd apps/api && npm run build`
Expected: build OK, không lỗi DI.
Run: `cd apps/api && PORT=3099 node dist/main.js &` rồi:
- `curl -s localhost:3099/api/storefront/public/__none__` → 404 JSON (không 500).
- Dừng tiến trình sau khi xong.

- [ ] **Step 4: Chạy lại toàn bộ test storefront + lint**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront && npx tsc --noEmit`
Expected: tất cả PASS, không lỗi type.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront apps/api/src/app.module.ts
git commit -m "feat(storefront): controller + đăng ký StorefrontModule + smoke"
```

---

## Task 10: FE service `storefront-api.ts`

**Files:**
- Create: `apps/miniapp/src/services/storefront-api.ts`

- [ ] **Step 1: Viết service (types + functions)**

```typescript
import { api } from './api';

export interface StorefrontItem {
  id: string;
  note: string | null;
  variationId: string | null;
  product: {
    id: string; name: string; slug: string; thumbnail: string | null; brand: string;
    basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number;
  };
}
export interface StorefrontItemEdit extends StorefrontItem { isPinned: boolean; isHidden: boolean; sortOrder: number; productId: string; }
export interface StorefrontCollection {
  id: string; title: string; kind: 'NORMAL' | 'COMBO'; layout: 'GRID' | 'CAROUSEL' | 'STACK';
  comboDiscountPct: number | null; items: StorefrontItem[];
}
export interface StorefrontCollectionEdit extends Omit<StorefrontCollection, 'items'> { sortOrder: number; items: StorefrontItemEdit[]; }
export interface Storefront {
  id: string; slug: string; type: 'CTV' | 'BRAND'; title: string; headerNote: string | null;
  avatarUrl: string | null; coverUrl: string | null; theme: string; collections: StorefrontCollection[];
}
export interface StorefrontEdit extends Omit<Storefront, 'collections'> { isPublished: boolean; collections: StorefrontCollectionEdit[]; }
export interface PickerProduct {
  id: string; name: string; slug: string; thumbnail: string | null; brand: string;
  basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number; maxAffiliateRate: number;
}

export const createStorefront = () => api.post('/storefront').then((r) => r.data as StorefrontEdit);
export const getMyStorefront = () => api.get('/storefront/me').then((r) => r.data as StorefrontEdit);
export const getPublicStorefront = (slug: string) => api.get(`/storefront/public/${slug}`).then((r) => r.data as Storefront);
export const updateStorefront = (dto: Partial<Pick<Storefront, 'title' | 'headerNote' | 'avatarUrl' | 'coverUrl' | 'theme'>>) =>
  api.patch('/storefront/me', dto).then((r) => r.data as StorefrontEdit);
export const publishStorefront = (isPublished: boolean) =>
  api.post('/storefront/me/publish', { isPublished }).then((r) => r.data as StorefrontEdit);

export const createCollection = (dto: { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.post('/storefront/me/collections', dto).then((r) => r.data as StorefrontCollectionEdit);
export const updateCollection = (id: string, dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number }) =>
  api.patch(`/storefront/me/collections/${id}`, dto).then((r) => r.data);
export const deleteCollection = (id: string) => api.delete(`/storefront/me/collections/${id}`).then((r) => r.data);
export const reorderCollections = (orderedIds: string[]) => api.post('/storefront/me/collections/reorder', { orderedIds }).then((r) => r.data);

export const addItem = (collectionId: string, dto: { productId: string; variationId?: string; note?: string }) =>
  api.post(`/storefront/me/collections/${collectionId}/items`, dto).then((r) => r.data as StorefrontItemEdit);
export const updateItem = (id: string, dto: { note?: string; isPinned?: boolean; isHidden?: boolean }) =>
  api.patch(`/storefront/me/items/${id}`, dto).then((r) => r.data);
export const removeItem = (id: string) => api.delete(`/storefront/me/items/${id}`).then((r) => r.data);
export const reorderItems = (collectionId: string, orderedIds: string[]) =>
  api.post(`/storefront/me/collections/${collectionId}/items/reorder`, { orderedIds }).then((r) => r.data);

export const pickerProducts = (search?: string) =>
  api.get('/storefront/me/products', { params: { search } }).then((r) => r.data as PickerProduct[]);
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/miniapp && npx tsc --noEmit`
Expected: không lỗi (import `api` đúng từ `./api`).

- [ ] **Step 3: Commit**

```bash
git add apps/miniapp/src/services/storefront-api.ts
git commit -m "feat(storefront/fe): service storefront-api + types"
```

---

## Task 11: FE — trang builder `storefront-builder.tsx`

**Files:**
- Create: `apps/miniapp/src/pages/storefront-builder.tsx`
- Modify: `apps/miniapp/src/i18n/vi.ts` — thêm khối `storefront`.

Bố cục theo mockup `ctv-builder` (§6.2): header sửa (avatar/cover/title/note + ImageUpload), danh sách collection → item có nút **đẩy lên đầu (isPinned) / ẩn-hiện (isHidden) / xoá**, nút **Thêm sản phẩm** (Sheet picker với search), **Tạo bộ sưu tập**, đáy **Xem trước (mở /s/:slug) + Lưu & Đăng**.

- [ ] **Step 1: Thêm copy vào `vi.ts`** (trong object `vi`, thêm khoá `storefront`)

```typescript
  storefront: {
    title: 'Gian hàng của tôi',
    empty: 'Tạo gian hàng để chia sẻ sản phẩm bạn tâm đắc.',
    create: 'Tạo gian hàng',
    addProduct: 'Thêm sản phẩm',
    addCollection: 'Tạo bộ sưu tập',
    preview: 'Xem trước',
    publish: 'Lưu & Đăng',
    published: 'Đã đăng gian hàng 🎉',
    pinTop: 'Đẩy lên đầu',
    hide: 'Ẩn',
    show: 'Hiện',
    pickerSearch: 'Tìm sản phẩm…',
    commission: 'hoa hồng',
  },
```

- [ ] **Step 2: Viết trang builder**

```tsx
import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMyStorefront, createStorefront, updateStorefront, publishStorefront,
  createCollection, addItem, updateItem, removeItem, pickerProducts,
  type StorefrontEdit, type PickerProduct,
} from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

export default function StorefrontBuilderPage() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const sfQ = useQuery({ queryKey: ['my-storefront'], queryFn: getMyStorefront, retry: false });

  const createMut = useMutation({
    mutationFn: createStorefront,
    onSuccess: () => { haptic('medium'); void qc.invalidateQueries({ queryKey: ['my-storefront'] }); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (sfQ.isLoading) {
    return <Page className="page"><Box p={4}><Skeleton style={{ height: 120, borderRadius: 16 }} /></Box></Page>;
  }
  // 404 = chưa có gian hàng → mời tạo
  if (sfQ.isError) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={6}>
          <EmptyState art="sprout" heading={vi.storefront.title} body={vi.storefront.empty}
            ctaLabel={vi.storefront.create} onCta={() => createMut.mutate()} />
        </Box>
      </Page>
    );
  }
  return <Builder sf={sfQ.data!} />;
}

function Builder({ sf }: { sf: StorefrontEdit }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-storefront'] });

  const publishMut = useMutation({
    mutationFn: () => publishStorefront(true),
    onSuccess: () => { haptic('medium'); openSnackbar({ text: vi.storefront.published, type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const newColMut = useMutation({
    mutationFn: () => createCollection({ title: 'Bộ sưu tập mới' }),
    onSuccess: () => void refresh(),
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const itemMut = useMutation({
    mutationFn: (v: { id: string; dto: { isPinned?: boolean; isHidden?: boolean } }) => updateItem(v.id, v.dto),
    onSuccess: () => void refresh(),
  });
  const delItemMut = useMutation({ mutationFn: removeItem, onSuccess: () => void refresh() });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4}>
        <Text bold size="large">{sf.title}</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>/{sf.slug}</Text>
      </Box>

      {sf.collections.map((col) => (
        <Box key={col.id} mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
          <Text bold style={{ marginBottom: 8 }}>{col.title}</Text>
          {col.items.map((it) => (
            <Box key={it.id} flex alignItems="center" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box style={{ flex: 1 }}>
                <Text size="small" style={{ opacity: it.isHidden ? 0.5 : 1 }}>{it.product.name}</Text>
                <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(it.product.salePrice ?? it.product.basePrice)}</Text>
              </Box>
              <Text size="xSmall" className="tubu-press" onClick={() => itemMut.mutate({ id: it.id, dto: { isPinned: !it.isPinned } })}>⤒</Text>
              <Text size="xSmall" className="tubu-press" onClick={() => itemMut.mutate({ id: it.id, dto: { isHidden: !it.isHidden } })}>{it.isHidden ? '🙈' : '👁'}</Text>
              <Text size="xSmall" className="tubu-press" style={{ color: 'var(--danger)' }} onClick={() => delItemMut.mutate(it.id)}>✕</Text>
            </Box>
          ))}
          <Button size="small" variant="secondary" style={{ marginTop: 8 }} onClick={() => setPickerCol(col.id)}>+ {vi.storefront.addProduct}</Button>
        </Box>
      ))}

      <Box mx={4} mb={3}>
        <Button fullWidth variant="secondary" onClick={() => newColMut.mutate()}>+ {vi.storefront.addCollection}</Button>
      </Box>

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: 'var(--neutral-50)', display: 'flex', gap: 8 }}>
        <Button variant="secondary" style={{ flex: 1 }} onClick={() => navigate(`/s/${sf.slug}`)}>{vi.storefront.preview}</Button>
        <Button style={{ flex: 1, background: 'var(--primary-600)' }} loading={publishMut.isPending} onClick={() => publishMut.mutate()}>{vi.storefront.publish}</Button>
      </Box>

      <Sheet visible={!!pickerCol} onClose={() => setPickerCol(null)} autoHeight>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => { void refresh(); }} onClose={() => setPickerCol(null)} />}
      </Sheet>
    </Page>
  );
}

function PickerSheet({ collectionId, onAdded, onClose }: { collectionId: string; onAdded: () => void; onClose: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const listQ = useQuery({ queryKey: ['picker', search], queryFn: () => pickerProducts(search) });
  const addMut = useMutation({
    mutationFn: (p: PickerProduct) => addItem(collectionId, { productId: p.id }),
    onSuccess: () => { haptic('light'); onAdded(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large" style={{ marginBottom: 12 }}>{vi.storefront.addProduct}</Text>
      <Input placeholder={vi.storefront.pickerSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
      <Box mt={3} style={{ maxHeight: 360, overflowY: 'auto' }}>
        {listQ.isError ? <ErrorState message={getErrorMessage(listQ.error)} onRetry={() => void listQ.refetch()} /> :
          (listQ.data ?? []).map((p) => (
            <Box key={p.id} flex alignItems="center" style={{ gap: 8, padding: '8px 0', borderBottom: '1px solid var(--neutral-100)' }}>
              <Box style={{ flex: 1 }}>
                <Text size="small">{p.name}</Text>
                <Box flex alignItems="center" style={{ gap: 6 }}>
                  <Text size="xSmall" style={{ color: 'var(--primary-700)' }}>{formatVnd(p.salePrice ?? p.basePrice)}</Text>
                  {p.maxAffiliateRate > 0 && (
                    <Text size="xSmall" style={{ color: 'var(--leaf-700)', background: 'var(--leaf-50)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}>
                      +{p.maxAffiliateRate}% {vi.storefront.commission}
                    </Text>
                  )}
                </Box>
              </Box>
              <Button size="small" style={{ background: 'var(--primary-600)' }} onClick={() => addMut.mutate(p)}>+ Thêm</Button>
            </Box>
          ))}
      </Box>
      <Button fullWidth variant="secondary" style={{ marginTop: 12 }} onClick={onClose}>Xong</Button>
    </Box>
  );
}
```

> Kiểm tra prop `EmptyState` (`art`/`heading`/`body`/`ctaLabel`/`onCta`) khớp `components/ui/empty-state.tsx`; nếu tên `art` khác (vd `icon`) sửa cho khớp.

- [ ] **Step 3: Typecheck**

Run: `cd apps/miniapp && npx tsc --noEmit`
Expected: không lỗi type.

- [ ] **Step 4: Commit**

```bash
git add apps/miniapp/src/pages/storefront-builder.tsx apps/miniapp/src/i18n/vi.ts
git commit -m "feat(storefront/fe): trang builder CTV (thêm/ẩn/đẩy-lên-đầu/đăng)"
```

---

## Task 12: FE — trang khách xem `/s/:slug` + route + entry

**Files:**
- Create: `apps/miniapp/src/pages/storefront-view.tsx`
- Modify: `apps/miniapp/src/components/app.tsx` — route `/storefront` + `/s/:slug`.
- Modify: `apps/miniapp/src/pages/affiliate.tsx` — nút "Gian hàng của tôi".

- [ ] **Step 1: Viết trang view (khách xem, theo mockup §6.1)**

```tsx
import { Box, Page, Text, Button, useSnackbar } from 'zmp-ui';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPublicStorefront } from '../services/storefront-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { shareLink } from '../services/zmp-bridge';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';

const THEME: Record<string, string> = {
  'leaf-orange': 'linear-gradient(120deg, var(--leaf-600), var(--primary-600))',
};

export default function StorefrontViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const q = useQuery({ queryKey: ['public-storefront', slug], queryFn: () => getPublicStorefront(slug), staleTime: 60_000 });

  if (q.isLoading) return <Page className="page"><Box p={4}><Skeleton style={{ height: 180, borderRadius: 16 }} /></Box></Page>;
  if (q.isError || !q.data) return <Page className="page"><Box p={6}><ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} /></Box></Page>;
  const sf = q.data;

  return (
    <Page className="page page-bleed" style={{ background: 'var(--neutral-50)', paddingBottom: 90 }}>
      <Box style={{ height: 84, background: sf.coverUrl ? `url(${sf.coverUrl}) center/cover` : (THEME[sf.theme] ?? THEME['leaf-orange']) }} />
      <Box px={4} style={{ marginTop: -28 }}>
        <Box style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--primary-600)', border: '3px solid var(--neutral-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', overflow: 'hidden' }}>
          {sf.avatarUrl ? <img src={sf.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌿'}
        </Box>
        <Text bold size="xLarge" style={{ marginTop: 8 }}>{sf.title}</Text>
        {sf.headerNote && <Text size="small" style={{ color: 'var(--neutral-600)' }}>{sf.headerNote}</Text>}
        <Box flex style={{ gap: 6, marginTop: 8 }}>
          <Text size="xSmall" style={{ background: 'var(--leaf-600)', color: '#fff', padding: '3px 9px', borderRadius: 'var(--radius-full)' }}>✓ CTV chính thức Tubu</Text>
        </Box>
      </Box>

      {sf.collections.map((col) => (
        <Box key={col.id} mt={4} px={4}>
          <Text bold style={{ marginBottom: 8 }}>{col.title}</Text>
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {col.items.map((it) => {
              const price = it.product.salePrice ?? it.product.basePrice;
              return (
                <Box key={it.id} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                  <Box style={{ aspectRatio: '1/1', background: 'var(--neutral-100)' }}>
                    {it.product.thumbnail && <img src={it.product.thumbnail} alt={it.product.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </Box>
                  <Box p={2}>
                    <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{it.product.brand}</Text>
                    <Text size="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>{it.product.name}</Text>
                    {it.product.reviewCount > 0 && (
                      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>★ {it.product.ratingAvg.toFixed(1)} ({it.product.reviewCount})</Text>
                    )}
                    <Text bold style={{ color: 'var(--primary-700)', fontSize: 15 }}>{formatVnd(price)}</Text>
                    {it.note && <Text size="xSmall" style={{ color: 'var(--leaf-700)', background: 'var(--leaf-50)', padding: '4px 8px', borderRadius: 10, marginTop: 4 }}>💬 {it.note}</Text>}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}

      <Box style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, display: 'flex', gap: 8 }}>
        <ShareBtn slug={sf.slug} title={sf.title} />
      </Box>
    </Page>
  );
}

function ShareBtn({ slug, title }: { slug: string; title: string }) {
  const { openSnackbar } = useSnackbar();
  return (
    <Button fullWidth style={{ background: 'var(--primary-600)' }}
      onClick={() => { void shareLink({ title, description: 'Gian hàng sống xanh tuyển chọn', path: `/s/${slug}` }).catch(() => openSnackbar({ text: 'Không chia sẻ được', type: 'error' })); }}>
      ↗ Chia sẻ gian hàng
    </Button>
  );
}
```

> `page-bleed` (đã có trong tokens.css) cho back-button nằm trên hero. `useParams` import từ `react-router-dom` (zmp-ui dùng react-router) — nếu repo dùng `useParams` từ `zmp-ui`, đổi import cho khớp các trang hiện có (vd product-detail.tsx).

- [ ] **Step 2: Thêm route trong `app.tsx`**

Tìm khối khai báo route (vd `<Route path="/product/:slug" ... />`), thêm 2 dòng (lazy import ở đầu file theo pattern hiện có):

```tsx
const StorefrontBuilderPage = lazy(() => import('../pages/storefront-builder'));
const StorefrontViewPage = lazy(() => import('../pages/storefront-view'));
// ...
<Route path="/storefront" element={<StorefrontBuilderPage />} />
<Route path="/s/:slug" element={<StorefrontViewPage />} />
```

- [ ] **Step 3: Entry point trong `affiliate.tsx`** (trong `Dashboard`, ngay dưới khối nút "Rút hoa hồng")

```tsx
<Box mx={4} mb={3}>
  <Button fullWidth variant="secondary" onClick={() => navigate('/storefront')}>
    🏪 Gian hàng của tôi
  </Button>
</Box>
```

> `affiliate.tsx` cần `useNavigate` — kiểm tra đã import từ `zmp-ui`; nếu chưa, thêm vào import và `const navigate = useNavigate();` trong `Dashboard`.

- [ ] **Step 4: Typecheck + build miniapp**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run build`
Expected: build sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/storefront-view.tsx apps/miniapp/src/components/app.tsx apps/miniapp/src/pages/affiliate.tsx
git commit -m "feat(storefront/fe): trang khách xem /s/:slug + route + entry CTV"
```

---

## Task 13: Verify toàn cục Lớp 1

**Files:** (không sửa code — chỉ kiểm tra)

- [ ] **Step 1: Backend test + typecheck**

Run: `cd apps/api && npm run test -- --testPathPattern=storefront && npx tsc --noEmit`
Expected: tất cả test storefront PASS; không lỗi type.

- [ ] **Step 2: Backend full jest (không vỡ regression)**

Run: `cd apps/api && npm run test`
Expected: toàn bộ suite PASS (số test cũ + test storefront mới).

- [ ] **Step 3: Boot + e2e smoke (cần token dev)**

Run: `cd apps/api && PORT=3099 node dist/main.js &`
- Mint token: `npx ts-node scripts/dev-token.ts` (theo helper có sẵn) → lấy JWT một CTV.
- `curl -s -X POST localhost:3099/api/storefront -H "Authorization: Bearer <jwt>"` → tạo gian hàng (200, slug = referralCode).
- `curl -s -X POST localhost:3099/api/storefront/me/collections -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" -d '{"title":"Test"}'` → 200.
- `curl -s -X POST localhost:3099/api/storefront/me/publish -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" -d '{"isPublished":true}'` → 200.
- `curl -s localhost:3099/api/storefront/public/<referralCode>` → 200 trả storefront published.
- Dừng tiến trình.
Expected: chuỗi flow tạo→collection→publish→public render OK.

- [ ] **Step 4: FE typecheck + build**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run build`
Expected: sạch.

- [ ] **Step 5: Commit (nếu có chỉnh khi verify)**

```bash
git add -A
git commit -m "test(storefront): verify Lớp 1 — flow tạo→sắp xếp→đăng→xem công khai"
```

---

## Self-Review (đã chạy)

- **Spec coverage (Lớp 1):** §5.1 Brand entity ✅ (Task 1–2). §5.2 Storefront/Collection/Item ✅ (Task 1,3–8). §5.5 `affiliateBlocked` ✅ (Task 1,7). §6.1 trang khách ✅ (Task 12). §6.2 builder (thêm/ẩn/đẩy-lên-đầu/đăng) ✅ (Task 11). §7.1 publish draft ✅ (Task 4). Không-lộ-%HH ✅ (Task 8). — *Ngoài phạm vi Lớp 1 (đúng kế hoạch):* combo commission, store-context nav, share-kit nâng cao, dashboard hoa hồng, brand page, gamification → các lớp sau.
- **Placeholder scan:** không có TBD; mọi step có code/lệnh thật.
- **Type consistency:** `getOrCreateMine/getMine/updateMine/publishMine/createCollection/updateCollection/deleteCollection/reorderCollections/addItem/updateItem/removeItem/reorderItems/pickerProducts/getPublicBySlug` đồng nhất giữa service ↔ controller ↔ FE service. `maxAffiliateRate` dùng thống nhất. `orderedIds` cùng tên ở reorder.
- **Điểm cần kiểm khi thực thi (đã chú thích inline):** tên file decorator (`current-user`/`public`), prop `EmptyState`, nguồn `useParams` (react-router-dom vs zmp-ui), `useNavigate` trong affiliate.tsx, script `prisma:migrate`/`dev-token` tên chính xác trong package.json.
