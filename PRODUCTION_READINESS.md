# 🚦 PRODUCTION READINESS — Tubu Tree

> Audit toàn diện ngày **2026-06-22**, mục tiêu go-live **2026-06-30** (còn ~8 ngày).
> Phương pháp: 9 dimension finders (money-path, auth-security, data-concurrency, api-logic, miniapp-fe, web-fe, performance, prod-config, tests-quality) quét code thật → verify đối kháng. Tổng **83 phát hiện**; phần dưới chỉ giữ các finding đã xác minh bằng `file:line` + trích code.

---

## 1. Đánh giá tổng thể — trả lời thẳng câu hỏi

**"Các chức năng đã chạy ổn định và không bị bug chưa?"**
→ **Lõi vững, nhưng CHƯA thể nói "không bug".** Phần nền tảng được làm rất tốt:
- Trừ ví/điểm dùng `updateMany` + điều kiện `gte` (atomic, chống âm/TOCTOU).
- Đặt đơn có idempotency key (`Order.idempotencyKey @unique`).
- Refresh token hash SHA-256 + xoay vòng atomic; guard JWT/RBAC global; **không tìm thấy IDOR**; `$queryRaw` đều tham số hoá (an toàn injection).
- 21 migration đều additive (không có lệnh phá dữ liệu). 35 spec backend phủ tốt money-path tuần tự.

Nhưng còn **~15 lỗ hổng thật** ở rìa hệ thống — webhook, các luồng game race, edge-case hoàn tiền, oversell, và ops/config — trong đó **2 vấn đề tiền/bảo mật mức critical/high** có thể bị khai thác. **Mức sẵn sàng go-live (COD/Ví): ~75%.** Đủ để demo COD có kiểm soát, **chưa đủ** để nhận traffic thật + tiền thật nếu không xử lý nhóm 🔴.

**"Code đã optimize nhất chưa?"**
→ **Chưa, nhưng không tệ.** Phân trang chuẩn, code-split route, ảnh lazy, SystemConfig cache 60s. Thiếu các tối ưu ROI cao: **không có GIN index** cho lọc category/segment (seq scan), **không cache catalog nóng** (`/products`, `/brands` query DB mỗi request), React Query **thiếu `staleTime`** (refetch mỗi lần điều hướng), N+1 trong `getAvailableCoupons`. Với lưu lượng nhỏ lúc mở bán thì chịu được, nhưng nên xử lý 3 cái đầu trước khi mở rộng.

---

## 2. 🔴 BLOCKER — phải xử lý trước go-live

### Nhóm A — Bảo mật khai thác được (ưu tiên cao nhất, effort thấp)

| # | Vấn đề | File | Sửa | Effort |
|---|--------|------|-----|--------|
| A1 | **Webhook Accesstrade fail-open khi secret rỗng** → giả postback tự nạp cashback (settle thành tiền rút được). `if (this.webhookSecret && !match)` — secret rỗng thì bỏ qua xác thực. | `cashback/cashback.controller.ts:50` | Fail-closed ở prod: `NODE_ENV==='production'` mà secret rỗng → 401. Bắt buộc secret qua `zod superRefine`. | S |
| A2 | **Webhook Pancake fail-open** tương tự → giả sự kiện đổi trạng thái đơn. | `integrations/pancake/pancake-webhook.controller.ts:53` | Như A1. | S |
| A3 | **Secret Pancake webhook thật bị commit** vào repo (git-tracked). | `.env.production.example:35` | **Rotate** secret trên Pancake, đổi dòng này thành rỗng, cân nhắc purge git history. | Trivial |
| A4 | **Coupon USER_GROUP không kiểm chủ sở hữu** → voucher cá nhân (code đoán được như `WELCOME-<userId>`, voucher 50k giới thiệu) bị user khác dùng. `validateAndCompute` không đọc `scope`/`scopeMeta`. | `coupons/coupons.service.ts:18` | Trong validate: nếu `scope==='USER_GROUP'` thì check `scopeMeta.userId===userId`; `TIER` thì check tier. | S |
| A5 | **Không có rate-limit ở bất kỳ đâu** (auth, `/auth/guest`, checkout, webhook). `@nestjs/throttler` chưa cài (đã verify = 0). | `apps/api/src/main.ts` | Thêm `@nestjs/throttler` global + siết chặt `/auth/*`, `/checkout/*`. | M |
| A6 | **Swagger phơi công khai ở prod + CORS wildcard** (`cors:true`). | `apps/api/src/main.ts:9,21` | Gate Swagger `if (NODE_ENV!=='production')`; CORS allowlist từ env. | S |

### Nhóm B — Money-path bug (mất tiền/sai số dư)

| # | Vấn đề | File | Sửa | Effort |
|---|--------|------|-----|--------|
| B1 | **Hoàn ví khi hủy đơn nằm ngoài transaction đổi-status** → nếu crash giữa chừng, đơn đã CANCELLED nhưng ví KHÔNG hoàn, retry bị guard chặn → **mất tiền vĩnh viễn**. | `orders/orders.service.ts:52` | Gói flip-status + hoàn ví + reverse điểm vào CÙNG `$transaction`. | M |
| B2 | **Hủy đơn CONFIRMED chưa giao → trừ `pointsEarned` chưa từng được cộng** (điểm chỉ cộng khi DELIVERED) → điểm âm/mất. | `loyalty/loyalty.service.ts:73` | Chỉ decrement `pointsEarned` khi tồn tại transaction `ORDER_DELIVERED:{code}` (đã credit). | S |
| B3 | **Duyệt đổi/trả luôn hoàn `order.total` vào ví bất kể phương thức** (COD `UNPAID` cũng được hoàn) **+ guard không atomic** → 2 admin duyệt đồng thời = hoàn 2 lần. | `admin/admin.service.ts:43` | Phân biệt theo `paymentMethod/paymentStatus`; đổi guard sang `updateMany where status='REQUESTED'`, chỉ hoàn khi `count===1`, trong transaction. | M |
| B4 | **Coupon redemption ngoài transaction + thiếu unique** → vượt `usageLimit/perUserLimit` khi đặt đồng thời (gồm voucher 50k). | `coupons/coupons.service.ts:63` + `schema.prisma:369` | Thêm `@@unique([couponId,orderId])`, ghi redemption TRONG transaction đơn, bắt P2002. | M |
| B5 | **Đặt đơn không kiểm/giảm tồn kho** → oversell (nguy hiểm với flash-sale/hàng giới hạn). `grep stock checkout.service.ts` = rỗng. | `checkout/checkout.service.ts:81` | Trong transaction: `updateMany({where:{id,stock:{gte:qty}},data:{stock:{decrement:qty}}})`, throw nếu count=0; cộng lại khi hủy. | M |

### Nhóm C — Crash & go-live config

| # | Vấn đề | File | Sửa | Effort |
|---|--------|------|-----|--------|
| C1 | **Quiz answer 500** cho user chưa có `gameProfile` (`update` ném P2025) + **không có global Prisma exception filter**. | `game/game-quiz.service.ts:54` | Thêm `ensureProfile`/`upsert` ở `answerQuiz`; đăng ký global filter map P2025→404, P2002→409. | S |
| C2 | **Không có backup DB tự động** — dữ liệu chỉ trên 1 volume/1 VM (mất VM = mất toàn bộ đơn). | `docs/DEPLOY-GCP.md:92` (chỉ thủ công) | Cron `pg_dump` hằng ngày → GCS/R2 + verify restore 1 lần. | M |
| C3 | **Deploy không gate test, không backup-before-migrate, không rollback**; CI không chặn deploy. Migration chạy trong CMD container — migration lỗi = API không lên. | `.github/workflows/deploy.yml:29` | Gate deploy theo CI xanh; `pg_dump` trước `up --build`; giữ image cũ để rollback. | M |
| C4 | **API/Web thiếu healthcheck** trong compose → caddy 502 lúc khởi động, không phát hiện app treo. (đã có `/api/health`.) | `docker-compose.prod.yml:39` | Thêm healthcheck dùng `/api/health` + `depends_on: condition: service_healthy`. | S |
| C5 | **Web checkout hardcode mã vùng `'00'`** → đơn đẩy Pancake sai vùng, hỏng giao vận. | `web/.../thanh-toan/page.tsx:190` | Bộ chọn Tỉnh/Huyện/Xã qua `/geo`; tối thiểu chặn đặt đơn nếu chưa có mã hợp lệ. *(Bỏ qua nếu Web KHÔNG nằm trong launch 30/06.)* | M |

---

## 3. 🟡 Nên sửa nếu kịp (medium)

- **Game race (tap nhanh = farm phần thưởng thật):** `waterTree` lost-update trên `totalSeeds` (cấp coupon/cây nhiều lần) — `game/game.service.ts:117`; quiz thiếu `@@unique` → double water; spin/gift cộng seed read-modify-write. Sửa: trừ/cộng seed atomic + unique `(userId,quizId,ngày)`.
- **Double-credit khi webhook đa-instance:** `creditOrderPoints` & `createCommissionForOrder` dùng check-then-act, `points_transactions`/`commissions` thiếu unique. Thêm unique + transition status atomic (`onStatusUpdated`). An toàn ở 1 instance, rủi ro khi scale.
- **FE dashboard tài chính không có error state** (affiliate/cashback) → lỗi 5xx hiện "0đ" âm thầm, CTV tưởng mất tiền. `affiliate.tsx:140`, `cashback.tsx:28`.
- **Checkout double-submit:** nút Đặt hàng không disable trong lúc `await ensurePhone()` — `checkout.tsx:359` (backend chống bằng idempotency, nhưng UX hỏng).
- **Cập nhật giỏ không debounce** — mỗi tap +/- = 1 PATCH đua nhau (`cart.tsx:172`).
- **Đơn Subscribe&Save / Đại lý không push Pancake** → không vào pipeline giao hàng (`subscriptions.service.ts:169`, `dealer.service.ts:122`). Xác nhận có chủ đích hay thiếu.
- **Web thiếu `error.tsx`/`not-found.tsx`/`metadataBase`**, auth không có trạng thái `unauthenticated` (trang gated nhấp nháy "vui lòng đăng nhập").

## 4. 🟢 Sau go-live (low / nice-to-have)

- `recalcTier` tính chi tiêu gồm cả phí ship (`loyalty.service.ts:117`) — xác nhận với spec.
- `JwtStrategy.validate` không tra DB (user bị khoá vẫn dùng token tới 15m hết hạn).
- Hard-code chuỗi lọt ngoài `i18n/vi.ts` ở affiliate/dealer/cashback/checkout-VAT.
- `bankInfo` nhận object tự do không validate cấu trúc.
- Caddy thiếu security headers (HSTS, X-Content-Type-Options).
- Browse miniapp thiếu load-more (chỉ 30 item, bỏ qua `meta.total`).

## 5. ⚡ Tối ưu code (theo ROI)

| Ưu tiên | Tối ưu | File |
|---------|--------|------|
| Cao | **GIN index** cho `categoryIds`/`forSegment`/`tags` (đang seq scan toàn bảng products) | migration mới · `schema.prisma:138` |
| Cao | **Cache catalog nóng** `/products`,`/brands` (in-memory TTL 60-300s như SystemConfig, hoặc `Cache-Control`) | `catalog/catalog.controller.ts` |
| Cao | **`staleTime: 60_000`** mặc định cho React Query (catalog refetch mỗi điều hướng) | `miniapp/.../app.tsx:53` |
| Trung | **N+1 `getAvailableCoupons`** — đổi `count` từng coupon → 1 `groupBy`; lọc scope ở DB | `loyalty/loyalty.service.ts:193` |
| Thấp | Over-fetch list/detail (`select` thay `include`, bỏ `reviews` khỏi `getBySlug`); N+1 trong `pancake-sync`/`repurchase`; `manualChunks` Vite | nhiều |

## 6. 🧪 Khoảng trống test (rủi ro hồi quy)

- **Miniapp & Web: 0 test, không có test runner.** Ưu tiên thêm Vitest + test 5 luồng critical: store/auth (refresh dedup, guest fallback), cart recompute + rollback, checkout (idempotency ổn định, wallet<total→COD, invoiceValid), affiliate withdraw valid, wallet canWithdraw.
- **Guard RBAC/Auth chưa có test nào** (`roles.guard.ts`, `jwt-auth.guard.ts`) — regression = lộ endpoint admin.
- **E2E chỉ phủ happy-path COD.** Thêm: COD>5tr→400, WALLET thiếu số dư→400, coupon hết hạn/hết lượt→400, place→cancel→hoàn ví/điểm, thêm giỏ vượt stock→400.
- **2 bug money-path mới (B2, B5) chưa có test** — thêm spec hồi quy khi sửa.
- Cân nhắc 1-2 integration test trên Postgres thật cho luồng đồng thời (2 placeOrder WALLET song song → đúng 1 thành công).

## 7. 👤 Việc ngoài-code (cần con người)

- [ ] **Rotate `PANCAKE_WEBHOOK_SECRET`** (đã lộ) + điền secret thật vào `.env` prod (không phải `.example`).
- [ ] **`zmp login` + `zmp deploy`** đẩy Mini App lên Zalo (bundle đã sẵn — xem `DEPLOY_ZALO.md`).
- [ ] Điền `VITE_ZALO_OA_ID` (nút hỗ trợ OA đang tắt) và `NEXT_PUBLIC_ZALO_APP_ID` (thiếu trong `.env.example` → web không đăng nhập được nếu quên).
- [ ] Quyết định: launch 30/06 chỉ **COD/Ví** (chấp nhận thiếu key ZaloPay/Accesstrade/ZNS — app đã degrade an toàn) hay chờ key thật.
- [ ] Chọn đích backup DB (GCS bucket) + xác minh restore.

---

## 8. 📅 KẾ HOẠCH 8 NGÀY (22 → 30/06)

> Solo dev. Thứ tự đặt theo: bảo mật khai thác được → bug mất tiền → ops → UX/perf → test → deploy.

**Ngày 1 (22/06) — Bảo mật khai thác được (effort thấp, chặn lỗ hổng tiền):**
A1, A2 fail-closed webhook · A3 rotate + blank secret · A4 coupon ownership · A6 Swagger gate + CORS allowlist. → Đa số là sửa nhỏ, có thể xong trong ngày.

**Ngày 2 (23/06) — Rate-limit + crash:**
A5 `@nestjs/throttler` global + siết auth/checkout · C1 quiz `ensureProfile` + global Prisma exception filter. Thêm spec cho coupon ownership + quiz.

**Ngày 3 (24/06) — Money-path transaction (phần 1):**
B1 hủy đơn atomic (flip+hoàn ví+reverse điểm 1 transaction) · B2 reverseOrderPoints chỉ trừ điểm đã credit. + spec hồi quy.

**Ngày 4 (25/06) — Money-path transaction (phần 2):**
B3 return refund theo paymentMethod + atomic guard · B4 coupon redemption in-transaction + `@@unique` + migration. + spec.

**Ngày 5 (26/06) — Tồn kho + Ops:**
B5 trừ stock atomic + hoàn khi hủy + spec oversell · C4 healthcheck compose · C2 cron `pg_dump` → GCS · C3 gate deploy theo CI + backup-before-migrate.

**Ngày 6 (27/06) — Web + FE error states:**
C5 web region picker `/geo` (nếu web trong scope) · FE error state affiliate/cashback dashboard · checkout double-submit disable · web `error.tsx`/`not-found.tsx` + auth `loading`.

**Ngày 7 (28/06) — Perf ROI cao + test lưới an toàn:**
GIN index migration · cache catalog · `staleTime` React Query · `groupBy` getAvailableCoupons · roles.guard test · Vitest miniapp 5 luồng critical · E2E thêm 5 kịch bản lỗi.

**Ngày 8 (29/06) — Deploy & verify:**
Điền env (OA_ID, ZALO_APP_ID, webhook secret thật) · `zmp deploy` · smoke test trên Zalo + prod · chạy E2E đầy đủ · verify backup restore một lần · rà lại checklist DoD.

**30/06 — Go-live + giám sát** (theo dõi log, health, đơn đầu tiên end-to-end).

> Nếu thời gian gấp: tối thiểu **Ngày 1-5** (Nhóm A + B + C2/C3/C4) là điều kiện cần để lên prod an toàn với tiền thật. Web (C5) và perf/test (Ngày 6-7) có thể giãn sang tuần đầu sau launch nếu launch chỉ Mini App + COD.

### ✅ Definition of Done cho go-live
1. Mọi webhook fail-closed ở prod; secret đã rotate; không secret trong repo.
2. Mọi đường tiền (hủy/hoàn/coupon/stock) atomic, có test race `count=0`.
3. Rate-limit bật ở auth/checkout/webhook.
4. Backup DB tự động chạy + đã verify restore.
5. Deploy gate theo CI; có đường rollback.
6. Healthcheck xanh; `/api/health` + web 200 sau deploy.
7. Mini App `zmp deploy` xong, đi hết luồng COD trên Zalo thật: chọn SP → giỏ → checkout → đơn `CONFIRMED` → hủy → hoàn ví đúng.
8. E2E phủ cả nhánh lỗi (quá hạn mức COD, coupon hết hạn, hết hàng).
