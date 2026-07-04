# Cộng đồng "Vườn Tubu" — Pha 2 (Kiểm duyệt lai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Kiểm duyệt lai (hybrid): khách tin cậy (đã mua / admin set / role nội bộ) đăng hiện ngay; khách mới bài **PENDING** chờ admin duyệt; báo cáo (report) nội dung + hàng đợi admin (duyệt/từ chối/ẩn/ghim). Thưởng xu chỉ khi bài thực sự PUBLISHED (không thưởng lúc PENDING).

**Architecture:** Mở rộng module `apps/api/src/modules/feed` (đã có từ Pha 1). Thêm model `CommunityReport` + `CommunityProfile`. Đổi `createPost` để đặt `status` theo trust; chuyển thưởng bài sang thời điểm PUBLISHED (create nếu trusted, hoặc approve nếu PENDING). Thêm endpoint admin (`@Roles('ADMIN')`). FE: nút Báo cáo + trạng thái "Chờ duyệt" cho bài của mình + màn kiểm duyệt admin.

**Tech Stack:** NestJS 10 + Prisma 5 + PostgreSQL, Jest (mock Prisma). Miniapp React + ZaUI (typecheck+build gate, no jest).

## Global Constraints

- **Bất biến tiền tệ** `coinsBalance == SUM(CoinTransaction.delta)`. Thưởng bài (`COMMUNITY_POST:<id>`, refType `COMMUNITY`) phải **idempotent** (partial unique index đã có) + **chỉ 1 lần** khi bài đạt PUBLISHED. PENDING → KHÔNG thưởng. Approve PENDING→PUBLISHED → thưởng (idempotent nên an toàn nếu gọi lại). Reward calls **non-fatal** (wrap try/catch + logger, như Pha 1).
- **Trust:** `isTrusted(userId, role)` = `CommunityProfile.isTrusted === true` OR có đơn `DELIVERED` (order.findFirst where userId,status=DELIVERED) OR `role ∈ {STAFF, ADMIN, DEALER, AFFILIATE}`.
- **Status Pha 1** vốn luôn `PUBLISHED`; Pha 2 mới sinh `PENDING`. `getFeed` đã lọc `status='PUBLISHED'` → PENDING/REMOVED tự ẩn khỏi bảng tin. `getPost`/`addComment` đã chặn `REMOVED` (Pha 1). Pha 2: chủ bài xem được bài PENDING của MÌNH (để thấy "chờ duyệt"); người khác → 404.
- Auth: global JwtAuthGuard; `@CurrentUser('sub')`/`@CurrentUser()`; admin endpoints `@Roles('ADMIN')`. KHÔNG đổi `createAchievementPost`.
- Copy tiếng Việt qua `vi.community.*` (FE, không hardcode JSX). Lỗi FE qua `getErrorMessage`.
- Lệnh: BE test `pnpm --filter @tubutree/api test -- <path>`; migrate `pnpm --filter @tubutree/api exec prisma migrate dev`; FE `pnpm --filter @tubutree/miniapp typecheck` + `build`.
- **Hoãn (không thuộc Pha 2):** badge nhãn-hàng + `CommunityProfile.isExpert` gắn vào DTO badge (giữ badge role-based của Pha 1); reputation/level (cột có sẵn nhưng chưa dùng) → Pha 4.

---

### Task 1: Schema — CommunityReport + CommunityProfile + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (thêm 2 model + back-relation User)
- Create: migration `..._community_phase2_moderation`
- Test: (verify bằng migrate + generate; không unit test schema)

**Interfaces:**
- Produces: `CommunityReport { id, reporterId, targetType(POST|COMMENT), targetId, reason, status(OPEN|RESOLVED) @default(OPEN), createdAt }`; `CommunityProfile { userId @id, reputation @default(0), level @default(1), isTrusted @default(false), isExpert @default(false), postCount @default(0), bestAnswerCount @default(0), updatedAt }`.

- [ ] **Step 1: Thêm models vào schema.prisma**

```prisma
model CommunityReport {
  id         String   @id @default(cuid())
  reporterId String
  reporter   User     @relation("CommunityReports", fields: [reporterId], references: [id], onDelete: Cascade)
  targetType String   // POST | COMMENT
  targetId   String
  reason     String
  status     String   @default("OPEN") // OPEN | RESOLVED
  createdAt  DateTime @default(now())
  @@index([status, createdAt])
  @@index([targetType, targetId])
  @@map("community_reports")
}

model CommunityProfile {
  userId          String   @id
  user            User     @relation("CommunityProfile", fields: [userId], references: [id], onDelete: Cascade)
  reputation      Int      @default(0)
  level           Int      @default(1)
  isTrusted       Boolean  @default(false)
  isExpert        Boolean  @default(false)
  postCount       Int      @default(0)
  bestAnswerCount Int      @default(0)
  updatedAt       DateTime @updatedAt
  @@map("community_profiles")
}
```

Trong model `User` thêm back-relations (đặt cạnh các relation khác):
```prisma
  communityReports  CommunityReport[]  @relation("CommunityReports")
  communityProfile  CommunityProfile?  @relation("CommunityProfile")
```

- [ ] **Step 2: Tạo + áp migration**

Run: `pnpm --filter @tubutree/api exec prisma migrate dev --name community_phase2_moderation`
Expected: migration tạo 2 bảng, apply sạch, Prisma Client generated. (2 model mới độc lập → không đụng dữ liệu cũ.)

- [ ] **Step 3: Verify generate + typecheck**

Run: `pnpm --filter @tubutree/api exec prisma generate && pnpm --filter @tubutree/api typecheck`
Expected: sạch.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(community): schema Pha 2 — CommunityReport + CommunityProfile (kiểm duyệt lai)"
```

---

### Task 2: Trust + createPost PENDING/PUBLISHED + reward-on-approve + approve/reject (money-critical)

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.service.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Consumes: `CommunityRewardService.rewardPost`, `PrismaService`.
- Produces: `isTrusted(userId, role): Promise<boolean>`; `createPost(userId, role, input)` (thêm tham số `role`) đặt status theo trust; `approvePost(postId): Promise<{ok}>` (PENDING→PUBLISHED + set author isTrusted + reward); `rejectPost(postId): Promise<{ok}>` (→ REMOVED); `getPost(userId, postId)` cho phép chủ xem PENDING của mình.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `community-feed.service.spec.ts` (thêm vào `makePrisma()` base: `order: { findFirst: jest.fn().mockResolvedValue(null) }`, `communityProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) }`; cập nhật `feedPost.create` mock đã có):

```typescript
describe('CommunityFeedService.isTrusted', () => {
  it('role STAFF → trusted (không cần query đơn)', async () => {
    const prisma = makePrisma();
    expect(await makeSvc(prisma).isTrusted('u1', 'STAFF')).toBe(true);
  });
  it('CUSTOMER không đơn, không profile → không trusted', async () => {
    const prisma = makePrisma();
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(false);
  });
  it('CUSTOMER có đơn DELIVERED → trusted', async () => {
    const prisma = makePrisma();
    (prisma.order.findFirst as jest.Mock).mockResolvedValue({ id: 'o1' });
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(true);
  });
  it('CommunityProfile.isTrusted=true → trusted', async () => {
    const prisma = makePrisma();
    (prisma.communityProfile.findUnique as jest.Mock).mockResolvedValue({ isTrusted: true });
    expect(await makeSvc(prisma).isTrusted('u1', 'CUSTOMER')).toBe(true);
  });
});

describe('CommunityFeedService.createPost (kiểm duyệt lai)', () => {
  it('khách KHÔNG trusted → PENDING, KHÔNG thưởng', async () => {
    const prisma = makePrisma(); // CUSTOMER, no order, no profile → not trusted
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'CUSTOMER', { kind: 'TIP', body: 'mẹo' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PENDING');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
  it('khách trusted (STAFF) → PUBLISHED + thưởng', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.create as jest.Mock).mockResolvedValue({ id: 'p1' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).createPost('u1', 'STAFF', { kind: 'TIP', body: 'mẹo' });
    expect((prisma.feedPost.create as jest.Mock).mock.calls[0][0].data.status).toBe('PUBLISHED');
    expect(reward.rewardPost).toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('CommunityFeedService.approvePost', () => {
  it('PENDING → PUBLISHED + set author trusted + thưởng (idempotent)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PENDING' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).approvePost('p1');
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PUBLISHED' } });
    expect(prisma.communityProfile.upsert).toHaveBeenCalled();
    expect(reward.rewardPost).toHaveBeenCalledWith('author', 'p1');
  });
  it('bài đã PUBLISHED → không thưởng lại (idempotent guard)', async () => {
    const prisma = makePrisma();
    (prisma.feedPost.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', userId: 'author', status: 'PUBLISHED' });
    const reward = { rewardPost: jest.fn(), rewardAnswer: jest.fn(), rewardBestAnswer: jest.fn() };
    await makeSvc(prisma, reward).approvePost('p1');
    expect(reward.rewardPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test → fail**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: FAIL (isTrusted/approvePost/rejectPost chưa có; createPost chưa nhận role/chưa PENDING).

- [ ] **Step 3: Implement**

Trong `community-feed.service.ts`:

```typescript
  private readonly TRUSTED_ROLES = new Set(['STAFF', 'ADMIN', 'DEALER', 'AFFILIATE']);

  async isTrusted(userId: string, role: string): Promise<boolean> {
    if (this.TRUSTED_ROLES.has(role)) return true;
    const profile = await this.prisma.communityProfile.findUnique({ where: { userId }, select: { isTrusted: true } });
    if (profile?.isTrusted) return true;
    const delivered = await this.prisma.order.findFirst({ where: { userId, status: 'DELIVERED' }, select: { id: true } });
    return !!delivered;
  }
```

Sửa `createPost(userId, role, input)` — thêm param `role`, thay chỗ đặt status + thưởng:
```typescript
    const trusted = await this.isTrusted(userId, role);
    const status = trusted ? 'PUBLISHED' : 'PENDING';
    const post = await this.prisma.feedPost.create({
      data: { userId, kind, status, body, title, images, categoryId: input.categoryId ?? null },
    });
    // ... product tags như cũ ...
    if (status === 'PUBLISHED') {
      try { await this.reward.rewardPost(userId, post.id); }
      catch (err) { this.logger.warn(`rewardPost failed for post ${post.id}: ${(err as Error).message}`); }
    }
    return { id: post.id, status };
```
(Trả thêm `status` để FE báo "chờ duyệt". Cập nhật kiểu trả về.)

Thêm approve/reject:
```typescript
  async approvePost(postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, status: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    if (post.status === 'PUBLISHED') return { ok: true }; // idempotent, không thưởng lại
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'PUBLISHED' } });
    await this.prisma.communityProfile.upsert({
      where: { userId: post.userId }, create: { userId: post.userId, isTrusted: true }, update: { isTrusted: true },
    });
    try { await this.reward.rewardPost(post.userId, post.id); }
    catch (err) { this.logger.warn(`rewardPost(approve) failed ${post.id}: ${(err as Error).message}`); }
    return { ok: true };
  }

  async rejectPost(postId: string) {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) throw new NotFoundException('Bài viết không tồn tại.');
    await this.prisma.feedPost.update({ where: { id: postId }, data: { status: 'REMOVED' } });
    return { ok: true };
  }
```

Sửa `getPost(userId, postId)` — chủ xem được PENDING của mình:
```typescript
    if (!p) throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'REMOVED') throw new NotFoundException('Bài viết không tồn tại.');
    if (p.status === 'PENDING' && p.userId !== userId) throw new NotFoundException('Bài viết không tồn tại.');
```
(Giữ tăng viewCount sau các guard này.)

- [ ] **Step 4: Chạy test → pass** (`pnpm --filter @tubutree/api test -- community-feed.service.spec`). Cập nhật test createPost cũ của Pha 1 (chữ ký thêm `role`): các test cũ gọi `createPost('u1', {...})` → đổi thành `createPost('u1', 'STAFF', {...})` để giữ nhánh PUBLISHED (hoặc set order/profile mock cho trusted) — đảm bảo assertion status/reward cũ vẫn đúng.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): kiểm duyệt lai — createPost PENDING theo trust + reward-on-approve + approve/reject"
```

---

### Task 3: Report + endpoint admin + wiring controller

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.service.ts` (report, moderation queries)
- Modify: `apps/api/src/modules/feed/community-feed.controller.ts` (endpoints)
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Produces: `report(reporterId, {targetType, targetId, reason})`; `adminPending(take?)` (bài PENDING kèm author); `adminReports(take?)` (report OPEN); `resolveReport(reportId, action?: {hide?: {type,id}})`; `pinPost(postId, pinned)`. Endpoints: `POST /feed/:id/report`, `@Roles('ADMIN')` `GET /feed/admin/pending`, `POST /feed/admin/:id/approve|reject`, `GET /feed/admin/reports`, `POST /feed/admin/reports/:id/resolve`, `POST /feed/admin/:id/pin`.

- [ ] **Step 1: Viết test** (report tạo bản ghi OPEN; resolveReport set RESOLVED; pin set isPinned; adminPending where status PENDING). Ví dụ:
```typescript
describe('CommunityFeedService.report', () => {
  it('tạo report OPEN cho POST', async () => {
    const prisma = makePrisma(); // thêm communityReport: { create: jest.fn().mockResolvedValue({id:'r1'}), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) }
    await makeSvc(prisma).report('u1', { targetType: 'POST', targetId: 'p1', reason: 'spam' });
    expect((prisma.communityReport.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ reporterId: 'u1', targetType: 'POST', targetId: 'p1', reason: 'spam', status: 'OPEN' });
  });
});
describe('CommunityFeedService.pinPost', () => {
  it('set isPinned', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).pinPost('p1', true);
    expect(prisma.feedPost.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isPinned: true } });
  });
});
describe('CommunityFeedService.resolveReport', () => {
  it('set RESOLVED', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).resolveReport('r1');
    expect(prisma.communityReport.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'RESOLVED' } });
  });
});
```
Thêm `communityReport` mock vào `makePrisma()` base.

- [ ] **Step 2: fail** → **Step 3: implement**:
```typescript
  async report(reporterId: string, dto: { targetType: string; targetId: string; reason: string }) {
    const type = dto.targetType === 'COMMENT' ? 'COMMENT' : 'POST';
    const reason = (dto.reason ?? '').trim().slice(0, 500) || 'Không phù hợp';
    await this.prisma.communityReport.create({ data: { reporterId, targetType: type, targetId: dto.targetId, reason, status: 'OPEN' } });
    return { ok: true };
  }
  async adminPending(take = 50) {
    const posts = await this.prisma.feedPost.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take,
      include: { user: { select: { fullName: true } }, category: { select: { name: true } } },
    });
    return posts.map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, images: p.images, author: p.user.fullName ?? 'Bạn Tubu', category: p.category?.name ?? null, createdAt: p.createdAt }));
  }
  async adminReports(take = 50) {
    return this.prisma.communityReport.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take });
  }
  async resolveReport(reportId: string) {
    await this.prisma.communityReport.update({ where: { id: reportId }, data: { status: 'RESOLVED' } });
    return { ok: true };
  }
  async pinPost(postId: string, pinned: boolean) {
    await this.prisma.feedPost.update({ where: { id: postId }, data: { isPinned: pinned } });
    return { ok: true };
  }
```
(Ghim: `getFeed` có thể ưu tiên `isPinned` — thêm `{ isPinned: 'desc' }` đầu orderBy trong getFeed. Nhỏ, đưa vào Step này.)

- [ ] **Step 4: Controller** — thêm DTO `ReportDto { @IsIn(['POST','COMMENT']) targetType; @IsString targetId; @IsString @MaxLength(500) reason }`; endpoints:
```typescript
  @Post(':id/report')
  report(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.feed.report(userId, { targetType: dto.targetType, targetId: dto.targetType === 'COMMENT' ? dto.targetId : id, reason: dto.reason });
  }
  @Roles('ADMIN') @Get('admin/pending')
  adminPending() { return this.feed.adminPending(); }
  @Roles('ADMIN') @Post('admin/:id/approve')
  approve(@Param('id') id: string) { return this.feed.approvePost(id); }
  @Roles('ADMIN') @Post('admin/:id/reject')
  reject(@Param('id') id: string) { return this.feed.rejectPost(id); }
  @Roles('ADMIN') @Get('admin/reports')
  adminReports() { return this.feed.adminReports(); }
  @Roles('ADMIN') @Post('admin/reports/:id/resolve')
  resolveReport(@Param('id') id: string) { return this.feed.resolveReport(id); }
  @Roles('ADMIN') @Post('admin/:id/pin')
  pin(@Param('id') id: string, @Body() body: { pinned?: boolean }) { return this.feed.pinPost(id, body?.pinned !== false); }
```
Import `Roles` từ `../../common/decorators/roles.decorator`. **Route order:** đặt `admin/*` TRƯỚC `:id` (giống categories) để không bị nuốt. Cập nhật `createPost` controller truyền `role`: `@CurrentUser() user` → `this.feed.createPost(user.sub, user.role, dto as CreatePostInput)`.

- [ ] **Step 5: test + typecheck + build**: `pnpm --filter @tubutree/api test -- community-feed.service.spec && pnpm --filter @tubutree/api typecheck && pnpm --filter @tubutree/api build`.

- [ ] **Step 6: Commit** `feat(community): report + endpoint admin (pending/approve/reject/reports/resolve/pin)`

---

### Task 4 (FE): Nút Báo cáo + trạng thái "Chờ duyệt"

**Files:**
- Modify: `apps/miniapp/src/services/feed-api.ts` (thêm `reportContent`, cập nhật `createPost` trả `{id,status}`)
- Modify: `apps/miniapp/src/components/community/post-card.tsx`, `apps/miniapp/src/pages/post-detail.tsx`, `apps/miniapp/src/components/community/post-composer.tsx`
- Modify: `apps/miniapp/src/i18n/vi.ts`

- [ ] **Step 1:** feed-api: `export const reportContent = (id, body: {targetType:'POST'|'COMMENT'; targetId?: string; reason: string}) => api.post(\`/feed/${id}/report\`, body).then(r=>r.data);` `createPost` trả type `{ id: string; status?: string }`.
- [ ] **Step 2:** Composer onSuccess: nếu `res.status === 'PENDING'` → snackbar `vi.community.pendingNotice` ("Bài đang chờ duyệt, sẽ hiện sau khi được duyệt 🌱") thay vì `posted`.
- [ ] **Step 3:** post-detail: nút "Báo cáo" (icon lucide `Flag`) trên bài + mỗi comment (không hiện cho chủ) → sheet/confirm nhập lý do → `reportContent` → snackbar `vi.community.reported`. Nếu `post.status === 'PENDING'` và `post.isOwner` → banner "⏳ Chờ duyệt".
- [ ] **Step 4:** i18n keys: `report`, `reportReason`, `reported`, `pendingNotice`, `pendingBadge`.
- [ ] **Step 5:** `pnpm --filter @tubutree/miniapp typecheck && build` → commit `feat(community): FE nút báo cáo + trạng thái chờ duyệt`.

---

### Task 5 (FE): Màn kiểm duyệt admin

**Files:**
- Create: `apps/miniapp/src/pages/community-moderation.tsx` (route `/admin/community`)
- Modify: `apps/miniapp/src/components/app.tsx` (route), điểm vào từ hub admin
- Modify: `apps/miniapp/src/services/feed-api.ts` (admin fns)

- [ ] **Step 1:** ĐỌC hub admin hiện có (`apps/miniapp/src/pages/admin.tsx` hoặc tương tự do staff-rbac thêm — tìm bằng `git grep "/admin"`) để mirror pattern (role ADMIN gate, layout tab/section).
- [ ] **Step 2:** feed-api admin fns: `adminPending()`, `adminApprove(id)`, `adminReject(id)`, `adminReports()`, `adminResolveReport(id)`, `adminPin(id, pinned)`.
- [ ] **Step 3:** Trang moderation (gate `role==='ADMIN'`): 2 tab — **Chờ duyệt** (list bài PENDING: xem tiêu đề/nội dung/ảnh + nút Duyệt/Từ chối → invalidate) + **Báo cáo** (list report OPEN: hiện targetType/targetId/reason + nút Ẩn bài/comment (gọi delete or reject) + Đã xử lý → resolve). Dùng useQuery/useMutation + getErrorMessage, strings vi.community.*.
- [ ] **Step 4:** Điểm vào: thêm mục "Kiểm duyệt cộng đồng" vào hub admin (nơi staff-rbac đặt các mục admin) + route `/admin/community` trong app.tsx (thêm vào profile READY nếu cần).
- [ ] **Step 5:** `pnpm --filter @tubutree/miniapp typecheck && build` → commit `feat(community): màn kiểm duyệt admin (duyệt bài + xử lý báo cáo)`.

---

## Self-Review
- Trust hybrid (role/đơn DELIVERED/profile) → T2 ✅; PENDING cho khách mới, reward-on-approve idempotent → T2 ✅; report + admin queue (approve/reject/reports/resolve/pin) → T3 ✅; FE báo cáo + chờ duyệt → T4 ✅; màn admin → T5 ✅.
- Money: reward chỉ khi PUBLISHED, idempotent qua reason+index; approve gọi lại không thưởng đôi (guard status PUBLISHED) → T2.
- Placeholder: FE T5 cố ý yêu cầu ĐỌC hub admin thật (do staff-rbac vừa thêm, không đoán cấu trúc) — nêu rõ.
- Hoãn có chủ đích: badge nhãn-hàng/isExpert-DTO, reputation/level → Pha 4.

## Ghi chú
- Route admin đặt trước `:id`. `getFeed` thêm `{isPinned:'desc'}` đầu orderBy (ghim lên đầu).
- Sau Pha 2: verify runtime (guest chưa mua → PENDING; admin approve → hiện + thưởng) rồi merge vào main.
