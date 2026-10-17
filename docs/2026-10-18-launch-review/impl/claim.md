# Gói claim: thẻ QR hộp hàng sàn, mã chỉ khách mới, freeship đơn đầu (D2-03, D2-08)

Nhánh `lr/claim`. Chủ dự án in thẻ QR bỏ vào hộp hàng giao từ sàn. Khách quét thẻ, Mini App mở và mã vào ví của khách. Mã đó chỉ khách mới dùng được, để khách đặt đơn đầu trực tiếp với Tubu Tree. Mọi mức tiền để chủ dự án quyết. Mặc định không có mã nào được phát và freeship đơn đầu tắt, nên khi chưa có ai bật thì hành vi giữ y như trước.

## 1. Đã làm gì

### D2-03: mã ẩn, chỉ khách mới, nhận mã, lô mã in thẻ

- **Schema** (migration `20261018000700_coupon_claims`): thêm phạm vi `CouponScope.CLAIM`, cột `coupons.newCustomerOnly` (mặc định false) và `coupons.batch`, bảng `coupon_claims` (unique `couponId + userId`). Mã CLAIM chỉ vào ví và chỉ áp được khi khách đã có dòng nhận (`coupon-scope.ts`, `isCouponEligible`). Mã CLAIM và mã `newCustomerOnly` đòi khách thật (`requiresRealUser`), cùng luật voucher chào mừng ở `common/real-user.ts`.
- **"Khách mới"** (`apps/api/src/common/first-order.ts`): khách chưa có đơn nào ở bất kỳ trạng thái nào trừ `CANCELLED`. Đơn chờ thanh toán và đơn trả hàng có tính. Đơn của tài khoản khách đã gộp vào cũng tính, vì lúc gộp đơn đã được chuyển sang. Luật này kiểm ba lần: lúc báo giá (`validateAndCompute`, `previewMany`), lúc liệt kê ví (`getAvailableCoupons` ẩn mã chỉ-khách-mới với khách đã có đơn), và trong transaction đặt đơn (`redeemInTx` → `assertFirstOrderInTx`). Lần kiểm cuối giữ khoá `pg_advisory_xact_lock('first-order', userId)` rồi đọc lại. Khi đọc lại thì bỏ qua các đơn của chính lần đặt, theo `orderIds` và `checkoutGroup` của đơn tách kiện.
- **Nhận mã** (`coupons/coupon-claim.service.ts`, `coupons.controller.ts`): `POST /coupons/claim {code}` cần đăng nhập, có throttle 10 lần/phút, và gọi lại nhiều lần vẫn cho cùng kết quả (khách quét lại thẻ thì nhận `alreadyClaimed: true`, không ghi thêm dòng). Số người nhận không vượt `usageLimit`, nhờ khoá theo mã rồi đếm. Mã một lượt (thẻ riêng) thì người thứ hai nhận thông báo "đã được tài khoản khác nhận". Khách đã có đơn bị từ chối trước khi ghi, nên không chiếm mất suất của thẻ. Khách gõ mã thẻ ở giỏ (Mini App hoặc web) thì hệ thống tự nhận rồi áp mã (`cart.service.ts` → `claimHiddenForCart`). Khi gộp tài khoản khách vào tài khoản Zalo, các lượt đã nhận đi theo (`auth.service.ts`).
- **Lô mã in thẻ** (`admin/admin-coupon-batch.service.ts` và `.controller.ts`, chỉ ADMIN): `POST /admin/coupon-batches` tạo N mã CLAIM, mỗi mã 1 lượt nhận và 1 lượt dùng, dạng `TIỀNTỐ-XXXXXXXX`. Phần ngẫu nhiên gồm 8 ký tự `crypto.randomInt`, bỏ 0/O/1/I. Tạo trùng tiền tố thì nhận 409. `GET /admin/coupon-batches` trả thống kê (tổng, đã nhận, đã dùng, đang bật). `GET :batch/codes` trả mã kèm link nhận. `PATCH :batch {isActive}` tắt cả lô. Luật tiền dùng chung với tạo mã lẻ (`admin/coupon-input-rules.ts`). Danh sách voucher mặc định ẩn các mã thuộc lô, để 2.000 mã không làm tràn danh sách; tìm đúng mã thì vẫn ra.
- **Mini App**: `components/coupon-claim-gate.tsx` và `services/coupon-claim.ts`. Mở link có `?claim=CODE` thì mã được lưu trên máy (`tubu_pending_claim`).
  - Đã đăng nhập Zalo: mã được nhận ngay, rồi hiện sheet "Bạn nhận được ưu đãi" gồm mức giảm, hạn dùng và dòng "Dành cho đơn đầu tiên". Nút "Dùng ngay" mở giỏ nếu giỏ có hàng, không thì mở trang mua sắm.
  - Tài khoản khách: sheet mời "Đăng nhập bằng Zalo". Đăng nhập xong thì mã tự nhận. Nếu khách bỏ qua, lần mở app sau đã đăng nhập thì mã tự vào ví.
  - Lỗi nghiệp vụ: báo đúng lý do, rồi bỏ mã đang lưu.
  - Mất mạng: giữ mã đang lưu, có nút "Thử lại".
  - `app.tsx` chỉ thêm 2 dòng. Quiz chào mừng không phủ màn hình khi app mở từ link thẻ (`onboarding-rules.ts`).
- **Web admin**, tab Voucher (`components/admin/claim-campaign-panel.tsx`; `page.tsx` thêm 2 dòng): khung "Thẻ hộp hàng sàn (mã ẩn)".
  - Kiểu "Lô mã riêng": tạo xong tự tải file CSV có 2 cột `code,url`.
  - Kiểu "Một mã chung cho cả đợt".
  - Danh sách lô kèm số đã nhận/đã dùng, nút tải lại CSV, nút tắt/bật lô (có hỏi xác nhận).
  - Cảnh báo khi chưa đặt `app.miniapp_base_url`.
  - Danh sách mã (`coupon-list.tsx`) có thêm nhãn "Ẩn · thẻ hộp hàng", "Chỉ khách mới" và số lượt đã nhận.

### D2-08: freeship đơn đầu

- Thêm 2 khoá SystemConfig: `shipping.first_order_free_enabled` (mặc định `false`, chỉ nhận đúng giá trị boolean) và `shipping.first_order_free_min_subtotal` (mặc định `0`, số nguyên đồng từ 0 đến 50 triệu). Thêm luật ghi cho `app.miniapp_base_url` (để trống hoặc là link https). Migration `20261018000710_claim_freeship_config` tạo 3 dòng này bằng đúng mặc định trong mã, với `ON CONFLICT DO NOTHING`.
- `pricing.service.ts` có 2 hàm mới:
  - `firstOrderFreeShipFrom` trả ngưỡng tiền hàng, hoặc null khi cờ tắt, khi là khách vãng lai, hoặc khi khách đã có đơn. Khi cờ tắt thì hàm không đọc DB.
  - `firstOrderShippingFee` miễn phí giao cho kiện Tubu khi tiền hàng của kiện đạt ngưỡng.
- `checkout.service.ts` (diff 36 dòng) áp freeship đơn đầu ở báo giá, ở xem trước mã và lúc đặt đơn:
  - Freeship đơn đầu được trừ trước mã FREESHIP. Mã FREESHIP vì thế không bị tiêu cho đơn đã miễn phí giao.
  - Trong tx đặt đơn, chốt `assertFirstOrderInTx` chạy trước bước ghi lượt mã. Thứ tự khoá giống `CouponsService`: khoá first-order trước, khoá mã sau.
  - Báo giá trả thêm trường `firstOrderShipWaived`.
- Giỏ (`cart.service.ts`): thanh tiến độ freeship dùng ngưỡng đơn đầu khi ngưỡng này thấp hơn ngưỡng thường.

## 2. Kiểm chứng

| Lệnh | Kết quả |
|---|---|
| `npx jest src/modules/coupons src/modules/admin src/modules/pricing src/modules/checkout src/modules/cart src/modules/loyalty/loyalty.service.spec.ts src/modules/system-config src/common/first-order.spec.ts src/modules/auth` | `Test Suites: 49 passed, 49 total`, `Tests: 1201 passed, 1201 total` |
| Race spec mới, Postgres 5566: `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/claim-first-order.race-spec.ts` | `Tests: 17 passed, 17 total`. Hai lần đặt song song cùng một mã chỉ-khách-mới: 1 thành công, 1 bị từ chối với lỗi "Mã này chỉ dành cho khách đặt đơn đầu tiên". Hai lần đặt song song khi bật freeship đơn đầu: 1 đơn phí 0, lần kia bị từ chối với yêu cầu tải lại. Một khách nhận 10 lần song song: 1 dòng. 6 khách cùng nhận một thẻ riêng: đúng 1 người nhận được. Mã chung 3 lượt, 8 khách nhận: đúng 3. Freeship đang tắt: phí giao vẫn 19k. Bật: đơn đầu 0đ, đơn thứ hai 19k, khách vãng lai 19k. Gộp tài khoản chuyển lượt nhận. Tạo/thống kê/tắt lô trên DB thật |
| Thử phá: bỏ chốt trong tx của checkout, rồi bỏ chốt trong `redeemInTx` (`MUTANT=1`) | Mỗi lần ca song song tương ứng đỏ: `fulfilled=2 errors=[]`, tức 2 đơn cùng qua. Đã khôi phục mã sau mỗi lần thử |
| Race spec cũ liên quan: `my-coupons-query`, `coupon-preview-equals-quote`, `p6-promo-abuse`, `auth-merge-guest`, `split-coupon-release`, `coupon-cleanup`, `cart-combo-equals-quote`, `buy-flow-4a`, `checkout-*`, `buy-flow-4b`, `buyer-totals-regression`, `split-checkout`, `r6-checkout`, `r13-merge-checkout-lock`, `pd3-checkout-points`, `vouchers-real-user` | 18 suite xanh, 120 test |
| `npx prisma migrate deploy` lên 5566, rồi `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` | Migrate xong không lỗi; diff trả `exit 0` (không lệch) |
| Mini App: `npx vitest run src/services/coupon-claim.spec.ts src/components/coupon-claim-gate.spec.tsx src/components/onboarding.spec.tsx` | `Tests 30 passed (30)` |
| Mini App, các spec quét mã nguồn (thuật ngữ, vùng chạm, token DS, biến CSS) | `Test Files 17 passed (17)`, `Tests 624 passed (624)` |
| Web: `npx vitest run src/components/admin src/app/admin src/*.spec.ts` | `Test Files 42 passed (42)`, `Tests 886 passed (886)` |
| `npx tsc --noEmit -p tsconfig.json` ở api, miniapp, web; `npx eslint <file đã sửa> --max-warnings=0` | Không lỗi |

Chỉ chạy trên DB `tubutree_it` ở cổng 5566. Không chạm DB dev hay PROD. Không build, không chạy Playwright.

## 3. Chưa làm hoặc cố ý để lại

- **Trang web `/nhan-uu-dai`**: chưa làm. Link QR mở Mini App. Trên web, khách gõ mã thẻ ở giỏ thì hệ thống tự nhận rồi áp mã (cùng endpoint giỏ), nên mã in trên thẻ vẫn dùng được trên web mà không cần trang riêng.
- **Câu "Miễn phí giao đơn đầu" ở trang thanh toán**: chưa làm, vì `pages/checkout.tsx` đang bị phiên khác sửa. Phí giao đã hiện 0đ. API trả sẵn `firstOrderShipWaived` để thêm dòng chữ này sau.
- **Nhãn "Chỉ khách mới" trong ví Mini App**: chưa có. Kiểu dữ liệu `/me/coupons` giữ nguyên; ví đã ẩn mã chỉ-khách-mới với khách đã có đơn.
- **Đơn tạo từ đường khác** (POS, đại lý, đơn định kỳ): vẫn tính là "đã có đơn", vì luật đếm mọi đơn của tài khoản trừ đơn huỷ. Các đường này không lấy khoá first-order. Chốt trong tx vẫn thấy đơn của chúng khi đơn đã commit. Trường hợp một đơn POS commit đúng lúc khách đang đặt đơn đầu là rất hẹp và không thành lỗi tiền lớn (khách được một lần freeship hoặc mã đơn đầu).
- **Chống dò mã**: phần ngẫu nhiên của mã có 32^8 ≈ 1,1 nghìn tỉ khả năng, cộng throttle 10 lần/phút mỗi tài khoản, và mỗi lần nhận đòi tài khoản Zalo thật. Chưa có khoá dò theo thiết bị/IP riêng.
- **Seed**: không thêm vào `seed.ts` (file của phiên khác). Migration đã tạo 3 dòng cấu hình nên tab Cấu hình thấy chúng.

## 4. Cách chủ dự án tạo đợt thẻ hộp hàng

1. **Cấu hình link** (làm một lần): Web admin, tab Cấu hình, nhóm `app`, khoá `app.miniapp_base_url`. Nhập link Mini App dạng `https://zalo.me/s/<appId>` rồi lưu. Chưa đặt thì khung thẻ hiện cảnh báo vàng, và link trong CSV chưa in QR được.
2. Mở tab **Voucher**, kéo tới khung **"Thẻ hộp hàng sàn (mã ẩn)"**.
3. Chọn kiểu đợt:
   - **"Lô mã riêng (mỗi thẻ một mã)"** (khuyên dùng): nhập *Tiền tố lô* (vd `SHOPEE11`, mỗi đợt một tiền tố riêng) và *Số thẻ* (tối đa 2.000 mỗi lô; cần nhiều hơn thì tạo thêm lô với tiền tố khác). Mỗi thẻ chỉ một khách nhận và dùng một lần. Thẻ lọt ra ngoài cũng chỉ mất một suất.
   - **"Một mã chung cho cả đợt"**: nhập *Mã chung* (vd `SHOPEETHANG11`) và *Tổng lượt nhận*. In cùng một mã trên mọi thẻ. Mã dễ bị chia sẻ lên nhóm, nên luôn đặt tổng lượt.
4. Nhập ưu đãi: loại (giảm tiền, giảm %, hoặc freeship), mức giảm, đơn tối thiểu, giảm tối đa (bắt buộc với mã từ 50%), ngày bắt đầu và ngày hết hạn. Nên để hạn dài, vì thẻ nằm trong kho và trong hộp hàng nhiều tuần. Ô **"Chỉ khách mới"** bật sẵn.
5. Bấm **"Tạo lô và tải CSV"** (hoặc **"Tạo mã chung"**).
   - Lô: trình duyệt tải file `the-hop-hang-<TIỀNTỐ>.csv` gồm cột `code` (in chữ trên thẻ) và cột `url` (nhà in trộn cột này thành mã QR).
   - Mã chung: màn hình báo "Link in QR: …" để đưa nhà in.
6. Gửi file cho nhà in. Mỗi thẻ in một QR theo `url` và in chữ `code` bên dưới, để khách không quét được thì gõ mã ở giỏ.
7. **Theo dõi**: mục "Các lô đã tạo" hiện "N thẻ · Đã nhận X · Đã dùng Y". Nút "Tải lại CSV" xuất lại file. Thẻ bị lộ thì bấm **"Tắt lô"**: đơn đã đặt giữ nguyên, thẻ chưa dùng hết hiệu lực. Mã chung xem và tắt ở danh sách "Mã đã tạo" (tìm theo mã).
8. Muốn kèm freeship đơn đầu: tab Cấu hình, đặt `shipping.first_order_free_enabled = true` và nếu cần đặt `shipping.first_order_free_min_subtotal`. Thay đổi có hiệu lực tối đa sau 60 giây (thời gian giữ cache).

## 5. Câu hỏi cho chủ dự án (mặc định đang dùng)

1. **Giá trị mã thẻ**: loại, mức giảm, đơn tối thiểu, hạn dùng? Mặc định là chưa tạo mã nào. Gợi ý cách nghĩ: giảm tiền có đơn tối thiểu, mức giảm nhỏ hơn biên lợi nhuận đơn đầu, hạn 60 đến 90 ngày.
2. **Lô riêng hay mã chung, bao nhiêu thẻ mỗi đợt/sàn?** Mặc định form mở sẵn kiểu "Lô mã riêng".
3. **"Chỉ khách mới" mặc định bật** trong form thẻ. Có muốn khách cũ mua trên sàn cũng nhận được không? Nếu muốn thì bỏ tick ô này khi tạo lô.
4. **Định nghĩa đơn đầu**: đơn chờ thanh toán và đơn đã trả hàng đều tính là "đã có đơn", chỉ đơn huỷ không tính. Đơn chờ thanh toán quá hạn sẽ bị cron huỷ và khi đó không còn tính. Anh/chị có đồng ý không?
5. **Freeship đơn đầu**: có bật không, và ngưỡng tiền hàng là bao nhiêu? Mặc định là tắt, ngưỡng 0. Nếu bật, freeship cộng dồn với mã thẻ chỉ-khách-mới (đơn đầu vừa được giảm vừa được miễn phí giao), và mã FREESHIP của khách sẽ không bị tiêu cho đơn đó. Có muốn chặn cộng dồn không?
6. **`app.miniapp_base_url`**: cần link Mini App thật trước khi in thẻ. Hiện đang để trống.
