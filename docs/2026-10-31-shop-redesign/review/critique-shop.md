# Critique thị giác gian hàng Mini App 375 (design lead TMĐT), 2026-10-31

Phạm vi: Trang chủ (guest, new, returning), Danh mục + tìm kiếm, chi tiết SP, giỏ. Khổ `mini375`. Mã main 13536d955.
Skill đã áp: `design:design-critique` (ấn tượng 2 giây, dùng được, thứ bậc, nhất quán, truy cập), `taste-skill:redesign-existing-projects` (chẩn đoán trên stack có sẵn, sửa đúng chỗ, không viết lại).
Báo cáo này chấm **hình và bố cục**. Kiến trúc thông tin, hợp đồng thành phần, API thì đã có ở `ia-merch.md`, `design-system.md`, `backend-gap.md`. Ở đây chỉ dẫn chiếu, và ghi rõ chỗ nào tôi đề xuất khác.

## 0. Kết luận

1. Gốc của cảm giác "rối, dàn trải" là **thẻ sản phẩm**: thẻ cao 289–319px, cao thấp lệch nhau trong cùng lưới, dòng "· Đã bán 1,2k+" vỡ thành 2 dòng, tên nhãn hiệu lặp hai lần. Hệ quả là ở /browse và kết quả tìm kiếm, màn đầu chỉ có 2 thẻ nằm trọn. Sửa thẻ (CS-01) thì mọi màn cùng gọn hơn.
2. **Trang chủ không có điểm nhấn.** Khách cũ thấy 3 nút xanh đậm tranh nhau ở màn đầu (Điểm danh, Thanh toán, Mua lại) và không thấy món deal nào. Khối Giờ vàng cộng Sắp diễn ra cao 673px, tức 83% một màn, trong đó 3 nút "Nhắc tôi" đặc màu là vật nặng nhất trang (HM-01, HM-02).
3. Màu giá không dẫn mắt. Giá thường màu đen 14/600, giá Giờ vàng màu cam: hai hệ màu, và trong lưới không giá nào nổi lên (CS-03).
4. /browse có 3 tầng điều khiển trước kết quả. Ở trang danh mục, tên danh mục hiện 3 lần. Thẻ đầu tiên nằm ở y=332 (BR-01, BR-02).
5. Ở chi tiết SP, Giờ vàng chỉ là một hàng badge nhỏ. Chip phân loại còn hiện giá chưa giảm ("1L 120.000đ" trong khi giá trên trang là 84.000đ): đây là lỗi hiển thị (PD-01, PD-02).
6. Giỏ không cho khách thấy mình đã tiết kiệm được bao nhiêu: dòng Giờ vàng không có giá gạch, chân trang không có dòng "Tiết kiệm". Ô mã giảm giá nằm cuối danh sách (CT-02, CT-04).
7. Nền móng tốt, nên không cần viết lại. Thẻ dùng chung, token, vùng chạm 44, khung chờ chống nhảy, deep-link phân loại Giờ vàng đều đã có (mục 6). Phần lớn đề xuất là đổi số đo, gom dòng và đổi thứ tự khối.

## 1. Số đo hiện trạng

Đo bằng Playwright qua bộ khung `miniapp-session.mjs` ở lane 7. Khổ 375×812, DPR 1, chờ 3,5 giây sau khi mở. Lấy `getBoundingClientRect` của `[data-home-block]` và của các thẻ có `.tubu-tile-link`. Thanh đáy chiếm 752–812, nên vùng nhìn được của màn đầu là 0–752. Script đo (tạm, không commit): `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/12414096-9829-4bf4-9dfe-d6d21a903b3a/scratchpad/measure.mjs`.

| Màn | Persona | Khối và vị trí y (px CSS) | Thẻ SP đầu | Thẻ trọn ở màn đầu | Cao thẻ lưới |
|---|---|---|---|---|---|
| Trang chủ | guest / new | logo 0–68 · tìm 68–122 · quà 122–198 · lối tắt 198–314 · **Giờ vàng + Sắp diễn ra 330–1003 (673)** · Bán chạy 1003–1384 · Danh mục 1384–1546 · Hành trình 1546–1706 · Cộng đồng 1706–1858 · Gợi ý từ 1858 | thẻ Giờ vàng ~365; thẻ lưới đầu ở 1059 | chỉ 1 hàng thẻ Giờ vàng | 289–319 |
| Trang chủ | returning | thẻ thành viên 122–198 · Việc cần làm 198–310 · lối tắt 310–426 · **Mua lại 426–643 (1 món, 217px)** · Giờ vàng 659–1331 · Danh mục 1331 · Gợi ý từ 1825 | Giờ vàng 659, **nằm dưới thanh đáy** | 0 thẻ deal (chỉ 1 món Mua lại) | 299–319 |
| /browse | returning | tìm · tiêu đề "Danh mục" · hàng pill danh mục · chip sắp xếp · số SP + Bộ lọc | 286 | 2 trọn, 4 chạm mép | 295–319 |
| /browse?category | returning | tìm · tiêu đề title-lg · chip danh mục · chip sắp xếp · số SP + Bộ lọc · chip lọc | 332 | 2 trọn | 295–319 |
| /browse?q=nuoc | returning | tìm · chip sắp xếp · số SP + Bộ lọc | 182 | 2 trọn | 299–319 |
| Chi tiết SP | returning | ảnh 0–375 · tên 437 · **"Phân loại" 797 (dưới màn đầu)** · Thành phần 1121 · Cam kết 1325 · Mô tả 1523 · **Đánh giá 1623** · Cùng nhà 2347 | — | — | kệ 279–306 |
| Giỏ | returning | mỗi dòng ~156px (ảnh `cart__returning__mini375__s1`) | — | 3 dòng | — |

Mốc so sánh Shopee VN là **ước lượng** từ app ở khổ 375, không đo trên máy thật trong đợt này:
- Thẻ lưới cao khoảng 270–285px và mọi thẻ trong lưới cao bằng nhau.
- Lưới tìm kiếm thấy khoảng 4 thẻ trọn.
- Khối Flash Sale ở Trang chủ cao khoảng 200–230px.
- Thanh trên dính là một hàng gồm ô tìm, giỏ và chat, cao khoảng 56px.

## 2. Bảng điểm (1 = kém, 5 = tốt)

| Màn | Thứ bậc | Mật độ | Nhịp khối | Điểm nhấn | Độ gọn (5 = gọn) | Màn đầu | Mắt người dùng đi đâu |
|---|---|---|---|---|---|---|---|
| Trang chủ returning | 2 | 2 | 2 | 2 | 2 | 1 | Thẻ thành viên xanh đậm → nút "Thanh toán" xanh đậm → nút "Mua lại" xanh nhạt to → dừng ở hàng lối tắt bị cắt. Chưa gặp deal nào trước khi phải cuộn. |
| Trang chủ guest/new | 3 | 3 | 2 | 3 | 3 | 3 | Nút "Nhận quà" → nhãn -34% cam → giá cam. Cuộn tiếp gặp 3 nút "Nhắc tôi" xanh đặc, mắt bị kéo sang deal chưa mở. |
| /browse gốc | 3 | 2 | 3 | 2 | 3 | 2 | Chip "Gợi ý" đặc xanh → nút "Bộ lọc" → thẻ. Không có gì nói "bắt đầu từ đâu". |
| /browse?category | 2 | 2 | 3 | 2 | 2 | 2 | Tiêu đề serif to → chip danh mục đặc → chip "Gợi ý" đặc → chip lọc đặc: 3 khối đặc xanh trước món đầu. |
| Tìm kiếm | 3 | 3 | 3 | 3 | 3 | 3 | Ổn nhất: ô tìm → chip → thẻ ở y=182. |
| Chi tiết SP | 2 | 3 | 3 | 3 | 2 | 3 | Giá xl đen → tim đỏ → 5 dòng chữ xanh và cam nhỏ, mắt nhảy. Giờ vàng không thành điểm nhấn. |
| Giỏ | 3 | 2 | 4 | 4 | 3 | 3 | Nút Thanh toán rõ. Nhưng thanh "miễn phí giao" đầy 100% chiếm chỗ mà không nói thêm gì. |

## 3. Phát hiện chung (mọi màn có thẻ sản phẩm)

| ID | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| CS-01 | **P0** | Mọi lưới và kệ | `product-tile.tsx:157-165` (dòng nhãn hiệu), `:214-232` (dòng meta là flex, không `nowrap`, nên "· Đã bán 8,7k+" vỡ 2 dòng); đo 289–319px; ảnh `browse-all__returning__mini375__s1..s3`, `home__returning__mini375__s4` | Thẻ cao và lệch nhau tới 30px, nên giá trong cùng một hàng nằm ở độ cao khác nhau. Tên nhãn lặp: dòng nhãn hiệu cộng tên SP (127/129 tên SP trong dữ liệu mẫu đã chứa tên nhãn; dữ liệu thật thì chủ cần xác nhận). | Thân thẻ `grid` mới, cao **cố định**, mọi dòng đều giữ chỗ: đệm 8 (`--tile-inset`) · tên body-sm 2 dòng (44, giữ `TILE_NAME_MIN_HEIGHT`) · 4 · hàng giá 22 (CS-03) · 2 · hàng meta 16 · 8, tổng **104**, thẻ ≈ 270 (đang 289–319). (1) Hàng meta: "★ 4,8 · Đã bán 1,2k" caption, bỏ "(20)" ở lưới, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. (2) Bỏ dòng nhãn hiệu khi tên đã chứa tên nhãn (hàm `nameHasBrand(name, brand)` ở app-core, so sánh không dấu); trên trang nhãn luôn ẩn (`hideBrand` của design-system B2). (3) Cập nhật `TILE_BODY_HEIGHT` (`catalog-grid.tsx:73-84`), skeleton và e2e `buy-flow-4b`. Kết quả ước tính: tìm kiếm có 4 thẻ trọn ở màn đầu (hàng 182–452 và 464–734). |
| CS-02 | P1 | Mọi lưới | `product-tile.tsx:119-128` xếp 2 nhãn chồng dọc; `catalog-grid.tsx:34-41` dùng `tone="promo"` nền orange-50; ảnh `home__guest__mini375__s24` (-10% chồng "Mới") | Nhãn -x% nền cam nhạt chìm trên nền ảnh sáng. Hai nhãn chồng nhau che ảnh. | Góc trên trái ảnh chỉ để **1 nhãn đặc**: Giờ vàng dùng `--color-flash-solid-*` như hiện nay; -x% dùng `--color-promo-solid-bg/fg` (cùng hình, khác chữ). "Mới" chuyển thành nhãn chữ nhỏ đứng đầu dòng tên (inline, cao 16, `Badge size="sm" tone="brand"`), không chồng lên ảnh. |
| CS-03 | P1 | Mọi lưới, chi tiết SP, giỏ | `tokens.css:113` `--color-text-price: stone-900`; `PriceTag size="sm"` 14/600 ở thẻ (`product-tile.tsx:236`); Giờ vàng dùng `--color-flash-fg` (`price-tag.tsx:21`) | Giá là thứ khách quét đầu tiên ở TMĐT, nhưng ở đây giá đen mảnh nằm dưới tên, ngang hàng với chữ thường. Giá Giờ vàng thì lại màu cam: hai hệ màu. | Trả lời câu E3 của design-system: giá **đang giảm** (sale hoặc Giờ vàng) dùng token mới `--color-text-price-deal` (= `--orange-800`, cặp màu đã đạt tương phản như `--color-flash-fg`, thêm vào `contrast.spec.ts`). Giá thường giữ `stone-900`. Ở thẻ lưới dùng `price-md` 16 thay `sm`. Giá gạch ở lưới **bỏ** khi ô không đủ rộng (đã có % trên ảnh); ở kệ và chi tiết SP giữ. |
| CS-04 | P2 | Mọi lưới | `product-tile.tsx:193-197` (`WishlistHeart floating`) | Đĩa trắng 32px ở mọi thẻ, mỗi hàng có 2 đĩa, tranh chỗ với nhãn %. | Tim không nền: icon 20, `filter: drop-shadow` nhẹ, vùng chạm 44 nhờ `tubu-hit-44`. Trạng thái đã thích (tim đỏ đặc) giữ nguyên. |
| CS-05 | P1 | Trang chủ (khối) | `flash-sale.tsx:118` marginTop 16; `best-seller-rail.tsx:27-30` đệm 8/4 cộng header 44; `category-row.tsx:21-23` đệm 4/8 + 8/4; `suggest-feed.tsx:58` đệm trên 16; lối tắt cao 116 nhưng nội dung chỉ ~76 vì "Tích điểm đơn sàn" xuống 2 dòng làm cả hàng cao theo (`shortcut-grid.tsx:45-46`, nhãn clamp 2 dòng); ảnh `home__guest__mini375__s1` | Khoảng trống giữa các khối lúc 55px (dưới lối tắt), lúc 18px (giữa 2 kệ Giờ vàng): không có nhịp. Tiêu đề khối lúc có "Xem tất cả", lúc không; Giờ vàng không có lối "Xem tất cả" nào. | Dùng `SectionHeader` + `Section` (design-system B5). Khoảng cách đặt **ở vỏ khối** `data-home-block` trong `home.tsx:155` (`margin-top: var(--space-block)` = 16), khối con không tự đặt đệm. Mọi khối hàng đều có "Xem tất cả" và có trang đích (ia-merch R5). Nhãn lối tắt chỉ 1 dòng (đổi chữ "Tích điểm đơn sàn" → "Đơn sàn" hoặc chuyển vào sheet "Tất cả", xem HM-03). |
| CS-06 | P1 | Trang chủ | `home.tsx:176` (`STICKY_SEARCH` chỉ bọc ô tìm), `SearchShell :179-213`; hàng logo + chuông + giỏ cao 68 và cuộn mất; ảnh `home__returning__mini375__s2` (thanh dính không có giỏ) | Cuộn xuống lưới Gợi ý thì không còn lối vào giỏ (/browse thì có: `browse.tsx:200` `CartButton`). Hàng logo tốn 68px ở màn đầu. | Gộp thành **một header dính cao 56px**: [dấu logo 28] [ô tìm flex] [chuông 44] [giỏ 44, `CartBadge`]. Bỏ hàng logo riêng. Tiết kiệm 66px ở màn đầu. Cập nhật mốc `top` trong các spec chống nhảy của Trang chủ. |

## 4. Theo màn

### 4.1 Trang chủ

**Ấn tượng 2 giây.**
- Khách cũ: "đây là trang tài khoản", vì khối nặng nhất là thẻ thành viên gradient xanh đậm (`member-card.tsx:36`).
- Khách mới: "có deal". Giờ vàng hiện ngay màn đầu, đúng hướng, nhưng ngay dưới là kệ "Sắp diễn ra" giống hệt, làm loãng.

So với Shopee: Shopee dùng màn đầu cho (1) ô tìm dính, (2) banner chiến dịch, (3) lưới lối tắt, (4) đầu Flash Sale. Tubu có (1) và (3). Thiếu (2). (4) thì quá to với khách mới và rơi khỏi màn đầu với khách cũ.

| ID | Mức | Persona | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| HM-01 | **P0** | returning | Đo: Mua lại 426–643, Giờ vàng 659; ảnh `home__returning__mini375__s1`; thứ tự `home-layout.ts:20-22` | Màn đầu không có món deal nào. Ba CTA xanh đậm (Điểm danh, Thanh toán, Mua lại) không có cái nào là chính. | Bố cục mới ở sơ đồ A. (1) Header dính 56 (CS-06). (2) Thẻ thành viên nền sáng (HM-05). (3) Việc cần làm 1 dòng (HM-06). (4) Banner nếu có. (5) Lối tắt 5 ô (HM-03). (6) **Giờ vàng gọn (HM-02) lên trước Mua lại**. (7) Mua lại 1 món thì là 1 dòng (HM-04). Giờ vàng nằm trọn trong màn đầu (≈ 318–580 khi không có banner, ≈ 470–730 khi có banner). Điểm này khác ia-merch C5 (đặt Mua lại trước Giờ vàng), xem câu hỏi Q3. |
| HM-02 | **P0** | mọi persona | `flash-sale.tsx:36-42` (thẻ 132), `:147-178` (6 dòng chữ: tên 2 dòng, phân loại, giá, giá gạch xuống dòng riêng, thanh, chữ %), `UpcomingFlashSales :259-333`, khối kệ `:306`, `home.tsx:124-129`; đo 673px; ảnh `extras/home-flash-active__returning__mini375.png` | Khối deal chiếm 83% màn. Kệ "Sắp diễn ra" lặp hình kệ đang chạy, và 3 nút "Nhắc tôi" đặc màu là điểm nhấn mạnh nhất trang, đẩy deal đang bán xuống vai phụ. Đồng hồ "Còn 13h 33m" dạng pill không tạo cảm giác gấp. | **Khối Giờ vàng cao ≈ 262px**: header 44 = "⚡ Giờ vàng" (`SectionHeader tone="promo"`) + `Countdown variant="blocks"` (design-system B7) + "Xem tất cả ›" tới trang Giờ vàng (ia-merch D1). Thẻ `flash` rộng 128 (`--tile-w-sm`): ảnh 1:1 với nhãn -x% đặc, tên **1 dòng** caption, giá flash 16/700, thanh 16px có chữ bên trong ("Đã bán 68%", từ 90% trở lên đổi thành "Sắp hết"). Bỏ giá gạch ở thẻ. **Bỏ kệ Sắp diễn ra khỏi Trang chủ**: chuyển thành tab khung giờ trên trang Giờ vàng. Ở Trang chủ chỉ thêm 1 dòng 40px dưới kệ: "12:00 · 6 deal sắp mở · Nhắc tôi ›", và chỉ khi suất kế tiếp mở trong ≤ 6 giờ. Không có suất đang chạy thì khối hiện trạng thái "sắp mở" (thẻ mờ cộng Countdown "Bắt đầu sau"). Sửa `FLASH_SKELETON_HEIGHT` và `HOME_SETTLING_HEIGHTS.flash` (`home-layout.ts`). |
| HM-03 | P1 | mọi persona | `home-layout.ts:139-148` (8 mục), `shortcut-grid.tsx:26-27,46` (ô 76, cuộn ngang); ảnh s1 (mục thứ 5 bị cắt còn "Mã củ…") | Thấy 4,6 mục. Mục bị cắt giữa chữ trông như lỗi chứ không như gợi ý cuộn. Trộn mục mua sắm với mục chương trình. Khách vãng lai thấy "Đơn hàng". | **5 ô cố định, không cuộn**: mỗi ô rộng (375−32)/5 ≈ 68, vòng 44, nhãn caption 1 dòng. Bốn mục chủ chốt cộng ô "Tất cả" mở sheet chứa các mục còn lại. Mặc định đề xuất: Giờ vàng · Mã giảm giá (kho voucher, ia-merch D3) · Mua chung · Đổi quà · Tất cả. Cao 84 (đang 116). Hàm `visibleHomeShortcuts` thêm tham số `slots: 4`, phần dư vào sheet. Câu hỏi Q2. |
| HM-04 | P1 | returning | `purchased-rail.tsx:203-240` (thẻ đơn có nút full width); đo 217px | Một món mà chiếm cả một khối to bằng một màn con. | Có 1 món thì dùng `ProductTile variant="line"` (ảnh 64) và nút "Mua lại" secondary ở bên phải, cao 88. Có từ 2 món thì giữ kệ `rail`. |
| HM-05 | P1 | returning | `member-card.tsx:36,93` gradient `--color-action-primary-bg` | Khối thông tin tài khoản nặng hơn mọi khối hàng. | Nền `--color-bg-surface`, viền `--color-border-subtle`, chữ forest-700. Nút "Điểm danh" là điểm màu duy nhất (primary sm). Giữ `HOME_HERO_HEIGHT` 64 để không phá chống nhảy. |
| HM-06 | P2 | returning | `todo-strip.tsx:136-160` (thẻ outline, nút lớn); đo 112px | Một việc chiếm 112px với nút primary to. Hợp lý về độ gấp nhưng tốn chỗ. | Một dòng 64px: ⚠ "120.000đ chờ chuyển khoản · còn 23:49" + nút "Thanh toán" size sm, viền trái 3px `--color-status-warning-fg`. Sửa `todoSkeletonHeight` cho khớp. |
| HM-07 | P1 | mọi persona | `category-row.tsx:9-10,63-69` (vòng 56 nền `--color-bg-subtle` gần trùng nền trang, biểu tượng đơn sắc); ảnh `home__guest__mini375__s3` ("Giặt xả" dùng biểu tượng ô lưới dự phòng, trông giống "Tất cả") | Danh mục khó nhận ra, cần cuộn, và nằm ở y≈1384 với khách mới, sau 2 kệ hàng. | Lưới **2 hàng × 5 cột** (10 ô vừa 1 màn ngang; quá 10 thì cuộn ngang theo cột 2 hàng). Ô 56 có nền màu xoay vòng theo `SHORTCUT_TINT_VARS`, hoặc ảnh `category.image` khi có. Ô cuối là "Tất cả ›". Danh mục mới cần biểu tượng riêng (`use-categories` map). Ở khách mới, Danh mục lên **trước** Top bán chạy. |
| HM-08 | P1 | mọi persona | `suggest-feed.tsx:62-77`; thứ tự mặc định `catalog.service.ts:621-629` (`isFeatured` rồi `id`); ảnh `home__returning__mini375__s4..s12` (6 thẻ Fuwa3e liền nhau, rồi 4 Cobote, rồi 4 Cobote nữa) | Chạy dài cùng nhãn trông như đang xem catalog một nhãn: đây chính là cảm giác "dàn trải, lặp". Đổi chip ở đầu lưới thì phải cuộn ngược hơn 20 màn. | Thứ tự xen kẽ "≤ 2 món liền nhau cùng nhãn" như ia-merch D2. Phần hình: hàng chip của "Gợi ý hôm nay" **dính** dưới header khi lưới chạm đỉnh (`position: sticky; top: 56`). Mỗi 20 thẻ chèn 1 ô nghỉ mắt rộng 2 cột (banner hoặc combo hoặc lối vào danh mục), dùng thành phần của D3/D4, không làm thành phần riêng. |
| HM-09 | P2 | mọi persona | `brand-journey.tsx`; ảnh s3 | Chip nhãn hàng trông giống hệt chip lọc, dễ hiểu sai vai trò. Khối cao 160. | Hàng logo tròn 48 cộng tên nhãn bên dưới (`InitialsAvatar` khi chưa có logo). Khối cao ~120. |
| HM-10 | P2 | mọi persona | `community-preview.tsx`; đo 152–172 | Một câu hỏi chiếm 1/5 màn giữa trang mua sắm. | Một dòng `ListRow` 56: 💬 câu hỏi (1 dòng, "…") · "1 trả lời" · ›. |
| HM-11 | P2 | new | ảnh `home__new__mini375__s1` ("Miễn phí giao hàng cho đơ…", nút "Chọn sản phẩm" nền nhạt) | Giá trị của quà bị cắt mất. Nút nhạt hơn khách vãng lai ("Nhận quà" đặc). | Tiêu đề 1 dòng đủ ý ("Freeship đơn đầu tiên") và nút cùng kiểu với bản guest. Chi tiết điều kiện để trong sheet. Câu chữ chốt bên `ux-copy.md`. |

**Khối: giữ, bỏ, gộp, chuyển**

| Khối hiện tại | Quyết định | Ghi chú |
|---|---|---|
| Hàng logo + chuông + giỏ (68) | gộp vào header dính 56 | CS-06 |
| Ô tìm dính | giữ, thêm chuông và giỏ | CS-06 |
| Thẻ thành viên / Quà khách mới | giữ, nền sáng, 1 điểm màu | HM-05, HM-11 |
| Việc cần làm | giữ, còn 1 dòng | HM-06 |
| Banner chiến dịch | **thêm** sau Việc cần làm | `BannerCarousel` (design-system B8), tỉ lệ 5:2 |
| Lối tắt 8 mục cuộn | thu còn 5 ô cố định + sheet | HM-03 |
| Giờ vàng | giữ, thu còn ~262, đứng trước Mua lại | HM-02 |
| Sắp diễn ra (kệ) | **bỏ khỏi Trang chủ**, thành 1 dòng nhắc; kệ đầy đủ chuyển sang trang Giờ vàng | HM-02 |
| Mua lại | giữ, 1 món thì là 1 dòng | HM-04 |
| Bán chạy (chỉ khách mới) | thay bằng Top bán chạy có hạng, cho cả 2 loại khách | ia-merch D1, thẻ `rank` |
| Danh mục (hàng tròn) | lưới 2×5; khách mới đứng trước Top | HM-07 |
| Combo tiết kiệm | **thêm** (khách mới) | ia-merch C5, `ComboCard` |
| Hành trình nguyên liệu | giữ, đổi chip thành logo | HM-09 |
| Cộng đồng hỏi đáp | thu còn 1 dòng | HM-10 |
| Gợi ý cho bạn | đổi tên "Gợi ý hôm nay", chip dính, xen kẽ nhãn | HM-08 |

**Sơ đồ A: Trang chủ khách cũ, 375** (y ước tính, có banner)

```
 y   ┌───────────────────────────────────────────┐
   0 │ (o) [🔍 Bạn đang tìm gì hôm nay?   ] 🔔  🛒6│ 56  header DÍNH (thay logo 68 + tìm 54)
  56 │ Lộc Biếc · 35.400 điểm ≈ 35.400đ [Điểm danh]│ 64  nền sáng, nút là điểm màu duy nhất
 120 │ ▌⚠ 120.000đ chờ CK · còn 23:49 [Thanh toán] │ 64  chỉ khi có việc
 184 │ ┌───────── banner chiến dịch 5:2 ─────────┐ │ 137 ẩn khi 0 banner
     │ └───────────────── • ○ ○ ─────────────────┘ │
 337 │  (⚡)     (🎟)     (👥)     (🎁)     (⋯)     │ 84  5 ô, không cuộn
     │ Giờ vàng Mã giảm Mua chung Đổi quà  Tất cả  │
 421 │ ⚡ Giờ vàng  [13]:[33]:[05]    Xem tất cả › │ 44
     │ ┌─────┐┌─────┐┌─────┐┌──                   │
     │ │-34% ││-30% ││-25% ││                     │ 128 thẻ 128px, thấy 2,6 thẻ
     │ └─────┘└─────┘└─────┘└──                   │
     │ Nước rửa…Nước rửa…Cà phê…                  │ tên 1 dòng
     │ 33.000đ  84.000đ  94.000đ                  │ giá deal 16/700
     │ [▓Sắp hết][▓▓68%░][▓17%░░]                 │ thanh 16, chữ trong thanh
 ~700│ 12:00 · 6 deal sắp mở           Nhắc tôi › │ 40  chỉ khi suất kế ≤ 6 giờ
 752 ╞════════════════ thanh đáy ═════════════════╡
     │ Mua lại                        Xem tất cả ›│ 1 món: 1 dòng 88; ≥2: kệ rail
     │ Danh mục        lưới 2 hàng × 5 + Tất cả › │ ~176
     │ Top bán chạy    kệ có ruy-băng hạng 1..10   │
     │ Hành trình nhãn  logo tròn                  │ ~120
     │ 💬 Câu hỏi cộng đồng (1 dòng)            ›  │ 56
     │ Gợi ý hôm nay [Tất cả|Mẹ & bé|Nhà sạch…]   │ ← hàng chip dính dưới header khi cuộn
     │ ┌────────┐ ┌────────┐  lưới 2 cột, thẻ 270  │
```

**Sơ đồ B: Trang chủ khách mới/vãng lai, 375**: giống A, nhưng thay thẻ thành viên bằng dải "Quà khách mới" (64), không có Việc cần làm (trừ khi có đơn chờ), không có Mua lại. Sau Giờ vàng là: Danh mục 2×5 → Top bán chạy → Combo tiết kiệm → Hành trình → Cộng đồng → Gợi ý hôm nay. Màn đầu (không banner): header 56 · quà 64 · lối tắt 84 · Giờ vàng 204–466 · dòng nhắc · đầu Danh mục.

### 4.2 Danh mục và tìm kiếm

**Ấn tượng 2 giây.** Màn này là một bảng điều khiển: hai hàng chip to 44px, nút "Bộ lọc" nền xanh nhạt, rồi mới tới hàng. Ở gốc, danh mục là hàng pill một dòng chỉ thấy được 1,5 mục (`category-grid.tsx:9-11`), nên không trả lời được câu "shop có những loại gì".
So với Shopee: danh sách kết quả của Shopee có **một** thanh dính "Liên quan | Mới nhất | Bán chạy | Giá ⇅ | Lọc" dạng chữ có gạch chân, không dùng chip.

| ID | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| BR-01 | P1 | /browse, danh mục, tìm | `sort-chips.tsx:22` (hàng chip 44 + đệm 6), `result-header.tsx:24-35` (hàng số SP + nút "Bộ lọc" 44); đo thẻ đầu 286 / 332 / 182 | Hai hàng điều khiển ~100px. Chip đặc xanh là thứ nặng nhất màn, nặng hơn cả thẻ hàng. Hai chip "Giá tăng" và "Giá giảm" làm hàng dài, mục cuối bị cắt. | Thành phần mới **`SortBar`**: một hàng dính 44 dưới ô tìm, 4 tab chữ label 14/600, mục đang chọn có gạch chân 2px `--color-border-selected` và chữ `--color-text-brand`. Các tab: "Phổ biến" (khi tìm thì đổi thành "Liên quan") · "Bán chạy" · "Mới" · "Giá ⇅" (một tab, chạm lần nữa thì đảo chiều, mũi tên chỉ chiều đang dùng) · "Lọc ⚙ (n)" ở mép phải. Số kết quả chuyển thành caption ở dòng tiêu đề ("21 sản phẩm"). Bỏ hàng `ResultHeader` riêng; chip lọc đang bật vẫn hiện dưới thanh khi có. Ước tính thẻ đầu ở ~140 (tìm) và ~190 (danh mục). |
| BR-02 | P1 | /browse?category | ảnh `browse-category__returning__mini375__s1`; `browse.tsx:224-244` (tiêu đề title-lg + `CategoryChips`) cộng chip lọc "Tẩy rửa sinh học ×" từ `chips` của search-state | Tên danh mục hiện 3 lần trên 330px. | Không tạo chip lọc gỡ được cho `category` khi `CategoryChips` đang hiện, vì chip active ở đó đã cho đổi hoặc gỡ. Tiêu đề hạ từ title-lg xuống `title-sm` một dòng, kèm số SP caption. Khi có danh mục con (ia-merch C2) thì hàng chip đổi thành chip con. |
| BR-03 | P1 | /browse gốc | `browse.tsx:245-273`; ảnh `browse-all__returning__mini375__s1`, `s8` (129 món sắp theo `isFeatured`, nút "Xem thêm") | Tab "Danh mục" mở ra một danh sách 129 món, không có chỗ bắt đầu. | Làm theo hub của ia-merch C2. Phần hình là sơ đồ C: lưới danh mục 2×4 ô 72 (nền màu như HM-07) + ô "Tất cả SP", rồi Đã xem gần đây (kệ `sm`), Top bán chạy (kệ `rank`), Thương hiệu (lưới logo 4×3). Không có lưới SP ở gốc. |
| BR-04 | P2 | /browse | ảnh `browse-all__returning__mini375__s8` (nút "Xem thêm" thủ công) và `suggest-feed.tsx` (tự tải) | Trang chủ tự tải thêm còn Danh mục bắt bấm nút: hai hành vi khác nhau. | Dùng chung `ProductGrid` (design-system B6) với luật tải lai R2 của ia-merch: tự tải 3 trang đầu rồi mới hiện nút. |
| BR-05 | P2 | đang gõ | ảnh `browse-search-typing__returning__mini375__s1` | Gợi ý chỉ là danh sách tên + giá đen, thumbnail 40 nhạt. Món đang giảm hay Giờ vàng trông như mọi món khác. | Dòng gợi ý SP dùng `PriceTag` có màu deal (CS-03) và nhãn ⚡ nhỏ khi đang Giờ vàng (dữ liệu `flashSales` đã truyền vào `SuggestList`). |

**Sơ đồ C: /browse gốc (hub)**

```
   0 │ [🔍 Tìm sản phẩm…                    ] 🛒6 │ 56 dính
  56 │ Danh mục                                    │ 44 SectionHeader
     │ (🌿)    (🧴)    (👶)    (🏠)               │
     │ Da      Nhà sạch Mẹ&bé  Sống xanh           │ 2 hàng × 4, ô 72
     │ (☕)    (🧼)    (🍚)    (⊞)                │
     │ Đồ uống Cá nhân Thực phẩm Tất cả SP         │
 ~300│ Đã xem gần đây                           ›  │ kệ sm 128
 ~500│ Top bán chạy                  Xem tất cả ›  │ kệ rank
     │ Thương hiệu                     Tất cả ›    │ lưới logo 4×3
```

**Sơ đồ D: danh sách (danh mục hoặc tìm)**

```
   0 │ [🔍 nuoc                          ×] 🛒6 │ 56 dính
  56 │ Liên quan  Bán chạy  Mới  Giá ⇅   Lọc ⚙1 │ 44 SortBar dính, gạch chân mục chọn
     │ ‾‾‾‾‾‾‾‾‾                                │
 100 │ Tẩy rửa sinh học · 21 sản phẩm           │ 28 (chỉ ở danh mục; tìm thì không có)
     │ [Nước giặt][Rửa chén][Lau sàn]…          │ 36 chip danh mục con (khi có)
~170 │ ┌──────────┐ ┌──────────┐                │ thẻ 270, 4 thẻ trọn ở màn đầu (tìm)
```

### 4.3 Chi tiết sản phẩm

**Ấn tượng 2 giây.** Ảnh to và giá to thì tốt. Nhưng ngay dưới giá là 7–9 dòng nhỏ với 4 màu khác nhau, nên mắt không biết dừng ở đâu. Giờ vàng, lý do để mua ngay, chỉ là một hàng badge nhỏ.
So với Shopee: ngay dưới ảnh Shopee có **thanh Flash Sale nền cam** chứa giá, % giảm và đồng hồ. Tiếp theo là các dòng thông tin dạng hàng có "›" (Voucher của shop, Vận chuyển, Chọn loại hàng). Phần đánh giá đứng trước mô tả.

| ID | Mức | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|
| PD-01 | P1 | `product-detail.tsx:496-501` (giá đen xl + "Đã bán 8,7k+"), `:503` (Điểm Xanh), `:506-522` (badge -30%, "Còn 13h 32m", "Đã bán 68%"); ảnh `product-slug__returning__mini375__s1` | Giờ vàng không thành điểm nhấn. Hai chữ "Đã bán" cách nhau 1 dòng mang hai nghĩa: 8,7k là tổng đã bán, 68% là phần suất Giờ vàng đã bán. | Thành phần mới **`FlashPriceBar`**, đặt ngay dưới ảnh, rộng hết màn, cao 72, nền `--color-flash-solid-bg`, chữ `--color-flash-solid-fg`. Bên trái: "⚡ GIỜ VÀNG" (label 12/700) và trên dòng dưới là giá `price-xl` + giá gạch + "-30%". Bên phải: "Kết thúc sau" + `Countdown blocks`. Dưới cùng: thanh 6px, chữ "Đã bán 68% suất". Thanh này thay hàng giá và hàng badge khi đang Giờ vàng. Dòng meta dưới tên khi đó chỉ còn "★ 4,4 (27) · Đã bán 8,7k". Khi không có Giờ vàng: hàng giá như hiện nay, cộng `discountPct` inline (design-system B4) và màu deal (CS-03). |
| PD-02 | P1 | `product-detail.tsx:1247-1248` (`formatVnd(variation.salePrice ?? variation.retailPrice)`); ảnh `product-slug__returning__mini375__s2` ("1L 120.000đ" trong khi giá trên trang là 84.000đ) | Chip phân loại hiện giá chưa áp Giờ vàng. Khách tưởng giá giờ vàng không áp cho phân loại mình chọn. | Lấy giá bằng `variationPricing(v, flashList)` (app-core `flash-price`, đã import ở `:49`), hiện giá đó và thêm icon ⚡ 12px khi `isFlash`. Thêm ca kiểm vào `product-detail.spec.tsx`. Làm cả phía web nếu web cũng vẽ chip có giá. |
| PD-03 | P1 | `product-detail.tsx:530-534` (shortDesc), `:536-593` (2 dòng xe tải, chữ xanh đậm), `:595-617` (chip Eco), `:619-675` (dải mã viền đứt cam, bị cắt ngang mép phải) | Khối thông tin có quá nhiều dòng rời, mỗi dòng một kiểu. Đây là chỗ "rối" nhất của màn. | Gom thành **các dòng thông tin** dùng `ListRow` có sẵn (`components/ui/list-row.tsx`), mỗi dòng 48px, có "›", ngăn bằng đường kẻ mảnh trong một thẻ trắng. Thứ tự: **Ưu đãi** ("FREESHIP · XANH10 +3", mở sheet ví mã, dùng `VoucherTicket` của design-system B9) · **Vận chuyển** ("Tubu Tree giao · Miễn phí đơn từ 99.000đ") · **Phân loại** (PD-04). Bỏ shortDesc ở khối đầu (đã có Mô tả). Chuyển chip Eco thành nhãn nhỏ cạnh tên, hoặc đưa vào Cam kết. Điểm Xanh thành chip nhỏ "+2.016 Điểm Xanh" trên dòng meta. |
| PD-04 | P1 | `:703-736` (thẻ Phân loại + thẻ Số lượng ~220px, "Phân loại" ở y=797, dưới màn đầu); sheet `extras/product-variant-picker__returning__mini375.png` cũng có phân loại và số lượng | Hai bộ điều khiển trùng chức năng. Chọn phân loại nằm ngoài màn đầu. | SP nhiều phân loại: 1 dòng "Phân loại · 1L, Can 5L ›" (thêm ảnh thu nhỏ 24 khi phân loại có ảnh), mở đúng sheet đang có. Số lượng chỉ chỉnh trong sheet. SP 1 phân loại: giữ stepper trong dòng "Số lượng". Tiết kiệm ~170px, phân loại lên màn đầu. |
| PD-05 | P1 | Đánh giá ở y=1623, đứng sau Thành phần, Cam kết, Chat, Mô tả | Bằng chứng xã hội (4,4★, 27 đánh giá) nằm ở màn thứ ba. | Thêm **"Đánh giá nhanh"** ngay sau combo/mua kèm: điểm + sao + số, 2 đánh giá đầu (ưu tiên đánh giá có ảnh), "Xem tất cả (27) ›". Danh sách đầy đủ giữ ở chỗ cũ. Khác ia-merch C3 ở vị trí, xem Q5. |
| PD-06 | P1 | ảnh `product-slug__returning__mini375__s4` (trang hết ở "Cùng nhà Fuwa3e") | Trang cụt: xem xong không có lối đi tiếp ngoài một kệ. | Thêm "Có thể bạn cũng thích" là lưới 2 cột vô tận ở cuối (ia-merch C3 khối 14). Combo và Mua kèm (D4) đặt ngay sau các dòng thông tin, xem sơ đồ E. |
| PD-07 | P2 | ảnh s1 và s3 hiện cùng câu "Lên men enzyme dứa, an toàn cho da tay." ở 2 chỗ; `:889` | Lặp nội dung. | Ẩn `CollapsibleDescription` khi `description` trùng `shortDesc` sau khi trim. |
| PD-08 | P2 | `:738-808` (Mua chung: thẻ 2 dòng chữ xanh cộng 1 dòng xám, ~112px) | Nặng so với vai trò phụ. | Gộp thành một `ListRow` 56: icon nhóm + "Mua chung 3 người, giảm 15%" + ›. |

**Sơ đồ E: chi tiết SP, 375**

```
   0 │ (‹)                              (⇪)(🛒6) │ nút nổi trên ảnh
     │              ảnh 1:1 (375)                │
 375 │▓ ⚡GIỜ VÀNG 84.000đ ̶1̶2̶0̶.̶0̶0̶0̶ -30%  [13]:[32]:[05]▓│ 72 FlashPriceBar (chỉ khi Giờ vàng)
     │▓ ▓▓▓▓▓▓▓▓▓░░░░ Đã bán 68% suất               ▓│
 447 │ Nước rửa chén sinh học Fuwa3e         ♡     │ tên 18/600, 2 dòng
     │ ★4,4 (27) · Đã bán 8,7k · +2.016 Điểm Xanh  │ caption
     │ Fuwa3e ›                         [Eco]      │
 540 │ Ưu đãi     FREESHIP · XANH10 +3          ›  │ 48 ListRow
     │ Vận chuyển Tubu Tree · Free từ 99.000đ   ›  │ 48
     │ Phân loại  1L · Can 5L                   ›  │ 48 (mở sheet)
 ~690│ Combo tiết kiệm (≤2 ComboCard)               │ D4
 752 ╞══ [🛒] [ Thêm vào giỏ ] [ Mua ngay 84.000đ ] ╡ giữ thanh dính hiện tại
     │ Mua kèm deal sốc (≤3 dòng có ô chọn)         │ D4
     │ Đánh giá 4,4★ (27) + 2 đánh giá   Xem tất cả›│ PD-05
     │ Mua chung (1 dòng)                        ›  │
     │ Thành phần · Mô tả · Cam kết + Chat          │
     │ Đánh giá (đầy đủ) · Cùng nhà Fuwa3e (kệ)     │
     │ Có thể bạn cũng thích (lưới vô tận)          │
```

### 4.4 Giỏ hàng

**Ấn tượng 2 giây.** Gọn và rõ, nút Thanh toán đúng là điểm nhấn. Có ba chỗ yếu: (1) mỗi dòng cao, (2) khách không thấy mình tiết kiệm được bao nhiêu, (3) mã giảm giá nằm ở đáy danh sách. Giỏ trống thì làm tốt: minh hoạ, câu chữ và lưới gợi ý.
So với Shopee: chân giỏ của Shopee có dòng voucher, dòng xu, và hàng [Tổng thanh toán, Tiết kiệm | Mua hàng (n)]. Giá trong từng dòng có giá gạch.

| ID | Mức | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|
| CT-01 | P1 | `cart.tsx:431-441` (dòng flex), `:518-527` (stepper và thùng rác thành hàng riêng); ảnh `cart__returning__mini375__s1` (~156px mỗi dòng, 3 dòng mỗi màn) | Dòng cao vì stepper và thùng rác chiếm một hàng riêng. Khoảng trống giữa checkbox và ảnh lớn. | Bố cục dòng ~124: [checkbox 44] [ảnh 72] [cột chữ: tên 2 dòng (chừa 36 bên phải cho thùng rác) · phân loại · hàng đáy gồm giá bên trái và `QuantitySelector size="sm"` bên phải]. Thùng rác `IconButton` ở góc phải trên, icon 18, vùng chạm 44. Giữ luật chạm 44 (`hit-target-guard.spec.tsx`). |
| CT-02 | P1 | `cart.tsx:478-480` (`PriceTag value={line.unitPrice}`, không có `compareAt`); `packages/app-core/src/api/cart.ts:12` chỉ có `unitPrice` | Dòng Giờ vàng "33.000đ" không kèm giá gạch 50.000đ. Chân trang không có "Tiết kiệm". Giỏ là nơi củng cố quyết định mua mà lại giấu lợi ích. | API thêm `listUnitPrice` (giá niêm yết của phân loại) vào `CartLine`; chuyển sang `backend-gap.md` nếu chưa có. `PriceTag compareAt={line.listUnitPrice}`. Chân trang thêm dòng caption "Tiết kiệm 51.000đ" màu deal dưới Tạm tính. |
| CT-03 | P1 | `cart.tsx:488-497` (badge "Giờ vàng" + "Đã bán 98%") | Ở giỏ, phần trăm đã bán không giúp gì. Điều khách cần biết là giá này còn giữ trong bao lâu. | Thay bằng `Countdown variant="chip"`: "Giá giờ vàng còn 13:30" (dữ liệu `flashEndAt` đã có trong `CartLine`). Còn dưới 15 phút thì chữ đổi sang tone warning. |
| CT-04 | P1 | `cart.tsx:273` (`CouponBlock` ở cuối danh sách), `:654-760` (`StickySummary`: thanh freeship đã đầy 100%, Tạm tính, nút full width) | Muốn thấy mã thì phải cuộn qua mọi dòng. Thanh tiến độ đầy 100% tốn chỗ mà không nói thêm gì. | Chân dính 3 hàng, cao ~140 (đang ~150): (1) hàng mã 40: 🎟 "5 mã dùng được · giảm đến 60.000đ ›" (mở sheet có sẵn); (2) freeship: chưa đạt thì giữ thanh + câu; đạt rồi thì chỉ 1 dòng "✓ Đã miễn phí giao hàng", không có thanh; (3) hàng tổng: bên trái "Tạm tính 812.000đ" + "Tiết kiệm …", bên phải nút "Thanh toán (6)" rộng ~160. Bỏ `CouponBlock` khỏi thân danh sách. |
| CT-05 | P2 | ảnh `cart__returning__mini375__s2` (giỏ có hàng không có gợi ý nào) | Bỏ lỡ chỗ bán thêm. | "Mua kèm deal sốc" (D4) đặt sau danh sách dòng: kệ `rail` 3–6 món, mỗi thẻ có nút "+". Giữ "Có thể bạn thích" bên dưới. |
| CT-06 | P2 | `cart.tsx:471-477` (phân loại là chữ xám) | Muốn đổi phân loại thì phải xoá dòng rồi thêm lại. | Chip "2L ▾" mở lại sheet chọn phân loại của PDP (cùng thành phần), đổi xong thì cập nhật dòng. |

**Sơ đồ F: giỏ, 375**

```
   0 │ (‹) Giỏ hàng (6)                            │
     │ ☑ Chọn tất cả                               │
     │┌───────────────────────────────────────────┐│
     ││☑ [ảnh72] Nước giặt sinh học Fuwa3e     🗑 ││ ~124
     ││          [2L ▾]                           ││
     ││          210.000đ ̶2̶5̶0̶k̶      [−] 2 [+]   ││
     │└───────────────────────────────────────────┘│
     ││☑ [ảnh] Nước rửa chén hương chanh Lá…   🗑 ││
     ││        Chai 500ml  ⏱Giá giờ vàng còn 13:30││
     ││        33.000đ ̶5̶0̶.̶0̶0̶0̶đ̶      [−] 1 [+]  ││
     │ Mua kèm deal sốc (kệ, nút +)                 │
     │ Có thể bạn thích (lưới)                      │
     ╞═════════════════ chân dính ═════════════════╡
     │ 🎟 5 mã dùng được · giảm đến 60.000đ       › │ 40
     │ ✓ Đã miễn phí giao hàng                      │ 24
     │ Tạm tính 812.000đ        [ Thanh toán (6) ]  │ 56
     │ Tiết kiệm 51.000đ                            │
```

## 5. Nhất quán và truy cập (chỉ phần thấy trên ảnh)

- Có **4 kiểu thẻ SP** khác nhau trên cùng một Trang chủ: thẻ Giờ vàng (`flash-sale.tsx`), thẻ kệ Bán chạy (`CatalogTile` 156), thẻ Mua lại (thẻ riêng ở `purchased-rail.tsx`), thẻ lưới. Mỗi kiểu xếp giá và chữ một cách. Đề xuất gom về các biến thể của `ProductTile` (design-system B2), cùng thứ tự dòng: tên → giá → meta.
- Tiêu đề khối: Fraunces 16 lúc màu cam, lúc màu đen, lúc có icon, lúc không; khoảng cách tiêu đề với nội dung cũng không đều. Dùng chung `SectionHeader` (CS-05).
- Tương phản: nhãn -x% nền orange-50 trên ô ảnh sáng là chỗ yếu nhất về nhận diện; chữ thì vẫn đạt. Màu deal mới phải thêm vào `contrast.spec.ts`.
- Vùng chạm: mọi đề xuất giữ 44, vì thanh `SortBar` và hàng `ListRow` đã cao 44–48. Bảng a11y chi tiết ở `a11y.md`.

## 6. Cái đang tốt (giữ)

- Một `ProductTile` dùng chung, một `PriceTag`, token 3 lớp: sửa một chỗ thì đổi được cả hệ (CS-01, CS-03 chỉ là đổi số đo và token).
- Khung chờ có chiều cao khớp khối thật (`HOME_SETTLING_HEIGHTS`, `FLASH_HINT_KEY`), nên Trang chủ không nhảy khi dữ liệu về. Mọi đề xuất đổi chiều cao phải cập nhật các hằng này.
- Đồng hồ Giờ vàng chuyển sang suất kế tiếp đúng lúc. Bấm thẻ Giờ vàng mở đúng phân loại đang giảm (`flash-sale.tsx:146-150`).
- Vùng chạm 44 nhất quán. Thẻ có cấu trúc "nút tên phủ thẻ", không lồng phần tử tương tác.
- Chi tiết SP: biểu đồ phân bố sao, lọc "Có ảnh", nút "Mua ngay" kèm giá. Sheet chọn phân loại gọn.
- Giỏ trống có minh hoạ, câu chữ ấm và lưới gợi ý. Thanh freeship khi chưa đạt có ích.
- Màu nền ấm và màu xanh rừng là bản sắc riêng. **Không** nên chuyển sang cam đỏ kiểu Shopee. Chỉ dùng cam cho deal (CS-03) để deal tự thành điểm nhấn.

## 7. Thứ tự làm

1. **Thẻ SP** (CS-01..04): đổi một thành phần, mọi màn gọn theo. Phụ thuộc design-system B2/B3, kéo theo skeleton và e2e `buy-flow-4b`.
2. **Header dính và nhịp khối** (CS-05, CS-06), rồi **Giờ vàng gọn** (HM-02), rồi **thứ tự Trang chủ** (HM-01, HM-03..07). Sửa `home-layout.ts`; web dùng chung thứ tự nên web 375 theo cùng lúc.
3. **SortBar** và dọn trang danh mục (BR-01, BR-02), sau đó là hub (BR-03, chờ dữ liệu danh mục IA-01).
4. **PDP**: sửa giá chip phân loại (PD-02, nhỏ, làm ngay), `FlashPriceBar` (PD-01), các dòng thông tin (PD-03, PD-04).
5. **Giỏ**: CT-01, CT-03, CT-04 làm bằng FE; CT-02 chờ API `listUnitPrice`.
6. Chức năng mới (banner, trang Giờ vàng, combo, mua kèm) đặt đúng chỗ ở các sơ đồ A–F.

**Cách kiểm (đưa vào cơ chế giữ khớp, design-system C2):** một bài Playwright "ngân sách bố cục" ở 375×812, đo giống script ở mục 1, chặn khi lệch:
- Mọi thẻ `grid` trong một lưới cao bằng nhau (±1px).
- Thẻ đầu của `/browse?q=` ≤ 200, và có ≥ 4 thẻ trọn ở màn đầu.
- Khối `flash` ≤ 280.
- Trang chủ khách cũ có ≥ 1 thẻ deal trọn trong 0–752.
- Khoảng cách giữa hai `data-home-block` liền nhau = 16 ±2.

## 8. Câu hỏi cho chủ (mỗi câu có mặc định đề xuất)

| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Giá đang giảm có đổi sang màu cam đậm (cùng màu Giờ vàng) không, hay giữ đen? (cũng là E3 ở design-system) | Đổi: chỉ giá đang giảm mới màu cam, giá thường giữ đen |
| Q2 | Bốn lối tắt cố định ở Trang chủ, các mục khác vào "Tất cả" | Giờ vàng · Mã giảm giá · Mua chung · Đổi quà |
| Q3 | Với khách cũ, đặt Giờ vàng trước hay sau Mua lại? (ia-merch C5 đặt Mua lại trước) | Giờ vàng trước, để deal nằm trong màn đầu; Mua lại 1 món thì là 1 dòng ngay dưới |
| Q4 | Nhãn thẻ (Combo, Tubu chọn, Freeship): thêm một hàng 18px riêng (ia-merch D2) hay 1 nhãn đứng đầu dòng tên? | Đứng đầu dòng tên, tối đa 1 nhãn: thẻ giữ 270px, không thành ~292px |
| Q5 | Kéo "Đánh giá nhanh" lên ngay sau Combo/Mua kèm ở chi tiết SP? | Có; danh sách đầy đủ giữ chỗ cũ |
