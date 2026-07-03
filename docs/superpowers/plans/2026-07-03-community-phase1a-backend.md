# Cộng đồng "Vườn Tubu" — Pha 1a (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp API feed hiện có thành API cộng đồng hỏi–đáp shoppable: nhiều loại bài (hỏi đáp / khoe vườn / mẹo), danh mục, ảnh, gắn sản phẩm, best-answer, badge chuyên gia, thưởng TubuXu — hiện tên thật thay vì giấu tên.

**Architecture:** Tiến hoá module `apps/api/src/modules/feed` (Hướng A trong spec). Mở rộng model `FeedPost`/`FeedComment` + thêm `CommunityCategory`, `PostProductTag`. Tách phần thưởng xu ra `CommunityRewardService` (money-critical, idempotent qua partial unique index). Pha 1 mọi bài `PUBLISHED` ngay (kiểm duyệt lai để Pha 2). Không đổi chữ ký `createAchievementPost` (auto-post game giữ nguyên).

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL, class-validator, Jest (mock Prisma). pnpm workspace `@tubutree/api`.

## Global Constraints

- Auth bật mặc định qua global `JwtAuthGuard`; lấy user bằng `@CurrentUser('sub') userId: string`; endpoint admin thêm `@Roles('ADMIN')`.
- Bất biến tiền tệ: `coinsBalance == SUM(CoinTransaction.delta)`. Mọi grant xu phải **atomic** + **idempotent** (dựa partial unique index `reason WHERE refType='COMMUNITY'`). Chỉ thưởng khi bài đã PUBLISHED.
- KHÔNG đổi chữ ký `CommunityFeedService.createAchievementPost(userId, kind, body, meta?)` — GameService gọi qua `@Optional`.
- Field mới trên `FeedPost`/`FeedComment` đều nullable/có default → migration không phá dữ liệu cũ.
- Copy tiếng Việt. Test theo pattern mock Prisma sẵn có ở `community-feed.service.spec.ts`.
- Lệnh (chạy từ gốc repo): test = `pnpm --filter @tubutree/api test -- <path>`; migrate = `pnpm --filter @tubutree/api exec prisma migrate dev`; generate = `pnpm --filter @tubutree/api prisma:generate`; seed = `pnpm --filter @tubutree/api prisma:seed`.
- Pha 1 KHÔNG dùng cột denormalized `likeCount/commentCount` — đọc qua `_count` như hiện tại (catalog nhỏ). Chỉ thêm `viewCount` (tăng ở GET chi tiết). Badge Pha 1 chỉ suy từ `role` (STAFF/ADMIN → EXPERT); badge nhãn hàng + `CommunityProfile.isExpert` để Pha 2.

---

### Task 1: Schema — mở rộng FeedPost/FeedComment, thêm CommunityCategory + PostProductTag, index idempotency xu, seed danh mục

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `FeedPostKind` ~1070, model `FeedPost` ~1055, `FeedComment` ~1091, `Product` ~143 back-relation)
- Create: `apps/api/prisma/migrations/<timestamp>_community_phase1/migration.sql` (sinh tự động rồi bổ sung SQL partial index)
- Modify: `apps/api/prisma/seed.ts` (seed 6 danh mục)

**Interfaces:**
- Produces: Prisma models `CommunityCategory { id, slug, name, icon?, order, isActive }`, `PostProductTag { id, postId, productId }`; `FeedPost` thêm `status FeedPostStatus`, `categoryId?`, `title?`, `images String[]`, `isPinned`, `bestCommentId? @unique`, `editedAt?`, `viewCount`, quan hệ `category`, `productTags`; `FeedComment` thêm `isAccepted Boolean`; enum `FeedPostKind` thêm `QUESTION|SHOWCASE|TIP`; enum `FeedPostStatus { PENDING PUBLISHED HIDDEN REMOVED }`.

- [ ] **Step 1: Sửa schema — enum**

Trong `apps/api/prisma/schema.prisma`, thay enum `FeedPostKind` (giữ giá trị cũ, thêm mới) và thêm enum status:

```prisma
enum FeedPostKind {
  MANUAL
  HARVEST
  MILESTONE
  SPECIES
  QUESTION
  SHOWCASE
  TIP
}

enum FeedPostStatus {
  PENDING
  PUBLISHED
  HIDDEN
  REMOVED
}
```

- [ ] **Step 2: Sửa schema — FeedPost, FeedComment, models mới, back-relation Product**

Thay model `FeedPost` và `FeedComment`, thêm 2 model mới:

```prisma
model FeedPost {
  id            String            @id @default(cuid())
  userId        String
  user          User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind          FeedPostKind      @default(MANUAL)
  status        FeedPostStatus    @default(PUBLISHED)
  categoryId    String?
  category      CommunityCategory? @relation(fields: [categoryId], references: [id])
  title         String?
  body          String
  images        String[]
  meta          Json?
  isPinned      Boolean           @default(false)
  bestCommentId String?           @unique
  editedAt      DateTime?
  viewCount     Int               @default(0)
  createdAt     DateTime          @default(now())
  reactions     FeedReaction[]
  comments      FeedComment[]
  productTags   PostProductTag[]

  @@index([status, createdAt])
  @@index([categoryId, status, createdAt])
  @@index([kind, status, createdAt])
  @@map("feed_posts")
}

model FeedComment {
  id         String   @id @default(cuid())
  postId     String
  post       FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  body       String
  isAccepted Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@index([postId])
  @@map("feed_comments")
}

model CommunityCategory {
  id       String     @id @default(cuid())
  slug     String     @unique
  name     String
  icon     String?
  order    Int        @default(0)
  isActive Boolean    @default(true)
  posts    FeedPost[]

  @@map("community_categories")
}

model PostProductTag {
  id        String   @id @default(cuid())
  postId    String
  post      FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([postId, productId])
  @@index([productId])
  @@map("post_product_tags")
}
```

Trong model `Product` (dòng ~143) thêm back-relation (đặt cạnh các quan hệ khác):

```prisma
  communityTags PostProductTag[]
```

- [ ] **Step 3: Tạo migration (create-only) để chèn SQL index thủ công**

Run: `pnpm --filter @tubutree/api exec prisma migrate dev --create-only --name community_phase1`
Expected: tạo thư mục `apps/api/prisma/migrations/<ts>_community_phase1/migration.sql` chứa ALTER/CREATE cho các thay đổi trên. CHƯA áp dụng.

- [ ] **Step 4: Thêm partial unique index cho idempotency xu cộng đồng**

Nối vào cuối file `migration.sql` vừa sinh (giống pattern index REFERRAL sẵn có):

```sql
-- Idempotency thưởng xu cộng đồng: 1 reason chỉ được cấp 1 lần khi refType='COMMUNITY'.
CREATE UNIQUE INDEX "coin_transactions_community_reason_key"
  ON "coin_transactions"("reason") WHERE "refType" = 'COMMUNITY';
```

- [ ] **Step 5: Áp dụng migration + generate client**

Run: `pnpm --filter @tubutree/api exec prisma migrate dev`
Expected: "Applied migration `<ts>_community_phase1`" + Prisma Client generated, không lỗi.

- [ ] **Step 6: Seed 6 danh mục (idempotent upsert)**

Trong `apps/api/prisma/seed.ts`, thêm khối seed (đặt trong hàm seed chính, dùng `prisma` sẵn có trong file):

```typescript
const COMMUNITY_CATEGORIES = [
  { slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱', order: 1 },
  { slug: 'sau-benh', name: 'Sâu bệnh', icon: '🐛', order: 2 },
  { slug: 'phoi-canh', name: 'Phối cảnh / décor', icon: '🪴', order: 3 },
  { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿', order: 4 },
  { slug: 'hoi-mua-gi', name: 'Hỏi mua gì', icon: '🛒', order: 5 },
  { slug: 'meo-hay', name: 'Mẹo hay', icon: '💡', order: 6 },
];
for (const c of COMMUNITY_CATEGORIES) {
  await prisma.communityCategory.upsert({ where: { slug: c.slug }, update: { name: c.name, icon: c.icon, order: c.order }, create: c });
}
console.log(`Seeded ${COMMUNITY_CATEGORIES.length} community categories`);
```

- [ ] **Step 7: Chạy seed + verify**

Run: `pnpm --filter @tubutree/api prisma:seed`
Expected: log "Seeded 6 community categories", không lỗi. (Kiểm tra nhanh: `prisma studio` → bảng `community_categories` có 6 dòng — tùy chọn.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(community): schema pha 1 — post types/status/category/images/product-tags + seed danh mục"
```

---

### Task 2: CommunityRewardService — thưởng xu (idempotent, trần/ngày, không tự thưởng)

**Files:**
- Create: `apps/api/src/modules/feed/community-reward.service.ts`
- Test: `apps/api/src/modules/feed/community-reward.service.spec.ts`

**Interfaces:**
- Consumes: `CoinsService.grantCoins(userId, amount, reason, refType, refId)` (từ `../wallet/coins.service`), `SystemConfigService.get<number>(key, fallback)` (global), `PrismaService`.
- Produces: `CommunityRewardService` với `rewardPost(userId, postId): Promise<void>`, `rewardAnswer(answererId, postAuthorId, commentId): Promise<void>`, `rewardBestAnswer(answererId, postAuthorId, commentId): Promise<void>`. Tất cả `refType='COMMUNITY'`, reason `COMMUNITY_POST:<id>` / `COMMUNITY_ANSWER:<id>` / `COMMUNITY_BEST:<id>`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/api/src/modules/feed/community-reward.service.spec.ts`:

```typescript
import { CommunityRewardService } from './community-reward.service';

function deps(over: Record<string, unknown> = {}) {
  const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockResolvedValue(0) };
  const prisma = { coinTransaction: { count: jest.fn().mockResolvedValue(0) } };
  return { coins, config, prisma, ...over } as any;
}
function make(d: ReturnType<typeof deps>) {
  return new CommunityRewardService(d.prisma, d.coins, d.config);
}

describe('CommunityRewardService.rewardPost', () => {
  it('thưởng post_reward với reason COMMUNITY_POST + refType COMMUNITY khi chưa chạm trần', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.post_reward' ? 200 : f));
    await make(d).rewardPost('u1', 'p1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('u1', 200, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1');
  });

  it('chạm trần ngày → KHÔNG thưởng', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) =>
      k === 'community.post_reward' ? 200 : k === 'community.daily_post_reward_cap' ? 3 : f,
    );
    d.prisma.coinTransaction.count.mockResolvedValue(3);
    await make(d).rewardPost('u1', 'p1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardAnswer', () => {
  it('trả lời bài của người khác → thưởng answer_reward', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.answer_reward' ? 100 : f));
    await make(d).rewardAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 100, 'COMMUNITY_ANSWER:c1', 'COMMUNITY', 'c1');
  });

  it('tự trả lời bài của mình → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardAnswer('same', 'same', 'c1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});

describe('CommunityRewardService.rewardBestAnswer', () => {
  it('best-answer của người khác → thưởng best_answer_reward', async () => {
    const d = deps();
    d.config.get.mockImplementation(async (k: string, f: number) => (k === 'community.best_answer_reward' ? 500 : f));
    await make(d).rewardBestAnswer('answerer', 'author', 'c1');
    expect(d.coins.grantCoins).toHaveBeenCalledWith('answerer', 500, 'COMMUNITY_BEST:c1', 'COMMUNITY', 'c1');
  });

  it('best-answer trỏ chính chủ bài → KHÔNG thưởng', async () => {
    const d = deps();
    await make(d).rewardBestAnswer('same', 'same', 'c1');
    expect(d.coins.grantCoins).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- community-reward.service.spec`
Expected: FAIL — "Cannot find module './community-reward.service'".

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/api/src/modules/feed/community-reward.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CoinsService } from '../wallet/coins.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Thưởng TubuXu cho hoạt động cộng đồng. Idempotent qua reason + partial unique index
 * (reason WHERE refType='COMMUNITY'). Chỉ thưởng khi bài PUBLISHED (caller đảm bảo).
 */
@Injectable()
export class CommunityRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinsService,
    private readonly config: SystemConfigService,
  ) {}

  /** Thưởng khi bài được đăng công khai. Trần số lần/ngày để chống spam. */
  async rewardPost(userId: string, postId: string): Promise<void> {
    const amount = await this.config.get<number>('community.post_reward', 200);
    if (amount <= 0) return;
    const cap = await this.config.get<number>('community.daily_post_reward_cap', 3);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.coinTransaction.count({
      where: { userId, refType: 'COMMUNITY', reason: { startsWith: 'COMMUNITY_POST:' }, createdAt: { gte: since } },
    });
    if (todayCount >= cap) return;
    await this.coins.grantCoins(userId, amount, `COMMUNITY_POST:${postId}`, 'COMMUNITY', postId);
  }

  /** Thưởng người trả lời (không thưởng khi tự trả lời bài của chính mình). */
  async rewardAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.answer_reward', 100);
    await this.coins.grantCoins(answererId, amount, `COMMUNITY_ANSWER:${commentId}`, 'COMMUNITY', commentId);
  }

  /** Thưởng khi câu trả lời được chọn hay nhất (không thưởng nếu trỏ chính chủ bài). */
  async rewardBestAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const amount = await this.config.get<number>('community.best_answer_reward', 500);
    await this.coins.grantCoins(answererId, amount, `COMMUNITY_BEST:${commentId}`, 'COMMUNITY', commentId);
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `pnpm --filter @tubutree/api test -- community-reward.service.spec`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/feed/community-reward.service.ts apps/api/src/modules/feed/community-reward.service.spec.ts
git commit -m "feat(community): CommunityRewardService — thưởng xu idempotent + trần/ngày"
```

---

### Task 3: Badge tác giả + createPost mở rộng (loại/danh mục/ảnh/gắn SP)

**Files:**
- Create: `apps/api/src/modules/feed/author-badge.ts`
- Test: `apps/api/src/modules/feed/author-badge.spec.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Consumes: `CommunityRewardService.rewardPost(userId, postId)` (Task 2).
- Produces: `authorBadge(role: string): 'EXPERT' | null`; `CommunityFeedService.createPost(userId, input: CreatePostInput)` với `CreatePostInput = { kind?: FeedPostKind; categoryId?: string; title?: string; body: string; images?: string[]; productSlugs?: string[] }` → trả `{ id: string }`.

- [ ] **Step 1: Viết test badge (fail)**

Tạo `apps/api/src/modules/feed/author-badge.spec.ts`:

```typescript
import { authorBadge } from './author-badge';

describe('authorBadge', () => {
  it('ADMIN → EXPERT', () => expect(authorBadge('ADMIN')).toBe('EXPERT'));
  it('STAFF → EXPERT', () => expect(authorBadge('STAFF')).toBe('EXPERT'));
  it('CUSTOMER → null', () => expect(authorBadge('CUSTOMER')).toBeNull());
  it('AFFILIATE → null', () => expect(authorBadge('AFFILIATE')).toBeNull());
});
```

- [ ] **Step 2: Chạy test badge để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- author-badge.spec`
Expected: FAIL — "Cannot find module './author-badge'".

- [ ] **Step 3: Viết author-badge.ts**

Tạo `apps/api/src/modules/feed/author-badge.ts`:

```typescript
export type AuthorBadge = 'EXPERT' | null;

/** Pha 1: badge suy từ role. STAFF/ADMIN = Chuyên gia Tubu. (Badge nhãn hàng để Pha 2.) */
export function authorBadge(role: string): AuthorBadge {
  return role === 'ADMIN' || role === 'STAFF' ? 'EXPERT' : null;
}
```

- [ ] **Step 4: Chạy test badge để xác nhận pass**

Run: `pnpm --filter @tubutree/api test -- author-badge.spec`
Expected: PASS (4 test).

- [ ] **Step 5: Viết test createPost mở rộng (fail)**

Thêm vào `apps/api/src/modules/feed/community-feed.service.spec.ts` (cập nhật `makePrisma` để có `product.findMany` + `postProductTag.createMany`, và constructor mới nhận reward service):

```typescript
// Ở đầu file, thêm helper tạo service với reward giả:
function makeSvc(prisma: any, reward: any = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() }) {
  return new CommunityFeedService(prisma, reward);
}
// Bổ sung vào base của makePrisma():
//   product: { findMany: jest.fn().mockResolvedValue([]) },
//   postProductTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },

describe('CommunityFeedService.createPost (mở rộng)', () => {
  it('QUESTION thiếu title → BadRequest, không tạo', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).createPost('u1', { kind: 'QUESTION', body: 'lá vàng?' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.feedPost.create).not.toHaveBeenCalled();
  });

  it('tạo SHOWCASE PUBLISHED kèm ảnh + gắn SP theo slug → thưởng post', async () => {
    const prisma = makePrisma();
    (prisma.product.findMany as jest.Mock).mockResolvedValue([{ id: 'prod1' }, { id: 'prod2' }]);
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'newpost' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    const r = await makeSvc(prisma, reward).createPost('u1', {
      kind: 'SHOWCASE', body: 'Khoe cây', images: ['https://img/1.jpg'], productSlugs: ['cay-a', 'cay-b'],
    });
    expect(r).toEqual({ id: 'newpost' });
    const data = (prisma.feedPost.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', kind: 'SHOWCASE', status: 'PUBLISHED', body: 'Khoe cây', images: ['https://img/1.jpg'] });
    expect(prisma.postProductTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'newpost', productId: 'prod1' }, { postId: 'newpost', productId: 'prod2' }],
      skipDuplicates: true,
    });
    expect(reward.rewardPost).toHaveBeenCalledWith('u1', 'newpost');
  });

  it('quá 5 SP → BadRequest', async () => {
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).createPost('u1', { body: 'x', productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 6: Chạy test để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: FAIL — constructor `CommunityFeedService` chưa nhận reward / `createPost` chưa nhận object.

- [ ] **Step 7: Sửa community-feed.service.ts — constructor + createPost**

Trong `apps/api/src/modules/feed/community-feed.service.ts`: cập nhật type, constructor, và `createPost`. Thêm import:

```typescript
import { CommunityRewardService } from './community-reward.service';

type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';

const MAX_TITLE = 160;
const MAX_BODY = 5000;
const MAX_IMAGES = 6;
const MAX_PRODUCT_TAGS = 5;

export interface CreatePostInput {
  kind?: FeedPostKind;
  categoryId?: string;
  title?: string;
  body: string;
  images?: string[];
  productSlugs?: string[];
}
```

Constructor:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly reward: CommunityRewardService,
  ) {}
```

Thay method `createPost` cũ bằng:

```typescript
  async createPost(userId: string, input: CreatePostInput): Promise<{ id: string }> {
    const kind = input.kind ?? 'MANUAL';
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Nội dung bài viết trống.');
    if (body.length > MAX_BODY) throw new BadRequestException('Nội dung quá dài.');
    const title = input.title?.trim() || null;
    if (kind === 'QUESTION' && !title) throw new BadRequestException('Câu hỏi cần có tiêu đề.');
    if (title && title.length > MAX_TITLE) throw new BadRequestException('Tiêu đề quá dài.');
    const images = (input.images ?? []).filter((u) => typeof u === 'string' && u.trim()).slice(0, MAX_IMAGES);
    const slugs = input.productSlugs ?? [];
    if (slugs.length > MAX_PRODUCT_TAGS) throw new BadRequestException('Chỉ gắn tối đa 5 sản phẩm.');

    const post = await this.prisma.feedPost.create({
      data: { userId, kind, status: 'PUBLISHED', body, title, images, categoryId: input.categoryId ?? null },
    });

    if (slugs.length) {
      const products = await this.prisma.product.findMany({
        where: { slug: { in: slugs }, isActive: true }, select: { id: true },
      });
      if (products.length) {
        await this.prisma.postProductTag.createMany({
          data: products.map((p) => ({ postId: post.id, productId: p.id })),
          skipDuplicates: true,
        });
      }
    }

    await this.reward.rewardPost(userId, post.id);
    return { id: post.id };
  }
```

- [ ] **Step 8: Chạy test để xác nhận pass**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec author-badge.spec`
Expected: PASS. (Test cũ `createPost` "hợp lệ → tạo bài MANUAL" nay gọi chữ ký cũ `createPost('u1', '  ...  ')` — cập nhật nó thành `createPost('u1', { body: '  Vườn mình xanh quá  ' })` và bỏ 2 test cũ trùng lặp `nội dung trống/quá dài` nếu đã có bản mới; giữ assert `kind: 'MANUAL', body: 'Vườn mình xanh quá'`.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): createPost mở rộng (loại/danh mục/ảnh/gắn SP) + badge tác giả + thưởng post"
```

---

### Task 4: getFeed + getPost — lọc, phân trang, DTO hiện tên+avatar+badge+SP

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.service.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Consumes: `authorBadge(role)` (Task 3).
- Produces: `CommunityFeedService.getFeed(userId, opts?: { category?: string; kind?: string; sort?: 'new'|'popular'; cursor?: string; take?: number })` → `{ posts: FeedItem[]; nextCursor: string | null }`; `getPost(userId, postId)` → `FeedItem` (tăng viewCount). `FeedItem` gồm `{ id, kind, status, title, body, images, category, author, avatar, badge, productTags, likeCount, commentCount, liked, bestCommentId, createdAt }` với `productTags: { slug, name, thumbnail, salePrice, basePrice }[]`.

- [ ] **Step 1: Viết test getFeed mới (fail)**

Cập nhật 2 test `getFeed` cũ + thêm test lọc/tag trong `community-feed.service.spec.ts` (bỏ kỳ vọng tên ẩn — giờ hiện tên thật + avatar + badge):

```typescript
describe('CommunityFeedService.getFeed (cộng đồng)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'p1', kind: 'SHOWCASE', status: 'PUBLISHED', title: null, body: 'Khoe cây', images: ['i1'],
    meta: null, bestCommentId: null, createdAt: new Date('2026-07-03'),
    user: { fullName: 'Lã Hoàng Long', avatarUrl: 'https://a/1.png', role: 'CUSTOMER' },
    category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
    productTags: [{ product: { slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 } }],
    _count: { reactions: 3, comments: 2 }, reactions: [{ id: 'r1' }],
    ...over,
  });

  it('hiện tên thật + avatar + badge + chip SP + đã-thả-tim', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([row()]);
    const r = await makeSvc(prisma).getFeed('u1', { category: 'khoe-vuon' });
    expect(r.posts[0]).toMatchObject({
      id: 'p1', author: 'Lã Hoàng Long', avatar: 'https://a/1.png', badge: null,
      likeCount: 3, commentCount: 2, liked: true,
      category: { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿' },
      productTags: [{ slug: 'cay-a', name: 'Cây A', thumbnail: 't', salePrice: null, basePrice: 100 }],
    });
    // Lọc theo danh mục + chỉ PUBLISHED được truyền vào where
    const where = (prisma.feedPost.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', category: { slug: 'khoe-vuon' } });
  });

  it('tác giả STAFF → badge EXPERT; tên null → "Bạn Tubu"', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findMany as jest.Mock).mockResolvedValue([
      row({ user: { fullName: null, avatarUrl: null, role: 'STAFF' } }),
    ]);
    const r = await makeSvc(prisma).getFeed('u1');
    expect(r.posts[0]).toMatchObject({ author: 'Bạn Tubu', avatar: null, badge: 'EXPERT' });
  });
});

describe('CommunityFeedService.getPost', () => {
  it('tăng viewCount và trả bài', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.update as jest.Mock) = jest.fn().mockResolvedValue({});
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({
      ...row(), reactions: [], _count: { reactions: 0, comments: 0 },
    });
    const svc = makeSvc(prisma);
    const r = await svc.getPost('u1', 'p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { viewCount: { increment: 1 } } });
    expect(r).toMatchObject({ id: 'p1' });
  });
});
```

Thêm vào base `makePrisma()`: `feedPost.update: jest.fn().mockResolvedValue({})`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: FAIL — getFeed chưa nhận opts / chưa trả avatar+badge+category+productTags; getPost chưa tồn tại.

- [ ] **Step 3: Sửa getFeed + getPost + bỏ maskName**

Trong `community-feed.service.ts`, thêm import `authorBadge` và thay `getFeed`, xoá `maskName`, thêm `getPost` + mapper dùng chung:

```typescript
import { authorBadge } from './author-badge';

const FEED_INCLUDE = {
  user: { select: { fullName: true, avatarUrl: true, role: true } },
  category: { select: { slug: true, name: true, icon: true } },
  productTags: { include: { product: { select: { slug: true, name: true, thumbnail: true, salePrice: true, basePrice: true } } } },
  _count: { select: { reactions: true, comments: true } },
} as const;

  async getFeed(
    userId: string,
    opts: { category?: string; kind?: string; sort?: 'new' | 'popular'; cursor?: string; take?: number } = {},
  ) {
    const take = Math.min(opts.take ?? 20, 50);
    const where: Record<string, unknown> = { status: 'PUBLISHED' };
    if (opts.category) where.category = { slug: opts.category };
    if (opts.kind) where.kind = opts.kind;
    const orderBy =
      opts.sort === 'popular'
        ? [{ reactions: { _count: 'desc' as const } }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];
    const posts = await this.prisma.feedPost.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { ...FEED_INCLUDE, reactions: { where: { userId }, select: { id: true } } },
    });
    const hasMore = posts.length > take;
    const page = hasMore ? posts.slice(0, take) : posts;
    return {
      posts: page.map((p) => this.toItem(p)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async getPost(userId: string, postId: string) {
    await this.prisma.feedPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } });
    const p = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      include: { ...FEED_INCLUDE, reactions: { where: { userId }, select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Bài viết không tồn tại.');
    return this.toItem(p);
  }

  private toItem(p: any) {
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      title: p.title ?? null,
      body: p.body,
      images: p.images ?? [],
      meta: p.meta,
      createdAt: p.createdAt,
      author: p.user.fullName ?? 'Bạn Tubu',
      avatar: p.user.avatarUrl ?? null,
      badge: authorBadge(p.user.role),
      category: p.category ? { slug: p.category.slug, name: p.category.name, icon: p.category.icon } : null,
      productTags: (p.productTags ?? []).map((t: any) => ({
        slug: t.product.slug, name: t.product.name, thumbnail: t.product.thumbnail,
        salePrice: t.product.salePrice, basePrice: t.product.basePrice,
      })),
      likeCount: p._count.reactions,
      commentCount: p._count.comments,
      liked: p.reactions.length > 0,
      bestCommentId: p.bestCommentId ?? null,
    };
  }
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): getFeed/getPost — lọc/phân trang + DTO hiện tên+avatar+badge+chip SP"
```

---

### Task 5: Bình luận/trả lời mở rộng + best-answer + sửa/xoá bài

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.service.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Consumes: `CommunityRewardService.rewardAnswer/rewardBestAnswer` (Task 2), `authorBadge` (Task 3).
- Produces: `addComment(userId, postId, body)` (thưởng answer nếu bài QUESTION & không tự trả lời); `getComments(postId)` → `{ id, body, author, avatar, badge, isAccepted, createdAt }[]`; `setBestAnswer(userId, role, postId, commentId)` (chủ bài hoặc ADMIN); `editPost(userId, postId, patch)`; `deletePost(userId, role, postId)` → set status REMOVED.

- [ ] **Step 1: Viết test (fail)**

Thêm vào `community-feed.service.spec.ts` (cập nhật base `makePrisma`: `feedComment.findUnique`, `feedComment.updateMany`, `feedComment.update`, `feedPost.update`; `feedPost.findUnique` trả `{ id, userId, kind }`):

```typescript
describe('CommunityFeedService.addComment (thưởng answer)', () => {
  it('trả lời bài QUESTION của người khác → tạo comment + thưởng answer', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('answerer', 'p1', 'Bạn tưới ít lại nhé');
    expect(reward.rewardAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });

  it('bình luận bài không phải QUESTION → KHÔNG thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'SHOWCASE' });
    (prisma.feedComment.create as jest.Mock).mockResolvedValue({ id: 'c1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).addComment('u2', 'p1', 'đẹp quá');
    expect(reward.rewardAnswer).not.toHaveBeenCalled();
  });
});

describe('CommunityFeedService.setBestAnswer', () => {
  it('không phải chủ bài & không admin → Forbidden', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    await expect(makeSvc(prisma).setBestAnswer('intruder', 'CUSTOMER', 'p1', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('chủ bài chọn best-answer → set bestCommentId, đánh isAccepted, bỏ cờ cũ, thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'QUESTION' });
    (prisma.feedComment.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', postId: 'p1', userId: 'answerer' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).setBestAnswer('author', 'CUSTOMER', 'p1', 'c1');
    expect(prisma.feedComment.updateMany).toHaveBeenCalledWith({ where: { postId: 'p1' }, data: { isAccepted: false } });
    expect(prisma.feedComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isAccepted: true } });
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { bestCommentId: 'c1' } });
    expect(reward.rewardBestAnswer).toHaveBeenCalledWith('answerer', 'author', 'c1');
  });
});

describe('CommunityFeedService.deletePost', () => {
  it('người khác (không admin) → Forbidden', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'TIP' });
    await expect(makeSvc(prisma).deletePost('intruder', 'CUSTOMER', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chủ bài → set status REMOVED', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', kind: 'TIP' });
    await makeSvc(prisma).deletePost('author', 'CUSTOMER', 'p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'REMOVED' } });
  });
});
```

Thêm import ở đầu file test: `import { ForbiddenException } from '@nestjs/common';`

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: FAIL — `setBestAnswer/deletePost/editPost` chưa tồn tại; addComment chưa thưởng.

- [ ] **Step 3: Sửa community-feed.service.ts**

Thêm import `ForbiddenException` vào dòng import `@nestjs/common`. Thay `addComment` và `getComments`, thêm `setBestAnswer`/`editPost`/`deletePost`:

```typescript
  async addComment(userId: string, postId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung bình luận trống.');
    if (text.length > MAX_COMMENT) throw new BadRequestException('Bình luận quá dài.');
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, kind: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    const comment = await this.prisma.feedComment.create({ data: { userId, postId, body: text } });
    if (post.kind === 'QUESTION') await this.reward.rewardAnswer(userId, post.userId, comment.id);
    return { id: comment.id };
  }

  async getComments(postId: string, take = 50) {
    const comments = await this.prisma.feedComment.findMany({
      where: { postId },
      orderBy: [{ isAccepted: 'desc' }, { createdAt: 'asc' }],
      take,
      include: { user: { select: { fullName: true, avatarUrl: true, role: true } } },
    });
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.fullName ?? 'Bạn Tubu',
      avatar: c.user.avatarUrl ?? null,
      badge: authorBadge(c.user.role),
      isAccepted: c.isAccepted,
      createdAt: c.createdAt,
    }));
  }

  /** Chọn câu trả lời hay nhất — chủ bài QUESTION hoặc ADMIN. */
  async setBestAnswer(userId: string, role: string, postId: string, commentId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, kind: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.kind !== 'QUESTION') throw new BadRequestException('Chỉ câu hỏi mới có câu trả lời hay nhất.');
    if (post.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Chỉ chủ bài mới chọn được.');
    const comment = await this.prisma.feedComment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, userId: true } });
    if (!comment || comment.postId !== postId) throw new NotFoundException('Câu trả lời không tồn tại.');
    await this.prisma.feedComment.updateMany({ where: { postId }, data: { isAccepted: false } });
    await this.prisma.feedComment.update({ where: { id: commentId }, data: { isAccepted: true } });
    await this.prisma.feedPost.update({ where: { id: postId }, data: { bestCommentId: commentId } });
    await this.reward.rewardBestAnswer(comment.userId, post.userId, commentId);
    return { ok: true };
  }

  /** Sửa bài — chỉ chủ bài; set editedAt. */
  async editPost(userId: string, postId: string, patch: { title?: string; body?: string; images?: string[] }) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.userId !== userId) throw new ForbiddenException('Chỉ chủ bài mới sửa được.');
    const data: Record<string, unknown> = { editedAt: new Date() };
    if (patch.body !== undefined) {
      const b = patch.body.trim();
      if (!b || b.length > MAX_BODY) throw new BadRequestException('Nội dung không hợp lệ.');
      data.body = b;
    }
    if (patch.title !== undefined) data.title = patch.title.trim().slice(0, MAX_TITLE) || null;
    if (patch.images !== undefined) data.images = patch.images.filter((u) => u?.trim()).slice(0, MAX_IMAGES);
    await this.prisma.feedPost.update({ where: { id: postId }, data });
    return { ok: true };
  }

  /** Xoá mềm — chủ bài hoặc ADMIN. */
  async deletePost(userId: string, role: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.userId !== userId && role !== 'ADMIN') throw new ForbiddenException('Không có quyền xoá.');
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'REMOVED' } });
    return { ok: true };
  }
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: PASS (toàn bộ suite feed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): comment/answer + best-answer + sửa/xoá bài (thưởng xu)"
```

---

### Task 6: Controller + DTO + wiring module (WalletModule) + verify

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.controller.ts`
- Modify: `apps/api/src/modules/feed/feed.module.ts`

**Interfaces:**
- Consumes: mọi method `CommunityFeedService` từ Task 3–5; `CommunityRewardService` (Task 2); `WalletModule` export `CoinsService`.
- Produces: HTTP endpoints `GET /feed`, `GET /feed/:id`, `POST /feed`, `PATCH /feed/:id`, `DELETE /feed/:id`, `POST /feed/:id/react`, `GET /feed/:id/comments`, `POST /feed/:id/comments`, `POST /feed/:id/best-answer/:commentId`.

- [ ] **Step 1: Cập nhật module — provider + import WalletModule**

Thay `apps/api/src/modules/feed/feed.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CommunityFeedController } from './community-feed.controller';
import { CommunityFeedService } from './community-feed.service';
import { CommunityRewardService } from './community-reward.service';

@Module({
  imports: [WalletModule],
  controllers: [CommunityFeedController],
  providers: [CommunityFeedService, CommunityRewardService],
  exports: [CommunityFeedService],
})
export class FeedModule {}
```

- [ ] **Step 2: Cập nhật controller — DTO + endpoints**

Thay `apps/api/src/modules/feed/community-feed.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommunityFeedService, type CreatePostInput } from './community-feed.service';

const KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;

class CreatePostDto {
  @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) productSlugs?: string[];
}
class EditPostDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) body!: string;
}

@Controller('feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  @Get()
  getFeed(
    @CurrentUser('sub') userId: string,
    @Query('category') category?: string,
    @Query('kind') kind?: string,
    @Query('sort') sort?: 'new' | 'popular',
    @Query('cursor') cursor?: string,
  ) {
    return this.feed.getFeed(userId, { category, kind, sort, cursor });
  }

  @Get(':id')
  getPost(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.getPost(userId, id);
  }

  @Post()
  createPost(@CurrentUser('sub') userId: string, @Body() dto: CreatePostDto) {
    return this.feed.createPost(userId, dto as CreatePostInput);
  }

  @Patch(':id')
  editPost(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: EditPostDto) {
    return this.feed.editPost(userId, id, dto);
  }

  @Delete(':id')
  deletePost(@CurrentUser() user: { sub: string; role: string }, @Param('id') id: string) {
    return this.feed.deletePost(user.sub, user.role, id);
  }

  @Post(':id/react')
  react(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.toggleReaction(userId, id);
  }

  @Get(':id/comments')
  comments(@Param('id') id: string) {
    return this.feed.getComments(id);
  }

  @Post(':id/comments')
  addComment(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.feed.addComment(userId, id, dto.body);
  }

  @Post(':id/best-answer/:commentId')
  bestAnswer(
    @CurrentUser() user: { sub: string; role: string },
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.feed.setBestAnswer(user.sub, user.role, id, commentId);
  }
}
```

- [ ] **Step 3: Typecheck + toàn bộ test feed + build**

Run: `pnpm --filter @tubutree/api typecheck && pnpm --filter @tubutree/api test -- feed`
Expected: typecheck sạch; toàn bộ test module feed PASS.

- [ ] **Step 4: Sửa nơi gọi createPost cũ (nếu có) ngoài module**

Run: `git grep -n "createPost(" -- apps/api/src`
Expected: chỉ còn controller + service (chữ ký mới). Nếu có nơi khác gọi `createPost(userId, string)` → sửa sang `createPost(userId, { body })`. `createAchievementPost` KHÔNG đổi.

- [ ] **Step 5: Build production để chắc chắn**

Run: `pnpm --filter @tubutree/api build`
Expected: build thành công, không lỗi type.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): controller endpoints + wiring WalletModule (Pha 1a backend xong)"
```

---

## Self-Review

**1. Spec coverage (Pha 1 backend):**
- Loại bài QUESTION/SHOWCASE/TIP + status → Task 1, 3 ✅
- Danh mục + seed → Task 1 ✅
- Ảnh (URL Cloudinary) → Task 1 (cột), Task 3 (nhận/lưu) ✅
- Gắn thẻ SP (`PostProductTag`, resolve theo slug, chip DTO) → Task 1, 3, 4 ✅
- Best-answer → Task 5 ✅
- Badge chuyên gia (role STAFF/ADMIN) → Task 3, 4, 5 ✅
- Thưởng TubuXu (post/answer/best) idempotent + trần/ngày + không tự thưởng → Task 2 ✅
- Danh tính hiện tên+avatar (bỏ mask) → Task 4, 5 ✅
- Config keys `community.*` → Task 2 (đọc qua SystemConfigService, fallback 200/100/500/3) ✅
- Sửa/xoá bài → Task 5 ✅
- **Hoãn có chủ đích (không thuộc Pha 1a):** kiểm duyệt lai (trust→PENDING) = Pha 2; badge nhãn hàng + `CommunityProfile` = Pha 2; tìm kiếm/tag/thông báo = Pha 3; reputation/sự kiện = Pha 4; cột denormalized likeCount/commentCount = khi cần. Không phải gap — đúng ranh giới pha trong spec.

**2. Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể ✅

**3. Type consistency:** `CreatePostInput` (Task 3) khớp `CreatePostDto` (Task 6); `getFeed(userId, opts)` khớp controller query (Task 6); `setBestAnswer(userId, role, postId, commentId)` khớp controller `bestAnswer` (Task 6); reason/refType `COMMUNITY_*`/`COMMUNITY` khớp giữa Task 2 và partial index Task 1 ✅

## Ghi chú bàn giao

- **Pha 1b (Frontend)** sẽ là plan riêng: dựng lại `feed.tsx` (tabs danh mục, composer type-aware, bộ chọn gắn SP, chi tiết bài + trả lời, chip `ProductCard`, nút "Mua cây này", best-answer, hiện tên+avatar+badge) + mở rộng `feed-api.ts` khớp DTO mới ở trên.
- **Vận hành:** sau khi merge, chạy `prisma migrate deploy` + `prisma:seed` trên môi trường thật (theo [[project_storefront]]). Thêm config `community.*` qua admin nếu muốn khác mặc định.
