# Lô 7 gửi phiên web: việc web khách theo đợt 6 (quyết định của chủ)

Viết 2026-10-22 bởi phiên UAT (tubutree-mini-app-44). Mã API/Mini App/admin nằm trên nhánh cục bộ `uat/int` (tip 3362c0a0), chưa push.
Số dòng dưới đây đo trên web cũ (05e6ae97), trước PR #24. Main đã đổi nhiều, nên tìm theo chuỗi chữ, đừng tìm theo số dòng.

## Commit theo gói

| Gói | Commit cuối trên uat/int | Web cần làm |
|---|---|---|
| q12-freeship | c624f71b (gộp e2dffaa4) | Ngưỡng miễn phí giao thường 199.000đ. Số lấy từ API, chỉ còn giá trị dự phòng và fixture |
| chu-viet | cc1a5da6 (gộp 3362c0a0) | Q13 Huỷ/Xoá/Khoá, Q14 bỏ "6 vùng đất", Q16 Việt hoá (giữ "CTV"); "CTV Academy" thành "Học viện CTV" |
| q22-chu-ky | d5c1c42f (gộp 831f1b89) | Màn Sửa gói định kỳ: chọn chu kỳ 4/6/8/10 tuần, hiện ngày giao kế mới; API nhận PATCH intervalWeeks, GET /me/subscriptions trả lastOrderAt |
| q18-mua-chung | 6d8a2d58 (gộp 627c6967) | Chỉ API: đơn tối thiểu mã mua chung theo biến thể rẻ nhất đang bán |
| q10-goi-that | 12bd2cde (gộp a1c50dd8) | Chỉ API: bậc giảm định kỳ chỉ đếm gói thật; web hiện bậc từ API thì tự đúng |
| q1-xet-hang | d5e76e32 (gộp 7c5eb963) | Chỉ API: chi tiêu xét hạng chỉ tính đơn tự mua lẻ |
| q19-dao-don | 392bc23c (gộp 6854156a) | Chỉ API + migration |
| q15-fetch | 4cd7706e (gộp 15458842) | Chỉ Mini App |
| q2-tncn | đang làm (W13) | Phiên UAT tự sửa `withdraw-sheet.tsx`, props WithdrawSheet ở `ctv/page.tsx`, `app-core` affiliate-rules/api (f2 đồng ý 2026-10-22) |

## Ghi chú nguyên văn của worker (file:dòng trên web cũ)

### uat/q12-freeship

- Phiên web (KHÔNG sửa), file:line còn giữ 200000 làm ngưỡng freeship trong apps/web/src: (code chạy) apps/web/src/lib/use-public-config.ts:13 (freeshipThreshold: 200_000 dự phòng khi /config/public chưa về) và apps/web/src/lib/legal.ts:41 (DEFAULT_LEGAL_VARS freeshipThreshold: 200000, dùng khi API chính sách lỗi). Số cho khách thật trên web đọc từ API nên tự thành 199.000 khi API mới lên; hai dòng trên chỉ là dự phòng. Fixture/spec cần cập nhật theo: apps/web/src/test-utils/fixtures/admin-config-rows.ts:96-97 (mô tả '< 200k' / '≥ 200k' và value 200000), apps/web/src/lib/pdp-logic.spec.ts:43,47-53, apps/web/src/app/san-pham/[slug]/pdp-extras.spec.tsx:16,69,90 ('Miễn phí vận chuyển cho đơn từ 200.000đ'), apps/web/src/app/chinh-sach/[loai]/page.spec.tsx:7,36, apps/web/src/lib/legal.spec.ts:4,56-66, apps/web/src/components/admin/config-item.spec.tsx:22-23, và các CART mock freeshipThreshold: 200000 ở apps/web/src/components/reorder/*.spec.*:16/22/6, apps/web/src/app/tai-khoan/thong-bao/page.spec.tsx:195, apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.spec.tsx:331 (mock, không bắt buộc đổi). Ngoài freeship: apps/web/src/app/tai-khoan/vi-tubu/page.tsx:246 dùng 200_000 cho referral.min_order_amount (luật khác, không đổi).
- Ngoài vùng sửa nhưng chạm bởi mặc định mới: apps/e2e/tests/support/{buy-flow-mocks.ts:35,47; discovery-mocks.ts:66; mock-api.ts:366,443,454; pilot-mocks.ts:65; checkout-mocks.ts:59} có mock freeshipThreshold: 200000 và packages/app-core/src/api/orders.spec.ts:20. Không sửa vì là mock dữ liệu (không ảnh hưởng logic) và mock-api.ts thuộc nhóm cần hỏi trước. Nếu ảnh chụp/so sánh e2e in chữ '200.000đ' từ mock thì phiên e2e/web tự đổi.
- Chưa đổi (không phải ngưỡng freeship thường): dealer.free_ship threshold (đơn sỉ, luật riêng), freeShipFrom của gian hàng đối tác (cấu hình theo gian hàng), mã FREESHIP minOrder 99.000đ, referral.min_order_amount 200.000đ (Mini App wallet.tsx:268 và web vi-tubu fallback), voucher.second_order_min_order 199.000đ đã là 199.000. Các tài liệu lịch sử (docs/2026-07-05, docs/2026-09, docs/2026-10-review, docs/2026-10-18-launch-review, docs/audit-2026-09, docs/superpowers) ghi 200k như ghi chép quá khứ, không sửa.

### uat/chu-viet

- Q24: đặt câu 'Hạ vai trò chỉ tạm ngừng: người này có thể tự đăng ký CTV lại.' ở hộp xác nhận đổi vai trò (roleChangeConsequences, apps/web/src/app/admin/page.tsx) khi đích là Khách hàng, không thêm ô chữ riêng; phương án khác: thêm dòng gợi ý cố định dưới ô chọn vai trò của GrantRoleForm.
- Phiên WEB khách cần đổi theo Q13 (kiểu cũ còn lại, mỗi mục là file:dòng, chữ hiển thị): src/app/gio-hang/page.tsx:157,305,341,346; src/app/tai-khoan/orders-section.tsx:107; src/app/tai-khoan/don-hang/[code]/order-actions.tsx:124,129,141,144,180,196; src/app/tai-khoan/don-hang/[code]/page.tsx:299; src/app/tai-khoan/dia-chi/page.tsx:113,173,188,226,229; src/app/san-pham/[slug]/product-reviews.tsx:479; src/app/san-pham/[slug]/subscribe-sheet.tsx:33,153; src/app/cong-dong/[id]/post-sheets.tsx:77; src/app/gioi-thieu/about-view.tsx:224,230,232,241,249,255; src/components/evidence-upload.tsx:109; src/app/merchant/product-form.tsx:80; src/components/address-form.tsx:115; src/components/referral-code-box.tsx:169; src/components/affiliate/ctv-copy.ts:48; src/components/orders/subscriptions-panel.tsx:26,79,137,169,232; src/components/orders/orders-tabs.ts:22; src/components/orders/subscription-options.tsx:17; src/components/account/avatar-crop-sheet.tsx:101; src/components/community/image-upload.tsx:66; src/components/account/notification-view.ts:21; src/lib/order-view.ts:11,21; src/lib/auth-context.tsx:207; src/lib/shipping-events.ts:39,40,41; src/lib/recycling.ts:28; src/lib/browse-text.ts:23,26; src/lib/brand-origins.ts:117; src/lib/export-csv.ts:36,88. Giữ nguyên địa danh Thanh Hóa, Khánh Hòa.
- Phiên WEB khách cần đổi theo Q14: src/lib/home-text.ts:23 'Khám phá 6 vùng đất làm nên sản phẩm Tubu' -> 'Khám phá sản phẩm Tubu từ nhiều vùng đất Việt Nam'.
- Phiên WEB khách cần đổi theo Q16: src/app/ctv/page.tsx:168 ('click'), :170 ('Dashboard hoa hồng realtime'), :412 (label 'Click'), :461 và :467 ('Caption gợi ý', 'Đã sao chép caption'), :496 ('click ·'); src/app/brand/[slug]/brand-actions.tsx:185 và src/components/affiliate/storefront-share.tsx:94 ('Caption gợi ý'); src/components/game/season-pass.tsx:10 ('XP'), :39 ('Chặng Mùa (Season Pass)'), :50 và :85 ('Premium'); src/components/game/quiz-card.tsx:30 ('Quiz Sống Xanh hôm nay'); src/components/game/season-leaderboard.tsx:9 ('Top góp nước mùa này'); src/app/hoc-vien/academy-auth.tsx:12 và academy-shell.tsx:8 ('CTV Academy'); src/lib/home-text.ts:37-39 ('Voucher chào mừng', Mini App đã đổi ở D8-11 chưa; vi.ts:89-91 vẫn còn 'Voucher chào mừng' vì ngoài danh sách task). Kéo theo e2e web cần sửa chuỗi: apps/e2e/tests/game.web.spec.ts:171 ('Top góp nước mùa này'), community.web.spec.ts:220 ('CTV Academy'), order.web.spec.ts:76,259,263,265,268,281,284,286,288 và account.web.spec.ts:162,191,194,199,203,204,206,208 (Hủy/Xóa kiểu cũ). Cần hỏi trước vì là spec e2e web.
- Admin dashboard còn hiện 'Đã hủy' kiểu cũ vì nhãn trạng thái lấy từ apps/web/src/lib/order-view.ts:21 (vùng web khách, không sửa): page.spec.tsx tab Tổng quan vẫn kỳ vọng 'Đã hủy' cho đến khi phiên web đổi order-view.ts (khi đó đổi lại một dòng spec, page.spec.tsx dòng 490). Ngoài ra apps/web/src/lib/admin-client.ts:1692 ('Marketing — voucher, flash sale, FAQ, Content Kit, Academy...') là chữ hiện cho admin nhưng nằm ngoài vùng được sửa; cần phiên web đổi.
- lint:parity xanh: không còn lệch giữa web khách và Mini App ở những chuỗi đã đổi (các chuỗi web khách còn kiểu cũ không nằm trong danh sách kiểm của lint:parity).
- P2 đã sửa: admin-analytics.spec.ts (tên tab và chữ trạng thái rỗng) và chú thích admin.spec.ts:12; chạy lại Playwright project Web Admin xanh.
- Danh sách web khách (apps/web/src ngoài admin) cần báo phiên web: lần đầu và lần này đều không sửa file nào ở vùng này. Không thấy thêm mục mới trong đợt sửa này. lint:parity xanh, nên chưa có chỗ nào web khách lệch Mini App vì đợt này.

### uat/q22-chu-ky

- FILE WEB CẦN THEO (vùng phiên web, KHÔNG sửa): apps/web/src/components/orders/subscription-edit-sheet.tsx (thêm chọn chu kỳ + dòng ngày giao kế như Mini App, gửi intervalWeeks); packages/app-core/src/api/subscriptions.ts (cần hỏi trước: thêm lastOrderAt?: string | null vào SubscriptionDTO và intervalWeeks?: number vào kiểu data của updateSubscription); apps/web/src/components/orders/subscriptions-panel.spec.tsx (mock DTO). Trả lời web: API đã nhận PATCH intervalWeeks 4/6/8/10 và list trả lastOrderAt, quy tắc ngày giao kế giống hàm nextRunAfterIntervalChange ở apps/miniapp/src/components/subscription-options.tsx.
- Web khách là vùng phiên web, không sửa. File web cần theo (chưa làm): apps/web/src/** màn Sửa gói định kỳ (tìm trong apps/web/src/app/tai-khoan hoặc component gói định kỳ) cần thêm chọn chu kỳ 4/6/8/10 gửi intervalWeeks, hiện ngày giao kế mới theo luật 0h VN của ngày đơn gần nhất + chu kỳ, và nhận thêm trường lastOrderAt từ GET /me/subscriptions; packages/app-core cần hỏi trước nếu kiểu SubscriptionDTO dùng chung.

### uat/q18-mua-chung

- Sửa ngoài vùng liệt kê: apps/miniapp/src/services/groupbuy-api.ts (thêm field minOrder? vào type GroupBuy), bắt buộc để page đọc được trường mới. Không sửa packages/app-core (cần hỏi trước) và không sửa apps/web (vùng phiên web).
- Báo phiên web (d3), không sửa: apps/web/src/app/mua-chung/group-buy-view.tsx:221 vẫn in 'dùng cho đơn từ {unitPrice}' và 'nhận mã giảm {basePrice - unitPrice}đ' (số tiền cố định, đã lệch từ D11-05). Nên đổi sang minOrder và %; packages/app-core/src/api/groupbuy.ts cũng cần thêm minOrder? vào type. Câu hỏi cho chủ: chữ tin GROUP_BUY_SUCCESS ('mã giảm {{discount}}đ') vẫn là việc chủ quyết từ đợt 4a, tin không nêu đơn tối thiểu nên không đổi.

### uat/q10-goi-that

- Đồng bộ phía khách: Mini App và web chỉ đọc effectiveDiscountPct do API trả (subs[0]), nên chỉ sửa API, không đụng apps/web, apps/miniapp, packages/app-core. Cấu hình công khai chỉ có subscribeDiscountPct (bậc cơ bản), không lộ bậc cao hơn.

### uat/q1-xet-hang

- Phí giao vẫn tính trong total theo Q23, không đổi. Không đụng web/miniapp/schema/SystemConfig.
