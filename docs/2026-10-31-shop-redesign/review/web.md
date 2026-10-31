# Review web responsive: gian hàng (2026-10-31)

Vai: design lead web responsive. Skill dùng: `design:design-critique`, `ui-ux-pro-max:ui-ux-pro-max` (nhóm Layout & Responsive, Touch, Navigation).
Mã: main 13536d955 (worktree `shop-redesign`). Chỉ đọc mã, không sửa.

Nguồn:
- 47 ô ảnh trong `screens/`. Tôi ghép từng cặp mini375 ↔ web375 cùng màn, cùng persona, cùng bước cuộn thành ảnh hai cột để so.
- Đo thêm trên lane 7 bằng Playwright qua `uat-harness/web-session.mjs` (script tạm ở scratchpad, không lưu vào repo, không bấm nút nào):
  - vị trí nút mua ở PDP khổ 1280×800 và 1440×900;
  - ảnh khổ 820×1180 và 1024×768 cho `/`, `/san-pham`, PDP.
- Không trùng với `design-system.md`: chỗ nào đã có ở đó (số đo thẻ Giờ vàng, cỡ chữ nhãn, bản `components/mini` không dùng, T1–T11), tôi chỉ dẫn mã DS-xx, không viết lại.

## 0. Kết luận

1. **Web khổ điện thoại đã khá giống Mini App.** Thanh đáy, ô tìm dính, bảng chọn phân loại (giống hệt), Ưu đãi (gần như trùng pixel), Giỏ và Dựng gian hàng đều khớp. Lệch còn lại tập trung ở bốn chỗ:
   - hàng sao/đã bán trên thẻ xuống dòng theo hai kiểu khác nhau;
   - khối giá Giờ vàng ở PDP;
   - PDP không có dải trắng cho từng khối và thiếu chip lọc đánh giá;
   - kiểu nút phụ (web dùng nút viền trắng, Mini dùng nền xanh nhạt).
2. **Web máy tính là chỗ yếu nhất.**
   - PDP để nút "Thêm vào giỏ"/"Mua ngay" dưới đáy màn, trong một cột có thanh cuộn riêng (đo: top 1020/1076px ở màn cao 800). **Đây là P0.**
   - Trang chủ máy tính chỉ là bản điện thoại kéo giãn.
   - Trang danh mục không hiện tên danh mục, cột lọc phải cuộn riêng.
   - Gian hàng và thương hiệu thiếu khung đầu kiểu shop.
3. **Nguyên nhân gốc.** Trang shop của web là thành phần máy tính chồng thêm lớp `max-md:` để giống Mini (`gio-hang/page.tsx` 24 lớp, `s/[slug]` 20, `brand/[slug]` 17, PDP 13). Mỗi thay đổi phải viết hai kiểu trong một className, nên hai khổ tự trôi lệch nhau. Không có khuôn trang máy tính chung.
4. **Cơ chế đề xuất (mục 4), bổ sung cho `design-system.md` mục C:**
   - khuôn trang máy tính dùng chung;
   - bài so bố cục ở cấp màn (T9 mới so ở cấp thành phần);
   - bài e2e chấp nhận cho khổ máy tính;
   - ảnh ghép cặp đính trong PR.

## 1. Đánh giá nhanh theo khung critique

| Khía cạnh | Web 375 | Web 1280 |
|---|---|---|
| Ấn tượng đầu | Giống Mini, gọn, màu thương hiệu nhất quán | Màn đầu Trang chủ là thẻ thành viên + "Chờ chuyển khoản" + 7 lối tắt, chưa có món hàng, chưa có điểm nhấn |
| Dùng được | Tốt; vài chỗ lệch nhỏ | PDP giấu nút mua; danh mục cuộn lồng; Gợi ý cuộn hết 129 SP mới tới chân trang |
| Thứ bậc | Như Mini | Ảnh PDP 720px lấn cột mua 408px; 6 phiếu mã đứng trước Phân loại và nút mua |
| Nhất quán | Nút phụ, chip mã, khối PDP khác Mini | Avatar gian hàng và bìa thương hiệu khác giữa hai khổ |
| Tiếp cận | Đủ 44px (đã có rào) | Hai thanh cuộn lồng nhau trong cột lọc; vùng cuộn ẩn khó dùng bằng bàn phím |

Làm tốt (giữ nguyên):
- Bảng chọn phân loại web375 trùng Mini (`extras/product-variant-picker__returning__{mini375,web375}.png`).
- Ưu đãi web375 trùng Mini (`offers__new__*__s1..s4`).
- Giỏ máy tính có cột tổng dính bên phải, đúng chuẩn (`web1280/cart__returning__web1280__s1.png`).
- Khung 1200px, 6 cột ở trang chủ/thương hiệu/gian hàng và 5 cột ở trang tìm kiếm khớp chuẩn Shopee web.
- Không có tràn ngang ở 820 và 1024 (scrollWidth = clientWidth).

## 2. Web375 ↔ Mini375: lệch theo từng cặp ảnh

Tên ảnh viết tắt: `X__p__s1` nghĩa là cặp `mini375/X__p__mini375__s1.png` ↔ `web375/X__p__web375__s1.png`.

| # | Mức | Màn | Ảnh | Lệch | Đề xuất |
|---|---|---|---|---|---|
| W-01 | P1 | Mọi lưới, kệ (Trang chủ, Danh mục, Thương hiệu, Gian hàng, PDP "Cùng nhà") | `browse-all__guest__s2`, `home__returning__s4`; máy tính: `web1280/browse-all__returning__web1280__s1.png`; đo thêm ở 820 | Hàng sao · đã bán xuống dòng theo hai kiểu. Web tách số lượt ra dòng riêng: "★ 4.4" / "(27)". Mini tách "· Đã bán" / "8,7k+". Thẻ cùng hàng vì thế lệch chiều cao và giá không thẳng hàng. Web: `components/product-card.tsx:84-97` (hai `span` tự xuống dòng, `md:justify-between`). Mini: `ui/product-tile.tsx:213-231` | Một dòng không xuống: `flex min-w-0 whitespace-nowrap overflow-hidden`, chữ dựng sẵn "★ 4,4 · Đã bán 8,7k+", bỏ "(27)" trên thẻ (số lượt đã có ở PDP). Thiếu chỗ thì cắt phần "Đã bán". Thêm `mt-auto` cho hàng giá để giá thẳng hàng trong cùng hàng lưới. Chuỗi meta sinh ở app-core (`productCardView.metaLine`, `design-system.md` B2) để hai app không tự ghép |
| W-02 | P1 | PDP, khối giá Giờ vàng | `product-slug__returning__s1` | Mini: giá … Đã bán 8,7k+ (một dòng) → Điểm → [-30%] [Còn 13h32m] Đã bán 68%. Web: nhãn "Giờ vàng -30%" nằm trong khối giá nên đẩy "Đã bán 8,7k+" xuống hai dòng, rồi Điểm, rồi [Còn 13h30m] Đã bán 68%. Hai thứ tự khác nhau. `san-pham/[slug]/page.tsx:117-122`, `components/flash-price.tsx:72-86` | Dưới md: ẩn nhãn trong `PdpPrice` (`max-md:hidden`), đưa chip "-30%" lên đầu hàng `PdpFlashMeta` như Mini, thêm `shrink-0 whitespace-nowrap` cho "Đã bán". Đợt làm Giờ vàng: thay cả hai bằng một dải Giờ vàng chung (nền flash, đồng hồ HH:MM:SS, % đã bán) đặt trên giá, cùng thành phần cho Mini và web |
| W-03 | P1 | PDP, nhịp khối | `product-slug__returning__s2`, `s3` | Mini chia trang thành từng dải trắng cách nhau 8px trên nền xám: Phân loại, Số lượng, Mua chung, Thành phần, Cam kết, Mô tả, Đánh giá. Web để các khối dưới nằm thẳng trên nền canvas, khoảng cách không đều (trước "Thành phần" có khoảng trống khoảng 40px). `page.tsx:181` (khung `max-md:px-4 max-md:py-6` không có nền) | Mỗi khối dưới md dùng dải bề mặt: `max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:py-4`, bỏ `py-6` của khung. Gắn `data-section="pdp-…"` cho bài so M-2 |
| W-04 | P1 | PDP, Đánh giá | `product-slug__returning__s3` | Web thiếu hàng chip lọc Tất cả / 5 sao / 4 sao / 3 sao / Có ảnh mà Mini có (`miniapp/components/reviews-section.tsx:184`). "Viết đánh giá" và "Xem thêm (22)" ở web là nút viền; ở Mini là link chữ màu thương hiệu (`product-reviews.tsx:163, 316`) | Chuyển logic lọc sang app-core (`reviewFilters(items, key)`), web vẽ bằng `components/mini` `Chip` trong `ScrollRow`. Dưới md hai nút thành nút chữ màu brand |
| W-05 | P1 | PDP, mã giảm | mini `s1` ↔ web `s1`/`s2` | Mini: chip một dòng "FREESHIP · Miễn phí giao hàng". Web: phiếu hai dòng có viền nét đứt và thêm dòng "Đơn từ 99.000đ", nên khối cao gấp đôi. `san-pham/[slug]/pdp-extras.tsx:121-133` | Dùng VoucherTicket `size=chip` (`design-system.md` B9): một dòng, bấm mở sheet chi tiết. Cùng thành phần ở Mini |
| W-06 | P2 | PDP, chip phân loại | `product-slug__returning__s2` | Web: "1L · 84.000đ Giờ vàng" một dòng, kèm dòng nâu giải thích giá. Mini: chip hai dòng "1L / 120.000đ". **Mini đang hiện sai giá**: 120.000đ là giá gốc, giá đang bán 84.000đ (`miniapp/pages/product-detail.tsx:1248` dùng `salePrice ?? retailPrice`, bỏ qua Giờ vàng). Web đúng (`add-to-cart.tsx:339-356` dùng `variationPricing`) | Mini gọi `variationPricing` của `@tubutree/app-core/flash-price` như web. Chốt một kiểu chip cho cả hai: hai dòng tên/giá, nhãn "Giờ vàng" nhỏ dưới giá |
| W-07 | P2 | Danh mục, Gian hàng, PDP | `browse-all__guest__s7`/`s8`, `s-slug__guest__s5`/`s6`, `product-slug__returning__s3` | Nút phụ khác kiểu. Web dùng `ui.btnSecondary` (nền trắng, viền stone-450) cho "Xem thêm", "Mở gian hàng", "Chat với Tubu Tree". Mini dùng nút phụ ZaUI nền xanh nhạt, không viền. "Xem thêm ở Tubu Tree" ở web là link đen gạch chân, ở Mini là chữ xanh. `lib/guest-ui.ts:21-22`, `catalog/browse-view.tsx:340` | Dưới md dùng `skin.btnSecondary` (`components/pro-shared/mini-skin.ts:9`) cho mọi nút phụ của trang shop, hoặc gom vào `mobile-skin.ts` theo DS-09. Link "Xem thêm ở…" dùng `text-[var(--color-text-brand)] no-underline` dưới md |
| W-08 | P2 | Trang chủ, khách vãng lai | `home__guest__s1`, `s2` | Mini guest thấy "Sắp diễn ra". Web vãng lai không thấy, vì Mini luôn có phiên khách `/auth/guest` còn web thì không. Query `enabled: authed` (`home/home-view.tsx:119`, `home/flash-sale.tsx:203, 221`), API `GET /flash-sales/upcoming` cần JWT (`flash-sale.controller.ts:20-21`). Người mới vào web mất một lý do để quay lại | API cho đọc `/upcoming` công khai (`reminded=false` khi không có phiên; ghi ở backend-gap). Web vãng lai vẫn hiện khối; bấm "Nhắc tôi" thì mở cổng đăng nhập (kiểu `coupon-claim-gate.tsx`) |
| W-09 | P2 | Thẻ Giờ vàng và Sắp diễn ra | `home__returning__s1`, `s2`; `home__new__s1` | Web 144px, có viền, tên 12px, tiêu đề 18px. Mini 132px, không viền, tiêu đề 16px. Mini cắt tên "…Lá…" còn web hiện đủ tên và phân loại | Đã có ở DS-02 và bảng A3 của `design-system.md`, làm theo đó (ProductTile `flash`) |
| W-10 | P2 | Giỏ | `cart__returning__s1` | Ở SL 1, nút "−" của Mini bị khoá (nền xám), web vẫn bật, nền trắng. Web tự vẽ ô −/+ (`gio-hang/page.tsx:31-32`) thay vì dùng QuantitySelector. Nhãn Giờ vàng: web "⚡ Giá Giờ vàng" nằm cạnh giá; Mini "⚡ Giờ vàng" và "Đã bán 98%" ở dòng dưới | Dưới md dùng `components/mini` `QuantitySelector`, khoá "−" ở SL 1 (xoá bằng thùng rác như Mini). Chữ nhãn theo ux-copy chốt |
| W-11 | P2 | Gian hàng, Thương hiệu | `s-slug__guest__s1`, `brand-slug__guest__s1` | "Tân binh": web có viền vàng, Mini nền nhạt không viền. Khối Khuyến mãi của thương hiệu: web viền cam nhạt, mã có biểu tượng chép nhưng không có chữ "chạm để chép"; Mini viền xanh có chữ đó | Gom vào Badge tông `verified`/`promo` và VoucherTicket (DS-06, B9) |
| W-12 | P2 | Danh mục | `browse-all__guest__web375__s7` | Dưới "Xem thêm" có thêm link "Trang sau ›" gạch chân (`catalog/browse-pager.tsx:20-30`, dùng cho crawler). Trên điện thoại là thêm một thứ để nhìn | Giữ link cho crawler, dưới md cho nhỏ lại: `max-md:text-caption max-md:no-underline max-md:text-[var(--color-text-tertiary)]` |
| — | Có chủ đích | Trang chủ "Mua lại", PDP | `home__returning__s1`, `product-slug__returning__s2` | Web có "Định kỳ -12%" và "Đặt định kỳ — tiết kiệm 12%", Mini không có: `packages/app-core/src/features.ts:16` `SUBSCRIPTIONS_IN_MINIAPP = false` | Không sửa. Ghi làm ngoại lệ trong `ds-map.json` để bài so bố cục (M-2) bỏ qua |
| — | Có chủ đích | Danh mục, Ưu đãi, Gian hàng | `…__web375__s7` / `s4` / `s6` | Web có chân trang (hotline, pháp lý) ở 375, Mini không | Giữ (pháp lý, SEO). Bài M-2 bỏ qua `footer` |

## 3. Web máy tính (1280) theo chuẩn Shopee web

### 3.1 Bảng chuẩn đề xuất

| Trang | Hiện tại | Đề xuất (lg ≥1024, khung `max-w-frame` 1200 giữ nguyên) |
|---|---|---|
| Header | Logo, ô tìm 672px, chuông, giỏ, tài khoản; hàng menu 7 mục. Ô tìm biến mất ở `/san-pham` | Giữ hai hàng. Ô tìm ở mọi trang (`/san-pham` dùng chính ô của header). Dưới ô tìm thêm dòng "Từ khoá hot" (cần API). Mục menu đang chọn có gạch chân 2px màu brand |
| Trang chủ | Cột dọc như điện thoại, không banner | Hàng 1: Banner (col 8) + cột phải (thẻ thành viên/quà khách mới + việc cần làm). Rồi Giờ vàng (thẻ trắng, đồng hồ, "Xem tất cả"), Danh mục 10 cột, Top bán chạy, Gợi ý 6 cột có giới hạn |
| Danh mục / tìm kiếm | Cột lọc 240 dính có thanh cuộn riêng, chip sắp xếp tròn, 5 cột, "Xem thêm" | Tiêu đề và breadcrumb theo danh mục. Cột lọc 200 cuộn theo trang. Thanh sắp xếp nền nhạt kèm số trang nhỏ. 5 cột. Phân trang số |
| PDP | Ảnh 720 / mua 408 dính có thanh cuộn riêng | Ảnh 440 / thông tin còn lại, không cuộn lồng, nút mua trong màn đầu. Dưới: nội dung (trái) + top của nhà (phải 280). Thanh mua thu gọn dính đầu trang khi nút chính khuất |
| Gian hàng / Thương hiệu | Bìa gradient hoặc không bìa, lưới 6 cột cho mọi mục | Một khung đầu shop chung (bìa phẳng, avatar, số liệu, nút). Thanh tab dính. Vẽ mục theo layout CTV chọn |
| Ưu đãi | Trong khung Tài khoản, cột 576px | Trang mua sắm rộng: hàng thẻ hạng + Điểm danh, lưới phiếu 2–3 cột có lọc theo loại |

### 3.2 Phát hiện

| # | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| D-01 | **P0** | PDP | `web1280/product-slug__returning__web1280__s1..s5`, `extras/product-variant-picker__returning__web1280.png`. Đo returning 1280×800: cột mua cao 658px, scrollHeight 1040; "Thêm vào giỏ" top=1020, "Mua ngay" top=1076. Ở 1440×900 giữ nguyên toạ độ. Guest 1280×800: "Mua ngay" top=816 | Nút mua nằm dưới đáy màn và trong một cột có thanh cuộn riêng, nên cuộn trang không làm nút hiện ra. Nguyên nhân:<br>• `san-pham/[slug]/page.tsx:87` `lg:grid-cols-[minmax(0,1fr)_400px]`: ảnh 720px, cột thông tin 408px;<br>• `:92` `lg:sticky … lg:max-h-[…] lg:overflow-y-auto`;<br>• `:169-173`: 6 phiếu mã (2 cột, cao 248px) và "Đặt định kỳ" đứng trước Phân loại, Số lượng, nút mua | 1. Lưới `lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-8` trong một thẻ `rounded-card bg-[var(--color-bg-surface)] p-6`.<br>2. Bỏ `sticky / max-h / overflow-y-auto` ở cột thông tin.<br>3. Thứ tự cột thông tin: nhãn hiệu → tên (font-display 24) → sao \| lượt đánh giá \| đã bán → dải Giờ vàng (W-02) → giá → điểm → mã giảm **một hàng ≤3 chip + "Xem tất cả mã"** (mở Sheet) → giao hàng → Phân loại → [SL] [Thêm vào giỏ (phụ)] [Mua ngay (chính)] cùng hàng → hàng phụ (Định kỳ, Mua chung, Bộ nội dung).<br>4. Dưới thẻ: `lg:grid-cols-[minmax(0,1fr)_280px]`; trái là Thành phần, Mô tả, Đánh giá (có chip lọc W-04); phải là "Cùng nhà Fuwa3e" dạng danh sách dọc top 5 bán chạy.<br>5. Thanh mua thu gọn (ảnh nhỏ, tên, giá, hai nút) dính dưới header khi nút chính ra khỏi màn (IntersectionObserver), bật từ md.<br>6. Bài e2e M-4: nút mua `toBeInViewport()` ở 1280×800 không cần cuộn |
| D-02 | P1 | Trang chủ | `web1280/home__returning__web1280__s1`, `s2`, `s13`, `s14` | Bản điện thoại kéo giãn:<br>• không banner;<br>• 7 lối tắt trải 1200px (biểu tượng 36px, khoảng trống lớn); 3 mục trùng hẳn menu ngang (Đổi rác, Mua chung, Cộng đồng), "Đổi quà" gần như trùng "Kho quà";<br>• "Mua lại" một thẻ chiếm nửa trái, nửa phải trống (`reorder/purchased-rail.tsx:207` `md:grid-cols-2`);<br>• Danh mục 10 ô nhỏ dồn trái;<br>• Gợi ý tự tải 12 món/lần (`SUGGEST_PAGE_SIZE`, `home-layout.ts:315`) tới hết 129 SP: 14 màn mới tới chân trang | Lưới 12 cột ở lg:<br>• Hàng 1: `BannerCarousel` col-span-8 (khoảng 776×320); col-span-4 xếp dọc thẻ thành viên hoặc Quà khách mới, Việc cần làm (bản gọn), Mua lại một dòng (ProductTile `line`).<br>• Lối tắt: `lg:hidden` (menu đã có); 3 mục không trùng (Đơn hàng, Mã của tôi, Kiếm tiền) chuyển vào menu tài khoản.<br>• Giờ vàng: thẻ trắng, đầu khối gồm tiêu đề + ô đồng hồ + "Xem tất cả ›" tới trang Giờ vàng mới.<br>• Danh mục: thẻ trắng `lg:grid-cols-10`, ô 96px, biểu tượng 56px.<br>• Top bán chạy theo danh mục (chức năng mới): tab danh mục, 6 thẻ có hạng 1–6.<br>• Gợi ý: tab dính dưới header; tự tải tối đa 4 trang (48 món) rồi nút "Xem thêm" dẫn tới `/san-pham?sort=…`. Thứ tự khối vẫn lấy từ `homeRenderOrder` của app-core, chỉ đổi cách xếp từ lg |
| D-03 | P1 | Danh mục, tìm kiếm | `web1280/browse-category__returning__web1280__s1`, `browse-search__returning__web1280__s1` | Tiêu đề máy tính luôn là "Danh mục", kể cả khi đang ở "Tẩy rửa sinh học" hay tìm "nuoc". Tên danh mục chỉ hiện dưới md (`catalog/browse-view.tsx:161` là `browseText.title`; `:248` `md:hidden`). Không có breadcrumb. Web375 hiện đúng tên | `h1` ở mọi khổ: tên danh mục, `Kết quả cho "nuoc"` hoặc "Tất cả sản phẩm". Từ md thêm breadcrumb Trang chủ › Danh mục › Tẩy rửa sinh học (dùng `BackLink crumbs` như PDP). Gộp hai tiêu đề thành một |
| D-04 | P1 | Danh mục | `web1280/browse-all__returning__web1280__s1`, `s3` | Cột lọc dính, có thanh cuộn riêng (`catalog/filter-sidebar.tsx:40` `lg:sticky lg:max-h-[…] lg:overflow-y-auto`), nhóm Thương hiệu lại cuộn riêng thêm một lớp (`:85` `max-h-56 overflow-y-auto`). Ở màn cao 800 chỉ thấy Danh mục và tiêu đề Khoảng giá; Tình trạng, ≥4 sao và Thương hiệu bị khuất | Cột lọc cuộn theo trang (bỏ sticky/max-h/overflow). Danh mục hiện 6 mục + "Thêm ▾" (mục đang chọn luôn hiện). Khoảng giá thêm hai ô Từ/Đến + "Áp dụng". Đánh giá thành hàng sao. Thương hiệu 6 + "Thêm", bỏ cuộn lồng. Độ rộng `xl:grid-cols-[200px_minmax(0,1fr)]` |
| D-05 | P1 | Danh mục | `web1280/browse-all__returning__web1280__s1`, `s3`, `s4` | Sắp xếp là chip tròn 44px như điện thoại. Không có số trang, chỉ "Xem thêm" + "Trang sau" | lg: thanh sắp xếp trong khối `rounded-card bg-[var(--color-bg-subtle)] h-14 px-4`: "Sắp xếp theo" + SegmentedTabs (Gợi ý, Bán chạy, Mới nhất) + chọn giá (tăng/giảm), bên phải "1/6 ‹ ›" (129 SP, `PAGE_LIMIT` 24 ở `lib/search-state.ts:105`). Cuối lưới `BrowsePager` hiện số trang 1 2 3 … 6 (đã có `?page=`, chỉ đổi cách hiển thị) thay "Xem thêm"; dưới md giữ "Xem thêm" |
| D-06 | P1 | Gian hàng `/s/:slug` | `web1280/s-slug__guest__web1280__s1..s4`; `web1280/storefront__ctv__web1280__s1` (màn dựng ghi "Cuộn ngang", "Lưới") | • Bìa gradient từ xanh sang gần đen (`s/[slug]/page.tsx:101`, `--sf-end: --color-bg-inverse`).<br>• Avatar máy tính là chữ "G", điện thoại là biểu tượng mầm (`:132-133`).<br>• Không có số liệu, tab, tìm trong shop.<br>• **Mọi bộ sưu tập vẽ cùng lưới** (`:276` `GRID_PRODUCTS`), bỏ qua `layout` GRID/CAROUSEL/STACK và `kind: COMBO` mà CTV chọn ở màn dựng. Mini cũng vậy: không file giao diện nào đọc `layout` (chỉ có kiểu ở `storefront-api.ts:21`, `app-core/api/storefront.ts:36`) | • Khung đầu shop là thẻ trắng: bìa phẳng `--sf-owner` (bỏ gradient), avatar cùng một kiểu ở mọi khổ, tên + nhãn, 3 số (Sản phẩm, Đã bán, Đánh giá TB tính từ items), nút Chia sẻ.<br>• Thanh tab dính: Nổi bật \| tên các bộ sưu tập, bấm thì cuộn tới mục.<br>• Vẽ theo layout: CAROUSEL → `ScrollRail` 6 thẻ; STACK → danh sách ProductTile `line`; COMBO → ComboCard (B10) có tổng giá và "Thêm cả combo"; GRID → 6 cột tối đa 2 hàng + "Xem tất cả".<br>• Làm cả ở Mini (một hàm `collectionView` ở app-core) |
| D-07 | P1 | Thương hiệu | `web1280/brand-slug__returning__web1280__s1..s3` | Máy tính không có bìa và không có logo khi nhãn chưa có ảnh: dải bìa và avatar dự phòng chỉ hiện dưới md (`brand/[slug]/page.tsx:53`, `:66-68`). "Theo dõi/Chia sẻ" nằm một hàng riêng bên phải. Danh sách SP không có sắp xếp hay lọc. Câu chuyện nằm cuối trang | Dùng chung khung đầu với gian hàng (một `StoreHeader` cho cả nhãn và CTV): bìa (`coverUrl` hoặc dải forest-700) ở mọi khổ, logo hoặc lá, tên + Chính hãng, tagline, số SP, đánh giá TB, nút cùng hàng với tên. Khuyến mãi là một hàng VoucherTicket (≤3 mỗi hàng). Sản phẩm có thanh sắp xếp (D-05), 6 cột, phân trang. Câu chuyện đặt thành tab "Câu chuyện" |
| D-08 | P1 | Ưu đãi | `web1280/offers__returning__web1280__s1..s4` | Trang nằm trong `AccountShell` (`uu-dai/layout.tsx`, noindex). Cột nội dung `md:max-w-xl` (576px; `uu-dai/page.tsx:140, 146`) nên khoảng 1/3 bề ngang trống. Phiếu xếp một cột, nút Sao chép/Dùng ngay dài khoảng 220px | Khi làm kho voucher + chiến dịch (brief mục 3): `/uu-dai` thành trang mua sắm `PAGE_WIDE`, bỏ AccountShell. Hàng đầu: thẻ hạng + Điểm danh 2 cột. "Mã giảm giá": lưới `lg:grid-cols-3` VoucherTicket ngang (cuống trái, nội dung, nút "Dùng" nhỏ), chip lọc Tất cả/Freeship/Giảm tiền/Của nhãn. Lối tắt chương trình thành lưới 3 cột |
| D-09 | P2 | Header | `web1280/browse-all__returning__web1280__s1` so với các trang khác | Ô tìm ở header ẩn trên `/san-pham` (`site-header.tsx:41-45`, có chủ đích), nên chỗ tìm kiếm nhảy giữa các trang. Mục menu đang chọn chỉ đổi màu chữ. Không có từ khoá gợi ý | Giữ ô tìm header ở mọi trang (`/san-pham` gắn gợi ý vào ô header và bỏ ô thứ hai). Mục đang chọn: `border-b-2 border-[var(--color-text-brand)]`. "Từ khoá hot" cần API (backend-gap) |
| D-10 | P2 | Khối Giờ vàng máy tính | `extras/home-flash-active__returning__web1280.png` | Thẻ cao thấp không đều: thẻ có `soldCount` 0 không có thanh tiến độ ("Toner diếp cá"), tên một dòng thì thẻ ngắn hơn. Nút mũi tên của kệ đè lên mép thẻ đầu. `home/flash-sale.tsx:139-148` | Luôn vẽ thanh (0% thì ghi "Vừa mở bán"). Tên `line-clamp-2` + chiều cao tối thiểu hai dòng; dòng phân loại luôn giữ chỗ. Mũi tên đặt ngoài lề kệ (`lg:-mx-5` + mũi tên `-left-5`) |
| D-11 | P2 | Tablet md 768–1023 | Đo 820×1180 và 1024×768 (`/`, `/san-pham`, PDP) | Không tràn ngang. Lưới 3 cột (820), 5 cột trang chủ và 4 cột danh mục (1024). Nhưng từ md không còn thanh đáy và thanh mua dính, nên ở PDP cuộn xuống phần đánh giá là mất nút mua. Hàng sao/đã bán vỡ dòng (W-01) cả ở 820 | Thanh mua thu gọn của D-01 bật từ md. W-01 sửa luôn phần vỡ dòng |
| D-12 | P2 | Dựng gian hàng máy tính | `web1280/storefront__ctv__web1280__s1` | Thanh "Xem trước / Chia sẻ" cố định ở đáy màn máy tính, che nội dung, không giống quy ước máy tính | Từ lg đưa hai nút lên hàng tiêu đề "Gian hàng của tôi" (bên phải), bỏ thanh đáy |

## 4. Cơ chế để màn làm sau vẫn khớp (phần web, bổ sung `design-system.md` mục C)

T1–T11 của `design-system.md` giữ khớp **thành phần** (thẻ, nhãn, giá) ở 375. Phần dưới lo **bố cục màn** và **khổ máy tính**, là hai chỗ đang lệch nhiều nhất.

| # | Thêm gì | File | Kiểm gì | Chạy |
|---|---|---|---|---|
| M-1 | Khuôn trang máy tính | `apps/web/src/components/layout/{listing-layout,pdp-layout,store-layout,hub-layout}.tsx` + hằng ở `lib/page-frame.ts` | Mỗi khuôn nhận slot, ví dụ `<ListingLayout title crumbs sidebar toolbar grid pager />`. Khuôn tự lo md/lg (cột, độ rộng, sticky). Dưới md khuôn chỉ xếp dọc các slot; phần trông giống Mini nằm ở thành phần Mini trong slot, không nằm ở lớp `max-md:` của trang. Bốn khuôn: Hub (trang chủ, ưu đãi, chiến dịch), Listing (danh mục, tìm kiếm, Giờ vàng, Top bán chạy), PDP, Store (gian hàng, thương hiệu) | Mọi trang shop mới bắt buộc dùng |
| M-2 | Bài so bố cục cấp màn mini375 ↔ web375 | `apps/e2e/tests/screen-parity.shop.spec.ts`; gắn `data-section="<id>"` cho các khối ở cả hai app | Với mỗi cặp route lane shop trong `route-map.json`, mở Mini (bộ khung `miniapp-session`) và web (`web-session`) ở 375×812, cùng persona và dữ liệu. Đọc danh sách `[data-section]` theo thứ tự (id, top, height, màu nền), so: **cùng thứ tự**, khoảng cách giữa khối lệch ≤4px, cùng loại nền (dải trắng hay canvas). Ngoại lệ có chủ đích (Định kỳ, chân trang) khai trong `ds-map.json` (`"exceptions"`). Bắt được những lỗi kiểu W-02, W-03, W-04, W-08 | `pnpm --filter @tubutree/e2e exec playwright test screen-parity` trong `e2e.yml` |
| M-3 | Bài chấp nhận cho khổ máy tính | `apps/e2e/tests/desktop-layout.shop.spec.ts` | Ở 1280×800:<br>(a) nút mua PDP `toBeInViewport()` khi chưa cuộn;<br>(b) trong `main` không phần tử nào có `overflow-y:auto` mà `scrollHeight > clientHeight`, trừ sheet và kệ ngang (cấm cuộn lồng);<br>(c) Trang chủ: tối đa 8 lần cuộn là thấy chân trang;<br>(d) `h1` của `/san-pham?category=X` bằng tên danh mục;<br>(e) `scrollWidth === clientWidth` ở 820, 1024, 1280 | như M-2 |
| M-4 | Bánh cóc `max-md:` | `apps/web/src/ds-v2-guest.spec.ts` thêm khối SHOP_LAYOUT | Đếm `max-md:` theo file shop (`app/{page,san-pham/**,s/**,brand/**,uu-dai/**,gio-hang/**}`), không được tăng so với `scripts/uiux/ds-baseline.json`. File mới ở `app/{gio-vang,chien-dich,top-ban-chay}/**` phải bằng 0 (dùng khuôn M-1 + `components/mini`) | `pnpm --filter @tubutree/web test` |
| M-5 | Ảnh ghép cặp trong PR | `scripts/uiux/pair-shots.mjs` (dựa trên `screens/capture-shop.mjs`, ghép bằng `sharp` có sẵn trong repo) | Chụp các route bị PR chạm ở mini375, web375, web1280, rồi ghép mini \| web theo từng bước cuộn vào `docs/<đợt>/pairs/`. Mục "Giao diện" trong PR template (C4 của design-system) thêm dòng: "đính ảnh ghép cặp của màn shop đã đổi" | tay, trước khi mở PR |
| M-6 | Khai khuôn trong `ds-map.json` | `packages/app-core/src/ds-map.json` (C1 của design-system) thêm khoá `screens` | `{ "/product/:slug": { "web": "app/san-pham/[slug]/page.tsx", "desktop": "PdpLayout", "sections": ["pdp-gallery","pdp-price","pdp-variants",…] } }`. `scripts/check-ds-parity.mjs` (T6) đỏ khi màn shop thiếu dòng này hoặc khai `desktop` mà file không import khuôn đó | `pnpm lint:parity` |

Thêm vào `AGENTS.md`, mục hai nền tảng, một dòng: "Màn shop mới: dùng khuôn M-1, khai `screens` trong `ds-map.json`, chạy `screen-parity` + `desktop-layout`, đính ảnh ghép cặp."

## 5. Thứ tự làm đề xuất (phần web)

1. D-01 PDP máy tính (P0), kèm bài M-3(a)(b).
2. W-01 hàng meta của thẻ (cả hai app, chuỗi lấy từ app-core).
3. Nhóm PDP 375: W-02, W-03, W-04, W-05. Gắn `data-section`, dựng M-2 cho PDP trước.
4. Danh mục máy tính: D-03, D-04, D-05, kèm khuôn `ListingLayout` (M-1).
5. Khung đầu chung cho gian hàng và thương hiệu (D-06, D-07), vẽ theo layout và combo (cùng Mini).
6. Trang chủ máy tính D-02: cần Banner (ia-merch) và Top bán chạy (backend-gap).
7. D-08 Ưu đãi rộng, làm cùng kho voucher.
8. Các mục P2.

## 6. Câu hỏi cho chủ (kèm mặc định)

| # | Câu hỏi | Mặc định nếu không trả lời |
|---|---|---|
| Q1 | Trang chủ máy tính có ẩn hàng lối tắt (3 mục trùng menu ngang) không? | Ẩn từ lg; Đơn hàng, Mã của tôi, Kiếm tiền chuyển vào menu tài khoản |
| Q2 | `/uu-dai` có rời khung Tài khoản để thành trang mua sắm rộng (kho voucher + chiến dịch) không? | Có, làm cùng đợt kho voucher |
| Q3 | Danh mục máy tính có dùng phân trang số thay "Xem thêm" không? | Có ở lg; điện thoại giữ "Xem thêm" |
| Q4 | "Gợi ý hôm nay" ở máy tính có dừng tự tải sau 48 món không? | Có, sau đó nút "Xem thêm" dẫn sang `/san-pham` |
| Q5 | Thẻ sản phẩm có bỏ số lượt đánh giá "(27)", chỉ giữ "★ 4,4 · Đã bán 8,7k+" không? | Bỏ trên thẻ, giữ ở PDP |
