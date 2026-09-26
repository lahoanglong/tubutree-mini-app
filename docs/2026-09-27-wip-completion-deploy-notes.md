# Ghi chú deploy + UAT: hoàn thiện WIP (nhánh `feat/complete-wip-2026-09`)

Ngày viết: 2026-09-27. Commit cần deploy: `b756c4a`. Prod đang chạy: `22e36d4` trên VPS Vietnix
(`/opt/tubutree`, `docker-compose.vietnix.yml`, xem `ops/README-vietnix-deploy.md`).

Tài liệu này dành cho người deploy và người chạy UAT. Mọi file, migration, biến môi trường, khoá cấu
hình, endpoint và mã mẫu thông báo nhắc tới dưới đây đều đã được đối chiếu trong repo. Những gì chưa
kiểm được (chủ yếu là trạng thái thật của DB/VPS prod và phía Gomdon) nằm ở mục 12. Người viết không
chạy lệnh nào trên DB hay VPS.

---

## 0. Đọc trước khi làm gì

- **Cron thưởng quý đại lý.** Code đang chạy trên prod trả thưởng quý vào 04:00 ngày 1 tháng đầu
  quý (`@Cron('0 0 4 1 1,4,7,10 *')`). Nếu đến **01/10 04:00** prod vẫn chạy `22e36d4`, cron cũ sẽ trả
  thưởng Q3 theo luật cũ (tính cả đơn chưa thanh toán, chưa đóng gói). Code mới không trả lại lần hai
  và cũng không truy thu phần chênh lệch. Muốn Q3 tính theo luật mới thì phải deploy trước mốc đó.
  Xem mục 8.3.
- **Thưởng mốc CTV phát xu ngay khi deploy.** Doanh số tháng được tính lại từ dữ liệu cũ (backfill),
  và CTV nhận được mốc của cả tháng trước lẫn tháng này. Xem mục 8.1 để ước lượng số xu trước khi
  mở.
- **Nhánh chưa có trên remote.** `feat/complete-wip-2026-09` không có upstream và chưa được push.
  `origin/main` (`3abddcf`) là tổ tiên của `b756c4a`, nên `main` fast-forward được. Việc push hay merge
  do chủ shop quyết.
- **Đừng chạy lại toàn bộ seed trên prod nếu đã có dữ liệu thật.** Migration đã tự chèn các dòng cần
  thiết. Seed vẫn ghi đè giá sản phẩm, hạng và mọi khoá cấu hình không đánh dấu `createOnly`. Xem mục 5.3.
- **Biến GOMDON_\*.** Nếu đặt `GOMDON_PHONE` và `GOMDON_PASSWORD` mà thiếu `GOMDON_WEBHOOK_SECRET`, API
  production **không boot**. Hãy đặt đủ ba biến cùng lúc, hoặc để trống cả ba.

---

## 1. Tóm tắt: người dùng được gì

### 1.1. Thu gom vật liệu tái chế lúc thanh toán (Gomdon / BestExpress, "đơn đổi hàng")

Ở màn thanh toán (Mini App và web shop), khách thấy thêm lựa chọn **"Gửi lại vật liệu tái chế (Bảo
vệ môi trường)"**, kèm ô ghi chú loại vật dụng (pin, vỏ hộp sữa, túi nilon...). Khi khách chọn, hệ
thống đặt một vận đơn "đổi hàng" qua Gomdon: bưu tá BestExpress giao hàng rồi nhận lại vật liệu tái
chế trong cùng một lần ghé. Lượng thu gom tối đa xấp xỉ cân nặng của đơn. Đơn COD được đặt vận đơn
ngay. Đơn trả trước chỉ được đặt vận đơn **sau khi tiền về**.

Ở chi tiết đơn, khách thấy trạng thái thu gom thật: "Đang đặt lịch thu gom", "Chờ thanh toán", "Đã
đặt lịch thu gom" (kèm mã vận đơn BestExpress), "CSKH sẽ liên hệ hẹn thu gom", "Đã huỷ thu gom"...
Khi bưu tá đã lấy hàng, khách không tự huỷ đơn được nữa.

Tính năng **tắt mặc định**. Lựa chọn chỉ hiện khi đã đặt đủ tài khoản Gomdon qua biến môi trường VÀ
admin đã bật công tắc `shipping.gomdon.recycling_enabled`.

### 1.2. Mốc thưởng CTV trả bằng Tubu Xu

CTV có bảng **"Thưởng Mốc Doanh Số Tháng"** với 4 mốc (định nghĩa ở
`apps/api/src/modules/affiliate/ctv-milestones.ts`):

| Mốc | Doanh số đã chốt trong tháng | Thưởng |
|---|---|---|
| `milestone-3m` | 3.000.000đ | 50.000 xu |
| `milestone-10m` | 10.000.000đ | 200.000 xu |
| `milestone-30m` | 30.000.000đ | 600.000 xu |
| `milestone-80m` | 80.000.000đ | 2.000.000 xu |

Thưởng được cộng vào **Tubu Xu** (`coinsBalance`, chỉ tiêu trong app, không rút được), không phải Ví
rút tiền. Mỗi (CTV, mốc, tháng) chỉ nhận được một lần; unique index trong DB là chốt chặn thật. CTV
nhận được mốc của tháng này và của tháng trước. Bậc CTV (Tân binh → Kim Cương) giờ chỉ còn là danh
hiệu: lời hứa "+X% bonus hoa hồng" đã bị gỡ vì chưa từng có luồng nào trả khoản đó.

### 1.3. Loyalty (Điểm Xanh)

- **Điểm danh riêng cho Điểm Xanh**, tách khỏi điểm danh hạt giống của Vườn Xanh. Vòng 7 ngày theo
  giờ Việt Nam, lỡ một ngày thì vòng bắt đầu lại. Mặc định `[1,1,1,1,1,1,2]` = 8 điểm/tuần (khoảng
  8.000đ). Mỗi ngày chỉ nhận một lần, có unique index chặn trong DB.
- **Đổi quà**: đổi Điểm Xanh lấy voucher cá nhân (Freeship 20 điểm, giảm 50k 50 điểm, giảm 15% 75
  điểm, giảm 100k 100 điểm). Voucher có hạn 30 ngày và vào ngay "Kho voucher".
- **Thẻ thành viên số có mã QR thật**: mã dạng `TUBU<referralCode>`, đúng chuỗi mà màn thu ngân quét.
- **Tích điểm hoá đơn tại quầy (POS)**: nhân viên tích Điểm Xanh cho hoá đơn mua tại cửa hàng. Tính năng
  **tắt mặc định**, có trần theo hoá đơn/nhân viên/thành viên, chống bấm đúp theo mã hoá đơn, và mọi
  lượt tích đều được ghi vào sổ audit.

### 1.4. Thưởng mốc đại lý: yêu cầu nhận, admin duyệt, xác nhận chuyển khoản

Trước đây nút "nhận thưởng" của đại lý chỉ ghi một dòng log, không lưu gì. Giờ yêu cầu được lưu vào
DB theo vòng đời `PENDING → APPROVED | REJECTED`, rồi `APPROVED → PAID`. Admin được báo khi có yêu cầu
mới, và đại lý được báo ở từng bước. Đại lý còn 30 ngày sau khi kỳ kết thúc để gửi yêu cầu cho mốc
đã đạt. Ngoài ra, admin giờ **xác nhận được chuyển khoản** cho đơn đại lý trả trước. Trước đây chỉ
webhook Pancake lật được PAID, nên đơn kẹt UNPAID mãi và không bao giờ được tính doanh số.

### 1.5. Web admin

- Hàng đợi **"Cần xử lý thu gom"** trong tab Đơn hàng, với các thao tác "Tạo lại vận đơn Gomdon", "Huỷ
  vận đơn Gomdon", "Đã xử lý tay".
- Form cấu hình **Gomdon** (kho lấy hàng, cân nặng mặc định, công tắc checkout; tài khoản và secret
  chỉ hiện "đã đặt/chưa đặt") và form **Điểm Xanh** (bảng điểm danh 7 ngày, công tắc và trần POS).
- `GET /admin/config` giờ che mọi khoá/trường chứa `password|secret|token`.
- **Màn thu ngân** `/admin/pos` (STAFF và ADMIN) và **sổ tích điểm tại quầy** (tab "Tích điểm tại
  quầy", chỉ ADMIN).
- Tab **"Thưởng đại lý"** để duyệt, từ chối và đánh dấu đã trao. Có khối xác nhận chuyển khoản cho
  đơn đại lý trả trước.
- Sửa lỗi lọc danh sách: trước đây `?status=`/`?search=` ở danh sách đơn, hồ sơ đại lý và đổi/trả đều
  trả 400. Hàng chờ duyệt giờ xếp cũ nhất lên trước, có tổng và nút tải thêm. Trang merchant hết trắng
  màn.

### 1.6. Siết tiền và kho

- **Khách huỷ đơn**: tiền được hoàn bất cứ khi nào DB ghi PAID ngay lúc huỷ (khoá dòng đơn, dùng guard
  `PAID→REFUNDED` trong transaction), không dựa vào bản đọc cũ. Hoàn về Ví Tubu, hoặc về xu nếu đơn
  trả bằng xu.
- Webhook thanh toán Pancake không còn "hồi sinh" đơn vừa huỷ thành PAID+CONFIRMED.
- Hoàn kho cho đơn đại lý đặt trước đọc lại `backorderedQty` dưới `FOR UPDATE`, nên cron lấp hàng chen
  giữa không làm kẹt kho nữa.
- Điểm Xanh của đơn còn trong hạn đổi/trả (hoặc đang có yêu cầu đổi/trả) chưa đổi quà hay tiêu ở
  checkout được.
- Thưởng quý đại lý chỉ tính trên doanh số đã chốt. Khi đơn bị huỷ/trả sau lúc chi trả, hệ thống chỉ
  thu hồi phần biên của đúng đơn đó.
- Hạn đổi/trả tính từ `orders.deliveredAt` thật, không còn tính từ `updatedAt`.
- Hoa hồng CTV chỉ chốt khi đơn vẫn còn DELIVERED.

### 1.7. Đi kèm: `3abddcf` (đã lên prod ngày 26/09 rồi rollback)

Đợt này mang lại toàn bộ `3abddcf`: thống kê theo sản phẩm cho CTV, huy hiệu bậc CTV công khai trên
trang gian hàng, gian hàng vào sitemap kèm twitter card, mẫu gian hàng dựng sẵn theo danh mục, cron
nhắc sản phẩm nổi bật còn thiếu (thứ Hai 09:00 theo giờ container), sửa lỗi idempotency của checkout,
và sửa lỗi panel đơn admin/merchant hiện "undefined".

---

## 2. Phạm vi thay đổi so với prod

`git log --oneline 22e36d4..HEAD`:

| Commit | Nội dung |
|---|---|
| `3abddcf` | QC go-live, 5 nâng cấp gian hàng CTV, 2 bugfix (đã deploy 26/09 rồi rollback) |
| `14a8e59` | Hoàn thiện 5 tính năng WIP (thu gom Gomdon, mốc CTV, loyalty, thưởng đại lý, admin) |
| `579d30d` | E2E miniapp chặn gọi API thật, race test trên Postgres thật |
| `b6dba99` | Merge `origin/main` (`3abddcf`) vào nhánh |
| `b756c4a` | Vá 23 lỗi từ review phản biện (tiền, kho, thu gom, admin) |

`git diff --stat 22e36d4..HEAD`: 200 file, +24.470 / −927 dòng.

Theo commit message của `b756c4a`: 2060 test API, 179 test miniapp, 135 test web, 39 e2e miniapp và
16 race test trên Postgres thật đều xanh. Race test nằm ở `apps/api/test/integration-race/`, e2e ở
`apps/e2e/tests/*.miniapp.spec.ts`. Người viết tài liệu này không chạy lại các bộ test đó.

### 2.1. Endpoint mới hoặc đổi hành vi (lấy từ controller, tiền tố `/api`)

| Endpoint | Quyền | Mới/đổi |
|---|---|---|
| `POST /webhooks/gomdon` (header `x-webhook-token` hoặc `?token=`) | Public + secret | Mới |
| `POST /webhooks/gomdon/:token` | Public + secret | Mới |
| `GET /config/public` | Public | Thêm `recyclingEnabled` (boolean) |
| `POST /checkout/quote`, `POST /checkout/place-order` | Khách | Nhận thêm `hasRecyclingPickup`, `recyclingNote`; trả 400 nếu gửi `true` khi tính năng tắt |
| `GET /me/loyalty/check-in`, `POST /me/loyalty/check-in` | Khách | Mới |
| `GET /me/loyalty/rewards`, `POST /me/loyalty/rewards/:id/redeem` | Khách | Mới (đổi quà giới hạn 10 lần/phút) |
| `GET /me/loyalty/member-card` | Khách | Mới |
| `POST /loyalty/staff/scan-member`, `POST /loyalty/staff/pos-credit` | STAFF, ADMIN | Mới |
| `GET /affiliate/tiers`, `GET /affiliate/milestones` | CTV | Mới |
| `POST /affiliate/milestones/:id/claim` (body `month` tuỳ chọn, `YYYY-MM`) | CTV | Mới |
| `GET /affiliate/dashboard` | CTV | `monthRevenue`/`tier` theo doanh số đã chốt, bỏ `bonusPct` |
| `POST /dealer/rewards/:id/claim` (body `periodKey` `Q3/2026` hoặc `2026`, `note`) | Đại lý | Mới |
| `GET /admin/orders?recycling=attention\|all` | ADMIN | Thêm bộ lọc thu gom; sửa lỗi 400 khi lọc |
| `POST /admin/orders/:id/gomdon/retry` (body `confirmedNoWaybill`) | ADMIN | Mới |
| `POST /admin/orders/:id/gomdon/cancel-waybill` | ADMIN | Mới |
| `POST /admin/orders/:id/gomdon/mark-handled` (body `note`) | ADMIN | Mới |
| `GET /admin/gomdon/status` | ADMIN | Mới, chỉ trả boolean |
| `GET /admin/config`, `PUT /admin/config` | ADMIN | Che secret khi đọc; kiểm luật cho khoá mới khi ghi |
| `GET /admin/dealer-reward-claims` | ADMIN | Mới |
| `POST /admin/dealer-reward-claims/:id/approve` \| `/reject` (bắt buộc `reason`) \| `/mark-paid` | ADMIN | Mới |
| `POST /admin/dealer-orders/:id/confirm-payment` (body `bankRef`, `note`) | ADMIN | Mới |
| `GET /admin/loyalty/pos-credits` | ADMIN | Mới |
| `GET /admin/dealer-applications`, `GET /admin/return-requests` | ADMIN | Thêm `order=asc\|desc`; sửa lỗi 400 khi lọc |
| `GET /storefront/me/stats`, `POST /storefront/me/apply-template` | CTV | Mới (từ `3abddcf`) |
| `GET /storefront/public-list` | Public | Mới (từ `3abddcf`) |

Không có route nào bị xoá.

---

## 3. Migration

### 3.1. Đếm và kiểm trước

`git ls-tree 22e36d4 apps/api/prisma/migrations` cho 91 thư mục migration (cộng `migration_lock.toml`).
Ở HEAD có 98. Như vậy có **7 migration mới**. `20260918190013_storefront_last_reminder_at` đến từ
`3abddcf`: nó đã được áp ngày 26/09 rồi được gỡ tay khi rollback (bỏ cột, bỏ dòng
`_prisma_migrations`, bỏ template `nt-storefront-trending`), nên hiện **chưa áp trên prod** và sẽ chạy
lại.

Migration tự chạy khi container api khởi động (`apps/api/Dockerfile`:
`pnpm exec prisma migrate deploy && node dist/main.js`). Trước khi deploy, hãy chạy các câu chỉ-đọc sau
trên prod:

```sql
-- Kỳ vọng: 91 | 20260916010000_add_storefront_owner_unique
SELECT count(*) AS da_ap, max(migration_name) AS moi_nhat
FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;

-- Kỳ vọng: 0 dòng (không có migration dở dang)
SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL;

-- Hai câu dưới phải CÙNG ra 0 dòng. Nếu dòng migration còn mà cột đã mất (hoặc ngược lại),
-- migrate deploy sẽ bỏ qua / vỡ, và code mới lỗi khi đọc storefronts.
SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260918190013_storefront_last_reminder_at';
SELECT 1 FROM information_schema.columns
WHERE table_name = 'storefronts' AND column_name = 'lastReminderAt';
```

### 3.2. Bảy migration, theo thứ tự áp

| # | Migration | Schema | Dữ liệu |
|---|---|---|---|
| 1 | `20260918190013_storefront_last_reminder_at` | + `storefronts.lastReminderAt` (nullable) | Không |
| 2 | `20260919220000_order_recycling_gomdon` | + `orders.hasRecyclingPickup` (NOT NULL DEFAULT false), `recyclingNote`, `gomdonOrderId`, `gomdonPartnerCode`, `gomdonStatus`; 2 index | Không |
| 3 | `20260926100000_gomdon_webhook_events_and_state` | + `orders.gomdonStatusAt`, `gomdonCancelStatus`, `deliveredAt`; index `(hasRecyclingPickup, gomdonStatus)`; bảng `gomdon_webhook_events` | **Backfill `orders.deliveredAt`**; **chèn** 3 config + 1 template |
| 4 | `20260926110000_ctv_milestone_claims` | + `commissions.commissionableTotal` (INT NOT NULL DEFAULT 0); bảng `ctv_milestone_claims` (unique `userId, milestoneId, monthKey`) | **Backfill `commissionableTotal`** |
| 5 | `20260926120000_loyalty_checkin_pos` | Bảng `loyalty_check_ins`, `pos_point_credits`; 2 partial unique index trên `points_transactions` | Không |
| 6 | `20260926130000_dealer_reward_claims` | Enum `DealerRewardClaimStatus`; bảng `dealer_reward_claims` | **Chèn** 1 config + 4 template |
| 7 | `20260927100000_dealer_bonus_adjusted_template` | Không đổi schema | **Chèn** 1 template |

Mọi thay đổi schema đều là **thêm mới**: không cột nào bị sửa hay xoá. Migration 2, 4 và 6 không có
`IF NOT EXISTS`, còn migration 3 và 5 có. Điều này quan trọng khi rollback (mục 10).

### 3.3. Backfill và dữ liệu được chèn

**`orders.deliveredAt` (migration 3).** Lấy mốc chuyển DELIVERED cuối cùng trong
`order_status_history`. Đơn DELIVERED cũ không có vết lịch sử thì dùng `updatedAt`, giữ đúng hành vi
cũ. Từ giờ `OrderStatusService` ghi `deliveredAt` mỗi khi đơn lật sang DELIVERED (cả đường Pancake lẫn
Gomdon đều đi qua service này).

**`commissions.commissionableTotal` (migration 4).** Bằng tổng `order_items.total` của các dòng có
hưởng hoa hồng (`affiliateRate > 0`, sản phẩm không `affiliateBlocked`). Backfill dùng rate và cờ chặn
**hiện tại**, nên nếu rate đã đổi sau lúc đặt đơn thì số backfill theo giá trị mới. Commission không
khớp dòng nào giữ nguyên 0 (không tính vào mốc).

**Dòng cấu hình và mẫu thông báo**: xem mục 5.

### 3.4. Khoá ghi trong lúc migrate

Migration 5 dựng hai partial unique index trên `points_transactions` bằng `CREATE UNIQUE INDEX` (không
`CONCURRENTLY`), chạy trong transaction của migration. Trong lúc dựng, mọi lệnh ghi vào
`points_transactions` phải chờ. Migration 3 (UPDATE + index trên `orders`) và migration 4 (UPDATE
`commissions`) cũng khoá ghi trên hai bảng đó trong thời gian chạy. Với cách deploy hiện tại, container
api cũ đã dừng khi container mới chạy `migrate deploy`, nên không có request nào bị chặn thêm: API
vốn đang down trong mấy giây đó. Chỉ cần lưu ý nếu có ai chạy migration riêng trong khi API cũ vẫn
phục vụ.

### 3.5. Sau khi rollout: chạy lại backfill cho các dòng còn sót

Chạy lại backfill `commissionableTotal`, **chỉ cho dòng còn bằng 0**. Code mới luôn ghi
`commissionableTotal > 0` khi tạo commission (commission chỉ được tạo khi có ít nhất một dòng hưởng hoa
hồng), nên câu này chỉ đụng các dòng do code cũ tạo. Ví dụ: commission sinh ra trong một khoảng
rollback về `22e36d4` rồi deploy lại, vì lúc đó migration không chạy lại. SQL dưới đây chép nguyên
từ migration, chỉ thêm điều kiện cuối:

```sql
UPDATE "commissions" AS c
SET "commissionableTotal" = sub."commissionable"
FROM (
  SELECT c2."id", SUM(oi."total")::INTEGER AS "commissionable"
  FROM "commissions" c2
  JOIN "order_items" oi ON oi."orderId" = c2."orderId"
  JOIN "variations" v ON v."id" = oi."variationId"
  JOIN "products" p ON p."id" = v."productId"
  WHERE COALESCE(v."affiliateRate", 0) > 0
    AND p."affiliateBlocked" = false
  GROUP BY c2."id"
) AS sub
WHERE sub."id" = c."id"
  AND c."commissionableTotal" = 0;
```

Backfill `deliveredAt` vốn đã idempotent (`WHERE "deliveredAt" IS NULL`). Chạy lại cũng an toàn, và
nên chạy trong cùng tình huống trên (đơn giao trong lúc đang chạy code cũ):

```sql
UPDATE "orders" AS o
SET "deliveredAt" = h."at"
FROM (
  SELECT "orderId", MAX("createdAt") AS "at"
  FROM "order_status_history"
  WHERE "toStatus" = 'DELIVERED'
  GROUP BY "orderId"
) AS h
WHERE o."id" = h."orderId" AND o."deliveredAt" IS NULL;

UPDATE "orders" SET "deliveredAt" = "updatedAt" WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NULL;
```

### 3.6. Chèn lại mẫu thông báo nhắc gian hàng (bị xoá khi rollback 26/09)

Mẫu `STOREFRONT_TRENDING_PRODUCTS` (id `nt-storefront-trending`) chỉ có trong `apps/api/prisma/seed.ts`,
không migration nào chèn. Lần rollback 26/09 đã xoá nó khỏi prod. Nếu thiếu mẫu này, cron nhắc thứ Hai
vẫn gửi được, nhưng với câu trung tính mặc định (`NotificationsService` ghi log cảnh báo thiếu mẫu).
Nếu không chạy seed thì chèn tay bằng câu dưới (nội dung chép từ seed):

```sql
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-storefront-trending', 'STOREFRONT_TRENDING_PRODUCTS', 'INAPP',
   '✨ Có {{count}} sản phẩm nổi bật (như {{sample}}) bạn chưa thêm vào gian hàng — thêm ngay để không bỏ lỡ khách quan tâm!')
ON CONFLICT DO NOTHING;
```

---

## 4. Biến môi trường (apps/api)

Định nghĩa ở `apps/api/src/config/env.validation.ts`, mẫu ở `.env.production.example`, logic đọc ở
`apps/api/src/modules/integrations/gomdon/gomdon-config.ts`.

| Biến | Ý nghĩa |
|---|---|
| `GOMDON_BASE_URL` | Để trống ở production thì dùng `https://admin.gomdon.com.vn`. Ở dev/test, để trống nghĩa là **tắt** (máy dev không bao giờ tự đặt bưu tá thật). Thường để trống trên prod. |
| `GOMDON_PHONE` | Tài khoản Gomdon. Được ưu tiên hơn `phone` nằm trong SystemConfig (fallback cho bản WIP cũ). |
| `GOMDON_PASSWORD` | Mật khẩu Gomdon. Không commit, không nhập vào tab Cấu hình (sẽ nằm trong DB và lịch sử cấu hình). |
| `GOMDON_WEBHOOK_SECRET` | Token chia sẻ để xác thực webhook. Để trống ở production thì **mọi webhook bị 401** (fail-closed). |

**Luật boot:** ở `NODE_ENV=production`, nếu `GOMDON_PHONE` **và** `GOMDON_PASSWORD` đều có giá trị mà
`GOMDON_WEBHOOK_SECRET` trống, validation báo lỗi và **API không khởi động**. Container sẽ restart liên
tục, tức là prod down. Luật này không bắt được trường hợp mật khẩu nằm trong SystemConfig thay vì env
(khi đó webhook âm thầm bị 401). Đó thêm một lý do để chuyển mật khẩu sang env (mục 5.4).

**Docker compose:** service `api` trong `docker-compose.vietnix.yml` dùng `env_file: .env`, nên mọi biến
trong `/opt/tubutree/.env` đều vào container. **Không cần sửa compose**, chỉ cần thêm bốn dòng vào
`.env` trên VPS. Viết comment trên dòng riêng, vì `env_file` của docker không hiểu comment cuối dòng
(ghi chú có sẵn trong `.env.production.example`). Sau khi sửa `.env`, tạo lại container:
`docker compose -f docker-compose.vietnix.yml up -d --force-recreate api`.

Bản sao cục bộ `.env.vietnix.deploy` (không được track, đã gitignore) hiện **không có** biến GOMDON_\* nào.

Tạo secret: `openssl rand -hex 32`.

---

## 5. SystemConfig và mẫu thông báo

### 5.1. Khoá cấu hình mới

Grep toàn bộ khoá mà code mới đọc chỉ ra đúng chín khoá dưới đây. Không có khoá mới nào khác.

| Khoá | Mặc định | Ai ghi vào DB prod | Seed |
|---|---|---|---|
| `shipping.gomdon.config` | `{"defaultWarehouse":{"name":"Fuwa3e Tubu HCM","phone":"0965573541","address":"Golf Park, 1 đường số 2","ward":"Phường Long Bình","district":"Thành phố Thủ Đức","province":"Thành phố Hồ Chí Minh"},"defaultWeightFallback":500}` | Migration 3 | createOnly |
| `shipping.gomdon.recycling_enabled` | `false` | Migration 3 | createOnly |
| `returns.window_days` | `7` | Migration 3 | createOnly |
| `dealer.reward_claim_grace_days` | `30` (kẹp 0–366) | Migration 6 | createOnly |
| `loyalty.checkin_points` | `[1,1,1,1,1,1,2]` (7 số nguyên 0–100; sai định dạng thì quay về mặc định) | **Chỉ seed** | createOnly |
| `loyalty.pos_credit_enabled` | `false` | **Chỉ seed** | createOnly |
| `loyalty.pos_max_order_total` | `5000000` | **Chỉ seed** | createOnly |
| `loyalty.pos_staff_daily_points_cap` | `3000` | **Chỉ seed** | createOnly |
| `loyalty.pos_member_daily_points_cap` | `1000` | **Chỉ seed** | createOnly |

Năm khoá `loyalty.*` không migration nào chèn. Nếu prod không chạy seed thì các khoá này không có trong
DB, và code dùng mặc định y hệt bảng trên (`loyalty.service.ts`: `DEFAULT_CHECKIN_POINTS`,
`POS_DEFAULTS`). Khi admin bấm lưu ở form "Điểm Xanh — điểm danh & tích điểm tại quầy",
`PUT /admin/config` tự tạo dòng (upsert). Không cần chèn tay.

`returns.window_days` là khoá mà code thật sự đọc (`orders.service`, `affiliate.service`,
`loyalty.service`). Seed cũ ghi nhầm `return.window_days` = 15, mà không code nào đọc, nên hạn đổi/trả
thực tế trên prod vẫn luôn là 7 ngày. Migration chèn 7, nên **không đổi hành vi**.

Hai khoá `affiliate.monthly_tier_thresholds` và `affiliate.monthly_tier_bonuses` vẫn còn trong seed nhưng
**không code nào đọc nữa**. Ngưỡng bậc nằm cứng ở `apps/api/src/modules/affiliate/ctv-milestones.ts`.
Sửa hai khoá này ở tab Cấu hình sẽ không có tác dụng.

### 5.2. Mẫu thông báo mới

| Mã | id | Migration chèn | Khi trùng id | Seed |
|---|---|---|---|---|
| `OPS_GOMDON_ALERT` | `nt-ops-gomdon` | 3 | `DO UPDATE` (ghi đè nội dung) | upsert thường (ghi đè) |
| `DEALER_REWARD_CLAIM_NEW` | `nt-dealer-reward-claim-new` | 6 | `DO UPDATE` | upsert thường |
| `DEALER_REWARD_CLAIM_APPROVED` | `nt-dealer-reward-claim-approved` | 6 | `DO UPDATE` | upsert thường |
| `DEALER_REWARD_CLAIM_REJECTED` | `nt-dealer-reward-claim-rejected` | 6 | `DO UPDATE` | upsert thường |
| `DEALER_REWARD_CLAIM_PAID` | `nt-dealer-reward-claim-paid` | 6 | `DO UPDATE` | upsert thường |
| `DEALER_BONUS_ADJUSTED` | `nt-dealer-bonus-adjusted` | 7 | `DO NOTHING` | createOnly |
| `STOREFRONT_TRENDING_PRODUCTS` | `nt-storefront-trending` | Không có | — | upsert thường; xem 3.6 |

Tất cả đều là kênh `INAPP`, không cần duyệt template ZNS với Zalo.

### 5.3. Seed giờ hoạt động thế nào, và có nên chạy trên prod không

`apps/api/prisma/seed.ts` giờ dùng `configSeedUpsertArgs` (`apps/api/src/modules/system-config/config-seed.ts`).
Khoá nào đánh dấu `createOnly: true` thì seed **chỉ tạo khi chưa có** và không bao giờ ghi đè giá trị
admin đã chỉnh. Chín khoá ở 5.1 đều là createOnly. Với mẫu thông báo, chỉ `DEALER_BONUS_ADJUSTED` là
createOnly. Các khoá và mẫu còn lại vẫn bị upsert ghi đè như trước.

Phía migration: dòng `system_configs` được chèn bằng `ON CONFLICT ("key") DO NOTHING`, nên không đè giá
trị admin. Mẫu thông báo ở migration 3 và 6 dùng `ON CONFLICT ("id") DO UPDATE` (đảm bảo nội dung
đúng), còn mẫu ở migration 7 dùng `DO NOTHING`.

**Khuyến nghị:** đợt này **không cần** chạy seed trên prod, vì migration đã chèn đủ các dòng code cần.
Việc tay duy nhất là mẫu `nt-storefront-trending` (3.6). Nếu prod đã có dữ liệu hoặc cấu hình do người
chỉnh, **đừng** chạy lại cả seed: seed vẫn upsert ghi đè sản phẩm (giá), biến thể, hạng thành viên,
hạng đại lý, danh mục, cùng mọi khoá cấu hình không createOnly. Mục 2 của
`docs/2026-09-12-deploy-runbook.md` ("seed lại mỗi lần deploy") không còn đúng cho prod có dữ liệu thật.

### 5.4. Dọn tay trên prod

Làm sau khi deploy xong.

```sql
-- 1) Dòng chết 'return.window_days' (không code nào đọc; khoá đúng là 'returns.window_days').
SELECT "key", "value" FROM "system_configs" WHERE "key" IN ('return.window_days', 'returns.window_days');
DELETE FROM "system_configs" WHERE "key" = 'return.window_days';

-- 2) Mật khẩu Gomdon dạng rõ trong shipping.gomdon.config (chỉ có nếu ai đó từng nhập theo bản WIP).
SELECT "value" ? 'password' AS co_mat_khau, "value" ? 'phone' AS co_sdt
FROM "system_configs" WHERE "key" = 'shipping.gomdon.config';
```

Nếu `co_mat_khau = true`, làm theo thứ tự sau:

1. Đưa tài khoản vào `.env` (`GOMDON_PHONE`, `GOMDON_PASSWORD`, `GOMDON_WEBHOOK_SECRET`) rồi tạo lại
   container api.
2. Kiểm `GET /api/admin/gomdon/status`: phải có `credentialsSet: true`.
3. Gỡ khỏi DB:

```sql
UPDATE "system_configs" SET "value" = "value" - 'password' - 'phone'
WHERE "key" = 'shipping.gomdon.config';

-- Lịch sử cấu hình cũng có thể chứa mật khẩu:
SELECT "id", "changedAt" FROM "system_config_history"
WHERE "key" = 'shipping.gomdon.config' AND ("oldValue" ? 'password' OR "newValue" ? 'password');
```

Nếu có dòng lịch sử chứa mật khẩu, xoá chúng đi, và nên đổi mật khẩu Gomdon, vì mật khẩu cũ đã nằm
trong DB và trong các bản `pg_dump`. Không gỡ mật khẩu bằng cách lưu lại form ở web admin: khi lưu,
`AdminService.setConfig` tự khôi phục các trường bị che về giá trị cũ.

---

## 6. Trình tự deploy đề xuất

1. **Chủ shop chọn giờ**, lý tưởng là trước 01/10 04:00 (mục 8.3). Chọn giờ thấp điểm: API down trong
   lúc build lại container và chạy migrate.
2. **Đưa code lên remote**: fast-forward `main` tới `b756c4a` và push (hoặc push nhánh). Việc này do
   chủ shop quyết.
3. **Trên VPS** (`ssh chodeli-vps`, thư mục `/opt/tubutree`):

```bash
cd /opt/tubutree
DC="docker compose -f docker-compose.vietnix.yml"

# Sao lưu (lần 26/09 dùng thư mục /opt/tubutree-backups). -U/-d theo mặc định trong compose, đổi nếu .env khác.
$DC exec -T postgres pg_dump -U tubu -d tubutree | gzip > /opt/tubutree-backups/pre-b756c4a-$(date +%Y%m%d-%H%M).sql.gz

# Kiểm trước (mục 3.1)
$DC exec -T postgres psql -U tubu -d tubutree -c 'SELECT count(*), max(migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'

# Lấy code: sau lần rollback 26/09, trạng thái git trên VPS có thể đang detached ở 22e36d4, nên xem git status trước.
git status && git fetch origin && git merge --ff-only origin/main   # hoặc checkout đúng b756c4a
git log -1 --oneline   # phải là b756c4a

# Build + chạy. Container api tự chạy prisma migrate deploy rồi mới khởi động.
$DC up -d --build
$DC logs --tail=150 api
$DC exec -T api pnpm exec prisma migrate status   # kỳ vọng: up to date, 98 migration
```

4. **Sau migrate**: chạy SQL ở 3.5 (an toàn khi chạy lại), 3.6 (mẫu gian hàng) và 5.4 (dọn tay).
5. **Smoke test** ngay trên VPS (qua cổng local, không phụ thuộc DNS):

```bash
curl -s http://127.0.0.1:14001/api/health
curl -s http://127.0.0.1:14001/api/config/public          # có "recyclingEnabled":false
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:14001/api/webhooks/gomdon \
  -H 'content-type: application/json' -d '{}'            # 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:14001/api/admin/gomdon/status   # 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:14001/api/affiliate/milestones  # 401
```

6. **UAT** theo mục 9.
7. **Bật Gomdon** theo mục 7, làm riêng sau khi UAT phần còn lại đã ổn.

---

## 7. Bật Gomdon (go-live), theo đúng thứ tự

**Điều kiện trước:** Gomdon phải gọi được webhook của ta qua Internet, tức là `api.tubutree.com` phải trỏ
đúng VPS và có HTTPS. Lần kiểm gần nhất (26/09), DNS của `api.` vẫn trỏ IP GCP cũ đã chết (xem
`ops/README-vietnix-deploy.md` mục "CÒN LẠI"). Kiểm lại bằng `dig +short api.tubutree.com`, kết quả
phải là `14.225.207.177`.

1. **Đặt env** trong `/opt/tubutree/.env`: `GOMDON_PHONE`, `GOMDON_PASSWORD`, `GOMDON_WEBHOOK_SECRET`
   (bắt buộc đặt cùng lúc), để trống `GOMDON_BASE_URL`. Tạo lại container api rồi kiểm
   `GET /api/admin/gomdon/status` bằng token ADMIN, hoặc xem khối "Thu gom vật liệu tái chế (Gomdon)" ở
   tab Cấu hình. Kỳ vọng: `configured: true`, `webhookSecretSet: true`, `recyclingToggle: false`.
2. **Đăng ký webhook với Gomdon.** Ưu tiên cách 1:
   - Cách 1: URL `https://api.tubutree.com/api/webhooks/gomdon` + header `x-webhook-token: <secret>`.
   - Nếu Gomdon chỉ cho nhập URL: `https://api.tubutree.com/api/webhooks/gomdon/<secret>` (đường dẫn)
     hoặc `https://api.tubutree.com/api/webhooks/gomdon?token=<secret>` (query).

   Controller (`gomdon-webhook.controller.ts`) nhận cả ba dạng; header thắng nếu có. Ưu tiên header vì
   hai dạng kia đưa secret vào URL. Log lỗi của ứng dụng có che (`apps/api/src/common/filters/redact-url.ts`),
   nhưng access log Apache (`/www/wwwlogs/api.tubutree.com-access_log`, định dạng `combined`) ghi nguyên
   URL, kể cả secret. Endpoint giới hạn 120 request/phút.
3. **Làm một lần đặt thử.** Lưu ý: khi công tắc còn tắt, checkout **từ chối** mọi đơn có
   `hasRecyclingPickup=true` ("Tính năng gửi lại vật liệu tái chế hiện chưa mở..."), nên không thể đặt
   thử qua app mà không bật công tắc. Có hai cách:
   - Đặt thử trực tiếp trên cổng Gomdon, hoặc nhờ Gomdon bắn một webhook thử. Sau đó kiểm webhook đã
     tới: `SELECT "status", "gomdonStatus", "receivedAt", "error" FROM "gomdon_webhook_events" ORDER BY "receivedAt" DESC LIMIT 5;`.
     Sự kiện của vận đơn không khớp đơn nào của ta sẽ ở trạng thái `IGNORED`, như vậy là bình thường.
     Nếu không có dòng nào, xem access log Apache để thấy có bị 401 không.
   - Hoặc bật công tắc trong một khung giờ vắng, đặt **một** đơn COD nội bộ có thu gom (địa chỉ nhân
     viên), rồi tắt công tắc ngay. Kiểm đơn có `gomdonPartnerCode`, trạng thái chuyển "Đã đặt lịch thu
     gom", webhook cập nhật `gomdonStatus`. Sau đó huỷ đơn đó và kiểm vận đơn được huỷ trên Gomdon
     (`orders.gomdonCancelStatus = 'CANCELLED'`).
4. **Chỉ khi bước 3 ổn** mới bật `shipping.gomdon.recycling_enabled = true`, bằng công tắc "Hiện lựa
   chọn thu gom ở checkout" ở tab Cấu hình. `GET /api/config/public` phải trả `"recyclingEnabled":true`.
5. **Theo dõi** hàng đợi "Cần xử lý thu gom" (`/admin?tab=orders&recycling=attention`). Cron cứu hộ
   `GomdonReconcileService` chạy mỗi 10 phút (`30 */10 * * * *`). Báo động `OPS_GOMDON_ALERT` gửi in-app
   tới tối đa 20 tài khoản ADMIN và chỉ xem được trong mục **Thông báo của Mini App** (đăng nhập bằng
   tài khoản ADMIN) cùng log API. Web admin không có hộp thông báo.

### 7.1. Hợp đồng API Gomdon: chưa xác nhận, cần hỏi Gomdon

Code viết theo tài liệu và giả định, chưa đối chiếu với môi trường thật của Gomdon:

| Điểm | Code đang giả định | Nơi |
|---|---|---|
| Tên trường webhook | `order_id` (id Gomdon), `order_code` (mã BestExpress), `order_customer_id` (mã đơn của ta), `status` (1–12), `created_time`, `tracking_link`/`tracking_url` | `gomdon.types.ts`, `gomdon-webhook.service.ts` |
| Đơn vị `created_time` | Nhận cả unix giây, mili-giây (> 1e12) và chuỗi ngày. Trường này dùng cho khoá chống trùng và chống lùi trạng thái | `parseEventTime` trong `gomdon-webhook.service.ts` |
| Đường huỷ vận đơn | `POST /api/v2/order/cancel/{id}` với id số | `gomdon.client.ts` |
| Đăng nhập | `POST /api/v2/auth/login` (form `phone`, `password`), `expires_in` tính bằng giây, mặc định 86400 | `gomdon.client.ts` |
| Tạo đơn | `POST /api/v2/order/create` (multipart/form-data) | `gomdon.client.ts` |
| Bảng mã trạng thái | 1 Tạo đơn … 7 Giao thành công … 12 Hoàn hàng thất bại | `gomdon-status.ts` |
| Có cho cấu hình header webhook không | Chưa biết, nên hỗ trợ cả ba dạng | `gomdon-webhook.controller.ts` |

---

## 8. Thay đổi hành vi chủ shop cần biết

### 8.1. CTV

- **Doanh số và bậc trên dashboard giờ là doanh số đã chốt.** Cách tính: tổng `commissionableTotal` của
  commission `APPROVED`/`PAID` có `approvedAt` rơi vào tháng (giờ VN), chỉ gồm dòng hàng có hưởng hoa
  hồng (không tính hàng bị chặn affiliate, hàng rate 0, phí ship). Commission chỉ lên APPROVED sau khi
  đơn giao xong, qua `max(affiliate.hold_days, returns.window_days)` = 20 ngày theo mặc định, và không
  còn yêu cầu đổi/trả chờ duyệt. Trước đây doanh số lấy `orderTotal` của mọi commission khác REJECTED
  tạo trong tháng. **Vì vậy doanh số và bậc hiển thị sẽ tụt với hầu hết CTV**, nhất là đầu tháng. Phần
  đang chờ chốt được hiển thị riêng.
- `bonusPct` ("+X% bonus hoa hồng") bị gỡ khỏi API và UI.
- **Huy hiệu bậc công khai trên trang gian hàng** dùng cùng định nghĩa, nên cũng tụt theo.
- Hai khoá `affiliate.monthly_tier_thresholds`/`bonuses` không còn được đọc (mục 5.1).
- **Bản Mini App production đang chạy trên Zalo** (nếu build từ code cũ như `22e36d4`) có dòng
  `Bonus +{d.tier.bonusPct}% hoa hồng tháng này`. API mới vẫn trả `tier.bonusPct = 0` ở
  `/affiliate/dashboard` chỉ để tương thích, nên bản cũ hiện **"Bonus +0% hoa hồng tháng này"**
  (đúng sự thật: chưa có luồng nào trả khoản bonus này) thay vì "+undefined%". Bản Mini App mới không
  còn dòng đó.
- **Thưởng mốc có hiệu lực ngay khi deploy** dựa trên dữ liệu backfill. Tổng bốn mốc là **2,85 triệu xu
  mỗi tháng**. Tháng trước và tháng này là hai lượt riêng, nên một CTV đạt đủ mốc ở cả hai tháng có thể
  nhận tới **5,7 triệu xu** ngay sau deploy. Xu chỉ tiêu trong app, không rút được. Để ước lượng sau khi
  migrate (câu chỉ-đọc):

```sql
SELECT "affiliateUserId",
       to_char("approvedAt" + interval '7 hours', 'YYYY-MM') AS thang_vn,
       SUM("commissionableTotal") AS doanh_so_da_chot
FROM "commissions"
WHERE "status" IN ('APPROVED', 'PAID')
  AND "approvedAt" >= date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '7 hours')
                      - interval '1 month' - interval '7 hours'
GROUP BY 1, 2
HAVING SUM("commissionableTotal") >= 3000000
ORDER BY 3 DESC;
```

### 8.2. Loyalty

- **Điểm xét hạng = điểm `ORDER_DELIVERED` trừ `ORDER_REVERSED` của cùng đơn**, trong 12 tháng. Điểm từ
  vòng quay game, đánh giá, season pass, điểm danh và POS vẫn là Điểm Xanh tiêu được bình thường, nhưng
  **không còn tính vào hạng**. Hạng vẫn có thể đạt nhờ tiêu chí chi tiêu (`minSpending`). Cron tính lại
  hạng chạy 03:15 hằng ngày. Người rớt mốc được ân hạn `loyalty.tier_grace_days` (30 ngày), sau đó mới
  bị hạ hạng. Để biết trần số người có thể bị ảnh hưởng (ước lượng thô, thực tế thấp hơn vì còn tiêu chí
  chi tiêu):

```sql
SELECT COUNT(DISTINCT "userId") AS thanh_vien_co_diem_ngoai_don_hang
FROM "points_transactions"
WHERE "delta" > 0
  AND "reason" NOT LIKE 'ORDER_DELIVERED:%'
  AND "createdAt" >= now() - interval '12 months';
```

- **Điểm của đơn còn trong hạn đổi/trả** (7 ngày kể từ `deliveredAt`), đơn đang có yêu cầu đổi/trả chờ
  duyệt, hoặc đơn đã huỷ/trả mà chưa kịp trừ điểm: **chưa đổi quà được và chưa tiêu ở checkout được**.
  Màn hình có câu giải thích.
- **Điểm danh mặc định 8 điểm/tuần** (khoảng 8.000đ). Bản WIP chưa từng deploy trả 190 điểm/tuần. Admin
  chỉnh được ở form Điểm Xanh.
- **POS tắt mặc định.** Muốn dùng phải bật `loyalty.pos_credit_enabled` và gán role STAFF cho nhân viên.

### 8.3. Đại lý

- **Thưởng quý chỉ tính doanh số đã chốt**: đơn đại lý tạo trong quý, đã thanh toán (`PAID`) hoặc ghi
  công nợ, và đã ở `PACKED`/`SHIPPING`/`DELIVERED`. Đơn chưa đủ điều kiện được hiển thị riêng là "chờ
  thanh toán/đóng gói, chưa tính thưởng".
- **Cron trả thưởng chuyển sang 04:00 ngày 10 tháng đầu quý** (`@Cron('0 0 4 10 1,4,7,10 *')`), để đơn
  đặt cuối quý kịp đóng gói. Đại lý nhận thưởng Q3 vào khoảng 10/10 thay vì 01/10. Nên báo trước cho đại
  lý.
- **Thu hồi thưởng là phần biên**: khi một đơn đã được tính bị huỷ/trả sau lúc chi trả, số thu hồi bằng
  `min(thưởng còn giữ, bonus(doanh số trước) − bonus(doanh số không có đơn đó))`, cộng lại vào công nợ,
  kèm thông báo `DEALER_BONUS_ADJUSTED`.
- **CẢNH BÁO 01/10:** nếu lúc 04:00 ngày 01/10 prod vẫn chạy code cũ, cron cũ trả Q3 theo luật cũ (tính
  mọi đơn trừ CANCELLED/RETURNED, kể cả đơn chưa trả tiền). Khoá idempotent của cả hai bản đều là
  `(userId, 'QUARTER_BONUS', 'Q3/2026')`, nên code mới sẽ **không trả lại, không tính lại, và không truy
  thu phần chênh quy tắc**. Hoặc deploy trước mốc đó, hoặc chấp nhận Q3 trả theo luật cũ. Giờ "04:00" là
  giờ của container; compose không đặt `TZ`, nên nhiều khả năng đó là UTC, tức 11:00 giờ VN (mục 12).
- **Yêu cầu nhận thưởng bị REJECTED là trạng thái cuối.** Unique `(userId, periodKey, rewardId)` nên đại
  lý không gửi lại được; cần hỗ trợ thì nhắn Zalo OA.
- Duyệt yêu cầu khi doanh số đã chốt của kỳ đã tụt dưới mốc (có đơn bị huỷ/trả sau khi gửi) sẽ bị từ
  chối kèm giải thích.

### 8.4. Huỷ đơn

Khách tự huỷ (PENDING_PAYMENT/CONFIRMED) giờ **hoàn tiền bất cứ khi nào DB ghi PAID** ngay lúc huỷ, kể
cả khi admin vừa xác nhận chuyển khoản hay webhook vừa lật PAID. Trước đây chỉ hoàn nếu bản đọc trước
đó là PAID. Tiền về Ví Tubu, hoặc về xu nếu đơn trả bằng xu. Đơn có thu gom mà bưu tá đã lấy hàng thì
khách không tự huỷ được.

### 8.5. Quyền truy cập web

- `/admin` vẫn chỉ cho **ADMIN** (cả web lẫn API `@Roles('ADMIN')`), không đổi so với prod.
- Mới: **`/admin/pos` cho STAFF và ADMIN**. Tab "Tích điểm tại quầy" (sổ POS) trong `/admin` chỉ ADMIN.
  API kiểm lại role trong DB mỗi lần tích điểm, nên JWT cũ sau khi bị hạ quyền cũng không dùng được.

---

## 9. UAT: thứ tự bấm

**Tài khoản cần có:** một khách thường, một CTV (role AFFILIATE, có commission đã chốt thì càng tốt),
một đại lý đã duyệt (DEALER), một STAFF và một ADMIN.

**Chuẩn bị Mini App (bản test trên Zalo):** `apps/miniapp/src/services/api.ts` rơi về
`http://localhost:3001/api` nếu không có `VITE_API_BASE_URL`. `apps/miniapp/.env` hiện không có biến
này, và bản build cục bộ gần nhất trong `apps/miniapp/www` (27/09) **đang trỏ localhost**. Phải build lại
với biến đặt rõ:

```bash
VITE_API_BASE_URL=https://api.tubutree.com/api pnpm --filter @tubutree/miniapp build
# PowerShell: $env:VITE_API_BASE_URL='https://api.tubutree.com/api'; pnpm --filter @tubutree/miniapp build
cd apps/miniapp
npx zmp sync-config www/index.html
npx zmp deploy -t -e -m "UAT b756c4a"
# Sau đó trả apps/miniapp/app-config.json về bản đã commit (hash asset đổi mỗi lần build, không commit).
```

Mini App bản test chỉ gọi được API khi `api.tubutree.com` đã trỏ đúng VPS và có HTTPS (mục 7).

**Chuẩn bị trên web admin:** tạo sẵn một phần thưởng đại lý ở tab "Nhãn hàng" (bước C8), để bước B5 có
dữ liệu.

### 9.1. Mini App (Zalo test build)

**B1. Điểm Xanh (`/loyalty`), tài khoản khách**

1. Mở tab Điểm Xanh. Kỳ vọng: có khối "Điểm danh nhận Điểm Xanh", 7 ô, và nút "Điểm danh +1" (ô ngày 7
   là +2).
2. Bấm điểm danh. Kỳ vọng: nút đổi thành "Đã điểm danh", số dư tăng đúng 1. Bấm nhanh nhiều lần hoặc tải
   lại trang vẫn chỉ cộng một lần.
3. Vào Vườn Xanh, điểm danh hạt giống. Kỳ vọng: vẫn điểm danh được, hai hệ không chặn nhau.
4. Bấm "Thẻ thành viên số (mã QR)". Kỳ vọng: hiện QR, mã dạng `TUBU…`, tên và SĐT đã che. Bấm "Chép" thì
   báo "Đã sao chép mã thành viên".
5. Mục "Đổi Điểm Nhận Voucher": chọn một ưu đãi đủ điểm. Modal "Xác nhận đổi ưu đãi" hiện "Điểm cần trừ"
   và "Điểm còn lại". Bấm "Đổi ngay". Kỳ vọng: báo "Đổi thành công! Mã … đã vào Kho voucher", voucher
   xuất hiện trong "Kho voucher", điểm giảm đúng giá.
6. Với tài khoản có đơn vừa giao (dưới 7 ngày): phần điểm của đơn đó không dùng được để đổi, và có câu
   giải thích.

**B2. Thanh toán (`/checkout`)**

7. Khi công tắc thu gom **tắt**: không có khối thu gom.
8. Khi đã **bật** (sau mục 7): có khối "Gửi lại vật liệu tái chế (Bảo vệ môi trường)" với dòng "Thu gom
   tối đa ~X kg". Bật lên thì hiện ô "Ghi chú loại vật dụng muốn gửi…". Chọn chuyển khoản hoặc ZaloPay thì
   có thêm câu "Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn." COD, Ví và Xu không có
   câu này.
9. Bật dùng Điểm Xanh: nếu có điểm bị khoá, có dòng ghi chú xám giải thích, và chỉ phần dùng được bị trừ.
10. Đặt một đơn COD có thu gom.

**B3. Chi tiết đơn (`/order/:code`)**

11. Kỳ vọng: có khối "Thu gom vật liệu tái chế" với dòng "Tubu Tree tài trợ 100% phí thu gom" và "Vật
    dụng gửi: …". Trạng thái đi từ "Đang đặt lịch thu gom" sang "Đã đặt lịch thu gom" kèm "Mã vận đơn
    BestExpress: …". Đơn trả trước chưa trả tiền thì hiện "Chờ thanh toán".
12. Huỷ đơn khi còn CONFIRMED. Kỳ vọng: huỷ được, trạng thái thu gom thành "Đã huỷ thu gom". Khi Gomdon
    đã báo bất kỳ mã nào khác 1, 2, 10 (tức bưu tá đã cầm hàng, xem `isGomdonPickedUp`), nút huỷ biến
    mất.
13. Đặt rồi huỷ một đơn trả bằng Ví. Kỳ vọng: Ví được hoàn đủ tiền.

**B4. CTV (`/affiliate`), tài khoản AFFILIATE**

14. Thẻ bậc: không còn dòng "Bonus +X%". Doanh số là doanh số đã chốt, kèm giải thích "Doanh số đã chốt =
    giá trị hàng được hưởng hoa hồng (không gồm phí ship)…".
15. Khối "Thưởng Mốc Doanh Số Tháng": 4 mốc. Mốc chưa đạt hiện "Chưa đạt" và "Còn thiếu … doanh số đã
    chốt". Mốc đạt có nút "Nhận thưởng". Bấm thì báo "Đã nhận thưởng mốc thành công!", nút thành "Đã nhận
    ✓", Tubu Xu tăng đúng số. Bấm đúp không cộng hai lần. Mốc tháng trước còn nhận được sẽ hiện thành
    phần riêng.

**B5. Đại lý (`/dealer`), tài khoản DEALER**

16. Báo cáo quý: "… đơn đã chốt · Thưởng hiện tại X% = …", phần "chờ thanh toán/đóng gói — chưa tính
    thưởng" tách riêng, và câu "Thưởng quý được cộng vào công nợ khoảng ngày 10 của quý kế tiếp."
17. Phần thưởng mốc (đã tạo ở C8): khi đạt mốc thì bấm "Yêu cầu nhận thưởng". Kỳ vọng: badge "Đã gửi yêu
    cầu · chờ duyệt". Bấm lại không tạo yêu cầu thứ hai.
18. Sau khi admin xử lý ở C9: mục "Thông báo" có tin tương ứng, badge đổi thành "Đã duyệt · chờ trao
    thưởng", "Yêu cầu bị từ chối" (kèm lý do, không còn nút) hoặc "Đã trao thưởng ✓".
19. Đơn đại lý đặt vượt tồn hiện "Đặt trước N — chờ hàng về".

**B6. Tài khoản ADMIN trên Mini App**

20. Khi có sự cố thu gom (ví dụ Gomdon báo huỷ hoặc giao thất bại), mục Thông báo có tin "⚠️ Vận đơn thu
    gom đơn …".

### 9.2. Web admin (`/admin`, tài khoản ADMIN)

**C1. Tab "Cấu hình", khối "Thu gom vật liệu tái chế (Gomdon)".** Base URL, Tài khoản Gomdon và Webhook
secret chỉ hiện "đã đặt"/"chưa đặt", không bao giờ hiện giá trị. Có công tắc "Hiện lựa chọn thu gom ở
checkout". Sửa kho rồi bấm "Lưu kho & cân nặng": lưu được, còn SĐT kho sai thì bị từ chối. Mở
`GET /api/admin/config` kiểm không có mật khẩu hay secret dạng rõ.

**C2. Khối "Điểm Xanh — điểm danh & tích điểm tại quầy".** Sửa "Điểm danh 7 ngày", bật "Bật tích điểm
tại quầy (POS)", sửa ba trần, rồi bấm "Lưu tham số tích điểm". Nhập sai (ví dụ 1000 điểm một ngày) thì
bị từ chối.

**C3. Tab "Người dùng".** Gán role STAFF cho SĐT nhân viên thu ngân.

**C4. `/admin/pos`, đăng nhập bằng STAFF.** Nhập "Mã thành viên" (`TUBU…`), bấm "Tra cứu": thấy tên, SĐT
đã che, hạng. Nhập "Mã hoá đơn POS" và "Tổng tiền hoá đơn (đ)", bấm "Tích điểm". Kỳ vọng:

- Điểm = tổng tiền / 10.000 × hệ số hạng.
- Gửi lại cùng mã hoá đơn không cộng lần hai; cùng mã mà khác số tiền hoặc khác thành viên thì báo lỗi.
- Tự tích cho chính mình bị chặn.
- POS đang tắt thì báo "Tính năng tích điểm tại quầy (POS) đang tắt".
- Vượt trần thì báo lỗi kèm số đã dùng.
- Tài khoản CUSTOMER mở `/admin/pos` thì thấy "Chỉ nhân viên hoặc quản trị viên mới dùng được màn thu
  ngân."

**C5. Tab "Tích điểm tại quầy".** Sổ hiện đúng lượt vừa tích, lọc được theo nhân viên và theo thành viên.

**C6. Tab "Đơn hàng".** Bộ lọc "Mọi đơn / ♻ Có thu gom / Cần xử lý thu gom" hoạt động, và URL giữ
trạng thái (`/admin?tab=orders&recycling=attention`). Lọc trạng thái hoặc tìm đơn không còn lỗi. Mở một
đơn thu gom: khối "Thu gom vật liệu tái chế (Gomdon)" có mã vận đơn, "Gomdon cập nhật", "Khách gửi kèm".
Thử lần lượt:

- "Tạo lại vận đơn Gomdon". Với `NEEDS_MANUAL_CHECK` phải tick "Tôi đã kiểm tra Pancake/Gomdon: kho CHƯA
  tạo vận đơn tay cho đơn này."
- "Huỷ vận đơn Gomdon".
- "Đã xử lý tay" kèm ghi chú: đơn rời hàng đợi "Cần xử lý thu gom".

**C7. Đơn đại lý trả trước chờ chuyển khoản.** Khối "Đơn đại lý trả trước — chờ chuyển khoản": nhập "Mã
giao dịch ngân hàng", bấm "Xác nhận đã nhận chuyển khoản". Kỳ vọng: đơn thành PAID, và
PENDING_PAYMENT chuyển sang CONFIRMED. Bấm lại không có tác dụng. Đơn ghi công nợ, đơn đã huỷ và đơn
không phải đơn đại lý thì không xác nhận được.

**C8. Tab "Nhãn hàng", phần thưởng đại lý.** Tạo một phần thưởng (loại tour/quà, ngưỡng, kỳ QUARTER) với
ngưỡng thấp để đại lý test đạt được.

**C9. Tab "Thưởng đại lý".** Danh sách "Yêu cầu nhận thưởng đại lý", lọc theo trạng thái. Duyệt (ghi chú
tuỳ chọn), từ chối (bắt buộc lý do) và đánh dấu đã trao thưởng. Yêu cầu REJECTED không còn nút nào.

**C10. Tab "Đổi / Trả" và "Đại lý".** Lọc theo trạng thái không còn lỗi 400. Hàng chờ xếp cũ nhất lên
trước, có tổng và nút tải thêm.

**C11. `/merchant`** (tài khoản nhãn hàng): không trắng màn, bảng đơn hiện đúng tên sản phẩm và giá.

### 9.3. Web shop

**D1. `/thanh-toan`.** Khi thu gom đã bật: có khối "Gửi lại vật liệu tái chế (Bảo vệ môi trường)" với
dòng "Bưu tá nhận lại vật liệu ngay khi giao hàng" và ô ghi chú. Chọn chuyển khoản thì có câu "Lịch thu
gom được đặt sau khi Tubu nhận được thanh toán của đơn." Dùng điểm khi có điểm khoá thì hiện "X điểm từ
đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được".

**D2.** Đặt đơn xong, màn xác nhận có ô trạng thái thu gom.

**D3. `/tai-khoan`.** Danh sách đơn có ô "Thu gom vật liệu tái chế" với trạng thái giống Mini App.

**D4. `/s/<slug>`.** Huy hiệu bậc CTV theo doanh số đã chốt. Ngay sau deploy, đa số sẽ là "Tân binh 🌱".

---

## 10. Rollback

### 10.1. Trước khi lùi

- Nếu đã bật thu gom, tắt công tắc "Hiện lựa chọn thu gom ở checkout" trước.
- Liệt kê đơn thu gom đang chạy, vì code cũ không biết gì về Gomdon (webhook sẽ trả 404) và các đơn này
  phải xử lý tay:

```sql
SELECT "code", "status", "gomdonStatus", "gomdonPartnerCode"
FROM "orders"
WHERE "hasRecyclingPickup" = true AND "status" NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED');
```

- `pg_dump` như bước deploy.

### 10.2. Lùi code

Có hai cách, giống lần 26/09:

- Trên VPS, đưa `/opt/tubutree` về `22e36d4` rồi chạy `docker compose -f docker-compose.vietnix.yml up -d --build`.
- Hoặc revert trên `main` và deploy lại bình thường.

### 10.3. Schema: để nguyên là an toàn

Nên **để nguyên** mọi cột, bảng, index và cả 7 dòng trong `_prisma_migrations`. Lý do:

- Mọi cột mới đều nullable hoặc có DEFAULT (`orders.hasRecyclingPickup` DEFAULT false,
  `commissions.commissionableTotal` DEFAULT 0). Prisma client cũ chỉ đọc và ghi các cột nó biết.
- Bảng mới (`gomdon_webhook_events`, `ctv_milestone_claims`, `loyalty_check_ins`, `pos_point_credits`,
  `dealer_reward_claims`) không ai đọc.
- Hai partial unique index trên `points_transactions` chỉ áp cho `refType` `CHECKIN`/`POS`, mà code
  `22e36d4` không bao giờ ghi hai giá trị đó.
- Khoá ngoại RESTRICT tới `users` không vướng gì, vì cả code cũ lẫn mới đều không xoá user.
- Dòng `system_configs`/`notification_templates` mới là vô hại.

**Đừng** xoá dòng `_prisma_migrations` trong khi vẫn giữ cột. Lần deploy lại sẽ chạy lại migration 2, 4
và 6 (không có `IF NOT EXISTS`), và sẽ vỡ ở `ADD COLUMN`, `CREATE TYPE` hoặc `CREATE TABLE`.

| Đối tượng | Khuyến nghị |
|---|---|
| Cột mới trên `orders`, `commissions`, `storefronts` | Để nguyên |
| Bảng `gomdon_webhook_events`, `ctv_milestone_claims`, `loyalty_check_ins`, `pos_point_credits`, `dealer_reward_claims`; enum `DealerRewardClaimStatus` | Để nguyên (còn giữ vết xu/điểm/thưởng đã phát) |
| Index `points_transactions_checkin_day_key`, `points_transactions_pos_ref_key` | Để nguyên |
| 7 dòng `_prisma_migrations` | Để nguyên, đi cùng schema |
| Dòng cấu hình và mẫu thông báo mới | Để nguyên |

Chỉ khi buộc phải gỡ sạch (ví dụ code cũ từ chối boot, xem mục 12): gỡ theo thứ tự ngược 7 → 1 trên bản
sao lưu đã có. Nghĩa là xoá các bảng, enum, index và cột ở bảng 3.2, xoá dòng cấu hình và mẫu thông báo ở
mục 5, rồi xoá 7 dòng `_prisma_migrations`. Gỡ bảng đồng nghĩa với mất vết audit của xu, điểm và thưởng
đã phát (số dư của người dùng thì vẫn giữ nguyên).

### 10.4. Hệ quả tiền của việc lùi

- Xu thưởng mốc CTV, điểm danh, điểm POS và thưởng đại lý đã trao **không tự thu lại**.
- Nếu còn chạy code cũ lúc 04:00 ngày 01/10, cron cũ trả Q3 theo luật cũ (mục 8.3).
- Khi deploy lại sau đó, chạy lại SQL ở mục 3.5.

---

## 11. Còn mở, cần chủ shop

1. **Hợp đồng API Gomdon chưa xác nhận**: tên trường webhook, đơn vị `created_time`, đường huỷ vận đơn
   (bảng 7.1). Cần hỏi Gomdon trước khi bật cho khách.
2. **Pancake không sửa được ghi chú sau khi đơn đã lên Pancake.** Với đơn trả trước, Pancake nhận đơn lúc
   còn chờ thanh toán; vận đơn Gomdon chỉ tạo sau khi tiền về. Vì Pancake không có API sửa note, hệ thống
   gửi báo động `OPS_GOMDON_ALERT` để nhân viên tự ghi mã vận đơn vào Pancake ("KHÔNG tạo vận đơn khác").
   Nếu không ai đọc báo động, kho có thể đặt thêm một hãng vận chuyển khác.
3. **Khoá advisory của POS là khoá toàn cục** (`pg_advisory_xact_lock(hashtext('loyalty.pos_credit'))`):
   mọi lượt tích điểm tại quầy trên toàn hệ thống xếp hàng từng lượt một. Ổn với một vài quầy; nhiều
   quầy cùng giờ cao điểm sẽ chậm.
4. **Thông báo `DEALER_BONUS_ADJUSTED` dùng hẹn giờ trong process** (`setTimeout` 1s/5s/30s/120s sau khi
   transaction commit). API restart trong khoảng đó thì mất thông báo. Khoản điều chỉnh vẫn nằm trong sổ
   công nợ, kèm mã đơn.
5. **UI Mini App và web mới chỉ được kiểm bằng Playwright/jsdom**, chưa bấm trên máy Zalo thật. Bản Mini
   App production hiện tại sẽ hiện "Bonus +0%" ở thẻ bậc CTV cho tới khi lên bản mới (mục 8.1).
6. **Quyết định deploy thuộc về chủ shop**: khi nào deploy (trước hay sau 01/10 04:00), có push/merge nhánh
   lên `main` không, có build và submit bản Mini App production lên Zalo không.
7. Điều kiện hạ tầng vẫn chưa xong từ đợt trước: DNS và HTTPS của `api.tubutree.com`/`app.tubutree.com`
   (`ops/README-vietnix-deploy.md`). Không có HTTPS thì Gomdon không gọi được webhook và Mini App bản test
   không gọi được API.

---

## 12. Chưa kiểm chứng

- **Trạng thái thật của DB prod**: có đúng 91 migration không, còn dòng `return.window_days` không,
  `shipping.gomdon.config` có mật khẩu không, đã có dữ liệu người dùng thật chưa (ghi chú hạ tầng ngày
  26/09 nói lúc đó DB prod rỗng dữ liệu người dùng). Người viết không truy cập DB.
- **`.env` thật trên VPS** đã có GOMDON_\* chưa. Chỉ kiểm được bản sao cục bộ `.env.vietnix.deploy` (không có).
- **Múi giờ của cron.** Image `node:20-alpine`, Dockerfile và compose đều không đặt `TZ`, nên suy ra các
  cron chạy theo UTC (04:00 ≈ 11:00 giờ VN). Chưa chạy `date` trong container trên VPS để xác nhận.
- **Code cũ có boot được khi DB có 7 migration nó không biết không.** Khi rollback, container `22e36d4`
  vẫn chạy `prisma migrate deploy` lúc khởi động. Chưa thử xem nó có chấp nhận các dòng
  `_prisma_migrations` không có trong thư mục migration hay không. Nên thử trên một bản restore của
  `pg_dump` trước khi cần tới.
- **Prisma chạy mỗi file migration trong một transaction**: đây là hành vi đã biết của Prisma trên
  Postgres, nhưng chưa thử riêng trên prod.
- **DNS hiện tại** của `api.tubutree.com`. Lần kiểm cuối (26/09) nó vẫn trỏ IP GCP cũ.
- **Bản Mini App production trên Zalo được build từ commit nào.** Điều này quyết định khách có thấy dòng
  "Bonus +0%" của bản cũ không.
- **Hợp đồng Gomdon** (mục 7.1).
- **Số test** ở mục 2 đã chạy lại sau khi viết tài liệu (27/09): 2061 API, 179 miniapp, 135 web, 39 e2e
  miniapp, 16 race test Postgres thật — xanh hết.
