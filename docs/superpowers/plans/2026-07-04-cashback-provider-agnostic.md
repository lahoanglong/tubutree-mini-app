# Cashback Provider-Agnostic + Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bóc AccessTrade (đang hard-code) trong module `cashback` ra sau interface `CashbackProvider` + DI registry, thêm reconciliation cron gated bằng `ACCESSTRADE_TOKEN` — không đổi lõi state-machine tài chính hay money flow.

**Architecture:** Mỗi provider là một `@Injectable` implement `CashbackProvider` (`buildDeeplink`/`verifyWebhook`/`parseWebhook`/`isReconcileEnabled`/`fetchTransactions`), gom qua `CashbackProviderRegistry` (DI token `CASHBACK_PROVIDERS`). Merchant mang field `provider`. `CashbackService.handlePostback` tách thành `ingest(NormalizedCashbackEvent, providerKey)` provider-agnostic; webhook route generic `POST /webhooks/cashback/:provider` + alias `/webhooks/accesstrade` (deprecated). Idempotency key đổi từ `merchantOrderId` sang composite `[provider, merchantOrderId]`.

**Tech Stack:** NestJS 10, Prisma 5 (PostgreSQL), Jest 29, axios, `@nestjs/schedule`. Nhánh: `feat/cashback-provider-agnostic` (đã tạo). Spec: [docs/superpowers/specs/2026-07-04-cashback-provider-agnostic-design.md](../specs/2026-07-04-cashback-provider-agnostic-design.md).

**Quy ước lệnh test:** chạy từ root repo — `pnpm --filter @tubutree/api test <đường-dẫn-spec>`. Typecheck: `pnpm --filter @tubutree/api typecheck`. Lint: `pnpm --filter @tubutree/api lint`.

---

## Task 1: Schema + migration + seed (field `provider`, composite unique)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `CashbackMerchant` ~879-893, model `CashbackTransaction` ~918-934)
- Create: `apps/api/prisma/migrations/20260704000000_cashback_provider/migration.sql`
- Modify: `apps/api/prisma/seed.ts` (CASHBACK_MERCHANTS ~584-588, mảng config cashback ~40-46)

- [ ] **Step 1: Sửa schema — CashbackMerchant thêm `provider`**

Trong `model CashbackMerchant`, thêm dòng `provider` ngay dưới `slug`:

```prisma
model CashbackMerchant {
  id               String          @id @default(cuid())
  slug             String          @unique
  provider         String          @default("accesstrade")
  name             String
  logoUrl          String
  category         String
  baseRate         Decimal
  fullRate         Decimal
  isActive         Boolean         @default(true)
  deeplinkTemplate String
  terms            String?
  clicks           CashbackClick[]

  @@map("cashback_merchants")
}
```

- [ ] **Step 2: Sửa schema — CashbackTransaction thêm `provider`, đổi unique**

Đổi `merchantOrderId String @unique` thành `merchantOrderId String` (bỏ `@unique`), thêm `provider`, thêm `@@unique`:

```prisma
model CashbackTransaction {
  id              String         @id @default(cuid())
  userId          String
  user            User           @relation(fields: [userId], references: [id])
  clickId         String?
  provider        String         @default("accesstrade")
  merchantOrderId String
  orderAmount     Int
  commission      Int
  userReward      Int
  status          CashbackStatus @default(PENDING)
  postbackPayload Json
  confirmedAt     DateTime?
  paidAt          DateTime?

  @@unique([provider, merchantOrderId])
  @@index([userId, status])
  @@map("cashback_transactions")
}
```

- [ ] **Step 3: Viết migration SQL tay**

Tạo file `apps/api/prisma/migrations/20260704000000_cashback_provider/migration.sql`:

```sql
-- Cashback provider-agnostic: tag provider cho merchant + transaction; đổi idempotency key
-- từ merchantOrderId đơn lẻ sang composite (provider, merchantOrderId) để đa provider không đụng nhau.

-- 1) Tag provider (default 'accesstrade' → tự back-fill row cũ).
ALTER TABLE "cashback_merchants" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'accesstrade';
ALTER TABLE "cashback_transactions" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'accesstrade';

-- 2) Đổi unique: bỏ merchantOrderId đơn lẻ, tạo composite (provider, merchantOrderId).
DROP INDEX "cashback_transactions_merchantOrderId_key";
CREATE UNIQUE INDEX "cashback_transactions_provider_merchantOrderId_key"
  ON "cashback_transactions" ("provider", "merchantOrderId");
```

- [ ] **Step 4: Cập nhật seed — provider cho merchant**

Trong `apps/api/prisma/seed.ts`, thêm `provider: 'accesstrade'` cho cả 3 phần tử CASHBACK_MERCHANTS:

```ts
const CASHBACK_MERCHANTS = [
  { id: 'cb-shopee', slug: 'shopee', provider: 'accesstrade', name: 'Shopee', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.035), fullRate: new Prisma.Decimal(0.05), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/shopee?utm_content={{clickId}}' },
  { id: 'cb-lazada', slug: 'lazada', provider: 'accesstrade', name: 'Lazada', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.042), fullRate: new Prisma.Decimal(0.06), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/lazada?utm_content={{clickId}}' },
  { id: 'cb-tiktok', slug: 'tiktokshop', provider: 'accesstrade', name: 'TikTok Shop', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.049), fullRate: new Prisma.Decimal(0.07), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/tiktok?utm_content={{clickId}}' },
];
```

- [ ] **Step 5: Cập nhật seed — config reconcile**

Trong mảng config (khối `// Cashback`, sau dòng `cashback.click_rate_limit_seconds`), thêm 1 dòng:

```ts
  { key: 'cashback.reconcile_lookback_days', value: 45, category: 'cashback', description: 'Reconcile cron kéo giao dịch từ provider trong N ngày gần nhất (phủ hold window + biên)' },
```

- [ ] **Step 6: Áp migration + regenerate client**

Run: `pnpm --filter @tubutree/api prisma:generate`
Then: `pnpm --filter @tubutree/api exec prisma migrate deploy`
Expected: `Applying migration 20260704000000_cashback_provider` → `All migrations have been applied`. Client regenerate không báo lỗi.

(Nếu chạy trên DB dev có drift, dùng `prisma migrate dev` và xác nhận Prisma KHÔNG tạo thêm migration mới — schema đã khớp SQL tay.)

- [ ] **Step 7: Typecheck (client mới có field `provider`)**

Run: `pnpm --filter @tubutree/api typecheck`
Expected: PASS (chưa dùng `provider` ở service nên không lỗi; nếu Prisma types cũ còn cache, generate lại).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260704000000_cashback_provider apps/api/prisma/seed.ts
git commit -m "feat(cashback): schema provider field + composite unique [provider, merchantOrderId]"
```

---

## Task 2: Provider contract + registry

**Files:**
- Create: `apps/api/src/modules/cashback/providers/cashback-provider.interface.ts`
- Create: `apps/api/src/modules/cashback/providers/cashback-provider.registry.ts`
- Test: `apps/api/src/modules/cashback/providers/cashback-provider.registry.spec.ts`

- [ ] **Step 1: Tạo interface + DI token**

Tạo `apps/api/src/modules/cashback/providers/cashback-provider.interface.ts`:

```ts
/** Sự kiện cashback đã chuẩn hoá — lõi CashbackService CHỈ làm việc với shape này. */
export interface NormalizedCashbackEvent {
  clickRef: string; // khớp CashbackClick.utmTraceId
  merchantOrderId: string; // id đơn của sàn (idempotency trong phạm vi provider)
  orderAmount: number; // VND, ≥ 0
  commission: number; // VND, ≥ 0
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  raw: unknown; // payload gốc → lưu postbackPayload
}

/** Adapter cho một mạng cashback (AccessTrade, Involve Asia, direct…). */
export interface CashbackProvider {
  readonly key: string;
  buildDeeplink(template: string, clickId: string, productUrl?: string): string;
  verifyWebhook(headers: Record<string, string | undefined>, body: unknown): boolean;
  parseWebhook(body: unknown): NormalizedCashbackEvent | null; // null = sai shape → bỏ qua
  isReconcileEnabled(): boolean;
  fetchTransactions(since: Date): Promise<NormalizedCashbackEvent[]>;
}

/** DI token gom mọi CashbackProvider (multi-provider array). */
export const CASHBACK_PROVIDERS = Symbol('CASHBACK_PROVIDERS');
```

- [ ] **Step 2: Viết test registry (failing)**

Tạo `apps/api/src/modules/cashback/providers/cashback-provider.registry.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { CashbackProviderRegistry } from './cashback-provider.registry';
import type { CashbackProvider } from './cashback-provider.interface';

const stub = (key: string): CashbackProvider => ({
  key,
  buildDeeplink: () => '',
  verifyWebhook: () => true,
  parseWebhook: () => null,
  isReconcileEnabled: () => false,
  fetchTransactions: async () => [],
});

describe('CashbackProviderRegistry', () => {
  it('get() trả provider theo key', () => {
    const r = new CashbackProviderRegistry([stub('accesstrade')]);
    expect(r.get('accesstrade').key).toBe('accesstrade');
  });

  it('get() key lạ → NotFoundException', () => {
    const r = new CashbackProviderRegistry([stub('accesstrade')]);
    expect(() => r.get('involve')).toThrow(NotFoundException);
  });

  it('all() trả mọi provider đã đăng ký', () => {
    const r = new CashbackProviderRegistry([stub('a'), stub('b')]);
    expect(r.all().map((p) => p.key).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 3: Chạy test — xác nhận FAIL**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/providers/cashback-provider.registry.spec.ts`
Expected: FAIL — `Cannot find module './cashback-provider.registry'`.

- [ ] **Step 4: Tạo registry**

Tạo `apps/api/src/modules/cashback/providers/cashback-provider.registry.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CASHBACK_PROVIDERS, type CashbackProvider } from './cashback-provider.interface';

/** Tra CashbackProvider theo key. Đăng ký qua DI token CASHBACK_PROVIDERS. */
@Injectable()
export class CashbackProviderRegistry {
  private readonly byKey: Map<string, CashbackProvider>;

  constructor(@Inject(CASHBACK_PROVIDERS) providers: CashbackProvider[]) {
    this.byKey = new Map(providers.map((p) => [p.key, p]));
  }

  get(key: string): CashbackProvider {
    const provider = this.byKey.get(key);
    if (!provider) throw new NotFoundException(`Cashback provider không tồn tại: ${key}`);
    return provider;
  }

  all(): CashbackProvider[] {
    return [...this.byKey.values()];
  }
}
```

- [ ] **Step 5: Chạy test — xác nhận PASS**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/providers/cashback-provider.registry.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/cashback/providers/cashback-provider.interface.ts apps/api/src/modules/cashback/providers/cashback-provider.registry.ts apps/api/src/modules/cashback/providers/cashback-provider.registry.spec.ts
git commit -m "feat(cashback): CashbackProvider interface + registry"
```

---

## Task 3: AccessTradeProvider adapter

**Files:**
- Create: `apps/api/src/modules/cashback/providers/access-trade.provider.ts`
- Test: `apps/api/src/modules/cashback/providers/access-trade.provider.spec.ts`

- [ ] **Step 1: Viết test adapter (failing)**

Tạo `apps/api/src/modules/cashback/providers/access-trade.provider.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { AccessTradeProvider } from './access-trade.provider';

const makeProvider = (over: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    ACCESSTRADE_BASE_URL: 'https://api.accesstrade.vn/v1',
    ACCESSTRADE_TOKEN: '',
    ACCESSTRADE_WEBHOOK_SECRET: '',
    ...over,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<never, true>;
  return new AccessTradeProvider(config);
};

const post = (over: Record<string, unknown> = {}) => ({
  utm_content: 'click-1',
  order_id: 'AT-ORDER-1',
  amount: 500000,
  commission: 50000,
  status: 'approved',
  ...over,
});

describe('AccessTradeProvider.parseWebhook', () => {
  it('approved → CONFIRMED, map đủ field', () => {
    const e = makeProvider().parseWebhook(post())!;
    expect(e).toMatchObject({
      clickRef: 'click-1',
      merchantOrderId: 'AT-ORDER-1',
      orderAmount: 500000,
      commission: 50000,
      status: 'CONFIRMED',
    });
  });

  it('pending → PENDING; rejected → REJECTED', () => {
    expect(makeProvider().parseWebhook(post({ status: 'pending' }))!.status).toBe('PENDING');
    expect(makeProvider().parseWebhook(post({ status: 'rejected' }))!.status).toBe('REJECTED');
  });

  it('commission âm → null (chống cộng số dư âm)', () => {
    expect(makeProvider().parseWebhook(post({ commission: -1 }))).toBeNull();
  });

  it('thiếu field / sai kiểu → null', () => {
    expect(makeProvider().parseWebhook(post({ order_id: undefined }))).toBeNull();
    expect(makeProvider().parseWebhook(post({ amount: 'x' }))).toBeNull();
    expect(makeProvider().parseWebhook(null)).toBeNull();
  });
});

describe('AccessTradeProvider.verifyWebhook', () => {
  it('secret cấu hình + token đúng → true', () => {
    const p = makeProvider({ ACCESSTRADE_WEBHOOK_SECRET: 'secret-abc' });
    expect(p.verifyWebhook({ 'x-accesstrade-token': 'secret-abc' }, {})).toBe(true);
  });

  it('secret cấu hình + token sai/thiếu → false', () => {
    const p = makeProvider({ ACCESSTRADE_WEBHOOK_SECRET: 'secret-abc' });
    expect(p.verifyWebhook({ 'x-accesstrade-token': 'sai' }, {})).toBe(false);
    expect(p.verifyWebhook({}, {})).toBe(false);
  });

  it('chưa cấu hình secret + KHÔNG phải production → true (dev bỏ qua)', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(makeProvider().verifyWebhook({}, {})).toBe(true);
    process.env.NODE_ENV = prev;
  });

  it('chưa cấu hình secret + production → false (fail-closed)', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(makeProvider().verifyWebhook({}, {})).toBe(false);
    process.env.NODE_ENV = prev;
  });
});

describe('AccessTradeProvider.buildDeeplink / isReconcileEnabled', () => {
  it('buildDeeplink thay {{clickId}} + append productUrl đã encode', () => {
    const url = makeProvider().buildDeeplink('https://x.vn/dl?utm_content={{clickId}}', 'abc', 'https://shopee.vn/p?id=1');
    expect(url).toBe('https://x.vn/dl?utm_content=abc&url=https%3A%2F%2Fshopee.vn%2Fp%3Fid%3D1');
  });

  it('isReconcileEnabled theo ACCESSTRADE_TOKEN', () => {
    expect(makeProvider().isReconcileEnabled()).toBe(false);
    expect(makeProvider({ ACCESSTRADE_TOKEN: 'tok' }).isReconcileEnabled()).toBe(true);
  });

  it('fetchTransactions khi chưa có token → [] (không gọi API)', async () => {
    expect(await makeProvider().fetchTransactions(new Date(0))).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/providers/access-trade.provider.spec.ts`
Expected: FAIL — `Cannot find module './access-trade.provider'`.

- [ ] **Step 3: Tạo AccessTradeProvider**

Tạo `apps/api/src/modules/cashback/providers/access-trade.provider.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../../../config/env.validation';
import type { CashbackProvider, NormalizedCashbackEvent } from './cashback-provider.interface';

/** Shape postback / transaction của AccessTrade (đặc thù vendor — không rò rỉ ra lõi). */
interface AccesstradePayload {
  utm_content: string; // clickId
  order_id: string;
  amount: number;
  commission: number;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Adapter AccessTrade. Reconcile gate bằng ACCESSTRADE_TOKEN (chưa cấu hình → no-op).
 * verifyWebhook: fail-closed ở production khi chưa có secret; dev bỏ qua cho dễ thử.
 */
@Injectable()
export class AccessTradeProvider implements CashbackProvider {
  readonly key = 'accesstrade';
  private readonly logger = new Logger(AccessTradeProvider.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('ACCESSTRADE_BASE_URL', { infer: true });
    this.token = config.get('ACCESSTRADE_TOKEN', { infer: true });
    this.webhookSecret = config.get('ACCESSTRADE_WEBHOOK_SECRET', { infer: true });
  }

  buildDeeplink(template: string, clickId: string, productUrl?: string): string {
    let url = template.replace('{{clickId}}', clickId);
    if (productUrl) url += `&url=${encodeURIComponent(productUrl)}`;
    return url;
  }

  verifyWebhook(headers: Record<string, string | undefined>): boolean {
    // Chưa cấu hình secret: dev cho qua, production từ chối (env.validation cũng ép secret ở prod).
    if (!this.webhookSecret) return process.env.NODE_ENV !== 'production';
    return this.tokenMatches(headers['x-accesstrade-token']);
  }

  parseWebhook(body: unknown): NormalizedCashbackEvent | null {
    const p = body as Partial<AccesstradePayload> | null;
    if (!p || typeof p.utm_content !== 'string' || typeof p.order_id !== 'string') return null;
    if (typeof p.amount !== 'number' || typeof p.commission !== 'number') return null;
    if (p.amount < 0 || p.commission < 0) return null; // chống cộng số dư âm (forge/bug)
    const status = p.status === 'approved' ? 'CONFIRMED' : p.status === 'rejected' ? 'REJECTED' : 'PENDING';
    return {
      clickRef: p.utm_content,
      merchantOrderId: p.order_id,
      orderAmount: p.amount,
      commission: p.commission,
      status,
      raw: body,
    };
  }

  isReconcileEnabled(): boolean {
    return Boolean(this.token);
  }

  /** Kéo giao dịch gần đây để đối soát (bắt postback rớt). Gated bằng token. */
  async fetchTransactions(since: Date): Promise<NormalizedCashbackEvent[]> {
    if (!this.token) return [];
    const { data } = await axios.get(`${this.baseUrl.replace(/\/$/, '')}/transactions`, {
      headers: { Authorization: `Bearer ${this.token}` },
      params: { since: since.toISOString() },
      timeout: 30000,
    });
    const rows: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      .map((r) => this.parseWebhook(r))
      .filter((e): e is NormalizedCashbackEvent => e !== null);
  }

  private tokenMatches(token?: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.webhookSecret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/providers/access-trade.provider.spec.ts`
Expected: PASS (toàn bộ describe).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cashback/providers/access-trade.provider.ts apps/api/src/modules/cashback/providers/access-trade.provider.spec.ts
git commit -m "feat(cashback): AccessTradeProvider adapter (deeplink/verify/parse/reconcile)"
```

---

## Task 4: Refactor CashbackService — `ingest()` + `createClick` qua registry

**Files:**
- Modify: `apps/api/src/modules/cashback/cashback.service.ts` (toàn bộ)
- Test: `apps/api/src/modules/cashback/cashback.service.spec.ts` (cập nhật helper + constructor)

- [ ] **Step 1: Cập nhật test — đổi payload AT → normalized, `handlePostback` → `ingest`**

Trong `apps/api/src/modules/cashback/cashback.service.spec.ts`:

(a) Thêm stub registry + import ở đầu file (sau các import `type`):

```ts
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';

const registry = {
  get: jest.fn(),
  all: jest.fn().mockReturnValue([]),
} as unknown as CashbackProviderRegistry;
```

(b) Đổi helper `payload()` sang shape normalized:

```ts
const event = (over: Partial<Record<string, unknown>> = {}) => ({
  clickRef: 'click-1',
  merchantOrderId: 'AT-ORDER-1',
  orderAmount: 500000,
  commission: 50000,
  status: 'CONFIRMED' as const,
  raw: {},
  ...over,
});
```

(c) Thay MỌI lời gọi constructor `new CashbackService(prisma, config, coins, notifications)` thành `new CashbackService(prisma, config, coins, notifications, registry)`, và MỌI `.handlePostback(payload({...}))` thành `.ingest(event({...}), 'accesstrade')`. Bảng đổi giá trị trong `over`:
- `status: 'approved'` → `status: 'CONFIRMED'`
- `status: 'pending'` → `status: 'PENDING'`
- `status: 'rejected'` → `status: 'REJECTED'`

(d) Trong các test tra `cashbackClick.findUnique`, đổi field khớp: lõi giờ tra theo `utmTraceId: event.clickRef` (vẫn là 'click-1') — mock trả `{ id: 'c1', userId: 'u1' }` giữ nguyên.

(e) Test "commission âm → ok:false" (dòng ~164): guard âm đã chuyển sang `parseWebhook` (Task 3). Ở lõi, đổi test này thành: `ingest` với `commission: -1` → `{ ok: false }`, KHÔNG tra click:

```ts
it('commission âm (phòng thủ ở ingest) → ok:false, không tạo giao dịch', async () => {
  const findUnique = jest.fn();
  const prisma = { cashbackClick: { findUnique } } as unknown as PrismaService;
  const r = await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ commission: -1 }), 'accesstrade');
  expect(r).toEqual({ ok: false });
  expect(findUnique).not.toHaveBeenCalled();
});
```

(f) Trong các test nhánh `existing` (helper `updateBranchPrisma`) và `settlePrisma`, giữ nguyên — chỉ đổi lời gọi sang `.ingest(event({...}), 'accesstrade')`. Với `findFirst` của existing, lõi giờ query `{ where: { provider: 'accesstrade', merchantOrderId: 'AT-ORDER-1' } }` — mock `findFirst.mockResolvedValue(existing)` không quan tâm where nên vẫn chạy.

- [ ] **Step 2: Chạy test — xác nhận FAIL (chưa có `ingest`)**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/cashback.service.spec.ts`
Expected: FAIL — `ingest is not a function` / thiếu tham số constructor.

- [ ] **Step 3: Viết lại `cashback.service.ts`**

Thay toàn bộ nội dung `apps/api/src/modules/cashback/cashback.service.ts` bằng:

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CoinsService } from '../wallet/coins.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import type { NormalizedCashbackEvent } from './providers/cashback-provider.interface';

/**
 * Cashback sàn ngoài (Build Spec §9, §15 cashback.*). Provider-agnostic: I/O vendor nằm ở
 * CashbackProvider; lõi này chỉ xử lý NormalizedCashbackEvent. Tubu giữ margin, user nhận
 * `merchant_user_share` (mặc định 70%). Hold `cashback.hold_days` sau confirm rồi mới về Ví.
 */
@Injectable()
export class CashbackService {
  private readonly logger = new Logger(CashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly coins: CoinsService,
    private readonly notifications: NotificationsService,
    private readonly registry: CashbackProviderRegistry,
  ) {}

  listMerchants() {
    return this.prisma.cashbackMerchant.findMany({ where: { isActive: true } });
  }

  /** Tạo click + sinh deeplink chứa clickId theo provider của merchant. */
  async createClick(userId: string, merchantId: string, productUrl?: string) {
    const merchant = await this.prisma.cashbackMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant || !merchant.isActive) throw new BadRequestException('Sàn không khả dụng.');
    const provider = this.registry.get(merchant.provider);

    const rateLimit = await this.config.get<number>('cashback.click_rate_limit_seconds', 30);
    const recent = await this.prisma.cashbackClick.findFirst({
      where: { userId, merchantId, clickedAt: { gte: new Date(Date.now() - rateLimit * 1000) } },
    });
    if (recent) {
      return { deeplink: provider.buildDeeplink(merchant.deeplinkTemplate, recent.utmTraceId, productUrl) };
    }

    const clickId = randomUUID().replace(/-/g, '');
    const deeplink = provider.buildDeeplink(merchant.deeplinkTemplate, clickId, productUrl);
    await this.prisma.cashbackClick.create({
      data: { userId, merchantId, utmTraceId: clickId, destinationUrl: deeplink, productUrl },
    });
    return { deeplink };
  }

  listTransactions(userId: string) {
    return this.prisma.cashbackTransaction.findMany({
      where: { userId },
      orderBy: { confirmedAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Nạp một sự kiện cashback đã chuẩn hoá (từ webhook HOẶC reconcile). Idempotent theo
   * (provider, merchantOrderId). Dùng chung cho mọi provider.
   */
  async ingest(event: NormalizedCashbackEvent, provider: string) {
    // Phòng thủ: parseWebhook đã guard, nhưng reconcile cũng gọi vào đây → guard lại.
    if (event.orderAmount < 0 || event.commission < 0) {
      this.logger.warn(`Ingest số âm — bỏ qua. order=${event.merchantOrderId}`);
      return { ok: false };
    }
    const click = await this.prisma.cashbackClick.findUnique({ where: { utmTraceId: event.clickRef } });
    if (!click) {
      this.logger.warn(`Ingest không khớp clickId ${event.clickRef}`);
      return { ok: false };
    }
    const userShare = await this.config.get<number>('cashback.merchant_user_share', 0.7);
    const userReward = Math.floor(event.commission * userShare);
    const status = event.status;

    const existing = await this.prisma.cashbackTransaction.findFirst({
      where: { provider, merchantOrderId: event.merchantOrderId },
    });

    let becameConfirmed = false;
    let confirmedUserId: string | null = null;

    if (existing) {
      // Đã settle về Ví (PAID) → BỎ QUA postback đến sau: không ghi đè status, không đụng số dư
      // (không claw-back được tiền đã về Ví).
      if (existing.status === 'PAID') return { ok: true };

      // Chuyển trạng thái ATOMIC bằng optimistic CAS theo status đã đọc + điều chỉnh pending trong
      // CÙNG tx → chống 2 sự kiện 'approved' song song cùng cộng pending 2 lần. Racer thua thấy
      // count=0 → bỏ qua.
      const wasConfirmed = existing.status === 'CONFIRMED';
      const nowConfirmed = status === 'CONFIRMED';
      const applied = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.cashbackTransaction.updateMany({
          where: { id: existing.id, status: existing.status },
          data: {
            // confirmedAt set MỚI khi chuyển từ chưa-confirmed sang confirmed (reset đồng hồ hold);
            // giữ nguyên khi đã confirmed. Tránh REJECTED→CONFIRMED giữ confirmedAt cũ → settle ngay.
            status,
            confirmedAt: nowConfirmed && !wasConfirmed ? new Date() : existing.confirmedAt,
          },
        });
        if (moved.count === 0) return false;
        if (nowConfirmed && !wasConfirmed) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { cashbackPending: { increment: existing.userReward } },
          });
        } else if (wasConfirmed && !nowConfirmed) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { cashbackPending: { decrement: existing.userReward } },
          });
        }
        return true;
      });
      if (applied && nowConfirmed && !wasConfirmed) {
        becameConfirmed = true;
        confirmedUserId = existing.userId;
      }
    } else {
      // Atomic create + cộng pending. @@unique([provider, merchantOrderId]) → sự kiện thứ 2 song
      // song ném P2002 → bỏ qua để KHÔNG double-credit.
      try {
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.cashbackTransaction.create({
            data: {
              userId: click.userId,
              clickId: click.id,
              provider,
              merchantOrderId: event.merchantOrderId,
              orderAmount: event.orderAmount,
              commission: event.commission,
              userReward,
              status,
              postbackPayload: event.raw as object,
              confirmedAt: status === 'CONFIRMED' ? new Date() : null,
            },
          }),
        ];
        if (status === 'CONFIRMED') {
          ops.push(
            this.prisma.user.update({
              where: { id: click.userId },
              data: { cashbackPending: { increment: userReward } },
            }),
          );
          becameConfirmed = true;
          confirmedUserId = click.userId;
        }
        await this.prisma.$transaction(ops);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.warn(`Ingest trùng (${provider}, ${event.merchantOrderId}) (race) — bỏ qua.`);
          return { ok: true };
        }
        throw err;
      }
    }

    // Thưởng xu giới thiệu khi referee có cashback CONFIRMED (ngoài tx tài chính; idempotent qua
    // unique index). Lỗi thưởng KHÔNG làm hỏng ingest (.catch).
    if (becameConfirmed && confirmedUserId) {
      await this.coins.grantReferralCoins(confirmedUserId).catch((err) =>
        this.logger.error(
          `Thưởng xu giới thiệu lỗi (referee=${confirmedUserId}): ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
    return { ok: true };
  }

  /** Cron mỗi giờ: cashback CONFIRMED quá hold_days → chuyển pending→Ví (PAID). */
  @Cron('0 30 * * * *')
  async settleConfirmed(): Promise<void> {
    const holdDays = await this.config.get<number>('cashback.hold_days', 30);
    const threshold = new Date(Date.now() - holdDays * 24 * 3600 * 1000);
    const due = await this.prisma.cashbackTransaction.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { lte: threshold } },
    });
    for (const tx of due) {
      const settled = await this.prisma.$transaction(async (t) => {
        const marked = await t.cashbackTransaction.updateMany({
          where: { id: tx.id, status: 'CONFIRMED' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (marked.count === 0) return false;
        await t.user.update({
          where: { id: tx.userId },
          data: {
            cashbackPending: { decrement: tx.userReward },
            walletBalance: { increment: tx.userReward },
          },
        });
        return true;
      });
      if (settled) {
        await this.notifications
          .notify(tx.userId, 'CASHBACK_PAID', { amount: tx.userReward.toLocaleString('vi-VN') })
          .catch((err) => this.logger.error(`Notify CASHBACK_PAID lỗi: ${err instanceof Error ? err.message : err}`));
      }
    }
    if (due.length > 0) this.logger.log(`Settle ${due.length} cashback → Ví Tubu.`);
  }

  /**
   * Cron mỗi 6 giờ: đối soát — kéo giao dịch gần đây từ mỗi provider có bật reconcile
   * (isReconcileEnabled) rồi feed qua ingest() (idempotent). Bắt postback rớt.
   */
  @Cron('0 0 */6 * * *')
  async reconcile(): Promise<void> {
    const lookbackDays = await this.config.get<number>('cashback.reconcile_lookback_days', 45);
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
    for (const provider of this.registry.all()) {
      if (!provider.isReconcileEnabled()) {
        this.logger.debug(`Reconcile skip ${provider.key} (chưa cấu hình).`);
        continue;
      }
      try {
        const events = await provider.fetchTransactions(since);
        for (const e of events) await this.ingest(e, provider.key);
        if (events.length) this.logger.log(`Reconcile ${provider.key}: ${events.length} giao dịch.`);
      } catch (err) {
        this.logger.error(`Reconcile ${provider.key} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
```

- [ ] **Step 4: Chạy test service — xác nhận PASS**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/cashback.service.spec.ts`
Expected: PASS (mọi test state-machine + settle, đã đổi sang `ingest`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cashback/cashback.service.ts apps/api/src/modules/cashback/cashback.service.spec.ts
git commit -m "refactor(cashback): tách handlePostback → ingest(normalized) provider-agnostic + reconcile cron"
```

---

## Task 5: Controller webhook generic + alias, wire module

**Files:**
- Modify: `apps/api/src/modules/cashback/cashback.controller.ts` (toàn bộ)
- Modify: `apps/api/src/modules/cashback/cashback.module.ts`
- Test: `apps/api/src/modules/cashback/cashback.controller.spec.ts` (viết lại)

- [ ] **Step 1: Viết lại controller test (failing)**

Thay toàn bộ `apps/api/src/modules/cashback/cashback.controller.spec.ts` bằng:

```ts
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CashbackController } from './cashback.controller';
import type { CashbackService } from './cashback.service';
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import type { CashbackProvider, NormalizedCashbackEvent } from './providers/cashback-provider.interface';

const body = { utm_content: 'click-1', order_id: 'O1', amount: 500000, commission: 50000, status: 'approved' };
const normalized: NormalizedCashbackEvent = {
  clickRef: 'click-1', merchantOrderId: 'O1', orderAmount: 500000, commission: 50000, status: 'CONFIRMED', raw: body,
};

function make(providerOver: Partial<CashbackProvider> = {}, known = true) {
  const ingest = jest.fn().mockResolvedValue({ ok: true });
  const cashback = { ingest } as unknown as CashbackService;
  const provider: CashbackProvider = {
    key: 'accesstrade',
    buildDeeplink: () => '',
    verifyWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockReturnValue(normalized),
    isReconcileEnabled: () => false,
    fetchTransactions: async () => [],
    ...providerOver,
  };
  const registry = {
    get: jest.fn().mockImplementation((k: string) => {
      if (!known) throw new NotFoundException(k);
      return provider;
    }),
  } as unknown as CashbackProviderRegistry;
  return { ctrl: new CashbackController(cashback, registry), ingest, provider };
}

describe('CashbackController.webhook', () => {
  it('verify pass + parse ok → gọi ingest với providerKey', async () => {
    const { ctrl, ingest } = make();
    const r = await ctrl.webhook('accesstrade', body, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(normalized, 'accesstrade');
  });

  it('verify fail → 401, không ingest', async () => {
    const { ctrl, ingest } = make({ verifyWebhook: jest.fn().mockReturnValue(false) });
    await expect(ctrl.webhook('accesstrade', body, {})).rejects.toThrow(UnauthorizedException);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('parseWebhook null (sai shape) → ok:false, không ingest', async () => {
    const { ctrl, ingest } = make({ parseWebhook: jest.fn().mockReturnValue(null) });
    const r = await ctrl.webhook('accesstrade', {}, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('provider lạ → NotFoundException', async () => {
    const { ctrl } = make({}, false);
    await expect(ctrl.webhook('khong-ton-tai', body, {})).rejects.toThrow(NotFoundException);
  });

  it('alias /webhooks/accesstrade → xử lý như provider accesstrade', async () => {
    const { ctrl, ingest } = make();
    const r = await ctrl.accesstradeWebhook(body, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(normalized, 'accesstrade');
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/cashback.controller.spec.ts`
Expected: FAIL — constructor signature cũ / `webhook` chưa tồn tại.

- [ ] **Step 3: Viết lại controller**

Thay toàn bộ `apps/api/src/modules/cashback/cashback.controller.ts` bằng:

```ts
import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CashbackService } from './cashback.service';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';

class ClickDto {
  @IsString() merchantId!: string;
  @IsOptional() @IsString() productUrl?: string;
}

@Controller()
export class CashbackController {
  constructor(
    private readonly cashback: CashbackService,
    private readonly registry: CashbackProviderRegistry,
  ) {}

  @Public()
  @Get('cashback/merchants')
  merchants() {
    return this.cashback.listMerchants();
  }

  @Post('cashback/click')
  click(@CurrentUser('sub') userId: string, @Body() dto: ClickDto) {
    return this.cashback.createClick(userId, dto.merchantId, dto.productUrl);
  }

  @Get('cashback/transactions')
  transactions(@CurrentUser('sub') userId: string) {
    return this.cashback.listTransactions(userId);
  }

  /** Webhook postback generic theo provider. Verify + parse do provider tự lo. */
  @Public()
  @SkipThrottle()
  @Post('webhooks/cashback/:provider')
  async webhook(
    @Param('provider') providerKey: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const provider = this.registry.get(providerKey); // key lạ → NotFoundException
    if (!provider.verifyWebhook(headers, body)) {
      throw new UnauthorizedException('Webhook cashback không hợp lệ.');
    }
    const event = provider.parseWebhook(body);
    if (!event) return { ok: false };
    return this.cashback.ingest(event, provider.key);
  }

  /** Alias tương thích ngược (deprecated) — trỏ vào provider accesstrade. */
  @Public()
  @SkipThrottle()
  @Post('webhooks/accesstrade')
  accesstradeWebhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.webhook('accesstrade', body, headers);
  }
}
```

- [ ] **Step 4: Wire module — đăng ký registry + AccessTradeProvider**

Thay toàn bộ `apps/api/src/modules/cashback/cashback.module.ts` bằng:

```ts
import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';
import { WalletModule } from '../wallet/wallet.module';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import { AccessTradeProvider } from './providers/access-trade.provider';
import { CASHBACK_PROVIDERS } from './providers/cashback-provider.interface';

@Module({
  imports: [WalletModule], // CoinsService — thưởng xu giới thiệu khi cashback CONFIRMED
  controllers: [CashbackController],
  providers: [
    CashbackService,
    CashbackProviderRegistry,
    AccessTradeProvider,
    { provide: CASHBACK_PROVIDERS, useFactory: (at: AccessTradeProvider) => [at], inject: [AccessTradeProvider] },
  ],
})
export class CashbackModule {}
```

- [ ] **Step 5: Chạy test controller — xác nhận PASS**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/cashback.controller.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/cashback/cashback.controller.ts apps/api/src/modules/cashback/cashback.controller.spec.ts apps/api/src/modules/cashback/cashback.module.ts
git commit -m "feat(cashback): webhook route generic /webhooks/cashback/:provider + alias, wire registry"
```

---

## Task 6: Test reconcile cron + verification toàn module

**Files:**
- Test: `apps/api/src/modules/cashback/cashback.service.spec.ts` (thêm describe `reconcile`)

- [ ] **Step 1: Thêm test reconcile (failing nếu logic sai)**

Thêm vào cuối `apps/api/src/modules/cashback/cashback.service.spec.ts` (trong file, sau describe `settleConfirmed`):

```ts
describe('CashbackService.reconcile', () => {
  const provider = (key: string, enabled: boolean, events: unknown[] = []) => ({
    key,
    buildDeeplink: () => '',
    verifyWebhook: () => true,
    parseWebhook: () => null,
    isReconcileEnabled: () => enabled,
    fetchTransactions: jest.fn().mockResolvedValue(events),
  });

  it('provider disabled → KHÔNG fetch, KHÔNG ingest', async () => {
    const p = provider('accesstrade', false);
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const prisma = {} as unknown as PrismaService;
    const svc = new CashbackService(prisma, config, coins, notifications, reg);
    const ingest = jest.spyOn(svc, 'ingest').mockResolvedValue({ ok: true });
    await svc.reconcile();
    expect(p.fetchTransactions).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('provider enabled → feed từng event qua ingest với đúng providerKey', async () => {
    const ev = event();
    const p = provider('accesstrade', true, [ev]);
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const prisma = {} as unknown as PrismaService;
    const svc = new CashbackService(prisma, config, coins, notifications, reg);
    const ingest = jest.spyOn(svc, 'ingest').mockResolvedValue({ ok: true });
    await svc.reconcile();
    expect(p.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(ev, 'accesstrade');
  });

  it('fetchTransactions lỗi → nuốt lỗi, không throw (cron không vỡ)', async () => {
    const p = provider('accesstrade', true);
    (p.fetchTransactions as jest.Mock).mockRejectedValue(new Error('AT 500'));
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const svc = new CashbackService({} as unknown as PrismaService, config, coins, notifications, reg);
    await expect(svc.reconcile()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test reconcile — xác nhận PASS**

Run: `pnpm --filter @tubutree/api test src/modules/cashback/cashback.service.spec.ts`
Expected: PASS (bao gồm 3 test reconcile mới).

- [ ] **Step 3: Chạy TOÀN BỘ test module cashback + typecheck + lint**

Run: `pnpm --filter @tubutree/api test src/modules/cashback`
Expected: PASS toàn bộ (service, controller, registry, provider).

Run: `pnpm --filter @tubutree/api typecheck`
Expected: PASS.

Run: `pnpm --filter @tubutree/api lint`
Expected: PASS (không lỗi mới).

- [ ] **Step 4: Chạy toàn bộ test suite API (không regression)**

Run: `pnpm --filter @tubutree/api test`
Expected: PASS toàn bộ (mọi module cũ vẫn xanh — money flow không đổi).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cashback/cashback.service.spec.ts
git commit -m "test(cashback): reconcile cron (skip disabled, feed ingest, nuốt lỗi)"
```

---

## Self-Review (đã chạy khi viết plan)

**1. Spec coverage:**
- 6 điểm hard-code AT → Task 3 (parseWebhook/verifyWebhook/buildDeeplink/fetchTransactions), Task 4 (userReward, createClick qua registry), Task 5 (route + secret). ✅
- Interface + registry → Task 2. ✅
- Schema `provider` + composite unique → Task 1. ✅
- Reconcile cron gated → Task 4 (`reconcile()`) + Task 6 (test). ✅
- Config → Task 1 step 5. ✅
- Testing (di chuyển state-machine, provider spec, reconcile) → Task 3/4/6. ✅
- Money flow không đổi → `settleConfirmed` giữ nguyên trong Task 4; toàn bộ suite chạy lại Task 6 step 4. ✅
- Alias tương thích ngược → Task 5. ✅

**2. Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể. Endpoint `/transactions` của AT là điểm gated (cô lập trong `AccessTradeProvider.fetchTransactions`) — nếu tài liệu AT khác field, chỉ sửa `parseWebhook`/mapping trong file này.

**3. Type consistency:** `ingest(event, provider)`, `NormalizedCashbackEvent`, `CASHBACK_PROVIDERS`, `CashbackProviderRegistry.get/all`, `provider.key` nhất quán giữa Task 2–6.

**Sai lệch có chủ đích so với spec:** spec liệt kê cả `cashback.reconcile_interval_hours=6`; plan wiring nhịp reconcile bằng `@Cron('0 0 */6 * * *')` (mỗi 6h) thay vì đọc config runtime (SchedulerRegistry động = YAGNI). Chỉ seed `cashback.reconcile_lookback_days`. Nếu sau này cần chỉnh nhịp runtime → chuyển sang SchedulerRegistry (ngoài phạm vi).

**Ngoài phạm vi (giữ nguyên từ spec):** claw-back sau settle; HMAC raw-body; provider thứ 2 thật; admin UI gán provider.
