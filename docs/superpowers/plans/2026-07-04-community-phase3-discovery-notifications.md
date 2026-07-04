# Cộng đồng "Vườn Tubu" — Pha 3 (Khám phá + Thông báo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Khám phá nội dung (tìm kiếm, hashtag, lọc "chưa trả lời") + thông báo (có người trả lời câu hỏi, được chọn best-answer, chuyên gia trả lời, bài được duyệt). Kèm dọn vài backlog Minor (getComments trả isOwner, localize enum màn admin, nút ghim).

**Architecture:** Mở rộng module `feed` (đã có Pha 1+2). Thêm `Tag`+`PostTag`. Mở rộng `getFeed` opts (q/unanswered/tag) — 1 engine list duy nhất. Inject `NotificationsService` (global) vào `CommunityFeedService`, gọi `notify()` **non-fatal** ở addComment/setBestAnswer/approvePost. Thông báo hiện tự động ở trang `/notifications` sẵn có (notify tạo INAPP log). FE: thanh tìm kiếm + chip "Chưa trả lời" + tag chip + tag input composer.

**Tech Stack:** NestJS 10 + Prisma 5 + PostgreSQL, Jest. Miniapp React + ZaUI (typecheck+build gate).

## Global Constraints

- Money path KHÔNG đổi (Pha 3 không chạm reward). `notify()` phải **non-fatal** (try/catch + logger) — lỗi thông báo không được làm hỏng comment/best-answer/approve.
- `notify(userId, templateCode, data: Record<string,string>)` (global `NotificationsService`, đã `@Global`); INAPP log tự hiện ở `/me/notifications`. Template mới seed trong `apps/api/prisma/seed.ts` `NOTIFICATION_TEMPLATES` (channel INAPP).
- getFeed vẫn lọc `status='PUBLISHED'` + `isPinned` desc đầu orderBy (Pha 2). Thêm filter q/unanswered/tag KHÔNG phá cursor pagination hiện có.
- Không tự thông báo cho chính mình (answerer === postAuthor → không notify new-answer; best-answer cho chính chủ → skip).
- Copy tiếng Việt qua `vi.community.*` (FE) + bodyTemplate tiếng Việt (seed). Lỗi FE qua `getErrorMessage`.
- Lệnh: BE test `pnpm --filter @tubutree/api test -- <path>`; migrate `pnpm --filter @tubutree/api exec prisma migrate dev`; FE `pnpm --filter @tubutree/miniapp typecheck` + `build`.

---

### Task 1 (BE): Tag/PostTag + getFeed q/unanswered/tag + tags trong DTO

**Files:** schema.prisma (+2 model + FeedPost relation), migration, community-feed.service.ts, community-feed.service.spec.ts.

- [ ] **Step 1: Schema** — thêm:
```prisma
model Tag {
  id    String    @id @default(cuid())
  slug  String    @unique
  name  String
  posts PostTag[]
  @@map("community_tags")
}
model PostTag {
  postId String
  post   FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  tagId  String
  tag    Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([postId, tagId])
  @@index([tagId])
  @@map("post_tags")
}
```
Trong `FeedPost` thêm `tags PostTag[]`. Migrate `--name community_phase3_tags`; generate.

- [ ] **Step 2: Test (TDD)** — thêm mocks `tag: { upsert: jest.fn(...) }`, `postTag: { createMany: jest.fn() }` vào makePrisma. Test:
  - `createPost` với `tagSlugs:['sen-da','tuoi-nuoc']` → upsert Tag mỗi slug + postTag.createMany.
  - `getFeed({ q:'vàng lá' })` → where có `OR:[{title contains},{body contains}]` (mode insensitive) + status PUBLISHED.
  - `getFeed({ unanswered:true })` → where `kind:'QUESTION', bestCommentId:null`.
  - `getFeed({ tag:'sen-da' })` → where `tags:{ some:{ tag:{ slug:'sen-da' } } }`.
  - `toItem` trả `tags: [{slug,name}]` (thêm `tags` include).

- [ ] **Step 3: Implement**:
  - `CreatePostInput` thêm `tagSlugs?: string[]`. Trong createPost sau khi tạo post + productTags: nếu `tagSlugs?.length` → chuẩn hoá (slugify: lowercase, trim, thay khoảng trắng bằng '-', bỏ '#', cap 5, bỏ rỗng); mỗi slug `tag.upsert({ where:{slug}, create:{slug,name:<original label>}, update:{} })`; rồi `postTag.createMany({ data: tags.map(t=>({postId:post.id, tagId:t.id})), skipDuplicates:true })`. Non-fatal wrap giống productTags nếu muốn (nhưng để đơn giản: cùng transaction-less như productTags hiện tại).
  - `FEED_INCLUDE` thêm `tags: { include: { tag: { select: { slug:true, name:true } } } }`.
  - `getFeed` opts thêm `q?, unanswered?, tag?`; build where: nếu `opts.q` → `where.OR = [{title:{contains:q,mode:'insensitive'}},{body:{contains:q,mode:'insensitive'}}]`; nếu `opts.unanswered` → `where.kind='QUESTION'; where.bestCommentId=null`; nếu `opts.tag` → `where.tags={some:{tag:{slug:opts.tag}}}`. (Giữ status PUBLISHED + category + kind + sort + cursor như cũ; lưu ý `unanswered` set kind='QUESTION' — nếu cả `kind` và `unanswered` truyền thì unanswered thắng cho kind.)
  - `toItem` thêm `tags: (p.tags??[]).map(t=>({slug:t.tag.slug, name:t.tag.name}))`.

- [ ] **Step 4: Test pass + typecheck.** Cập nhật getFeed/toItem tests hiện có nếu thêm `tags` vào expected (thêm `tags: []` vào row/expectation nếu cần).

- [ ] **Step 5: Commit** `feat(community): Tag/PostTag + tìm kiếm/lọc chưa-trả-lời/tag + tags trong DTO`.

---

### Task 2 (BE): Thông báo (non-fatal) + getComments isOwner

**Files:** seed.ts (+4 template), community-feed.service.ts, community-feed.service.spec.ts.

- [ ] **Step 1: Seed templates** — thêm vào `NOTIFICATION_TEMPLATES` (seed.ts), channel INAPP:
```
{ id:'nt-comm-answer', code:'COMMUNITY_NEW_ANSWER', channel:'INAPP', bodyTemplate:'💬 {{author}} vừa trả lời câu hỏi "{{title}}" của bạn.' },
{ id:'nt-comm-expert', code:'COMMUNITY_EXPERT_REPLIED', channel:'INAPP', bodyTemplate:'🌿 Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.' },
{ id:'nt-comm-best', code:'COMMUNITY_BEST_ANSWER', channel:'INAPP', bodyTemplate:'✅ Câu trả lời của bạn được chọn là hay nhất! +{{xu}} TubuXu 🌿' },
{ id:'nt-comm-approved', code:'COMMUNITY_POST_APPROVED', channel:'INAPP', bodyTemplate:'🌱 Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.' },
```

- [ ] **Step 2: Inject NotificationsService** — thêm `private readonly notify?: NotificationsService` (import từ `../notifications/notifications.service`) vào constructor `CommunityFeedService` (Optional để test cũ không vỡ — hoặc thêm vào tất cả test factory). Vì NotificationsModule `@Global`, KHÔNG cần import module. (feed.module vẫn không cần đổi.)

- [ ] **Step 3: Test (TDD)** — mock `notify: { notify: jest.fn().mockResolvedValue(undefined) }`, truyền vào service. Test:
  - addComment trên QUESTION của người khác → gọi `notify.notify(postAuthorId, 'COMMUNITY_NEW_ANSWER', {author, title})`. (Cần load post kèm title + user fullName của answerer → mở rộng addComment fetch.)
  - answerer role STAFF/ADMIN → gọi `COMMUNITY_EXPERT_REPLIED` thay vì NEW_ANSWER (truyền role vào addComment: `addComment(userId, role, postId, body)` — thêm param role; controller truyền `user.role`).
  - tự trả lời (answerer===author) → KHÔNG notify.
  - setBestAnswer → `notify.notify(comment.userId, 'COMMUNITY_BEST_ANSWER', {xu})` (không notify nếu answerer===postAuthor).
  - approvePost → `notify.notify(post.userId, 'COMMUNITY_POST_APPROVED', {})`.
  - notify ném lỗi → hành động chính vẫn thành công (non-fatal): mock notify.notify.mockRejectedValue → addComment vẫn trả {id}.
  - getComments trả thêm `isOwner: c.userId === viewerId` → đổi `getComments(postId, viewerId?)` nhận viewerId; controller truyền `@CurrentUser('sub')`.

- [ ] **Step 4: Implement** — wrap mọi `notify?.notify(...)` trong try/catch + `this.logger.warn`. addComment: sau khi tạo comment + reward, load `post.title` (đã có post) + answerer fullName (query user hoặc truyền), chọn template theo role (STAFF/ADMIN → EXPERT_REPLIED). setBestAnswer: sau reward, notify comment.userId. approvePost: sau reward, notify post.userId. getComments: thêm param `viewerId` + map `isOwner`.

- [ ] **Step 5: Controller** — `addComment` truyền role: `@CurrentUser() user` → `this.feed.addComment(user.sub, user.role, id, dto.body)`. `getComments` truyền viewer: `@CurrentUser('sub') userId` → `this.feed.getComments(id, userId)` (đổi từ `@Param` only). Chạy full test + typecheck + build.

- [ ] **Step 6: Commit** `feat(community): thông báo cộng đồng (trả lời/best-answer/duyệt) non-fatal + getComments isOwner`.

---

### Task 3 (FE): Tìm kiếm + lọc chưa-trả-lời + tag trên bảng tin

**Files:** feed-api.ts, feed.tsx, components/community/post-card.tsx, i18n/vi.ts.

- [ ] feed-api `getFeed` params thêm `q?, unanswered?, tag?`; `FeedItem` thêm `tags: {slug,name}[]`.
- [ ] feed.tsx: thêm `Input.Search` (debounce 300 qua `useDebounced`) → set `q` vào queryKey/getFeed; chip "Chưa trả lời" toggle `unanswered`; nếu có `tag` state (từ tap tag) → filter + hiện nhãn "#tag ✕" để xoá. Đưa q/unanswered/tag vào `queryKey ['community', category, sort, q, unanswered, tag]` + getFeed args. Empty state cho tìm kiếm không ra.
- [ ] post-card.tsx: render tag chips (#name) nếu `post.tags.length` → tap chip set tag filter (điều hướng về feed với tag, hoặc callback). Đơn giản: tag chip tap → `navigate('/feed?tag='+slug)` hoặc set state qua query param; feed.tsx đọc query param `tag` (dùng useLocation/URLSearchParams) để khởi tạo filter.
- [ ] vi.community keys: `search`, `searchPlaceholder`, `unanswered`, `noResult`, `clearTag`.
- [ ] typecheck+build → commit `feat(community): FE tìm kiếm + lọc chưa trả lời + tag`.

---

### Task 4 (FE): Composer tag input + backlog polish (isOwner report, localize admin enum, nút ghim)

**Files:** components/community/post-composer.tsx, pages/post-detail.tsx, pages/community-moderation.tsx, services/feed-api.ts, i18n/vi.ts.

- [ ] **Composer tag input**: thêm ô nhập hashtag (Input, tách theo dấu phẩy/khoảng trắng, hiện chip, cap 5) → `createPost({..., tagSlugs})`. vi key `tags`, `tagsPlaceholder`.
- [ ] **isOwner report (backlog)**: post-detail — dùng `comment.isOwner` (giờ getComments trả) để ẩn nút Báo cáo trên bình luận của chính mình.
- [ ] **Localize admin enum (backlog)**: community-moderation.tsx — map `post.kind`/`report.targetType` qua nhãn vi.community.* (dùng KIND_LABEL từ post-card hoặc thêm map) thay vì hiện "QUESTION"/"POST" thô.
- [ ] **Nút ghim (backlog #7)**: feed-api thêm `adminPin(id, pinned)` → `POST /feed/admin/:id/pin`; trong post-detail, nếu `role==='ADMIN'` → nút "Ghim/Bỏ ghim" (cần biết trạng thái ghim — thêm `isPinned` vào FeedItem DTO ở Task 1's toItem: `isPinned: p.isPinned`, và FE type). Toggle → adminPin → invalidate.
- [ ] typecheck+build → commit `feat(community): composer tag input + polish (isOwner report, localize admin, nút ghim)`.

*(Ghi chú: `isPinned` cần thêm vào toItem/FeedItem — làm ở Task 1 Step 3 (thêm `isPinned: p.isPinned`) + Task 3 FE type, để Task 4 dùng.)*

---

## Self-Review
- Tìm kiếm (q ILIKE) / lọc chưa-trả-lời / tag → T1+T3 ✅; hashtag tạo+hiện+lọc → T1+T3+T4 ✅; thông báo 4 loại non-fatal → T2 ✅ (hiện tự động ở /notifications); backlog (isOwner report, localize admin enum, nút ghim) → T2+T4 ✅.
- Money path không đổi; notify + tag creation non-fatal.
- Placeholder: none — backend TDD-concrete, FE mirror pattern browse.tsx (search/debounce) + Pha 1/2 components.

## Ghi chú
- Sau Pha 3: verify runtime (tạo bài có tag → tìm theo tag; trả lời → post author nhận thông báo) rồi merge main.
- Pha 4 (reputation/hạng/sự kiện) là phần cuối theo spec.
