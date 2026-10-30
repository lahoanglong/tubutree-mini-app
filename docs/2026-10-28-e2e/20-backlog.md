# 20. Backlog sửa end-to-end (đêm 2026-10-28)

Bản mã: nhánh `review/e2e-2026-10-28` = main `f4ec472d7` (gồm PR #59–#67). Nguồn: 8 báo cáo nhóm `11-muahang.md` … `18-cskh.md` và các mục "Sau" của `docs/2026-10-28-review/20-backlog.md`.

Kết quả: **128 mục E**: P1 2, P2 28, P3 98. Trong đó 6 mục là việc của chủ (E-2, E-30, E-80, E-88, E-126, E-128), 1 mục làm ở bước tích hợp (E-120), 1 mục để sau có lý do (E-125), còn lại 120 mục chia vào 16 gói chạy song song. Quyết định thay chủ và việc chờ chủ: `21-quyet-dinh.md`. Việc từng gói: `goi/<gói>.md`.

## Cách đọc

- Mức: P1 nên sửa trước khi mở cho đông khách; P2 nên sửa trong tháng đầu; P3 đánh bóng.
- Mã E đánh theo mức giảm dần. Cột "Nguồn" ghi mã phát hiện của nhóm và mã R cũ.
- CS: S dưới nửa ngày, M 1–2 ngày.
- Cột "Gói": tên gói trong `goi/`. "chủ" = việc của chủ, không làm đêm nay. "tích hợp" = làm khi gộp các gói. "sau" = để lại có lý do kỹ thuật.
- E-1..E-90 là phát hiện mới của đợt này; E-91..E-124 là mục cũ (R); E-125..E-128 là bốn phát hiện mới P3 thêm sau cùng (không đổi thứ tự mức).
- Bằng chứng tính từ gốc worktree; số dòng có thể lệch vài dòng, tin mã.

## Gộp trùng (cùng gốc → một mục, lấy mức cao nhất)

| Mục | Gộp từ | Lý do |
|---|---|---|
| E-3 | KYTHUAT-04, CSKH-05 | Cùng 24+ chỗ `.notify().catch(() => undefined)` |
| E-4 | DODANG-02, CSKH-01 | Cùng hàm `notificationOrderLink` không loại `MERCHANT_` |
| E-5 | DIEM-05, CSKH-02, CTV-05 | Cùng hàm `notificationAction`/`notificationMeta` thiếu nhánh |
| E-33 | MUAHANG-06, DODANG-10 | Cùng thiếu tải video đánh giá trên web |
| E-42 | DOIRAC-08, R-135 | Cùng quầy web thiếu quét mã |
| E-84 | CSKH-10 (phần a), R-112 (phân trang) | Cùng `take: 50` của danh sách tin |
| E-86 | CSKH-12, R-170 | Cùng kiểm log ZNS không lọc trạng thái |
| E-87 | CSKH-13, R-112 (tiêu đề) | Cùng tiêu đề chung "Thông báo" |
| E-89 | CSKH-15, R-133 | Cùng thẻ sự kiện cộng đồng Mini |
| E-91 | R-114, CSKH-10 (phần b) | Cùng Cá nhân tải danh sách chỉ để đếm |
| E-29 | VANHANH-08, R-69 | VANHANH-08 là phần còn lại của R-69 |
| E-64 | DODANG-03, R-157 | Cùng dòng định kỳ trong Quà khách mới |
| E-65 | DODANG-04, R-132 | Cùng trang Xếp hạng web |
| E-68 | DODANG-07, R-75 | Phần còn lại của R-75 (Sự kiện) |
| E-69 | DODANG-08, R-53 | Phần còn lại của R-53 (earn-sheet) |
| E-20 | DIEM-07, R-41 | Cùng `take: 100` lịch sử điểm |

Tách: CTV-10 thành E-48 (Mini storefront-view, gói giohang) và E-49 (platform của touch, gói ctv). CSKH-04 một mục E-81 nhưng hai gói làm hai file (thongbao: flash-sale + client; muachung: groupbuy).

## Kiểm lại mục cũ trên mã worktree này

Đủ 41 mã: 31 mã "Sau" (trừ R-116) và R-167..R-176. Không mã nào đã xong hẳn. Ba mã xong một phần, chỉ làm phần còn lại.

| Mã R | Còn? | Kiểm thấy | Mục E |
|---|---|---|---|
| R-92 | còn | `suggest-feed.tsx` rỗng vẫn render tiêu đề | E-92 |
| R-93 | còn | `app/dang-nhap` dùng biểu tượng chung | E-93 |
| R-94 | còn | web `bottom-nav.tsx` `text-xs`, Mini caption | E-94 |
| R-95 | còn | Mini `bottom-nav.tsx:24-28` `go()` trả về khi cùng đường | E-95 |
| R-98 | còn | trang SP web khác kiểu | E-96 |
| R-99 | còn | giỏ rỗng web không có dải gợi ý | E-97 |
| R-100 | một phần | Mini đã có nhãn giảm giá và lớp hết hàng; thiếu nút giỏ nhanh | E-98 |
| R-101 | còn | nhãn "(đã giảm)" dùng cả khi không giảm; `vi.cart.subtotal` có sẵn | E-99 |
| R-102 | còn | `packages/app-core/src/group-buy-copy.ts:38` | E-100 |
| R-106 | còn | Mini không giới hạn chiều ngang | E-101 |
| R-112 | còn | `notifications.service.ts` `take: 50`; tiêu đề "Thông báo" | E-84, E-87 |
| R-114 | còn | `profile.tsx:113` 3 `useQueries` đếm đơn | E-91 |
| R-121 | còn | `DEFAULT_TREE_TYPE = 'Cây Dứa Fuwa3e'` hiện ở garden-hero | E-102 |
| R-122 | còn | trang Hạng còn khối mã | E-103 |
| R-125 | còn | mã gõ tay vẫn là nút phụ (`external-points.tsx`) | E-104 |
| R-130 | còn | nút phụ AI/chat khác kiểu | E-105 |
| R-131 | một phần | trang AI đã `max-w-2xl`; dải chip chat còn băng trắng | E-106 |
| R-132 | còn | `app/cong-dong/xep-hang/page.tsx` còn | E-65 |
| R-133 | còn | `community-events.tsx` thẻ nêu điểm | E-89 |
| R-134 | còn | `support-hotline.tsx` `flexWrap: 'wrap'` | E-107 |
| R-135 | còn | web `recycle-desk.tsx` không có quét | E-42 |
| R-136 | còn | chữ `vi.storefront` như cũ | E-108 |
| R-138 | còn | "Nhắn Tubu" rơi về `/gioi-thieu` khi chat tắt | E-109 |
| R-140 | còn | các lệch nhỏ CTV/gian hàng còn | E-110 |
| R-143 | một phần | token đã nằm trong `dealer-theme.css` từng app, chưa vào `design-tokens` | E-111 |
| R-150 | còn | tab Chat CSKH 375 như ảnh | E-112 |
| R-151 | còn | `window.confirm` trong Mini `admin.tsx` | E-113 |
| R-152 | còn | không có `data-hydrated` | E-114 |
| R-153 | còn | `ProductCard` không có `createdAt`/`isNew` | E-115 |
| R-154 | còn | Mini `utils/server-clock.ts` song song app-core; PDP `flashItem` không lọc `endAt` | E-116 |
| R-155 | còn | `getAvailableCoupons` sắp theo id, cắt 50 ở `coupons.service.ts:192` | E-117 |
| R-167 | còn | `vn-date-input.tsx:141,146` dòng nhắc `absolute` | E-118 |
| R-168 | còn | không có câu "hết hạn phải sau bắt đầu" | E-118 |
| R-169 | còn | `touched` không đặt lại | E-118 |
| R-170 | còn | `dedupeWhere` ZNS không lọc trạng thái; `queue.add` lỗi không ném | E-86 |
| R-171 | còn | `tierKeepGap` tính `since = until − 12 tháng` | E-119 |
| R-172 | còn | ảnh cũ chưa chụp lại | E-120 |
| R-173 | còn | `use-home-settling.ts:16` | E-121 |
| R-174 | còn | `use-home-settling.ts:11-13` | E-122 |
| R-175 | còn | chưa có test cấp trang | E-123 |
| R-176 | còn | `home-settling.tsx:9-12` số 96/138/260 | E-124 |

Không làm theo lệnh: R-86, R-116, R-160, R-166 (chờ chủ, xem `21-quyet-dinh.md`).

## Bảng backlog

| Mã | Mức | Hành trình | Vấn đề | Bằng chứng file:dòng | Sửa cụ thể | CS | Nguồn | Gói | Ghi chú phản biện |
|---|---|---|---|---|---|---|---|---|---|
| E-1 | P1 | Vận hành | Đơn đại lý chuyển khoản chờ tiền không có thẻ việc, tự huỷ sau 72 giờ | `apps/api/src/modules/admin/admin-order-filter.ts:133-138`; `ops/ops-inbox.service.ts:110`; `orders/pending-payment-expiry.cron.ts:88-97` | Queue + khoá `dealerTransferToConfirm` cho KE_TOAN, giờ còn lại theo TTL đại lý | M | VANHANH-01 (R-13 phần đại lý) | admin-hopviec | Giữ P1: đơn sỉ lớn nhất, huỷ im lặng |
| E-2 | P1 | Điểm | Khách vãng lai nhận điểm danh và thưởng 7 ngày, gộp vào tài khoản thật không giới hạn | `loyalty/loyalty.service.ts:1306-1330`; `game/game.service.ts:902-925`; `auth/auth.service.ts:257-325` | Chủ chốt luật; nếu chặn: bỏ điểm cho khách vãng lai, giữ giọt nước, chặn nhiệm vụ | M | DIEM-01 | chủ | Đổi luật điểm: không làm đêm nay. Giữ P1 vì điểm đổi ra mã thật |
| E-3 | P2 | Kỹ thuật, CSKH | 24+ lời gửi tin `.catch(() => undefined)` không log | `orders/order-status.service.ts:476-478, 602-613, 733-735`; `orders/refund-queue.ts:228, 474, 553`; `notifications.service.ts:100-168` | `notifySafe` + thay hết + audit spec chặn tái phạm | M | KYTHUAT-04, CSKH-05 | api-tin | Gộp trùng |
| E-4 | P2 | Thông báo | Tin `MERCHANT_*` mở trang đơn người mua, đối tác gặp 404 | Mini `pages/notifications.tsx:77-80, 115-117`; `orders/orders.service.ts:236-241` | Loại `MERCHANT_` khỏi nhánh đơn; web dẫn `/merchant?tab=...`; Mini không nút | S | DODANG-02, CSKH-01 | thongbao | Gộp trùng |
| E-5 | P2 | Thông báo | Tin hoa hồng, hạng, điểm sàn không nút; nhãn gian hàng sai | Mini `notifications.tsx:37-71, 99-152`; web `notification-view.ts:96-147` | Luật chung `packages/app-core/src/notification-route.ts` | M | DIEM-05, CSKH-02, CTV-05 | thongbao | Gộp trùng |
| E-6 | P2 | Mua hàng | Giỏ và thanh toán không nói khách có mã dùng được | Mini `checkout.tsx:647-657`, `cart.tsx:608-618`; web `coupon-box.tsx:114-121, 245-250` | Câu "Bạn có N mã dùng được · giảm đến X"; không tự áp | M | MUAHANG-01 | giohang | Hạ P1→P2: khách vẫn tự chọn được mã, không sai tiền; tự áp mã chờ chủ |
| E-7 | P2 | CTV | Mọi `?ref=` bị khoá như mã CTV ở thanh toán | Mini `components/checkout/referral-code-box.tsx:81-104`; `affiliate.service.ts:229-236` | `referralEligible` trong storefront-context | S | CTV-04 | giohang | Không đổi luật ghi công |
| E-8 | P2 | CTV | Web mất nguồn CTV khi khách chưa đăng nhập đóng tab | web `lib/storefront-context.ts:11-14, 34, 64`; `storefront-tracker.tsx:23, 39-44` | Bản chờ `localStorage` 7 ngày, ghi chạm khi đăng nhập | M | CTV-01 | giohang | Hạ P1→P2: kênh chính Mini không bị |
| E-9 | P2 | Mua chung | "Mua ngay với mã" không áp mã | Mini `group-buy.tsx:93, 206-219`; web `group-buy-view.tsx:192, 227-236` | Áp mã sau khi thêm giỏ (`applyCoupon`) | M | MUAHANG-02 | muachung | |
| E-10 | P2 | Mua hàng | "Giao dự kiến" hứa cho hàng gian hàng tự giao | Mini `checkout.tsx:97, 1020`; `packages/app-core/src/shipping-eta.ts:23-25, 41` | `checkoutEtaLabel(eta, kinds)` | S | MUAHANG-03 | giohang | |
| E-11 | P2 | CTV | Khách vãng lai đăng ký CTV; dòng đã gộp vẫn được ghi công; mua chung không có lối liên kết | `affiliate/affiliate.service.ts:130-136, 229-243`; `auth/auth.service.ts:409-412, 745-755`; Mini `group-buy.tsx:94` | Chặn `register`; lọc `mergedIntoId`; `ensurePhone` trước khi đăng ký/tham gia | S | CTV-03 | ctv (+ muachung phần `group-buy.tsx`) | Chủ đếm CTV là tài khoản khách trên PROD (chỉ đọc) trước deploy |
| E-12 | P2 | Kỹ thuật | 429/503/ACCOUNT_BLOCKED đẩy khách quen về "Khách" | Mini `store/auth.ts:124-141, 172-195`; `auth/auth.service.ts:961` | Chỉ lỗi SDK mới về khách; lỗi máy chủ báo và thử lại | M | KYTHUAT-01 | phien | Hạ P1→P2: chỉ khi lỗi tạm; đơn tự gộp lần sau |
| E-13 | P2 | Kỹ thuật | `/auth/ensure-phone` không làm mới khi 401; lỗi 409 bị nuốt | Mini `services/api.ts:128, 164-165`; `store/auth.ts:215-230` | `isAnonAuthCall`; `ensurePhoneOrThrow` mới, `ensurePhone` giữ trả null | S | KYTHUAT-02 | phien | Checkout không đổi |
| E-14 | P2 | Kỹ thuật | deviceId (khoá vào tài khoản khách) lưu thô, CSKH và analytics thấy | `auth/auth.service.ts:105-111`; `admin/admin.controller.ts:447-450`; `analytics/analytics.controller.ts:20, 28` | Khoá `guest_h_<sha256>`, đổi tại chỗ; analytics băm | M | KYTHUAT-06 | phien | |
| E-15 | P2 | Kỹ thuật | Token OA ghi rời, chỉ một lần thử trước hạn, không theo dõi | `integrations/zns/zalo-oa-token.service.ts:78-80`; `zalo-oa-token.util.ts:4`; `zalo-oa-token.cron.ts:18` | Transaction, ngưỡng 13 giờ, kiểm ở ops-health | S | KYTHUAT-05 | hotro | |
| E-16 | P2 | Điểm | Không có kiểm lệch sổ điểm/Ví; lỗi cron chỉ warn | `loyalty/loyalty-expiry.service.ts:404-406, 452-456`; `loyalty.service.ts:442`; `loyalty/points-reconcile.ts:61` | Cron 04:30 đọc-chỉ báo `OPS_HEALTH_ALERT`; warn→error | M | DIEM-02 | api-tin (+ diem dòng 442) | Chỉ báo, không sửa sổ |
| E-17 | P2 | Điểm | Chọn người thắng: đóng trước, cộng sau, lỗi thì mất thưởng | `feed/community-feed.service.ts:1515-1540` | Một transaction; lỗi thì sự kiện vẫn OPEN | S | DIEM-03 | diem | |
| E-18 | P2 | Điểm | Đếm trần mã thu hoạch quét cả bảng `coupons` | `game/game.service.ts:383-388, 476`; `game/game-garden.service.ts:214-222, 276` | `$queryRaw` khớp index một phần | S | DIEM-04 | diem | Chưa chạy EXPLAIN thật: kiểm trong race |
| E-19 | P2 | Điểm | Thẻ thành viên mời lên hạng khi khách sắp bị hạ | `packages/app-core/src/home-layout.ts:263-284` | `tierGraceLine` ưu tiên | S | DIEM-06 (R-42 phần) | canhan | |
| E-20 | P2 | Điểm | Lịch sử điểm chỉ 100 dòng | `loyalty/loyalty.service.ts:757-765`; `loyalty.controller.ts:20-23` | Con trỏ `before/beforeId/limit`, giữ mặc định | M | DIEM-07 = R-41 | diem | Không cần migration (có index `userId`) |
| E-21 | P2 | Vườn | Nhiệm vụ "Mời 3 bạn" dẫn sang Ví | Mini `pages/game.tsx:53-57`; web `vuon-xanh/page.tsx:63-67` | Đường tới mục mời bạn ở Cá nhân | S | DODANG-01 | canhan | |
| E-22 | P2 | Đổi rác | Không nhắc trước hạn; MAIL_IN đã gửi kiện bị báo "hết hạn" | `waste-exchange/pickup/waste-expiry.cron.ts:39, 91`; `core/waste-notifier.service.ts:21` | Mẫu `WASTE_REQUEST_EXPIRING` (INAPP) + chữ MAIL_IN không hứa | M | DOIRAC-03 | doirac | Cờ waste tắt; migration chèn mẫu |
| E-23 | P2 | CSKH | Trợ lý AI mất hội thoại khi xem SP rồi quay lại | Mini `pages/ai-advisor.tsx:41, 182`; web `tu-van/page.tsx:52, 65` | Store trong bộ nhớ, xoá khi đăng xuất | S | CSKH-06 | hotro | Chỉ khi cờ AI bật |
| E-24 | P2 | Vận hành | Yêu cầu xoá tài khoản không có thẻ việc | `users/users.service.ts:259, 277`; `ops/ops-inbox.service.ts:29-63` | Khoá `accountDeletionPending`, mở và cuộn tới khối | S | VANHANH-02 | admin-hopviec | Có hạn theo luật |
| E-25 | P2 | Vận hành | Đại lý báo đã trả nợ không lưu, kế toán không nhận | `dealer/dealer.service.ts:509-540`; `common/notify-admins.ts:39` | Bảng `DealerCreditPaymentReport` + thẻ việc + nút Ghi nhận | M | VANHANH-03 | admin-hopviec | Migration; race chống ghi đôi |
| E-26 | P2 | Vận hành | Ca chờ duyệt không có thẻ, sáng ra không vào ca được | `staff/attendance/attendance.service.ts:97-99`; `ops/ops-inbox.service.ts:29-63` | Khoá `shiftsPending`; số trên tab Mini | S | VANHANH-04 | admin-hopviec (+ admin-nhansu Mini) | |
| E-27 | P2 | Vận hành | "Câu hỏi chưa ai trả lời" dẫn sang Mini chỉ đọc | `apps/web/src/components/admin/community-moderation-tab.tsx:391, 404-414` | Ô trả lời ngay trong dòng + link mở bài | S | VANHANH-05 | admin-congcu | |
| E-28 | P2 | Vận hành | "Doanh thu hôm nay" = 0 với COD | `admin/admin.service.ts:856-880`; `admin-revenue.ts:16-20` | Thêm giá trị đơn đặt, đổi nhãn "Đã thu" | S | VANHANH-06 | admin-hopviec | Số cũ giữ nguyên |
| E-29 | P2 | Vận hành | Còn ô ngày giờ gốc trình duyệt (mm/dd, 12h) | `apps/web/src/app/admin/page.tsx:2675-3041`; `claim-campaign-panel.tsx:302, 305` | `VnDateInput`, `VnMonthInput`, `VnDateTimeInput` 24h | M | VANHANH-08 = R-69 | admin-don | |
| E-30 | P2 | CSKH | Trả lời CSKH chỉ là tin trong app, khách đóng app không biết | `apps/api/prisma/seed.ts:855`; `support-chat/reply-notifier.ts:51-57` | Chủ đăng ký mẫu ZNS, đặt kênh ở admin | S | CSKH-07 (R-86) | chủ | Gửi ZNS cho khách thật; điều kiện bật chat |
| E-31 | P3 | Mua hàng | "Viết đánh giá" dẫn tới SP đã gỡ (404) | Mini `order-detail.tsx:396-411`; `catalog/catalog.service.ts:393-395` | `productPublic` trong dòng đơn | S | MUAHANG-04 | api-tin | Hạ P2→P3: chỉ SP đã gỡ |
| E-32 | P3 | Mua hàng | Tin mời đánh giá có nút "Xem chi tiết đơn" | `lifecycle/review-invite.service.ts:139-145`; Mini `notifications.tsx:115-116` | `order_id` trong tin; nút "Viết đánh giá" mở form | S | MUAHANG-05 | thongbao | |
| E-33 | P3 | Mua hàng | Web không tải được video đánh giá | web `san-pham/[slug]/product-reviews.tsx:396-397`; Mini `image-upload.tsx:212-250` | Hàm Cloudinary chung ở app-core | M | MUAHANG-06, DODANG-10 | muachung | Gộp trùng |
| E-34 | P3 | Mua hàng | Đơn định kỳ hiện ghi chú tiếng Anh như lời khách | `subscriptions/subscriptions.service.ts:801`; Mini `order-detail.tsx:667-675` | Ẩn ghi chú cố định, nhãn "Đơn định kỳ", "Ưu đãi đặt định kỳ" | S | MUAHANG-07 | api-tin | Phản biện: không xoá `note` (kho/Pancake đọc) |
| E-35 | P3 | Điểm | Quà của tôi: mã không có HSD, không biết đã dùng | Mini `rewards-mine.tsx:61-72`; `loyalty.service.ts:1804-1826` | `couponEndAt`, `couponUsed`; bấm để dùng | M | DIEM-08 | diem | |
| E-36 | P3 | Điểm | Cron hết hạn điểm quét lại mọi khách từng có lô hết hạn | `loyalty/loyalty-expiry.service.ts:380-419, 429-459` | Lọc theo mốc lần chạy trước | M | DIEM-09 | api-tin | Không migration |
| E-37 | P3 | Đổi rác | "Số dư mới" là số cũ | Mini `recycle-request.tsx:155-162`, `recycle-done.tsx:34-35` | Invalidate + `refetchOnMount` | S | DOIRAC-01 | doirac | Hạ P2→P3: cờ tắt, web chỉ chớp |
| E-38 | P3 | Đổi rác | Quầy tra mã đồng nghiệp vừa duyệt ra "không tìm thấy" | `waste-exchange/receiving/waste-desk.service.ts:50-58, 134-142` | (b) Cùng điểm xem chỉ đọc | S | DOIRAC-02 | doirac | (a) chờ chủ; hạ P2→P3 vì cờ tắt |
| E-39 | P3 | Đổi rác | Lối vào quầy chỉ trong trang Đổi rác | Mini `pages/recycle.tsx:278-285` | Hàng ở Cá nhân và menu web | M | DOIRAC-04 | canhan | Hạ P2→P3: cờ tắt |
| E-40 | P3 | Đổi rác | PICKUP đã RECEIVED tô sai bước | Mini `utils/waste-labels.ts:38, 120, 185-186` | `timelineFor` chung ở app-core | S | DOIRAC-05 | doirac | |
| E-41 | P3 | Đổi rác | Quầy báo "cộng 0 điểm" | Mini `recycle-desk.tsx:251, 340`; web `recycle-desk.tsx:359` | "Lần này chưa đủ để cộng điểm" | S | DOIRAC-06 | doirac | |
| E-42 | P3 | Đổi rác | Quầy web không quét mã; thứ tự thẻ, màu nút khác Mini | web `components/recycle/recycle-desk.tsx`; Mini `recycle-desk.tsx:19, 212` | `BarcodeDetector`; thẻ hạn mức trước; nút từ chối màu cảnh báo | S/M | DOIRAC-08, R-135 | doirac | Gộp trùng |
| E-43 | P3 | CTV | Đơn đã trả hoa hồng bị trả hàng: không ai biết | `affiliate/affiliate.service.ts:1103-1120` | Cảnh báo kế toán qua `OPS_REFUND_ALERT` | S | CTV-02 | ctv | Chỉ cảnh báo; thu hồi chờ chủ |
| E-44 | P3 | Mua chung | Link mời mua chung cần đăng nhập mới thấy nhóm | `groupbuy/groupbuy.controller.ts:24-27`; web `group-buy-view.tsx:44-46` | `@Public` + `OptionalJwtAuthGuard`, ẩn mã | S | CTV-06 | muachung | Hạ P2→P3: chỉ web, Mini luôn có phiên |
| E-45 | P3 | CTV | Trả một phần cắt hoa hồng không báo CTV | `orders/order-reversal.service.ts:497-537` | `COMMISSION_REVERSED` cho phần cắt | S | CTV-07 | api-tin | |
| E-46 | P3 | CTV | Lịch sử hoa hồng 100 dòng, lệnh chuyển 50 dòng | `affiliate/affiliate.service.ts:403-408, 423-427` | Phân trang con trỏ | M | CTV-08 | ctv | Lịch chuyển giữ nguyên |
| E-47 | P3 | CTV | Nhiệm vụ đơn đầu tính cả hoa hồng REJECTED | `storefront/storefront-quest.service.ts:61-67` | Loại REJECTED | S | CTV-09 | ctv | Luật còn lại chờ chủ |
| E-48 | P3 | CTV | Mini mở gian hàng đối tác xoá mã CTV đang có | Mini `pages/storefront-view.tsx:47-49` | Phân biệt `type` như web | S | CTV-10 (a) | giohang | |
| E-49 | P3 | CTV | Sự kiện chạm luôn ghi `platform: 'miniapp'` | `affiliate/affiliate.service.ts:206-215` | Đọc header `X-Client-Platform` | S | CTV-10 (b) | ctv | Không đổi client |
| E-50 | P3 | CTV | Gian hàng đổi tên/ảnh sau duyệt không dấu vết | `storefront/storefront.service.ts:175-221` | `contentChangedAt` + lọc "Đổi sau duyệt" | M | CTV-11 | admin-nhansu | Không bắt duyệt lại; migration |
| E-51 | P3 | Vận hành | Hồ sơ khách và chi tiết đơn không dẫn qua lại | `components/admin/user-detail-drawer.tsx:134-155`; `page.tsx:1783-1849` | Lọc `userId`, nút mở đơn, "Xem hồ sơ" | M | VANHANH-07 | admin-don | Hạ P2→P3: thêm chạm, không sai dữ liệu |
| E-52 | P3 | Vận hành | Xử lý xong mà số trên thẻ đứng tới 60 giây | `order-status-actions.tsx:150-154`; `storefronts-tab.tsx:61-73` | `invalidateInbox` | S | VANHANH-09 | admin-hopviec | |
| E-53 | P3 | Vận hành | Xác nhận tiền xong câu báo biến mất | `app/admin/page.tsx:1205, 1715`; `order-status-actions.tsx:186-193` | `onPaid` + đơn kế | S | VANHANH-10 | admin-don | |
| E-54 | P3 | Vận hành | Không có chip hàng đợi chuyển khoản; URL mất lọc | `app/admin/page.tsx:390-412, 1291-1303` | URL lưu `status`, `invoice`, `queue`; chip | S | VANHANH-11 | admin-don | |
| E-55 | P3 | Vận hành | Thẻ việc không xếp theo độ gấp | `ops/ops-inbox.service.ts:88-153`; `ops-inbox-tab.tsx:106, 123-131` | `oldestAt`, sắp theo `hoursLeft` | M | VANHANH-12 | admin-hopviec | |
| E-56 | P3 | Vận hành | Số "Hôm nay" và đơn mới nhất không bấm được | `ops-inbox-tab.tsx:187-195, 211-218`; `reports-tab.tsx:11-17` | `onPress`; mốc Hôm nay/Hôm qua | S | VANHANH-13 | admin-hopviec | |
| E-57 | P3 | Vận hành | Mini thêm nhân sự không chọn được nhóm việc | Mini `pages/admin.tsx:489, 551, 620`; `staff/rbac/rbac.service.ts:82` | `RoleGrant.staffPermissions` + chip chọn nhóm | M | VANHANH-14 | admin-nhansu | Migration |
| E-58 | P3 | Vận hành | Đổi/trả và hoàn tiền không tìm theo mã đơn/SĐT | `lib/admin-client.ts:353, 1482-1485`; `customer-refunds-tab.tsx:118` | Tham số `q` + ô tìm | M | VANHANH-15 | admin-don | |
| E-59 | P3 | Vận hành | "Đã xử lý" việc Pancake không ghi lịch sử đơn | `admin/admin.service.ts:1319-1357` | `orderStatusHistory` có ghi chú | S | VANHANH-16 | admin-hopviec | |
| E-60 | P3 | Vận hành | Thẻ đơn sàn mở ra danh sách rỗng | `external-points/external-points-attention.ts:29-40`; `external-claims-tab.tsx:56` | `parts` + lọc `partial_refund` | S | VANHANH-17 | admin-hopviec | Thu hẹp; cờ tắt |
| E-61 | P3 | Kỹ thuật | Danh tính đổi mà cache vẫn số tài khoản khách | Mini `store/auth.ts:100-111, 223-226` | Invalidate khi `user.id` đổi | S | KYTHUAT-03 | phien | Hạ P2→P3: tự đúng khi rời màn |
| E-62 | P3 | Kỹ thuật | Webhook OA nhận cả sự kiện OA tự gửi; tin kẹt RECEIVED | `integrations/zalo-oa/zalo-oa-webhook.controller.ts:36-38, 57, 67, 86-90` | Lọc `user_send_*`; cron xếp lại | M | KYTHUAT-07 | hotro | Chữ ký chờ chủ |
| E-63 | P3 | Kỹ thuật | Đăng xuất Mini không thu hồi token, giữ MST | Mini `store/auth.ts:233-243`; `checkout.tsx:116, 285` | Gọi `/auth/logout`, xoá `tubu_invoice` | S | KYTHUAT-08 | phien | |
| E-64 | P3 | Đồng bộ | Quà khách mới Mini hứa giảm định kỳ | Mini `components/home/new-customer-gift.tsx:46` | Bọc cờ `SUBSCRIPTIONS_IN_MINIAPP` | S | DODANG-03 = R-157 | phien | Hạ P2→P3: một dòng chữ |
| E-65 | P3 | Đồng bộ | Web còn trang Xếp hạng cộng đồng | `apps/web/src/app/cong-dong/xep-hang/page.tsx`; `route-map.json:44` | Bỏ trang, redirect, sửa route-map | S | DODANG-04 = R-132 | dondep | Chủ đã chốt |
| E-66 | P3 | Đồng bộ | Web Vườn Xanh còn tab Cộng đồng Mini đã bỏ | web `components/game/game-tabs.tsx:6`; `vuon-xanh/page.tsx:322-345` | Cờ `GAME_SOCIAL_ON_WEB = false` | S | DODANG-05 | canhan | Quyết thay chủ, đảo ngược được |
| E-67 | P3 | Đồng bộ | Cổng parity không bắt Mini chuyển hướng | `scripts/check-platform-parity.mjs`; `route-map.json:76` | Kiểm `Navigate`; `/refill` web `/doi-rac` | M | DODANG-06 | dondep | |
| E-68 | P3 | Đồng bộ | Admin web không quản lý sự kiện cộng đồng | `components/admin/community-moderation-tab.tsx:29-33` | View "Sự kiện" dùng hàm app-core có sẵn | M | DODANG-07 = R-75 (phần còn lại) | admin-congcu | "Báo cáo (n)" đã có |
| E-69 | P3 | Đồng bộ | Bảng "Kiếm tiền" mời mọi khách vào Học viện | Mini `earn-sheet.tsx:9-13`; `account-copy.ts:36-39`; `academy-access.ts:2-6` | Lọc `canUseAcademy`, gộp hai hàm | S | DODANG-08 = R-53 | dondep | |
| E-70 | P3 | Đồng bộ | Ô Video URL Học viện không cảnh báo link Mini không phát | Mini `academy.tsx:217-233`; `page.tsx:3899-3906` | `isDirectVideoUrl` + cảnh báo | S | DODANG-09 | admin-don | |
| E-71 | P3 | Đồng bộ | Khách có gói định kỳ không xem được gói trong Mini | Mini `components/orders/orders-tabs.ts:26-34` | Tab chỉ cho khách có gói ACTIVE/PAUSED | M | DODANG-11 | thongbao | Quyết thay chủ; không lối tạo gói |
| E-72 | P3 | Đồng bộ | Không có màn thưởng/phạt và tính lại lương | `staff/payroll/admin-payroll.controller.ts:52, 83` | Hàm app-core + nút có xác nhận | M | DODANG-12 | admin-congcu | Money |
| E-73 | P3 | Đồng bộ | Trình dựng gian hàng không sắp xếp được | `storefront/storefront.controller.ts:88, 93` | Nút lên/xuống | M | DODANG-13 | ctv | |
| E-74 | P3 | Đồng bộ | Endpoint cũ không màn nào gọi | `game/game.controller.ts:49`; `loyalty/loyalty.controller.ts:69` | Xoá nếu cả bản Mini đang chạy không gọi | S | DODANG-14 | diem | `customDomain` chỉ ghi chú |
| E-75 | P3 | CSKH | Trả lời qua OA coi là thành công khi Zalo báo lỗi | `integrations/zalo-oa/zalo-oa-message.client.ts:10-13, 27-33` | Kiểm `error` trong body | S | DODANG-15 | hotro | |
| E-76 | P3 | Đồng bộ | Không có màn quản trị câu đố | `game/game-quiz.service.ts:33-59` | Controller + tab (xem, thêm, sửa) | M | DODANG-16 | admin-don | `rewardPts` 0; không xoá/tắt |
| E-77 | P3 | Đồng bộ | Cấu hình bố cục khách mới không ai đọc; comment cờ mùa sai | `system-config/public-config.ts:120`; `packages/app-core/src/features.ts:6-7` | Sửa comment và mô tả, không nối/xoá | S | DODANG-17 (R-3) | canhan | Nối hay xoá chờ chủ |
| E-78 | P3 | Đồng bộ | Mã chết | 6 file (`home-extras.tsx`, `home-section.tsx` x2, `product-picker.tsx`, `queries/payment.ts`, `queries/reviews.ts`) | Xoá sau khi `rg` | S | DODANG-18 | dondep | |
| E-79 | P3 | Đồng bộ | "Quản trị nhân sự" web mở tab Hôm nay | `apps/web/src/components/account/account-menu.ts:82` | `/admin?tab=staffRoster` | S | DODANG-19 | canhan | |
| E-80 | P3 | CSKH | Lên hạng, hạ hạng thật không có tin | `loyalty/loyalty.service.ts:358-363` | Mẫu `TIER_UPGRADED`/`TIER_DOWNGRADED` | M | CSKH-03 | chủ | Gửi tin mới cho khách thật và câu quyền lợi: chủ duyệt |
| E-81 | P3 | CSKH | Nhắc giờ vàng và mua chung thành công về sai chỗ | `flash-sale/flash-sale.service.ts:645, 667`; `groupbuy/groupbuy.service.ts:240-241` | Thêm `product_slug`, nút tới SP | S | CSKH-04 | thongbao (+ muachung API) | Hạ P2→P3: thêm chạm |
| E-82 | P3 | CSKH | Đọc chat xong chuông vẫn báo | `support-chat/support-chat.service.ts:196-235` | Đánh dấu log chuông READ + invalidate | S | CSKH-08 | hotro | |
| E-83 | P3 | CSKH | Mini lùi 3 lần sau khi mở tin | Mini `notifications.tsx:205-215, 242-246` | `navigate(..., { replace: true })` | S | CSKH-09 | thongbao | |
| E-84 | P3 | CSKH | Chỉ 50 tin; đếm chưa đọc tải cả danh sách | `notifications/notifications.service.ts:327-333` | `before/beforeId/limit`; `GET /me/notifications/unread-count` | M | CSKH-10 (a), R-112 (phân trang) | thongbao | Giữ dạng mảng cho client cũ |
| E-85 | P3 | CSKH | Tin "Đã giao, cộng X điểm" có thể mất | `orders/order-status.service.ts:416, 476-478, 522-531` | Gửi trong `runDeliveredEffects` với dedupe | S | CSKH-11 | api-tin | |
| E-86 | P3 | CSKH | ZNS báo trước hạ hạng không gửi lại sau FAILED | `notifications.service.ts:112-118, 228-242` | Lọc trạng thái + nhả claim khi `queue.add` lỗi | S | CSKH-12, R-170 | api-tin | Gộp trùng |
| E-87 | P3 | CSKH | Nhiều loại tin tiêu đề chung "Thông báo" | Mini `notifications.tsx:37-71`; web `notification-view.ts:12-39` | Nhãn theo loại | S | CSKH-13, R-112 (tiêu đề) | thongbao | Giữ emoji |
| E-88 | P3 | CSKH | Tin xác nhận chuyển khoản không nói đã nhận tiền | `orders/order-status.service.ts:733-735`; `seed.ts:762` | Biến `payment_note` + sửa thân mẫu | S | CSKH-14 | chủ | Sửa mẫu tin khách thật (có thể ZNS đã duyệt): chủ |
| E-89 | P3 | CSKH | Sự kiện cộng đồng Mini không nói cách tham gia | Mini `pages/community-events.tsx:47-56, 267` | Câu cách tham gia, điểm thành dòng phụ, không link | S | CSKH-15, R-133 | thongbao | Quyết thay chủ (phương án b) |
| E-90 | P3 | CSKH | Cảnh báo cầu nối Zalo chỉ tới ADMIN | `support-chat/bridge-health.cron.ts:124, 147`; `common/notify-admins.ts:40` | `audience: 'admins+cskh'` | S | CSKH-16 | thongbao | Mặc định giữ cũ |
| E-91 | P3 | Cá nhân | Cá nhân gọi 19 API, 3 lần chỉ để đếm đơn | Mini `pages/profile.tsx:100-101, 113`; web `tai-khoan/page.tsx:108` | `GET /orders/status-counts` + đếm chưa đọc | M | R-114, CSKH-10 (b) | canhan | Sau thongbao |
| E-92 | P3 | Trang chủ | "Gợi ý cho bạn" rỗng vẫn hiện | Mini, web `components/home/suggest-feed.tsx` | Ẩn khối khi rỗng | S | R-92 | giaodien | |
| E-93 | P3 | Đăng nhập | Trang đăng nhập web không logo, không lợi ích | `apps/web/src/app/dang-nhap/**` | Logo, dòng lợi ích từ cấu hình, skeleton | S | R-93 | giaodien | |
| E-94 | P3 | Thanh đáy | Nhãn tab web 12px, nhãn giữa lệch | web `components/bottom-nav.tsx` | Cỡ caption token | S | R-94 | giaodien | |
| E-95 | P3 | Thanh đáy | Mini bấm lại tab đang mở không làm gì | Mini `components/bottom-nav.tsx:24-28` | Cuộn về đầu | S | R-95 | giaodien | |
| E-96 | P3 | Mua hàng | Trang SP web khác Mini | ảnh `screens/web375/product-slug__returning__web375__s2.png` | Theo kiểu Mini | M | R-98 | muachung | |
| E-97 | P3 | Mua hàng | Giỏ rỗng web không có gợi ý | web `app/gio-hang/page.tsx` | Dải gợi ý như Mini | S | R-99 | giohang | |
| E-98 | P3 | Mua hàng | Yêu thích thiếu nút giỏ nhanh | Mini `pages/wishlist.tsx`; web `tai-khoan/yeu-thich` | Nút giỏ nhỏ + tấm phân loại có sẵn | M | R-100 (phần còn lại) | giaodien | Nhãn giảm giá Mini đã có |
| E-99 | P3 | Mua hàng | "(đã giảm)" hiện cả khi không giảm | Mini, web giỏ | Chỉ hiện khi có giảm | S | R-101 | giohang | |
| E-100 | P3 | Mua chung | Câu mua chung khó hiểu | `packages/app-core/src/group-buy-copy.ts:38` | Tách hai ý | S | R-102 | muachung | Chỉ cách nói |
| E-101 | P3 | Mọi màn | Mini ở khổ rộng không giới hạn | ảnh `screens/mini1280/*` | `max-width: 480px` bằng CSS | S | R-106 | giaodien | Quyết thay chủ |
| E-102 | P3 | Vườn | Vườn luôn ghi "Cây Dứa Fuwa3e" | `garden-hero.tsx` (hai nền) | Loài thật hoặc "Cây của bạn" | S | R-121 | diem | |
| E-103 | P3 | Điểm | Trang Hạng dài, mã ở 3 chỗ | Mini `pages/loyalty.tsx`; web `diem-xanh/page.tsx` | Một dòng "Ví mã (n) ›" | S | R-122 | diem | Quyết thay chủ |
| E-104 | P3 | Điểm | Quét điểm: mã hợp lệ vẫn nút phụ | Mini `pages/external-points.tsx` | Nút chính khi hợp lệ | S | R-125 | diem | |
| E-105 | P3 | CSKH | Nút phụ AI/chat khác kiểu hai nền | ảnh `screens/*/ai-advisor__returning__*` | Một kiểu theo token | S | R-130 | hotro | |
| E-106 | P3 | CSKH | Web 1280: dải chip chat trong băng trắng | ảnh `screens/web1280/chat__returning__web1280__s1.png` | Cùng nền khung chat | S | R-131 (phần còn lại) | hotro | Trang AI đã `max-w-2xl` |
| E-107 | P3 | Lỗi chung | "Gọi <số>" xuống dòng | Mini `components/support-hotline.tsx` | `nowrap` | S | R-134 | giaodien | |
| E-108 | P3 | CTV | Trình dựng gian hàng: nút khó hiểu | `vi.storefront`; Mini `storefront-builder.tsx` | Đổi nhãn, gom menu ⋯, Hành trình lên đầu | S | R-136 | ctv | |
| E-109 | P3 | Nhãn hàng | Web 375 tràn cột, ô ngày không nhãn, nút sai đích | `apps/web/src/app/chu-thuong-hieu/**` | Lưới, nhãn, "Liên hệ Tubu" | S | R-138 | ctv | |
| E-110 | P3 | CTV | Lệch nhỏ web 375 so Mini | ảnh `screens/pairs/storefront.png` | Theo Mini từng mục | M | R-140 | ctv | |
| E-111 | P3 | Đại lý | Màu đại lý ngoài design-tokens | `css/dealer-theme.css` (hai app) | Theme `dealer` trong design-tokens | S | R-143 (phần còn lại) | ctv | |
| E-112 | P3 | Vận hành | Tab Chat CSKH 375 khó dùng | `components/admin/support-chat-tab.tsx` | Dòng trạng thái + ngăn kéo | S | R-150 | admin-congcu | |
| E-113 | P3 | Vận hành | Mini nhân sự dùng `window.confirm` | Mini `pages/admin.tsx` | ConfirmSheet chung | S | R-151 | admin-nhansu | |
| E-114 | P3 | Kỹ thuật | E2E web chập chờn trước hydrate | B-130 | `data-hydrated` + helper chờ | M | R-152 | dondep | |
| E-115 | P3 | Thẻ SP | Nhãn "Mới" chưa đúng nghĩa | `packages/app-core/src/api/catalog.ts:10` | `createdAt` + trong 30 ngày | M | R-153 | giaodien | Quyết thay chủ (30 ngày) |
| E-116 | P3 | Giờ vàng | Mini hai đồng hồ máy chủ; PDP không lọc suất hết | Mini `utils/server-clock.ts`; `packages/app-core/src/server-clock.ts` | Re-export app-core; lọc `endAt` | M | R-154 | muachung | |
| E-117 | P3 | Mã giảm | Xem trước mã chỉ 50 mã đầu theo id | `checkout/checkout.service.ts:955`; `coupons/coupons.service.ts:192` | Mã riêng trước khi cắt | S | R-155 | diem | |
| E-118 | P3 | Vận hành | Ô ngày: nhắc che nút, không giải thích, báo đỏ khi gõ | `components/admin/vn-date-input.tsx:69, 77, 107, 141, 146`; `page.tsx:2478` | Nhắc trong luồng; câu riêng; đặt lại `touched` | S | R-167, R-168, R-169 | admin-don | |
| E-119 | P3 | Điểm | "Còn thiếu để giữ hạng" lệch khung lượt hạ hạng | `loyalty/loyalty.service.ts:642-651` | `since` theo lượt 03:15 | S | R-171 | diem | Không đổi luật |
| E-120 | P3 | Chi tiết đơn | Ảnh "Dự kiến giao" chụp trước bản sửa | `docs/2026-10-28-review/reviews/taikhoan-c.md` | Chụp lại khi tích hợp | S | R-172 | tích hợp | Không cần gói |
| E-121 | P3 | Trang chủ | Phiên lỗi giữ khung chờ 4,5 giây | web `home-view.tsx:86, 94`; `use-home-settling.ts:16` | Thả ngay khi phiên lỗi | S | R-173 | canhan | |
| E-122 | P3 | Trang chủ | Nội dung đã dựng bị thay bằng khung chờ | web `use-home-settling.ts:11-13` | Giữ nội dung khách mới | S | R-174 | canhan | |
| E-123 | P3 | Trang chủ | Thiếu test cấp trang cho khung chờ | Mini `pages/home.spec.tsx:40` | Test lỗi + giờ giả | S | R-175 | canhan | |
| E-124 | P3 | Trang chủ | Chiều cao khung chờ viết tay | Mini `home-settling.tsx:9-12` | Hằng chung app-core | S | R-176 | canhan | |
| E-125 | P3 | Điểm | Nhả điểm đơn sàn/chat giữ một transaction ngoài tới 10 phút chỉ để giữ khoá | `apps/api/src/modules/external-points/external-claim-release.ts:233-297` (`pg_try_advisory_xact_lock` + `timeout: 10 * 60_000`) | Khoá có hạn không giữ kết nối (helper chung cho mọi cron) | M | DIEM-10 | sau | Cờ đơn sàn tắt; cùng mẫu khoá ở 10 cron khác (`merchant-sla.cron.ts:57`, `pending-payment-expiry.cron.ts:70`…), sửa riêng một chỗ không đáng; làm chung khi bật cờ |
| E-126 | P3 | Đổi rác | Quà hiện vật đổi rác quá hạn nhận vẫn READY mãi, vẫn trao được | `waste-exchange/catalog/waste-gift-redemptions.service.ts:144, 150-162`; `core/waste-queue-filters.ts:44` | Chủ chốt luật: quá hạn tự huỷ + hoàn điểm, hay vẫn cho nhận | M | DIEM-11 | chủ | Luật điểm và thể lệ; cờ waste tắt |
| E-127 | P3 | Đổi rác | Quầy điểm đối tác mặc định "đã nhận" cả món chỉ kho HCMC nhận, duyệt ra 409 | `waste-exchange/receiving/waste-confirm.service.ts:69, 130-133`; `receiving/waste-desk.service.ts:128, 156` | `warehouseOnly` trong DTO quầy, mặc định 0 ở điểm PARTNER | S | DOIRAC-07 | doirac | |
| E-128 | P3 | Đổi rác | Phiên bản đồng ý thể lệ gắn cứng `'2026-10-17.1'` dù admin sửa được thể lệ | `waste-exchange/customer/waste-requests.service.ts:260`; `waste.constants.ts:2` | Chủ chọn cách đánh phiên bản thể lệ (hash nội dung hay số phiên bản) | S | DOIRAC-09 | chủ | Chứng cứ pháp lý về thể lệ |

## Gói

16 gói (120 mục), mỗi gói một worker Sonnet, một worktree. Gói có "chạy sau" chỉ bắt đầu khi gói kia xong và gộp nhánh đó.

| Gói | Mục | money | migration | Chạy sau |
|---|---|---|---|---|
| giohang | E-6, E-7, E-8, E-10, E-48, E-97, E-99 | có | không | |
| muachung | E-9, E-11 (Mini mua chung), E-33, E-44, E-81 (API groupbuy), E-96, E-100, E-116 | có | không | |
| thongbao | E-4, E-5, E-32, E-71, E-81, E-83, E-84, E-87, E-89, E-90 | không | không | |
| canhan | E-19, E-21, E-39, E-66, E-77, E-79, E-91, E-121, E-122, E-123, E-124 | không | không | thongbao |
| api-tin | E-3, E-16, E-31, E-34, E-36, E-45, E-85, E-86 | có | không | |
| diem | E-16 (dòng 442), E-17, E-18, E-20, E-35, E-74, E-102, E-103, E-104, E-117, E-119 | có | không | |
| ctv | E-11, E-43, E-46, E-47, E-49, E-73, E-108, E-109, E-110, E-111 | có | không | |
| doirac | E-22, E-37, E-38, E-40, E-41, E-42, E-127 | không | có (chèn mẫu tin) | |
| phien | E-12, E-13, E-14, E-61, E-63, E-64 | có (xác thực) | không | |
| hotro | E-15, E-23, E-62, E-75, E-82, E-105, E-106 | không | không | |
| admin-hopviec | E-1, E-24, E-25, E-26, E-28, E-52, E-55, E-56, E-59, E-60 | có | có | |
| admin-don | E-29, E-51, E-53, E-54, E-58, E-70, E-76, E-118 | không | không | admin-hopviec, api-tin |
| admin-nhansu | E-26 (Mini), E-50, E-57, E-113 | không | có | admin-hopviec |
| admin-congcu | E-27, E-68, E-72, E-112 | có (lương) | không | |
| dondep | E-65, E-67, E-69, E-78, E-114 | không | không | |
| giaodien | E-92, E-93, E-94, E-95, E-98, E-101, E-107, E-115 | không | không | |

Bản đồ file nào gói nào được sửa nằm cuối mỗi file `goi/<gói>.md` (giống nhau ở mọi gói).

File dùng chung bắt buộc:
- `schema.prisma`: admin-hopviec, rồi admin-nhansu. doirac chỉ thêm migration chèn dữ liệu, không đổi schema.
- Mini `components/app.tsx`: giohang.
- `route-map.json`: dondep.
- Client API app-core: mỗi file `packages/app-core/src/api/*.ts` một gói giữ (account: thongbao rồi canhan; orders: api-tin; loyalty: diem; storefront và affiliate: ctv; groupbuy: muachung; staff: admin-nhansu; payroll và feed: admin-congcu).
- Admin `page.tsx`, `admin-client.ts`: admin-hopviec, rồi admin-don.
- `seed.ts`, `notification-variables.ts`: doirac.
- Mini `i18n/vi.ts`: ctv.

## Thứ tự gộp gợi ý

1. Gộp các gói độc lập theo thứ tự rủi ro thấp trước: dondep, giaodien, hotro, doirac, phien, api-tin, diem, ctv, giohang, muachung, thongbao, admin-congcu, admin-hopviec.
2. Rồi canhan (sau thongbao), admin-nhansu và admin-don (sau admin-hopviec; admin-don sau cả api-tin).
3. Bước tích hợp: chạy `pnpm lint:parity`, gate đầy đủ, Playwright cả hai nền; chụp lại ảnh đơn CONFIRMED/SHIPPING (E-120) và ảnh `state-coupon-chua-ap-dung` (R-169).

## Chuyển tiếp sau đợt P3 (gói ctv)

- Web 375: `ui.field` (`apps/web/src/lib/guest-ui.ts`, `min-h-11`) cao 44px so Mini 50px; cỡ chữ `ui.btn*` lệch Mini. Là thành phần dùng chung toàn web nên cần một gói giao diện web dùng chung, có thể thêm hằng kiểu phone vào `apps/web/src/lib/phone-ui.ts` như `phoneSectionTitle`. Đợt P3 chưa sửa mã phần này.
