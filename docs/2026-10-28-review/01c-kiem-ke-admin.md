# Kiểm kê trang quản trị (Phần A)

Commit: 77bf4676 (nhánh main, chỉ đọc)

Ghi chú: `/admin` là một trang client (`apps/web/src/app/admin/page.tsx`, 3782 dòng) hiển thị 42 tab bằng `?tab=<k>`. Chỉ có 2 `page.tsx` trong `apps/web/src/app/admin/**`: `/admin` và `/admin/pos`. Không có route group admin. Cột "Vai trò" lấy guard class-level của controller API; route riêng có `@Roles` khác hoặc `@AllowStaff` chưa tra từng route, ghi "chưa rõ".

## Trang (page.tsx)

| URL | File nguồn | Chức năng | API gọi | Vai trò cần | Có trong menu? |
|---|---|---|---|---|---|
| /admin | apps/web/src/app/admin/page.tsx:1 | Trang quản trị gồm 42 tab, tab mở theo ?tab= | nhiều (xem bảng tab) | ADMIN; STAFF theo quyền nhóm (chưa rõ cổng trang) | — |
| /admin/pos | apps/web/src/app/admin/pos/page.tsx:1 | Màn thu ngân tích Điểm Xanh tại quầy | /loyalty/staff/scan-member, /loyalty/staff/pos-credit (qua PosScreen) | STAFF, ADMIN (trang kiểm role ở client; loyalty.controller.ts:82,93) | Không (link từ tab posCredits) |

## Tab trong /admin (?tab=k)

| Tab k | Component | Chức năng | API gọi | Vai trò cần | Trong menu (page.tsx) |
|---|---|---|---|---|---|
| inbox | OpsInboxTab (components/admin/ops-inbox-tab.tsx) | Việc cần xử lý hôm nay | /admin/ops/inbox | ADMIN (admin.controller.ts:411) | 219 |
| dashboard | DashboardTab (page.tsx) | Tổng quan chỉ số | /admin/dashboard/stats | ADMIN | 220 |
| analytics | AnalyticsTab (app/admin/analytics-tab.tsx) | Giữ chân khách & chỉ số chính | /admin/analytics/retention-daily | ADMIN | 221 |
| reports | ReportsTab (components/admin/reports-tab.tsx) | Báo cáo theo mục | /admin/reports/* (lib/admin-reports) | ADMIN (admin-reports.controller.ts:46) | 222 |
| orders | inline (page.tsx:569) | Danh sách và chi tiết đơn hàng | /admin/orders, /admin/orders/:id/status-history, /admin/orders/:id/confirm-payment | ADMIN; STAFF qua quyền KHO/CSKH/KE_TOAN chưa rõ | 228 |
| externalOrders | ExternalOrdersTab | Đơn ngoài app (Pancake) | /admin/external-orders | ADMIN (external-orders-admin.controller.ts:26) | 229 |
| externalClaims | ExternalClaimsTab | Duyệt/huỷ/đảo tích điểm đơn sàn | /admin/external-claims, /admin/external-claims/attempts, /:id/approve, /:id/void, /:id/reverse | ADMIN (external-claims-admin.controller.ts:50); STAFF chỉ khi có quyền CSKH (page.tsx:564) | 230 |
| merchantFulfilment | MerchantFulfilmentTab | Đơn đối tác và đối soát | /admin/merchant-fulfilment/links/:id/confirm-consignment, /admin/storefronts/:id/partner | ADMIN; chưa rõ STAFF | 231 |
| returns | inline (page.tsx:583) | Duyệt đổi/trả | /admin/return-requests, /:id/review, /:id/received | chưa rõ | 237 |
| customerRefunds | CustomerRefundsTab | Hoàn tiền khách | /admin/customer-refunds, /:id/claim, /verify, /mark-paid, /dismiss | ADMIN; STAFF KE_TOAN theo staff-permissions.ts:21 | 238 |
| cashback | CashbackTab | Hoàn tiền sàn ngoài | /admin/cashback/transactions, /:id/review | ADMIN (cashback-admin.controller.ts:22) | 239 |
| dealers | DealersTab (page.tsx) | Duyệt hồ sơ đại lý | /admin/dealer-applications, /:id/review | ADMIN | 245 |
| dealerClaims | DealerClaimsTab | Thưởng đại lý | /admin/dealer-reward-claims, /approve, /reject, /mark-paid, /reopen | ADMIN (dealer-admin.controller.ts:28) | 246 |
| dealerAccounts | DealerAccountsTab | Đại lý và công nợ | /admin/dealers/accounts, /admin/dealers/:id/credit-ledger, /credit-payment | ADMIN (dealer-accounts-admin.controller.ts:43) | 247 |
| dealerPrices | DealerPriceHistoryTab | Lịch sử giá đại lý | /admin/dealer-prices/history | ADMIN | 248 |
| commissionRates | CommissionRatesTab | Hoa hồng và giá sỉ | /admin/commission-rates, /products/:id, /variations/:id, /import/preview, /import/apply | ADMIN (commission-admin.controller.ts:39) | 249 |
| productCategories | ProductCategoriesTab | Danh mục sản phẩm | /admin/product-categories/products, /assign, /admin/pancake/categories | ADMIN (product-category-admin.controller.ts:30) | 250 |
| payouts | PayoutAdminTab | Yêu cầu rút tiền | /admin/payouts, /pit-report, /:id/approve, /reject, /mark-paid | ADMIN (payout-admin.controller.ts:45) | 251 |
| merchantProducts | MerchantProductsTab | Duyệt SP đối tác | /admin/merchant-products/pending, /:id/review, /linked, /:id/unlink | chưa rõ | 252 |
| storefronts | StorefrontsTab | Gian hàng | /admin/storefronts/* (storefront-admin.controller.ts:29) | ADMIN | 253 |
| brands | BrandsTab (page.tsx) | Nhãn hàng | /admin/brands, /:id, /verify, /products, /link-by-name, /:id/promotions | ADMIN (brand-admin.controller.ts:15) | 254 |
| users | UsersTab (page.tsx) + AccountDeletionPanel | Người dùng, khoá, đổi role, xuất CSV | /admin/users, /:id/block, /:id/unblock, /users/role, /users/export, /admin/account-deletion-requests | ADMIN (admin-users.controller.ts:20) | 260 |
| reviews | ReviewsTab | Đánh giá | /admin/reviews; /reviews/:id/visibility | chưa rõ | 261 |
| community | CommunityModerationTab | Kiểm duyệt cộng đồng | /feed/* (community-moderation-client) | ADMIN (community-feed.controller.ts:106+); STAFF CSKH/MARKETING (staff-permissions.ts:24) | 262 |
| supportChat | SupportChatTab | Chat CSKH (cầu nối Zalo) | /admin/support-chat/* | ADMIN (support-chat-admin.controller.ts:9) | 263 |
| subscriptions | SubscriptionsTab | Gói định kỳ | /admin/subscriptions | chưa rõ | 264 |
| posCredits | PosCreditsTab | Sổ tích điểm tại quầy | /admin/loyalty/pos-credits | ADMIN (admin.controller.ts:411, chưa tra route) | 265 |
| waste | WasteTab | Đổi rác lấy quà | /admin/waste/* | ADMIN; STAFF cho một số route (waste-admin-requests.controller.ts:97-179) | 266 |
| coupons | CouponsTab (page.tsx) | Mã giảm giá và lô mã | /admin/coupons, /admin/coupon-batches | ADMIN (admin-coupon-batch.controller.ts:33; coupons qua admin.controller.ts) | 272 |
| flashSales | FlashSalesTab (page.tsx) | Giờ vàng | /admin/flash-sales | ADMIN (flash-sale-admin.controller.ts:32) | 273 |
| engagement | EngagementTab | Nhiệm vụ | /admin/engagement/missions | ADMIN (admin-engagement.controller.ts:21) | 274 |
| faqs | FaqTab (page.tsx) | Câu hỏi thường gặp | /admin/faqs | ADMIN (faq-admin.controller.ts:7) | 280 |
| contentKit | ContentKitTab (page.tsx) | Bộ nội dung CTV | /admin/content-kits/:productId | ADMIN (content-kit-admin.controller.ts:8) | 281 |
| academy | AcademyTab (page.tsx) | Học viện CTV | /admin/academy/courses, /lessons | ADMIN (academy-admin.controller.ts:8) | 282 |
| quickReplies | QuickReplyTab (page.tsx) | CSKH mẫu tin nhanh | /admin/quick-replies | ADMIN (cskh-admin.controller.ts:7) | 283 |
| notificationTemplates | NotificationTemplatesTab | Mẫu thông báo | /admin/notification-templates | chưa rõ | 284 |
| staffRoster | StaffRosterTab | Nhân sự và quyền | @tubutree/app-core, core-http (chưa tra đường dẫn) | chưa rõ | 290 |
| shiftApproval | ShiftApprovalTab | Duyệt ca | app-core api/shifts (chưa tra đường dẫn) | chưa rõ | 291 |
| payroll | PayrollAdminTab | Lương | app-core api/payroll (chưa tra đường dẫn) | chưa rõ | 292 |
| attendance | AttendanceTab | Chấm công | /admin/attendance/live, /admin/attendance/manual-checkout | chưa rõ | 293 |
| config | ConfigTab (page.tsx) | Cấu hình hệ thống | /admin/config (GET ?category=, PUT) | ADMIN (admin.controller.ts:411) | 299 |
| opsHealth | OpsHealthTab | Sức khoẻ hệ thống | /admin/ops/health, /admin/pancake/sync, /admin/ops/webhook-events/* | ADMIN (admin.controller.ts; pancake.controller.ts:24) | 300 |

## Menu admin (NAV_GROUPS, page.tsx:215-302)

Thứ tự: nhóm rồi mục. Dòng menu là page.tsx:219-300.

1. Tổng quan (216): inbox, dashboard, analytics, reports
2. Đơn hàng & giao vận (226): orders, externalOrders, externalClaims, merchantFulfilment
3. Hoàn tiền & đổi trả (235): returns, customerRefunds, cashback
4. Người bán (243): dealers, dealerClaims, dealerAccounts, dealerPrices, commissionRates, productCategories, payouts, merchantProducts, storefronts, brands
5. Khách hàng (258): users, reviews, community, supportChat, subscriptions, posCredits, waste
6. Khuyến mãi (270): coupons, flashSales, engagement
7. Nội dung (278): faqs, contentKit, academy, quickReplies, notificationTemplates
8. Nhân sự (288): staffRoster, shiftApproval, payroll, attendance
9. Cấu hình & tích hợp (297): config, opsHealth

Tổng 42 mục menu, khớp 42 giá trị Tab (page.tsx:168-208) và 42 nhánh `active ===` (page.tsx:554-616).

## Kết quả đối chiếu

- Tab không có trong menu: không có.
- Mục menu không có nhánh render: không có.
- Menu hiển thị (AdminNav, components/admin/admin-nav.tsx) không lọc theo role: NAV_GROUPS không điều kiện (page.tsx:215). Chưa xác nhận việc ẩn theo quyền STAFF ở chỗ khác.
