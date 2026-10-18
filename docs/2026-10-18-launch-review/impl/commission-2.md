# Hoa hồng CTV: mức mặc định toàn cục (lr2/commission)

## Dấu vết tính hoa hồng
- `AffiliateService.createCommissionForOrder(orderId, tx)` (affiliate.service.ts) chạy trong tx tạo đơn. Bỏ qua khi không có người giới thiệu, hoặc tự giới thiệu mà không phải đơn hộ. Người giới thiệu phải thuộc `affiliate.commission_eligible_roles` (mặc định AFFILIATE + DEALER) xét lúc đặt đơn.
- Mỗi dòng: `floor(paidLineTotals × rate / 100)` (tiền khách thực trả, đã trừ giảm giá/flash sale/combo; ship không tính). Tổng = `Commission.amount`; `lineAmounts` {orderItemId: số} chỉ cho dòng rate > 0; `commissionableTotal` = tổng nền dòng có hoa hồng.
- Rate một dòng trước đây: chặn (`product.affiliateBlocked`) hoặc hàng ký gửi của chính người giới thiệu → 0; ngược lại `variation.affiliateRate` hoặc 0 khi NULL.
- Đại lý: không có % theo bậc. Bậc đại lý (dealerPrices) chỉ là giá sỉ; hoa hồng đại lý dùng cùng `affiliateRate` như CTV. Nên không có gì để mặc định "đè" lên.
- Hoàn/huỷ: `reverseCommissionsForOrder` đổi PENDING/LOCKED → REJECTED. Trả một phần (`order-reversal.reversePartialReturn`) cắt theo `lineAmounts` đã lưu; chỉ hoa hồng cũ thiếu `lineAmounts` mới tính lại theo `affiliateRate` hiện tại (đường legacy, không đổi).

## Quy tắc mới (commission-rate.ts `resolveVariationRate`)
Thứ tự: bị chặn hoặc ký gửi của chính người giới thiệu → 0; `affiliateRate` đã đặt (kể cả 0) → dùng nó (A1 8% là mặc định, không ép); NULL + sản phẩm gian hàng đối tác (`product.storefrontId` khác null) → 0 (A3); NULL còn lại → `affiliate.default_rate_pct`.
- Khoá `affiliate.default_rate_pct`: mặc định 8, số nguyên 0–50 (RANGES `integer: true`, giống `RATE_MAX_DECIMALS = 0`). Giá trị hỏng đọc ra 8 (`sanitizeDefaultRate`). Đã vào reference-data, APPROVED_LOADED_KEYS, extraKeys race seed.
- Chốt lúc đặt đơn: rate đã giải được ghi vào `Commission.rate/amount/lineAmounts`; đổi mặc định sau đó không đụng đơn cũ (race test `commission-create` đổi mặc định 8 → 20 sau khi tạo, hoa hồng giữ 16.000).
- B15: đúng sẵn, không đổi code. Vai trò chỉ xét lúc tạo hoa hồng; không cron/rút tiền nào xét lại vai trò; `affiliateAccess` giữ quyền xem/rút cho đại lý còn hoa hồng. CTV bị hạ về CUSTOMER (không phải đại lý) thì `hasAccess` false nên tầng web ẩn công cụ CTV; endpoint `/affiliate/payouts` không chặn theo vai trò (chưa kiểm UI).

## Admin
Màn "Hoa hồng & giá sỉ": hiện "Mức mặc định khi để trống: X%", đổi câu "CTV nhận 0đ" thành mô tả mặc định; API `GET commission-rates` trả thêm `defaultRate`. Đổi mức ở tab Cấu hình (khoá trên). Không thêm ô sửa riêng.

## Test
- Unit: `commission-rate.spec.ts` (null/0/12/chặn/đối tác/ký gửi/sanitize), `affiliate.service.spec.ts` (mặc định, đối tác, DEALER, cấu hình hỏng).
- Race (Postgres thật): `commission-create` (mặc định + chốt), `commission-rates-admin` (sửa theo luật mới), `partial-return-commission-tier` (dòng "không hoa hồng" nay đặt rate 0 tường minh).

## Sửa sau review
1. Race spec dùng `affiliateRate: null` với nghĩa "không hoa hồng" sửa sang 0 tường minh: q1-money-refunds (dòng phấn), partial-return-commission-tier. Quét toàn bộ 97 race spec có commission/referrer: chỉ q1-money-refunds còn đỏ.
2. Huy hiệu storefront picker và banner nhãn dùng `maxResolvedRate` (cùng `resolveVariationRate`, hàng đối tác NULL = 0). `getShareToEarn` xét `affiliate.commission_eligible_roles` (đại lý thấy banner); `BrandService` nhận thêm `SystemConfigService`.
3. Duyệt "Tubu giao hộ" và gỡ liên kết đặt `affiliateRate: null` cùng `variation.updateMany` (merchant-pancake-link.ts); race (l) ở merchant-pancake-link.
4. Xoá % riêng: `PUT commission-rates/variations|products/:id` nhận `{rate: null}`; CSV ô "mặc định"/"mac dinh"/"macdinh"/"default" (preview OK/UNCHANGED, áp ghi NULL); web nút "Về mặc định" và gợi ý CSV. Race: commission-rates-admin.
5. `loadDefaultRate` = min(mặc định, trần `affiliate.max_rate_pct`) dùng khi tính hoa hồng, admin list, huy hiệu; `SystemConfigService.set` từ chối mặc định > trần và hạ trần < mặc định.
6. Dòng NULL trên web: "Mặc định X% ≈ Yđ/sp" (hàng Tubu) hoặc "Hàng đối tác chưa đặt %: 0đ"; preview CSV ghi "mặc định".
7. Test snapshot viết lại trong partial-return-commission-tier: a NULL (8.000) + b 10% (10.000), đổi mặc định 8 → 20, trả dòng a → cắt đúng 8.000 theo lineAmounts (đường tính lại cũ cho NULL = 0 sẽ cắt 0, nên test đỏ nếu bỏ lineAmounts); finally khôi phục giá trị cũ. Test yếu ở commission-create bỏ phần đổi mặc định.
Điểm còn lại: ctv-assisted-late-payment đỏ một lần trên DB đã dùng qua nhiều spec, xanh hai lần liên tiếp trên DB sạch (chưa rõ nguyên nhân, nghi flaky thời gian).

## Điểm mở
- Hai đường tính lại legacy (order-reversal.commissionByLine, productCommissionBreakdown) vẫn coi NULL = 0; chỉ ảnh hưởng hoa hồng cũ thiếu `lineAmounts`.
- `prisma/seed.ts` dev (file phiên khác) chưa có khoá; mã dùng mặc định 8.
- "Áp % cho biến thể chưa có %" (fillMissingRates) còn nguyên; giờ chỉ cần khi muốn mức khác mặc định.
