# Review hình bước chốt đợt shop redesign (2026-11-01)

Bước "Chốt đợt" của `02-ke-hoach.md`: chụp lại mọi màn trong phạm vi ở 3 khổ rồi review hình (khung design-critique) so với ảnh cũ, `01-thiet-ke.md` và `DESIGN.md`.

## Kết luận

- Mã chụp: nhánh tích hợp `0f59c461f` (worktree `shop-capture`), lane 7, API thật, DB `tubutree_uat_l7`.
- 247 ảnh: mini375 89, web375 91, web1280 67. 0 lỗi API, 0 lỗi trang, 0 lỗi console ở mọi ô.
- **P0: không có.** Mọi số tiền trên ảnh khớp dữ liệu seed: giá Giờ vàng, giá gạch, %, tổng combo, tiết kiệm, mua kèm, tổng giỏ 953.750đ.
- **P1: 19.** Nặng nhất: Trang chủ web 375 tràn ngang làm thanh điều hướng dưới rơi khỏi màn; cột phải Trang chủ web 1280 cắt chữ; giá gạch ở giỏ khác ở thẻ; đầu trang Mini thừa 48px ở 4 màn mới; nửa dưới PDP web 375 còn khác Mini.
- **P2: 38.**
- Trang chủ sẽ chụp lại sau khi gói F9 (combo vào `GET /home`, chống trùng §5) gộp. Lần này vẫn chụp; lỗi chống trùng combo với Bán chạy nhất là việc của F9, không tính ở đây.

## Ảnh

Thư mục `docs/2026-10-31-shop-redesign/screens/final/`. Tên ảnh `<khổ>/<màn>__<persona>__<khổ>__s<n>.png`. `s1` là đầu trang, mỗi ảnh sau cuộn 85% chiều cao màn. Mỗi khổ có `index-<khổ>.jsonl` (url, ảnh, lỗi API, lỗi trang, chữ đầu trang).

Mọi đường dẫn ảnh trong báo cáo này tính từ thư mục `final/`.

| Màn | Mini | Web | Persona | mini375 | web375 | web1280 |
|---|---|---|---|---|---|---|
| Trang chủ | `/` | `/` | guest, returning (1280: returning) | 12 + 12 | 12 + 12 | 8 |
| Danh mục: hub | `/browse` | `/san-pham` | returning | 2 | 2 | 3 |
| Danh mục cha 2 tầng | `/browse?category=cat-cleaning` | `/san-pham?category=cat-cleaning` | returning | 5 | 5 | 4 |
| Danh mục con | `/browse?category=<Rửa chén & rau quả>` | như Mini | returning | 3 | 3 | 3 |
| Tìm kiếm | `/browse?q=nuoc` | `/san-pham?q=nuoc` | returning | 3 | 3 | 3 |
| PDP Giờ vàng | `/product/nuoc-rua-chen-fuwa3e` | `/san-pham/…` | returning | 6 | 6 | 6 |
| PDP Combo + Mua kèm | `/product/nuoc-giat-fuwa3e` | `/san-pham/…` | returning, guest | 6 + 7 | 6 + 9 | 6 |
| Giỏ | `/cart` | `/gio-hang` | returning | 2 | 2 | 3 |
| Gian hàng CTV | `/s/uatctv` | `/s/uatctv` | guest | 4 | 4 | 4 |
| Trình dựng gian hàng | `/storefront` | `/ctv/gian-hang` | ctv | 2 | 2 | 3 |
| Trình dựng: chi tiết khối COMBO | `/storefront?khoi=…` | `/ctv/gian-hang?khoi=…` | ctv | 2 | 2 | 3 |
| Thương hiệu | `/brand/fuwa3e` | `/brand/fuwa3e` | guest | 2 | 2 | 3 |
| Ưu đãi | `/offers` | `/uu-dai` | returning, guest (1280: returning) | 4 + 4 | 5 + 3 | 4 |
| Mã giảm giá | `/vouchers` | `/ma-giam-gia` | returning | 1 | 1 | 2 |
| Giờ vàng (khung đang chạy) | `/flash-sale` | `/gio-vang` | returning | 2 | 2 | 3 |
| Giờ vàng (bấm tab khung sắp mở 12:00) | `/flash-sale` | `/gio-vang` | guest | 2 | 2 | 2 |
| Bán chạy nhất | `/best-sellers` | `/ban-chay` | returning | 5 | 5 | 4 |
| Chiến dịch | `/campaign/tuan-le-song-xanh` | `/chien-dich/…` | guest | 3 | 3 | 3 |

Ghi chú chụp:
- Trang chủ 375 dừng ở 12 ảnh: lưới "Gợi ý hôm nay" tải thêm khi cuộn nên không có đáy. Tìm kiếm và danh mục con ở 1280 dừng ở 3 ảnh theo trần đặt trong script.
- Ảnh sản phẩm là khung lá, banner là ảnh giả (chữ trắng trên nền màu). Không chấm việc thiếu ảnh thật.
- Bong bóng "Trồng cây mỗi ngày, nhận quà thật" đè thanh dưới ở ảnh 375: hành vi thật khi mở lần đầu, không tính lỗi.
- Công cụ: `screens/capture-shop.mjs` (thêm `--out`, trần ảnh theo màn, bấm tab trước khi chụp, danh sách màn mới). Chụp lại một màn: `node capture-shop.mjs --phase mini375 --filter home --force`.

## Dữ liệu seed thêm cho lần chụp này

Chỉ trên DB lane 7 (`tubutree_uat_l7`), qua API admin của lane 7. Script: `screens/seed-l7/final.mjs` (chạy lại được, món đã có thì bỏ qua). Nền là seed 31/10 (129 sản phẩm, xem `screens/INDEX.md` ở worktree tích hợp).

Trước khi seed:
- `prisma migrate deploy`: 253 → 261 migration (gồm `20261101110000_coupon_listed` tới `20261101130000_bundle_item_ref_price`).
- `prisma/seed-reference.ts` (chỉ tạo mới, không ghi đè): +7 khoá cấu hình.

Đã thêm:
- **Danh mục 2 tầng (2 cây):** "Tẩy rửa sinh học" > Rửa chén & rau quả (9 SP), Lau nhà & bếp (6), Nhà tắm & bồn cầu (4). "Giặt xả" > Nước giặt & bột giặt (8), Nước xả & tẩy vết (4). Sản phẩm gán vào mục lá và gỡ khỏi mục cha (`POST /admin/categories`, `POST /admin/product-categories/assign`).
- **Mã nhận được (listed, loại CLAIM, 500 lượt):** NHANSHIP (miễn phí giao, đơn từ 99.000đ, hết 03/11), NHANXANH20K (giảm 20.000đ, đơn từ 150.000đ, hết 07/11), NHAN10 (giảm 10% tối đa 50.000đ, đơn từ 300.000đ, hết 15/11). Khách `returning` đã nhận NHANXANH20K.
- **Chiến dịch (2):** "Tuần lễ sống xanh" (HOME_TOP, 8 SP, mã NHANXANH20K + NHAN10) và "Ưu đãi tháng 11" (OFFERS_TOP, 4 SP, mã NHANSHIP). Ảnh 1000×400 JPEG dựng bằng Playwright. Chạy 01/11 → 15/11.
- **Combo BUNDLE_PCT (2):** "Bộ giặt sạch Fuwa3e" −15% (Nước giặt Fuwa3e + Nước xả lavender + Xịt tẩy vết: 435.000 → 369.750đ). "Bộ bếp sạch Fuwa3e" −12% (Nước lau bếp + Nước rửa tay + Nước lau kính: 267.000 → 234.960đ). Hai bộ để khối "Combo tiết kiệm" Trang chủ đạt sàn 2.
- **Mua kèm ADDON (1):** "Mua kèm cho nước giặt Fuwa3e", món chính `nuoc-giat-fuwa3e`: Viên tẩy lồng máy giặt 69.000đ (tối đa 2), Bột giặt enzyme 109.000đ (tối đa 1). Chạy 01/11 → 15/11.
- **Giờ vàng:** "Giờ vàng 20:00" đang chạy 01/11 20:00 → 02/11 01:00 (dài hơn khung 2 giờ để đủ thời gian chụp), 8 món, đã bán 0–90%. "Giờ vàng 12:00" sắp mở 02/11 12:00 → 14:00, 6 món.
- **Giỏ `returning`:** thêm Nước xả lavender và Xịt tẩy vết để đủ "Bộ giặt sạch" (giỏ trả `comboDiscount` 65.250đ).

## Cách review

- Ghép từng cặp ảnh mini375 | web375 cùng màn, cùng số thứ tự, để so hai app từng màn.
- Ba reviewer chia màn (Trang chủ + Danh mục + Bán chạy; PDP + giỏ + Giờ vàng + chiến dịch; gian hàng + trình dựng + thương hiệu + Ưu đãi + mã). Phiên chính mở lại ảnh để kiểm từng P1, hạ mức hoặc gộp khi cần.
- Đo tràn ngang web 375 bằng trình duyệt thật (`scrollWidth`) trên 19 trang. Chỉ Trang chủ tràn (guest và returning). Mini Trang chủ không tràn.
- Lưu ý khi so ảnh ghép: từ `s2`, web cuộn nhiều hơn Mini 43px mỗi bước, nên lệch dọc giữa hai bên là do cách chụp. Cắt cùng chỗ thì thẻ hai bên trùng nhau.

## P0

Không có.

## P1

Mỗi dòng: màn | khổ | ảnh | vấn đề | file nghi ngờ | cách sửa.

| # | Màn | Khổ | Ảnh | Vấn đề | File nghi ngờ | Cách sửa |
|---|---|---|---|---|---|---|
| 1 | Trang chủ | web375 | `web375/home__returning__web375__s1.png` (đáy: chỉ thấy đỉnh nút Vườn Xanh) | Trang tràn ngang 24px (layout 399px). Thanh điều hướng dưới bị đẩy khỏi màn 50px, trang kéo ngang được. Gốc: chữ đọc ẩn (`SR_ONLY`, `position:absolute`) của `PriceTag` trong `ComboCard` lấy khung `relative` bọc ngoài vùng cuộn làm gốc, nên thoát vùng cuộn của kệ "Combo tiết kiệm". Đặt `position:relative` cho vùng cuộn thì `scrollWidth` về 375 (đã thử trong trình duyệt). | `apps/web/src/components/mini/scroll-row.tsx:27` (div `.scroll-x` không `relative`; khung `relative` ở `:40` nằm ngoài); `apps/web/src/components/mini/price-tag.tsx:59,65` | Thêm `position: relative` cho vùng cuộn của `ScrollRow` (Mini làm cùng cho khớp). Thêm e2e: Trang chủ web 375 có combo thì `scrollWidth ≤ 375`. |
| 2 | Trang chủ | web1280 | `web1280/home__returning__web1280__s1.png` (cột phải, y 150–214) | Thẻ thành viên và thẻ Việc cần làm đứng cạnh nhau trong cột 4/12 cạnh banner. Chữ cắt hết: "3…", "12…", tên khách mất. Hồi quy: ảnh 31/10 chưa có banner nên hai thẻ trải ngang. | `apps/web/src/components/home/home-view.tsx:217` (`md:flex … md:[&>div]:flex-1`); `apps/web/src/components/layouts/hub-layout.tsx:21` | Có banner thì xếp dọc hai thẻ (`lg:flex-col`); chỉ để cạnh nhau khi `aside` rộng 12 cột. |
| 3 | Trang chủ, khối Giờ vàng | mọi khổ | `mini375/home__returning__mini375__s1.png` (thẻ Giờ vàng, dòng tên) | Tên món 2 dòng ("Khăn ướt không / cồn Bé Na"). Q11 chốt 1 dòng. Thẻ cao khoảng 258px vì thêm giá gạch và dòng phân loại. | `packages/app-core/src/commerce/tile-metrics.ts:13-14,50-51`; `apps/miniapp/src/components/ui/product-tile.tsx:267`; `apps/web/src/components/mini/product-tile.tsx:263` | Biến thể `flash` cắt 1 dòng, hạ `nameCaption` của flash, chỉnh khung chờ theo. Nếu muốn giữ 2 dòng thì chủ sửa Q11. |
| 4 | Trang chủ, hub Danh mục (kệ Bán chạy nhất) | mọi khổ | `web1280/home__returning__web1280__s2.png` (thẻ #4 #5 #6 #8 #9, dòng meta) | Thẻ hạng 128px cắt giữa số: "★ 4,7 · Đã bán 8,…". Mất nghĩa. Mini cùng bề rộng nên cũng cắt. | `packages/app-core/src/commerce/card-meta.ts:35` (`cardMetaLine` chưa có bản gọn); dòng meta biến thể `rank` trong hai `product-tile.tsx` | Thêm bản gọn cho thẻ hẹp (`rank`, `rail-sm`): bỏ sao hoặc bỏ chữ "Đã bán". |
| 5 | Bán chạy nhất, Giờ vàng, Chiến dịch, Mã giảm giá | mini375 | `mini375/flash-sale__returning__mini375__s1.png` (dải 0–65px chỉ có nút ‹); cùng lỗi ở `best-sellers__…s1`, `campaign__…s1`, `vouchers__…s1` | Đầu trang thừa khoảng 48px. Tiêu đề rơi xuống hàng hai và thụt 48px. Web đặt tiêu đề cạnh nút lùi trên một hàng. Có từ P13 và P12. | `apps/miniapp/src/pages/best-sellers.tsx:69`, `flash-sale.tsx:321`, `campaign.tsx:94`, `vouchers.tsx:134` (`className="page"`) cộng `apps/miniapp/src/css/tokens.css:65-67` (đệm 48px) và `apps/miniapp/src/components/ui/page-header.tsx:32` (chừa trái 48px) | Bỏ lớp `page` ở 4 trang như `cart.tsx`; chỉnh `STICKY` của `flash-sale.tsx` (đang trừ khoản đệm này). |
| 6 | Giỏ | mọi khổ | `web375/cart__returning__web375__s1.png` (dòng "Nước rửa chén hương chanh": 33.000đ gạch 59.000đ); so `mini375/flash-sale__returning__mini375__s1.png` (cùng món gạch 50.000đ) | Cùng món Giờ vàng có hai "giá gốc". Giỏ gạch giá niêm yết; thẻ, trang Giờ vàng, PDP gạch giá đang bán trước Giờ vàng. "Tiết kiệm 92.000đ" tính theo giá niêm yết. Tiền khách trả vẫn đúng. | `apps/api/src/modules/cart/cart.service.ts:207` (`listUnitPrice: retailPrice`) với `packages/app-core/src/flash-price.ts:97` (`compareAt` theo giá đang bán) | Chốt một nguồn giá gạch cho món Giờ vàng ở mọi nơi; thêm spec giữ thẻ và giỏ bằng nhau. |
| 7 | Giỏ | mini375, web375 | `mini375/cart__returning__mini375__s1.png` (chân dính từ y≈548) | Chân dính cao khoảng 265px, một phần ba màn. Mỗi màn chỉ thấy khoảng 2 dòng hàng. Đã đạt miễn phí giao vẫn vẽ thanh đầy. Tạm tính và nút Thanh toán hai hàng riêng. Trái sơ đồ CT-04 (khoảng 140px). | `apps/miniapp/src/pages/cart.tsx:735-795`; `apps/web/src/app/gio-hang/page.tsx` (chân dính) | Đạt miễn phí giao thì còn một dòng chữ, bỏ thanh; hàng cuối gồm tổng + tiết kiệm bên trái, nút bên phải. |
| 8 | Giỏ | mini375, web375 | `mini375/cart__returning__mini375__s1.png` (hàng "Mã giảm giá") | Gợi ý mã cắt "Bạn có 6 mã dùng đư…", mất "giảm đến 60.000đ". Web 1280 hiện đủ. | `apps/miniapp/src/pages/cart.tsx` (hàng mã, `nowrap` + ellipsis); `packages/app-core/src/coupon-use.ts:36` | Ở 375 rút chữ ("6 mã · giảm đến 60.000đ") hoặc cho xuống dòng. |
| 9 | Giờ vàng (hai khung) | mini375, web375 | `mini375/flash-sale__returning__mini375__s1.png` (thẻ 1, 2, 4: "Gói 80 tờ · Mỗi khách tối đ…") | Dòng ghi chú cắt mất chính con số giới hạn mua. | `apps/miniapp/src/components/ui/product-tile.tsx:308`; `apps/web/src/components/mini/product-tile.tsx:305`; `packages/app-core/src/commerce/flash-slots.ts:107-110` | Đặt giới hạn lên trước ("Tối đa 3 · Gói 80 tờ") hoặc cho ghi chú biến thể `line` 2 dòng. |
| 10 | PDP | web375 | `web375/product-flash__returning__web375__s2.png`, `web375/product-bundle__returning__web375__s3.png` | Đánh giá nhanh đứng sau Số lượng và Mua chung, sau một dải trống khoảng 56px. Mini để ngay sau Phân loại / Combo / Mua kèm (Q8). | `apps/web/src/app/san-pham/[slug]/page.tsx:221-225` (nằm trong `below`); `pdp-quick-reviews.tsx:21` (`mt-8`) | Ở điện thoại đưa `PdpQuickReviews` vào khối thông tin, giữa `PdpBundles` và `AddToCart`; bỏ khoảng trống. |
| 11 | PDP, nửa dưới | web375 | `web375/product-flash__returning__web375__s3.png` | Thành phần, Cam kết, Mô tả, Đánh giá nằm liền trên nền kem (Mini: dải trắng cách 8px). "Chat với Tubu Tree", "Viết đánh giá", "Xem thêm (22)" là nút viền (Mini: nút nền nhạt hoặc chữ). Thiếu chip lọc đánh giá (Mini có ở `mini375/…__s3`). Lỗi cũ W-03, W-04, W-07 của `web.md`. | `apps/web/src/app/san-pham/[slug]/page.tsx:223`; `product-reviews.tsx:164,172,316`; `pdp-extras.tsx:411,425,432` | Làm theo W-03, W-04, W-07: khối dải trắng, kiểu nút như Mini, thêm chip lọc. |
| 12 | PDP, khối phân loại | web375 | `web375/product-flash__returning__web375__s2.png` | Chip phân loại một dòng "1L · 84.000đ Giờ vàng"; Mini hai dòng có ⚡. Chip "Eco" và "Đặt định kỳ" đứng sau Vận chuyển (Mini: Eco ở khối đầu). Dòng miễn phí giao to hơn Mini. | `apps/web/src/components/add-to-cart.tsx:376-377`; `apps/web/src/app/san-pham/[slug]/page.tsx:193-205`; `pdp-extras.tsx:126` | Chip hai dòng như Mini; ở điện thoại đưa chứng nhận lên khối đầu; dòng miễn phí giao cỡ chữ như Mini. |
| 13 | PDP | web1280 | `web1280/product-bundle__returning__web1280__s1.png` ("Combo ưu đãi"), `web1280/product-flash__returning__web1280__s2.png` | Tiêu đề khối trong luồng mua dùng Fraunces. Q1: Inter 16/700. | `apps/web/src/app/san-pham/[slug]/pdp-sections.tsx:12` (`ui.sectionTitle` là font-display) | Dùng `SectionHeader` / Inter 16/700 ở mọi khổ. |
| 14 | Trình dựng: chi tiết khối | web375 | `web375/storefront-block__ctv__web375__s1.png`, `…__s2.png` | Web giữ tiêu đề trang "Gian hàng của tôi" rồi thêm hàng "‹ Gian hàng của tôi ⋯"; Mini gộp lối về vào hàng nút lùi. Nội dung web thấp hơn khoảng 44px. Nút "+ Thêm sản phẩm" web chỉ rộng theo chữ, Mini rộng hết hàng. | `apps/web/src/app/ctv/gian-hang/page.tsx:28`; `apps/web/src/components/affiliate/storefront-section-detail.tsx:108-118,158-161` | Ẩn `PageHeader` khi có `?khoi=` dưới md, dựng đầu khối như Mini; nút thêm sản phẩm `w-full`, chữ lấy từ khoá chung. |
| 15 | Ưu đãi | mini375, web375 | `mini375/offers__returning__mini375__s1.png` (đầu khối Giờ vàng) | Khối Giờ vàng ở Ưu đãi dùng đồng hồ HH:MM:SS nhảy giây. Q3 chỉ cho đầu khối Giờ vàng Trang chủ và trang Giờ vàng. Tiêu đề "Giờ vàng", Q10 ghi "Giờ vàng hôm nay". | `apps/miniapp/src/components/offers/offers-flash.tsx:51`; `apps/web/src/components/offers/offers-flash.tsx:57` | `Countdown mode="text"` ("Kết thúc sau …"); thêm khoá chữ "Giờ vàng hôm nay". |
| 16 | Ưu đãi | mọi khổ | `mini375/offers__returning__mini375__s3.png` | "Mã của tôi" vẽ cả 8 phiếu dù có "Xem tất cả" sang trang Mã giảm giá. Khối không có trần (DESIGN.md nguyên tắc 5). Đẩy Đổi quà xuống rất xa. | `apps/miniapp/src/pages/offers.tsx:149`; `apps/web/src/app/uu-dai/page.tsx:137` | Cắt 3 phiếu (máy tính 3 hoặc 6), nút ghi "Tất cả (n)". |
| 17 | Ưu đãi | mọi khổ | `mini375/offers__returning__mini375__s2.png` (thẻ Điểm danh, y≈302–638) | Thẻ Điểm danh cao khoảng 340px, đoạn luật 4 dòng luôn mở, chen giữa dải điểm và Mã của tôi. Q10 chỉ có "dải Điểm Xanh gọn". Lỗi OF-03 cũ. | `apps/miniapp/src/pages/offers.tsx:124-126`; `apps/web/src/app/uu-dai/page.tsx:109` (`DailyCheckInCard`) | Bản `compact`: 7 ô và nút một hàng, luật vào sheet (i); hoặc chuyển Điểm danh sang Vườn Xanh. |
| 18 | Ưu đãi, Mã giảm giá, Chiến dịch (phiếu mã) | mọi khổ | `mini375/offers__returning__mini375__s1.png` (phiếu NHANSHIP), `…__s3.png` (phiếu BEPXANH15) | Phiếu cao 104–135px, thiết kế khoảng 88px. Nhãn gãy 2 dòng, mã xuống dòng. Dòng phụ lặp điều kiện và trộn hai cách ghi số: "Miễn phí giao hàng đơn từ 99.000đ · Đơn từ 99k · NHANSHIP". Phiếu cùng danh sách cao thấp khác nhau. Một phần do tên mã seed đã chứa điều kiện, nhưng admin thật cũng sẽ đặt tên như vậy. | `apps/miniapp/src/components/ui/voucher-ticket.tsx:60-70` (ghép tên · điều kiện · mã); `packages/app-core/src/commerce/voucher.ts:89-93` | Nhãn một dòng ("Giảm 15% · tối đa 45k"); bỏ điều kiện khi tên đã nói; một cách ghi số. |
| 19 | Ưu đãi (chưa đăng nhập) | mini375, web375 | `web375/offers__guest__web375__s2.png` (y≈380–590) | Sau Nhận mã chỉ còn một khối đăng nhập chung. Không khối nào vẽ `GuestLinkCard` như Q10; dải điểm, Mã của tôi, Đổi quà mất hẳn. Nhãn nút khác nhau: Mini "Đăng nhập ngay", web "Đăng nhập với Zalo". (Ảnh Mini persona guest là phiên Zalo chưa liên kết nên thấy khác; nhánh chưa đăng nhập của Mini dùng cùng kiểu khối chung.) | `apps/web/src/app/uu-dai/page.tsx:102-103`; `apps/miniapp/src/pages/offers.tsx:111-116` | Mỗi khối cần tài khoản vẽ `GuestLinkCard`; Đổi quà vẫn hiện; một nhãn nút chung. |
Ghi chú: lỗi cùng gốc đã gộp một dòng. #5 gộp 4 màn Mini; #18 gộp phiếu mã ở 3 màn.

## P2

| # | Màn | Khổ | Ảnh | Vấn đề | File nghi ngờ | Cách sửa |
|---|---|---|---|---|---|---|
| 1 | Bán chạy nhất | web375 | `web375/best-sellers__returning__web375__s5.png` | Có thêm "Trang sau ›" dưới "Xem thêm"; Mini không có. | `apps/web/src/components/catalog/numbered-pager.tsx:32` | Ẩn dưới md (giữ cho SEO bằng `sr-only`) hoặc khai lệch có chủ đích. |
| 2 | Hub Danh mục, Trang chủ | mọi khổ | `mini375/browse-hub__returning__mini375__s1.png`, `mini375/home__returning__mini375__s2.png` | Seed có 10 danh mục gốc (trần P16 là 8). Hub cắt còn 8 ô + "Tất cả"; Trang chủ ô "Tất cả" sang cột 6, bị lớp mờ che; web 1280 không có mũi tên. | `packages/app-core/src/browse/hub.ts:3`; `apps/miniapp/src/components/home/category-row.tsx:19,63`; `apps/web/src/components/home/category-row.tsx:68` | "Xem tất cả" ở tiêu đề khối; cột 6 ló ra mép; bật `arrows` ở lg. |
| 3 | Trang chủ | mọi khổ | `mini375/home__returning__mini375__s1.png` | Khách cũ không thấy Mua lại: món đã mua (Can 5L) cùng sản phẩm với món đang Giờ vàng (1L), chống trùng theo slug loại cả khối. | `apps/miniapp/src/pages/home.tsx:121`; `apps/web/src/components/home/home-view.tsx:154` | Chủ quyết: chống trùng theo phân loại. |
| 4 | Trang chủ | mọi khổ | `mini375/home__returning__mini375__s2.png` | Kệ Bán chạy hiện #1, #2, #4 (hạng 3 đang ở Giờ vàng). Mã cố ý giữ hạng thật, khách dễ tưởng lỗi. | `apps/miniapp/src/components/home/use-home-shelves.ts:67`; web `use-home-shelves.ts:93` | Chủ chọn: kệ có hạng không chống trùng, hoặc ẩn số hạng khi hụt. |
| 5 | Trang chủ | mọi khổ | `mini375/home__returning__mini375__s3.png` | "Hành trình nguyên liệu", "Cộng đồng hỏi đáp" dùng Fraunces; khối khác Inter 16/700. | `apps/miniapp/src/components/home/brand-journey.tsx:39`; `community-preview.tsx` (cả web) | Dùng `SectionHeader`. |
| 6 | Lưới SP | mọi khổ | `mini375/browse-parent__returning__mini375__s1.png` | Dòng thương hiệu "Fuwa3e" lặp ngay trên tên "…Fuwa3e". | `packages/app-core/src/commerce/product-card-view.ts:119` | Ẩn dòng thương hiệu khi tên đã chứa nó. |
| 7 | Trang chủ | 375 | `mini375/home__returning__mini375__s1.png` | Lời chào cắt "Chào Nguyễ…"; thanh đầu web 1280 lại ghi "Lại". | `apps/miniapp/src/components/home/member-card.tsx:88`; web `member-card.tsx:58` | Chào bằng tên gọi. |
| 8 | Trang chủ, hub | web1280 | `web1280/home__returning__web1280__s2.png` | Mũi tên "‹" mờ vẫn hiện ở đầu kệ, đè mép thẻ #1. | `apps/web/src/components/scroll-rail.tsx:8,23` | Ẩn khi chưa cuộn được. |
| 9 | Hub Danh mục | web1280 | `web1280/browse-hub__returning__web1280__s1.png` | h1 "Danh mục" rồi h2 "Danh mục". | `apps/web/src/components/catalog/browse-view.tsx:238`; `category-tiles.tsx:65` | Bỏ tiêu đề khối ở hub lg. |
| 10 | Bán chạy nhất | web1280 | `web1280/best-sellers__returning__web1280__s4.png` | Hàng tab dính hẹp hơn lưới, thẻ cuộn ló ra bên phải. | `apps/web/src/app/ban-chay/best-sellers-view.tsx` | Nền vùng dính rộng bằng khung. |
| 11 | PDP Giờ vàng | mọi khổ | `mini375/product-flash__returning__mini375__s1.png` | Rãnh thanh "Đã bán 68%" cùng màu nền dải nên không thấy rãnh. | `apps/miniapp/src/components/ui/flash-sold-bar.tsx:26`; `components/product/flash-price-bar.tsx:27` | Rãnh dùng `--color-track` khi nằm trên nền kem. |
| 12 | Giỏ | mọi khổ | `mini375/cart__returning__mini375__s1.png` | "Tiết kiệm 92.000đ" không gồm combo 65.250đ; màu xanh, ở PDP "Tiết kiệm" màu cam. | `packages/app-core/src/commerce/pdp-view.ts:14`; `cart.tsx:790-794` | Cộng combo hoặc đổi chữ; một màu deal. |
| 13 | Giỏ | web1280 | `web1280/cart__returning__web1280__s1.png` | Ghi "Tổng" cho số mà 375 gọi "Tạm tính (đã giảm)" (chưa gồm phí giao). | `apps/web/src/app/gio-hang/page.tsx:467,473` | Một nhãn. |
| 14 | Giỏ | web375 | `web375/cart__returning__web375__s1.png` | Nút "−" ở số lượng 1 vẫn bật (Mini khoá). Tên dòng đậm hơn Mini. | `apps/web/src/app/gio-hang/page.tsx:382` | Khoá khi `quantity <= 1`. |
| 15 | Giỏ | mini375 | `mini375/cart__returning__mini375__s1.png` | Ô chọn cách ảnh khoảng 30px (PL-19). Dùng token primitive. | `apps/miniapp/src/pages/cart.tsx:749,758` | Token semantic; cột 24 + gap 12. |
| 16 | PDP | mọi khổ | `mini375/product-flash__returning__mini375__s1.png` | "4.4 · 27 đánh giá" rồi "4,4 · 27": hai kiểu dấu thập phân. | `apps/miniapp/src/pages/product-detail.tsx:618`; `apps/web/src/app/san-pham/[slug]/pdp-sections.tsx:21,27` | Định dạng vi-VN. |
| 17 | PDP | mọi khổ | `mini375/product-flash__returning__mini375__s4.png` | Thuật ngữ cấm còn hiện: "Cùng nhà Fuwa3e", "nhận mã giảm khi đủ người" (đang trong `EXEMPT`). | `product-detail.tsx:1002-1004`; `pdp-rails.tsx:81`; `terminology.spec.ts` | "Cùng thương hiệu", "mã giảm giá"; hạ `max`. |
| 18 | PDP | 375 | `mini375/product-flash__returning__mini375__s2.png` | Vừa có dòng "Phân loại ›" vừa có chip; Số lượng bị Đánh giá nhanh tách khỏi phân loại (Mini). | `apps/miniapp/src/pages/product-detail.tsx:733-776` | Bỏ chip hoặc đặt Số lượng ngay dưới phân loại. |
| 19 | PDP | web1280 | `web1280/product-flash__returning__web1280__s1.png` | Cột thông tin không có giá Giờ vàng; dải Giờ vàng góc vuông dưới ảnh bo; phần dưới một cột hẹp; không có thanh mua thu gọn; thanh sao dài khoảng 1000px. | `apps/web/src/app/san-pham/[slug]/page.tsx:95-100`; `components/layouts/pdp-layout.tsx` | Làm nốt D-01 mục 4–5 của `web.md`. |
| 20 | PDP khách chưa đăng nhập | web375 | `web375/product-bundle__guest__web375__s5.png` … `s9` | "Có thể bạn cũng thích" web khoảng 20 món (bán chạy), Mini 7 món (for-you của phiên khách Zalo). Có lý do (web chưa đăng nhập không gọi được for-you). | `apps/web/src/app/san-pham/[slug]/pdp-rails.tsx:68-79` | Trần cùng số món với Mini; khai lệch nguồn trong `ds-map`. |
| 21 | Chiến dịch | web1280 | `web1280/campaign__guest__web1280__s1.png` | Ảnh đầu bị cắt còn khoảng 3,6:1 (`max-h-80` + `object-cover`). | `apps/web/src/components/campaign/campaign-body.tsx:72` | Giữ 5/2 bằng trần bề rộng. |
| 22 | Giờ vàng | mọi khổ | `mini375/flash-sale__returning__mini375__s1.png` | Nút "Mua ngay" dùng `--color-flash-solid-bg`; DESIGN.md ghi chỉ Badge và thanh tiến độ được dùng. | `apps/miniapp/src/components/ui/button.tsx:15` | Sửa DESIGN.md cho khớp hoặc đổi màu nút. |
| 23 | Thương hiệu | 375 | `mini375/brand-slug__guest__mini375__s1.png` (y≈470) | Phiếu chip cắt mất mã: "…với mã B…". | `apps/miniapp/src/pages/brand-view.tsx:243-251`; `packages/app-core/src/commerce/shop-page.ts:170-177` | Chip 2 dòng hoặc mã riêng cạnh nút. |
| 24 | Thương hiệu | web375 | `web375/brand-slug__guest__web375__s1.png` | Từ khối Câu chuyện trở xuống web thấp hơn Mini 22px (`min-h-11` chiếm chỗ thật). | `apps/web/src/components/shop-page/brand-body.tsx:157` | Nới vùng chạm kiểu `tubu-hit-44`. |
| 25 | Trình dựng: chi tiết khối | 375 | `mini375/storefront-block__ctv__mini375__s1.png` (nút "Lưu mức giảm") | Nút tắt hai app khác màu; Mini chữ be nhạt trên nền be khó đọc (SB-08 còn một phần). | `section-detail.tsx:81`; `apps/web/src/components/affiliate/storefront-section-detail.tsx:76`; `apps/web/src/lib/phone-ui.ts:4-5` | Một token cho nút phụ đang tắt. |
| 26 | Trình dựng | mini375 | `mini375/storefront__ctv__mini375__s1.png` | "Sắp xếp" hụt mép phải khoảng 30px (nút ghost ZaUI rộng tối thiểu 120px). | `apps/miniapp/src/pages/storefront-builder.tsx:682`; `section-detail.tsx:168` | Nút chữ không bề rộng tối thiểu. |
| 27 | Nút Mini có icon | mini375 | `mini375/storefront__ctv__mini375__s1.png` | Icon cao hơn chữ khoảng 4px, cách chữ khoảng 15px (Sửa hồ sơ, Cài đặt, Chia sẻ, Theo dõi). Web căn đúng. | `apps/miniapp/src/components/ui/button.tsx:86`; `css/tokens.css:581` | Căn giữa dọc, giảm khoảng cách trong `.tubu-btn .zaui-btn-icon`. |
| 28 | Trình dựng | mini375 | `mini375/storefront__ctv__mini375__s1.png` | Thanh dính đáy hai nút lệch bề rộng, cao 48 (web bằng nhau, 44). Đệm thẻ hồ sơ 12 vs 16. | `storefront-builder.tsx:720-748`; `sticky-action-bar.tsx:32-37` | `flex: 1 1 0` cho hai nút; thống nhất đệm. |
| 29 | Trình dựng | 375 | `web375/storefront__ctv__web375__s1.png` | "Thêm ảnh bìa" màu xanh như link nhưng không bấm được. | `storefront-builder.tsx:643` (Mini); web `storefront-builder.tsx:474` | Thành nút mở sheet hồ sơ, hoặc chữ gợi ý xám. |
| 30 | Trình dựng: chi tiết khối | 375 | `mini375/storefront-block__ctv__mini375__s2.png` | Hai lối lùi cạnh nhau; mỗi món hai nút chữ, hàng cao khoảng 113px (SB-02 một phần). | `section-detail.tsx:104-117,251` | Bỏ lối lùi thừa; "Bài đăng mẫu" vào menu ⋯. |
| 31 | Gian hàng, Thương hiệu (ShopTopBar) | web375 | `web375/s-slug__guest__web375__s2.png` | Tên shop trên thanh lệch phải 15px so với Mini (Mini chừa 96px cho nút Zalo, web 64px). | `apps/web/src/components/mini/shop-top-bar.tsx:33` | Chép đệm Mini hoặc khai lệch có chủ đích. |
| 32 | Ưu đãi | 375 | `mini375/offers__returning__mini375__s2.png` | Fraunces dưới 22px: "Điểm danh mỗi ngày", "35.400 điểm", tiêu đề GuestLinkCard (Q1). | `DailyCheckInCard`, `OffersPointsStrip`, `components/home/guest-link-card.tsx` | Inter 16/700. |
| 33 | Ưu đãi, Thương hiệu | mọi khổ | `mini375/offers__returning__mini375__s1.png` | Ba kiểu "xem tất cả": "Tất cả 3 mã" (đếm cả mã đã lưu, chỉ hiện 2), "Xem tất cả" (vẫn hiện khi rỗng), "Tất cả (16)". | `apps/miniapp/src/components/offers/offers-collect.tsx:74`; `offers.tsx:141` | Một mẫu chung, đếm đúng, ẩn khi rỗng. |
| 34 | Ưu đãi (guest Mini) | mini375 | `mini375/offers__guest__mini375__s3.png` | Hai nhãn cho cùng việc: "Liên kết Zalo" và "Đăng nhập Zalo"; ba nút sát nhau. | `offers.tsx:119`; `components/loyalty/guest-points-note.tsx:37` | Một nhãn; bỏ ghi chú trong thẻ khi đã có GuestLinkCard. |
| 35 | Trình dựng | web1280 | `web1280/storefront__ctv__web1280__s1.png` | Máy tính vẫn có thanh dính đáy, tràn khung 16px (D-12 cũ). Chi tiết khối bỏ trống cột phải. | `apps/web/src/components/affiliate/storefront-builder.tsx:539-541` | Từ lg đưa hai nút lên hàng tiêu đề. |
| 36 | Gian hàng CTV | web1280 | `web1280/s-slug__guest__web1280__s3.png` | ComboCard rộng 1152px, nút dài 1126px; kệ 4 thẻ dồn trái. | `apps/web/src/components/mini/shop-section.tsx:101` | Trần bề rộng ComboCard từ lg; kệ ít món vẽ thành lưới. |
| 37 | Ưu đãi | web1280 | `web1280/offers__returning__web1280__s1.png` | Banner cao 460px, đẩy Giờ vàng xuống đáy màn đầu. | `--banner-ratio` ở `packages/design-tokens/src/tokens.css:272` | Từ lg tỉ lệ khoảng 4:1 hoặc trần cao khoảng 280px. |
| 38 | Mọi màn web | web375 | `web375/storefront__ctv__web375__s2.png` | Web 375 có chân trang (Hotline, Điều khoản…), Mini không có; ở trình dựng thanh dính dừng trên chân trang, hở một dải. Có lẽ cố ý (trang web cần liên kết pháp lý). | khung trang chung của web | Ghi vào DESIGN.md là lệch có chủ đích, hoặc ẩn chân trang dưới md ở màn trong app. |

## Làm tốt

- Tiền đúng ở mọi chỗ đã soát: 14 giá Giờ vàng, % đã bán, combo 369.750đ / 234.960đ, combo gian hàng 335.700đ, mua kèm 69.000đ / 109.000đ (−27%), giỏ 953.750đ với dòng "Giảm giá combo −65.250đ".
- Web 375 trùng Mini gần từng px ở Trang chủ, Danh mục (hub, cha, con, tìm), gian hàng CTV, Ưu đãi, Giờ vàng, chiến dịch.
- Màn đầu Trang chủ có deal: banner, lối tắt 4 + Tất cả, Giờ vàng đồng hồ ô tối, cam không đỏ. Thứ tự khối đúng §5.
- Danh mục 2 tầng chạy đúng: cha "19 sản phẩm" = 9 + 6 + 4, chip mục con, SortBar dính một hàng, thẻ đều, giá 16/700 màu deal. Web 1280 có ListingLayout đủ (h1, breadcrumb, cột lọc, phân trang số).
- PDP: FlashPriceBar dưới ảnh, chip phân loại hiện giá Giờ vàng (lỗi PD-02 cũ đã sửa), Ưu đãi gom một dòng. Web 1280 nút "Mua ngay" nằm trong màn 1280×800 (P0 D-01 cũ đã sửa).
- Gian hàng đã ra dáng trang shop: ShopHeader 3 số, tab, ShopSection theo layout, ComboCard "Mua cả bộ". Trình dựng gọn: danh sách khối, Sắp xếp riêng, xem trước bằng chính ShopSection.

## Lỗi cũ đã sửa (so với ảnh 31/10)

Ảnh cũ ở `docs/2026-10-31-shop-redesign/screens/` của worktree tích hợp (`shop-redesign`, không có trong git).

- Trang chủ: HM-01 (màn đầu không có deal), HM-02 phần đồng hồ, HM-03 (lối tắt cắt chữ), HM-05, HM-08, CS-06 (mất lối vào giỏ khi cuộn). `mini375/home__returning__mini375__s1.png` cũ → mới.
- Danh mục: CS-01, CS-03 (thẻ lệch, "Đã bán" vỡ dòng, giá đen nhỏ), BR-01..03 (hai hàng điều khiển, tên danh mục lặp, gốc là lưới 129 món). `browse-category__…` cũ → `browse-parent__…`, `browse-all__…` cũ → `browse-hub__…`.
- PDP: PD-01, PD-02, PD-03, PD-05 (Mini), PD-06, PD-07; web D-01 (nút mua dưới đáy màn 1280), W-02, W-05. `product-slug__…` cũ → `product-flash__…`.
- Giỏ: CT-02 (giá gạch, Tiết kiệm; còn lỗi nguồn giá gạch ở P1 #6), CT-03; combo hiện trong giỏ.
- Gian hàng CTV: ST-01, ST-02, ST-03, ST-04, ST-07; web D-06, D-07.
- Trình dựng: SB-01, SB-03, SB-04, SB-05, SB-06; SB-02 và SB-08 một phần.
- Thương hiệu: BR-01..04 của critique-store.
- Ưu đãi: OF-01, OF-02, OF-04; web D-08 (`/uu-dai` hẹp trong khung tài khoản).
- PL-06: tiêu đề khối trang shop thôi dùng Fraunces.

Còn mở từ báo cáo đầu đợt: OF-03 (P1 #17), W-03/W-04/W-07 (P1 #11), W-06 phần chip (P1 #12), CT-04 (P1 #7), D-12 (P2 #35), PL-19 (P2 #15), SB-02 và SB-08 một phần.

## Không kiểm được

- Sheet phân loại, sheet chọn mã ("Mỗi đơn dùng 1 mã" có trong mã nhưng không nằm trên màn được chụp), tab Sản phẩm / Danh mục / Câu chuyện của trang shop, chế độ Sắp xếp đang bật.
- "Khách thường mua cùng" (seed không có dữ liệu mua cùng), chip danh mục Giờ vàng (cần ≥ 12 món một khung), món hết suất mờ cuối danh sách, dòng "Suất kế tiếp" ở Trang chủ (khung kế cách hơn 6 giờ), khối "Đã xem" ở hub.
- Trạng thái combo "Đã kết thúc" / "Tạm hết hàng", bậc CTV từ bậc 2, nhãn "Tất cả (n)" khi khối bị cắt.
- Báo giá, thanh toán, đặt đơn ra cùng 953.750đ: không chụp checkout.
- Tương phản tính bằng số, axe, thứ tự Tab, trình đọc màn hình: chỉ xem ảnh. Một reviewer thấy chữ đọc của giá có thể đọc đôi ("Giá Giờ vàng 26.000đ, giá gốc 35.000đ" và "Giá 26.000đ , giá gốc 35.000đ"), cần axe hoặc trình đọc màn hình kiểm.
- Ưu đãi web 1280 cho khách chưa đăng nhập, Trang chủ web 1280 cho khách chưa đăng nhập: không chụp.
