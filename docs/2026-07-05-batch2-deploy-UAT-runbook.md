# Runbook deploy + UAT — Retention batch 2

> Ngày viết: 2026-07-05. Phạm vi: toàn bộ tính năng batch 1 + batch 2 đã merge `main`
> (xem `docs/2026-07-05-retention-batch2-program-plan.md` cho bối cảnh chương trình).
> Tài liệu này = kết quả gate cuối + UAT tự động (đã chạy) + hướng dẫn deploy prod +
> checklist UAT thủ công trên Zalo thật (chưa chạy — cần user).

## Tính năng trong batch này (đã merge `main`)

**Batch 1:** Streak Repair, Referral milestone, Remarketing (nhắc giỏ bỏ quên + voucher
sắp hết hạn), Subscription discount tiers, Subscription save-flow.
**Batch 2:** Feed "Dành cho bạn" (`GET /products/for-you`), "Nhắc tôi" flash sale,
Point-expiry FIFO + reminder, FAQ + AI-context, Season/Battle Pass, CTV Content Kit,
CTV Lên đơn hộ, CTV Academy. Cộng thêm: Flash Sale engine (nền tảng, làm trước batch 2),
Chat AI (DeepSeek→Gemini, `ai-advisor` + `LlmClient`, đã có trước batch này).

---

## Phần 1 — Kết quả gate cuối (đã chạy, `main`, commit `b92fb73`)

| Bước | Kết quả |
|---|---|
| `pnpm --filter @tubutree/api test` | **PASS** — 80/80 test suite, **1040/1040 test** (29.6s) |
| `pnpm --filter @tubutree/api typecheck` | **PASS** (`tsc --noEmit`, không lỗi) |
| `pnpm --filter @tubutree/miniapp typecheck` | **PASS** |
| `pnpm --filter @tubutree/miniapp build` | **PASS** (Vite, built in 10.24s) |
| `pnpm --filter @tubutree/web typecheck` | **PASS** |
| `pnpm --filter @tubutree/web build` | **PASS** (Next.js 14.2.35, 10 route tĩnh/động, build thành công) |
| `pnpm --filter @tubutree/api exec prisma migrate status` | **"Database schema is up to date!"** — 70 migrations, DB dev `localhost:5434/tubutree` |

### Migration mới trong batch này (dated `20260705*`)

Theo thứ tự áp dụng, đã có sẵn trên DB dev (không cần `migrate reset`):

1. `20260705000000_cashback_provider` — **không thuộc batch 2** (tính năng cashback
   provider-agnostic, làm ngay trước batch 2 cùng ngày — xem `0accb07 docs(cashback)`). Liệt kê
   ở đây vì trùng ngày, để tránh nhầm khi rà migration.
2. `20260705015816_flash_sale_engine` — nền tảng Flash Sale (item/sale/quota).
3. `20260705074211_streak_repair` — `GameProfile.brokenStreakDays/brokenStreakAt/lastStreakRepairAt`.
4. `20260705083222_remarketing` — model hỗ trợ remarketing (giỏ bỏ quên/voucher sắp hết hạn).
5. `20260705093334_flash_reminder` — `FlashSaleReminder` ("Nhắc tôi").
6. `20260705095822_faq` — model FAQ.
7. `20260705130632_season_pass` — `Season`/`UserSeasonPass` mở rộng cho chặng mùa.
8. `20260705132431_content_kit` — model Content Kit CTV.
9. `20260705134758_order_placed_for_customer` — `Order.placedForCustomer`.
10. `20260705140136_academy` — `Course`/`Lesson`/`UserLessonProgress`.

**Prod chạy `prisma migrate deploy` sẽ áp toàn bộ 10 migration trên** (cộng với các
migration cũ hơn nếu prod DB đang ở baseline trước đó — kiểm `migrate status` trên prod
trước để biết chính xác cần áp bao nhiêu cái).

---

## Phần 2 — UAT tự động trên DB dev thật (đã chạy, đã dọn sạch)

Script throwaway `apps/api/scripts/_uat-batch2.ts` (real `PrismaClient` trỏ
`localhost:5434/tubutree`, gọi trực tiếp service layer — KHÔNG qua Nest DI/HTTP) đã chạy
3 tính năng mới end-to-end, **7/7 bước PASS**, sau đó tự dọn toàn bộ dữ liệu tạo ra +
tự xoá chính nó.

| Bước | Kết quả | Quan sát |
|---|---|---|
| SeasonPassService.addXp + getState | **PASS** | Mùa active `Mùa Hè Xanh — Phủ xanh Cần Giờ`; addXp(50) → `getState.xp = 50` |
| SeasonPassService.claim(tier 0, 'free') | **PASS** | Bậc 0 (ngưỡng 30xp) affordable → claim trả `{type:'SEEDS', amount:20}`; `GameProfile.totalSeeds` 0→20; `claimedFree` bật đúng bậc |
| AffiliateService.placeOrderForCustomer | **PASS** | Tạo `Order` (COD) `placedForCustomer=true`, `status=CONFIRMED`, `total=345.000đ` |
| → trừ tồn kho | **PASS** | `Variation.stock` 70→69 (đúng 1 đơn vị) |
| → tạo hoa hồng CTV | **PASS** | `Commission` PENDING, `amount=34.500đ` (rate 10%) |
| AcademyService — ẩn nháp/hiện sau publish | **PASS** | Course chưa `isPublished` → không có trong `listCourses`; sau `updateCourse({isPublished:true})` → xuất hiện, `lessonCount=1` |
| AcademyService.completeLesson → tiến độ | **PASS** | Sau `completeLesson` → `completedCount=1`, `isCompleted=true` |

**Dọn dẹp — đã xác nhận bằng truy vấn lại DB sau khi script chạy xong:**
- 0 user tạm còn sót (`uat-season-*`, `uat-ctv-*`, `uat-academy-*`).
- `SystemConfig` key `seasonpass.tiers` (tạo tạm vì DB dev chưa seed key này) đã bị xoá lại
  đúng như trước khi chạy (trả về `null`).
- Course/Lesson/UserLessonProgress tạm: 0 sót.
- `Variation` dùng để test (`Kem chống nắng khoáng Visante SPF50`) đã khôi phục đúng
  `stock=70`, `affiliateRate=null` như trước khi chạy.
- File `apps/api/scripts/_uat-batch2.ts` đã tự xoá (script tự `unlinkSync(__filename)`
  trong `finally`); `git status` sạch, không còn gì phải commit ngoài file runbook này.

**Ghi chú quan trọng phát hiện trong lúc viết UAT:** DB dev **chưa seed** key
`SystemConfig` `seasonpass.tiers` dù `prisma/seed.ts` đã định nghĩa nó — nghĩa là DB dev
hiện tại chưa chạy `prisma db seed` lần gần nhất sau khi thêm Season Pass, hoặc seed chạy
trước khi key này được thêm vào `seed.ts`. **Trước khi UAT thủ công Season Pass trên
Zalo thật, cần chạy `prisma db seed` (hoặc kiểm tra riêng key `seasonpass.tiers`) — nếu
không, `getState`/`claim` sẽ luôn thấy 0 bậc** (fallback rỗng trong code, xem
`apps/api/src/modules/game/season-pass.service.ts:42`).

---

## Phần 3 — Deploy backend (prod)

### 3.1 Migrate

```bash
pnpm --filter @tubutree/api exec prisma migrate status   # kiểm baseline trước
pnpm --filter @tubutree/api exec prisma migrate deploy   # áp các migration liệt kê ở Phần 1
```

**KHÔNG chạy `migrate reset`.** Nếu `migrate status` báo "database schema is not in
sync" theo cách bất thường (khác "N migrations chưa áp"), dừng lại và kiểm tra thủ công
trước khi deploy tiếp.

### 3.2 Seed (config + notification templates)

```bash
pnpm --filter @tubutree/api exec prisma db seed
```

`prisma/seed.ts` dùng `upsert` theo key/code nên **chạy lại an toàn** trên DB đã có dữ
liệu (không đè dữ liệu nghiệp vụ, chỉ upsert config/template theo key cố định). Các key
`SystemConfig` mới liên quan batch này (đã verify tồn tại trong `seed.ts`):

| Key | Giá trị mặc định | Mục đích |
|---|---|---|
| `flashsale.default_per_user_limit` | 5 | Giới hạn mua/user/item flash sale |
| `flashsale.min_discount_pct` | 0 | Mức giảm tối thiểu để tạo item flash (0 = tắt validate) |
| `remarketing.cart_abandon_min_hours` | 6 | Giỏ bỏ quên ít nhất N giờ mới nhắc |
| `remarketing.cart_abandon_max_hours` | 72 | Không nhắc giỏ cũ quá N giờ |
| `remarketing.voucher_expiry_days` | 3 | Nhắc voucher sắp hết hạn trong N ngày tới |
| `seasonpass.checkin_xp` | 10 | XP mỗi lần điểm danh |
| `seasonpass.tiers` | mảng 5 bậc (xp 30/70/120/200/300, thưởng SEEDS/XU) | Ladder Season Pass |
| `loyalty.point_expiry_reminder_days` | 7 | Nhắc trước N ngày khi điểm sắp hết hạn |
| `subscribe.discount_tiers` | `[{minActive:1,pct:0.12},{minActive:3,pct:0.14},{minActive:5,pct:0.15}]` | Chiết khấu Subscribe & Save theo bậc |
| `coins.referral_milestones` | `[{count:3,bonus:20000},{count:5,bonus:40000},{count:10,bonus:100000}]` | Mốc thưởng xu giới thiệu |
| `app.miniapp_base_url` | **KHÔNG có trong seed** (fallback `''`) | Dùng bởi Content Kit để build link share — **phải set thủ công qua Admin → System Config sau deploy**, nếu không link chia sẻ sẽ rỗng |

`NotificationTemplate` mới (channel `INAPP` — xem ghi chú quan trọng ở Phần 4):

| code | Nội dung mẫu |
|---|---|
| `CART_ABANDONED` | "🛒 Bạn còn {{item_count}} món trong giỏ (có {{product}})! ..." |
| `VOUCHER_EXPIRING` | "⏰ Voucher {{code}} của bạn sắp hết hạn ({{expires}}). ..." |
| `FLASH_STARTING` | "⚡ Giờ vàng {{product}} đã bắt đầu! ..." |
| `POINTS_EXPIRING` | "⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}. ..." |

**Lưu ý:** `prisma/seed.ts` **không seed dữ liệu nội dung** cho FAQ và Academy (không có
FAQ entry hay Course/Lesson mẫu nào trong seed) — đây là **nội dung biên tập**, admin cần
tự tạo qua trang quản trị sau deploy (Academy: tạo Course + Lesson qua admin CRUD;
FAQ: xem `apps/api/src/modules/faq/` để biết chỗ nhập).

### 3.3 Env keys cần set trên prod

| Biến | Dùng cho | Nếu thiếu |
|---|---|---|
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Chat AI (`ai-advisor` + `LlmClient`) — provider chính | `LlmClient` fallback sang Gemini; nếu cả 2 thiếu → chạy chế độ offline-graceful (trả lời tĩnh, không lỗi 500) |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL` | Chat AI — provider dự phòng | như trên |
| `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_ACCESS_TOKEN` | ZNS/OA — **đã có sẵn** trong hạ tầng hiện tại (không phải mới của batch này) | Nếu thiếu, các thông báo kênh `ZNS` (vd. `ORDER_SHIPPING`) không gửi được; kênh `INAPP` (kể cả 4 template mới batch 2) vẫn hoạt động bình thường vì không phụ thuộc ZNS |

### 3.4 Deploy FE

```bash
cd apps/miniapp && npm run deploy     # zmp deploy -M production, App ID 2070857098114207963
```

Web-admin (Next.js) deploy theo hạ tầng hiện có (xem `docs/DEPLOY-GCP.md`).

---

## Phần 4 — UAT thủ công trên Zalo thật (checklist cho user)

Chạy sau khi đã deploy + seed prod. Đánh dấu ✅ từng dòng khi verify xong.

- [ ] **Flash Sale (giờ vàng + Nhắc tôi)** — Cách kiểm: mở Home (`/`), cuộn tới section
  Flash Sale, bấm "Nhắc tôi" trên 1 item chưa mở bán → khi item vào giờ vàng, kiểm mục
  Thông báo (`/notifications`) có `FLASH_STARTING`.
- [ ] **Feed "Dành cho bạn" (home)** — Cách kiểm: đăng nhập, mở Home (`/`), cuộn tới
  section "Dành cho bạn" → có gợi ý dựa trên danh mục đã xem/mua gần đây + hàng bán chạy.
- [ ] **Point-expiry (điểm sắp hết hạn thông báo)** — Cách kiểm: cần user có điểm sắp hết
  hạn trong `loyalty.point_expiry_reminder_days` (7 ngày) tới → kiểm `/notifications` có
  `POINTS_EXPIRING`; đến đúng ngày hết hạn, kiểm điểm bị trừ đúng số đã hết hạn (không
  claw-back điểm đã tiêu).
- [ ] **FAQ + Chat AI tư vấn** — Cách kiểm: mở `/about` xem mục "Câu hỏi thường gặp"; mở
  `/ai-advisor`, hỏi 1 câu về sản phẩm → nhận trả lời từ DeepSeek/Gemini (cần key đã cắm ở
  Phần 3.3).
- [ ] **Season Pass (chặng mùa, claim free/premium)** — Cách kiểm: mở `/game`, cuộn tới
  section "Chặng Mùa" → điểm danh vài ngày để lên XP, claim thưởng bậc free; nếu có gói
  đăng ký định kỳ ACTIVE, thử claim bậc premium (thưởng TubuXu). **Nhắc: đảm bảo đã chạy
  `prisma db seed` để có key `seasonpass.tiers`, nếu không mọi bậc sẽ trống (xem Phần 2)**.
- [ ] **Content Kit CTV (copy caption + share)** — Cách kiểm: mở `/storefront`
  (storefront builder), mở content kit của 1 sản phẩm → bấm "Sao chép"/"Share Zalo" →
  kiểm link chia sẻ có domain đúng (phụ thuộc `app.miniapp_base_url` đã set — xem Phần 3.2).
- [ ] **Lên đơn hộ (tạo đơn hộ + hoa hồng)** — Cách kiểm: với tài khoản CTV (role
  AFFILIATE), mở `/affiliate`, mở sheet "Lên đơn hộ khách", nhập SP + thông tin khách
  (COD) → tạo đơn thành công, kiểm đơn có `placedForCustomer=true` và hoa hồng CTV xuất
  hiện trong dashboard `/affiliate`.
- [ ] **Academy (học + tiến độ)** — Cách kiểm: mở `/academy` → cần admin đã tạo ít nhất 1
  khoá học + publish trước (xem ghi chú Phần 3.2) → học xong 1 bài, kiểm tiến độ cập nhật.
- [ ] **Streak Repair (hồi sinh chuỗi)** — Cách kiểm: để mất chuỗi điểm danh (bỏ lỡ 1
  ngày), mở `/game`, kiểm section "Hồi sinh chuỗi vừa mất" xuất hiện trong cửa sổ 48h →
  bấm hồi sinh (cooldown 30 ngày/lần).
- [ ] **Referral milestone** — Cách kiểm: mời đủ 3/5/10 người có cashback đầu tiên →
  kiểm `/wallet` có tiến độ mốc giới thiệu + thưởng xu cộng đúng khi đạt mốc.
- [ ] **Remarketing (nhắc giỏ hàng bỏ quên / voucher sắp hết hạn)** — Cách kiểm: bỏ giỏ
  hàng 6–72 giờ không thanh toán → kiểm `/notifications` có `CART_ABANDONED`; có voucher
  cá nhân sắp hết hạn trong 3 ngày → kiểm có `VOUCHER_EXPIRING`.
- [ ] **Subscription discount + save-flow** — Cách kiểm: mở 1 sản phẩm (`/product/:slug`),
  mở sheet "Đăng ký định kỳ" (Subscribe & Save), tạo subscription → kiểm chiết khấu áp
  đúng theo số subscription đang chạy (bậc 12%/14%/15%); quản lý ở `/subscriptions`.

---

## Phần 5 — Known gaps / ops TODO

1. **CTV Lên đơn hộ chưa đẩy sang Pancake để fulfillment.** `AffiliateService.placeOrderForCustomer`
   tạo `Order` trong DB Tubu nhưng KHÔNG gọi `PancakeSyncService`/`pushOrder` — đơn hộ sẽ
   không tự động xuất hiện trong hệ thống vận đơn Pancake. Cần thêm bước đẩy đơn hoặc quy
   trình đối soát thủ công (reconciliation) trước khi feature này chạy ở quy mô lớn.
2. **Chat AI cần key DeepSeek/Gemini.** Nếu chưa cắm `DEEPSEEK_API_KEY`/`GEMINI_API_KEY`
   trên prod, `/ai-advisor` chạy chế độ offline-graceful (không lỗi nhưng trả lời tĩnh,
   không thực sự "tư vấn AI"). Ưu tiên cắm key trước khi UAT mục Chat AI.
3. **Remarketing/flash-reminder/point-expiry hiện tại CHỈ gửi kênh INAPP** (đã verify
   trong `NotificationsService.notify` + `NotificationTemplate` seed: cả 4 template mới
   — `CART_ABANDONED`/`VOUCHER_EXPIRING`/`FLASH_STARTING`/`POINTS_EXPIRING` — có
   `channel: 'INAPP'`, không phải `ZNS`). Nghĩa là **user chỉ thấy nhắc khi tự mở app**
   (mục Thông báo), KHÔNG có push chủ động ra ngoài Zalo OA. Nếu muốn nhắc chủ động
   (đẩy tin nhắn Zalo kể cả khi user không mở app) thì cần: (a) đổi channel các template
   này sang `ZNS` + gán `zaloTemplateId`, (b) đăng ký + chờ duyệt mẫu tin trên Zalo Business,
   (c) tính chi phí mỗi tin gửi (Zalo tính phí ZNS theo tin). Hạ tầng `ZnsClient`/
   `ZaloOaTokenService` đã có sẵn (dùng cho `ORDER_SHIPPING` v.v.) — chỉ cần đăng ký thêm
   mẫu mới nếu quyết định làm.
4. **Point-expiry FIFO — edge case idempotency đã biết** (xem chi tiết trong code/spec
   `apps/api/src/modules/loyalty/loyalty-expiry.service.ts` +
   `points-reconcile.spec.ts`): cron chạy trùng lặp trong cùng ngày được guard, nhưng nếu
   cron bị trễ nhiều ngày liên tiếp (downtime dài), cần verify lại tổng điểm hết hạn được
   cộng dồn đúng theo từng đợt phát sinh, không bị double-count hay bỏ sót — nên theo dõi
   log cron `LoyaltyExpiryService` sau lần chạy đầu trên prod.
5. **Season Pass cần `prisma db seed` chạy đúng trước UAT** — xem ghi chú Phần 2 (key
   `seasonpass.tiers` chưa có sẵn trên DB dev khi viết runbook này; đảm bảo seed đã chạy
   trên prod trước khi test claim bậc).
6. **FAQ + Academy không có nội dung mẫu** — cả hai đều rỗng ngay sau
   `migrate deploy` + `db seed` (seed chỉ tạo config/template, không tạo nội dung biên
   tập). Admin cần nhập nội dung trước khi UAT các mục này có ý nghĩa.
7. **`app.miniapp_base_url` không nằm trong seed** — Content Kit sẽ sinh link rỗng cho
   tới khi admin set key này thủ công qua System Config (Phần 3.2).

---

## Tóm tắt trạng thái

- **Gate cuối:** DONE — test 1040/1040, typecheck + build 3 package đều xanh, migrate
  status khớp.
- **UAT tự động (dev DB):** DONE — 7/7 bước PASS, dọn dẹp sạch, script tạm đã xoá.
- **UAT thủ công trên Zalo thật:** CHƯA CHẠY — cần user theo checklist Phần 4 sau khi
  deploy prod.
