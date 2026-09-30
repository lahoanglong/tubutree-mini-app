# Buy-flow 4a — Reorder rhythm, tab bar, order success — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "buy it again" a 2-tap action from every entry point (Home rail, Orders tab, order card, order detail, reorder reminder), replace the "Ví & HH" tab with an "Đơn hàng" tab that shows a live badge, and rebuild the order-success screen in Design System v2.

**Architecture:** The API gains three additive endpoints/behaviours in the orders module (`GET /orders/active-count`, `GET /me/purchased-items`, `POST /orders/:code/repurchase` v2 with per-line results) plus additive fields on order items (thumbnail/stock/availability joined by `variationId`), a `group` filter on `GET /orders`, `shippingEta` on `/config/public`, and a for-you ranking change. The miniapp gets one shared reorder flow (`ReorderSheet` + `useReorder` + typed events) used by every entry point, a single navigation config (`nav-config.ts`) read by `BottomNav`/`BackButton`, a shared `CartButton`/`useCartCount`, a rebuilt Orders root page, and a rebuilt `OrderSuccess`. Deploy order is API first, miniapp second; the miniapp degrades silently against the old API.

**Tech Stack:** NestJS 10 + Prisma 5.22 (Postgres) + class-validator, Jest (unit + `test/integration-race` on real Postgres); React 18 + zmp-ui 1.11 + TanStack Query 5 + lucide-react, Vitest + Testing Library; Playwright (`apps/e2e`, mocked API).

**Spec:** `docs/superpowers/specs/2026-09-30-buy-flow-redesign-design.md` — this plan covers **§3 (shared parts) and §4 (phase 4a) only**. Audit refs: `docs/audit-2026-09/02-purchase-funnel.md` (A2-04, A2-05, A2-45, A2-47), `docs/audit-2026-09/01-ia-navigation.md`. Carry-over debts: `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`.

## Plan Notes / Rulings

Places where the spec was ambiguous or would break something already in the code. Each ruling picks the most conservative option.

1. **Order tabs keep "Chờ thanh toán".** The spec lists Tất cả · Đang xử lý · Đang giao · Đã giao · Đã huỷ/hoàn · Định kỳ. `orders.tsx` already has a dedicated `PENDING_PAYMENT` tab added as a fix ("nhóm cần hành động gấp nhất"), and the audit's recommendation (A2-47) also lists it. Final tabs: Tất cả · Chờ thanh toán · Đang xử lý (CONFIRMED+PACKED) · Đang giao (SHIPPING) · Đã giao (DELIVERED) · Đã hủy/hoàn (CANCELLED+RETURNED) · Định kỳ. The two groups go through a new optional `group=processing|closed` query param; the single `status` param is unchanged and wins if both are sent. The label uses "hủy" (the app's existing spelling in `vi.ts`), not "huỷ".
2. **Repurchase v2 response is the cart at top level plus `results`**, i.e. `{ ...CartSummary, results }`, not `{ cart, results }`. Deploying the API first means old miniapp builds (still cached in Zalo) will call the new API and do `setQueryData(['cart'], response)`; a nested `cart` would render a broken cart for them. The miniapp normalizes the response into `{ cart, results, legacy }` in `shop-api.ts`.
3. **Repurchase error handling.** Business errors thrown by `CartService.addItem` for one line (400 stock race, 404 unavailable) become a `skipped` result and the loop continues. Infrastructure errors are re-thrown (honest 500; each `addItem` is its own transaction so the cart stays consistent). An `orderItemId` that is not in the order → 400 before any write. A line whose `Product.isActive=false` is skipped as `INACTIVE` (stricter than `addItem`, which only checks the variation).
4. **Home "Mua lại" always confirms in the sheet.** §3.3 says single-product reorder uses `cart.addItem` directly and opens the sheet "only when needed"; success criterion 1 says "chạm Mua lại → xác nhận trong sheet" (2 taps). Criterion 1 wins: tap "Mua lại" opens `ReorderSheet` (qty 1 preselected), tap "Thêm vào giỏ (1)" calls `cart.addItem` with `addSource`. No accidental adds.
5. **After a successful reorder:** `order_detail` and `order_card` (whole-order reorder) navigate to `/cart` (keeps today's order-detail behaviour and the pilot e2e); `home_rail`, `orders_tab` rail and `notification` stay on the page and show a snackbar with a "Xem giỏ" action (the spec's "không tự chuyển trang nếu mua lại từ Home").
6. **`GET /me/purchased-items` extras (all additive):** `brand` and `stock` fields (needed by `ProductTile` and to cap the quantity selector), and an optional `variationId` filter (used by the reminder lookup). `lastPurchasedAt` = order `createdAt` (same definition as `LifecycleService`). Inactive variations/products and non-APPROVED products are excluded; out-of-stock ones are returned with `inStock:false`. Cursor = base64url of `"<epoch ms>|<variationId>"`; ordering `lastPurchasedAt desc, variationId desc`; epoch comparison avoids session-timezone issues with `timestamp without time zone`.
7. **Order item media** (`thumbnail`, `stock`, `available`, `currentPrice`) is joined by `variationId` in `GET /orders` and `GET /orders/:code` only (new `detailView`). Internal `detail()` callers (`cancel`, `repurchase`, `requestReturn`, `track`) stay undecorated. No `OrderItem` column (spec §3.2).
8. **Reminder fallback order:** if `variation_id` is found in the user's purchased items **and in stock** → open `ReorderSheet`; else if `product_slug` exists → PDP (where 4c will add "Báo khi có hàng"); else → `/orders` (spec fallback, replacing today's `/`).
9. **ETA is `null` until the shop owner configures it.** `/config/public` returns `shippingEta: { minDays, maxDays } | null`; `null` when either `shipping.eta_min_days` / `shipping.eta_max_days` is missing or invalid. No seed defaults (seed runs on prod — we must not promise dates the owner has not set). The order-success line is hidden when `null` or when the API is old.
10. **"Đặt định kỳ" suggestion condition** = the PDP's condition (`product-detail.tsx:442`: selected variation exists and `stock > 0`), evaluated with `GET /products/:slug` (same `['product', slug]` query key as the PDP) for the first 3 distinct slugs of the order.
11. **`packages/shared-types` is not touched** (it is consumed from a built `dist/`). New types live in `apps/api/src/modules/orders/*` and `apps/miniapp/src/services/shop-api.ts`.
12. **`SegmentedTabs` min-height 40 → 44px** (hit-area rule). Its only consumer is `orders.tsx`.
13. **`useCartCount`/`CartButton` replace the cart query in Home and Browse headers.** The PDP's `['cart']` query also drives its bounce animation and layout; it moves in 4c.
14. **`/subscriptions` becomes a redirect** to `/orders?tab=subscriptions`; its content moves into `components/subscriptions-panel.tsx` and is migrated to DS v2 in the same move (behaviour kept). `pages/subscriptions.tsx` is deleted.
15. **"Thêm vào giỏ (n)": n = selected units** (sum of quantities), matching the cart badge meaning.
16. **Query keys:** active-order badge uses `['orders', 'active-count']` so every existing `invalidateQueries({ queryKey: ['orders'] })` (checkout, cancel) refreshes it; the orders list moves to `['orders', 'list', tabKey]`.
17. **Lint baseline.** Several legacy pages already fail `tubu-ds` lint today (verified: `profile.tsx`, `notifications.tsx`, `home.tsx`, `wallet.tsx`, `subscriptions.tsx` import zmp `Button` in `pages/` or use raw `rgba`). Tasks must not add new lint errors; files created or rewritten by this plan must be ESLint-clean. `notifications.tsx` keeps its other zmp CTAs and imports the DS button as `DsButton` for the reminder CTA only (spec: "cho loại này").
18. **E2E fixture fails on any unmocked call.** Each task that makes a page covered by an existing spec call a new endpoint also adds a default mock in `apps/e2e/tests/support/mock-api.ts` (`mockSession`) or `checkout-mocks.ts` in the same task.
19. **New miniapp vs old API (graceful degradation):** `purchased-items` 404 → rail hidden; `active-count` 404 → no badge; order items without `stock`/`available` → line treated as available with max 99 (server still clamps); old repurchase ignores the body and adds all lines (accepted until the API is deployed first).
20. **`back-button.tsx` raw `rgba` background is replaced by tokens** while the file is touched (it is a DS v2 lint error today).
21. **for-you:** the "purchased" set is still computed from the last 20 order items of any status (unchanged); only the `notIn` exclusion becomes "sort purchased products after unpurchased ones".
22. The Button follow-up "synchronous `useRef` lock" and the keyboard helper for clickable rows are **not** in scope (not requested); only the four listed debts are.

## Global Constraints

- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Write file content and commit messages in normal English or Vietnamese prose (no caveman style). UI copy is Vietnamese and goes through `apps/miniapp/src/i18n/vi.ts`.
- DS v2 rules for every new/rewritten miniapp file: use components in `apps/miniapp/src/components/ui/`; no raw colors (hex/rgb/rgba) in `style`; no legacy CSS vars `--neutral-*`, `--primary-*`, `--leaf-*`; every `IconButton` has `label`/`aria-label`; hit areas ≥ 44px; DS `Button` uses `onPress` (never `onClick`), never pass the pending flag as `disabled`.
- Every task adds or updates tests; tests fail first, then pass.
- Never run `git stash`, `git reset` or `git checkout` (other agents may share the tree). Deleting a file this plan replaces uses `git rm`.
- Deploy order: **API before miniapp**. Graceful degradation per Ruling 19 (`purchased-items` 404 → hide rail; missing `available` → treated as available).
- `pnpm lint:vars` (repo root) must stay `OK`.
- Commands (Git Bash; in PowerShell use `$env:E2E_SCOPE='miniapp';` instead of the `VAR=x` prefix):
  - Miniapp unit: `pnpm --filter @tubutree/miniapp exec vitest run <path>`
  - Miniapp types: `pnpm --filter @tubutree/miniapp exec tsc --noEmit`
  - Miniapp lint (new/rewritten files): `pnpm --filter @tubutree/miniapp exec eslint <files>`
  - API unit: `pnpm --filter @tubutree/api exec jest <pattern>`
  - API types: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json`
  - API real Postgres: `cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand <pattern>` (DB must be the throwaway `tubutree_it`; create it with `createdb tubutree_it && DATABASE_URL=... npx prisma migrate deploy` if missing) — `IT_DATABASE_URL` = the `DATABASE_URL` from `apps/api/.env` with only the database name replaced by `tubutree_it` (read it from that file; never print or commit credentials).
  - E2E: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test <file-pattern> --workers=1`
  - E2E types: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json`
- Verify UI at **375px and 320px** (Tasks 24–25 capture screenshots).
- Deploy notes for the runbook: no migration in 4a; new optional SystemConfig keys `shipping.eta_min_days`, `shipping.eta_max_days` (integers, set by the owner in admin config); API first, then miniapp.

## Review Focus

- **An old miniapp build calling the new `POST /orders/:code/repurchase` with no body** must still receive a cart-shaped response (`items`, `subtotal`, `itemCount` at top level) — Task 3 pins it.
- **`GET /orders/active-count` swallowed by `GET /orders/:code`** (Express matches in declaration order) would return "Không tìm thấy đơn hàng" and the badge would silently stay 0 — Task 1 pins declaration order; Task 5/23 exercise the real route.
- **Reordering while the cart already holds the same variation near its stock** must clamp or skip that one line and still add the others (today it throws mid-loop after partial adds) — Task 3 (unit) and Task 5 (real Postgres).
- **Guest / new customer / old API (404) on Home** must show no rail and never an ErrorState above the fold — Task 15.
- **Double tap on "Thêm vào giỏ (n)"** must send exactly one request — Task 14.

## File Map

API (`apps/api/src/modules/...`)
- `orders/order-status-groups.ts` (new) — `ACTIVE_ORDER_STATUSES`, `ORDER_STATUS_GROUPS`, `OrderStatusGroup`.
- `orders/dto/orders.dto.ts` (new) — `OrderListQuery` (moved + `group`), `RepurchaseDto`, `RepurchaseItemDto`, `PurchasedItemsQuery`.
- `orders/orders.service.ts` — `list` filter, `activeCount`, `detailView`, item media, `repurchase` v2.
- `orders/orders.controller.ts` — `active-count` route (before `:code`), repurchase body, `detailView`.
- `orders/purchased-items.service.ts`, `orders/purchased-items.controller.ts` (new) — `GET /me/purchased-items`.
- `orders/orders.module.ts` — register the new service/controller.
- `catalog/catalog.service.ts` — for-you ranking.
- `system-config/shipping-eta.ts` (new), `system-config/system-config.controller.ts` — `shippingEta`.
- `apps/api/test/integration-race/buy-flow-4a.race-spec.ts` (new).

Miniapp (`apps/miniapp/src/...`)
- `services/shop-api.ts` — types + calls; `services/buy-flow-events.ts` (new).
- `hooks/use-public-config.ts`, `hooks/use-cart-count.ts` (new), `hooks/use-active-order-count.ts` (new), `hooks/use-purchased-items.ts` (new), `hooks/use-reorder.ts` (new).
- `components/nav-config.ts` (new), `components/bottom-nav.tsx`, `components/back-button.tsx`, `components/app.tsx`, `components/cart-button.tsx` (new), `components/ui/cart-badge.tsx`.
- `components/reorder/` (new): `reorder-types.ts`, `reorder-summary.ts`, `reorder-sheet.tsx`, `purchased-rail.tsx`, `reorder-reminder.ts`.
- `components/orders/` (new): `orders-tabs.ts`, `order-card.tsx`; `components/subscriptions-panel.tsx` (new).
- `components/ui/product-tile.tsx`, `components/ui/segmented-tabs.tsx`, `components/ui/button.tsx`, `css/tokens.css`.
- `components/checkout/order-success.tsx`; `utils/order-status.ts`, `utils/shipping-eta.ts` (new).
- Pages: `home.tsx`, `browse.tsx`, `orders.tsx`, `order-detail.tsx`, `notifications.tsx`, `profile.tsx`; `pages/subscriptions.tsx` (deleted).
- `i18n/vi.ts` — `nav`, `reorder`, `orders`, `subscriptions`, `success` blocks.
- `scripts/check-undefined-css-vars.mjs` (repo root).

E2E (`apps/e2e/tests/...`)
- `support/mock-api.ts` (defaults in `mockSession`), `support/checkout-mocks.ts`, `support/buy-flow-mocks.ts` (new), `buy-flow-4a.miniapp.spec.ts` (new), `design-system-pilot.miniapp.spec.ts` (order-detail test updated).

---

## Task 1: API — order status groups, `group` filter, `GET /orders/active-count`

**Files:**
- Create: `apps/api/src/modules/orders/order-status-groups.ts`
- Create: `apps/api/src/modules/orders/dto/orders.dto.ts`
- Create: `apps/api/src/modules/orders/dto/orders.dto.spec.ts`
- Create: `apps/api/src/modules/orders/orders.controller.spec.ts`
- Modify: `apps/api/src/modules/orders/orders.controller.ts` (remove inline `OrderListQuery` lines 8-12, add `activeCount` before `detail`)
- Modify: `apps/api/src/modules/orders/orders.service.ts:34-46` (`list`) + new `activeCount`
- Test: `apps/api/src/modules/orders/orders.service.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const ACTIVE_ORDER_STATUSES: readonly ['PENDING_PAYMENT','CONFIRMED','PACKED','SHIPPING']`
  - `export const ORDER_STATUS_GROUPS: { processing: readonly ['CONFIRMED','PACKED']; closed: readonly ['CANCELLED','RETURNED'] }`
  - `export type OrderStatusGroup = 'processing' | 'closed'`; `export const ORDER_STATUS_GROUP_KEYS: OrderStatusGroup[]`
  - `export interface OrderListFilter { status?: OrderStatus; group?: OrderStatusGroup }` (in `orders.service.ts`)
  - `OrdersService.list(userId: string, filter: OrderListFilter, page: number, limit: number)`
  - `OrdersService.activeCount(userId: string): Promise<{ count: number }>`
  - HTTP: `GET /orders?group=processing|closed` (optional), `GET /orders/active-count → { count: number }`
  - `export class OrderListQuery extends PaginationQuery { status?: OrderStatus; group?: OrderStatusGroup }` (in `dto/orders.dto.ts`)

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/orders/dto/orders.dto.spec.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { OrderListQuery } from './orders.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asQuery = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });

describe('OrderListQuery', () => {
  it('nhận group=processing và group=closed', async () => {
    await expect(asQuery(OrderListQuery, { group: 'processing' })).resolves.toMatchObject({ group: 'processing' });
    await expect(asQuery(OrderListQuery, { group: 'closed' })).resolves.toMatchObject({ group: 'closed' });
  });

  it('từ chối group lạ', async () => {
    await expect(asQuery(OrderListQuery, { group: 'everything' })).rejects.toThrow();
  });

  it('status đơn lẻ vẫn nhận như cũ; page/limit ép sang số', async () => {
    await expect(asQuery(OrderListQuery, { status: 'PACKED', page: '2', limit: '5' })).resolves.toMatchObject({
      status: 'PACKED',
      page: 2,
      limit: 5,
    });
  });
});
```

`apps/api/src/modules/orders/orders.controller.spec.ts`:

```ts
import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

describe('OrdersController', () => {
  it('khai báo GET active-count TRƯỚC GET :code — Express khớp theo thứ tự khai báo, nếu sau thì "active-count" bị hiểu là mã đơn → 404', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods).toContain('activeCount');
    expect(methods.indexOf('activeCount')).toBeLessThan(methods.indexOf('detail'));
    expect(Reflect.getMetadata('path', OrdersController.prototype.activeCount)).toBe('active-count');
  });

  it('list chuyển status + group xuống service', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const ctrl = new OrdersController({ list } as unknown as OrdersService);
    await ctrl.list('u1', { group: 'processing', page: 1, limit: 20 } as never);
    expect(list).toHaveBeenCalledWith('u1', { status: undefined, group: 'processing' }, 1, 20);
  });

  it('activeCount trả { count } của service', async () => {
    const activeCount = jest.fn().mockResolvedValue({ count: 3 });
    const ctrl = new OrdersController({ activeCount } as unknown as OrdersService);
    await expect(ctrl.activeCount('u1')).resolves.toEqual({ count: 3 });
    expect(activeCount).toHaveBeenCalledWith('u1');
  });
});
```

Append to `apps/api/src/modules/orders/orders.service.spec.ts`:

```ts
describe('OrdersService.list / activeCount — nhóm trạng thái (tab Đơn hàng)', () => {
  function makeListService() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      order: { findMany, count },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), findMany, count };
  }

  it('group=processing → CONFIRMED + PACKED', async () => {
    const { svc, findMany, count } = makeListService();
    await svc.list('u1', { group: 'processing' }, 1, 20);
    const where = { userId: 'u1', status: { in: ['CONFIRMED', 'PACKED'] } };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('group=closed → CANCELLED + RETURNED (trước đây RETURNED chỉ thấy ở "Tất cả" — A2-47)', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', { group: 'closed' }, 1, 20);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: { in: ['CANCELLED', 'RETURNED'] } } }),
    );
  });

  it('status đơn lẻ thắng group; phân trang giữ nguyên', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', { status: 'SHIPPING', group: 'closed' }, 2, 10);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'SHIPPING' }, skip: 10, take: 10 }),
    );
  });

  it('không lọc → chỉ theo userId', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', {}, 1, 20);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('activeCount đếm 4 trạng thái đang xử lý của chính user', async () => {
    const { svc, count } = makeListService();
    count.mockResolvedValue(2);
    await expect(svc.activeCount('u1')).resolves.toEqual({ count: 2 });
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] } },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tubutree/api exec jest orders.dto orders.controller orders.service`
Expected: FAIL — `Cannot find module './orders.dto'`, `activeCount` missing, `list` called with an object as `status`.

- [ ] **Step 3: Implement**

`apps/api/src/modules/orders/order-status-groups.ts`:

```ts
import type { OrderStatus } from '@tubutree/shared-types';

/** Đơn "đang xử lý" — badge tab Đơn hàng (spec 4a.1). */
export const ACTIVE_ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] as const satisfies readonly OrderStatus[];

/** Nhóm trạng thái cho tab gộp của trang Đơn hàng (spec 4a.2, A2-47). */
export const ORDER_STATUS_GROUPS = {
  processing: ['CONFIRMED', 'PACKED'],
  closed: ['CANCELLED', 'RETURNED'],
} as const satisfies Record<string, readonly OrderStatus[]>;

export type OrderStatusGroup = keyof typeof ORDER_STATUS_GROUPS;
export const ORDER_STATUS_GROUP_KEYS = Object.keys(ORDER_STATUS_GROUPS) as OrderStatusGroup[];
```

`apps/api/src/modules/orders/dto/orders.dto.ts`:

```ts
import { IsIn, IsOptional } from 'class-validator';
import type { OrderStatus } from '@tubutree/shared-types';
import { PaginationQuery } from '../../../common/pagination';
import { ORDER_STATUS_GROUP_KEYS, type OrderStatusGroup } from '../order-status-groups';

export class OrderListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status?: OrderStatus;

  /** Tab gộp nhiều trạng thái. `status` (nếu có) thắng `group`. */
  @IsOptional()
  @IsIn(ORDER_STATUS_GROUP_KEYS)
  group?: OrderStatusGroup;
}
```

In `apps/api/src/modules/orders/orders.controller.ts`: delete the inline `class OrderListQuery ... {}` (lines 8-12) and its now-unused `IsIn`/`PaginationQuery`/`OrderStatus` imports (keep `ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength` for `ReturnRequestDto`), add `import { OrderListQuery } from './dto/orders.dto';`, and replace the `list` + `detail` handlers with:

```ts
  @Get()
  list(@CurrentUser('sub') userId: string, @Query() query: OrderListQuery) {
    return this.orders.list(userId, { status: query.status, group: query.group }, query.page, query.limit);
  }

  // PHẢI đứng TRƯỚC @Get(':code'): Express khớp route theo thứ tự khai báo — đặt sau thì
  // "active-count" bị coi là mã đơn → 404 "Không tìm thấy đơn hàng", badge tab im lặng về 0.
  @Get('active-count')
  activeCount(@CurrentUser('sub') userId: string) {
    return this.orders.activeCount(userId);
  }

  @Get(':code')
  detail(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.detail(userId, code);
  }
```

In `apps/api/src/modules/orders/orders.service.ts` add the import and replace `list` (lines 34-46):

```ts
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_GROUPS, type OrderStatusGroup } from './order-status-groups';

export interface OrderListFilter {
  status?: OrderStatus;
  group?: OrderStatusGroup;
}

function statusWhere(filter: OrderListFilter): Prisma.OrderWhereInput {
  if (filter.status) return { status: filter.status };
  if (filter.group) return { status: { in: [...ORDER_STATUS_GROUPS[filter.group]] } };
  return {};
}
```

```ts
  async list(userId: string, filter: OrderListFilter, page: number, limit: number) {
    const where: Prisma.OrderWhereInput = { userId, ...statusWhere(filter) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  /** Số đơn đang xử lý — endpoint nhẹ cho badge tab Đơn hàng. */
  async activeCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.order.count({
      where: { userId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
    });
    return { count };
  }
```

(`OrderListFilter` and `statusWhere` go above the `@Injectable()` class.)

- [ ] **Step 4: Run the tests and types**

Run: `pnpm --filter @tubutree/api exec jest orders.dto orders.controller orders.service` → PASS.
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/orders/order-status-groups.ts apps/api/src/modules/orders/dto/orders.dto.ts apps/api/src/modules/orders/dto/orders.dto.spec.ts apps/api/src/modules/orders/orders.controller.ts apps/api/src/modules/orders/orders.controller.spec.ts apps/api/src/modules/orders/orders.service.ts apps/api/src/modules/orders/orders.service.spec.ts
git commit -m "feat(api): order status groups, group filter and GET /orders/active-count" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: API — order item media (thumbnail, stock, availability) joined by `variationId`

**Files:**
- Modify: `apps/api/src/modules/orders/orders.service.ts` (`list` return, new `detailView`, private `attachItemMedia`)
- Modify: `apps/api/src/modules/orders/orders.controller.ts` (`detail` → `detailView`)
- Test: `apps/api/src/modules/orders/orders.service.spec.ts`, `apps/api/src/modules/orders/orders.controller.spec.ts`

**Interfaces:**
- Consumes: `OrdersService.list(userId, filter, page, limit)` (Task 1).
- Produces:
  - `export interface OrderItemMedia { thumbnail: string | null; stock: number; available: boolean; currentPrice: number | null }`
  - `export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>`
  - `export type OrderItemView = OrderWithItems['items'][number] & OrderItemMedia`
  - `export type OrderView = Omit<OrderWithItems, 'items'> & { items: OrderItemView[] }`
  - `OrdersService.list(...)` now returns `PaginatedResult<OrderView>`; `OrdersService.detailView(userId: string, code: string): Promise<OrderView>`
  - HTTP: every item in `GET /orders` and `GET /orders/:code` gains `thumbnail`, `stock`, `available`, `currentPrice` (additive).
  - `available = variation.isActive && product.isActive && product.approvalStatus === 'APPROVED' && variation.stock > 0`; deleted variation → `{ thumbnail: null, stock: 0, available: false, currentPrice: null }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/modules/orders/orders.service.spec.ts`:

```ts
describe('OrdersService — ảnh + tồn kho từng dòng đơn (join theo variationId, không thêm cột)', () => {
  const line = (id: string, variationId: string, quantity = 1) => ({
    id, orderId: 'o1', variationId, productName: `SP ${id}`, productSlug: null, variationName: 'Mặc định',
    unitPrice: 50000, quantity, total: 50000 * quantity, flashSaleItemId: null, backorderedQty: 0,
  });
  const v = (id: string, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
    id, stock: 5, isActive: true, retailPrice: 60000, salePrice: null, ...over,
    product: { thumbnail: `https://img.test/${id}.jpg`, images: [], isActive: true, approvalStatus: 'APPROVED', ...product },
  });

  function makeMediaService(orders: Record<string, unknown>[], variations: Record<string, unknown>[]) {
    const variationFindMany = jest.fn().mockResolvedValue(variations);
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue(orders),
        count: jest.fn().mockResolvedValue(orders.length),
        findUnique: jest.fn().mockResolvedValue(orders[0] ?? null),
      },
      variation: { findMany: variationFindMany },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), variationFindMany };
  }

  it('list: MỘT truy vấn variation cho cả trang; mỗi dòng có thumbnail/stock/available/currentPrice', async () => {
    const orders = [
      { ...baseOrder, id: 'o1', code: 'A', items: [line('i1', 'v1'), line('i2', 'v2')] },
      { ...baseOrder, id: 'o2', code: 'B', items: [line('i3', 'v1')] },
    ];
    const { svc, variationFindMany } = makeMediaService(orders, [v('v1', { salePrice: 55000 }), v('v2', { stock: 0 })]);
    const res = await svc.list('u1', {}, 1, 20);
    expect(variationFindMany).toHaveBeenCalledTimes(1);
    expect(variationFindMany.mock.calls[0]![0].where).toEqual({ id: { in: ['v1', 'v2'] } });
    expect(res.data[0]!.items[0]).toMatchObject({ id: 'i1', thumbnail: 'https://img.test/v1.jpg', stock: 5, available: true, currentPrice: 55000 });
    expect(res.data[0]!.items[1]).toMatchObject({ id: 'i2', stock: 0, available: false, currentPrice: 60000 });
    expect(res.data[1]!.items[0]).toMatchObject({ id: 'i3', available: true });
  });

  it.each([
    ['variation tắt', { isActive: false }, {}],
    ['sản phẩm tắt', {}, { isActive: false }],
    ['sản phẩm chưa duyệt', {}, { approvalStatus: 'PENDING_REVIEW' }],
    ['sản phẩm bị từ chối', {}, { approvalStatus: 'REJECTED' }],
  ])('available=false khi %s', async (_label, vOver, pOver) => {
    const { svc } = makeMediaService([{ ...baseOrder, items: [line('i1', 'v1')] }], [v('v1', vOver, pOver)]);
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]!.available).toBe(false);
  });

  it('variation đã bị xoá → thumbnail null, stock 0, available false, currentPrice null', async () => {
    const { svc } = makeMediaService([{ ...baseOrder, items: [line('i1', 'gone')] }], []);
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]).toMatchObject({ thumbnail: null, stock: 0, available: false, currentPrice: null });
  });

  it('thumbnail rơi về images[0] khi product.thumbnail null', async () => {
    const { svc } = makeMediaService(
      [{ ...baseOrder, items: [line('i1', 'v1')] }],
      [v('v1', {}, { thumbnail: null, images: ['https://img.test/first.jpg'] })],
    );
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]!.thumbnail).toBe('https://img.test/first.jpg');
  });

  it('detailView: gắn media cho đơn của chính user; đơn không có dòng nào → không truy vấn variation', async () => {
    const withItems = makeMediaService([{ ...baseOrder, items: [line('i1', 'v1')] }], [v('v1')]);
    const view = await withItems.svc.detailView('u1', 'TUBU1');
    expect(view.items[0]).toMatchObject({ id: 'i1', available: true, stock: 5 });

    const empty = makeMediaService([{ ...baseOrder, items: [] }], []);
    await empty.svc.detailView('u1', 'TUBU1');
    expect(empty.variationFindMany).not.toHaveBeenCalled();
  });
});
```

Append to `apps/api/src/modules/orders/orders.controller.spec.ts` (inside the describe):

```ts
  it('GET :code dùng detailView (có ảnh/tồn kho), không phải detail thô', async () => {
    const detailView = jest.fn().mockResolvedValue({ code: 'A', items: [] });
    const ctrl = new OrdersController({ detailView } as unknown as OrdersService);
    await ctrl.detail('u1', 'A');
    expect(detailView).toHaveBeenCalledWith('u1', 'A');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/api exec jest orders.service orders.controller`
Expected: FAIL — items have no `thumbnail`/`available`; `detailView` is not a function.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/orders/orders.service.ts`, above the class:

```ts
export interface OrderItemMedia {
  thumbnail: string | null;
  stock: number;
  available: boolean;
  currentPrice: number | null;
}
export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
export type OrderItemView = OrderWithItems['items'][number] & OrderItemMedia;
export type OrderView = Omit<OrderWithItems, 'items'> & { items: OrderItemView[] };

const MISSING_MEDIA: OrderItemMedia = { thumbnail: null, stock: 0, available: false, currentPrice: null };
```

In `list`, replace `return paginated(items, page, limit, total);` with:

```ts
    return paginated(await this.attachItemMedia(items), page, limit, total);
```

Add after `detail`:

```ts
  /** Chi tiết đơn cho màn khách (GET /orders/:code) — kèm ảnh/tồn kho từng dòng. Các luồng nội bộ
   * (cancel/repurchase/requestReturn/track) vẫn dùng detail() thô, không tốn thêm truy vấn. */
  async detailView(userId: string, code: string): Promise<OrderView> {
    const order = await this.detail(userId, code);
    const [view] = await this.attachItemMedia([order]);
    return view!;
  }

  /** Ảnh + tồn kho + còn bán được của từng dòng, join theo variationId (OrderItem không có FK/ảnh —
   * spec §3.2 không thêm cột). Một truy vấn cho cả trang đơn. */
  private async attachItemMedia(orders: OrderWithItems[]): Promise<OrderView[]> {
    const ids = [...new Set(orders.flatMap((o) => o.items.map((it) => it.variationId)))];
    const variations = ids.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            stock: true,
            isActive: true,
            retailPrice: true,
            salePrice: true,
            product: { select: { thumbnail: true, images: true, isActive: true, approvalStatus: true } },
          },
        })
      : [];
    const byId = new Map(variations.map((v) => [v.id, v]));
    const media = (variationId: string): OrderItemMedia => {
      const v = byId.get(variationId);
      if (!v) return MISSING_MEDIA;
      return {
        thumbnail: v.product.thumbnail ?? v.product.images[0] ?? null,
        stock: v.stock,
        available: v.isActive && v.product.isActive && v.product.approvalStatus === 'APPROVED' && v.stock > 0,
        currentPrice: v.salePrice ?? v.retailPrice,
      };
    };
    return orders.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it, ...media(it.variationId) })) }));
  }
```

In `orders.controller.ts`, `detail` now returns `this.orders.detailView(userId, code);`.

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/api exec jest orders` → PASS (all orders specs, including the existing cancel/return suites).
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/orders/orders.service.ts apps/api/src/modules/orders/orders.service.spec.ts apps/api/src/modules/orders/orders.controller.ts apps/api/src/modules/orders/orders.controller.spec.ts
git commit -m "feat(api): order items carry thumbnail, stock and availability via variation join" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: API — `POST /orders/:code/repurchase` v2 (per-line results, approval check, addSource)

**Files:**
- Modify: `apps/api/src/modules/orders/dto/orders.dto.ts` (add `RepurchaseItemDto`, `RepurchaseDto`)
- Modify: `apps/api/src/modules/orders/orders.service.ts:139-151` (`repurchase`)
- Modify: `apps/api/src/modules/orders/orders.controller.ts` (`repurchase` handler takes `@Body()`)
- Test: `apps/api/src/modules/orders/dto/orders.dto.spec.ts`, `apps/api/src/modules/orders/orders.service.spec.ts`, `apps/api/src/modules/orders/orders.controller.spec.ts`

**Interfaces:**
- Consumes: `CartService.addItem(userId, dto: AddItemDto)` (throws `NotFoundException` when variation/approval invalid, `BadRequestException` when `existing + quantity > stock`), `CartService.getCart(userId)`; `OrdersService.detail` (existing).
- Produces:
  - `export type RepurchaseAddSource = 'repurchase' | 'reorder_notification'`
  - `export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK'`
  - `export interface RepurchaseLineResult { orderItemId: string; status: 'added' | 'partial' | 'skipped'; reason?: RepurchaseSkipReason; addedQuantity: number }`
  - `export interface RepurchaseInput { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource }`
  - `OrdersService.repurchase(userId: string, code: string, input?: RepurchaseInput): Promise<CartSummaryShape & { results: RepurchaseLineResult[] }>` where `CartSummaryShape = Awaited<ReturnType<CartService['getCart']>>`
  - HTTP body (optional): `{ items?: [{ orderItemId: string; quantity: 1..999 }] (1..100 entries), addSource?: 'repurchase' | 'reorder_notification' }`; response = cart fields at top level + `results` (Ruling 2).
  - Status rules per line, in order: variation missing / `variation.isActive=false` / `product.isActive=false` → `INACTIVE`; `approvalStatus !== 'APPROVED'` → `NOT_APPROVED`; `stock <= 0` → `OUT_OF_STOCK`; `stock - alreadyInCart <= 0` → `EXCEEDS_STOCK`; `want > room` → `partial` (`reason: 'EXCEEDS_STOCK'`, `addedQuantity = room`); else `added`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/modules/orders/dto/orders.dto.spec.ts` (and add `RepurchaseDto` to the import from `./orders.dto`):

```ts
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

describe('RepurchaseDto', () => {
  it('body rỗng hợp lệ (client cũ không gửi gì)', async () => {
    await expect(asBody(RepurchaseDto, {})).resolves.toBeDefined();
  });

  it('nhận items + addSource hợp lệ', async () => {
    await expect(
      asBody(RepurchaseDto, { items: [{ orderItemId: 'oi1', quantity: 2 }], addSource: 'reorder_notification' }),
    ).resolves.toMatchObject({ items: [{ orderItemId: 'oi1', quantity: 2 }], addSource: 'reorder_notification' });
  });

  it.each([
    ['items rỗng', { items: [] }],
    ['quantity 0', { items: [{ orderItemId: 'oi1', quantity: 0 }] }],
    ['quantity 1000', { items: [{ orderItemId: 'oi1', quantity: 1000 }] }],
    ['thiếu orderItemId', { items: [{ quantity: 1 }] }],
    ['addSource lạ', { addSource: 'pdp' }],
    ['field lạ', { foo: 1 }],
  ])('từ chối %s', async (_l, body) => {
    await expect(asBody(RepurchaseDto, body)).rejects.toThrow();
  });
});
```

Append to `apps/api/src/modules/orders/orders.service.spec.ts`:

```ts
describe('OrdersService.repurchase v2 — mỗi dòng xử lý độc lập (A2-05)', () => {
  const CART = { items: [{ id: 'ci1' }], couponCode: null, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 3 };
  const line = (id: string, variationId: string, quantity: number) => ({
    id, orderId: 'o1', variationId, productName: `SP ${id}`, productSlug: null, variationName: 'Mặc định',
    unitPrice: 50000, quantity, total: 50000 * quantity, flashSaleItemId: null, backorderedQty: 0,
  });
  const variation = (id: string, stock: number, over: { isActive?: boolean; productActive?: boolean; approval?: string } = {}) => ({
    id, stock, isActive: over.isActive ?? true,
    product: { isActive: over.productActive ?? true, approvalStatus: over.approval ?? 'APPROVED' },
  });

  function makeRepurchaseService(opts: {
    items: ReturnType<typeof line>[];
    variations: ReturnType<typeof variation>[];
    inCart?: { variationId: string; quantity: number }[];
    addItem?: jest.Mock;
  }) {
    const addItem = opts.addItem ?? jest.fn().mockResolvedValue(CART);
    const getCart = jest.fn().mockResolvedValue(CART);
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ ...baseOrder, status: 'DELIVERED', items: opts.items }) },
      variation: { findMany: jest.fn().mockResolvedValue(opts.variations) },
      cart: { findUnique: jest.fn().mockResolvedValue(opts.inCart ? { items: opts.inCart } : null) },
    } as unknown as PrismaService;
    const cartSvc = { addItem, getCart } as unknown as CartService;
    return { svc: new OrdersService(prisma, loyalty, cartSvc, notifications, config, affiliate, reversal), addItem, getCart };
  }

  it('không body (client cũ): thêm mọi dòng, addSource=repurchase; response VẪN là giỏ ở top-level + results', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v1', 10), variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).toHaveBeenNthCalledWith(1, 'u1', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
    expect(addItem).toHaveBeenNthCalledWith(2, 'u1', { variationId: 'v2', quantity: 1, addSource: 'repurchase' });
    expect(res).toMatchObject({ items: CART.items, subtotal: 150000, itemCount: 3 });
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'added', addedQuantity: 2 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
  });

  it('items: chỉ các dòng được chọn, số lượng theo client', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'i2', quantity: 4 }] });
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v2', quantity: 4, addSource: 'repurchase' });
    expect(res.results).toEqual([{ orderItemId: 'i2', status: 'added', addedQuantity: 4 }]);
  });

  it('orderItemId không thuộc đơn → 400 TRƯỚC mọi lần ghi', async () => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 10)] });
    await expect(svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'khac', quantity: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(addItem).not.toHaveBeenCalled();
  });

  it.each([
    ['variation tắt', variation('v1', 10, { isActive: false }), 'INACTIVE'],
    ['sản phẩm tắt', variation('v1', 10, { productActive: false }), 'INACTIVE'],
    ['sản phẩm chưa duyệt (trước đây thiếu kiểm này)', variation('v1', 10, { approval: 'REJECTED' }), 'NOT_APPROVED'],
    ['hết hàng', variation('v1', 0), 'OUT_OF_STOCK'],
  ])('%s → skipped, không gọi addItem', async (_l, v, reason) => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [v] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).not.toHaveBeenCalled();
    expect(res.results).toEqual([{ orderItemId: 'i1', status: 'skipped', reason, addedQuantity: 0 }]);
  });

  it('variation đã bị xoá → skipped INACTIVE', async () => {
    const { svc } = makeRepurchaseService({ items: [line('i1', 'gone', 1)], variations: [] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results[0]).toMatchObject({ status: 'skipped', reason: 'INACTIVE' });
  });

  it('giỏ đã giữ hết tồn → EXCEEDS_STOCK; dòng sau vẫn được thêm (trước đây addItem ném giữa vòng lặp)', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1)],
      variations: [variation('v1', 3), variation('v2', 5)],
      inCart: [{ variationId: 'v1', quantity: 3 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('muốn 5, còn chỗ 2 → partial, kẹp đúng 2', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 5)],
      variations: [variation('v1', 3)],
      inCart: [{ variationId: 'v1', quantity: 1 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
    expect(res.results).toEqual([{ orderItemId: 'i1', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 2 }]);
  });

  it('2 dòng cùng variation: dòng sau tính cả phần dòng trước vừa thêm', async () => {
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v1', 2)],
      variations: [variation('v1', 3)],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'added', addedQuantity: 2 },
      { orderItemId: 'i2', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 },
    ]);
  });

  it('addItem ném lỗi nghiệp vụ cho 1 dòng (race tồn kho / SP vừa bị ẩn) → dòng đó skipped, dòng khác vẫn chạy', async () => {
    const addItem = jest
      .fn()
      .mockRejectedValueOnce(new BadRequestException('Chỉ còn 0 sản phẩm trong kho.'))
      .mockRejectedValueOnce(new NotFoundException('Sản phẩm không khả dụng.'))
      .mockResolvedValue(CART);
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1), line('i3', 'v3', 1)],
      variations: [variation('v1', 5), variation('v2', 5), variation('v3', 5)],
      addItem,
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results.map((r) => [r.orderItemId, r.status, r.reason])).toEqual([
      ['i1', 'skipped', 'EXCEEDS_STOCK'],
      ['i2', 'skipped', 'INACTIVE'],
      ['i3', 'added', undefined],
    ]);
  });

  it('lỗi hạ tầng (không phải lỗi nghiệp vụ) → ném ra, không nuốt', async () => {
    const addItem = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { svc } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)], addItem });
    await expect(svc.repurchase('u1', 'TUBU1')).rejects.toThrow('connection reset');
  });

  it('addSource=reorder_notification được chuyển tới add_to_cart', async () => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)] });
    await svc.repurchase('u1', 'TUBU1', { addSource: 'reorder_notification' });
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v1', quantity: 1, addSource: 'reorder_notification' });
  });
});
```

Also add `NotFoundException` to the file's imports: `import { BadRequestException, NotFoundException } from '@nestjs/common';` at the top of `orders.service.spec.ts`.

Append to `apps/api/src/modules/orders/orders.controller.spec.ts`:

```ts
  it('repurchase chuyển items + addSource trong body; body thiếu → input rỗng', async () => {
    const repurchase = jest.fn().mockResolvedValue({ items: [], results: [] });
    const ctrl = new OrdersController({ repurchase } as unknown as OrdersService);
    await ctrl.repurchase('u1', 'A', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    expect(repurchase).toHaveBeenLastCalledWith('u1', 'A', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    await ctrl.repurchase('u1', 'A', undefined as never);
    expect(repurchase).toHaveBeenLastCalledWith('u1', 'A', { items: undefined, addSource: undefined });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/api exec jest orders`
Expected: FAIL — `RepurchaseDto` not exported; `res.results` undefined; `addItem` called without `addSource`.

- [ ] **Step 3: Implement**

Append to `apps/api/src/modules/orders/dto/orders.dto.ts` (extend the class-validator import to `ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested` and add `import { Type } from 'class-transformer';`):

```ts
export class RepurchaseItemDto {
  @IsString() @MaxLength(64) orderItemId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

/** Body tuỳ chọn — không gửi = mua lại toàn bộ dòng như bản cũ (tương thích ngược). */
export class RepurchaseDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RepurchaseItemDto)
  items?: RepurchaseItemDto[];

  @IsOptional()
  @IsIn(['repurchase', 'reorder_notification'])
  addSource?: 'repurchase' | 'reorder_notification';
}
```

In `orders.controller.ts` add `RepurchaseDto` to the `./dto/orders.dto` import and replace the handler:

```ts
  @Post(':code/repurchase')
  repurchase(@CurrentUser('sub') userId: string, @Param('code') code: string, @Body() dto: RepurchaseDto) {
    return this.orders.repurchase(userId, code, { items: dto?.items, addSource: dto?.addSource });
  }
```

In `orders.service.ts`, add above the class:

```ts
export type RepurchaseAddSource = 'repurchase' | 'reorder_notification';
export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK';
export interface RepurchaseLineResult {
  orderItemId: string;
  status: 'added' | 'partial' | 'skipped';
  reason?: RepurchaseSkipReason;
  addedQuantity: number;
}
export interface RepurchaseInput {
  items?: { orderItemId: string; quantity: number }[];
  addSource?: RepurchaseAddSource;
}
```

Replace `repurchase` (lines 139-151):

```ts
  /**
   * Mua lại đơn (spec §3.2). Mỗi dòng xử lý ĐỘC LẬP — một dòng hết hàng/ngừng bán/vượt tồn không
   * dừng vòng lặp (bản cũ: addItem ném giữa vòng lặp → 400 sau khi đã thêm một phần, A2-05).
   * Response giữ giỏ ở top-level + `results` để bản miniapp cũ (setQueryData(['cart'], res)) vẫn
   * đúng trong lúc API đã deploy trước.
   */
  async repurchase(userId: string, code: string, input: RepurchaseInput = {}) {
    const order = await this.detail(userId, code);
    const requested = input.items ? new Map(input.items.map((i) => [i.orderItemId, i.quantity])) : null;
    if (requested) {
      const known = new Set(order.items.map((i) => i.id));
      if ([...requested.keys()].some((id) => !known.has(id))) {
        throw new BadRequestException('Có dòng hàng không thuộc đơn này.');
      }
    }
    const lines = requested ? order.items.filter((i) => requested.has(i.id)) : order.items;
    const [variations, cartRow] = await Promise.all([
      this.prisma.variation.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.variationId))] } },
        select: { id: true, stock: true, isActive: true, product: { select: { isActive: true, approvalStatus: true } } },
      }),
      this.prisma.cart.findUnique({
        where: { userId },
        select: { items: { select: { variationId: true, quantity: true } } },
      }),
    ]);
    const byId = new Map(variations.map((v) => [v.id, v]));
    const inCart = new Map<string, number>((cartRow?.items ?? []).map((ci) => [ci.variationId, ci.quantity]));
    const addSource = input.addSource ?? 'repurchase';
    const results: RepurchaseLineResult[] = [];

    for (const line of lines) {
      const skip = (reason: RepurchaseSkipReason) =>
        results.push({ orderItemId: line.id, status: 'skipped', reason, addedQuantity: 0 });
      const v = byId.get(line.variationId);
      if (!v || !v.isActive || !v.product.isActive) { skip('INACTIVE'); continue; }
      if (v.product.approvalStatus !== 'APPROVED') { skip('NOT_APPROVED'); continue; }
      if (v.stock <= 0) { skip('OUT_OF_STOCK'); continue; }
      const room = v.stock - (inCart.get(v.id) ?? 0);
      if (room <= 0) { skip('EXCEEDS_STOCK'); continue; }
      const want = requested?.get(line.id) ?? line.quantity;
      const qty = Math.min(want, room);
      try {
        await this.cart.addItem(userId, { variationId: v.id, quantity: qty, addSource });
      } catch (err) {
        // Lỗi nghiệp vụ của RIÊNG dòng này (tồn kho đổi giữa lúc đọc và ghi, SP vừa bị ẩn) → bỏ qua
        // dòng; lỗi hạ tầng ném ra (mỗi addItem là một tx riêng nên giỏ không lệch).
        if (err instanceof BadRequestException) { skip('EXCEEDS_STOCK'); continue; }
        if (err instanceof NotFoundException) { skip('INACTIVE'); continue; }
        throw err;
      }
      inCart.set(v.id, (inCart.get(v.id) ?? 0) + qty);
      results.push(
        qty < want
          ? { orderItemId: line.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: qty }
          : { orderItemId: line.id, status: 'added', addedQuantity: qty },
      );
    }
    const cart = await this.cart.getCart(userId);
    return { ...cart, results };
  }
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/api exec jest orders` → PASS.
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/orders/dto/orders.dto.ts apps/api/src/modules/orders/dto/orders.dto.spec.ts apps/api/src/modules/orders/orders.service.ts apps/api/src/modules/orders/orders.service.spec.ts apps/api/src/modules/orders/orders.controller.ts apps/api/src/modules/orders/orders.controller.spec.ts
git commit -m "feat(api): repurchase v2 with per-line results, approval check and addSource" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: API — `GET /me/purchased-items`

**Files:**
- Create: `apps/api/src/modules/orders/purchased-items.service.ts`
- Create: `apps/api/src/modules/orders/purchased-items.service.spec.ts`
- Create: `apps/api/src/modules/orders/purchased-items.controller.ts`
- Create: `apps/api/src/modules/orders/purchased-items.controller.spec.ts`
- Modify: `apps/api/src/modules/orders/orders.module.ts` (register both)
- Modify: `apps/api/src/modules/orders/dto/orders.dto.ts` (add `PurchasedItemsQuery`) + `dto/orders.dto.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`$queryRaw` with `Prisma.sql`, `variation.findMany`).
- Produces:
  - `export interface PurchasedItem { variationId: string; productId: string; slug: string; productName: string; variationName: string; brand: string; thumbnail: string | null; price: number; salePrice: number | null; stock: number; inStock: boolean; timesBought: number; lastPurchasedAt: string }`
  - `export interface PurchasedItemsPage { items: PurchasedItem[]; nextCursor: string | null }`
  - `export interface PurchasedItemsOptions { cursor?: string; limit?: number; variationId?: string }`
  - `export function encodePurchasedCursor(ms: number, variationId: string): string` / `export function decodePurchasedCursor(cursor: string): { ms: number; variationId: string }` (throws `BadRequestException`)
  - `PurchasedItemsService.list(userId: string, opts?: PurchasedItemsOptions): Promise<PurchasedItemsPage>` — default limit 20, max 50.
  - HTTP: `GET /me/purchased-items?cursor=&limit=&variationId=` (auth required via the global guard; user id only from JWT).
  - `export class PurchasedItemsQuery { cursor?: string; limit: number = 20; variationId?: string }`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/orders/purchased-items.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { PurchasedItemsService, decodePurchasedCursor, encodePurchasedCursor } from './purchased-items.service';

const AT = new Date('2026-09-10T03:00:00.123Z');
const row = (variationId: string, timesBought = 1, at: Date = AT) => ({ variationId, timesBought, lastPurchasedAt: at });
const variation = (id: string, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
  id, name: `Loại ${id}`, retailPrice: 65000, salePrice: null, stock: 4, ...over,
  product: { id: `p-${id}`, slug: `sp-${id}`, name: `Sản phẩm ${id}`, brand: 'Tubu', thumbnail: `https://img.test/${id}.jpg`, images: [], ...product },
});

function setup(rows: ReturnType<typeof row>[], variations: ReturnType<typeof variation>[]) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const findMany = jest.fn().mockResolvedValue(variations);
  const prisma = { $queryRaw: queryRaw, variation: { findMany } } as unknown as PrismaService;
  return { svc: new PurchasedItemsService(prisma), queryRaw, findMany };
}
const sqlOf = (m: jest.Mock) => m.mock.calls[0]![0] as Prisma.Sql;

describe('PurchasedItemsService.list', () => {
  it('trả item theo đúng thứ tự SQL (mới mua trước), đủ trường cho kệ Mua lại', async () => {
    const { svc } = setup([row('v2', 3), row('v1')], [variation('v1'), variation('v2', { salePrice: 59000, stock: 0 })]);
    const page = await svc.list('u1');
    expect(page.items.map((i) => i.variationId)).toEqual(['v2', 'v1']);
    expect(page.items[0]).toEqual({
      variationId: 'v2', productId: 'p-v2', slug: 'sp-v2', productName: 'Sản phẩm v2', variationName: 'Loại v2',
      brand: 'Tubu', thumbnail: 'https://img.test/v2.jpg', price: 65000, salePrice: 59000, stock: 0, inStock: false,
      timesBought: 3, lastPurchasedAt: '2026-09-10T03:00:00.123Z',
    });
    expect(page.nextCursor).toBeNull();
  });

  it('SQL chỉ lấy đơn DELIVERED của CHÍNH user và loại SP ngừng bán / chưa duyệt', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1');
    const sql = sqlOf(queryRaw);
    expect(sql.values).toContain('u1');
    expect(sql.sql).toContain(`o.status::text = 'DELIVERED'`);
    expect(sql.sql).toContain('v."isActive" = true');
    expect(sql.sql).toContain('p."isActive" = true');
    expect(sql.sql).toContain(`p."approvalStatus"::text = 'APPROVED'`);
  });

  it('không có dòng nào → không truy vấn variation', async () => {
    const { svc, findMany } = setup([], []);
    await expect(svc.list('u1')).resolves.toEqual({ items: [], nextCursor: null });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lấy limit+1 để biết còn trang sau; nextCursor mã hoá mốc của item cuối trang', async () => {
    const { svc, queryRaw } = setup([row('v3'), row('v2'), row('v1')], [variation('v3'), variation('v2'), variation('v1')]);
    const page = await svc.list('u1', { limit: 2 });
    expect(sqlOf(queryRaw).values).toContain(3);
    expect(page.items.map((i) => i.variationId)).toEqual(['v3', 'v2']);
    expect(decodePurchasedCursor(page.nextCursor!)).toEqual({ ms: AT.getTime(), variationId: 'v2' });
  });

  it('limit bị kẹp 1..50', async () => {
    const a = setup([], []);
    await a.svc.list('u1', { limit: 500 });
    expect(sqlOf(a.queryRaw).values).toContain(51);
    const b = setup([], []);
    await b.svc.list('u1', { limit: 0 });
    expect(sqlOf(b.queryRaw).values).toContain(2);
  });

  it('cursor → điều kiện HAVING theo (epoch ms, variationId)', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1', { cursor: encodePurchasedCursor(1700000000000, 'v9') });
    const sql = sqlOf(queryRaw);
    expect(sql.sql).toContain('HAVING');
    expect(sql.values).toEqual(expect.arrayContaining([1700000000000, 'v9']));
  });

  it('cursor hỏng → 400', async () => {
    const { svc } = setup([], []);
    await expect(svc.list('u1', { cursor: 'không-phải-cursor' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lọc variationId (tra nhanh cho thông báo nhắc mua lại)', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1', { variationId: 'v7' });
    expect(sqlOf(queryRaw).values).toContain('v7');
    expect(sqlOf(queryRaw).sql).toContain('oi."variationId" =');
  });

  it('thumbnail rơi về images[0]; variation biến mất giữa 2 truy vấn → bỏ qua', async () => {
    const { svc } = setup([row('v1'), row('gone')], [variation('v1', {}, { thumbnail: null, images: ['https://img.test/a.jpg'] })]);
    const page = await svc.list('u1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.thumbnail).toBe('https://img.test/a.jpg');
  });
});
```

`apps/api/src/modules/orders/purchased-items.controller.spec.ts`:

```ts
import { PurchasedItemsController } from './purchased-items.controller';
import type { PurchasedItemsService } from './purchased-items.service';

describe('PurchasedItemsController', () => {
  it('userId lấy từ JWT, cursor/limit/variationId từ query', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const ctrl = new PurchasedItemsController({ list } as unknown as PurchasedItemsService);
    await ctrl.list('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
    expect(list).toHaveBeenCalledWith('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
  });
});
```

Append to `apps/api/src/modules/orders/dto/orders.dto.spec.ts` (import `PurchasedItemsQuery`):

```ts
describe('PurchasedItemsQuery', () => {
  it('mặc định limit=20; ép kiểu limit chuỗi', async () => {
    await expect(asQuery(PurchasedItemsQuery, {})).resolves.toMatchObject({ limit: 20 });
    await expect(asQuery(PurchasedItemsQuery, { limit: '10', variationId: 'v1' })).resolves.toMatchObject({ limit: 10, variationId: 'v1' });
  });
  it.each([[{ limit: '51' }], [{ limit: '0' }], [{ userId: 'u2' }]])('từ chối %p (không nhận userId từ client)', async (q) => {
    await expect(asQuery(PurchasedItemsQuery, q)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/api exec jest purchased-items orders.dto`
Expected: FAIL — modules not found / `PurchasedItemsQuery` not exported.

- [ ] **Step 3: Implement**

`apps/api/src/modules/orders/purchased-items.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  lastPurchasedAt: string;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
}
export interface PurchasedItemsOptions {
  cursor?: string;
  limit?: number;
  variationId?: string;
}

interface PurchasedRow {
  variationId: string;
  timesBought: number;
  lastPurchasedAt: Date;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Cursor = base64url("<epoch ms>|<variationId>"). So sánh bằng epoch ms (không phải timestamp)
 * để không phụ thuộc TimeZone của phiên Postgres với cột `timestamp without time zone`. */
export function encodePurchasedCursor(ms: number, variationId: string): string {
  return Buffer.from(`${ms}|${variationId}`, 'utf8').toString('base64url');
}

export function decodePurchasedCursor(cursor: string): { ms: number; variationId: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  const ms = Number(raw.slice(0, sep));
  const variationId = raw.slice(sep + 1);
  if (sep <= 0 || !Number.isSafeInteger(ms) || ms < 0 || variationId.length === 0) {
    throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
  }
  return { ms, variationId };
}

/**
 * Sản phẩm khách đã mua THÀNH CÔNG (đơn DELIVERED), nhóm theo variation — nguồn cho kệ "Mua lại"
 * (spec §3.1). Chỉ dữ liệu của chính user (userId từ JWT). Loại variation/SP ngừng bán hoặc chưa
 * duyệt; SP chỉ hết hàng vẫn trả kèm inStock:false. lastPurchasedAt = createdAt của đơn giao gần
 * nhất (cùng định nghĩa với LifecycleService.sendReorderReminders).
 */
@Injectable()
export class PurchasedItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, opts: PurchasedItemsOptions = {}): Promise<PurchasedItemsPage> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const cursor = opts.cursor ? decodePurchasedCursor(opts.cursor) : null;
    const rows = await this.prisma.$queryRaw<PurchasedRow[]>(Prisma.sql`
      SELECT oi."variationId" AS "variationId",
             COUNT(DISTINCT o.id)::int AS "timesBought",
             MAX(o."createdAt") AS "lastPurchasedAt"
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      JOIN variations v ON v.id = oi."variationId"
      JOIN products p ON p.id = v."productId"
      WHERE o."userId" = ${userId}
        AND o.status::text = 'DELIVERED'
        AND v."isActive" = true
        AND p."isActive" = true
        AND p."approvalStatus"::text = 'APPROVED'
        ${opts.variationId ? Prisma.sql`AND oi."variationId" = ${opts.variationId}` : Prisma.empty}
      GROUP BY oi."variationId"
      ${
        cursor
          ? Prisma.sql`HAVING (FLOOR(EXTRACT(EPOCH FROM MAX(o."createdAt")) * 1000)::bigint, oi."variationId") < (${cursor.ms}::bigint, ${cursor.variationId})`
          : Prisma.empty
      }
      ORDER BY MAX(o."createdAt") DESC, oi."variationId" DESC
      LIMIT ${limit + 1}`);

    const page = rows.slice(0, limit);
    if (page.length === 0) return { items: [], nextCursor: null };

    const variations = await this.prisma.variation.findMany({
      where: { id: { in: page.map((r) => r.variationId) } },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        salePrice: true,
        stock: true,
        product: { select: { id: true, slug: true, name: true, brand: true, thumbnail: true, images: true } },
      },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    const items: PurchasedItem[] = [];
    for (const r of page) {
      const v = byId.get(r.variationId);
      if (!v) continue;
      items.push({
        variationId: v.id,
        productId: v.product.id,
        slug: v.product.slug,
        productName: v.product.name,
        variationName: v.name,
        brand: v.product.brand,
        thumbnail: v.product.thumbnail ?? v.product.images[0] ?? null,
        price: v.retailPrice,
        salePrice: v.salePrice,
        stock: Math.max(v.stock, 0),
        inStock: v.stock > 0,
        timesBought: Number(r.timesBought),
        lastPurchasedAt: new Date(r.lastPurchasedAt).toISOString(),
      });
    }
    const last = page[page.length - 1]!;
    return {
      items,
      nextCursor: rows.length > limit ? encodePurchasedCursor(new Date(last.lastPurchasedAt).getTime(), last.variationId) : null,
    };
  }
}
```

`apps/api/src/modules/orders/purchased-items.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PurchasedItemsQuery } from './dto/orders.dto';
import { PurchasedItemsService } from './purchased-items.service';

@Controller('me/purchased-items')
export class PurchasedItemsController {
  constructor(private readonly purchased: PurchasedItemsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() q: PurchasedItemsQuery) {
    return this.purchased.list(userId, { cursor: q.cursor, limit: q.limit, variationId: q.variationId });
  }
}
```

Append to `apps/api/src/modules/orders/dto/orders.dto.ts` (`Type` already imported in Task 3):

```ts
export class PurchasedItemsQuery {
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional() @IsString() @MaxLength(64) variationId?: string;
}
```

`apps/api/src/modules/orders/orders.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderReversalService } from './order-reversal.service';
import { OrderStatusService } from './order-status.service';
import { PurchasedItemsService } from './purchased-items.service';
import { PurchasedItemsController } from './purchased-items.controller';
import { CartModule } from '../cart/cart.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [CartModule, FlashSaleModule],
  controllers: [OrdersController, PurchasedItemsController],
  providers: [OrdersService, OrderReversalService, OrderStatusService, PurchasedItemsService],
  // Xuất cho AdminModule/MerchantModule/PancakeModule — nguồn ghi Order.status
  // dùng chung để không lặp lại khối restock/refund + guard chuyển trạng thái.
  exports: [OrderReversalService, OrderStatusService],
})
export class OrdersModule {}
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/api exec jest purchased-items orders.dto` → PASS.
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/orders/purchased-items.service.ts apps/api/src/modules/orders/purchased-items.service.spec.ts apps/api/src/modules/orders/purchased-items.controller.ts apps/api/src/modules/orders/purchased-items.controller.spec.ts apps/api/src/modules/orders/orders.module.ts apps/api/src/modules/orders/dto/orders.dto.ts apps/api/src/modules/orders/dto/orders.dto.spec.ts
git commit -m "feat(api): GET /me/purchased-items for the buy-again rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: API — real-Postgres integration test for repurchase v2 and purchased-items

**Files:**
- Create: `apps/api/test/integration-race/buy-flow-4a.race-spec.ts`

**Interfaces:**
- Consumes: `OrdersService.repurchase` (Task 3), `PurchasedItemsService.list` (Task 4), real `CartService` + `AnalyticsEventsService`, helpers `createUser`, `createOrder`, `randCode`, `warmPool` from `./helpers`.
- Produces: nothing for later tasks (verification only). Proves on real SQL: one failing line does not affect others; purchased-items filters DELIVERED + own user + active/approved; cursor pagination is stable including ties on the same `createdAt`.

- [ ] **Step 1: Write the test**

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { ProductApprovalStatus, Variation } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { PurchasedItemsService } from '../../src/modules/orders/purchased-items.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Dự án 4a trên Postgres THẬT: repurchase v2 (mỗi dòng độc lập, CartService thật với kiểm tồn +
 * approvalStatus + sự kiện add_to_cart) và purchased-items (SQL thô: lọc DELIVERED + đúng user +
 * SP còn bán, phân trang cursor ổn định kể cả khi 2 variation cùng mốc createdAt).
 * Stub: coupon / flash-sale (giỏ không có mã, không giờ vàng), thông báo, hoa hồng.
 */
describe('Buy-flow 4a — repurchase v2 + purchased-items (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let cart: CartService;
  let purchased: PurchasedItemsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrdersService,
        CartService,
        AnalyticsEventsService,
        PurchasedItemsService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), release: jest.fn() } },
        { provide: FlashSaleService, useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()), restore: jest.fn() } },
        { provide: AffiliateService, useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    cart = moduleRef.get(CartService);
    purchased = moduleRef.get(PurchasedItemsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function createVariation(over: {
    stock: number;
    isActive?: boolean;
    productIsActive?: boolean;
    approvalStatus?: ProductApprovalStatus;
  }): Promise<Variation> {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        isActive: over.productIsActive ?? true,
        approvalStatus: over.approvalStatus ?? 'APPROVED',
        thumbnail: `https://img.test/${tag}.jpg`,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 50_000,
        stock: over.stock,
        isActive: over.isActive ?? true,
      },
    });
  }

  async function addLine(orderId: string, variation: Variation, quantity: number) {
    return prisma.orderItem.create({
      data: {
        orderId,
        variationId: variation.id,
        productName: 'SP IT',
        variationName: variation.name,
        unitPrice: 50_000,
        quantity,
        total: 50_000 * quantity,
      },
    });
  }

  it('(a) repurchase: dòng bị từ chối / hết hàng / giỏ đã giữ hết tồn KHÔNG chặn dòng còn hàng; dòng thiếu tồn được kẹp', async () => {
    const user = await createUser(prisma);
    const ok = await createVariation({ stock: 10 });
    const rejected = await createVariation({ stock: 10, approvalStatus: 'REJECTED' });
    const full = await createVariation({ stock: 1 });
    const empty = await createVariation({ stock: 0 });
    const short = await createVariation({ stock: 2 });
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED' });
    const lOk = await addLine(order.id, ok, 3);
    const lRej = await addLine(order.id, rejected, 1);
    const lFull = await addLine(order.id, full, 1);
    const lEmpty = await addLine(order.id, empty, 1);
    const lShort = await addLine(order.id, short, 3);

    // Giỏ đã giữ trọn tồn của `full` (bản cũ: addItem ném 400 ngay dòng này, bỏ dở cả vòng lặp).
    await cart.addItem(user.id, { variationId: full.id, quantity: 1 });

    const res = await orders.repurchase(user.id, order.code);

    expect(res.results).toEqual(
      expect.arrayContaining([
        { orderItemId: lOk.id, status: 'added', addedQuantity: 3 },
        { orderItemId: lRej.id, status: 'skipped', reason: 'NOT_APPROVED', addedQuantity: 0 },
        { orderItemId: lFull.id, status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
        { orderItemId: lEmpty.id, status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
        { orderItemId: lShort.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 2 },
      ]),
    );
    const lines = await prisma.cartItem.findMany({ where: { cart: { userId: user.id } } });
    const qty = new Map(lines.map((l) => [l.variationId, l.quantity]));
    expect(qty.get(ok.id)).toBe(3);
    expect(qty.get(full.id)).toBe(1);
    expect(qty.get(short.id)).toBe(2);
    expect(qty.has(rejected.id)).toBe(false);
    expect(qty.has(empty.id)).toBe(false);
    // Giỏ ở top-level (bản miniapp cũ đọc thẳng) + results.
    expect(res.items).toHaveLength(3);
    expect(res.itemCount).toBe(6);

    const events = await prisma.analyticsEvent.findMany({ where: { userId: user.id, eventName: 'add_to_cart' } });
    const sources = events.map((e) => (e.props as { addSource?: string }).addSource).sort();
    expect(sources).toEqual(['pdp', 'repurchase', 'repurchase']);
  });

  it('(b) purchased-items: chỉ DELIVERED của chính user, loại SP ngừng bán, mới nhất trước, cursor ổn định khi trùng mốc', async () => {
    const me = await createUser(prisma);
    const other = await createUser(prisma);
    const a = await createVariation({ stock: 5 });
    const b = await createVariation({ stock: 0 });
    const d = await createVariation({ stock: 3 });
    const c = await createVariation({ stock: 5 });
    const gone = await createVariation({ stock: 5, isActive: false });

    const old = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-08-01T03:00:00.000Z') });
    await addLine(old.id, a, 1);
    await addLine(old.id, d, 1);
    await addLine(old.id, gone, 1);
    const recent = await createOrder(prisma, { userId: me.id, status: 'DELIVERED', createdAt: new Date('2026-09-10T03:00:00.123Z') });
    await addLine(recent.id, a, 1);
    await addLine(recent.id, b, 2);
    const pending = await createOrder(prisma, { userId: me.id, status: 'CONFIRMED' });
    await addLine(pending.id, c, 1);
    const others = await createOrder(prisma, { userId: other.id, status: 'DELIVERED' });
    await addLine(others.id, c, 1);

    const all = await purchased.list(me.id, { limit: 20 });
    // a và b cùng mốc `recent` → phá hoà bằng variationId giảm dần; d (đơn cũ) cuối.
    const tie = [a.id, b.id].sort().reverse();
    expect(all.items.map((i) => i.variationId)).toEqual([...tie, d.id]);
    const itemA = all.items.find((i) => i.variationId === a.id)!;
    expect(itemA.timesBought).toBe(2);
    expect(itemA.lastPurchasedAt).toBe('2026-09-10T03:00:00.123Z');
    expect(all.items.find((i) => i.variationId === b.id)!.inStock).toBe(false);
    expect(all.nextCursor).toBeNull();

    const p1 = await purchased.list(me.id, { limit: 1 });
    const p2 = await purchased.list(me.id, { limit: 1, cursor: p1.nextCursor! });
    const p3 = await purchased.list(me.id, { limit: 1, cursor: p2.nextCursor! });
    expect([p1, p2, p3].map((p) => p.items[0]!.variationId)).toEqual([...tie, d.id]);
    expect(p3.nextCursor).toBeNull();

    // c chỉ nằm trong đơn chưa giao + đơn của người khác.
    await expect(purchased.list(me.id, { variationId: c.id })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(purchased.list(me.id, { variationId: a.id })).resolves.toMatchObject({ items: [{ variationId: a.id }] });
  });
});
```

- [ ] **Step 2: Run on the throwaway DB**

Run: `cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand buy-flow-4a`
Expected: PASS 2/2. If (b) fails on the cursor step, the HAVING tuple/epoch expression in `purchased-items.service.ts` is wrong — fix the service (not the test) and re-run Task 4's unit tests too.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration-race/buy-flow-4a.race-spec.ts
git commit -m "test(api): real-Postgres coverage for repurchase v2 and purchased-items" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: API — for-you keeps purchased products but ranks them after unpurchased ones

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts:160-229` (`getForYou`)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts:198-223` (replace the first `getForYou` test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /products/for-you` — same shape; purchased products may appear, always after every unpurchased product; within each group sorted by `soldExternal + soldApp` desc; still max 10.

- [ ] **Step 1: Replace the failing-by-design test**

In `catalog.service.spec.ts`, replace the whole `it('có lịch sử mua ở danh mục C → ...', ...)` block (lines 198-223) with:

```ts
  it('có lịch sử mua ở danh mục C → gợi ý cùng danh mục; SP ĐÃ MUA vẫn có mặt nhưng xếp SAU mọi SP chưa mua (spec 4a.3, A2-04)', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([{ variationId: 'v1' }]);
    const variationFindMany = jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]);
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: ['C'] }])
      .mockResolvedValueOnce([
        { ...card('p1'), soldExternal: 100, soldApp: 0 }, // đã mua, bán chạy nhất
        { ...card('p2'), soldExternal: 5, soldApp: 0 },
        { ...card('p3'), soldExternal: 10, soldApp: 20 },
      ]);
    const { prisma, svc } = setup({
      orderItem: { findMany: orderItemFindMany },
      variation: { findMany: variationFindMany },
      product: { findMany: productFindMany },
    });

    const r = await svc.getForYou('u1');

    expect(r.map((c) => c.id)).toEqual(['p3', 'p2', 'p1']);
    // Không còn loại ở DB — SP đã mua được phép xuất hiện.
    const candidateWhere = (prisma as any).product.findMany.mock.calls[1][0].where;
    expect(candidateWhere.id).toBeUndefined();
    expect(candidateWhere.OR).toEqual(expect.arrayContaining([{ categoryIds: { hasSome: ['C'] } }]));
  });

  it('nhánh fallback isFeatured cũng xếp SP đã mua sau', async () => {
    const productFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ categoryIds: [] }])
      .mockResolvedValueOnce([
        { ...card('p1'), isFeatured: true, soldExternal: 50, soldApp: 0 },
        { ...card('pf'), isFeatured: true, soldExternal: 1, soldApp: 0 },
      ]);
    const { svc } = setup({
      orderItem: { findMany: jest.fn().mockResolvedValue([{ variationId: 'v1' }]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }]) },
      product: { findMany: productFindMany },
    });
    const r = await svc.getForYou('u1');
    expect(r.map((c) => c.id)).toEqual(['pf', 'p1']);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/api exec jest catalog.service`
Expected: FAIL — `candidateWhere.id` is `{ notIn: ['p1'] }` and `p1` is missing from the result.

- [ ] **Step 3: Implement**

In `getForYou`, update the docblock line 2 to: `2) Gợi ý sản phẩm active trùng danh mục HOẶC thuộc nhãn theo dõi; sản phẩm ĐÃ MUA vẫn có thể xuất hiện nhưng luôn xếp sau sản phẩm chưa mua (spec 4a.3), trong mỗi nhóm sắp theo tổng đã bán giảm dần.`

Delete the line `if (purchasedProductIds.length) where.id = { notIn: purchasedProductIds };` and replace the final sort (lines 225-228) with:

```ts
    const purchased = new Set(purchasedProductIds);
    const sold = (p: { soldExternal: number; soldApp: number }) => p.soldExternal + p.soldApp;
    const sorted = [...items].sort((a, b) => {
      const pa = purchased.has(a.id) ? 1 : 0;
      const pb = purchased.has(b.id) ? 1 : 0;
      return pa !== pb ? pa - pb : sold(b) - sold(a);
    });
    return sorted.slice(0, TAKE).map((p) => this.toCard(p));
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/api exec jest catalog` → PASS.
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/catalog.service.ts apps/api/src/modules/catalog/catalog.service.spec.ts
git commit -m "feat(api): for-you ranks purchased products after unpurchased instead of hiding them" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: API — `shippingEta` on `/config/public`

**Files:**
- Create: `apps/api/src/modules/system-config/shipping-eta.ts`
- Modify: `apps/api/src/modules/system-config/system-config.controller.ts`
- Test: `apps/api/src/modules/system-config/system-config.controller.spec.ts` (append)

**Interfaces:**
- Consumes: `SystemConfigService.get<T>(key, fallback)` (a `null` fallback is returned and cached, no `NotFoundException`).
- Produces: `export interface ShippingEta { minDays: number; maxDays: number }`, `export function toShippingEta(min: unknown, max: unknown): ShippingEta | null`; `/config/public` gains `shippingEta: ShippingEta | null` (null unless both keys are integers with `0 <= min <= max <= 60`).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('SystemConfigController.publicConfig', ...)`:

```ts
  describe('shippingEta — ngày giao dự kiến (chỉ khi chủ shop đã cấu hình)', () => {
    it('chưa cấu hình → null (FE ẩn dòng "Giao dự kiến", không hứa ngày)', async () => {
      const out = await new SystemConfigController(makeConfig()).publicConfig();
      expect(out.shippingEta).toBeNull();
    });

    it('2 và 4 → { minDays: 2, maxDays: 4 }', async () => {
      const out = await new SystemConfigController(
        makeConfig({ 'shipping.eta_min_days': 2, 'shipping.eta_max_days': 4 }),
      ).publicConfig();
      expect(out.shippingEta).toEqual({ minDays: 2, maxDays: 4 });
    });

    it.each([
      [5, 2],
      [1.5, 3],
      [-1, 2],
      [2, 90],
      ['2', 4],
      [2, null],
    ])('giá trị sai (%p, %p) → null', async (min, max) => {
      const out = await new SystemConfigController(
        makeConfig({ 'shipping.eta_min_days': min, 'shipping.eta_max_days': max }),
      ).publicConfig();
      expect(out.shippingEta).toBeNull();
    });

    it('đọc 2 khoá với fallback null (không ném NotFound khi thiếu khoá)', async () => {
      const config = makeConfig();
      await new SystemConfigController(config).publicConfig();
      const get = (config as unknown as { get: jest.Mock }).get;
      expect(get).toHaveBeenCalledWith('shipping.eta_min_days', null);
      expect(get).toHaveBeenCalledWith('shipping.eta_max_days', null);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/api exec jest system-config.controller`
Expected: FAIL — `shippingEta` is undefined.

- [ ] **Step 3: Implement**

`apps/api/src/modules/system-config/shipping-eta.ts`:

```ts
export interface ShippingEta {
  minDays: number;
  maxDays: number;
}

/** Khoảng ngày giao dự kiến (spec §2: cố định từ SystemConfig, chưa theo tỉnh). Cấu hình thiếu
 * hoặc sai → null để FE ẩn hẳn dòng này thay vì hứa một con số chủ shop chưa đặt. */
export function toShippingEta(min: unknown, max: unknown): ShippingEta | null {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  const lo = min as number;
  const hi = max as number;
  if (lo < 0 || hi < lo || hi > 60) return null;
  return { minDays: lo, maxDays: hi };
}
```

In `system-config.controller.ts`: add `import { toShippingEta } from './shipping-eta';`, extend the destructuring and the `Promise.all` with two more reads, and add the field to the returned object:

```ts
    const [
      freeshipThreshold,
      subscribeDiscountPct,
      affiliateWalletMultiplier,
      affiliateMinWithdrawBank,
      cashbackHoldDays,
      recyclingEnabled,
      etaMinDays,
      etaMaxDays,
    ] = await Promise.all([
      this.config.get<number>('shipping.free_threshold', 200000),
      this.config.get<number>('subscribe.discount_pct', 0.12),
      this.config.get<number>('affiliate.tubu_wallet_multiplier', 1.5),
      this.config.get<number>('affiliate.min_withdraw_bank', 50000),
      this.config.get<number>('cashback.hold_days', 30),
      isGomdonRecyclingEnabled(this.config).catch(() => false),
      this.config.get<number | null>('shipping.eta_min_days', null),
      this.config.get<number | null>('shipping.eta_max_days', null),
    ]);
    return {
      freeshipThreshold,
      subscribeDiscountPct,
      affiliateWalletMultiplier,
      affiliateMinWithdrawBank,
      cashbackHoldDays,
      recyclingEnabled,
      shippingEta: toShippingEta(etaMinDays, etaMaxDays),
    };
```

(Keep the existing comment above `isGomdonRecyclingEnabled`.)

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/api exec jest system-config` → PASS.
Run: `pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/system-config/shipping-eta.ts apps/api/src/modules/system-config/system-config.controller.ts apps/api/src/modules/system-config/system-config.controller.spec.ts
git commit -m "feat(api): expose optional shipping ETA range on /config/public" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Miniapp — DS v2 carry-over debts (Button aria order, label diacritics, `--zaui-*` allowlist)

**Files:**
- Modify: `apps/miniapp/src/components/ui/button.tsx` (attribute order)
- Modify: `apps/miniapp/src/css/tokens.css:426-430` (label rule)
- Modify: `scripts/check-undefined-css-vars.mjs` (`RUNTIME_PREFIXES` + header comment)
- Create: `apps/miniapp/src/css/tokens-button-label.spec.ts`
- Test: `apps/miniapp/src/components/ui/button.spec.tsx` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `Button` — caller-supplied `aria-busy` / `aria-disabled` now override the loading-derived defaults (all other behaviour unchanged). CSS: `.tubu-btn` label keeps 3px block padding. `pnpm lint:vars` only exempts `--zaui-safe-area-*`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('a11y while loading', ...)` of `button.spec.tsx`:

```tsx
    it('caller-provided aria-busy / aria-disabled win over the loading-derived defaults (followups: aria order)', () => {
      render(<Button loading aria-busy={false} aria-disabled={false}>Lưu</Button>);
      const btn = screen.getByRole('button', { name: 'Lưu' });
      expect(btn).toHaveAttribute('aria-busy', 'false');
      expect(btn).toHaveAttribute('aria-disabled', 'false');
    });
```

`apps/miniapp/src/css/tokens-button-label.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nhãn Button có overflow:hidden (để rút gọn "…") nên cắt ~1,3px đỉnh chữ hoa hai dấu ("Ẩ", "Ấ",
 * "Ổ") — follow-up của dự án 3. Đệm 3px trên/dưới rồi bù margin âm: khung chữ đủ cao cho dấu mà
 * chiều cao nút không đổi.
 */
describe('tokens.css — nhãn .tubu-btn không cắt dấu tiếng Việt', () => {
  const css = readFileSync(join(process.cwd(), 'src/css/tokens.css'), 'utf8');
  const rule = /\.tubu-btn \.zaui-btn-container > span:not\(\.zaui-btn-icon\):not\(\.zaui-btn-loading-container\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('rule nhãn tồn tại', () => {
    expect(rule).toContain('overflow: hidden');
  });
  it('có padding-block: 3px và margin-block: -3px', () => {
    expect(rule).toMatch(/padding-block:\s*3px/);
    expect(rule).toMatch(/margin-block:\s*-3px/);
  });
});
```

Lint-script probe (red step for the allowlist): create a temporary file `apps/miniapp/src/__lint-vars-probe.ts`:

```ts
// Tạm thời — chỉ để chứng minh lint:vars bắt tên biến ZaUI gõ sai. Xoá ở Step 4.
export const probe = 'var(--zaui-light-buton-primary-background)';
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/button.spec.tsx src/css/tokens-button-label.spec.ts`
Expected: FAIL — `aria-busy` is `true`; `padding-block` missing.
Run: `pnpm lint:vars`
Expected (this is the bug): prints `OK` even though the probe references an undefined `--zaui-light-buton-...` variable.

- [ ] **Step 3: Implement**

`button.tsx` — move the two defaults before the spread so callers can override them:

```tsx
    <ZButton
      aria-busy={loading || undefined}
      aria-disabled={loading || disabled || undefined}
      {...aria}
      aria-label={label}
      variant={ZAUI_VARIANT[variant]}
```

(Delete the old `{...aria}` / `aria-label` / `aria-busy` / `aria-disabled` lines; the rest of the element is unchanged. Update the docblock sentence about aria-busy to add: "Caller truyền `aria-busy`/`aria-disabled` tường minh thì thắng giá trị suy từ `loading`.")

`tokens.css` — the label rule becomes:

```css
.tubu-btn .zaui-btn-container > span:not(.zaui-btn-icon):not(.zaui-btn-loading-container) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  /* overflow:hidden cắt đỉnh chữ hoa hai dấu ("Ẩ", "Ổ") ~1,3px — đệm 3px rồi bù margin âm để
   * chiều cao nút không đổi (follow-up dự án 3). */
  padding-block: 3px;
  margin-block: -3px;
}
```

`scripts/check-undefined-css-vars.mjs` — replace `const RUNTIME_PREFIXES = ['zaui-'];` with `const RUNTIME_PREFIXES = ['zaui-safe-area-'];` and the header bullet about `--zaui-*` with:

```js
//  - `--zaui-safe-area-*`: biến runtime do zmp-ui tự đặt (vd --zaui-safe-area-inset-bottom), không
//    nằm trong 3 file định nghĩa. CHỈ cho qua đúng họ này — trước đây cho qua mọi `--zaui-*` nên tên
//    biến theme ZaUI gõ sai (vd --zaui-light-buton-...) cũng lọt. Biến --zaui-light-* hợp lệ đã được
//    định nghĩa trong zaui-bridge.css nên vẫn qua như thường.
```

- [ ] **Step 4: Run tests, then remove the probe**

Run: `pnpm lint:vars` → exits 1 and reports `apps/miniapp/src/__lint-vars-probe.ts:2: var(--zaui-light-buton-primary-background) is not defined anywhere`.
Delete the probe: `rm apps/miniapp/src/__lint-vars-probe.ts`
Run: `pnpm lint:vars` → `OK — every var(--x) reference is defined.`
Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/button.spec.tsx src/css/tokens-button-label.spec.ts src/components/ui/button-guard.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/ui/button.tsx apps/miniapp/src/components/ui/button.spec.tsx apps/miniapp/src/css/tokens.css apps/miniapp/src/css/tokens-button-label.spec.ts scripts/check-undefined-css-vars.mjs
git commit -m "fix(ds): button aria override order, diacritic-safe label padding, narrow zaui lint allowlist" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Miniapp — `shop-api` types/calls, buy-flow events, public-config fallback

**Files:**
- Modify: `apps/miniapp/src/services/shop-api.ts`
- Create: `apps/miniapp/src/services/shop-api.spec.ts`
- Create: `apps/miniapp/src/services/buy-flow-events.ts`
- Create: `apps/miniapp/src/services/buy-flow-events.spec.ts`
- Modify: `apps/miniapp/src/hooks/use-public-config.ts` + `use-public-config.spec.ts`
- Modify (call-site compatibility only): `apps/miniapp/src/pages/orders.tsx:47`, `apps/miniapp/src/pages/order-detail.tsx:141-149`

**Interfaces:**
- Consumes: API contracts from Tasks 1-4, 7.
- Produces (all exported from `services/shop-api.ts`):
  - `interface OrderItemMedia { thumbnail?: string | null; stock?: number; available?: boolean; currentPrice?: number | null }`
  - `type OrderItemView = OrderItemDTO & OrderItemMedia`; `type OrderView = Omit<OrderDTO, 'items'> & { items: OrderItemView[] }`
  - `type OrderStatusGroup = 'processing' | 'closed'`; `interface OrderListFilter { status?: string; group?: OrderStatusGroup }`
  - `fetchOrders(filter?: OrderListFilter, page?: number, limit?: number): Promise<PageResponse<OrderView>>` (status wins over group)
  - `fetchOrder(code: string): Promise<OrderView>`
  - `fetchActiveOrderCount(): Promise<number>` (non-number → 0)
  - `interface PurchasedItem { variationId; productId; slug; productName; variationName; brand; thumbnail: string | null; price: number; salePrice: number | null; stock: number; inStock: boolean; timesBought: number; lastPurchasedAt: string }`, `interface PurchasedItemsPage { items: PurchasedItem[]; nextCursor: string | null }`
  - `fetchPurchasedItems(params?: { cursor?: string; limit?: number; variationId?: string }): Promise<PurchasedItemsPage>`
  - `type AddToCartSource = 'pdp' | 'buy_now' | 'repurchase' | 'wishlist' | 'ctv_sheet' | 'reorder_notification'`; `addToCart(variationId: string, quantity: number, addSource?: AddToCartSource): Promise<CartSummary>`
  - `type RepurchaseAddSource = 'repurchase' | 'reorder_notification'`; `type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK'`; `interface RepurchaseLineResult { orderItemId: string; status: 'added' | 'partial' | 'skipped'; reason?: RepurchaseSkipReason; addedQuantity: number }`
  - `interface RepurchaseResponse { cart: CartSummary; results: RepurchaseLineResult[]; legacy: boolean }`; `normalizeRepurchaseResponse(raw: CartSummary & { results?: RepurchaseLineResult[] }): RepurchaseResponse`
  - `repurchaseOrder(code: string, body?: { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource }): Promise<RepurchaseResponse>`
  - `interface ShippingEta { minDays: number; maxDays: number }`; `PublicConfig.shippingEta?: ShippingEta | null`; `PUBLIC_CONFIG_FALLBACK.shippingEta = null`
- Produces (`services/buy-flow-events.ts`): `type ReorderSource = 'home_rail' | 'order_card' | 'order_detail' | 'notification' | 'orders_tab'`; `trackReorderClicked(p: { source: ReorderSource; orderCode?: string; variationId?: string }): void`; `trackReorderCompleted(p: { source: ReorderSource; added: number; skipped: number }): void`; `trackReorderReminderCta(notificationId: string): void`.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/services/shop-api.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './api';
import {
  addToCart,
  fetchActiveOrderCount,
  fetchOrders,
  fetchPurchasedItems,
  normalizeRepurchaseResponse,
  repurchaseOrder,
  type CartSummary,
} from './shop-api';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };

describe('shop-api — buy-flow 4a', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizeRepurchaseResponse: API v2 (giỏ top-level + results) → { cart, results }', () => {
    const results = [{ orderItemId: 'i1', status: 'added' as const, addedQuantity: 1 }];
    expect(normalizeRepurchaseResponse({ ...CART, results })).toEqual({ cart: CART, results, legacy: false });
  });

  it('normalizeRepurchaseResponse: API cũ (chỉ giỏ) → legacy=true, results rỗng', () => {
    expect(normalizeRepurchaseResponse(CART)).toEqual({ cart: CART, results: [], legacy: true });
  });

  it('repurchaseOrder gửi body items + addSource', async () => {
    post.mockResolvedValue({ data: { ...CART, results: [] } });
    await repurchaseOrder('TUBU1', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    expect(post).toHaveBeenCalledWith('/orders/TUBU1/repurchase', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
  });

  it('addToCart chỉ gửi addSource khi có', async () => {
    post.mockResolvedValue({ data: CART });
    await addToCart('v1', 1);
    expect(post).toHaveBeenLastCalledWith('/cart/items', { variationId: 'v1', quantity: 1 });
    await addToCart('v1', 2, 'repurchase');
    expect(post).toHaveBeenLastCalledWith('/cart/items', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
  });

  it('fetchOrders: status thắng group; không lọc → chỉ page/limit', async () => {
    get.mockResolvedValue({ data: { data: [], meta: { page: 1, limit: 20, total: 0 } } });
    await fetchOrders({ group: 'processing' }, 1, 20);
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { group: 'processing', page: 1, limit: 20 } });
    await fetchOrders({ status: 'SHIPPING', group: 'closed' }, 2, 10);
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { status: 'SHIPPING', page: 2, limit: 10 } });
    await fetchOrders();
    expect(get).toHaveBeenLastCalledWith('/orders', { params: { page: 1, limit: 20 } });
  });

  it('fetchActiveOrderCount ép về 0 khi dữ liệu lạ', async () => {
    get.mockResolvedValueOnce({ data: { count: 3 } });
    await expect(fetchActiveOrderCount()).resolves.toBe(3);
    get.mockResolvedValueOnce({ data: { code: 'active-count' } });
    await expect(fetchActiveOrderCount()).resolves.toBe(0);
  });

  it('fetchPurchasedItems chuyển params', async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchPurchasedItems({ variationId: 'v1', limit: 1 });
    expect(get).toHaveBeenCalledWith('/me/purchased-items', { params: { variationId: 'v1', limit: 1 } });
  });
});
```

`apps/miniapp/src/services/buy-flow-events.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from './analytics';
import { trackReorderClicked, trackReorderCompleted, trackReorderReminderCta } from './buy-flow-events';

describe('buy-flow-events (spec §3.4)', () => {
  it('reorder_clicked mang source + mã đơn/variation', () => {
    trackReorderClicked({ source: 'order_card', orderCode: 'TUBU1' });
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_clicked', 'miniapp', { source: 'order_card', orderCode: 'TUBU1' });
  });
  it('reorder_completed mang số dòng thêm/bỏ qua', () => {
    trackReorderCompleted({ source: 'home_rail', added: 1, skipped: 0 });
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_completed', 'miniapp', { source: 'home_rail', added: 1, skipped: 0 });
  });
  it('reorder_reminder_cta gắn notificationId cả ở props lẫn cột notificationId', () => {
    trackReorderReminderCta('n1');
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_reminder_cta', 'miniapp', { notificationId: 'n1' }, { notificationId: 'n1' });
  });
});
```

Append to `apps/miniapp/src/hooks/use-public-config.spec.ts`:

```ts
  it('shippingEta mặc định null — không hứa ngày giao khi server chưa trả', () => {
    expect(PUBLIC_CONFIG_FALLBACK).toHaveProperty('shippingEta', null);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/services/shop-api.spec.ts src/services/buy-flow-events.spec.ts src/hooks/use-public-config.spec.ts`
Expected: FAIL — missing exports / module.

- [ ] **Step 3: Implement**

`services/shop-api.ts`: change the type import to `import type { OrderDTO, OrderItemDTO } from '@tubutree/shared-types';`. In `PublicConfig` add:

```ts
  /** Khoảng ngày giao dự kiến — null/thiếu khi chủ shop chưa cấu hình (hoặc API cũ) → ẩn. */
  shippingEta?: ShippingEta | null;
```

and above it:

```ts
export interface ShippingEta {
  minDays: number;
  maxDays: number;
}
```

Replace the `addToCart` export:

```ts
export type AddToCartSource = 'pdp' | 'buy_now' | 'repurchase' | 'wishlist' | 'ctv_sheet' | 'reorder_notification';
export const addToCart = (variationId: string, quantity: number, addSource?: AddToCartSource) =>
  api
    .post<CartSummary>('/cart/items', { variationId, quantity, ...(addSource ? { addSource } : {}) })
    .then((r) => r.data);
```

Replace the `// Orders` block's `fetchOrders`, `fetchOrder` and `repurchaseOrder` with:

```ts
/** Ảnh/tồn kho từng dòng do API join theo variationId (dự án 4a). Optional: API cũ không trả. */
export interface OrderItemMedia {
  thumbnail?: string | null;
  stock?: number;
  available?: boolean;
  currentPrice?: number | null;
}
export type OrderItemView = OrderItemDTO & OrderItemMedia;
export type OrderView = Omit<OrderDTO, 'items'> & { items: OrderItemView[] };

export type OrderStatusGroup = 'processing' | 'closed';
export interface OrderListFilter {
  status?: string;
  group?: OrderStatusGroup;
}

// Bug 1 fix: truoc day khong truyen page/limit -> BE mac dinh page=1 limit=20, khach co >20 don
// khong bao gio xem duoc don cu hon qua app. Nhan them page/limit de orders.tsx phan trang duoc.
export const fetchOrders = (filter: OrderListFilter = {}, page = 1, limit = 20) =>
  api
    .get<PageResponse<OrderView>>('/orders', {
      params: {
        ...(filter.status ? { status: filter.status } : filter.group ? { group: filter.group } : {}),
        page,
        limit,
      },
    })
    .then((r) => r.data);
export const fetchOrder = (code: string) =>
  api.get<OrderView>(`/orders/${code}`).then((r) => r.data);
/** Badge tab Đơn hàng. Dữ liệu lạ (vd mock/route khác trả nhầm) → 0 thay vì NaN. */
export const fetchActiveOrderCount = () =>
  api.get<{ count?: unknown }>('/orders/active-count').then((r) => (typeof r.data?.count === 'number' ? r.data.count : 0));

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  lastPurchasedAt: string;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
}
export const fetchPurchasedItems = (params: { cursor?: string; limit?: number; variationId?: string } = {}) =>
  api.get<PurchasedItemsPage>('/me/purchased-items', { params }).then((r) => r.data);

export type RepurchaseAddSource = 'repurchase' | 'reorder_notification';
export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK';
export interface RepurchaseLineResult {
  orderItemId: string;
  status: 'added' | 'partial' | 'skipped';
  reason?: RepurchaseSkipReason;
  addedQuantity: number;
}
export interface RepurchaseResponse {
  cart: CartSummary;
  results: RepurchaseLineResult[];
  /** API cũ (trước dự án 4a) trả giỏ trơn, không có results. */
  legacy: boolean;
}
/** API v2 trả giỏ ở top-level + `results` (để bản miniapp cũ vẫn đọc được giỏ) — tách lại ở đây. */
export function normalizeRepurchaseResponse(raw: CartSummary & { results?: RepurchaseLineResult[] }): RepurchaseResponse {
  const { results, ...cart } = raw;
  return Array.isArray(results) ? { cart, results, legacy: false } : { cart, results: [], legacy: true };
}
export const repurchaseOrder = (
  code: string,
  body: { items?: { orderItemId: string; quantity: number }[]; addSource?: RepurchaseAddSource } = {},
) =>
  api
    .post<CartSummary & { results?: RepurchaseLineResult[] }>(`/orders/${code}/repurchase`, body)
    .then((r) => normalizeRepurchaseResponse(r.data));
```

`services/buy-flow-events.ts`:

```ts
import { trackEvent } from './analytics';

/** Điểm vào luồng mua lại (spec §3.4). Tên event tự do ở server (@IsString) — không cần đổi DTO. */
export type ReorderSource = 'home_rail' | 'order_card' | 'order_detail' | 'notification' | 'orders_tab';

export function trackReorderClicked(p: { source: ReorderSource; orderCode?: string; variationId?: string }): void {
  trackEvent('reorder_clicked', 'miniapp', { ...p });
}

export function trackReorderCompleted(p: { source: ReorderSource; added: number; skipped: number }): void {
  trackEvent('reorder_completed', 'miniapp', { ...p });
}

export function trackReorderReminderCta(notificationId: string): void {
  trackEvent('reorder_reminder_cta', 'miniapp', { notificationId }, { notificationId });
}
```

Note: `trackReorderClicked({ source: 'order_card', orderCode: 'TUBU1' })` spreads to `{ source, orderCode }` — no `variationId: undefined` key, which the test's `toHaveBeenLastCalledWith` requires.

`hooks/use-public-config.ts` — add to `PUBLIC_CONFIG_FALLBACK`:

```ts
  // Không hứa ngày giao khi server chưa xác nhận cấu hình (dự án 4a, Ruling 9).
  shippingEta: null,
```

Call-site compatibility:
- `pages/orders.tsx:47`: `queryFn: ({ pageParam }) => fetchOrders(tab ? { status: tab } : {}, pageParam, PAGE_LIMIT),`
- `pages/order-detail.tsx:141-149` (`repurchase` mutation): `onSuccess: (r) => { queryClient.setQueryData(['cart'], r.cart); haptic('medium'); navigate('/cart'); },` (Task 19 replaces this whole mutation with the sheet).

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/services src/hooks` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/services/shop-api.ts src/services/buy-flow-events.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/services/shop-api.ts apps/miniapp/src/services/shop-api.spec.ts apps/miniapp/src/services/buy-flow-events.ts apps/miniapp/src/services/buy-flow-events.spec.ts apps/miniapp/src/hooks/use-public-config.ts apps/miniapp/src/hooks/use-public-config.spec.ts apps/miniapp/src/pages/orders.tsx apps/miniapp/src/pages/order-detail.tsx
git commit -m "feat(miniapp): buy-flow API client types, repurchase v2 normalizer and reorder events" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Miniapp — `CountBadge`, `useCartCount`, `CartButton` in Home and Browse headers

**Files:**
- Modify: `apps/miniapp/src/components/ui/cart-badge.tsx`
- Create: `apps/miniapp/src/components/ui/cart-badge.spec.tsx`
- Create: `apps/miniapp/src/hooks/use-cart-count.ts`
- Create: `apps/miniapp/src/components/cart-button.tsx`
- Create: `apps/miniapp/src/components/cart-button.spec.tsx`
- Modify: `apps/miniapp/src/pages/home.tsx:3-4,17,34,106-115`
- Modify: `apps/miniapp/src/pages/browse.tsx:3-4,15-17,51-53,180-204`

**Interfaces:**
- Consumes: `getCart` (`services/shop-api.ts`), `useAuthStore`.
- Produces:
  - `CountBadge({ count: number; label: string; bounce?: boolean }): JSX.Element | null` (null when `count <= 0`, "99+" above 99, DS tokens `--color-promo-solid-bg/fg`, `--radius-pill`)
  - `CartBadge({ count: number; bounce?: boolean })` (unchanged signature; now wraps `CountBadge`)
  - `useCartCount(): number` — `useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: authed })`, `itemCount ?? 0`
  - `CartButton(): JSX.Element` — 44×44 `<button aria-label="Giỏ hàng">` (or `"Giỏ hàng, N sản phẩm"` when N>0), navigates to `/cart`.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/ui/cart-badge.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CartBadge, CountBadge } from './cart-badge';

describe('CountBadge / CartBadge', () => {
  it('ẩn khi count <= 0', () => {
    const { container } = render(<CountBadge count={0} label="x" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('hiện số, 99+ khi quá 99, aria-label theo nhãn truyền vào', () => {
    const { rerender } = render(<CountBadge count={7} label="7 đơn đang xử lý" />);
    expect(screen.getByLabelText('7 đơn đang xử lý')).toHaveTextContent('7');
    rerender(<CountBadge count={120} label="nhiều" />);
    expect(screen.getByLabelText('nhiều')).toHaveTextContent('99+');
  });
  it('CartBadge giữ nhãn cũ "N sản phẩm trong giỏ" và dùng token DS v2 (không --clay-500/--neutral-0)', () => {
    render(<CartBadge count={2} />);
    const el = screen.getByLabelText('2 sản phẩm trong giỏ');
    expect(el.getAttribute('style')).toContain('var(--color-promo-solid-bg)');
    expect(el.getAttribute('style')).not.toMatch(/--clay-500|--neutral-0/);
  });
});
```

`apps/miniapp/src/components/cart-button.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), getCart: vi.fn(), status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('zmp-ui')>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({ getCart: mocks.getCart }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { CartButton } from './cart-button';

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CartButton /></QueryClientProvider>);
}

describe('CartButton + useCartCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });

  it('badge = itemCount của giỏ; nhãn a11y gồm số lượng; vùng chạm 44px; bấm → /cart', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 3 });
    renderButton();
    const btn = await screen.findByRole('button', { name: 'Giỏ hàng, 3 sản phẩm' });
    expect(btn).toHaveStyle({ width: '44px', height: '44px' });
    expect(screen.getByLabelText('3 sản phẩm trong giỏ')).toHaveTextContent('3');
    fireEvent.click(btn);
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('giỏ rỗng → nhãn đúng "Giỏ hàng" (e2e miniapp.spec dùng [aria-label="Giỏ hàng"])', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 0 });
    renderButton();
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });

  it('chưa đăng nhập → không gọi /cart (tránh 401 lúc restore chưa xong)', () => {
    mocks.status = 'loading';
    renderButton();
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/cart-badge.spec.tsx src/components/cart-button.spec.tsx`
Expected: FAIL — `CountBadge` / `./cart-button` not found.

- [ ] **Step 3: Implement**

`components/ui/cart-badge.tsx`:

```tsx
/**
 * Huy hiệu đếm trên icon (giỏ hàng, tab Đơn hàng). Đặt trong phần tử `position: relative`.
 * Trước đây Trang chủ/Duyệt dùng `--clay-500`, trang sản phẩm dùng `--primary-600` — cùng con số
 * mà hai màu. Nay một nguồn, token DS v2.
 */
export function CountBadge({ count, label, bounce }: { count: number; label: string; bounce?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={bounce ? 'tubu-bounce' : undefined}
      aria-label={label}
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-promo-solid-bg)',
        color: 'var(--color-promo-solid-fg)',
        fontSize: 11,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 4px',
        boxSizing: 'border-box',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function CartBadge({ count, bounce }: { count: number; bounce?: boolean }) {
  return <CountBadge count={count} bounce={bounce} label={`${count} sản phẩm trong giỏ`} />;
}
```

`hooks/use-cart-count.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { getCart } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

/** Số món trong giỏ cho header — một hook thay 3 bản useQuery(['cart']) lặp (spec §3.5). Dùng
 * chung queryKey ['cart'] nên không phát sinh request mới; gate theo auth tránh 401. */
export function useCartCount(): number {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: authed }).data?.itemCount ?? 0;
}
```

`components/cart-button.tsx`:

```tsx
import { ShoppingCart } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { useCartCount } from '../hooks/use-cart-count';
import { haptic } from '../utils/haptic';
import { Icon } from './ui/icon';
import { CartBadge } from './ui/cart-badge';

/** Nút giỏ dùng chung ở header các trang mua sắm (spec §3.5). */
export function CartButton() {
  const navigate = useNavigate();
  const count = useCartCount();
  return (
    <button
      type="button"
      aria-label={count > 0 ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        navigate('/cart');
      }}
      style={{
        position: 'relative',
        flex: '0 0 auto',
        width: 44,
        height: 44,
        padding: 0,
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-action-secondary-bg)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      <Icon icon={ShoppingCart} size="md" tone="brand" />
      <CartBadge count={count} />
    </button>
  );
}
```

Note: the e2e `miniapp.spec.ts` uses `[aria-label="Giỏ hàng"]` with an empty cart, which still matches.

`pages/home.tsx`:
- line 3: remove `ShoppingCart` from the lucide import.
- line 4: `import { fetchProducts, fetchBrands, fetchForYou } from '../services/shop-api';`
- line 17: replace `import { CartBadge } from '../components/ui/cart-badge';` with `import { CartButton } from '../components/cart-button';`
- delete line 34 (`const cartCount = ...`) and its comment line 33.
- replace the whole cart `<Box role="button" aria-label="Giỏ hàng" ...>...</Box>` (lines 106-115) with `<CartButton />`.

`pages/browse.tsx`:
- line 4: `import { fetchProducts, fetchBrands } from '../services/shop-api';`
- delete lines 15-17 (`ShoppingCart`, `useAuthStore`, `CartBadge` imports) and add `import { CartButton } from '../components/cart-button';`
- delete lines 51-53 (comment + `authed` + `cartCount`).
- replace the cart `<Box role="button" aria-label="Giỏ hàng" ...>...</Box>` block (keep the comment above it) with `<CartButton />`.

- [ ] **Step 4: Run tests, types, lint, e2e smoke**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/cart-button.tsx src/components/ui/cart-badge.tsx src/hooks/use-cart-count.ts` → clean.
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test miniapp.spec --workers=1` → PASS ("Icon Giỏ hàng điều hướng đến /cart").

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/ui/cart-badge.tsx apps/miniapp/src/components/ui/cart-badge.spec.tsx apps/miniapp/src/hooks/use-cart-count.ts apps/miniapp/src/components/cart-button.tsx apps/miniapp/src/components/cart-button.spec.tsx apps/miniapp/src/pages/home.tsx apps/miniapp/src/pages/browse.tsx
git commit -m "feat(miniapp): shared CartButton and useCartCount in Home and Browse headers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Miniapp — `nav-config.ts`, tab "Đơn hàng" with badge, root pages, Profile hub

**Files:**
- Create: `apps/miniapp/src/components/nav-config.ts`, `apps/miniapp/src/components/nav-config.spec.ts`
- Create: `apps/miniapp/src/hooks/use-active-order-count.ts`, `apps/miniapp/src/hooks/use-active-order-count.spec.tsx`
- Rewrite: `apps/miniapp/src/components/bottom-nav.tsx`; Create: `apps/miniapp/src/components/bottom-nav.spec.tsx`
- Modify: `apps/miniapp/src/components/back-button.tsx:15,24,57-58`; Create: `apps/miniapp/src/components/back-button.spec.tsx`
- Modify: `apps/miniapp/src/pages/profile.tsx:4,52-65` (`export const MENU`, remove two items); Create: `apps/miniapp/src/pages/profile.spec.ts`
- Modify: `apps/miniapp/src/i18n/vi.ts` (add `nav` block)
- Modify: `apps/e2e/tests/support/mock-api.ts` (`mockSession` default for `/orders/active-count`)

**Interfaces:**
- Consumes: `fetchActiveOrderCount` (Task 9), `CountBadge` (Task 10), `Icon`, `Text`.
- Produces:
  - `interface NavTab { path: string; label: string; Icon: LucideIcon; center?: boolean; badge?: 'active-orders' }`
  - `const NAV_TABS: readonly NavTab[]` = `/`, `/browse`, `/game` (center), `/orders` (badge), `/profile`
  - `const ROOT_PATHS: readonly string[]`; `function isRootPath(pathname: string): boolean`
  - `const ACTIVE_ORDER_COUNT_KEY = ['orders', 'active-count'] as const`; `useActiveOrderCount(enabled: boolean): number`
  - `vi.nav = { main: 'Điều hướng chính', activeOrders: (n) => '<n> đơn đang xử lý', tabWithActiveOrders: (label, n) => '<label>, <n> đơn đang xử lý' }`
  - `BottomNav` renders `<nav aria-label="Điều hướng chính">` with 5 `<button>`s; the Orders tab's accessible name is `"Đơn hàng, N đơn đang xử lý"` when N > 0.
  - `export const MENU` in `profile.tsx` (no `/orders`, no `/subscriptions`).

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/nav-config.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_TABS, ROOT_PATHS, isRootPath } from './nav-config';

describe('nav-config — nguồn duy nhất cho tab bar + ROOTS (spec §3.5, 4a.1)', () => {
  it('5 tab, "Đơn hàng" thay "Ví & HH", Vườn Xanh ở giữa', () => {
    expect(NAV_TABS.map((t) => t.path)).toEqual(['/', '/browse', '/game', '/orders', '/profile']);
    expect(NAV_TABS.map((t) => t.label)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Đơn hàng', 'Cá nhân']);
    expect(NAV_TABS[2]!.center).toBe(true);
    expect(NAV_TABS[3]!.badge).toBe('active-orders');
  });
  it('/orders là trang gốc; /wallet thành trang con', () => {
    expect(ROOT_PATHS).toContain('/orders');
    expect(isRootPath('/orders')).toBe(true);
    expect(isRootPath('/wallet')).toBe(false);
    expect(isRootPath('/order/TUBU1')).toBe(false);
  });
});
```

`apps/miniapp/src/hooks/use-active-order-count.spec.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActiveOrderCount: vi.fn(), status: 'authenticated' }));
vi.mock('../services/shop-api', () => ({ fetchActiveOrderCount: mocks.fetchActiveOrderCount }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { useActiveOrderCount } from './use-active-order-count';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useActiveOrderCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });
  it('trả số đơn đang xử lý', async () => {
    mocks.fetchActiveOrderCount.mockResolvedValue(2);
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
  it('trang con (enabled=false) hoặc chưa đăng nhập → không gọi API, 0', () => {
    renderHook(() => useActiveOrderCount(false), { wrapper });
    mocks.status = 'loading';
    renderHook(() => useActiveOrderCount(true), { wrapper });
    expect(mocks.fetchActiveOrderCount).not.toHaveBeenCalled();
  });
  it('API cũ 404 → 0, không ném', async () => {
    mocks.fetchActiveOrderCount.mockRejectedValue(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
    const { result } = renderHook(() => useActiveOrderCount(true), { wrapper });
    await waitFor(() => expect(mocks.fetchActiveOrderCount).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});
```

`apps/miniapp/src/components/bottom-nav.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/', count: 0 }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname, search: '', state: null }),
}));
vi.mock('../hooks/use-active-order-count', () => ({ useActiveOrderCount: (enabled: boolean) => (enabled ? mocks.count : 0) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BottomNav from './bottom-nav';

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    mocks.count = 0;
  });

  it('5 tab trong <nav>, có "Đơn hàng", không còn "Ví & HH"; mỗi tab cao ≥44px', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(nav).toHaveTextContent('Đơn hàng');
    expect(nav).not.toHaveTextContent('Ví & HH');
    expect(nav).toHaveStyle({ height: 'calc(60px + var(--safe-bottom))' });
  });

  it('badge số đơn đang xử lý trên tab Đơn hàng + nhãn a11y', () => {
    mocks.count = 2;
    render(<BottomNav />);
    const tab = screen.getByRole('button', { name: 'Đơn hàng, 2 đơn đang xử lý' });
    expect(tab).toHaveTextContent('2');
  });

  it('bấm tab khác → navigate; tab đang mở có aria-current=page', () => {
    mocks.pathname = '/orders';
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: 'Đơn hàng' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Cá nhân' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile');
  });

  it('ẩn ở trang con (vd /wallet đã thành trang con)', () => {
    mocks.pathname = '/wallet';
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it('không còn biến CSS cũ --neutral/--leaf/--primary', () => {
    const { container } = render(<BottomNav />);
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary)-/);
  });
});
```

`apps/miniapp/src/components/back-button.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), location: { pathname: '/orders', search: '', state: null as unknown } }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
}));
vi.mock('../store/storefront-context', () => ({
  useStorefrontContext: (sel: (s: { slug: null; kind: null }) => unknown) => sel({ slug: null, kind: null }),
}));

import BackButton from './back-button';

describe('BackButton — ROOTS từ nav-config', () => {
  beforeEach(() => {
    mocks.location = { pathname: '/orders', search: '', state: null };
  });
  it('/orders là trang gốc → không có nút back', () => {
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  });
  it('/wallet giờ là trang con → có nút back, dùng token (không rgba thô)', () => {
    mocks.location = { pathname: '/wallet', search: '', state: { from: '/profile' } };
    render(<BackButton />);
    const btn = screen.getByRole('button', { name: 'Quay lại' });
    expect(btn.getAttribute('style')).not.toContain('rgba(');
  });
});
```

`apps/miniapp/src/pages/profile.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Avatar: () => null, Spinner: () => null,
  useNavigate: () => () => undefined, useSnackbar: () => ({ openSnackbar: () => undefined }),
}));
vi.mock('zmp-sdk/apis', () => ({ vibrate: async () => ({}), setStorage: async () => ({}), getStorage: async () => ({}), removeStorage: async () => ({}) }));

import { MENU } from './profile';

describe('Hub Cá nhân (spec 4a.1)', () => {
  const targets = MENU.flatMap((s) => s.items.map((i) => i.to));
  it('bỏ mục đã có ở tab bar: Đơn hàng, Đặt định kỳ', () => {
    expect(targets).not.toContain('/orders');
    expect(targets).not.toContain('/subscriptions');
  });
  it('giữ Ví, Ưu đãi (Điểm Xanh), Yêu thích, Sổ địa chỉ', () => {
    expect(targets).toEqual(expect.arrayContaining(['/wallet', '/loyalty', '/wishlist', '/addresses']));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/nav-config.spec.ts src/hooks/use-active-order-count.spec.tsx src/components/bottom-nav.spec.tsx src/components/back-button.spec.tsx src/pages/profile.spec.ts`
Expected: FAIL — missing modules, "Ví & HH" present, `MENU` not exported.

- [ ] **Step 3: Implement**

`i18n/vi.ts` — insert before the line `  orderStatus: {`:

```ts
  nav: {
    main: 'Điều hướng chính',
    activeOrders: (n: number) => `${n} đơn đang xử lý`,
    tabWithActiveOrders: (label: string, n: number) => `${label}, ${n} đơn đang xử lý`,
  },

```

`components/nav-config.ts`:

```ts
import { Home, LayoutGrid, Package, Sprout, User, type LucideIcon } from 'lucide-react';

/**
 * Nguồn DUY NHẤT cho tab bar + danh sách trang gốc (spec §3.5). Trước đây ROOTS chép tay ở
 * back-button.tsx và bottom-nav.tsx — đổi một chỗ quên chỗ kia là nút back hiện trên trang gốc.
 * Tab "Đơn hàng" thay "Ví & HH" (4a.1): Ví chuyển vào Cá nhân.
 */
export interface NavTab {
  path: string;
  label: string;
  Icon: LucideIcon;
  center?: boolean;
  badge?: 'active-orders';
}

export const NAV_TABS: readonly NavTab[] = [
  { path: '/', label: 'Trang chủ', Icon: Home },
  { path: '/browse', label: 'Danh mục', Icon: LayoutGrid },
  { path: '/game', label: 'Vườn Xanh', Icon: Sprout, center: true },
  { path: '/orders', label: 'Đơn hàng', Icon: Package, badge: 'active-orders' },
  { path: '/profile', label: 'Cá nhân', Icon: User },
];

export const ROOT_PATHS: readonly string[] = NAV_TABS.map((t) => t.path);

export function isRootPath(pathname: string): boolean {
  return ROOT_PATHS.includes(pathname);
}
```

`hooks/use-active-order-count.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchActiveOrderCount } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

/** Khoá nằm dưới tiền tố ['orders'] → mọi invalidateQueries({ queryKey: ['orders'] }) sẵn có
 * (đặt đơn, huỷ đơn) làm mới luôn badge. */
export const ACTIVE_ORDER_COUNT_KEY = ['orders', 'active-count'] as const;

/** Số đơn đang xử lý cho badge tab. `enabled` = đang ở trang gốc (tab bar hiện). API cũ 404 → 0. */
export function useActiveOrderCount(enabled: boolean): number {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const q = useQuery({
    queryKey: ACTIVE_ORDER_COUNT_KEY,
    queryFn: fetchActiveOrderCount,
    enabled: enabled && authed,
    staleTime: 30_000,
    retry: false,
  });
  return q.data ?? 0;
}
```

`components/bottom-nav.tsx` (full rewrite):

```tsx
import { useNavigate, useLocation } from 'zmp-ui';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { useActiveOrderCount } from '../hooks/use-active-order-count';
import { NAV_TABS, isRootPath, type NavTab } from './nav-config';
import { Icon } from './ui/icon';
import { Text } from './ui/text';
import { CountBadge } from './ui/cart-badge';

/**
 * Tab bar 5 tab (spec 4a.1): Trang chủ · Danh mục · Vườn Xanh (nút tròn nổi giữa) · Đơn hàng
 * (badge đơn đang xử lý) · Cá nhân. Dữ liệu tab lấy từ nav-config.ts. Ẩn ở trang con.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isRoot = isRootPath(pathname);
  const activeOrders = useActiveOrderCount(isRoot);
  if (!isRoot) return null;

  const go = (t: NavTab) => {
    if (pathname === t.path) return;
    haptic('light');
    navigate(t.path);
  };

  return (
    <nav
      aria-label={vi.nav.main}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 'calc(60px + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-subtle)',
        boxShadow: 'var(--elevation-3)',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 100,
      }}
    >
      {NAV_TABS.map((t) => {
        const active = pathname === t.path;
        const count = t.badge === 'active-orders' ? activeOrders : 0;
        return (
          <button
            key={t.path}
            type="button"
            aria-label={count > 0 ? vi.nav.tabWithActiveOrders(t.label, count) : t.label}
            aria-current={active ? 'page' : undefined}
            className="tubu-press"
            onClick={() => go(t)}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              position: 'relative',
              border: 'none',
              padding: 0,
              paddingBottom: t.center ? 6 : 0,
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: t.center ? 'flex-end' : 'center',
              gap: 3,
            }}
          >
            {t.center ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -22,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 54,
                  height: 54,
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--color-action-primary-bg)',
                  border: '3px solid var(--color-bg-surface)',
                  boxShadow: 'var(--elevation-2)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon icon={t.Icon} size="lg" tone="inverse" />
              </span>
            ) : (
              <span aria-hidden style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <Icon icon={t.Icon} size="lg" tone={active ? 'brand' : 'muted'} />
                <CountBadge count={count} label={vi.nav.activeOrders(count)} />
              </span>
            )}
            <Text variant="caption" tone={active ? 'brand' : 'tertiary'} style={{ fontWeight: active ? 700 : 500 }}>
              {t.label}
            </Text>
          </button>
        );
      })}
    </nav>
  );
}
```

`components/back-button.tsx`:
- replace line 15 `const ROOTS = [...]` with `import { isRootPath } from './nav-config';` (move into the import block at the top) and update the doc comment line "Ẩn ở các tab gốc (đã có BottomNav)." to "Ẩn ở các tab gốc (nav-config.ts — đã có BottomNav)."
- line 24: `const show = !isRootPath(location.pathname) || Boolean(fromPath);`
- lines 57-58: `background: 'var(--color-bg-surface)',` and `boxShadow: 'var(--elevation-2)',`

`pages/profile.tsx`:
- line 4: remove `Package, Repeat,` from the lucide import (no other use in the file).
- line 52: `export const MENU: { group: string; items: MenuItem[] }[] = [`
- delete the two items `{ Icon: Package, label: 'Đơn hàng của tôi', to: '/orders' },` and `{ Icon: Repeat, label: 'Đặt định kỳ', to: '/subscriptions' },`. (`READY` keeps both paths — harmless and still valid routes.)

`apps/e2e/tests/support/mock-api.ts` — inside `mockSession`, after `api.get('/me', me);`:

```ts
  // Mặc định cho khối dùng chung toàn app (dự án 4a): badge tab Đơn hàng gọi ở MỌI trang gốc.
  // Spec cần số khác thì đăng ký lại SAU (đăng ký sau thắng) — và phải đăng ký SAU mọi mock
  // '/orders/:code' vì pattern đó cũng khớp '/orders/active-count'.
  api.get('/orders/active-count', { count: 0 });
```

- [ ] **Step 4: Run tests, types, lint, e2e regressions**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/nav-config.ts src/components/bottom-nav.tsx src/components/back-button.tsx src/hooks/use-active-order-count.ts` → clean.
Run: `pnpm lint:vars` → OK.
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test miniapp.spec features.miniapp --workers=1` → PASS (root pages now call `/orders/active-count`, served by the default mock).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/nav-config.ts apps/miniapp/src/components/nav-config.spec.ts apps/miniapp/src/hooks/use-active-order-count.ts apps/miniapp/src/hooks/use-active-order-count.spec.tsx apps/miniapp/src/components/bottom-nav.tsx apps/miniapp/src/components/bottom-nav.spec.tsx apps/miniapp/src/components/back-button.tsx apps/miniapp/src/components/back-button.spec.tsx apps/miniapp/src/pages/profile.tsx apps/miniapp/src/pages/profile.spec.ts apps/miniapp/src/i18n/vi.ts apps/e2e/tests/support/mock-api.ts
git commit -m "feat(miniapp): Orders tab replaces wallet tab, shared nav config and active-order badge" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Miniapp — reorder model (`reorder-types.ts`) and result summary (`reorder-summary.ts`)

**Files:**
- Create: `apps/miniapp/src/components/reorder/reorder-types.ts`, `apps/miniapp/src/components/reorder/reorder-types.spec.ts`
- Create: `apps/miniapp/src/components/reorder/reorder-summary.ts`, `apps/miniapp/src/components/reorder/reorder-summary.spec.ts`
- Modify: `apps/miniapp/src/i18n/vi.ts` (add `reorder` block)

**Interfaces:**
- Consumes: `OrderItemView`, `PurchasedItem`, `RepurchaseResponse`, `RepurchaseSkipReason` (Task 9); `ReorderSource` (Task 9, re-exported).
- Produces:
  - `MAX_REORDER_QTY = 99`
  - `interface ReorderLine { key: string; variationId: string; productName: string; variationName: string; thumbnail: string | null; unitPrice: number; defaultQuantity: number; maxQuantity: number; available: boolean }` (`key` = `orderItemId` for orders, `variationId` for single items)
  - `type ReorderTarget = { kind: 'order'; orderCode: string; lines: ReorderLine[] } | { kind: 'item'; line: ReorderLine }`
  - `interface LineSelection { checked: boolean; quantity: number }`; `interface ReorderSelection { key: string; variationId: string; quantity: number }`
  - `lineFromOrderItem(it: OrderItemView): ReorderLine`, `lineFromPurchasedItem(p: PurchasedItem): ReorderLine`
  - `orderReorderTarget(order: { code: string; items: OrderItemView[] }): ReorderTarget`, `itemReorderTarget(p: PurchasedItem): ReorderTarget`
  - `targetLines(t: ReorderTarget): ReorderLine[]`, `initialSelection(t): Record<string, LineSelection>`, `selectedLines(t, sel): ReorderSelection[]`, `selectionTotals(t, sel): { units: number; subtotal: number }`
  - `interface ReorderSummary { addedLines: number; skippedLines: number; addedUnits: number; hasProblems: boolean; message: string }`; `summarizeReorder(res: RepurchaseResponse, lines: ReorderLine[], selections: ReorderSelection[]): ReorderSummary`
  - `vi.reorder` strings (used by Tasks 13-20, exact text below).

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/reorder/reorder-types.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { OrderItemView, PurchasedItem } from '../../services/shop-api';
import {
  MAX_REORDER_QTY, initialSelection, itemReorderTarget, lineFromOrderItem, lineFromPurchasedItem,
  orderReorderTarget, selectedLines, selectionTotals,
} from './reorder-types';

const orderItem = (over: Partial<OrderItemView> = {}): OrderItemView => ({
  id: 'oi1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh',
  unitPrice: 60000, quantity: 2, total: 120000, backorderedQty: 0, ...over,
});
const purchased = (over: Partial<PurchasedItem> = {}): PurchasedItem => ({
  variationId: 'v1', productId: 'p1', slug: 'nrc', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: 59000, stock: 4, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z', ...over,
});

describe('reorder-types', () => {
  it('dòng đơn: giá hiện tại (currentPrice) thay giá lúc mua; SL mặc định = SL cũ, kẹp theo tồn', () => {
    const l = lineFromOrderItem(orderItem({ currentPrice: 65000, stock: 1, available: true, thumbnail: 'x.jpg' }));
    expect(l).toEqual({
      key: 'oi1', variationId: 'v1', productName: 'Nước rửa chén', variationName: 'Chanh', thumbnail: 'x.jpg',
      unitPrice: 65000, defaultQuantity: 1, maxQuantity: 1, available: true,
    });
  });

  it('dòng đơn hết hàng / không khả dụng → available=false', () => {
    expect(lineFromOrderItem(orderItem({ stock: 0, available: false })).available).toBe(false);
    expect(lineFromOrderItem(orderItem({ stock: 5, available: false })).available).toBe(false);
  });

  it('API cũ không trả stock/available → coi như khả dụng, max 99, giá lúc mua', () => {
    const l = lineFromOrderItem(orderItem());
    expect(l).toMatchObject({ available: true, maxQuantity: MAX_REORDER_QTY, unitPrice: 60000, defaultQuantity: 2 });
  });

  it('SP đã mua: key = variationId, giá sale, SL 1, max = tồn', () => {
    expect(lineFromPurchasedItem(purchased())).toMatchObject({ key: 'v1', unitPrice: 59000, defaultQuantity: 1, maxQuantity: 4, available: true });
    expect(lineFromPurchasedItem(purchased({ stock: 0, inStock: false })).available).toBe(false);
  });

  it('lựa chọn ban đầu chỉ tick dòng khả dụng; tổng tính theo dòng được chọn', () => {
    const t = orderReorderTarget({
      code: 'TUBU1',
      items: [orderItem({ id: 'a', stock: 10, available: true, currentPrice: 10000, quantity: 2 }), orderItem({ id: 'b', stock: 0, available: false })],
    });
    const sel = initialSelection(t);
    expect(sel).toEqual({ a: { checked: true, quantity: 2 }, b: { checked: false, quantity: 2 } });
    expect(selectedLines(t, sel)).toEqual([{ key: 'a', variationId: 'v1', quantity: 2 }]);
    expect(selectionTotals(t, sel)).toEqual({ units: 2, subtotal: 20000 });
  });

  it('dòng không khả dụng không bao giờ được gửi dù state bị tick; SL bị kẹp 1..max', () => {
    const t = itemReorderTarget(purchased({ stock: 3 }));
    expect(selectedLines(t, { v1: { checked: true, quantity: 50 } })).toEqual([{ key: 'v1', variationId: 'v1', quantity: 3 }]);
    const out = itemReorderTarget(purchased({ stock: 0, inStock: false }));
    expect(selectedLines(out, { v1: { checked: true, quantity: 1 } })).toEqual([]);
  });
});
```

`apps/miniapp/src/components/reorder/reorder-summary.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CartSummary } from '../../services/shop-api';
import { summarizeReorder } from './reorder-summary';
import type { ReorderLine } from './reorder-types';

const CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
const line = (key: string, productName: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName, variationName: '', thumbnail: null, unitPrice: 1, defaultQuantity: 1, maxQuantity: 9, available: true,
});
const lines = [line('a', 'Nước rửa chén'), line('b', 'Xà phòng'), line('c', 'Nước lau sàn')];

describe('summarizeReorder', () => {
  it('thêm đủ → "Đã thêm N món vào giỏ"', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] }, lines, []);
    expect(s).toEqual({ addedLines: 1, skippedLines: 0, addedUnits: 2, hasProblems: false, message: 'Đã thêm 2 món vào giỏ' });
  });

  it('có dòng bị bỏ qua / thiếu → nêu tên + lý do tiếng Việt', () => {
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'added', addedQuantity: 1 },
          { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 },
        ],
      },
      lines,
      [],
    );
    expect(s.addedLines).toBe(2);
    expect(s.skippedLines).toBe(1);
    expect(s.addedUnits).toBe(2);
    expect(s.hasProblems).toBe(true);
    expect(s.message).toBe('Đã thêm 2 món vào giỏ. Chưa thêm đủ: Xà phòng (hết hàng), Nước lau sàn (chỉ thêm được 1)');
  });

  it('không thêm được gì → câu báo lỗi, addedUnits 0; NOT_APPROVED hiển thị như "ngừng bán"', () => {
    const s = summarizeReorder(
      { cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'skipped', reason: 'NOT_APPROVED', addedQuantity: 0 }] },
      lines,
      [],
    );
    expect(s.addedUnits).toBe(0);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (ngừng bán)');
  });

  it('API cũ (legacy) → coi như thêm đủ các dòng đã chọn', () => {
    const s = summarizeReorder({ cart: CART, legacy: true, results: [] }, lines, [
      { key: 'a', variationId: 'v-a', quantity: 2 },
      { key: 'b', variationId: 'v-b', quantity: 1 },
    ]);
    expect(s).toEqual({ addedLines: 2, skippedLines: 0, addedUnits: 3, hasProblems: false, message: 'Đã thêm vào giỏ' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`i18n/vi.ts` — insert before the line `  orderStatus: {` (after the `nav` block from Task 11):

```ts
  reorder: {
    railTitle: 'Mua lại',
    timesBought: (n: number) => `Đã mua ${n} lần`,
    sheetTitle: 'Mua lại',
    fromOrder: (code: string) => `Từ đơn ${code}`,
    selectLine: (name: string) => `Chọn ${name}`,
    unavailable: 'Tạm hết hàng',
    subtotal: 'Tạm tính',
    priceNote: 'Giá theo hiện tại, xem chính xác ở giỏ hàng.',
    addCta: (n: number) => `Thêm vào giỏ (${n})`,
    added: (n: number) => `Đã thêm ${n} món vào giỏ`,
    addedGeneric: 'Đã thêm vào giỏ',
    notFullyAdded: 'Chưa thêm đủ',
    nothingAdded: 'Chưa thêm được món nào vào giỏ',
    partial: (n: number) => `chỉ thêm được ${n}`,
    unknownProduct: 'Sản phẩm',
    reasons: {
      OUT_OF_STOCK: 'hết hàng',
      INACTIVE: 'ngừng bán',
      NOT_APPROVED: 'ngừng bán',
      EXCEEDS_STOCK: 'không đủ hàng',
    },
    viewCart: 'Xem giỏ',
    cardCta: 'Mua lại',
    reminderCta: 'Mua lại ngay',
  },

```

`components/reorder/reorder-types.ts`:

```ts
import type { OrderItemView, PurchasedItem } from '../../services/shop-api';

export type { ReorderSource } from '../../services/buy-flow-events';

/** Trần số lượng khi API không cho biết tồn kho (API cũ) — server vẫn kẹp theo tồn thật. */
export const MAX_REORDER_QTY = 99;

/** Một dòng trong ReorderSheet. `key` = orderItemId (mua lại cả đơn) hoặc variationId (1 SP). */
export interface ReorderLine {
  key: string;
  variationId: string;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  unitPrice: number;
  defaultQuantity: number;
  maxQuantity: number;
  available: boolean;
}

export type ReorderTarget =
  | { kind: 'order'; orderCode: string; lines: ReorderLine[] }
  | { kind: 'item'; line: ReorderLine };

export interface LineSelection {
  checked: boolean;
  quantity: number;
}

export interface ReorderSelection {
  key: string;
  variationId: string;
  quantity: number;
}

const clampQty = (n: number, max: number) => Math.max(1, Math.min(Math.floor(n) || 1, Math.max(max, 1)));

export function lineFromOrderItem(it: OrderItemView): ReorderLine {
  // API cũ không trả stock/available → coi như còn hàng (Ruling 19), server kẹp theo tồn thật.
  const stock = typeof it.stock === 'number' ? Math.max(it.stock, 0) : MAX_REORDER_QTY;
  const available = it.available !== false && stock > 0;
  const maxQuantity = Math.min(stock, MAX_REORDER_QTY);
  return {
    key: it.id,
    variationId: it.variationId,
    productName: it.productName,
    variationName: it.variationName,
    thumbnail: it.thumbnail ?? null,
    unitPrice: it.currentPrice ?? it.unitPrice,
    defaultQuantity: available ? clampQty(it.quantity, maxQuantity) : it.quantity,
    maxQuantity,
    available,
  };
}

export function lineFromPurchasedItem(p: PurchasedItem): ReorderLine {
  const stock = Math.max(p.stock, 0);
  return {
    key: p.variationId,
    variationId: p.variationId,
    productName: p.productName,
    variationName: p.variationName,
    thumbnail: p.thumbnail,
    unitPrice: p.salePrice ?? p.price,
    defaultQuantity: 1,
    maxQuantity: Math.min(stock, MAX_REORDER_QTY),
    available: p.inStock !== false && stock > 0,
  };
}

export function orderReorderTarget(order: { code: string; items: OrderItemView[] }): ReorderTarget {
  return { kind: 'order', orderCode: order.code, lines: order.items.map(lineFromOrderItem) };
}

export function itemReorderTarget(p: PurchasedItem): ReorderTarget {
  return { kind: 'item', line: lineFromPurchasedItem(p) };
}

export function targetLines(t: ReorderTarget): ReorderLine[] {
  return t.kind === 'order' ? t.lines : [t.line];
}

export function initialSelection(t: ReorderTarget): Record<string, LineSelection> {
  return Object.fromEntries(targetLines(t).map((l) => [l.key, { checked: l.available, quantity: l.defaultQuantity }]));
}

export function selectedLines(t: ReorderTarget, sel: Record<string, LineSelection>): ReorderSelection[] {
  return targetLines(t)
    .filter((l) => l.available && sel[l.key]?.checked)
    .map((l) => ({ key: l.key, variationId: l.variationId, quantity: clampQty(sel[l.key]!.quantity, l.maxQuantity) }));
}

export function selectionTotals(t: ReorderTarget, sel: Record<string, LineSelection>): { units: number; subtotal: number } {
  const price = new Map(targetLines(t).map((l) => [l.key, l.unitPrice]));
  return selectedLines(t, sel).reduce(
    (acc, s) => ({ units: acc.units + s.quantity, subtotal: acc.subtotal + s.quantity * (price.get(s.key) ?? 0) }),
    { units: 0, subtotal: 0 },
  );
}
```

`components/reorder/reorder-summary.ts`:

```ts
import { vi } from '../../i18n/vi';
import type { RepurchaseResponse } from '../../services/shop-api';
import type { ReorderLine, ReorderSelection } from './reorder-types';

export interface ReorderSummary {
  addedLines: number;
  skippedLines: number;
  addedUnits: number;
  hasProblems: boolean;
  message: string;
}

/** Câu báo kết quả mua lại — nêu rõ dòng nào không thêm được và vì sao (spec §3.3, §9). */
export function summarizeReorder(res: RepurchaseResponse, lines: ReorderLine[], selections: ReorderSelection[]): ReorderSummary {
  if (res.legacy) {
    const units = selections.reduce((s, x) => s + x.quantity, 0);
    return { addedLines: selections.length, skippedLines: 0, addedUnits: units, hasProblems: false, message: vi.reorder.addedGeneric };
  }
  const nameOf = (key: string) => lines.find((l) => l.key === key)?.productName ?? vi.reorder.unknownProduct;
  const addedUnits = res.results.reduce((s, r) => s + r.addedQuantity, 0);
  const addedLines = res.results.filter((r) => r.status !== 'skipped').length;
  const skippedLines = res.results.filter((r) => r.status === 'skipped').length;
  const problems = res.results
    .filter((r) => r.status !== 'added')
    .map((r) => `${nameOf(r.orderItemId)} (${r.status === 'partial' ? vi.reorder.partial(r.addedQuantity) : vi.reorder.reasons[r.reason ?? 'OUT_OF_STOCK']})`);
  const message =
    addedUnits > 0
      ? problems.length > 0
        ? `${vi.reorder.added(addedUnits)}. ${vi.reorder.notFullyAdded}: ${problems.join(', ')}`
        : vi.reorder.added(addedUnits)
      : `${vi.reorder.nothingAdded}: ${problems.join(', ')}`;
  return { addedLines, skippedLines, addedUnits, hasProblems: problems.length > 0, message };
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/reorder` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/reorder/reorder-types.ts apps/miniapp/src/components/reorder/reorder-types.spec.ts apps/miniapp/src/components/reorder/reorder-summary.ts apps/miniapp/src/components/reorder/reorder-summary.spec.ts apps/miniapp/src/i18n/vi.ts
git commit -m "feat(miniapp): reorder line model and Vietnamese result summary" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Miniapp — `useReorder(source)` hook

**Files:**
- Create: `apps/miniapp/src/hooks/use-reorder.ts`
- Create: `apps/miniapp/src/hooks/use-reorder.spec.tsx`

**Interfaces:**
- Consumes: `addToCart`, `repurchaseOrder` (Task 9), `trackReorderCompleted` (Task 9), `targetLines`, `ReorderTarget`, `ReorderSelection` (Task 12), `summarizeReorder`, `ReorderSummary` (Task 12), zmp `useNavigate`/`useSnackbar`.
- Produces:
  - `interface UseReorderOptions { navigateToCart?: boolean }`
  - `interface UseReorder { submit: (target: ReorderTarget, selections: ReorderSelection[]) => Promise<ReorderSummary>; isPending: boolean }`
  - `useReorder(source: ReorderSource, opts?: UseReorderOptions): UseReorder`
  - Behaviour: `item` target → `addToCart(variationId, qty, source === 'notification' ? 'reorder_notification' : 'repurchase')`; `order` target → `repurchaseOrder(code, { items, addSource: 'repurchase' })`; on success sets `['cart']` to the cart, fires `reorder_completed`, shows a snackbar (with "Xem giỏ" action unless `navigateToCart`), navigates to `/cart` when `navigateToCart && addedUnits > 0`; nothing added → error snackbar, no navigation; network error → error snackbar and `submit` rejects (caller keeps its selection).

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/hooks/use-reorder.spec.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(), trackReorderCompleted: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({ addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderCompleted: mocks.trackReorderCompleted }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useReorder } from './use-reorder';
import type { ReorderLine, ReorderTarget } from '../components/reorder/reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };
const line = (key: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName: `SP ${key}`, variationName: '', thumbnail: null, unitPrice: 1000, defaultQuantity: 1, maxQuantity: 5, available: true,
});
const ITEM: ReorderTarget = { kind: 'item', line: line('v1') };
const ORDER: ReorderTarget = { kind: 'order', orderCode: 'TUBU1', lines: [line('a'), line('b')] };

function setup(source: Parameters<typeof useReorder>[0], opts?: Parameters<typeof useReorder>[1]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, ...renderHook(() => useReorder(source, opts), { wrapper }) };
}

describe('useReorder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1 SP từ kệ Home: addToCart với addSource=repurchase; cập nhật ["cart"]; snackbar có "Xem giỏ"; KHÔNG tự chuyển trang', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result, qc } = setup('home_rail');
    let summary;
    await act(async () => {
      summary = await result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 2 }]);
    });
    expect(mocks.addToCart).toHaveBeenCalledWith('v-v1', 2, 'repurchase');
    expect(qc.getQueryData(['cart'])).toEqual(CART);
    expect(summary).toMatchObject({ addedUnits: 2 });
    expect(mocks.trackReorderCompleted).toHaveBeenCalledWith({ source: 'home_rail', added: 1, skipped: 0 });
    const snack = mocks.openSnackbar.mock.calls[0]![0];
    expect(snack).toMatchObject({ text: 'Đã thêm 2 món vào giỏ', type: 'success', action: { text: 'Xem giỏ', close: true } });
    snack.action.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('từ thông báo nhắc: addSource=reorder_notification', async () => {
    mocks.addToCart.mockResolvedValue(CART);
    const { result } = setup('notification');
    await act(async () => {
      await result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 1 }]);
    });
    expect(mocks.addToCart).toHaveBeenCalledWith('v-v1', 1, 'reorder_notification');
  });

  it('cả đơn: repurchaseOrder chỉ với dòng đã chọn; navigateToCart → sang /cart; dòng bị bỏ → snackbar warning', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: CART,
      legacy: false,
      results: [
        { orderItemId: 'a', status: 'added', addedQuantity: 1 },
        { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
      ],
    });
    const { result } = setup('order_detail', { navigateToCart: true });
    await act(async () => {
      await result.current.submit(ORDER, [
        { key: 'a', variationId: 'v-a', quantity: 1 },
        { key: 'b', variationId: 'v-b', quantity: 1 },
      ]);
    });
    expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU1', {
      items: [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'b', quantity: 1 }],
      addSource: 'repurchase',
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'warning', text: 'Đã thêm 1 món vào giỏ. Chưa thêm đủ: SP b (hết hàng)' });
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
    expect(mocks.trackReorderCompleted).toHaveBeenCalledWith({ source: 'order_detail', added: 1, skipped: 1 });
  });

  it('không thêm được món nào → snackbar lỗi, không chuyển trang dù navigateToCart', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }],
    });
    const { result } = setup('order_card', { navigateToCart: true });
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('lỗi mạng → snackbar lỗi và submit reject (sheet giữ nguyên lựa chọn)', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Network Error'));
    const { result } = setup('home_rail');
    await act(async () => {
      await expect(result.current.submit(ITEM, [{ key: 'v1', variationId: 'v-v1', quantity: 1 }])).rejects.toThrow('Network Error');
    });
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
    expect(mocks.trackReorderCompleted).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks/use-reorder.spec.tsx`
Expected: FAIL — `./use-reorder` not found.

- [ ] **Step 3: Implement**

`apps/miniapp/src/hooks/use-reorder.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { addToCart, repurchaseOrder, type RepurchaseResponse } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { trackReorderCompleted, type ReorderSource } from '../services/buy-flow-events';
import { targetLines, type ReorderSelection, type ReorderTarget } from '../components/reorder/reorder-types';
import { summarizeReorder, type ReorderSummary } from '../components/reorder/reorder-summary';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

export interface UseReorderOptions {
  /** Mua lại cả đơn (chi tiết đơn / thẻ đơn) → sang giỏ. Kệ Home/tab Đơn hàng/thông báo → ở lại. */
  navigateToCart?: boolean;
}

export interface UseReorder {
  submit: (target: ReorderTarget, selections: ReorderSelection[]) => Promise<ReorderSummary>;
  isPending: boolean;
}

async function send(source: ReorderSource, target: ReorderTarget, selections: ReorderSelection[]): Promise<RepurchaseResponse> {
  if (target.kind === 'item') {
    const s = selections[0];
    if (!s) throw new Error('Chưa chọn sản phẩm');
    // Mua lại MỘT sản phẩm dùng cart.addItem (spec §3.3), gắn nguồn để add_to_cart không ghi nhầm 'pdp'.
    const cart = await addToCart(s.variationId, s.quantity, source === 'notification' ? 'reorder_notification' : 'repurchase');
    return { cart, results: [{ orderItemId: s.key, status: 'added', addedQuantity: s.quantity }], legacy: false };
  }
  return repurchaseOrder(target.orderCode, {
    items: selections.map((s) => ({ orderItemId: s.key, quantity: s.quantity })),
    addSource: 'repurchase',
  });
}

/** Một luồng mua lại cho MỌI điểm vào (Home, thẻ đơn, chi tiết đơn, thông báo, tab Đơn hàng). */
export function useReorder(source: ReorderSource, opts: UseReorderOptions = {}): UseReorder {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();

  const mutation = useMutation({
    mutationFn: async (v: { target: ReorderTarget; selections: ReorderSelection[] }) => {
      const res = await send(source, v.target, v.selections);
      return { res, summary: summarizeReorder(res, targetLines(v.target), v.selections) };
    },
    onSuccess: ({ res, summary }) => {
      qc.setQueryData(['cart'], res.cart);
      trackReorderCompleted({ source, added: summary.addedLines, skipped: summary.skippedLines });
      if (summary.addedUnits === 0) {
        openSnackbar({ text: summary.message, type: 'error', duration: 5000 });
        return;
      }
      haptic('medium');
      const type = summary.hasProblems ? 'warning' : 'success';
      if (opts.navigateToCart) {
        openSnackbar({ text: summary.message, type });
        navigate('/cart');
        return;
      }
      openSnackbar({
        text: summary.message,
        type,
        duration: 4000,
        action: { text: vi.reorder.viewCart, close: true, onClick: () => navigate('/cart') },
      });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return {
    submit: async (target, selections) => (await mutation.mutateAsync({ target, selections })).summary,
    isPending: mutation.isPending,
  };
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks/use-reorder.spec.tsx` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/hooks/use-reorder.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/hooks/use-reorder.ts apps/miniapp/src/hooks/use-reorder.spec.tsx
git commit -m "feat(miniapp): useReorder hook shared by every buy-again entry point" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Miniapp — `ReorderSheet`

**Files:**
- Create: `apps/miniapp/src/components/reorder/reorder-sheet.tsx`
- Create: `apps/miniapp/src/components/reorder/reorder-sheet.spec.tsx`

**Interfaces:**
- Consumes: `useReorder` (Task 13); `initialSelection`, `selectedLines`, `selectionTotals`, `targetLines`, `ReorderTarget`, `ReorderLine`, `LineSelection` (Task 12); `trackReorderClicked` (Task 9); DS `BottomSheet`, `Button`, `Checkbox`, `KeyValueRow`, `PriceTag`, `Text`, `QuantitySelector` (size `md`, 44px).
- Produces: `ReorderSheet(props: { target: ReorderTarget | null; source: ReorderSource; onClose: () => void; navigateToCart?: boolean })` — open when `target !== null`; fires `reorder_clicked` once per opened target; unavailable lines are dimmed, checkbox disabled, never sent; CTA `"Thêm vào giỏ (n)"` (n = selected units) disabled at 0; closes only when ≥1 unit was added; keeps the selection on error.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/reorder/reorder-sheet.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), repurchaseOrder: vi.fn(), addToCart: vi.fn(),
  trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ repurchaseOrder: mocks.repurchaseOrder, addToCart: mocks.addToCart }));
vi.mock('../../services/buy-flow-events', () => ({
  trackReorderClicked: mocks.trackReorderClicked,
  trackReorderCompleted: mocks.trackReorderCompleted,
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReorderSheet } from './reorder-sheet';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, ...over,
});
const ORDER: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU1',
  lines: [line('a', 'Nước rửa chén'), line('b', 'Xà phòng', { available: false, maxQuantity: 0 })],
};

function renderSheet(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ReorderSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dòng hết hàng: mờ, checkbox bị khoá, không tính vào CTA; tạm tính theo dòng chọn', () => {
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Chọn Xà phòng' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
    expect(screen.getByText('Tạm hết hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeInTheDocument();
    expect(screen.getByText('100.000đ')).toBeInTheDocument();
  });

  it('bỏ chọn hết → CTA "(0)" bị vô hiệu', () => {
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' }));
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (0)' })).toBeDisabled();
  });

  it('+ số lượng cập nhật CTA; gửi đúng dòng khả dụng; thành công → đóng sheet', async () => {
    mocks.repurchaseOrder.mockResolvedValue({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 3 }] });
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Tăng số lượng' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (3)' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU1', { items: [{ orderItemId: 'a', quantity: 3 }], addSource: 'repurchase' });
  });

  it('lỗi mạng → KHÔNG đóng, giữ nguyên lựa chọn để bấm lại', async () => {
    mocks.repurchaseOrder.mockRejectedValue(new Error('Network Error'));
    const onClose = vi.fn();
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Thêm vào giỏ (2)' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Chọn Nước rửa chén' })).toBeChecked();
  });

  it('chạm đúp CTA → chỉ MỘT request', async () => {
    let resolve!: (v: unknown) => void;
    mocks.repurchaseOrder.mockReturnValue(new Promise((r) => (resolve = r)));
    renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    const cta = screen.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);
    expect(mocks.repurchaseOrder).toHaveBeenCalledTimes(1);
    resolve({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
    await waitFor(() => expect(mocks.trackReorderCompleted).toHaveBeenCalled());
  });

  it('bắn reorder_clicked đúng 1 lần mỗi lần mở, kèm mã đơn / variation', () => {
    const { rerender } = renderSheet(<ReorderSheet target={ORDER} source="order_card" onClose={() => {}} />);
    expect(mocks.trackReorderClicked).toHaveBeenCalledWith({ source: 'order_card', orderCode: 'TUBU1' });
    const item: ReorderTarget = { kind: 'item', line: line('v1', 'Nước rửa chén', { key: 'v1', variationId: 'v1', defaultQuantity: 1 }) };
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ReorderSheet target={item} source="home_rail" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(mocks.trackReorderClicked).toHaveBeenLastCalledWith({ source: 'home_rail', variationId: 'v1' });
    expect(mocks.trackReorderClicked).toHaveBeenCalledTimes(2);
  });

  it('target=null → không hiện gì', () => {
    renderSheet(<ReorderSheet target={null} source="order_card" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Thêm vào giỏ/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder/reorder-sheet.spec.tsx`
Expected: FAIL — `./reorder-sheet` not found.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/reorder/reorder-sheet.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { vi } from '../../i18n/vi';
import { formatVnd } from '../../utils/format';
import { useReorder } from '../../hooks/use-reorder';
import { trackReorderClicked } from '../../services/buy-flow-events';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/form';
import { KeyValueRow } from '../ui/key-value-row';
import { PriceTag } from '../ui/price-tag';
import { QuantitySelector } from '../ui/quantity-selector';
import { Text } from '../ui/text';
import {
  initialSelection, selectedLines, selectionTotals, targetLines,
  type LineSelection, type ReorderLine, type ReorderSource, type ReorderTarget,
} from './reorder-types';

const SR_ONLY: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};

export interface ReorderSheetProps {
  target: ReorderTarget | null;
  source: ReorderSource;
  onClose: () => void;
  navigateToCart?: boolean;
}

/**
 * Sheet mua lại dùng chung (spec §3.3): chọn dòng + số lượng, dòng hết hàng mờ và khoá, tổng tạm
 * tính, CTA "Thêm vào giỏ (n)". Lỗi mạng giữ nguyên lựa chọn; chỉ đóng khi đã thêm được ≥1 món.
 */
export function ReorderSheet({ target, source, onClose, navigateToCart }: ReorderSheetProps) {
  const [sel, setSel] = useState<Record<string, LineSelection>>({});
  const reorder = useReorder(source, { navigateToCart });

  useEffect(() => {
    if (!target) return;
    setSel(initialSelection(target));
    trackReorderClicked(
      target.kind === 'order'
        ? { source, orderCode: target.orderCode }
        : { source, variationId: target.line.variationId },
    );
  }, [target, source]);

  const lines = target ? targetLines(target) : [];
  const { units, subtotal } = target ? selectionTotals(target, sel) : { units: 0, subtotal: 0 };

  // Khoá ĐỒNG BỘ chống chạm đúp: isPending của react-query chỉ cập nhật sau một nhịp notify
  // (setTimeout 0) nên cú chạm thứ hai trong cùng nhịp vẫn thấy isPending=false.
  const inFlight = useRef(false);
  const submit = async () => {
    if (!target || units === 0 || inFlight.current) return;
    inFlight.current = true;
    try {
      const summary = await reorder.submit(target, selectedLines(target, sel));
      if (summary.addedUnits > 0) onClose();
    } catch {
      /* useReorder đã báo lỗi — giữ sheet + lựa chọn để khách bấm lại */
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <BottomSheet
      open={target !== null}
      onClose={onClose}
      title={vi.reorder.sheetTitle}
      description={target?.kind === 'order' ? vi.reorder.fromOrder(target.orderCode) : undefined}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <KeyValueRow label={vi.reorder.subtotal} value={formatVnd(subtotal)} emphasis />
          <Text variant="caption" tone="tertiary" as="div">
            {vi.reorder.priceNote}
          </Text>
          <Button fullWidth size="lg" loading={reorder.isPending} disabled={units === 0} onPress={() => void submit()}>
            {vi.reorder.addCta(units)}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {lines.map((line) => (
          <ReorderLineRow
            key={line.key}
            line={line}
            value={sel[line.key]}
            onChange={(v) => setSel((s) => ({ ...s, [line.key]: v }))}
          />
        ))}
      </div>
    </BottomSheet>
  );
}

function ReorderLineRow({
  line,
  value,
  onChange,
}: {
  line: ReorderLine;
  value: LineSelection | undefined;
  onChange: (v: LineSelection) => void;
}) {
  const checked = line.available && (value?.checked ?? false);
  const qty = value?.quantity ?? line.defaultQuantity;
  return (
    <div
      data-testid="reorder-line"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: line.available ? 1 : 0.5 }}
    >
      <Checkbox checked={checked} disabled={!line.available} onChange={() => onChange({ checked: !checked, quantity: qty })}>
        <span style={SR_ONLY}>{vi.reorder.selectLine(line.productName)}</span>
      </Checkbox>
      <div
        style={{
          width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden',
          borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
        }}
      >
        {line.thumbnail && (
          <img src={line.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Text variant="body-sm" as="div" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.productName}
        </Text>
        {line.variationName && (
          <Text variant="caption" tone="tertiary" as="div">
            {line.variationName}
          </Text>
        )}
        {line.available ? (
          <>
            <PriceTag value={line.unitPrice} size="sm" />
            <QuantitySelector value={qty} max={line.maxQuantity} size="md" onChange={(n) => onChange({ checked, quantity: n })} />
          </>
        ) : (
          <Text variant="caption" tone="danger" as="div">
            {vi.reorder.unavailable}
          </Text>
        )}
      </div>
    </div>
  );
}
```

Layout note: the quantity selector sits under the price inside the text column so the row fits 320px (checkbox 44 + thumb 56 + column ≥ 168px ≥ selector 134px).

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/reorder/reorder-sheet.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/reorder/reorder-sheet.tsx apps/miniapp/src/components/reorder/reorder-sheet.spec.tsx
git commit -m "feat(miniapp): ReorderSheet with per-line selection, blocked out-of-stock lines and one-shot submit" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Miniapp — `usePurchasedItems`, `PurchasedRail`, Home placement

**Files:**
- Create: `apps/miniapp/src/hooks/use-purchased-items.ts`
- Create: `apps/miniapp/src/components/reorder/purchased-rail.tsx`, `apps/miniapp/src/components/reorder/purchased-rail.spec.tsx`
- Modify: `apps/miniapp/src/components/ui/product-tile.tsx:173-186` (rebuy button on its own row for block variants) + `product-tile.spec.tsx`
- Modify: `apps/miniapp/src/pages/home.tsx` (render the rail right after the search block)
- Modify: `apps/e2e/tests/support/mock-api.ts` (`mockSession` default for `/me/purchased-items`)

**Interfaces:**
- Consumes: `fetchPurchasedItems`, `PurchasedItem` (Task 9); `ReorderSheet` (Task 14); `itemReorderTarget` (Task 12); `ProductTile` (`variant="rail"`, `action="rebuy"`, `showWishlist={false}`); `Badge`, `Heading`, `Skeleton`.
- Produces:
  - `PURCHASED_ITEMS_KEY = 'purchased-items'`; `usePurchasedItems(limit: number)` → `UseQueryResult<PurchasedItemsPage>` (enabled only when authenticated, `retry: false`, `staleTime: 60_000`)
  - `toTileProduct(p: PurchasedItem): ProductTileProduct`
  - `PurchasedRail({ source: 'home_rail' | 'orders_tab' })` — `<section aria-label="Mua lại">` with up to 10 tiles; renders **nothing** when not authenticated, empty, or on error (incl. 404 from an old API); while loading renders an `aria-hidden` skeleton row (`data-testid="purchased-rail-loading"`).
  - `ProductTile` with `action="rebuy"` on block variants (`grid`/`rail`/`compact`) renders a full-width "Mua lại" button below the price (line/list variants unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `apps/miniapp/src/components/ui/product-tile.spec.tsx`:

```tsx
  it('rail + rebuy: nút "Mua lại" nằm hàng riêng, full width, không bị min-width 120px của ZaUI làm tràn thẻ 148px', () => {
    renderTile(<ProductTile product={PRODUCT} variant="rail" action="rebuy" showWishlist={false} onPress={() => {}} onAction={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Mua lại' });
    expect(btn.className).toContain('zaui-btn-full-width');
    expect(btn).toHaveStyle({ minWidth: '0px' });
  });
```

`apps/miniapp/src/components/reorder/purchased-rail.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchPurchasedItems: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(),
  status: 'authenticated',
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchPurchasedItems: mocks.fetchPurchasedItems, addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder,
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { PurchasedRail } from './purchased-rail';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };

function renderRail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PurchasedRail source="home_rail" /></QueryClientProvider>);
}

describe('PurchasedRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });

  it('khách cũ: vùng "Mua lại" với thẻ SP + nhãn số lần đã mua', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Nước rửa chén · Chanh');
    expect(region).toHaveTextContent('Đã mua 2 lần');
    expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 10 });
  });

  it('khách mới (rỗng) → không render gì', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    const { container } = renderRail();
    await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('API cũ trả 404 → ẩn im lặng, không ErrorState / "Thử lại"', async () => {
    mocks.fetchPurchasedItems.mockRejectedValue(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
    const { container } = renderRail();
    await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText('Thử lại')).toBeNull();
  });

  it('chưa đăng nhập → không gọi API, không render', () => {
    mocks.status = 'idle';
    const { container } = renderRail();
    expect(mocks.fetchPurchasedItems).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('đang tải → skeleton aria-hidden (không phải region)', () => {
    mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
    renderRail();
    expect(screen.getByTestId('purchased-rail-loading')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name: 'Mua lại' })).toBeNull();
  });

  it('2 chạm: "Mua lại" → sheet → "Thêm vào giỏ (1)" → addToCart(repurchase), ở lại trang', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'repurchase'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ text: 'Xem giỏ' }) })));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('chạm thẻ → trang sản phẩm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Nước rửa chén · Chanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder/purchased-rail.spec.tsx src/components/ui/product-tile.spec.tsx`
Expected: FAIL — rail module missing; rail tile button not full width.

- [ ] **Step 3: Implement**

`components/ui/product-tile.tsx` — replace the price row block (lines 173-186) with:

```tsx
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 4 }}>
          <PriceTag value={price} compareAt={hasSale ? p.basePrice : undefined} size="sm" />
          {action === 'rebuy' && isLine && (
            // Cô lập click: Button.onPress (Task 10) là `() => void` — KHÔNG nhận native event,
            // nên không thể tự stopPropagation từ bên trong onPress. Bọc một div riêng chặn click
            // ở đây trước khi nó nổi bọt lên div ngoài cùng (role=button, onClick=onPress) — nếu
            // không, tap "Mua lại" sẽ đồng thời điều hướng đi (đã verify empirically bằng test).
            <div onClick={(e) => e.stopPropagation()}>
              <Button size="md" variant="secondary" onPress={() => onAction?.()}>
                Mua lại
              </Button>
            </div>
          )}
        </div>
        {action === 'rebuy' && !isLine && (
          // Thẻ dạng khối (kệ Mua lại 148px): `.zaui-btn` có min-width 120px nên không vừa cùng hàng
          // với giá → nút xuống hàng riêng, full width, bỏ min-width. Cùng cơ chế chặn nổi bọt.
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
            <Button size="md" variant="secondary" fullWidth onPress={() => onAction?.()} style={{ minWidth: 0 }}>
              Mua lại
            </Button>
          </div>
        )}
```

`hooks/use-purchased-items.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchPurchasedItems } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

export const PURCHASED_ITEMS_KEY = 'purchased-items';

/** Trang đầu SP đã mua (kệ "Mua lại"). retry:false — API cũ trả 404 thì ẩn kệ ngay (Ruling 19). */
export function usePurchasedItems(limit: number) {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: [PURCHASED_ITEMS_KEY, limit],
    queryFn: () => fetchPurchasedItems({ limit }),
    enabled: authed,
    staleTime: 60_000,
    retry: false,
  });
}
```

`components/reorder/purchased-rail.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { vi } from '../../i18n/vi';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import type { PurchasedItem } from '../../services/shop-api';
import { Badge } from '../ui/badge';
import { ProductTile, type ProductTileProduct } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { Heading } from '../ui/text';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';

const TILE_WIDTH = 148;
const RAIL_LIMIT = 10;

export function toTileProduct(p: PurchasedItem): ProductTileProduct {
  return {
    id: p.productId,
    slug: p.slug,
    name: p.variationName ? `${p.productName} · ${p.variationName}` : p.productName,
    brand: p.brand,
    thumbnail: p.thumbnail,
    basePrice: p.price,
    salePrice: p.salePrice,
    inStock: p.inStock,
  };
}

export interface PurchasedRailProps {
  source: 'home_rail' | 'orders_tab';
}

/**
 * Kệ "Mua lại" (spec 4a.2/4a.3): SP khách đã nhận hàng, mới mua trước. Khách mới / chưa đăng nhập
 * / API cũ (404) → không render gì (không ErrorState trên đầu trang). Mua lại = 2 chạm.
 */
export function PurchasedRail({ source }: PurchasedRailProps) {
  const navigate = useNavigate();
  const q = usePurchasedItems(RAIL_LIMIT);
  const [target, setTarget] = useState<ReorderTarget | null>(null);

  if (q.isLoading) {
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" className="scroll-x" style={{ display: 'flex', gap: 10, padding: '4px 16px 12px' }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={TILE_WIDTH} height={236} radius="var(--radius-card)" style={{ flex: '0 0 auto' }} />
        ))}
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (q.isError || items.length === 0) return null;

  return (
    <section aria-label={vi.reorder.railTitle} style={{ paddingBottom: 12 }}>
      <div style={{ padding: '4px 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {vi.reorder.railTitle}
        </Heading>
      </div>
      <div className="scroll-x" style={{ display: 'flex', gap: 10, padding: '0 16px', minWidth: 0, maxWidth: '100%' }}>
        {items.map((p) => (
          <div key={p.variationId} style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}>
            <ProductTile
              product={toTileProduct(p)}
              variant="rail"
              showWishlist={false}
              action="rebuy"
              badge={p.timesBought > 1 ? <Badge tone="brand" size="sm">{vi.reorder.timesBought(p.timesBought)}</Badge> : undefined}
              onAction={() => setTarget(itemReorderTarget(p))}
              onPress={() => navigate(`/product/${encodeURIComponent(p.slug)}`)}
            />
          </div>
        ))}
      </div>
      <ReorderSheet target={target} source={source} onClose={() => setTarget(null)} />
    </section>
  );
}
```

`pages/home.tsx`: add `import { PurchasedRail } from '../components/reorder/purchased-rail';` and insert directly after the closing `</Box>` of the `{/* ── Search ── */}` block (before `{/* ── Quick actions ...`):

```tsx
      {/* ── Mua lại (spec 4a.3) — khối ĐẦU TIÊN dưới ô tìm; khách mới/chưa mua không thấy. ── */}
      <PurchasedRail source="home_rail" />
```

`apps/e2e/tests/support/mock-api.ts` — inside `mockSession`, under the active-count default from Task 11:

```ts
  // Kệ "Mua lại" (Home + tab Đơn hàng) — mặc định khách chưa mua gì.
  api.get('/me/purchased-items', { items: [], nextCursor: null });
```

- [ ] **Step 4: Run tests, types, lint, e2e regressions**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/reorder/purchased-rail.tsx src/hooks/use-purchased-items.ts src/components/ui/product-tile.tsx` → clean.
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test miniapp.spec design-system-pilot --workers=1` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/hooks/use-purchased-items.ts apps/miniapp/src/components/reorder/purchased-rail.tsx apps/miniapp/src/components/reorder/purchased-rail.spec.tsx apps/miniapp/src/components/ui/product-tile.tsx apps/miniapp/src/components/ui/product-tile.spec.tsx apps/miniapp/src/pages/home.tsx apps/e2e/tests/support/mock-api.ts
git commit -m "feat(miniapp): buy-again rail on Home, first block under search" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Miniapp — order helpers, tab config, `OrderCard`

**Files:**
- Modify: `apps/miniapp/src/utils/order-status.ts` (append helpers); Create: `apps/miniapp/src/utils/order-status.spec.ts`
- Create: `apps/miniapp/src/components/orders/orders-tabs.ts`, `apps/miniapp/src/components/orders/orders-tabs.spec.ts`
- Create: `apps/miniapp/src/components/orders/order-card.tsx`, `apps/miniapp/src/components/orders/order-card.spec.tsx`
- Modify: `apps/miniapp/src/i18n/vi.ts` (`orders` block)

**Interfaces:**
- Consumes: `OrderView`, `OrderListFilter` (Task 9); `STATUS_TONE`; DS `Badge`, `Button`, `Icon`, `PriceTag`, `Text`.
- Produces:
  - `REORDERABLE_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const`; `isReorderable(status: string): boolean`; `orderUnitCount(items: { quantity: number }[]): number`
  - `type OrdersTabKey = 'all' | 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed' | 'subscriptions'`
  - `interface OrdersTab { key: OrdersTabKey; label: string; filter?: OrderListFilter }` (`subscriptions` has no filter); `ORDERS_TABS: readonly OrdersTab[]`; `parseOrdersTab(search: string): OrdersTabKey` (unknown → `'all'`)
  - `OrderCard({ order: OrderView; onOpen: () => void; onReorder?: () => void })` — thumbnail of the first item, `"N món"` (units, not lines — A2-47), total, status badge, "Mua lại" button only when `onReorder` is given and the status is reorderable; the button click does not trigger `onOpen`.
  - `vi.orders` changes: `itemCount: (n) => '<n> món'`, new `tabTitle`, `tabProcessing`, `tabShipping`, `tabDelivered`, `tabClosed`, `tabSubscriptions`, `emptyTabHeading`.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/utils/order-status.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isReorderable, orderUnitCount } from './order-status';

describe('order-status helpers', () => {
  it('mua lại được với đơn đã xong (giao/huỷ/hoàn) — cùng điều kiện nút ở chi tiết đơn', () => {
    expect(['DELIVERED', 'CANCELLED', 'RETURNED'].every(isReorderable)).toBe(true);
    expect(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'].some(isReorderable)).toBe(false);
  });
  it('số món = tổng số lượng, không phải số dòng (A2-47)', () => {
    expect(orderUnitCount([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
    expect(orderUnitCount([])).toBe(0);
  });
});
```

`apps/miniapp/src/components/orders/orders-tabs.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ORDERS_TABS, parseOrdersTab } from './orders-tabs';

describe('orders-tabs', () => {
  it('7 tab theo thứ tự, gồm Đang đóng gói (trong Đang xử lý), Đã hoàn (trong Đã hủy/hoàn) và Định kỳ', () => {
    expect(ORDERS_TABS.map((t) => t.label)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ',
    ]);
    expect(ORDERS_TABS.find((t) => t.key === 'processing')!.filter).toEqual({ group: 'processing' });
    expect(ORDERS_TABS.find((t) => t.key === 'closed')!.filter).toEqual({ group: 'closed' });
    expect(ORDERS_TABS.find((t) => t.key === 'subscriptions')!.filter).toBeUndefined();
  });
  it('parseOrdersTab đọc ?tab=, giá trị lạ → all', () => {
    expect(parseOrdersTab('?tab=subscriptions')).toBe('subscriptions');
    expect(parseOrdersTab('?tab=processing&x=1')).toBe('processing');
    expect(parseOrdersTab('?tab=hack')).toBe('all');
    expect(parseOrdersTab('')).toBe('all');
  });
});
```

`apps/miniapp/src/components/orders/order-card.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { OrderView } from '../../services/shop-api';
import { OrderCard } from './order-card';

const ORDER = {
  id: 'o1', code: 'TUBU-777', status: 'DELIVERED', total: 149000, createdAt: '2026-09-20T08:00:00.000Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0, thumbnail: 'https://img.test/a.jpg' },
    { id: 'i2', variationId: 'v2', productName: 'Xà phòng', productSlug: null, variationName: '', unitPrice: 19000, quantity: 1, total: 19000, backorderedQty: 0 },
  ],
} as unknown as OrderView;

describe('OrderCard', () => {
  it('ảnh SP đầu, tên + "+1", "3 món", tổng tiền, trạng thái', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
    const card = screen.getByRole('button', { name: 'Đơn TUBU-777' });
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(card).toHaveTextContent('Nước rửa chén +1');
    expect(card).toHaveTextContent(/3 món/);
    expect(card).toHaveTextContent('149.000đ');
    expect(card).toHaveTextContent('Giao thành công');
  });

  it('"Mua lại" gọi onReorder, KHÔNG mở chi tiết', () => {
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={onReorder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mua lại' }));
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đơn TUBU-777' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('đơn đang giao → không có "Mua lại"; không ảnh → icon thay thế', () => {
    render(<OrderCard order={{ ...ORDER, status: 'SHIPPING', items: [{ ...ORDER.items[1]! }] } as OrderView} onOpen={() => {}} onReorder={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mua lại' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đơn TUBU-777' }).querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/order-status.spec.ts src/components/orders`
Expected: FAIL — missing exports/modules.

- [ ] **Step 3: Implement**

`i18n/vi.ts`, inside `orders: { ... }`: change `itemCount: (n: number) => \`${n} sản phẩm\`,` to `itemCount: (n: number) => \`${n} món\`,` and add after `tabAll: 'Tất cả',`:

```ts
    tabTitle: 'Đơn hàng',
    tabProcessing: 'Đang xử lý',
    tabShipping: 'Đang giao',
    tabDelivered: 'Đã giao',
    tabClosed: 'Đã hủy/hoàn',
    tabSubscriptions: 'Định kỳ',
    emptyTabHeading: 'Không có đơn nào ở mục này',
```

Append to `utils/order-status.ts`:

```ts
/** Trạng thái hiện nút "Mua lại" — cùng điều kiện `isDone` của chi tiết đơn (order-detail.tsx). */
export const REORDERABLE_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const;

export function isReorderable(status: string): boolean {
  return (REORDERABLE_STATUSES as readonly string[]).includes(status);
}

/** Số MÓN của đơn (tổng số lượng) — trước đây thẻ đơn đếm số dòng (A2-47). */
export function orderUnitCount(items: { quantity: number }[]): number {
  return items.reduce((s, it) => s + it.quantity, 0);
}
```

`components/orders/orders-tabs.ts`:

```ts
import { vi } from '../../i18n/vi';
import type { OrderListFilter } from '../../services/shop-api';

export type OrdersTabKey = 'all' | 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed' | 'subscriptions';

export interface OrdersTab {
  key: OrdersTabKey;
  label: string;
  /** Không có filter = tab không phải danh sách đơn (Định kỳ). */
  filter?: OrderListFilter;
}

/** Tab trang Đơn hàng (spec 4a.2 + Ruling 1). "Đang xử lý" gồm Đang đóng gói, "Đã hủy/hoàn" gồm
 * Đã hoàn — hai trạng thái trước đây chỉ thấy ở "Tất cả" (A2-47). */
export const ORDERS_TABS: readonly OrdersTab[] = [
  { key: 'all', label: vi.orders.tabAll, filter: {} },
  { key: 'pending_payment', label: vi.orderStatus.PENDING_PAYMENT!, filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: vi.orders.tabProcessing, filter: { group: 'processing' } },
  { key: 'shipping', label: vi.orders.tabShipping, filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: vi.orders.tabDelivered, filter: { status: 'DELIVERED' } },
  { key: 'closed', label: vi.orders.tabClosed, filter: { group: 'closed' } },
  { key: 'subscriptions', label: vi.orders.tabSubscriptions },
];

export function parseOrdersTab(search: string): OrdersTabKey {
  const v = new URLSearchParams(search).get('tab');
  return ORDERS_TABS.some((t) => t.key === v) ? (v as OrdersTabKey) : 'all';
}
```

`components/orders/order-card.tsx`:

```tsx
import { Package } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { OrderView } from '../../services/shop-api';
import { STATUS_TONE, isReorderable, orderUnitCount } from '../../utils/order-status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';

export interface OrderCardProps {
  order: OrderView;
  onOpen: () => void;
  /** Có = hiện nút "Mua lại" cho đơn đã xong. */
  onReorder?: () => void;
}

/** Thẻ đơn trong tab Đơn hàng (spec 4a.2): ảnh SP đầu (join theo variationId), số món, tổng tiền,
 * trạng thái, nút Mua lại (A2-05). */
export function OrderCard({ order: o, onOpen, onReorder }: OrderCardProps) {
  const first = o.items[0];
  const canReorder = onReorder !== undefined && isReorderable(o.status);
  return (
    <div
      role="button"
      aria-label={`Đơn ${o.code}`}
      className="tubu-press"
      onClick={onOpen}
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text variant="label" style={{ letterSpacing: 0.4 }}>
          {o.code}
        </Text>
        <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{vi.orderStatus[o.status] ?? o.status}</Badge>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden', display: 'grid', placeItems: 'center',
            borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
          }}
        >
          {first?.thumbnail ? (
            <img src={first.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Icon icon={Package} tone="muted" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {first && (
            <Text variant="body-sm" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {first.productName}
              {o.items.length > 1 ? ` +${o.items.length - 1}` : ''}
            </Text>
          )}
          <Text variant="caption" tone="tertiary" as="div">
            {vi.orders.itemCount(orderUnitCount(o.items))} · {new Date(o.createdAt).toLocaleDateString('vi-VN')}
          </Text>
        </div>
        <PriceTag value={o.total} size="sm" />
      </div>
      {canReorder && (
        // Chặn nổi bọt: bấm "Mua lại" không được mở chi tiết đơn (cùng cách ProductTile).
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="md" variant="secondary" onPress={onReorder} style={{ minWidth: 0 }}>
            {vi.reorder.cardCta}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils src/components/orders` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/orders src/utils/order-status.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/utils/order-status.ts apps/miniapp/src/utils/order-status.spec.ts apps/miniapp/src/components/orders apps/miniapp/src/i18n/vi.ts
git commit -m "feat(miniapp): order card with thumbnail, unit count and buy-again, order tab config" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Miniapp — `SubscriptionsPanel` (DS v2) and `/subscriptions` redirect

**Files:**
- Create: `apps/miniapp/src/components/subscriptions-panel.tsx`, `apps/miniapp/src/components/subscriptions-panel.spec.tsx`
- Delete: `apps/miniapp/src/pages/subscriptions.tsx` (`git rm`)
- Modify: `apps/miniapp/src/components/app.tsx:3,67,220`
- Modify: `apps/miniapp/src/i18n/vi.ts` (`subscriptions` block additions)

**Interfaces:**
- Consumes: `getSubscriptions`, `setSubscriptionStatus`, `skipSubscriptionCycle`, `SubscriptionDTO` (`services/subscriptions-api.ts`), `usePublicConfig`; DS `Badge`, `BottomSheet`, `Button`, `Card`, `EmptyState`, `ErrorState`, `Icon`, `LineItemSkeleton`, `Text`.
- Produces: `SubscriptionsPanel()` — same behaviour as the old page body (list, pause/resume, "Hủy" opens the save-offer sheet with Tạm dừng / Bỏ qua kỳ này / Vẫn hủy, empty state CTA to `/browse`), without its own `Page`. Route `/subscriptions` → `<Navigate to="/orders?tab=subscriptions" replace />`.
- New `vi.subscriptions` keys: `intro(pct)`, `perCycle(weeks, price)`, `nextRun(date)`, `scheduling`, `pausedLine`, `pause`, `resume`, `cancel`, `statusLabel: { ACTIVE, PAUSED, CANCELLED }`, `emptyHeading`, `emptyBody`, `emptyCta`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/subscriptions-panel.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getSubscriptions: vi.fn(), setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions,
  setSubscriptionStatus: mocks.setSubscriptionStatus,
  skipSubscriptionCycle: mocks.skipSubscriptionCycle,
}));
vi.mock('../services/shop-api', () => ({ getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }) }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SubscriptionsPanel } from './subscriptions-panel';

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE' as const, nextRunAt: '2026-10-15T00:00:00.000Z',
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SubscriptionsPanel /></QueryClientProvider>);
}

describe('SubscriptionsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('liệt kê lịch: tên, chu kỳ + tiền, trạng thái, % giảm đang áp', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    renderPanel();
    expect(await screen.findByText('Nước xả vải Tubu')).toBeInTheDocument();
    expect(screen.getByText('Mỗi 4 tuần · 160.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đang chạy')).toBeInTheDocument();
    expect(screen.getByText('Đang giảm 14% cho đơn định kỳ')).toBeInTheDocument();
  });

  it('"Tạm dừng" gọi đổi trạng thái PAUSED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED'));
  });

  it('"Hủy" mở sheet giữ chân; "Bỏ qua kỳ này" gọi skip; "Vẫn hủy" gọi CANCELLED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    expect(await screen.findByText('Giữ lại lịch định kỳ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua kỳ này' }));
    await waitFor(() => expect(mocks.skipSubscriptionCycle).toHaveBeenCalledWith('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vẫn hủy' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED'));
  });

  it('chưa có lịch → EmptyState, CTA sang /browse', async () => {
    mocks.getSubscriptions.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Khám phá sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('không dùng biến CSS cũ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    const { container } = renderPanel();
    await screen.findByText('Nước xả vải Tubu');
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary|clay)-/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/subscriptions-panel.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`i18n/vi.ts`, inside `subscriptions: { ... }` append:

```ts
    intro: (pct: number) => `Tự động đặt lại sản phẩm bạn dùng thường xuyên — tiết kiệm ${pct}% mỗi đơn, hủy bất kỳ lúc nào.`,
    perCycle: (weeks: number, price: string) => `Mỗi ${weeks} tuần · ${price}`,
    nextRun: (date: string) => `Lần kế: ${date}`,
    scheduling: 'Đang lên lịch',
    pausedLine: 'Đang tạm dừng',
    pause: 'Tạm dừng',
    resume: 'Tiếp tục',
    cancel: 'Hủy',
    statusLabel: { ACTIVE: 'Đang chạy', PAUSED: 'Tạm dừng', CANCELLED: 'Đã hủy' },
    emptyHeading: 'Chưa có lịch đặt định kỳ',
    emptyBody: 'Mở một sản phẩm và chọn "Đặt định kỳ" để bắt đầu.',
    emptyCta: 'Khám phá sản phẩm',
```

`components/subscriptions-panel.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import {
  getSubscriptions,
  setSubscriptionStatus,
  skipSubscriptionCycle,
  type SubscriptionDTO,
} from '../services/subscriptions-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { usePublicConfig } from '../hooks/use-public-config';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Badge, type BadgeTone } from './ui/badge';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EmptyState, ErrorState } from './ui/empty-state';
import { Icon } from './ui/icon';
import { LineItemSkeleton } from './ui/skeleton';
import { Text } from './ui/text';

type SubStatus = SubscriptionDTO['status'];
const STATUS_TONE: Record<SubStatus, BadgeTone> = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' };

/**
 * Nội dung "Đặt định kỳ" — nhúng làm tab "Định kỳ" của trang Đơn hàng (spec 4a.2). Chuyển từ
 * pages/subscriptions.tsx sang DS v2, GIỮ nguyên hành vi: tạm dừng/tiếp tục, huỷ qua sheet giữ chân
 * (tạm dừng / bỏ qua kỳ / vẫn huỷ).
 */
export function SubscriptionsPanel() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // /me/subscriptions cần auth — fetch trước khi restore() xong sẽ 401 và kẹt (retry:false cho 4xx).
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const cfg = usePublicConfig();
  const subs = subsQ.data ?? [];
  // % thực tế đang áp (thang bậc) thắng % cấu hình chung khi đã có lịch.
  const subscribePct = Math.round((subs[0]?.effectiveDiscountPct ?? cfg.subscribeDiscountPct) * 100);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubStatus }) => setSubscriptionStatus(id, status),
    onSuccess: () => {
      haptic('light');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const skipMut = useMutation({
    mutationFn: (id: string) => skipSubscriptionCycle(id),
    onSuccess: () => {
      haptic('light');
      openSnackbar({ text: vi.subscriptions.skipOk, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setCancelTarget(null);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const targetSub = subs.find((s) => s.id === cancelTarget) ?? null;
  const pending = statusMut.isPending ? statusMut.variables?.status : undefined;
  const changeFromSheet = (status: SubStatus) => {
    if (!cancelTarget) return;
    statusMut.mutate({ id: cancelTarget, status }, { onSuccess: () => setCancelTarget(null) });
  };

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text variant="body-sm" tone="secondary" as="p">
          {vi.subscriptions.intro(subscribePct)}
        </Text>
        {subs[0] && (
          <Text variant="caption" tone="brand" as="p" style={{ marginTop: 4 }}>
            {vi.subscriptions.discountLine(Math.round(subs[0].effectiveDiscountPct * 100))}
          </Text>
        )}
      </div>

      {!authed || subsQ.isLoading ? (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      ) : subsQ.isError ? (
        <ErrorState variant="inline" message={getErrorMessage(subsQ.error)} onRetry={() => void subsQ.refetch()} />
      ) : subs.length > 0 ? (
        subs.map((s) => (
          <SubscriptionCard
            key={s.id}
            sub={s}
            busy={statusMut.isPending}
            onToggle={() => statusMut.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
            onCancel={() => setCancelTarget(s.id)}
          />
        ))
      ) : (
        <EmptyState
          variant="inline"
          art="box"
          heading={vi.subscriptions.emptyHeading}
          body={vi.subscriptions.emptyBody}
          ctaLabel={vi.subscriptions.emptyCta}
          onCta={() => navigate('/browse')}
        />
      )}

      <BottomSheet
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={vi.subscriptions.saveTitle}
        description={vi.subscriptions.saveBody}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            fullWidth
            loading={pending === 'PAUSED'}
            disabled={statusMut.isPending && pending !== 'PAUSED'}
            onPress={() => changeFromSheet('PAUSED')}
          >
            {vi.subscriptions.pauseCta}
          </Button>
          {targetSub?.status === 'ACTIVE' && (
            <Button fullWidth variant="secondary" loading={skipMut.isPending} onPress={() => cancelTarget && skipMut.mutate(cancelTarget)}>
              {vi.subscriptions.skipCta}
            </Button>
          )}
          <Button
            fullWidth
            variant="ghost"
            loading={pending === 'CANCELLED'}
            disabled={statusMut.isPending && pending !== 'CANCELLED'}
            onPress={() => changeFromSheet('CANCELLED')}
            style={{ color: 'var(--color-text-danger)' }}
          >
            {vi.subscriptions.confirmCancelCta}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

function SubscriptionCard({
  sub: s,
  busy,
  onToggle,
  onCancel,
}: {
  sub: SubscriptionDTO;
  busy: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  return (
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          style={{
            width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden', display: 'grid', placeItems: 'center',
            borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
          }}
        >
          {s.thumbnail ? (
            <img src={s.thumbnail} alt={s.productName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Icon icon={Sprout} tone="brand" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {s.productName}
          </Text>
          <Text variant="caption" tone="tertiary" as="div">
            {s.variationName} · SL {s.quantity}
          </Text>
          <Text variant="caption" tone="brand" as="div">
            {vi.subscriptions.perCycle(s.intervalWeeks, formatVnd(s.unitPrice * s.quantity))}
          </Text>
        </div>
        <Badge tone={STATUS_TONE[s.status]} size="sm" style={{ alignSelf: 'flex-start' }}>
          {vi.subscriptions.statusLabel[s.status]}
        </Badge>
      </div>
      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 10 }}>
        {s.status === 'ACTIVE'
          ? s.nextRunAt
            ? vi.subscriptions.nextRun(new Date(s.nextRunAt).toLocaleDateString('vi-VN'))
            : vi.subscriptions.scheduling
          : vi.subscriptions.pausedLine}
      </Text>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={busy} onPress={onToggle} style={{ flex: 1, minWidth: 0 }}>
          {s.status === 'ACTIVE' ? vi.subscriptions.pause : vi.subscriptions.resume}
        </Button>
        <Button variant="ghost" disabled={busy} onPress={onCancel} style={{ flex: 1, minWidth: 0, color: 'var(--color-text-danger)' }}>
          {vi.subscriptions.cancel}
        </Button>
      </div>
    </Card>
  );
}
```

Behaviour note: the old page's "Tiếp tục" branch also applied to `CANCELLED` rows (it set `ACTIVE`); `onToggle` keeps exactly that.

`components/app.tsx`:
- line 3: `import { Navigate, Route } from 'react-router-dom';`
- delete line 67 (`const SubscriptionsPage = lazy(...)`).
- line 220: `<Route path="/subscriptions" element={<Navigate to="/orders?tab=subscriptions" replace />} />` with the comment `{/* "Đặt định kỳ" nay là tab "Định kỳ" của trang Đơn hàng (spec 4a.2) — giữ route cũ cho link đã lưu. */}` above it.

Delete the page: `git rm apps/miniapp/src/pages/subscriptions.tsx`

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/subscriptions-panel.spec.tsx` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors (nothing else imports `pages/subscriptions`).
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/subscriptions-panel.tsx src/components/app.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/subscriptions-panel.tsx apps/miniapp/src/components/subscriptions-panel.spec.tsx apps/miniapp/src/components/app.tsx apps/miniapp/src/i18n/vi.ts
git commit -m "feat(miniapp): subscriptions panel in DS v2, /subscriptions redirects to the Orders tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(The `git rm` above is already staged.)

---

## Task 18: Miniapp — Orders root page (rail + tabs + cards + Định kỳ)

**Files:**
- Rewrite: `apps/miniapp/src/pages/orders.tsx`
- Create: `apps/miniapp/src/pages/orders.spec.tsx`
- Modify: `apps/miniapp/src/components/ui/segmented-tabs.tsx` (`minHeight: 40` → `44`) + `segmented-tabs.spec.tsx`

**Interfaces:**
- Consumes: `fetchOrders`, `OrderView` (Task 9); `PurchasedRail` (Task 15); `ReorderSheet` (Task 14); `orderReorderTarget`, `ReorderTarget` (Task 12); `ORDERS_TABS`, `parseOrdersTab`, `OrdersTabKey`, `OrderCard` (Task 16); `SubscriptionsPanel` (Task 17); `PageHeader` (`back={false}`), `SegmentedTabs`, `EmptyState`, `ErrorState`, `LineItemSkeleton`, `Button`.
- Produces: `/orders` page — header "Đơn hàng" without back button, "Mua lại" rail (`source="orders_tab"`), tabs (initial tab from `?tab=`), infinite list keyed `['orders', 'list', tabKey]`, card "Mua lại" opens `ReorderSheet` (`source="order_card"`, `navigateToCart`), "Định kỳ" renders `SubscriptionsPanel` and does not fetch orders; bottom padding clears the tab bar.

- [ ] **Step 1: Write the failing tests**

Append to `apps/miniapp/src/components/ui/segmented-tabs.spec.tsx` (inside its describe):

```tsx
  it('mỗi tab cao ≥44px (vùng chạm tối thiểu)', () => {
    render(<SegmentedTabs items={[{ key: 'a', label: 'A' }]} value="a" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'A' })).toHaveStyle({ minHeight: '44px' });
  });
```

(If that spec file does not already import `render`/`screen`, add `import { render, screen } from '@testing-library/react';`.)

`apps/miniapp/src/pages/orders.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchOrders: vi.fn(), fetchPurchasedItems: vi.fn(), repurchaseOrder: vi.fn(),
  getSubscriptions: vi.fn(), search: '',
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrders: mocks.fetchOrders,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  repurchaseOrder: mocks.repurchaseOrder,
  addToCart: vi.fn(),
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
}));
vi.mock('../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions, setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import OrdersPage from './orders';

const ORDER = {
  id: 'o1', code: 'TUBU-777', status: 'DELIVERED', total: 149000, createdAt: '2026-09-20T08:00:00.000Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0, stock: 9, available: true, currentPrice: 65000, thumbnail: null },
  ],
};
const PAGE = { data: [ORDER], meta: { page: 1, limit: 20, total: 1 } };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrdersPage /></QueryClientProvider>);
}

describe('OrdersPage (tab gốc)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.fetchOrders.mockResolvedValue(PAGE);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getSubscriptions.mockResolvedValue([]);
  });

  it('tiêu đề "Đơn hàng", không có nút Quay lại; 7 tab gồm "Định kỳ"', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Đơn hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ',
    ]);
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-777' })).toBeInTheDocument();
    expect(mocks.fetchOrders).toHaveBeenCalledWith({}, 1, 20);
  });

  it('tab "Đang xử lý" gửi group=processing', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Đang xử lý' }));
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalledWith({ group: 'processing' }, 1, 20));
  });

  it('?tab=subscriptions → mở thẳng "Định kỳ", không tải danh sách đơn', async () => {
    mocks.search = '?tab=subscriptions';
    renderPage();
    expect(screen.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Chưa có lịch đặt định kỳ')).toBeInTheDocument();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('"Mua lại" trên thẻ → sheet → gửi repurchase → sang /cart', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: { items: [], itemCount: 2 }, legacy: false, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }],
    });
    renderPage();
    const card = await screen.findByRole('button', { name: 'Đơn TUBU-777' });
    fireEvent.click(card.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() =>
      expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU-777', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('chạm thẻ → chi tiết đơn', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đơn TUBU-777' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TUBU-777');
  });

  it('tab khác "Tất cả" rỗng → thông báo nhẹ, không CTA mua đơn đầu', async () => {
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Đang giao' }));
    expect(await screen.findByText('Không có đơn nào ở mục này')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages/orders.spec.tsx src/components/ui/segmented-tabs.spec.tsx`
Expected: FAIL — only 6 tabs, back button rendered, no "Định kỳ", SegmentedTabs 40px.

- [ ] **Step 3: Implement**

`components/ui/segmented-tabs.tsx`: `minHeight: 40,` → `minHeight: 44,`.

`pages/orders.tsx` (full rewrite):

```tsx
import { useState } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchOrders } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Button } from '../components/ui/button';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { OrderCard } from '../components/orders/order-card';
import { ORDERS_TABS, parseOrdersTab, type OrdersTabKey } from '../components/orders/orders-tabs';
import { PurchasedRail } from '../components/reorder/purchased-rail';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { orderReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
import { SubscriptionsPanel } from '../components/subscriptions-panel';

const PAGE_LIMIT = 20;

/**
 * Tab gốc "Đơn hàng" (spec 4a.1/4a.2): kệ Mua lại → tab trạng thái (+ Định kỳ) → thẻ đơn có ảnh,
 * số món, nút Mua lại. Trang gốc: không nút back, đệm đáy cho tab bar.
 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useAuthStore((s) => s.status);
  const [tab, setTab] = useState<OrdersTabKey>(() => parseOrdersTab(location.search));
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const current = ORDERS_TABS.find((t) => t.key === tab) ?? ORDERS_TABS[0]!;
  const isSubscriptions = tab === 'subscriptions';

  // Phân trang bằng useInfiniteQuery + "Xem thêm" (giữ fix cũ: >20 đơn vẫn xem được đơn cũ).
  const orders = useInfiniteQuery({
    queryKey: ['orders', 'list', tab],
    queryFn: ({ pageParam }) => fetchOrders(current.filter ?? {}, pageParam, PAGE_LIMIT),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, limit, total } = lastPage.meta;
      return page * limit < total ? page + 1 : undefined;
    },
    enabled: authStatus === 'authenticated' && !isSubscriptions,
  });
  const list = orders.data?.pages.flatMap((pg) => pg.data) ?? [];

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(76px + var(--safe-bottom))' }}>
      <PageHeader title={vi.orders.tabTitle} back={false} />
      <div style={{ paddingTop: 8 }}>
        <PurchasedRail source="orders_tab" />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <SegmentedTabs
          items={ORDERS_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={(key) => {
            haptic('light');
            setTab(key as OrdersTabKey);
          }}
          scroll
        />
      </div>

      {isSubscriptions ? (
        <SubscriptionsPanel />
      ) : orders.isLoading || authStatus === 'loading' ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      ) : orders.isError ? (
        <ErrorState message={getErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
      ) : list.length === 0 ? (
        tab === 'all' ? (
          <EmptyState
            art="box"
            heading={vi.orders.emptyHeading}
            body={vi.orders.emptyBody}
            ctaLabel={vi.orders.emptyCta}
            onCta={() => navigate('/browse')}
          />
        ) : (
          <EmptyState variant="inline" art="box" heading={vi.orders.emptyTabHeading} />
        )
      ) : (
        <>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onOpen={() => navigate(`/order/${o.code}`)}
                onReorder={() => setReorderTarget(orderReorderTarget(o))}
              />
            ))}
          </div>
          {orders.hasNextPage && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 16 }}>
              <Button
                variant="secondary"
                loading={orders.isFetchingNextPage}
                onPress={() => void orders.fetchNextPage()}
                style={{ minWidth: 160 }}
              >
                Xem thêm
              </Button>
            </div>
          )}
        </>
      )}

      <ReorderSheet target={reorderTarget} source="order_card" navigateToCart onClose={() => setReorderTarget(null)} />
    </Page>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages/orders.spec.tsx src/components/ui` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/orders.tsx src/components/ui/segmented-tabs.tsx` → clean.
Run: `pnpm lint:vars` → OK.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/orders.tsx apps/miniapp/src/pages/orders.spec.tsx apps/miniapp/src/components/ui/segmented-tabs.tsx apps/miniapp/src/components/ui/segmented-tabs.spec.tsx
git commit -m "feat(miniapp): Orders root page with buy-again rail, grouped status tabs and subscriptions tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 19: Miniapp — order detail "Mua lại đơn này" opens `ReorderSheet`

**Files:**
- Modify: `apps/miniapp/src/pages/order-detail.tsx:1-30,141-149,623-627,702` (imports, remove repurchase mutation, button, mount sheet)
- Modify: `apps/e2e/tests/design-system-pilot.miniapp.spec.ts:24,255-272` (test 5 now goes through the sheet)

**Interfaces:**
- Consumes: `ReorderSheet` (Task 14), `orderReorderTarget`, `ReorderTarget` (Task 12), `isReorderable` (Task 16).
- Produces: order-detail reorder = sheet with the order's lines (source `order_detail`, `navigateToCart`); POST body `{ items, addSource: 'repurchase' }`; still lands on `/cart`.

- [ ] **Step 1: Update the e2e test first (failing)**

In `design-system-pilot.miniapp.spec.ts`, change header comment item 5 to `5. Đơn đã giao: "Mua lại đơn này" mở sheet; CTA trong sheet hiện spinner rồi chuyển sang /cart.` and replace the test `'Đơn đã giao: "Mua lại" hiện spinner rồi chuyển sang /cart'` with:

```ts
  test('Đơn đã giao: "Mua lại đơn này" mở sheet; CTA trong sheet hiện spinner rồi chuyển sang /cart', async ({ page, api }) => {
    mockPilotDeliveredOrder(api, { repurchaseDelayMs: 1500 });
    await page.goto(`/order/${PILOT_ORDER_CODE}`);

    const rebuy = page.getByRole('button', { name: 'Mua lại đơn này' });
    await expect(rebuy).toBeVisible({ timeout: 15_000 });
    await rebuy.click();

    // makeOrder: 1 dòng SL 2, API mock cũ không trả stock → coi như còn hàng (Ruling 19).
    const cta = page.getByRole('button', { name: 'Thêm vào giỏ (2)' });
    await expect(cta).toBeEnabled();
    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await cta.click();

    await expect(cta.locator('.zaui-btn-loading-icon')).toBeVisible();
    await expect(cta).toHaveAttribute('aria-busy', 'true');
    const call = await posted;
    expect(call.body).toEqual({ items: [{ orderItemId: `item-${PILOT_ORDER_CODE}`, quantity: 2 }], addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    expect(api.callsTo('POST', '/orders/:code/repurchase')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test design-system-pilot --workers=1 -g "Mua lại đơn này"`
Expected: FAIL — no "Thêm vào giỏ (2)" (button posts directly and navigates).

- [ ] **Step 3: Implement**

In `order-detail.tsx`:
- line 5: remove `repurchaseOrder` from the shop-api import.
- line 12: `import { STATUS_COLOR, TIMELINE_STEPS, timelineIndex, isReorderable } from '../utils/order-status';`
- add imports:

```tsx
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { orderReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
```

- next to the other `useState`s (after line 57): `const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);`
- delete the whole `const repurchase = useMutation({...});` block (lines 141-149, as modified in Task 9).
- replace the `{isDone && (<Button loading={repurchase.isPending} ...>{vi.orders.repurchase}</Button>)}` block with:

```tsx
            {isReorderable(o.status) && (
              <Button
                onPress={() => {
                  haptic('light');
                  setReorderTarget(orderReorderTarget(o));
                }}
                style={{ flex: 1, fontWeight: 600 }}
              >
                {vi.orders.repurchase}
              </Button>
            )}
```

(`isDone` stays — it still drives `{!canCancel && !isDone && ...}`.)
- just before `</Page>` (after the return-request `Sheet`):

```tsx
      {/* Mua lại cả đơn qua sheet dùng chung (spec §3.3) — chọn dòng, dòng hết hàng bị khoá. */}
      <ReorderSheet target={reorderTarget} source="order_detail" navigateToCart onClose={() => setReorderTarget(null)} />
```

- [ ] **Step 4: Run e2e + unit + types**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test design-system-pilot returns-reversal shipping-pancake recycling-pickup --workers=1` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/button-guard.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/order-detail.tsx apps/e2e/tests/design-system-pilot.miniapp.spec.ts
git commit -m "feat(miniapp): order detail buy-again goes through the shared ReorderSheet" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 20: Miniapp — `REORDER_REMINDER` opens `ReorderSheet`

**Files:**
- Create: `apps/miniapp/src/components/reorder/reorder-reminder.ts`, `apps/miniapp/src/components/reorder/reorder-reminder.spec.ts`
- Modify: `apps/miniapp/src/pages/notifications.tsx:1-18,52-62,81-84,331-343,402` (imports, fallback, state, CTA, sheet)
- Modify: `apps/miniapp/src/pages/notifications.spec.ts:4,43-58` (mock + fallback expectation)

**Interfaces:**
- Consumes: `fetchPurchasedItems`, `PurchasedItem` (Task 9), `trackReorderReminderCta` (Task 9), `ReorderSheet` (Task 14), `itemReorderTarget`, `ReorderTarget` (Task 12), DS `Button` (imported as `DsButton`).
- Produces:
  - `reminderFallbackPath(data?: Record<string, string>): string` — `/product/<slug>` or `/orders`
  - `type ReorderReminderAction = { kind: 'sheet'; item: PurchasedItem } | { kind: 'navigate'; to: string }`
  - `reorderReminderAction(data: Record<string, string> | undefined, item: PurchasedItem | null): ReorderReminderAction` (sheet only when `item?.inStock`)
  - `reorderReminderTarget(data)` in `notifications.tsx` keeps its name and delegates to `reminderFallbackPath` (fallback `/orders`, was `/`).
  - Reminder CTA: DS `Button` "Mua lại ngay" (no emoji), fires `reorder_reminder_cta {notificationId}`, looks up `GET /me/purchased-items?variationId=<variation_id>&limit=1`, then opens the sheet (`source="notification"` → `addSource: 'reorder_notification'`) or navigates.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/reorder/reorder-reminder.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PurchasedItem } from '../../services/shop-api';
import { reminderFallbackPath, reorderReminderAction } from './reorder-reminder';

const ITEM: PurchasedItem = {
  variationId: 'v1', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Visante',
  thumbnail: null, price: 120000, salePrice: null, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-08-01T00:00:00.000Z',
};

describe('reorderReminderAction (spec 4a.4 + Ruling 8)', () => {
  it('variation còn trong danh sách đã mua và còn hàng → mở sheet đúng variation', () => {
    expect(reorderReminderAction({ variation_id: 'v1', product_slug: 'dau-goi' }, ITEM)).toEqual({ kind: 'sheet', item: ITEM });
  });
  it('đã mua nhưng hết hàng → trang sản phẩm (4c thêm "Báo khi có hàng"), không mở sheet cụt', () => {
    expect(reorderReminderAction({ product_slug: 'dau-goi' }, { ...ITEM, stock: 0, inStock: false })).toEqual({ kind: 'navigate', to: '/product/dau-goi' });
  });
  it('không tìm thấy + thiếu slug → /orders (fallback của spec)', () => {
    expect(reorderReminderAction({ product: 'Dầu gội', variation_id: 'gone' }, null)).toEqual({ kind: 'navigate', to: '/orders' });
    expect(reorderReminderAction(undefined, null)).toEqual({ kind: 'navigate', to: '/orders' });
  });
  it('slug được encode', () => {
    expect(reminderFallbackPath({ product_slug: 'sữa tắm/đặc biệt' })).toBe(`/product/${encodeURIComponent('sữa tắm/đặc biệt')}`);
  });
});
```

In `apps/miniapp/src/pages/notifications.spec.ts`:
- replace line 4 with a mock that also stubs what the page now imports:

```ts
vi.mock('zmp-ui', () => ({
  Box: () => null, Page: () => null, Text: () => null, Button: () => null, Sheet: () => null,
  Checkbox: () => null, Radio: () => null, Switch: () => null,
  useNavigate: () => () => undefined,
  useSnackbar: () => ({ openSnackbar: () => undefined, closeSnackbar: () => undefined }),
}));
```

- in `describe('reorderReminderTarget ...')`, rename the second test and change its expectations:

```ts
  it('không có slug (đơn cũ trước khi OrderItem có cột productSlug) → /orders (spec 4a.4) thay vì link hỏng /product/', () => {
    expect(reorderReminderTarget({ product: 'Dầu gội Visante 500ml' })).toBe('/orders');
    expect(reorderReminderTarget(undefined)).toBe('/orders');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder/reorder-reminder.spec.ts src/pages/notifications.spec.ts`
Expected: FAIL — module missing; fallback is still `/`.

- [ ] **Step 3: Implement**

`components/reorder/reorder-reminder.ts`:

```ts
import type { PurchasedItem } from '../../services/shop-api';

export type ReorderReminderAction = { kind: 'sheet'; item: PurchasedItem } | { kind: 'navigate'; to: string };

/** Đích khi không mở được sheet: trang sản phẩm nếu payload có slug, không thì tab Đơn hàng. */
export function reminderFallbackPath(data?: Record<string, string>): string {
  const slug = data?.product_slug ?? data?.productSlug;
  return slug ? `/product/${encodeURIComponent(String(slug))}` : '/orders';
}

/**
 * CTA "Mua lại ngay" của REORDER_REMINDER (spec 4a.4): mở ReorderSheet đúng variation trong payload
 * khi khách còn mua được nó (có trong purchased-items và còn hàng); còn lại điều hướng dự phòng.
 */
export function reorderReminderAction(data: Record<string, string> | undefined, item: PurchasedItem | null): ReorderReminderAction {
  if (item && item.inStock) return { kind: 'sheet', item };
  return { kind: 'navigate', to: reminderFallbackPath(data) };
}
```

`pages/notifications.tsx`:
- imports to add:

```tsx
import { fetchPurchasedItems, type PurchasedItem } from '../services/shop-api';
import { trackReorderReminderCta } from '../services/buy-flow-events';
// zmp-ui Button vẫn dùng cho các CTA loại khác (nợ migrate); CTA nhắc mua lại dùng DS v2 (spec 4a.4).
import { Button as DsButton } from '../components/ui/button';
import { ReorderSheet } from '../components/reorder/reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from '../components/reorder/reorder-types';
import { reminderFallbackPath, reorderReminderAction } from '../components/reorder/reorder-reminder';
```

- replace the body of `reorderReminderTarget` (keep its docblock, update its last sentence to "đơn cũ chưa có slug → về tab Đơn hàng.") with:

```ts
export function reorderReminderTarget(data: Record<string, string> | undefined): string {
  return reminderFallbackPath(data);
}
```

- inside `NotificationsPage`, after `const [selectedNotif, ...]`:

```tsx
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);

  // Tra đúng variation trong payload qua purchased-items (đơn DELIVERED của chính khách). Lỗi / API cũ
  // 404 → coi như không tìm thấy, rơi về điều hướng dự phòng (Ruling 8).
  const openReorderReminder = async (n: NotificationDTO) => {
    if (reminderBusy) return;
    trackReorderReminderCta(n.id);
    haptic('light');
    setReminderBusy(true);
    const variationId = n.payload.data?.variation_id;
    let item: PurchasedItem | null = null;
    if (variationId) {
      item = await fetchPurchasedItems({ variationId, limit: 1 })
        .then((p) => p.items[0] ?? null)
        .catch(() => null);
    }
    setReminderBusy(false);
    const action = reorderReminderAction(n.payload.data, item);
    setSelectedNotif(null);
    if (action.kind === 'sheet') setReorderTarget(itemReorderTarget(action.item));
    else navigate(action.to);
  };
```

- replace the `{isReorder && !isOrder && !isFlash && (<Button ...>Mua lại ngay 🛒</Button>)}` block with:

```tsx
                  {isReorder && !isOrder && !isFlash && (
                    <DsButton
                      fullWidth
                      size="lg"
                      loading={reminderBusy}
                      onPress={() => void openReorderReminder(selectedNotif)}
                      style={{ marginTop: 8 }}
                    >
                      {vi.reorder.reminderCta}
                    </DsButton>
                  )}
```

- add `import { vi } from '../i18n/vi';` if the file does not import it yet (it does not today).
- just before the final `</Page>`:

```tsx
      {/* Nhắc mua lại → sheet mua lại 1 SP (addSource=reorder_notification). */}
      <ReorderSheet target={reorderTarget} source="notification" onClose={() => setReorderTarget(null)} />
```

- [ ] **Step 4: Run tests, types, lint (no new errors)**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/reorder src/pages/notifications.spec.ts` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/notifications.tsx src/components/reorder/reorder-reminder.ts` → only the pre-existing `no-restricted-imports` error on the zmp `Button` import at line 2 (baseline, Ruling 17); no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/reorder/reorder-reminder.ts apps/miniapp/src/components/reorder/reorder-reminder.spec.ts apps/miniapp/src/pages/notifications.tsx apps/miniapp/src/pages/notifications.spec.ts
git commit -m "feat(miniapp): reorder reminder opens the buy-again sheet for the exact variation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 21: Miniapp — order-success screen rebuilt in DS v2

**Files:**
- Create: `apps/miniapp/src/utils/shipping-eta.ts`, `apps/miniapp/src/utils/shipping-eta.spec.ts`
- Rewrite: `apps/miniapp/src/components/checkout/order-success.tsx`
- Create: `apps/miniapp/src/components/checkout/order-success.spec.tsx`
- Modify: `apps/miniapp/src/i18n/vi.ts` (`success` block)
- Modify: `apps/e2e/tests/support/checkout-mocks.ts` (default `/products/:slug` mock in `mockCheckout`)

**Interfaces:**
- Consumes: `usePublicConfig` (`shippingEta`, `subscribeDiscountPct`, `isLoaded`), `fetchProduct` (`['product', slug]` key, same as PDP), `copyText`, `SubscribeSheet`, `useStorefrontContext`; DS `Button`, `Card`, `Heading`, `Text`, `Icon`, `IconButton`, `KeyValueRow`.
- Produces:
  - `shippingEtaLabel(eta: ShippingEta, now?: Date): string` → `"dd/MM – dd/MM"` (single date when min = max)
  - `interface SubscribeCandidate { variationId: string; quantity: number; productName: string }`; `useSubscribeCandidate(order: OrderDTO): SubscribeCandidate | null` (first item whose variation, fetched by slug, has `stock > 0`; checks at most 3 distinct slugs)
  - `OrderSuccess({ order, onTrack, onContinue })` — same props as today. Shows: heading "Cảm ơn bạn đã chọn Tubu" (no emoji), copyable order code (`IconButton` "Sao chép mã đơn"), total, COD cash note, points ("+N điểm"), "Giao dự kiến" (only when configured), 3 steps (Xác nhận đơn → Đóng gói → Giao hàng), subscribe suggestion (only when eligible), CTA "Theo dõi đơn" (primary) and "Tiếp tục mua sắm". No falling leaves.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/utils/shipping-eta.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shippingEtaLabel } from './shipping-eta';

describe('shippingEtaLabel', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0); // 30/09/2026 (giờ địa phương)
  it('khoảng ngày → "02/10 – 04/10"', () => {
    expect(shippingEtaLabel({ minDays: 2, maxDays: 4 }, now)).toBe('02/10 – 04/10');
  });
  it('min = max → một ngày', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, now)).toBe('01/10');
  });
});
```

`apps/miniapp/src/components/checkout/order-success.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchProduct: vi.fn(), getPublicConfig: vi.fn(), copyText: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ fetchProduct: mocks.fetchProduct, getPublicConfig: mocks.getPublicConfig }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../store/storefront-context', () => ({
  useStorefrontContext: (sel: (s: { slug: null; kind: null }) => unknown) => sel({ slug: null, kind: null }),
}));
vi.mock('../subscribe-sheet', () => ({
  SubscribeSheet: ({ visible, variationId }: { visible: boolean; variationId: string }) => (visible ? <div>subscribe-open:{variationId}</div> : null),
}));

import { OrderSuccess } from './order-success';

const ORDER = {
  id: 'o1', code: 'TUBU-COD-12345', status: 'CONFIRMED', total: 149000, pointsEarned: 14, paymentMethod: 'COD',
  items: [{ id: 'i1', variationId: 'var-1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0 }],
} as unknown as OrderDTO;
const CONFIG = { freeshipThreshold: 200000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, affiliateMinWithdrawBank: 50000, cashbackHoldDays: 30 };
const PRODUCT = (stock: number) => ({ slug: 'nrc', variations: [{ id: 'var-1', stock }] });

function renderSuccess(props: Partial<Parameters<typeof OrderSuccess>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderSuccess order={ORDER} onTrack={props.onTrack ?? vi.fn()} onContinue={props.onContinue ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('OrderSuccess (DS v2, spec 4a.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: { minDays: 2, maxDays: 4 } });
    mocks.fetchProduct.mockResolvedValue(PRODUCT(10));
  });

  it('tiêu đề không emoji, mã đơn, tổng tiền, nhắc tiền mặt COD, điểm sẽ nhận, 3 bước tiếp theo', () => {
    const { container } = renderSuccess();
    expect(screen.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeInTheDocument();
    expect(screen.getByText('TUBU-COD-12345')).toBeInTheDocument();
    expect(screen.getByText('149.000đ')).toBeInTheDocument();
    expect(screen.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeInTheDocument();
    expect(screen.getByText('+14 điểm')).toBeInTheDocument();
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) expect(screen.getByText(s)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(container.querySelector('.tubu-leaf')).toBeNull();
  });

  it('sao chép mã đơn', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã đơn' })));
    expect(mocks.copyText).toHaveBeenCalledWith('TUBU-COD-12345');
  });

  it('ngày giao dự kiến chỉ hiện khi đã cấu hình', async () => {
    renderSuccess();
    expect(await screen.findByText('Giao dự kiến')).toBeInTheDocument();
  });

  it('chưa cấu hình ETA (null) → không có dòng giao dự kiến', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: null });
    renderSuccess();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Giao dự kiến')).toBeNull());
  });

  it('gợi ý "Đặt định kỳ" khi variation còn hàng (cùng điều kiện PDP) → mở SubscribeSheet đúng variation', async () => {
    renderSuccess();
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt định kỳ' }));
    expect(screen.getByText('subscribe-open:var-1')).toBeInTheDocument();
    expect(mocks.fetchProduct).toHaveBeenCalledWith('nrc');
  });

  it('variation hết hàng → không gợi ý định kỳ', async () => {
    mocks.fetchProduct.mockResolvedValue(PRODUCT(0));
    renderSuccess();
    await waitFor(() => expect(mocks.fetchProduct).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Đặt định kỳ' })).toBeNull();
  });

  it('CTA chính "Theo dõi đơn", phụ "Tiếp tục mua sắm"', () => {
    const onTrack = vi.fn();
    const onContinue = vi.fn();
    renderSuccess({ onTrack, onContinue });
    fireEvent.click(screen.getByRole('button', { name: 'Theo dõi đơn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục mua sắm' }));
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/shipping-eta.spec.ts src/components/checkout/order-success.spec.tsx`
Expected: FAIL — module missing; heading has emoji; no copy button/steps.

- [ ] **Step 3: Implement**

`i18n/vi.ts` — replace the whole `success: { ... },` block with:

```ts
  success: {
    prepareCash: 'Chuẩn bị tiền mặt khi nhận hàng',
    heading: 'Cảm ơn bạn đã chọn Tubu',
    subheading: 'Đơn hàng của bạn đã được ghi nhận',
    orderCode: 'Mã đơn hàng',
    copyCode: 'Sao chép mã đơn',
    copied: 'Đã sao chép mã đơn',
    copyFailed: (code: string) => `Không sao chép được — mã đơn: ${code}`,
    total: 'Tổng thanh toán',
    pointsLabel: 'Điểm Xanh sẽ nhận',
    pointsValue: (n: number) => `+${n} điểm`,
    pointsComing: (n: number) => `${n} điểm Xanh sẽ về tay khi đơn giao thành công`,
    etaLabel: 'Giao dự kiến',
    nextTitle: 'Tiếp theo',
    steps: [
      { title: 'Xác nhận đơn', body: 'Tubu kiểm tra và xác nhận đơn của bạn.' },
      { title: 'Đóng gói', body: 'Sản phẩm được đóng gói cẩn thận.' },
      { title: 'Giao hàng', body: 'Đơn vị vận chuyển giao tới địa chỉ của bạn.' },
    ],
    subscribeTitle: (name: string) => `Đặt định kỳ ${name}`,
    subscribeBody: (pct: number) => `Tự động giao lại theo chu kỳ, tiết kiệm ${pct}% mỗi đơn.`,
    subscribeCta: 'Đặt định kỳ',
    trackOrder: 'Theo dõi đơn',
    keepShopping: 'Tiếp tục mua sắm',
  },
```

`utils/shipping-eta.ts`:

```ts
import type { ShippingEta } from '../services/shop-api';

const DAY_MS = 864e5;

/** "02/10 – 04/10" từ khoảng ngày cấu hình (ngày lịch, chưa theo tỉnh — spec §2). */
export function shippingEtaLabel(eta: ShippingEta, now: Date = new Date()): string {
  const fmt = (days: number) =>
    new Date(now.getTime() + days * DAY_MS).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return eta.minDays === eta.maxDays ? fmt(eta.minDays) : `${fmt(eta.minDays)} – ${fmt(eta.maxDays)}`;
}
```

`components/checkout/order-success.tsx` (full rewrite):

```tsx
import { useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, Copy, Repeat } from 'lucide-react';
import type { OrderDTO } from '@tubutree/shared-types';
import { fetchProduct } from '../../services/shop-api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useStorefrontContext } from '../../store/storefront-context';
import { copyText } from '../../utils/clipboard';
import { formatVnd } from '../../utils/format';
import { shippingEtaLabel } from '../../utils/shipping-eta';
import { vi } from '../../i18n/vi';
import { SubscribeSheet } from '../subscribe-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { KeyValueRow } from '../ui/key-value-row';
import { Heading, Text } from '../ui/text';

const MAX_SUBSCRIBE_CHECKS = 3;

export interface SubscribeCandidate {
  variationId: string;
  quantity: number;
  productName: string;
}

/**
 * Sản phẩm đầu tiên của đơn cho phép "Đặt định kỳ" — CÙNG điều kiện PDP đang dùng để hiện nút
 * (product-detail.tsx: `selected && inStock`, tức variation đang bán và stock > 0). Dùng chung
 * queryKey ['product', slug] với PDP. Đơn không có dòng nào đủ điều kiện → null (ẩn gợi ý).
 */
export function useSubscribeCandidate(order: OrderDTO): SubscribeCandidate | null {
  const slugs = [...new Set(order.items.map((it) => it.productSlug).filter((s): s is string => !!s))].slice(0, MAX_SUBSCRIBE_CHECKS);
  const products = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['product', slug],
      queryFn: () => fetchProduct(slug),
      staleTime: 60_000,
      retry: false,
    })),
  });
  for (const it of order.items) {
    const idx = it.productSlug ? slugs.indexOf(it.productSlug) : -1;
    const variation = idx >= 0 ? products[idx]?.data?.variations.find((v) => v.id === it.variationId) : undefined;
    if (variation && variation.stock > 0) {
      return { variationId: it.variationId, quantity: it.quantity, productName: it.productName };
    }
  }
  return null;
}

/**
 * Màn "Đặt hàng thành công" (spec 4a.5, A2-45): mã đơn sao chép được, tổng tiền, điểm sẽ nhận,
 * ngày giao dự kiến (khi chủ shop đã cấu hình), 3 bước tiếp theo, CTA chính "Theo dõi đơn", gợi ý
 * "Đặt định kỳ". Bỏ lá rơi / emoji chức năng.
 */
export function OrderSuccess({
  order,
  onTrack,
  onContinue,
}: {
  order: OrderDTO;
  onTrack: () => void;
  onContinue: () => void;
}) {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);
  const cfg = usePublicConfig();
  const candidate = useSubscribeCandidate(order);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const handleContinue = () => {
    if (sfSlug) navigate(sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`, { replace: true });
    else onContinue();
  };

  const copyCode = () => {
    void copyText(order.code).then((ok) =>
      openSnackbar(
        ok
          ? { text: vi.success.copied, type: 'success' }
          : { text: vi.success.copyFailed(order.code), type: 'info', duration: 4000 },
      ),
    );
  };

  const eta = cfg.isLoaded && cfg.shippingEta ? shippingEtaLabel(cfg.shippingEta) : null;

  return (
    <div style={{ padding: '32px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
        <span
          aria-hidden
          className="tubu-pop"
          style={{
            width: 56, height: 56, borderRadius: 'var(--radius-pill)', background: 'var(--color-action-secondary-bg)',
            display: 'grid', placeItems: 'center',
          }}
        >
          <Icon icon={CheckCircle2} size="lg" tone="brand" />
        </span>
        <Heading variant="title-lg" as="h1">
          {vi.success.heading}
        </Heading>
        <Text variant="body-sm" tone="secondary">
          {vi.success.subheading}
        </Text>
      </div>

      <Card variant="outline" padding={16}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {vi.success.orderCode}
            </Text>
            <Text variant="body-lg" as="div" style={{ fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>
              {order.code}
            </Text>
          </div>
          <IconButton icon={Copy} label={vi.success.copyCode} onPress={copyCode} />
        </div>
        <div style={{ borderTop: '1px solid var(--color-border-subtle)', marginTop: 12, paddingTop: 8 }}>
          <KeyValueRow label={vi.success.total} value={formatVnd(order.total)} emphasis />
          {order.paymentMethod === 'COD' && (
            <Text variant="caption" tone="secondary" as="div">
              {vi.success.prepareCash}
            </Text>
          )}
          {order.pointsEarned > 0 && (
            <>
              <KeyValueRow label={vi.success.pointsLabel} value={vi.success.pointsValue(order.pointsEarned)} tone="success" />
              <Text variant="caption" tone="tertiary" as="div">
                {vi.success.pointsComing(order.pointsEarned)}
              </Text>
            </>
          )}
          {eta && <KeyValueRow label={vi.success.etaLabel} value={eta} />}
        </div>
      </Card>

      <section aria-label={vi.success.nextTitle}>
        <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
          {vi.success.nextTitle}
        </Heading>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {vi.success.steps.map((s, i) => (
            <li key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  width: 28, height: 28, flex: '0 0 auto', display: 'grid', placeItems: 'center', fontWeight: 700,
                  borderRadius: 'var(--radius-pill)', fontSize: 'var(--type-caption-size)',
                  background: i === 0 ? 'var(--color-action-primary-bg)' : 'var(--color-bg-subtle)',
                  color: i === 0 ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
                }}
              >
                {i + 1}
              </span>
              <div>
                <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                  {s.title}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {s.body}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {candidate && (
        <Card variant="flat" padding={12}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Icon icon={Repeat} tone="brand" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                {vi.success.subscribeTitle(candidate.productName)}
              </Text>
              <Text variant="caption" tone="secondary" as="div">
                {vi.success.subscribeBody(Math.round(cfg.subscribeDiscountPct * 100))}
              </Text>
            </div>
          </div>
          <Button variant="secondary" fullWidth onPress={() => setSubscribeOpen(true)} style={{ marginTop: 10 }}>
            {vi.success.subscribeCta}
          </Button>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button fullWidth size="lg" onPress={onTrack}>
          {vi.success.trackOrder}
        </Button>
        <Button fullWidth variant="ghost" onPress={handleContinue}>
          {vi.success.keepShopping}
        </Button>
      </div>

      {candidate && (
        <SubscribeSheet
          visible={subscribeOpen}
          onClose={() => setSubscribeOpen(false)}
          variationId={candidate.variationId}
          quantity={candidate.quantity}
        />
      )}
    </div>
  );
}
```

`apps/e2e/tests/support/checkout-mocks.ts` — add `import { PILOT_PRODUCT } from './pilot-mocks';` and inside `mockCheckout`, after the `/payments/bank-qr/:code` line:

```ts
  // Màn đặt hàng thành công (dự án 4a) đọc sản phẩm của đơn để quyết định gợi ý "Đặt định kỳ"
  // (cùng điều kiện PDP). makeOrder dùng slug 'nuoc-rua-chen-tubu' + variation 'var-1' = PILOT_PRODUCT.
  api.get('/products/:slug', PILOT_PRODUCT);
```

- [ ] **Step 4: Run tests, types, lint, e2e regression**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils src/components/checkout` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/checkout/order-success.tsx src/utils/shipping-eta.ts` → clean.
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test checkout.miniapp --workers=1` → PASS ("Cảm ơn bạn đã chọn Tubu", code, cash note still visible).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/utils/shipping-eta.ts apps/miniapp/src/utils/shipping-eta.spec.ts apps/miniapp/src/components/checkout/order-success.tsx apps/miniapp/src/components/checkout/order-success.spec.tsx apps/miniapp/src/i18n/vi.ts apps/e2e/tests/support/checkout-mocks.ts
git commit -m "feat(miniapp): order success in DS v2 with copyable code, ETA, next steps and subscribe offer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 22: Miniapp — guard: 4a files never use legacy CSS vars

**Files:**
- Create: `apps/miniapp/src/ds-legacy-vars-4a.spec.ts`

**Interfaces:**
- Consumes: every file created/rewritten in Tasks 10-21.
- Produces: a regression guard (followups: "Guard against pilot pages / components/ui using old variable names") scoped to this plan's files; later plans append their files.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dự án 4a: file mới/viết lại không được dùng biến CSS v1 (`--neutral-*`, `--primary-*`, `--leaf-*`)
 * — khối alias legacy trong css/tokens.css chỉ còn để đỡ ~35 trang CHƯA migrate (spec §11).
 * Plan sau (4b/4c/4d) thêm file của mình vào danh sách.
 */
const FILES_4A = [
  'src/components/nav-config.ts',
  'src/components/bottom-nav.tsx',
  'src/components/back-button.tsx',
  'src/components/cart-button.tsx',
  'src/components/ui/cart-badge.tsx',
  'src/components/ui/segmented-tabs.tsx',
  'src/components/ui/product-tile.tsx',
  'src/components/reorder/reorder-sheet.tsx',
  'src/components/reorder/purchased-rail.tsx',
  'src/components/orders/order-card.tsx',
  'src/components/subscriptions-panel.tsx',
  'src/components/checkout/order-success.tsx',
  'src/pages/orders.tsx',
];
const LEGACY = /var\(--(neutral|primary|leaf)-/;

describe('4a — không dùng biến CSS cũ', () => {
  it.each(FILES_4A)('%s', (file) => {
    const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n');
    const hits = lines.map((l, i) => `${i + 1}: ${l.trim()}`).filter((l) => LEGACY.test(l));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/ds-legacy-vars-4a.spec.ts`
Expected: PASS (13 cases). If a case fails, replace the listed variable with its DS v2 semantic token in that file (do not remove the file from the list).

- [ ] **Step 3: Lint the same files**

Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/nav-config.ts src/components/bottom-nav.tsx src/components/back-button.tsx src/components/cart-button.tsx src/components/ui/cart-badge.tsx src/components/ui/segmented-tabs.tsx src/components/ui/product-tile.tsx src/components/reorder src/components/orders src/components/subscriptions-panel.tsx src/components/checkout/order-success.tsx src/pages/orders.tsx src/hooks`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/miniapp/src/ds-legacy-vars-4a.spec.ts
git commit -m "test(ds): guard buy-flow 4a files against legacy CSS variables" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 23: E2E — Home rail (2 taps), tab bar + badge, Orders tab, order card reorder

**Files:**
- Create: `apps/e2e/tests/support/buy-flow-mocks.ts`
- Create: `apps/e2e/tests/buy-flow-4a.miniapp.spec.ts`

**Interfaces:**
- Consumes: `MockApi`, `mockSession`, `makeUser`, `makeOrder`, `reply` (`support/mock-api.ts`), `publicConfig` (`support/checkout-mocks.ts`); miniapp types `CartSummary`, `OrderView`, `PageResponse`, `ProductCard`, `PurchasedItem`, `PurchasedItemsPage`, `NotificationDTO`, `SubscriptionDTO`.
- Produces (for Task 24): `THUMB`, `PURCHASED`, `PURCHASED_PAGE`, `CART_AFTER_ADD`, `DELIVERED_CODE`, `deliveredOrder()`, `mockBuyFlowSession(api, opts?: { activeCount?: number; purchased?: PurchasedItemsPage | 'not-found' })`, `mockOrdersTab(api)`, `SUBSCRIPTION`, `REMINDER`.

- [ ] **Step 1: Write the mocks and the spec**

`apps/e2e/tests/support/buy-flow-mocks.ts`:

```ts
import type { NotificationDTO } from '../../../miniapp/src/services/account-api';
import type {
  CartSummary, OrderView, PageResponse, ProductCard, PurchasedItem, PurchasedItemsPage,
} from '../../../miniapp/src/services/shop-api';
import type { SubscriptionDTO } from '../../../miniapp/src/services/subscriptions-api';
import { makeOrder, makeUser, mockSession, reply, type MockApi } from './mock-api';
import { publicConfig } from './checkout-mocks';

/**
 * Mock cho dự án 4a (buy-flow-4a.miniapp.spec.ts):
 *   GET /me/purchased-items (purchased-items.controller), GET /orders + /orders/active-count +
 *   POST /orders/:code/repurchase (orders.controller), POST /cart/items (cart.controller),
 *   GET /me/subscriptions, GET /me/notifications + POST /me/notifications/:id/read.
 * Ảnh dùng data: URI (host ngoài bị chặn trong mock-api.ts).
 */
export const THUMB = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

export const PURCHASED: PurchasedItem = {
  variationId: 'var-1',
  productId: 'prod-1',
  slug: 'nuoc-rua-chen-tubu',
  productName: 'Nước Rửa Chén Sinh Học Tubu 500ml',
  variationName: 'Hương Chanh Gừng',
  brand: 'Tubu',
  thumbnail: THUMB,
  price: 65000,
  salePrice: null,
  stock: 20,
  inStock: true,
  timesBought: 2,
  lastPurchasedAt: '2026-09-20T08:00:00.000Z',
};
export const PURCHASED_PAGE: PurchasedItemsPage = { items: [PURCHASED], nextCursor: null };

const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
export const CART_AFTER_ADD: CartSummary = {
  items: [
    {
      id: 'cart-item-1', variationId: 'var-1', slug: 'nuoc-rua-chen-tubu', productName: PURCHASED.productName,
      variationName: PURCHASED.variationName, thumbnail: THUMB, unitPrice: 65000, quantity: 2, stock: 20, weight: 600, total: 130000,
    },
  ],
  couponCode: null,
  subtotal: 130000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 200000,
  itemCount: 2,
};

const HOME_PRODUCT: ProductCard = {
  id: 'prod-9', slug: 'xa-phong-tubu', brand: 'Tubu', name: 'Xà Phòng Thảo Mộc Tubu', thumbnail: null,
  basePrice: 45000, salePrice: null, isFeatured: true, inStock: true, sold: 10,
};

/** Phiên + mọi khối của trang chủ (như miniapp.spec.ts) + kệ Mua lại + badge. */
export function mockBuyFlowSession(
  api: MockApi,
  opts: { activeCount?: number; purchased?: PurchasedItemsPage | 'not-found' } = {},
): void {
  mockSession(api, makeUser({ id: 'user-4a', fullName: 'Khách Mua Lại' }));
  const page: PageResponse<ProductCard> = { data: [HOME_PRODUCT], meta: { page: 1, limit: 6, total: 1 } };
  api.get('/products', page);
  api.get('/brands', [{ brand: 'Tubu', count: 3 }]);
  api.get('/cart', EMPTY_CART);
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/products/for-you', []);
  api.get('/me/notifications', []);
  api.get('/me/wishlist/ids', []);
  api.get('/config/public', publicConfig());
  api.post('/cart/items', CART_AFTER_ADD);
  const purchased = opts.purchased ?? PURCHASED_PAGE;
  api.get('/me/purchased-items', purchased === 'not-found' ? reply(404, { statusCode: 404, message: 'Cannot GET' }) : purchased);
  api.get('/orders/active-count', { count: opts.activeCount ?? 0 });
  // Sự kiện analytics / chạm CTV — fire-and-forget, không liên quan nội dung test.
  api.allowUnmocked('POST /events', 'POST /affiliate/touch', 'GET /me/coupons', 'GET /affiliate/me');
}

export const DELIVERED_CODE = 'TUBU-DLV-4A';

/** Đơn đã giao 2 dòng: 1 dòng còn hàng (SL 2), 1 dòng đã hết (SL 1) → "3 món". */
export function deliveredOrder(): OrderView {
  const base = makeOrder({ code: DELIVERED_CODE, status: 'DELIVERED', paymentStatus: 'PAID' });
  return {
    ...base,
    items: [
      {
        id: 'oi-avail', variationId: 'var-1', productName: PURCHASED.productName, productSlug: PURCHASED.slug,
        variationName: PURCHASED.variationName, unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0,
        thumbnail: THUMB, stock: 10, available: true, currentPrice: 65000,
      },
      {
        id: 'oi-out', variationId: 'var-out', productName: 'Xà Phòng Tubu Đã Hết', productSlug: 'xa-phong-het',
        variationName: '', unitPrice: 19000, quantity: 1, total: 19000, backorderedQty: 0,
        thumbnail: null, stock: 0, available: false, currentPrice: 19000,
      },
    ],
  };
}

export const SUBSCRIPTION: SubscriptionDTO = {
  id: 'sub-1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T00:00:00.000Z',
  productName: 'Nước Xả Vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nuoc-xa-vai', unitPrice: 80000, effectiveDiscountPct: 0.12,
};

/** Trang Đơn hàng + điều hướng sang giỏ sau khi mua lại cả đơn. */
export function mockOrdersTab(api: MockApi): void {
  api.get('/orders', (): PageResponse<OrderView> => ({ data: [deliveredOrder()], meta: { page: 1, limit: 20, total: 1 } }));
  api.get('/me/subscriptions', [SUBSCRIPTION]);
  api.post('/orders/:code/repurchase', {
    ...CART_AFTER_ADD,
    results: [{ orderItemId: 'oi-avail', status: 'added', addedQuantity: 2 }],
  });
  // Trang giỏ (sau khi mua lại) gọi thêm mã giảm giá / voucher — không liên quan nội dung test.
  api.allowUnmocked('GET /coupons/available', 'GET /me/vouchers');
}

export const REMINDER: NotificationDTO = {
  id: 'ntf-reorder-1',
  templateCode: 'REORDER_REMINDER',
  payload: {
    body: 'Nước Rửa Chén Sinh Học Tubu 500ml của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé!',
    data: { product: PURCHASED.productName, variation_id: 'var-1', product_slug: PURCHASED.slug },
  },
  status: 'SENT',
  sentAt: '2026-09-29T08:00:00.000Z',
};
```

`apps/e2e/tests/buy-flow-4a.miniapp.spec.ts`:

```ts
import { test, expect } from './support/mock-api';
import { DELIVERED_CODE, THUMB, mockBuyFlowSession, mockOrdersTab } from './support/buy-flow-mocks';

/**
 * Zalo Mini App E2E — Dự án 4a "Nhịp mua lại + tab bar + đặt hàng thành công"
 * (docs/superpowers/specs/2026-09-30-buy-flow-redesign-design.md §3-4). API mock toàn bộ.
 */
test.describe('Buy-flow 4a — mua lại, tab Đơn hàng', () => {
  test('Home: kệ "Mua lại" là khối đầu tiên dưới ô tìm; mua lại 1 SP đúng 2 chạm, ở lại trang chủ', async ({ page, api }) => {
    mockBuyFlowSession(api);
    await page.goto('/');

    const rail = page.getByRole('region', { name: 'Mua lại' });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    const [searchBox, railBox, aiBox] = await Promise.all([
      page.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }).boundingBox(),
      rail.boundingBox(),
      page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox(),
    ]);
    expect(railBox!.y).toBeGreaterThan(searchBox!.y);
    expect(railBox!.y).toBeLessThan(aiBox!.y);

    const added = api.waitForCall('POST', '/cart/items');
    await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click(); // chạm 1
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click(); // chạm 2
    const call = await added;
    expect(call.body).toEqual({ variationId: 'var-1', quantity: 1, addSource: 'repurchase' });
    await expect(page.getByText('Đã thêm 1 món vào giỏ')).toBeVisible();
    await expect(page.getByText('Xem giỏ')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Khách mới (chưa có đơn giao) → không có kệ Mua lại', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: { items: [], nextCursor: null } });
    await page.goto('/');
    await expect(page.locator('[aria-label="Xà Phòng Thảo Mộc Tubu"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
  });

  test('API cũ (purchased-items 404) → kệ ẩn im lặng, không có "Thử lại"', async ({ page, api }) => {
    mockBuyFlowSession(api, { purchased: 'not-found' });
    await page.goto('/');
    await expect(page.locator('[aria-label="Xà Phòng Thảo Mộc Tubu"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  });

  test('Tab bar: "Đơn hàng" thay "Ví & HH", badge đơn đang xử lý; /orders là trang gốc', async ({ page, api }) => {
    mockBuyFlowSession(api, { activeCount: 2 });
    mockOrdersTab(api);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    for (const label of ['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Cá nhân']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Ví & HH')).toHaveCount(0);
    const ordersTab = nav.getByRole('button', { name: 'Đơn hàng, 2 đơn đang xử lý' });
    await expect(ordersTab).toBeVisible();
    await expect(ordersTab.getByText('2', { exact: true })).toBeVisible();

    await ordersTab.click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Đơn hàng' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quay lại' })).toHaveCount(0);
    await expect(nav).toBeVisible();
  });

  test('Trang Đơn hàng: kệ Mua lại + 7 tab (có Định kỳ); "Đang xử lý" gửi group=processing; "Định kỳ" hiện lịch', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders');

    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` })).toBeVisible();
    const tabs = page.getByRole('tablist');
    for (const t of ['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ']) {
      await expect(tabs.getByRole('tab', { name: t, exact: true })).toBeAttached();
    }

    const filtered = api.waitForCall('GET', '/orders');
    await tabs.getByRole('tab', { name: 'Đang xử lý' }).click();
    const call = await filtered;
    expect(call.query.get('group')).toBe('processing');
    expect(call.query.get('status')).toBeNull();

    await tabs.getByRole('tab', { name: 'Định kỳ' }).click();
    await expect(page.getByText('Nước Xả Vải Tubu')).toBeVisible();
  });

  test('/subscriptions (link cũ) → /orders?tab=subscriptions, tab Định kỳ đang chọn', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/subscriptions');
    await expect(page).toHaveURL(/\/orders\?tab=subscriptions$/, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Thẻ đơn: ảnh SP đầu, "3 món"; "Mua lại" → sheet khoá dòng hết hàng, chỉ gửi dòng còn hàng → /cart', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    await page.goto('/orders');

    const card = page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('img')).toHaveAttribute('src', THUMB);
    await expect(card.getByText(/3 món/)).toBeVisible();

    await card.getByRole('button', { name: 'Mua lại', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Chọn Xà Phòng Tubu Đã Hết' })).toBeDisabled();
    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await page.getByRole('button', { name: 'Thêm vào giỏ (2)' }).click();
    const call = await posted;
    expect(call.body).toEqual({ items: [{ orderItemId: 'oi-avail', quantity: 2 }], addSource: 'repurchase' });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test buy-flow-4a --workers=1`
Expected: PASS 7/7. If the fixture reports an unmocked call from `/cart` (e.g. a voucher endpoint), add exactly that `"METHOD /path"` to the `allowUnmocked` call in `mockOrdersTab` with a one-line comment.
Run: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/support/buy-flow-mocks.ts apps/e2e/tests/buy-flow-4a.miniapp.spec.ts
git commit -m "test(e2e): buy-again rail, Orders tab and order card reorder (buy-flow 4a)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 24: E2E — reminder → sheet, order success, layout at 320/375px, sticky bar at 320px

**Files:**
- Modify: `apps/e2e/tests/buy-flow-4a.miniapp.spec.ts` (append a second `describe`)

**Interfaces:**
- Consumes: `mockBuyFlowSession`, `mockOrdersTab`, `PURCHASED_PAGE`, `REMINDER`, `DELIVERED_CODE` (Task 23); `mockCheckout`, `publicConfig`, `ORDER_CODE_COD` (`support/checkout-mocks.ts`); `makeOrder` (`support/mock-api.ts`).
- Produces: screenshots under the Playwright output dir (`home-<w>.png`, `orders-sheet-<w>.png`, `order-success-<w>.png`) for the visual check in Task 25.

- [ ] **Step 1: Append the tests**

Extend the imports at the top of `buy-flow-4a.miniapp.spec.ts`:

```ts
import { makeOrder } from './support/mock-api';
import { mockCheckout, publicConfig, ORDER_CODE_COD } from './support/checkout-mocks';
import { PURCHASED_PAGE, REMINDER } from './support/buy-flow-mocks';
```

(merge `PURCHASED_PAGE, REMINDER` into the existing `buy-flow-mocks` import line.)

Append:

```ts
test.describe('Buy-flow 4a — nhắc mua lại, đặt hàng thành công, bố cục', () => {
  test('Thông báo nhắc mua lại: "Mua lại ngay" mở sheet đúng variation; thêm giỏ với addSource=reorder_notification', async ({ page, api }) => {
    mockBuyFlowSession(api);
    api.get('/me/notifications', [REMINDER]);
    api.post('/me/notifications/:id/read', { ok: true });
    api.get('/me/purchased-items', ({ call }) =>
      call.query.get('variationId') === 'var-1' ? PURCHASED_PAGE : { items: [], nextCursor: null },
    );
    await page.goto('/notifications');

    await page.getByText('Nhắc mua lại').first().click({ timeout: 15_000 });
    const lookup = api.waitForCall('GET', '/me/purchased-items');
    await page.getByRole('button', { name: 'Mua lại ngay' }).click();
    expect((await lookup).query.get('variationId')).toBe('var-1');

    const added = api.waitForCall('POST', '/cart/items');
    await page.getByRole('button', { name: 'Thêm vào giỏ (1)' }).click();
    expect((await added).body).toEqual({ variationId: 'var-1', quantity: 1, addSource: 'reorder_notification' });
    await expect(page.getByText('Đã thêm 1 món vào giỏ')).toBeVisible();
  });

  test('Nhắc mua lại: SP không còn trong danh sách đã mua và payload thiếu slug → mở tab Đơn hàng', async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/me/notifications', [
      { ...REMINDER, id: 'ntf-2', payload: { ...REMINDER.payload, data: { product: 'SP cũ', variation_id: 'var-gone' } } },
    ]);
    api.post('/me/notifications/:id/read', { ok: true });
    api.get('/me/purchased-items', { items: [], nextCursor: null });
    await page.goto('/notifications');

    await page.getByText('Nhắc mua lại').first().click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Mua lại ngay' }).click();
    await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });
  });

  test('Đặt hàng thành công (DS v2): mã đơn sao chép được, tổng, điểm, giao dự kiến, 3 bước, gợi ý định kỳ; không lá rơi', async ({ page, api }) => {
    mockCheckout(api);
    api.get('/config/public', publicConfig({ shippingEta: { minDays: 2, maxDays: 4 } }));
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await placeBtn.click();

    await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ORDER_CODE_COD)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sao chép mã đơn' })).toBeVisible();
    await expect(page.getByText('149.000đ').first()).toBeVisible();
    await expect(page.getByText('+14 điểm')).toBeVisible();
    await expect(page.getByText('Giao dự kiến')).toBeVisible();
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) {
      await expect(page.getByText(s, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Đặt định kỳ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Theo dõi đơn' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếp tục mua sắm' })).toBeVisible();
    await expect(page.locator('.tubu-leaf')).toHaveCount(0);
  });

  for (const width of [320, 375]) {
    test(`Bố cục ${width}px: Home (kệ Mua lại), Đơn hàng + sheet Mua lại, màn thành công — không tràn ngang`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

      mockBuyFlowSession(api);
      mockOrdersTab(api);
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll()).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`home-${width}.png`) });

      await page.goto('/orders');
      const card = page.getByRole('button', { name: `Đơn ${DELIVERED_CODE}` });
      await expect(card).toBeVisible({ timeout: 15_000 });
      expect(await noHorizontalScroll()).toBe(true);
      await card.getByRole('button', { name: 'Mua lại', exact: true }).click();
      const cta = page.getByRole('button', { name: 'Thêm vào giỏ (2)' });
      await expect(cta).toBeVisible();
      const ctaBox = await cta.boundingBox();
      expect(ctaBox!.x).toBeGreaterThanOrEqual(0);
      expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(width);
      for (const plus of await page.getByRole('button', { name: 'Tăng số lượng' }).all()) {
        const b = await plus.boundingBox();
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
        expect(b!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: test.info().outputPath(`orders-sheet-${width}.png`) });
    });

    test(`Màn đặt hàng thành công ${width}px: nút nằm trọn trong màn hình`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      mockCheckout(api);
      api.get('/config/public', publicConfig({ shippingEta: { minDays: 2, maxDays: 4 } }));
      await page.goto('/checkout');
      const placeBtn = page.getByRole('button', { name: /Đặt hàng · 149\.000đ/ });
      await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
      await placeBtn.click();
      await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeVisible({ timeout: 10_000 });
      for (const name of ['Theo dõi đơn', 'Tiếp tục mua sắm', 'Đặt định kỳ', 'Sao chép mã đơn']) {
        const b = await page.getByRole('button', { name }).boundingBox();
        expect(b, name).not.toBeNull();
        expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`order-success-${width}.png`), fullPage: true });
    });
  }

  test('Chi tiết đơn 320px (followups DS v2): "Hủy đơn" + "Thanh toán ngay" nằm trọn và không bị cắt chữ', async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    mockBuyFlowSession(api);
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PAY-320', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' }));
    await page.goto('/order/TUBU-PAY-320');

    const bar = page.getByTestId('sticky-bar');
    for (const name of ['Hủy đơn', 'Thanh toán ngay']) {
      const btn = bar.getByRole('button', { name });
      await expect(btn).toBeVisible({ timeout: 15_000 });
      const b = await btn.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width, `${name} tràn phải`).toBeLessThanOrEqual(320);
      const label = btn.getByText(name, { exact: true });
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), `"${name}" bị rút gọn`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test buy-flow-4a --workers=1`
Expected: PASS (7 from Task 23 + 8 here). A failing layout assertion is a real bug in the component under test — fix the component (e.g. add `minWidth: 0` to the offending DS `Button`), not the threshold.
Run: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/buy-flow-4a.miniapp.spec.ts
git commit -m "test(e2e): reorder reminder, order success and 320/375px layout checks (buy-flow 4a)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 25: Full-suite verification, screenshots, follow-up ledger

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md` (mark the 4 debts done)

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for review; screenshots reviewed at 320px and 375px.

- [ ] **Step 1: Run every suite**

```bash
pnpm --filter @tubutree/api exec tsc --noEmit -p tsconfig.json
pnpm --filter @tubutree/api exec jest
cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand && cd ../..
pnpm --filter @tubutree/miniapp exec tsc --noEmit
pnpm --filter @tubutree/miniapp exec vitest run
pnpm lint:vars
pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json
E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test --workers=1
```

Expected: all green. The integration-race run includes the pre-existing race specs — they must still pass. The Playwright run covers every `*.miniapp.spec.ts` (existing specs rely on the `mockSession` / `mockCheckout` defaults added in Tasks 11, 15, 21).

- [ ] **Step 2: Lint the touched files (no new errors)**

```bash
pnpm --filter @tubutree/miniapp exec eslint src/components src/hooks src/services src/utils src/pages/orders.tsx src/pages/order-detail.tsx src/pages/home.tsx src/pages/browse.tsx src/pages/notifications.tsx src/pages/profile.tsx
pnpm --filter @tubutree/api exec eslint "src/modules/orders/**/*.ts" "src/modules/catalog/catalog.service.ts" "src/modules/system-config/**/*.ts"
```

Expected: the only miniapp errors are the pre-existing baseline ones listed in Ruling 17 (`home.tsx` raw `#fff`/`rgba`, `notifications.tsx` + `profile.tsx` zmp `Button` import and raw `rgba`); `back-button.tsx` must now be clean. Every file created or rewritten by this plan must be clean. Any other error is new and must be fixed in the file that introduced it.

- [ ] **Step 3: Visual check at 320px and 375px**

Open the screenshots written by Task 24 (`apps/e2e/test-results/**/home-320.png`, `home-375.png`, `orders-sheet-320.png`, `orders-sheet-375.png`, `order-success-320.png`, `order-success-375.png`). Check: rail tiles fully legible, "Mua lại" button not clipped, badge on the Orders tab not overlapping the label, sheet rows (checkbox, thumbnail, name, price, quantity) readable at 320px, success screen has no emoji or leaves, Vietnamese capitals with double diacritics in buttons (e.g. "Đặt định kỳ", "Tiếp tục mua sắm") are not clipped at the top. Record any defect as a fix commit in the owning task's files before continuing.

- [ ] **Step 4: Update the follow-up ledger**

In `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`, under "Must-do early in sub-project 4", append ` — done in 4a (Task 8)` to the Button-label diacritics item, the aria-order half of the Button item (leave the `useRef` lock half open), and the `--zaui-*` allowlist item; append ` — done in 4a (Task 24)` to the sticky-bar e2e item; append ` — started in 4a (Task 22, 4a files only)` to the legacy-variable guard item. Under "Deferred review findings", note that `SegmentedTabs` is now 44px (Task 18).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-28-design-system-v2-followups.md
git commit -m "docs(ds): mark design-system follow-ups closed by buy-flow 4a" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Deploy reminder (not part of this plan's execution): API first (no migration; optional config keys `shipping.eta_min_days` / `shipping.eta_max_days`), then miniapp.

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| §3.1 `GET /me/purchased-items` (DELIVERED only, own user, grouped, cursor, inactive excluded, `inStock:false`) | 4, 5 |
| §3.2 repurchase v2 (optional items, per-line results, approval check, addSource, no thumbnail column) | 2 (join), 3, 5 |
| §3.3 `ReorderSheet` + `useReorder` (checkbox, qty, OOS dimmed, subtotal, CTA, toast + "Xem giỏ", reasons in Vietnamese, single-item via `cart.addItem`) | 12, 13, 14 (+ Ruling 4) |
| §3.3 entry points: Home rail, order card, order detail, reminder, Orders-tab rail | 15, 18, 19, 20 |
| §3.4 events `reorder_clicked`, `reorder_completed`, `reorder_reminder_cta` | 9, 13, 14, 20 |
| §3.5 `nav-config.ts`, `CartButton`, `useCartCount` | 10, 11 (PDP deferred — Ruling 13) |
| 4a.1 tab bar, badge + `GET /orders/active-count`, `/orders` root, `/wallet` child, Profile hub | 1, 11 |
| 4a.2 Orders page: rail, tabs incl. Định kỳ, PACKED/RETURNED covered, `/subscriptions` redirect, card thumbnail + units + Mua lại | 1, 2, 16, 17, 18 (+ Ruling 1) |
| 4a.3 Home rail first under search, hidden for new customers; for-you ranking | 6, 15 |
| 4a.4 reminder → sheet by `variation_id`, fallback `/orders`, DS Button, event | 20 (+ Ruling 8) |
| 4a.5 order success (copyable code, total, points, ETA from config, 3 steps, CTAs, subscribe offer with PDP condition, no leaves/emoji) | 7, 21 (+ Rulings 9, 10) |
| §9 skeletons, silent hide, graceful degradation | 11, 15, 18 (+ Ruling 19) |
| §10 unit + real Postgres + e2e (Home 2 taps, Orders tab + badge, 320/375) | every task; 5; 23, 24 |
| Follow-up debts (label diacritics, aria order, `--zaui-*` allowlist, sticky bar 320px) | 8, 24, 25 |

No gaps for 4a. Out of scope by design: Browse/PDP/cart/checkout redesign (4b–4d), PDP `useCartCount` swap (4c).

**2. Placeholder scan** — no "TBD"/"TODO"/"similar to"; every code step has code. The two conditional instructions (add a discovered unmocked call to `allowUnmocked`; fix a component if a layout assertion fails) name the exact file and action.

**3. Type consistency** — checked: `OrderListFilter` (API: `status?: OrderStatus`, miniapp: `status?: string`) are separate app-local types by design (Ruling 11); `RepurchaseLineResult`/`RepurchaseSkipReason` identical on both sides; `ReorderSource` defined once (Task 9) and re-exported from `reorder-types.ts`; `ReorderSummary.hasProblems` defined in Task 12 and used in Task 13; `useActiveOrderCount(enabled)` (Task 11) matches its mock in `bottom-nav.spec.tsx`; `usePurchasedItems(limit)` → `fetchPurchasedItems({ limit })` matches `purchased-rail.spec.tsx` (`{ limit: 10 }`); `shippingEta` shape `{ minDays, maxDays }` matches API (Task 7), client type (Task 9) and `shippingEtaLabel` (Task 21); query keys `['cart']`, `['orders', 'active-count']`, `['orders', 'list', tab]`, `['purchased-items', limit]`, `['product', slug]` are used consistently.

**4. Review Focus** — each line has a pinning test: old-client repurchase shape (Task 3 "không body (client cũ)"), route order (Task 1 controller spec), cart-near-stock line isolation (Task 3 + Task 5 (a)), silent rail on guest/new/404 (Task 15 three tests + Task 23 two e2e tests), double tap (Task 14 "chạm đúp CTA").

