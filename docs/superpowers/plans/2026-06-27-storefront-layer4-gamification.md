# Storefront Lớp 4 — Gamification CTV (Hành trình gian hàng + TubuXu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Steps dùng checkbox (`- [ ]`).

**Goal:** Biến bậc doanh số tĩnh thành tiến trình hành vi — chuỗi "nhiệm vụ gian hàng" (hoàn thiện hồ sơ, thêm SP, có ghi chú, đăng, có đơn đầu) thưởng **TubuXu** ngay khi đạt mốc, để CTV mới có "early win" và động lực dựng gian hàng.

**Architecture:** Module storefront thêm `StorefrontQuestService` tính nhiệm vụ từ dữ liệu CÓ SẴN (Storefront/Collection/Item + Commission) — KHÔNG thêm bảng tiến trình. Thưởng qua `CoinsService.grantCoins` đã có, idempotent bằng **partial unique index** `coin_transactions` (userId, reason) WHERE refType='QUEST' (mirror index referral). "Đã nhận thưởng" = tồn tại `CoinTransaction` reason tương ứng. FE miniapp hiện section "Hành trình gian hàng" trong storefront-builder với thanh tiến trình + nút Nhận thưởng.

**Tech Stack:** NestJS + Prisma (embedded PG 5544), Jest (mock Prisma), ZaUI + react-query.

---

## File Structure

**Backend (apps/api):**
- Create `prisma/migrations/20260627020000_coin_quest_unique/migration.sql` — partial unique index quest.
- Create `src/modules/storefront/storefront-quest.service.ts` — định nghĩa quest + tính tiến trình + claim.
- Create `src/modules/storefront/storefront-quest.service.spec.ts` — unit test (mock Prisma + CoinsService).
- Modify `src/modules/storefront/storefront.controller.ts` — 2 endpoint quests.
- Modify `src/modules/storefront/storefront.module.ts` — import WalletModule, provider mới.

**Frontend miniapp (apps/miniapp):**
- Modify `src/services/storefront-api.ts` — `getQuests`, `claimQuest` + types.
- Modify `src/pages/storefront-builder.tsx` — section "Hành trình gian hàng".

---

## Task 1: Migration — partial unique index quest (idempotency)

**Files:**
- Create: `apps/api/prisma/migrations/20260627020000_coin_quest_unique/migration.sql`

- [ ] **Step 1: Viết migration SQL**

```sql
-- Idempotency cho thưởng TubuXu nhiệm vụ gian hàng: mỗi (user, quest-reason) chỉ thưởng 1 lần.
-- reason dạng "STOREFRONT_QUEST:<code>" KHÔNG nhúng userId nên unique phải gồm (userId, reason).
CREATE UNIQUE INDEX "coin_transactions_quest_unique"
  ON "coin_transactions" ("userId", "reason")
  WHERE "refType" = 'QUEST';
```

- [ ] **Step 2: Áp migration embedded PG**

Run: `cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5544/tubutree npx prisma migrate deploy`
Expected: "All migrations have been successfully applied." (KHÔNG đổi schema.prisma — index thuần SQL, prisma không quản; an toàn vì migrate deploy chỉ chạy SQL).

> Lưu ý: index này không khai báo trong schema.prisma (giống `coin_transactions_referral_unique` đã có). `prisma migrate status` vẫn "up to date" vì chỉ so khớp danh sách migration đã chạy.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/migrations/20260627020000_coin_quest_unique
git commit -m "feat(storefront/gamification): partial unique index coin_transactions quest (idempotency)"
```

---

## Task 2: StorefrontQuestService — định nghĩa quest + tính tiến trình (TDD)

**Files:**
- Create: `apps/api/src/modules/storefront/storefront-quest.service.ts`
- Test: `apps/api/src/modules/storefront/storefront-quest.service.spec.ts`

Quest tính từ stats: `itemsTotal`, `itemsWithNote`, `isPublished`, `profileComplete` (avatar+note+cover), `firstOrder` (>=1 commission). Mỗi quest: `{ code, title, hint, goal, rewardXu, progress, done, claimed }`.

- [ ] **Step 1: Viết failing test**

Tạo `apps/api/src/modules/storefront/storefront-quest.service.spec.ts`:

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorefrontQuestService, QUESTS } from './storefront-quest.service';

function makeDeps(over: any = {}) {
  const prisma = {
    storefront: { findFirst: jest.fn() },
    storefrontItem: { count: jest.fn().mockResolvedValue(0) },
    commission: { count: jest.fn().mockResolvedValue(0) },
    coinTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ coinsBalance: 0 }) },
    ...over,
  } as any;
  const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, coins };
}

describe('StorefrontQuestService.listQuests', () => {
  it('ném NotFound nếu CTV chưa có gian hàng', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(null);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.listQuests('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tính done theo stats + claimed theo CoinTransaction', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
      collections: [{ items: [{ note: 'x' }, { note: null }, { note: 'y' }, { note: 'z' }, { note: 'w' }] }],
    });
    prisma.commission.count.mockResolvedValue(1);
    prisma.coinTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:profile_complete' }]);
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete'].done).toBe(true);
    expect(byCode['profile_complete'].claimed).toBe(true);
    expect(byCode['add_5_products'].done).toBe(true); // 5 items
    expect(byCode['add_5_products'].claimed).toBe(false);
    expect(byCode['notes_3'].done).toBe(true); // 4 có note >= 3
    expect(byCode['publish'].done).toBe(true);
    expect(byCode['first_order'].done).toBe(true);
    expect(out.totalEarnedXu).toBe(QUESTS.find((q) => q.code === 'profile_complete')!.rewardXu);
  });

  it('done=false khi chưa đạt goal', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: null, headerNote: null, coverUrl: null, isPublished: false,
      collections: [{ items: [{ note: null }] }],
    });
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete'].done).toBe(false);
    expect(byCode['add_5_products'].progress).toBe(1);
    expect(byCode['add_5_products'].done).toBe(false);
  });
});

describe('StorefrontQuestService.claimQuest', () => {
  const baseSf = {
    id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
    collections: [{ items: [{ note: 'x' }, { note: 'y' }, { note: 'z' }, { note: 'w' }, { note: 'v' }] }],
  };

  it('ném BadRequest nếu quest chưa đạt', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ ...baseSf, isPublished: false });
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'publish')).rejects.toBeInstanceOf(BadRequestException);
    expect(coins.grantCoins).not.toHaveBeenCalled();
  });

  it('ném BadRequest nếu code không tồn tại', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'khong-co')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grantCoins đúng reason + refType QUEST khi đạt', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ coinsBalance: 4000 });
    const svc = new StorefrontQuestService(prisma, coins);
    const reward = QUESTS.find((q) => q.code === 'publish')!.rewardXu;
    const out = await svc.claimQuest('u1', 'publish');
    expect(coins.grantCoins).toHaveBeenCalledWith('u1', reward, 'STOREFRONT_QUEST:publish', 'QUEST', 'sf1');
    expect(out).toEqual({ claimed: true, code: 'publish', rewardXu: reward, coinsBalance: 4000 });
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd apps/api && npx jest storefront-quest --silent`
Expected: FAIL — "Cannot find module './storefront-quest.service'".

- [ ] **Step 3: Implement service**

Tạo `apps/api/src/modules/storefront/storefront-quest.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CoinsService } from '../wallet/coins.service';

interface QuestStats {
  itemsTotal: number;
  itemsWithNote: number;
  isPublished: boolean;
  profileComplete: boolean;
  firstOrder: boolean;
}

export interface QuestDef {
  code: string;
  title: string;
  hint: string;
  goal: number;
  rewardXu: number;
  /** Tiến trình hiện tại (0..goal). */
  measure: (s: QuestStats) => number;
}

/** Chuỗi nhiệm vụ "Hành trình gian hàng" (early-win + động lực dựng gian hàng). */
export const QUESTS: QuestDef[] = [
  { code: 'profile_complete', title: 'Hoàn thiện hồ sơ gian hàng', hint: 'Thêm ảnh đại diện, ảnh bìa và lời nhắn cá nhân.', goal: 1, rewardXu: 2000, measure: (s) => (s.profileComplete ? 1 : 0) },
  { code: 'add_5_products', title: 'Thêm 5 sản phẩm', hint: 'Chọn 5 món bạn tâm đắc từ catalog.', goal: 5, rewardXu: 2000, measure: (s) => Math.min(s.itemsTotal, 5) },
  { code: 'notes_3', title: 'Viết lý do cho 3 sản phẩm', hint: '“Vì sao mình giới thiệu” giúp khách tin hơn.', goal: 3, rewardXu: 1500, measure: (s) => Math.min(s.itemsWithNote, 3) },
  { code: 'publish', title: 'Đăng gian hàng', hint: 'Bấm Lưu & Đăng để khách xem được.', goal: 1, rewardXu: 1000, measure: (s) => (s.isPublished ? 1 : 0) },
  { code: 'first_order', title: 'Đơn hàng đầu tiên', hint: 'Chia sẻ link — khi có đơn từ gian hàng bạn nhận thưởng!', goal: 1, rewardXu: 5000, measure: (s) => (s.firstOrder ? 1 : 0) },
];

@Injectable()
export class StorefrontQuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinsService,
  ) {}

  private async stats(userId: string): Promise<{ sfId: string; stats: QuestStats }> {
    const sf = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId, type: 'CTV' },
      include: { collections: { include: { items: { select: { note: true } } } } },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    const items = sf.collections.flatMap((c) => c.items);
    const itemsTotal = items.length;
    const itemsWithNote = items.filter((i) => i.note && i.note.trim().length > 0).length;
    const firstOrderCount = await this.prisma.commission.count({ where: { affiliateUserId: userId } });
    const stats: QuestStats = {
      itemsTotal,
      itemsWithNote,
      isPublished: sf.isPublished,
      profileComplete: Boolean(sf.avatarUrl && sf.headerNote && sf.coverUrl),
      firstOrder: firstOrderCount > 0,
    };
    return { sfId: sf.id, stats };
  }

  async listQuests(userId: string) {
    const { stats } = await this.stats(userId);
    const claimedTxns = await this.prisma.coinTransaction.findMany({
      where: { userId, refType: 'QUEST' },
      select: { reason: true },
    });
    const claimedSet = new Set(claimedTxns.map((t) => t.reason));
    let totalEarnedXu = 0;
    const quests = QUESTS.map((q) => {
      const progress = q.measure(stats);
      const done = progress >= q.goal;
      const claimed = claimedSet.has(`STOREFRONT_QUEST:${q.code}`);
      if (claimed) totalEarnedXu += q.rewardXu;
      return { code: q.code, title: q.title, hint: q.hint, goal: q.goal, rewardXu: q.rewardXu, progress, done, claimed };
    });
    const claimedCount = quests.filter((q) => q.claimed).length;
    return { quests, totalEarnedXu, level: claimedCount, levelMax: QUESTS.length };
  }

  async claimQuest(userId: string, code: string) {
    const def = QUESTS.find((q) => q.code === code);
    if (!def) throw new BadRequestException('Nhiệm vụ không tồn tại.');
    const { sfId, stats } = await this.stats(userId);
    if (def.measure(stats) < def.goal) throw new BadRequestException('Bạn chưa hoàn thành nhiệm vụ này.');
    // grantCoins idempotent qua partial unique index (userId, reason) WHERE refType='QUEST'.
    await this.coins.grantCoins(userId, def.rewardXu, `STOREFRONT_QUEST:${code}`, 'QUEST', sfId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    return { claimed: true, code, rewardXu: def.rewardXu, coinsBalance: user.coinsBalance };
  }
}
```

- [ ] **Step 4: Run → pass**

Run: `cd apps/api && npx jest storefront-quest --silent`
Expected: PASS (toàn bộ).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storefront/storefront-quest.service.ts apps/api/src/modules/storefront/storefront-quest.service.spec.ts
git commit -m "feat(storefront/gamification): StorefrontQuestService — quest progress + claim TubuXu (TDD)"
```

---

## Task 3: Controller endpoints + module wiring

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.controller.ts`
- Modify: `apps/api/src/modules/storefront/storefront.module.ts`

- [ ] **Step 1: Inject service vào controller + 2 endpoint**

Trong `storefront.controller.ts`: thêm import + constructor param + routes.

Thêm vào import: `import { StorefrontQuestService } from './storefront-quest.service';`

Sửa constructor:
```typescript
  constructor(
    private readonly svc: StorefrontService,
    private readonly quests: StorefrontQuestService,
  ) {}
```

Thêm routes (trước dòng `@Public() ... publicView`):
```typescript
  @Get('me/quests') listQuests(@CurrentUser('sub') uid: string) { return this.quests.listQuests(uid); }
  @Post('me/quests/:code/claim') claimQuest(@CurrentUser('sub') uid: string, @Param('code') code: string) { return this.quests.claimQuest(uid, code); }
```

- [ ] **Step 2: Module wiring**

Sửa `storefront.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { StorefrontQuestService } from './storefront-quest.service';

@Module({
  imports: [WalletModule],
  controllers: [StorefrontController],
  providers: [StorefrontService, StorefrontQuestService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
```

- [ ] **Step 3: tsc + full jest**

Run: `cd apps/api && npx tsc --noEmit && npx jest --silent`
Expected: tsc sạch; tất cả pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/storefront/storefront.controller.ts apps/api/src/modules/storefront/storefront.module.ts
git commit -m "feat(storefront/gamification): endpoints GET/POST me/quests + import WalletModule"
```

---

## Task 4: E2E smoke — quests cho CTV

- [ ] **Step 1: build + start API**

Run: `cd apps/api && DATABASE_URL=...5544 npm run build && DATABASE_URL=...5544 JWT_ACCESS_SECRET=<.env> npm run start` (theo workflow máy này — KHÔNG dùng watch).

- [ ] **Step 2: Mint JWT AFFILIATE + tạo gian hàng**

Run: `DATABASE_URL=...5544 JWT_ACCESS_SECRET=<.env> DEV_ROLE=AFFILIATE npx tsx scripts/dev-token.ts` → `$TOKEN`.
```bash
curl -s -X POST localhost:3001/api/storefront -H "Authorization: Bearer $TOKEN"
curl -s localhost:3001/api/storefront/me/quests -H "Authorization: Bearer $TOKEN"
```
Expected: quests trả 5 nhiệm vụ, ban đầu `done:false`, `claimed:false`, `level:0`.

- [ ] **Step 3: claim quest chưa đạt → 400**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/api/storefront/me/quests/publish/claim -H "Authorization: Bearer $TOKEN"`
Expected: 400 (chưa publish).

- [ ] **Step 4: publish rồi claim → thưởng + claim lần 2 idempotent**

```bash
curl -s -X POST localhost:3001/api/storefront/me/publish -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary '{"isPublished":true}'
curl -s -X POST localhost:3001/api/storefront/me/quests/publish/claim -H "Authorization: Bearer $TOKEN"   # claimed:true, coinsBalance tăng
curl -s -X POST localhost:3001/api/storefront/me/quests/publish/claim -H "Authorization: Bearer $TOKEN"   # idempotent: coinsBalance KHÔNG tăng thêm
```
Expected: lần 1 coinsBalance +1000; lần 2 coinsBalance giữ nguyên (P2002 → grantCoins no-op).

- [ ] **Step 5: Commit (nếu có fix)**

```bash
git add -A && git commit -m "test(storefront/gamification): e2e smoke quests claim + idempotency"
```

---

## Task 5: FE miniapp — section "Hành trình gian hàng"

**Files:**
- Modify: `apps/miniapp/src/services/storefront-api.ts`
- Modify: `apps/miniapp/src/pages/storefront-builder.tsx`

- [ ] **Step 1: API client + types**

Thêm vào `storefront-api.ts`:
```typescript
export interface StorefrontQuest {
  code: string; title: string; hint: string; goal: number; rewardXu: number;
  progress: number; done: boolean; claimed: boolean;
}
export interface QuestList { quests: StorefrontQuest[]; totalEarnedXu: number; level: number; levelMax: number; }

export const getQuests = () => api.get('/storefront/me/quests').then((r) => r.data as QuestList);
export const claimQuest = (code: string) =>
  api.post(`/storefront/me/quests/${code}/claim`).then((r) => r.data as { claimed: boolean; code: string; rewardXu: number; coinsBalance: number });
```

- [ ] **Step 2: Section UI trong storefront-builder.tsx**

Đọc `storefront-builder.tsx` trước để khớp pattern (react-query, useMutation, useSnackbar, ZaUI Box/Text/Button, tokens). Thêm 1 section "🎯 Hành trình gian hàng" hiển thị:
- Tiến trình `level/levelMax` + tổng `totalEarnedXu` TubuXu đã nhận.
- Mỗi quest: title + hint + thanh tiến trình `progress/goal`; nếu `done && !claimed` → nút "Nhận {rewardXu} TubuXu" (gọi `claimQuest`, invalidate query `['quests']` + balance); nếu `claimed` → nhãn "✓ Đã nhận"; nếu chưa done → "{progress}/{goal}".

Khung (đặt sau khối tổng quan, dùng useQuery `['storefront-quests']`):
```tsx
// import { getQuests, claimQuest } ...
const questsQ = useQuery({ queryKey: ['storefront-quests'], queryFn: getQuests });
const claimMut = useMutation({
  mutationFn: (code: string) => claimQuest(code),
  onSuccess: (r) => {
    openSnackbar({ text: `+${r.rewardXu.toLocaleString('vi-VN')} TubuXu 🎉`, type: 'success' });
    void queryClient.invalidateQueries({ queryKey: ['storefront-quests'] });
  },
});
// render: questsQ.data?.quests.map(...) với progress bar + nút theo trạng thái
```

> **Bắt buộc đọc trước:** `storefront-builder.tsx` để dùng đúng `useSnackbar`, `queryClient`/`useQueryClient`, và component progress/Button hiện hành. Đảm bảo section ẩn/hiện đúng khi chưa có gian hàng (chỉ render khi đã `createStorefront`/`getMyStorefront` thành công).

- [ ] **Step 3: Build miniapp**

Run: `cd apps/miniapp && npm run build`
Expected: build sạch, không lỗi type.

- [ ] **Step 4: Commit**

```bash
git add apps/miniapp/src/services/storefront-api.ts apps/miniapp/src/pages/storefront-builder.tsx
git commit -m "feat(storefront/fe): section Hành trình gian hàng — quest tiến trình + nhận TubuXu"
```

---

## Task 6: Verify toàn cục + finalize

- [ ] **Step 1: full jest + tsc + build 2 FE**

Run: `cd apps/api && npx jest --silent && npx tsc --noEmit` ; `cd apps/miniapp && npm run build`
Expected: tất cả pass/sạch.

- [ ] **Step 2: Cập nhật memory** `project_storefront.md`: Lớp 4 XONG (quest gamification + TubuXu), nêu thiết kế không-thêm-bảng + idempotency index.

- [ ] **Step 3: finishing-a-development-branch** — Lớp 2+3+4 đã xong trên `feat/storefront-layer2` → quyết định merge/PR vào main.

---

## Self-Review

**Spec coverage (§7.7):**
- "biến bậc doanh số tĩnh thành điểm/progress thưởng cả hành vi dựng gian hàng + doanh số" → quests gồm hành vi (profile/add/notes/publish) + doanh số (first_order); `level` là progress. ✔
- "milestone thưởng TubuXu/badge để CTV mới có early win" → mỗi quest thưởng TubuXu, claim ngay khi đạt. ✔
- "tái dùng TubuXu + tier có sẵn" → dùng `CoinsService.grantCoins`; không phá tier doanh số (vẫn còn ở affiliate dashboard). ✔

**Placeholder scan:** Task 5 UI là khung + chỉ thị đọc `storefront-builder.tsx` (UI primitive phải khớp file thật) — logic (states done/claimed, mutation, invalidate) đã nêu rõ; không phải placeholder nghiệp vụ.

**Type consistency:** `QuestList { quests, totalEarnedXu, level, levelMax }` đồng nhất service (Task 2) ↔ FE (Task 5). `claimQuest` trả `{ claimed, code, rewardXu, coinsBalance }` đồng nhất Task 2 ↔ controller ↔ FE. reason `STOREFRONT_QUEST:<code>` + refType `QUEST` đồng nhất service ↔ index migration (Task 1).

**Idempotency:** index `(userId, reason) WHERE refType='QUEST'` (Task 1) + `grantCoins` bắt P2002 → claim lần 2 no-op (test Task 4 step 4). ✔
