# Storefront Lớp 3 — Brand Flagship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng trang nhãn hàng flagship (`/brand/:slug`) giàu hơn gian hàng CTV — chứng nhận đã xác minh, khuyến mãi editorial (`BrandPromotion`), chương trình đại lý + thưởng doanh số (`DealerReward`), và banner "CTV share-to-earn" — cùng admin CRUD cho brand/promotion/dealer-reward.

**Architecture:** Module mới `apps/api/src/modules/brand` (service + 2 controller: public `brand` + admin `admin`), tái dùng `Storefront`/`Brand`/`Product.brandId` đã có. Public payload KHÔNG bao giờ chứa % hoa hồng; share-to-earn lấy qua endpoint riêng yêu cầu role AFFILIATE (guardrail server-side). FE: web `/brand/[slug]` (showcase + OG, song song `/s/[slug]`) và miniapp `brand-view.tsx` (tương tác + share-to-earn + theo dõi). Migration thủ công + `migrate deploy` trên embedded PG 5544 (theo workflow máy này — KHÔNG `migrate dev`).

**Tech Stack:** NestJS + Prisma (PostgreSQL embedded port 5544), class-validator DTO inline, Jest (mock Prisma), Next.js App Router (web), ZaUI + react-query (miniapp).

---

## File Structure

**Backend (apps/api):**
- Create `prisma/migrations/20260627010000_brand_promotion_dealer_reward/migration.sql` — `BrandPromotion`, `DealerReward` tables + `DealerRewardType` enum.
- Modify `prisma/schema.prisma` — 2 model mới + enum + relation từ `Brand`.
- Create `src/modules/brand/brand.service.ts` — public flagship aggregation + admin CRUD + share-to-earn.
- Create `src/modules/brand/brand.service.spec.ts` — unit test (mock Prisma).
- Create `src/modules/brand/brand.controller.ts` — `@Controller('brand')`: public view + share-to-earn (auth).
- Create `src/modules/brand/brand-admin.controller.ts` — `@Roles('ADMIN') @Controller('admin')`: brands + promotions + dealer-rewards CRUD.
- Create `src/modules/brand/dto/brand.dto.ts` — DTO class-validator.
- Create `src/modules/brand/brand.module.ts`.
- Modify `src/app.module.ts` — đăng ký `BrandModule`.

**Frontend web (apps/web):**
- Modify `src/lib/api.ts` — `getBrand(slug)` + type `BrandDetail`.
- Create `src/app/brand/[slug]/page.tsx` — flagship showcase + OG metadata.

**Frontend miniapp (apps/miniapp):**
- Create `src/services/brand-api.ts` — `getPublicBrand`, `getBrandShareToEarn`, `followBrand`.
- Create `src/pages/brand-view.tsx` — trang nhãn tương tác (cert, khuyến mãi, đại lý, share-to-earn, story, products).
- Modify `src/router.tsx` (hoặc nơi khai báo route) — route `/brand/:slug`.

---

## Task 1: Schema + migration cho BrandPromotion & DealerReward

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260627010000_brand_promotion_dealer_reward/migration.sql`

- [ ] **Step 1: Thêm 2 model + enum vào schema.prisma**

Thêm vào `Brand` model (sau dòng `storefront Storefront?`):

```prisma
  promotions     BrandPromotion[]
  dealerRewards  DealerReward[]
```

Thêm cuối file (cạnh các model storefront):

```prisma
model BrandPromotion {
  id         String   @id @default(cuid())
  brandId    String
  brand      Brand    @relation(fields: [brandId], references: [id], onDelete: Cascade)
  title      String
  subtitle   String?
  themeColor String?
  couponCode String?
  startAt    DateTime
  endAt      DateTime
  isActive   Boolean  @default(true)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([brandId, isActive])
  @@map("brand_promotions")
}

enum DealerRewardType {
  TOUR
  GIFT
  OTHER
}

model DealerReward {
  id          String           @id @default(cuid())
  brandId     String?
  brand       Brand?           @relation(fields: [brandId], references: [id], onDelete: Cascade)
  type        DealerRewardType
  title       String
  description String?
  threshold   Int
  period      String           @default("QUARTER")
  isActive    Boolean          @default(true)
  sortOrder   Int              @default(0)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([brandId, isActive])
  @@map("dealer_rewards")
}
```

- [ ] **Step 2: Validate schema**

Run: `cd apps/api && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: Viết migration SQL thủ công**

Tạo `apps/api/prisma/migrations/20260627010000_brand_promotion_dealer_reward/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "DealerRewardType" AS ENUM ('TOUR', 'GIFT', 'OTHER');

-- CreateTable
CREATE TABLE "brand_promotions" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "themeColor" TEXT,
    "couponCode" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brand_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_rewards" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "type" "DealerRewardType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "threshold" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'QUARTER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dealer_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_promotions_brandId_isActive_idx" ON "brand_promotions"("brandId", "isActive");
CREATE INDEX "dealer_rewards_brandId_isActive_idx" ON "dealer_rewards"("brandId", "isActive");

-- AddForeignKey
ALTER TABLE "brand_promotions" ADD CONSTRAINT "brand_promotions_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dealer_rewards" ADD CONSTRAINT "dealer_rewards_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Áp migration lên embedded PG + generate client**

Khởi động embedded PG nếu chưa chạy (terminal riêng): `cd tools/local-test && npm run pg`

Run:
```bash
cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree npx prisma migrate deploy && npx prisma generate
```
Expected: "All migrations have been successfully applied." + "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260627010000_brand_promotion_dealer_reward
git commit -m "feat(storefront/brand): schema BrandPromotion + DealerReward (Lớp 3)"
```

---

## Task 2: BrandService — public flagship aggregation (TDD)

**Files:**
- Create: `apps/api/src/modules/brand/brand.service.ts`
- Test: `apps/api/src/modules/brand/brand.service.spec.ts`

Aggregation `getPublicBySlug` trả về brand flagship: thông tin nhãn, CHỈ cert `verified=true`, promotions đang active (theo `isActive` + khoảng `startAt..endAt`), sản phẩm của nhãn (active), dealer rewards active. KHÔNG chứa % hoa hồng.

- [ ] **Step 1: Viết failing test**

Tạo `apps/api/src/modules/brand/brand.service.spec.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { BrandService } from './brand.service';

function makePrisma(overrides: any = {}) {
  return {
    brand: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    brandPromotion: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    dealerReward: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn() },
    ...overrides,
  } as any;
}

describe('BrandService.getPublicBySlug', () => {
  const NOW = new Date('2026-06-27T00:00:00Z');

  it('ném NotFound khi brand chưa published', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue(null);
    const svc = new BrandService(prisma);
    await expect(svc.getPublicBySlug('khong-co', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chỉ trả cert verified=true, KHÔNG lộ proofUrl nội bộ vẫn giữ', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({
      id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: 't',
      story: null, storyImages: [], origin: 'Bến Tre', isVerified: true, followerCount: 5,
      certifications: [
        { code: 'ORG', label: 'Hữu cơ', verified: true, proofUrl: 'u' },
        { code: 'FAKE', label: 'Giả', verified: false },
      ],
    });
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(out.certifications).toHaveLength(1);
    expect(out.certifications[0].code).toBe('ORG');
  });

  it('lọc promotions theo isActive + khoảng thời gian', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({
      id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0,
    });
    prisma.brandPromotion.findMany.mockResolvedValue([
      { id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, themeColor: null, couponCode: null, startAt: new Date('2026-06-01'), endAt: new Date('2026-07-01'), sortOrder: 0 },
    ]);
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(prisma.brandPromotion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ brandId: 'b1', isActive: true, startAt: { lte: NOW }, endAt: { gte: NOW } }),
    }));
    expect(out.promotions).toHaveLength(1);
  });

  it('KHÔNG bao giờ kèm affiliateRate trong payload public', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0 });
    prisma.product.findMany.mockResolvedValue([
      { id: 'pr1', name: 'Dầu gội', slug: 'dau-goi', thumbnail: null, basePrice: 100000, salePrice: null, ratingAvg: 4.5, reviewCount: 3 },
    ]);
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(JSON.stringify(out)).not.toMatch(/affiliateRate|commission/i);
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: FAIL — "Cannot find module './brand.service'".

- [ ] **Step 3: Viết BrandService (phần public)**

Tạo `apps/api/src/modules/brand/brand.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface Cert { code: string; label: string; verified?: boolean; proofUrl?: string }

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trang nhãn flagship cho khách. now truyền vào để test tất định. */
  async getPublicBySlug(slug: string, now: Date = new Date()) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại hoặc chưa đăng.');

    const certs: Cert[] = Array.isArray(brand.certifications) ? (brand.certifications as Cert[]) : [];
    const verifiedCerts = certs
      .filter((c) => c && c.verified === true)
      .map((c) => ({ code: c.code, label: c.label, proofUrl: c.proofUrl ?? null }));

    const [promotions, products, dealerRewards] = await Promise.all([
      this.prisma.brandPromotion.findMany({
        where: { brandId: brand.id, isActive: true, startAt: { lte: now }, endAt: { gte: now } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, subtitle: true, themeColor: true, couponCode: true, startAt: true, endAt: true },
      }),
      this.prisma.product.findMany({
        where: { brandId: brand.id, isActive: true },
        orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
        take: 30,
        select: { id: true, name: true, slug: true, thumbnail: true, basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true },
      }),
      this.prisma.dealerReward.findMany({
        where: { OR: [{ brandId: brand.id }, { brandId: null }], isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, type: true, title: true, description: true, threshold: true, period: true },
      }),
    ]);

    return {
      id: brand.id, slug: brand.slug, name: brand.name, logoUrl: brand.logoUrl, coverUrl: brand.coverUrl,
      tagline: brand.tagline, story: brand.story, storyImages: brand.storyImages, origin: brand.origin,
      isVerified: brand.isVerified, followerCount: brand.followerCount,
      certifications: verifiedCerts,
      promotions, products, dealerRewards,
    };
  }
}
```

- [ ] **Step 4: Run test → pass**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/brand/brand.service.ts apps/api/src/modules/brand/brand.service.spec.ts
git commit -m "feat(storefront/brand): BrandService.getPublicBySlug — cert verified-only, no commission leak (TDD)"
```

---

## Task 3: BrandService — share-to-earn cho viewer AFFILIATE (TDD)

**Files:**
- Modify: `apps/api/src/modules/brand/brand.service.ts`
- Modify: `apps/api/src/modules/brand/brand.service.spec.ts`

Guardrail server-side: chỉ user role AFFILIATE mới nhận `{ eligible:true, maxAffiliateRate, referralCode, brandSlug }`; khác → `{ eligible:false }`. % HH KHÔNG nằm trong endpoint public.

- [ ] **Step 1: Thêm failing test**

Thêm vào `brand.service.spec.ts`:

```typescript
describe('BrandService.getShareToEarn', () => {
  it('trả eligible=false nếu user không phải AFFILIATE', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi', name: 'Sachi' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'CUSTOMER', referralCode: 'X' });
    const svc = new BrandService(prisma);
    const out = await svc.getShareToEarn('sachi', 'u1');
    expect(out.eligible).toBe(false);
    expect((out as any).maxAffiliateRate).toBeUndefined();
  });

  it('trả maxAffiliateRate (cao nhất trong SP nhãn) + referralCode cho AFFILIATE', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi', name: 'Sachi' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'AFFILIATE', referralCode: 'LINH123' });
    prisma.variation.findMany.mockResolvedValue([
      { affiliateRate: 8 }, { affiliateRate: 12 }, { affiliateRate: null },
    ]);
    const svc = new BrandService(prisma);
    const out = await svc.getShareToEarn('sachi', 'u1');
    expect(out).toEqual({ eligible: true, maxAffiliateRate: 12, referralCode: 'LINH123', brandSlug: 'sachi' });
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: FAIL — "getShareToEarn is not a function".

- [ ] **Step 3: Implement getShareToEarn**

Thêm method vào `BrandService`:

```typescript
  /** Banner "Chia sẻ nhận HH" — CHỈ AFFILIATE thấy %; khách thường eligible=false. */
  async getShareToEarn(slug: string, userId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true }, select: { id: true, slug: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại.');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId }, select: { role: true, referralCode: true },
    });
    if (user.role !== 'AFFILIATE') return { eligible: false as const };
    const variations = await this.prisma.variation.findMany({
      where: { product: { brandId: brand.id, isActive: true, affiliateBlocked: false } },
      select: { affiliateRate: true },
    });
    const maxAffiliateRate = variations.reduce(
      (m, v) => Math.max(m, v.affiliateRate ? Number(v.affiliateRate) : 0), 0,
    );
    return { eligible: true as const, maxAffiliateRate, referralCode: user.referralCode, brandSlug: brand.slug };
  }
```

- [ ] **Step 4: Run → pass**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/brand/brand.service.ts apps/api/src/modules/brand/brand.service.spec.ts
git commit -m "feat(storefront/brand): share-to-earn — AFFILIATE-only commission, server guardrail (TDD)"
```

---

## Task 4: BrandService — admin CRUD brand/promotion/dealer-reward (TDD)

**Files:**
- Modify: `apps/api/src/modules/brand/brand.service.ts`
- Modify: `apps/api/src/modules/brand/brand.service.spec.ts`

- [ ] **Step 1: Thêm failing test**

Thêm vào `brand.service.spec.ts`:

```typescript
describe('BrandService admin', () => {
  it('createBrand slugify tên tiếng Việt', async () => {
    const prisma = makePrisma();
    prisma.brand.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'b1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createBrand({ name: 'Dừa Bến Tre' });
    expect(out.slug).toBe('dua-ben-tre');
    expect(prisma.brand.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ slug: 'dua-ben-tre', name: 'Dừa Bến Tre' }) }));
  });

  it('verifyBrand set isVerified', async () => {
    const prisma = makePrisma();
    prisma.brand.update.mockResolvedValue({ id: 'b1', isVerified: true });
    const svc = new BrandService(prisma);
    await svc.verifyBrand('b1', true);
    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { isVerified: true } });
  });

  it('createPromotion gắn brandId', async () => {
    const prisma = makePrisma();
    prisma.brandPromotion.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createPromotion('b1', { title: 'Sale', startAt: '2026-06-01', endAt: '2026-07-01' });
    expect(out.brandId).toBe('b1');
    expect(out.startAt).toBeInstanceOf(Date);
  });

  it('createDealerReward giữ type', async () => {
    const prisma = makePrisma();
    prisma.dealerReward.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'd1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createDealerReward({ type: 'TOUR', title: 'Tour Phú Quốc', threshold: 50000000 });
    expect(out.type).toBe('TOUR');
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: FAIL — "createBrand is not a function".

- [ ] **Step 3: Implement admin methods + slugify**

Thêm vào đầu file (sau import) helper slugify, và các method vào `BrandService`:

```typescript
/** Slugify tiếng Việt: bỏ dấu, gạch nối, an toàn cho URL. */
export function slugifyVi(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

```typescript
  // ---- Admin: Brand ----
  listBrands() {
    return this.prisma.brand.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createBrand(dto: { name: string; slug?: string; logoUrl?: string; coverUrl?: string; tagline?: string; story?: string; origin?: string; certifications?: unknown; isPublished?: boolean }) {
    const slug = dto.slug?.trim() ? slugifyVi(dto.slug) : slugifyVi(dto.name);
    if (!slug) throw new BadRequestException('Tên nhãn không hợp lệ để tạo slug.');
    return this.prisma.brand.create({
      data: {
        name: dto.name, slug,
        logoUrl: dto.logoUrl ?? null, coverUrl: dto.coverUrl ?? null, tagline: dto.tagline ?? null,
        story: dto.story ?? null, origin: dto.origin ?? null,
        certifications: (dto.certifications as object) ?? undefined,
        isPublished: dto.isPublished ?? false,
      },
    });
  }

  async updateBrand(id: string, dto: Record<string, unknown>) {
    await this.prisma.brand.findUniqueOrThrow({ where: { id } });
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.slug === 'string' && dto.slug.trim()) data.slug = slugifyVi(dto.slug as string);
    return this.prisma.brand.update({ where: { id }, data });
  }

  verifyBrand(id: string, isVerified: boolean) {
    return this.prisma.brand.update({ where: { id }, data: { isVerified } });
  }

  // ---- Admin: BrandPromotion ----
  createPromotion(brandId: string, dto: { title: string; subtitle?: string; themeColor?: string; couponCode?: string; startAt: string; endAt: string; sortOrder?: number }) {
    return this.prisma.brandPromotion.create({
      data: {
        brandId, title: dto.title, subtitle: dto.subtitle ?? null, themeColor: dto.themeColor ?? null,
        couponCode: dto.couponCode ?? null, startAt: new Date(dto.startAt), endAt: new Date(dto.endAt),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  updatePromotion(id: string, dto: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.startAt === 'string') data.startAt = new Date(dto.startAt as string);
    if (typeof dto.endAt === 'string') data.endAt = new Date(dto.endAt as string);
    return this.prisma.brandPromotion.update({ where: { id }, data });
  }

  async deletePromotion(id: string) {
    await this.prisma.brandPromotion.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Admin: DealerReward ----
  listDealerRewards() {
    return this.prisma.dealerReward.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] });
  }

  createDealerReward(dto: { brandId?: string; type: 'TOUR' | 'GIFT' | 'OTHER'; title: string; description?: string; threshold: number; period?: string; sortOrder?: number }) {
    return this.prisma.dealerReward.create({
      data: {
        brandId: dto.brandId ?? null, type: dto.type, title: dto.title, description: dto.description ?? null,
        threshold: dto.threshold, period: dto.period ?? 'QUARTER', sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  updateDealerReward(id: string, dto: Record<string, unknown>) {
    return this.prisma.dealerReward.update({ where: { id }, data: dto });
  }

  async deleteDealerReward(id: string) {
    await this.prisma.dealerReward.delete({ where: { id } });
    return { ok: true };
  }
```

- [ ] **Step 4: Run → pass**

Run: `cd apps/api && npx jest brand.service --silent`
Expected: PASS (toàn bộ test brand.service).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/brand/brand.service.ts apps/api/src/modules/brand/brand.service.spec.ts
git commit -m "feat(storefront/brand): admin CRUD brand/promotion/dealer-reward + slugifyVi (TDD)"
```

---

## Task 5: Controllers + DTO + module + đăng ký

**Files:**
- Create: `apps/api/src/modules/brand/dto/brand.dto.ts`
- Create: `apps/api/src/modules/brand/brand.controller.ts`
- Create: `apps/api/src/modules/brand/brand-admin.controller.ts`
- Create: `apps/api/src/modules/brand/brand.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTO**

Tạo `apps/api/src/modules/brand/dto/brand.dto.ts`:

```typescript
import { Allow, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBrandDto {
  @IsString() name!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class VerifyBrandDto { @IsBoolean() isVerified!: boolean; }

export class PromotionDto {
  @IsString() title!: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class DealerRewardDto {
  @IsOptional() @IsString() brandId?: string;
  @IsIn(['TOUR', 'GIFT', 'OTHER']) type!: 'TOUR' | 'GIFT' | 'OTHER';
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(0) threshold!: number;
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateDealerRewardDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) threshold?: number;
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
```

- [ ] **Step 2: Public controller**

Tạo `apps/api/src/modules/brand/brand.controller.ts`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BrandService } from './brand.service';

@Controller('brand')
export class BrandController {
  constructor(private readonly svc: BrandService) {}

  @Public() @Get('public/:slug')
  publicView(@Param('slug') slug: string) {
    return this.svc.getPublicBySlug(slug);
  }

  // Cần đăng nhập: chỉ AFFILIATE nhận %HH; khách thường eligible=false.
  @Get(':slug/share-to-earn')
  shareToEarn(@Param('slug') slug: string, @CurrentUser('sub') uid: string) {
    return this.svc.getShareToEarn(slug, uid);
  }
}
```

- [ ] **Step 3: Admin controller**

Tạo `apps/api/src/modules/brand/brand-admin.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { BrandService } from './brand.service';
import {
  CreateBrandDto, DealerRewardDto, PromotionDto, UpdateBrandDto,
  UpdateDealerRewardDto, UpdatePromotionDto, VerifyBrandDto,
} from './dto/brand.dto';

@Roles('ADMIN')
@Controller('admin')
export class BrandAdminController {
  constructor(private readonly svc: BrandService) {}

  @Get('brands') list() { return this.svc.listBrands(); }
  @Post('brands') create(@Body() dto: CreateBrandDto) { return this.svc.createBrand(dto); }
  @Patch('brands/:id') update(@Param('id') id: string, @Body() dto: UpdateBrandDto) { return this.svc.updateBrand(id, dto); }
  @Patch('brands/:id/verify') verify(@Param('id') id: string, @Body() dto: VerifyBrandDto) { return this.svc.verifyBrand(id, dto.isVerified); }

  @Post('brands/:id/promotions') addPromo(@Param('id') id: string, @Body() dto: PromotionDto) { return this.svc.createPromotion(id, dto); }
  @Patch('promotions/:id') updPromo(@Param('id') id: string, @Body() dto: UpdatePromotionDto) { return this.svc.updatePromotion(id, dto); }
  @Delete('promotions/:id') delPromo(@Param('id') id: string) { return this.svc.deletePromotion(id); }

  @Get('dealer-rewards') listRewards() { return this.svc.listDealerRewards(); }
  @Post('dealer-rewards') addReward(@Body() dto: DealerRewardDto) { return this.svc.createDealerReward(dto); }
  @Patch('dealer-rewards/:id') updReward(@Param('id') id: string, @Body() dto: UpdateDealerRewardDto) { return this.svc.updateDealerReward(id, dto); }
  @Delete('dealer-rewards/:id') delReward(@Param('id') id: string) { return this.svc.deleteDealerReward(id); }
}
```

- [ ] **Step 4: Module + đăng ký**

Tạo `apps/api/src/modules/brand/brand.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BrandService } from './brand.service';
import { BrandController } from './brand.controller';
import { BrandAdminController } from './brand-admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BrandController, BrandAdminController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
```

> Kiểm tra cách `StorefrontModule` import Prisma (`grep PrismaModule apps/api/src/modules/storefront/storefront.module.ts`) và bắt chước đúng (có thể `PrismaModule` là global → bỏ `imports`). Dùng đúng pattern hiện hành.

Trong `apps/api/src/app.module.ts`: thêm `import { BrandModule } from './modules/brand/brand.module';` và thêm `BrandModule` vào mảng `imports` (cạnh `StorefrontModule`).

- [ ] **Step 5: Build API + chạy toàn bộ test**

Run: `cd apps/api && npx tsc --noEmit && npx jest --silent`
Expected: tsc sạch; tất cả test pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/brand apps/api/src/app.module.ts
git commit -m "feat(storefront/brand): controllers (public + admin) + module + đăng ký app"
```

---

## Task 6: E2E runtime smoke — admin tạo brand → publish → public 200

**Files:** (không tạo file; kiểm thử thủ công qua HTTP)

- [ ] **Step 1: Khởi động API trên embedded PG**

Run (terminal nền): `cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree JWT_ACCESS_SECRET=<từ .env> npm run start:dev`

- [ ] **Step 2: Mint JWT admin**

Run: `cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree JWT_ACCESS_SECRET=<từ .env> DEV_ROLE=ADMIN npx tsx scripts/dev-token.ts`
Lưu token vào `$TOKEN`.

- [ ] **Step 3: Tạo brand + publish + promotion**

```bash
curl -s -X POST localhost:3001/api/admin/brands -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Dừa Bến Tre","tagline":"Bến Tre từ 2015","isPublished":true,"certifications":[{"code":"ORG","label":"Hữu cơ","verified":true},{"code":"X","label":"Chưa duyệt","verified":false}]}'
# Lấy id, sau đó:
curl -s -X POST localhost:3001/api/admin/brands/<id>/promotions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"MUA 2 TẶNG 1","startAt":"2026-06-01","endAt":"2026-12-31"}'
```
Expected: 201 với brand có `slug:"dua-ben-tre"`; promotion tạo OK.

- [ ] **Step 4: Public view ẩn cert chưa verified**

Run: `curl -s localhost:3001/api/brand/public/dua-ben-tre`
Expected: 200, `certifications` chỉ 1 phần tử (code ORG); `promotions` 1 phần tử; KHÔNG có `affiliateRate`.

- [ ] **Step 5: Commit (nếu có chỉnh sửa fix trong quá trình smoke)**

```bash
git add -A && git commit -m "test(storefront/brand): e2e smoke admin→publish→public (fixes nếu có)"
```

---

## Task 7: Web `/brand/[slug]` flagship showcase + OG (song song `/s/[slug]`)

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/app/brand/[slug]/page.tsx`

- [ ] **Step 1: Thêm getBrand + type vào lib/api.ts**

Sau `getStorefront`, thêm:

```typescript
export interface BrandDetail {
  id: string; slug: string; name: string; logoUrl: string | null; coverUrl: string | null;
  tagline: string | null; story: string | null; storyImages: string[]; origin: string | null;
  isVerified: boolean; followerCount: number;
  certifications: { code: string; label: string; proofUrl: string | null }[];
  promotions: { id: string; title: string; subtitle: string | null; themeColor: string | null; couponCode: string | null; startAt: string; endAt: string }[];
  products: { id: string; name: string; slug: string; thumbnail: string | null; basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number }[];
  dealerRewards: { id: string; type: string; title: string; description: string | null; threshold: number; period: string }[];
}

export async function getBrand(slug: string): Promise<BrandDetail | null> {
  const res = await fetch(`${API_BASE}/brand/public/${slug}`, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  return res.json();
}
```

> Kiểm tra tên hằng base URL thực tế trong file (`API_BASE` vs khác) qua `grep -n "API_BASE\|fetch(" apps/web/src/lib/api.ts` và dùng đúng pattern `getStorefront` đang dùng (cùng cách gọi fetch + revalidate).

- [ ] **Step 2: Trang flagship + OG metadata**

Tạo `apps/web/src/app/brand/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrand, formatVnd } from '@/lib/api';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Nhãn hàng — Tubu Tree' };
  const title = `${b.name}${b.isVerified ? ' ✓' : ''} — Tubu Tree`;
  const description = b.tagline ?? `Nhãn hàng sống xanh trên Tubu Tree`;
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  return { title, description, openGraph: { title, description, images: img ? [img] : [], type: 'website' } };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {b.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.coverUrl} alt={b.name} className="mb-4 h-44 w-full rounded-xl object-cover" />
      )}
      <div className="flex items-center gap-3">
        {b.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt={b.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-white" />
        )}
        <div>
          <h1 className="flex items-center gap-1 text-2xl font-bold text-neutral-900">
            {b.name}
            {b.isVerified && <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">✓ Chính hãng</span>}
          </h1>
          {b.tagline && <p className="text-neutral-600">{b.tagline}</p>}
        </div>
      </div>

      {b.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900">Chứng nhận</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {b.certifications.map((c) => (
              <span key={c.code} className="whitespace-nowrap rounded-lg bg-green-50 px-3 py-1.5 text-sm text-green-800">🌿 {c.label}</span>
            ))}
          </div>
        </section>
      )}

      {b.promotions.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900">🎉 Khuyến mãi</h2>
          <div className="space-y-2">
            {b.promotions.map((p) => (
              <div key={p.id} className="rounded-xl border border-clay-200 bg-clay-50 p-3" style={p.themeColor ? { borderColor: p.themeColor } : undefined}>
                <p className="font-semibold text-clay-800">{p.title}</p>
                {p.subtitle && <p className="text-sm text-neutral-600">{p.subtitle}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {b.products.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-neutral-900">Sản phẩm</h2>
          <div className="grid grid-cols-2 gap-3">
            {b.products.map((p) => (
              <a key={p.id} href={`/san-pham/${p.slug}`} className="block overflow-hidden rounded-2xl bg-white shadow-sm">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail} alt={p.name} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-green-50 text-4xl">🌿</div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-sm text-neutral-900">{p.name}</p>
                  <p className="mt-1 font-bold text-clay-700">{formatVnd(p.salePrice ?? p.basePrice)}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {b.dealerRewards.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-neutral-900">🏪 Chương trình đại lý</h2>
          <div className="space-y-2">
            {b.dealerRewards.map((d) => (
              <div key={d.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="font-semibold text-neutral-900">{d.title}</p>
                {d.description && <p className="text-sm text-neutral-600">{d.description}</p>}
                <p className="mt-1 text-xs text-neutral-500">Đạt doanh số {formatVnd(d.threshold)} / {d.period === 'YEAR' ? 'năm' : 'quý'}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {b.story && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-neutral-900">Câu chuyện thương hiệu</h2>
          <p className="whitespace-pre-line text-neutral-700">{b.story}</p>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build web**

Run: `cd apps/web && npm run build`
Expected: build thành công (route `/brand/[slug]` xuất hiện trong output).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/brand
git commit -m "feat(storefront/web): trang nhãn /brand/[slug] flagship + OG metadata"
```

---

## Task 8: Miniapp brand-api + brand-view + route + share-to-earn

**Files:**
- Create: `apps/miniapp/src/services/brand-api.ts`
- Create: `apps/miniapp/src/pages/brand-view.tsx`
- Modify: file khai báo route miniapp (xác định qua `grep -rn "storefront-view\|path=\"/s" apps/miniapp/src`)

- [ ] **Step 1: brand-api service**

Tạo `apps/miniapp/src/services/brand-api.ts`:

```typescript
import { api } from './api';

export interface BrandCert { code: string; label: string; proofUrl: string | null }
export interface BrandPromotionView { id: string; title: string; subtitle: string | null; themeColor: string | null; couponCode: string | null; startAt: string; endAt: string }
export interface BrandProductView { id: string; name: string; slug: string; thumbnail: string | null; basePrice: number; salePrice: number | null; ratingAvg: number; reviewCount: number }
export interface DealerRewardView { id: string; type: 'TOUR' | 'GIFT' | 'OTHER'; title: string; description: string | null; threshold: number; period: string }
export interface BrandView {
  id: string; slug: string; name: string; logoUrl: string | null; coverUrl: string | null;
  tagline: string | null; story: string | null; storyImages: string[]; origin: string | null;
  isVerified: boolean; followerCount: number;
  certifications: BrandCert[]; promotions: BrandPromotionView[]; products: BrandProductView[]; dealerRewards: DealerRewardView[];
}
export type ShareToEarn = { eligible: false } | { eligible: true; maxAffiliateRate: number; referralCode: string; brandSlug: string };

export const getPublicBrand = (slug: string) => api.get(`/brand/public/${slug}`).then((r) => r.data as BrandView);
export const getBrandShareToEarn = (slug: string) => api.get(`/brand/${slug}/share-to-earn`).then((r) => r.data as ShareToEarn);
```

- [ ] **Step 2: brand-view page**

Tạo `apps/miniapp/src/pages/brand-view.tsx`. Tái dùng pattern của `storefront-view.tsx` (đọc file đó trước để khớp ZaUI import, back-button nổi, store-context-bar, react-query). Khung tối thiểu:

```tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPublicBrand, getBrandShareToEarn } from '../services/brand-api';
import { ShareSheet } from '../components/share-sheet';
// ... import ProductCard, BackButton, formatVnd theo storefront-view.tsx

export default function BrandView() {
  const { slug = '' } = useParams();
  const { data: brand, isLoading } = useQuery({ queryKey: ['brand', slug], queryFn: () => getPublicBrand(slug) });
  const { data: ste } = useQuery({ queryKey: ['brand-ste', slug], queryFn: () => getBrandShareToEarn(slug), retry: false });

  if (isLoading || !brand) return null; // skeleton theo convention dự án

  return (
    <div>
      {/* cover + logo + badge ✓ Chính hãng + tagline */}
      {/* share-to-earn banner CHỈ khi ste?.eligible */}
      {ste?.eligible && (
        <div className="ste-banner">💰 Chia sẻ nhãn này — nhận tới {ste.maxAffiliateRate}% hoa hồng</div>
      )}
      {/* chứng nhận (ẩn nếu rỗng) */}
      {/* khuyến mãi (ẩn nếu rỗng) */}
      {/* sản phẩm grid */}
      {/* chương trình đại lý (ẩn nếu rỗng) + nút Đăng ký đại lý → route dealer */}
      {/* story */}
      {/* đáy: Theo dõi + Chia sẻ (ShareSheet với url ?s=brand-slug + ?ref nếu ste.eligible) */}
    </div>
  );
}
```

> **Bắt buộc đọc trước khi viết:** `storefront-view.tsx`, `components/share-sheet.tsx`, `components/storefront-context-bar.tsx` để dùng đúng UI primitive, theme tokens (cam/lá/đất sét), back-button nổi, và cách `ShareSheet` nhận props (scope/url/caption). Empty-state §11: ẩn mọi khối rỗng (cert/khuyến mãi/đại lý), không render khung trống.

- [ ] **Step 3: Đăng ký route `/brand/:slug`**

Tìm nơi khai báo route `/s/:slug` (storefront-view) và thêm route song song trỏ `BrandView`. Lazy-load đúng pattern hiện có.

- [ ] **Step 4: Build miniapp**

Run: `cd apps/miniapp && npm run build`
Expected: build thành công, không lỗi type.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/services/brand-api.ts apps/miniapp/src/pages/brand-view.tsx apps/miniapp/src/<router-file>
git commit -m "feat(storefront/fe): trang nhãn miniapp /brand/:slug + share-to-earn banner (CTV)"
```

---

## Task 9: Verify toàn cục + finalize

- [ ] **Step 1: Chạy full test API**

Run: `cd apps/api && npx jest --silent`
Expected: tất cả pass (gồm brand.service mới).

- [ ] **Step 2: tsc + build cả 3 app**

Run: `cd apps/api && npx tsc --noEmit` ; `cd apps/web && npm run build` ; `cd apps/miniapp && npm run build`
Expected: tất cả sạch.

- [ ] **Step 3: Cập nhật memory**

Cập nhật `project_storefront.md`: Lớp 3 XONG (brand flagship + admin CRUD + share-to-earn), nêu commit range; còn lại Lớp 4.

- [ ] **Step 4: Commit cuối + (tùy) gộp lớp 2+3 hoặc tạo PR**

Theo finishing-a-development-branch khi cả Lớp 3 + 4 xong.

---

## Self-Review

**Spec coverage (§6.3, §7.5, §7.8, §8, §9, §11):**
- §6.3 trang nhãn flagship (cover/logo/badge ✓/tagline/cert/khuyến mãi/SP/đại lý/story) → Task 7 (web) + Task 8 (miniapp). ✔
- §7.5 CTV share-to-earn (banner % HH chỉ AFFILIATE) → Task 3 (service guardrail) + Task 8 (banner). ✔
- §7.8 brand v1 admin + đại lý (DealerReward) → Task 4 (admin CRUD) + Task 1 (schema). ✔
- §8 API public `/brand/:slug` + admin `/admin/brands` + `/admin/dealer-rewards` → Task 5. ✔
- §9 guardrails: cert verified-only (Task 2), brand chỉ admin (Task 5 `@Roles('ADMIN')`), không lộ %HH (Task 2 test + Task 3 endpoint riêng). ✔
- §11 empty-state ẩn khối rỗng → Task 7 (điều kiện `length > 0`) + Task 8 (ghi chú). ✔
- §5.3 BrandPromotion nối Coupon qua `couponCode` (chỉ editorial) → schema Task 1 có `couponCode`. ✔
- §5.4 DealerReward (TOUR/GIFT/OTHER, threshold, period, brandId null=toàn shop) → Task 1 + Task 2 query `OR brandId null`. ✔

**Placeholder scan:** Task 8 brand-view cố ý là khung + chỉ thị "đọc storefront-view trước" vì UI primitive miniapp phải khớp file thật — KHÔNG đoán API ZaUI. Đây là ràng buộc có chủ đích, không phải placeholder logic nghiệp vụ (logic share-to-earn/empty-state đã nêu rõ).

**Type consistency:** `getShareToEarn` trả `{eligible:false}` | `{eligible:true,maxAffiliateRate,referralCode,brandSlug}` đồng nhất giữa service (Task 3), FE type `ShareToEarn` (Task 8). `certifications` public = `{code,label,proofUrl}` đồng nhất Task 2 ↔ web/miniapp type. `DealerReward.type` enum `TOUR|GIFT|OTHER` đồng nhất schema/DTO/FE.
