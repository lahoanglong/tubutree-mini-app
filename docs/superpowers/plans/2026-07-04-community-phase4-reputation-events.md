# Cộng đồng "Vườn Tubu" — Pha 4 (Reputation + Sự kiện) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Giữ chân — điểm uy tín & hạng thành viên (Mầm → Cây non → Trưởng thành → Cổ thụ) hiển thị cạnh tên + bảng xếp hạng; sự kiện/thử thách cộng đồng (admin tạo, thành viên tham gia bằng bài, admin chọn người thắng → thưởng xu). Phần cuối theo spec §6.

**Architecture:** Mở rộng module `feed`. Dùng `CommunityProfile` (đã có reputation/level/postCount/bestAnswerCount từ Pha 2). Tăng điểm **non-fatal** tại các action đã có (post PUBLISHED / answer / best-answer). Thêm `CommunityEvent` + thưởng người thắng qua `CoinsService.grantCoins` (idempotent). FE: badge hạng + trang bảng xếp hạng + trang sự kiện + quản lý sự kiện trong hub admin.

**Tech Stack:** NestJS 10 + Prisma 5 + PostgreSQL, Jest. Miniapp React + ZaUI (typecheck+build gate).

## Global Constraints

- **Tiền tệ:** thưởng người thắng sự kiện qua `CoinsService.grantCoins(userId, amount, reason, 'COMMUNITY', refId)` — reason `COMMUNITY_EVENT_WIN:<eventId>:<userId>` (idempotent qua partial unique index sẵn có refType='COMMUNITY'). Chỉ thưởng khi admin chốt người thắng. Non-fatal wrap.
- **Reputation là điểm mềm (cosmetic rank), KHÔNG phải tiền.** Tăng điểm là side-effect non-fatal (try/catch + logger) tại: post đạt PUBLISHED (+`community.rep_post`, mặc định 5), trả lời (+`community.rep_answer`, 2), được chọn best-answer (+`community.rep_best`, 10). Không cần idempotent tuyệt đối (rank hiển thị, không quy đổi tiền); tie vào cùng chỗ gọi reward để tận dụng guard sẵn có nơi có thể. `level` suy từ `community.rep_thresholds` (mặc định [0,50,200,500] → level 1..4).
- Level/rank tên: 1 Mầm · 2 Cây non · 3 Cây trưởng thành · 4 Cổ thụ (`levelName(level)`).
- getFeed/getComments DTO thêm `authorLevel` (số) để FE hiện badge hạng. KHÔNG phá money path / notify / discovery của Pha 1–3.
- Auth: global JwtAuthGuard; admin `@Roles('ADMIN')`. Event routes đặt trước `:id` param routes.
- Copy vi.community.*; lỗi FE getErrorMessage. Lệnh như các pha trước.

---

### Task 1 (BE): Reputation — tăng điểm + level + expose authorLevel + leaderboard

**Files:** community-feed.service.ts, community-feed.controller.ts, community-feed.service.spec.ts.

- [ ] **Step 1: Helpers + test (TDD)**. Thêm mock `communityProfile.upsert` (đã có), `communityProfile.findMany`. Test:
  - `levelFromReputation(rep, thresholds=[0,50,200,500])`: rep 0→1, 49→1, 50→2, 200→3, 500→4 (pure fn).
  - `levelName(1..4)` → 'Mầm'/'Cây non'/'Cây trưởng thành'/'Cổ thụ'.
  - `bumpReputation(userId, amount)`: upsert CommunityProfile increment reputation + set level = levelFromReputation(newRep) (đọc thresholds config). (Đơn giản: upsert increment reputation; rồi tính level từ reputation mới — có thể findUnique sau upsert để lấy reputation rồi update level, hoặc set level trong cùng upsert nếu tính được; chấp nhận 2 bước.)
  - `getLeaderboard(take=20)`: `communityProfile.findMany` orderBy reputation desc take, join user fullName/avatar → map `{ author, avatar, reputation, level, levelName }`.
  - getFeed/getComments toItem thêm `authorLevel: user.communityProfile?.level ?? 1` (thêm include communityProfile trong FEED_INCLUDE + getComments include).

- [ ] **Step 2–3: Implement** (pure fns + bumpReputation non-fatal; wire bumpReputation calls — non-fatal try/catch — tại: createPost khi status PUBLISHED (+rep_post to author), addComment khi QUESTION & non-self (+rep_answer to answerer), setBestAnswer (+rep_best to answerer), approvePost (+rep_post to author)). Thresholds/amounts qua SystemConfigService (inject nếu chưa — CommunityRewardService có; CommunityFeedService thì chưa → inject `@Optional() config` hoặc thêm SystemConfigService (global). Đơn giản: inject SystemConfigService vào CommunityFeedService constructor (global module, luôn có)). FEED_INCLUDE + getComments include `user.communityProfile.level`. Leaderboard endpoint `GET /feed/leaderboard` (đặt trước `:id`).

- [ ] **Step 4: Verify** test + typecheck + build + full suite.
- [ ] **Step 5: Commit** `feat(community): reputation/hạng + authorLevel trong DTO + leaderboard`.

---

### Task 2 (BE): CommunityEvent — model + endpoints + thưởng người thắng

**Files:** schema.prisma (+model), migration, community-feed.service.ts, community-feed.controller.ts, spec.

- [ ] **Step 1: Schema**:
```prisma
model CommunityEvent {
  id             String   @id @default(cuid())
  title          String
  description    String?
  coverUrl       String?
  startAt        DateTime
  endAt          DateTime
  rewardXu       Int      @default(0)
  status         String   @default("OPEN") // OPEN | CLOSED
  winnerUserId   String?
  createdAt      DateTime @default(now())
  @@index([status, endAt])
  @@map("community_events")
}
```
Bài tham gia sự kiện: dùng `FeedPost.meta.eventId` (không cần bảng join — MVP). Migrate `--name community_phase4_events`.

- [ ] **Step 2: Test (TDD)** (mock `communityEvent`): `listEvents()` (OPEN, orderBy endAt), `createEvent(dto)` (admin), `closeEvent(id)` (status CLOSED), `pickWinner(eventId, userId)` (set winnerUserId + CLOSED + grantCoins reason COMMUNITY_EVENT_WIN:<eventId>:<userId> non-fatal, idempotent), `submitToEvent` = createPost với `meta:{eventId}` (mở rộng CreatePostInput `eventId?` → set meta). `eventPosts(eventId)` = getFeed-like filter `meta.eventId` (Prisma JSON filter `meta: { path:['eventId'], equals: eventId }`).

- [ ] **Step 3: Implement** service methods (pickWinner dùng CoinsService.grantCoins — CommunityFeedService chưa inject CoinsService; CommunityRewardService có. Thêm 1 method vào CommunityRewardService: `rewardEventWinner(userId, eventId, amount)` (reason COMMUNITY_EVENT_WIN:<eventId>:<userId>, refType COMMUNITY) rồi gọi từ feed service). createPost: `CreatePostInput.eventId?` → nếu có, set `meta = { ...(meta||{}), eventId }`.

- [ ] **Step 4: Controller** — `GET /feed/events` (auth), `GET /feed/events/:id/posts`, `@Roles('ADMIN')`: `POST /feed/events` (create), `POST /feed/events/:id/close`, `POST /feed/events/:id/winner` body `{userId}`. Đặt `events` routes TRƯỚC `:id`. createPost DTO thêm `@IsOptional() @IsString() eventId?`.

- [ ] **Step 5: Verify** + **Commit** `feat(community): sự kiện cộng đồng — model + endpoint + thưởng người thắng (idempotent)`.

---

### Task 3 (FE): Badge hạng + bảng xếp hạng

**Files:** feed-api.ts, post-card.tsx, post-detail.tsx, pages/community-leaderboard.tsx (new), app.tsx, feed.tsx (entry), vi.ts.

- [ ] feed-api: `FeedItem`/`FeedComment` thêm `authorLevel: number`; `getLeaderboard()` → `{author,avatar,reputation,level,levelName}[]`.
- [ ] post-card + post-detail: cạnh tên tác giả hiện badge hạng nhỏ (icon 🌱/🌿/🌳 theo level + levelName) khi authorLevel>1 (level 1 Mầm có thể ẩn để đỡ rối).
- [ ] `community-leaderboard.tsx` route `/feed/leaderboard`: list top 20 (hạng + tên + avatar + reputation + levelName). Entry: nút "Bảng xếp hạng" ở header feed.tsx. Route trong app.tsx + READY.
- [ ] vi keys: `leaderboard`, `rank`, `level1..4` (Mầm/Cây non/Cây trưởng thành/Cổ thụ), `points`.
- [ ] typecheck+build → commit `feat(community): FE badge hạng + bảng xếp hạng`.

---

### Task 4 (FE): Sự kiện — trang danh sách/tham gia + quản lý admin

**Files:** feed-api.ts, pages/community-events.tsx (new), community-moderation.tsx (admin event tab), post-composer.tsx (chọn sự kiện), app.tsx, feed.tsx (entry), vi.ts.

- [ ] feed-api: `listEvents()`, `eventPosts(id)`, admin `createEvent(dto)`, `closeEvent(id)`, `pickWinner(id,userId)`; `createPost` input thêm `eventId?`.
- [ ] `community-events.tsx` route `/feed/events`: list sự kiện OPEN (cover/tiêu đề/mô tả/hạn/thưởng xu) → tap xem bài dự thi (eventPosts) + nút "Đăng bài dự thi" (mở composer với eventId). Entry: thẻ/nút "Sự kiện" ở header feed.
- [ ] composer: nếu mở từ sự kiện (prop eventId) → hiện nhãn "Dự thi: <event>" + gửi `eventId` trong createPost.
- [ ] community-moderation.tsx: thêm tab "Sự kiện" (admin) — tạo sự kiện (form title/desc/cover/startAt/endAt/rewardXu), đóng, chọn người thắng (nhập userId hoặc chọn từ bài dự thi).
- [ ] vi keys: `events`, `joinEvent`, `submitEntry`, `eventReward`, `pickWinner`, `createEvent`, `closeEvent`, `eventEnded`.
- [ ] typecheck+build → commit `feat(community): FE sự kiện — tham gia + quản lý admin`.

---

## Self-Review
- Reputation/hạng (tăng điểm non-fatal, level, badge, leaderboard) → T1+T3 ✅; sự kiện (model/endpoint/thưởng winner idempotent + FE tham gia/quản lý) → T2+T4 ✅.
- Money: chỉ pickWinner chạm tiền (grantCoins idempotent + non-fatal); reputation là điểm mềm.
- Không phá Pha 1–3 (money/notify/discovery giữ nguyên; chỉ thêm include communityProfile + meta.eventId).
- Placeholder: none — BE TDD-concrete, FE mirror pattern (leaderboard/events list ~ browse/orders; admin event tab ~ moderation tab).

## Ghi chú
- Sau Pha 4: verify runtime (tăng rep → level; tạo event → submit → pick winner thưởng xu) rồi merge main. HOÀN THÀNH cả 4 pha theo spec.
- Reputation không farm-hardened (cosmetic); nếu cần chống farm về sau, tie vào reward cap.
