# 00 — Ma trận tương đương Mini App ↔ web

Nguồn: `apps/miniapp/src/components/app.tsx:189-245` trên `web/base` db9adca0, cùng 5 báo cáo khảo sát ở `khao-sat/` (báo cáo của agent quét, chưa kiểm từng dòng; lane phải đọc lại code trước khi làm).

Quy ước route web: theo đường dẫn tiếng Việt đang dùng (`/san-pham`, `/gio-hang`, `/thanh-toan`, `/tai-khoan/...`). Đường dẫn kiểu Mini App (ví dụ `/browse`, `/feed/:id`) được chuyển hướng 307 sang route web, để link chia sẻ từ Mini App mở được trên web (như `/product/[slug]/route.ts` đang làm).

Trạng thái: **có** = web đã đủ; **thiếu** = web có route nhưng thiếu chức năng con; **mới** = web chưa có; **skip** = cố ý không làm trên web (kèm lý do).

Riêng tư = cần đăng nhập, thêm vào `PRIVATE_PATHS` (`apps/web/src/lib/site.ts:16`), `noindex`. Công khai = SSR/ISR + metadata, vào sitemap khi nội dung công khai.

| # | Mini App | File | Web hiện có | Web đích | TT | Lane | Loại | Ghi chú nền tảng |
|---|---|---|---|---|---|---|---|---|
| 1 | `/` | home.tsx | `/` hiện là **trang danh mục + tìm kiếm** (`app/page.tsx:27-75`: `q`, `category`, `brand`, phân trang, canonical) | `/` | thiếu | shop | công khai | `/` thành trang chủ như Mini App: mua lại, đơn đang giao, flash sale (đang và sắp tới), "Dành cho bạn", bán chạy, danh mục, đã xem gần đây, nổi bật, hàng mới, quà khách mới, bố cục theo khách mới/cũ (cờ `homeNewCustomerLayout`). Pull-to-refresh không cần trên web |
| 2 | `/browse` | browse.tsx | nằm trong `/` | `/san-pham` | mới | shop | công khai (`noindex` khi có `q`) | Chuyển danh mục từ `/` sang. `/?q=`, `/?category=`, `/?brand=` chuyển hướng 307 sang `/san-pham` cùng query (URL đã được index). Sửa `components/site-search.tsx` (đang đẩy `/?q=`) và `lib/home-seo.ts`. Thêm gợi ý tìm kiếm, tìm gần đây, bộ lọc, sắp xếp, tải thêm, sự kiện tìm kiếm |
| 3 | `/product/:slug` | product-detail.tsx | `/san-pham/[slug]` | giữ | thiếu | shop | công khai | Thiếu (kiểm lại): mã giảm giá theo sản phẩm, dòng freeship, đơn vị giao, đặt định kỳ, mua chung, content kit, tim yêu thích, mua kèm, liên quan, chat OA (`zalo.me`) |
| 4 | `/cart` | cart.tsx | `/gio-hang` | giữ | thiếu | order | riêng tư | Kiểm: voucher sheet, hoàn tác xoá, nhóm theo đơn vị giao, thanh ngữ cảnh gian hàng |
| 5 | `/checkout` | checkout.tsx | `/thanh-toan` | giữ | thiếu | order | riêng tư | Bỏ `ensurePhone` (Q2; Mini App cũng không chặn). Phương thức: COD, chuyển khoản, ví (Q4; ZaloPay đang ẩn ở cả Mini App). Kiểm: hóa đơn VAT, chia kiện, cảnh báo đổi giá, gắn phiếu đổi rác |
| 6 | `/bank-payment/:code` | bank-payment.tsx | panel trong `/thanh-toan` | `/thanh-toan/chuyen-khoan/[code]` | mới | order | riêng tư | Dùng lại `bank-transfer-panel.tsx`; dò 4 giây tới khi PAID |
| 7 | `/orders` (+`/subscriptions`) | orders.tsx | `OrdersSection` trong `/tai-khoan` | `/tai-khoan/don-hang` | mới | order | riêng tư | 7 tab gồm "Định kỳ" (`?tab=subscriptions`), mua lại, gợi ý khách mới |
| 8 | `/order/:code` | order-detail.tsx | `/tai-khoan/don-hang/[code]` | giữ | thiếu | order | riêng tư | Kiểm: đánh giá từng món, phiếu đổi rác, mua lại, nơi nhận hoàn tiền. Lời mời theo dõi OA dùng link `zalo.me` |
| 9 | `/addresses` | addresses.tsx | `/tai-khoan/dia-chi` | giữ | thiếu | order | riêng tư | Kiểm: đặt mặc định, sửa, xoá có xác nhận |
| 10 | `/wishlist` | wishlist.tsx | — | `/tai-khoan/yeu-thich` | mới | shop | riêng tư | |
| 11 | `/group-buy`, `/group-buy/:id` | group-buy.tsx | — | `/mua-chung`, `/mua-chung/[id]` | mới | shop | công khai | Tham gia cần đăng nhập |
| 12 | `/brand/:slug` | brand-view.tsx | `/brand/[slug]` | giữ | thiếu | shop | công khai | Thiếu: theo dõi nhãn, chia sẻ kiếm tiền, nút đại lý |
| 13 | `/brand-story` | brand-story.tsx | — | `/cau-chuyen` | mới | shop | công khai | Bản đồ SVG tĩnh |
| 14 | `/s/:slug` | storefront-view.tsx | `/s/[slug]` | giữ | thiếu | affiliate | công khai | Chủ gian hàng thấy nút "thêm sản phẩm" |
| 15 | `/about` | about.tsx | — (có `/chinh-sach/[loai]`) | `/gioi-thieu` | mới | account | công khai | FAQ, liên hệ (`tel:`, email, OA), chính sách, xoá tài khoản, đăng xuất |
| 16 | `*` | not-found.tsx | `not-found.tsx` | giữ | có | — | — | |
| 17 | `/profile` | profile.tsx | `/tai-khoan` | giữ | thiếu | account | riêng tư | Hub: lối tắt điểm/ví/mã, menu theo vai trò (STAFF/ADMIN, chủ nhãn, đại lý, CTV), cờ `aiAdvisorEnabled`, `CASHBACK_ENABLED`, `marketplaceClaimEnabled` |
| 18 | `/edit-profile` | edit-profile.tsx | khối sửa tên trong `/tai-khoan` | `/tai-khoan/ho-so` | mới | account | riêng tư | Thêm email, ngày sinh, ảnh đại diện (Cloudinary + crop). SĐT chỉ đọc |
| 19 | `/settings` | settings.tsx | — | `/tai-khoan/cai-dat` | mới | account | riêng tư | Thông báo (server), cỡ chữ (localStorage). Theo dõi OA = link `zalo.me`; xin quyền gửi thông báo Zalo không có trên web. Không chép đồng bộ `tubu_prefs` cũ |
| 20 | `/notifications` | notifications.tsx | — | `/tai-khoan/thong-bao` | mới | account | riêng tư | Link hành động trỏ sang route web tương ứng |
| 21 | `/loyalty` | loyalty.tsx | `/tai-khoan/diem-xanh` (một phần) | giữ | thiếu | loyalty | riêng tư | Điểm danh, thẻ thành viên QR, mã giảm giá, hạng, lịch sử. **Điểm: 2 lượt review** |
| 22 | `/wallet` | wallet.tsx | `/tai-khoan/vi-tubu` (một phần) | giữ | thiếu | loyalty | riêng tư | Rút tiền (idempotency, phí/mức tối thiểu), giới thiệu bạn, lịch sử. **Tiền: 2 lượt review** |
| 23 | `/rewards` | rewards.tsx | — | `/kho-qua` | mới | loyalty | riêng tư | Đổi điểm lấy quà. **Điểm: 2 lượt review** |
| 24 | `/rewards/mine` | rewards-mine.tsx | — | `/kho-qua/cua-toi` | mới | loyalty | riêng tư | QR mã quà |
| 25 | `/refill` | refill.tsx | — | `/doi-vo` | mới | loyalty | riêng tư | Trả vỏ, idempotency |
| 26 | `/cashback` | cashback.tsx | — | `/hoan-tien` | mới | loyalty | công khai một phần | Giữ cờ `CASHBACK_ENABLED` (đang tắt). `openAffiliateLink` thành mở tab mới |
| 27 | `/points/scan` | external-points.tsx | — | — | skip | — | — | Q2: quét mã đơn sàn chỉ ở Mini App (cần SĐT đã xác minh và máy quét QR). Web không có route; hub tài khoản trên web hiện lời dặn mở Mini App khi cờ bật |
| 28 | `/game` | game.tsx | — | `/vuon-xanh` | mới | game | riêng tư | Lớn nhất (103 test). Không dùng Zalo SDK |
| 29 | `/feed` | feed.tsx | — | `/cong-dong` | mới | community | công khai một phần | Khách: bản xem trước công khai |
| 30 | `/feed/:id` | post-detail.tsx | — | `/cong-dong/[id]` | mới | community | riêng tư (Mini App bắt đăng nhập) | |
| 31 | `/feed/events` | community-events.tsx | — | `/cong-dong/su-kien` | mới | community | riêng tư | |
| 32 | `/feed/leaderboard` | community-leaderboard.tsx | — | `/cong-dong/xep-hang` | mới | community | riêng tư | |
| 33 | `/academy`, `/academy/:courseId` | academy.tsx | — | `/hoc-vien`, `/hoc-vien/[courseId]` | mới | community | công khai | Hoàn thành bài cần đăng nhập |
| 34 | `/ai-advisor` | ai-advisor.tsx | — | `/tu-van` | mới | ai | riêng tư | Cờ `aiAdvisorEnabled` |
| 35 | `/affiliate` | affiliate.tsx | — | `/ctv` | mới | affiliate | riêng tư | Đăng ký CTV, link, hoa hồng, rút, thuế, mốc thưởng, lên đơn hộ. **Tiền: 2 lượt review** |
| 36 | `/storefront` | storefront-builder.tsx | — | `/ctv/gian-hang` | mới | affiliate | riêng tư | Không lẫn với cổng `/merchant` |
| 37 | `/dealer` | dealer.tsx | — | `/dai-ly` | mới | pro | riêng tư | Bảng giá, đơn, công nợ, báo cáo, thưởng. **Tiền: 2 lượt review** |
| 38 | `/staff` | staff.tsx | — | `/nhan-vien` | mới | pro | riêng tư | Chấm công cần token vị trí Zalo (`attendance-api.ts:51`). Web: quản lý ca, xem trạng thái; vào/ra ca hiện lời dặn dùng Mini App. Không thêm đường chấm công bằng toạ độ trình duyệt (liên quan lương) |
| 39 | `/my-payroll` | my-payroll.tsx | — | `/nhan-vien/bang-luong` | mới | pro | riêng tư | Sửa tài khoản ngân hàng nhận lương. **Tiền: 2 lượt review** |
| 40 | `/brand-owner` | brand-owner.tsx (+ brand-owner-sales.tsx) | — | `/chu-thuong-hieu` | mới | pro | riêng tư | |
| 41 | `/admin` | admin.tsx | `/admin` (nhiều tab, có "Chấm công") | `/admin?tab=...` | thiếu | pro | riêng tư | Thiếu: nhân sự (cấp/thu quyền), duyệt ca, mẫu ca, lương, sửa phiên công, duyệt đổi vỏ. Kiểm tab đã có trước khi làm |
| 42 | `/admin/community` | community-moderation.tsx | tab community trong `/admin` | `/admin?tab=community` | có | — | riêng tư | Chỉ cần ánh xạ |
| 43 | `/recycle` | recycle.tsx | — | `/doi-rac` | mới | recycle | riêng tư | `eligibility !== 'OK'` (thiếu SĐT) thì hiện lời dặn mở Mini App (Q2) |
| 44 | `/recycle/rules` | recycle-rules.tsx | — | `/doi-rac/quy-dinh` | mới | recycle | công khai | |
| 45 | `/recycle/new` | recycle-new.tsx | — | `/doi-rac/tao` | mới | recycle | riêng tư | "Điểm gần tôi" cần token vị trí Zalo (`waste-customer.controller.ts:34`). Web đợt này: chỉ chọn theo tỉnh. Lý do: `next.config.mjs:80` đặt `Permissions-Policy: geolocation=()` cho mọi trang; mở ra là đổi header bảo mật, để chủ quyết |
| 46 | `/recycle/points` | recycle-points.tsx | — | `/doi-rac/diem-nhan` | mới | recycle | riêng tư | Như dòng 45 |
| 47 | `/recycle/r/:id` | recycle-request.tsx | — | `/doi-rac/yeu-cau/[id]` | mới | recycle | riêng tư | |
| 48 | `/recycle/r/:id/edit` | recycle-edit.tsx | — | `/doi-rac/yeu-cau/[id]/sua` | mới | recycle | riêng tư | |
| 49 | `/recycle/requests` | recycle-requests.tsx | — | `/doi-rac/yeu-cau` | mới | recycle | riêng tư | |
| 50 | `/recycle/done/:id` | recycle-done.tsx | — | `/doi-rac/xong/[id]` | mới | recycle | riêng tư | |
| 51 | `/recycle/desk` | recycle-desk.tsx | — | `/doi-rac/quay` | mới | recycle | riêng tư | Quầy nhận: nhập mã tay (Mini App cũng không quét) |

Chức năng mức ứng dụng (không phải `<Route>`, gắn trong `app.tsx`):

| # | Mini App | Web hiện có | Web đích | TT | Lane | Ghi chú |
|---|---|---|---|---|---|---|
| 52 | `CouponClaimGate` (`app.tsx:253`): `?claim=` → `POST /coupons/claim` | — | `components/app-gates.tsx` | mới | account | **Tiền: 2 lượt review** |
| 53 | `OnboardingGate` (`app.tsx:252`) | — | `components/app-gates.tsx` | mới | account | |
| 54 | `?s=` ghi nguồn gian hàng (`app.tsx:158-171`, `recordReferralTouch`) | `ReferralCapture` chỉ đọc `?ref=` (`components/storefront-tracker.tsx:45-58`) | `storefront-tracker.tsx` | thiếu | core | Ảnh hưởng hoa hồng CTV. **2 lượt review** |

Tổng: 54 dòng (51 nhóm route + 3 chức năng mức ứng dụng). `app.tsx` có 53 `<Route path>` (không tính `*`); `route-map.json` có đúng 53 dòng route, mỗi `<Route>` một dòng (`/group-buy` và `/group-buy/:id`, `/academy` và `/academy/:courseId`, `/subscriptions` tách riêng). Map theo route, không theo file: `brand-owner-sales.tsx` là tab trong `/brand-owner`.

Web có mà Mini App không có (giữ nguyên, không thuộc đợt này): `/merchant`, `/admin/pos`, `/chinh-sach/[loai]`, `/dang-nhap`.

## Khả năng riêng của Zalo dùng trong các màn

| zmp-sdk / bridge | Màn dùng | Cách làm trên web |
|---|---|---|
| `getAccessToken`, `login` | mọi màn cần đăng nhập | Zalo OAuth có sẵn (`auth-context.tsx`) |
| `getPhoneNumber`, `ensurePhone` | checkout (không chặn), recycle hub | Không có (Q2) |
| `getLocation` (token) | staff vào/ra ca, recycle điểm gần | Staff: không. Recycle: toạ độ trình duyệt nếu thêm endpoint |
| `scanQRCode` | points/scan | Không (màn skip) |
| `openShareSheet` | sản phẩm, mua chung, ví, CTV, gian hàng, nhãn | Web Share API, dự phòng chép link (`share-button.tsx`) |
| `openChat`, `followOA` | sản phẩm, đơn, giới thiệu, cài đặt | Link `https://zalo.me/<OA id>` |
| `requestSendNotification` | cài đặt | Không có trên web |
| `openPhone` | giới thiệu, đổi vỏ | `tel:` |
| `openWebview` | đơn (tra vận đơn, hoá đơn), cashback | Mở tab mới |
| `getStorage`, `setStorage` | cài đặt, lời mời OA | `localStorage` bọc try/catch |
