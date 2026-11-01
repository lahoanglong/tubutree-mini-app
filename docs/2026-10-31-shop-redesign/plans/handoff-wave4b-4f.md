# Bàn giao đợt 4b–5b (P10 trình dựng gian hàng, P14 mã giảm giá, P16 danh mục admin, F6 sửa việc mở, P17a/P17b cơ chế, tài liệu và bài kiểm chặn, P15 combo và mua kèm, F7a và F7b sửa lỗi nhỏ, F8 và F8b sửa nốt P15, F9 combo ở Trang chủ, F10a–F10d sửa P1 của bước chốt)

Nhánh tích hợp `shop/2026-10-31-redesign`, PR #109 vào main. Nội dung ở đây là phần gộp thêm sau đợt 4a (xem `handoff-wave4a.md`). Chưa deploy gì từ các gói này. Deploy là việc chủ quyết, agent không tự deploy.

Thứ tự gộp theo PROGRESS: P16, F6, P17a, main 7b77ee686 (#97, #102), P10, P14 (cổng kiểm đợt 4b e3229fe39, 0 FAIL, e2e Mini 318 xanh). Sau đó F7a, F7b, P15, F8, main 2765aea5b (#111), F8b, main f7b7a09ef (#112), bước chốt chụp ảnh và review hình (`review/final-critique.md`), F9, F10a, F10b, F10c, F10d, sửa P1 số 2 của phiên chính, P17b. Review: P16 và F6 APPROVE lượt 1; P10, P14 lượt 2; P17a lượt 3. P14, P15, F8b và F10b là đường tiền nên review đủ hai lượt. P15 và F8 còn thêm các vòng sửa theo reviewer Opus (ghi ở cuối `P15-bundles.md` và `F8-bundles-followups.md`). F9, F10a–F10d APPROVE ở lượt 2; P17b qua 4 vòng (vòng 4 do phiên chính sửa, xem cuối `P17b-ratchets.md`).

## 1. Đã có gì

**P10, trình dựng gian hàng (CTV).** Màn `/storefront` (Mini) và `/ctv/gian-hang` (web).
- Khách: không đổi gì. Gian hàng khách thấy vẫn là các khối cũ.
- CTV/admin: màn chính là danh sách khối. Mỗi khối có nút lên/xuống, chọn kiểu trình bày, ô % combo và xem trước đúng như khách thấy (dùng chính `ShopSection`). Có chế độ "Sắp xếp" riêng. Hành trình thu thành dải 56px, thống kê 30 ngày lên đầu khi gian hàng đang mở.
- Chi tiết khối là một mục lịch sử riêng (`?khoi=<id>`), nên nút Quay lại về đúng danh sách khối. Kiểu NORMAL/COMBO của khối chỉ chọn lúc tạo, chưa đổi được sau đó.
- Trần % combo do máy chủ quyết. Màn chỉ báo "Mức giảm tối đa hiện là n%." khi máy chủ hạ số.

**P14, mã giảm giá.** Trang `/vouchers` (Mini) và `/ma-giam-gia` (web), dựng lại `/offers` và `/uu-dai`.
- Khách: ba tab Nhận mã, Mã của tôi, Đã dùng hoặc hết hạn. Chỉ mã được admin bật "hiện ở mục Nhận mã" mới vào kho. `/uu-dai` công khai, không còn nằm trong khung tài khoản. Chỗ chọn mã ở giỏ và thanh toán ghi "Mỗi đơn dùng 1 mã".
- Admin: mã có thêm tên hiển thị và công tắc "Hiện ở mục Nhận mã". Chỉ mã loại nhận chung (CLAIM) và không thuộc lô thẻ in mới bật được.
- Cách tính giảm giá và nhận mã không đổi (vẫn `POST /coupons/claim`). API mới `GET /coupons/collectable` (công khai, có cache) và `GET /me/coupons/history`.

**P16, danh mục admin.** Tab "Sản phẩm" ở admin.
- Khách: không đổi.
- Admin: dựng cây danh mục 2 tầng (tối đa 8 gốc, mỗi gốc tối đa 8 mục con). Tạo, đổi tên, chuyển mục, xoá, sắp thứ tự bằng nút lên/xuống. Gán sản phẩm hàng loạt vào danh mục lá (gán lại không sinh trùng), lọc theo thương hiệu. Hộp việc "SP chưa có danh mục (n)" dẫn tới màn gán. API chặn vượt giới hạn bằng lỗi 400 tiếng Việt.
- Đồng bộ Pancake không đè danh mục admin đã gán tay. Chỉ gán vào mục lá. Muốn thêm mục con vào gốc đang có sản phẩm gắn thẳng thì phải xác nhận (F7b).

**F6, sửa bảy việc còn mở của đợt 3 và 4a.**
- Khách: thanh dính của Mini không còn hở 48px; giỏ Mini chỉ còn một nút "Quay lại"; trang Bán chạy nhất đặt tên tab và dòng thước đo đúng; "Nhắc tôi" Giờ vàng tự đặt nhắc sau khi đăng nhập; Trang chủ web từ màn lớn không nhảy khi banner có gợi ý mà phiên chưa khôi phục; danh mục "Tẩy rửa sinh học" cùng icon ở Mini và web.
- Admin: không đổi.

**P17a, cơ chế giữ khớp và tài liệu.** Không có gì để khách hay admin thấy.
- Có `DESIGN.md`, bản đồ `docs/design/ds-map.json` (thành phần Mini ↔ web) và `scripts/check-ds-parity.mjs` nối vào `lint:parity`.
- Có `terminology.spec.ts` chặn từ cấm trong chữ hiển thị của hai app (chỗ đang vi phạm nằm trong danh sách miễn có lý do và trần số lượng).
- Có skill `tubu-ui`, dòng trỏ ở `AGENTS.md` và mẫu PR.
- Phần ratchet, e2e đối chiếu và axe để P17b (mục 5).

**P15, combo toàn sàn và mua kèm.** Hai loại bộ: BUNDLE_PCT ("mua đủ bộ giảm %", 2–6 sản phẩm) và ADDON ("mua kèm giá riêng", 1–3 món kèm).
- Khách: trang chi tiết sản phẩm có khối "Combo ưu đãi" (tối đa 2) và "Mua kèm deal sốc" (tối đa 3). Giỏ hiện dòng "Giảm giá combo" sẵn có. Trang chủ có khối `combos`. Bộ hết hạn hoặc tắt khi khách đang xem thì khối ở nguyên chỗ và ghi "Đã kết thúc". Món hết hàng thì ghi "Tạm hết hàng" (F8). Hai app cùng làm.
- Admin: mục "Combo và mua kèm" cạnh "Chiến dịch" (quyền MARKETING). Nhân viên bị trần giảm; ADMIN được miễn.
- Luật tiền: Tubu tài trợ. Giảm đi qua đường combo sẵn có, nên hoa hồng CTV tính trên giá sau giảm. Hậu quả: combo toàn sàn làm giảm hoa hồng CTV. Trả hàng hoàn đúng phần khách đã trả. Mỗi dòng lấy khoản giảm lớn nhất giữa combo gian hàng và combo toàn sàn. Dòng đang Giờ vàng không nhận combo. Món của đối tác bị loại khỏi bộ. Hết hạn giữa báo giá và đặt đơn thì máy chủ trả `TOTAL_CHANGED` và không tạo đơn.

**F7a, sửa lỗi nhỏ phía khách (8 việc).**
- Ví tải lỗi thì tab Nhận mã báo thử lại, không ghi "Đã dùng" cho mã đã nhận.
- Mã khách mới đã nhận mà khách đã có đơn thì báo không còn áp dụng.
- Mẫu gian hàng theo danh mục cha gồm cả sản phẩm của mục con.
- Thẻ Giờ vàng "Sắp diễn ra" ghi "Sau 2 giờ 05 phút" (khoá chữ riêng `flash.startsInTile`, trần 18 ký tự cho vừa thẻ 112px).
- Nút Quay lại Mini đứng trước nội dung chính trong thứ tự Tab.
- Kệ Bán chạy nhất Trang chủ ghi đúng thước đo khi lùi về tổng lượt bán.
- Web Trang chủ không giữ khung chờ banner khi máy chủ đã báo không có chiến dịch.
- `home-banner-lg.web.spec.ts` chạy được trên CI.

**F7b, sửa lỗi nhỏ ở admin và trình dựng (9 việc).**
- Admin: lỗi tải cây danh mục hiện cả khi cây thu gọn; chip "Chưa có danh mục" ghi rõ phạm vi; chuyển mục phải chọn đích rồi bấm nút xác nhận; thêm mục con vào gốc đang có sản phẩm gắn thẳng phải xác nhận (máy chủ ép, quyết định số 4 của plan); API giả của e2e áp đúng `onSale`.
- Trình dựng: đổi kiểu khối gửi nốt lựa chọn cuối khi rời màn lúc lần ghi trước chưa xong; mở khối bằng `?khoi=` rồi Quay lại luôn về đúng danh sách, kể cả mở thẳng hay F5; web đổi `?khoi=` bằng History API, không tải lại RSC.

**F8, sửa nốt P15 (đường tiền và chữ).**
- Trần giảm của món mua kèm theo giá tham chiếu lúc tạo (cột mới `BundleItem.refPrice`). Giá phân loại tăng về sau không làm khoản giảm phình theo.
- Nhân viên không hưởng bộ do chính mình tạo (cùng luật mã giảm giá và Giờ vàng). ADMIN được miễn.
- Hai PATCH đồng thời không lách được trần nhân viên (kiểm lại nội dung sau khoá `FOR UPDATE`, mọi đọc trong khoá đi qua đúng kết nối của giao dịch).
- Khoản giảm không phụ thuộc thứ tự dòng trong giỏ, báo giá và đặt đơn. Giá mua kèm công khai và giá giỏ cùng đi qua `addonPayPrice`.
- Chữ "Tạm hết hàng" khác "Đã kết thúc". Mini giữ khối như web. Form admin báo đúng khoản giảm khi sửa giá kèm. Lời từ chối trần % nói đúng cơ sở ("so với giá lúc đặt giá kèm").
- Cuối đợt có thêm hai sửa sau review của F8: trần nhân viên của bộ ADDON tính trên giá tham chiếu giữ lại (không theo giá sale đang thấp hơn), và sửa bộ ADDON không đặt lại giá tham chiếu theo giá hiện tại.

**F8b, trần tiền nhân viên lúc tính tiền cho combo.** Chủ duyệt "sửa trước khi merge".
- Bất biến: tổng khoản giảm mỗi đơn nhờ các bộ do NHÂN VIÊN tạo không vượt `coupon.staff_max_amount_vnd` ở mọi đường (giỏ, báo giá, xem trước mã, đặt đơn), dù nhiều bộ, dù giá tăng sau khi lưu.
- "Nhân viên" là người tạo không được xác nhận là ADMIN (người tạo trống, tài khoản không còn hay vai trò khác đều bị kẹp). Bộ ADMIN không bị kẹp.
- Phần bị cắt rút theo thứ tự `variationId` tăng dần nên không phụ thuộc thứ tự dòng giỏ. Chỉ tra vai trò khi tổng thô vượt trần (một truy vấn).
- API công khai vẫn quảng cáo theo từng bộ; giỏ chỉ có thể thấp hơn tổng quảng cáo, không bao giờ cao hơn.

**F9, combo ở phần tĩnh của Trang chủ và chống trùng §5.**
- Kệ Combo chiếm các món của nó theo slug, nên Bán chạy nhất và Gợi ý hôm nay bỏ món đã nằm trong combo. Web đưa combo vào HTML đầu (`loadHomeInitial`), Mini giữ khung chờ Bán chạy nhất tới khi biết combo (có hạn chờ). Không thêm request.
- Lệch có chủ đích (cần chủ ký, mục 3): combo chỉ chiếm xuống dưới, không bị Giờ vàng hay Mua lại loại. Nên cùng một món có thể hiện ở Mua lại và trong combo. Lý do: Mua lại về sau khung chờ; nếu combo bị loại thì cả kệ combo biến mất khi Mua lại về và trang nhảy.

**F10a–F10d, sửa 18 P1 của bước chốt** (`review/final-critique.md`; P1 số 2 do phiên chính sửa).
- F10a, thẻ và hàng cuộn: Trang chủ web 375 không còn tràn ngang (vùng cuộn có `position: relative` ở hai app); tên món ở thẻ Giờ vàng một dòng; dòng meta thẻ hẹp đổi bản gọn không cắt giữa số (ngưỡng container 131.98px, chữ dài hơn 21 ký tự gắn `data-long`); ghi chú Giờ vàng đặt con số lên trước ("Tối đa 2/khách").
- F10b, giỏ và đầu trang (đường tiền, chỉ phần hiển thị): bốn trang Mini (Bán chạy nhất, Giờ vàng, Chiến dịch, Mã giảm giá) bỏ khoảng thừa đầu trang; một nguồn giá gạch cho thẻ, trang Giờ vàng và giỏ (`strikePrice`), "Tiết kiệm" khớp giá gạch đó; chân dính giỏ gọn (~140px, tổng và nút cùng hàng, đạt miễn phí giao chỉ còn một dòng chữ); gợi ý mã trong giỏ rút chữ. Số tiền khách trả không đổi (có spec).
- F10c, PDP web: thứ tự khối 375 giống Mini (Đánh giá nhanh sau Phân loại/Combo), nửa dưới làm theo Mini (thẻ trắng, nút, chip lọc đánh giá), chip phân loại có ⚡ cho món Giờ vàng, tiêu đề khối từ 1280 dùng Inter.
- F10d, Ưu đãi và mã: trình dựng web bỏ hàng đầu thừa ở chi tiết khối, nút "+ Thêm sản phẩm" rộng hết hàng; khối Giờ vàng ở Ưu đãi đếm ngược dạng chữ; "Mã của tôi" chỉ vẽ 3 phiếu + "Tất cả (n)"; thẻ Điểm danh gọn 156px, luật mở khi bấm; phiếu mã nhãn một dòng, một cách ghi số; Ưu đãi chưa đăng nhập có GuestLinkCard từng khối, giữ Đổi quà.
- Phiên chính, P1 số 2: Trang chủ web từ lg có banner thì thẻ thành viên và Việc cần làm xếp dọc trong cột 4 (cạnh nhau thì cắt hết số điểm và tên).

**P17b, bài kiểm chặn của cơ chế giữ khớp.** Không có gì để khách hay admin thấy.
- Bánh cóc số px và lớp `max-md:` (`scripts/uiux/ds-ratchet.mjs`, baseline `scripts/uiux/ds-baseline.json` chỉ được giảm) nối vào `pnpm lint:parity`. Ai thêm số px cứng hay `max-md:` mới thì đỏ; sửa bớt thì chạy `node scripts/uiux/ds-ratchet.mjs --write` để hạ baseline.
- `ds-shop-guard` hai app dùng luật chung (`scripts/uiux/ds-shop-rules.mjs`).
- e2e `ds-parity.shop.spec.ts` so computed style 375px của thành phần Mini và web với một bảng chuẩn chung.
- axe smoke 375px các màn mua sắm cả hai app (`a11y-shop.*.spec.ts`, axe-core 4.12.0, chỉ `serious`/`critical` chặn, vi phạm có sẵn ở `support/a11y-baseline.ts` kèm lý do). Web cần DB tạm có thương hiệu, sản phẩm, gian hàng công khai: `seedShopScreens()` tự seed; trên CI không seed được thì đỏ.

**Sửa của phiên chính trên nhánh tích hợp (không thuộc gói nào).**
- Hai race spec dùng chung một DB không còn đạp nhau: race danh mục tự dọn chỗ gốc (`withRootRoom` dùng chung, cả ca của F7b), và so mã có `title` (1f36e1a84, d1dd5ebf8).
- Flake `flash-sale.spec`: chờ dòng suất kế lâu hơn trên CI (1f36e1a84).
- e2e web theo trình dựng khối của P10 và phiếu mã của P14: web CTV tạo khối, chấm đỏ Ưu đãi (d5dd704ed).
- Lỗi tràn ngang 375px ở danh sách món trong khối (web); e2e `ctv-375` mở chi tiết khối (8bb5838a6).
- Flake `flash-sale.spec` gốc rễ: hai món "sắp diễn ra" dùng một mốc giờ chung, gọi `Date.now()` riêng từng món thì CI chậm lệch 1ms và đếm thành "1 món" (cf99f540f).
- Flake `edit-profile.spec` (Mini): đợi giá trị điền sẵn chứ không chỉ đợi ô (115024ef7).
- Các commit khác trong `git log 019e3d59d..HEAD` (script ops set-smtp và healthcheck, tài liệu review-1028, tối ưu Trang chủ R-16, `127de2c77`...) đến từ main và phiên khác, không thuộc bàn giao này.

## 2. Deploy (việc của chủ quyết)

Có 4 migration mới so với main (`git diff --name-only origin/main...HEAD -- apps/api/prisma/migrations`). Chạy theo đúng thứ tự tên, sau 2 migration đợt 4a (`20261101100000_campaigns`, `20261101100100_flash_item_sort_order`) nếu PROD chưa có.

1. `20261101110000_coupon_listed` (P14). Thêm hai cột vào bảng mã giảm giá: `listed` (mặc định false, nên mọi mã cũ vẫn ẩn khỏi kho) và `title`. Thêm chỉ mục. Thêm ràng buộc CHECK: mã chỉ được `listed` khi là loại CLAIM và không thuộc lô thẻ in. Rủi ro thấp: cột mới đều mặc định false nên không hàng nào vi phạm. Ràng buộc chặn ghi tay sai vào DB.
2. `20261101110100_product_category_ids_default` (P16). Câu UPDATE đổi `categoryIds` NULL thành mảng rỗng trên bảng sản phẩm, rồi đặt mặc định mảng rỗng. Lý do: sản phẩm tạo qua đường đồng bộ Pancake cũ mang NULL, lọc "chưa có danh mục" bỏ sót chúng. Rủi ro: UPDATE chạm các hàng NULL trong bảng sản phẩm (bảng nhỏ, khoá ngắn). Sau đó số "SP chưa có danh mục (n)" ở hộp việc admin có thể tăng, vì các sản phẩm NULL này nay được đếm. Không mất dữ liệu.
3. `20261101120000_bundles` (P15). Tạo kiểu `BundleKind` và hai bảng mới `bundles`, `bundle_items`, có khoá ngoại và chỉ mục. Có bốn ràng buộc CHECK: `pct` từ 1 đến 100, `endAt` sau `startAt`, `addonPrice` không âm, `maxQty` từ 1 đến 10. Rủi ro rất thấp: chỉ thêm bảng mới, rỗng. Bản ghi tay vi phạm sẽ bị DB từ chối.
4. `20261101130000_bundle_item_ref_price` (F8). Thêm cột `refPrice` vào `bundle_items`, backfill, rồi thêm CHECK `refPrice >= 0`. Backfill: món ADDON có ghim phân loại lấy giá đang bán của phân loại làm giá tham chiếu. Đây là giá hiện tại, không phải giá lúc tạo, vì không có dữ liệu cũ hơn. Chấp nhận được vì bộ chưa từng lên PROD, nên trên PROD bước này cập nhật 0 hàng. Món ADDON thiếu `refPrice` không giảm và không được quảng cáo. Nếu sau này ai ghi bộ trực tiếp vào DB thì phải ghi `refPrice`.

Cấu hình hệ thống mới: không có khoá nào bắt buộc nạp. `bundle.max_pct` (trần % của combo, mặc định 50 nằm trong mã `BUNDLE_MAX_PCT_DEFAULT`) và trần của nhân viên đọc từ cấu hình, chưa có thì dùng mặc định. P10 dùng `storefront.max_combo_pct` đã có từ trước, không thêm khoá. P16 dùng `catalog.category_tree`, là khoá advisory trong DB, không phải cấu hình. Khoá `flashsale.slots` của đợt 4a đã nạp lúc deploy 01/11.

Các việc chính cần nhớ khi deploy:
- Mini: entry 641 KB (giới hạn 700), tổng 2140 KB, vượt mốc cảnh báo 2048 từ trước (gate-P15).
- API thêm đường công khai `GET /products/:slug/bundles`, `GET /bundles/combos` (đã đưa vào `PUBLIC_GET_PATHS`, không chờ phiên) và `GET /coupons/collectable`. Kiểm khoá cache của proxy cho ba đường này giống lần `/categories`.
- `GET /home/me` bỏ khối `shippingOrders` (Trang chủ đã dùng `/orders/home-todo`). Thay đổi này đến từ main (#111, R-194), không phải từ #109; nhắc ở đây vì #109 gộp main đó. Bản Mini/web cũ còn chạy khi đang deploy có thể thiếu khối này, nên deploy API và web cùng lượt.
- F9: `GET /home` (phần tĩnh) có thêm `combos`. Bản app cũ bỏ qua khoá này, không vỡ.
- Các lỗi chữ trong plan đã qua `terminology.spec`; không cần làm gì thêm.

## 3. Việc của chủ sau deploy

- **Xếp danh mục 2 tầng (P16).** Vào admin, tab "Sản phẩm". Dựng tối đa 8 danh mục gốc, mỗi gốc tối đa 8 mục con. Gán sản phẩm vào mục lá. Hộp việc "SP chưa có danh mục (n)" cho biết còn bao nhiêu sản phẩm chưa gán. Khách chỉ thấy hub Danh mục đúng khi xong bước này.
- **Ảnh thật.** Ảnh chụp 375px trong `screens/` (P15, F8, các gói khác) là ảnh dựng từ dữ liệu giả. Cần ảnh sản phẩm, banner chiến dịch, ảnh combo thật để khối nhìn đúng như thiết kế.
- **Chạy `recompute-sold` (ghi PROD).** `POST /admin/products/recompute-sold` đặt lại số bán 30 ngày cho kệ Bán chạy nhất. Không chạy thì số này bằng 0 đến lần cron 03:00 kế tiếp. Chỉ chạy khi chủ cho phép; agent không tự chạy.
- **Nhập bộ combo và mua kèm đầu tiên** ở admin, mục "Combo và mua kèm". Tạo, thử trên điện thoại, kiểm giỏ.
- **Bật mã vào kho mã (P14).** Mã cũ đều đang ẩn. Mở từng mã muốn công khai, bật "Hiện ở mục Nhận mã" và nhập tên hiển thị.
- **Ký lệch §5 của F9 (mục 4, ý 1).** Một món có thể hiện ở cả Mua lại và trong combo. Nếu chủ muốn đúng §5 ở mức món thì phải đổi cách tải Mua lại (vào khung chờ chung), có giá CLS.
- **Hệ quả tiền cần biết:** combo toàn sàn làm giảm hoa hồng CTV (đúng quyết định Q15, nhưng là hệ quả tiền thật). Hai mục chính sách khác của P15 (nhân viên tự hưởng, giá tham chiếu cho mua kèm) đã sửa ở F8; trần nhân viên lúc tính tiền đã sửa ở F8b.

## 4. Rủi ro đã biết, giới hạn còn lại

1. **Chống trùng Trang chủ của combo (F9, lệch §5 ở mức món, chờ chủ ký).** Combo đã chiếm món khỏi Bán chạy nhất và Gợi ý hôm nay. Còn lệch: món trong combo vẫn có thể hiện ở Mua lại. Bán chạy nhất có thể tụt dưới 3 món nếu có 3–4 combo dựng từ món bán chạy (hiện chỉ 0–2 combo); việc sau là nâng `HOME_BEST_SELLER_LIMIT` (đợt 6).
2. **Trần nhân viên của combo lúc tính tiền: đã sửa ở F8b.** Không còn là rủi ro mở.
3. **Giới hạn của F8 ("giữ khối").** Khi API báo `addonsSoldOut` (sản phẩm chính hết hàng, danh sách mua kèm rỗng) thì không có mã bộ để đối chiếu, nên coi mọi bộ đang giữ là hết hàng.
4. **API công khai vẫn quảng cáo bộ cho chính nhân viên tạo** (cache chung). Giỏ chỉ giảm ít hơn quảng cáo, không bao giờ đắt hơn, giống Giờ vàng và mã giảm giá.
5. **Không có quota toàn cục cho combo.** Chặn rủi ro bằng `maxQty` tối đa 10 mỗi đơn và bộ do nhân viên hoặc ADMIN tạo tay, có hạn.
6. **Combo không áp cho dòng đang Giờ vàng** và bộ thiếu món vì món đó đang Giờ vàng thì không đủ bộ (cùng luật combo gian hàng). API công khai ẩn các bộ đó, không tra theo người mua, nên người đã hết suất cá nhân vẫn thấy bộ bị ẩn.
7. **PDP web sản phẩm Giờ vàng có bộ: CLS 0,0715** (không có bộ 0,0715 đến 0,0771: cú nhảy là thanh Giờ vàng của P12, không phải khối bộ). Còn dưới ngưỡng 0,1 nhưng sát. Mốc cũ 0,0957 ở đợt 4a chưa xử lý, nếu thanh Giờ vàng cao thêm thì phải tải Giờ vàng ở máy chủ làm `initialData` cho `pdp-extras.tsx`.
8. **`UpcomingFlashSales` chưa gắn vào Trang chủ nào** (F7a, Task 4). Thẻ chỉ có spec đơn vị. Việc đo bề rộng 112px lấy từ `TILE_METRICS.inset` và thẻ `flash` 128px, không có e2e 375px. Nếu gắn thẻ này vào Trang chủ sau này thì phải đo lại ở 375px.
9. **Trình dựng (P10).** Kiểu khối NORMAL hay COMBO khoá sau khi tạo vì API chưa nhận `kind` khi sửa.
10. **Ảnh 375px còn nợ từ 4a:** UI admin Giờ vàng và món hết hàng ở khung sắp mở.
11. **Đồng bộ Pancake và đường đối tác:** đường đối tác (`merchant.service`) không đi qua luật "chỉ gán vào mục lá" của P16 (ghi trong plan, giữ nguyên).
12. **Máy tải nặng sinh FAIL giả** ở vitest nặng và một spec jest. Ca CLS chập chờn là lỗi thật, xem "Bẫy môi trường" của `handoff-wave4a.md`.

13. **Giới hạn đo chữ thẻ (F10a).** Ngưỡng dòng meta gọn 131.98px đo với Inter 12px/500 (font đi kèm app). Đổi cỡ chữ meta hay chữ "Đã bán" thì phải đo lại; vitest khoá độ dài 21 ký tự của chữ xấu nhất.
14. **Ảnh "sau" của F10a, F10b, F10d chụp trước lượt sửa cuối** nên không phản ánh đúng bản cuối ở vài chỗ (ngưỡng meta, cỡ chữ tổng giỏ, "Tất cả (3)"). e2e đo vị trí và kích thước vẫn chạy trên bản cuối.

## 5. Việc sau (đợt 6, nhánh riêng sau khi #109 vào main)

- MINOR còn lại của F10 (chữ mã "Tặng 20k đồng", tên mã bị coi là nhắc lại mã, chấm đỏ Ưu đãi đánh dấu cả mã chưa vẽ, phiếu mã cao không đều, tổng giỏ 320px tràn với số lớn, `scroll-padding` giỏ chưa theo chiều cao chân dính thật, `cardPricing` chưa gọi thẳng `strikePrice`, link đánh giá web, tên đọc của "Tối đa n/khách").
- 38 P2 của `review/final-critique.md` (trừ những mục cần chủ quyết).
- `HOME_BEST_SELLER_LIMIT` theo số combo (F9).
