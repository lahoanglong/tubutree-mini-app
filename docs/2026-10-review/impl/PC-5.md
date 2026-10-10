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
