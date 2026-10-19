# D5 — UI/UX đã hoàn thiện 100% chưa (đọc mã tĩnh)

Nhánh D5, launch review 2026-10-18. Chỉ đọc mã ở worktree `launch-review` (cùng cây main 0cc2fe62). Không chạy test, build, Playwright; chưa xem ảnh thật (bước khác làm). Đường dẫn tính từ `apps/` trừ khi ghi khác. Mọi chỗ không đọc được ghi "chưa kiểm".

## 1. Tóm tắt

- **Mức hoàn thiện UI/UX ước tính: khoảng 88–90%.** Không có màn placeholder. Không có link chết. Không còn `TODO/FIXME/lorem/coming soon` trong mã UI (grep không ra). Mini-app 45 route và web 19 trang đều có trạng thái tải-lỗi-rỗng ở các luồng chính. Cả hai nền đã dùng token DS v2.
- Báo cáo cũ `docs/2026-10-review/04-uiux.md` (40 mục) gần như đã xử lý hết: DS v2 xong cả miniapp lẫn web, không còn `user-scalable=no` (`miniapp/index.html:7`), `Chip` đã đạt 44px nhờ `.tubu-hit-44` (`components/ui/chip.tsx:20`), `ui/primitives.tsx` đã xoá, `Button` đã khoá bấm đúp bằng `useRef` (`components/ui/button.tsx:59`), hotline giả đã thay bằng cấu hình (`pages/about-data.ts:58`). Chỉ còn 2 mục cũ mở (mục 5).
- **Lỗ hổng 1: pháp lý và đồng ý sử dụng.** Web không có trang điều khoản, bảo mật hay đổi trả nào (`find apps/web/src/app` không có route chính sách); chân trang chỉ có hotline và email (`web/src/components/site-footer.tsx:10-36`); đăng nhập không có link điều khoản (`web/src/app/dang-nhap/page.tsx:56`). Mini-app chỉ có 3 đoạn văn ngắn trong `pages/about.tsx:26-40`. Ra mắt công khai mà thiếu là rủi ro pháp lý và mất tin cậy.
- **Lỗ hổng 2: web chưa phải kênh "kéo khách sàn về mua" đủ tốt.** Trang sản phẩm chỉ có "Thêm vào giỏ" (`web/src/components/add-to-cart.tsx:237`), không "Mua ngay", không thanh CTA dính, không chia sẻ; trang gian hàng và nhãn thiếu trạng thái rỗng; QR chuyển khoản chưa có lưu ảnh hay mở app ngân hàng, nút sao chép của miniapp chỉ 15px (`pages/bank-payment.tsx:239`).
- **Lỗ hổng 3: admin Config là danh sách JSON thô** cho khoảng 125 khoá (`web/src/components/admin/config-item.tsx:51`), không tìm kiếm, không nhóm, không form theo kiểu. Nhân sự đổi giá hay ngưỡng phải biết tên khoá và sửa JSON, dễ sai, và là một lý do việc vẫn làm ngoài hệ thống (mục tiêu 5).
- Phần còn lại là việc nhỏ: số cứng trong chữ (vd. "45%", "24 giờ", "199.000đ" lệch khi admin đổi cấu hình), CTA bị mờ không nói lý do ở vài màn, trợ lý AI thiếu cuộn và Enter-gửi, chữ không đồng nhất (hủy/huỷ, `...`/`…`, Copy/Sao chép).
- **Tuyên bố thương hiệu cần chủ dự án xác nhận** ("100% Thuần Chay", "100% Nguyên bản Việt Nam": `web/src/app/page.tsx:58,94`).
- Cần chủ dự án quyết 6 câu (mục 6). Top 15 việc ở mục 5, trong đó 5 việc chạm file đang bị phiên đổi-rác sửa.

## 2. Bảng phát hiện

Quy ước: "RC" = file nằm trong danh sách phiên đổi-rác sửa (`app/admin/page.tsx`, `engagement-tab`, checkout, `components/app.tsx`, loyalty, game, refill): nên gộp sau khi phiên đó merge để tránh xung đột.

| ID | Mức | Vai trò | Hiện trạng + bằng chứng | Đề xuất | Công sức | Chủ dự án quyết? |
|---|---|---|---|---|---|---|
| D5-01 | P1 | khách, kế toán | Web không có trang điều khoản/bảo mật/đổi trả (liệt kê route: không có). Chân trang chỉ hotline+email (`web/src/components/site-footer.tsx:10-36`). Đăng nhập chỉ nói "Đăng nhập để mua sắm…" không link điều khoản (`web/src/app/dang-nhap/page.tsx:56`). Mini-app: 3 đoạn văn ngắn (`miniapp/src/pages/about.tsx:26-40`), chính sách đổi trả nói hoàn về Ví Tubu; version "1.0.0" cứng (`about.tsx:280`). Không có đoạn đồng ý ở thanh toán web hay miniapp (grep "điều khoản\|chính sách" chỉ ra comment) | Trang `/chinh-sach/[slug]` đọc từ cấu hình admin (cùng nguồn với miniapp), link ở chân trang, đăng nhập, thanh toán; thêm thông tin công ty/MST/địa chỉ vào chân trang | M | Y: ai cung cấp nội dung chính sách và thông tin pháp nhân; có đăng ký website TMĐT với Bộ Công Thương không |
| D5-02 | P1 | khách | `bank-payment.tsx:239`: biểu tượng sao chép 15px, `onClick` trên icon, không nhãn, không role, vi phạm 44px. Hạn thanh toán là chữ tĩnh (~`:203-209`). Không có lưu ảnh QR hay mở app ngân hàng | Thay bằng `IconButton` 44px có `aria-label`; đếm ngược theo hạn đơn; nút "Lưu mã QR" nếu Zalo cho phép (chưa kiểm khả thi trong webview) | S–M | N |
| D5-03 | P1 | khách | Web `thanh-toan/bank-transfer-panel.tsx:135`: `disabled={checking \|\| isFetching}` làm nút "Tôi đã chuyển" nhấp nháy mỗi lần thăm dò; không có lưu QR | Chỉ khoá khi `checking`; hiện trạng thái "đang kiểm tra" riêng; thêm tải QR | S | N |
| D5-04 | P1 | khách, marketing | Trang sản phẩm web chỉ có "Thêm vào giỏ · giá" (`web/src/components/add-to-cart.tsx:237`) và thông báo "Xem giỏ hàng →" (`:246`); không "Mua ngay", không thanh CTA dính trên điện thoại, không chia sẻ/yêu thích (`web/src/app/san-pham/[slug]/page.tsx`: grep "share" rỗng; chỉ có `openGraph` `:35`). Thêm vào giỏ khi chưa đăng nhập phải qua Zalo OAuth (D2 mục 3 bước 2; `add-to-cart.tsx:123`) | "Mua ngay" (thêm giỏ rồi vào thanh toán), thanh CTA dính ở màn hẹp, nút chia sẻ (Web Share API + sao chép link kèm `?ref=` nếu đang là CTV) | M | Y: web có cho mua không cần đăng nhập Zalo không (mặc định: giữ Zalo-only lúc ra mắt, làm "Mua ngay" + quay lại đúng bước sau đăng nhập) |
| D5-05 | P1 | khách, đại lý | `/s/[slug]`: `sf.collections?.map` không có nhánh rỗng (`web/src/app/s/[slug]/page.tsx:228`); `/brand/[slug]`: `b.products.length > 0 &&` không thì không hiện gì (`web/src/app/brand/[slug]/page.tsx:103`). Dải tin cậy "Xuất kho tận gốc", "VietQR Napas247" (`s/[slug]/page.tsx:214,218`) là lời hứa cứng; comment `:192` ghi đã bỏ thanh toán thẳng cho đối tác nên chữ "VietQR" dễ gây hiểu nhầm. Địa chỉ `https://{sf.subdomain}.tubutree.com` (`:150`) chỉ đúng khi wildcard DNS xong (chưa kiểm) | Thêm EmptyState + nút về danh mục; rà lại chữ trong dải tin cậy; chỉ hiện URL subdomain khi DNS sẵn sàng | S | Y: wildcard DNS đã sẵn sàng chưa; "Xuất kho tận gốc" có đúng cho hàng đối tác không |
| D5-06 | P1 | admin, CSKH, kế toán | Tab Cấu hình: mỗi khoá một ô JSON thô (`web/src/components/admin/config-item.tsx:51`), chỉ 4 tiền tố tiền được hỏi xác nhận (`:9` `MONEY_PREFIXES`), không tìm kiếm/nhóm (`web/src/app/admin/page.tsx` ConfigTab ~`:1760-1780`, RC). ~125 khoá trong `api/prisma/seed.ts` | Ô tìm khoá + nhóm theo tiền tố; form theo kiểu (số tiền, %, bật/tắt, danh sách); nhãn tiếng Việt và mô tả cho khoá hay đổi; mở rộng danh sách tiền tố cần xác nhận | M | N |
| D5-07 | P1 | khách | Cộng đồng: chưa đăng nhập chỉ thấy EmptyState "đăng nhập để xem" (`miniapp/src/pages/feed.tsx:109`); feed rỗng có minh hoạ + chữ nhưng không có nút "Đăng bài đầu tiên" (`feed.tsx:239`; chữ ở `i18n/vi.ts` `community.emptyBody`). Ngày đầu chưa có khách thật nên mọi người vào đều thấy feed trống (D4 xử lý nội dung hạt giống) | Thêm nút hành động vào EmptyState; xem trước công khai vài bài (đọc-không-đăng) | S–M | Y: cho xem công khai feed không (mặc định: có, chỉ bật đăng/thích sau đăng nhập) |
| D5-08 | P1 | khách, marketing | Hero web: "SỐNG XANH AN LÀNH · 100% NGUYÊN BẢN VIỆT NAM" (`web/src/app/page.tsx:58`), thẻ "100% Thuần Chay & Lành Tính" (`:94`). Danh mục thật chưa kiểm toàn bộ (D2: hàng tẩy rửa, thực phẩm) | Xác nhận hoặc giới hạn phạm vi câu chữ trước khi công khai | S | Y: câu nào đúng cho 100% danh mục |
| D5-09 | P2 | khách, đại lý | Miniapp `/s/:slug`: thanh dính chỉ có "Chia sẻ gian hàng" (`pages/storefront-view.tsx:63-67`), không nút mua/xem tất cả; chưa kiểm hiển thị khác nhau giữa chủ và khách; không có EmptyState; không tìm thấy thì dùng ErrorState chung (`:31`) | Với khách: CTA "Xem sản phẩm"; với chủ: giữ chia sẻ; thêm 404 riêng và EmptyState | S | N |
| D5-10 | P2 | khách | Số cứng trong chữ lệch khi admin đổi cấu hình: `i18n/vi.ts:286` "Đơn đầu từ 199.000đ… mã chào mừng 30.000đ"; `vi.ts:734` "1 điểm = 1.000đ, tối đa 1.000 điểm"; `pages/dealer.tsx:151` "Giá sỉ đến 45%", `:211` "24 giờ"; loyalty HSD 30 ngày (~`loyalty.tsx:636,828`, RC) | Đọc từ cấu hình công khai đã có (như `support.*`), hoặc tạo `public-config` một lần; thêm spec cấm số tiền cứng trong `vi.ts` | S | N |
| D5-11 | P2 | khách | Checkout miniapp: CTA đặt hàng mờ khi `!canPlace` (`pages/checkout.tsx:358,944`); lý do chỉ hiện cho hết hàng (`:357`) và chặn phương thức (`:369`), còn thiếu địa chỉ/hoá đơn/phương thức thì mờ không nói. Chữ cứng "Đang tính..." (`:931,1054`) ngoài `vi`. (RC: checkout) | Dòng gợi ý dưới CTA "Chọn địa chỉ để tiếp tục"; chuyển chữ cứng vào `vi.checkout` | S | N |
| D5-12 | P2 | khách | Trợ lý AI: không cuộn xuống tin mới, không Enter để gửi (grep `onKeyDown\|scrollIntoView` rỗng trong `pages/ai-advisor.tsx`), không dòng cảnh báo "gợi ý tham khảo"; có `onError` (`:48`) nhưng không có nút thử lại (chưa kiểm nội dung) | `scrollIntoView` khi có tin, Enter gửi, dòng miễn trừ, nút thử lại | S | N |
| D5-13 | P2 | đại lý | Đăng ký đại lý: 2 ảnh CCCD bắt buộc (`pages/dealer.tsx:177,182`), nút gửi mờ `disabled={!valid}` (`:191`) không chỉ ô nào thiếu; chưa thấy dòng giải thích dữ liệu CCCD dùng để làm gì và lưu bao lâu (chưa kiểm toàn file) | Báo ô thiếu; thêm dòng về quyền riêng tư; xem lại nhu cầu CCCD ở bước đăng ký | S–M | Y: bắt CCCD ngay bước đăng ký hay sau khi duyệt sơ bộ |
| D5-14 | P2 | khách | Web `/tai-khoan` (109 dòng, `web/src/app/tai-khoan/page.tsx`) chỉ điều hướng tới địa chỉ, điểm xanh, đơn, ví; không sửa hồ sơ, không xoá tài khoản, không ví voucher, không yêu thích, không đánh giá của tôi. Miniapp có cả bộ này | Thêm tối thiểu: sửa tên/SĐT, xoá tài khoản (API đã có luồng của admin `account-deletion-panel`), voucher của tôi | M | N |
| D5-15 | P2 | khách | Web không có `loading.tsx` ở đâu (`find` rỗng) trong khi comment nói root có (`web/src/app/product/[slug]/route.ts:7`); trang SSR chuyển cảnh trắng chờ máy chủ | Thêm `app/loading.tsx` (skeleton) và sửa comment | S | N |
| D5-16 | P2 | khách | Web trang chủ: có tìm kiếm `q` và lọc nhãn (`web/src/app/page.tsx:14`) nhưng chưa thấy sắp xếp/lọc giá; trang đích của khách sàn nên có "Bán chạy", "Mới", "Giá" (chưa kiểm hết) | Thêm sắp xếp (giá, bán chạy) | M | N |
| D5-17 | P3 | khách | Chữ không đồng nhất trong cùng sản phẩm (đếm trong `miniapp/src` + `web/src`, trừ spec): hủy 48 / huỷ 166; xóa 15 / xoá 77; `…` 223 / `...` 12 (`checkout.tsx:931` "Đang tính..." cạnh `add-to-cart.tsx:237` "Đang thêm…"); "Copy" 45 / "Sao chép" 14 (phần lớn là tên icon, chưa kiểm hết) | Chốt quy ước (huỷ, xoá, `…`, Sao chép) và thêm vào `terminology.spec.ts` | S | N |
| D5-18 | P3 | dev | Còn token Lớp 1 ngoài `tokens.css`: ~109 chỗ (cart 12; vd. `--clay-*` trong `checkout.tsx`, `cashback.tsx`); `fontSize: 11` rời (`checkout.tsx:535`, `cart.tsx:480,590`, dưới trần 12px của DS); chip phiếu giảm giá lặp 3 nơi; `wishlist.tsx` còn dùng `components/product-card.tsx` cũ. Cũ A4-020 | Gộp thành `CouponChip`; đổi sang token ngữ nghĩa; bỏ card cũ | S–M | N |
| D5-19 | P3 | admin, đại lý | Còn `window.confirm`: `web/src/app/merchant/page.tsx:1184,1231`, `web/src/components/admin/account-deletion-panel.tsx:127`; admin chính đã dùng `confirm-dialog.tsx`. Cũ A4-040 (đã xử lý phần admin chính) | Dùng `useConfirm` ở 3 chỗ này | S | N |
| D5-20 | P3 | admin | Nhãn tab tiếng Anh "Retention & North-star" (`web/src/app/admin/page.tsx:192`, RC); "Content Kit CTV", "Academy", "Flash Sale" nhãn tiếng Anh trộn | Đổi "Giữ chân khách" và chuẩn hoá nhãn | S | N |
| D5-21 | P3 | khách | Cũ A4-016 còn mở: `Text onClick` không role/bàn phím (`pages/cart.tsx:458`) | Đổi sang `<button>` | S | N |
| D5-22 | P3 | khách, marketing | Danh sách nguồn gốc nhãn cứng trong `miniapp/src/utils/brand-origins.ts`, `utils/brands.ts`; dữ liệu mẫu ghi "Sokfram" trong khi nhãn thật là "Sokfarm" (`api/prisma/seed.ts:371,592`; link Shopee `sokfarm_mathoadua` ở D2). Dữ liệu thật trên DB chưa kiểm | Soát lại tên nhãn trên DB thật; đưa danh sách nguồn gốc vào dữ liệu nhãn | S | Y: tên chính thức của nhãn |
| D5-23 | P3 | admin | `admin/page.tsx` 3.232 dòng một file (RC), 33 tab; cũ A4-027 (nay đã có nhóm điều hướng và URL state nên chỉ còn khó bảo trì) | Tách theo tab (không gấp trước ra mắt) | L | N |
| D5-24 | P3 | khách | `ErrorBoundary` còn `padding: '10px 28px'` và `fontSize` 15-16 rời (`miniapp/src/components/error-boundary.tsx:78,86,91`); màu đã đổi sang token. Cũ A4-039 | Dùng `Button` DS | S | N |

## 3. Chấm điểm từng màn

Thang: **HT** = hoàn thiện (có đủ trạng thái, CTA rõ, token DS v2); **SS** = còn sơ sài (thiếu trạng thái hoặc CTA yếu); **PH** = placeholder (không có). Không màn nào PH. Cột "Căn cứ" ghi "đọc" nếu tôi đọc mã trang, "đo" nếu chấm theo số đo chung (không đọc kỹ từng dòng).

### 3.1 Mini-app (45 route từ `components/app.tsx:175-219`)

| Màn | Route | Điểm | Căn cứ + ghi chú |
|---|---|---|---|
| Trang chủ | `/` | HT | đo. Khối lỗi đã có (`home.tsx:78,89`), cũ A4-017 đã xử lý |
| Duyệt sản phẩm | `/browse` | HT | đo |
| Chi tiết sản phẩm | `/product/:slug` | HT | đọc. Có cam kết (`product-detail.tsx:731`), định kỳ |
| Giỏ hàng | `/cart` | HT | đọc. Còn `fontSize: 11` (`:480,590`), Text onClick (`:458`) |
| Thanh toán | `/checkout` | HT (RC) | đọc. D5-11. Khối Gomdon thuộc đổi-rác |
| Chuyển khoản | `/bank-payment/:code` | SS | đọc. D5-02 |
| Đơn hàng | `/orders` | HT | đo. Có tab Định kỳ |
| Chi tiết đơn | `/order/:code` | HT | đo (958 dòng; hành trình + tra cứu) |
| Game | `/game` | HT (RC) | đọc cấu trúc 3 tab. Thuộc phiên đổi-rác |
| Cộng đồng | `/feed` | SS | đọc. D5-07 |
| Bảng xếp hạng | `/feed/leaderboard` | HT | đo |
| Sự kiện cộng đồng | `/feed/events` | HT | đo. `vi.ts:734` số cứng |
| Chi tiết bài | `/feed/:id` | HT | đo, chưa đọc kỹ |
| Trợ lý AI | `/ai-advisor` | SS | đọc. D5-12 |
| Mua chung | `/group-buy`, `/group-buy/:id` | HT | đo, chưa đọc kỹ (chữ cứng ~`:230`) |
| Đổi vỏ chai | `/refill` | (bỏ qua) | Thuộc phiên đổi-rác |
| Cá nhân | `/profile` | HT | đọc. Ô "Mã giảm giá" mở `/loyalty` (đúng, không phải trang riêng) |
| Điểm thưởng | `/loyalty` | HT (RC) | đo |
| Ví | `/wallet` | HT | đo |
| Địa chỉ | `/addresses` | HT | đo |
| Thông báo | `/notifications` | HT | đo |
| CTV / Tiếp thị liên kết | `/affiliate` | HT | đọc tiêu đề + nút (1.226 dòng, lớn nhất) |
| Học viện | `/academy`, `/academy/:id` | HT | đo, chưa đọc kỹ |
| Hoàn tiền sàn ngoài | `/cashback` | HT | đọc. ErrorState cho ví và nhà bán |
| Đăng ký đại lý | `/dealer` | SS | đọc. D5-13 |
| Về Tubu Tree | `/about` | SS | đọc. D5-01 (chính sách ngắn) |
| Yêu thích | `/wishlist` | HT | đo. Dùng thẻ cũ (D5-18) |
| Sửa hồ sơ | `/edit-profile` | HT | đo, chưa đọc kỹ |
| Cài đặt | `/settings` | HT | đo |
| Câu chuyện thương hiệu | `/brand-story` | HT | đo |
| Định kỳ (chuyển hướng) | `/subscriptions` | HT | `app.tsx:210` về `/orders?tab=subscriptions` |
| Trình dựng gian hàng | `/storefront` | HT | đo (990 dòng) |
| Gian hàng công khai | `/s/:slug` | SS | đọc. D5-09 |
| Trang nhãn | `/brand/:slug` | HT | đo |
| Chủ nhãn | `/brand-owner` | HT | đo (+ `brand-owner-sales.tsx`) |
| Admin trong app | `/admin` | HT | đo (1.163 dòng; chưa so với admin web) |
| Duyệt cộng đồng | `/admin/community` | HT | đo, chưa đọc kỹ |
| Nhân viên | `/staff` | HT | đo, chưa đọc kỹ |
| Bảng lương của tôi | `/my-payroll` | HT | đo, chưa đọc kỹ |
| 404 | `*` | HT | `not-found.tsx` |

### 3.2 Web khách (19 trang từ `web/src/app`)

| Màn | Route | Điểm | Căn cứ + ghi chú |
|---|---|---|---|
| Trang chủ | `/` | HT | đọc. Có tìm kiếm, lọc nhãn, phân trang; D5-08, D5-16 |
| Chi tiết sản phẩm | `/san-pham/[slug]` | SS | đọc. D5-04 |
| Chuyển hướng cũ | `/product/[slug]` | HT | route handler 301; comment lệch (D5-15) |
| Trang nhãn | `/brand/[slug]` | SS | đọc. D5-05 |
| Gian hàng đại lý | `/s/[slug]` | SS | đọc. D5-05 |
| Giỏ hàng | `/gio-hang` | HT | đọc. Có `CouponBox` (`:333`) |
| Thanh toán | `/thanh-toan` | HT | đọc. Ngang miniapp: voucher, điểm xanh (`:525`), hoá đơn (`:49`); có `checkout-parity.spec.tsx` |
| Đăng nhập | `/dang-nhap` + `/callback` | SS | đọc. Chỉ Zalo, thiếu điều khoản (D5-01) |
| Tài khoản | `/tai-khoan` | SS | đọc. D5-14 |
| Địa chỉ | `/tai-khoan/dia-chi` | HT | đo |
| Điểm xanh | `/tai-khoan/diem-xanh` | HT | đo |
| Chi tiết đơn | `/tai-khoan/don-hang/[code]` | HT | đo |
| Ví Tubu | `/tai-khoan/vi-tubu` | HT | đo |
| Lỗi chung | `error.tsx`, `not-found.tsx` | HT | có |
| Merchant | `/merchant` | HT | đọc. Tab trong URL (cũ A4-030 đã xử lý); D5-19 |
| Admin | `/admin` | HT (RC) | đọc. Mục 4 |
| Admin POS | `/admin/pos` | chưa kiểm | chưa đọc |

### 3.3 Tab admin web (33 tab, `admin/page.tsx:186-258`, RC)

| Nhóm | Tab | Điểm | Ghi chú |
|---|---|---|---|
| Tổng quan | Việc cần xử lý, Tổng quan KPI, Retention & North-star | HT | nhãn tiếng Anh (D5-20) |
| Đơn hàng | Đơn hàng | HT | đọc: tìm kiếm, trạng thái, khoảng ngày, CSV, phân trang, ngăn kéo ở màn hẹp (`page.tsx:868-1335`); không thấy thao tác hàng loạt |
| Đơn hàng | Đơn đối tác & đối soát | HT | đo |
| Hoàn tiền | Đổi/Trả, Hoàn tiền khách, Hoàn tiền sàn ngoài | HT | đo |
| Người bán | Đại lý, Thưởng, Lịch sử giá, Rút tiền, Duyệt SP, Nhãn hàng | HT | đo |
| Khách hàng | Người dùng, Đánh giá, Gói định kỳ, Tích điểm tại quầy, Đổi vỏ chai | HT | Đổi vỏ chai: đổi-rác |
| Khuyến mãi | Voucher, Flash Sale, Nhiệm vụ & quà đổi điểm | HT | `engagement-tab` là RC |
| Nội dung | FAQ, Content Kit, Academy, Mẫu tin nhanh, Mẫu thông báo | HT | đo |
| Nhân sự | Chấm công | HT | đo |
| Cấu hình | Cấu hình | SS | D5-06 |
| Cấu hình | Sức khoẻ hệ thống | HT | đo |

## 4. Đánh giá riêng admin web

**Làm tốt (đọc mã):**
- 9 nhóm điều hướng (`NAV_GROUPS` `admin/page.tsx:186-258`), tab nằm trong URL (`?tab=`), nhân viên chỉ thấy tab theo quyền CSKH/KHO (`STAFF_TABS` `:265`).
- Bảng dữ liệu bọc `ScrollRegion` (`web/src/components/admin/ui.tsx`), nút 44px, ngăn kéo `SideDrawer` + `useNarrowScreen` ở màn hẹp.
- Hộp xác nhận chung `confirm-dialog.tsx` thay `window.confirm` ở admin chính; tab Đơn có lọc, xuất CSV, phân trang.

**Còn thiếu:**
- **Cấu hình** (D5-06): rủi ro lớn nhất về dùng sai. Hộp xác nhận chỉ áp cho 4 tiền tố (`config-item.tsx:9`), các khoá nhạy cảm khác (vd. `support.*`, ngưỡng freeship) không được hỏi lại (chưa kiểm hết các khoá).
- Không thấy thao tác hàng loạt (in nhãn, chuyển trạng thái nhiều đơn) ở tab Đơn: kho/CSKH làm từng đơn một. Đây có thể là một trong các việc "làm ngoài hệ thống" (xem D1).
- Admin/merchant chỉ thiết kế tốt cho máy tính; mobile dùng được cho Đơn/Đổi trả/Rút tiền (ngăn kéo), các tab khác chỉ có cuộn ngang (chưa kiểm bằng ảnh).
- Có hai bề mặt admin song song (`miniapp/src/pages/admin.tsx` 1.163 dòng và web admin): chưa kiểm chúng lệch nhau chỗ nào; nhân viên dễ không biết dùng cái nào.
- Merchant: `window.confirm` (D5-19); chưa kiểm trải nghiệm đối tác trên điện thoại.

## 5. Top 15 việc UI/UX trước ra mắt

| # | Việc | File chính | Công sức | RC? | Mức |
|---|---|---|---|---|---|
| 1 | Trang chính sách web + link ở chân trang, đăng nhập, thanh toán; nội dung đọc từ cấu hình; thông tin pháp nhân (D5-01) | `web/src/components/site-footer.tsx`, `web/src/app/dang-nhap/page.tsx`, trang mới `web/src/app/chinh-sach/[slug]/page.tsx`, `miniapp/src/pages/about.tsx` | M | Không (thanh toán miniapp là RC nếu thêm đồng ý ở đó) | P1 |
| 2 | QR chuyển khoản: nút sao chép 44px có nhãn, đếm ngược hạn, lưu QR (D5-02) | `miniapp/src/pages/bank-payment.tsx:239` | S–M | Không | P1 |
| 3 | Web: sửa nhấp nháy nút thanh toán chuyển khoản + tải QR (D5-03) | `web/src/app/thanh-toan/bank-transfer-panel.tsx:135` | S | Không | P1 |
| 4 | Web PDP: "Mua ngay", thanh CTA dính, chia sẻ (D5-04) | `web/src/components/add-to-cart.tsx`, `web/src/app/san-pham/[slug]/page.tsx` | M | Không | P1 |
| 5 | Web `/s/[slug]`, `/brand/[slug]`: trạng thái rỗng, sửa chữ dải tin cậy, chỉ hiện URL subdomain khi DNS sẵn sàng (D5-05) | `web/src/app/s/[slug]/page.tsx:150,214,228`, `web/src/app/brand/[slug]/page.tsx:103` | S | Không | P1 |
| 6 | Admin Cấu hình: tìm kiếm, nhóm, form theo kiểu, mở rộng tiền tố cần xác nhận (D5-06) | `web/src/components/admin/config-item.tsx`, ConfigTab trong `web/src/app/admin/page.tsx` | M | **Có**: `page.tsx` (tách ConfigTab ra file riêng trước, rồi mới sửa) | P1 |
| 7 | Cộng đồng: nút hành động trong EmptyState, xem trước công khai (D5-07) | `miniapp/src/pages/feed.tsx:109,239`, `miniapp/src/i18n/vi.ts` | S–M | Không | P1 |
| 8 | Xác nhận và sửa câu quảng cáo "100% Thuần Chay/Nguyên bản Việt Nam" (D5-08) | `web/src/app/page.tsx:58,94` | S | Không | P1 |
| 9 | Chữ phụ thuộc cấu hình: 199.000đ, 30.000đ, 45%, 24 giờ, HSD 30 ngày (D5-10) | `miniapp/src/i18n/vi.ts:286,734`, `miniapp/src/pages/dealer.tsx:151,211` | S | **Có** nếu đụng `loyalty.tsx` (HSD); phần còn lại không | P2 |
| 10 | Checkout: lý do CTA mờ + chuyển chữ cứng sang `vi` (D5-11) | `miniapp/src/pages/checkout.tsx:358,931,944,1054` | S | **Có** (checkout) | P2 |
| 11 | Gian hàng miniapp: CTA mua cho khách, EmptyState, 404 riêng (D5-09) | `miniapp/src/pages/storefront-view.tsx:31,63` | S | Không | P2 |
| 12 | Trợ lý AI: cuộn, Enter, miễn trừ, thử lại (D5-12) | `miniapp/src/pages/ai-advisor.tsx` | S | Không | P2 |
| 13 | Đăng ký đại lý: báo ô thiếu, dòng quyền riêng tư (D5-13) | `miniapp/src/pages/dealer.tsx:177-191` | S–M | Không | P2 |
| 14 | Web tài khoản: sửa hồ sơ, xoá tài khoản, voucher; thêm `loading.tsx` (D5-14, D5-15) | `web/src/app/tai-khoan/page.tsx`, `web/src/app/loading.tsx` (mới) | M | Không | P2 |
| 15 | Dọn nhất quán: quy ước chữ + spec, `CouponChip`, `fontSize: 11`, `window.confirm` ×3, nhãn admin tiếng Anh (D5-17..21, 24) | `miniapp/src/i18n/vi.ts`, `miniapp/src/pages/cart.tsx:458,480,590`, `miniapp/src/pages/checkout.tsx:535`, `web/src/app/merchant/page.tsx:1184,1231`, `web/src/app/admin/page.tsx:192` | S–M | **Có** (checkout, admin page): làm sau khi phiên đổi-rác merge | P3 |

Ghi chú xếp hạng: các việc 2–5 và 7–8 phục vụ mục tiêu 1 (khách sàn vào mua trực tiếp) và mục tiêu 3; việc 5 và 11 phục vụ mục tiêu 4; việc 6 phục vụ mục tiêu 5; việc 1 là điều kiện công khai.
Việc 4 và 14 có chồng với D2 (đăng nhập Zalo trên web): nên làm cùng một người.

## 6. Mục cũ (`docs/2026-10-review/04-uiux.md`) VẪN còn

| ID cũ | Hiện trạng kiểm lại | Gắn với |
|---|---|---|
| A4-016 | `pages/cart.tsx:458` vẫn là `Text onClick` (đã nới 44px bằng `tubu-hit-44` nhưng không role/bàn phím) | D5-21 |
| A4-040 (một phần) | Admin chính đã dùng `confirm-dialog.tsx`; còn `window.confirm` ở merchant và `account-deletion-panel.tsx:127` | D5-19 |
| A4-020 (một phần) | `wishlist.tsx` còn dùng `components/product-card.tsx` cũ | D5-18 |
| A4-039 (một phần) | `error-boundary.tsx:78,86,91` còn `padding`/`fontSize` rời; màu đã đúng token | D5-24 |

Đã xử lý (kiểm lại bằng mã): A4-004 (viewport), A4-008 (hotline giả), A4-011 (Chip), A4-012 (primitives), A4-014 (Button khoá), A4-017 (lỗi Home), A4-018 (Ví mờ có lý do: `checkout.tsx:369` `hint`), A4-030 (merchant có URL). Các mục còn lại của báo cáo cũ (contrast, axe, h1/landmark): chưa kiểm vì cần chạy trình duyệt; `MainLandmark` đã có (`components/app.tsx:172`).

## 7. Nhất quán miniapp và web

- **Thanh toán: ngang nhau.** Web có voucher (`gio-hang/page.tsx:333`, `thanh-toan/page.tsx:532`), Điểm Xanh (`:525`), hoá đơn VAT (`:49`), và có `checkout-parity.spec.tsx` giữ cho hai bên cùng quy tắc. Khác biệt đáng nói: ZaloPay ẩn ở miniapp (`checkout.tsx:363`, theo D2); web không có Gomdon/đổi-rác (thuộc phiên khác).
- **Cùng hành động, khác chữ (chưa kiểm hết, chỉ mẫu đọc được):** trạng thái chờ miniapp viết "Đang tính..." (`checkout.tsx:931`, ba chấm) còn web viết "Đang thêm…" (`add-to-cart.tsx:237`, ký tự `…`); tên nút giỏ ở web là chữ cứng, ở miniapp qua `vi.*` (D5-17).
- **Mục chỉ có ở miniapp:** yêu thích, thông báo, cộng đồng, game, mua chung, học viện, AI, định kỳ, cashback, lịch sử voucher. Web chỉ có tài khoản tối giản. Chấp nhận được nếu web là cửa vào cho khách sàn, nhưng phải có đường chuyển sang Mini App (mã QR/nút "Mở bằng Zalo") ở trang cảm ơn đặt hàng: chưa kiểm có hay không.
- **Đăng nhập:** miniapp im lặng đăng nhập bằng Zalo (D2); web bắt OAuth Zalo trước khi thêm giỏ (`add-to-cart.tsx:123`). Lệch này là rào cản lớn nhất của khách web mới (D5-04).
- **Chia sẻ:** link chia sẻ trong miniapp trỏ về web `WEB_BASE_URL/s/<slug>?ref=` (`components/share-sheet.tsx`); nên khách vào qua đường này thấy trang web (D5-05), không phải miniapp. Điều này làm cho chất lượng web `/s/[slug]` quan trọng hơn trang miniapp tương ứng.

## 8. Quét dấu hiệu chưa xong

- `TODO|FIXME|XXX|lorem|coming soon|sắp ra mắt|dummy|0123456789|test@` trong `miniapp/src` và `web/src` (trừ spec): không có kết quả đáng kể trong mã UI.
- `console.log`/`alert(`: không có `alert(`; `console.error` ở các nhánh bắt lỗi (vd. `web/src/app/dang-nhap/page.tsx:43`) là chủ đích.
- `window.confirm`: 3 chỗ (D5-19).
- Số điện thoại, email cứng: `miniapp/src/pages/about-data.ts:58` (dự phòng khi không đọc được cấu hình, khớp API và web, chủ đích); không thấy địa chỉ cửa hàng cứng.
- Giá cứng trong chữ: D5-10.
- Route chết: mọi `navigate('/…')` trong các file đã đọc đều khớp bảng route `app.tsx`; `/subscriptions` là chuyển hướng có chủ đích. Không kiểm bằng công cụ cho toàn bộ link (chưa kiểm hết 104 file trang).
- Tuyên bố quảng cáo cứng: D5-05, D5-08.

## 9. Đề xuất tính năng mới (theo giá trị/công sức)

1. **Khối "Mua trực tiếp được gì" trên web trang chủ và PDP** (mục tiêu 1; S): 3 dòng đã có sẵn trong hệ thống, hiện nay khách không thấy lúc quyết định (D2 mục 4): Điểm Xanh ~10%, freeship từ 200k, định kỳ giảm 12–15%. Đọc số từ cấu hình để không lệch.
2. **"Mua ngay" + thanh CTA dính + chia sẻ trên web PDP** (mục tiêu 1; M): D5-04.
3. **Trang chính sách và xác nhận đồng ý** (điều kiện công khai; M): D5-01.
4. **Nút "Lưu QR" và "Mở app ngân hàng" cho chuyển khoản** (mục tiêu 1; S–M): giảm bỏ đơn ở bước trả tiền, khách sàn quen thanh toán một chạm. Chưa kiểm khả thi deep link trong webview Zalo.
5. **Xem trước công khai cộng đồng + chia sẻ bài ra web** (mục tiêu 3; M): kéo khách mới qua nội dung, không chỉ qua mua hàng.
6. **Thao tác hàng loạt ở tab Đơn (in nhãn, đổi trạng thái nhiều đơn)** (mục tiêu 5; M): chưa kiểm nhu cầu thật, nên hỏi kho/CSKH (D1).
7. **Admin Cấu hình có form theo kiểu** (mục tiêu 5; M): D5-06.
8. **Mã QR gian hàng cho đại lý in/dán** (mục tiêu 4; S): chưa kiểm `share-sheet.tsx` đã có QR hay chưa.
9. **Web tài khoản đầy đủ hơn (voucher, yêu thích, đánh giá của tôi)** (mục tiêu 1; M): D5-14.

## 10. Câu hỏi cho chủ dự án

| # | Câu hỏi | Mặc định khuyên dùng |
|---|---|---|
| 1 | Ai cung cấp nội dung điều khoản, bảo mật, đổi trả, và thông tin pháp nhân (tên, MST, địa chỉ)? Có đăng ký website với Bộ Công Thương không? | Dùng đoạn hiện có ở `about.tsx:26-40` làm bản nháp, chủ dự án duyệt trước ra mắt; đặt trong cấu hình admin để sửa không cần phát hành lại. |
| 2 | Web có cho khách mua không cần đăng nhập Zalo (khách vãng lai hoặc SĐT)? | Giữ Zalo-only lúc ra mắt; làm "Mua ngay" + quay lại đúng bước sau khi đăng nhập. Xem xét khách vãng lai sau khi có số liệu bỏ giỏ. |
| 3 | "100% Thuần Chay" và "100% Nguyên bản Việt Nam" có đúng cho toàn bộ danh mục không? | Bỏ hoặc giới hạn theo từng nhãn nếu chưa chắc; không đưa lời tuyệt đối lên trang đầu. |
| 4 | Có cho xem công khai feed cộng đồng (không cần đăng nhập)? | Có, chỉ đọc; đăng/thích/bình luận cần đăng nhập. |
| 5 | Wildcard DNS `*.tubutree.com` đã sẵn sàng trước khi đưa URL subdomain cho đại lý? | Nếu chưa, ẩn dòng URL subdomain và chỉ cho chia sẻ `…/s/<slug>`. |
| 6 | Đăng ký đại lý có bắt CCCD ngay lúc đăng ký không? | Chuyển CCCD sang bước sau khi duyệt sơ bộ, nếu quy định thuế cho phép; nếu bắt buộc ngay thì thêm dòng giải thích mục đích và thời hạn lưu. |

## 11. Hạn chế của báo cáo này

- Đọc mã tĩnh; không có ảnh chụp. Mọi kết luận về tràn ngang 360–390px, tương phản, nhấp nháy lúc chạy: chưa kiểm.
- Khoảng 40% màn chấm theo số đo chung, không đọc từng dòng (ghi "đo" ở cột Căn cứ). Với màn đó, điểm HT nghĩa là "không thấy dấu hiệu thiếu", không phải đã kiểm kỹ.
- Chưa kiểm: nội dung danh mục và dữ liệu nhãn thật trên DB, DNS, ZNS, template Zalo, `apps/web/src/app/admin/pos/page.tsx`, lệch giữa admin miniapp và admin web.
- Các phần đổi-rác (refill, Gomdon, Điểm Xanh từ rác) và việc tồn n5-polish được loại khỏi báo cáo theo brief.
