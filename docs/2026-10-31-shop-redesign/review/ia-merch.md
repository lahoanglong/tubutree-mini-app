# Review kiến trúc thông tin + merchandising (ia-merch), 2026-10-31

Người review: agent ia-merch (vai merchandising TMĐT + product). Mã: nhánh `shop/2026-10-31-redesign` = main `13536d955`.
Cách làm: đọc mã các màn trong phạm vi (Mini App trước, web đối chiếu), đọc API liên quan, so với mẫu Shopee / Lazada / TikTok Shop / Tiki / Zalo Mini App bán lẻ (tìm web, nguồn cuối bài). Kỹ năng đã dùng: `ecc:product-lens` (chẩn đoán, ICE), `ecc:competitive-platform-analysis` (chọn đối chiếu), `design:user-research` (persona + heuristic, không phỏng vấn thật).
Giới hạn: lúc viết chưa có ảnh trong `screens/` (agent chụp chưa xong), nên bằng chứng là `file:dòng`. Không đọc PROD; số "111 SP" lấy từ `docs/2026-10-28-review/03-perf-build.md:106`.

## 0. Kết luận ngắn

1. "Rối" không phải do có quá nhiều kệ ở Trang chủ (chỉ 3–4 kệ hàng). Nó đến từ 5 chỗ: (a) danh mục phẳng và có thể thiếu dữ liệu, nên mọi lối duyệt rơi về một lưới 111 SP; (b) các kệ không có số món tối đa, cũng không có "Xem tất cả" dẫn tới trang riêng (Giờ vàng, Sắp diễn ra, bộ sưu tập gian hàng, dải nhãn hàng); (c) các khối không loại món trùng nhau; (d) mọi khối hàng có cùng một hình thức (lưới 2 cột hoặc kệ thẻ giống hệt), còn cài đặt bố cục mà CTV chọn thì bị bỏ qua; (e) chưa có công cụ để kể câu chuyện cho hàng: không banner, không trang chiến dịch, không hệ nhãn, combo đã có ở máy chủ nhưng khách không thấy.
2. P0 duy nhất là một việc về dữ liệu: gán danh mục (có danh mục con) cho cả 111 SP. Chưa làm việc này thì mọi đề xuất về Danh mục, Top bán chạy theo danh mục hay Gợi ý theo danh mục đều không có tác dụng.
3. Nên làm theo thứ tự ICE: sửa nhanh bố cục (giới hạn món, chống trùng, "Xem tất cả") → hub Danh mục + thanh công cụ dính → hệ nhãn thẻ + "Gợi ý hôm nay" → cho khách thấy combo đang có → trang Giờ vàng theo khung giờ → khung trang shop dùng chung cho gian hàng CTV và nhãn hàng → Top bán chạy → banner → kho voucher → trang chiến dịch → combo cấp sàn → mua kèm deal sốc.
4. Cơ chế để màn làm sau vẫn khớp (mục 7): mọi khối hàng khai báo trong một sổ đăng ký kệ ở `app-core`, có hàm chống trùng chung, nhãn thẻ tính ở một hàm chung, và có spec chặn CI khi kệ mới vi phạm luật (thiếu số món tối đa, thiếu đích "Xem tất cả", vượt số kệ cho phép).

---

## A. Hiện trạng: khối, kệ, số món, logic chọn, trùng lặp

### A1. Trang chủ (`packages/app-core/src/home-layout.ts:20-29`, `apps/miniapp/src/pages/home.tsx:100-140`)

| Khối | Khách mới | Khách cũ | Nguồn / logic chọn | Số món | Bằng chứng |
|---|---|---|---|---|---|
| Ô tìm (dính) | ✓ | ✓ | vỏ, mở `/browse?focus=search` | — | `home.tsx:178` |
| Thẻ thành viên / dải Quà khách mới | dải quà | thẻ | loyalty / new-customer-offer | — | `home.tsx:110-120` |
| Việc cần làm | ✓ | ✓ | đơn chờ, giao… | 0–2 dòng | `todo-strip.tsx` |
| Lối tắt (1 hàng cuộn) | ✓ | ✓ | `HOME_SHORTCUTS` theo cờ | ≤ 8 ô | `home-layout.ts:129-138` |
| Mua lại | — | ✓ | SP đã nhận | 10 | `reorder/purchased-rail.tsx:42` |
| Giờ vàng + Sắp diễn ra | ✓ | ✓ | mọi item của mọi suất đang chạy; suất sắp tới (cần đăng nhập) | **không giới hạn**, 2 kệ liền nhau | `flash-sale.tsx:135`, `:315` |
| Danh mục (1 hàng) | ✓ | ✓ | danh mục có hàng, phẳng | mọi danh mục | `category-row.tsx` |
| Bán chạy | ✓ | — | `sort=best_seller` (đã bán trọn đời) | 6 | `best-seller-rail.tsx:13` |
| Hành trình nguyên liệu | ✓ | ✓ | thẻ bản đồ + chip **mọi** nhãn | không giới hạn chip | `brand-journey.tsx:55` |
| Cộng đồng | ✓ | ✓ | 2 bài | 2 | `community-preview.tsx:15` |
| Gợi ý cho bạn (vô tận) | ✓ | ✓ | 3 chip: Cho bạn (for-you 10 + catalog theo `isFeatured`) / Bán chạy / Mới | 12 mỗi trang | `suggest-feed.tsx:21-33`, `home-layout.ts:308-316` |

Trùng lặp đang có:
- Khách mới thấy kệ "Bán chạy" (6 món, `sort=best_seller`), rồi chip "Bán chạy" của lưới Gợi ý dùng **đúng nguồn đó** (`home-layout.ts:310`). Chip mặc định "Cho bạn" (sắp theo `isFeatured`, rồi đã bán) cũng lặp lại phần lớn 6 món này.
- Món Giờ vàng xuất hiện lại trong Bán chạy và Gợi ý. Giá giờ vàng đã thống nhất trên thẻ (`catalog-grid.tsx:27`), nhưng món thì vẫn lặp.
- `dedupeAgainst` có sẵn (`apps/miniapp/src/components/home/home-blocks.ts:26`, bản web `apps/web/src/components/home/home-blocks.ts:25`) nhưng **không nơi nào gọi**.
- Với khách vãng lai, "Cho bạn" chỉ là thứ tự mặc định của catalog: `personal = []` khi chưa đăng nhập (`suggest-feed.tsx:32`). Tên chip hứa cá nhân hoá nhưng không làm.

### A2. Danh mục + tìm (`apps/miniapp/src/pages/browse.tsx`)

- Trang gốc (không có `q`, không có danh mục) gồm: lưới Danh mục → Đã xem gần đây → chip sắp xếp → đầu kết quả → **lưới toàn bộ catalog, 30 món mỗi trang, có nút "Xem thêm"** (`browse.tsx:36`, `:245-330`). Với 111 SP, đây là "bức tường" dài khoảng 55 hàng thẻ.
- Chỉ ô tìm dính (`browse.tsx:39`). Chip sắp xếp và nút Lọc cuộn mất theo trang (`browse.tsx:254`).
- Danh mục phẳng: schema có `Category.parentId` (`apps/api/prisma/schema.prisma:851-862`) và DTO cũng trả về (`apps/miniapp/src/services/shop-api.ts:401`), nhưng API `categories()` không dựng cây (`catalog.service.ts:582-600`), còn client vẽ mọi danh mục ngang hàng (`use-categories.ts:47-53`).
- Dữ liệu danh mục: "Đồng bộ Pancake KHÔNG ghi `categoryIds`" (`catalog.service.ts:578`). Gán danh mục chỉ làm được bằng tay ở Admin (`product-category-admin.service.ts:11`). Khi không danh mục nào có hàng, app lùi về 4 "phân khúc" suy từ tên SP (`use-categories.ts:43-46`).
- Đã có từ trước (không báo lại): khi chọn danh mục thì có tiêu đề và hàng chip danh mục (R-89 đã sửa, `browse.tsx:168`, `:224-244`).
- Ô gợi ý khi chưa gõ chỉ có lịch sử tìm của chính khách, chưa có từ khoá phổ biến hay danh mục nóng (`suggest-list.tsx:47-48`).

### A3. Chi tiết SP (`apps/miniapp/src/pages/product-detail.tsx`)

Thứ tự hiện tại: ảnh → nhãn, tên, sao, đã bán, giá → giờ vàng → dòng giao hàng / freeship → **dải 6 mã giảm (chạm để chép)** (`:621-622`) → định kỳ → phân loại → số lượng → mua chung → CTV → thành phần → cam kết → mô tả → đánh giá → **"Thường mua kèm" 6 món** (`:938`) → **"Cùng nhà {brand}" 8 món** (`:964`).
- "Thường mua kèm" chỉ để xem, không có nút "thêm cả hai", và nằm sau phần đánh giá.
- `related()` không có `orderBy`, nên 8 món trả về theo thứ tự tuỳ ý của DB (`catalog.service.ts:431-441`).
- `boughtTogether()` đếm cả đơn đã huỷ (không lọc trạng thái đơn) (`catalog.service.ts:452-466`).
- Không có thẻ "cửa hàng / nhãn" để dẫn sang trang shop; chỉ có tên nhãn nhỏ ở đầu trang.

### A4. Gian hàng CTV / đối tác `/s/:slug` + màn dựng `/storefront`

- API trả về mỗi bộ sưu tập kèm `kind` (NORMAL / COMBO), `layout` (GRID / CAROUSEL / STACK), `comboDiscountPct` (`storefront.service.ts:365`). Checkout giảm combo thật (`combo.service.ts:29-54`).
- Mini (`storefront-view.tsx:142-160`) và web (`apps/web/src/app/s/[slug]/page.tsx:264-289`) đều **bỏ qua cả 3 trường**: mọi bộ sưu tập thành lưới 2 cột với toàn bộ món, không có số món tối đa, không có "Xem tất cả", không có nhãn combo.
- Màn dựng trên Mini không có chỗ chọn bố cục, cũng không tạo được combo (`storefront-builder.tsx:214`, chỉ có `createCollection({ title })`). Web thì có (`apps/web/src/components/affiliate/storefront-rules.ts:4-5`, `storefront-builder.tsx:347-354`). Đây là lệch giữa hai nền tảng.
- Không có tab, không có ô tìm hay sắp xếp trong shop, không có voucher shop. Món ghim (`isPinned`) không được làm nổi ở trang khách.

### A5. Trang thương hiệu `/brand/:slug` (`apps/miniapp/src/pages/brand-view.tsx`)

- Thứ tự: đầu trang → khối chia sẻ cho CTV → chứng nhận → khuyến mãi (thẻ có mã, chạm để chép) → **lưới "Sản phẩm" một khối** (`:258`) → chương trình đại lý → câu chuyện.
- API cắt **cứng 30 SP** mà không báo và không có link "Xem tất cả" (`apps/api/src/modules/brand/brand.service.ts:112-117`). Nhãn có trên 30 SP thì món thứ 31 trở đi không tới được từ trang nhãn.
- Truy vấn SP của nhãn chỉ lọc `isActive`, không dùng `PUBLIC_PRODUCT_WHERE` (thiếu `approvalStatus: 'APPROVED'`, xem `catalog/public-product.ts:11-14`). **Chưa xác minh** được có SP chờ duyệt nào gắn `brandId` hay không; để agent backend-gap kiểm.

### A6. Ưu đãi `/offers` (`apps/miniapp/src/pages/offers.tsx`)

- Đây là trang của điểm và quà: thẻ Điểm Xanh → Điểm danh → Đổi quà và tiện ích → Mã của tôi (danh sách dọc, không chia nhóm) (`:111-258`).
- Không có nội dung mua sắm (Giờ vàng, mã đang phát, combo). Khách vãng lai chỉ thấy màn mời đăng nhập (`:105`; `route-map.json` để `/offers` ở chế độ `private: true`).
- Máy chủ chưa có danh sách mã công khai để khách "Lưu". Cơ chế lưu mã đã có ở `CouponClaim` nhưng chỉ dùng cho mã ẩn qua link `?claim=` (`schema.prisma:1359-1360`, `:1404-1414`).

### A7. Giờ vàng

- Model `FlashSale` có `startAt` / `endAt` tự do, không có khái niệm khung giờ (`schema.prisma:791-804`). Chưa có trang riêng hay route riêng. Trang chủ vẽ mọi món đang chạy thành một kệ, rồi thêm kệ "Sắp diễn ra" (chỉ khi đã đăng nhập).
- Admin thêm món bằng `variationId` (`docs/flash-sale-QA-guide.md:20-30`).

---

## B. Chẩn đoán: vì sao "rối, quá nhiều SP dàn trải" với shop trên 100 SP

Persona dùng để chấm (suy từ mã và spec; không phỏng vấn):
- **Lan, mẹ bỉm 30 tuổi**, vào từ link CTV gửi qua Zalo. Việc cần làm: tìm nhanh đúng loại an toàn cho bé và tin được. Lan cần danh mục rõ, nhãn tin cậy, combo tiết kiệm.
- **Hùng, khách quen**, mua lại cà phê và nước giặt. Việc cần làm: mua lại trong 3 chạm và bắt được deal. Hùng cần Mua lại, Giờ vàng có giờ cụ thể, và voucher gom một chỗ.
- **Thảo, CTV**. Việc cần làm: gian hàng gọn, có combo để chốt đơn, dễ chia sẻ. Thảo cần bố cục bộ sưu tập có tác dụng thật, combo hiện rõ, shop có tab.

| # | Nguyên nhân gốc | Heuristic vi phạm | Bằng chứng | Ai bị ảnh hưởng |
|---|---|---|---|---|
| B1 | Không có tầng phân loại dùng được: danh mục phẳng, có thể thiếu dữ liệu. Mọi lối duyệt rơi về "tất cả 111 SP". | Nhận ra thay vì nhớ; khớp với thế giới thực | A2 | Lan |
| B2 | Không có "ngân sách món" mỗi khối, "Xem tất cả" không có trang đích: kệ dài vô hạn | Tối giản; người dùng kiểm soát | `flash-sale.tsx:135,315`; `storefront-view.tsx:146`; `brand-journey.tsx:55` | cả 3 |
| B3 | Không chống trùng: cùng món lặp ở 2–3 khối, thấy "nhiều mà không mới" | Nhất quán; tối giản | A1 (dedupe không được gọi) | Lan, Hùng |
| B4 | Một hình thức cho mọi khối: thiếu điểm nhấn và thứ bậc thị giác; `layout` bị bỏ qua | Thứ bậc thị giác | A4 | Thảo, Lan |
| B5 | Thiếu công cụ merchandising: chỉ có cờ `isFeatured`. Không banner, không chiến dịch, không bộ sưu tập cấp sàn, combo thì ẩn | — (lỗ hổng sản phẩm) | `schema.prisma:419-490` (Product), A4 | chủ shop |
| B6 | Thẻ SP không có hệ nhãn theo luật: mỗi nơi tự truyền `badge`. Tín hiệu "đáng mua" yếu và không đều | Nhất quán | `product-tile.tsx:39-51`, `catalog-grid.tsx:34-41`, `product-card.tsx:34-41` | Lan |
| B7 | Ưu đãi chỉ phục vụ điểm và quà, deal mua sắm nằm rải rác (dải mã ở PDP, khuyến mãi ở trang nhãn, Giờ vàng ở Trang chủ) | Khớp mô hình tư duy "săn deal" | A6 | Hùng |

---

## C0. Phát hiện (theo mức)

| ID | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất cụ thể |
|---|---|---|---|---|---|
| IA-01 | **P0** | Danh mục (mọi màn duyệt) | `catalog.service.ts:578`; `use-categories.ts:43-53`; `schema.prisma:851-862` | Đồng bộ Pancake không ghi danh mục; cây danh mục có trong schema nhưng không dùng. Thiếu bước này thì mọi IA bên dưới không có tác dụng. | (1) Chủ / admin: chốt cây 2 tầng (gợi ý ở C2) và gán mọi SP vào **lá** bằng Admin > "Danh mục sản phẩm" (đã có gán hàng loạt). Đích: 0 SP đang bán thiếu danh mục. (2) Mã: `categories()` trả thêm `children` và `productCount` đã cộng cả con; lọc `category=<cha>` khớp cả SP của con (`categoryIds hasSome [cha, ...con]`). (3) Thêm khoá hộp việc admin "SP đang bán chưa có danh mục (n)" (nối R-73). |
| IA-02 | P1 | `/browse` gốc | `browse.tsx:245-330` | Gốc đổ cả catalog thành một lưới dưới lưới danh mục | Gốc thành **hub**, không có lưới SP (xem C2). Lưới chỉ hiện khi đã có `q`, danh mục, nhãn, hoặc chọn "Tất cả sản phẩm". |
| IA-03 | P1 | `/browse` danh sách | `browse.tsx:39`, `:254` | Chip sắp xếp và nút Lọc cuộn mất; khách ở sâu trong lưới không đổi được cách xem | Thanh công cụ dính ngay dưới ô tìm (cao 44px, nền `--color-bg-canvas`): `SegmentedTabs scroll` 4 mục "Phổ biến · Bán chạy · Mới · Giá" (bấm "Giá" lần hai thì đảo chiều) + nút "Lọc (n)". Dùng `SegmentedTabs`, `Chip` có sẵn. |
| IA-04 | P1 | Trang chủ | `home-blocks.ts:26` không được gọi; `home-layout.ts:310` | Món lặp giữa Giờ vàng, Bán chạy, Gợi ý | Dùng luật chống trùng chung (C1-R3) qua `applyShelfDedupe` trong app-core. Bỏ chip "Bán chạy" khỏi lưới Gợi ý (xem D2). |
| IA-05 | P1 | Trang chủ, Giờ vàng | `flash-sale.tsx:135`, `:273-330` | Kệ Giờ vàng không giới hạn số món, không có "Xem tất cả", không có trang riêng. "Sắp diễn ra" là một kệ cỡ đầy đủ thứ hai | Kệ tối đa 8 thẻ, thêm thẻ cuối "Xem tất cả" → `/flash-sale`. Bỏ kệ "Sắp diễn ra" ở Trang chủ; thay bằng một dòng dưới tiêu đề khi chưa có suất chạy: "Suất kế tiếp 20:00 · Nhắc tôi" (xem D1). |
| IA-06 | P1 | `/s/:slug` (Mini + web) | `storefront-view.tsx:142-160`; `apps/web/src/app/s/[slug]/page.tsx:264-289`; `storefront.service.ts:365` | Bỏ qua `layout`, `kind=COMBO`, `comboDiscountPct`; mọi bộ sưu tập dàn hết món. Khách không biết combo có giảm | Khung trang shop dùng chung (C4). Vẽ theo `layout`: CAROUSEL → kệ tối đa 10 + "Xem tất cả"; GRID → lưới tối đa 6 + "Xem tất cả (n)"; STACK → dạng dòng tối đa 5. COMBO → thẻ combo (D4). |
| IA-07 | P1 | `/storefront` (Mini) | `storefront-builder.tsx:214` | Mini không chọn được bố cục, không tạo được combo (web có) | Đưa `LAYOUT_LABEL`, `KIND_LABEL` từ `apps/web/src/components/affiliate/storefront-rules.ts` lên `packages/app-core/src/storefront-order.ts` (hoặc file mới `storefront-rules.ts`) để hai app dùng chung. Sheet "Sửa bộ sưu tập" có `SegmentedTabs` bố cục + công tắc "Combo giảm giá" + ô % (giới hạn như `clampComboPct`). |
| IA-08 | P1 | `/brand/:slug` | `brand.service.ts:115`; `brand-view.tsx:258` | Cắt 30 SP mà không báo; không sắp xếp, không tab; câu chuyện nằm cuối | Dùng khung trang shop (C4): tab "Sản phẩm (n)" phân trang qua `/products?brand=<tên>`, vì catalog đã lọc theo nhãn. Thêm tab "Câu chuyện". API trả `productCount` thật. |
| IA-09 | P1 | `/offers` | `offers.tsx:105`, `:230-258`; `route-map.json:32` | Không có deal mua sắm; khách vãng lai gặp ngõ cụt | Bố cục mới (C6): phần công khai "Giờ vàng hôm nay" + "Mã đang phát" hiện cả khi chưa đăng nhập ("Lưu" mới đòi đăng nhập). Mã của tôi chia tab Tất cả / Giảm giá / Freeship / Sắp hết hạn. |
| IA-10 | P1 | Chi tiết SP | `product-detail.tsx:938-980` | Mua kèm nằm cuối, chỉ để xem; không có combo gần chỗ quyết định mua | Thứ tự mới ở C3: khối "Combo ưu đãi" và "Mua kèm deal sốc" đặt ngay dưới số lượng (D4). "Thường mua kèm" chỉ hiện khi SP không có combo hay deal mua kèm nào. |
| IA-11 | P2 | Chi tiết SP | `product-detail.tsx:621-622` | 6 mã nằm thành dải ngang chiếm chỗ ở vùng giá | Gộp thành một dòng tóm tắt "3 mã giảm · Freeship ›" mở `BottomSheet` danh sách mã có nút "Lưu" / "Chép". |
| IA-12 | P2 | Chi tiết SP | `product-detail.tsx` (chưa có) | Không có lối sang trang shop hay nhãn | Thêm thẻ shop sau khối cam kết: logo, tên, "Chính hãng", số SP, ★, nút "Xem shop" (chỉ khi nhãn `isPublished` hoặc SP thuộc gian hàng công khai). Dùng `Card`, `Badge`, `Button variant="secondary"`. |
| IA-13 | P2 | API gợi ý | `catalog.service.ts:431-441`, `:452-466` | `related()` không sắp xếp; `boughtTogether()` đếm cả đơn huỷ | `related`: `orderBy` theo đã bán giảm dần, rồi `id`. `boughtTogether`: lọc `o.status NOT IN ('CANCELLED', ...)` theo enum thật. |
| IA-14 | P2 | Trang chủ | `brand-journey.tsx:55` | Dải chip vẽ mọi nhãn | Tối đa 8 nhãn (sắp theo số SP) + chip "Tất cả nhãn" → `/browse?view=brands` (hub nhãn ở C2). |
| IA-15 | P2 | Tìm | `suggest-list.tsx:47-48` | Ô tìm trống chỉ có lịch sử | Thêm "Tìm nhiều" (8 từ khoá từ sự kiện `search_performed` 7 ngày, có lọc; admin ghim hoặc ẩn được) + "Danh mục nổi bật" (4). Cần endpoint mới `/search/trending`. |
| IA-16 | P2 | Bán chạy | `catalog.service.ts:184-199`; `schema.prisma:448-449` | Xếp theo tổng đã bán trọn đời, gồm cả `soldExternal` do admin nhập, nên bảng xếp hạng gần như đứng yên | Cột mới `sold30d` (cron đêm, tính trên đơn đã giao trong 30 ngày) có index; Top bán chạy dùng `sold30d`, hoà thì so trọn đời. Gộp với hướng xử lý của R-81 (`soldTotal`). |
| IA-17 | P2 | Gợi ý | `suggest-feed.tsx:32` | Khách vãng lai thấy chip "Cho bạn" mà không có cá nhân hoá | Đổi tên khối thành "Gợi ý hôm nay", bỏ chip "Cho bạn" (xem D2). |
| IA-18 | P2 | Thẻ SP | `product-card.tsx` (dùng ở gian hàng, nhãn) và `catalog-grid.tsx` `CatalogTile` | Hai vỏ thẻ chép logic giá và nhãn của nhau | Gộp về một `CatalogTile` nhận `listSource`; nhãn lấy từ `tileLabels()` (D2). |
| IA-19 | P2 | Trang nhãn (API) | `brand.service.ts:112-113` | Thiếu `approvalStatus` trong truy vấn SP công khai (**chưa xác minh** có gây lộ hay không) | Dùng `PUBLIC_PRODUCT_WHERE`. |

---

## C. Kiến trúc thông tin mới

### C1. Luật chung (áp cho mọi màn, mã hoá ở app-core: mục 7)

- **R1 Mỗi khối một ý định**, tiêu đề nói thẳng ý định đó ("Giờ vàng", "Top bán chạy", "Gợi ý hôm nay", "Combo tiết kiệm").
- **R2 Ngân sách món**:

  | Dạng | Tối đa | Tối thiểu để hiện | Thành phần |
  |---|---|---|---|
  | kệ ngang | 10 thẻ + thẻ "Xem tất cả" | 3 | `ScrollRow` + `CatalogTile` (rộng 156, như `best-seller-rail.tsx:14`) |
  | lưới trong trang tổng hợp | 6 (3 hàng × 2) | 4 | `CatalogGrid` |
  | danh sách dòng | 5 | 2 | `ProductTile variant="line"` |
  | lưới vô tận | 20 mỗi trang; tự tải 3 trang đầu rồi chuyển sang nút "Xem thêm"; dừng ở 100 món với câu kết + lối sang Danh mục | — | `CatalogGrid` |

  Lưới vô tận theo kiểu lai: tải cuộn một đoạn đầu rồi dùng nút, đúng hướng nghiên cứu Baymard (xem nguồn).
- **R3 Chống trùng theo thứ tự ưu tiên** trên cùng một màn: Giờ vàng > Mua lại > Combo > Top bán chạy > Mới về > Gợi ý hôm nay. Khối đứng sau loại các món đã hiện ở khối đứng trước (theo product id). Riêng giá giờ vàng vẫn hiện trên thẻ ở mọi khối (đã có).
- **R4 Ẩn hẳn khối** khi dưới mức tối thiểu ở R2. Không để lại tiêu đề trơ.
- **R5 "Xem tất cả" luôn có đích**: trang đích mang cùng tiêu đề và cùng nguồn dữ liệu, khai trong `route-map.json`.
- **R6 Trang chủ có tối đa 4 khối hàng**, không tính lưới vô tận.
- **R7 Màn đầu ở 375px** phải có ít nhất một hàng thẻ SP hoặc một banner deal. R-3 đã đạt phần lớn; không làm hỏng điều này.

### C2. Danh mục `/browse`

**Cây danh mục gợi ý** (chủ chốt; ánh xạ được với 4 phân khúc `forSegment` hiện có và 7 danh mục seed, `seed.ts:411-419`):

| Tầng 1 | Tầng 2 (ví dụ) |
|---|---|
| Mẹ & bé | Tắm gội bé · Giặt xả đồ bé · Bình sữa & vệ sinh · Mẹ bầu |
| Nhà sạch | Nước giặt · Nước rửa chén · Lau sàn · Tẩy rửa đa năng |
| Chăm sóc da | Rửa mặt · Dưỡng · Chống nắng · Mặt nạ |
| Chăm sóc cá nhân | Tóc · Răng miệng · Cơ thể |
| Thực phẩm & đồ uống | Cà phê · Trà · Nông sản |
| Sống xanh | Đồ dùng tái sử dụng · Quà tặng |

Tầng 1 tối đa 8, tầng 2 tối đa 8 cho mỗi tầng 1. Mỗi SP gán vào lá. `forSegment` ánh xạ sang tầng 1 để bỏ nhánh lùi về phân khúc khi đã có dữ liệu.

**Gốc (hub, không có lưới SP)**:

| # | Khối | Ý định | Tối đa | Nguồn | Ẩn khi |
|---|---|---|---|---|---|
| 1 | Ô tìm + giỏ (dính) | tìm | — | có sẵn | — |
| 2 | Lưới danh mục tầng 1 | chọn nhu cầu | 8 ô (2 × 4) + ô "Tất cả SP" | `categories` | lỗi thì lùi về phân khúc |
| 3 | Đã xem gần đây | quay lại món đã xem | 10 | có sẵn | chưa xem gì |
| 4 | Top bán chạy (link thẻ) | xã hội chứng thực | kệ 10, có số hạng | D1 | < 3 món |
| 5 | Thương hiệu | duyệt theo nhãn | 12 logo (lưới 4 × 3) + "Tất cả nhãn" | `/brands` (thêm `logoUrl`) | < 4 nhãn |
| 6 | Nút "Xem tất cả sản phẩm" | lối thoát | — | → chế độ danh sách không lọc | — |

**Danh sách** (đã có `q`, danh mục, nhãn, hoặc "Tất cả"):

| # | Khối | Ghi chú |
|---|---|---|
| 1 | Ô tìm + giỏ (dính) | có sẵn |
| 2 | Thanh công cụ dính: sắp xếp + "Lọc (n)" | IA-03 |
| 3 | Tiêu đề danh mục + chip tầng 2 (hoặc chip anh em khi đang ở lá) | thay `CategoryChips` phẳng hiện nay |
| 4 | Banner danh mục (tuỳ chọn, `placement=CATEGORY:<id>`) | D3; ẩn khi không có |
| 5 | Đầu kết quả + chip lọc đang bật | có sẵn |
| 6 | Lưới 2 cột, 20 mỗi trang, tải lai | R2 |

Web từ `md` trở lên: cây danh mục thành cột trái dính (240px), bộ lọc mở sẵn ở cột trái, lưới 4–5 cột.

### C3. Chi tiết SP (thứ tự mới ở 375px)

| # | Khối | Thay đổi |
|---|---|---|
| 1 | Ảnh | giữ |
| 2 | Giá + thanh Giờ vàng (%, đếm ngược, đã bán %) | giữ |
| 3 | Tên, ★, đã bán | giữ |
| 4 | Dòng tóm tắt ưu đãi: "3 mã · Freeship từ 199k ›" | IA-11, mở sheet |
| 5 | Phân loại + số lượng | giữ |
| 6 | **Combo ưu đãi** (tối đa 2 combo) | mới, D4 |
| 7 | **Mua kèm deal sốc** (tối đa 3 món) | mới, D4 |
| 8 | Giao hàng & cam kết (gộp dòng giao hàng, freeship, cam kết) | gộp lại |
| 9 | Mua chung / Kiếm tiền CTV | giữ, có điều kiện |
| 10 | **Thẻ shop / nhãn** | mới, IA-12 |
| 11 | Thành phần → Mô tả → Đánh giá | giữ |
| 12 | Thường mua kèm (6) | chỉ khi khối 6 và 7 đều trống |
| 13 | Cùng nhà {brand} (8, sắp theo đã bán) | IA-13 |
| 14 | Có thể bạn cũng thích (lưới, cùng danh mục, 20 + nút) | P2, dùng chung hàm của "Gợi ý hôm nay" |

Chống trùng giữa khối 12, 13 và 14: loại SP đang xem và các món đã hiện ở khối đứng trên.

### C4. Khung trang shop dùng chung: gian hàng CTV, gian hàng đối tác, nhãn hàng

Thành phần mới `ShopPage` (Mini: `components/shop-page/`; web: `components/shop-page/`), xây trên `StorePageShell` có sẵn (`store-page-shell.tsx:23`). Hợp đồng dữ liệu đặt ở `packages/app-core/src/shop-page.ts`.

1. **Đầu shop**: ảnh bìa (84–96px), avatar, tên, huy hiệu (giữ luật `trustBadgeLabel`), dòng 3 số "n SP · ★ 4,8 · n người theo dõi", nút "Theo dõi" (nhãn) hoặc "Chia sẻ" (chủ gian hàng).
2. **Voucher shop**: tối đa 3 thẻ mã ngang + "Xem tất cả"; nút "Lưu" (D3). Nhãn lấy từ `BrandPromotion.couponCode` sẵn có; gian hàng lấy từ mã gắn `applyTo.storefrontId`.
3. **Tab dính** (`SegmentedTabs`): **Shop** | **Sản phẩm (n)** | **Danh mục** | (nhãn có thêm) **Câu chuyện**.
   - *Shop*: "Nổi bật" (món ghim `isPinned`, kệ tối đa 10) → các bộ sưu tập theo thứ tự chủ xếp, vẽ theo `layout` và ngân sách R2 → combo vẽ bằng thẻ combo (D4). Bộ sưu tập dưới 3 món thì vẽ dạng dòng.
   - *Sản phẩm*: mọi SP của shop (bỏ trùng giữa các bộ sưu tập) + thanh sắp xếp dính "Phổ biến · Mới · Bán chạy · Giá" + lưới 20 mỗi trang. API mới: `GET /storefront/:slug/products?sort&page`. Nhãn dùng `/products?brands=<tên>`.
   - *Danh mục*: danh sách bộ sưu tập kèm số món → mở tab Sản phẩm đã lọc.
   - *Câu chuyện* (nhãn): xuất xứ + nút bản đồ, chứng nhận, câu chuyện, ảnh, chương trình đại lý (chuyển xuống đây từ thân trang).
4. Cuối trang: "Xem thêm ở Tubu Tree" (giữ quyết định R-61, không có nút dính đẩy khách ra ngoài).

**Màn dựng** `/storefront`: thêm chọn bố cục và combo (IA-07). Khi bộ sưu tập dạng kệ có trên 10 món, hiện cảnh báo nhẹ: "Khách thấy 10 món đầu ở tab Shop; các món còn lại ở tab Sản phẩm". Thêm "Xem như khách" mở `/s/:slug`.

### C5. Trang chủ (thứ tự mới, sửa trong `home-layout.ts`)

Khách mới: `search → welcome → todo → shortcuts → banner* → flash → categories → topSellers → combos* → journey → community → suggest`
Khách cũ: `search → member → todo → shortcuts → banner* → purchased → flash → categories → topSellers → journey → community → suggest`
(* khối mới, tự ẩn khi không có dữ liệu)

| Khối | Ý định | Tối đa | Nguồn | Chống trùng (R3) | Ẩn khi |
|---|---|---|---|---|---|
| banner | chiến dịch đang chạy | 5 slide | `Banner placement=HOME_TOP` theo đối tượng | — | 0 banner |
| purchased | mua lại | 10 | có sẵn | ưu tiên 2 | khách mới |
| flash | deal có hạn | 8 + "Xem tất cả" | suất đang chạy | ưu tiên 1 | không có suất chạy và không có suất trong 6 giờ tới |
| categories | chọn nhu cầu | tầng 1 (≤ 8) + "Tất cả" | C2 | — | lỗi + không dữ liệu |
| topSellers (thay bestSellers) | xã hội chứng thực | 10, có số hạng | D1 `sold30d` | ưu tiên 4 | < 3 |
| combos | mua nhiều tiết kiệm | 4 thẻ combo | `PromoBundle` + combo của nhãn | ưu tiên 3 | < 2 combo |
| journey | câu chuyện nhãn | 1 thẻ + 8 chip | có sẵn (IA-14) | — | — |
| community | hỏi đáp | 2 | có sẵn | — | — |
| suggest → "Gợi ý hôm nay" | khám phá | vô tận (R2) | D2 | loại mọi id đã hiện phía trên | — |

Đếm khối hàng (R6): khách mới có flash + top + combos (+ lưới vô tận); khách cũ có purchased + flash + top (+ lưới vô tận). Cả hai trong giới hạn 4.
Lưu ý chiều cao khung chờ: banner và combos thêm vào `HOME_SETTLING_HEIGHTS` và dùng gợi ý "lần trước có hay không" giống `FLASH_HINT_KEY` (`home-layout.ts:431-458`), để không làm hỏng việc giữ CLS ~0 đã đạt ở R-2.

### C6. Ưu đãi `/offers`

| # | Khối | Đăng nhập | Ghi chú |
|---|---|---|---|
| 1 | Banner `placement=OFFERS_TOP` | không cần | D3 |
| 2 | Giờ vàng hôm nay: dải khung giờ thu gọn + 4 món + "Xem tất cả" | không cần | D1 |
| 3 | Mã đang phát (Lưu) | xem không cần, Lưu cần | D3 |
| 4 | Thẻ Điểm Xanh + Điểm danh | cần | giữ |
| 5 | Mã của tôi, tab Tất cả / Giảm giá / Freeship / Sắp hết hạn | cần | `SegmentedTabs` |
| 6 | Đổi quà & tiện ích | cần | giữ |

`route-map.json`: `/offers` thành `private: false`; các khối 4–6 vẽ `GuestLinkCard` khi chưa đăng nhập.

---

## D. Đặc tả chức năng

### D1. Giờ vàng theo khung giờ + Top bán chạy

**Hành vi khách**
- Trang `/flash-sale` (Mini) và `/gio-vang` (web), khai trong `route-map.json`, công khai.
- Đầu trang: tiêu đề "Giờ vàng" + đồng hồ của suất đang chạy (`useCountdown`, `serverNow`).
- Dải tab khung giờ dính: tối đa 5 tab theo `startAt` trong hôm nay và ngày mai. Nhãn hai dòng: giờ ("12:00") + trạng thái ("Đang diễn ra" / "Sắp diễn ra" / "Ngày mai"). Suất đã hết không thành tab; sau 0h chỉ còn tab ngày mới. Mở trang thì tự chọn tab "Đang diễn ra", không có thì chọn suất sớm nhất.
- Chip danh mục tầng 1 chỉ hiện khi suất có từ 12 món trở lên.
- Món vẽ dạng dòng (`ProductTile variant="line"`, ảnh 96px): giá giờ vàng, giá gạch, -%, `ProgressBar tone="flash"` + chữ "Đã bán 67%". Từ 80% trở lên thì chữ "Sắp hết". Hết suất thì phủ mờ + "Đã bán hết", xuống cuối danh sách. Nút "Mua ngay" (đang chạy) hoặc "Nhắc tôi / Đã nhắc" (sắp tới; dùng API nhắc có sẵn).
- Trang chủ: kệ 8 thẻ đầu của suất đang chạy, sắp theo % giảm giảm dần + thẻ "Xem tất cả". Không có suất chạy mà có suất trong 6 giờ tới thì chỉ hiện tiêu đề + dòng "Suất kế tiếp 20:00" + nút "Nhắc tôi cả suất" (nhắc mọi món của suất).

**Quy tắc**
- Khung giờ là cấu hình `flashsale.slots` (mặc định `["12:00-14:00","20:00-22:00"]`), sửa trong Admin. Lý do chọn ít khung: kho 111 SP. Theo các nguồn đọc được, Shopee mở 6 khung (0/9/12/15/18/21h) chủ yếu vào ngày hội, ngày thường 3 khung (nguồn không thống nhất, xem cuối bài). Chia 6 khung với kho nhỏ sẽ làm mỗi khung còn 1–2 món.
- Mỗi suất từ 4 đến 12 món (admin bị chặn khi lưu ngoài khoảng này). Mỗi biến thể chỉ ở một suất còn hạn (giữ `assertNoItemClash`).
- Hai suất không chồng giờ (thêm kiểm khi tạo).

**Trạng thái**: đang tải (khung chờ cao bằng thật), không có suất trong 24 giờ ("Chưa có Giờ vàng hôm nay" + kệ Top bán chạy làm lối đi tiếp), lỗi (`HomeBlockError`), khách vãng lai bấm Nhắc (mời đăng nhập, sau đăng nhập tự đặt nhắc).

**API**: `GET /flash-sales/schedule?from&to` (công khai): danh sách suất kèm món, không có `reminded`. `GET /flash-sales/reminders` (cần đăng nhập): danh sách `itemId` đã nhắc. Endpoint `upcoming` hiện tại giữ cho bản cũ.

**Admin** (tab "Giờ vàng" có sẵn): (1) nút "Tạo suất theo khung giờ cho n ngày" sinh `FlashSale` theo `flashsale.slots`; (2) chọn món bằng tìm tên SP rồi chọn phân loại (dùng `product-picker.tsx` có sẵn), không gõ `variationId`; (3) cột "đã bán / suất" sống; (4) xem trước dạng thẻ.

**Top bán chạy**
- Trang `/top` (web `/ban-chay`): chip danh mục tầng 1 (Tất cả + ≤ 8), danh sách dòng xếp hạng 1–20. Hạng 1–3 có huy hiệu số dùng `--color-flash-solid-bg` / `--color-promo-solid-bg`, hạng 4–20 dùng `Badge tone="neutral"`. Dòng phụ "Đã bán {n} trong 30 ngày".
- Nguồn: `sold30d` (IA-16), lọc theo cây danh mục. SP có `sold30d < 3` không vào bảng. Bảng dưới 5 món thì lùi về đã bán trọn đời và đổi phụ đề thành "Bán chạy nhất".
- Kệ Trang chủ "Top bán chạy" = 10 món đầu của "Tất cả".

**Đo**: CTR kệ Giờ vàng; % phiên vào `/flash-sale`; tỉ lệ đặt nhắc → mua; tỉ lệ bán hết của suất.

### D2. Nhãn thẻ + "Gợi ý hôm nay"

**Hệ nhãn** (hàm chung `tileLabels(product, ctx)` trong `packages/app-core/src/product-badges.ts`, cả hai app vẽ từ kết quả của hàm):

| Vị trí | Tối đa | Thứ tự ưu tiên | Điều kiện | Token / thành phần |
|---|---|---|---|---|
| Góc trên-trái ảnh | 1 nhãn khuyến mãi + 1 nhãn "Mới" | Giờ vàng -x% > -x% | đang có (giữ luật hết hàng không hiện) | `Badge tone="promo"` / flash solid; "Mới" `tone="brand"` (có sẵn) |
| Dải nhãn dưới tên (mới, cao 18px) | 2 | Combo -x% > Tubu chọn > Yêu thích > Freeship | xem dưới | `Badge size="sm" tone="neutral"`, viền `--color-border-subtle` |
| Dòng phụ | — | ★ 4,8 (n) · Đã bán 1,2k | có sẵn | có sẵn |

- **Tubu chọn**: `isFeatured = true` (admin đã bật được, `product-edit-drawer.tsx:139`). Không dùng chữ "Mall" hay "Yêu thích" cho cờ này, vì đó là tên chương trình người bán của Shopee và khách dễ hiểu nhầm.
- **Yêu thích**: `reviewCount ≥ 10` và `ratingAvg ≥ 4,8`. Hai ngưỡng là cấu hình `catalog.badge_loved_min_reviews`, `catalog.badge_loved_min_rating`. Agent ux-copy nên chốt chữ cuối (gợi ý: "Khách khen").
- **Freeship**: chỉ khi **một đơn vị** đã đạt ngưỡng (giá đang bán ≥ `freeshipThreshold`, ngưỡng chung cho khách vãng lai, ngưỡng theo hạng khi đã đăng nhập), hoặc hàng của gian hàng đối tác có `freeShipFrom ≤` giá. Không dán "Freeship" lên mọi thẻ chỉ vì có chương trình miễn phí giao theo ngưỡng đơn: hứa sai là mất tin.
- **Combo -x%**: SP thuộc một combo đang chạy (D4).
- Thẻ dạng dòng (`line`/`list`) không có dải nhãn, giữ quy tắc hiện tại (`product-tile.tsx:87-90`).
- Khung chờ: dải nhãn luôn giữ chỗ 18px (kể cả khi trống) để `TILE_BODY_HEIGHT` không đổi theo dữ liệu. Cập nhật `catalog-grid.tsx:76-84`.

**"Gợi ý hôm nay"** (thay khối Gợi ý hiện nay):
- Tiêu đề "Gợi ý hôm nay". Chip đổi từ cách sắp xếp sang **danh mục**: "Tất cả" + tối đa 4 danh mục tầng 1 có nhiều SP nhất. Cách sắp xếp đã nằm ở Danh mục, chip "Bán chạy" thì trùng kệ Top.
- Nguồn "Tất cả": (đã đăng nhập) for-you 10 món lên đầu → phần còn lại của catalog xếp theo `hash(productId + ngày VN + userId|deviceId)` để mỗi ngày một thứ tự khác mà vẫn ổn định trong ngày. Không quá 2 món liền nhau cùng nhãn. Loại id đã hiện ở các khối trên (R3) và SP hết hàng.
- Phân trang theo R2 (20; tự tải 3 trang đầu rồi nút; dừng ở 100 món: "Bạn đã xem hết gợi ý hôm nay" + nút "Vào Danh mục").
- API: `GET /products/daily?seed=<yyyy-mm-dd>&category&page&exclude=<ids>`. Máy chủ xếp thứ tự để hai nền tảng giống nhau và trang không lệch nhau.

### D3. Banner + trang chiến dịch + kho voucher

**Banner**
- Model mới `Banner { id, placement (HOME_TOP | OFFERS_TOP | BROWSE_TOP | CATEGORY), categoryId?, imageMobile, imageDesktop?, alt, linkKind (CAMPAIGN | PRODUCT | CATEGORY | BRAND | FLASH | URL_INTERNAL), linkTarget, audience (ALL | NEW | RETURNING), startAt, endAt, sortOrder, isActive }`.
- Hiển thị: tỉ lệ 3:1 (343×114 ở 375px; web `md+` 1200×300), bo `--radius-card`, tối đa 5 slide, tự chuyển 5 giây (tắt khi `prefers-reduced-motion`, dừng khi chạm), có chấm chỉ vị trí và nhãn đọc "Banner 2 trên 4". Mỗi slide là một link có `alt` bắt buộc. Chỉ có 1 banner thì không có chấm, không tự chuyển.
- Cần thành phần mới `BannerCarousel` (Mini + web), xây trên `ScrollRow` + scroll-snap, không thêm thư viện.
- Admin tab "Banner" (nhóm MARKETING): tải ảnh (dùng `image-url-field.tsx`), chọn đích bằng picker (SP, danh mục, nhãn, chiến dịch), xem trước 375 và 1280, lịch chạy, cảnh báo khi ảnh sai tỉ lệ.

**Trang chiến dịch**
- Route `/c/:slug` (Mini và web, công khai). Model `Campaign { slug, title, heroImage, accent (chỉ chọn trong bảng token: forest, clay, amber, rose), startAt, endAt, sections Json }`.
- `sections` là danh sách có thứ tự gồm các loại: `vouchers {couponIds}`, `flash {flashSaleId}`, `products {source: manual ids | category | brand | tag, layout: rail | grid, max}`, `bundles {bundleIds}`, `banner {bannerId}`, `text {md}`. Mỗi loại vẽ bằng khối đã có và tuân R2, R3.
- Hết hạn: trang vẫn mở nhưng có dải "Chương trình đã kết thúc", ẩn mã và suất, giữ lưới SP (link chia sẻ cũ không thành ngõ cụt).
- Admin tab "Chiến dịch": tạo, thêm và xếp section, xem trước, lấy link chia sẻ (link Mini App, theo R-67).

**Kho voucher**
- Mã đang phát: `Coupon.isListed` (cột mới) với scope `CLAIM`. "Lưu" gọi `POST /coupons/claim` có sẵn. `GET /coupons/listed` công khai trả mã còn hạn, còn lượt, kèm `claimed` khi đã đăng nhập.
- Thẻ mã dùng `CouponCard` có sẵn, thêm nút phải "Lưu" / "Đã lưu" / "Dùng" (mở `/browse` đã lọc theo `applyTo`, hoặc mở giỏ).
- Nhóm: Tất cả / Giảm giá / Freeship / Của shop (mã có `applyTo.storefrontId` hoặc `brandId`). "Sắp hết hạn" dùng `isCouponExpiring` có sẵn (`home-layout.ts:181`).
- Voucher shop (C4) và dòng tóm tắt ở PDP (IA-11) lấy cùng nguồn này, lọc theo SP / shop.
- Admin (tab Mã giảm giá có sẵn): công tắc "Hiện ở Kho voucher", chọn "Áp cho gian hàng / nhãn".

### D4. Combo + mua kèm giảm giá

**Combo**
- Mức 1 (dùng cái đã có, làm trước): vẽ bộ sưu tập `COMBO` của gian hàng thành **thẻ combo**: dải 2–5 ảnh nhỏ nối bằng dấu "+", tiêu đề, "Mua cả bộ -{pct}% · Tiết kiệm {số tiền}đ" (tính trên giá đang bán của phân loại mặc định, cùng hàm giá `cardPricing`), nút "Thêm cả combo". Nếu có món nhiều phân loại thì mở `VariationSheet` lần lượt từng món, rồi thêm tất cả. Món hết hàng: nút đổi thành "Combo tạm hết" (không thêm lẻ).
- Mức 2 (cấp sàn): model `PromoBundle { id, title, discountType PERCENT|AMOUNT, value, productIds[], startAt, endAt, isActive, maxPerOrder }`. Checkout đưa các bundle này vào **cùng** `allocateComboDiscounts` (`combo.service.ts:29`), không cần gian hàng nào gửi kèm. Thứ tự với các ưu đãi khác giữ như hiện tại: dòng giờ vàng không giảm combo, mã tính sau combo.
- PDP khối "Combo ưu đãi": combo có SP đang xem, tối đa 2.
- Giỏ hàng: gom các dòng cùng combo dưới tiêu đề "Combo -x%". Nếu thiếu đúng 1 món thì hiện "Thêm {tên} để được combo -x%" + nút thêm (thay cho tiến độ freeship khi khách đã đạt freeship).

**Mua kèm deal sốc**
- Model `AddOnDeal { id, mainProductIds[], addonVariationId, addonPrice, perOrderLimit (mặc định 1), startAt, endAt, isActive }`.
- PDP khối "Mua kèm deal sốc": tối đa 3 món, mỗi món một dòng có ô chọn, giá mua kèm + giá gạch. Nút chính đổi thành "Thêm {n} món vào giỏ".
- Giỏ: món mua kèm gắn với dòng chính, có nhãn "Mua kèm". Bỏ dòng chính thì món mua kèm trở về giá thường và có thông báo. Không cộng với giờ vàng của chính món mua kèm (lấy giá thấp hơn). Mã giảm tính sau.
- Admin tab "Combo & Mua kèm": danh sách, tạo (chọn SP bằng picker), kiểm giá mua kèm phải thấp hơn giá đang bán, xem trước thẻ.

**Trạng thái chung**: combo hết hạn giữa chừng (giỏ báo "Combo đã kết thúc", trả giá thường), đủ món nhưng khác phân loại (vẫn tính, vì combo tính theo productId), khách vãng lai (thêm vào giỏ khách như hiện nay).

---

## E. Ưu tiên (ICE = Ảnh hưởng × Tin chắc ÷ Công; thang 1–5, công 1 = ít)

| Thứ tự | Gói | I | C | E | ICE | Phụ thuộc |
|---|---|---|---|---|---|---|
| 1 | IA-01 gán danh mục + cây 2 tầng (dữ liệu, chủ/admin) + API cây | 5 | 5 | 1 | **25** | — |
| 2 | Sửa nhanh: R2/R3/R4 cho kệ có sẵn (Giờ vàng 8 + Xem tất cả, chip nhãn 8, dedupe Trang chủ, nhãn "Xem tất cả" 30+, `related` sắp xếp) | 4 | 5 | 1 | **20** | — |
| 3 | Hub Danh mục + thanh công cụ dính (IA-02, IA-03) | 4 | 4 | 2 | 8 | 1 |
| 4 | Hệ nhãn thẻ + "Gợi ý hôm nay" (D2) | 4 | 4 | 2 | 8 | 1 (chip danh mục) |
| 5 | Combo mức 1: vẽ COMBO có sẵn + màn dựng Mini (IA-06 phần combo, IA-07) | 4 | 4 | 2 | 8 | — |
| 6 | Trang Giờ vàng + khung giờ + admin sinh suất (D1) | 5 | 4 | 3 | 6,7 | 2 |
| 7 | Top bán chạy + `sold30d` (D1, IA-16) | 3 | 4 | 2 | 6 | 1 |
| 8 | Banner Trang chủ / Ưu đãi + admin (D3) | 3 | 4 | 2 | 6 | — |
| 9 | Khung trang shop dùng chung có tab (C4) | 4 | 4 | 3 | 5,3 | 5 |
| 10 | Kho voucher + Ưu đãi công khai (D3, C6) | 4 | 3 | 3 | 4 | — |
| 11 | Trang chiến dịch (D3) | 3 | 3 | 4 | 2,3 | 8, 10 |
| 12 | Combo cấp sàn `PromoBundle` (D4 mức 2) | 3 | 3 | 4 | 2,3 | 5 |
| 13 | Mua kèm deal sốc (D4) | 3 | 2 | 4 | 1,5 | 12 |

Gói 1–5 xử lý trực tiếp cảm giác "rối". Gói 6–10 thêm điểm nhấn và độ hấp dẫn. Gói 11–13 nên chờ số liệu đo từ các gói trước. Gói 12–13 đụng tiền (giá ở checkout), nên bắt buộc có review Opus trước khi merge.

---

## F. Cơ chế giữ khớp cho màn làm sau (mục 7 của brief)

1. **Sổ đăng ký kệ** `packages/app-core/src/merch/shelves.ts`: mỗi khối hàng ở mọi màn khai một `ShelfSpec { id, screen, intent, source, layout: 'rail'|'grid'|'line'|'feed', maxItems, minItems, dedupeRank, seeAllRoute }`. Hàm `shelvesFor(screen, ctx)` trả thứ tự. `home-layout.ts` giữ phần thứ tự khối không phải hàng (thẻ thành viên, lối tắt…) và đọc kệ từ sổ này.
2. **Chống trùng chung** `applyShelfDedupe(shelves, itemsById)`: thuần, có spec. Mini và web chỉ gọi hàm này, không tự lọc.
3. **Nhãn thẻ chung** `tileLabels()` (D2). Thêm spec kiểu `primitives-removed.spec.ts`: ngoài `CatalogTile` không nơi nào được truyền `badge` thẳng vào `ProductTile`.
4. **Spec chặn CI** `packages/app-core/src/merch/shelves.spec.ts`:
   - mọi kệ có `maxItems` trong ngân sách R2 và `minItems` > 0;
   - `seeAllRoute` có trong `route-map.json` (đọc file như `lint:parity`);
   - không màn nào có hai kệ cùng `intent` hoặc cùng `source`;
   - Trang chủ có ≤ 4 kệ không phải `feed`;
   - mọi khối mới của Trang chủ có chiều cao trong `HOME_SETTLING_HEIGHTS` (giữ R-2).
5. **Spec bố cục shop**: một bộ sưu tập ở mỗi `layout` render đúng thành phần (rail, grid, line, combo) ở cả Mini và web, để lỗi kiểu IA-06 (bỏ qua `layout`) không quay lại.
6. Ghi luật C1 thành mục "Kệ hàng" trong `design_handoff/` hoặc `AGENTS.md`, trỏ tới `shelves.ts` làm nguồn đúng duy nhất. Agent design-system nên đặt cùng chỗ với quy tắc token.

---

## G. Đối chiếu nền tảng (tóm tắt)

| Mẫu | Shopee | Lazada | TikTok Shop | Tiki | Zalo Mini App bán lẻ (mẫu nhà cung cấp) | Tubu: lấy hay không |
|---|---|---|---|---|---|---|
| Banner xoay đầu trang | có | có | có | có | có (khối do vận hành thêm) | Lấy (D3), tối đa 5 |
| Flash sale theo khung giờ | có, khung đổi theo ngày thường / ngày hội | có (0h/12h, ngày hội nhiều hơn) | có (nhãn flash trên thẻ) | khối flash trong trang shop | khối "Flash Sale" từ module khuyến mãi | Lấy, ít khung (kho nhỏ) |
| Gợi ý vô tận cuối trang | Daily Discover | Just For You | feed | có | khối nhóm SP | Lấy, chip theo danh mục |
| Trang shop có tab, voucher shop, bộ sưu tập | có | có | shop tab | trang trí shop (xếp hạng, carousel, flash) | — | Lấy (C4) |
| Kho voucher, nút Lưu | có | có | có | có | — | Lấy, dùng `CouponClaim` |
| Combo khuyến mãi / Mua kèm deal sốc | có | có | — | — | — | Lấy, combo trước |
| Nhãn Mall / Yêu thích của người bán | có | LazMall | — | — | — | **Không** chép tên; dùng "Tubu chọn" + nhãn theo luật |

Độ tin chắc: phần lớn nguồn là blog bên thứ ba; khung giờ flash sale không thống nhất giữa các nguồn. Vì vậy D1 đặt khung giờ là cấu hình, không gắn cứng.

## Nguồn

- [Sapo: Flash sale là gì](https://www.sapo.vn/blog/flash-sale-la-gi)
- [FPT Shop: cách săn sale Shopee](https://fptshop.com.vn/tin-tuc/thu-thuat/cach-san-sale-shopee-176414)
- [GHN: cập nhật khung giờ săn sale Shopee](https://ghn.vn/blogs/tip-ban-hang/cap-nhat-khung-gio-san-sale-shopee)
- [Shopee Blog: cách săn flash sale](https://shopee.vn/blog/cach-san-flash-sale-shopee/)
- [Shopee Blog: cách sử dụng mã giảm giá](https://shopee.vn/blog/cach-su-dung-ma-giam-gia-shopee)
- [GHN: cách săn voucher Shopee](https://ghn.vn/blogs/tip-ban-hang/cach-san-voucher-shopee)
- [BigSeller: công cụ marketing Shopee (Combo, Mua kèm deal sốc)](https://www.bigseller.com/blog/articleDetails/3799/top-7-cac-cong-cu-marketing-cua-shopee-giup-shop-tang-don-nhanh-chong.htm)
- [Shopee Ads SG: vị trí Daily Discover / You May Also Like](https://ads.shopee.sg/learn/faq/92/179)
- [Ginee: Discovery Ads Shopee](https://ginee.com/ph/insights/discovery-ads-shopee)
- [Lazada VN: hướng dẫn mua flash sale](https://www.lazada.vn/blog/huong-dan-mua-hang-flash-sale-tren-lazada-moi-nhat/)
- [Tiki Học viện: trang trí gian hàng](https://hocvien.tiki.vn/faq/instruction-on-store-decoration-feature)
- [TikTok Shop tab (Marketech APAC)](https://marketech-apac.com/tiktok-shop-introduces-new-shop-tab-feature-for-more-seamless-shopping-experience/)
- [CNV Loyalty: giao diện Mini App](https://huongdan.cnvloyalty.com/kenh-ban-hang/social-loyalty/zalo/cai-dat/giao-dien-mini-app)
- [CoreRetail: trang chủ Zalo Mini App](https://coreretail.gitbook.io/huong-dan-van-hanh-mini-app/mini-app-incom-tutorial/mini-app-cho-nguoi-dung-user/zalo-mini-app/trang-chu)
- [Shopline: banner flash sale, đếm ngược](https://help.shopline.com/hc/en-001/articles/14203761977497-Flash-Sales-Customizing-Banners-and-Promotion-Tags)
- [Baymard (Smashing): phân trang, cuộn vô tận, nút Xem thêm](https://smashingmagazine.com/2016/03/pagination-infinite-scrolling-load-more-buttons)
