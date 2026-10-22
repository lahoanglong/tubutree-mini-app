# U3: CTV, đại lý, chủ nhãn (lane 3)

Chạy 2026-10-19, khoảng 22:50 đến 23:55 giờ VN. Lane 3: API 3231, web 3232 (next dev), Mini App 3233, Pancake giả 3238. DB `tubutree_uat_l3`, Redis db 3. Dữ liệu seed của bộ khung gồm uat_ctv, uat_ctv_pending, uat_dealer (bậc DEALER_2: chiết khấu 30%, hạn mức 20.000.000đ, NET 15), uat_brand (chủ nhãn Fuwa3e), uat_admin, uat_ketoan, uat_returning. Mỗi lượt chạy tạo khách mới riêng.

Không sửa mã ứng dụng. Thao tác chuẩn bị trên DB lane, ghi rõ ở từng ca:
- lùi `commissions.lockedAt`, `dealer_credit_ledgers.createdAt`, `orders.createdAt` để giả thời gian;
- bật `waste.enabled` rồi trả về `false`;
- bật `isPublished` cho nhãn Fuwa3e rồi trả lại.

**Tổng: 45 ca. PASS 39, FAIL 5, BLOCKED 1.** Cả 5 FAIL đều ứng với lỗi đã biết còn mở hoặc phần còn lại của lỗi đã biết:
- D11-01: U3-25, U3-26, U3-30;
- D13-01: U3-38;
- D3-06, phần chuyển đổi: U3-37, ghi thành U3-B01.

Phát hiện mới là U3-B02 (cần chủ quyết).

Script chạy lại được nằm ở `uat/scripts/U3-ctv-dai-ly-nhan/`. Dùng `node 0N-*.mjs`, đặt `PATH` có Node 22. Kết quả thô từng ca ở `out/*.json`, ảnh ở `uat/shots/U3-ctv-dai-ly-nhan/`. Thứ tự chạy:
- 01 và 02 độc lập;
- 03 tự đưa gian hàng chờ duyệt về trạng thái chưa duyệt;
- 04 tự trả hết dư nợ đầu lượt;
- 05 phải chạy trước 06 (06 cần gian hàng đối tác của uat_dealer);
- 08 cần 03 chạy trước.

## Bảng ca

| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|
| U3-01 | CTV | Trang CTV | Mini App uat_ctv mở /affiliate | Thấy mã giới thiệu, hoa hồng tháng, nút "Rút tiền hoa hồng"; mọi API 2xx | Có mã UATCTV, số tháng, nút rút; 13 API đều 200 | `shots/U3-ctv-dai-ly-nhan/U3-01-ctv-trang.png`; GET /affiliate/me, /dashboard, /links, /commissions, /payouts, /tax-statement → 200 | PASS |
| U3-02 | CTV | Link chia sẻ | "+ Tạo link" rồi "Chia sẻ" | Tạo link 201, có thêm 1 dòng affiliate_links; sheet chia sẻ mang `?ref=UATCTV` | 201 shortCode GJPfXbE; SQL count 1→2; zmp `openShareSheet` path `/?ref=UATCTV` | `U3-02-ctv-tao-link-chia-se.png`; `SELECT count(*) FROM affiliate_links WHERE "userId"='uat_ctv'` 1→2 | PASS |
| U3-03 | Khách mới | Mở link CTV | Khách mới mở Mini App `/?ref=UATCTV` | POST /affiliate/touch 2xx, có chạm hạn 7 ngày (affiliate.attribution_days) | 201; referral_touches referrer uat_ctv, kind ctv, hạn 2026-10-26 | `U3-03-khach-moi-mo-link.png`; SQL referral_touches | PASS |
| U3-04 | Khách mới | Mua qua link: 8% | PDP → "Mua ngay" → COD → "Đặt hàng" | Đơn gán uat_ctv; commission PENDING = floor(8% × tiền hàng đã trả), không tính phí ship | TUBU2026101988844: hàng 120.000 + ship 19.000; commission PENDING 9.600, base 120.000 | `U3-04-khach-moi-checkout.png`, `U3-04-khach-moi-dat-xong.png`; SQL orders.referrerUserId=uat_ctv; commissions amount 9600, commissionableTotal 120000 | PASS |
| U3-05 | Hệ thống | Giao xong thì khoá | Webhook Pancake shipped → delivered | commission LOCKED, có lockedAt | LOCKED, lockedAt 2026-10-19T15:58:56Z | webhook PROCESSED; SQL commissions status/lockedAt | PASS |
| U3-06 | Hệ thống | Giữ 10 ngày sau giao | Lùi lockedAt 9n23g → job `commissions.approve-due`; lùi 10n1p → chạy lại | Chưa đủ 10 ngày vẫn LOCKED; đủ 10 ngày thì APPROVED | 9n23g: LOCKED; 10n: APPROVED | SQL commissions.status sau mỗi lượt job | PASS |
| U3-07 | CTV | Số dư rút được | Mở /affiliate | "Có thể rút" = SUM(commissions APPROVED, payoutBatchId null) | 19.200 = SQL 19.200, hiện trên màn | `U3-07-ctv-co-the-rut.png`; GET /affiliate/dashboard withdrawableCommission; SQL SUM | PASS |
| U3-08 | CTV chưa có tiền | Rút khi không đủ | uat_ctv_pending POST /affiliate/payouts | 400, không tạo lệnh | 400 "Không có hoa hồng khả dụng để rút."; payouts 0 | SQL count(payouts)=0 | PASS |
| U3-09 | CTV | Rút sai số | Rút quá số dư, rút một phần, rút ngân hàng < 50.000đ | Cả ba 400; số dư không đổi | 400 "không đủ" / "chỉ hỗ trợ rút toàn bộ" / "tối thiểu 50.000đ"; SUM APPROVED 9.600 → 9.600 | SQL SUM APPROVED trước/sau | PASS |
| U3-10 | CTV | Rút về Ví (< 2 triệu) | Mini App "Rút tiền hoa hồng" → "Ví Tubu" → "Nhận 9.600đ vào Ví" | Lệnh WALLET_BALANCE PAID, thuế 0; walletBalance += 9.600 = SUM(wallet_transactions) | PAID, tax 0; walletBalance 1.813.920 → 1.823.520 = SUM sổ | `U3-10-rut-ve-vi-form.png`, `U3-10-rut-ve-vi-xong.png`; SQL users.walletBalance vs SUM(wallet_transactions); wallet_transactions +9600 COMMISSION_PAYOUT | PASS |
| U3-11 | CTV | TNCN 10% từ 2 triệu | Đơn CTV lên hộ 26.202.000đ (CK, đã thu) → giao → duyệt → rút ngân hàng chưa có MST | 400 PIT_TAX_ID_REQUIRED, báo số thuế; không tạo lệnh | Commission 2.096.160; 400 PIT_TAX_ID_REQUIRED "khấu trừ thuế TNCN 209.616đ" | SQL commissions TUBU2026101907776 APPROVED 2096160 | PASS |
| U3-12 | CTV | Hai lệnh rút cùng lúc | 2 POST /affiliate/payouts song song (khoá khác nhau), có MST | Đúng 1 lệnh; gross 2.096.160, thuế = round(10%) = 209.616, net 1.886.544; commission gắn batch | 201 + 400 "đã được xử lý"; payout REQUESTED amount 1.886.544, tax 209.616; còn APPROVED chưa rút 0 | SQL payouts; commissions theo payoutBatchId (1 dòng, 2.096.160) | PASS |
| U3-13 | Kế toán / ADMIN | Duyệt lệnh rút | uat_ketoan POST approve; web admin 1440 "Duyệt" | Kế toán 403; ADMIN duyệt → APPROVED, reviewedBy | 403; APPROVED reviewedBy uat_admin | `U3-13-admin-duyet-rut.png`; SQL payouts | PASS |
| U3-14 | Kế toán | "Đã chi" | Web admin uat_ketoan → "Đã chuyển khoản" → hộp xác nhận | PAID, paidBy, bankRef; commission PAID; báo cáo TNCN tháng = SUM thuế trong sổ | PAID paidBy uat_ketoan bankRef FT26U3g8arl; commission PAID; pit-report thuế 417.936 = SQL 417.936 | `U3-14-ketoan-da-chi.png`; SQL payouts, commissions; GET pit-report và SQL SUM(tax) | PASS |
| U3-15 | ADMIN | Từ chối lệnh rút | ADMIN reject kèm lý do | REJECTED; hoa hồng trở lại "Có thể rút" | REJECTED; SUM APPROVED chưa rút 67.200 → 67.200 | SQL payouts.rejectionReason; SUM APPROVED trước/sau | PASS |
| U3-16 | Khách / CTV | Gian hàng chờ duyệt lần đầu | Gian hàng uatctvpending đã đăng, approvedAt null: GET public, web /s/, Mini App, chủ mở /storefront | API 404; web 404; Mini App "không tồn tại"; chủ thấy "đang chờ Tubu Tree duyệt lần đầu" | API 404; web render mới 404; Mini App "không tồn tại"; chủ thấy đúng lý do | `U3-16-mini-gian-hang-cho-duyet-an.png`, `U3-16-chu-gian-hang-thay-ly-do.png`; SQL storefronts isPublished true, approvedAt null. Bản cache next dev vẫn 200, xem "Hạn chế bộ khung" | PASS |
| U3-17 | ADMIN | Duyệt gian hàng | Web admin /admin?tab=storefronts → "Xem" → "Duyệt gian hàng" | Approval 2xx; API 200; web SSR 200 có tên; Mini App hiện | 200; API 200; web 200 có "Nhà Sạch Của Võ Thị"; Mini App hiện | `U3-17-admin-duyet-gian-hang.png`, `U3-17-mini-gian-hang-sau-duyet.png`; SQL approvedAt | PASS |
| U3-18 | Khách thành CTV | Tạo gian hàng | Mini App khách mới → /affiliate → tick → "Đăng ký miễn phí ngay" → /storefront → "Tạo gian hàng" → "Bỏ qua, tự tạo gian hàng trống" → nhập tên bộ sưu tập → "Tạo bộ sưu tập" → "Thêm sản phẩm" → "Lưu & Đăng" | role AFFILIATE + điều khoản; isPublished true, approvedAt null; API 404; chủ thấy lý do chờ duyệt | Đúng tất cả (uatu3ctvhoi19) | `U3-18-ctv-moi-dang-gian-hang.png`; SQL users.role, metadata.affiliateTerms; storefronts | PASS |
| U3-19 | CTV | Sửa gian hàng | "Cấu hình" → "Tên gian hàng" → "Lưu cấu hình gian hàng"; ADMIN duyệt | PATCH 2xx; title đổi; API, web, Mini App đều hiện tên mới | 200; "Gian hàng xanh hoi19" ở DB, API, web, Mini App | `U3-19-ctv-sua-ten-gian-hang.png`, `U3-19-mini-gian-hang-ten-moi.png`; SQL storefronts.title | PASS |
| U3-20 | Khách mới | Mua trong gian hàng | Khách mới mở /s/uatu3ctvhoi19 → SP → "Mua ngay" → COD | Đơn có storefrontSlug, referrer = chủ gian hàng; commission 8% | storefrontSlug và referrer đúng; commission PENDING 9.600 / base 120.000 | `U3-20-khach-mua-trong-gian-hang.png`; SQL orders, commissions | PASS |
| U3-21 | ADMIN / khách | Ẩn gian hàng khi CTV bị hạ | POST /admin/users/role CUSTOMER; mở public, web, Mini App | API 404; web 404; Mini App "không tồn tại" | API 404; web render mới 404; Mini App "không tồn tại". Trang /affiliate của người bị hạ hiện màn đăng ký CTV (xem U3-B02) | `U3-21-gian-hang-an-sau-ha-vai-tro.png`, `U3-21-ctv-bi-ha-mo-trang-ctv.png`; SQL users.role CUSTOMER | PASS |
| U3-22 | CTV bị hạ | Giữ hoa hồng đơn cũ (B15 đã chốt) | Giao đơn U3-20 sau khi hạ → lùi 10 ngày → job → rút về Ví | Commission APPROVED rồi PAID; walletBalance += 9.600 = SUM sổ | APPROVED → PAID; walletBalance 0 → 9.600 = SUM wallet_transactions | SQL commissions; users.walletBalance vs SUM(wallet_transactions) | PASS |
| U3-23 | Khách mới | Mã của CTV bị hạ | place-order với referralCode + storefrontSlug của CTV bị hạ | Đơn tạo được; referrer null, slug null; không commission | referrer null, slug null, 0 commission | SQL orders, commissions | PASS |
| U3-24 | Đại lý | /dealer bảng giá | Mini App uat_dealer /dealer → "Bảng giá" → tìm "FUWA-DW" | dealerPrice = round(giá lẻ × 0,7) mọi dòng; FUWA-DW-5L 480.000 → 336.000; không có hàng đối tác; "Hạn mức: 20.000.000đ" | 48 dòng, lệch công thức 0; 336.000; 0 dòng đối tác; thẻ Đại lý Cấp 2 + hạn mức | `U3-24-dai-ly-bang-gia.png`; GET /dealer/pricelist; SQL products.storefrontId của các biến thể | PASS |
| U3-25 | Đại lý | Đơn sỉ tối thiểu 3 triệu | "Dán đơn" `FUWA-DW-1L 2` → "Thêm vào đơn" → "Trả trước" | 400, không tạo đơn | 201 DLR28393998055 168.000đ PENDING_PAYMENT, chuyển sang /bank-payment | `U3-25-don-si-duoi-3-trieu-van-dat-duoc.png`; SQL orders subtotal 168000. **D11-01 còn mở** | FAIL |
| U3-26 | Đại lý | Miễn ship từ 5 triệu | POST /dealer/orders PREPAID 4.025.000đ | shippingFee > 0 (mức phí: cần chủ quyết) | 201, shippingFee 0 | SQL orders.shippingFee 0, total 4025000. **D11-01 còn mở** | FAIL |
| U3-27 | Kế toán | Đơn trả trước | uat_ketoan POST /admin/dealer-orders/:code/confirm-payment kèm bankRef | PAID; status rời PENDING_PAYMENT; lịch sử ghi mã GD; không có dòng sổ công nợ | PAID, CONFIRMED; history "Kế toán xác nhận… Mã GD FTU3HL1B2PRE"; 0 dòng sổ | SQL orders, order_status_history, dealer_credit_ledgers | PASS |
| U3-28 | Đại lý | Ghi công nợ | "Dán đơn" 2 dòng (6.042.400đ) → "Ghi công nợ" | CONFIRMED; total = Σ giá đại lý × SL; ship 0 (≥ 5 triệu); sổ ORDER +total; currentDebt = SUM sổ | CONFIRMED 6.042.400, ship 0; sổ +6.042.400; SUM −1.082.312 → 4.960.088 = /dealer/me | `U3-28-ghi-cong-no.png`; `SELECT SUM(delta) FROM dealer_credit_ledgers WHERE "userId"='uat_dealer'` | PASS |
| U3-29 | Đại lý | Hạn mức 20 triệu | Dán giỏ 15.582.000đ khi còn 15.039.912đ; gọi API CREDIT cùng giỏ | Màn báo "Vượt hạn mức…", "Ghi công nợ" tắt; API 400; sổ không đổi | Có cảnh báo, nút tắt; 400 "Vượt hạn mức công nợ."; SUM 4.960.088 → 4.960.088 | `U3-29-vuot-han-muc.png`; SQL SUM sổ | PASS |
| U3-30 | Đại lý | Khoá mua chịu khi quá hạn | Lùi dòng sổ đơn U3-28 về 20 ngày (NET 15); đặt CREDIT FUWA-DW-1L×1 | 400 (khoá CREDIT, PREPAID vẫn được) | 201 DLR28402181869 CONFIRMED, ghi thêm nợ | SQL dealer_credit_ledgers.createdAt 2026-09-29; orders. **D11-01 còn mở** | FAIL |
| U3-31 | Đại lý / Kế toán | Trả nợ | "Công nợ" → "Số tiền đã chuyển" 2000000 → "Báo đã CK"; kế toán ghi số vượt dư nợ, rồi 2.000.000 | Báo CK 2xx nhưng sổ không đổi; vượt dư nợ 400; ghi đúng thì PAYMENT −2.000.000, nợ giảm đúng | 201, sổ 5.044.088 → 5.044.088; vượt 400; PAYMENT −2.000.000 → 3.044.088 = API | `U3-31-dai-ly-bao-da-ck.png`; SQL SUM sổ 3 thời điểm; dòng PAYMENT có mã GD | PASS |
| U3-32 | Hệ thống | Thưởng quý | 3 đơn CREDIT ~18 triệu → giao → kế toán ghi trả → lùi createdAt vào Q1/2026 → `DealerService.payoutQuarterlyBonuses(now=2026-04-10)` hai lần | Thưởng = round(doanh số đã chốt × bậc), bậc mặc định ≥50tr 2%; 1 dòng QUARTER_BONUS âm; chạy lại không trả lần 2 | Doanh số đã chốt SQL 54.084.800 → thưởng 1.081.696; lượt 1 paid 1, lượt 2 paid 0; 1 dòng −1.081.696; SUM 0 → −1.081.696 | SQL orders (DELIVERED + có dòng sổ ORDER) trong quý; dealer_credit_ledgers QUARTER_BONUS; notification_logs DEALER_BONUS_PAID | PASS |
| U3-33 | Đại lý / ADMIN / Kế toán | Phần thưởng mốc | ADMIN tạo quà 5 triệu/quý (Fuwa3e); /dealer → "Báo cáo" → "Yêu cầu nhận thưởng"; kế toán duyệt; ADMIN duyệt; kế toán chi | claim Q4/2026 PENDING, volumeAtClaim = doanh số đã chốt (SQL); kế toán duyệt 403; ADMIN duyệt; kế toán chi → PAID | Q4/2026, vol 85.114.400 = SQL; 403; APPROVED; PAID paidBy uat_ketoan | `U3-33-dai-ly-yeu-cau-nhan-thuong.png`; SQL dealer_reward_claims | PASS |
| U3-34 | Đại lý / khách mới | Đại lý giới thiệu khách lẻ | place-order referralCode=UATDEALER, FUWA-DW-1L×2 | referrer uat_dealer; commission PENDING 8% tiền hàng | 19.200 = 8% × 240.000 | SQL orders.referrerUserId; commissions; SUM order_items.paidTotal | PASS |
| U3-35 | Khách mới / CTV | Không hoa hồng hàng đối tác | uat_dealer mở gian hàng đối tác, đăng SP 150.000đ, ADMIN duyệt; khách mới mua SP đó + FUWA-DW-1L qua UATCTV | Hoa hồng chỉ trên hàng Tubu: 9.600; đơn con hàng đối tác 0 | Tách 2 đơn; hàng Tubu 9.600; đơn đối tác 0 dòng commission | SQL order_items (partner true/false, paidTotal); commissions theo đơn | PASS |
| U3-36 | Đại lý | Đơn sỉ không mua hàng đối tác | GET /dealer/pricelist; POST /dealer/orders với biến thể đối tác | Không có trong bảng giá; 400 PARTNER_GOODS_NOT_ELIGIBLE | Đúng | HTTP 400 code PARTNER_GOODS_NOT_ELIGIBLE | PASS |
| U3-37 | Khách mới / CTV | Đếm click và chuyển đổi của link | Link mới → khách mới mở `/?ref=UATCTV&l=mRwbR_o` → đặt đơn | clicks +1; đơn ghi công uat_ctv; conversions +1; "Chuyển đổi" trên trang CTV tăng | clicks 0 → 1; đơn ghi công, hoa hồng 9.600; conversions 0 → 0; dashboard totalConversions 0, dù CTV có 15 đơn có hoa hồng | `U3-37-link-click-chuyen-doi.png` ("1 click · 0 đơn"); SQL affiliate_links.clicks/conversions; GET /affiliate/dashboard. **U3-B01** | FAIL |
| U3-38 | ADMIN | Quầy đại lý chỉ carton + nilon | PATCH /admin/waste/points/:id (PARTNER) thêm wi-milk-carton, wi-tubu-bottle | 400, danh sách món không đổi | 200, điểm đại lý lưu 4 món (script trả lại 2 món sau đó) | SQL waste_point_items. **D13-01 còn mở** | FAIL |
| U3-39 | Khách | Gửi hộp sữa / vỏ chai tới quầy đại lý | POST /waste/requests DROP_OFF tới điểm đại lý: hộp sữa ×10, rồi vỏ chai ×2 | Bị từ chối, không tạo yêu cầu; danh sách điểm công khai chỉ carton + nilon | 409 "Điểm nhận này không nhận: Vỏ hộp sữa sạch" / "…Vỏ chai, hộp Tubu Tree"; 0 waste_requests; acceptedItemIds [wi-carton, wi-bubble-wrap] | SQL count(waste_requests); GET /waste/points | PASS |
| U3-40 | Đại lý (quầy) / khách | Quầy nhận carton + nilon | Khách hẹn 3 carton + 2 nilon → uat_dealer /recycle/desk → nhập mã → "Tra mã" → "Xác nhận đã nhận" | COMPLETED, pointsAwarded 5.000; points_transactions RECYCLE +5.000; pointsBalance = SUM sổ | COMPLETED 5.000; sổ +5.000; balance 0 → 5.000 = SUM | `U3-40-quay-dai-ly-tra-ma.png`, `U3-40-quay-dai-ly-da-nhan.png`; SQL waste_requests, points_transactions | PASS |
| U3-41 | Khách chưa đăng nhập / khách thường | /brand trên Mini App | Mini App guest và uat_returning mở /brand/fuwa3e | Cả hai thấy "Chương trình đại lý" (chốt 2026-10-19), tên quà, nút "Đăng ký đại lý"; API dealerRewards khớp SQL | Cả hai thấy khối, 3 quà, nút "Đăng ký đại lý"; API 3 = SQL 3; 6 SP | `U3-41-mini-nhan-guest.png`, `U3-41-mini-nhan-returning.png`; SQL dealer_rewards active (brand hoặc chung) | PASS |
| U3-42 | Khách (web) | /brand trên web SSR | GET 3232 /brand/fuwa3e (render mới); Playwright guest 390, uat_returning 1440 | 200; HTML SSR có khối + tên quà; giao diện hiện khối | Đúng | `U3-42-web-nhan-390-khach.png`, `U3-42-web-nhan-1440.png`; HTML chứa "Chương trình đại lý" | PASS |
| U3-43 | Chủ nhãn | Doanh thu | Mini App uat_brand /brand-owner → "Doanh thu" (30 ngày) | revenue, orderCount, unitsSold = SQL (loại PENDING_PAYMENT/CANCELLED/RETURNED, REFUNDED/FAILED); màn hiện đúng | 48.239.000 / 28 đơn / 416 SP = SQL; return_requests trong kỳ 0. Số gồm cả đơn đại lý (giá sỉ) | `U3-43-chu-nhan-doanh-thu.png`; SQL SUM(order_items.total) theo brandId | PASS |
| U3-44 | Chủ nhãn / khách | Khuyến mãi | "Hồ sơ & khuyến mãi" → Tiêu đề, Mô tả → "Thêm khuyến mãi"; khách mở trang nhãn | 201; brand_promotions active, hạn +30 ngày; API, Mini App, web hiện tiêu đề | 201; 19/10 → 18/11; hiện ở API, Mini App, web SSR | `U3-44-chu-nhan-them-khuyen-mai.png`, `U3-44-mini-nhan-khuyen-mai-moi.png`; SQL brand_promotions | PASS |
| U3-45 | CTV / đại lý | Tin báo tiền qua Zalo | SQL notification_logs của uat_ctv, uat_dealer | Có tin trong app; tin ZNS/OA theo mẫu | Chỉ kênh INAPP, tất cả SENT (COMMISSION_NEW 14, PAYOUT_PAID 2, DEALER_BONUS_PAID 3, DEALER_CREDIT_PAYMENT_CONFIRMED 28…); 0 dòng ZNS | SQL notification_logs GROUP BY mẫu, kênh. Lane tắt Zalo OA/ZNS (README uat-harness mục 2) | BLOCKED |

Truy vấn đối soát chính (dán được vào psql của lane 3):

```sql
-- Ví CTV: số dư = sổ
SELECT u."walletBalance", (SELECT SUM(delta) FROM wallet_transactions w WHERE w."userId" = u.id) FROM users u WHERE id = 'uat_ctv';
-- Hoa hồng rút được = "Có thể rút"
SELECT SUM(amount) FROM commissions WHERE "affiliateUserId" = 'uat_ctv' AND status = 'APPROVED' AND "payoutBatchId" IS NULL;
-- Lệnh rút: gross = net + thuế, thuế = round(10%) khi gross ≥ 2.000.000
SELECT id, "grossAmount", "taxWithheld", amount, status FROM payouts WHERE "userId" = 'uat_ctv' ORDER BY "createdAt" DESC;
-- Công nợ đại lý: SUM sổ = /dealer/me currentDebt, mỗi dòng ORDER = total đơn
SELECT SUM(delta) FROM dealer_credit_ledgers WHERE "userId" = 'uat_dealer';
SELECT l."refId", l.delta, o.total FROM dealer_credit_ledgers l JOIN orders o ON o.id = l."refId" WHERE l."userId" = 'uat_dealer' AND l."refType" = 'ORDER' AND l.delta <> o.total;
```

Đối soát cuối lượt 04: SUM sổ đại lý −1.081.696 (60 dòng) = API currentDebt −1.081.696. Số dòng ORDER lệch total đơn: 0 (`out/04-doi-soat.json`).

## Lỗi tìm thấy

### Đã biết, còn mở, xác nhận lại tối nay

- **D11-01** (P1, cần chủ quyết; `apps/api/src/modules/dealer/dealer.service.ts:207`, `:258-268`, `:306`). Còn mở, tái hiện qua UI và API:
  - đơn sỉ 168.000đ vẫn đặt được (U3-25);
  - đơn 4.025.000đ có shippingFee 0 (U3-26);
  - nợ quá NET 15 vẫn ghi thêm CREDIT (U3-30).

  Script: `04-dai-ly.mjs`.
- **D13-01** (P2, agent sửa ngay; `apps/api/src/modules/waste-exchange/catalog/waste-admin-points.service.ts:219` hàm update, `:172-178` hàm create). Còn mở. ADMIN thêm hộp sữa + vỏ chai vào điểm PARTNER và nhận 200 (U3-38). Script: `06-quay-doi-rac-dai-ly.mjs`. Khi danh sách món của điểm đúng, phía khách đã chặn đúng (U3-39).
- **D1-04** (P2, cần chủ quyết). Ngưỡng TNCN 2 triệu xét theo từng lần rút. Hành vi đúng như mô tả: U3-10 rút 9.600đ không thuế, U3-12 rút 2.096.160đ thuế 209.616đ. Không tính FAIL.

### Mới

| ID | Mức | Nhóm | path:line | Mô tả và kịch bản | Bằng chứng | Đề xuất sửa + test | Script tái hiện | Vùng file |
|---|---|---|---|---|---|---|---|---|
| U3-B01 | P2 | agent sửa ngay | `apps/api/prisma/schema.prisma:1416` (`AffiliateLink.conversions`); `apps/api/src/modules/affiliate/affiliate.service.ts:270-279` (`trackClick` chỉ tăng clicks), `:315`, `:334` (dashboard cộng conversions); `:880` (`createCommissionForOrder`, không đụng link); `apps/miniapp/src/pages/affiliate.tsx:344` ("Chuyển đổi"), `:626` ("x click · y đơn"); `apps/miniapp/src/utils/entry-source.ts:50` (đọc `l=`); `apps/web/src/lib/link-click.ts:12` | Phần còn mở của **D3-06** (2026-10-18). Click đã đếm (`40694b60`, `fb62365e`, `b18b7e7a`); vế "cộng conversions khi đơn mang mã link" chưa làm. Không chỗ nào trong apps/api/src tăng `conversions`, đơn và lượt chạm không lưu mã link. Khách mới mở `/?ref=UATCTV&l=<mã>`, clicks 0 → 1, đặt đơn có hoa hồng 9.600đ → conversions vẫn 0. Trang CTV hiện "Chuyển đổi 0" và "1 click · 0 đơn" dù CTV có 15 đơn có hoa hồng | U3-37: SQL affiliate_links clicks 0→1→1, conversions 0→0; GET /affiliate/dashboard totalConversions 0→0; ảnh `U3-37-link-click-chuyen-doi.png` | Lưu mã link vào lượt chạm (`referral_touches`, cột mới `linkShortCode`) và đơn (`orders.affiliateLinkId`) khi `l=` khớp link của chính referrer. Trong `createCommissionForOrder` (cùng transaction), tăng `conversions` +1 và `revenue` += commissionableTotal của link đó. Chưa kịp thì ẩn ô "Chuyển đổi" và "· y đơn". Test: affiliate.service.spec "đơn có touch mang shortCode → link.conversions +1, revenue += base"; "đơn không mang mã link → conversions không đổi"; race-spec hai đơn cùng link | `05-hang-doi-tac-link.mjs` (U3-37) | API + miniapp: vùng UAT. `apps/web/src/lib/link-click.ts`, `entry-source.ts`: vùng phiên web |
| U3-B02 | P2 | cần chủ quyết | `apps/api/src/modules/affiliate/affiliate-access.ts:4-6` (`canRegisterAsAffiliate` cho CUSTOMER); `apps/api/src/modules/affiliate/affiliate.service.ts:119-125` (`register` đặt lại AFFILIATE); `apps/api/src/modules/admin/admin.controller.ts:472` (`users/role`) | ADMIN hạ CTV về CUSTOMER (gian hàng ẩn, đúng B16). Người bị hạ mở /affiliate, thấy màn "Trở thành CTV Tubu" (không thấy số dư hoa hồng đơn cũ), tick, bấm "Đăng ký miễn phí ngay": 201, role về AFFILIATE ngay, không ai duyệt. Gian hàng đã duyệt hiện lại (API 404 → 200), mã giới thiệu ghi công đơn mới (hoa hồng 9.600đ). Nếu hạ vai trò là biện pháp xử lý CTV vi phạm thì việc này vô hiệu, và không có cờ nào khác để chặn riêng CTV | `out/08-ctv-bi-ha-dang-ky-lai.json`: uat_u3ctvhoi19 CUSTOMER → register 201 → AFFILIATE; public 404 → 200; đơn TUBU2026101984460 referrer uat_u3ctvhoi19, commission PENDING 9.600; ảnh `U3-B02-ctv-bi-ha-tu-dang-ky-lai.png` | Chủ chọn: (a) giữ như hiện tại (hạ vai trò chỉ là "tạm ngừng", tự mở lại được), nên ghi rõ trong màn admin; hoặc (b) khi ADMIN hạ thì ghi `metadata.affiliateRevokedAt/By`, `register` trả 403 "Tài khoản đã bị Tubu Tree ngừng CTV" cho tới khi ADMIN mở lại. Với (b) cũng nên cho người bị hạ xem và rút số dư APPROVED còn lại (API đã cho, U3-22) mà không phải đăng ký lại. Test: affiliate.service.spec "user bị ADMIN hạ → register 403"; "CUSTOMER chưa từng là CTV → register 201" | `08-ctv-bi-ha-dang-ky-lai.mjs` (cần `03-gian-hang.mjs` chạy trước) | API: vùng UAT; màn /affiliate miniapp: vùng UAT |

Ghi chú không tính lỗi:
- Doanh thu màn chủ nhãn (U3-43) gồm cả đơn đại lý theo giá sỉ (`brand.service.ts:576-581` không lọc `type`). Số khớp SQL. Nếu chủ muốn tách bán lẻ và bán sỉ thì cần thêm cột; hiện chưa có luật chốt.
- Gian hàng bị ẩn (chờ duyệt, hạ vai trò) trên web production chỉ ẩn sau lượt tái tạo ISR (revalidate 300 giây ở `apps/web/src/app/s/[slug]/page.tsx:24`). Trên next dev của bộ khung thì không bao giờ ẩn, xem mục dưới. Production chưa kiểm chứng.

## Hạn chế bộ khung (không tính FAIL)

1. **Web next dev giữ mãi bản cũ của trang đã từng hiện.** `/s/[slug]` đọc API bằng fetch `revalidate: 300`. Next 14.2.35 chỉ ghi data cache khi API trả 200 (`node_modules/.pnpm/next@14.2.35…/next/dist/server/lib/patch-fetch.js:458`). Khi bản cache hết hạn, next dev trả bản cũ và tải lại nền; 404 mới không được ghi, nên gian hàng đã ẩn vẫn hiện tới khi tắt dev server. Đo được: hỏi lại mỗi 15 giây trong 424 giây, vẫn 200. Ca U3-16, U3-17, U3-19, U3-21 vì vậy chấm theo lượt render mới (`cache-control: no-cache`; next dev bỏ qua data cache). Bản cache ghi kèm trong `out/03-gian-hang.json`. Production tái tạo trang ở chế độ isRevalidate, phải tải lại tiền cảnh nên thấy 404; điều này chưa kiểm chứng vì không được `next build`.
2. **`run-job.mjs` đôi khi thoát mã 1.** Lỗi là ioredis "Connection is closed" lúc đóng context, sau khi đã in JSON kết quả. Gặp ở lượt 01, 02 khi chạy `commissions.approve-due`. `u3lib.runJob` đọc JSON từ stdout dù mã thoát khác 0; job đã chạy xong, xác minh bằng SQL trạng thái commission.
3. **Đăng nhập Zalo là giả.** `/auth/zalo-mini-app` nhận token giả của fake zmp-sdk. Đường gắn `ref` lúc đăng nhập lần đầu (`referredById`) chưa kiểm chứng. Ghi công dùng đường lượt chạm `/affiliate/touch` và `referralCode` lúc đặt đơn. Chia sẻ Zalo chỉ ghi được lệnh `openShareSheet` của SDK giả.
4. **Tin ra ngoài tắt** (Zalo OA/ZNS): U3-45 BLOCKED. Pancake và ngân hàng là giả: giao hàng bằng webhook shipped → delivered, tiền vào bằng `bank-webhook.mjs`.
5. **Thời gian giả bằng SQL**, không chờ thật:
   - giữ 10 ngày (`commissions.lockedAt`);
   - NET 15 (`dealer_credit_ledgers.createdAt`);
   - quý thưởng (`orders.createdAt`, `payoutQuarterlyBonuses(now)`).

   Thưởng quý idempotent theo (đại lý, quý), nên mỗi lượt chạy 04 dùng quý chưa trả gần nhất: lượt tối nay lần lượt Q3/2026 → Q2/2026 → Q1/2026. Doanh số kỳ vọng lấy bằng SQL theo đúng luật đã chốt, không cộng tay.
6. **Tồn kho lane cạn dần khi chạy lại.** Đơn sỉ tự chọn SKU còn tồn (giữ 10), bỏ 3 SKU flash sale. Một lượt hỏng giữa chừng đã để lại 1 đơn đặt trước (backorder 215) không lên Pancake.
7. **Máy tải cao** (load tới 213 do phiên khác chạy vitest). Các lượt chạy đều chờ load < 40 theo brief.
