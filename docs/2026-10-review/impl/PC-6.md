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
- ~~C-017~~: xong, xem mục cuối.

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

## C-017 — đơn thứ 2 trong 30 ngày + mời đánh giá sau giao: XONG (phía API)

Commit: `05567ea` (cột + mẫu tin), `fb80929` (cron + test).

Đã làm:
- **Mã giảm giá đơn thứ 2** `VouchersService.secondOrderVouchers()`, cron `0 10 * * *` với `timeZone: CRON_TZ`. Cron cấp
  cho khách thỏa đủ các điều kiện sau:
  - là khách thật (cùng `REAL_USER_SQL` của C-059: có SĐT hoặc zaloId không phải `guest_`), role `CUSTOMER`;
  - có đúng MỘT đơn không huỷ, đơn đó `DELIVERED` đã `voucher.second_order_delay_days` ngày (mặc định 3);
  - đơn còn ít nhất `voucher.second_order_min_remaining_days` ngày (mặc định 3) trong cửa sổ NS-1 30 ngày tính từ lúc tạo
    đơn đầu.

  Không xét đơn lên hộ (`placedForCustomer`), đơn đại lý (`type DEALER`), đơn sinh từ gói định kỳ và khách còn gói
  ACTIVE/PAUSED. Mã `SECOND-ORDER-<userId>` mỗi khách chỉ một lần trong đời. Mã có `usageLimit` 1, giảm
  `voucher.second_order_amount` (30.000đ) cho đơn từ `voucher.second_order_min_order` (199.000đ), hết hạn đúng lúc đóng
  cửa sổ 30 ngày (`grant()` có thêm tham số `endAt`).
- **Tôn trọng notifyPromo:** `SECOND_ORDER_VOUCHER` được thêm vào nhóm PROMO (`notification-categories.ts`). Khách đã tắt
  "Khuyến mãi & mã giảm giá" không nhận tin, cả trong app lẫn ZNS. Mã vẫn nằm trong kho voucher, giống voucher chào mừng.
- **Tin mời đánh giá** `ReviewInviteService.sendReviewInvites()` (mới, `lifecycle/review-invite.service.ts`), cron
  `0 10,19 * * *` với `timeZone: CRON_TZ`. Cron chọn đơn RETAIL không lên hộ, đã giao từ `review.invite_delay_hours`
  (48h) đến `review.invite_max_age_days` (7 ngày) và chưa có `reviewInvitedAt`. Cách gửi:
  - Cron claim đơn bằng `updateMany … reviewInvitedAt IS NULL` rồi mới gửi `REVIEW_REQUEST`. Đây là tin giao dịch, không
    bị công tắc khuyến mãi chặn. Payload gồm `order_code`, `product`, `product_slug`.
  - Q-30: tin chỉ nêu SP khách CHƯA đánh giá (`reviews` unique userId+productId). Đơn đã đánh giá hết thì được đánh dấu
    và không gửi.
  - Gửi lỗi thì cron trả `reviewInvitedAt` về null để lượt sau gửi lại.
  - Trần 7 ngày tránh việc lần chạy đầu sau deploy gửi tin cho toàn bộ đơn cũ, vì cột mới đều NULL.
- **Cả hai cron chạy theo lô có giới hạn và có khoá chống chạy chồng.** Keyset theo `userId`/`orderId`. Đơn thứ 2 xử lý
  tối đa 200×25 khách mỗi lượt, mời đánh giá tối đa 200×10 đơn mỗi lượt. Có cờ `running` trong process và
  `pg_try_advisory_xact_lock` giữa các instance, theo đúng mẫu `coupon-cleanup.cron`. Lớp chặn cuối là code coupon
  `@unique` và claim theo cột. Toàn thân cron bọc try/catch, lỗi từng khách/đơn không làm hỏng cả lô.
- Mẫu tin `SECOND_ORDER_VOUCHER` và `REVIEW_REQUEST` có trong cả `prisma/seed.ts` (createOnly) lẫn migration, vì prod không
  chạy seed. Câu chữ dùng "Mã giảm giá" và "Điểm Xanh" (Q-26).
- Miniapp: không cần sửa. `notificationAction` hiện sẵn nút "Xem chi tiết đơn hàng" cho tin có `order_code`. Trang
  chi tiết đơn đã có lối sang trang SP để đánh giá (P1-2). Tin `*_VOUCHER` đi tới kho voucher.

Migration: `20261010190500_order_review_invite_second_order`.
- `ALTER TABLE orders ADD COLUMN "reviewInvitedAt" TIMESTAMP(3)` (nullable, không backfill).
- `INSERT` 2 mẫu tin `ON CONFLICT DO NOTHING`.
- Đã áp bằng `prisma migrate deploy` lên `tubu_it_pc6:5576`.
- Đặt tên `19:05` để đứng sau `20261010180000` của C-015.

### Test (đỏ → xanh)
- Race spec mới `apps/api/test/integration-race/second-order-review-invite.race-spec.ts` (Postgres thật), 5 ca:
  - (a) 2 instance song song cộng chạy lại thì ra đúng 1 mã và 1 tin; hạn mã = đơn đầu + 30 ngày; instance thứ hai nhận `LOCKED`.
  - (b) 7 ca không cấp: guest, đã có đơn 2 (PENDING_PAYMENT), giao chưa đủ ngày, sắp hết cửa sổ, lên hộ, đại lý,
    đơn định kỳ. Có đơn huỷ trước đó vẫn được cấp.
  - (c) số khách vượt một lô (lô 2, 5 khách) thì không sót ai.
  - (d) mời đánh giá chỉ nêu SP chưa đánh giá; 2 instance song song cộng chạy lại chỉ gửi 1 tin; đơn đã đánh giá hết
    được đánh dấu và không gửi.
  - (e) đơn chưa tới giờ, quá 7 ngày, đơn đại lý, đơn lên hộ: không gửi và không đánh dấu. Gửi lỗi thì cờ trở về null,
    lượt sau gửi đúng 1 tin.
- Unit test: `vouchers.service.spec.ts` có ca `grant` với `endAt`. `notification-prefs.spec.ts` kiểm
  SECOND_ORDER_VOUCHER = PROMO và REVIEW_REQUEST = giao dịch. `notification-templates-seed.spec.ts` bắt buộc có mẫu
  SECOND_ORDER_VOUCHER.
- Đỏ: chạy race spec trước khi code thì `Cannot find module '../../src/modules/lifecycle/review-invite.service'`
  (`Test Suites: 1 failed`). Lúc đó tính năng chưa tồn tại, chưa có `secondOrderVouchers`/`ReviewInviteService`.

Lệnh kiểm chứng:
```
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5576/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand second-order-review-invite vouchers-real-user
  [a] results=[{"granted":1,"scanned":1},{"skipped":"LOCKED"}] coupons=1 notify=1
  [b] guest,hasSecond,tooFresh,windowEnding,proxy,dealer,subscriber,withCancelled=[0,0,0,0,0,0,0,1]
  [e] afterFail={"reviewInvitedAt":null} calls=[{"order_code":"IT…","product":"Nước rửa chén IT",…}]
  Tests:       10 passed, 10 total
npx jest --maxWorkers=1 src/modules/notifications/notification-prefs.spec.ts src/modules/notifications/notification-templates-seed.spec.ts src/common/cron-timezone.spec.ts src/modules/vouchers src/modules/lifecycle
  Tests:       118 passed, 118 total   (sau đó vouchers riêng: 22 passed)
npx tsc --noEmit -p tsconfig.json        -> exit 0
npx eslint <8 file đã sửa/thêm>           -> 0 lỗi
```

### Sửa ngoài nhóm file (tối thiểu)
- `apps/api/src/modules/notifications/notification-categories.ts`: thêm 1 dòng `SECOND_ORDER_VOUCHER` vào PROMO_CODES. File này
  ghi rõ mã mới chưa liệt kê sẽ rơi vào TRANSACTIONAL, nên thiếu dòng này thì tin khuyến mãi vẫn gửi cho khách đã tắt. Ngoài ra
  có 2 spec cùng thư mục, mỗi spec thêm 1 mã vào danh sách kiểm.

### Giả định (C-017)
- Mức ưu đãi đơn 2 lấy theo voucher chào mừng: 30.000đ cho đơn từ 199.000đ. Mức này đọc từ SystemConfig nên admin chỉnh
  được mà không cần deploy. Chọn mức khiêm tốn vì đây là chi phí trên mỗi khách.
- "Một đơn" nghĩa là chỉ có một đơn không huỷ. Đã có đơn khác ở bất kỳ trạng thái nào (kể cả chờ thanh toán hay trả hàng) thì
  không cấp, vì khách đã quay lại hoặc không phải khách mới.
- Khách còn gói định kỳ, hoặc đơn đầu sinh từ gói, thì không cấp, vì đơn kế tiếp tự đến. Giảm giá lúc này không kéo thêm
  đơn mà chỉ thành chi phí.
- Tin mời đánh giá gửi cả cho khách guest có đơn (đây là tin giao dịch về đơn của chính họ, và API đánh giá cho phép).
  Không gửi cho đơn lên hộ vì userId là CTV, không phải người dùng SP.
- Tin mời đánh giá không chặn theo giờ yên lặng riêng mà chỉ chạy lúc 10h và 19h giờ VN.

### Việc còn lại (C-017)
- Deploy: `prisma migrate deploy` (thêm migration `20261010190500_order_review_invite_second_order`).
- Có thể làm sau (ngoài gói): nhiệm vụ game "đơn thứ 2" (finding gốc nhắc bảng `missions`), icon/nhãn riêng cho
  `REVIEW_REQUEST` ở `pages/notifications.tsx` (file của gói khác), nút "Đánh giá ngay" dẫn thẳng `product_slug`.
- `apps/api/prisma/migrations/migration_lock.toml` trong worktree đang khác HEAD chỉ ở kiểu xuống dòng (do `migrate dev`). Không
  commit, nội dung không đổi.

## Tổng kết gói PC-6
- C-015: XONG (API + miniapp). C-017: XONG (API; miniapp dùng lại CTA có sẵn).
- Migration của gói: `20261010180000_subscription_payment_method`, `20261010190500_order_review_invite_second_order`
  (cả hai additive).
- Migration thêm sau review lượt 1: `20261010191000_subscription_second_order_templates_fix` (chỉ INSERT ... ON CONFLICT DO
  NOTHING và UPDATE có điều kiện "đúng câu cũ", không đổi schema).

## Review lượt 1

| # | Mức | Finding | Kết quả |
|---|---|---|---|
| 1 | major | Mẫu `SUBSCRIPTION_ORDER_AWAITING_PAYMENT` và lời mới của `SUBSCRIPTION_PAUSED` chỉ có trong seed, prod không có | ĐÃ SỬA (commit `92ac635`) |
| 2 | major | Không chặn số lượng tối đa và hạn mức COD, nên đơn đầu giao ngay lách được trần 5.000.000đ của checkout | ĐÃ SỬA (commit `d238873`) |
| 3 | minor | Gói trùng nhưng khác cách trả bị coi là bấm đúp, nên cách trả khách chọn bị bỏ; FE hiện "đơn đầu giao từ undefined" | ĐÃ SỬA (commit `894ab1d`) |
| 4 | minor | Gói tạm dừng vì ví thiếu/địa chỉ hỏng mất luôn kỳ đó, tin lại bảo "bật lại lịch" | SỬA MỘT PHẦN (commit `85dd7fc`): tin giờ nói thật |
| 5 | minor | Tin SECOND_ORDER_VOUCHER lặp "cho đơn", số tiền chưa định dạng vi-VN | ĐÃ SỬA (`92ac635` sửa lời, `8b2b352` định dạng số) |
| 6 | minor | Chiết khấu Subscribe & Save áp ngay đơn đầu, khách tạo gói rồi huỷ thì thành giảm giá một lần | KHÔNG SỬA, cần chủ dự án quyết |

### 1. Mẫu tin lên prod qua migration (đã xác minh: reviewer đúng)
- Bằng chứng: trước khi sửa, grep `nt-sub-pause` / `SUBSCRIPTION_ORDER_AWAITING` trong `apps/api/prisma/migrations` không ra
  kết quả nào. Prod không chạy seed (runbook), nên `notify()` rơi về câu mặc định.
- Sửa: migration mới `20261010191000_subscription_second_order_templates_fix`:
  - INSERT `nt-sub-order-awaiting-payment` và `nt-sub-pause` (bản có `{{reason}}`), ON CONFLICT DO NOTHING.
  - UPDATE `SUBSCRIPTION_PAUSED` chỉ khi body vẫn đúng câu seed cũ, để không ghi đè nội dung admin đã chỉnh.
  - UPDATE `SECOND_ORDER_VOUCHER` sang lời mới (finding 5), cùng điều kiện như trên.
  - Không sửa migration `20261010190500`: DB thử của gói đã áp nó rồi, đổi file thì lệch checksum.
- Test (đỏ → xanh), trong `notification-templates-seed.spec.ts`: áp lần lượt mọi migration (INSERT trước, UPDATE sau) cho 4 mã
  `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_ORDER_AWAITING_PAYMENT`, `SECOND_ORDER_VOUCHER`, `REVIEW_REQUEST`, rồi đối chiếu từng chữ
  với seed. Trước khi sửa: 3 test đỏ (PAUSED, AWAITING, lặp "cho đơn"). Sau khi sửa: 13/13 xanh.
- Áp thử trên Postgres riêng (5576): chèn dòng `nt-sub-pause` mang lời cũ, chạy `prisma migrate deploy` rồi query lại:
  ```
  All migrations have been successfully applied.
   SUBSCRIPTION_ORDER_AWAITING_PAYMENT | Đơn định kỳ {{order_code}} đã được tạo, vui lòng chuyển khoản {{amount
   SUBSCRIPTION_PAUSED                 | Lịch đặt định kỳ đã tạm dừng: {{reason}}. Vui lòng kiểm tra lại rồi bậ
   SECOND_ORDER_VOUCHER: Cảm ơn bạn đã tin dùng Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng cho lần mua tiếp theo trước {{expires}} 🌿
  ```
- Ngoài nhóm file: `notification-templates-seed.spec.ts` (thư mục notifications) chỉ được thêm một khối test. Đây là chỗ kiểm
  seed khớp migration sẵn có, nên không tách sang file khác.

### 2. Hạn mức COD và trần số lượng (đã xác minh: reviewer đúng)
- Bằng chứng: `checkout.service.ts:191` chặn COD > 5.000.000đ, còn `placeCycleOrder` không có bước kiểm này. DTO mới có
  `@Min(1)`, chưa có `@Max`.
- Sửa:
  - `CreateSubDto`/`UpdateSubDto` thêm `@Max(999)`, bằng trần một dòng giỏ hàng ở `cart.dto`. Service kiểm lại bằng `assertQuantity`.
  - `placeCycleOrder`: trả COD mà `total > 5.000.000đ` thì ném `SubscriptionCodLimitError` trước khi giữ kho. Trường hợp
    này đơn đầu trả 400 ("Đơn vượt hạn mức thanh toán khi nhận hàng (5.000.000đ)…"), còn cron tạm dừng gói với lý do
    `cod_limit` và báo khách đổi sang Ví Tubu/chuyển khoản. Ví Tubu và chuyển khoản không bị hạn mức này.
  - Hằng số `SUBSCRIPTION_COD_MAX` lặp lại số trong checkout chứ không dùng chung, vì checkout không thuộc nhóm file của gói.
    Hiện checkout cũng hard-code con số này (`payment.cod_max_amount` vẫn là khoá chết).
- Test (đỏ → xanh, `subscriptions.service.spec.ts`): COD 60 × 100.000đ ở cron cho ra tạm dừng + reason chứa "5.000.000đ" +
  `cod_limit`, không giữ kho, không tạo đơn. Đơn đầu COD vượt hạn mức trả 400, không giữ kho. Ví Tubu và chuyển khoản không bị
  chặn. create/update với số lượng 1000 trả 400. Trước khi sửa 4 test đỏ, sau khi sửa 52/52 xanh.

### 3. Gói trùng khác cách trả (minor, đã sửa)
- `resolveDuplicate` giờ chỉ coi là bấm đúp (trả lại gói cũ) khi trùng cả số lượng, chu kỳ và **cách trả**. Khác cách trả thì
  trả 409 `SUBSCRIPTION_DUPLICATE` để khách sửa gói cũ. Test mới: gói COD cũ, yêu cầu WALLET → 409.
- Miniapp `subscribe-sheet.tsx`: nếu giao ngay mà API không trả `firstOrder` (gói y hệt đã có) thì báo "Bạn đã có lịch định kỳ
  này rồi, xem ở tab Định kỳ trong Đơn hàng". Trước đây chỗ này định dạng một ngày rỗng. Test vitest mới: đỏ trước khi sửa,
  7/7 xanh sau khi sửa. Có thêm 1 chuỗi vào `i18n/vi.ts` (khối subscribe sẵn có).

### 4. Kỳ bị bỏ khi hệ thống tạm dừng gói (minor, sửa một phần)
- Xác minh: đúng. Bước claim đã dời `nextRunAt` sang kỳ kế. Bật lại lịch thì `setStatus` giữ ngày đó, nên kỳ bị lỗi không giao.
- Phương án reviewer đề xuất (đặt lại `nextRunAt = cycleAt`) **không** giúp gì: `setStatus` thấy ngày đã qua sẽ dời sang
  `now + chu kỳ`, khách còn chờ lâu hơn. Muốn "bật lại là giao bù ngay" thì phải đổi nghĩa của bật lại lịch, và cần phân
  biệt gói do hệ thống tạm dừng với gói khách tự tạm dừng (cần thêm cột). Đó là quyết định nghiệp vụ, nằm ngoài mức sửa rẻ.
- Đã làm: tin tạm dừng nói thật "(kỳ này không giao, kỳ kế tiếp ngày dd/mm/yyyy)" cho các nhánh ví thiếu, địa chỉ hỏng và
  vượt hạn mức COD. Ngày lấy đúng giá trị bước claim đã ghi. Test mới: đỏ trước khi sửa, xanh sau khi sửa.
- Cần chủ dự án quyết: có giao bù kỳ bị lỗi khi khách bật lại trong vòng một chu kỳ không.

### 5. Lời tin SECOND_ORDER_VOUCHER (minor, đã sửa)
- Lời mới: "…Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng cho lần mua tiếp theo trước {{expires}} 🌿". Seed
  và migration giống nhau từng chữ (có test kiểm).
- `VouchersService.grant`: mã giảm tiền (AMOUNT) truyền `value` dạng `toLocaleString('vi-VN')` (30.000). Mã % giữ nguyên. Thay
  đổi này áp cho mọi tin voucher (WELCOME, BIRTHDAY, WINBACK, MILESTONE…), và chỉ đổi cách hiển thị số. Test cập nhật
  "30000" → "30.000": đỏ trước khi sửa, xanh sau khi sửa.

### 6. Chiết khấu đơn đầu rồi huỷ gói (minor, không sửa)
- Hành vi này đúng theo Q-13 (đơn đầu giao ngay, có chiết khấu Subscribe & Save). Thu hồi chiết khấu hoặc chỉ cho bậc cơ bản ở
  đơn đầu là thay đổi giá, không tự quyết được. Việc mở nhiều gói cùng lúc để đẩy bậc thì hiện bị giới hạn bởi unique (SP +
  địa chỉ). Hạn mức COD (finding 2) và trần 999 cũng giới hạn quy mô lạm dụng.
- Cần chủ dự án quyết: chấp nhận, hay đơn đầu chỉ được bậc cơ bản, hay thu hồi khi huỷ trước kỳ 2. Theo dõi được qua event
  `subscription_changed` (created/cancelled) có sẵn.

### Lệnh kiểm chứng (review lượt 1)
```
apps/api: npx jest --maxWorkers=1 src/modules/subscriptions/subscriptions.service.spec.ts   -> Tests: 54 passed, 54 total
apps/api: npx jest --maxWorkers=1 src/modules/vouchers/vouchers.service.spec.ts src/modules/notifications/notification-templates-seed.spec.ts src/modules/lifecycle
          -> Tests: 65 passed, 65 total
apps/api: DATABASE_URL=...5576/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand
          subscription-cycle-payment -> 15 passed; address-subscription -> 7 passed; subscription-duplicate -> 8 passed
apps/api: npx prisma migrate deploy (5576) -> All migrations have been successfully applied.
apps/api: npx tsc --noEmit -p tsconfig.json -> 0 lỗi; npx eslint <file đã sửa> -> 0 lỗi
apps/miniapp: npx vitest run src/components/subscribe-sheet.spec.tsx -> 7 passed; npx tsc --noEmit -> 0 lỗi; eslint -> 0 lỗi
```
- Deploy: thêm `20261010191000_subscription_second_order_templates_fix` vào lượt `prisma migrate deploy`.
