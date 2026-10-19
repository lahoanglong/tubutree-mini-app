# D2-auth-pii — Auth, quyền, PII

## Tóm tắt

Không có P0 về auth, quyền hoặc PII. Các đợt trước đã làm chắc vùng này, mọi thử phá đều không qua.

- JWT strategy đọc role, trạng thái khoá và nhóm staff từ DB ở mỗi request.
- Refresh token xoay vòng, có cửa sổ ân hạn, và thu hồi cả chuỗi khi bị dùng lại.
- Cookie refresh là HttpOnly, SameSite=lax và cần header x-client: web.
- OAuth web kiểm tra cả state và PKCE.
- ensurePhone lấy user từ JWT.
- Mọi webhook so token bằng hàm hằng thời gian và từ chối khi production thiếu secret.
- 47 route @Public không lộ PII.
- Kiểm tra IDOR trên địa chỉ, subscription, đơn hàng, mẫu đại lý, thông báo đều đạt.
- CSV xuất cho kế toán đã che số điện thoại.

Còn bốn phát hiện, theo thứ tự mức độ:

- D2-01 (P1, tiền): MARKETING tạo flash sale giảm tới 90%, không giới hạn theo user, rồi tự mua. Vượt trần B19 cho mã do staff tạo (30% / 100.000đ mỗi đơn, 10 triệu đ mỗi ngày) và luật cấm dùng mã của chính mình.
- D2-02 (P1, sai quyết định B8): CSKH và MARKETING ghim được bài cộng đồng, qua API và qua tab kiểm duyệt web. B8 nói chỉ ADMIN ghim.
- D2-03 (P3): Hộp "Việc cần xử lý" không hiện hoá đơn VAT chờ xuất cho kế toán, dù kế toán được xuất hoá đơn từ B18.
- D2-04 (P3): Kế toán ghép lại được số điện thoại đầy đủ bằng cách tìm đơn theo chuỗi số con, làm hỏng việc che 3 số cuối.

Soát chéo: D2-01 và D2-02 đều CONFIRMED. D2-03 và D2-04 chưa soát. Soát chéo phát hiện thêm 1 mục bỏ sót (D2-05, P2).

## Phạm vi đã đọc

Đọc đủ: common/guards/*, common/decorators/{public,roles}, common/staff-permissions.ts, common/staff-access.ts, common/throttle/*, modules/auth/* (auth.controller, auth.service: login, ensure-phone, guest merge, refresh, issueTokens; refresh-cookie, session-state, jwt.strategy, zalo.service), config/env.validation.ts, bootstrap.ts (CORS, trust proxy), users.controller/service, admin-users.controller, phần đơn/coupon/export của admin.controller, admin-order-filter.ts, admin-export / admin-finance-export / admin-order-items-export (che số), order-actor-transitions.ts, ops-inbox.service.ts, community-feed.controller.ts (kiểm duyệt, ghim, người thắng) + approvePost, flash-sale-admin.controller + addItem, trần coupon staff trong coupon-input-rules / admin-coupon-batch.service, storefront getPublicBySlug, brand.controller + PromotionDto, game leaderboard, return-images, phần auth của merchant-payout-owner.guard và merchant updateMerchantOrderStatus, payouts markPayoutPaid, external-claims approve (forbidSelf), waste-access.service + waste-desk lookup, webhook Pancake/ZaloPay/AccessTrade, web lib/og-image-fetch.ts (SSRF), web lib/auth-context.tsx (OAuth state/PKCE), web community-moderation-tab + cong-dong/[id] (nút ghim).

Đã dump metadata của 535 route từ AppModule thật bằng tsx (Public/Roles/AllowStaff/guards) vào scratchpad `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/scratchpad/routes.txt`. Không route nào có AllowStaff mà thiếu Roles. Không route nào dưới /admin khách vào được.

Đã chạy file test community-feed.controller.permissions.spec.ts (23/23 đạt, xác nhận ghim mở cho CSKH/MARKETING). Đã chạy SELECT trên DB UAT: system_configs cho coupon.staff_*, flashsale.*, storefront.require_approval.

Chưa đọc hoặc chỉ lướt: phần lớn merchant-fulfilment.service, phần còn lại của brand.service, content-kit, academy, data-retention (chỉ phần anonymize của account-deletion), service gộp analytics, toàn bộ cskh service, mọi màn Mini App, page.tsx của web admin (3358 dòng, chỉ grep), staff payroll/attendance, thân webhook Zalo OA, phần còn lại của waste-exchange (để cho nhánh recycling).

Chưa xác minh: Zalo ID từ Graph /me có theo app hay không (ảnh hưởng việc dùng access token của app khác); cấu hình PROD thật của AUTH_COOKIE_SAMESITE/DOMAIN và nginx X-Forwarded-For.

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D2-01 | P1 | CONFIRMED | cần chủ quyết | uat | apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:21-26, :28-30; apps/api/src/modules/flash-sale/flash-sale.service.ts:374-403, :37-38; apps/api/src/common/staff-permissions.matrix.spec.ts:127-130 | MARKETING vượt trần mã của staff qua flash sale: giảm tới 90%, số lượng không giới hạn, tự mua được. STAFF chỉ có MARKETING: POST /api/admin/flash-sales {title, startAt=now, endAt=+1h}, rồi POST /api/admin/flash-sales/:id/items {variationId của SP 500.000đ, flashPrice: 50000, quota: 200, perUserLimit: 200}. API nhận, vì sàn là 10% giá (flashsale.max_discount_pct=0.9 ở DB UAT), quota chỉ cần <= tồn kho, perUserLimit có @Min(1) mà không có @Max. Staff tự thanh toán: 200 × 450.000đ = 90 triệu đ giảm trong một đơn. Mã coupon cùng mức giảm bị assertStaffCouponCaps chặn (30% / 100.000đ / 10 triệu đ mỗi ngày / 1.000 lượt) và bị luật cấm dùng mã của mình chặn. Flash sale không có kiểm tra tương đương: createSale lưu createdBy nhưng checkout không đọc. | Cần chủ quyết B19 có áp cho flash sale không. Gợi ý: khi actor.role !== 'ADMIN', áp trần staff cho addItem (giảm mỗi đơn vị <= coupon.staff_max_percent, (giá gốc-flashPrice)*perUserLimit <= coupon.staff_max_amount_vnd, trần cho perUserLimit, tổng (giá gốc-flashPrice)*quota tính vào ngân sách 10 triệu/ngày); ở checkout từ chối giá flash của sale có createdBy là người mua. Test cần viết: (1) MARKETING thêm item giảm 50% bị 400; (2) STAFF thanh toán item flash từ sale của mình bị 403; (3) ADMIN vẫn thêm được ở 90%. |
| D2-02 | P1 | CONFIRMED | agent sửa ngay | chung | apps/api/src/modules/feed/community-feed.controller.ts:317-322; apps/api/src/common/staff-permissions.matrix.spec.ts:273; apps/api/src/modules/feed/community-feed.controller.permissions.spec.ts:33; apps/web/src/components/admin/community-moderation-tab.tsx:260-289 | CSKH và MARKETING ghim được bài cộng đồng, trái luật B8 (chỉ ADMIN ghim). STAFF CSKH (hoặc MARKETING) mở Admin web → Cộng đồng → Đã đăng, bấm "Ghim", hoặc gọi POST /api/feed/admin/<postId>/pin {pinned:true}. RolesGuard cho qua, feed_posts.isPinned=true, bài nằm đầu feed của mọi người. | Bỏ @AllowStaff ở pin (giữ @Roles('ADMIN')). Đổi matrix thành `'POST /feed/admin/:id/pin': ADMIN_ONLY`, chuyển 'pin' từ MODERATION sang ADMIN_ONLY trong spec quyền, ẩn nút Ghim/Bỏ ghim trong community-moderation-tab.tsx khi người xem không phải ADMIN (file thuộc vùng phiên web, hỏi họ trước). Test fail cần viết trước: canRun('pin', cskh) === false. |
| D2-05 | P2 | bỏ sót do soát chéo | cần chủ quyết | uat | apps/api/src/modules/flash-sale/flash-sale.service.ts:301-321, :407-415, :342-353, :374; apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:44-61 | Không có kiểm tra chủ sở hữu nào. Xem mục "Bỏ sót do soát chéo phát hiện". | Xem mục "Bỏ sót do soát chéo phát hiện". Có thể gộp với D2-01. |
| D2-03 | P3 | chưa soát | agent sửa ngay | uat | apps/api/src/modules/ops/ops-inbox.service.ts:111-112; apps/api/src/modules/admin/admin.controller.ts:518-522; apps/api/src/modules/ops/ops-inbox.service.spec.ts:175-182 | Hộp "Việc cần xử lý" không hiện hoá đơn VAT chờ cho kế toán, dù B18 cho kế toán xuất. KE_TOAN mở GET /api/admin/ops/inbox. Có 5 đơn đòi hoá đơn VAT, phản hồi không có khoá invoicePending nên kế toán không thấy việc, dù bấm được "Đã xuất hoá đơn" (POST /admin/orders/:id/issue-invoice là @AllowStaff('KE_TOAN')). Comment ở dòng đó vẫn ghi "xuất hoá đơn (issue-invoice) chỉ ADMIN", đã cũ từ B18. Tương tự, payout ADMIN đã duyệt đang chờ kế toán bấm "Đã chi" không có khoá inbox cho KE_TOAN; khoá 'payouts' chỉ đếm REQUESTED cho ADMIN. | Đặt audience của invoicePending là ['KE_TOAN'], sửa comment, thêm khoá cho payout APPROVED với audience ['KE_TOAN']. Test: trong ops-inbox.service.spec thêm ca viewer KE_TOAN thấy invoicePending; giữ ca CSKH không thấy. |
| D2-04 | P3 | chưa soát | cần chủ quyết | uat | apps/api/src/modules/admin/admin-order-filter.ts:249-274; apps/api/src/modules/admin/admin.controller.ts:477-489; apps/api/src/modules/admin/order-actor-transitions.ts:27-31 | Kế toán ghép lại số điện thoại đầy đủ từ danh sách đã che bằng cách tìm theo chuỗi số con. KE_TOAN thấy đơn TB-XXXX với phone *******567 (maskOrderPhones). Họ gọi GET /api/admin/orders?search=090, ?search=0901, ?search=09012…, thêm một số mỗi lần, xem TB-XXXX còn trong kết quả không. Khoảng 70 request ra đủ 10 số. Throttle mặc định cho 300 request mỗi phút mỗi route. Việc này vô hiệu việc che số mà launch review thêm vào. | Với viewer có seesFullOrderPhones = false, chỉ cho khớp chính xác số đầy đủ (10 số sau searchPhone), không tìm chuỗi con. Giữ ca dùng thật (khách đọc số, kế toán tra) và chặn dò từng số. Test: viewer KE_TOAN tìm '0901' không ra đơn có user.phone=0901234567, tìm '0901234567' vẫn ra. |

## Chi tiết P0/P1

### D2-01 (P1, CONFIRMED) — MARKETING vượt trần mã staff qua flash sale

Nhóm: cần chủ quyết. Vùng: uat.

Vị trí:
- apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:21-26
- apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:28-30
- apps/api/src/modules/flash-sale/flash-sale.service.ts:374-403
- apps/api/src/modules/flash-sale/flash-sale.service.ts:37-38
- apps/api/src/common/staff-permissions.matrix.spec.ts:127-130

Kịch bản: STAFF chỉ có MARKETING gọi POST /api/admin/flash-sales {title, startAt=now, endAt=+1h}, rồi POST /api/admin/flash-sales/:id/items {variationId của SP 500.000đ, flashPrice: 50000, quota: 200, perUserLimit: 200}. API nhận vì sàn là 10% giá (flashsale.max_discount_pct=0.9 ở DB UAT), quota chỉ cần <= tồn kho, perUserLimit có @Min(1) mà không có @Max. Staff thanh toán trên tài khoản mình: 200 × 450.000đ = 90 triệu đ giảm trong một đơn. Mã coupon cùng mức giảm bị assertStaffCouponCaps chặn (30% / 100.000đ / 10 triệu đ mỗi ngày / 1.000 lượt, giá trị từ system_configs ở UAT) và bị luật cấm dùng mã của mình chặn. Flash sale không có kiểm tra tương đương: createSale lưu createdBy nhưng checkout không đọc.

Bằng chứng (người review):
- flash-sale-admin.controller.ts: `@Roles('ADMIN') @AllowStaff('MARKETING')` trên cả class; `class AddItemDto { @IsInt() @Min(1) flashPrice; @IsInt() @Min(1) quota; @IsOptional() @IsInt() @Min(1) perUserLimit }`.
- flash-sale.service.ts:385-392 chỉ chặn flashPrice < ceil(giá gốc*(1-0.9)); :393 chỉ kiểm quota <= tồn kho.
- grep createdBy/actor trong flash-sale.service.ts và checkout/*.ts: chỉ flash-sale.service.ts:293 ghi createdBy, không nơi nào đọc.
- DB UAT: flashsale.max_discount_pct=0.9, coupon.staff_max_percent=30, coupon.staff_max_amount_vnd=100000, coupon.staff_daily_budget_vnd=10000000.
- docs/2026-10-18-launch-review/impl/roles.md:10 mở admin/flash-sales cho MARKETING nhưng không đặt trần cho flash sale.

Lý do soát chéo (CONFIRMED, giữ P1): Tái hiện từ mã, không thấy kiểm tra ở tầng nào khác.
- flash-sale-admin.controller.ts:28-30 đặt @Roles('ADMIN') @AllowStaff('MARKETING') cho cả class; staff-permissions.matrix.spec.ts:126-131 khoá cả 6 route cho MARKETING.
- Trong AddItemDto (flash-sale-admin.controller.ts:21-26), perUserLimit có @Min(1), không có @Max.
- addItem trong flash-sale.service.ts chỉ kiểm ba điều: flashPrice < giá gốc, flashPrice >= ceil(giá gốc*(1-0.9)), quota <= tồn kho. Không kiểm actor hay role.
- SELECT trên DB UAT: flashsale.max_discount_pct=0.9, min_discount_pct=0, coupon.staff_max_percent=30, staff_max_amount_vnd=100000, staff_daily_budget_vnd=10000000, và 9 variation đang bán có tồn >= 200 (cao nhất 400).
- Giỏ hàng cho số lượng tới 999 (cart.dto.ts:6) nên không chặn 200 đơn vị.
- createdBy chỉ được dùng ở lúc ghi, flash-sale.service.ts:293 (createSale). Không có gì trong flash-sale, checkout hay cart đọc nó.
- Coupon thì chặn staff dùng mã của mình (coupon-scope.ts:29, coupons.service.ts:378) và chặn staff sửa mã do ADMIN tạo (admin.service.ts:1485, admin-coupon-batch.service.ts:185).
- B19 (03-cau-hoi-sang.md:53) chỉ nói về "mã". Để flash sale ngoài trần là lỗ hổng của luật, không phải vi phạm luật đã chốt. Giữ P1 và giao chủ quyết.
- Trần chỉ có nghĩa vì MARKETING không được tin như ADMIN.

### D2-02 (P1, CONFIRMED) — CSKH và MARKETING ghim bài cộng đồng, trái B8

Nhóm: agent sửa ngay. Vùng: chung (API thuộc phiên UAT, tab web thuộc phiên web).

Vị trí:
- apps/api/src/modules/feed/community-feed.controller.ts:317-322
- apps/api/src/common/staff-permissions.matrix.spec.ts:273
- apps/api/src/modules/feed/community-feed.controller.permissions.spec.ts:33
- apps/web/src/components/admin/community-moderation-tab.tsx:260-289

Kịch bản: STAFF CSKH (hoặc MARKETING) mở Admin web → Cộng đồng → Đã đăng, bấm "Ghim", hoặc gọi POST /api/feed/admin/<postId>/pin {pinned:true}. RolesGuard cho qua, feed_posts.isPinned=true, bài nằm đầu feed của mọi người. B8 (03-cau-hoi-sang.md:42 và :105) ghi: "CSKH duyệt bài… Chỉ ADMIN ghim bài và chọn người thắng". Chọn người thắng đúng là chỉ ADMIN; ghim thì không.

Bằng chứng (người review):
- community-feed.controller.ts:317-322: `@Roles('ADMIN') @AllowStaff(...COMMUNITY_MODERATORS) @Post('admin/:id/pin')`, với COMMUNITY_MODERATORS=['CSKH','MARKETING'] (staff-permissions.ts).
- Matrix spec khoá điều này: `'POST /feed/admin/:id/pin': [CSKH, MARKETING]`.
- `npx jest src/modules/feed/community-feed.controller.permissions.spec.ts` → 23/23 đạt, gồm ca 'pin: ADMIN và STAFF nhóm CSKH hoặc MARKETING được'.
- Nút ghim ở giao diện khách chỉ ADMIN (web cong-dong/[id]/page.tsx:248 `isAdmin &&`), nhưng tab kiểm duyệt hiện nút cho mọi moderator.

Lý do soát chéo (CONFIRMED, giữ P1):
- B8 nằm trong danh sách đã chốt (03-cau-hoi-sang.md:42): "Chỉ ADMIN ghim bài và chọn người thắng".
- community-feed.controller.ts:318-323 có @Roles('ADMIN') @AllowStaff(...COMMUNITY_MODERATORS) trên POST admin/:id/pin, COMMUNITY_MODERATORS=['CSKH','MARKETING'] (staff-permissions.ts:17).
- pinPost (community-feed.service.ts:1335) chạy feedPost.update thuần, không kiểm role.
- Matrix spec ở :273 và danh sách MODERATION ở community-feed.controller.permissions.spec.ts:33 ghi luật sai thành đúng.
- Lịch sử git: community.md:8 mở ghim cho CSKH, roles.md:174 sau đó thêm MARKETING.
- Tab community-moderation-tab.tsx (nút Ghim/Bỏ ghim quanh dòng 288) không kiểm ADMIN.
- Không tài liệu nào sau đó đảo B8.
- Phá luật đã chốt nhưng thiệt hại nhỏ: chỉ đổi thứ tự bài, không liên quan tiền hay điểm, và CSKH vốn đã duyệt/ẩn được bài. P1 hợp, không cần P0.
- Sửa API thuộc phiên UAT. Tab web thuộc phiên web.

## Bỏ sót do soát chéo phát hiện

### D2-05 (P2) — Flash sale không kiểm chủ sở hữu khi sửa, xoá, thêm item

Nhóm: cần chủ quyết. Có thể gộp với D2-01.

Vị trí:
- apps/api/src/modules/flash-sale/flash-sale.service.ts:301-321 (updateSale)
- apps/api/src/modules/flash-sale/flash-sale.service.ts:407-415 (removeItem)
- apps/api/src/modules/flash-sale/flash-sale.service.ts:342-353 (deleteSale)
- apps/api/src/modules/flash-sale/flash-sale.service.ts:374 (addItem)
- apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:44-61

Kịch bản: ADMIN tạo sale S và sale đang chạy. STAFF chỉ có MARKETING gọi PATCH /api/admin/flash-sales/S {isActive:false}, tắt chiến dịch của ADMIN giữa chừng, hoặc {endAt:+31 ngày} để kéo dài tới giới hạn. Cũng gọi được POST /api/admin/flash-sales/S/items để thêm item giảm 90% vào sale của ADMIN, nên sale trông như việc của ADMIN. Coupon thì chặn điều này: staff không sửa hay bật lại mã do ADMIN tạo (admin.service.ts:1485 assertStaffCreatedCoupons; admin-coupon-batch.service.ts:185). Flash sale thì không.

Bằng chứng: FlashSaleItem không có trường ghi ai thêm item (grep prisma/schema.prisma tìm created/by trong model FlashSaleItem: không có kết quả); module flash-sale không có audit log. Nên sau sự việc không ai biết ai đặt giá 90%.

Mức: P2, chủ quyết.

## Đã bác bỏ

Không có phát hiện nào bị REFUTED.
