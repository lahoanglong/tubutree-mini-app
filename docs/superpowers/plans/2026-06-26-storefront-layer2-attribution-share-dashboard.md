# Storefront Lớp 2 — Attribution · Store-context · Share-kit · Web OG · Dashboard (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một link gian hàng được chia sẻ đẹp (caption/QR/OG), khách vào → ở lại "store-context" (back/mua quay về gian hàng, có nút Về Tubu), đơn gắn attribution gian hàng, và CTV thấy hoa hồng theo từng gian hàng/sản phẩm.

**Architecture:** Mở rộng (không phá) Lớp 1. BE: thêm `Order.storefrontSlug` + truyền qua checkout + analytics query-based (per-storefront, per-product) trên dữ liệu sẵn có. FE miniapp: zustand `storefront-context` store (capture `?s=`/`?ref=` từ deep link, persist) + đổi đích back/sau-mua + share-kit (caption + QR). Web Next.js: trang public `/s/[slug]` có `generateMetadata` OG. TDD cho BE (jest mock Prisma); FE/web verify bằng tsc/lint/build.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest, React + zmp-ui + Vite + zustand + react-query, Next.js 14 App Router, qrcode.

**Spec:** `docs/superpowers/specs/2026-06-26-ctv-brand-storefront-design.md` (§7.3 store-context, §7.4 share-kit, §7.6 dashboard). **Combo (§7.2) KHÔNG thuộc plan này** — sẽ là plan Lớp 2B riêng (money-path cart/checkout). Brand page (§6.3) = Lớp 3.

**Tiền đề (Lớp 1 đã merge main):** module `apps/api/src/modules/storefront` (service + controller + `@Public GET /storefront/public/:slug`), FE `storefront-builder.tsx` + `storefront-view.tsx` (`/s/:slug`) + `storefront-api.ts`. `Order.referrerUserId` đã có; `PlaceOrderDto` đã nhận `referralCode` (checkout `resolveReferrer(dto.referralCode)` tại checkout.service.ts:93) nhưng **FE chưa gửi**.

**Quy ước codebase (đã verify — giống Lớp 1):**
- Module Nest: `PrismaService` auto-inject; `@CurrentUser('sub')`; `@Public()`; DTO class-validator inline; ValidationPipe whitelist.
- Test BE: `*.service.spec.ts`, `import 'reflect-metadata'`, mock prisma `{table:{method:jest.fn()}} as unknown as PrismaService`. Chạy: `cd apps/api && npm run test -- --testPathPattern=<x>`.
- Prisma: sửa schema → migration thủ công + `migrate deploy` (Docker hay tắt; dùng embedded PG `tools/local-test` port 5544, `DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree`; **KHÔNG** `migrate dev` trên embedded — shadow DB WIN1252 + GIN drift). Generate: `npx prisma generate`.
- FE miniapp verify: `cd apps/miniapp && npm run typecheck && npm run lint && npm run build`. Copy ở `i18n/vi.ts`. zustand store ở `src/store/`. Deep-link query: ZMP hash-based — `getLaunchReferral()` (zmp-bridge.ts) parse cả `window.location.search` và hash.
- Web verify: `cd apps/web && npm run build`. Route = thư mục `src/app/<route>/page.tsx`; `generateMetadata` async nhận `params: Promise<{slug}>` (Next 14 — `await params`); server fetch qua `API_BASE_URL` (lib/api.ts), ISR `revalidate`.

---

## File Structure

**Backend (apps/api):**
- Modify `prisma/schema.prisma` — `Order.storefrontSlug String?` + `@@index`.
- Create `prisma/migrations/20260626040000_order_storefront_slug/migration.sql`.
- Modify `src/modules/checkout/checkout.service.ts` + `checkout.controller.ts` (DTO) — set storefrontSlug.
- Modify `src/modules/affiliate/affiliate.service.ts` + `.spec.ts` + `affiliate.controller.ts` — `storefrontAnalytics` + `productCommissionBreakdown`.

**FE miniapp (apps/miniapp):**
- Create `src/store/storefront-context.ts` (zustand).
- Modify `src/components/app.tsx` — capture `?s=`/`?ref=` on launch; (route already exists).
- Modify `src/services/shop-api.ts` — placeOrder gửi `referralCode` + `storefrontSlug`.
- Modify `src/pages/checkout.tsx` — đính context vào placeOrder.
- Modify `src/components/checkout/order-success.tsx` + `src/components/back-button.tsx` — đích về gian hàng khi có context.
- Create `src/components/storefront-context-bar.tsx` — banner "Đang xem cửa hàng … · Về Tubu Tree".
- Create `src/components/qr-code.tsx` + `src/components/share-sheet.tsx` (caption presets + QR) ; modify `storefront-view.tsx` to use it.
- Modify `src/services/affiliate-api.ts` + `src/pages/affiliate.tsx` — dashboard per-storefront/per-product.
- Modify `src/i18n/vi.ts` — copy mới.
- Modify `apps/miniapp/package.json` — add `qrcode` + `@types/qrcode`.

**Web (apps/web):**
- Create `src/app/s/[slug]/page.tsx` (public storefront SSR + OG).
- Modify `src/lib/api.ts` — `getStorefront(slug)`.

---

## Task 1: Prisma — `Order.storefrontSlug`

**Files:** Modify `apps/api/prisma/schema.prisma`; Create migration.

- [ ] **Step 1: Add field to `Order` model** (cạnh `referrerUserId String?`)

```prisma
  storefrontSlug  String?
```
Add to the Order block's index area:
```prisma
  @@index([storefrontSlug])
```

- [ ] **Step 2: Validate**

Run: `cd apps/api && npx prisma validate`
Expected: schema valid.

- [ ] **Step 3: Create migration file** `apps/api/prisma/migrations/20260626040000_order_storefront_slug/migration.sql`:

```sql
ALTER TABLE "orders" ADD COLUMN "storefrontSlug" TEXT;
CREATE INDEX "orders_storefrontSlug_idx" ON "orders"("storefrontSlug");
```

- [ ] **Step 4: Apply + generate** (embedded PG; Docker off)

Run: `cd apps/api && DATABASE_URL="postgresql://postgres:postgres@localhost:5544/tubutree" npx prisma migrate deploy`
Expected: migration `20260626040000_order_storefront_slug` applied.
Run: `cd apps/api && npx prisma generate`
Expected: client regenerated (Order now has storefrontSlug).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(storefront): Order.storefrontSlug cho attribution gian hàng (Lớp 2)"
```

---

## Task 2: Checkout — nhận & lưu `storefrontSlug` (TDD)

**Files:** Modify `apps/api/src/modules/checkout/checkout.controller.ts` (PlaceOrderDto), `checkout.service.ts`; Test: `checkout.service.spec.ts` (tạo nếu chưa có cho case này — nếu đã có spec, thêm vào).

Mục tiêu: `PlaceOrderDto` nhận `storefrontSlug?`; `placeOrder` lưu `order.storefrontSlug = dto.storefrontSlug ?? null`. KHÔNG đổi logic giá/commission.

- [ ] **Step 1: Thêm field DTO** — trong `checkout.controller.ts`, class `PlaceOrderDto`, thêm:

```typescript
  @IsOptional() @IsString() storefrontSlug?: string;
```
(`@IsOptional`, `@IsString` đã import sẵn từ Lớp 1 controllers; nếu chưa, import từ `class-validator`.)

- [ ] **Step 2: Viết test thất bại** — thêm vào `apps/api/src/modules/checkout/checkout.service.spec.ts` (nếu file chưa tồn tại, tạo với `import 'reflect-metadata';` + mock theo các spec hiện có; tham khảo cấu trúc mock của một spec checkout đã có trong repo). Test xác minh `order.create` được gọi với `storefrontSlug` lấy từ dto:

```typescript
it('lưu storefrontSlug vào order khi đặt từ gian hàng', async () => {
  // Arrange: dựng service với prisma mock tối thiểu cho placeOrder happy-path COD,
  // hoặc — nếu khó dựng nguyên placeOrder — test ở mức hàm dựng data order.
  // Kỳ vọng: data truyền vào order.create chứa storefrontSlug: 'linh-shop'.
});
```

> **Lưu ý cho người thực thi:** `placeOrder` lớn (stock/points/wallet/coupon trong transaction). Nếu dựng full mock quá nặng, hãy **trích logic gán attribution ra một điểm test được**: ví dụ giữ nguyên placeOrder nhưng thêm test kiểm tra rằng khi gọi `placeOrder` với mock transaction, `tx.order.create` nhận `storefrontSlug`. Tham khảo cách spec checkout hiện có (nếu có) mock `$transaction`. Nếu thực sự không có spec hạ tầng, chấp nhận test ở tầng nhỏ hơn (một helper `buildOrderData`) — nhưng KHÔNG đổi hành vi.

- [ ] **Step 3: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=checkout.service`
Expected: FAIL (storefrontSlug chưa được set).

- [ ] **Step 4: Set trong placeOrder** — tại `checkout.service.ts`, trong `tx.order.create({ data: { ... } })` (khoảng dòng 110-138), thêm:

```typescript
        storefrontSlug: dto.storefrontSlug ?? null,
```
(cạnh `referrerUserId`).

- [ ] **Step 5: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=checkout.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/checkout
git commit -m "feat(storefront): checkout nhận+lưu storefrontSlug (TDD)"
```

---

## Task 3: Affiliate analytics — per-storefront + per-product (TDD)

**Files:** Modify `apps/api/src/modules/affiliate/affiliate.service.ts` + `.spec.ts` + `affiliate.controller.ts`.

Hai method query-based (dùng dữ liệu sẵn có — KHÔNG cần wire click→order):
- `storefrontAnalytics(userId)`: với các storefront slug của tôi, tổng `count đơn`, `doanh số` (sum Order.total) và `hoa hồng` (sum Commission.amount) của đơn có `Order.storefrontSlug ∈ {slugs của tôi}` và `referrerUserId = userId`.
- `productCommissionBreakdown(userId)`: lấy Commission của tôi (status != REJECTED) → join Order.items → nhóm theo productName → tính hoa hồng phân bổ theo `item.total × variation.affiliateRate%`. (Đơn giản hoá: nhóm theo `OrderItem.productName` + cộng `floor(item.total × rate/100)`.)

- [ ] **Step 1: Thêm test**

```typescript
describe('AffiliateService analytics', () => {
  it('storefrontAnalytics gom theo gian hàng của tôi', async () => {
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { total: 900000 } }) },
      commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 72000 } }) },
    } as unknown as PrismaService;
    const config = { get: jest.fn() } as unknown as SystemConfigService;
    const svc = new AffiliateService(prisma, config);
    const r = await svc.storefrontAnalytics('u1');
    expect(r.storefronts[0]).toMatchObject({ slug: 'linh', orders: 3, revenue: 900000, commission: 72000 });
  });

  it('productCommissionBreakdown nhóm theo sản phẩm', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', order: { items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Xà phòng', variationId: 'v2', total: 50000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' }, { id: 'v2', affiliateRate: '8' },
      ]) },
    } as unknown as PrismaService;
    const config = { get: jest.fn() } as unknown as SystemConfigService;
    const svc = new AffiliateService(prisma, config);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.commission).toBe(10000); // floor(100000*10/100)
    expect(r.find((x) => x.productName === 'Xà phòng')?.commission).toBe(4000);
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && npm run test -- --testPathPattern=affiliate.service`
Expected: FAIL (method chưa có).

- [ ] **Step 3: Thêm methods** (vào `AffiliateService`)

```typescript
  /** Thống kê theo từng gian hàng của CTV (đơn có storefrontSlug thuộc tôi + referrer là tôi). */
  async storefrontAnalytics(userId: string) {
    const myStores = await this.prisma.storefront.findMany({
      where: { ownerUserId: userId }, select: { slug: true, title: true },
    });
    const out = [] as Array<{ slug: string; title?: string; orders: number; revenue: number; commission: number }>;
    for (const s of myStores) {
      const [orderAgg, commAgg] = await Promise.all([
        this.prisma.order.aggregate({
          where: { storefrontSlug: s.slug, referrerUserId: userId },
          _count: { _all: true }, _sum: { total: true },
        }),
        this.prisma.commission.aggregate({
          where: { affiliateUserId: userId, order: { storefrontSlug: s.slug } },
          _sum: { amount: true },
        }),
      ]);
      out.push({
        slug: s.slug, title: (s as { title?: string }).title,
        orders: orderAgg._count._all, revenue: orderAgg._sum.total ?? 0,
        commission: commAgg._sum.amount ?? 0,
      });
    }
    return { storefronts: out };
  }

  /** Phân rã hoa hồng theo sản phẩm (join Commission→Order.items, tính theo affiliateRate). */
  async productCommissionBreakdown(userId: string) {
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateUserId: userId, status: { not: 'REJECTED' } },
      include: { order: { include: { items: true } } },
      take: 500,
    });
    const variationIds = [
      ...new Set(commissions.flatMap((c) => c.order?.items.map((i) => i.variationId) ?? [])),
    ];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } }, select: { id: true, affiliateRate: true },
    });
    const rate = new Map(variations.map((v) => [v.id, v.affiliateRate ? Number(v.affiliateRate) : 0]));
    const acc = new Map<string, { productName: string; commission: number; orders: number }>();
    for (const c of commissions) {
      for (const it of c.order?.items ?? []) {
        const r = rate.get(it.variationId) ?? 0;
        if (r <= 0) continue;
        const amount = Math.floor((it.total * r) / 100);
        const cur = acc.get(it.productName) ?? { productName: it.productName, commission: 0, orders: 0 };
        cur.commission += amount; cur.orders += 1;
        acc.set(it.productName, cur);
      }
    }
    return [...acc.values()].sort((a, b) => b.commission - a.commission);
  }
```

> **Lưu ý:** `Commission` cần quan hệ `order` để `include: { order: ... }`. Nếu schema chưa có relation `Commission.order`, thêm `order Order @relation(fields:[orderId],references:[id])` + back-relation `Order.commissions Commission[]` (kiểm tra: Lớp 1/cũ có thể đã có). Nếu thêm → cần migration FK (ADD CONSTRAINT, additive) + generate. Nếu `Commission.orderId` đã có cột nhưng chưa có relation, chỉ thêm relation annotation (no SQL change) + generate.

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && npm run test -- --testPathPattern=affiliate.service`
Expected: PASS.

- [ ] **Step 5: Expose endpoints** — `affiliate.controller.ts`:

```typescript
  @Get('analytics/storefronts')
  storefrontAnalytics(@CurrentUser('sub') userId: string) {
    return this.affiliate.storefrontAnalytics(userId);
  }

  @Get('analytics/products')
  productBreakdown(@CurrentUser('sub') userId: string) {
    return this.affiliate.productCommissionBreakdown(userId);
  }
```

- [ ] **Step 6: tsc + build + commit**

Run: `cd apps/api && npx tsc --noEmit && npm run build`
Expected: clean (DI ok).

```bash
git add apps/api/src/modules/affiliate
git commit -m "feat(storefront): affiliate analytics per-storefront + per-product (TDD)"
```

---

## Task 4: FE — zustand `storefront-context` store

**Files:** Create `apps/miniapp/src/store/storefront-context.ts`.

Lưu context khi vào qua link gian hàng: `{ slug, referralCode }`, persist sang `sessionStorage` để sống qua điều hướng/login.

- [ ] **Step 1: Viết store** (theo pattern `src/store/auth.ts`)

```typescript
import { create } from 'zustand';

const KEY = 'tubu_sf_ctx';
type Ctx = { slug: string | null; referralCode: string | null };

function load(): Ctx {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Ctx;
  } catch { /* ignore */ }
  return { slug: null, referralCode: null };
}

interface StorefrontCtxState extends Ctx {
  setContext: (ctx: Partial<Ctx>) => void;
  clear: () => void;
}

export const useStorefrontContext = create<StorefrontCtxState>((set, get) => ({
  ...load(),
  setContext: (ctx) => {
    const next = { slug: ctx.slug ?? get().slug, referralCode: ctx.referralCode ?? get().referralCode };
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set(next);
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ slug: null, referralCode: null });
  },
}));
```

- [ ] **Step 2: typecheck + commit**

Run: `cd apps/miniapp && npx tsc --noEmit`
```bash
git add apps/miniapp/src/store/storefront-context.ts
git commit -m "feat(storefront/fe): zustand storefront-context store (persist sessionStorage)"
```

---

## Task 5: FE — capture `?s=`/`?ref=` khi mở app + storefront-view set context

**Files:** Modify `apps/miniapp/src/components/app.tsx`; Modify `apps/miniapp/src/pages/storefront-view.tsx`.

- [ ] **Step 1: Helper parse query (search + hash)** — trong `app.tsx`, thêm 1 effect chạy 1 lần khi mount (sau khi router sẵn sàng), đọc `?s=`/`?ref=` từ cả `window.location.search` và phần hash (ZMP hash router). Dùng pattern có sẵn (`getLaunchReferral` parse ref). Code:

```tsx
import { useStorefrontContext } from '../store/storefront-context';
// ... trong component App, thêm:
const setSfContext = useStorefrontContext((s) => s.setContext);
useEffect(() => {
  const parse = (qs: string) => new URLSearchParams(qs);
  const search = parse(window.location.search);
  const hash = window.location.hash.includes('?')
    ? parse(window.location.hash.slice(window.location.hash.indexOf('?') + 1))
    : new URLSearchParams();
  const slug = search.get('s') ?? hash.get('s');
  const ref = search.get('ref') ?? hash.get('ref');
  if (slug || ref) setSfContext({ slug: slug ?? null, referralCode: ref ?? null });
}, [setSfContext]);
```

- [ ] **Step 2: storefront-view set context khi mở trực tiếp** — trong `storefront-view.tsx`, sau khi load `sf`, set context (slug + nếu là CTV storefront thì referralCode = slug, vì Lớp 1 CTV slug = referralCode):

```tsx
import { useStorefrontContext } from '../store/storefront-context';
// trong component, sau khi có sf:
const setSfContext = useStorefrontContext((s) => s.setContext);
useEffect(() => {
  if (sf) setSfContext({ slug: sf.slug, referralCode: sf.type === 'CTV' ? sf.slug : null });
}, [sf, setSfContext]);
```

- [ ] **Step 3: typecheck + commit**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run lint`
```bash
git add apps/miniapp/src/components/app.tsx apps/miniapp/src/pages/storefront-view.tsx
git commit -m "feat(storefront/fe): capture ?s/?ref vào storefront-context"
```

---

## Task 6: FE — gửi `referralCode` + `storefrontSlug` khi đặt đơn

**Files:** Modify `apps/miniapp/src/services/shop-api.ts`; Modify `apps/miniapp/src/pages/checkout.tsx`.

- [ ] **Step 1: Mở rộng placeOrder interface + hàm** — trong `shop-api.ts`, tìm interface `PlaceOrderInput` (hoặc tham số của `placeOrder`) và thêm 2 field optional `referralCode?: string; storefrontSlug?: string;`; truyền xuống body POST `/checkout/place-order`. (Giữ `Idempotency-Key` header như cũ.)

```typescript
// trong type body của placeOrder:
  referralCode?: string;
  storefrontSlug?: string;
// đảm bảo object gửi đi spread đủ 2 field này
```

- [ ] **Step 2: checkout.tsx đính context** — đọc context và truyền vào mutation placeOrder:

```tsx
import { useStorefrontContext } from '../store/storefront-context';
// trong component checkout:
const sfCtx = useStorefrontContext();
// nơi gọi placeOrder(...): thêm
//   referralCode: sfCtx.referralCode ?? undefined,
//   storefrontSlug: sfCtx.slug ?? undefined,
```

- [ ] **Step 3: typecheck + lint + commit**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run lint`
```bash
git add apps/miniapp/src/services/shop-api.ts apps/miniapp/src/pages/checkout.tsx
git commit -m "feat(storefront/fe): gửi referralCode + storefrontSlug khi đặt đơn"
```

---

## Task 7: FE — store-context navigation (back + sau-mua + bar "Về Tubu")

**Files:** Create `apps/miniapp/src/components/storefront-context-bar.tsx`; Modify `apps/miniapp/src/components/checkout/order-success.tsx`, `apps/miniapp/src/components/back-button.tsx`, `apps/miniapp/src/i18n/vi.ts`.

- [ ] **Step 1: Context bar** — banner mảnh hiển thị khi có context, có nút "Về Tubu Tree" (clear context + về `/`):

```tsx
import { Box, Text, useNavigate } from 'zmp-ui';
import { useStorefrontContext } from '../store/storefront-context';
import { vi } from '../i18n/vi';

export function StorefrontContextBar() {
  const navigate = useNavigate();
  const { slug, clear } = useStorefrontContext();
  if (!slug) return null;
  return (
    <Box flex alignItems="center" justifyContent="space-between"
      style={{ padding: '8px 14px', background: 'var(--neutral-0)', boxShadow: 'var(--shadow-xs)' }}>
      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>🏪 {vi.storefront.inStore}</Text>
      <Text size="xSmall" bold className="tubu-press" style={{ color: 'var(--primary-700)' }}
        onClick={() => { clear(); navigate('/'); }}>
        {vi.storefront.backToTubu}
      </Text>
    </Box>
  );
}
```
Thêm copy `vi.storefront.inStore = 'Đang xem cửa hàng'`, `vi.storefront.backToTubu = '⤺ Về Tubu Tree'`.

- [ ] **Step 2: order-success về gian hàng khi có context** — trong `order-success.tsx`, nút "Tiếp tục mua sắm" (onContinue → `/`) đổi thành: nếu có `useStorefrontContext().slug` → `navigate('/s/'+slug)`, ngược lại `/`.

```tsx
import { useStorefrontContext } from '../../store/storefront-context';
// trong component:
const sfSlug = useStorefrontContext((s) => s.slug);
// onContinue:
//   () => navigate(sfSlug ? `/s/${sfSlug}` : '/')
```

- [ ] **Step 3: back-button fallback về gian hàng** — trong `back-button.tsx`, nhánh fallback (khi `history.state.idx` không > 0) hiện `navigate('/')`; đổi: nếu có context slug → `navigate('/s/'+slug)` else `/`.

```tsx
import { useStorefrontContext } from '../store/storefront-context';
// const sfSlug = useStorefrontContext((s) => s.slug);
// fallback: navigate(sfSlug ? `/s/${sfSlug}` : '/')
```

- [ ] **Step 4: Gắn context bar** — render `<StorefrontContextBar />` ở đầu các trang trong luồng mua (vd `product-detail.tsx`, `cart.tsx`, `checkout.tsx`) — đặt ngay dưới đỉnh Page. (Tối thiểu: product-detail + cart.)

- [ ] **Step 5: typecheck + lint + build + commit**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run lint && npm run build`
```bash
git add apps/miniapp/src
git commit -m "feat(storefront/fe): store-context nav — back/sau-mua về gian hàng + bar Về Tubu"
```

---

## Task 8: FE — Share-kit (QR + caption presets)

**Files:** Modify `apps/miniapp/package.json` (add deps); Create `apps/miniapp/src/components/qr-code.tsx`, `apps/miniapp/src/components/share-sheet.tsx`; Modify `apps/miniapp/src/pages/storefront-view.tsx`, `apps/miniapp/src/i18n/vi.ts`.

- [ ] **Step 1: Cài qrcode**

Run: `cd d:/tubutree-mini-app && pnpm --filter @tubutree/miniapp add qrcode && pnpm --filter @tubutree/miniapp add -D @types/qrcode`
Expected: thêm vào apps/miniapp/package.json.

- [ ] **Step 2: QR component** — sinh data URL bằng `qrcode`:

```tsx
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#1a1a17', light: '#ffffff' } })
      .then(setUrl).catch(() => setUrl(''));
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size, background: 'var(--neutral-100)', borderRadius: 12 }} />;
  return <img src={url} alt="QR" width={size} height={size} style={{ borderRadius: 12 }} />;
}
```

- [ ] **Step 3: Share sheet** — caption presets (chạm copy) + QR + nút share Zalo (`shareLink`). Link base = `VITE_WEB_BASE_URL` + `/s/{slug}?ref={ref}`:

```tsx
import { Box, Text, Button, Sheet, useSnackbar } from 'zmp-ui';
import { QrCode } from './qr-code';
import { shareLink } from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

export function ShareSheet({ visible, onClose, slug, title, referralCode, thumbnail }:
  { visible: boolean; onClose: () => void; slug: string; title: string; referralCode?: string | null; thumbnail?: string }) {
  const { openSnackbar } = useSnackbar();
  const base = (import.meta.env.VITE_WEB_BASE_URL as string | undefined) ?? 'https://shop.tubutree.com';
  const url = `${base}/s/${slug}${referralCode ? `?ref=${referralCode}` : ''}`;
  const captions = [
    `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${url}`,
    `Gian hàng sống xanh của mình đây 💚 ${url}`,
    `Đồ thiên nhiên lành cho da & nhẹ với đất 🌱 ${url}`,
  ];
  const copy = (t: string) => { if (navigator.clipboard) { void navigator.clipboard.writeText(t); openSnackbar({ text: vi.storefront.copied, type: 'success' }); } };
  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text bold size="large" style={{ marginBottom: 12 }}>{vi.storefront.shareTitle}</Text>
        <Box flex justifyContent="center" mb={3}><QrCode value={url} /></Box>
        <Button fullWidth style={{ background: 'var(--primary-600)', marginBottom: 8 }}
          onClick={() => { haptic('light'); void shareLink({ title, description: captions[0], thumbnail, path: `/s/${slug}` }).catch(() => {}); }}>
          ↗ {vi.storefront.shareZalo}
        </Button>
        <Button fullWidth variant="secondary" style={{ marginBottom: 12 }} onClick={() => copy(url)}>📋 {vi.storefront.copyLink}</Button>
        <Text size="xSmall" bold style={{ marginBottom: 6 }}>{vi.storefront.captionHint}</Text>
        {captions.map((c, i) => (
          <Box key={i} className="tubu-press" onClick={() => copy(c)} p={2}
            style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{c}</Text>
          </Box>
        ))}
      </Box>
    </Sheet>
  );
}
```
Thêm copy: `vi.storefront.shareTitle='Chia sẻ gian hàng'`, `shareZalo='Chia sẻ qua Zalo'`, `copyLink='Sao chép link'`, `captionHint='Caption gợi ý (chạm để sao chép)'`, `copied='Đã sao chép'`.

- [ ] **Step 4: Dùng trong storefront-view** — thay nút "Chia sẻ gian hàng" hiện tại bằng mở `ShareSheet` (state `useState`); truyền `slug`, `title`, `referralCode = sf.type==='CTV' ? sf.slug : null`, `thumbnail` = ảnh SP đầu tiên nếu có.

- [ ] **Step 5: typecheck + lint + build + commit**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run lint && npm run build`
```bash
git add apps/miniapp/package.json apps/miniapp/src ../../pnpm-lock.yaml
git commit -m "feat(storefront/fe): share-kit (QR + caption presets + share Zalo)"
```

---

## Task 9: Web — trang public `/s/[slug]` + OG

**Files:** Modify `apps/web/src/lib/api.ts`; Create `apps/web/src/app/s/[slug]/page.tsx`.

- [ ] **Step 1: API fetch** — trong `apps/web/src/lib/api.ts`, thêm (theo pattern `getProduct`):

```typescript
export async function getStorefront(slug: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/storefront/public/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
```

- [ ] **Step 2: Trang SSR + generateMetadata** — `apps/web/src/app/s/[slug]/page.tsx` (theo pattern `san-pham/[slug]/page.tsx`):

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStorefront } from '@/lib/api';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) return { title: 'Gian hàng — Tubu Tree' };
  const firstImg = sf.collections?.[0]?.items?.[0]?.product?.thumbnail ?? sf.coverUrl ?? undefined;
  const title = `${sf.title} — Tubu Tree`;
  const description = sf.headerNote ?? 'Gian hàng sống xanh tuyển chọn trên Tubu Tree';
  return {
    title, description,
    openGraph: { title, description, images: firstImg ? [firstImg] : [], type: 'website' },
  };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">{sf.title}</h1>
      {sf.headerNote && <p className="text-neutral-600 mt-1">{sf.headerNote}</p>}
      {sf.collections?.map((c: { id: string; title: string; items: Array<{ id: string; product: { name: string; slug: string; thumbnail?: string; basePrice: number; salePrice?: number } }> }) => (
        <section key={c.id} className="mt-6">
          <h2 className="font-semibold mb-3">{c.title}</h2>
          <div className="grid grid-cols-2 gap-3">
            {c.items.map((it) => (
              <a key={it.id} href={`/san-pham/${it.product.slug}`} className="block rounded-2xl bg-white shadow-sm overflow-hidden">
                {it.product.thumbnail && <img src={it.product.thumbnail} alt={it.product.name} className="aspect-square w-full object-cover" loading="lazy" />}
                <div className="p-2">
                  <p className="text-sm line-clamp-2">{it.product.name}</p>
                  <p className="font-bold text-[#b86a10]">{(it.product.salePrice ?? it.product.basePrice).toLocaleString('vi-VN')}đ</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
```

> Khớp Tailwind theme web (màu `#b86a10` = primary-700; kiểm tra `tailwind.config.ts` nếu có alias màu thì dùng class tương ứng). `line-clamp-2` cần plugin/`@tailwindcss/line-clamp` (Tailwind ≥3.3 có sẵn) — nếu lint/build báo thiếu, bỏ class đó.

- [ ] **Step 3: build + commit**

Run: `cd apps/web && npm run build`
Expected: build OK, route `/s/[slug]` xuất hiện.
```bash
git add apps/web/src
git commit -m "feat(storefront/web): trang public /s/[slug] + OG metadata (unfurl khi share)"
```

---

## Task 10: FE — Dashboard per-storefront + per-product

**Files:** Modify `apps/miniapp/src/services/affiliate-api.ts`, `apps/miniapp/src/pages/affiliate.tsx`, `apps/miniapp/src/i18n/vi.ts`.

- [ ] **Step 1: Service** — thêm vào `affiliate-api.ts`:

```typescript
export interface StorefrontStat { slug: string; title?: string; orders: number; revenue: number; commission: number; }
export interface ProductStat { productName: string; commission: number; orders: number; }
export const getStorefrontAnalytics = () => api.get('/affiliate/analytics/storefronts').then((r) => r.data as { storefronts: StorefrontStat[] });
export const getProductBreakdown = () => api.get('/affiliate/analytics/products').then((r) => r.data as ProductStat[]);
```

- [ ] **Step 2: UI** — trong `affiliate.tsx` Dashboard, thêm 2 Section (dùng `Section` component có sẵn): "Theo gian hàng" (list slug · đơn · doanh số · hoa hồng) và "Theo sản phẩm" (top SP theo hoa hồng). Dùng `useQuery(['affiliate-sf-analytics'])` + `useQuery(['affiliate-product-breakdown'])`, `formatVnd`, `ErrorState` khi lỗi.

```tsx
// thêm import getStorefrontAnalytics, getProductBreakdown
const sfQ = useQuery({ queryKey: ['affiliate-sf-analytics'], queryFn: getStorefrontAnalytics });
const pbQ = useQuery({ queryKey: ['affiliate-product-breakdown'], queryFn: getProductBreakdown });
// render 2 Section: map sfQ.data?.storefronts và pbQ.data (top 10). Lỗi → ErrorState.
```

- [ ] **Step 3: typecheck + lint + build + commit**

Run: `cd apps/miniapp && npx tsc --noEmit && npm run lint && npm run build`
```bash
git add apps/miniapp/src
git commit -m "feat(storefront/fe): dashboard hoa hồng theo gian hàng + sản phẩm"
```

---

## Task 11: Verify toàn cục Lớp 2

- [ ] **Step 1: Backend test + tsc**

Run: `cd apps/api && npm run test -- --testPathPattern="affiliate.service|checkout.service|storefront" && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 2: Backend full jest (regression)**

Run: `cd apps/api && npm run test`
Expected: all pass (lưu ý 2 suite admin/checkout.dto đôi khi lỗi đọc-file I/O transient trên Windows → chạy lại `--testPathPattern="admin.service|checkout.dto"` để xác nhận pass).

- [ ] **Step 3: Boot + e2e attribution** (embedded PG 5544; Docker off — xem preamble; mint token DEV_ROLE=ADMIN)

Boot: `cd apps/api && DATABASE_URL="postgresql://postgres:postgres@localhost:5544/tubutree" PORT=3097 node dist/main.js &` (sau `npm run build`).
- Tạo gian hàng + publish (như Lớp 1), rồi đặt 1 đơn COD với body có `storefrontSlug` + `referralCode` của chính CTV đó (lưu ý ràng buộc referrer != buyer — dùng 2 user hoặc kiểm tra `GET /affiliate/analytics/storefronts` trả mảng storefronts của tôi với orders/revenue/commission ≥ 0 không lỗi).
- `curl GET /affiliate/analytics/storefronts` + `/affiliate/analytics/products` với Bearer → 200, cấu trúc đúng.
- Kill API.

- [ ] **Step 4: FE + Web build**

Run: `cd apps/miniapp && npm run build` ; `cd apps/web && npm run build`
Expected: cả hai sạch.

- [ ] **Step 5: Commit (nếu có sửa khi verify)**

```bash
git add -A && git commit -m "test(storefront): verify Lớp 2 — attribution + share + dashboard"
```

---

## Self-Review (đã chạy)

- **Spec coverage Lớp 2:** §7.3 store-context (Task 4–7) ✅ · attribution `Order.storefrontSlug` (Task 1–2) ✅ · §7.4 share-kit caption+QR+Zalo (Task 8) + web OG (Task 9) ✅ · §7.6 dashboard per-link/SP → làm per-storefront + per-product (Task 3,10) ✅ (per-shortCode-link cần click→order linking = ngoài phạm vi, đã ghi chú). **Combo §7.2 = plan Lớp 2B riêng.**
- **Placeholder scan:** không TBD; mỗi step có code/lệnh. Vài chỗ "kiểm tra/đối chiếu file thật" là chỉ dẫn thực thi có chủ đích (DTO import, Commission.order relation, tailwind màu) — không phải placeholder.
- **Type consistency:** `storefrontSlug` xuyên suốt Order↔checkout DTO↔FE placeOrder↔analytics. `storefrontAnalytics`/`productCommissionBreakdown` khớp service↔controller↔FE service (`StorefrontStat`/`ProductStat`). `useStorefrontContext` dùng nhất quán.
- **Điểm cần kiểm khi thực thi (chú thích inline):** (a) `Commission.order` relation tồn tại chưa (Task 3) — nếu thiếu thêm relation/FK additive; (b) `PlaceOrderInput` tên thật trong shop-api; (c) order-success/back-button cấu trúc thật; (d) `VITE_WEB_BASE_URL` đã có; (e) tailwind line-clamp/màu web; (f) checkout.service.spec hạ tầng mock (Task 2) — nếu nặng, test ở tầng nhỏ hơn nhưng không đổi hành vi.
- **Phụ thuộc thứ tự:** Task 1→2 (field trước khi set); 4→5→6→7 (store trước khi dùng); 3 trước 10 (endpoint trước UI). Task 8, 9 độc lập.
