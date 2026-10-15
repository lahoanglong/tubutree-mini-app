# Đối tác tự giao hàng và "Tubu giao hộ" (D4) — thiết kế

Ngày: 2026-10-14 · Gói UAT: p8-seller · Phát hiện gốc: PANCAKE-10, SELLER-1

## 1. Vấn đề

Sản phẩm đối tác đăng ở `/merchant` được gán `pancakeId = MCH_<ts>_<rand>` (biến thể `<id>_VAR`). Sau khi admin duyệt,
sản phẩm bán được như hàng Tubu, checkout đẩy mọi đơn sang Pancake, Pancake từ chối mã giả, cron 15 phút đẩy lại mãi.
Kho Tubu không có hàng, còn đối tác không có quyền chuyển trạng thái đơn. Giỏ có lẫn một món đối tác thì cả đơn Pancake hỏng,
nên hàng Tubu trong cùng giỏ cũng không tới kho.

Quyết định chủ sản phẩm (D4): đối tác đăng sản phẩm có thể nhập mã biến thể Pancake. Mã được kiểm khớp danh mục Pancake đã
đồng bộ thì được tích "Tubu giao hộ", khi đó dòng hàng do Tubu giao qua Pancake. Ngược lại MẶC ĐỊNH đối tác tự giao.

## 2. Mô hình dữ liệu

### 2.1 Sản phẩm

| Cột | Ý nghĩa |
| --- | --- |
| `Product.fulfilment` (`TUBU` \| `MERCHANT`, mặc định `TUBU`) | Ai giao hàng của sản phẩm này. Hàng đồng bộ từ Pancake và sản phẩm đối tác "Tubu giao hộ" là `TUBU`; sản phẩm đối tác tự giao là `MERCHANT`. |
| `Product.pancakeId`, `Variation.pancakeId` thành **nullable** | `NULL` = không có trên Pancake. Không còn mã giả nào; dữ liệu cũ `MCH_…` được migration đổi về `NULL` (mục 9). |
| `Product.pancakeLinkCode` | Mã biến thể Pancake đối tác xin liên kết khi tích "Tubu giao hộ" (chờ admin duyệt). |

Một dòng hàng đi Pancake khi và chỉ khi `isPancakeFulfilledLine(line)` đúng — hàm duy nhất, xuất ở
`apps/api/src/modules/integrations/pancake/pancake-fulfilment.ts`:

```ts
isPancakeFulfilledLine({ pancakeId, fulfilment }) =
  fulfilment !== 'MERCHANT' && pancakeId là chuỗi khác rỗng && !pancakeId.startsWith('MCH_')
```

Mọi nơi gom dòng để gửi Pancake (`PancakeOrderService.pushOrder`) và nơi xếp dòng vào kiện hàng ở checkout đều đi qua hàm này.
Tiền tố `MCH_` vẫn bị chặn trong hàm để dữ liệu lọt lưới (bản sao DB cũ, seed tay) không bao giờ tới Pancake.

### 2.2 Đơn: một đơn con cho mỗi nơi giao

Chọn **tách đơn** (sub-order) thay vì nhiều "kiện" trong một đơn. Lý do: mọi cơ chế đang có chạy theo từng đơn — bảng chuyển
trạng thái, huỷ (D1), hoàn tiền (D2), trả hàng theo dòng (D3), hoa hồng CTV, Điểm Xanh, lịch sử trạng thái. Một đơn chỉ có một
nơi giao thì không cần huỷ/hoàn một phần đơn khi người bán huỷ phần của mình, và đơn của đối tác không bao giờ có
`pancakeOrderId`, nên luồng huỷ D1 tự đi nhánh "huỷ tại chỗ".

| Cột mới trên `Order` | Ý nghĩa |
| --- | --- |
| `fulfiller` (`TUBU` \| `MERCHANT`, mặc định `TUBU`) | Nơi giao của cả đơn. Đơn cũ là `TUBU`. |
| `fulfillerStorefrontId` | Gian hàng đối tác giao đơn (`MERCHANT`). |
| `merchantCommissionPct` | Phí sàn chốt lúc đặt đơn (đối soát dùng số này, đổi cấu hình sau không đổi đơn cũ). |
| `checkoutGroup` | Mã đơn đầu tiên của lần đặt bị tách; mọi đơn cùng lần đặt mang cùng giá trị. `NULL` = không tách. |
| `merchantAcceptedAt`, `shippedAt` | Mốc đối tác xác nhận đơn và giao cho đơn vị vận chuyển (SLA). |
| `merchantSlaNotifiedAt` | Lần nhắc quá hạn gần nhất (chống nhắc trùng). |
| `storefrontId` | Gian hàng được ghi công (SELLER-5) — khoá ngoại, không còn so chuỗi `storefrontSlug`. |

Hãng vận chuyển, mã vận đơn, link tra cứu của đơn đối tác dùng lại `shippingPartner`, `shippingCode`, `trackingLink`.

### 2.3 Đối soát

```
MerchantPayout      { id, storefrontId, amount, status PENDING|PAID|CANCELLED, bankInfo (ảnh chụp TK lúc tạo),
                      createdBy, createdAt, paidAt, paidBy, bankRef, note }
MerchantPayoutLine  { id, payoutId, orderId, orderCode, kind SALE|REVERSAL,
                      goodsAmount, shippingFee, commissionAmount, codCollected, netAmount,
                      @@unique([orderId, kind]) }
```

Bảng kê (statement) không lưu sẵn mà tính từ đơn lúc xem; dòng chỉ được "đóng" khi vào một phiếu thanh toán. Unique
`(orderId, kind)` bảo đảm một đơn chỉ được trả một lần và chỉ bị trừ ngược một lần, kể cả hai admin bấm tạo phiếu cùng lúc.

## 3. Checkout

1. Giỏ trả thêm `fulfiller` cho mỗi dòng: `{ kind: 'TUBU' }` hoặc `{ kind: 'MERCHANT', storefrontId, name }`.
   Dòng `TUBU` phải qua `isPancakeFulfilledLine`; dòng không thuộc nơi giao nào (không có mã Pancake và không phải hàng đối
   tác tự giao) bị chặn với lỗi "đang cập nhật, tạm chưa đặt được". Hàng `MERCHANT` chỉ có nơi giao khi gian hàng sở hữu là
   loại `MERCHANT`: chỉ chủ gian hàng loại này mới vào được tab "Đơn cần giao", nên hàng tự giao nằm ở gian hàng CTV/thương
   hiệu (dữ liệu cũ, hoặc gian hàng đổi loại) cũng bị chặn như trên thay vì sinh đơn không ai xử lý được.
2. Gom dòng theo nơi giao: kiện Tubu (nếu có) đứng đầu, sau đó từng gian hàng đối tác.
3. Giảm giá tính trên TOÀN lần đặt như hiện tại (combo → mã → hạng → Điểm Xanh), rồi phân bổ về từng dòng và từng kiện theo
   mục 7: mỗi khoản chỉ vào dòng được hưởng, Điểm Xanh chỉ vào hàng của Tubu (phần dư làm tròn dồn theo phương pháp số dư lớn
   nhất để tổng khớp từng đồng). Điểm đã dùng (lô thường và lô quy đổi) chia theo phần Điểm Xanh của từng kiện để huỷ một đơn
   con hoàn đúng phần điểm của đơn đó; kiện chỉ có hàng của gian hàng đối tác không dùng điểm.
4. Phí giao **theo từng kiện**: kiện Tubu dùng luật hiện có (`shipping.free_threshold`, `shipping.flat_fee_below_threshold`,
   ưu đãi hạng) trên tiền hàng của kiện; kiện đối tác dùng `Storefront.shippingFee` (trống thì `merchant.default_shipping_fee`),
   miễn phí khi tiền hàng của kiện đạt `Storefront.freeShipFrom`. Ngưỡng miễn phí của Tubu và mã freeship (Tubu tài trợ) chỉ
   áp cho kiện Tubu: phí giao của kiện đối tác là tiền của đối tác, chỉ được miễn theo ngưỡng của chính gian hàng. Giỏ và trang
   thanh toán vì vậy tính tiến độ "mua thêm để được miễn phí vận chuyển" trên tiền hàng phần Tubu giao. Mã freeship chỉ tính
   là đã áp (và chỉ tiêu lượt) khi thật sự miễn được phí giao của kiện Tubu; giỏ chỉ hàng đối tác tự giao, hoặc kiện Tubu vốn
   đã miễn phí giao, thì báo "Mã miễn phí vận chuyển chỉ áp cho phí giao hàng do Tubu Tree giao, và đơn này không có phí giao
   đó." và không ghi lượt dùng.
5. Thanh toán: kiện đối tác chỉ nhận **COD** (đối tác thu) hoặc **Ví Tubu** (Tubu giữ tiền). Chuyển khoản được Pancake đối soát
   theo mã đơn Pancake nên không có đường xác nhận cho đơn đối tác; ZaloPay đang ẩn ở cả hai app. Lần đặt bị tách cũng chỉ nhận
   COD/Ví vì một lệnh thanh toán ngoài chỉ trỏ được một mã đơn. COD còn bị trần 5.000.000đ (`COD_MAX_PER_ORDER`, trần thu hộ
   mỗi kiện của hãng vận chuyển) xét trên **từng đơn sau khi tách** (tiền hàng sau giảm cộng phí giao của đơn đó), không xét
   tổng cả giỏ: giỏ 2,6 triệu hàng Tubu cộng 3 triệu hàng gian hàng vẫn COD được. Báo giá trả `blockedPaymentMethods`
   (phương thức → câu lý do kèm cách đặt tiếp) cho COD, chuyển khoản và ZaloPay; đây là nguồn duy nhất: đặt hàng từ chối đúng các
   phương thức báo giá khoá, cùng câu (mã lỗi `PAYMENT_METHOD_NOT_ALLOWED`), phương thức không khoá thì đặt được. Ví Tubu do FE
   so số dư mới nhất với tổng đơn (đúng điều kiện API dùng lúc đặt). FE tắt sẵn lựa chọn bị khoá kèm lý do; lựa chọn đang chọn
   không còn dùng được thì tự chọn COD hoặc chuyển khoản nếu dùng được, không tự chọn Ví (Ví trừ tiền ngay), không còn cách nào
   thì bỏ chọn, khoá nút đặt và nói khách xem hướng dẫn dưới từng phương thức (UAT vòng 4 R4-CHECKOUT-2).
6. Thu gom vỏ tái chế (Gomdon) chỉ gắn vào đơn Tubu; lần đặt không có hàng Tubu mà bật thu gom bị từ chối.
7. Ghi đơn: một transaction tạo mọi đơn con, giữ tồn từng dòng, trừ điểm một lần dưới khoá dòng user rồi ghi sổ điểm theo
   từng đơn, trừ ví theo từng đơn, tạo hoa hồng CTV theo từng đơn. Mã giảm giá ghi nhận lượt dùng trên đơn đầu tiên
   (`CouponRedemption.orderId`). Idempotency-Key gắn vào đơn đầu; gửi lại cùng key trả lại cả nhóm. Phần giảm của mã nằm ở
   mọi đơn con, nên huỷ/trả một đơn con chỉ trả lượt dùng mã khi **mọi** đơn cùng `checkoutGroup` đã `CANCELLED`/`RETURNED`
   (huỷ đơn đầu khi đơn gian hàng còn sống thì mã vẫn tính là đã dùng). Bước này khoá theo nhóm
   (`pg_advisory_xact_lock('checkout-group-coupon:<group>')`) để hai lần huỷ cùng lúc trả lượt đúng một lần.
8. Sau commit: đơn Tubu → hàng đợi Pancake/Gomdon như cũ; đơn đối tác → báo đối tác `MERCHANT_ORDER_NEW`. Khách nhận
   `ORDER_CONFIRMED` cho từng đơn.

Lần đặt chỉ có hàng Tubu đi đúng đường cũ, không đổi một đồng nào (đã có test khoá điều này).

## 4. Khách thấy gì

- Giỏ và trang thanh toán chia nhóm "Tubu Tree giao" / "<Tên shop> giao", mỗi nhóm có phí giao riêng; tổng = tổng các kiện.
- Đặt xong, màn kết quả liệt kê các đơn đã tách (mã, nơi giao, số tiền).
- Chi tiết đơn đối tác: "Người bán giao: <shop>", hotline gian hàng (nếu có), hãng vận chuyển + mã vận đơn + link tra cứu khi
  đã gửi hàng, và các đơn cùng lần đặt.
- Huỷ: theo D1 — được huỷ khi đơn chưa giao cho đơn vị vận chuyển. Đơn đã `SHIPPING` thì nút đổi thành "Liên hệ CSKH".

## 5. Đối tác xử lý đơn ở /merchant

Tab "Đơn cần giao" (chỉ đơn `fulfillerStorefrontId = gian hàng của mình`), hiện đủ tên, SĐT, địa chỉ người nhận vì đối tác
phải giao. Tab "Đơn từ gian hàng" giữ như cũ cho đơn Tubu giao (che thông tin khách, chỉ xem).

| Bước | API | Trạng thái nội bộ | Ràng buộc |
| --- | --- | --- | --- |
| Mới | — | `CONFIRMED`, `merchantAcceptedAt = null` | |
| Xác nhận | `POST /merchant/orders/:id/accept` | `CONFIRMED` + `merchantAcceptedAt` | |
| Đã đóng gói | `POST …/pack` | `PACKED` | tự ghi `merchantAcceptedAt` nếu chưa có |
| Đã gửi hàng | `POST …/ship {carrier, trackingCode, trackingUrl?}` | `SHIPPING` + `shippedAt` | bắt buộc hãng và mã vận đơn |
| Đã giao | `POST …/deliver` | `DELIVERED` | cộng điểm, chốt hoa hồng như mọi đơn |
| Giao thất bại | `POST …/fail {reason}` | `CANCELLED` (ghi lý do) | chỉ từ `SHIPPING`; hoàn tiền trả trước, hoàn kho |
| Huỷ | `POST …/cancel {reason}` | `CANCELLED` | chỉ khi chưa `SHIPPING` (cùng mốc D1) |

Mọi bước đi qua `OrderStatusService.setStatus` (một nguồn ghi trạng thái, có khoá chuyển trạng thái, hoàn tiền/hoàn kho/đảo
điểm khi huỷ). Ghi hãng và mã vận đơn nằm trong cùng câu lật trạng thái (tham số `patch`), không có cửa sổ ghi nửa chừng.

## 6. Thông báo

| Mã | Người nhận | Khi nào |
| --- | --- | --- |
| `MERCHANT_ORDER_NEW` | chủ gian hàng | đơn đối tác vừa đặt |
| `MERCHANT_ORDER_CANCELLED` | chủ gian hàng | khách/admin/hệ thống huỷ đơn đối tác |
| `MERCHANT_ORDER_OVERDUE` | chủ gian hàng | quá SLA xác nhận hoặc gửi hàng (nhắc tối đa mỗi 12 giờ) |
| `ORDER_PACKED`/`ORDER_SHIPPING`/`ORDER_DELIVERED`/`ORDER_CANCELLED` | khách | như đơn Tubu (`setStatus`) |
| `MERCHANT_ORDER_CANCELLED_BY_SELLER` | khách | đối tác huỷ hoặc giao thất bại, kèm lý do |
| `MERCHANT_PAYOUT_CREATED`/`MERCHANT_PAYOUT_PAID` | chủ gian hàng | admin lập phiếu / đánh dấu đã chuyển |
| `MERCHANT_PRODUCT_APPROVED`/`MERCHANT_PRODUCT_REJECTED` | chủ gian hàng | admin duyệt sản phẩm (SELLER-12) |
| `OPS_MERCHANT_PRODUCT_PENDING` | admin | đối tác gửi sản phẩm mới chờ duyệt |
| `OPS_MERCHANT_PRODUCT_EDIT_PENDING` | admin | đối tác sửa nội dung sản phẩm đang bán, bản sửa chờ duyệt (sản phẩm vẫn bán nội dung cũ) |
| `MERCHANT_PRODUCT_EDIT_APPROVED`/`MERCHANT_PRODUCT_EDIT_REJECTED` | chủ gian hàng | admin duyệt / từ chối bản sửa |

## 7. Tiền

- COD trên đơn đối tác: đối tác thu của khách. Trả trước (Ví Tubu): Tubu giữ.
- Hàng của gian hàng đối tác (sản phẩm có `Product.storefrontId`, cả tự giao lẫn Tubu giao hộ) chỉ bán theo giá lẻ niêm yết
  cộng mã giảm giá của khách (chủ dự án chốt, Q8 S2/S7). Một luật dùng chung `isPartnerOwnedVariation`/`isPartnerOwnedProduct`
  (`cart/partner-goods.ts`, lỗi mã `PARTNER_GOODS_NOT_ELIGIBLE` kèm câu tiếng Việt) cho mọi chương trình:
  - Giá đại lý: bảng giá đại lý bỏ biến thể của gian hàng (`TUBU_OWNED_VARIATION_WHERE`), đặt đơn đại lý có món đó bị từ chối.
  - Đặt định kỳ (giảm giá định kỳ): trang sản phẩm ẩn lựa chọn; tạo hoặc bật lại gói bị từ chối; gói cũ đến kỳ thì tạm dừng
    (lý do `partner_goods`), không lên đơn. Đơn đầu giao ngay gặp món vừa thành hàng của gian hàng trả 400 tiếng Việt kèm mã
    `PARTNER_GOODS_NOT_ELIGIBLE`, không tạo gói lẫn đơn.
  - Combo CTV: không thêm món vào bộ sưu tập loại COMBO; món đã nằm trong combo bị bỏ khỏi combo khi hiển thị và khi tính giảm
    giá combo (`combo.service.ts`), nên giảm combo không bao giờ rơi vào món của gian hàng. Combo còn dưới `MIN_COMBO_PRODUCTS`
    (2) sản phẩm được giảm thì checkout không giảm, nên trang gian hàng trả `comboDiscountPct = null` cho combo đó.
  - Mua chung: không mở nhóm mua chung cho món của gian hàng (trang sản phẩm ẩn nút). Nhóm đã mở trước khi món thành hàng của
    gian hàng: tham gia bị từ chối, nhóm đủ người (kể cả lúc đối soát mã) không phát mã; nhóm chuyển `FAILED`, thành viên nhận
    thông báo `GROUP_BUY_FAILED` như nhóm hết hạn, danh sách nhóm đang mở không gồm nhóm đó.
  - Điểm Xanh: không trả hàng của gian hàng bằng điểm. Số điểm tối đa của lần đặt bằng `pointsRedeemBase` (`checkout-split.ts`):
    tiền các dòng hàng Tubu sau combo, mã, giảm hạng, cộng hàng Tubu giá flash; giỏ chỉ hàng Tubu thì đúng bằng nền cũ. Gửi
    điểm quá mức thì checkout kẹp về mức tối đa, báo giá trả `pointsMax`, `pointsPartnerNote` ("Điểm Xanh chỉ dùng cho hàng của
    Tubu, không dùng cho hàng của gian hàng đối tác") và `pointsNotice` (chỉ khi luật này làm giảm số điểm dùng); tổng đổi so
    với tổng khách thấy thì vẫn trả `TOTAL_CHANGED`. Giỏ chỉ hàng đối tác: ô Điểm Xanh tắt kèm câu giải thích (web, miniapp).
    Mức tối đa và phần tiền từng dòng dùng chung một phép chia: chia một lần trên mọi dòng theo thứ tự kiện (`groupByFulfiller`),
    rồi cộng theo kiện, nên chênh làm tròn không làm dòng nào âm hay giảm vượt tiền hàng. Phép chia lỗi (dòng âm, giảm quá tiền
    hàng, tổng dòng lệch) thì checkout báo lỗi, không tạo đơn (`allocationError`).
  - Giá giờ vàng do admin đặt vẫn áp (admin chủ động chọn): món bán giá flash thì nền đối soát là giá flash khách thực trả.
  - Giảm hạng thành viên vẫn áp như mọi món; phần giảm hạng và phần mã giảm giá của khách áp cho món được trừ vào tiền của gian
    hàng. Mã chỉ áp cho món khác (mã gắn sản phẩm Tubu) không trừ vào món của gian hàng.
- Đơn tự giao và hàng Tubu giao hộ cùng một nền tiền dòng `merchantLineBase` (`merchant-line-base.ts`) = tiền khách thực trả
  cho dòng: giá lẻ hoặc giá flash, trừ phần mã của khách và giảm hạng của chính dòng đó (không có Điểm Xanh). Ví Tubu là cách
  trả, không làm giảm `order.total`. Phí giao giữ như cũ.
- Mỗi khoản giảm chỉ rơi vào dòng được hưởng (review M1): checkout (`allocateLineAmounts`/`allocateGroupAmounts`,
  `checkout-split.ts`) chia combo về đúng dòng của nó → mã giảm giá trên các dòng không flash mà mã áp được (mã gắn sản phẩm
  `Coupon.applyTo.productIds`, kể cả mã mua chung: chỉ dòng sản phẩm đó; chỉ kiện có sản phẩm đó), sau combo → giảm hạng trên
  phần còn lại không flash → Điểm Xanh trên phần còn lại của các dòng hàng Tubu cộng hàng Tubu giá flash (dòng hàng đối tác
  nhận 0 điểm), rồi lưu `OrderItem.paidTotal` = `total` − phần mã, hạng, điểm của dòng (cộng lại = `order.total − shippingFee`)
  và `OrderItem.pointsDiscount` = phần Điểm Xanh của dòng. Trả một phần hoàn điểm theo phần điểm của chính các dòng được trả
  (trả hàng đối tác không hoàn điểm vì dòng đó không dùng điểm); đơn cũ không có `pointsDiscount` hoàn theo tỉ lệ giá trị như
  trước. Đảo cả đơn sau các lần trả một phần chỉ trả phần còn lại của số điểm đã dùng (`remainingPointsBack`): lô quy đổi nhận
  tối đa phần quy đổi chưa trả, lô thường nhận phần còn lại, nên tổng điểm hoàn không vượt số đã dùng. `merchantLineBase`, hoàn tiền khách (`refund-allocation`) và
  hoa hồng CTV (`paidLineTotals`) đọc cùng số này, nên tiền hoàn cho khách và dòng đảo của gian hàng khớp nhau. Đơn cũ (không có
  `paidTotal`, hoặc tổng không khớp) chia tiền hàng thực trả theo `OrderItem.total` như trước; khách vẫn trả đúng tổng như trước,
  phiếu đã lập giữ số đã lưu. Ví dụ (phí sàn 10%, phí giao 30.000):
  - (a) T 200.000 (Tubu) có mã 50.000 chỉ cho T, C 100.000 (giao hộ): C 100.000, thực nhận 90.000 (chia đều: 83.333 / 75.000).
  - (b) mã 20% (40.000) trên T không flash, C mua giá flash 100.000: C 100.000 (chia đều: 86.667).
  - (c) mã 50.000 gắn sản phẩm Tubu P 200.000, M 100.000 của gian hàng tự giao: đơn gian hàng 130.000, hàng 100.000 (chia đều:
    mã 16.667 vào kiện gian hàng → đơn 113.333, gian hàng thu thiếu 16.667).
- Đơn `DELIVERED` quá `merchant.settlement_hold_days` ngày (mặc định 7 = hạn đổi/trả), Tubu đã thu tiền (PAID hoặc COD) thành
  "có thể đối soát":

```
goods      = Σ merchantLineBase(order)              (= order.total − shippingFee, tối đa Σ OrderItem.total)
commission = round(goods × merchantCommissionPct)   (mức chốt trên đơn lúc đặt)
cod        = paymentMethod = COD ? order.total : 0
net        = goods + shippingFee − commission − cod   (> 0: Tubu trả đối tác, < 0: đối tác nộp lại Tubu)
```

  Ví dụ tính tay (race spec `merchant-selfship-paid-base`): A 2 × 100.000, B 1 × 100.000; mã giảm 50.000;
  phí giao 30.000 → khách trả 280.000; phí sàn 10%. goods 250.000 (A 166.667, B 83.333), commission 25.000.
  COD: 250.000 + 30.000 − 25.000 − 280.000 = −25.000 (gian hàng nộp phí sàn); ví: 255.000. Nền cũ (Σ OrderItem.total) cho COD
  +20.000 vì Tubu chịu 50.000 giảm giá. Trả 1 × A: −(83.334 − 8.333) = −75.001; trả nốt: −(166.666 + 30.000 − 16.667) =
  −179.999. Cộng lại: goods, phí giao, phí sàn về 0; net COD = −280.000 (tiền mặt gian hàng giữ, Tubu đã hoàn khách), ví = 0.
- Phiếu đã lập giữ số đã lưu. Dòng đảo của đơn đã có SALE tính trên tiền hàng đã lưu ở SALE: khớp nền hiện tại thì dùng thẳng,
  khác (SALE lập theo nền cũ) thì chia số đã lưu theo `OrderItem.total` (phần dư theo thứ tự id dòng), nên SALE + mọi dòng đảo
  vẫn cộng về đúng như trên.
- Bảng kê đọc bằng nhiều truy vấn READ COMMITTED: đơn lật DELIVERED → RETURNED giữa lúc đọc đơn đủ hạn và lúc đọc đơn bị trả
  chỉ được tính như đơn còn đã giao (SALE); bảng kê sau thấy SALE đã lưu và đảo đúng phần còn lại (review S4). "Sắp đủ hạn" bỏ
  đơn đã có SALE.

- Đơn bị `RETURNED` (Tubu đã hoàn tiền cho khách, hàng về đối tác) → dòng `REVERSAL`, trừ vào phiếu kế tiếp:

```
đã đối soát (có dòng SALE):      goods/ship/commission đảo dấu, cod = 0, net = −(goods + ship − commission)
chưa đối soát, COD đã hoàn tiền: goods = ship = commission = 0, cod = order.total, net = −order.total
chưa đối soát, trả trước:        không lên bảng kê (Tubu giữ tiền và tự hoàn)
```

  Đơn COD đối tác đã thu tiền mặt của khách nhưng tiền hoàn cho khách do Tubu chi, nên đối tác nộp lại đúng số tiền mặt đã thu
  dù đơn chưa từng vào phiếu. Bảng kê ở /merchant giải thích dòng này cho đối tác.
- Admin lập phiếu theo gian hàng (gom mọi dòng đủ điều kiện), chuyển khoản tay vào tài khoản gian hàng khai ở tab "Tài khoản
  nhận đối soát", rồi bấm "Đã chuyển" kèm mã giao dịch. Phiếu âm là "đối tác cần nộp" và được đánh dấu "Đã thu".
- Phí sàn: `Storefront.commissionPct` (admin đặt) hoặc `merchant.commission_pct` (mặc định 0,15). Hoa hồng CTV giới thiệu (nếu
  có) là chi phí của Tubu, không trừ đối tác.
- Hàng "Tubu giao hộ" (Q8, `merchant-consignment.ts`): đơn kho Tubu, tiền khách luôn về Tubu (COD hãng thu hộ Tubu hoặc trả
  trước). Mỗi dòng hàng có biến thể liên kết với gian hàng lúc đặt đơn (`merchant_pancake_links`, khoảng `[linkedAt, unlinkedAt)`)
  là một dòng phiếu riêng, khoá `ITEM:<orderItemId>`, cùng hạn giữ và cùng phiếu với đơn tự giao:

```
paid_i     = OrderItem.paidTotal (đơn cũ: (order.total − shippingFee) chia theo OrderItem.total; phí giao là của Tubu)
commission = round(paid_i × phí sàn của gian hàng)
pctFee     = min(round(paid_i × consignmentFeePct), max(0, paid_i − commission))
opsFee     = pctFee + min(phần của consignmentFeeFixed, max(0, paid_i − commission − pctFee))
             (phần cố định chia theo paid_i giữa các món giao hộ của gian hàng trong đơn; mọi paid_i = 0 thì không thu)
net        = paid_i − commission − opsFee            (shippingFee = cod = 0, không âm)
```

  `paid_i` là `merchantLineBase`, cùng hàm với đơn tự giao: đổi nền tính (tiền khách trả hay tiền hàng) chỉ sửa một chỗ. Chủ dự án
  đã chốt: mã giảm giá của khách và giảm hạng áp cho món được trừ vào số tiền của đối tác (đối tác chịu, Tubu không chịu);
  Điểm Xanh không dùng cho hàng của đối tác nên không bao giờ trừ vào `paid_i`. Ví Tubu là
  phương thức thanh toán, không phải giảm giá: đơn trả bằng ví giữ nguyên `order.total`, nên không làm giảm `paid_i`. Đơn tự
  giao cũng theo nền này (đầu mục 7).

  Điều kiện một dòng hàng vào bảng kê (lọc trong SQL):
  - Đơn `fulfiller = TUBU`, `DELIVERED`, Tubu đã thu tiền: `paymentStatus = PAID` hoặc `paymentMethod = COD` (cùng luật doanh thu
    admin). Đơn công nợ đại lý (chuyển khoản, chưa trả) chờ tới khi PAID. Luật này áp cả cho đơn tự giao.
  - Đơn đặt từ mốc `merchant.consignment_settle_from` (migration đặt bằng lúc triển khai): đơn cũ hơn không tự đối soát. Mốc là
    chuỗi ISO 8601 (không ghi múi giờ thì UTC), đọc và kiểm bằng code rồi truyền vào SQL làm tham số; system-config chặn ghi
    thời điểm không có thật. Giá trị sai đã nằm trong DB (vd `2026-13-01`) không làm lỗi bảng kê: tạm không giới hạn và ghi
    cảnh báo một lần (review S6).
  - Biến thể liên kết với gian hàng lúc đặt. Liên kết takeover (nhận lại mã của sản phẩm Tubu đang bán) chỉ tính đơn đặt từ lúc
    admin bấm "Xác nhận hàng ký gửi" (`consignmentConfirmedAt`); màn liên kết hiện tồn lúc liên kết (`stockAtLink`) để đối chiếu.
  - Hạn giữ tính từ `deliveredAt`; đơn DELIVERED thiếu `deliveredAt` lấy lần chuyển DELIVERED cuối trong
    `order_status_history`, không có nữa thì `updatedAt`.

  Phí chốt theo lúc đặt đơn: mỗi lần admin sửa phí ghi một dòng `storefront_terms_history` (`effectiveFrom` = lúc sửa, người
  sửa); dòng hàng lấy mức có `effectiveFrom` lớn nhất không sau `order.createdAt`. Gian hàng chưa có lịch sử dùng mức hiện tại
  (lần sửa đầu ghi mức cũ làm mốc gốc `effectiveFrom = 0`). Lịch sử lưu phí sàn đã quy ra số (review S1): gian hàng theo mặc
  định lưu `merchant.commission_pct` lúc ghi (đọc thẳng DB trong transaction); đổi `merchant.commission_pct` qua system-config
  ghi, trong cùng transaction và dưới khoá từng gian hàng, một dòng mức mới cho mọi gian hàng đang theo mặc định (chưa có lịch
  sử thì thêm mốc gốc mức cũ). Nâng mặc định 15% → 20% trước khi lập phiếu: món đặt trước giữ 15%. Migration
  `q8_consignment_settlement_terms_resolved` quy ra các dòng NULL bằng mặc định hiện tại.

  Danh sách chỉ đọc "Hàng Tubu giao hộ chưa vào đối soát tự động" (review S5, tab Đối soát của đối tác và bảng kê gian hàng
  của admin): món đã bán (kho Tubu giao, Tubu đã thu tiền, biến thể liên kết lúc đặt) mà không vào bảng kê vì đặt trước mốc
  bắt đầu hoặc liên kết takeover chưa xác nhận lúc đặt; kèm lý do và tiền khách trả cho món, không cộng vào phiếu, tối đa 200
  món mới nhất.

  Lập và huỷ phiếu khoá theo gian hàng (`pg_advisory_xact_lock`), bảng kê tính lại trong transaction; "Lập phiếu" gửi tổng
  admin đang xem, server tính khác thì từ chối (409). Tổng quan admin chỉ dựng bảng kê cho gian hàng mà một câu SQL thấy có khoản
  chờ.

  Việc admin phải làm với đối tác hiện ở "Việc cần xử lý" (R4-ADMIN-7), chỉ ADMIN thấy, mỗi số đếm đúng điều kiện danh sách mở ra
  khi bấm vào: `consignmentPending` (liên kết takeover còn hiệu lực chưa xác nhận hàng ký gửi, `CONSIGNMENT_PENDING_LINK_WHERE`;
  mở "Duyệt SP đối tác" ở chip "Chờ xác nhận ký gửi"), `merchantToSettle` (số gian hàng có dòng đủ hạn trong bảng kê, mở tab
  "Đơn đối tác & đối soát") và `merchantPayoutsPending` (phiếu `PENDING`: chờ chuyển cho đối tác hoặc chờ đối tác nộp lại; chip
  "Chờ xử lý" của danh sách phiếu lọc `status=PENDING` nên phiếu cũ không bị đẩy khỏi trang đầu). Món "chưa vào đối soát tự động"
  vì liên kết takeover chưa xác nhận có nút dẫn thẳng tới màn xác nhận.

  Trả một phần: `REVERSAL` khoá `RETURN:<id yêu cầu>:ITEM:<orderItemId>`, phần của các đơn vị trả trên chính số của dòng SALE
  (luỹ kế). Đơn `RETURNED` (trả cả đơn, Pancake "Đã hoàn") sau khi đã vào phiếu: `REVERSAL` khoá `ITEM:<orderItemId>` đảo phần
  còn lại. Hàng trả về kho Tubu. Phí giao hộ (`Storefront.consignmentFeePct`, `consignmentFeeFixed`, mặc định 0) admin sửa ở tab
  "Đơn đối tác" cùng phí sàn.

## 8. Trả hàng, giám sát

- Trả cả đơn đối tác đi luồng D2/D3 như đơn Tubu (admin duyệt, hoàn tiền); hàng về đối tác. Đối soát tự trừ ngược như mục 7.
- Trả từng dòng (D3, gói p5): khi hoàn một phần trên đơn đối tác đã đối soát cần thêm một dòng `REVERSAL` theo số tiền hoàn —
  ghi ở follow-up vì mô hình trả từng dòng của p5 chưa có trên nhánh nền.
- Admin tab "Đơn đối tác": danh sách quá SLA (`merchant.confirm_sla_hours` mặc định 24, `merchant.ship_sla_hours` 48,
  `merchant.deliver_sla_days` 7), lọc theo gian hàng, mở thẳng đơn. Cron mỗi giờ nhắc đối tác đơn quá hạn.

## 9. "Tubu giao hộ" và dữ liệu MCH_ cũ

- Form đăng sản phẩm có ô "Mã biến thể Pancake" + nút "Kiểm tra" (`GET /merchant/pancake-variations/:code`). Mã hợp lệ khi có
  biến thể đã đồng bộ mang đúng `pancakeId`, đang bán, thuộc sản phẩm Tubu chưa có chủ (hoặc của chính gian hàng). Khi đó mới
  bật được "Tubu giao hộ"; giá và tồn kho theo Pancake.
- Admin duyệt: trong một transaction, chuyển biến thể Pancake đó sang sản phẩm của đối tác (cùng một dòng `Variation`, nên giữ
  chỗ tồn, hoàn kho, đồng bộ tồn Pancake đều không đổi), xoá biến thể tạm, sản phẩm Tubu cũ hết biến thể thì tắt. Đồng bộ Pancake
  về sau chỉ cập nhật giá/tồn của biến thể theo `pancakeId`, không kéo nó về sản phẩm cũ. Hai đối tác xin cùng mã: lần duyệt sau
  bị từ chối (cập nhật có điều kiện `productId = sản phẩm cũ`). Đối tác sửa tên, mô tả hoặc ảnh sản phẩm đang bán (kể cả sản phẩm
  đã liên kết) không gỡ nó khỏi trang bán: bản sửa lưu ở `product_edit_drafts` (tối đa một dòng mỗi sản phẩm, đối tác sửa tiếp
  thì gộp vào), sản phẩm giữ nội dung đã duyệt, trạng thái `APPROVED` và biến thể Pancake cho tới khi admin duyệt bản sửa
  (ghi đè nội dung) hoặc từ chối (giữ nội dung cũ, lý do ở `rejectReason`). Hai admin duyệt cùng một bản sửa: xoá bản chờ có
  điều kiện theo `updatedAt` nên chỉ một bên thắng. Lần duyệt thấy biến thể đã thuộc chính sản phẩm này thì không chuyển gì nữa,
  chỉ báo trùng mã khi biến thể đang thuộc sản phẩm khác.
- Duyệt đúng mã admin đã xem (`POST /admin/merchant-products/:id/review`): màn duyệt luôn gửi kèm mã Pancake đang hiện
  (`expectedPancakeCode`, chuỗi rỗng khi dòng không có mã) và, khi admin tích xác nhận chuyển sản phẩm đang bán, sản phẩm đó
  (`expectedTakeoverProductId`). Cả hai đều tuỳ chọn. Gửi mà khác dữ liệu hiện tại (đối tác đổi mã sau khi admin mở danh sách,
  biến thể đã sang sản phẩm đang bán khác) thì 409 `PANCAKE_CODE_CHANGED` hoặc `PANCAKE_TAKEOVER_CHANGED`, không lật trạng thái
  và màn duyệt tải lại danh sách. Bỏ trống (không gửi hoặc `null`, vd gọi thẳng API) thì duyệt theo mã và sản phẩm đang có,
  không còn 409, và API ghi cảnh báo nêu admin, bản ghi liên kết và mã đã duyệt. Chuyển sản phẩm đang bán vẫn bắt buộc
  `confirmTakeover` (409 `PANCAKE_TAKEOVER_UNCONFIRMED`) và lần lật trạng thái vẫn có điều kiện theo mã lúc đọc. Chủ quyết định
  nới ngày 2026-10-15; trước đó (review đợt 7) bỏ trống mã bị 409.
- Không tích "Tubu giao hộ" (hoặc không nhập mã): sản phẩm `MERCHANT`, không có `pancakeId`, đối tác tự khai và tự sửa tồn.
  Chỉ gian hàng loại `MERCHANT` được tạo sản phẩm (kể cả admin vào gian hàng CTV cũng không), vì chỉ loại này có tab giao đơn.
- Migration `p8_seller_merchant_fulfilment`: `pancakeId` thành nullable; mọi `pancakeId LIKE 'MCH\_%'` (sản phẩm và biến thể) đổi
  về `NULL`, sản phẩm đó thành `MERCHANT`. Sản phẩm `MERCHANT` nằm ở gian hàng không phải loại `MERCHANT` bị tắt bán (không ai
  giao được); đơn cũ chỉ chuyển sang `fulfiller = MERCHANT` khi mọi dòng là hàng tự giao của gian hàng loại `MERCHANT`. Chạy lại
  không đổi gì; không đụng dòng khác.
- Kênh khác cũng đẩy Pancake (đơn đại lý, gói định kỳ, CTV lên đơn hộ) chỉ nhận hàng `isPancakeFulfilledLine`; bảng giá đại lý
  không hiện hàng đối tác tự giao.
- Cron cứu hộ đẩy Pancake chỉ quét đơn `fulfiller = TUBU`.

## 10. Ngoài phạm vi / việc sau

- Thanh toán chuyển khoản/ZaloPay cho đơn đối tác và cho lần đặt bị tách (cần một lệnh thanh toán cho nhiều mã đơn và đường
  đối soát không qua Pancake).
- Trả từng dòng trên đơn đối tác đã đối soát (mục 8).
- Đối tác tự in vận đơn/tích hợp hãng vận chuyển: hiện đối tác tự gửi và nhập mã vận đơn tay.
