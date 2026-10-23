# D15-admin-web-bao-mat — Admin web, merchant portal, trang SSR công khai

## Tóm tắt

Góc admin web và bảo mật web: không có P0 hay P1. Phần lớn đã được các đợt trước làm chắc, thử phá đều không qua:
- Tab admin ẩn/hiện khớp ma trận @AllowStaff của API cho cả 4 nhóm việc. Nút xuất CSV, khoá người dùng, duyệt rút tiền, chi thưởng đều được chặn đúng theo isAdmin/canFinance.
- CSV xuất ở web (export-csv.ts, payroll-csv.ts) và ở API (admin-export.ts csvCell) đều thêm dấu nháy trước ô bắt đầu bằng = + - @.
- ?returnTo đi qua safeReturnPath, chặn được //, /\ và ký tự điều khiển.
- Chỉ có 2 chỗ dùng dangerouslySetInnerHTML: JSON-LD có thoát dấu <, và script boot dựng từ hằng số. Văn bản pháp lý render bằng React và lọc link qua safeHref.
- Mọi href lấy từ dữ liệu người dùng đều qua bộ lọc http(s). Riêng trackingLink ở trang merchant thì API đã kiểm bằng @IsUrl.
- SSR công khai (/s, /brand, /chinh-sach, /cong-dong) không đọc cookie, không có dữ liệu người đăng nhập. Kho gian hàng chỉ trả khi là gian hàng đối tác.
- Đăng xuất xoá cache React Query, danh sách khách gần đây và hoá đơn đã lưu.

Còn 5 phát hiện, theo thứ tự mức độ:
- D15-01 (P2, đã tái hiện bằng renderToString): chèn CSS qua themeColor của khuyến mãi nhãn hàng. Chủ nhãn hàng tự đặt được giá trị, và nó chèn được khai báo CSS tuỳ ý vào HTML SSR trang /brand/[slug].
- D15-02 (P2): form "Cấp / đổi vai trò theo SĐT" mặc định chọn CUSTOMER và chỉ hỏi xác nhận khi cấp ADMIN. Một cú bấm hạ quyền ngay một STAFF hoặc ĐẠI LÝ, nhân viên mất luôn nhóm việc, đại lý mất cờ đối tác của gian hàng.
- D15-03 (P2): nút "Từ chối" hồ sơ đại lý chạy ngay khi bấm, không hỏi xác nhận, gửi cho người nộp lý do cứng "Không đạt yêu cầu". Từ chối là trạng thái cuối.
- D15-04 (P3): 8 nút xoá trong admin/page.tsx không hỏi xác nhận. Có cả "Xoá khoá học", xoá luôn mọi bài học.
- D15-05 (P3, đã biết là A6-47, vẫn mở): CSP chỉ ở chế độ Report-Only, không có report-uri, script-src còn 'unsafe-inline' 'unsafe-eval'. Web cũng không gửi header HSTS.

Chưa kiểm chứng trên DB: máy không có psql nên chưa đếm được brand_promotions có themeColor sai dạng.

Soát chéo: chưa có kết quả soát (không có verdict nào).

## Phạm vi đã đọc

Đã đọc kỹ:
- apps/web/src/app/admin/page.tsx: gating tab, STAFF_TABS, DealerRow, OrdersTab (phần xuất CSV), UsersTab, GrantRoleForm, các nút xoá ở BrandRow, FlashSaleRow, FAQ, QuickReply, Course, Lesson, DealerRewards.
- Trong components/admin, đọc phần quyền và tiền của: admin-nav, confirm-dialog, order-status-actions (huỷ đơn, nhận tiền muộn), order-payment-summary, payout-admin-tab, dealer-credit-panel, dealer-accounts-tab, dealer-claims-tab, customer-refunds-tab, merchant-fulfilment-tab, external-claims-tab, cashback-tab, community-moderation-tab, reviews-tab (link ảnh, video), return-request-row, merchant-products-tab, waste-gifts-section, loyalty-config-card, pos-screen, reports-tab, claim-campaign-panel.
- lib/export-csv.ts, payroll-csv.ts, middleware.ts, tenant-subdomain.ts, next.config.mjs (headers, CSP), Caddyfile, layout.tsx (script boot), product-seo.ts (JSON-LD), legal-markdown.tsx, return-to.ts.
- auth-context: logout, OAuth URL.
- Các trang /s/[slug], /brand/[slug], /chinh-sach/[loai], cong-dong/page + [id]/layout, community-channels, site-footer.
- merchant/page.tsx (nút trạng thái đơn), merchant/fulfil-orders-tab.tsx (trackingLink).
- Phía API: staff-permissions.matrix.spec.ts, admin-export csvCell, setUserRole, reviewDealerApplication, confirmOrderPayment, reverseFinancials (phần tiền), notification-templates-admin.service (MARKETING), storefront getPublicBySlug, merchant ShipDto, brand.dto PromotionDto, brand.controller owner/me/promotions, academy deleteCourse, flash-sale removeItem.
- Đã tra findings-catalog, launch-review 02/D4/impl, D2-auth-pii.md tối nay. Không báo lại D2-02 (ghim bài). A6-47 chỉ ghi trạng thái.

Chưa đọc hoặc chỉ lướt:
- Thân phần lớn tab con trong components/admin (waste-request-detail, waste-requests-section, ops-health-tab, commission-rates-tab, storefronts-tab, staff-roster, payroll, attendance, shift-approval, subscriptions, engagement), chỉ đếm confirm theo mutation.
- merchant/settlement-tab, merchant-returns, product-form.
- cong-dong/[id]/page.tsx, cong-dong/xep-hang, su-kien.
- Toàn bộ trang khách ngoài /s, /brand, pháp lý, cộng đồng.

Không chạy jest. Có chạy renderToString của react-dom 18.3.1 để chứng minh D15-01. Không truy vấn được DB UAT vì máy không có psql.

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D15-01 | P2 | chưa soát | agent sửa ngay | chung (API: UAT; web: phiên web) | apps/api/src/modules/brand/dto/brand.dto.ts:63; brand.dto.ts:75; apps/api/src/modules/brand/brand.controller.ts:54-61; apps/api/src/modules/brand/brand.service.ts:526-532; apps/web/src/app/brand/[slug]/page.tsx:97 | Chủ nhãn hàng chèn CSS tuỳ ý vào /brand/[slug] qua themeColor của khuyến mãi. POST /api/brand/owner/me/promotions với themeColor 'red;position:fixed;inset:0;z-index:9999;background:url(https://evil.example/fake-stk.png) center/cover' được nhận vì PromotionDto chỉ có @IsString. SSR render style="border-color:red;position:fixed;...". Mọi khách mở thẳng trang thấy ảnh phủ kín trên tên miền chính thức. | API: thêm @Matches(/^#[0-9a-fA-F]{6}$/) cho themeColor ở PromotionDto và UpdatePromotionDto, thêm @MaxLength cho title và subtitle. Web: chỉ đặt borderColor khi khớp hex. Trước deploy: soát brand_promotions. Test: e2e POST themeColor 'red;position:fixed' phải 400; vitest trang brand không chứa 'position:fixed'. |
| D15-02 | P2 | chưa soát | agent sửa ngay | web | apps/web/src/app/admin/page.tsx:1819; page.tsx:1834-1846; page.tsx:1867-1874; apps/api/src/modules/admin/admin.service.ts:551-556; admin.service.ts:560-565 | Form "Cấp / đổi vai trò theo SĐT" mặc định CUSTOMER. ADMIN gõ SĐT nhân viên KE_TOAN hoặc đại lý, bấm "Cấp quyền" khi để nguyên mặc định: không hộp xác nhận (chỉ ADMIN mới hỏi), API đổi role về CUSTOMER, xoá staffPermissions, tắt isPartner của gian hàng đại lý, MERCHANT thành CTV. Đặt lại STAFF không trả lại nhóm việc. | Không đặt vai trò mặc định (bắt chọn). Hỏi xác nhận với mọi lần đổi vai trò, nêu vai trò hiện tại → mới và hậu quả. Tra listUsers theo SĐT trước để hiện vai trò hiện tại. Test page.spec.tsx: gõ SĐT rồi bấm "Cấp quyền" không được gọi setUserRole khi chưa xác nhận. |
| D15-03 | P2 | chưa soát | agent sửa ngay | web | apps/web/src/app/admin/page.tsx:677-681; page.tsx:708; apps/api/src/modules/admin/admin.service.ts:341-347; apps/api/prisma/seed.ts:873 | Nút "Từ chối" hồ sơ đại lý chạy ngay, không xác nhận, lý do cứng "Không đạt yêu cầu". API chuyển REJECTED, không có đường mở lại. Người nộp nhận tin "chưa được duyệt: Không đạt yêu cầu", không biết sửa gì, phải nộp lại cả CCCD. Mini App không có màn duyệt hồ sơ đại lý nên web là nơi duy nhất. | Dùng useConfirm().ask với ô lý do bắt buộc, tone danger, gửi lý do admin nhập. Test page.spec.tsx: bấm "Từ chối" không gọi reviewDealerApp; nhập lý do rồi xác nhận thì gọi đúng lý do. |
| D15-04 | P3 | chưa soát | agent sửa ngay | web | apps/web/src/app/admin/page.tsx:3186; 3307; 2670; 2846; 2503; 2259; 2148; 2135; apps/api/src/modules/academy/academy.service.ts:125-128; apps/api/prisma/schema.prisma:2983 | Nhiều nút xoá chạy ngay, không xác nhận. "Xoá khoá học" gọi prisma.course.delete, Lesson onDelete: Cascade nên mất cả khoá và mọi bài học; user_lesson_progress (không có khoá ngoại) thành rác. Các nút khác: FAQ (2670), mẫu tin nhanh CSKH (2846, đang dùng cho auto-reply OA), bài học (3307), SP trong flash sale đang chạy chưa bán (2503), chương trình thưởng đại lý (2259, claim cũ mất rewardId), KM nhãn hàng (2148), gỡ SP khỏi nhãn (2135). Xoá đợt flash sale (2378) đã có confirm. | Bọc mutation xoá bằng useConfirm().confirm, tone danger, nêu hậu quả (ví dụ "Xoá khoá học X và N bài học? Không hoàn tác được."). Test page.spec: bấm Xoá khoá học, deleteAcademyCourse chưa được gọi khi chưa xác nhận. |
| D15-05 | P3 | chưa soát | cần chủ quyết | web | apps/web/next.config.mjs:43-54; next.config.mjs:84-97; Caddyfile:6-9 | CSP chỉ Report-Only, không có report-uri/report-to, script-src có 'unsafe-inline' 'unsafe-eval'. Web và Caddy không gửi Strict-Transport-Security (API có helmet nên có HSTS). Nếu có lỗ XSS, CSP không chặn; không thu được báo cáo vi phạm; lần đầu vào http://app.<domain> có thể bị hạ cấp xuống HTTP. Đã biết là A6-47 (docs/audit-2026-09/06-web.md:222), còn mở. | Chủ quyết lịch bật CSP chặn thật. Thêm report-uri (endpoint nhỏ ở API, có throttle). Thêm header Strict-Transport-Security: max-age=31536000 ở next.config headers() hoặc ở proxy (Caddy hoặc nginx aaPanel). Test next.config spec kiểm có HSTS và report-uri. |

## Chi tiết P0/P1

Không có phát hiện P0 hoặc P1.

## Bỏ sót do soát chéo phát hiện

Không có.

## Đã bác bỏ

Không có.
