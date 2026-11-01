# Thiết kế: nâng cấp gian hàng Tubu Tree (2026-10-31)

Nguồn: 10 báo cáo trong `review/` (ảnh hiện trạng ở `screens/`, mục lục `screens/INDEX.md`). Tài liệu này chốt hướng làm; chi tiết từng đề xuất (số đo, sơ đồ, chữ) nằm ở báo cáo gốc theo mã tham chiếu (vd `critique-shop HM-02`, `design-system B2`, `ux-copy B7`).

## 1. Ý định

Chủ dự án thấy gian hàng "rối, quá nhiều sản phẩm dàn trải" và muốn Mini App chuẩn tầm Shopee. Review cho thấy cái rối không đến từ số kệ (Trang chủ chỉ 3–4 kệ) mà từ:

1. Thẻ sản phẩm cao lệch nhau (289–319px), dòng sao/đã bán gãy hai dòng, giá nhỏ bằng tên; màn đầu Danh mục chỉ có 2 thẻ trọn.
2. Danh mục phẳng: đồng bộ Pancake không ghi danh mục, `Category.parentId` bị bỏ qua, nên mọi lối duyệt rơi về một lưới hơn 100 món.
3. Kệ không có trần số món, không có "Xem tất cả", không chống trùng giữa khối.
4. Gian hàng CTV và trang thương hiệu vẽ mọi bộ sưu tập thành lưới 2 cột hiện hết món, bỏ qua `layout` và combo mà API đã trả; giỏ trừ tiền combo mà khách không thấy.
5. Thiếu công cụ bán hàng: không banner/chiến dịch, không hệ nhãn, Giờ vàng không có trang riêng, mã giảm giá rải ba kiểu.
6. Sáu kiểu thẻ, sáu kiểu tiêu đề khối, mười kiểu nhãn, 490 số px viết tay: mỗi màn mới lại tự chế, nên càng làm càng lệch.

Thành công là: khách mở Trang chủ thấy deal ngay màn đầu; tìm được món qua danh mục hai tầng thay vì cuộn lưới dài; mỗi khối một ý định, có trần và có lối "Xem tất cả"; thẻ sản phẩm đều nhau, giá nổi; gian hàng trông như trang shop; web khổ điện thoại giống Mini App; và màn làm sau bị bài kiểm tự động chặn nếu lệch hệ thống.

## 2. Mục tiêu, không làm, phản mục tiêu

Mục tiêu (chủ đã chọn): làm lại Trang chủ, Danh mục, chi tiết SP, giỏ, gian hàng CTV + màn dựng, trang thương hiệu, Ưu đãi + Giờ vàng; thêm 4 nhóm chức năng (Giờ vàng theo khung giờ + Bán chạy nhất; nhãn thẻ + Gợi ý hôm nay; banner + trang chiến dịch + kho mã giảm giá; combo + mua kèm). Mini App trước, web cùng nhánh (luật `AGENTS.md`). Cơ chế giữ khớp cho việc sau.

Không làm đợt này: theo dõi gian hàng CTV (`StorefrontFollow`); nhiều mã giảm giá trong một đơn; livestream, chat shop; đổi Mini App sang khung UI khác; đổi luồng thanh toán; màn admin ngoài phần cần cho chức năng mới; gán danh mục cho sản phẩm thật trên PROD (việc dữ liệu của chủ, xem §7).

Phản mục tiêu (làm xong mà dính là hỏng):
- Trang nhảy khi tải (CLS) quay lại: khung chờ Trang chủ đã đạt CLS ~0 (`home-layout.ts` settling), khối mới phải có chiều cao giữ chỗ.
- Giá khách thấy khác giá khách trả (giỏ, báo giá, đặt đơn phải ra cùng số; xem `backend-gap §5–6`).
- Màu đỏ "gào thét" kiểu sàn giá rẻ: giữ chất "Deep Forest Apothecary", Giờ vàng dùng cam đậm, đồng hồ nền tối.
- Hồi quy a11y đã đạt (0 vi phạm axe, vùng chạm 44px, tương phản).
- Web khổ điện thoại lệch Mini App.

## 3. Ràng buộc

- Logic dùng chung ở `packages/app-core` (giá thẻ, nhãn, chữ, luật kệ); Mini App và web chỉ vẽ. Route mới khai trong `route-map.json`, `pnpm lint:parity` xanh.
- Đường tiền: thứ tự giảm hiện có Giờ vàng → combo → mã → hạng → điểm, chia về dòng qua `OrderItem.paidTotal` (`checkout.service.ts:1078-1121`, `checkout-split.ts:198-232`). Gói mới đụng giá phải đi qua đường chia dòng này, có race test giỏ = báo giá = đặt đơn.
- Không deploy, không đụng PROD. Merge vào main khi gate xanh + reviewer Opus không còn lỗi (chủ cho phép).
- Khung chờ, vùng chạm, tương phản, axe giữ như hiện tại hoặc tốt hơn.

## 4. Quyết định đã chốt

Các câu hỏi trong báo cáo được chốt như sau. Chủ giao quyền tự chốt; mọi dòng dưới là quyết định của tôi, chủ đổi được sau.

| # | Câu hỏi (nguồn) | Chốt |
|---|---|---|
| Q1 | Chữ tiêu đề khối (DS E1, polish PL-06) | Khối trong luồng mua: Inter 16/700, -0.01em. Fraunces chỉ cho tiêu đề trang và số lớn ≥22px. |
| Q2 | Màu giá (DS E3, critique-shop Q1) | Giá đang giảm (Giờ vàng hoặc giá sale) dùng một màu cam đậm `--orange-700 #9A5200` qua token `--color-text-price-deal`; giá thường giữ đen. Không dùng đỏ. |
| Q3 | Đồng hồ Giờ vàng (ux-copy E1, polish PL-07) | HH:MM:SS nhảy từng giây chỉ ở đầu khối Giờ vàng Trang chủ và đầu trang Giờ vàng, ô số nền stone-900. Nơi khác "Kết thúc sau 2 giờ 05 phút", cập nhật theo phút. Một bộ đếm cho cả khối. |
| Q4 | Nhãn thẻ (critique-shop Q4, DS B3, ia-merch D2) | Slot A trên ảnh: tối đa 1 (Giờ vàng -x% hoặc -x%). Slot nhãn: tối đa 1 nhãn đứng đầu dòng tên, ưu tiên Combo > Tubu chọn > Được yêu thích > Mới > Miễn phí giao hàng. Dòng meta: "★ 4,8 · Đã bán 1,2k+" một dòng. Hết hàng ẩn mọi nhãn. Thẻ giữ chiều cao cố định. |
| Q5 | Tên nhãn (ux-copy E2–E7) | "Bán chạy nhất" (không "Top"); "Miễn phí giao hàng" chỉ khi riêng món đó được miễn phí; "Được yêu thích" (≥4,8★, ≥20 đánh giá, ≥50 đã bán, cấu hình được, API tính) và "Tubu chọn" (`isFeatured`); "Mã giảm giá" thay "Kho voucher", tab Nhận mã / Mã của tôi / Đã dùng–hết hạn; "Thương hiệu" ở mọi nơi; thẻ "Tạm hết hàng", hàng ngừng "Ngừng bán". E8 (chữ nút chat) giữ nguyên. |
| Q6 | Khách cũ: Giờ vàng hay Mua lại trước (critique-shop Q3) | Giờ vàng trước để deal nằm trong màn đầu; Mua lại 1 món thành 1 dòng. |
| Q7 | Lối tắt Trang chủ (critique-shop Q2) | 4 ô cố định + "Tất cả" mở sheet: Giờ vàng · Mã giảm giá · Đổi rác lấy quà · Mua chung. Danh sách đầy đủ trong sheet. |
| Q8 | Đánh giá nhanh ở PDP (critique-shop Q5) | Có: 2 đánh giá ngay sau Combo/Mua kèm; danh sách đầy đủ giữ chỗ cũ. |
| Q9 | Bậc CTV trên trang shop công khai (critique-store Q1) | Ẩn bậc thấp nhất, hiện từ bậc 2. |
| Q10 | Thứ tự `/offers` (critique-store Q2, ia-merch C6) | Trang mua sắm công khai: Banner → Giờ vàng hôm nay → Nhận mã → dải Điểm Xanh gọn → Mã của tôi → Đổi quà. Khối cần đăng nhập vẽ `GuestLinkCard`. Route thành `private: false`. |
| Q11 | Giờ vàng Trang chủ có tên món (critique-store Q4) | Có, 1 dòng. |
| Q12 | Trần khối tab Shop (critique-store Q5) | 6 khối, quá thì cảnh báo ở màn dựng. |
| Q13 | Web máy tính (web Q1–Q5) | Ẩn lối tắt từ lg; `/uu-dai` rời khung Tài khoản thành trang rộng; phân trang số ở lg cho Danh mục; Gợi ý hôm nay ở máy tính dừng 48 món rồi "Xem thêm"; thẻ bỏ số lượt đánh giá. |
| Q14 | Khung giờ Giờ vàng | Mặc định 12:00 và 20:00, cấu hình `flashsale.slots`. |
| Q15 | Tiền combo/mua kèm toàn sàn (backend-gap §4, §7) | Tubu tài trợ. Hoa hồng CTV tính trên `paidTotal` của dòng sau giảm (giữ luật hiện có của combo gian hàng; builder kiểm lại và ghi rõ nếu khác). Khách trả một món của combo: hoàn đúng `paidTotal` của dòng đó, không thu lại phần giảm của món còn giữ. Một đơn một mã. Ghi "Mỗi đơn dùng 1 mã" ở chỗ chọn mã. |
| Q16 | Skill dự án (DS E4) | `.claude/skills/tubu-ui/SKILL.md` vào git: `.gitignore` đổi `.claude/` thành `.claude/*` + `!.claude/skills/`. |
| Q17 | Kiểm a11y axe 375px (a11y C7) | Chạy trong gate trước merge của đợt này; đưa vào CI nếu dưới 2 phút. |
| Q18 | Bán chạy nhất khi chưa có đơn thật (builder check) | Xếp `soldApp30d` giảm dần, hoà thì theo `sold` trọn đời (`soldExternal + soldApp`, số nhập tay là bán ngoài kênh, vẫn là dữ liệu thật). Số hạng luôn hiện. "Đã bán" trên thẻ và ngưỡng "Được yêu thích" dùng `sold` tổng như hiện tại. |
| Q19 | Dung lượng Mini App (builder check) | Ngưỡng cứng đợt này: chunk vào (entry) Mini App không vượt 700 KB (`scripts/ci/bundle-budget.cjs`). Khối dưới màn đầu nạp lười theo mẫu `home-lazy.tsx`/`home-below.tsx` kèm chiều cao giữ chỗ; trang mới (`/flash-sale`, Bán chạy nhất, chiến dịch, `/ds-gallery`) là chunk theo route. Gói nào làm entry tăng phải ghi số trước/sau trong PR. |

## 5. Hướng thiết kế theo màn

Mỗi màn theo sơ đồ trong báo cáo được nêu; chỗ hai báo cáo khác nhau thì theo §4.

- **Thẻ sản phẩm (mọi màn):** một `ProductTile` với biến thể `grid | rail-sm | rail-md | flash | rank | line`, thân thẻ cố định (tên 2 dòng, giá 16/700 neo đáy, meta nowrap), hai bề rộng kệ `--tile-w-sm 128` và `--tile-w-md 148`. Logic giá/nhãn/meta/chữ đọc ở `productCardView` (app-core). Xoá `CatalogTile`, `RelatedTile`, thẻ chết của web. Nguồn: DS B2–B4, critique-shop CS-01, polish PL-01..03, a11y P1 giá gạch + describedby, web P1 thẻ.
- **Trang chủ:** sơ đồ A của critique-shop với thứ tự khối:
  - Khách cũ: `header dính (logo, tìm, chuông, giỏ) → member (nền sáng) → todo (1 dòng) → banner* → shortcuts (4 + Tất cả) → flash (gọn, ≤8 + Xem tất cả + dòng "Suất kế tiếp") → purchased (1 món = 1 dòng) → categories (lưới 2×5) → bestSellers ("Bán chạy nhất", có số hạng) → combos* → journey → community → suggest ("Gợi ý hôm nay")`.
  - Khách mới: như trên, `welcome` thay `member`, không `purchased`.
  - (* tự ẩn khi không có dữ liệu.) Bỏ kệ "Sắp diễn ra" ở Trang chủ. Chống trùng theo thứ tự ưu tiên Giờ vàng > Mua lại > Combo > Bán chạy > Mới > Gợi ý. Gợi ý hôm nay: chip danh mục thay chip sắp xếp, xoay thứ tự theo ngày, dừng ở 100 món (máy tính 48).
- **Danh mục `/browse`:** gốc là hub không lưới (danh mục tầng 1, Đã xem, Bán chạy nhất, logo thương hiệu, nút "Xem tất cả sản phẩm"); chế độ danh sách có `SortBar` dính 44px (Phổ biến/Liên quan · Bán chạy · Mới · Giá ⇅ · Lọc (n)), chip danh mục tầng 2, 20 món/trang. Tên danh mục hiện một lần. Nguồn: ia-merch C2, critique-shop 4.2.
- **Chi tiết SP:** `FlashPriceBar` dưới ảnh khi đang Giờ vàng; sửa chip phân loại hiện giá chưa áp Giờ vàng (`product-detail.tsx:1247`); gom thông tin thành `ListRow` có "›"; một dòng "Phân loại ›" mở sheet; Combo ưu đãi (≤2), Mua kèm deal sốc (≤3), Đánh giá nhanh, "Khách thường mua cùng" (đổi tên dải cũ), "Có thể bạn cũng thích" cuối trang; mã giảm gom một dòng mở sheet. Web máy tính: sửa P0 nút mua dưới đáy màn (web P0). Nguồn: ia-merch C3, critique-shop 4.3, web P1 PDP.
- **Giỏ:** dòng ~124px, giá gạch + "Tiết kiệm" (API thêm `listUnitPrice`), chân dính gồm mã giảm, freeship, tổng + tiết kiệm + nút. Nguồn: critique-shop 4.4.
- **Khung trang shop (gian hàng CTV + thương hiệu):** `ShopHeader` (bìa phẳng, avatar thống nhất, `ShopStatsRow` 3 số, nút Theo dõi cho thương hiệu), voucher shop dạng chip, tab Shop | Sản phẩm (n) | Danh mục (+ Câu chuyện cho thương hiệu), `ShopTopBar` hiện tên shop khi cuộn; `ShopSection` vẽ theo `layout`: CAROUSEL → kệ ≤10, GRID → lưới ≤6 + "Tất cả (n)", STACK → dòng ≤5, COMBO → `ComboCard` "Mua cả bộ -x%" + "Thêm cả combo" (API thêm giỏ nhiều món trong một transaction). API thương hiệu phân trang thật + `productCount`; `%` combo trả về kẹp `max_combo_pct`. Nguồn: critique-store, ia-merch C4, backend-gap §4.
- **Màn dựng `/storefront` (Mini + web):** màn chính là danh sách `SectionCard`; trang chi tiết khối có `LayoutPicker` (Lưới/Kệ ngang/Danh sách/Combo) + ô % combo + xem trước bằng chính `ShopSection`; chế độ Sắp xếp riêng; Hành trình thu thành dải 56px; thống kê lên đầu khi gian hàng đang mở. Nguồn: critique-store 4.x, a11y P1 trình dựng.
- **Ưu đãi `/offers` + Mã giảm giá:** thứ tự Q10; `VoucherTicket` (ticket ~88px, cuống trái theo loại, một nút chính), sắp xếp sắp hết hạn trước, chip lọc. Web `/uu-dai` trang rộng, lưới 3 cột ở máy tính. Nguồn: critique-store /offers, ia-merch C6, web P1 Ưu đãi.
- **Giờ vàng:** trang `/flash-sale` (web `/gio-vang`) có tab khung giờ dính (tablist bàn phím được), `Countdown`, chip danh mục, hàng thẻ `line` + `FlashSoldBar` có chữ ("Vừa mở bán / Đã bán n% / Sắp hết / Đã bán hết"), món hết suất mờ cuối danh sách, "Nhắc tôi" cho suất sắp tới (xem được khi chưa đăng nhập). Hiện giới hạn mua và câu lỗi mới khi vượt: thanh Giờ vàng ở PDP nói "Mỗi khách tối đa {n}" (`flash.limit`), còn dòng ghi chú một dòng của hàng thẻ trong danh sách dùng dạng ngắn "Tối đa {n}/khách" (`flash.limitShort`) đứng ĐẦU dòng, trước tên phân loại, vì dòng nowrap bị cắt ở đuôi trên 375px (chốt ở F10a, P1 #9 của final-critique); hai dạng cố ý khác nhau theo bề rộng chỗ chứa. Nguồn: ia-merch D1, backend-gap §1, a11y P0 thanh %, ux-copy B.
- **Bán chạy nhất:** trang riêng theo danh mục (tab), số hạng trên thẻ `rank`; xếp theo `soldApp30d` (cron 03:00), không trộn số nhập tay.
- **Banner + chiến dịch:** model `Campaign` (placement HOME_TOP / OFFERS_TOP, lịch, đối tượng), `CampaignProduct`, `CampaignCoupon`; trang `/campaign/:slug`; admin CRUD + ảnh. `BannerCarousel` theo yêu cầu a11y P0 (nút dừng, reduced-motion trong JS, ≥5s/slide, slide ngoài khung inert).
- **Combo + mua kèm toàn sàn:** `Bundle` + `BundleItem` (BUNDLE_PCT, ADDON), quy về `comboPerLine`/`Order.comboDiscount`, mỗi dòng lấy khoản giảm lớn nhất, có trần giá nhân viên; admin quản lý; hiện ở PDP, giỏ, khối combos Trang chủ. Race test bắt buộc, review Opus hai lượt.
- **Danh mục hai tầng (dữ liệu):** API `categories` trả cây + `productCount` cộng con; lọc theo cha gồm cả con; admin gán hàng loạt + hộp việc "SP chưa có danh mục (n)". Không tự gán dữ liệu thật.
- **Web máy tính:** khuôn `ListingLayout / PdpLayout / StoreLayout / HubLayout`; Trang chủ lưới 12 cột (banner col-8 + cột phải thẻ thành viên/việc cần làm); Danh mục h1 + breadcrumb + cột lọc 200px cuộn theo trang + phân trang số. Nguồn: web §3–4.
- **A11y và chuyển động chung:** `BottomSheet` Mini thành hộp thoại thật (chép từ web); vùng `role=status` + `useNotify()`; focus-visible cho nút DS; `scroll-padding`; tim yêu thích có tên SP; tách kiểu nhấn nút/thẻ; nút "Thêm vào giỏ" tự đổi "Đã thêm" thay snackbar đầu màn. Nguồn: a11y P1, polish PL-09..13.

## 6. Cơ chế giữ khớp (việc làm sau vẫn ăn khớp)

1. **Một nguồn sự thật:** `DESIGN.md` ở gốc repo (nguyên tắc, token, thành phần, luật kệ, luật nhãn, chữ chuẩn) + `docs/design/ds-map.json` (thành phần ↔ file Mini ↔ file web ↔ màn dùng) + trang `/ds-gallery` (chỉ bản dev) ở hai app vẽ mọi biến thể.
2. **Logic dùng chung:** `packages/app-core/src/commerce/` (`productCardView`, `cardBadges`, `metaLine`, `countdown*`, `couponLabel`, `sortVouchers`, `collectionView`, `shopStats`), `packages/app-core/src/merch/shelves.ts` (`ShelfSpec`: intent, source, layout, maxItems, minItems, dedupeRank, seeAllRoute) + `applyShelfDedupe`, `shop-copy.ts` (chữ + bảng thuật ngữ).
3. **Bài kiểm chặn (CI):** kệ thiếu ngân sách/seeAllRoute không có trong route-map/hai kệ cùng ý định/Trang chủ >4 kệ (`shelves.spec`); thẻ SP tự chế ngoài `ProductTile`; giá gạch ngoài `PriceTag`; primitive màu ngoài `css/` và `components/ui`; `Text` của zmp-ui trong trang mua sắm; gọi thẳng `openSnackbar`; thuật ngữ cấm (Nhãn hàng, Top, Kho voucher, Freeship...); số px viết tay và lớp `max-md:` chỉ được giảm (bánh cóc có baseline); cặp màu mới trong `contrast.spec`; độ dài chữ theo khổ 375; so số đo computed style Mini ↔ web ở 375px cho thẻ, tiêu đề khối, giá (`ds-parity`). `packages/design-tokens` có script test, `lint:vars` vào CI.
4. **Skill `tubu-ui`:** agent phải đọc trước khi làm UI: dùng thành phần nào, khai kệ thế nào, chữ lấy ở đâu, chạy kiểm gì, chụp so 375px Mini vs web.
5. **PR template mục Giao diện** + dòng trỏ skill trong `AGENTS.md`.

## 7. Việc của chủ (không chặn đợt làm)

- Chốt cây danh mục 2 tầng (≤8 cha × ≤8 con) và gán sản phẩm thật trên PROD bằng màn admin mới; đến lúc đó Danh mục vẫn chạy với danh mục phẳng hiện có.
- Ảnh banner và chiến dịch thật; ảnh sản phẩm thật (mẫu chỉ có khung lá).
- Deploy khi muốn (đợt này không deploy).

## 8. Để lại cho người làm

Tên file, cách chia component nội bộ, tên khoá chữ, cách viết migration, số px cuối cùng khi đo thấy lệch so với báo cáo (giữ ý: thẻ đều, giá nổi, màn đầu có deal), cách đặt trang `/ds-gallery`, thứ tự commit trong gói. Báo cáo nào đề xuất khác nhau mà §4 không phủ thì chọn phương án ít rủi ro hơn và ghi vào PROGRESS.
