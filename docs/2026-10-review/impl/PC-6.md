# PC-6 — Giao định kỳ + đơn thứ 2

Nhánh `hz6/PC-6` (tách từ `hardening/2026-10` @ `ee97986`).

## C-015 — phần API: XONG

Commit: `551fa54` (cột `paymentMethod`), `e2c37c1` (service/controller), `3f292e3` (unit test).

Đã làm:
- **Đơn đầu giao ngay hoặc từ ngày khách chọn.** `POST /subscriptions` nhận thêm `startDate` (YYYY-MM-DD giờ VN)
  và `paymentMethod`. Bỏ trống hoặc chọn hôm nay thì gói và đơn đầu được ghi trong cùng một transaction. Đơn đầu
  lỗi (hết hàng, Ví Tubu thiếu, địa chỉ hỏng) thì trả 400 tiếng Việt và không để lại gói. Chọn ngày sau thì
  `nextRunAt` = 0h ngày đó giờ VN, cron 3h sáng sinh đơn. Ngày đã qua, quá 60 ngày hoặc sai lịch (2026-02-31) trả 400.
- **Thanh toán COD / Ví Tubu / chuyển khoản** (cột `subscriptions.paymentMethod`, mặc định COD):
  - Ví Tubu: gọi `WalletLedgerService.applyDelta(ORDER_PAY, refType ORDER, refId = id đơn)` trong cùng tx với việc
    tạo đơn và trừ kho, đơn được đánh `PAID`. Một kỳ chỉ có một đơn nhờ `idempotencyKey = subscription:<id>:<kỳ>`
    (unique), nên ví cũng chỉ bị trừ một lần.
  - Ví thiếu khi cron sinh đơn kỳ: rollback cả đơn lẫn kho, gói chuyển `PAUSED` và khách nhận `SUBSCRIPTION_PAUSED`
    kèm `{{reason}}`. Không sinh đơn nợ.
  - Chuyển khoản: đơn `PENDING_PAYMENT`, `UNPAID`. `BANK_TRANSFER` thuộc `PREPAID_METHODS`, nên cron
    `pending-payment-expiry` hiện có tự huỷ đơn quá hạn và hoàn kho. Khách nhận tin `SUBSCRIPTION_ORDER_AWAITING_PAYMENT`
    (số tiền + số giờ lấy theo TTL đang cấu hình).
  - ZaloPay/VNPAY/XU không được nhận (400), vì cổng thanh toán cần khách thao tác ở mỗi kỳ.
- **Sửa gói** `PATCH /subscriptions/:id` gồm `quantity`, `addressId`, `paymentMethod` cho gói ACTIVE/PAUSED. Có kiểm:
  chủ gói, SP còn bán (`PRODUCT_DISCONTINUED`), địa chỉ thuộc user, chống trùng gói cùng SP + địa chỉ (409
  `SUBSCRIPTION_DUPLICATE`, giữ partial unique của PA-6/C-057; P2002 khi chạy song song được đổi thành 409).
  Gói đã huỷ trả 400.
- **Chống trộn bản cũ/mới:** cron và `update` cùng khoá dòng gói bằng `SELECT … FOR UPDATE`. Cron đọc số lượng,
  địa chỉ và cách trả ngay dưới khoá đó, nên đơn kỳ luôn theo trọn bản cũ hoặc trọn bản mới.
- `list` trả thêm `paymentMethod`, `addressId`, `lastOrderId` để FE dùng cho tab Định kỳ.
- Seed: mẫu `SUBSCRIPTION_PAUSED` đổi sang dùng `{{reason}}`; thêm mẫu `SUBSCRIPTION_ORDER_AWAITING_PAYMENT`.

Migration: `20261010180000_subscription_payment_method`, chỉ thêm cột
(`ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD'`). Gói đang có giữ COD như hành vi cũ, không cần
backfill. Đã áp bằng `prisma migrate deploy` lên Postgres riêng `tubu_it_pc6:5576`.

### Test
- Race spec mới `apps/api/test/integration-race/subscription-cycle-payment.race-spec.ts` (Postgres thật) gồm:
  giao ngay / chọn ngày / ngày sai; Ví đủ tiền thì sổ cái khớp, Ví thiếu thì không tạo gói, đơn hay trừ kho;
  chuyển khoản ra PENDING_PAYMENT; 5 lượt cron song song × 5 vòng cho đúng 1 đơn và 1 lần trừ ví mỗi kỳ, sổ cái
  khớp; ví thiếu khi tới kỳ thì PAUSED, không đơn, không trừ kho/ví; sửa ACTIVE/PAUSED; các trường hợp bị từ chối;
  409 khi đổi sang địa chỉ trùng; 2 gói đổi chéo song song × 10 vòng; sửa gói xen giữa bước nhận kỳ và bước ghi
  đơn; sửa gói song song với cron × 15 vòng (cặp số lượng@địa chỉ luôn là `1@Cu` hoặc `5@Moi`).
- Ba race spec cũ (`address-subscription`, `subscription-duplicate`, `sellable-product`) được chỉnh theo hành vi
  mới: tạo gói giờ sinh đơn đầu ngay, nên các spec này truyền `startDate` để giữ đúng kịch bản cũ.
- Unit `subscriptions.service.spec.ts` có thêm các ca COD/Ví/chuyển khoản và ngày bắt đầu.
- Đỏ → xanh: mấy test trên được viết và commit cùng lượt sửa ở lượt trước. Lượt này không chạy lại để chứng minh
  chúng đỏ trên code cũ. Lý do chắc chắn đỏ: ở `ee97986` không có `startDate`/`paymentMethod`/`update`, tạo gói không
  sinh đơn, nên các assert về đơn đầu và về ví không thể qua.

Lệnh kiểm chứng (chạy lại ở lượt này):
```
cd apps/api && npx jest src/modules/subscriptions --maxWorkers=1
  Tests:       47 passed, 47 total
DATABASE_URL=postgresql://tubu:tubu@localhost:5576/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand subscription-cycle-payment subscription-duplicate address-subscription sellable-product
  Test Suites: 4 passed, 4 total
  Tests:       57 passed, 57 total
npx tsc --noEmit -p tsconfig.json        -> 0 lỗi
npx eslint src/modules/subscriptions test/integration-race/{subscription-*,address-subscription,sellable-product}.race-spec.ts prisma/seed.ts -> 0 lỗi
```

### Giả định
- Đơn đầu giao ngay mà lỗi thì không tạo gói (an toàn tiền: không có gói "đang chạy" mà không có hàng hoặc không có
  tiền). Khách thấy lỗi và chọn lại.
- Ví thiếu ở kỳ sau thì tạm dừng gói. Khi khách bật lại, giữ hành vi cũ của `setStatus`: kỳ quá hạn dời sang một
  chu kỳ tính từ lúc bật, không sinh bù kỳ đã lỡ.
- Hết hàng tạm thời ở kỳ sau: không pause (giữ hành vi cũ), chỉ báo khách và để kỳ sau thử lại.
- Phạm vi ngày bắt đầu: tối đa 60 ngày tới (`MAX_START_DAYS_AHEAD`).

### Còn lại (lượt khác)
- C-015 phần miniapp: tab "Định kỳ" ở trang Đơn hàng (chọn ngày bắt đầu, cách trả, sửa số lượng/địa chỉ) và client
  `services` cho `PATCH /subscriptions/:id`.
- C-017.
- Deploy: `prisma migrate deploy` (1 migration) + seed lại mẫu thông báo `SUBSCRIPTION_PAUSED`/
  `SUBSCRIPTION_ORDER_AWAITING_PAYMENT`.
