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
3. Giảm giá tính trên TOÀN lần đặt như hiện tại (combo → mã → hạng → Điểm Xanh), rồi phân bổ về từng kiện:
   combo theo đúng dòng; mã, giảm hạng và Điểm Xanh chia theo tỉ lệ giá trị hàng của kiện (phần dư làm tròn dồn theo phương
   pháp số dư lớn nhất để tổng khớp từng đồng). Điểm đã dùng (lô thường và lô quy đổi) chia theo cùng tỉ lệ để huỷ một đơn
   con hoàn đúng phần điểm của đơn đó.
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
   COD/Ví vì một lệnh thanh toán ngoài chỉ trỏ được một mã đơn. Báo giá trả `blockedPaymentMethods` (phương thức → câu lý do)
   để FE tắt sẵn lựa chọn không hợp lệ, hiện đúng lý do và tự chuyển về COD; API vẫn chặn (mã lỗi `PAYMENT_METHOD_NOT_ALLOWED`).
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

## 7. Tiền

- COD trên đơn đối tác: đối tác thu của khách. Trả trước (Ví Tubu): Tubu giữ.
- Mã giảm, giảm hạng, Điểm Xanh là Tubu tài trợ; combo của gian hàng tính vào giá dòng (`OrderItem.total`).
- Đơn `DELIVERED` quá `merchant.settlement_hold_days` ngày (mặc định 7 = hạn đổi/trả) thành "có thể đối soát":

```
goods      = Σ OrderItem.total                      (đã trừ combo)
commission = round(goods × merchantCommissionPct)
cod        = paymentMethod = COD ? order.total : 0
net        = goods + shippingFee − commission − cod   (> 0: Tubu trả đối tác, < 0: đối tác nộp lại Tubu)
```

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
paid_i     = (order.total − shippingFee) chia theo OrderItem.total (distributeByWeight; phí giao là của Tubu)
commission = round(paid_i × phí sàn của gian hàng)
opsFee     = round(paid_i × consignmentFeePct) + phần của consignmentFeeFixed (chia theo paid_i giữa các món giao hộ của gian hàng trong đơn)
net        = paid_i − commission − opsFee            (shippingFee = cod = 0)
```

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
  bị từ chối (cập nhật có điều kiện `productId = sản phẩm cũ`). Đối tác sửa nội dung sản phẩm đã liên kết đưa nó về chờ duyệt;
  lần duyệt lại thấy biến thể đã thuộc chính sản phẩm này thì không chuyển gì nữa (kể cả hai admin duyệt lại cùng lúc), chỉ
  báo trùng mã khi biến thể đang thuộc sản phẩm khác.
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
