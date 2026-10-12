# A2 — Rà soát Dữ liệu và Kiến trúc (Data + Architecture)

- **Ngày:** 2026-10-09
- **Commit:** `080bc75` (nhánh `hardening/2026-10`)
- **Phạm vi:** `apps/api/prisma/schema.prisma` (2.350 dòng, 108 model), 103 migration, `apps/api/src` (NestJS), các chỗ ghi tiền, tồn kho, coupon, flash sale, ví/TubuXu/điểm, hoa hồng, công nợ và backorder đại lý; `packages/shared-types` so với DTO của API và type phía FE.
- **Phương pháp:** đọc toàn bộ schema và grep đối chiếu từng model với mã đọc/ghi. Kiểm drift bằng `prisma migrate diff` trên DB tạm (đã xoá). Truy vấn `pg_constraint`/`pg_indexes` trên DB local `tubutree` (chỉ SELECT). Dò vòng phụ thuộc bằng script Tarjan tự viết, chạy offline vì máy không có madge. Dựng ví dụ tối thiểu bằng psql trên DB tạm `tubutree_a2_probe` (đã xoá) để kiểm hành vi Postgres. Đo byte/dòng trên DB `tubutree_perf` mà agent load-test đã seed (chỉ SELECT kích thước).
- **Giới hạn:** không đụng PROD. Không chạy test suite và không chạy load test (đó là việc của agent khác). Không đo được tốc độ tăng dữ liệu thật trên PROD; mọi ước lượng tăng trưởng đều dựa trên **giả định ghi rõ**. DB local chỉ có 13 user và 3 đơn nên không đại diện cho dữ liệu thật. Hành vi của Pancake (tự trừ tồn hay không, có trả `remain_quantity` âm hay không) **chưa kiểm chứng**.

---

## Tóm tắt điều hành

Nhìn chung, schema đã được gia cố tốt. Tiền đều lưu bằng `Int`/`Decimal`, không có `Float`. Tồn kho, ví, điểm, xu, coupon và flash sale đều trừ bằng câu UPDATE có điều kiện nguyên tử. Có 13 partial unique index đóng vai trò khoá idempotency. Schema khớp migration (không drift). Không có vòng import ở mức file.

Rủi ro còn lại tập trung ở **các mối nối giữa module** và **sổ sách tiền**, gồm 5 lỗi P1:

1. Gộp tài khoản khách sang Zalo lúc bấm "Đặt hàng" có thể **hỏng vĩnh viễn**. Code bắt lỗi P2002 bên trong một transaction Postgres đã bị abort.
2. Đơn đại lý còn hàng đặt trước (backorder) bị cron đối soát **đẩy sang Pancake sau 15 phút**, trái thiết kế.
3. **Xoá một địa chỉ thì gói giao định kỳ dùng địa chỉ đó cũng bị xoá theo** (FK CASCADE).
4. **Ví Tubu là tiền thật rút được nhưng không có sổ cái**: 8 chỗ ghi số dư, không có lịch sử nào để đối soát.
5. **Hoa hồng CTV được tạo ngoài transaction của đơn**: lỗi bị nuốt, không có unique, không có cron bù.

Ngoài ra có 12 phát hiện P2, gồm bảng log phình không có TTL, thiếu index, Int 32-bit cho cột doanh số tích luỹ, webhook Pancake không dedupe, cron không đặt TZ, logic trùng và thiếu race test cho các đường tiền chính.

**Không có P0 mới.**

## Bảng tổng hợp

| ID | Mức | Tiêu đề | Nhóm file | Trạng thái |
|---|---|---|---|---|
| A2-001 | P1 | Gộp khách→Zalo: "bỏ qua bảng khi P2002" làm hỏng cả transaction, chặn đặt hàng vĩnh viễn | `modules/auth` | MỚI |
| A2-002 | P1 | Đơn đại lý backorder bị `PancakePushReconcileService` đẩy sang Pancake trước khi đủ hàng | `integrations/pancake` (+`dealer`) | MỚI |
| A2-003 | P1 | Xoá địa chỉ thì gói định kỳ bị xoá theo (`subscriptions.addressId ON DELETE CASCADE`) | `prisma`, `users`, `subscriptions` | MỚI |
| A2-004 | P1 | Ví Tubu (`walletBalance`, tiền thật) không có sổ cái, không có lịch sử, không đối soát được | `wallet`,`affiliate`,`cashback`,`orders`,`checkout`,`auth`,`prisma` | MỚI |
| A2-005 | P1 | Hoa hồng CTV tạo ngoài transaction, nuốt lỗi, không unique, không cron bù | `affiliate`,`checkout`,`prisma` | MỚI |
| A2-006 | P2 | Mẫu "bắt P2002 rồi đi tiếp" bên trong interactive transaction (bẫy chờ nổ) | `wallet/coins`,`coupons` | MỚI |
| A2-007 | P2 | Bảng log/sự kiện phình, không dọn/TTL; ingest analytics gần như không giới hạn | `auth`,`notifications`,`analytics`,`integrations/*` | Một phần CÒN MỞ từ A7-18 |
| A2-008 | P2 | Thiếu index cho truy vấn cron và inbox thực dùng | `prisma` | MỚI (+ A7-09 CÒN MỞ) |
| A2-009 | P2 | Int 32-bit cho cột doanh số/ngưỡng tích luỹ: ngưỡng từ 2,15 tỷ đ trở lên gây lỗi 500 | `prisma`,`brand/dto`,`dealer` | MỚI |
| A2-010 | P2 | `PancakeWebhookEvent` không dedupe, không index, không có cron cứu sự kiện FAILED | `integrations/pancake`,`prisma` | MỚI |
| A2-011 | P2 | Tạo gói định kỳ không chống trùng: double-tap ra 2 gói, mỗi kỳ 2 đơn COD | `subscriptions`,`prisma` | MỚI |
| A2-012 | P2 | Cron: 27/28 không đặt timeZone, container không đặt TZ, mốc "đầu ngày" lệch giữa các module, không có khoá phân tán | mọi module có `@Cron`, `docker-compose.*` | CÒN MỞ từ audit-2026-09/00 (câu hỏi TZ, báo cáo 03) + MỚI |
| A2-013 | P2 | Logic trùng: sinh mã đơn ×4, maskName ×4, báo admin ×3, chuẩn hoá SĐT ×3, dayKey VN ×7 | `common` + nhiều module | CÒN MỞ từ nightly 306be08a52, 335ab97e91, cc574bbfcb (mở rộng) |
| A2-014 | P2 | 5 service trên 800 dòng ôm nhiều trách nhiệm | `dealer`,`loyalty`,`affiliate`,`feed`,`integrations/gomdon` | MỚI |
| A2-015 | P2 | Thiếu race test trên Postgres thật cho checkout oversell, coupon, flash, ví/xu, groupbuy, backorder và subscription | `apps/api/test/integration-race` | MỚI |
| A2-016 | P2 | Shared types gần như không được dùng; API trả thẳng entity Prisma (lộ cột nội bộ) | `packages/shared-types`, controllers, `web/lib`, `miniapp/services` | MỚI |
| A2-017 | P2 | Toàn vẹn dựa vào code: hơn 80 cột `*Id` không có FK (kể cả bảng tiền); gộp khách bỏ sót bảng giới hạn lượt | `prisma`,`auth` | MỚI |
| A2-018 | P3 | Bảng/cột chết hoặc chỉ ghi không đọc | `prisma`,`analytics`,`beta`,`affiliate` | MỚI (+ A7-24 CÒN MỞ) |
| A2-019 | P3 | Trùng khái niệm: 2 sổ điểm/xu, 2 hệ điểm danh, lô vườn 2 dạng lưu, cờ "đã nhắc" rải 6 nơi | `loyalty`,`wallet`,`game`,`lifecycle` | Một phần CÒN MỞ từ A3-19/H3.4 |
| A2-020 | P3 | Trạng thái kiểu `String` thay vì enum | `prisma` | MỚI |
| A2-021 | P3 | Vòng phụ thuộc mức thư mục (12 module); DealerService lấy qua ModuleRef, lỗi wiring chỉ log | `orders`,`integrations/pancake`,`integrations/gomdon`,`dealer` | MỚI |
| A2-022 | P3 | 13 partial unique index (chốt tiền) Prisma không thấy; `db push` sẽ làm mất chúng | `prisma`, CI | MỚI |
| A2-023 | P3 | Tồn kho âm có thể lọt qua `forcePancakeStock`/create, làm `reserveAvailable` trả số âm | `catalog/variation-stock`,`integrations/pancake` | MỚI (chưa kiểm chứng Pancake) |
| A2-024 | P3 | `Review @@unique([userId, productId])` chặn đánh giá lại khi mua lại | `prisma`,`reviews` | MỚI (quyết định nghiệp vụ) |
| A2-025 | P3 | Flash sale: lần mua đầu đồng thời của cùng user nhận thông báo `PRICE_CHANGED` sai nghĩa | `flash-sale`,`checkout` | MỚI |

**Đếm:** P0 = 0 · P1 = 5 · P2 = 12 · P3 = 8.

---

## 1. Kiểm drift schema và migration (lệnh + output thật)

```
$ docker exec tubu_pg psql -U tubu -d postgres -c "CREATE DATABASE tubutree_shadow_a2;"   → CREATE DATABASE
$ cd apps/api && npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
$ npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url postgresql://tubu:***@localhost:5434/tubutree_shadow_a2 --exit-code
No difference detected.            (exit code 0)
$ npx prisma migrate status        → 103 migrations found … Database schema is up to date!
$ docker exec tubu_pg psql -U tubu -d postgres -c "DROP DATABASE tubutree_shadow_a2;"     → DROP DATABASE
```

- **Không có drift.** Schema khớp chuỗi 103 migration, và DB local `tubutree` đã áp đủ 103 migration. Prisma 5.22.0.
- **12 migration chưa lên PROD** (`git diff --name-only 22e36d4 HEAD -- apps/api/prisma/migrations`), từ `20260918190013_storefront_last_reminder_at` đến `20260927230000_tier_birthday_voucher_amount`. Tất cả đều chỉ **thêm mới**. Không có `DROP COLUMN` hay `SET NOT NULL`. Duy nhất một `DROP INDEX "mission_progress_userId_idx"` (thay bằng unique bao trùm). Có 2 `UPDATE` back-fill toàn bảng (`orders.deliveredAt`, `commissions`): nhanh ở quy mô hiện tại.
  - Lưu ý: `mission_progress_userId_missionId_cycleKey_key` sẽ fail nếu PROD có dòng trùng. Theo comment A1-02, bảng này chưa từng được ghi nên nhiều khả năng rỗng. **Chưa kiểm chứng PROD.**
- Xem A2-022: `migrate diff` "No difference" **dù 13 partial unique index không hề khai báo trong schema**, vì Prisma 5 bỏ qua index có `WHERE`.

---

## 2. Phát hiện chi tiết

### A2-001 · P1 · Gộp khách→Zalo: "bỏ qua bảng khi P2002" làm hỏng cả transaction, chặn đặt hàng vĩnh viễn
- **Bằng chứng:**
  - `apps/api/src/modules/auth/auth.service.ts:296-315`: bên trong `this.prisma.$transaction(async (tx) => …)` (mở ở dòng 245), mỗi `tx.pointsTransaction.updateMany`, `tx.coinTransaction.updateMany`, `cashbackClick`, `cashbackTransaction` được bọc `try { … } catch (err) { if (!this.isUniqueViolation(err)) throw err; }` rồi chạy tiếp.
  - Hàm này được gọi từ `ensurePhone` lúc khách bấm Đặt hàng (`auth.service.ts:194-202`).
  - Chạm được trên thực tế qua partial unique `points_transactions_checkin_day_key ("userId","refId") WHERE refType='CHECKIN'` (migration `20260926120000_loyalty_checkin_pos`) nếu tài khoản khách và tài khoản Zalo **cùng điểm danh một ngày VN**. Tương tự với `coin_transactions_quest_unique ("userId", reason) WHERE refType='QUEST'`.
  - Postgres **abort cả transaction** sau lỗi đầu tiên. Đã dựng lại trên DB tạm:
    ```
    BEGIN;
    UPDATE points_transactions SET "userId"='target' WHERE "userId"='guest';
    ERROR:  duplicate key value violates unique constraint "points_transactions_checkin_day_key"
    UPDATE coin_transactions SET "userId"='target' WHERE "userId"='guest';
    ERROR:  current transaction is aborted, commands ignored until end of transaction block
    COMMIT;  → ROLLBACK
    ```
  - Lỗi thứ hai (25P02) không phải P2002, nên `mergeGuestInto` ném lỗi và toàn bộ lần gộp bị rollback.
  - Unit test `auth.service.spec.ts:545` ("đụng ràng buộc unique … bỏ qua BẢNG đó") dùng **fake Prisma**, nên xác nhận một hành vi mà Postgres thật không có.
- **Tác động:** hai dòng CHECKIN trùng ngày nằm lại vĩnh viễn, nên **mọi lần gộp sau đều lỗi theo cùng cách**. Khách vãng lai trên thiết bị đó không đặt hàng được qua `ensurePhone` cho tới khi có người sửa dữ liệu tay. Đây đúng là nhóm khách đang được vá ở A7-01.
- **Đề xuất sửa:** không dựa vào lỗi để bỏ qua. Lọc trước các dòng xung đột, ví dụ chuyển các dòng không trùng bằng `updateMany` có điều kiện `NOT (refType='CHECKIN' AND refId IN <dayKey của target>)`. Các dòng trùng thì đổi `refId` thành `MERGED:<guestId>:<dayKey>` để giữ lịch sử. Nếu cần chiến lược "thử rồi bỏ qua" thì dùng `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` bằng `tx.$executeRaw`. Gộp luôn `loyalty_check_ins`, `coupon_redemptions`, `flash_sale_purchases` (xem A2-017). Thêm race-spec trên Postgres thật.
- **Lệnh kiểm chứng:** race-spec mới trong `apps/api/test/integration-race`: tạo guest và target, cả hai có `points_transactions(refType='CHECKIN', refId=<cùng ngày>)`. Gọi `ensurePhone` phải trả token của target, và số dư `points/coins/wallet` phải được cộng đúng. Chạy `cd apps/api && DATABASE_URL=…/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand -t merge`.
- **Công sức:** M · **Model:** opus (tiền + định danh) · **Nhóm file:** `apps/api/src/modules/auth` · **Trạng thái:** MỚI.

### A2-002 · P1 · Đơn đại lý còn backorder bị cron đối soát đẩy sang Pancake trước khi đủ hàng
- **Bằng chứng:**
  - Thiết kế nói rõ đơn còn backorder **không** được đẩy Pancake: `dealer.service.ts:267-272` và `docs/2026-09-12-deploy-runbook.md:85` ("Đơn còn backorder chưa được đẩy sang Pancake").
  - Nhưng `integrations/pancake/pancake-push-reconcile.service.ts:47-52` quét **mọi** đơn có `pancakeOrderId: null`, `status ≠ CANCELLED`, `createdAt < now-15'` rồi `enqueuePush`, **không lọc** `items.backorderedQty > 0`.
  - `pancake-order.service.ts:79-84` (`pushOrder`) cũng không chặn.
  - `grep -rn backorder src/modules/integrations/pancake/*.ts` → 0 kết quả.
- **Tác động:**
  - **Chắc chắn:** 15 phút sau khi đặt, kho vật lý nhận một đơn đại lý chưa có hàng để soạn. Sau đó `DealerBackorderService` thấy đơn đã có `pancakeOrderId` nên không đẩy lại; cơ chế "đủ hàng mới đẩy" bị vô hiệu.
  - **Có thể (chưa kiểm chứng, tuỳ Pancake có tự trừ `remain_quantity` cho phần thiếu hay không):** `applyPancakeStock` nhả `reservedStock` theo mức giảm của Pancake, rồi cron backorder lại giữ kho thêm một lần cho cùng nhu cầu. Kết quả là tồn kho local lệch so với Pancake.
- **Đề xuất sửa:** trong reconcile thêm điều kiện `items: { none: { backorderedQty: { gt: 0 } } }`. Trong `pushOrder` từ chối khi còn dòng `backorderedQty > 0`, trừ khi admin ép đẩy. Unit test cho cả hai.
- **Lệnh kiểm chứng:** `grep -n "backorderedQty" apps/api/src/modules/integrations/pancake/pancake-push-reconcile.service.ts` phải có kết quả. Spec mới: đơn DEALER có item `backorderedQty=3`, `createdAt` cách đây 20 phút; chạy `reconcile()` thì `enqueuePush` không được gọi.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `modules/integrations/pancake` (+ test `modules/dealer`) · **Trạng thái:** MỚI.

### A2-003 · P1 · Xoá địa chỉ thì gói giao định kỳ bị xoá theo
- **Bằng chứng:**
  - `schema.prisma:2159-2160` khai báo `address Address @relation(..., onDelete: Cascade)` trên `Subscription`.
  - Trên DB thật: `pg_constraint` → `subscriptions|subscriptions_addressId_fkey|addresses|c` (c = CASCADE).
  - `users.service.ts:110-114`: `deleteAddress` chỉ kiểm chủ sở hữu rồi `address.delete`.
  - Miniapp có nút xoá ở `pages/addresses.tsx`, gọi `account-api.ts:321-322`.
- **Tác động:** khách xoá một địa chỉ cũ thì gói Subscribe & Save đang ACTIVE/PAUSED **bị xoá cứng**, không thông báo, không khôi phục được. Đây là mất dữ liệu ở một tính năng giữ chân, và không còn đơn định kỳ nào được tạo. Chấm P1 vì không mất tiền; chủ dự án có thể nâng P0 vì tính chất "mất dữ liệu".
- **Đề xuất sửa:** đổi FK sang `onDelete: Restrict` (migration). Trong `deleteAddress`, nếu còn gói ACTIVE/PAUSED thì trả lỗi tiếng Việt kèm danh sách gói. Hoặc theo quyết định ở mục 8 câu 2: chuyển gói sang PAUSED và gửi thông báo. Rà thêm `subscriptions.variationId` (cũng CASCADE).
- **Lệnh kiểm chứng:** `docker exec tubu_pg psql -U tubu -d tubutree -At -c "select confdeltype from pg_constraint where conname='subscriptions_addressId_fkey'"` phải ra `r` (Restrict) sau khi sửa. Thêm unit/e2e cho trường hợp xoá địa chỉ đang gắn gói.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `apps/api/prisma`, `modules/users`, `modules/subscriptions` · **Trạng thái:** MỚI.

### A2-004 · P1 · Ví Tubu (tiền thật rút được) không có sổ cái
- **Bằng chứng:**
  - `schema.prisma:232` có `walletBalance Int`, nhưng **không có model nào** ghi giao dịch ví (so sánh với `PointsTransaction` ở `:904` và `CoinTransaction` ở `:989`).
  - Có 8 chỗ ghi số dư: `affiliate.service.ts:678` (rút hoa hồng về ví), `:1100` (từ chối payout thì hoàn ví), `cashback.service.ts:356` (settle cashback), `orders/order-reversal.service.ts:122` (hoàn đơn), `checkout.service.ts:321` (trả bằng ví), `wallet.service.ts:93` (đổi sang xu), `:177` (rút ngân hàng), `auth.service.ts:325` (gộp khách).
  - API chỉ có `GET me/wallet` và `GET me/coins` (`wallet.controller.ts:30,54`); không có endpoint lịch sử ví. `pages/wallet.tsx` không có mục lịch sử.
- **Tác động:** số dư ví (có thể rút ra ngân hàng) chỉ là một con số. Không có sao kê cho khách hay CTV, không đối soát được `walletBalance` với tổng phát sinh, không phát hiện được lệch tiền do bug hoặc sửa tay. Khi khách khiếu nại "ví tôi mất tiền" thì không có dữ liệu để trả lời. Lần gộp khách (`auth.service.ts:325`) cộng số dư mà không để lại vết nào.
- **Đề xuất sửa:**
  - Thêm model `WalletTransaction(userId, delta, reason, refType, refId, balanceAfter, createdAt)` có unique `(refType, refId, reason)`, ghi **cùng transaction** tại cả 8 chỗ.
  - Back-fill bằng một dòng `OPENING_BALANCE` mỗi user tại ngày triển khai (xem mục 8 câu 3).
  - Cron đối soát `walletBalance == SUM(delta)`, báo động khi lệch.
  - Thêm `GET /me/wallet/transactions` và mục "Lịch sử ví".
- **Lệnh kiểm chứng:** `grep -n "^model WalletTransaction" apps/api/prisma/schema.prisma`. Sau khi sửa: `SELECT count(*) FROM users u WHERE "walletBalance" <> coalesce((SELECT sum(delta) FROM wallet_transactions w WHERE w."userId"=u.id),0)` phải bằng 0. Hiện tại, với điểm và xu, câu tương tự trên DB local cho `points_mismatch=0`, `coins_mismatch=0`.
- **Công sức:** M–L · **Model:** opus · **Nhóm file:** `prisma`, `modules/wallet`, `affiliate`, `cashback`, `orders`, `checkout`, `auth` · **Trạng thái:** MỚI.

### A2-005 · P1 · Hoa hồng CTV tạo ngoài transaction, nuốt lỗi, không unique, không cron bù
- **Bằng chứng:**
  - `checkout.service.ts:424-427` và `affiliate.service.ts:404-406` gọi `createCommissionForOrder(order.id).catch(log)` **sau khi** transaction đơn đã commit.
  - `affiliate.service.ts:458-503` dùng `commission.create` trần.
  - `schema.prisma:1119-1143` (model `Commission`) chỉ có `@@index([orderId])`, **không có unique** `(orderId, affiliateUserId)`.
  - Không có cron nào tìm "đơn có `referrerUserId` mà chưa có commission". Kiểm bằng `grep -rn "createCommissionForOrder(" src`: chỉ có 2 caller trên.
- **Tác động:** một lỗi DB tạm thời, hoặc process bị kill giữa lúc commit đơn và lúc tạo commission (khi deploy hay OOM), làm **CTV mất hoa hồng vĩnh viễn** và không ai biết. Nếu sau này thêm retry mà chưa có unique thì sẽ tạo trùng hoa hồng.
- **Đề xuất sửa:** tạo commission **trong cùng tx** với đơn (hàm nhận `tx`, đọc rate trước khi vào tx), và thêm `@@unique([orderId, affiliateUserId])`. Thêm cron reconcile hằng giờ: đơn `referrerUserId IS NOT NULL` thuộc diện hưởng mà không có commission thì tạo bù.
- **Lệnh kiểm chứng:** spec mô phỏng `commission.create` ném lỗi thì đơn phải rollback, hoặc cron bù phải tạo đúng 1 dòng. SQL đối soát: `SELECT o.code FROM orders o WHERE o."referrerUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c."orderId"=o.id)` (lưu ý đơn có rate 0 hợp lệ thì không có commission).
- **Công sức:** M · **Model:** sonnet (opus nếu gộp chung với A2-004) · **Nhóm file:** `modules/affiliate`, `modules/checkout`, `prisma` · **Trạng thái:** MỚI.

### A2-006 · P2 · Bắt P2002 rồi đi tiếp bên trong interactive transaction (bẫy chờ nổ)
- **Bằng chứng:**
  - `wallet/coins.service.ts:65-90`: `grantCoins(..., tx)` bắt P2002 rồi `return` khi chạy trong transaction của caller. Caller là `community-reward.service.ts:40` và `affiliate.service.ts:986`.
  - `coupons/coupons.service.ts:144-157`: `redeem(..., tx)` cũng bắt P2002 rồi `return`.
  - Postgres xử lý `COMMIT` trên transaction đã abort như `ROLLBACK` mà **không báo lỗi** (xem ví dụ ở A2-001).
- **Tác động:** hôm nay chưa gây hại. Ở `grantCoins` caller không ghi gì sau đó; ở `redeem`, `(couponId, orderId)` của một đơn mới tạo không thể trùng. Nhưng ai thêm lệnh ghi sau các lời gọi này sẽ gặp một trong hai kiểu lỗi: toàn bộ thao tác **âm thầm rollback** trong khi code tưởng đã thành công, hoặc lỗi 25P02 khó hiểu. Đây cùng lớp lỗi với A2-001.
- **Đề xuất sửa:** helper `withSavepoint(tx, fn)` hoặc `INSERT … ON CONFLICT DO NOTHING` (`createMany({ skipDuplicates: true })` rồi kiểm `count`). Thêm rule lint hoặc review checklist: "cấm catch lỗi Prisma bên trong `$transaction(async tx)` rồi tiếp tục".
- **Lệnh kiểm chứng:** `grep -rn -B3 "P2002" apps/api/src/modules --include=*.ts | grep -n "tx\."`. Sau khi sửa không còn chỗ catch-continue trong tx.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `modules/wallet`, `modules/coupons` · **Trạng thái:** MỚI.

### A2-007 · P2 · Bảng log/sự kiện phình, không dọn/TTL; ingest analytics gần như không giới hạn
- **Bằng chứng:**
  - `grep -rn "deleteMany" apps/api/src`: **không có** lệnh dọn nào cho `refresh_tokens`, `notification_logs`, `analytics_events`, `pancake_webhook_events`, `gomdon_webhook_events`, `oa_inbound_messages`, `affiliate_clicks`, `game_spins`.
  - Mỗi `notify()` ghi 1 dòng `notification_logs` cộng 1 dòng `analytics_events`, và thêm một cặp nữa nếu gửi ZNS (`notifications.service.ts:55-81`).
  - `POST /events` (`analytics.controller.ts:17-50`): throttle theo header `x-device-id` do **client tự đặt**, nên đổi header là hết giới hạn. Mỗi request tối đa 50 sự kiện. `eventName` và `props` không có whitelist hay giới hạn kích thước (`dto/ingest-events.dto.ts:7-20`); body cho phép tới 10 MB (`main.ts:58`).
  - DB dev có 55 `refresh_tokens` cho 13 user, trong đó 48 dòng (87%) đã thu hồi hoặc hết hạn.
- **Đo thực tế:** byte/dòng gồm cả index, đo trên `tubutree_perf` do agent load-test seed (dữ liệu tổng hợp, `props` nhỏ): `analytics_events` 404 B, `notification_logs` 247 B, `refresh_tokens` 341 B, `order_status_history` 244 B.
- **Ước lượng tăng trưởng** (**giả định**, chưa có số PROD: 1.000 DAU, 100 đơn/ngày, 3 phiên/DAU/ngày, khoảng 30 sự kiện client/DAU/ngày):

  | Bảng | Dòng/ngày (giả định) | Dung lượng/năm |
  |---|---|---|
  | `analytics_events` | ~31.000 | ~4,5 GB |
  | `refresh_tokens` | ~3.000 | ~0,37 GB |
  | `notification_logs` | ~1.100 | ~0,1 GB |
  | `pancake_webhook_events` | 5–10 event/đơn, payload thô vài KB | ~0,5–1 GB (**chưa kiểm chứng** kích thước payload thật) |

  VPS Vietnix dùng chung với ChoDeli nên dung lượng đĩa là ràng buộc thật.
- **Tác động:** đĩa và backup phình đều, các cron quét toàn bảng chậm dần (đã thấy Seq Scan trong `scripts/loadtest/results/explain-cron.txt` của agent load-test ở mục C1, C6, C11). Endpoint `/events` có thể bị dùng để ghi rác hàng loạt.
- **Đề xuất sửa:**
  - Module `retention` gồm một cron đêm có khoá: xoá `refresh_tokens` đã thu hồi/hết hạn quá 30 ngày (giữ đủ cửa sổ cho DAU proxy); `notification_logs` quá 180 ngày; webhook/OA PROCESSED quá 90 ngày.
  - `analytics_events` partition theo tháng, giữ dữ liệu thô 13 tháng rồi tổng hợp.
  - `/events`: whitelist `eventName`, `@MaxLength`, giới hạn kích thước `props`, throttle theo `userId` của JWT thay cho header.
- **Lệnh kiểm chứng:** `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10` theo dõi định kỳ. Spec cho cron dọn. `grep -n "IsIn\|MaxLength" apps/api/src/modules/analytics/dto/ingest-events.dto.ts`.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `modules/auth`, `notifications`, `analytics`, `integrations/*`, module dọn mới · **Trạng thái:** phần `refresh_tokens` CÒN MỞ từ A7-18 (audit-2026-09/07); phần còn lại MỚI.

### A2-008 · P2 · Thiếu index cho truy vấn thực dùng
- **Bằng chứng (truy vấn → index hiện có):**
  - `notification_logs` chỉ có `@@index([userId])` (`schema.prisma:2066`), nhưng các truy vấn thực tế là:
    - `game-reminder.service.ts:115-121`: `templateCode` + `sentAt` khoảng, quét cả bảng hằng ngày.
    - `loyalty-expiry.service.ts:258`: `userId, templateCode, sentAt`.
    - `notifications.service.ts:114`: `userId, channel ORDER BY sentAt DESC`.
  - `cashback_transactions` chỉ có `[userId, status]`; cron hằng giờ `cashback.service.ts:339-345` lọc `status='CONFIRMED' AND confirmedAt<=…`.
  - `commissions` có `[affiliateUserId, status]`, `[orderId]`; cron hằng giờ `affiliate.service.ts:767-774` lọc `status='LOCKED' AND lockedAt<=…`.
  - `refresh_tokens` không có index thời gian. Câu DAU ở `analytics-aggregation.service.ts:96-99` bọc `createdAt` trong biểu thức (non-sargable).
  - `coupons` chỉ có `code` (A7-09).
- **Tác động:** các truy vấn này seq scan và chậm dần theo A2-007. Inbox của user nặng thì phải sort trong bộ nhớ.
- **Đề xuất sửa:** một migration thêm `notification_logs(templateCode, sentAt)` và `(userId, sentAt)`; `cashback_transactions(status, confirmedAt)`; `commissions(status, lockedAt)`; `refresh_tokens(createdAt)`. Viết lại câu DAU thành khoảng `createdAt >= $start AND < $end`. Với coupon: thực hiện đề xuất A7-09 (`ownerUserId` + index).
- **Lệnh kiểm chứng:** `EXPLAIN` từng truy vấn trên `tubutree_perf` sau khi thêm index, phải ra Index Scan.
- **Công sức:** S · **Model:** haiku (schema) / sonnet (A7-09) · **Nhóm file:** `apps/api/prisma` (+ `analytics`, `loyalty` cho coupon) · **Trạng thái:** MỚI; phần coupon CÒN MỞ từ A7-09 (kiểm lại: `loyalty.service.ts:494-496` vẫn nạp mọi coupon còn hạn).

### A2-009 · P2 · Int 32-bit cho cột doanh số/ngưỡng tích luỹ
- **Bằng chứng:**
  - Postgres `INTEGER` tối đa 2.147.483.647, khoảng 2,15 tỷ đ.
  - Các cột tích luỹ: `DealerReward.threshold` (`schema.prisma:472`), `DealerRewardClaim.volumeAtClaim` (`:506`), `CtvMilestoneClaim.revenue` (`:1156`), `AffiliateLink.revenue` (`:1067`), `DealerCreditLedger.delta`.
  - DTO `brand/dto/brand.dto.ts:75,87` chỉ có `@IsInt() @Min(0) threshold` mà **không có `@Max`**.
  - Hạng `DEALER_VIP` yêu cầu `minOrderVolume` 200 triệu/tháng (`seed.ts:286`); thưởng theo năm hay quý cho đại lý lớn có thể vượt 2,15 tỷ.
- **Tác động:** admin nhập ngưỡng thưởng tour năm từ 2,15 tỷ trở lên, hoặc đại lý có doanh số kỳ vượt mức đó lúc gửi yêu cầu, thì nhận lỗi `value out of range for type integer` (500) và yêu cầu nhận thưởng bị chặn.
- **Đề xuất sửa:** chuyển các cột tích luỹ sang `BigInt` (hoặc `Decimal(18,0)`), đồng thời thêm `@Max` ở DTO. Cột tiền của một đơn đơn lẻ giữ `Int`.
- **Lệnh kiểm chứng:** `POST` tạo DealerReward với `threshold=3000000000` phải trả 400 (nếu dùng `@Max`) hoặc 201 (nếu dùng BigInt), không được 500.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `prisma`, `modules/brand/dto`, `modules/dealer`, `modules/affiliate` · **Trạng thái:** MỚI.

### A2-010 · P2 · `PancakeWebhookEvent` không dedupe, không index, không cron cứu
- **Bằng chứng:**
  - `schema.prisma:2074-2085` không có `dedupeKey`, không có index.
  - `pancake-webhook.controller.ts:65-67` mỗi lần gọi là `create` một dòng.
  - `pancake.processor.ts:56-80`: lỗi thì ghi FAILED rồi để BullMQ retry; hết số lần retry thì **không còn đường nào xử lý lại**.
  - Đối chiếu với Gomdon: `GomdonWebhookEvent.dedupeKey @unique`, `@@index([status, receivedAt])`, cộng cron cứu `gomdon-reconcile.service.ts`.
- **Tác động:** sự kiện DELIVERED hoặc RETURNED xử lý lỗi quá số lần retry (DB blip kéo dài) thì đơn kẹt trạng thái cũ. Hệ quả là không cộng điểm, không khoá hoa hồng, không tính hạn đổi trả. Pancake gửi lặp thì sinh nhiều dòng; các handler có guard trạng thái nên an toàn tiền, nhưng tốn chỗ.
- **Đề xuất sửa:** thêm `dedupeKey` unique (event + order id + status + updated_at), `@@index([status, receivedAt])`, cron re-enqueue FAILED/RECEIVED quá 10 phút có trần số lần, và báo động.
- **Lệnh kiểm chứng:** spec gửi cùng payload 5 lần đồng thời thì chỉ có 1 dòng (mirror `gomdon.race-spec.ts` (g)).
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `modules/integrations/pancake`, `prisma` · **Trạng thái:** MỚI.

### A2-011 · P2 · Tạo gói định kỳ không chống trùng
- **Bằng chứng:**
  - `subscriptions.service.ts:49-80`: `create` không đọc `Idempotency-Key`, không kiểm gói đang hoạt động cùng `variationId`.
  - `schema.prisma:2151-2170`: không có unique; `status` là `String`.
- **Tác động:** bấm đúp hoặc retry mạng tạo 2 gói, nên mỗi kỳ cron (`processDue`) tạo 2 đơn COD cùng SKU. Không mất tiền trước nhưng tốn phí giao và làm khách khó chịu.
- **Đề xuất sửa:** partial unique `(userId, variationId, addressId) WHERE status IN ('ACTIVE','PAUSED')` (xem mục 8 câu 6), cộng Idempotency-Key ở FE. Chuyển `status` sang enum.
- **Lệnh kiểm chứng:** race-spec gửi 3 lệnh create đồng thời thì chỉ có 1 gói.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `modules/subscriptions`, `prisma`, `miniapp/services/subscriptions-api.ts` · **Trạng thái:** MỚI.

### A2-012 · P2 · Cron: múi giờ, mốc "đầu ngày" và khoá phân tán
- **Bằng chứng:**
  - `grep -rn "@Cron(" src`: 28 cron, chỉ `analytics-aggregation.service.ts:36` đặt `timeZone: 'Asia/Ho_Chi_Minh'`.
  - `docker-compose.vietnix.yml:47-70` và `apps/api/Dockerfile` không đặt `TZ`; `.env*` cũng không có `TZ`. Vì vậy `'0 3 * * *'` (catalog `catalog.service.ts:473`, subscriptions `subscriptions.service.ts:174`) chạy lúc **10:00 giờ VN**, đúng giờ cao điểm.
  - Mốc "đầu ngày" cho trần thưởng tính bằng giờ server: `community-feed.service.ts:200`, `community-reward.service.ts:32`, `game-garden.service.ts:149`, `game.service.ts:184` (`setHours(0,0,0,0)`). Trong khi đó 7 chỗ khác tính `dayKey` theo UTC+7 (`game-economy.service.ts:20`, `game-gift.service.ts:21`, `game-quiz.service.ts:21`, `game.service.ts:624`, `loyalty.service.ts:644`, `staff/shifts/time.util.ts:5`, `analytics-aggregation.service.ts:40`). Trên container UTC, trần thưởng/ngày reset lúc 07:00 VN còn điểm danh reset lúc 00:00 VN.
  - Không có khoá phân tán (`grep pg_try_advisory|redlock|SET NX` → không có). Phần lớn cron có claim guard, nhưng `game-reminder.service.ts:73,134` và `loyalty-expiry.service.ts:258-268` (đọc rồi gửi) sẽ **gửi thông báo đôi** khi chạy từ 2 instance API trở lên. Hiện compose chỉ có 1 instance.
- **Tác động:** giờ chạy cron lệch kỳ vọng, trần thưởng lệch ngày, và khi scale lên 2 replica thì khách nhận thông báo trùng.
- **Đề xuất sửa:** đặt `TZ=Asia/Ho_Chi_Minh` trong compose **và** `timeZone` cho từng `@Cron` (phòng thủ hai lớp). Tạo một util `vn-time.ts` dùng chung (`vnDayKey`, `vnStartOfDay`). Viết decorator hoặc helper `runExclusive(name)` dùng `pg_try_advisory_lock` cho các cron gửi thông báo.
- **Lệnh kiểm chứng:** `grep -rn "@Cron(" apps/api/src | grep -vc timeZone` phải bằng 0. `grep -rn "setHours(0, 0, 0, 0)" apps/api/src --include=*.ts | grep -v spec` phải ra rỗng.
- **Công sức:** S–M · **Model:** sonnet · **Nhóm file:** mọi module có `@Cron`, `docker-compose.*.yml`, `common/` · **Trạng thái:** phần TZ CÒN MỞ từ audit-2026-09/00 ("Câu hỏi mở: TZ thực tế của container production", báo cáo 03); phần mốc ngày và khoá phân tán MỚI.

### A2-013 · P2 · Logic trùng nên gom về một chỗ
- **Bằng chứng:**
  - **Sinh mã đơn có 4 bản:** `checkout.service.ts:621-632`, `affiliate.service.ts:415-426`, `dealer.service.ts:1426-1433`, `subscriptions.service.ts:360-367`. Nightly chỉ thấy 2 bản. `ymd` tính theo UTC nên đơn đặt từ 00:00 đến 07:00 VN mang ngày hôm trước.
  - **maskName có 4 bản:** `game-gift.service.ts:24`, `game-season.service.ts:13`, `game.service.ts:615`, `merchant.service.ts:50`.
  - **Báo admin có 3 bản:** `users.service.ts:174`, `dealer.service.ts:340,862`.
  - **Chuẩn hoá SĐT có 3 bản:** `affiliate.service.ts:436-440`, `loyalty normalizeVnPhone`, `zalo.service normalizePhone` (comment ở `affiliate.service.ts:429-431` tự thừa nhận).
  - **dayKey VN có 7 bản** (xem A2-012).
  - Code chết trong nightly: `orders/order-transition.ts:44` (`isTerminal`), `admin/admin-order-filter.ts:19` (grep chỉ ra chính dòng định nghĩa).
- **Tác động:** sửa một chỗ quên chỗ khác. Mã đơn đã có biến thể `TUBU…`/`TUBUSUB…`/`DLR…` do 4 nơi tự sinh.
- **Đề xuất sửa:** tạo `apps/api/src/common/` gồm `order-code.ts`, `mask-name.ts`, `phone.ts`, `vn-time.ts` và `AdminNotifierService`. Thay dần từng chỗ gọi. Xoá code chết.
- **Lệnh kiểm chứng:** `grep -rn "private async generate.*Code\|private maskName\|function maskFullName\|notifyAdminsOf" apps/api/src --include=*.ts | grep -v spec` chỉ còn định nghĩa trong `common/`.
- **Công sức:** M · **Model:** haiku (cơ học) / sonnet (review) · **Nhóm file:** `common/` + `checkout`, `affiliate`, `dealer`, `subscriptions`, `game`, `merchant`, `users`, `loyalty` · **Trạng thái:** CÒN MỞ từ nightly `306be08a52`, `335ab97e91`, `cc574bbfcb`, `60082bfe4a`, `dc3500d7f8` (đã grep, vẫn nguyên); phần SĐT và dayKey MỚI.

### A2-014 · P2 · Service quá lớn, ôm nhiều trách nhiệm
- **Bằng chứng (`wc -l`, không tính spec):**

  | File | Số dòng | Trách nhiệm đang gộp chung |
  |---|---|---|
  | `dealer/dealer.service.ts` | 1.434 | đăng ký, bảng giá, đặt đơn, công nợ, thưởng mốc và duyệt, thưởng quý và thu hồi, mẫu đơn, xác nhận CK |
  | `loyalty/loyalty.service.ts` | 1.297 | cộng/đảo điểm, hạng, điểm danh, đổi quà, coupon khả dụng, POS |
  | `affiliate/affiliate.service.ts` | 1.128 | đăng ký, ghi nhận chạm, link/click, dashboard/bậc, lên đơn hộ, vòng đời hoa hồng, voucher giới thiệu, payout admin, mốc tháng |
  | `feed/community-feed.service.ts` | 1.099 | bài, bình luận, tim, kiểm duyệt, uy tín, sự kiện, BXH |
  | `integrations/gomdon/gomdon-order.service.ts` | 815 | — |

  `admin.service.ts` 748 dòng, dưới ngưỡng.
- **Đề xuất tách** (không đổi API, mỗi lần tách một PR kèm test):
  - `dealer`: `DealerOrderService` (đặt đơn và mẫu), `DealerCreditService` (sổ công nợ và xác nhận CK), `DealerRewardService` (mốc và claim), `DealerBonusService` (thưởng quý và thu hồi).
  - `loyalty`: `PointsLedgerService` (credit/reverse/lock), `TierService`, `CheckInService`, `RewardCatalogService`, `PosCreditService`.
  - `affiliate`: `AttributionService` (touch/link/click), `CommissionService`, `PayoutService`, `CtvAssistedOrderService`, `CtvTierService`.
  - `feed`: `PostService`, `ModerationService`, `ReputationService`, `CommunityEventService`.
- **Lệnh kiểm chứng:** `find apps/api/src -name "*.service.ts" ! -name "*.spec.ts" -exec wc -l {} + | sort -rn | head` phải không còn file nào trên 800 dòng. Toàn bộ unit test (2.364) phải vẫn pass.
- **Công sức:** L · **Model:** sonnet · **Nhóm file:** theo từng module, làm song song được vì 4 module không đụng nhau · **Trạng thái:** MỚI. Nên làm **sau** A2-015 để có lưới an toàn.

### A2-015 · P2 · Thiếu race test trên Postgres thật cho các đường tiền/kho chính
- **Bằng chứng:**
  - `apps/api/test/integration-race/` có 10 spec. Chúng phủ: claim mốc CTV, analytics atomic, 4a/4b (không phải race), hoàn COD, thưởng quý đại lý, claim thưởng đại lý, Gomdon, loyalty, và huỷ đơn so với xác nhận CK.
  - **Không có** spec nào cho:
    - checkout oversell (`reserveVariationStock`, `checkout.service.ts:215`);
    - `usageLimit`/`perUserLimit` của coupon (advisory lock, `coupons.service.ts:136`);
    - flash `consumeQuota`/`perUserLimit` (`flash-sale.service.ts:94-138`);
    - idempotency của `wallet.withdraw`/`convertToXu`;
    - `coins.spendCoins`;
    - `groupbuy.join` (`groupbuy.service.ts:98-123`);
    - claim trong `subscriptions.processDue`;
    - backorder reconcile so với huỷ đơn (chỉ có unit mock ở `dealer-backorder.service.spec.ts:95`).
  - Kiểm bằng `grep -ln -i "flash\|coupon\|withdraw\|convertToXu\|spendCoins\|groupbuy\|reserveVariationStock" test/integration-race/*.ts`: chỉ khớp các file không liên quan tới những đường trên.
- **Tác động:** các guard nguyên tử hiện đúng khi đọc code, nhưng không có lưới chống hồi quy khi refactor (A2-014) hoặc khi sửa A2-001/A2-005.
- **Đề xuất sửa:** thêm các race-spec với mẫu `Promise.all` 5–10 request: (1) 2 đơn cùng tranh 1 đơn vị cuối; (2) coupon `usageLimit=1` với 5 đơn đồng thời; (3) flash quota/perUserLimit; (4) withdraw/convert cùng key; (5) groupbuy đủ người; (6) backorder reconcile song song với cancel.
- **Lệnh kiểm chứng:** `cd apps/api && DATABASE_URL=postgresql://tubu:***@localhost:5434/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand`.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `apps/api/test/integration-race` (không đụng src) · **Trạng thái:** MỚI.

### A2-016 · P2 · Shared types gần như không được dùng; API trả thẳng entity Prisma
- **Bằng chứng:**
  - `packages/shared-types/src` có 302 dòng (enums, auth, catalog, order).
  - Số file import `@tubutree/shared-types`: **API 17, miniapp 6, web 0**. API chỉ dùng `OrderStatus`, `JwtPayload`, `UserRole`, `LoginResponse`; miniapp chỉ dùng `OrderDTO`, `AuthUser`, `LoginResponse`.
  - `ProductDTO`, `VariationDTO`, `Paginated`, `ProductListQuery` **không ai import**. `ProductListQuery` bị định nghĩa lại ở `api/catalog/dto/product-query.dto.ts:13-38` (đã có thêm `minPrice/maxPrice/inStock/minRating`), còn miniapp có `CatalogSort` riêng (`shop-api.ts:206`).
  - Web tự khai báo `status: string`, `paymentMethod: string` (`web/src/lib/admin-client.ts:14,43,52,96-97`), cùng `UserRole` riêng (`:235`).
  - Response đơn là nguyên dòng Prisma: `checkout.service.ts:658-662` (`include: { items: true }`) trả cả `idempotencyKey`, `pancakeOrderId`, `paymentTxnId`, `commission`, `referrerUserId`, `endCustomerKey` cho khách.
- **Tác động:** đổi enum hay cột ở API thì FE không lỗi compile mà vỡ lúc chạy. Cột nội bộ lộ ra client; mức độ nhạy cảm thấp, nhưng các cột thêm sau này sẽ tự động bị lộ.
- **Đề xuất sửa:** chọn một trong hai hướng: (a) response DTO kèm `select` tường minh cho Order/Product/User và đưa vào `shared-types`; (b) sinh client và type từ OpenAPI (`@nestjs/swagger`). Web chuyển sang import enum dùng chung. Chặn bằng lint "không trả thẳng `prisma.*.find*` từ controller".
- **Lệnh kiểm chứng:** `grep -rln "@tubutree/shared-types" apps/web/src | wc -l` phải lớn hơn 0. Snapshot test cho response `/checkout/place-order` không chứa `idempotencyKey`.
- **Công sức:** L · **Model:** sonnet · **Nhóm file:** `packages/shared-types`, controller API, `apps/web/src/lib`, `apps/miniapp/src/services` · **Trạng thái:** MỚI.

### A2-017 · P2 · Toàn vẹn dữ liệu dựa vào code; gộp khách bỏ sót bảng giới hạn lượt
- **Bằng chứng:**
  - Truy vấn `information_schema` so với `pg_constraint` trên DB local tìm ra **hơn 80 cột `*Id` không có FK**. Các bảng tiền và nghiệp vụ trong số đó:
    - `dealer_credit_ledgers.userId`
    - `coupon_redemptions.userId/orderId`
    - `return_requests.orderId/userId`
    - `order_items.variationId`, `order_items.flashSaleItemId`
    - `orders.referrerUserId/subscriptionId`
    - `dealer_reward_claims.userId`
    - `payroll_days/months/adjustments.staffId`
    - `order_status_history.orderId`
    - `flash_sale_purchases.userId`
    - `users.referredById`
  - `mergeGuestInto` (`auth.service.ts:239-361`) chuyển cart, address, orders, points, coins, cashback nhưng **không chuyển** `coupon_redemptions`, `flash_sale_purchases`, `loyalty_check_ins`, `reviews`, `game_profiles`.
- **Tác động:** dữ liệu mồ côi chỉ phát sinh khi sửa tay DB, vì code không xoá cứng user, đơn hay variation. Riêng gộp khách thì **lách được `perUserLimit`**: dùng coupon hoặc suất flash ở phiên khách, gộp vào tài khoản Zalo rồi dùng lại.
- **Đề xuất sửa:** thêm FK `ON DELETE RESTRICT` cho các bảng tiền, sau khi chạy SQL tìm dòng mồ côi trên bản sao PROD. Bổ sung các bảng còn thiếu vào merge (gom chung với A2-001).
- **Lệnh kiểm chứng:** câu SQL "cột *Id không FK" trong phụ lục phải ngắn lại. Race-spec gộp khách: coupon `perUserLimit=1` đã dùng ở phiên khách thì không dùng lại được sau khi gộp.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `prisma`, `modules/auth` · **Trạng thái:** MỚI.

### A2-018 · P3 · Bảng/cột chết hoặc chỉ ghi không đọc
- **Bằng chứng** (grep `apps/api/src`, `apps/web/src`, `apps/miniapp/src`, không tính spec):
  - **0 tham chiếu:** `CohortRepeatSnapshot`, `FunnelDailySnapshot` (chỉ có TODO ở `analytics-aggregation.service.ts:13-16`), `User.zaloAccessToken/zaloRefreshToken/pancakeCustomerId`, `MembershipTier.badgeImageUrl`.
  - **Luôn null:** `RetentionDailySnapshot.dauEventBased`.
  - **Không nơi nào ghi:** `Order.commission`. Nguồn sự thật là bảng `commissions`.
  - **Chỉ ghi, không đọc:** `AffiliateClick` (đọc 0), `GameSpin` (đọc 0), `BetaFeedback` (đọc 0: góp ý của khách beta **không ai xem được** qua app hay admin), `SystemConfigHistory` (audit, chấp nhận được).
  - **Không bao giờ tăng:** `AffiliateLink.conversions/revenue`, `AffiliateClick.convertedOrderId` (A7-24).
  - Comment trong schema nói `Order.endCustomerKey` là "hash SĐT", nhưng code lưu **SĐT dạng rõ** (`affiliate.service.ts:347,436-440`).
- **Đề xuất sửa:** xoá các cột/bảng chết qua migration, hoặc hiện thực nốt (snapshot cohort/funnel theo dự án con 2). Thêm màn admin đọc `BetaFeedback`. Sửa comment `endCustomerKey`, hoặc hash thật nếu chủ dự án muốn (ảnh hưởng gộp khách lên hộ).
- **Lệnh kiểm chứng:** `grep -rnw "dauEventBased\|badgeImageUrl\|pancakeCustomerId" apps/*/src` và đếm đọc/ghi theo model (script trong phụ lục).
- **Công sức:** S · **Model:** haiku · **Nhóm file:** `prisma`, `modules/analytics`, `modules/beta`, `modules/affiliate` · **Trạng thái:** MỚI; phần affiliate CÒN MỞ từ A7-24.

### A2-019 · P3 · Trùng khái niệm trong mô hình dữ liệu
- **Bằng chứng:**
  - **Hai sổ tiền tệ tiêu trong app:** `PointsTransaction` và `CoinTransaction` (`schema.prisma:904,989`), mỗi sổ có partial unique riêng.
  - **Hai hệ điểm danh:** `LoyaltyCheckIn` (`:934`) và `GameProfile.lastCheckInAt/streakDays` (`:1374-1376`).
  - **Lô vườn nhà lưu trong JSON** `GameProfile.ecoImpact` (`{progress,target,treeType,treesPlanted}`, ví dụ ở `game-quiz.service.ts:108`), còn lô phụ là các cột trong `GardenPlot` (`:1542-1559`).
  - **Cờ "đã nhắc" rải 6 nơi:** `Cart.abandonRemindedAt`, `Coupon.remindedAt`, `FlashSaleReminder.notifiedAt`, `ReorderReminder.remindedAt`, `Storefront.lastReminderAt`, và dò `NotificationLog` (`game-reminder.service.ts:115`, `loyalty-expiry.service.ts:258`).
  - **Khoá idempotency nhét trong chuỗi `reason`** (`ORDER_DELIVERED:<code>`) kèm partial unique `LIKE 'ORDER_DELIVERED:%'`.
- **Tác động:** khó hiểu, khó đối soát, dễ lệch. Audit 03 đã nêu khách phải hiểu từ 12 loại số dư trở lên.
- **Đề xuất sửa:** theo H3.4 của audit 03: một sổ cái tiền tệ có `source/refType/refId/expiresAt`. Một bảng `notification_dispatch(dedupeKey unique)` thay cho 6 cờ nhắc. Chuẩn hoá lô vườn nhà thành `GardenPlot slot 0`.
- **Lệnh kiểm chứng:** không áp dụng (thiết kế); xong khi có ADR được duyệt.
- **Công sức:** L · **Model:** opus (thiết kế) · **Nhóm file:** `loyalty`, `wallet`, `game`, `lifecycle`, `prisma` · **Trạng thái:** phần tiền tệ và điểm danh CÒN MỞ từ A3-19/H3.4 (audit-2026-09/03, mục 206: "Hợp nhất `PointsTransaction` + `CoinTransaction`"); phần còn lại MỚI.

### A2-020 · P3 · Trạng thái kiểu `String` thay vì enum
- **Bằng chứng:** `Subscription.status` (`:2161`), `CommunityReport.status` (`:1725`), `CommunityEvent.status` (`:1800`), `OrderStatusHistory.fromStatus/toStatus/actorType` (`:1862-1865`), `ReturnRequest.refundMethod` (`:1881`), `Order.source/platform` (`:832-833`), `ReferralTouch.kind`, `NotificationLog.status/channel`, các webhook `status`, `Lesson.contentType`, `DealerReward.period`.
- **Tác động:** gõ sai giá trị không bị DB chặn; FE không có union type.
- **Đề xuất sửa:** chuyển sang enum (migration `ALTER TYPE … USING`) theo từng nhóm, ưu tiên `Subscription.status` và `OrderStatusHistory` (dùng `OrderStatus`).
- **Lệnh kiểm chứng:** `grep -nE "status +String" apps/api/prisma/schema.prisma` phải ngắn lại.
- **Công sức:** S–M · **Model:** haiku · **Nhóm file:** `prisma` + service tương ứng · **Trạng thái:** MỚI.

### A2-021 · P3 · Vòng phụ thuộc mức thư mục; DealerService lấy qua ModuleRef
- **Bằng chứng** (script `cycles.cjs`, Tarjan trên import giá trị, không tính spec):
  - Mức file: **0 vòng**. `forwardRef`: 0 lời gọi; chỉ còn một comment ở `gomdon.module.ts:18`.
  - Mức thư mục có 3 SCC. SCC lớn gồm **12 module**: cart, pricing, wallet, affiliate, loyalty, dealer, flash-sale, orders, lifecycle, integrations/pancake, integrations/gomdon, system-config.
  - Các cạnh gây vòng:
    - pancake → gomdon (`pancake-order.service.ts` → `gomdon-config/status/weight`; `pancake.processor.ts` → `gomdon-alert/queue`), và gomdon → pancake (`gomdon-order.service.ts` → `pancake-order.service.ts`);
    - orders → dealer (`order-reversal.service.ts`);
    - system-config → gomdon (`system-config.controller.ts` → `gomdon-config.ts`).
  - Hai SCC nhỏ: notifications ↔ jobs, và staff/payroll ↔ staff/attendance.
  - `order-reversal.service.ts:200-208` lấy `DealerService` qua `moduleRef.get(..., { strict: false })`. Nếu thiếu thì chỉ `logger.error("… Cần đối soát tay")` rồi bỏ qua bước thu hồi thưởng quý.
- **Tác động:** module dính chặt vào nhau nên khó tách service (A2-014) và khó test. Lỗi wiring ở đường tiền không làm hỏng boot mà âm thầm bỏ bước thu hồi.
- **Đề xuất sửa:** tách `gomdon-config/status/alert/queue` sang một module "fulfillment-core" không phụ thuộc Pancake. Dùng event (`EventEmitter2`) cho `orders → dealer`. Thêm kiểm tra lúc boot (`onModuleInit`) để fail nhanh nếu thiếu `DealerService`.
- **Lệnh kiểm chứng:** chạy lại `node cycles.cjs apps/api/src` (script ở phụ lục), SCC lớn phải tách ra.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `orders`, `integrations/pancake`, `integrations/gomdon`, `dealer`, `system-config` · **Trạng thái:** MỚI.

### A2-022 · P3 · 13 partial unique index (chốt tiền) mà Prisma không thấy
- **Bằng chứng:**
  - `pg_indexes … WHERE indexdef ILIKE '% where %'` trên `tubutree` trả 13 index: `coin_transactions_{convert_ref_key, referral_unique, quest_unique, community_reason_key}`, `points_transactions_{checkin_day_key, pos_ref_key, delivered_unique, reverse_unique}`, `coupon_redemptions_couponId_orderId_notnull`, `dealer_applications_pending_user_key`, `return_requests_open_order_key`, `role_grants_active_phone_role_key`, `attendance_sessions_open_staff_key`.
  - Cả 13 không khai báo trong `schema.prisma`, nhưng `migrate diff` vẫn trả "No difference detected".
  - DB race `tubutree_it` có đủ 13 (được dựng bằng migrate deploy, 103 dòng trong `_prisma_migrations`).
- **Tác động:** ai dựng DB bằng `prisma db push` hoặc từ schema (môi trường mới, e2e, preview) sẽ **mất các chốt chống cộng tiền đôi** mà không có cảnh báo nào.
- **Đề xuất sửa:** thêm bước CI chạy `migrate deploy` rồi assert `count(partial index) = 13` (cập nhật số này mỗi khi thêm index). Ghi rõ "cấm `db push`" trong README/AGENTS.md. Có thể nâng Prisma lên bản hỗ trợ partial index khi ổn định.
- **Lệnh kiểm chứng:** `docker exec tubu_pg psql -U tubu -d <db> -At -c "select count(*) from pg_indexes where schemaname='public' and indexdef ilike '% where %'"` phải ra 13.
- **Công sức:** S · **Model:** haiku · **Nhóm file:** `apps/api/prisma`, CI · **Trạng thái:** MỚI.

### A2-023 · P3 · Tồn kho âm có thể lọt vào và làm `reserveAvailable` trả số âm
- **Bằng chứng:**
  - Webhook loại `remain_quantity < 0` (`pancake.processor.ts:366`).
  - Nhưng đường sync tạo variation ghi `stock: v.remain_quantity` (`pancake-sync.service.ts:197`), và `forcePancakeStock` ghi thẳng giá trị mà không kẹp về 0 (`variation-stock.ts:122-131`, gọi từ `pancake-sync.service.ts:205`).
  - `reserveAvailableVariationStock` (`variation-stock.ts:145-166`) tính `LEAST(old.stock, q)`. Nếu stock âm thì "số giữ được" là số âm, và `backorderedQty = quantity − reserved > quantity` (`dealer.service.ts:222-223`).
  - `purchased-items.service.ts:123` có `Math.max(v.stock, 0)`, cho thấy stock âm là trường hợp đã được tính tới.
  - **Chưa kiểm chứng** Pancake có trả số âm hay không.
- **Đề xuất sửa:** dùng `GREATEST(0, …)` ở create và force; dùng `LEAST(GREATEST(old.stock,0), q)` ở `reserveAvailable`.
- **Lệnh kiểm chứng:** race-spec đặt `stock=-3` rồi gọi `reserveAvailableVariationStock(q=5)`, kết quả phải là 0, `stock=-3` giữ nguyên hoặc thành 0, và `reservedStock` không giảm.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `modules/catalog/variation-stock.ts`, `integrations/pancake` · **Trạng thái:** MỚI.

### A2-024 · P3 · Mỗi khách chỉ được đánh giá một sản phẩm một lần
- **Bằng chứng:** `schema.prisma:2037` có `@@unique([userId, productId])` trên `Review`.
- **Tác động:** khách mua lại (north-star) không đánh giá thêm được; social proof không tăng theo số lần mua lặp.
- **Đề xuất sửa:** quyết định nghiệp vụ (mục 8 câu 5).
- **Lệnh kiểm chứng:** không áp dụng.
- **Công sức:** S · **Model:** sonnet · **Nhóm file:** `prisma`, `modules/reviews` · **Trạng thái:** MỚI.

### A2-025 · P3 · Flash sale: lần mua đầu đồng thời của cùng user nhận thông báo sai nghĩa
- **Bằng chứng:**
  - `flash-sale.service.ts:117-137`: `findUnique` rồi `create` `FlashSalePurchase`.
  - Hai đơn đồng thời đầu tiên của cùng user thì đơn thua ăn P2002 trên `@@unique([flashSaleItemId, userId])`.
  - `checkout.service.ts:219-232` map mọi lỗi không phải `OVER_LIMIT` thành `PRICE_CHANGED`.
- **Tác động:** không mất tiền (transaction rollback), nhưng khách thấy "giá đã đổi" thay vì "đơn trước đang xử lý".
- **Đề xuất sửa:** `INSERT … ON CONFLICT ("flashSaleItemId","userId") DO UPDATE SET quantity = quantity + $q WHERE quantity + $q <= limit` trong một câu SQL.
- **Lệnh kiểm chứng:** race-spec flash (A2-015 mục 3).
- **Công sức:** S · **Model:** haiku/sonnet · **Nhóm file:** `modules/flash-sale` · **Trạng thái:** MỚI.

---

## 3. Bản đồ transaction và race theo vùng tiền/kho

| Vùng | Chỗ ghi | Cơ chế | Isolation | Race test Postgres thật |
|---|---|---|---|---|
| Tồn kho bán lẻ | `variation-stock.ts:56-62` `UPDATE … WHERE stock >= q` | atomic có điều kiện | Read Committed | **Chưa** (A2-015) |
| Tồn kho đại lý (backorder) | `variation-stock.ts:145-166` CTE `FOR UPDATE`; reconcile `dealer-backorder.service.ts:53-66` updateMany guard + release | atomic + khoá dòng | RC | **Chưa** (chỉ unit mock) |
| Hoàn kho khi huỷ/trả | `order-reversal.service.ts:136-149` đọc lại `backorderedQty FOR UPDATE` | khoá dòng | RC | có (order-cancel, cod-return) |
| Đồng bộ Pancake | `variation-stock.ts:98-115` một câu UPDATE theo chênh lệch | atomic | RC | không có (đã verify tay, xem memory P0-3) |
| Flash quota | `flash-sale.service.ts:102-114` raw `soldCount + q <= quota` + kiểm sale active | atomic | RC | **Chưa** |
| Flash perUserLimit | `:117-137` updateMany `quantity <= limit-q`; lần đầu thì create | atomic, lần đầu dựa vào unique | RC | **Chưa** (A2-025) |
| Coupon usageLimit | `coupons.service.ts:115-117` updateMany guard `usedCount < usageLimit` | atomic | RC | **Chưa** |
| Coupon perUserLimit | `coupons.service.ts:136-142` `pg_advisory_xact_lock(coupon,user)` rồi count | khoá advisory | RC | **Chưa** |
| Ví (trả đơn, rút, đổi xu) | `checkout.service.ts:320-324`, `wallet.service.ts:92-95,176-179` `walletBalance >= x` | atomic; idempotency qua `Payout.idempotencyKey`/partial unique CONVERT | RC | **Chưa** |
| Ví (cộng) | affiliate:678, 1100; cashback:356; reversal:122 | increment trong tx có guard trạng thái | RC | có (cod-return) |
| TubuXu | `coins.service.ts:106-112` `coinsBalance >= x` + ledger | atomic | RC | một phần (affiliate milestone) |
| Điểm Xanh tiêu | `checkout.service.ts:291-303` `FOR UPDATE` user + guard `>= dùng + khoá` | khoá dòng + atomic | RC | có (loyalty) |
| Điểm Xanh cộng/đảo | `loyalty.service.ts:79-121` partial unique `ORDER_DELIVERED`/`ORDER_REVERSED` | idempotency bằng unique | RC | có (loyalty) |
| Hoa hồng tạo | `affiliate.service.ts:491` **ngoài tx đơn** | không có | — | **Chưa** (A2-005) |
| Hoa hồng rút | `affiliate.service.ts:663-680` updateMany + đối chiếu `count` | atomic | RC | **Chưa** |
| Công nợ đại lý | `dealer.service.ts:207-252` | đếm rồi ghi | **Serializable** | có (dealer-bonus) |
| Thưởng quý đại lý | `dealer.service.ts:1147-1257` advisory `(đại lý, quý)` + `FOR UPDATE` + unique ledger | khoá | RC | có |
| Cashback settle | `cashback.service.ts:346-359` updateMany status guard | atomic | RC | **Chưa** |
| Mua chung | `groupbuy.service.ts:98-123` unique member + updateMany `currentSize < target` | atomic | RC | **Chưa** |
| Gói định kỳ | `subscriptions.service.ts:186-190` claim `nextRunAt` | atomic | RC | **Chưa** |
| Gộp khách | `auth.service.ts:245-360` | **catch P2002 trong tx (sai)** | RC | **Chưa** (A2-001) |

Nhận xét: mọi chỗ **trừ** số dư đều dùng update có điều kiện nguyên tử; không thấy chỗ đọc-rồi-ghi số dư nào (đã grep các mẫu `balance: x ± y`). Rủi ro còn lại nằm ở những chỗ **không nằm trong transaction** (A2-005), những chỗ **xử lý lỗi sai trong transaction** (A2-001, A2-006), và những chỗ **thiếu test chống hồi quy** (A2-015).

---

## 4. Kiến trúc NestJS: tóm tắt đo đạc

- **Vòng phụ thuộc:** xem A2-021. Máy không có madge (`node_modules/.bin` không có madge/dpdm/depcruise). Thay vì `npx` tải từ mạng, tôi viết `cycles.cjs` (Tarjan, chỉ tính `import` giá trị) và chạy offline.
- **Service lớn:** xem A2-014.
- **Logic trùng:** xem A2-013.
- **Cron:** 28 `@Cron`. Phần lớn có guard claim (subscriptions, reorder, remarketing, flash reminder, storefront reminder, cashback settle, backorder) hoặc idempotent (vouchers P2002, analytics upsert). Cron không có claim: `game-reminder`, `loyalty-expiry` (nhắc). Không có cron nào bị trùng nhiệm vụ. Ba job `'0 3 * * *'` theo giờ server (catalog, subscriptions, và analytics theo giờ VN) nên rơi vào hai khung khác nhau khi TZ=UTC; xem A2-012.

## 5. Đối chiếu audit cũ và nightly backlog (phần thuộc phạm vi A2)

| Nguồn | Mục | Kiểm lại bằng code | Kết luận |
|---|---|---|---|
| audit-2026-09/07 | A7-09 coupon nạp toàn bộ, không index | `loyalty.service.ts:494-496`; `Coupon` không có `ownerUserId` | CÒN MỞ (gộp vào A2-008) |
| audit-2026-09/07 | A7-18 `refresh_tokens` không dọn | không có `deleteMany` | CÒN MỞ (A2-007) |
| audit-2026-09/07 | A7-24 `conversions`/`convertedOrderId` không ghi | không có chỗ tăng | CÒN MỞ (A2-018) |
| audit-2026-09/07 | A7-10 `Order.source/platform/paidAt/subscriptionId/endCustomerKey` | đã có ở `schema.prisma:832-836` | ĐÃ ĐÓNG phần schema (comment `endCustomerKey` sai, xem A2-018) |
| audit-2026-09/02,03,06 | A2-07=A3-03=A6-31 LIMIT 500 nhắc mua lại | `lifecycle.service.ts:87-100` đã có LEFT JOIN, HAVING, ORDER BY | ĐÃ ĐÓNG |
| audit-2026-09/00 | Câu hỏi TZ container | compose và Dockerfile không có TZ | CÒN MỞ (A2-012) |
| audit-2026-09/03 | A3-19/H3.4 gộp sổ điểm và xu | 2 bảng riêng | CÒN MỞ (A2-019) |
| nightly | 306be08a52 mã đơn trùng | thực tế có 4 bản | CÒN MỞ, mở rộng (A2-013) |
| nightly | 335ab97e91 maskName | 4 bản | CÒN MỞ (A2-013) |
| nightly | cc574bbfcb báo admin | 3 bản | CÒN MỞ (A2-013) |
| nightly | 60082bfe4a `isTerminal`, dc3500d7f8 hằng chết | chỉ còn dòng định nghĩa | CÒN MỞ (A2-013) |
| nightly | e64687732a N+1 gộp giỏ khách | `auth.service.ts:260-277` vòng lặp 2–3 lệnh/dòng | CÒN MỞ (sửa chung khi làm A2-001) |
| nightly | 2f2f22fefe `listLinks` không giới hạn; 9063c0ecda `subscriptions.list` không giới hạn | `affiliate.service.ts:140-141`; `subscriptions.service.ts:85-88` | CÒN MỞ (hiệu năng, giao agent perf) |

---

## 6. Gợi ý chia việc (theo nhóm file, không đụng nhau)

1. **Đợt tiền (opus):** A2-004 và A2-005 (`wallet`, `affiliate`, `cashback`, `orders`, `checkout`, cộng một migration).
2. **Đợt định danh (opus):** A2-001, A2-017 phần merge, nightly e64687732a (`auth`).
3. **Đợt tích hợp (sonnet):** A2-002 và A2-010 (`integrations/pancake`).
4. **Đợt schema (haiku/sonnet, một migration gộp):** A2-003, A2-008, A2-009, A2-011, A2-020, A2-022.
5. **Đợt test (sonnet, chỉ `test/integration-race`):** A2-015. Nên làm trước 1–4 hoặc song song.
6. **Đợt vận hành (sonnet):** A2-007 và A2-012 (module dọn mới, `@Cron`, compose).
7. **Đợt cấu trúc (sonnet, sau 5):** A2-013, A2-014, A2-021, A2-016.

---

## 7. Môi trường và ghi chú

- Container `tubu_pg` vừa khởi động lại (Up 5 phút lúc bắt đầu), nên `pg_stat_user_tables.n_live_tup` bằng 0. Tôi phải dùng `count(*)` để đo.
- Không có madge; đã thay bằng script tự viết, không tải gói từ mạng.
- DB tạm `tubutree_shadow_a2` và `tubutree_a2_probe` đã tạo và đã **xoá**. Không ghi gì vào `tubutree`, `tubutree_it` hay `tubutree_perf` (chỉ SELECT).

---

## 8. Quyết định nghiệp vụ cần chủ dự án

1. **Gộp tài khoản khách vào tài khoản Zalo khi cả hai đã điểm danh cùng ngày (A2-001):** xử lý lượt điểm danh trùng thế nào?
   - **(Khuyến nghị) Giữ cả hai lượt điểm đã cộng**, đổi khoá dòng của khách thành `MERGED:…` để giữ lịch sử. Lý do: điểm đã thuộc về khách, trừ lại gây khó chịu; số tiền nhỏ.
   - Chỉ giữ lượt của tài khoản Zalo và trừ điểm lượt của khách.
2. **Xoá địa chỉ đang dùng cho gói định kỳ (A2-003):**
   - **(Khuyến nghị) Chặn xoá** và báo "Địa chỉ đang dùng cho gói giao định kỳ X, hãy đổi địa chỉ gói trước". Lý do: không mất gói, khách chủ động.
   - Cho xoá nhưng chuyển gói sang PAUSED và gửi thông báo.
   - Cho xoá và tự chuyển gói sang địa chỉ mặc định.
3. **Sổ cái Ví Tubu (A2-004):** dữ liệu ví hiện có xử lý thế nào khi bắt đầu ghi sổ?
   - **(Khuyến nghị) Ghi một dòng "Số dư đầu kỳ" cho mỗi user tại ngày triển khai.** Lý do: chính xác tuyệt đối từ hôm đó trở đi; công sức S.
   - Dựng lại lịch sử từ 6 nguồn (payout, cashback, hoàn đơn, đơn trả ví, đổi xu, rút). Lý do không chọn: tốn công và không khớp 100% vì gộp khách không để lại vết.
4. **Đơn đại lý đặt trước (A2-002):** khi nào đẩy sang kho Pancake?
   - **(Khuyến nghị) Chỉ khi đủ 100% hàng** (đúng thiết kế đã duyệt ngày 12/09).
   - Tách đơn: phần có hàng đẩy ngay, phần đặt trước đẩy sau.
   - Đẩy ngay toàn bộ để kho tự xử lý. Nếu chọn hướng này thì phải bỏ cơ chế giữ chỗ backorder.
5. **Đánh giá khi mua lại (A2-024):**
   - **(Khuyến nghị) Giữ 1 đánh giá cho mỗi sản phẩm nhưng cho sửa khi mua lại**, hiển thị "đã mua N lần", chỉ thưởng điểm lần đầu. Lý do: chống farm điểm mà vẫn cập nhật được cảm nhận.
   - Cho 1 đánh giá cho mỗi đơn, thưởng điểm mỗi lần.
6. **Gói định kỳ trùng (A2-011):** có cho một khách đặt nhiều gói cùng sản phẩm không?
   - **(Khuyến nghị) Cho nhiều gói cùng sản phẩm chỉ khi khác địa chỉ** (ví dụ gửi bố mẹ), chặn trùng cùng địa chỉ.
   - Mỗi sản phẩm chỉ 1 gói đang hoạt động.
   - Không chặn (giữ như hiện tại).
7. **Thời hạn lưu dữ liệu (A2-007):**
   - **(Khuyến nghị) Sự kiện analytics thô giữ 13 tháng** (sau đó chỉ giữ số tổng hợp); thông báo trong app 180 ngày; payload webhook 90 ngày; phiên đăng nhập đã thu hồi 30 ngày. Lý do: đủ cho so sánh cùng kỳ năm trước và đối soát, giới hạn dung lượng trên VPS dùng chung.
   - Giữ vĩnh viễn và nâng ổ đĩa.
8. **Ngưỡng thưởng đại lý tối đa (A2-009):**
   - **(Khuyến nghị) Hỗ trợ ngưỡng và doanh số trên 2,1 tỷ đ** (chuyển cột sang BigInt). Lý do: đại lý VIP có doanh số quý hoặc năm có thể vượt mức này.
   - Giới hạn cứng 2 tỷ đ ở form admin.

---

## Phụ lục: lệnh đã chạy (rút gọn)

```bash
git rev-parse --short HEAD                                   # 080bc75
# Drift
docker exec tubu_pg psql -U tubu -d postgres -c "CREATE DATABASE tubutree_shadow_a2;"
cd apps/api && npx prisma validate && npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url <…/tubutree_shadow_a2> --exit-code   # No difference detected.
npx prisma migrate status                                    # 103 migrations … up to date
docker exec tubu_pg psql -U tubu -d postgres -c "DROP DATABASE tubutree_shadow_a2;"
# Đọc/ghi theo model (108 model): với mỗi model m, grep "\.m\.(find|count|aggregate|groupBy)" và "\.m\.(create|update|upsert|delete)" trong apps/api/src (bỏ spec)
# FK CASCADE và cột *Id không FK
docker exec tubu_pg psql -U tubu -d tubutree -At -c "select conrelid::regclass, conname, confrelid::regclass, confdeltype from pg_constraint where contype='f' and confdeltype='c'"
docker exec tubu_pg psql -U tubu -d tubutree -At -c "select c.table_name,c.column_name from information_schema.columns c where c.table_schema='public' and c.column_name ~ 'Id$' and not exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey) where k.contype='f' and k.conrelid=(quote_ident(c.table_name))::regclass and a.attname=c.column_name)"
# Partial index
docker exec tubu_pg psql -U tubu -d tubutree -At -c "select indexname, indexdef from pg_indexes where schemaname='public' and indexdef ilike '% where %'"   # 13 dòng
# Ví dụ Postgres abort-transaction (DB tạm tubutree_a2_probe, đã DROP): xem A2-001
# Bất biến sổ cái trên DB local: points_mismatch=0, coins_mismatch=0, wallet_nonzero=0; refresh_tokens 55 (48 thu hồi/hết hạn)
# Byte/dòng (tubutree_perf, chỉ SELECT): analytics_events 404, notification_logs 247, refresh_tokens 341, order_status_history 244
# Vòng phụ thuộc: node <scratchpad>/cycles.cjs D:/tubutree-mini-app/apps/api/src   → file-level 0, dir-level 3 SCC (12/2/2)
# Service lớn
find apps/api/src -name "*.ts" ! -name "*.spec.ts" -exec wc -l {} + | sort -rn | head
# Cron
grep -rn "@Cron(" apps/api/src --include=*.ts | grep -v spec      # 28, chỉ 1 có timeZone
# Migration chưa lên PROD
git diff --name-only 22e36d4 HEAD -- apps/api/prisma/migrations   # 12 migration
```

Script `cycles.cjs` (Tarjan trên import tương đối, bỏ `import type`) nằm trong scratchpad của phiên; muốn chạy lại thì chép vào `scripts/` (chưa làm vì giai đoạn này chỉ đọc).

---

## Kiểm chứng độc lập (verifier)

- **Ngày:** 2026-10-09 · **Commit:** `080bc75` (nhánh `hardening/2026-10`) · **Người kiểm:** verifier độc lập. Không tin báo cáo; kiểm lại từ code và lệnh.
- **Phạm vi:** báo cáo không có P0, nên kiểm toàn bộ 5 mục P1 (A2-001…A2-005). Kiểm nhanh thêm 3 mục P2 (A2-007, A2-012, A2-022) bằng grep/psql.
- **Phương pháp:**
  - Đọc code ở đúng file:line được dẫn, đọc thêm đường gọi phía miniapp.
  - Truy vấn `pg_constraint`/`pg_indexes` trên DB `tubutree` (chỉ SELECT).
  - Dùng `git show 22e36d4:<file>` để biết lỗi đã lên PROD chưa.
  - Dựng lại hành vi Postgres trên DB tạm riêng `tubutree_verify_a2` (đã tạo rồi DROP).
  - Không chạy test suite, không sửa source.
- **Giới hạn:** chưa chạy chính `mergeGuestInto` trên Postgres thật, vì phải dựng Nest DI cộng 103 migration mà máy chỉ còn khoảng 1,1 GB RAM trống lúc kiểm. Hành vi Prisma được suy ra từ hai nguồn: `PrismaService` là `PrismaClient` trần, không dùng savepoint (`apps/api/src/prisma/prisma.service.ts:1-13`); và ví dụ psql ở A2-001 bên dưới.

### Bảng phán quyết

| ID | Phán quyết | Mức đề xuất |
|---|---|---|
| A2-001 | **XÁC NHẬN cơ chế, nhưng tác động bị mô tả sai** (không chặn đặt hàng) | **Giữ P1**, sửa tiêu đề và tác động |
| A2-002 | **XÁC NHẬN** (lỗi đang chạy trên PROD) | **Giữ P1** |
| A2-003 | **XÁC NHẬN** (lỗi đang chạy trên PROD) | **Giữ P1** |
| A2-004 | **XÁC NHẬN phần chính**, một khẳng định nói quá | **Hạ P1 → P2** |
| A2-005 | **XÁC NHẬN** | **Giữ P1** |

### Bằng chứng từng mục

**A2-001 · Gộp khách→Zalo**
- **Cơ chế đúng:**
  - `auth.service.ts:245` mở `$transaction(async (tx)…)`. Các dòng `:296-315` bọc 4 lệnh `updateMany` trong `try/catch`, nuốt P2002 rồi chạy tiếp.
  - Index `points_transactions_checkin_day_key ("userId","refId") WHERE refType='CHECKIN'` có thật trên `tubutree`.
  - Điểm danh ghi `refType:'CHECKIN', refId: today` (`loyalty.service.ts:767-774`). Endpoint chỉ cần JWT, nên khách vãng lai cũng điểm danh được.
- **Probe psql trên DB tạm:**
  - `UPDATE points_transactions …` → `ERROR: duplicate key … points_transactions_checkin_day_key`.
  - Lệnh kế tiếp → `ERROR: current transaction is aborted…`.
  - `COMMIT` → `ROLLBACK`.
- Spec `auth.service.spec.ts:545` dùng fixture giả, nên đang xác nhận một hành vi không có thật.
- **Sai ở phần tác động: lỗi này không chặn đặt hàng.**
  - `miniapp/src/pages/checkout.tsx:734` gọi `ensurePhone().catch(() => undefined)` rồi vẫn `order.mutate`.
  - `store/auth.ts:196-219` nuốt lỗi và trả `null`.
- **Tác động thật: phiên khách bị kẹt vĩnh viễn.**
  - `upgradeGuestSilently` (`store/auth.ts:90-102`) thất bại âm thầm mỗi lần mở app, BE trả 500.
  - Đơn, điểm và giỏ mới tiếp tục ghi vào tài khoản khách.
  - Tài khoản Zalo thật (điểm, hạng, chuỗi điểm danh, đơn cũ) không vào được trên máy đó.
- **Kịch bản tự nhiên:** sáng khách điểm danh bằng Zalo. Tối Zalo SDK lỗi, app rơi về phiên khách. Khách điểm danh thêm lần nữa, và từ đó lần gộp nào cũng hỏng.
- **Chưa lên PROD:** `git show 22e36d4:…/auth.service.ts` không có `mergeGuestInto`.
- **Mức:** giữ P1. Sửa tiêu đề và tác động thành "kẹt phiên khách vĩnh viễn, không vào lại được tài khoản Zalo thật"; bỏ ý "chặn đặt hàng".

**A2-002 · Đơn đại lý backorder bị đẩy Pancake sớm**
- `pancake-push-reconcile.service.ts:47-52` chỉ lọc 3 điều kiện: `pancakeOrderId:null`, `status notIn CANCELLED`, `createdAt<cutoff`. Không lọc `type`, không lọc `backorderedQty`.
- `grep -rn -i backorder src/modules/integrations/pancake/` (bỏ spec) ra 0 dòng.
- `pancake-order.service.ts:79-84`: `pushOrder` chỉ chặn khi đơn đã có `pancakeOrderId`.
- Thiết kế cố ý không đẩy đơn còn backorder (`dealer.service.ts:264-272`).
- `dealer-backorder.service.ts:81-82` coi trường hợp "đã đẩy" là "không nên xảy ra — phòng thủ" và bỏ qua. Hệ quả sau khi reconcile đẩy sớm:
  - Lúc đơn đủ hàng, không có lần đẩy nào nữa vì đơn đã có `pancakeOrderId`.
  - Cron backorder **vẫn tiếp tục giữ kho** cho dòng đó, vì `:33-40` không lọc `pancakeOrderId`.
- **Đã có trên PROD:** commit backorder `11a174b` là tổ tiên của `22e36d4`, và `git show 22e36d4:…/pancake-push-reconcile.service.ts | grep -ci backorder` ra 0.
- **Mức:** giữ P1. Nên sửa sớm nhất trong nhóm P1 vì đang chạy trên PROD.

**A2-003 · Xoá địa chỉ thì gói định kỳ bị xoá theo**
- `schema.prisma:2159-2160` khai báo `address Address @relation(…, onDelete: Cascade)`.
- Trên DB: `subscriptions_addressId_fkey|addresses|c`. Hai FK `variationId_fkey` và `userId_fkey` cũng là `c`.
- `users.service.ts:110-114`: `deleteAddress` chỉ `assertOwner` rồi `address.delete`.
- Miniapp có đường xoá: `pages/addresses.tsx:39` gọi `account-api.ts:321-322` (`DELETE /me/addresses/:id`, `users.controller.ts:59`).
- **Đã có trên PROD:** `22e36d4:schema.prisma:1950` cũng là Cascade.
- **Mức:** giữ P1.

**A2-004 · Ví Tubu không có sổ cái**
- **Phần đúng:**
  - Không có model sổ ví: `grep -niE "^model .*(Wallet|Ledger|Payout)" schema.prisma` chỉ ra `Payout` và `DealerCreditLedger`.
  - Đủ 8 chỗ ghi số dư, đúng số dòng: `affiliate.service.ts:678,1100`, `cashback.service.ts:356`, `order-reversal.service.ts:122`, `checkout.service.ts:321-322`, `wallet.service.ts:93-94,177-178`, `auth.service.ts:325`.
  - Khách không có endpoint lịch sử ví: `wallet.controller.ts` chỉ có `GET me/wallet` và `GET me/coins`.
- **Phần nói quá:** câu "không có lịch sử nào để đối soát" không đúng hẳn. Phần lớn biến động **dựng lại được** từ bảng nguồn:
  - Rút hoa hồng về ví tạo `Payout(PAID)` (`affiliate.service.ts:679-681`).
  - Rút ngân hàng tạo `Payout`.
  - Cashback để lại dòng trong `cashback_transactions`.
  - Hoàn đơn để lại trạng thái trên đơn.
  - Chỉ gộp khách (`auth.service.ts:325`) và đổi xu là không có vết VND trực tiếp.
- Theo audit 03 (`03-retention-loops.md:141`), ví của khách mua thường "gần như luôn 0đ", nên rủi ro tập trung ở CTV.
- **Mức:** hạ P1 → P2. Đây là nợ thiết kế/tính năng (sao kê, bất biến đối soát), không phải lỗi làm sai tiền. Giữ P1 nếu chủ dự án muốn có sao kê ví trước khi mở rút tiền rộng rãi.

**A2-005 · Hoa hồng CTV tạo ngoài transaction**
- `checkout.service.ts:424-427` và `affiliate.service.ts:404-406` gọi `createCommissionForOrder(...).catch(log)` sau khi transaction của đơn đã commit, và sau cả bước enqueue Pancake/Gomdon.
- `affiliate.service.ts:491` dùng `commission.create` trần.
- `pg_indexes` của `commissions` chỉ có `pkey`, `(affiliateUserId,status)` và `(orderId)`. Không có unique.
- Ngoài `:491` không còn chỗ nào gọi `commission.create`. Cron duy nhất trong affiliate (`:757`) là cron nhả hold, không phải cron bù.
- **Tác nhân thực tế:** lỗi pool timeout (P2024) lúc cao điểm flash sale, hoặc restart khi deploy.
- **Mức:** giữ P1.

### Kiểm thêm các mục P2 (ngoài phạm vi bắt buộc)

| ID | Phán quyết | Bằng chứng |
|---|---|---|
| A2-012 | XÁC NHẬN (lệch số nhỏ) | Grep thô ra 29 dòng `@Cron(`, trong đó 1 dòng là comment ở `main.ts:84`. Vậy đúng **28 decorator**, chỉ 1 cái có `timeZone` (`analytics-aggregation.service.ts:36`). `grep -n "TZ\|timezone"` trên `docker-compose.vietnix.yml`, `docker-compose.prod.yml` và `apps/api/Dockerfile` ra rỗng. |
| A2-022 | XÁC NHẬN | `pg_indexes … indexdef ILIKE '% where %'` trên `tubutree` trả đúng 13 index, khớp danh sách trong báo cáo. |
| A2-007 (phần `/events`) | XÁC NHẬN | `analytics.controller.ts:17-27` throttle theo header `x-device-id` do client tự đặt. Endpoint không có `@Public` nên cần JWT, nhưng JWT khách lấy tự do qua `loginGuest`. `main.ts:58` đặt `json({ limit: '10mb' })`. |

### Tổng kết verifier

- **Đã kiểm 5 mục P1:** XÁC NHẬN 5, trong đó A2-001 và A2-004 xác nhận kèm hiệu chỉnh. BÁC BỎ 0, LỖI THỜI 0, CHƯA RÕ 0.
- **Đổi mức:** A2-004 từ P1 xuống P2, vì đây là nợ thiết kế và phần lớn dựng lại được từ `payouts`, `cashback_transactions` và đơn. Các mục khác giữ nguyên mức.
- **Hiệu chỉnh nội dung:** A2-001 không chặn đặt hàng. Tác động đúng là phiên khách kẹt vĩnh viễn và tài khoản Zalo thật không vào được trên máy đó.
- **Ưu tiên theo PROD:**
  - A2-002 và A2-003 **đang chạy trên PROD** (`22e36d4`).
  - A2-001 hiện chỉ có ở main và nhánh hardening, sẽ lên PROD ở lần deploy tới. Cần sửa **trước** lần deploy đó.
- **Môi trường:**
  - DB tạm `tubutree_verify_a2` đã tạo rồi DROP. Không ghi gì vào `tubutree`, `tubutree_it` hay `tubutree_perf`.
  - RAM trống lúc kiểm khoảng 1,1/15,5 GB, nên không chạy migrate deploy hay jest.

---

## Kiểm chứng độc lập (verifier) — lượt 2

- **Ngày:** 2026-10-09 · **Commit:** `080bc75` (nhánh `hardening/2026-10`). Phiên tiếp tục, kiểm lại độc lập cả báo cáo A2 lẫn mục verifier lượt 1 ở trên. Không sửa phần nào phía trên.
- **Phạm vi:** báo cáo có 0 P0, 5 P1 (A2-001…A2-005). Kiểm đủ 5 mục.
- **Phương pháp:** đọc code đúng file:line được dẫn; `git show 22e36d4:<file>` để biết lỗi đã lên PROD chưa; `pg_indexes`/`pg_constraint` trên `tubutree` (chỉ SELECT). Tự dựng lại hành vi Postgres trên DB tạm riêng `tubutree_verify2_a2` (tạo rồi DROP).
- **Giới hạn:** không chạy test suite và không chạy `mergeGuestInto` qua Nest DI thật (RAM trống khoảng 2,1/15,5 GB). Hành vi Prisma suy ra từ: `$transaction` không dùng savepoint, cộng với probe psql bên dưới.

| ID | Phán quyết | Bằng chứng (lượt 2) | Mức đề xuất |
|---|---|---|---|
| A2-001 | **XÁC NHẬN** cơ chế. Đồng ý với hiệu chỉnh của lượt 1: lỗi **không chặn đặt hàng**, mà làm **kẹt phiên khách vĩnh viễn** | `auth.service.ts:245` mở `$transaction`; `:296-315` bọc 4 `updateMany` trong try/catch nuốt P2002 (`isUniqueViolation` ở `:370-372` chỉ so `code==='P2002'`). Index `points_transactions_checkin_day_key ("userId","refId") WHERE refType='CHECKIN' AND refId IS NOT NULL` có trên `tubutree`. Điểm danh ghi `refType:'CHECKIN', refId: today` (`loyalty.service.ts:767-774`). `POST me/loyalty/check-in` (`loyalty.controller.ts:70-73`) không có `@Roles`, nên khách vãng lai gọi được. Probe psql lượt 2: `UPDATE points_transactions` → `ERROR duplicate key … checkin_day_key`; `UPDATE coin_transactions` → `ERROR current transaction is aborted`; `COMMIT` → `ROLLBACK`; dòng coin vẫn ở `guest`. Lỗi thứ 2 không phải P2002, nên bị ném ra; `PrismaExceptionFilter` trả 500. Phía FE: `checkout.tsx:734` gọi `ensurePhone().catch(() => undefined)` rồi vẫn `order.mutate`; `store/auth.ts:196-219` nuốt lỗi; `upgradeGuestSilently` (`store/auth.ts:91-102`, gọi ở `:156`) cũng nuốt lỗi. Spec `auth.service.spec.ts:544` dùng `$transaction` giả (`:379`, gọi thẳng `cb(base)`), nên không tái hiện được abort. PROD `22e36d4` không có `mergeGuestInto` (grep ra 0). | **Giữ P1**: sửa trước lần deploy tới. Tiêu đề nên đổi thành "kẹt phiên khách, không gộp được vào tài khoản Zalo thật" |
| A2-002 | **XÁC NHẬN** | `pancake-push-reconcile.service.ts:47-52` chỉ lọc `pancakeOrderId:null`, `status notIn CANCELLED`, `createdAt<cutoff`. Vòng lặp `:73-107` không có nhánh nào cho backorder. `grep -rni backorder src/modules/integrations/pancake` (bỏ spec) ra 0. `pancake-order.service.ts:79-84` chỉ chặn đơn đã có `pancakeOrderId`. Thiết kế cố ý không đẩy đơn còn backorder (`dealer.service.ts:264-272`). `dealer-backorder.service.ts:79-82` bỏ qua đơn đã có `pancakeOrderId` ("không nên xảy ra"), còn `:33-40` vẫn giữ kho cho dòng đó. PROD: `11a174b` là tổ tiên của `22e36d4`; reconcile của `22e36d4` cũng chỉ lọc 3 điều kiện trên (dòng 35-36). | **Giữ P1**: đang chạy trên PROD |
| A2-003 | **XÁC NHẬN** | `schema.prisma:2159` khai báo `address … onDelete: Cascade`. Trên DB: `subscriptions_addressId_fkey` → `addresses`, `confdeltype=c`, và cả `userId`, `variationId` cũng là `c`. `users.service.ts:110-114` chỉ `assertOwner` rồi `address.delete`. Miniapp `pages/addresses.tsx:38-39` gọi `account-api.ts:321-322` (`DELETE /me/addresses/:id`). PROD `22e36d4:schema.prisma:1950` cũng là Cascade, và `deleteAddress` giống hệt. | **Giữ P1**: đang chạy trên PROD |
| A2-004 | **XÁC NHẬN** phần chính (không có model sổ ví; `grep "^model .*(Wallet\|Ledger\|Payout)"` chỉ ra `Payout`, `DealerCreditLedger`). 8 chỗ ghi đúng dòng: affiliate `:678,1100`, auth `:325`, cashback `:356`, checkout `:321-322`, reversal `:122`, wallet `:93-94,177-178`. Không có raw SQL ghi `"walletBalance"` | Đồng ý với lượt 1 rằng câu "không có lịch sử nào" nói quá. Rút về ví tạo `Payout(WALLET_BALANCE, PAID)` (`affiliate.service.ts:678-681`). Rút ngân hàng tạo `Payout(BANK)` (`wallet.service.ts:180-182`). Cashback có `cashback_transactions.status=PAID, paidAt` (`cashback.service.ts:347-358`). Đổi xu để lại `coin_transactions(CONVERT_FROM_WALLET)` (`wallet.service.ts:98-106`), nhưng ghi số xu chứ không ghi số VND. Hoàn đơn để lại trạng thái trên đơn. Chỉ gộp khách là không có vết trực tiếp. | **Hạ P1 → P2** (đồng ý với lượt 1; ranh giới). Nâng lại P1 nếu chủ dự án muốn có sao kê ví trước khi mở rút tiền rộng |
| A2-005 | **XÁC NHẬN** | `checkout.service.ts:424-427` và `affiliate.service.ts:404-406` gọi `createCommissionForOrder(...).catch(log)`, sau khi tx đơn commit và sau cả bước enqueue Pancake/Gomdon. `affiliate.service.ts:491` dùng `commission.create` trần, ngoài tx, rate đọc lại lúc đó. `pg_indexes` của `commissions` chỉ có `pkey`, `(affiliateUserId,status)`, `(orderId)`; không có unique. Toàn `src` chỉ có 1 chỗ `commission.create` (`:491`) và 2 caller. `@Cron` duy nhất của affiliate (`:757`) là cron nhả hold, không phải cron bù. | **Giữ P1** |

**Tổng kết lượt 2:**
- Đã kiểm 5 mục: XÁC NHẬN 5, BÁC BỎ 0, LỖI THỜI 0, CHƯA RÕ 0. Kết quả trùng với lượt 1.
- **Đổi mức:** chỉ A2-004, từ P1 xuống P2.
- **Hiệu chỉnh:** sửa tiêu đề và tác động của A2-001 như trên.
- **Thứ tự ưu tiên:**
  - A2-002 và A2-003 đang chạy trên PROD.
  - A2-001 sẽ lên PROD ở lần deploy tới; phải sửa trước đó.
- DB tạm `tubutree_verify2_a2` đã DROP. Không ghi gì vào `tubutree`.
