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
- ~~C-015 phần miniapp~~: xong, xem mục dưới.
- C-017.

## C-015 — phần miniapp: XONG

Commit: `c7b20aa` (sheet đặt định kỳ + client), `053ca31` (tab Định kỳ sửa gói), `052b1ab` (sửa kiểu trong spec).

Đã làm:
- **Client** `services/subscriptions-api.ts`: `createSubscription` gửi thêm `paymentMethod` và `startDate` (khi có), trả
  `firstOrder`. Có thêm `updateSubscription` (`PATCH /me/subscriptions/:id`). DTO có `addressId`/`paymentMethod`/`lastOrderId`
  (để tuỳ chọn vì khối home feed trong cache có thể còn từ bản API cũ). Hằng `SUBSCRIPTION_PAYMENT_METHODS` và
  `MAX_START_DAYS_AHEAD = 60` khớp API.
- **Sheet "Đặt định kỳ"** (`components/subscribe-sheet.tsx`, mở từ PDP và trang đặt hàng thành công) chuyển sang DS v2
  (`BottomSheet`, `Chip`, `Button`, `Field`, `Text`). Thêm:
  - Đơn đầu tiên: chip "Giao ngay" (mặc định) hoặc "Chọn ngày". Ô ngày có `min` = ngày mai, `max` = +60 ngày, tính theo
    giờ VN. Ngày ngoài khoảng thì báo lỗi qua `Field` và khoá nút tạo.
  - Thanh toán mỗi kỳ: COD / Ví Tubu (kèm số dư) / Chuyển khoản ngân hàng. Hàng `role=radio` có `rowKeyboardProps`, cao
    ≥44px. Hàng đang chọn hiện giải thích, ví dụ "Ví không đủ tiền thì gói tạm dừng".
  - Địa chỉ: chọn trong sổ địa chỉ, mặc định là địa chỉ mặc định. Nhờ vậy khách tạo được nhiều gói cùng SP ở các địa chỉ khác nhau.
  - Kết quả: có đơn đầu thì báo mã đơn. Chuyển khoản mà đơn `PENDING_PAYMENT` thì mở `/bank-payment/<mã>` (luồng chuyển khoản
    hiện có). Hẹn ngày thì báo "đơn đầu giao từ dd/mm/yyyy". Lỗi API (Ví thiếu, hết hàng, trùng gói) hiện snackbar và
    sheet vẫn mở.
- **Tab "Định kỳ"** (`components/subscriptions-panel.tsx`): mỗi thẻ hiện "Thanh toán: …" và "Giao tới: …" (để phân biệt
  các gói cùng SP), thêm nút "Sửa". Nút này mở `components/subscription-edit-sheet.tsx` (DS v2: `QuantitySelector`, chọn
  cách trả, chọn địa chỉ) cho gói đang chạy hoặc tạm dừng. Sheet chỉ PATCH các trường đã đổi, nên đổi số lượng không gửi
  lại địa chỉ và không phải qua kiểm trùng. Không đổi gì thì nút lưu bị khoá. 409/400 từ API hiện snackbar.
- `components/subscription-options.tsx`: helper ngày giờ VN (`vnDateOf`, `startDateRange`, `isStartDateAllowed`,
  `formatVnDate`), cùng `PaymentMethodPicker`/`AddressPicker` dùng chung cho cả 2 sheet. Chuỗi mới nằm trong
  `i18n/vi.ts` → `subscriptions.*`, dùng thuật ngữ "Ví Tubu".

### Test (đỏ → xanh)
- Mới: `subscription-options.spec.tsx` (4), `subscribe-sheet.spec.tsx` (6), `subscriptions-panel.spec.tsx` có thêm 4 ca
  (thẻ hiện cách trả/địa chỉ, sửa 3 trường, chỉ đổi số lượng, gói tạm dừng + 409). `orders.spec.tsx` mock thêm `getAddresses`.
- Đỏ: chạy chính các spec mới trên bản gốc `ee97986` của `subscriptions-panel.tsx`/`subscribe-sheet.tsx` (bản sao tạm, đã
  xoá) → `Tests 9 failed | 8 passed (17)`. Các ca hành vi mới đều đỏ, chỉ ca cũ xanh.
- Xanh:
```
cd apps/miniapp && npx vitest run src/components/subscribe-sheet.spec.tsx src/components/subscription-options.spec.tsx \
  src/components/subscriptions-panel.spec.tsx src/pages/orders.spec.tsx src/ds-legacy-vars-4a.spec.ts \
  src/components/ui/button-guard.spec.ts src/components/ui/hit-target-guard.spec.tsx \
  src/components/checkout/order-success.spec.tsx src/components/home/order-strip.spec.tsx src/services/home-feed.spec.ts
  Test Files  10 passed (10)
  Tests  92 passed (92)
npx tsc --noEmit                                  -> exit 0
npx eslint <các file đã sửa/thêm>                 -> 0 lỗi (1 cảnh báo có sẵn ở orders.spec.tsx:11, không phải dòng mới)
```

### Giả định (miniapp)
- Ngày bắt đầu chỉ chọn được lúc tạo gói, vì API `PATCH` không nhận `startDate`. Muốn đổi lịch thì dùng "Bỏ qua kỳ này"
  hoặc tạm dừng như trước.
- Số lượng mỗi kỳ ở client chặn trần 99, chỉ để nút + không tăng vô hạn. Còn hàng hay không do API kiểm khi sinh đơn kỳ.
- Chọn Ví Tubu khi số dư thấp vẫn được phép (nhất là khi hẹn ngày, khách còn kịp nạp). Đơn giao ngay mà Ví thiếu thì API trả
  400 và sheet hiện lỗi.
- Sheet sửa được mount khi mở (theo `key` gói), nên đóng sheet không có hiệu ứng trượt xuống. Đổi lại, state luôn lấy đúng từ
  gói đang chọn.

### Việc còn lại (miniapp)
- Chưa kiểm trực quan trên Zalo thật/Playwright (máy giới hạn RAM). Cần UAT tay: ô `type=date` trên WebView Zalo iOS/Android.
- Deploy: `prisma migrate deploy` (1 migration) + seed lại mẫu thông báo `SUBSCRIPTION_PAUSED`/
  `SUBSCRIPTION_ORDER_AWAITING_PAYMENT`.
