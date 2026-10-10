# PC-5 — CTV / đại lý / nhãn hàng

Nhánh `hz5/PC-5` (từ `hardening/2026-10` @ `cb92dc8`).

## Lượt 1/2 — C-034 (Q-18) và C-006

### C-034 — Tab "Doanh thu" chỉ-đọc cho chủ nhãn, ẩn PII khách: XONG

Quyết định chủ dự án Q-18 (mục 9 roadmap): tab chỉ-đọc trong `/brand-owner`, số đơn, doanh thu, SP bán chạy theo kỳ, ẩn PII.

**API** `GET /brand/owner/me/sales?period=7d|30d|90d|month|prev_month` (mặc định `30d`)
- `apps/api/src/modules/brand/brand.service.ts` `getOwnedSales`, `brand.controller.ts`, `dto/brand.dto.ts` (`BrandSalesQueryDto`, `BRAND_SALES_PERIODS`).
- Quyền: nhãn lấy từ `Brand.ownerUserId` của người gọi (`assertOwnedBrand`), không nhận `brandId` từ client; DTO `forbidNonWhitelisted` nên tham số thừa bị từ chối. Người không sở hữu nhãn: 404.
- Chỉ số tổng hợp: `orderCount`, `unitsSold`, `revenue`, `delivered {orderCount, revenue}`, `topProducts` (tối đa 10: productId, name, slug, quantity, revenue). Không có truy vấn nào đọc bản ghi đơn (chỉ `groupBy`/`count`/`aggregate`), nên không thể kéo tên/SĐT/địa chỉ/mã đơn/userId.
- Gán dòng hàng cho nhãn qua `OrderItem.variationId -> Variation.productId -> Product.brandId` (OrderItem không có quan hệ tới Variation nên lấy trước danh sách variationId của nhãn). Đơn có hàng của nhiều nhãn chỉ tính phần dòng của nhãn này.
- Kỳ `month`/`prev_month` theo lịch giờ Việt Nam (UTC+7).

**Miniapp**
- `pages/brand-owner.tsx`: `SegmentedTabs` "Hồ sơ & khuyến mãi" | "Doanh thu"; tab Doanh thu là `pages/brand-owner-sales.tsx` (DS v2: `SegmentedTabs` làm bộ chọn kỳ, `StatTile`, `Skeleton`, `EmptyState`, `ErrorState`, `Text`/`Heading`); `services/brand-owner-api.ts` thêm `getOwnedBrandSales`.
- Dọn lỗi ESLint tubu-ds có sẵn của file: `Button` import thẳng từ `zmp-ui` -> `components/ui/button`; nút "Sửa"/"Xoá" khuyến mãi và ô ngày nâng lên vùng chạm 44px.

**Test (đỏ -> xanh)**
- `src/modules/brand/brand-owner-sales.spec.ts` (jest, 14 case): viết trước khi có `getOwnedSales`/`BrandSalesQueryDto` (đỏ do chưa có export), rồi xanh. Phủ: 404 + không chạm bảng đơn khi không sở hữu nhãn, phạm vi theo variationId của đúng nhãn, loại trạng thái, gộp theo SP/sắp xếp/top 10, không lộ PII, nhãn rỗng, các kỳ giờ VN (kể cả rạng sáng 01h VN, tháng 1 -> tháng 12 năm trước), DTO.
- `test/integration-race/brand-owner-sales.race-spec.ts` (Postgres thật `tubu_it_pc5:5565`, 4 case): hai nhãn + SP không nhãn + đơn pha trộn + các trạng thái bị loại + đơn 40 ngày trước; kiểm cách ly giữa các nhãn, kỳ, 404, JSON không chứa tên/SĐT/địa chỉ/userId/mã đơn. Kiểm chứng test có tác dụng: tạm bỏ bộ lọc trạng thái -> 2/4 ĐỎ (orderCount 5 thay vì 2, unitsSold 6 thay vì 3); trả lại -> 4/4 xanh.
- `apps/miniapp/src/pages/brand-owner.spec.tsx` (vitest, 8 case): 2 tab, tab Doanh thu hiện số liệu + SP bán chạy + câu "không hiện thông tin khách", đổi kỳ gọi lại API, trạng thái rỗng, lỗi + thử lại. 6/8 đỏ trước khi viết tab, 8/8 xanh sau.

### C-006 — Khuyến mãi nhãn gắn mã giảm giá có thật: XONG

- `brand.service.ts`: `createPromotion`/`updatePromotion` (dùng chung cho admin và chủ nhãn tự quản) gọi `resolvePromotionCoupon`: mã phải có trong bảng `Coupon`, `scope = PUBLIC`, chưa hết hạn, còn lượt (`usedCount < usageLimit`); sai thì 400 tiếng Việt ("Mã giảm giá ..."). Lưu đúng chuỗi `Coupon.code` (checkout so khớp chính xác), không lưu chuỗi người nhập. Mã có hiệu lực từ ngày mai vẫn được gắn (lên lịch chiến dịch trước).
- `updatePromotion`: giữ nguyên mã đang lưu thì không kiểm lại (sửa tiêu đề không bị chặn vì mã hết hạn sau đó); `couponCode` rỗng = gỡ mã (trước đây không có cách gỡ).
- `getPublicBySlug` (brand-view): với mã cũ lưu tự do từ trước hoặc mã đã chết/hết lượt/chưa hiệu lực, trả `couponCode: null` (khuyến mãi vẫn hiện, chỉ mất nút "chạm để chép"); mã dùng được trả đúng `Coupon.code`. Chỉ tốn thêm 1 truy vấn khi có khuyến mãi gắn mã. `brand-view.tsx` không cần đổi.
- `PromotionDto`/`UpdatePromotionDto`: `couponCode` thêm `@MaxLength(64)`.
- Miniapp: khi sửa, ô mã trống gửi `''` để gỡ mã; thêm khuyến mãi không nhập mã không gửi `couponCode`; lỗi 400 của máy chủ hiện nguyên thông báo (đã có sẵn qua `getErrorMessage`); lời nhắc dưới ô mã cập nhật ("do Tubu tạo sẵn, công khai và còn hạn").
- Test: `src/modules/brand/brand-promotion-coupon.spec.ts` (jest, 11 case; 9 đỏ trước khi sửa service, xanh sau) + 3 case trong `brand-owner.spec.tsx`.

### Lệnh kiểm chứng (output thật)

```
cd apps/api && npx jest --maxWorkers=1 src/modules/brand
  Test Suites: 4 passed, 4 total   Tests: 64 passed, 64 total
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5565/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/brand-owner-sales.race-spec.ts
  Tests: 4 passed, 4 total
cd apps/miniapp && npx vitest run src/pages/brand-owner.spec.tsx src/components/ui/button-guard.spec.ts src/pages/profile.spec.ts
  Test Files 3 passed (3)   Tests 14 passed (14)
npx tsc --noEmit (apps/api, apps/miniapp): 0 lỗi; npx eslint các file đã sửa: 0 lỗi (1 cảnh báo `import()` type ở spec, cùng kiểu với orders.spec.tsx)
node scripts/check-undefined-css-vars.mjs: OK
grep -ci 'doanh thu' apps/miniapp/src/pages/brand-owner.tsx -> 1 (>0)
```

Lưu ý khi chạy: có một lần race spec báo "Can't reach database server at localhost:5565" giữa chừng (kết nối Docker chập chờn, container vẫn `Up`); chạy lại ngay thì xanh, không liên quan code.

### Migration

Không có (không đổi schema).

### Giả định

- Doanh thu của nhãn = tổng `OrderItem.total` của dòng hàng thuộc SP của nhãn, tức giá bán x số lượng, TRƯỚC mã giảm giá toàn đơn và chưa gồm phí ship (giảm giá theo đơn không chia công bằng được cho từng nhãn). Ghi rõ trong chú thích cuối tab.
- Đơn được tính: trạng thái khác `PENDING_PAYMENT`/`CANCELLED`/`RETURNED` và `paymentStatus` khác `REFUNDED`/`FAILED`. Phương án thận trọng: đơn chuyển khoản chưa trả không làm phồng doanh thu; đơn COD (vào thẳng CONFIRMED) tính ngay. `delivered` tách riêng số đã giao để chủ nhãn tự đối soát.
- Gán SP vào nhãn theo `Product.brandId` hiện tại: nếu admin chuyển SP sang nhãn khác thì lịch sử doanh thu đi theo nhãn hiện tại (không có snapshot nhãn trên OrderItem).
- Không làm danh sách đơn từng dòng cho chủ nhãn: Q-18 chỉ yêu cầu số đơn/doanh thu/SP bán chạy; không hiển thị mã đơn để không mở đường tra cứu chéo.
- Mã giảm giá gắn vào khuyến mãi bắt buộc `scope = PUBLIC`: mã riêng cho nhóm/hạng/sinh nhật/giới thiệu không thể công khai trên trang nhãn (khách khác dán vào sẽ bị từ chối).

### Việc còn lại (lượt 2/2 do lượt khác làm)

C-064, C-067, C-081, C-029, C-117. Việc cần người: duyệt định nghĩa "doanh thu" ở trên (trước mã giảm giá toàn đơn) với chủ dự án nếu muốn dùng làm đối soát chi trả cho nhãn.

## Lượt 2/2 — C-064, C-067, C-081, C-029, C-117

Trạng thái: cả 5 mục XONG trong phạm vi gói. Hai việc liền kề ghi ở "Việc còn lại" vì nằm ngoài nhóm file.

### C-067 — Chia sẻ lỗi không còn bị nuốt: XONG

- `components/share-sheet.tsx` thêm hook `useShareWithFallback()`: khi `shareLink` reject thì chép sẵn liên kết (đã có `?ref=` mã giới thiệu) vào clipboard và báo snackbar; không chép được thì báo lỗi hướng dẫn chép tay. Nút trong ShareSheet chuyển sang Button DS v2.
- Dùng ở 3 chỗ: `ShareSheet`, nút chia sẻ mã giới thiệu ở `pages/affiliate.tsx`, và `components/content-kit-sheet.tsx` (cùng lỗi nuốt lỗi trên đường chia sẻ chính của CTV; file ngoài nhóm, sửa tối thiểu).
- Giả định: người dùng tự đóng hộp thoại Zalo cũng có thể làm `shareLink` reject (chưa kiểm chứng mã lỗi SDK) nên thông điệp viết theo hướng "chưa chia sẻ được, đã chép sẵn liên kết" để không gây hoảng nếu đó chỉ là huỷ.
- Test: `share-sheet.spec.tsx` (4), `affiliate.spec.tsx` (có case chia sẻ lỗi), `content-kit-sheet.spec.tsx` (1). Mỗi case viết trước, chạy đỏ với mã cũ hoặc với đột biến (hook nuốt lỗi), rồi xanh.

### C-081 — Đại lý đặt trước hàng hết/chưa về, nhãn -X% đúng: XONG

- `pages/dealer.tsx`: `QuantitySelector` không còn chặn theo `row.stock` mà theo `DEALER_MAX_QTY` (9999, chỉ chặn gõ nhầm). Dòng hết hàng ghi "Hết hàng — được đặt trước"; số lượng vượt tồn hiện "Đặt trước N, giao khi hàng về"; thanh tổng nhắc phần thiếu giao khi hàng về; sau khi đặt, thông báo riêng nếu đơn có `backorderedQty > 0`. API `placeOrder` đã hỗ trợ đặt trước từ trước, không đổi API.
- Nhãn `-X%` tính phía client từ `retailPrice` và `dealerPrice` của chính dòng (`pages/dealer-pricing.ts`), không dùng `discountPct` mặc định của bậc (giá riêng theo bậc làm hai số lệch nhau). Không hiện nhãn khi không giảm.
- Test: `pages/dealer.spec.tsx` (9: helper `preorderQty`/`realDiscountPct` và hành vi trên màn).

### C-029 — CTV nhận thông báo hoa hồng: XONG

- Mẫu seed (INAPP, `createOnly`) trong `prisma/seed.ts`: `COMMISSION_NEW`, `COMMISSION_APPROVED`, `COMMISSION_PAYOUT_PAID`. Mã bắt đầu bằng `COMMISSION` để màn Thông báo gom vào nhóm "Hoa hồng CTV" sẵn có. Hằng mã ở `affiliate/ctv-notification-codes.ts`.
- `AffiliateService` thêm `@Optional() NotificationsService` (cuối constructor nên test cũ không đổi):
  - Hoa hồng mới: `notifyCommissionCreated(orderId)` gọi SAU commit đơn (hoa hồng sinh trong tx đơn nên không báo từ trong tx, tránh báo khoản bị rollback). Không báo đơn CTV tự lên hộ; payload không chứa `order_code` (đó là đơn của khách, app sẽ hiện nút "Xem đơn" mà CTV không xem được).
  - Được duyệt: cron `approveDueCommissions` ghi `approvedAt` cố định, rồi `notifyCommissionsApproved` gộp theo CTV theo đúng mốc đó (một tin "N khoản, tổng X"; không cộng khoản đã duyệt từ trước).
  - Đã rút: `markPayoutPaid` báo số tiền thực nhận (`Payout.amount`) kèm mã giao dịch nếu có.
  - Lỗi gửi thông báo chỉ log, không làm hỏng đơn/cron/ghi nhận chi.
- File ngoài nhóm: `checkout/checkout.service.ts` (+8 dòng, khối try/catch sau commit) và `checkout.service.spec.ts` (+3 case). Lý do: chỉ chỗ này biết "đơn vừa tạo có hoa hồng"; đặt cuối hàm để ít đụng PC-3.
- Test: `affiliate/affiliate-notifications.spec.ts` (16, jest), 3 case trong `checkout.service.spec.ts`, và `test/integration-race/ctv-notifications.race-spec.ts` (4, Postgres thật, NotificationsService thật): gộp theo CTV, không cộng khoản duyệt cũ, chạy lại cron không báo lặp, nội dung hiển thị đúng, payload không có mã đơn, đơn tự lên hộ không báo, chi xong báo đúng số tiền. Đột biến (bỏ lọc `approvedAt`, bỏ hook ở checkout) làm case tương ứng đỏ.

### C-117 — Đăng ký CTV có bước đồng ý điều khoản: XONG

- Miniapp (`pages/affiliate.tsx`, `i18n/vi.ts` khối `ctvTerms`): khối "Điều khoản hoa hồng & thuế" 4 ý ngắn + checkbox đồng ý; nút đăng ký khoá tới khi tick (có dòng nhắc); gọi `registerAffiliate(vi.ctvTerms.version)`. Đổi nội dung điều khoản phải tăng `ctvTerms.version`.
- API: `POST /affiliate/register` nhận `termsVersion` tuỳ chọn (`dto/register-affiliate.dto.ts`, tối đa 32 ký tự); lưu `{version, acceptedAt}` vào `User.metadata.affiliateTerms` (gộp, giữ khoá cũ; cùng phiên bản đã đồng ý thì không ghi đè thời điểm). Không migration. Client cũ không gửi `termsVersion` vẫn đăng ký được nên backend deploy trước miniapp.
- Test: `affiliate/affiliate-terms.spec.ts` (9, jest) và case điều khoản trong `pages/affiliate.spec.tsx`.

### C-064 — CTV lên đơn hộ giảm chạm: XONG

- `components/affiliate/recent-customers.ts` (mới): "khách gần đây" lưu localStorage theo tài khoản CTV (`tubu_ctv_recent_customers:<userId>`), tối đa 8, trùng SĐT (chuẩn hoá +84/0) thì cập nhật và đưa lên đầu, chỉ ghi khi đơn tạo thành công, mọi truy cập bọc try/catch.
- `ctv-order-sheet.tsx`: hàng chip "Khách gần đây" (tên + 3 số cuối SĐT) và chip "Khách mới"; chạm một lần điền sẵn tên, SĐT, tỉnh, phường, địa chỉ. Nút chuyển sang Button DS v2; các nút tăng/giảm/xoá, dòng chọn sản phẩm/phân loại, nút Đóng đạt vùng chạm 44px.
- `pages/affiliate.tsx`: nút "Lên đơn hộ khách" đưa lên ngay dưới thẻ hoa hồng; toàn bộ Button của trang chuyển sang DS v2 (hết lỗi `no-restricted-imports`).
- Test: `recent-customers.spec.ts` (9), `ctv-order-sheet.spec.tsx` (8), 2 case lối tắt trong `affiliate.spec.tsx`.

### Lệnh kiểm chứng (output thật, chạy lại ở HEAD trước khi commit báo cáo)

```
cd apps/api && npx jest --maxWorkers=1 src/modules/affiliate src/modules/checkout
  Test Suites: 7 passed, 7 total / Tests: 220 passed, 220 total
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5565/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/ctv-notifications.race-spec.ts
  Tests: 4 passed, 4 total
cd apps/miniapp && npx vitest run src/pages src/components src/i18n src/services src/utils
  Test Files 92 passed (92) / Tests 728 passed (728)
npx tsc --noEmit (apps/api và apps/miniapp): 0 lỗi
```

ESLint các file đã sửa: không thêm lỗi mới. `affiliate.tsx` còn lỗi `tubu-ds/no-raw-color` có từ trước (rgba trắng trên nền gradient); `dealer.tsx` còn lỗi có từ trước (1 import Button zmp-ui, các rgba trắng).

### Migration

Không có (không đổi schema). Khi deploy PROD cần chạy seed để có 3 mẫu thông báo; thiếu mẫu thì `NotificationsService.notify` gửi câu trung tính mặc định, CTV không thấy số tiền.

### Giả định (lượt 2/2)

- "Khách gần đây" chỉ lưu trên máy CTV (không thêm API ngoài nhóm file), không đồng bộ giữa thiết bị; tách theo tài khoản, tối đa 8 khách; chưa có nút xoá từng khách.
- Nội dung điều khoản CTV do lượt này soạn ngắn, KHÔNG phải văn bản pháp lý; mục thuế nói "có thể khấu trừ" trong khi code chưa có quy trình khấu trừ. Cần chủ dự án/pháp chế duyệt trước khi bật cho CTV thật.
- Bằng chứng đồng ý chỉ có từ khi miniapp bản mới gọi API; gọi thẳng API không kèm `termsVersion` vẫn đăng ký được (chọn tương thích client cũ thay vì bắt buộc phía máy chủ).
- `User.metadata` ghi theo kiểu đọc-gộp-ghi như các chỗ khác trong repo (segments, dealerTierId): có cửa sổ race rất nhỏ nếu admin sửa metadata của cùng người đó cùng lúc.
- "Được duyệt" = hoa hồng chuyển APPROVED (có thể rút), không phải tự vào Ví, nên thông điệp nói "có thể rút ngay".
- Thông báo CTV chỉ kênh INAPP (ZNS cần Zalo duyệt mẫu).
- Đặt trước của đại lý không chặn theo tồn (trần UI 9999); giá chốt lúc đặt theo API hiện có.

### Việc còn lại

- Lối tắt "Lên đơn hộ" trong tab Cá nhân: `pages/profile.tsx` ngoài nhóm file của gói.
- Màn Thông báo chưa có CTA mở `/affiliate` cho nhóm `COMMISSION*` (`pages/notifications.tsx`, ngoài nhóm).
- Lệnh rút bị từ chối (`rejectPayout`) chưa báo CTV kèm lý do (ngoài phạm vi C-029, nên làm cùng đợt).
- Lỗi rgba trắng ở `affiliate.tsx`/`dealer.tsx` cần token "chữ trắng mờ trên nền tối" từ DS (PC-1); `dealer.tsx` còn Button zmp-ui.
- Việc cần người: duyệt nội dung điều khoản (`vi.ctvTerms`), chạy seed khi deploy, deploy API trước miniapp.
