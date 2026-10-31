# Polish: cảm giác chạm, nhịp và chuyển động (Mini App 375, gian hàng)

Ngày 2026-10-31, mã main 13536d955 (worktree `shop-redesign`). Chỉ đọc mã và đo DOM trên lane 7, không sửa mã sản phẩm.
Skill đã nạp: `ecc:make-interfaces-feel-better`, `taste-skill:high-end-visual-design`, `taste-skill:design-taste-frontend`.

## 0. Kết luận

**Cách đọc đề bài.** Đây là Mini App mua hàng xanh cho gia đình Việt, chạy trong Zalo. Giọng ấm và êm (brief §3.2: "tử tế hơn khẩn cấp"). Đích là độ gọn của Shopee, xây trên DS v2 đã có: forest + stone + cam logo, Fraunces + Inter.
- Mức chỉnh: VARIANCE 3, MOTION 4, DENSITY 6.
- Phần "landing page" của hai skill taste **không áp** ở đây: khoảng trắng py-24, khung lồng hai lớp, hiện dần mọi khối khi cuộn, đổi font.
- Phần **có áp**: chống dấu hiệu "AI làm", trạng thái đủ vòng, chuyển động có lý do, số dùng chữ số đều (tabular), vùng chạm.

**Ba việc đáng làm nhất**, xếp theo số lần khách nhìn thấy:
1. **Thẻ sản phẩm.**
   - Dòng ★/đã bán gãy thành 2 dòng ở 7/10 thẻ. Vì vậy thẻ cao 319 hoặc 299 và giá trôi lơ lửng 30px.
   - Giá cùng cỡ chữ với tên.
   - Giá Giờ vàng màu nâu đục.
   - Phát hiện liên quan: PL-01 đến PL-04.
2. **Giờ vàng "sống mà vẫn êm".**
   - Thêm dải Giờ vàng ở trang chi tiết.
   - Thẻ flash gọn lại từ 285 còn khoảng 250px. Thanh % có chữ nằm trong thanh.
   - Đồng hồ dạng ô số.
   - Bớt 6 nút "Nhắc tôi" đặc.
   - Phát hiện liên quan: PL-07, PL-08, PL-09, PL-13.
3. **Cảm giác chạm.**
   - Chip nhìn cao 44, nên hạ còn 36.
   - Thẻ và nút nên co theo hai mức khác nhau.
   - "Thêm vào giỏ" tự báo đã thêm ngay trên nút. Tim có nhịp nảy.
   - Thanh dưới cần thêm tín hiệu "đang chọn" ngoài màu.
   - Phát hiện liên quan: PL-05, PL-10, PL-11, PL-12.

**Đã tốt, cần giữ:**
- Bóng nhuộm ấm theo stone, không dùng đen thuần.
- Token chuyển động, kèm quy tắc giảm chuyển động áp toàn app.
- Giá dùng `tabular-nums`.
- Vùng chạm 44 qua `::after`.
- Khung chờ thẻ dựng từ hằng của thẻ thật.
- Ô ảnh 1:1 giữ chỗ nên trang không nhảy.
- Không có gradient tím, glass, neon hay `transition: all`.

**Dấu hiệu "AI làm" còn lại:**
- Icon Sparkles dùng ở chỗ không liên quan AI (PL-21).
- Chấm màu trang trí trên mọi thẻ (PL-03).
- Mọi tiêu đề khối nhỏ đều dùng serif (PL-06).
- Gạch dài trong chữ hiển thị: ít nhất 11 chuỗi ở `i18n/vi.ts`, ví dụ "Tạm hết — sẽ về sớm" (`:134`), cộng 2 chuỗi viết thẳng trong trang chi tiết là "Hàng chính hãng — nguồn gốc rõ ràng" (`product-detail.tsx:851`) và "Mở nhóm mua chung — nhận mã giảm…" (`:771`). Chuyển cho ux-copy.

## 1. Cách làm và số đo

**Ảnh đã xem (mini375):**
- Trang chủ: guest s1, new s2, returning s1–s5.
- Danh mục: browse-all s1–s2, browse-category s1, browse-search-typing.
- Chi tiết: product-slug s1–s4.
- Gian hàng: s-slug s1, s2, s4. Dựng gian hàng: storefront s1.
- Thương hiệu: brand-slug s1.
- Ưu đãi: offers s1–s2. Giỏ: cart s1–s2.
- extras: `home-flash-active`, `product-variant-picker`.

**Đo DOM thật.** Lane 7, khổ 375×812, DPR 2. Đi qua `miniapp-session.mjs` bằng script đo nằm ở scratchpad, không ghi vào repo. Ý tưởng script có ở mục 5, T-P2.

| Đo | Kết quả |
|---|---|
| Lưới Gợi ý, returning, 10 thẻ đầu | 7/10 thẻ có dòng ★/đã bán cao **40px** (gãy 2 dòng). Thẻ cao **319** hoặc **299**. Thẻ cạnh thẻ gãy có giá cách đáy **30–31px**, đáng lẽ 10 |
| `/browse`, 4 thẻ đầu | 4/4 thẻ gãy |
| Kệ Bán chạy, persona new | cao 289, 310, 310, 309, 310, 309. Đáy lệch **21px** |
| Thẻ Giờ vàng | 132×285. Hẹp hơn thẻ lưới 34px mà cao gần bằng (299) |
| Chip `/browse` | cao nhìn thấy **44**. Nền stone-100 trên canvas stone-50 chỉ **1,08:1** |
| Tiêu đề khối Trang chủ | 8/8 là Fraunces 16/600 |
| Tên / giá trên thẻ | tên 14/400, dòng 22. Giá 14/600: **cùng cỡ** |
| Thanh dưới | cao 60. Nhãn 13px, tab đang chọn 700, tab khác 500 |
| Khoảng trống giữa các khối Trang chủ, returning (đo theo phần có vẽ) | 8, 12, 20, 24, 28, 12, 24, 26, 24px |
| Như trên, guest | 8, 20, 36, 18, 28, 24, 26, 24px. Đây là bằng chứng số cho DS-05 |

**Không lặp lại** các mục đã có ở `design-system.md` (DS-xx), `ia-merch.md` (IA-xx), `a11y.md`, `ux-copy.md`. Chỗ chạm nhau ghi "(bổ sung DS-xx)".

---

## 2. Phát hiện P1 (nên sửa đợt này)

### PL-01. Dòng ★/đã bán gãy 2 dòng, giá trôi (mọi lưới thẻ)
- **Bằng chứng:**
  - `components/ui/product-tile.tsx:214-232`: hàng flex không `nowrap`. Chữ "· Đã bán 5,2k+" tự xuống dòng trong bề rộng 146px.
  - `:233`: hàng giá không neo xuống đáy.
  - Ảnh: `home__returning__mini375__s4`, `s5`, `browse-all__returning__mini375__s1`, `s2`, `s-slug__guest__mini375__s2`. Số đo ở mục 1.
- **Vấn đề:** Thẻ có sao cao 319, thẻ không sao cao 299. Trong cùng một hàng lưới, thẻ ngắn bị kéo dãn nên giá lơ lửng giữa thẻ. Đây là nguồn "rối" lớn nhất của lưới.
- **Đề xuất:**
  - Hàng meta: `flexWrap: 'nowrap'`, `whiteSpace: 'nowrap'`, `overflow: 'hidden'`, `minWidth: 0`. Phần "đã bán" thêm `overflow: hidden; textOverflow: ellipsis`.
  - Ở biến thể grid và rail, viết gọn thành `★ 4,8 · Đã bán 5,2k`, bỏ "(20)". Số lượt đánh giá chỉ giữ ở trang chi tiết. Bề rộng ước tính ở 13px khoảng 125px, nhỏ hơn 146. Câu chữ chốt chung với ux-copy và cách đọc ở a11y P2-4, P2-6.
  - Vỏ thẻ: `display: flex; flexDirection: column; height: 100%`. Thân thẻ: `flex: 1; display: flex; flexDirection: column`. Hàng giá: `marginTop: 'auto'`. Khi đó giá mọi thẻ cùng hàng nằm trên một đường.
  - `TILE_BODY_HEIGHT` không đổi vì dòng meta vẫn cao 20px. Khung chờ giữ nguyên.

### PL-02. Thẻ trong kệ ngang cao lệch nhau
- **Bằng chứng:** `components/home/best-seller-rail.tsx:63`. Vỏ `flex: 0 0 156px` không có `display: flex`, còn ProductTile không đặt `height: 100%`. Đo được 289–310. Ảnh `home__new__mini375__s2`.
- **Đề xuất:**
  - Vỏ thẻ: `display: 'flex'`. Thẻ: `height: '100%'`, đi cùng PL-01.
  - Áp cho mọi kệ: Mua lại (`reorder/purchased-rail.tsx`), "Cùng nhà" ở trang chi tiết (`RelatedTile`, `product-detail.tsx:1175`).
  - Khi làm `ProductRail` (DS B6), đưa luật này vào thành phần đó luôn.

### PL-03. Giá không phải thứ nổi nhất trên thẻ
- **Bằng chứng:**
  - Tên 14/400. Giá `price-sm` 14/600 (`price-tag.tsx:25`, `product-tile.tsx:236`).
  - "đ" cùng cỡ với số. Giá gạch 13px (`price-tag.tsx:29`).
  - Dòng nhãn hiệu 13/600 màu secondary kèm chấm màu 7px (`product-tile.tsx:157-165`), đậm ngang tên.
- **Vấn đề:** Nhãn hiệu, tên, giá có trọng lượng gần như nhau. Ở lưới 2 cột, giá phải là điểm neo mắt.
- **Đề xuất** (trước → sau):

| Phần | Trước | Sau |
|---|---|---|
| Giá thẻ (grid, rail, flash) | 14px, nét 600 | **16px, nét 700**. Line-height giữ 20px qua token lớp 3 mới `--type-price-tile-size/lh/weight` = 16px / 1.25 / 700. Khung chờ không đổi |
| Hậu tố "đ" | cỡ 1em, cùng nét | 0.75em, nét 600, `marginLeft: 1px`. PriceTag tách số và hậu tố: thêm `formatVndParts` cạnh `formatVnd` ở `utils/format.ts`, đưa vào app-core nếu web cũng dùng |
| Giá gạch | 13px | 12px (`--type-label-size`), nét 400 |
| Dòng nhãn hiệu | 13/600, màu secondary, chấm 7px, cao 20 | **12/500, màu tertiary, bỏ chấm**, cao 16. Chấm là trang trí, không mang trạng thái, và màu nhãn đã có ở ô ảnh. `TILE_BODY_HEIGHT` 133 → 129: đổi hằng của dòng này ở `catalog-grid.tsx:76-84`. Trang nhãn vẫn dùng `hideBrand` (DS-16) |
| Tên | 14/400, dòng 22 | **Giữ.** Không hạ line-height xuống 20 vì chữ hoa hai dấu ("Ẩ", "Ổ") bị cắt đỉnh khi `overflow: hidden`. Lỗi này đã gặp ở `.tubu-btn`, xem chú thích trong `css/tokens.css` |

- E2E `buy-flow-4b` kiểm lệch khung chờ ≤ 16px, nên phải đo lại sau khi đổi.

### PL-04. Giá Giờ vàng màu nâu đục
- **Bằng chứng:** `--color-flash-fg: var(--orange-800)` = `#7A4300` (`packages/design-tokens/src/tokens.css:162`, `:49`). Ở ảnh `extras/home-flash-active__returning__mini375.png`, "33.000đ" đọc như chữ nâu chứ không ra giá ưu đãi. Ngoài lưới, cùng sản phẩm đó lại có giá đen (DS-03).
- **Đề xuất:**
  - Thêm primitive `--orange-700: #9A5200` và đặt `--color-flash-fg: var(--orange-700)`.
  - Tương phản tính theo công thức WCAG: 5,86:1 trên trắng, 5,25:1 trên orange-50, 5,34:1 trên stone-50. Màu cam bão hoà hơn (`#B05E00`) không đạt 4,5:1.
  - Giữ `--color-promo-fg` = orange-800 cho chữ 12px trên nền cam nhạt.
  - Thêm 3 cặp màu mới vào `css/contrast.spec.ts`.
  - Không dùng đỏ (§3.2).
  - Dù câu hỏi E3 của DS chốt giá thường màu đen, giá flash vẫn đổi theo đề xuất này.

### PL-05. Chip nhìn cao 44, nền gần như vô hình
- **Bằng chứng:**
  - `components/ui/chip.tsx:52-57`: `minHeight 44`, đệm 10/14. Chú thích cùng file ghi "nhìn cao 36px" nhưng đo thực tế là 44.
  - Nền chip chưa chọn là stone-100 trên canvas: 1,08:1. Chọn thì nét chữ nhảy 500 → 600.
  - Ảnh `browse-category__returning__mini375__s1`: tiêu đề, 2 hàng chip, chip lọc đang bật và hàng "21 sản phẩm / Bộ lọc" chiếm khoảng **275px (34% màn)** trước thẻ đầu tiên.
  - Ở `/browse` có hai kiểu chip trên cùng một màn: danh mục là viên trắng có viền (`catalog/category-grid.tsx:55-62`), sắp xếp là viên xám.
- **Đề xuất cho Chip md:**
  - `minHeight 36`, `padding: 7px 14px`. Vùng chạm vẫn 44 nhờ `.tubu-hit-44` có sẵn.
  - Chưa chọn: `background: var(--color-bg-surface)` + `boxShadow: inset 0 0 0 1px var(--color-border-subtle)`. Viền vẽ bằng bóng nên không đổi kích thước, và cùng kiểu với viên danh mục.
  - Đang chọn: giữ nền forest-600, chữ trắng.
  - Nét chữ 600 ở cả hai trạng thái.
  - Hàng chip trong `.scroll-x` vẫn cần đệm dọc ≥ 4px.
  - Mỗi hàng chip tiết kiệm 8px. Thanh công cụ dính ở IA-03 dùng cùng chip này.

### PL-06. Tiêu đề khối: một lá phiếu cho câu hỏi E1 của DS
- **Bằng chứng:**
  - Đo được 8/8 tiêu đề khối Trang chủ là Fraunces 16/600. Trang chi tiết dùng Inter 16 (DS-04).
  - DS v2 chọn Fraunces cho cảm giác "xanh tự nhiên cao cấp".
  - Brief gốc lại chọn Be Vietnam Pro (`design_handoff/specs/TUBU_TREE_DESIGN_BRIEF.md:300-303`).
- **Nhận xét polish:**
  - Fraunces là serif hiển thị, đẹp từ 22px trở lên. Ở 16px, gặp dấu chồng như "Ưu đãi giờ vàng", "Gợi ý cho bạn", "Sắp diễn ra", nét đậm và chân serif dày lên nên chữ trông chật và cũ.
  - Trang chủ có 8 tiêu đề serif xen 8 kệ, nên serif mất vai trò "điểm nhấn".
  - Skill taste xếp Fraunces vào nhóm serif AI hay chọn mặc định. Thêm một lý do để dùng ít mà đúng chỗ.
- **Đề xuất:**
  - Fraunces chỉ dùng cho "khoảnh khắc thương hiệu" từ 22px trở lên: tiêu đề trang (Giỏ hàng, Ưu đãi, tên gian hàng, tên nhãn), số điểm ở thẻ thành viên, điểm "4.4" ở khối đánh giá.
  - Tiêu đề khối trong luồng mua: Inter 16/700, `letterSpacing: -0.01em`. Riêng Giờ vàng giữ màu promo và icon.
  - Đề xuất này ngược với mặc định của DS-04. Chủ chốt ở E1, và `SectionHeader` (DS B5) chỉ cần đổi một chỗ.

### PL-07. Đồng hồ Giờ vàng: bản "êm mà sống"
- **Bằng chứng:**
  - `hooks/use-countdown.ts:18` cập nhật mỗi 30s. Chữ "Còn 13h 33m" nằm trong Badge promo nền nhạt (`components/flash-sale.tsx:125-131`).
  - 30s là quyết định có chủ ý: §3.2 và `docs/superpowers/specs/2026-07-05-flash-sale-engine-design.md:140`. Nay chủ muốn chuẩn Shopee.
- **Đề xuất** (bổ sung phần hình cho `Countdown` ở DS B7):
  - Ô số 22×20, bo `--radius-tag` 4px. Nền `--color-countdown-bg` (stone-900, **không đỏ**), chữ trắng 12/700 tabular-nums.
  - Dấu ":" 12/700 màu `--color-flash-fg`, cách ô 3px.
  - Nhịp đếm: chủ chọn ở Q1 (mục 7). Đề xuất (b).
    - (a) **Êm:** HH:MM, cập nhật mỗi phút ở mọi nơi.
    - (b) **Kiểu Shopee:** HH:MM:SS chạy từng giây, **chỉ** ở đầu khối Giờ vàng Trang chủ và đầu trang Giờ vàng. Trang chi tiết, giỏ và thẻ "Sắp diễn ra" vẫn đếm theo phút.
  - Một bộ đếm giây cho cả khối, không phải mỗi thẻ một `setInterval`. Số đổi thì chỉ thay số, không lật, không nảy.
  - Dưới 1 giờ hiện MM:SS. Trên 24 giờ hiện "2 ngày 03:15" (đã ghi ở B7).
  - Icon Zap ở tiêu đề tô đặc (`fill="currentColor"`) bằng `--color-flash-solid-bg`. Như vậy khối chỉ có một điểm cam đặc, ngoài nhãn %.

### PL-08. Thẻ Giờ vàng dài và nhiều tầng
- **Bằng chứng:** `components/flash-sale.tsx:36-42`, `:162-188`. Thẻ 132×285 xếp 6 tầng:
  1. tên 2 dòng
  2. phân loại
  3. giá
  4. giá gạch trên dòng riêng
  5. thanh 6px
  6. chữ "Đã bán 98%" trên dòng riêng

  Ảnh `extras/home-flash-active__returning__mini375.png`.
- **Đề xuất** (khớp biến thể `flash` ở DS B2):
  - Bỏ dòng giá gạch vì nhãn "-34%" trên ảnh đã nói mức giảm. Nếu chủ muốn giữ thì đặt cùng dòng với giá: 16/700 cộng 12px vẫn vừa 116px.
  - Thanh % có chữ trong thanh:
    - cao 16, bo pill
    - rãnh `--color-flash-bg`, phần đã bán `--color-flash-solid-bg`
    - chữ "Đã bán 98%" 12/600 stone-900 căn giữa: 6,75:1 trên cam, 15,6:1 trên rãnh
    - từ 90% đổi thành "Sắp hết", chữ do ux-copy chốt
  - Thanh chạy một lần khi khối vào màn: `transform: scaleX(0 → p)`, `transform-origin: left`, 600ms, `--p-ease-out`. Khi dữ liệu poll 60s đổi số thì chỉ chuyển 220ms.
  - Ước tính chiều cao: 285 → **khoảng 250px**.

### PL-09. "Sắp diễn ra": 6 nút 44px đặc giống hệt nhau
- **Bằng chứng:** `components/flash-sale.tsx:231-262`. Mỗi thẻ có chữ "Bắt đầu sau 13h 33m" (gãy 2 dòng trong 116px) và một nút xanh đặc cao 44. Ảnh `home__new__mini375__s2`: đây là khối nặng nhất Trang chủ.
- **Đề xuất:** Nếu IA-05 bỏ kệ này thì bỏ qua mục này. Nếu giữ:
  - Giờ bắt đầu chỉ nói một lần ở tiêu đề khối: "Sắp diễn ra 12:00" kèm Countdown dạng chip. Bỏ dòng chữ trên từng thẻ.
  - Nút nhắc thành nút icon nổi trên ảnh (slot `imageOverlay` của ProductTile): vòng 32px nền surface + `--elevation-1`, icon Bell 16, vùng chạm 44.
  - Đã nhắc: nền `--color-action-secondary-bg`, icon BellRing màu brand, chuyển 150ms kèm nảy nhẹ (mẫu ở PL-14).

### PL-10. Thanh dưới: tab đang chọn chỉ khác nhau bằng màu
- **Bằng chứng:**
  - `components/bottom-nav.tsx:114,135`: icon đổi forest/tertiary, chữ đổi màu và nét 500 → 700. Ngoài màu không còn tín hiệu nhìn thấy nào (WCAG 1.4.1). Trình đọc màn hình thì đã có `aria-current`.
  - Thanh có cả `borderTop` lẫn `--elevation-3` (`:55-56`), nên mép trên dày gấp đôi.
- **Đề xuất:**
  - Icon tab đang chọn tô đặc nhẹ: thêm prop `filled` cho `ui/icon.tsx` (`fill="currentColor" fillOpacity={0.16}`, `strokeWidth 2`).
  - Nhãn 13 → 12px (`--type-label-size`), nét 500 cho tab thường, 600 cho tab đang chọn (thay 700).
  - Mép trên: bỏ `borderTop`. Thay `--elevation-3` bằng token mới `--elevation-nav: 0 -1px 0 rgba(28,26,22,.06), 0 -4px 16px rgba(28,26,22,.06)`.
  - Khi chuyển tab, icon vừa chọn đi `scale .88 → 1` trong 220ms, `--p-ease-spring`. Nhãn đứng yên.
  - Nút tròn Vườn Xanh ở giữa giữ nguyên.

### PL-11. Phản hồi nhấn: một kiểu cho mọi thứ, và có thể không chạy trên iOS
- **Bằng chứng:**
  - `css/tokens.css:113-121`: `.tubu-press` = scale .97 + opacity .9, 100ms cả lúc nhấn lẫn lúc thả. Dùng chung cho thẻ 166×299 và chip 36px.
  - Thẻ co 5×9px và ảnh mờ 10%, cảm giác mềm nhũn.
  - Nút ZaUI chỉ đổi nền, không co.
  - iOS WebKit chỉ áp `:active` khi phần tử hoặc tổ tiên có listener `touchstart`. App chỉ gắn listener ở `pull-to-refresh.tsx:70`, tức vùng cuộn trang. Sheet, thanh dính đáy và bóng gợi ý nằm ngoài vùng đó có thể không có phản hồi. **Chưa kiểm trên Zalo iOS.**
- **Đề xuất:**
  - Token mới: `--p-dur-press: 80ms`, `--p-dur-release: 180ms`, `--p-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`.
  - `.tubu-press` (nút, chip, icon, ô lối tắt):
    - `transition: transform var(--p-dur-release) var(--p-ease-out)`
    - `:active { transform: scale(0.96); transition-duration: var(--p-dur-press) }`
    - Bỏ opacity. Nhấn nhanh, thả chậm.
  - `.tubu-press-card` (mới, cho ProductTile, thẻ flash, thẻ cộng đồng): scale .985, cùng nhịp nhấn và thả, không đổi opacity.
  - `.tubu-btn:active` (nút DS): scale .97, cùng nhịp. Nền pressed của ZaUI giữ nguyên.
  - `app.tsx`: gắn `document.addEventListener('touchstart', () => {}, { passive: true })` một lần.
  - Quy tắc giảm chuyển động toàn app (`css/tokens.css`, khối `prefers-reduced-motion` cuối) đã đưa mọi `transition-duration` về 0,01ms, nên không cần thêm gì.

### PL-12. "Thêm vào giỏ": phản hồi nằm sai chỗ
- **Bằng chứng:** `pages/product-detail.tsx:272-281`. Hiện có:
  - rung nhẹ
  - huy hiệu giỏ nảy (`tubu-bounce` 350ms, scale 1.35)
  - snackbar ở **đầu màn** 2s "Đã thêm vào giỏ 🌿", đè lên ảnh và nút back

  Trong khi đó mắt khách đang ở thanh dưới.
- **Đề xuất:**
  - Nút "Thêm vào giỏ" tự xác nhận: nhãn đổi thành icon Check + "Đã thêm" trong 1.200ms rồi trở lại.
  - Đổi nhãn bằng cách chuyển chéo opacity + scale .92→1 + blur 2px→0: 160ms khi vào, 120ms khi ra. Đây là mẫu "icon swap" của skill.
  - Khoá `minWidth` của nút bằng bề rộng hiện tại để nút không đổi cỡ.
  - Giữ hiệu ứng nảy của huy hiệu. Khi số trên huy hiệu đổi thì thêm `tubu-pop`.
  - Snackbar chỉ hiện khi có ghi chú (mã nhóm), và đặt `position: 'bottom'`, nằm trên thanh dính.
  - Bảng chọn phân loại (`extras/product-variant-picker…`): đóng sheet xong mới phát phản hồi trên nút giỏ.
  - P2, tuỳ chọn: ảnh bay vào giỏ.
    - Bản sao thumbnail 48px bay tới nút giỏ trong 420ms, `cubic-bezier(.5,0,.75,0)`.
    - Thu nhỏ 1 → .3, mờ 1 → .6.
    - Tắt khi khách bật giảm chuyển động.

### PL-13. Trang chi tiết: Giờ vàng chỉ là 3 nhãn nhỏ
- **Bằng chứng:** `pages/product-detail.tsx:496-521`. Giá cỡ xl màu đen. Dòng dưới có nhãn "-30%", chip "Còn 13h 32m" và chữ "Đã bán 68%". Bên phải giá còn "Đã bán 8,7k+", tức hai chữ "Đã bán" khác nghĩa đứng cạnh nhau. Ảnh `product-slug__returning__mini375__s1`.
- **Đề xuất:** Thành phần mới `FlashStrip` (Mini `components/ui/`, web có bản tương ứng). Dải tràn hết bề ngang, ngay dưới ảnh, cao 48:
  - nền `--color-flash-solid-bg`
  - bên trái: Zap đặc 16 + "Giờ vàng" 14/700 stone-900 (6,75:1)
  - bên phải: "Kết thúc sau" 12/500 stone-900 + Countdown dạng ô, đếm phút hay giây theo Q1
- **Dưới dải:**
  - Hàng giá dùng `PriceTag flash` (màu ở PL-04), kèm "-30%" trên cùng dòng (`discountPct` của B4).
  - Thanh % kiểu PL-08, rộng hết khối, có chữ trong thanh.
  - Bỏ hàng 3 nhãn nhỏ. "Đã bán 8,7k+" chuyển về dòng sao, cạnh "27 đánh giá".
- **Chuyển động:** dải vào màn bằng opacity + translateY 8→0, 220ms.

---

## 3. Phát hiện P2 (tinh chỉnh)

**PL-14. Tim yêu thích đổi tức thì.**
- Bằng chứng: `components/wishlist-heart.tsx:109-114`.
- Đề xuất:
  - Thêm keyframe `tubu-heart-pop` vào `css/tokens.css`: 0% scale 1, 40% 1.25, 70% .94, 100% 1, trong 320ms, `--p-ease-spring`. Chỉ chạy khi chuyển sang "đã thích".
  - Khi bỏ thích: phần tô mờ dần 120ms.
  - Nét icon 1.9 đổi về 1.75 qua `Icon` (PL-21).

**PL-15. Ảnh sản phẩm.**
- Bằng chứng:
  - `components/ui/product-image.tsx:56-73`: `<img>` tải lười hiện bụp một cái.
  - Không có viền trong.
  - Ô thay thế nhuộm theo màu nhãn ở 12% (`:26`), nên lưới thành mảng be, xám, xám xanh xen kẽ (`browse-all__returning__mini375__s2`).
- Đề xuất:
  - (a) Ảnh hiện dần `opacity 0→1` trong 200ms ở `onLoad`. Ảnh lấy từ cache (`img.complete`) thì hiện ngay.
  - (b) Khung ảnh thêm `outline: 1px solid var(--color-media-outline); outline-offset: -1px`, với token mới `--color-media-outline: rgba(28,26,22,.06)`. Dùng màu trung tính, không nhuộm màu nhãn. Ảnh nền trắng (đa số ảnh từ Pancake) sẽ không hoà vào thân thẻ trắng.
  - (c) Ô thay thế dùng một nền `--color-bg-media` cho mọi nhãn. Bỏ tên nhãn trong ô vì dòng nhãn hiệu ngay dưới đã có. Giữ lá 36.

**PL-16. Khung chờ và thanh tiến độ.**
- Bằng chứng:
  - `css/tokens.css:229-235`: shimmer trắng 65%, 1,4s, easing mặc định, chạy liên tục. Trên 6 thẻ cùng lúc, nó loé mạnh.
  - `ui/progress-bar.tsx:28`, `pages/cart.tsx:731`, `pages/product-detail.tsx:1161` chuyển `width`, gây tính lại bố cục.
- Đề xuất:
  - Shimmer `rgba(255,255,255,.45)`, 1,6s `ease-in-out`.
  - Khung chờ và ô thay thế ảnh dùng cùng nền `--color-bg-media`, để lúc tải xong ô không đổi màu.
  - Thanh tiến độ chuyển bằng `transform: scaleX()`, `transform-origin: left`.

**PL-17. Ô tìm dính ở Trang chủ không có mép.**
- Bằng chứng: `pages/home.tsx:175` chỉ có nền canvas. Thẻ trượt xuống dưới ô tìm mà không có đường ngăn (`home__returning__mini375__s2…s5`).
- Đề xuất:
  - Đặt sentinel 1px trước khối. IntersectionObserver gắn `data-stuck` khi ô tìm đã dính.
  - Khi dính: `box-shadow: 0 1px 0 var(--color-border-subtle)`, chuyển 150ms.
  - Ô tìm bỏ `--elevation-1` vì đã có viền subtle; một tín hiệu là đủ (`home.tsx:191-200`).
  - Thanh công cụ dính ở `/browse` (IA-03) làm cùng cách.

**PL-18. Nhịp khối thông tin ở trang chi tiết.**
- Bằng chứng: `pages/product-detail.tsx:487-540` dùng marginTop 6/8/6/4/8/10/10. Icon xe tải 15px vẽ tay với `strokeWidth 2`, lặp ở 2 dòng liền nhau.
- Đề xuất:
  - Khối thông tin là một stack gap 8. Ba nhóm (giá; điểm + Giờ vàng; giao hàng) cách nhau 12.
  - Icon đi qua `Icon sm`.
  - Dòng "Miễn phí giao hàng…" dùng icon khác xe tải, ví dụ `BadgePercent`.
  - Phần đổi `Text` của ZaUI sang DS đã có ở DS-11.

**PL-19. Giỏ hàng.**
- Bằng chứng:
  - Lề trong 12 (`pages/cart.tsx:256`) trong khi màn khác dùng 16.
  - Checkbox cách ảnh khoảng 32px, ảnh cách chữ 12 (`:431-440`, ảnh `cart__returning__mini375__s1`).
  - Bộ đếm là 3 ô 44 tách rời, cộng thêm thùng rác.
  - Dòng Giờ vàng có giá đen và nhãn "Giờ vàng" nền nhạt, khác nhãn đặc trên thẻ.
- Đề xuất:
  - Lề 16. Cột checkbox 24 + gap 12.
  - Bộ đếm liền khối `[− | 2 | +]`:
    - cao nhìn thấy 32, rộng 104
    - viền 1px `--color-border-default`, bo 8, vạch ngăn bên trong
    - số tabular-nums 14/600
    - vùng chạm 44 nhờ `.tubu-hit-44-square`
  - Dòng Giờ vàng dùng PriceTag flash và Badge tông flash (DS-06).

**PL-20. Phiếu ở Ưu đãi nặng.**
- Bằng chứng: mỗi phiếu có hai nút 44 rộng nửa ô (`offers__returning__mini375__s2`). 7 phiếu là 14 nút.
- Đề xuất (đi cùng `VoucherTicket`, DS-07):
  - Một nút "Dùng" cao nhìn thấy 32 (vùng chạm 44) ở bên phải.
  - Chạm vào mã để chép.
  - Phiếu thấp xuống từ khoảng 130 còn khoảng 84px.

**PL-21. Icon.**
- (a) Sparkles là ký hiệu quen của "AI" nhưng đang dùng ở 3 chỗ không liên quan AI:

| Chỗ dùng | Thay bằng |
|---|---|
| danh mục Tẩy rửa (`hooks/use-categories.ts:20`) | `SprayCan` (đã import cùng file) |
| tiêu đề Khuyến mãi trang nhãn (`pages/brand-view.tsx:202`) | `BadgePercent` (đã import) |
| nhãn "CTV tuyển chọn" (`pages/storefront-view.tsx:97`) | `Award` |

  Giữ Sparkles cho Trợ lý AI.
- (b) Đếm bằng grep thấy 32 chỗ tự đặt `strokeWidth=` từ 1.5 đến 2.25 ngoài `ui/icon.tsx` (chuẩn 1.75), ví dụ tim 1.9, chia sẻ 2, xe tải 2. Chuyển qua `Icon` và thêm bài kiểm bánh cóc (mục 5).

**PL-22. Hai hệ vòng icon đứng cạnh nhau ở Trang chủ.**
- Bằng chứng: lối tắt là vòng 44 với 5 màu (`components/home/shortcut-grid.tsx:26-27,77`). Danh mục là vòng 56 màu sage (`components/home/category-row.tsx:8-9,57`).
- Đề xuất: dùng hình dạng để phân biệt "công cụ" với "hàng hoá".
  - Lối tắt thành ô vuông bo 12, 44×44, `--radius-control`. Vẫn giữ màu theo chức năng.
  - Danh mục giữ vòng 56 và ưu tiên ảnh thật. Khi danh mục chưa có ảnh, lấy ảnh SP bán chạy nhất của danh mục; việc này cần trường API (xem backend-gap).

**PL-23. Đầu trang gian hàng và trang nhãn.**
- Bằng chứng:
  - Khi chưa có bìa, đầu trang là dải forest-700 trơn cao 84–96px, chỉ chứa nút back (`s-slug__guest__mini375__s1`, `brand-slug__returning__mini375__s1`). Trông như một thanh lỗi.
  - Nhãn cách tagline 4px, trong khi phía trên cách 16.
  - Phiếu khuyến mãi của nhãn có viền forest 1px trên nền cam (`pages/brand-view.tsx:213-243`).
- Đề xuất:
  - Chưa có bìa: dùng nền `--color-bg-subtle` cao 72, avatar đè lên 50%.
  - Hàng nhãn thêm `marginBottom: 8`.
  - Phiếu làm theo `VoucherTicket` (DS-07), viền `--color-voucher-edge`.

**PL-24. Bóng gợi ý "Trồng cây mỗi ngày…" hiện và tắt tức thì.**
- Bằng chứng: `components/garden-hint-bubble.tsx`.
- Đề xuất:
  - Vào: opacity + translateY 6→0, 220ms. Ra: 150ms. Ra ngắn hơn vào, theo skill.
  - Không đổi logic hiện/tắt. Logic đã tự tắt sau 5s và khi khách cuộn.

**PL-25. Số đổi theo thời gian chưa dùng chữ số đều.**
- Bằng chứng: số lượng ở `components/ui/quantity-selector.tsx:78`, chữ đồng hồ trong Badge, `CountBadge`. Thiếu `tabular-nums` nên chữ xê dịch khi đổi số.
- Đề xuất: thêm `fontVariantNumeric: 'tabular-nums'` cho 3 chỗ này và cho `Countdown` mới.

**PL-26. Gãy dòng xấu.**
- Bằng chứng: một chữ mồ côi rơi xuống dòng riêng:
  - "bình luận" ở thẻ cộng đồng (`home__returning__mini375__s3`)
  - "nước" ở "+65 giọt nước" (`offers__returning__mini375__s1`)
  - "khi đủ người" ở dòng mua chung (`product-slug__returning__mini375__s2`)
- Đề xuất:
  - `textWrap: 'balance'` cho tiêu đề ngắn: h1 trang chi tiết (`PRODUCT_NAME_STYLE`, `product-detail.tsx:1056`), tên gian hàng, tiêu đề khối.
  - `textWrap: 'pretty'` cho mô tả ngắn: tagline nhãn, mô tả phiếu, dòng phụ thẻ cộng đồng.
  - Không dùng cho đoạn văn dài.

---

## 4. Bảng token: trước → sau

| Token / thuộc tính | Trước | Sau | Nơi đổi |
|---|---|---|---|
| `--orange-700` (mới, lớp 1) | — | `#9A5200` | `packages/design-tokens/src/tokens.css` |
| `--color-flash-fg` | orange-800 `#7A4300` | orange-700 `#9A5200` | `tokens.css:162` |
| `--type-price-tile-size / lh / weight` (mới, lớp 3) | thẻ dùng price-sm 14 / 1.43 / 600 | 16px / 1.25 / 700 | `tokens.css`; PriceTag `size="tile"` |
| Hậu tố "đ" của PriceTag | 1em, cùng nét | 0.75em, 600 | `ui/price-tag.tsx` |
| Giá gạch | 13px | 12px | `ui/price-tag.tsx:29` |
| Dòng nhãn hiệu trên thẻ | 13/600, secondary, chấm 7px, cao 20 | 12/500, tertiary, không chấm, cao 16 | `ui/product-tile.tsx:157-165`, `catalog/catalog-grid.tsx:76-84` |
| Chip md | cao 44, đệm 10/14, nền stone-100, nét 500/600 | cao 36, đệm 7/14, nền surface + viền trong border-subtle, nét 600/600 | `ui/chip.tsx:52-57` |
| `.tubu-press` | scale .97 + opacity .9, 100ms | scale .96, không đổi opacity, nhấn 80ms / thả 180ms | `css/tokens.css:113-121` |
| `.tubu-press-card` (mới) | dùng chung `.tubu-press` | scale .985 | `css/tokens.css` |
| `--p-dur-press`, `--p-dur-release`, `--p-ease-spring` (mới) | — | 80ms, 180ms, `cubic-bezier(.34,1.56,.64,1)` | `packages/design-tokens/src/tokens.css` |
| `--elevation-nav` (mới) | `borderTop` 1px + `--elevation-3` (`0 -8px 24px .10`) | `0 -1px 0 rgba(28,26,22,.06), 0 -4px 16px rgba(28,26,22,.06)` | `components/bottom-nav.tsx:55-56` |
| Nhãn thanh dưới | 13px, 500/700 | 12px, 500/600; icon tab đang chọn tô 16% | `bottom-nav.tsx:135`, `ui/icon.tsx` |
| ProgressBar tông flash | cao 6, rãnh stone-200, chữ dòng riêng, chuyển `width` | cao 16, rãnh `--color-flash-bg`, chữ 12/600 trong thanh, `scaleX` | `ui/progress-bar.tsx:24-28` |
| Đồng hồ | 30s, "13h 33m" trong Badge | ô HH:MM(:SS) 22×20 nền stone-900 | `hooks/use-countdown.ts:18`, B7 |
| Shimmer | trắng .65, 1.4s, ease | trắng .45, 1.6s, ease-in-out | `css/tokens.css:229-235` |
| `--color-media-outline` (mới) | — | `rgba(28,26,22,.06)` | khung ảnh của ProductTile, FlashTile, thumbnail giỏ |
| Tiêu đề khối (nếu chủ chọn PL-06) | Fraunces 16/600 | Inter 16/700, `-0.01em` | `SectionHeader` (B5) |

## 5. Hợp đồng chuyển động (mọi màn gian hàng)

Mỗi chuyển động trả lời được câu "nó báo cho khách điều gì". Mọi thời lượng dùng token. Quy tắc `prefers-reduced-motion` cuối `css/tokens.css` đưa tất cả về tức thì.

| Sự kiện | Chuyển động | Thời gian | Easing | Báo điều gì |
|---|---|---|---|---|
| Nhấn nút, chip, icon | scale .96 | 80 vào / 180 ra | ease-out | đã nhận chạm |
| Nhấn thẻ | scale .985 | 80 / 180 | ease-out | đã nhận chạm, không làm mờ ảnh |
| Thích | tim nảy 1 → 1.25 → .94 → 1 | 320 | spring | đã lưu |
| Thêm giỏ | nhãn nút → Check "Đã thêm", chuyển chéo opacity/scale/blur | 160 vào, giữ 1.200, 120 ra | ease-out | đã thêm, đúng chỗ khách đang nhìn |
| Huy hiệu giỏ | nảy 1.35 (đã có) | 350 | ease-out | số trong giỏ đã đổi |
| Thanh % Giờ vàng | `scaleX` 0 → p, chỉ lần đầu | 600 (poll sau đó: 220) | ease-out | mức đã bán |
| Đồng hồ | chỉ thay số, không lật | — | — | thời gian, không gây hối thúc |
| Ảnh tải xong | opacity 0 → 1 | 200 | ease-out | ảnh đến mà không bụp |
| Khung chờ | shimmer | 1.600, lặp lại | ease-in-out | đang tải |
| Dải Giờ vàng ở trang chi tiết, bóng gợi ý | opacity + y 6–8 → 0 | 220 vào / 150 ra | ease-out / ease-in | khối mới xuất hiện |
| Ô tìm dính | viền dưới hiện dần | 150 | ease-out | nội dung đang trượt dưới ô tìm |
| Chọn tab | icon scale .88 → 1 | 220 | spring | đã chuyển tab |

**Không thêm:**
- Hiện dần mọi khối khi cuộn: trang mua sắm cần thấy ngay.
- Parallax.
- Hiệu ứng lặp vô hạn ngoài khung chờ và `ptr-spin`.
- Marquee.

## 6. Bánh cóc bổ sung (nối vào DS mục C2, không lặp)

- **T-P1 `apps/miniapp/src/ds-motion-guard.spec.ts`**, web làm bản tương ứng. Quét `components/` và `pages/` của lane shop, cấm:
  - `transition: 'all` / `transition: all`
  - `transition` trên `width|height|left|top`. Ba chỗ hiện có ghi vào danh sách cho phép, rồi giảm dần.
  - `@keyframes` ngoài `css/`
  - `strokeWidth=` ngoài `ui/icon.tsx`
  - import `Sparkles` ngoài `pages/ai-advisor.tsx` và `pages/profile.tsx`
  - `opacity` trong `:active`
- **T-P2 Playwright `tile-rhythm`.**
  - Dựng lại từ ý của script đo ở mục 1: chạy `miniapp-session`, rồi lấy `getBoundingClientRect` của từng thẻ trong `[data-testid=catalog-grid]` và từng con của kệ.
  - Áp ở khổ 375 cho: lưới Gợi ý Trang chủ, `/browse`, `/s/:slug`, `/brand/:slug`, kệ Bán chạy.
  - Điều kiện đạt:
    - thẻ cùng hàng: chênh đáy giá ≤ 1px
    - dòng meta cao ≤ 20px
    - thẻ cùng kệ cao bằng nhau ±1px
    - chip cao 36 ±1
  - Chạy cùng nhóm e2e với `buy-flow-4b`.
- **T-P3 `css/contrast.spec.ts`:** thêm `--orange-700` trên trắng, orange-50, stone-50 (ngưỡng 4,5), và stone-900 trên `--color-flash-solid-bg` (ngưỡng 4,5).
- **Checklist PR** (DS C4), thêm 3 dòng:
  - Phần tử bấm được có `tubu-press` hoặc `tubu-press-card` chưa?
  - Chuyển động có lý do chưa, và lúc ra có ngắn hơn lúc vào không?
  - Số đổi theo thời gian có `tabular-nums` chưa?

## 7. Câu hỏi cho chủ (mỗi câu có đề xuất mặc định)

1. **Q1. Đồng hồ Giờ vàng:**
   - đếm theo phút (êm, §3.2), hoặc
   - đếm từng giây ở đầu khối và đầu trang Giờ vàng (kiểu Shopee)?

   Đề xuất: đếm giây chỉ ở đầu khối và đầu trang Giờ vàng, nền ô màu stone-900 (không đỏ). Mọi chỗ khác đếm theo phút.
2. **Q2 (= E1 của DS). Tiêu đề khối trong luồng mua:** Fraunces 16 hay Inter 16/700?

   Đề xuất: Inter 16/700. Fraunces để dành cho tiêu đề trang và các con số lớn.
3. **Q3. Thẻ Giờ vàng có bỏ giá gạch không** (nhãn "-x%" trên ảnh đã nói mức giảm)?

   Đề xuất: bỏ ở thẻ, giữ ở trang chi tiết và giỏ.

## 8. Thứ tự làm

| Bước | Gồm | Ghi chú |
|---|---|---|
| 1 | PL-01, 02, 03, 04, 21b. Kèm T-P2, T-P3 | Một PR thẻ sản phẩm. Đo lại `TILE_BODY_HEIGHT` và `buy-flow-4b`. Lợi nhiều nhất trên mọi lưới |
| 2 | PL-05, 10, 11. Kèm T-P1 | Điều khiển và cảm giác chạm. Kiểm `:active` trên Zalo iOS thật |
| 3 | PL-07, 08, 09, 13 | Đi cùng `Countdown` (B7) và biến thể `flash` (B2). Cần trả lời Q1 và Q3 |
| 4 | PL-12, 14, 15, 16 | Chuyển động phản hồi |
| 5 | PL-06 (sau E1), P2 còn lại | |

## 9. Chưa kiểm

- `:active` và rung (haptic) trong Zalo iOS và Android thật. Bộ khung UAT dùng Chromium, giả zmp-sdk.
- Ảnh sản phẩm thật: chưa có trong repo nên viền trong và hiện dần ảnh (PL-15) mới suy từ mã.
- Máy yếu chạy bộ đếm 1s cùng lưới cuộn vô tận: chưa đo khung hình.
- Web 375 và 1280: agent `web` phụ trách. Mọi giá trị ở đây phải ra cùng số đo ở web dưới `md` (DS B0.4).
- Chế độ tối: Mini App chỉ có một chủ đề sáng, và skill taste đòi có chế độ tối, nhưng việc này ngoài phạm vi đợt này nên không đề xuất.
