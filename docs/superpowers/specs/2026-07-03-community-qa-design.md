# Thiết kế: Cộng đồng "Vườn Tubu" — hỏi đáp & đăng bài gắn bán hàng

- **Ngày:** 2026-07-03
- **Thuộc:** [[project_tubutree_v2_monorepo]] · liên quan [[project_vuon_xanh_2]] (feed game), [[project_tubuxu]] (thưởng xu), [[project_storefront]] (role/brand cho badge chuyên gia).
- **Trạng thái:** Đã brainstorm & chốt hướng với user 2026-07-03. Chờ review spec → writing-plans.

## Mục tiêu

Biến trải nghiệm "FB Group" thành một cộng đồng hỏi–đáp & đăng bài **ngay trong Zalo Mini App**, customize để **gắn kết bán hàng**. Tubu bán cây/cây cảnh — mặt hàng khách có rất nhiều câu hỏi sau mua (tưới, ánh sáng, lá vàng, sâu bệnh, thay chậu, phối cảnh). Cộng đồng khai thác đúng nhu cầu đó và khép 4 vòng lặp về doanh thu:

1. Hỏi chăm cây → cộng đồng/chuyên gia Tubu trả lời → gợi ý sản phẩm giải pháp.
2. Khoe vườn (UGC có ảnh) → gắn thẻ SP đã mua → người khác "muốn giống vậy" → chạm PDP.
3. Thưởng TubuXu cho hỏi/đáp/khoe → xu tiêu trong app → quay lại mua.
4. Gắn đơn hàng & game Vườn Xanh → cộng đồng thành trung tâm giữ chân.

### Quyết định nghiệp vụ đã chốt với user

- **Trọng tâm v1:** Kết hợp — một bảng tin thống nhất nhiều loại bài (Hỏi đáp / Khoe vườn / Mẹo hay), phân theo danh mục.
- **Cơ chế gắn bán hàng:** làm cả 4 — gắn thẻ SP, badge Shop/chuyên gia, thưởng TubuXu, nút "Mua cây này".
- **Kiểm duyệt:** Lai — khách tin cậy (đã mua / admin set) đăng ngay; khách mới duyệt lần đầu; báo cáo + ẩn.
- **Phạm vi:** Đầy đủ (gồm tìm kiếm, tag, thông báo, xếp hạng thành viên, sự kiện/thử thách) — **thiết kế trọn vẹn, giao theo pha**.
- **Danh tính tác giả:** hiện **tên hiển thị + avatar** cho bài cộng đồng (khác feed cũ đang giấu tên) — user đã đồng ý.
- **Danh mục seed & mức thưởng xu (200/100/500):** user đã đồng ý mặc định đề xuất; chỉnh sau qua admin config.

## Kiến trúc (Hướng A — tiến hoá module feed sẵn có)

Mở rộng module & model đã có thay vì làm mới:

- Backend: `apps/api/src/modules/feed/` (`CommunityFeedService` đã `@Injectable` + được export; controller `@Controller('feed')`). Auto-post game gọi `createAchievementPost(...)` từ [game.service.ts:200](../../../apps/api/src/modules/game/game.service.ts) và [game-garden.service.ts:216](../../../apps/api/src/modules/game/game-garden.service.ts) — **giữ nguyên hoạt động**.
- Frontend: `apps/miniapp/src/pages/feed.tsx` + `apps/miniapp/src/services/feed-api.ts` (route `/feed` đăng ký ở `app.tsx`) là điểm khởi đầu, mở rộng dần.

Ta **tiến hoá 3 bảng lõi** (`FeedPost`/`FeedComment`/`FeedReaction`) và **thêm bảng vệ tinh** (danh mục, thẻ SP, tag, report, hồ sơ thành viên).

Lý do không chọn B/C: B tạo 2 hệ bài + lớp gộp và trùng lặp reaction/comment; C phải repoint code game (nhạy cảm money-path) + migrate + xoá feed cũ. A rủi ro thấp nhất, tận dụng wiring sẵn có, đúng mục tiêu "một bảng tin thống nhất".

## Mô hình dữ liệu

Tất cả bảng đặt trong `apps/api/prisma/schema.prisma`, tiền tố `feed_*`/`community_*`. Ảnh: đẩy client → Cloudinary (theo `MultiImageUpload` hiện có), DB chỉ lưu URL string.

### Tiến hoá bảng lõi

```prisma
enum FeedPostKind {         // giữ cũ + thêm mới
  MANUAL
  HARVEST
  MILESTONE
  SPECIES
  QUESTION     // mới — bài hỏi đáp (có title, cho phép best-answer)
  SHOWCASE     // mới — khoe vườn/cây (nhấn ảnh + gắn SP)
  TIP          // mới — mẹo/chia sẻ kinh nghiệm
}

enum FeedPostStatus {
  PENDING      // khách mới, chờ admin duyệt
  PUBLISHED
  HIDDEN       // admin ẩn (vi phạm/nhẹ)
  REMOVED      // xoá mềm
}

model FeedPost {
  id            String         @id @default(cuid())
  userId        String
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind          FeedPostKind   @default(MANUAL)
  status        FeedPostStatus @default(PUBLISHED)
  categoryId    String?
  category      CommunityCategory? @relation(fields: [categoryId], references: [id])
  title         String?        // dùng cho QUESTION
  body          String
  images        String[]       // URL Cloudinary
  meta          Json?
  isPinned      Boolean        @default(false)
  bestCommentId String?        @unique   // best-answer (trỏ FeedComment)
  likeCount     Int            @default(0)  // denormalized
  commentCount  Int            @default(0)  // denormalized
  viewCount     Int            @default(0)
  editedAt      DateTime?
  createdAt     DateTime       @default(now())
  reactions     FeedReaction[]
  comments      FeedComment[]  @relation("PostComments")
  productTags   PostProductTag[]
  tags          PostTag[]
  @@index([status, createdAt])
  @@index([categoryId, status, createdAt])
  @@index([kind, status, createdAt])
  @@map("feed_posts")
}

model FeedComment {
  id          String   @id @default(cuid())
  postId      String
  post        FeedPost @relation("PostComments", fields: [postId], references: [id], onDelete: Cascade)
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  body        String
  isAccepted  Boolean  @default(false)  // best-answer đã chọn
  createdAt   DateTime @default(now())
  @@index([postId, createdAt])
  @@map("feed_comments")
}
// FeedReaction: GIỮ NGUYÊN (like bài, @@unique([postId, userId])). Like comment hoãn tới Pha 4.
```

**Ghi chú migration:** field mới đều có default/nullable → migrate không phá dữ liệu cũ. `likeCount`/`commentCount` denormalized: seed một lần từ `_count` hiện có, sau đó tăng/giảm trong cùng transaction với react/comment.

### Bảng mới

```prisma
model CommunityCategory {
  id       String  @id @default(cuid())
  slug     String  @unique
  name     String
  icon     String?          // emoji/tên lucide
  order    Int     @default(0)
  isActive Boolean @default(true)
  posts    FeedPost[]
  @@map("community_categories")
}

model PostProductTag {              // gắn SP vào bài/đáp → shoppable
  id        String   @id @default(cuid())
  postId    String
  post      FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([postId, productId])
  @@index([productId])            // "SP này được nhắc ở đâu"
  @@map("post_product_tags")
}

model Tag {                          // hashtag (Pha 3)
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
  @@map("post_tags")
}

model CommunityReport {             // kiểm duyệt (Pha 2)
  id         String   @id @default(cuid())
  reporterId String
  reporter   User     @relation(fields: [reporterId], references: [id], onDelete: Cascade)
  targetType String   // POST | COMMENT
  targetId   String
  reason     String
  status     String   @default("OPEN")  // OPEN | RESOLVED
  createdAt  DateTime @default(now())
  @@index([status, createdAt])
  @@map("community_reports")
}

model CommunityProfile {            // trust + xếp hạng (Pha 2/4)
  userId          String   @id
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  reputation      Int      @default(0)
  level           Int      @default(1)     // 1 Mầm · 2 Cây non · 3 Trưởng thành · 4 Cổ thụ
  isTrusted       Boolean  @default(false) // đăng ngay không cần duyệt
  isExpert        Boolean  @default(false) // override thủ công (ngoài suy luận từ role)
  postCount       Int      @default(0)
  bestAnswerCount Int      @default(0)
  updatedAt       DateTime @updatedAt
  @@map("community_profiles")
}
```

**Không gộp với Reviews.** [reviews.service.ts](../../../apps/api/src/modules/reviews/reviews.service.ts) đã lo UGC *xác thực mua* theo từng SP (rating + ảnh/video, thưởng **điểm** `pointsBalance`, `@@unique([userId, productId])`). Cộng đồng thưởng **xu** `coinsBalance` và không ràng buộc mua. Cross-link (bài có thể gắn SP; review vẫn là review), tránh double-count.

### Danh mục seed

`Chăm sóc cây` · `Sâu bệnh` · `Phối cảnh / décor` · `Khoe vườn` · `Hỏi mua gì` · `Mẹo hay`. Seed qua migration; sửa/thêm qua admin.

## API

Tuân theo pattern hiện có: global `JwtAuthGuard` (auth mặc định), `@CurrentUser('sub') userId`, `@Roles('ADMIN')` cho moderation, `@Public()` cho đọc công khai. Giữ prefix `/feed`.

### Đọc & tạo bài (Pha 1)
- `GET /feed?category=&kind=&sort=&cursor=` → danh sách bài `PUBLISHED` (phân trang cursor theo `createdAt`). Trả DTO gồm `author` (tên + avatar), `authorBadge` (expert?), `category`, `images`, `productTags[]`, counts, `liked`, `bestCommentId`.
- `GET /feed/:id` → chi tiết 1 bài (+ tăng `viewCount`).
- `POST /feed` body `{ kind, categoryId, title?, body, images?[], productSlugs?[], tagSlugs?[] }` → tạo bài. Server tự đặt `status` theo trust (xem Kiểm duyệt). QUESTION bắt buộc `title`. Validate độ dài (title ≤160, body 1–5000, images ≤6, productSlugs ≤5).
- `POST /feed/:id/react` → toggle like (giữ nguyên, cập nhật `likeCount`).
- `PATCH /feed/:id` (chủ bài) → sửa body/images/tags; set `editedAt`.
- `DELETE /feed/:id` (chủ bài hoặc ADMIN) → `status=REMOVED`.

### Bình luận / trả lời (Pha 1)
- `GET /feed/:id/comments` → danh sách (tên + avatar + badge).
- `POST /feed/:id/comments` body `{ body, productSlugs? }` → thêm trả lời; cập nhật `commentCount`.
- `POST /feed/:id/best-answer/:commentId` (chủ bài QUESTION hoặc ADMIN) → set `bestCommentId`, đánh `isAccepted`, bỏ cờ comment cũ, thưởng xu người trả lời.

### Kiểm duyệt (Pha 2, `@Roles('ADMIN')`)
- `GET /feed/admin/pending` → bài PENDING.
- `POST /feed/admin/:id/approve` | `/reject`.
- `POST /feed/:id/report` body `{ reason }` (auth thường) → tạo `CommunityReport`.
- `GET /feed/admin/reports` · `POST /feed/admin/reports/:id/resolve` (kèm hành động ẩn/xoá).
- `POST /feed/admin/:id/pin` toggle ghim.

### Khám phá & tag (Pha 3)
- `GET /feed/search?q=` (ILIKE title+body, chỉ PUBLISHED).
- `GET /feed?unanswered=1` (QUESTION chưa có bestComment) — đẩy trả lời.
- `GET /feed/tags/:slug`.

### Sự kiện (Pha 4)
- `GET /feed/events` · `POST /feed/:id` với `meta.eventId`. (Chi tiết model sự kiện ở Pha 4, xem dưới.)

## Cơ chế gắn bán hàng

1. **Gắn thẻ SP** — Composer có ô tìm SP (tái dùng search catalog theo tên) → chọn tối đa 5 → lưu `PostProductTag`. Bài & comment render **chip `ProductCard`** ([product-card.tsx](../../../apps/miniapp/src/components/product-card.tsx)) → chạm `navigate('/product/'+slug)`.
2. **Badge Shop/Chuyên gia** — hàm `resolveBadge(user)`: `role ∈ {STAFF, ADMIN}` → "Chuyên gia Tubu"; hoặc chủ nhãn xác thực (`Brand.ownerUserId === userId && brand.isVerified`) → "Nhãn hàng ✔"; hoặc `CommunityProfile.isExpert`. Câu trả lời có badge → **ghim đầu danh sách comment** + hiển thị huy hiệu.
3. **Thưởng TubuXu** — qua [CoinsService.grantCoins(userId, amount, reason, refType, refId)](../../../apps/api/src/modules/wallet/coins.service.ts):
   - Bài PUBLISHED: `+community.post_reward` (mặc định **200**), reason `COMMUNITY_POST:<postId>`.
   - Trả lời: `+community.answer_reward` (mặc định **100**), reason `COMMUNITY_ANSWER:<commentId>`.
   - Được chọn best-answer: `+community.best_answer_reward` (mặc định **500**), reason `COMMUNITY_BEST:<commentId>`.
   - **Idempotency:** thêm partial unique index trên `CoinTransaction.reason WHERE refType='COMMUNITY'` (giống pattern REFERRAL sẵn có) → cấp trùng ném P2002, nuốt. refType mới = `COMMUNITY`.
   - **Chống lạm dụng:** chỉ thưởng khi bài đạt PUBLISHED (không thưởng lúc PENDING; duyệt xong mới thưởng); trần số lần thưởng đăng bài/ngày (`community.daily_post_reward_cap`, mặc định 3); không thưởng khi tự trả lời câu hỏi của chính mình.
   - Amount đọc qua [SystemConfigService.get('community.*', fallback)](../../../apps/api/src/modules/system-config/system-config.service.ts); sửa qua `PUT /admin/config`.
4. **Nút "Mua cây này"** — bài SHOWCASE có `productTags` → nút mua nhanh SP đầu tiên; comment Q&A có SP → nút "Xem giải pháp" → PDP.

*(Deferred, không thuộc 4 pha: đo attribution bài→click→đơn.)*

## Kiểm duyệt lai + danh tính

**Trust:** `isTrusted(userId)` = `CommunityProfile.isTrusted` OR có đơn `DELIVERED` (query theo pattern [reviews.service.ts:19](../../../apps/api/src/modules/reviews/reviews.service.ts) bỏ filter `items`) OR `role ∈ {STAFF,ADMIN,DEALER,AFFILIATE}`. Trusted → bài `PUBLISHED` ngay; ngược lại `PENDING`. Sau khi admin approve bài đầu → set `CommunityProfile.isTrusted=true` (lần sau đăng thẳng). Rate-limit qua `ThrottlerGuard` sẵn có + kiểm tần suất tạo bài.

**Danh tính:** DTO cộng đồng trả `author = user.fullName` + `avatar = user.avatarUrl` (KHÔNG dùng `maskName`). Auto-post game (`HARVEST/SPECIES/MILESTONE`) vẫn có thể giữ mask nếu muốn — quyết định lúc code Pha 1, mặc định cũng hiện tên để nhất quán. Báo cáo/ẩn xử lý nội dung xấu thay cho việc ẩn danh.

## Thông báo (Pha 3)

Qua [NotificationsService.notify(userId, templateCode, data)](../../../apps/api/src/modules/notifications/notifications.service.ts) + thêm `NotificationTemplate` (INAPP) mới:
- `COMMUNITY_NEW_ANSWER` — có người trả lời câu hỏi của bạn.
- `COMMUNITY_BEST_ANSWER` — câu trả lời của bạn được chọn hay nhất (+xu).
- `COMMUNITY_EXPERT_REPLIED` — chuyên gia Tubu đã trả lời.
- `COMMUNITY_POST_APPROVED` — bài của bạn đã được duyệt.
Miniapp đọc qua `/me/notifications` sẵn có.

## Giữ chân (Pha 4)

- **Reputation & hạng:** cộng điểm khi bài được like/best-answer/trả lời; `level` suy từ ngưỡng reputation (Mầm→Cây non→Trưởng thành→Cổ thụ). Badge hạng cạnh tên; trang bảng xếp hạng.
- **Sự kiện/thử thách:** model `CommunityEvent { id, title, description, coverUrl, startAt, endAt, rewardXu?, rewardVoucherId?, status }`; bài gắn `meta.eventId`; admin chọn người thắng → trao xu/voucher (tái dùng vouchers.service). Ví dụ "Khoe góc xanh tháng 7".

## Config keys

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `community.post_reward` | 200 | xu khi bài PUBLISHED |
| `community.answer_reward` | 100 | xu khi trả lời |
| `community.best_answer_reward` | 500 | xu khi được chọn best-answer |
| `community.daily_post_reward_cap` | 3 | trần lần thưởng đăng bài/ngày |
| `community.rep_thresholds` | [0,50,200,500] | ngưỡng lên hạng (Pha 4) |

## Lộ trình pha

| Pha | Nội dung | Model/endpoint chính |
|---|---|---|
| **1 — Lõi + Q&A + bán hàng** | enum/status/images/category, composer type-aware, comment + best-answer, badge chuyên gia, gắn SP + "Mua cây này", thưởng xu, hiện danh tính | FeedPost mở rộng, CommunityCategory, PostProductTag; `GET/POST /feed`, comments, best-answer |
| **2 — Kiểm duyệt lai** | trust từ đơn DELIVERED, PENDING cho khách mới, report + hàng đợi admin, ghim, rate-limit | FeedPostStatus, CommunityReport, CommunityProfile.isTrusted; endpoint admin |
| **3 — Khám phá + thông báo** | tìm kiếm, tag/hashtag, lọc chưa-trả-lời, notifications | Tag/PostTag; search/tags endpoint; NotificationTemplate mới |
| **4 — Giữ chân** | reputation/hạng, sự kiện/thử thách | CommunityProfile (rep/level), CommunityEvent |

## Kiểm thử (theo TDD, mỗi pha)

- **Unit (mock Prisma):** tạo bài đặt status theo trust; QUESTION bắt buộc title; best-answer set cờ + bỏ cờ cũ + thưởng xu 1 lần (idempotent, không thưởng self-answer); `resolveBadge` theo role/brand; trần thưởng/ngày; counters tăng/giảm đúng.
- **Integ:** khách mới đăng → PENDING → admin approve → PUBLISHED + set trusted + thưởng xu; khách đã DELIVERED đăng → PUBLISHED ngay; report → resolve ẩn bài.
- **E2E:** đăng bài SHOWCASE gắn SP → hiện chip → best-answer thưởng xu vào `coinsBalance` (ledger `CoinTransaction` khớp) → notification tạo.
- **FE:** feed lọc theo danh mục; composer gắn SP; chip điều hướng PDP; nút "Mua cây này".

## Rủi ro & lưu ý

- **Money-path:** thưởng xu phải idempotent + đúng invariant `coinsBalance == SUM(CoinTransaction.delta)` — grant trong `$transaction`, dedupe bằng reason + partial unique index. Không thưởng lúc PENDING.
- **Privacy:** đổi từ giấu tên → hiện tên+avatar là thay đổi hành vi; auto-post game xem xét giữ mask nếu nhạy cảm.
- **Không phá game:** không đổi chữ ký `createAchievementPost`; field mới đều optional.
- **Spam:** rate-limit + kiểm duyệt lai + report là ba lớp phòng vệ.
