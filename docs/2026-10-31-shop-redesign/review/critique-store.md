# Critique gian hàng, thương hiệu, Ưu đãi, Giờ vàng (mini375), 2026-10-31

Vai: design lead thương mại điện tử mobile. Kỹ năng đã nạp: `design:design-critique` (khung chấm: ấn tượng đầu, dùng được, thứ bậc thị giác, nhất quán, truy cập), `ui-ux-pro-max` (luật `primary-action`: mỗi màn một CTA chính; luật kéo-thả WCAG 2.5.7: luôn có cách sắp xếp không cần kéo; tra "marketplace seller storefront": nhấn vào tín hiệu tin cậy + huy hiệu người bán đã xác thực). Tra "countdown/flash sale" trong CSDL của skill không ra kết quả, phần Giờ vàng dưới đây là kinh nghiệm chung + đối chiếu Shopee, không lấy từ CSDL.

Nguồn: ảnh `screens/mini375/{s-slug,storefront,brand-slug,offers}__*`, `screens/extras/home-flash-*__mini375.png`, mã main 13536d955, DB lane 7 (chỉ đọc). Chỉ đọc mã, không sửa.

Đã đọc các báo cáo cùng đợt để không lặp: `ia-merch.md` (IA, kệ, chức năng D1–D4), `design-system.md` (tên thành phần `SectionHeader`, `ProductRail`, `Countdown`, `VoucherTicket`, `ComboCard`), `backend-gap.md`, `a11y.md`, `ux-copy.md`. Báo cáo này lo phần **hình và bố cục** của 5 màn, đưa ra sơ đồ khối cụ thể, và trả lời câu "CTV tự sắp gian hàng thế nào để không rối". Chỗ nào trùng thì tôi trỏ sang mã phát hiện của báo cáo kia, không viết lại.

---

## 0. Kết luận

1. **Gian hàng CTV `/s/:slug` là một cái kho xếp dọc, chưa phải một shop.** Mọi bộ sưu tập đều thành lưới 2 cột, hiện hết món: 4 bộ, 17 món, cao 3.759px, tức 4,6 màn. API cho phép 30 bộ × 100 món. Đầu shop không có số nào để tin (số SP, sao, đã bán), không có voucher shop, không có tab, không tìm được trong shop, và khi cuộn thì mất luôn tên shop. Đây đúng là chỗ chủ thấy "rối, dàn trải".
2. **CTV không có công cụ nào để làm gian hàng gọn.** Màn dựng chỉ đặt được tên bộ sưu tập. Kiểu hiển thị (lưới, kệ ngang, danh sách) và combo **không chỉnh được ở đâu cả**, kể cả web (sửa lại nhận định IA-07, xem mục 7). Mỗi món chiếm 123pt với 5 nút. Thẻ "Hành trình" chiếm trọn màn đầu, có 3 nút chính cùng lúc.
3. **Trang thương hiệu khá hơn**: có Theo dõi, khuyến mãi, câu chuyện. Nhưng câu chuyện bị đẩy xuống sau 16–30 thẻ, mỗi thẻ lặp tên nhãn, và API cắt cứng 30 SP mà không báo.
4. **Ưu đãi chưa phải "kho voucher"**: 8 mã cao 134pt mỗi cái, kèm 16 nút ngang nhau, xếp theo id, khó quét. Danh sách mã bắt đầu sau 1,25 màn (thẻ điểm + điểm danh đứng trước).
5. **Giờ vàng thiếu nhịp gấp**: đồng hồ "Còn 13h 30m" không có giây, thẻ cao 285pt, chưa có trang riêng hay khung giờ, và kệ "Sắp diễn ra" (3 nút xanh đặc) to ngang kệ đang bán.
6. Hướng đi: **một khung trang shop chung** cho CTV và nhãn hàng (đầu shop có số liệu, voucher shop, tab Shop | Sản phẩm | Danh mục, khối vẽ theo `layout` có ngân sách món). Đi kèm **màn dựng kiểu "khối"**, đúng như khách sẽ thấy: chọn kiểu khối có hình minh hoạ, ngân sách và cảnh báo lấy từ cùng một hàm app-core với trang công khai, sắp xếp chỉ bật khi cần. Sơ đồ ở mục 3.

---

## 1. Chấm theo chuẩn Shopee

Thang điểm: 0 = chưa có, 1 = có nhưng yếu, 2 = đạt.

### 1a. Trang shop (Shopee "Shop" ↔ Tubu `/s/:slug` CTV, `/brand/:slug`)

| Thành phần trang shop Shopee | `/s/:slug` | `/brand/:slug` | Bằng chứng |
|---|---|---|---|
| Đầu shop: bìa, avatar, tên, huy hiệu | 1: bìa là dải xanh trơn 84px, tên to, có huy hiệu | 1: như trái, bìa 96px | `store-page-shell.tsx:27`, ảnh `s-slug…s1`, `brand-slug…s1` |
| Uy tín: số SP, ★ TB, đã bán, người theo dõi | 0: không số nào. Huy hiệu bậc **"Tân binh"** cho khách xem lại thành tín hiệu *trừ* điểm | 1: chỉ có người theo dõi, và ẩn khi bằng 0 | `storefront-view.tsx:101`; `brand-view.tsx:155-157` |
| Theo dõi / Chat ngay ở đầu shop | 0 (backend chỉ có `BrandFollow`) | 1: Theo dõi nằm ở thanh dính đáy, không ở đầu | `schema.prisma:521`; `brand-view.tsx:136-151` |
| Voucher của shop (Lưu) | 0 | 1: thẻ khuyến mãi to, "chạm để chép", không có Lưu | `brand-view.tsx:199-252` |
| Tab Shop / Sản phẩm / Danh mục | 0 | 0 | — |
| Bộ sưu tập vẽ đúng kiểu (kệ, lưới, combo) | 0: bỏ qua `layout`, `kind` | — | `storefront-view.tsx:142-159` |
| Sản phẩm nổi bật | 1: là bộ đầu, nhưng cũng là lưới hết món | 1: "Sản phẩm" sắp theo featured/review | `brand.service.ts:113` |
| Tìm trong shop, sắp xếp | 0 | 0 | — |
| Thanh đầu khi cuộn (tên shop, tìm, giỏ) | 0: thanh trắng 56pt chỉ có nút quay lại | 0 | `back-button.tsx:19-25`, ảnh `s-slug…s2–s6` |
| Combo / deal của shop | 0: combo có trừ tiền ở giỏ nhưng khách không thấy | — | backend-gap #1, IA-06 |
| **Tổng** | **3/20** | **5/18** | |

### 1b. Flash Sale (Shopee) ↔ Giờ vàng

| Thành phần | Tubu | Bằng chứng |
|---|---|---|
| Đồng hồ HH:MM:SS ô tối, nhảy từng giây | 1: chip "Còn 13h 30m", làm tròn phút | `countdown-format.ts:5-14`, `flash-sale.tsx:125-131` |
| Tab khung giờ (đang diễn ra / sắp tới) | 0 | backend-gap mục Giờ vàng #1 |
| Trang riêng + "Xem tất cả" | 0 | IA-05 |
| Thanh đã bán có chữ trong thanh ("Sắp cháy hàng", "Vừa mở bán") | 1: thanh + dòng chữ riêng; món bán 0% thì không có thanh | `flash-sale.tsx:179-188` |
| Thẻ gọn (ảnh, giá, thanh) | 1: thẻ 132×285pt, giá và giá gạch nằm 2 dòng | ảnh `home-flash-active…mini375` |
| Sắp diễn ra + Nhắc tôi | 1: có, nhưng là kệ thứ hai cùng cỡ, 3 nút chính, khách vãng lai không thấy | `flash-sale.tsx:273-331` |
| **Tổng** | **4/12** | |

### 1c. Kho voucher (Shopee) ↔ `/offers`

| Thành phần | Tubu | Bằng chứng |
|---|---|---|
| Gom mọi mã một chỗ | 1: "Mã giảm giá của tôi" ở cuối tab Ưu đãi | `offers.tsx:231-255` |
| Tab loại mã (Tất cả, Freeship, Giảm giá, Của shop) | 0 | — |
| Thẻ vé gọn (cuống trái theo loại, 1 nút) | 0: thẻ 134pt, 2 nút full, mọi loại cùng màu | `coupon-card.tsx:24-60` |
| Xếp sắp hết hạn trước, ghi "còn 2 ngày" | 0: xếp theo `id` | `loyalty.service.ts:869-872` |
| Xem mã khi chưa đăng nhập, Lưu mới cần đăng nhập | 0 | IA-09 |
| **Tổng** | **1/10** | |

---

## 2. Từng màn

### 2.1 Gian hàng CTV `/s/:slug`

**Ấn tượng 2 giây.** Mắt rơi vào dải xanh đậm phía trên, rồi tên shop chữ serif to, rồi ngay sau đó là 2 thẻ sản phẩm to (295pt mỗi thẻ). Không có câu trả lời cho "shop này là ai, có đáng tin không, đang có ưu đãi gì". Cảm giác: trang danh sách, chưa phải cửa hàng.

**Luồng mắt.** Đọc dọc theo từng bộ sưu tập, mỗi bộ là một lưới dài. Ảnh `s3`→`s4`: bộ "Chăm bé an toàn" chiếm gần 2 màn trong khi trong DB nó là `CAROUSEL`. Bộ "Combo giặt sạch tiết kiệm" (`COMBO`, `STACK`, -10%) trông y như lưới thường; nhãn "-10%" trên thẻ lại là giảm giá riêng của món, nên khách dễ hiểu nhầm đó là mức giảm combo (ảnh `s5`).

**Điểm tốt nên giữ.**
- Luật nhãn tin cậy chỉ cho gian hàng đã duyệt (`trustBadgeLabel`, `storefront-view.tsx:31-36`).
- Không có nút dính đáy đẩy khách ra khỏi gian hàng (R-61), và có lối "Xem thêm ở Tubu Tree" ở cuối.
- Giá Giờ vàng hiện đúng trên thẻ ở mọi bộ sưu tập (ảnh `s2`).
- Khi link hỏng có ErrorState kèm gợi ý sản phẩm (`:58-71`).

### 2.2 Màn dựng `/storefront` (persona ctv)

**Ấn tượng 2 giây.** Màn đầu (ảnh `storefront…s1`) toàn là thẻ "Hành trình gian hàng". Ở đó có 2 nút xanh đặc "Nhận 2.000 điểm", "Nhận 1.000 điểm", cộng thêm nút "Chia sẻ" xanh đặc ở thanh dính: 3 CTA chính trong cùng một màn, trái luật `primary-action`. Chính gian hàng (hồ sơ, bộ sưu tập) chỉ bắt đầu từ màn 2.

**Dùng được không.**
- Mỗi món là một hàng cao 123pt gồm tên, giá, ↑, ↓, ⋯, "Thêm lý do giới thiệu", "Bài đăng mẫu". 17 món là khoảng 2.100pt, 5 màn hàng giống hệt nhau, không có ảnh để nhận ra món (ảnh `s2–s6`).
- Mũi tên ↑↓ của bộ sưu tập và của món cùng cỡ, cùng màu, đặt sát nhau (`storefront-builder.tsx:398-400` và `:425-427`). Nhìn không biết đang dời bộ hay dời món.
- Không có gì cho CTV biết khách sẽ thấy bộ này ra sao: không có kiểu hiển thị, không có số món khách thấy, không cảnh báo.
- Tạo bộ sưu tập là một ô nhập nằm cuối trang, sau mọi món (`:458-476`). Nút bị tắt có nền be, chữ xám, khó đọc (ảnh `s6`).
- "Thống kê 30 ngày" nằm cuối cùng (`:478`), trong khi với gian hàng đã đăng thì đây là thứ CTV muốn xem trước.
- Bản xem trước lúc còn nháp (`storefront-preview.tsx:11-12`) gộp mọi bộ thành 4 thẻ, nên không phản ánh trang thật.

**Điểm tốt nên giữ.**
- Sắp xếp lạc quan có rollback (`:247-267`).
- Menu ⋯ có chữ và đặt thao tác nguy hiểm ở cuối (`:122-143`).
- Có sheet nhập lý do giới thiệu, đếm 200 ký tự.
- Đã có mẫu dựng nhanh theo danh mục (`storefront-pickers.tsx:26`).

### 2.3 Trang thương hiệu `/brand/:slug`

**Ấn tượng 2 giây.** Tên nhãn + "Chính hãng" + tagline + khối "Khuyến mãi" màu vàng nổi bật. Thứ bậc đúng hơn trang CTV vì khuyến mãi đứng trước sản phẩm.

**Vấn đề hình.**
- Khối khuyến mãi dùng nền `--color-promo-bg` nhưng viền lấy `themeColor` của nhãn (xanh lá), nên vàng-viền-xanh bị chỏi (`brand-view.tsx:208`, ảnh `brand-slug…s1`).
- Mỗi thẻ lặp tên nhãn 2 lần: chấm màu + "Fuwa3e", rồi tên SP kết thúc bằng "Fuwa3e". Lý do là trang gắn `brand: b.name` cho mọi thẻ (`:263`).
- "Câu chuyện thương hiệu" nằm sau toàn bộ lưới (ảnh `s5`). Khách gần như không cuộn tới.
- Thanh dính đáy "Theo dõi | Chia sẻ" chiếm khoảng 64pt suốt trang, trong khi Shopee để Theo dõi ở đầu shop.

**Điểm tốt nên giữ.**
- Chạm để chép mã có phản hồi.
- Lượng người theo dõi được làm mới sau khi bấm (`:58-64`).
- Nút "Xem trên bản đồ" nối sang Hành trình nguyên liệu.

### 2.4 Ưu đãi `/offers`

**Ấn tượng 2 giây.** Thẻ điểm xanh đậm và thẻ điểm danh chiếm cả màn đầu. Đoạn luật điểm danh 4 dòng luôn mở (ảnh `offers…s1`). Với người vào để tìm mã, màn đầu không có mã nào.

**Vấn đề hình.**
- 8 thẻ mã, mỗi thẻ 134pt, có 2 nút cao 48pt ("Sao chép", "Dùng ngay"). Tổng khoảng 1.100pt toàn nút giống nhau, có tới 8 nút chính trên một danh sách (ảnh `s2–s4`).
- Mã freeship và mã giảm tiền cùng màu, cùng hình, không phân biệt được khi lướt.
- Không có thứ tự rõ: SHIP0D hết hạn 03/11 đứng giữa danh sách.
- Hàng tiện ích (Đổi quà, Quà của tôi, Đổi rác, Tích điểm đơn sàn, Mua chung, Vườn Xanh) là 6 dòng ListRow, khoảng 420pt. Lưới icon 4 cột sẽ chỉ cần khoảng 180pt.

**Điểm tốt nên giữ.**
- `?section=coupons` cuộn tới danh sách mã.
- Có dấu "sắp hết hạn" dùng chung luật app-core (`isCouponExpiring`).
- Thẻ hạng có tiến độ lên hạng.

### 2.5 Khu Giờ vàng (khối Trang chủ)

**Ấn tượng 2 giây.** Tiêu đề "Ưu đãi giờ vàng" serif màu nâu, chip "Còn 13h 30m" màu kem (ảnh `extras/home-flash-active…mini375`). Không có màu, nhịp hay con số nào tạo cảm giác gấp. Đồng hồ không nhảy giây nên trông như đứng yên.

**Vấn đề hình.**
- Thẻ 132pt rộng, 285pt cao: tên 2 dòng + phân loại + giá + giá gạch dòng riêng + thanh + dòng "Đã bán 98%". Chỉ thấy 2,5 thẻ, và một thẻ đã cao bằng 1/3 màn.
- Kệ "Sắp diễn ra" đứng ngay dưới, cùng cỡ, mỗi thẻ có nút "Nhắc tôi" xanh đặc cao 44pt. Nó tranh chú ý với kệ đang bán. "Bắt đầu sau 13h 30m" bị gãy 2 dòng.
- Món đã bán 0% không có thanh (`flash-sale.tsx:179`), nên các thẻ trong cùng kệ không đồng dạng.
- Không có lối đi tiếp ("Xem tất cả").

---

## 3. Bố cục đề xuất (sơ đồ khối, khổ 375)

Dùng thành phần có sẵn khi được: `StorePageShell`, `SegmentedTabs`, `ScrollRow`, `ProductTile` (biến thể `grid | rail | line`), `Badge`, `Chip`, `ProgressBar tone="flash"`, `StickyActionBar`, `BottomSheet`, `Skeleton`. Thành phần mới thì theo đúng tên và props mà `design-system.md` §B5–B10 đã đặt: `SectionHeader`, `ProductRail`, `ProductGrid`, `Countdown`, `VoucherTicket`, `ComboCard`. Thành phần mới riêng của báo cáo này được ghi rõ là **[mới]**.

### 3.1 Khung trang shop chung (CTV, đối tác, nhãn hàng), khớp IA-06/IA-08 và C4 của ia-merch

```
┌───────────────────────────────────────────┐
│ ‹                            [chia sẻ][giỏ]│ ShopTopBar [mới]: trong suốt trên bìa,
│                                           │ cuộn qua bìa thì nền surface + tên shop
│  (ảnh bìa 120pt; không có bìa thì         │ + ô "Tìm trong shop" thay tiêu đề
│   gradient --color-action-primary-bg →    │
│   -bg-pressed, không dùng --forest-700)   │
│ ┌────┐                                    │
│ │ava │ Góc Xanh Của Phạm          [Theo dõi]│ avatar 56; nút Theo dõi chỉ ở nhãn
│ │ 56 │ [✔ CTV tuyển chọn]                 │ (CTV: chủ thấy [Chia sẻ] ở đây)
│ └────┘                                    │
├───────────────────────────────────────────┤
│  17 sản phẩm │ ★ 4,6 (612) │ Đã bán 31k+   │ ShopStatsRow [mới]: 48pt, 3 cột,
├───────────────────────────────────────────┤ số body-md 700, nhãn caption tertiary
│ Gian hàng UAT, sản phẩm xanh chọn lọc …   │ headerNote tối đa 2 dòng + "Xem thêm"
├───────────────────────────────────────────┤
│ Voucher của shop                     Tất cả›│ SectionHeader
│ ┌──────────────┐┌──────────────┐┌──────    │ VoucherTicket variant=chip, ScrollRow
│ │Giảm 15%  Lưu ││Freeship  Lưu ││          │ (ẩn cả khối nếu 0 mã)
│ └──────────────┘└──────────────┘└──────    │
╞═══════════════════════════════════════════╡
│   Shop    │  Sản phẩm (17)  │  Danh mục    │ SegmentedTabs, dính dưới ShopTopBar
╞═══════════════════════════════════════════╡
│ TAB SHOP                                  │
│ Nổi bật                            Tất cả ›│ món isPinned + bộ đầu; ProductRail md
│ ┌─────┐┌─────┐┌─────┐┌──                  │ tối đa 10
│ └─────┘└─────┘└─────┘└──                  │
│ Combo giặt sạch tiết kiệm   [Combo -10%]  │ ComboCard variant=store (xem 3.1b)
│ Bếp xanh mỗi ngày                 Xem 6 › │ GRID: ProductGrid, tối đa 6 thẻ
│ ┌─────┐┌─────┐                            │
│ ┌─────┐┌─────┐                            │
│ ┌─────┐┌─────┐                            │
│ Chăm bé an toàn                    Tất cả ›│ CAROUSEL: ProductRail md, tối đa 10
│ ┌─────┐┌─────┐┌─────┐┌──                  │
│ Mình hay dùng                       Tất cả ›│ STACK: ProductTile line, tối đa 5,
│ [ảnh64] Tên · giá                          │ có câu "Vì sao mình giới thiệu"
│        "Rửa sạch mùi tanh, không khô tay"  │ trong thẻ
│ ...                                       │
│ Muốn có gian hàng như này? Tìm hiểu ›      │ 1 dòng link (thay thẻ to hiện nay)
│        Xem thêm ở Tubu Tree                │
└───────────────────────────────────────────┘
```

- **Tab Sản phẩm**: thanh sắp xếp dính "Phổ biến · Mới · Bán chạy · Giá ↕" (dùng `Chip`), dưới là `ProductGrid` 2 cột tải thêm khi cuộn. Món bỏ trùng giữa các bộ. Nguồn dữ liệu như ia-merch C4 (`GET /storefront/:slug/products`). Nhãn hàng thì dùng catalog lọc theo nhãn.
- **Tab Danh mục**: danh sách bộ sưu tập, mỗi dòng có dải 4 ảnh nhỏ (48pt) + tên + "n món" + ›. Bấm vào thì mở tab Sản phẩm đã lọc theo bộ đó.
- **Nhãn hàng** có thêm tab **Câu chuyện**: xuất xứ + bản đồ, chứng nhận, câu chuyện, ảnh, chương trình đại lý. Ở tab Shop chỉ giữ 3 dòng câu chuyện + "Đọc câu chuyện ›" ngay dưới ShopStatsRow, vì câu chuyện là lý do mua của nhãn xanh. Bỏ thanh dính đáy: Theo dõi lên đầu shop, Chia sẻ lên ShopTopBar.
- **Số liệu ShopStatsRow**:
  - Số SP = số món khác nhau.
  - ★ = trung bình có trọng số `ratingAvg × reviewCount` trên các món, chỉ hiện khi tổng số đánh giá từ 5 trở lên.
  - Đã bán = tổng `sold`, định dạng bằng `formatSold`.
  - Nhãn hàng thêm "n người theo dõi" (định dạng số, ux-copy đã nêu).
  - Cả ba số tính được từ dữ liệu API đang trả (`storefront.service.ts:366-375`, `brand.service.ts:143-150`). Nên tính ở app-core để Mini và web ra cùng số.

#### 3.1b Khối combo trong trang shop (ComboCard `variant="store"`, mở rộng B10)

```
┌───────────────────────────────────────────┐
│ Combo giặt sạch tiết kiệm   [Combo -10%]  │ Badge tone=promo
│ ┌────┐ + ┌────┐ + ┌────┐                  │ ảnh 72, dấu + ở giữa; >3 món thì ảnh
│ │    │   │    │   │    │                  │ thứ 4 là "+2"
│ └────┘   └────┘   └────┘                  │
│ Mua cả bộ  337.300đ  ~~374.000đ~~         │ PriceTag md + compareAt
│ Tiết kiệm 36.700đ                         │ chữ --color-promo-fg
│ [            Thêm cả combo            ]   │ Button primary full (CTA duy nhất của khối)
│ Xem từng món ›                            │ link phụ, mở danh sách line
└───────────────────────────────────────────┘
```
- Tiền tiết kiệm lấy từ API, không tự tính ở máy khách. Luật về món hết hàng, nhiều phân loại, hàng đối tác giữ như ia-merch D4.
- Nút "Thêm cả combo" cần `POST /cart/items/batch` (backend-gap 4a-BE).

### 3.2 Màn dựng `/storefront`: "dựng bằng khối", đúng như khách thấy

Nguyên tắc: (1) màn chính chỉ có **khối**, không có hàng món; (2) sửa món thì vào **trang chi tiết khối**; (3) sắp xếp là **một chế độ** phải bật mới thấy; (4) ngân sách và cảnh báo **dùng chung hàm** với trang công khai.

```
┌ ‹ Gian hàng của tôi                [Xem như khách]┐ PageHeader + nút ghost mở /s/:slug
├───────────────────────────────────────────┤
│ ┌──────┐ Góc Xanh Của Phạm   [Đang hiển thị]│ bìa thu nhỏ 56×56 + tên + Badge trạng thái
│ │ bìa  │ /s/uatctv · Sửa hồ sơ ›            │
│ └──────┘                                  │
│  0 đơn   │  0đ doanh thu  │  0đ hoa hồng  │ StatBox gọn 1 hàng (chuyển lên từ cuối),
│              30 ngày qua                  │ gian hàng chưa đăng thì ẩn
├───────────────────────────────────────────┤
│ (i) 2 phần thưởng đang chờ · 3.000 điểm  › │ QuestStrip [mới]: 1 dòng 56pt, mở sheet
├───────────────────────────────────────────┤ Hành trình; nút Nhận nằm trong sheet
│ Bố cục gian hàng (tab Shop)    [Sắp xếp]  │ SectionHeader + nút ghost bật chế độ
│ ┌───────────────────────────────────────┐ │
│ │ Nổi bật · Kệ ngang · 4/10 món       › │ │ SectionCard [mới]: cao khoảng 104pt
│ │ [▢][▢][▢][▢]                          │ │ dải ảnh 40pt của 5 món đầu
│ └───────────────────────────────────────┘ │
│ ┌───────────────────────────────────────┐ │
│ │ Combo giặt sạch · Combo -10% · 3 món › │ │
│ │ [▢]+[▢]+[▢]                           │ │
│ └───────────────────────────────────────┘ │
│ ┌───────────────────────────────────────┐ │
│ │ Bếp xanh mỗi ngày · Lưới · 6 món     › │ │
│ │ [▢][▢][▢][▢][▢]                       │ │
│ │ ! Khách thấy 6/12 món, 6 món còn lại  │ │ cảnh báo caption --color-status-warning-fg
│ │   ở tab Sản phẩm                      │ │
│ └───────────────────────────────────────┘ │
│ ── Từ khối thứ 7: chỉ hiện ở tab Danh mục ─│ vạch chia khi có trên 6 khối
│ [ + Thêm khối ]                           │ Button secondary full, mở sheet 3.2b
├───────────────────────────────────────────┤
│ Gian hàng gọn: 3/5   Xem việc còn thiếu › │ ShopHealth [mới] (3.3 luật L6)
├───────────────────────────────────────────┤
│ [ Xem trước ]          [ Chia sẻ ]        │ StickyActionBar (CTA chính duy nhất)
└───────────────────────────────────────────┘
```

**Chế độ Sắp xếp** (bấm [Sắp xếp]):
- Mỗi SectionCard thu thành 1 dòng 56pt: tay kéo ≡ + tên + ↑ ↓ (giữ `RowIconButton` 44pt; ↑↓ là cách không cần kéo theo WCAG 2.5.7).
- Nút [Xong] thay chỗ "Chia sẻ" ở thanh dính.
- Ngoài chế độ này không hiện mũi tên nào. Hết cảnh mũi tên khối và mũi tên món nằm cạnh nhau.

#### 3.2a Trang chi tiết khối (route `/storefront/section/:id` hoặc BottomSheet full-height)

```
┌ ‹ Combo giặt sạch tiết kiệm             [⋯]┐ ⋯: Đổi tên, Xoá khối
├───────────────────────────────────────────┤
│ Kiểu hiển thị                             │
│ ┌──────┐┌──────┐┌──────┐┌──────┐          │ LayoutPicker [mới]: 4 ô chọn (radio),
│ │ ▦▦   ││ ▭▭▭→ ││ ≡    ││ ▢+▢  │          │ mỗi ô có hình minh hoạ 48×32 + nhãn
│ │ Lưới ││Kệ ngang││Danh sách││Combo│      │ (nhãn lấy từ LAYOUT_LABEL/KIND_LABEL
│ └──────┘└──────┘└──────┘└──────┘          │  sau khi chuyển lên app-core)
│ Giảm khi mua cả bộ  [ 10 ] %  (tối đa 30%) │ chỉ khi Combo; trần storefront.max_combo_pct
├───────────────────────────────────────────┤
│ Khách sẽ thấy                             │ Xem trước THẬT: chính ShopSection [mới]
│ ┌───────────────────────────────────────┐ │ ở tỉ lệ 0,85, không tương tác
│ │ (ComboCard thu nhỏ)                   │ │
│ └───────────────────────────────────────┘ │
├───────────────────────────────────────────┤
│ 3 món · Combo cần 2–5 món                 │ dòng ngân sách từ app-core
│ [ảnh48] Nước giặt hữu cơ Lá Xanh  148k [⋯]│ ProductTile line + ⋯ (Ghim, Ẩn, Bài đăng
│         + Thêm lý do giới thiệu            │ mẫu, Xoá). "Bài đăng mẫu" vào ⋯, không
│ [ảnh48] Nước xả vải lavender      145k [⋯]│ còn lặp ở mỗi hàng
│         "Thơm dịu, bé không bị kích ứng"   │
│ [ + Thêm sản phẩm ]                       │
└───────────────────────────────────────────┘
```
Mỗi hàng món từ 123pt xuống khoảng 72pt (ảnh 48, tên 1 dòng, giá, lý do 1 dòng). 17 món còn khoảng 1.220pt, và nằm rải theo từng khối chứ không dồn trên một trang.

#### 3.2b Sheet "Thêm khối" (thay ô nhập tên ở cuối trang)

```
┌ Thêm khối ──────────────────────────────┐
│ Chọn kiểu, đặt tên sau                  │
│ ┌──────────────────┐┌──────────────────┐│ 2×2 thẻ chọn, mỗi thẻ có hình, tên,
│ │ ▭▭▭→ Kệ ngang    ││ ▦▦ Lưới          ││ 1 dòng "Hợp khi…"
│ │ 4–10 món, lướt   ││ 4–6 món, nổi bật ││
│ └──────────────────┘└──────────────────┘│
│ ┌──────────────────┐┌──────────────────┐│
│ │ ≡ Danh sách      ││ ▢+▢ Combo        ││
│ │ 3–5 món kèm lý do││ 2–5 món, giảm %  ││
│ └──────────────────┘└──────────────────┘│
│ Tên khối [ Bếp xanh mỗi ngày          ] │ gợi ý tên theo kiểu ("Combo tiết kiệm")
│ [            Tạo và thêm món           ]│ tạo xong mở PickerSheet luôn
└─────────────────────────────────────────┘
```

#### 3.2c PickerSheet (`storefront-pickers.tsx:76-122`) nâng lên
- Mỗi dòng có ảnh 48 (`ProductTile variant="line"`). Hiện tại chỉ có tên và giá.
- Hàng chip lọc: Bán chạy · Hoa hồng cao · Đang Giờ vàng · theo danh mục.
- Chọn nhiều món, nút dính "Thêm 5 món".
- Món đã có trong khối này hiện "Đã thêm" (tắt). Món đã có ở khối khác hiện chú thích "Có ở 'Bếp xanh'" (vẫn chọn được).
- Khối đã đủ ngân sách thì hiện dòng nhắc "Khách chỉ thấy 6 món đầu ở tab Shop".

### 3.3 Luật chống rối cho CTV (đặt ở app-core, trang công khai và màn dựng cùng gọi)

| # | Luật | Màn dựng | Trang công khai |
|---|---|---|---|
| L1 | Tab Shop hiện tối đa **6 khối** | Vạch chia "chỉ hiện ở tab Danh mục" | Khối thứ 7 trở đi chỉ có ở tab Danh mục |
| L2 | Ngân sách món theo kiểu: Kệ ngang 10, Lưới 6, Danh sách 5, Combo 2–5, Nổi bật 10 | "Khách thấy x/y món" | Cắt đúng số đó + "Tất cả ›" mở tab Sản phẩm đã lọc |
| L3 | Khối dưới 2 món | Cảnh báo "Thêm ít nhất 1 món nữa" | Vẽ dạng Danh sách; combo dưới 2 món thì ẩn (khớp `comboLive`, `storefront.service.ts:363`) |
| L4 | Một món nằm ở hơn 2 khối | Chú thích "Món này có ở 3 khối" | Tab Shop bỏ trùng theo thứ tự khối (luật R3 ia-merch) |
| L5 | Chỉ một khối Nổi bật, luôn đứng đầu | Không cho dời xuống | Đứng đầu tab Shop |
| L6 | Sức khoẻ gian hàng: có bìa + avatar; có lời nhắn; có ≥ 1 khối Nổi bật từ 4 món; ≥ 3 món có lý do; không khối nào vượt L2 | ShopHealth "3/5" + danh sách việc | — |

L6 nối với Hành trình: nhiệm vụ "Viết lý do cho 3 sản phẩm" và "Hoàn thiện hồ sơ" đã có (`storefront-quest.service.ts`). QuestStrip chỉ cần trỏ cùng việc, không thêm điểm thưởng mới.

### 3.4 Ưu đãi + Kho voucher (khớp IA-09, C6, D3 của ia-merch)

```
┌ Ưu đãi ───────────────────────────────────┐
│ ┌───────────────────────────────────────┐ │ MemberStrip [mới]: thẻ điểm thu gọn 72pt
│ │ Lộc Biếc · 35.400 điểm ≈ 35.400đ    › │ │ (thanh tiến độ mảnh 4px ở dưới)
│ │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                 │ │
│ └───────────────────────────────────────┘ │
│ ┌───────────────────────────────────────┐ │ DailyCheckInCard bản gọn 112pt:
│ │ Điểm danh  N1 N2 N3 N4 N5 N6 N7  [Điểm danh]│ 7 ô + nút cùng hàng; luật 4 dòng
│ │ Hôm nay +1.000 điểm · +65 giọt   (i) │ │ chuyển vào sheet (i)
│ └───────────────────────────────────────┘ │
│ [Đổi quà][Quà của tôi][Đổi rác][Mua chung]│ lưới icon 4 cột (Tiles có sẵn ở
│ [Vườn Xanh][Tích điểm sàn]                │ ui/tiles.tsx), khoảng 180pt
├───────────────────────────────────────────┤
│ Giờ vàng hôm nay  [13]:[29]:[41]  Tất cả ›│ khối 3.5a thu nhỏ (4 thẻ), ẩn khi 0 suất
├───────────────────────────────────────────┤
│ Kho voucher                        8 mã   │ SectionHeader
│ Tất cả · Freeship · Giảm giá · Của shop · Sắp hết hạn │ Chip (ScrollRow), dính khi cuộn
│ ┌────────┬──────────────────────────────┐ │ VoucherTicket variant=ticket khoảng 88pt
│ │ (xe)   │ Miễn phí giao hàng           │ │ cuống trái 72: freeship màu ship,
│ │FREESHIP│ Mã SHIP0D                    │ │ giảm giá màu voucher
│ │        │ Còn 2 ngày            [Dùng] │ │ "Còn 2 ngày" chữ warning khi sắp hết hạn
│ └────────┴──────────────────────────────┘ │ nút sm, 1 nút / thẻ
│ ┌────────┬──────────────────────────────┐ │
│ │  15%   │ Giảm 15% tối đa 45k          │ │ chạm thân thẻ: sheet Điều kiện
│ │        │ Đơn từ 250k · Fuwa3e         │ │ (mã, áp cho, HSD đầy đủ, [Sao chép])
│ │        │ HSD 15/11             [Dùng] │ │
│ └────────┴──────────────────────────────┘ │
│ ... Mã đang phát chưa lưu đứng cuối, nút [Lưu]; đã lưu thì "Đã lưu" → [Dùng] │
└───────────────────────────────────────────┘
```
- **Thứ tự mã**: dùng được ngay và sắp hết hạn → giá trị giảm lớn → hạn xa → chưa lưu. Hàm `sortVouchers` đặt ở app-core. Nếu giữ thứ tự ở API thì sửa `orderBy` ở `loyalty.service.ts:871`.
- **"Sao chép"** chuyển vào sheet Điều kiện. "Dùng" là nút duy nhất trên thẻ, giữ hành vi `useCouponUse().use`.
- Tám mã từ khoảng 1.100pt xuống khoảng 760pt. Danh sách mã bắt đầu trong màn đầu với khách đã đăng nhập (khoảng 640pt từ đỉnh).
- **Khác với ia-merch C6**: C6 đặt Giờ vàng + Mã đang phát *trên* thẻ điểm. Tôi để MemberStrip + điểm danh gọn ở đầu vì khách quen vào tab này mỗi ngày để điểm danh, và hai khối này giờ chỉ còn 184pt nên mã vẫn lên màn đầu. Với khách vãng lai thì đúng thứ tự C6: Giờ vàng và Kho voucher lên đầu, `GuestLinkCard` thay hai khối cần đăng nhập. Câu hỏi Q2 cho chủ.

### 3.5 Giờ vàng

#### 3.5a Khối Trang chủ

```
┌───────────────────────────────────────────┐
│ GIỜ VÀNG  [13]:[29]:[41]          Tất cả ›│ SectionHeader tone=promo, trailing =
│                                           │ Countdown variant=blocks (B7)
│ ┌───────┐┌───────┐┌───────┐┌───────┐┌──   │ thẻ 112pt rộng (rail sm), cao khoảng 196pt
│ │  ảnh  ││       ││       ││       ││     │ ảnh 1:1 + cờ "-34%" góc phải trên
│ │ 1:1   ││       ││       ││       ││     │ (flash solid)
│ │   -34%││   -30%││   -25%││       ││     │
│ │33.000đ││84.000đ││94.000đ││       ││     │ giá md màu flash, KHÔNG có giá gạch
│ │Nước rửa…││Nước rửa…││Cà phê…││  ││     │ tên 1 dòng caption, bỏ dòng phân loại
│ │[▓▓SẮP HẾT]│[▓ĐÃ BÁN 68]│[VỪA MỞ BÁN]│   │ FlashSoldBar [mới]: ProgressBar cao 16,
│ └───────┘└───────┘└───────┘└───────┘└──   │ chữ label 12/700 nằm trong thanh
│ Suất kế tiếp 12:00 trưa · 6 món   [Nhắc tôi]│ 1 dòng thay kệ "Sắp diễn ra"
└───────────────────────────────────────────┘ (nút secondary sm; vãng lai bấm thì mời đăng nhập)
```
- Chữ trong thanh: dưới 1 món đã bán: "Vừa mở bán". 1–79%: "Đã bán {n}%". 80–99%: "Sắp hết". 100%: "Đã bán hết", thẻ mờ, xếp cuối. Món bán 0% cũng có thanh, nên thẻ nào cũng cùng dạng.
- Giá gạch và tên 2 dòng giữ cho trang riêng, không đưa lên khối Trang chủ. Thẻ giảm từ 285pt xuống khoảng 196pt, thấy được 3,2 thẻ thay vì 2,5.
- Countdown: ô số nền `--color-countdown-bg` (B1/B7). `aria-label` cập nhật theo phút, phần nhảy giây đặt `aria-hidden` (a11y P2-5).

#### 3.5b Trang `/flash-sale` (khớp D1 ia-merch và backend-gap mục Giờ vàng)

```
┌ ‹ Giờ vàng                          [giỏ]┐
├───────────────────────────────────────────┤
│  12:00     │   20:00      │  12:00        │ SlotTabs [mới] dựa trên SegmentedTabs:
│ Đã kết thúc│ Đang diễn ra │  Ngày mai     │ 2 dòng; tab đang diễn ra nền flash solid
├───────────────────────────────────────────┤ dính
│ Kết thúc sau [13]:[29]:[41]               │ Countdown blocks; tab sắp tới: "Bắt đầu sau"
│ Tất cả · Tẩy rửa · Cho bé · Cà phê         │ Chip, chỉ hiện khi ≥ 2 danh mục
├───────────────────────────────────────────┤
│ [ảnh 96] Nước rửa chén hương chanh Lá Xanh │ ProductTile variant=line + ô bên phải
│          Chai 500ml                        │
│          33.000đ ~~50.000đ~~  -34%         │ PriceTag sm + compareAt
│          [▓▓▓▓▓▓▓ SẮP HẾT ]   [Mua ngay]   │ FlashSoldBar + Button sm primary
├───────────────────────────────────────────┤
│ ... (tab sắp tới: nút [Nhắc tôi] secondary; │
│      đã nhắc: [Đã nhắc] ghost + icon check) │
│ ... món hết suất: mờ, "Đã bán hết", cuối   │
└───────────────────────────────────────────┘
```

---

## 4. Phát hiện

Mức: P0 chặn trải nghiệm · P1 nên sửa đợt này · P2 tinh chỉnh. Mã trùng với báo cáo khác được ghi trong ngoặc.

### Gian hàng `/s/:slug`

**ST-01 · P0 · /s/:slug (Mini + web)** (nâng IA-06 từ P1 lên vì đây là phàn nàn chính của chủ)
- Bằng chứng:
  - `storefront-view.tsx:142-159` vẽ mọi bộ bằng `gridTemplateColumns: '1fr 1fr'` với **toàn bộ** món.
  - Web `s/[slug]/page.tsx:264-289` làm y như vậy.
  - DB lane 7: "Chăm bé an toàn" `CAROUSEL`, "Combo giặt sạch" `STACK`/`COMBO` 10%, cả hai đều thành lưới (ảnh `s3–s6`).
  - Trang cao 3.759px cho 17 món. API cho phép 30 bộ × 100 món (`storefront.service.ts:24-25`).
- Vấn đề: không có nhịp, không có ngân sách, khách không thấy combo. Shop càng nhiều món càng rối.
- Đề xuất:
  - Thêm `ShopSection` **[mới]** (Mini `components/shop-page/shop-section.tsx`, web cùng tên). Nhận `collection` + `sectionView()` từ app-core (mục 6), rẽ nhánh: `CAROUSEL` → `ProductRail md`; `GRID` → `ProductGrid` cắt 6; `STACK` → `ProductTile line` cắt 5; `COMBO` → `ComboCard variant="store"`.
  - Mỗi khối có `SectionHeader` kèm "Tất cả ›" khi bị cắt.
  - Thay trực tiếp vào `storefront-view.tsx:142-159` và web `page.tsx:264-289`.

**ST-02 · P1 · /s/:slug**
- Bằng chứng: `StorePageShell` chỉ nhận tiêu đề + badges (`store-page-shell.tsx:23-41`); không có số liệu nào (ảnh `s1`).
- Vấn đề: khách không có lý do để tin một CTV lạ.
- Đề xuất: `ShopStatsRow` **[mới]** đặt trong `StorePageShell` (prop `stats?: {label, value}[]`), 48pt, 3 cột ngăn bằng `--color-border-subtle`. Công thức số như 3.1, tính trong app-core `shopStats(collections)`.

**ST-03 · P1 · /s/:slug**
- Bằng chứng: `storefront-view.tsx:101` hiện `TierBadge` của chủ shop cho khách. Ảnh `s1` ghi "Tân binh".
- Vấn đề: bậc CTV thấp nhất đọc ra là "người bán mới, chưa có kinh nghiệm", nên làm giảm tin cậy. Shopee chỉ cho khách thấy huy hiệu mang nghĩa tốt (Yêu thích, Mall).
- Đề xuất:
  - Chỉ hiện bậc từ bậc thứ 2 trở lên. Thêm cờ `publicBadge` vào kết quả `getPublicTier`, hoặc lọc theo `sortOrder > 0` ở API.
  - Chủ shop vẫn thấy bậc của mình trong màn dựng.
  - Mini dùng pill xanh nhạt, web dùng pill vàng viền (`s/[slug]/page.tsx:162-166`, ảnh `web375/s-slug…s1`). Thống nhất về `TierBadge` của Mini.

**ST-04 · P1 · /s/:slug, /brand/:slug**
- Bằng chứng: `back-button.tsx:19-25` dựng thanh trắng cố định cao 56pt chỉ có nút ‹ khi cuộn (ảnh `s-slug…s2–s6`, `brand-slug…s2–s5`).
- Vấn đề: mất ngữ cảnh "đang ở shop nào", tốn 56pt mà không có tác dụng gì.
- Đề xuất: `ShopTopBar` **[mới]** cho 2 trang này:
  - Trên bìa: trong suốt, nút ‹, chia sẻ, giỏ dạng tròn nền `--color-bg-scrim-light`.
  - Cuộn qua bìa (dùng lại logic `scrolled` của `back-button.tsx:49-60`): nền `--color-bg-surface`, giữa là tên shop (`body-sm 600`, 1 dòng).
  - Sau khi có tab Sản phẩm thì giữa là ô "Tìm trong shop" (`SearchField` có sẵn) và tab dính ngay dưới.

**ST-05 · P1 · /s/:slug**
- Bằng chứng: không có voucher ở trang shop. `Coupon.applyTo` theo gian hàng đã có (D3 ia-merch).
- Đề xuất: khối "Voucher của shop" dùng `VoucherTicket variant="chip"` trong `ScrollRow`, tối đa 3 + "Tất cả ›". Ẩn cả khối khi không có mã. Đặt trên tab, dưới ShopStatsRow.

**ST-06 · P1 · /s/:slug, /brand/:slug**
- Bằng chứng: không có tab, tìm trong shop hay sắp xếp. Nhãn hàng có `take: 30` (`brand.service.ts:115`).
- Đề xuất: `SegmentedTabs` dính "Shop | Sản phẩm (n) | Danh mục" (+ "Câu chuyện" cho nhãn) như 3.1. Phần dữ liệu theo IA-08 / ia-merch C4.

**ST-07 · P2 · /s/:slug**
- Bằng chứng: thẻ "Bạn cũng muốn có gian hàng như này?" có nút secondary full-width (`storefront-view.tsx:160-169`, ảnh `s6`).
- Vấn đề: lời mời mở shop chen vào trang bán hàng, nặng ngang một khối sản phẩm.
- Đề xuất: đổi thành 1 dòng link caption "Muốn có gian hàng như này? Tìm hiểu ›" đặt trên "Xem thêm ở Tubu Tree".

**ST-08 · P2 · /s/:slug** (a11y P2-12 lo phần gắn nhãn)
- Bằng chứng: ghi chú CTV vẽ thành hộp xanh nằm **ngoài** thẻ (`storefront-view.tsx:149-154`).
- Vấn đề: thẻ có ghi chú cao hơn thẻ bên cạnh, lưới lệch, và nhìn như hai vật rời nhau.
- Đề xuất: thêm prop `note?: string` cho `ProductTile`. `line` hiện 2 dòng trích dẫn trong thẻ; `grid`/`rail` hiện 1 dòng caption có icon `MessageSquare` 12 dưới tên, giữ `minHeight` để thẻ trong hàng bằng nhau. Kiểu STACK (Danh sách) là nơi ghi chú nổi nhất, nên gợi ý CTV dùng kiểu này cho "Mình hay dùng".

**ST-09 · P2 · /s/:slug, /brand/:slug**
- Bằng chứng: bìa dự phòng dùng primitive `var(--forest-700)` (`store-page-shell.tsx:27`). Dải 84–96pt màu đặc chiếm chỗ mà không mang thông tin.
- Đề xuất:
  - Khi không có bìa: gradient `--color-action-primary-bg` → `--color-action-primary-bg-pressed` (giống thẻ điểm `offers.tsx:117`) + hoạ tiết lá chìm 8% opacity, cao 120pt để có chỗ cho ShopTopBar.
  - Khi có bìa: phủ scrim dưới 40% để tên trắng đọc được nếu sau này đặt tên lên bìa.

### Màn dựng `/storefront`

**SB-01 · P1 · /storefront (Mini + web)** (sửa IA-07)
- Bằng chứng:
  - Mini chỉ gọi `createCollection({ title })` (`storefront-builder.tsx:214`) và `updateCollection(id, { title })` (`:222`).
  - Web cũng **chỉ** có tên: `NewCollectionForm` (`apps/web/src/components/affiliate/storefront-sheets.tsx:443-449`), sửa tên (`:421`).
  - Web chỉ *hiển thị* nhãn bố cục và combo (`storefront-builder.tsx:347-354`), không có ô chọn.
- Vấn đề: CTV không thể chọn kiểu khối hay tạo combo ở bất kỳ app nào. Combo chỉ có khi tạo qua API.
- Đề xuất:
  - LayoutPicker + ô % combo ở trang chi tiết khối (3.2a). Sheet "Thêm khối" có chọn kiểu (3.2b).
  - Chuyển `LAYOUT_LABEL`, `KIND_LABEL` từ `apps/web/src/components/affiliate/storefront-rules.ts:4-5` lên app-core.
  - Nhãn hiển thị cho CTV: "Kệ ngang, Lưới, Danh sách, Combo". "Danh sách" thay "Xếp dọc"; ux-copy chốt chữ.

**SB-02 · P1 · /storefront**
- Bằng chứng: hàng món 123pt với ↑ ↓ ⋯ + 2 nút chữ (`:401-450`). 17 món chiếm 5 màn (ảnh `s2–s6`).
- Đề xuất:
  - Màn chính chỉ còn `SectionCard` (3.2): tên, kiểu, số món, dải ảnh 40pt, cảnh báo.
  - Sửa món chuyển vào trang chi tiết khối: ảnh 48, tên 1 dòng, giá, 1 dòng lý do, ⋯.
  - "Bài đăng mẫu" chuyển vào ⋯ của món (`ActionMenu` có sẵn, thêm mục).

**SB-03 · P1 · /storefront**
- Bằng chứng: ↑↓ của bộ (`:398-400`) và của món (`:425-427`) cùng cỡ, cùng tông, đặt cạnh nhau. Ảnh `s2`: 3 hàng mũi tên liền nhau.
- Đề xuất: chế độ "Sắp xếp" riêng (3.2). Ngoài chế độ này không hiện mũi tên. Trong chế độ thì mỗi dòng có ≡ + ↑↓, đủ 44pt. Dời món chỉ làm trong trang chi tiết khối.

**SB-04 · P1 · /storefront**
- Bằng chứng: `QuestSection` đứng đầu khi chưa nhận đủ (`:340`). Mỗi nhiệm vụ đạt có `Button` primary cỡ thường (`:790-796`). Thanh dính cũng có "Chia sẻ" primary. Ảnh `s1`: 3 CTA chính.
- Đề xuất:
  - `QuestStrip` **[mới]** 56pt: "2 phần thưởng đang chờ · 3.000 điểm ›", mở `BottomSheet` chứa `QuestSection` hiện có. Trong sheet, nút "Nhận" dùng `variant="secondary"` cỡ sm.
  - Khi chưa có phần thưởng chờ, strip ghi việc kế tiếp ("Viết lý do cho 3 món · 0/3").

**SB-05 · P1 · /storefront**
- Bằng chứng: `StatsSection` ở cuối trang (`:478`). Ảnh `s6`.
- Đề xuất: gian hàng `LIVE` thì đưa 3 số lên đầu, dưới thẻ hồ sơ, dạng 1 hàng (StatBox giữ nguyên, padding 8). Chưa đăng thì ẩn.

**SB-06 · P1 · /storefront**
- Bằng chứng: không có cách nào để biết khách thấy gì. Bản xem trước khi còn nháp gộp mọi bộ thành 4 thẻ (`storefront-preview.tsx:11-12,34-38`).
- Đề xuất:
  - Trang chi tiết khối hiện `ShopSection` thật ở tỉ lệ 0,85.
  - `StorefrontPreview` dựng lại bằng chính các `ShopSection` (bỏ lưới riêng), để bản xem trước luôn khớp trang thật.
  - Nút "Xem như khách" ở PageHeader khi đã `LIVE`.

**SB-07 · P1 · /storefront**
- Bằng chứng: chưa có luật nào ngăn khối quá dài, quá nhiều khối hay món lặp.
- Đề xuất: luật L1–L6 (3.3) qua `sectionView()` / `shopHealth()` trong app-core. Cảnh báo dùng `Text caption` màu `--color-status-warning-fg` trong SectionCard, không chặn lưu.

**SB-08 · P2 · /storefront**
- Bằng chứng: ô "Tên bộ sưu tập" + nút "Tạo bộ sưu tập" bị tắt nằm cuối trang (`:458-476`). Nút tắt chữ xám trên nền be khó đọc (ảnh `s6`).
- Đề xuất: thay bằng `Button secondary` full "+ Thêm khối" mở sheet 3.2b. Tên nhập trong sheet, có gợi ý theo kiểu.

**SB-09 · P2 · PickerSheet**
- Bằng chứng: `storefront-pickers.tsx:101-115` chỉ có tên, giá, % hoa hồng, nút "Thêm" từng món.
- Đề xuất: theo 3.2c (ảnh, chip lọc, chọn nhiều, "Đã thêm", "Có ở khối X").

**SB-10 · P2 · /storefront**
- Bằng chứng: giá trong màn dựng là `salePrice ?? basePrice` (`:405`), không có Giờ vàng. Ví dụ Lá Xanh hiện 50.000đ trong khi khách thấy 33.000đ (ảnh `storefront…s3` so với `s-slug…s2`).
- Đề xuất: dùng cùng `cardPricing` (app-core `flash-price.ts`) để CTV thấy giá như khách. Thêm badge "Giờ vàng" để CTV biết lúc nào nên chia sẻ.

### Trang thương hiệu `/brand/:slug`

**BR-01 · P1 · /brand/:slug**
- Bằng chứng: "Câu chuyện thương hiệu" và "Chương trình đại lý" nằm sau lưới (`brand-view.tsx:270-322`, ảnh `s5`).
- Đề xuất: theo 3.1, có tab "Câu chuyện". Tab Shop giữ 3 dòng câu chuyện + "Đọc câu chuyện ›" dưới ShopStatsRow.

**BR-02 · P1 · /brand/:slug**
- Bằng chứng: Theo dõi nằm ở thanh dính đáy (`:136-151`). Người theo dõi ẩn khi bằng 0 (`:155`). Không có số SP, ★, đã bán.
- Đề xuất:
  - ShopStatsRow (ST-02) với "n sản phẩm · ★ x,x · n người theo dõi".
  - Nút "Theo dõi" `variant="secondary"` sm đặt cạnh tên. Đang theo dõi thì đổi `ghost` + icon `Check`.
  - Chia sẻ lên ShopTopBar. Bỏ `stickyBar`.

**BR-03 · P2 · /brand/:slug**
- Bằng chứng: `product={{ ...p, brand: b.name }}` (`:263`) làm mọi thẻ có dòng "● Fuwa3e" (ảnh `s1–s5`).
- Đề xuất: thêm prop `showBrand?: boolean` cho `ProductTile` (mặc định true) và truyền `false` ở trang nhãn. Thẻ gọn đi 1 dòng (khoảng 20pt), lưới 16 món ngắn đi khoảng 160pt.

**BR-04 · P2 · /brand/:slug** (DS-07)
- Bằng chứng: khuyến mãi nền promo nhưng viền `safeHexColor(p.themeColor)` (`:208`), ô mã viền đứt riêng (`:229-241`).
- Đề xuất: tiêu đề + phụ đề của khuyến mãi thành 1 dòng `SectionHeader subtitle`. Mã hiện bằng `VoucherTicket variant="chip"` có nút "Lưu" / "Dùng". Bỏ viền theo `themeColor`; nếu cần màu nhãn thì chỉ dùng cho chấm nhỏ 8px bên trái tiêu đề.

**BR-05 · P1 · API nhãn** (IA-08, nêu để nối vào bố cục)
- Bằng chứng: `take: 30` mà không trả `productCount` (`brand.service.ts:112-117`).
- Đề xuất: trả `productCount`. Tab "Sản phẩm (n)" phân trang qua catalog lọc theo nhãn.

### Ưu đãi `/offers`

**OF-01 · P1 · /offers**
- Bằng chứng: `CouponCard` có 2 nút `fullWidth` (`coupon-card.tsx:53-60`). Thẻ 134pt × 8 (ảnh `s2–s4`). Màu freeship và giảm giá như nhau (`:27`).
- Đề xuất: `VoucherTicket variant="ticket"` (B9) khoảng 88pt, cuống trái theo loại, 1 nút sm "Dùng". "Sao chép" và điều kiện đầy đủ nằm trong sheet khi chạm thân thẻ. Thay `CouponCard` ở `offers.tsx:248-250`.

**OF-02 · P1 · /offers**
- Bằng chứng: mã xếp `orderBy: { id: 'asc' }` (`loyalty.service.ts:871`). SHIP0D hết hạn 03/11 nằm thứ 7 (ảnh `s3`).
- Đề xuất: `sortVouchers()` trong app-core: dùng được và sắp hết hạn (`isCouponExpiring`) → giá trị giảm quy ra đồng lớn trước → HSD gần trước. Thẻ sắp hết hạn ghi "Còn n ngày" thay "HSD dd/mm/yyyy".

**OF-03 · P1 · /offers**
- Bằng chứng: thẻ điểm (`offers.tsx:112-196`) + điểm danh (`:199-201`) + 6 dòng tiện ích (`:204-228`) đứng trước mã. Mã bắt đầu ở khoảng 1.020pt (ảnh `s2`).
- Đề xuất: bố cục 3.4:
  - MemberStrip 72pt.
  - Điểm danh gọn 112pt, luật vào sheet (i). `DailyCheckInCard` thêm prop `compact`.
  - Tiện ích thành lưới 4 cột dùng `ui/tiles.tsx`.
  - Kho voucher có tab `Chip` (Tất cả, Freeship, Giảm giá, Của shop, Sắp hết hạn).

**OF-04 · P1 · /offers** (IA-09): khách vãng lai chỉ gặp màn mời đăng nhập (`offers.tsx:101-106`). Thứ tự dành cho khách vãng lai theo C6.

### Giờ vàng

**FS-01 · P1 · Trang chủ**
- Bằng chứng: chip "Còn 13h 30m" (`flash-sale.tsx:125-131`, `countdown-format.ts:13`) không nhảy giây và nằm bên phải như một nhãn phụ.
- Đề xuất: `Countdown variant="blocks"` (B7) là trailing của `SectionHeader tone="promo"`:
  - Ô số nền `--color-countdown-bg`.
  - Từ 24 giờ trở lên: "Kết thúc lúc 12:00 ngày 1/11".
  - Dưới 24 giờ: HH:MM:SS.
  - `prefers-reduced-motion` thì vẫn nhảy số (đổi chữ, không phải chuyển động) nhưng bỏ hiệu ứng lật.

**FS-02 · P1 · Trang chủ**
- Bằng chứng: thẻ 132 × 285pt có tên 2 dòng + phân loại + giá + giá gạch + thanh + chữ (`flash-sale.tsx:36-42,162-189`).
- Đề xuất:
  - Thẻ khối Trang chủ theo 3.5a: rộng 112 (rail sm), giá md màu flash, tên 1 dòng, bỏ phân loại và giá gạch. `FlashSoldBar` **[mới]** có chữ trong thanh, luôn hiện kể cả 0%.
  - Dùng `ProductTile` biến thể `flash` mà design-system đề xuất (D5), không vẽ tay.

**FS-03 · P1 · Trang chủ** (IA-05)
- Bằng chứng: kệ "Sắp diễn ra" cỡ đầy đủ với 3 nút primary (`flash-sale.tsx:234-262,305-331`, ảnh `home-flash-upcoming`).
- Đề xuất:
  - Khi có suất đang chạy: 1 dòng "Suất kế tiếp 12:00 trưa · 6 món [Nhắc tôi]" dưới kệ. Nút secondary sm, nhắc cả suất. Nhắc cả suất cần API mới hoặc vòng lặp `setFlashReminder` theo món.
  - Khi không có suất chạy: khối đổi tiêu đề thành "Giờ vàng 12:00 trưa", Countdown "Bắt đầu sau", thẻ mờ nhẹ, 1 nút Nhắc cho cả suất.
  - "Bắt đầu sau 13h 30m" gãy dòng: dùng giờ tuyệt đối "12:00 mai".

**FS-04 · P1 · thiếu màn**: trang `/flash-sale` theo 3.5b (D1 ia-merch, API ở backend-gap). Món hết suất vẫn hiện mờ để thấy độ khan hiếm, cần API trả `soldOut`.

**FS-05 · P2 · Trang chủ**
- Bằng chứng: badge "-34%" ở góc trái ảnh (`flash-sale.tsx:44-50`), trong khi thẻ ở lưới dùng "Giờ vàng -30%" kèm icon (ảnh `s-slug…s2`).
- Đề xuất: theo luật nhãn của design-system B3. Trong khu Giờ vàng chỉ cần "-34%" (ngữ cảnh đã rõ), đặt góc phải trên ảnh để không đụng cờ "Mới" bên trái. Ngoài khu Giờ vàng giữ "Giờ vàng -x%".

---

## 5. Thành phần

| Thành phần | Loại | Dùng ở | Ghi chú |
|---|---|---|---|
| `StorePageShell` | mở rộng | /s, /brand | thêm `stats`, `actions` (Theo dõi/Chia sẻ), `topBar`; bỏ `stickyBar` cho khách |
| `ShopTopBar` | **mới** | /s, /brand | trong suốt trên bìa, sang surface + tên/ô tìm khi cuộn; tái dùng logic `scrolled` của `back-button.tsx` |
| `ShopStatsRow` | **mới** | /s, /brand | 3 cột, số từ `shopStats()` app-core |
| `ShopSection` | **mới** | /s, /brand, màn dựng (xem trước) | rẽ nhánh theo `layout`/`kind`, cắt theo `sectionView()` |
| `SectionCard`, `LayoutPicker`, `QuestStrip`, `ShopHealth` | **mới** | /storefront | chỉ dùng ở màn dựng; LayoutPicker là radio group có hình |
| `FlashSoldBar`, `SlotTabs` | **mới** | Giờ vàng | FlashSoldBar bọc `ProgressBar tone="flash"` + chữ; SlotTabs bọc `SegmentedTabs` |
| `SectionHeader`, `ProductRail`, `ProductGrid`, `Countdown`, `VoucherTicket`, `ComboCard` | mới, đã đặc tả ở design-system B5–B10 | tất cả | dùng đúng props đã đặt |
| `ProductTile` | mở rộng | /s, /brand | prop `note`, `showBrand` |
| `DailyCheckInCard` | mở rộng | /offers | prop `compact` |
| `SegmentedTabs`, `Chip`, `ScrollRow`, `BottomSheet`, `StickyActionBar`, `Tiles` | có sẵn | | |

---

## 6. Cơ chế để màn làm sau vẫn khớp (riêng phần gian hàng)

Bổ sung cho ia-merch F và design-system C, không thay hai mục đó.

1. **Một nguồn sự thật cho khối gian hàng.** File `packages/app-core/src/storefront-sections.ts`:
   ```ts
   export const SECTION_TYPES = {
     CAROUSEL: { label: 'Kệ ngang', maxVisible: 10, minItems: 2, render: 'rail' },
     GRID:     { label: 'Lưới',     maxVisible: 6,  minItems: 2, render: 'grid' },
     STACK:    { label: 'Danh sách', maxVisible: 5, minItems: 1, render: 'line' },
   } as const satisfies Record<CollectionLayout, SectionTypeSpec>;
   export const COMBO_SPEC = { minItems: 2, maxItems: 5, render: 'combo' } as const;
   export const MAX_SHOP_TAB_SECTIONS = 6;
   export function sectionView(c, opts): { render, visible, hiddenCount, warnings: SectionWarning[] };
   export function shopHealth(sf): { score, total, todos };
   export function shopStats(collections): { productCount, rating?, sold? };
   ```
   - `satisfies Record<CollectionLayout, …>`: thêm một giá trị vào enum Prisma mà chưa khai ở đây thì `tsc` báo lỗi. Kiểu mới không thể lọt vào mà UI không biết vẽ.
   - Trang công khai (Mini + web), màn dựng (cảnh báo, "x/y món") và bản xem trước đều gọi `sectionView`. Không nơi nào được tự `slice`.
2. **Spec chặn CI** `storefront-sections.spec.ts`: mỗi `layout` có `maxVisible` trong ngân sách R2 của ia-merch; `sectionView` cắt đúng; combo dưới 2 món trả `render: 'hidden'`; L1–L6 có ca kiểm. Cộng thêm spec render (ia-merch F5) ở `storefront-view.spec.tsx` và `apps/web/src/app/s/storefront-page.spec.tsx`: một bộ mỗi kiểu phải ra đúng `data-testid` (`shop-rail`, `shop-grid`, `shop-line`, `shop-combo`).
3. **Xem trước = trang thật.** Spec ở `storefront-builder.spec.tsx`: trang chi tiết khối dựng `ShopSection` (tìm `data-testid="shop-section-preview"`). `storefront-preview.tsx` không còn lưới tự vẽ. Thêm vào `ds-shop-guard` (T1 design-system) mục cấm `gridTemplateColumns` trong `pages/storefront-*.tsx` và `pages/brand-view.tsx`.
4. **Chữ khối dùng chung.** `LAYOUT_LABEL`, `KIND_LABEL` chuyển từ web lên `SECTION_TYPES.label`. `pnpm lint:parity` thêm kiểm: web không còn khai riêng.
5. **Màn shop mới** (ví dụ trang đối tác, trang chiến dịch theo nhãn) phải dựng từ `StorePageShell` + `ShopSection`. Ghi thành 1 dòng trong mục "Kệ hàng" mà ia-merch F6 đề xuất đặt ở `AGENTS.md`.

---

## 7. Sai lệch so với báo cáo cùng đợt

- **IA-07 (ia-merch)** ghi "Web thì có [chọn bố cục, combo]". Mã hiện tại cho thấy web **không có**: `NewCollectionForm` chỉ có tên (`apps/web/src/components/affiliate/storefront-sheets.tsx:443-449`), sửa chỉ đổi tên (`:421`), còn `storefront-builder.tsx:347-354` chỉ *hiển thị* nhãn. Cả hai app đều phải làm LayoutPicker (SB-01). Không có lệch giữa hai nền tảng, chỉ là cùng thiếu.
- **IA-06**: tôi đề xuất nâng lên P0 (ST-01) vì đây là lời phàn nàn chính của chủ ("rối, dàn trải") và là thay đổi giao diện thuần, dữ liệu đã có sẵn.
- Dữ liệu lane 7: "Sản phẩm nổi bật" có 8 dòng `storefront_items` nhưng trang và màn dựng đều chỉ hiện 4. Bốn dòng kia có thể là món không còn bán hoặc chưa duyệt, đã bị lọc. Tôi chưa kiểm tiếp. Nếu đúng vậy thì màn dựng nên nói "4 món bị ẩn vì ngừng bán" thay vì im lặng (`hiddenReason` đã có cho từng món, `storefront-builder.tsx:417-421`).

---

## 8. Câu hỏi cho chủ (kèm mặc định đề xuất)

1. **Q1. Bậc CTV trên trang shop công khai**: (a) ẩn bậc thấp nhất "Tân binh", hiện từ bậc 2 *(mặc định)*; (b) ẩn hết bậc với khách; (c) giữ như cũ.
2. **Q2. Thứ tự tab Ưu đãi cho khách đã đăng nhập**: (a) điểm + điểm danh gọn ở đầu, rồi Giờ vàng, rồi Kho voucher *(mặc định, 3.4)*; (b) Giờ vàng + Kho voucher lên đầu như ia-merch C6.
3. **Q3. Theo dõi gian hàng CTV**: backend chỉ có `BrandFollow`. (a) Đợt này chưa làm, CTV dùng Chia sẻ *(mặc định)*; (b) thêm `StorefrontFollow` + nút như nhãn hàng.
4. **Q4. Giờ vàng ở Trang chủ có hiện tên món không**: (a) tên 1 dòng *(mặc định, vì ảnh SP thật còn ít)*; (b) bỏ tên như Shopee khi đã đủ ảnh.
5. **Q5. Trần khối ở tab Shop**: (a) 6 khối *(mặc định)*; (b) 8; (c) không giới hạn, chỉ cảnh báo.
