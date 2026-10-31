# Rà chữ giao diện (UX copy): gian hàng, sản phẩm, Giờ vàng, Ưu đãi

Ngày 2026-10-31, trên mã main 13536d955 (worktree `shop-redesign`). Chỉ đọc mã, không sửa mã sản phẩm. Làm theo skill `design:ux-copy`.

**Nguồn giọng và thuật ngữ đã chốt.** Dùng làm thước đo cho mọi đề xuất bên dưới:
- `design_handoff/specs/TUBU_TREE_DESIGN_BRIEF.md` §12: xưng "Bạn" và "Tubu", câu ≤ 12 từ, Việt thuần, giọng tích cực, không đổ lỗi cho khách.
- Cùng file, §3.2 "Tử tế hơn là khẩn cấp": không dùng đồng hồ đếm ngược màu đỏ, không viết "Chỉ còn 3 sản phẩm — Mua ngay!".
- Các spec đang chạy:
  - `apps/miniapp/src/i18n/terminology.spec.ts`: Q-26 dùng "Mã giảm giá", cấm "voucher"; Q13 viết "Huỷ, Xoá"; Q16 Việt hoá, cấm "Top" ở màn game.
  - `freeship-copy.spec.ts` (D6-17): chỉ viết "Miễn phí giao hàng", không viết "ship".
  - `ui-emoji.spec.ts`.

**Giới hạn của đợt rà.** Lúc rà, thư mục `screens/` chưa có ảnh. Mọi con số độ dài chữ ở dưới là ước tính theo cỡ chữ trong token, chưa đo trên ảnh chụp. Phải đo lại khi có ảnh 375px.

---

## Tóm tắt

1. Một khái niệm đang có nhiều cách gọi:
   - Thương hiệu được gọi 5 kiểu: Thương hiệu, Nhãn hàng, nhãn, Cửa hàng, nhà.
   - Ưu đãi có 3 kiểu: Ưu đãi, Khuyến mãi, Ưu đãi giờ vàng.
   - Hai cách ghi hạn dùng mã: "HSD" và "Dùng đến".
   - Hai câu khác nhau sau khi chép mã: một câu bảo "chọn", câu kia bảo "dán".
2. Chữ "Còn" đang mang hai nghĩa ngay trên cùng trang chi tiết sản phẩm. "Còn 2h 05m" là thời gian, "Còn 3 sản phẩm" là số lượng, hai dòng nằm sát nhau. Đồng hồ đếm ngược còn trộn đơn vị tiếng Anh ("h/m") với tiếng Việt ("ngày giờ").
3. Một số chữ quá dài cho thẻ 2 cột ở 375px:
   - Dòng sao và lượt bán "★ 4.8 (1.234) · Đã bán 1,2k+" chừng 27 ký tự, trong khi một dòng chỉ chứa khoảng 20.
   - Nhãn phủ khi hết hàng "Tạm hết — sẽ về sớm" gần chạm mép thẻ.
   - Web lại ghi "Hết hàng", tức đã lệch với Mini App.
4. Chữ đang bị chép tay ở nhiều nơi giữa Mini App và web, không có bài kiểm nào bắt giống nhau:
   - Hàm `couponLabel` có 4 bản, `formatSold` có 2 bản.
   - `home-text.ts` của web chỉ ghi chú "giữ y như vi.home", không có bài kiểm.
   - Các file trong phạm vi còn khoảng 41 dòng chữ viết thẳng trong mã ở Mini App và khoảng 50 dòng ở web.
5. Bốn chữ trong yêu cầu chức năng mới đụng luật đã chốt. Phải chốt lại trước khi làm:
   - "Freeship": D6-17 chỉ cho viết "Miễn phí giao hàng".
   - "Top": Q16 đã cấm.
   - "Yêu thích": trùng với tim lưu sản phẩm.
   - "Kho voucher": Q-26 đã cấm.
6. Giới hạn mua giá Giờ vàng của mỗi khách (`perUserLimit`) không hiện ở đâu. Khách chỉ biết khi bấm đặt hàng và nhận lỗi "Vượt giới hạn mua ưu đãi.".
7. Đề xuất cơ chế giữ chữ khớp về sau (mục D):
   - Một file chữ chung `packages/app-core/src/shop-copy.ts`.
   - Một spec bảng thuật ngữ cho cả hai nền tảng.
   - Một spec chặn chữ viết thẳng trong mã, chạy theo kiểu chốt chặn: chỉ được giảm, không được tăng.
   - Một spec ngân sách độ dài chữ cho thẻ 375px.

---

## A. Phát hiện trên mã hiện tại

### P1: nên sửa trong đợt này

**UC-01 · P1 · Thương hiệu, chi tiết sản phẩm, Danh mục, gian hàng (Mini App và web): một khái niệm có 5 cách gọi**

Bằng chứng:
- Mini App, `apps/miniapp/src/pages/brand-view.tsx`:
  - `:30` `PAGE_TITLE = 'Nhãn hàng'`
  - `:64` "Đã theo dõi nhãn 💚"
  - `:101-103` "Không tìm thấy nhãn hàng / Nhãn này…"
  - `:175` "Chia sẻ nhãn này"
  - `:293` "Câu chuyện thương hiệu"
  - `:329` tên khi chia sẻ `Cửa hàng ${b.name}`
- Mini App, `apps/miniapp/src/i18n/vi.ts`:
  - `:69` "Thương hiệu Việt"
  - `:422` "Xem trang nhãn hàng {brand}"
  - `:468` lọc "Thương hiệu"
  - `:632` "Nhãn hàng trên Tubu Tree"
- Mini App, `product-detail.tsx:964` "Cùng nhà {brand}".
- Mini App, `packages/app-core/src/home-copy.ts` journey "nhãn Việt".
- Web, `apps/web/src/app/brand/[slug]/`:
  - `page.tsx:25,27,133-134`
  - `not-found.tsx:12-18`
  - `brand-actions.tsx:56,58,109,165,171`

Vấn đề:
- Cùng một thực thể (route `/brand`) có 5 tên gọi.
- Chữ "nhãn" còn đang dùng cho "nhãn dán ngoài hộp" (`vi.ts:509`).
- Đợt này lại thêm "nhãn trên thẻ sản phẩm", nên "nhãn" sẽ mang ba nghĩa.
- "Cửa hàng {tên}" khi chia sẻ dễ bị hiểu là gian hàng.

Đề xuất:
- Một chữ duy nhất: **"Thương hiệu"**.
- Bảng đổi chữ:

  | Chữ hiện tại | Chữ mới |
  |---|---|
  | `PAGE_TITLE` | "Thương hiệu" |
  | Màn không tìm thấy | "Không tìm thấy thương hiệu" / "Thương hiệu này chưa mở hoặc liên kết đã cũ. Xem thương hiệu khác trong Danh mục nhé." |
  | "Đã theo dõi nhãn" | "Đã theo dõi thương hiệu" |
  | "Chia sẻ nhãn này" | "Chia sẻ thương hiệu này" |
  | Tên khi chia sẻ | "{tên} trên Tubu Tree" |
  | `viewBrand` | "Xem trang {brand}" |
  | `badgeBrand` | "Thương hiệu trên Tubu Tree" |
  | Dải ở chi tiết sản phẩm | "Cùng thương hiệu" (bỏ tên để khỏi xuống dòng với tên dài; tên đưa vào aria của "Xem tất cả") |
  | `journey.body` | "{n} thương hiệu Việt, từ nhiều vùng đất" |

- Thêm luật vào spec thuật ngữ (mục D2).

**UC-02 · P1 · Chi tiết sản phẩm (Mini App và web): "Còn" mang hai nghĩa, đơn vị đếm ngược trộn Anh–Việt, Mini App thiếu chữ "Giờ vàng"**

Bằng chứng:
- `product-detail.tsx:514` hiện `vi.flashSale.endsIn` → "Còn 2h 05m". Ngay dưới, `:527` hiện `vi.product.lowStock` → "Còn 3 sản phẩm".
- `packages/app-core/src/countdown-format.ts:13-15`: dưới 24 giờ ra "2h 05m", từ 24 giờ ra "1 ngày 3 giờ".
- Hàng Giờ vàng của Mini App chỉ có nhãn "-30%" (`product-detail.tsx:509-511`). Web có "⚡ Giờ vàng -30%" (`apps/web/src/components/flash-price.tsx:83`).
- Web còn viết thẳng "Còn {left}" ở `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx:158`.

Vấn đề:
- Liếc qua, khách không phân biệt được dòng nào là thời gian, dòng nào là số lượng.
- "h/m" là ký hiệu tiếng Anh, lệch với nhánh "ngày giờ" ngay trong cùng một hàm.
- Trên Mini App, khách không biết giá này là giá Giờ vàng.

Đề xuất:
- Giữ "Còn" chỉ cho số lượng. Đổi chữ đếm ngược:

  | Khoá | Chữ mới |
  |---|---|
  | `endsIn` | "Kết thúc sau {t}" |
  | `startsIn` | giữ "Bắt đầu sau {t}" |

- Tách hai cách ghi thời gian trong app-core:
  - `countdownClock(ms)` ra "02:05:33". Dùng ở trang Giờ vàng và hàng tiêu đề khối Trang chủ, kèm biểu tượng đồng hồ và aria "Kết thúc sau 2 giờ 5 phút".
  - `countdownText(ms)` ra "2 giờ 05 phút" (dưới 24 giờ) hoặc "3 ngày 4 giờ".
- Trên trang chi tiết Mini App, dùng đúng nhãn của thẻ: `Badge` có icon Zap, chữ "Giờ vàng -30%" (đã có ở `catalog-grid.tsx:39`).
- Xem quyết định E1 về đồng hồ nhảy từng giây.

**UC-03 · P1 · Thẻ sản phẩm 2 cột và kệ ngang (Mini App và web): dòng sao + lượt bán quá dài ở 375px**

Bằng chứng:
- `apps/miniapp/src/components/ui/product-tile.tsx:214-231` ghép ra "★ 4.8 (1.234) · Đã bán 1,2k+".
- Web lặp lại ở `apps/web/src/components/product-card.tsx:84-96`.
- `apps/miniapp/src/components/home/best-seller-rail.tsx:15-16` phải để dư `RAIL_TILE_EXTRA = 20` px vì thẻ thật cao hơn khung chờ.

Vấn đề:
- Ở 375px, thẻ rộng 165,5px, chữ được 145px. Chữ caption 13px chứa khoảng 20 ký tự một dòng.
- Chuỗi trên dài khoảng 27 ký tự, nên dòng xuống hàng và các thẻ cao lệch nhau. Kệ ngang 156px còn hẹp hơn.
- Thêm nữa, số sao ghi "4.8" (dấu chấm) trong khi "1,2k" dùng dấu phẩy, ngay trên cùng một dòng.

Đề xuất:
- Trên thẻ ghi "★ 4,8 · Đã bán 1,2k+": bỏ số lượt đánh giá (đã có ở trang chi tiết), dùng dấu phẩy thập phân.
- Dòng này giữ một hàng (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`).
- Nếu thiếu chỗ, bỏ phần sao trước, giữ "Đã bán".
- Đưa phần ghép chuỗi vào app-core, ví dụ `tileMetaLine(rating, sold)`, để hai nền tảng chỉ có một bản.

**UC-04 · P1 · Thẻ sản phẩm và kệ ngang: chữ hết hàng lệch giữa hai nền tảng và gần chạm mép thẻ**

Bằng chứng:
- Mini App: `product-tile.tsx:151` dùng `vi.product.outOfStock` → "Tạm hết — sẽ về sớm".
- Web bản Mini: `apps/web/src/components/mini/product-tile.tsx:153` viết thẳng cùng câu đó.
- Web: `product-card.tsx:42` ghi "Hết hàng".
- Các nơi khác lại dùng câu khác:
  - `vi.ts:378` "Tạm hết hàng"
  - `:239` "Sản phẩm đã hết hàng"
  - `:715` "Tạm hết hàng"

Vấn đề:
- Nhãn phủ chữ 13px đậm, đệm 12px mỗi bên, rộng khoảng 160px trên ảnh rộng 165px. Ở 360px, ở kệ "Mua lại" 148px và kệ Bán chạy 156px, nhãn sẽ xuống dòng.
- Câu "sẽ về sớm" là một lời hứa. Hàng đã ngừng bán thì câu này sai.

Đề xuất:

| Chỗ dùng | Chữ |
|---|---|
| Nhãn phủ trên thẻ (mọi nền tảng) | "Tạm hết hàng" (12 ký tự) |
| Trang chi tiết, khi sản phẩm còn bán | giữ "Tạm hết — sẽ về sớm" |
| Hàng đã ngừng bán | "Ngừng bán" |

Hai khoá trong `shopCopy.stock`: `outShort` và `outLong`.

**UC-05 · P1 · Danh mục (Mini App và web): "Giá giảm" dễ hiểu thành "đang giảm giá"**

Bằng chứng:
- `vi.ts:447-448` và `apps/web/src/lib/browse-text.ts:48-49`: "Giá tăng" / "Giá giảm".
- Hiện bằng chip ở `apps/miniapp/src/components/catalog/sort-chips.tsx:10-11`.

Vấn đề: lưới sản phẩm đầy nhãn "-30%", nên khách dễ đọc "Giá giảm" thành "hàng đang giảm giá" chứ không phải "xếp giá từ cao xuống thấp".

Đề xuất:

| Chip | Chữ hiển thị | aria |
|---|---|---|
| Giá tăng dần | "Giá thấp" | "Xếp giá từ thấp đến cao" |
| Giá giảm dần | "Giá cao" | "Xếp giá từ cao đến thấp" |

Hai chữ cùng độ dài với chữ cũ, chip không phình ra.

**UC-06 · P1 · Chi tiết sản phẩm, Thương hiệu, Ưu đãi (Mini App và web): chữ quanh mã giảm giá không thống nhất**

Bằng chứng:
- Câu báo sau khi chép mã:
  - Trang chi tiết: "Đã chép mã X — mã đã có sẵn trong ví, chọn ở bước thanh toán" (`product-detail.tsx:635`; web `pdp-extras.tsx:116`).
  - Trang thương hiệu: "Đã chép mã X — dán ở bước thanh toán" (`brand-view.tsx:224`; web `brand-actions.tsx:219`).
- Hạn dùng ghi "HSD {ngày}" (`components/loyalty/coupon-card.tsx:44`; web `uu-dai/page.tsx:72`), trong khi `vi.home.newGift.voucherExpires` ghi "Dùng đến {ngày}".
- Điều kiện đơn có 3 cách ghi: "Đơn từ" (`product-detail.tsx:661`), "· đơn từ" (`coupon-card.tsx:39`), "Cho đơn từ" (`vi.ts:95`).
- "mã giảm" bị viết cụt (`home-copy.ts` groupBuyHint; `product-detail.tsx:771`), trái với Q-26.

Vấn đề:
- "trong ví" dễ nhầm với Ví Tubu (ví tiền).
- Hai trang dặn hai thao tác khác nhau ("chọn" và "dán") cho cùng một việc.
- "HSD" là chữ quen dùng cho hạn của sản phẩm, không phải của mã.

Đề xuất:
- Thẻ mã ở trang chi tiết và trang thương hiệu dùng đúng hai nút của thẻ mã ở Ưu đãi: `couponUseCopy.use` "Dùng ngay" và `couponUseCopy.copy` "Sao chép". Không cần câu dặn dài nữa.
- Nếu vẫn giữ kiểu chạm để chép, câu báo là "Đã chép mã {code}. Bạn chọn mã ở bước thanh toán nhé."
- Hạn dùng ghi "Dùng đến {dd/mm}".
- Điều kiện ghi "Đơn từ {199k}", viết thường khi đứng sau dấu "·".
- Luôn viết đủ "mã giảm giá".
- Gộp 4 bản `couponLabel` thành một hàm trong app-core:
  - `apps/miniapp/src/pages/product-detail.tsx:98`
  - `apps/miniapp/src/components/loyalty/coupon-card.tsx:14`
  - `apps/web/src/app/uu-dai/page.tsx:36`
  - `apps/web/src/lib/pdp-logic.ts:23`

**UC-07 · P1 · Giờ vàng, thanh toán: khách không biết giới hạn mua mỗi người, lỗi thì cụt lủn**

Bằng chứng:
- `apps/api/prisma/schema.prisma:815` có `perUserLimit`, nhưng chữ này không hiện ở màn khách nào.
- Đặt quá giới hạn thì `checkout.service.ts:483` trả lỗi `FLASH_OVER_LIMIT_MSG = 'Vượt giới hạn mua ưu đãi.'` (`flash-sale.service.ts:16`).
- Hết suất thì trả `'Hết suất ưu đãi.'` (`:15`).

Vấn đề: khách bị chặn ở bước cuối. Câu lỗi không nói giới hạn là bao nhiêu và không nói phải làm gì.

Đề xuất:
- Ở trang chi tiết và thẻ trang Giờ vàng, thêm dòng "Mỗi khách tối đa {n}".
- Câu lỗi cho khách:
  - Quá giới hạn: "Giá Giờ vàng chỉ áp cho {n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé."
  - Hết suất: "Suất Giờ vàng vừa hết, sản phẩm về giá thường. Bạn xem lại giỏ nhé."
- API phải trả kèm `n`, cần sửa máy chủ.

**UC-08 · P1 · Chi tiết sản phẩm và giỏ (chuẩn bị cho chức năng mới): "Thường mua kèm" sẽ đụng "Mua kèm giảm giá"**

Bằng chứng: `product-detail.tsx:943` và web `pdp-rails.tsx:66` có dải "Thường mua kèm". Dải này chỉ gợi ý những món hay được mua cùng, không giảm giá.

Vấn đề: chức năng 4 thêm "mua kèm giảm giá". Hai khối cùng chữ "mua kèm" nhưng một khối có giảm giá, một khối không.

Đề xuất:
- Đổi tên dải cũ thành "Khách thường mua cùng".
- Giữ chữ "Mua kèm" chỉ cho ưu đãi giảm giá (mục B7).

**UC-09 · P1 · Chữ dùng chung (cơ chế): chữ chép tay, đã bắt đầu lệch**

Bằng chứng:
- `vi.ts:4` ghi "KHÔNG hard-code chuỗi trong JSX", nhưng không có spec nào kiểm.
- Các file trong phạm vi còn khoảng 41 dòng chữ tiếng Việt viết thẳng ở Mini App (home, browse, product-detail, storefront-view, brand-view, offers, flash-sale, best-seller-rail) và khoảng 50 dòng ở web (brand, s/[slug], uu-dai, pdp-*, product-card, flash-price).
- `apps/web/src/lib/home-text.ts:3` chỉ ghi chú "giữ y như vi.home". Chỗ đã lệch: "Hết hàng" ở UC-04, "Đã có lỗi xảy ra — Vui lòng thử lại" ở `home-text.ts:34`.
- `formatSold` có 2 bản: `miniapp/src/utils/format.ts:63` và `web/src/lib/api.ts:445`.

Đề xuất: xem mục D.

### P2: tinh chỉnh

**UC-10 · P2 · Khối Giờ vàng ở Trang chủ: cách viết hoa và tiêu đề**

Bằng chứng:
- `vi.ts:118-119` và `home-text.ts:70` ghi "Ưu đãi giờ vàng". Nhãn thẻ lại ghi "Giờ vàng". `vi.ts:123` có "sản phẩm giờ vàng", `:693` có "Giá giờ vàng".
- `flash-sale.tsx:310` dùng tiêu đề "Sắp diễn ra" đứng một mình.
- Chữ viết thẳng: `:314` "Sắp diễn ra", `:182` "Tỉ lệ đã bán". Web dùng `soldPct` làm aria.

Vấn đề:
- "Giờ vàng" là tên chương trình, giống "Điểm Xanh" hay "Vườn Xanh", nhưng đang lúc viết hoa lúc không.
- "Ưu đãi giờ vàng" dài 15 ký tự. Cộng nhãn đếm ngược và nút "Xem tất cả" sẽ thêm khi có trang riêng, hàng tiêu đề khoảng 340px, tràn ở 320–360px.
- "Sắp diễn ra" không nói cái gì sắp diễn ra.

Đề xuất:
- Tiêu đề khối là "Giờ vàng".
- Luôn viết hoa "Giờ vàng".
- Khối chờ mở bán là "Giờ vàng sắp tới".
- Đưa hai chữ đang viết thẳng vào bộ chữ chung.

**UC-11 · P2 · Lưới gợi ý ở Trang chủ: tiêu đề và chip lặp ý**

Bằng chứng:
- `home-copy.ts` có `suggest.title` "Gợi ý cho bạn" và câu hết danh sách "Bạn đã xem hết gợi ý hôm nay".
- `home-layout.ts:308-312` có các chip "Cho bạn", "Bán chạy", "Mới".

Vấn đề:
- "Gợi ý cho bạn" rồi lại chip "Cho bạn" là lặp.
- Câu hết danh sách nói "hôm nay" nhưng tiêu đề thì không.
- Chip "Mới" trùng chữ với nhãn "Mới" trên thẻ. Danh mục lại gọi cách xếp này là "Mới nhất".

Đề xuất: tiêu đề "Gợi ý hôm nay"; các chip "Dành cho bạn" / "Bán chạy" / "Mới nhất" (xem B4). Lỗi R-92 (khối trống) đã có trong backlog, không ghi lại.

**UC-12 · P2 · Kệ "Mua lại" ở Trang chủ: nút "Xem tất cả" dẫn tới danh sách đơn**

Bằng chứng: `components/reorder/purchased-rail.tsx:113-119` ghi "Xem tất cả" nhưng mở `/orders?tab=delivered`. Khoá `homeCopy.reorder.seeAll` "Xem đơn hàng" có sẵn mà chưa dùng. Nút cũng thiếu aria (kệ Bán chạy thì có).

Đề xuất: dùng "Xem đơn hàng", aria "Xem đơn đã giao".

**UC-13 · P2 · Gian hàng, dựng gian hàng, chi tiết sản phẩm: lệch giọng thương hiệu**

Bằng chứng:
- `apps/miniapp/src/components/storefront-pickers.tsx:18`: "chúng tôi tự thêm sẵn 8 sản phẩm nổi bật". Brief cấm xưng "chúng tôi"; API thật ra lấy *tối đa* 8 (`storefront.service.ts:522,535`).
- "Vui lòng": `vi.ts:123`, `:255-256`, `home-text.ts:34`.
- `storefront-builder.tsx:952` "Đã lưu cấu hình gian hàng!", trong khi tiêu đề `:47` là "Cài đặt gian hàng".
- `:977` "Subdomain riêng".
- `packages/app-core/src/storefront-signup.ts:47` "…gian hàng như này?".

Đề xuất:

| Chữ hiện tại | Chữ mới |
|---|---|
| Lời dặn khi chọn mẫu | "Chọn danh mục gần với sản phẩm bạn muốn giới thiệu. Tubu thêm sẵn tối đa 8 sản phẩm bán chạy, bạn sửa lúc nào cũng được." |
| `priceChangedBody` | "Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ. Bạn xem lại giỏ trước khi đặt nhé." |
| `overStock` | "{tên} chỉ còn {n} sản phẩm. Bạn sửa số lượng trong giỏ nhé." / "{tên} đã hết hàng. Bạn bỏ khỏi giỏ để đặt các món còn lại nhé." |
| Câu báo lưu | "Đã lưu cài đặt gian hàng" |
| "Subdomain riêng" | "Tên miền riêng" |
| Câu mời mở gian hàng | "Bạn cũng muốn có gian hàng như thế này?" |

**UC-14 · P2 · Trang thương hiệu: tiêu đề "Khuyến mãi" và chữ chép mã**

Bằng chứng: `brand-view.tsx:203` (web `page.tsx:113`) ghi "Khuyến mãi"; `:246` "chạm để chép"; `:156` "{b.followerCount} người theo dõi" chưa định dạng số, nên 1200 hiện ra "1200".

Đề xuất:
- Đổi tiêu đề thành "Mã giảm giá", vì khối này đúng là danh sách mã (Q-26).
- Nút dùng "Sao chép" như ở mục Ưu đãi.
- Số người theo dõi đi qua `formatNumber` ("1.200 người theo dõi").

**UC-15 · P2 · Định dạng số**

Bằng chứng: điểm sao ghi "4.8":
- `product-tile.tsx:219`
- `product-detail.tsx:492`
- web `product-card.tsx:88`
- web `pdp-sections.tsx:27`

Trong khi đó, "1,2k" và "3,5%" dùng dấu phẩy.

Đề xuất: thêm `formatRating` trong app-core (một chữ số lẻ, dấu phẩy) và dùng ở mọi nơi.

**UC-16 · P2 · Ưu đãi, chi tiết sản phẩm: tên của đăng nhập, mua chung và chat chưa thống nhất**

Bằng chứng:
- Đăng nhập: `offers.tsx:105` "Đăng nhập ngay", `vi.auth.loginCta` "Tiếp tục với Zalo" (đúng brief §12.2), `homeCopy.profile.guestCta` "Liên kết Zalo".
- Mua chung: `offers.tsx:95` và web `uu-dai/page.tsx:131` "Mua chung nhóm"; lối tắt "Mua chung"; thẻ cũ "Mua chung giá tốt".
- Chat: `vi.ts:147` và web `pdp-extras.tsx:337,352` "Chat với Tubu Tree"; `vi.ts:517` "Nhắn Tubu Tree".

Đề xuất:

| Việc | Chữ |
|---|---|
| Khách vãng lai đăng nhập | "Tiếp tục với Zalo" |
| Tài khoản khách cần liên kết | "Liên kết Zalo" |
| Mua chung | "Mua chung" ở mọi nơi |
| Chat | Chọn một: "Nhắn Tubu Tree" (Việt thuần, ngắn hơn). Chủ có thể giữ "Chat" nếu muốn. |

**UC-17 · P2 · Toàn bộ: dấu ba chấm và chữ "Chỉ còn"**

Bằng chứng:
- Dấu ba chấm: `vi.ts:15`, `:289`, `:423` dùng "..."; `:645`, `:677`, `:692` dùng "…".
- `vi.ts:238` `stockLimited` "Chỉ còn {n} sản phẩm". Đây đúng là mẫu câu brief §3.2 lấy làm ví dụ cấm.

Đề xuất:
- Chỉ dùng "…".
- Đổi thành "Còn {n} sản phẩm", giống `vi.product.lowStock`.

**UC-18 · P2 · Chi tiết sản phẩm: câu quá 12 từ**

Bằng chứng:
- `product-detail.tsx:562` và `:581`: "…chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.", khoảng 22 từ. Câu ở `:562` còn mở đầu vụng: "Hàng gian hàng tự giao".
- `:771` "Mở nhóm mua chung — nhận mã giảm khi đủ người".

Đề xuất:

| Câu hiện tại | Câu mới |
|---|---|
| Câu hàng đối tác | "Hàng đối tác: chỉ giá lẻ, không dùng Điểm Xanh." Ý "không đặt định kỳ / mua chung" thì ẩn nút đi thay vì viết ra. |
| Nút mua chung | "Mở nhóm mua chung" |
| Dòng phụ dưới nút mua chung | "Đủ {n} người, mỗi người nhận mã giảm giá {x}" (đã có `groupBuyPitch`) |

**UC-19 · P2 · Thanh báo đang ở gian hàng (vào từ /s/:slug)**

Bằng chứng: `vi.ts:647` "Đang xem cửa hàng" và `:648` "⤺ Về Tubu Tree", hiện ở `storefront-context-bar.tsx:32,41`.

Vấn đề:
- "cửa hàng" là chữ thứ ba cho cùng ý (đã có gian hàng, thương hiệu).
- Thanh này không nói đang ở gian hàng nào.
- Ký tự ⤺ viết thẳng vào chữ thay vì dùng icon.

Đề xuất:
- Đổi chữ theo loại (`kind`) trong `storefront-context`:
  - ctv / partner: "Bạn đang ở gian hàng"
  - brand: "Bạn đang xem thương hiệu"
- Tốt nhất là lưu thêm tên gian hàng để ghi "Gian hàng {tên}" (một dòng, cắt "…" nếu dài).
- Nút ghi "Về Tubu Tree", kèm icon lucide `Undo2`.

**UC-20 · P2 · Trang gian hàng: chữ lệch giữa web và Mini App**

Bằng chứng: web `s/[slug]/page.tsx:238-251` có khối "Cam kết của gian hàng" gồm 3 dòng, và `:273` ghi "({n} sản phẩm)" cạnh tên bộ sưu tập. Mini App `storefront-view.tsx` không có hai thứ này.

Đề xuất:
- Đưa 3 dòng cam kết vào `shopCopy.storefront` và hiện ở cả hai nền tảng.
- Số sản phẩm của bộ sưu tập hiện ở cả hai, dạng "{n} sản phẩm" màu chữ phụ.

**UC-21 · P2 · Khoá chữ không còn dùng trong vi.ts và home-text.ts**

Bằng chứng: quét `vi.home.*`, `vi.storefront.*`, `vi.product.*` thấy khoảng 30 khoá không còn màn nào dùng:
- `home.featured`, `forYou`, `newArrivals` ("Mới về vườn"), `bestSellers`, `heroKicker`, `heroTitle`, `heroCta`, `aiCard`, `groupBuyCard`, `brandsTitle`, `allBrands`, `strip`…
- `storefront.pinTop`, `hide`, `show`, `publish`, `statusDraft`…

Bản sao bên web ở `home-text.ts:7-25`.

Vấn đề: người làm sau dễ nhặt lại chữ cũ. Ví dụ "Mới về vườn" từng gây nhầm với Vườn Xanh (A2-33).

Đề xuất: xoá trước khi thêm bộ chữ mới, và nới `vi-dead-keys.spec.ts` để quét cả các mục này.

**UC-22 · P2 · Danh mục: câu trống khi chỉ lọc lại nhắc "từ khoá"**

Bằng chứng: `browse.tsx:282-283` kết hợp với `vi.ts:427`. Khi chỉ lọc mà không gõ tìm, màn vẫn hiện "Thử từ khoá khác hoặc bỏ bớt bộ lọc".

Đề xuất: khi không có từ khoá, ghi "Bỏ bớt bộ lọc để xem thêm sản phẩm".

---

## B. Bộ chữ cho chức năng mới

Mọi khoá dưới đây đặt trong `packages/app-core/src/shop-copy.ts` (mục D1). Cột "Tối đa" là số ký tự để vừa chỗ ở 375px (cách tính ở mục C).

### B1. Giờ vàng (flash sale theo khung giờ)

| Khoá | Chữ | Chỗ dùng | Tối đa |
|---|---|---|---|
| `flash.title` | Giờ vàng | Tiêu đề khối Trang chủ và tiêu đề trang | 12 |
| `flash.seeAll` | Xem tất cả | Hàng tiêu đề khối; aria "Xem tất cả Giờ vàng" | 10 |
| `flash.slotLive` | Đang diễn ra | Dòng dưới giờ trên tab khung, ví dụ "12:00 / Đang diễn ra" | 12 |
| `flash.slotNext` | Sắp diễn ra | Tab khung kế tiếp | 12 |
| `flash.slotTomorrow` | Ngày mai | Khung của ngày sau | 12 |
| `flash.slotEnded` | Đã kết thúc | Khung đã qua (nếu cho xem) | 12 |
| `flash.endsIn(t)` | Kết thúc sau {t} | Trang Giờ vàng, trang chi tiết; t = "02:05:33" | 22 |
| `flash.startsIn(t)` | Bắt đầu sau {t} | Giữ chữ cũ | 22 |
| `flash.startsAt(time, day?)` | Mở lúc {12:00} / Mở lúc {12:00 ngày 02/11} | Thẻ của khung mở sau hơn 24 giờ (giờ cụ thể dễ hiểu hơn đếm ngược) | 22 |
| `flash.badge(pct)` | Giờ vàng -{pct}% | Nhãn trên ảnh (đã có), icon Zap | 14 |
| `flash.justOpened` | Vừa mở bán | Thay thanh tiến độ khi mới bán 0% | 16 |
| `flash.soldPct(n)` | Đã bán {n}% | Từ 1% đến 79% | 16 |
| `flash.almostGone` | Sắp hết suất | Từ 80% trở lên và còn hơn 10 suất | 16 |
| `flash.left(n)` | Còn {n} suất | Còn ≤ 10 suất; ghi đúng số, không thêm câu giục mua | 16 |
| `flash.soldOut` | Đã hết suất | 100%: thẻ mờ, nút khoá, sản phẩm về giá thường | 16 |
| `flash.limit(n)` | Mỗi khách tối đa {n} | Trang chi tiết và thẻ trang Giờ vàng (UC-07) | 20 |
| `flash.buy` | Mua ngay | Nút trên thẻ trang Giờ vàng (cùng chữ với nút ở trang chi tiết) | 12 |
| `flash.remind` / `flash.reminded` | Nhắc tôi / Đã đặt nhắc | Giữ; aria khi đã đặt: "Bỏ nhắc {tên sản phẩm}" | 12 |
| `flash.remindedToast(time)` | Tubu sẽ nhắc bạn lúc {12:00} | Báo sau khi đặt nhắc | — |
| `flash.unremindToast` | Đã bỏ nhắc | | — |
| `flash.emptyTitle` | Chưa có Giờ vàng lúc này | Trang không có khung nào | — |
| `flash.emptyBody` | Khung giờ tiếp theo sẽ hiện ở đây. | | — |
| `flash.emptyCta` | Xem sản phẩm khác | Dẫn tới /browse | 18 |
| `flash.endedTitle` | Khung giờ này đã kết thúc | Mở từ thông báo cũ | — |
| `flash.endedCta` | Xem khung giờ tiếp theo | | 22 |
| `flash.priceChangedBody` | Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ. Bạn xem lại giỏ trước khi đặt nhé. | Thay `vi.ts:123` | — |
| `flash.overLimitError(n)` | Giá Giờ vàng chỉ áp cho {n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé. | Lỗi từ API (UC-07) | — |
| `flash.soldOutError` | Suất Giờ vàng vừa hết, sản phẩm về giá thường. Bạn xem lại giỏ nhé. | | — |
| `flash.notifyStart` | {Tên sản phẩm} đang có giá Giờ vàng tới {14:00}. | Thông báo cho khách đã đặt nhắc | — |

Ghi chú:
- Không dùng "Flash sale", "HOT", "SỐC", "Nhanh tay", không viết hoa cả chữ, không dùng dấu "!" (brief §3.2).
- Màu đếm ngược dùng tông promo, không dùng đỏ nguy hiểm.

### B2. Bán chạy nhất (bảng xếp hạng theo danh mục)

| Khoá | Chữ | Chỗ dùng | Tối đa |
|---|---|---|---|
| `rank.title` | Bán chạy nhất | Tiêu đề trang bảng xếp hạng; khối Trang chủ giữ "Bán chạy" | 16 |
| `rank.basis` | Theo lượt bán 30 ngày qua | Dòng phụ dưới tiêu đề. Chỉ ghi khi dữ liệu đúng là 30 ngày; nếu là tổng từ trước tới nay thì ghi "Theo tổng lượt bán" | 28 |
| `rank.tabAll` | Tất cả | Tab đầu; các tab sau là tên danh mục có sẵn | — |
| `rank.position(n)` | (chỉ hiện số "1", "2", "3"… trong dải ruy-băng) | aria: "Hạng {n} bán chạy" | 3 |
| `rank.sold` | dùng `formatSold`: "Đã bán 1,2k+" | | 16 |
| `rank.seeAll` | Xem tất cả | Từ khối Trang chủ sang trang xếp hạng | 10 |
| `rank.emptyTitle` | Chưa đủ lượt bán để xếp hạng | Danh mục ít đơn | — |
| `rank.emptyCta` | Xem sản phẩm trong danh mục | | 26 |

Vì sao không dùng "Top bán chạy": xem E2.

### B3. Nhãn trên thẻ sản phẩm

Luật chung:
- Trên ảnh tối đa 2 nhãn, xếp theo thứ tự ưu tiên: Giờ vàng hoặc -% (chỉ hiện một trong hai), rồi "Tubu chọn", rồi "Mới".
- Dưới giá tối đa 1 dòng, ưu tiên "Miễn phí giao hàng" rồi tới "Có combo".
- Không gắn nhãn khi điều kiện không đúng cho riêng sản phẩm đó.

| Nhãn | Chữ | Vị trí | Điều kiện | Tối đa |
|---|---|---|---|---|
| Giờ vàng | ⚡ Giờ vàng -{n}% | Ảnh, góc trái trên | Đang có suất chạy (đã có) | 14 |
| Giảm giá | -{n}% | Ảnh, góc trái trên | `salePct` ≥ 1 (đã có) | 5 |
| Mới | Mới | Dưới nhãn giảm giá | 30 ngày, sau `launch_date` (đã có) | 4 |
| Tubu chọn | Tubu chọn | Ảnh, thay chỗ "Mới" khi đã đủ 2 nhãn | Quản trị gắn tay. Khớp chữ "Tubu chọn cho bạn" đã có. | 10 |
| Được yêu thích | Được yêu thích | Ảnh | Ví dụ ≥ 4,8★ và ≥ 20 đánh giá, ngưỡng do chủ chốt (xem E4) | 14 |
| Miễn phí giao hàng | (icon Truck) Miễn phí giao hàng | Dòng dưới giá, chữ caption tông thương hiệu | Chỉ khi riêng sản phẩm này được miễn phí, tức giá ≥ ngưỡng miễn phí hoặc có cấu hình miễn phí riêng. Ngưỡng tính theo cả đơn thì KHÔNG gắn (xem E3). | 18 |
| Có combo | Có combo | Dòng dưới giá | Sản phẩm nằm trong combo đang chạy | 9 |
| Sao + đã bán | ★ 4,8 · Đã bán 1,2k+ | Dòng trên giá | UC-03 | 20 |
| Hết hàng | Tạm hết hàng | Nhãn phủ giữa ảnh | UC-04 | 12 |
| Sắp hết | (không gắn trên thẻ) | — | Brief §3.2. Trang chi tiết đã có "Còn {n} sản phẩm" | — |

### B4. Gợi ý hôm nay (lưới cuộn vô tận)

| Khoá | Chữ | Ghi chú |
|---|---|---|
| `suggest.title` | Gợi ý hôm nay | Thay "Gợi ý cho bạn" |
| `suggest.tabs` | Dành cho bạn · Bán chạy · Mới nhất | Thay "Cho bạn · Bán chạy · Mới" (UC-11) |
| `suggest.guestHint` | Đăng nhập để có gợi ý hợp với bạn | Khách vãng lai ở chip "Dành cho bạn"; nút "Tiếp tục với Zalo" |
| `suggest.loadingMore` | Đang tải thêm… | Chỉ cho trình đọc màn hình (`aria-live`); trên màn hình chỉ hiện khung chờ |
| `suggest.loadMoreFailed` | Chưa tải thêm được. | Kèm nút "Thử lại" |
| `suggest.more` | Xem thêm | Giữ; nút dự phòng khi máy không đo được cuộn |
| `suggest.end` | Bạn đã xem hết gợi ý hôm nay | Giữ; thêm nút "Xem Danh mục" |

### B5. Banner chiến dịch và trang chiến dịch

| Khoá | Chữ | Ghi chú |
|---|---|---|
| `campaign.carouselLabel` | Chương trình nổi bật | aria của vùng banner |
| `campaign.slideLabel(title, i, n)` | {tiêu đề}, {i} trên {n} | aria từng ảnh |
| `campaign.dot(i)` | Xem chương trình {i} | aria của chấm |
| `campaign.pause` / `campaign.play` | Dừng tự chuyển / Tự chuyển tiếp | Nút bắt buộc cho a11y khi ảnh tự chạy |
| `campaign.dateRange(a, b)` | Từ {01/11} đến {11/11} | Dòng phụ trang chiến dịch |
| `campaign.status` | Đang diễn ra / Sắp diễn ra / Đã kết thúc | Dùng chung với `flash.slot*` |
| `campaign.sectionCoupons` | Mã giảm giá của chương trình | |
| `campaign.sectionFlash` | Giờ vàng trong chương trình | |
| `campaign.sectionProducts` | Sản phẩm trong chương trình | |
| `campaign.notStarted(when)` | Chương trình mở lúc {00:00 ngày 11/11} | Kèm nút "Nhắc tôi" |
| `campaign.endedTitle` | Chương trình đã kết thúc | |
| `campaign.endedBody` | Cảm ơn bạn đã ghé. Xem các ưu đãi đang có nhé. | Nút "Xem ưu đãi" dẫn tới /offers |
| `campaign.notFound` | Không tìm thấy chương trình này | Nút "Xem ưu đãi" |
| `campaign.share` | Chia sẻ chương trình | |

Luật cho chữ quản trị nhập (kiểm ở form, có bộ đếm ký tự):
- Tiêu đề banner ≤ 28 ký tự, dòng phụ ≤ 40, nút ≤ 12.
- Chữ trên nút bắt đầu bằng động từ: "Xem ưu đãi", "Nhận mã", "Xem combo".
- Không viết hoa cả chữ, không "!!!", không emoji, không "SỐC/HOT/Nhanh tay".

### B6. Mã giảm giá gom một chỗ (thay "Kho voucher")

Tên trang và mục: **"Mã giảm giá"**. Q-26 cấm chữ "voucher" và cấm "Kho voucher" (`terminology.spec.ts:51-54`).

Các tab:
- "Nhận mã": mã công khai, bấm để lưu.
- "Mã của tôi": mã đã lưu và còn dùng được. Lối tắt "Mã của tôi" đã có.
- "Đã dùng/hết hạn".

| Khoá | Chữ | Ghi chú |
|---|---|---|
| `coupon.value` | Giảm {30k} · Giảm {10%}, tối đa {50k} · Miễn phí giao hàng · Giảm {15k} phí giao hàng | Một hàm duy nhất thay 4 bản `couponLabel` (UC-06) |
| `coupon.minOrder(min)` | Đơn từ {199k} | Viết thường khi đứng sau "·" |
| `coupon.scope` | Mọi sản phẩm · Cho sản phẩm {thương hiệu} · Cho {n} sản phẩm | "Cho {n} sản phẩm" mở danh sách sản phẩm |
| `coupon.expires(date)` | Dùng đến {31/12} | Thay "HSD" |
| `coupon.expiresToday` | Hết hạn hôm nay | Thay "Sắp hết hạn" khi còn dưới 24 giờ |
| `coupon.expiresInDays(n)` | Còn {n} ngày | Khi còn ≤ 3 ngày; cùng điều kiện với `isCouponExpiring` |
| `coupon.usesLeft(n)` | Còn {n} lượt | Mã có giới hạn lượt toàn hệ thống; chỉ ghi số |
| `coupon.save` / `coupon.saved` | Lưu mã / Đã lưu | Ghi "Lưu mã", không ghi "Lưu" trơn, để khỏi nhầm với nút Lưu của form |
| `coupon.use` | Dùng ngay | Đã có `couponUseCopy.use` |
| `coupon.copy` | Sao chép | Đã có |
| `coupon.needMore(x)` | Mua thêm {50k} để dùng | Giỏ chưa đủ điều kiện; câu tích cực |
| `coupon.outOfQuota` | Đã hết lượt | Nút khoá |
| `coupon.expired` / `coupon.used` | Đã hết hạn / Đã dùng | Tab "Đã dùng/hết hạn" |
| `coupon.savedToast` | Đã lưu vào Mã của tôi | |
| `coupon.loginToSave` | Đăng nhập để lưu mã nhé | Nút "Tiếp tục với Zalo" |
| `coupon.detailTitle` | Điều kiện dùng mã | Tấm chi tiết |
| `coupon.detailLines` | Đơn tối thiểu: {199.000đ} · Giảm tối đa: {50.000đ} · Áp dụng cho: {…} · Hạn dùng: đến 23:59 ngày {31/12/2026} · Mỗi khách dùng {n} lần | Số đầy đủ ở tấm chi tiết; số rút gọn chỉ ở thẻ |
| `coupon.emptyMineTitle` | Bạn chưa có mã nào dùng được | Thay "Chưa có mã giảm giá khả dụng" ("khả dụng" là Hán Việt, khô) |
| `coupon.emptyMineBody` | Lưu mã ở mục Nhận mã, hoặc đổi Điểm Xanh lấy mã ở Đổi quà. | Nút "Nhận mã" |
| `coupon.emptyClaimTitle` | Hôm nay chưa có mã mới | Nút "Xem Giờ vàng" (nếu đang có) hoặc "Xem sản phẩm" |

### B7. Combo và mua kèm giảm giá

| Khoá | Chữ | Chỗ dùng |
|---|---|---|
| `combo.title` | Combo tiết kiệm | Tiêu đề khối ở trang chi tiết |
| `combo.rule(n, pct)` | Mua {2} giảm {5%} | Mỗi bậc một chip |
| `combo.total(price, save)` | Tổng {price} · Tiết kiệm {save} | Dưới danh sách món |
| `combo.add` | Thêm combo vào giỏ | Nút rộng hết khối |
| `combo.tileTag` | Có combo | Nhãn dưới giá (B3) |
| `combo.cartHint(n, pct)` | Thêm {n} sản phẩm nữa để giảm combo {pct} | Dòng nhắc trong giỏ |
| `combo.cartReached(x)` | Đã đủ combo, giảm {x} | |
| `combo.cartLost` | Combo chưa đủ món nên chưa giảm | Khi xoá bớt món |
| `combo.cartLine` | Giảm giá combo | Đã có `vi.cart.comboDiscount` |
| `addon.title` | Mua kèm giá ưu đãi | Khối ở trang chi tiết và giỏ |
| `addon.price(p)` | Giá mua kèm {39k} | Dưới tên món kèm |
| `addon.condition(name)` | Chỉ khi mua cùng {tên sản phẩm chính} | Cắt 1 dòng |
| `addon.add` / `addon.added` | Thêm / Đã thêm | Nút nhỏ |
| `addon.cartLine` | Ưu đãi mua kèm | Dòng tổng tiền ở giỏ |
| `addon.lost(name)` | Đã bỏ giá mua kèm vì {tên} không còn trong giỏ | Báo trong giỏ |
| `pdp.boughtTogether` | Khách thường mua cùng | Đổi tên dải cũ "Thường mua kèm" (UC-08) |

### B8. Chữ màn quản trị (gọn)

**Giờ vàng.** Admin đã gọi là "đợt giờ vàng" (`apps/web/src/app/admin/page.tsx:3130-3225`), nên đổi sang "Đợt Giờ vàng". Các trường:
- "Khung giờ (bắt đầu – kết thúc)"
- "Giá Giờ vàng"
- "Số suất"
- "Mỗi khách mua tối đa"
- Gợi ý dưới ô: "Khách thấy dòng 'Mỗi khách tối đa {n}' ở trang sản phẩm."

**Câu báo lỗi của API cho nhân viên.** Ví dụ `flash-sale.service.ts:18-20`: đổi "flash sale" thành "Giờ vàng" để cùng một tên với màn khách.

**Bảng xếp hạng.** "Khoảng tính lượt bán: 7 / 30 / 90 ngày". Chữ khoảng này đi thẳng vào `rank.basis`.

---

## C. Ngân sách độ dài ở 375px (ước tính theo token, chưa đo trên ảnh)

Cỡ chữ lấy từ `packages/design-tokens/src/tokens.css:214-223`, font Inter.

| Chỗ | Bề rộng chữ | Cỡ | Khoảng ký tự/dòng |
|---|---|---|---|
| Thẻ lưới 2 cột: (375 − 32 − 12)/2 = 165,5px, đệm 10px | 145px | caption 13px | ~20 |
| Kệ ngang Bán chạy, thẻ 156px | 136px | caption 13px | ~19 |
| Kệ Mua lại, thẻ 148px | 128px | caption 13px | ~18 |
| Thẻ Giờ vàng 132px, đệm 8px | 116px | caption 13px | ~16 |
| Nhãn trên ảnh: ảnh 165px trừ lề 8px, icon 12 + 4, đệm 6px mỗi bên | ~140px | 11px đậm | ≤ 14 (tối đa 18) |
| Nút trong thẻ, rộng hết thẻ | ~120px | label 12px | ≤ 16 |
| Hàng tiêu đề khối: 343px, trừ "Xem tất cả" (~72px) | ~250px | title-sm 16px | ≤ 24, hoặc ≤ 12 nếu có nhãn đếm ngược |
| Tab khung giờ (khoảng 4 tab trong 343px) | ~80px | label 12px | ≤ 12 |

---

## D. Cơ chế giữ chữ khớp cho màn làm sau

**D1. Một nguồn chữ cho gian hàng.**
- Tạo `packages/app-core/src/shop-copy.ts`, xuất `shopCopy` gồm các mục `flash`, `rank`, `badge`, `suggest`, `campaign`, `coupon`, `combo`, `addon`, `stock`, `sort`, `brand`, `storefront`.
- Mini App: `vi.flashSale`, `vi.browse.sort`, `vi.product.outOfStock`… chỉ trỏ lại sang `shopCopy`.
- Web: `flashSaleText`, `browseText.sort` và chữ trong `product-card.tsx` lấy từ đó.
- Chuyển vào app-core các hàm sinh chữ: `couponLabel`, `formatSold`, `formatRating`, `tileMetaLine`, `countdownClock`, `countdownText`. Hiện `couponLabel` có 4 bản, `formatSold` có 2 bản.
- Mỗi khoá có chú thích một dòng: chỗ dùng và số ký tự tối đa.

**D2. Spec bảng thuật ngữ cho cả hai nền tảng.** Nới `terminology.spec.ts` (hoặc tạo `packages/app-core/src/shop-glossary.spec.ts`) quét cả `apps/miniapp/src` và `apps/web/src` (trừ `admin`). Mỗi khái niệm một chữ:

| Khái niệm | Chữ dùng | Cấm trong chữ hiển thị |
|---|---|---|
| Brand | Thương hiệu | "Nhãn hàng", "theo dõi nhãn", "nhãn này", "Cửa hàng ${", "Cùng nhà" |
| Gian hàng CTV/đối tác | Gian hàng | "cửa hàng" |
| Flash sale | Giờ vàng (luôn hoa chữ G) | "Flash sale", "flash sale", "giờ vàng" viết thường, "Ưu đãi giờ vàng" |
| Mã | Mã giảm giá | đã có Q-26; thêm "HSD", "mã giảm" không có chữ "giá" theo sau |
| Giao hàng miễn phí | Miễn phí giao hàng | đã có D6-17; thêm "Freeship" |
| Xếp hạng | Bán chạy nhất | "Top " (mở rộng Q16 sang gian hàng) |
| Đếm ngược | Kết thúc sau / Bắt đầu sau | "Còn ${" truyền chuỗi thời gian vào; các mẫu "\d+h \d+m" |
| Tồn kho | Còn {n} sản phẩm | "Chỉ còn" (brief §3.2) |
| Giọng | Bạn / Tubu | "chúng tôi", "Vui lòng" (trong các file khách xem) |
| Dấu câu | "…" | "..." |

Mỗi luật có bộ đối chứng "bắt đúng / bỏ qua đúng", như cách `terminology.spec.ts:42-49` đang làm.

**D3. Spec chặn chữ viết thẳng trong mã.**
- Dùng lại hàm `stringsOf` của `freeship-copy.spec.ts:24-42` để đọc chuỗi bằng TypeScript AST.
- Áp cho danh sách file gian hàng ở cả hai nền tảng: home, browse, product-detail và pdp-*, storefront-view và /s, brand-view và /brand, offers và uu-dai, flash-sale, product-tile và product-card, cùng mọi file mới của đợt này.
- Chặn chuỗi có dấu tiếng Việt nằm ngoài các module chữ.
- Chạy theo kiểu chốt chặn: ghi số dòng hiện tại (khoảng 41 ở Mini App, 50 ở web) vào spec. Số này chỉ được giảm, không được tăng. File mới thì phải bằng 0.

**D4. Spec ngân sách độ dài.** `shop-copy.spec.ts` gọi hàm với giá trị xấu nhất rồi kiểm số ký tự theo mục C. Ví dụ:

```text
badge(99).length ≤ 14
tileMetaLine(4.95, 999_999).length ≤ 20
flash.endsIn('23:59:59').length ≤ 22
stock.outShort.length ≤ 12
```

**D5. Một dòng trong `AGENTS.md`** (người có quyền sửa thêm vào):

> Chữ của màn gian hàng chỉ thêm vào `shop-copy.ts`, kèm chỗ dùng và độ dài tối đa. Chạy spec thuật ngữ, spec chữ viết thẳng và spec độ dài trước khi mở PR.

**D6. Thứ tự làm.**
1. Xoá khoá chết (UC-21).
2. Tạo `shop-copy.ts`, đưa chữ hiện có vào, sửa luôn UC-01 tới UC-06.
3. Bật D2 tới D4.
4. Rồi mới làm 4 chức năng mới, theo bộ chữ ở mục B.

---

## E. Cần chủ quyết

| # | Câu hỏi | Đề xuất |
|---|---|---|
| E1 | Đồng hồ Giờ vàng nhảy từng giây kiểu Shopee ("02:05:33"), hay nhảy theo phút ("2 giờ 05 phút") đúng tinh thần brief §3.2? | Nhảy từng giây chỉ ở trang Giờ vàng và hàng tiêu đề khối Trang chủ, màu promo, không dùng đỏ. Trang chi tiết dùng "Kết thúc sau 2 giờ 05 phút". |
| E2 | "Top bán chạy" hay "Bán chạy nhất"? | "Bán chạy nhất". Q16 đã cấm "Top" ở game; giữ "Top" thì phải thêm ngoại lệ vào spec. |
| E3 | Nhãn "Freeship" trên thẻ? | Viết "Miễn phí giao hàng" (D6-17), và chỉ gắn khi riêng sản phẩm đó được miễn phí. Ngưỡng miễn phí tính theo cả đơn thì gắn nhãn là nói sai. |
| E4 | Nhãn "Yêu thích"? | Không dùng, vì trùng với tim "Thêm yêu thích" và "Sản phẩm yêu thích". Chọn "Được yêu thích" (theo ngưỡng sao và số đánh giá do chủ chốt) hoặc "Tubu chọn" (gắn tay). |
| E5 | "Kho voucher"? | "Mã giảm giá" với 3 tab: Nhận mã, Mã của tôi, Đã dùng/hết hạn (Q-26). |
| E6 | Brand gọi là gì? | "Thương hiệu" ở mọi nơi (UC-01). |
| E7 | "Tạm hết — sẽ về sớm" là một lời hứa | Thẻ ghi "Tạm hết hàng". Câu dài chỉ hiện ở trang chi tiết khi sản phẩm còn bán; hàng đã ngừng thì ghi "Ngừng bán". |
| E8 | Chat CTA | "Nhắn Tubu Tree" (Việt thuần) hay giữ "Chat với Tubu Tree" (đang dùng nhiều hơn). |
