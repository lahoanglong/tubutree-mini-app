# Kiểm vùng pdp (gl-1103): PDP, tờ chọn phân loại, Yêu thích, Giờ vàng, Combo và Mua kèm

Người kiểm: auditor vùng pdp. Chỉ đọc và đo, không sửa mã, không commit, không đọc hay ghi PROD. Lane 5.
Ngày: 2026-11-03.

## Tóm tắt

- Không thấy lỗi P0 hay P1 trong phần đã kiểm được. Có 3 lỗi P2 và 9 điểm P3.
- Web 375 và web 1280 chỉ kiểm được một phần: máy chủ web lane 5 (cổng 3252) treo suốt phiên, tải máy 90 đến 143. Mọi lệnh thử vào web quá thời gian chờ (90 s, 240 s, 45 s, 60 s). Phần web dựa vào ảnh chụp cũ của `capture.mjs` (web 375, ok) và đọc mã. Chi tiết ở mục "Chưa kiểm được".
- Mini 375 kiểm đủ: PDP, tờ chọn phân loại, Giờ vàng (khung đang mở, sắp mở, Nhắc tôi), Combo, Mua kèm, Yêu thích, các trạng thái chờ, lỗi, ngoại tuyến, rỗng, chữ dài.

## Cách chạy (lệnh)

Thư mục làm việc tạm: `/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/315ed69b-80dc-466e-bece-22ee1ad7bd37/scratchpad/pdp/`.

- Chụp chuẩn: `node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375 --keys product-slug,flash-sale,wishlist` và các trạng thái `--state loading,error500,offline,empty,longtext`. Ảnh ở `docs/2026-10-28-review/screens/<nhãn>/`.
- Dữ liệu giả cho Giờ vàng, Combo, Mua kèm và suất theo khách: `lib.mjs` chồng `context.route` lên `http://localhost:3251/api/**` (chỉ GET công khai, POST ghi được giả). Lane 5 không có Giờ vàng hay combo thật nên phải giả mới thấy giao diện.
  - `node run.mjs mini returning pdp-flash|flash-page|wish|home`
  - `node flow-mini.mjs flash-remind|combo-add|combo-fail|combo-guest|sheet-partial|sheet-spent`
  - `node states-mini.mjs longname|oos|lowstock|many|merchant|unavailable|partner|404`
  - `node flow-write.mjs` (new_nophone: bấm tim hai lần, thêm giỏ một lần, ghi thật).
- Ảnh riêng của tôi: `docs/2026-11-03-golive/audit/pdp-img/`.

## Phát hiện

### PDP-01 (P2, Mini + web) Trang Giờ vàng: nút Mua ngay không biết suất còn lại của khách

- `apps/miniapp/src/pages/flash-sale.tsx:112-113` và `apps/web/src/app/gio-vang/flash-slots-view.tsx:111-112`: `buyMut` gọi `addToCart(item.variationId, 1, ...)` mà không hỏi `useFlashAllowance`, không xét món đã có trong giỏ. `useFlashAllowance` chỉ nằm ở `product-detail.tsx`, `wishlist.tsx`, `add-to-cart.tsx`, `quick-add.tsx`.
- PDP và tờ chọn phân loại thì có: khi hết suất, cả dòng tính giá thường và có câu giải thích (ảnh `flow-sheet-spent-1-sheet__returning__mini.png`, `flow-sheet-partial-1-sheet__returning__mini.png`).
- Ảnh `flash-page__returning__mini.png` (giả suất = 0 cho `fsi-nrc-1l`): thẻ vẫn ghi giá Giờ vàng 89.000đ và nút "Mua ngay", không có câu nào. Máy chủ tính cả dòng theo giá thường khi quá giới hạn, nên khách vào thanh toán thấy 120.000đ.
- Không dựng được bước thanh toán với Giờ vàng thật trên lane (không được ghi dữ liệu Giờ vàng), nên mức giá cuối chỉ suy từ mã và từ `flashLinePreview`. Đề nghị đội sửa xác nhận bằng một suất thật.
- Đề xuất: dùng `useFlashAllowance` trên trang Giờ vàng, khi suất = 0 đổi nhãn thẻ sang giá thường hoặc ghi `lineNote` như PDP; giữ cùng chữ trong `shop-copy`.

### PDP-02 (P2, Mini + web) Sản phẩm hết hàng vẫn mời "Mở nhóm mua chung"

- Ảnh `state-oos__returning__mini.png` (giả mọi phân loại `stock: 0`): thanh dưới đã khoá mua, nhưng hàng "Mở nhóm mua chung — nhận mã giảm giá khi đủ người", ô Số lượng và dòng "Nhận ~2.880 Điểm Xanh" vẫn hiện.
- `apps/miniapp/src/pages/product-detail.tsx:821` chỉ chặn bằng `!retailOnly`. Web: `apps/web/src/app/san-pham/[slug]/page.tsx:247` `{!retailOnly && <PdpGroupBuyRow .../>}` (chưa chụp web, đọc mã).
- API `apps/api/src/modules/groupbuy/groupbuy.service.ts:85-130` `create()` không kiểm tồn kho: khách mở được nhóm, rủ 2 người bạn, rồi không ai mua được.
- Đề xuất: ẩn hàng mua chung khi `!inStock` (cả hai app), và API từ chối mở nhóm khi mọi phân loại còn bán đều hết hàng.

### PDP-03 (P2, Mini + web) Nguồn thêm giỏ của Combo và Mua kèm bị ghi cứng là `ctv_sheet`

- `apps/miniapp/src/services/cart-batch.ts:11` và `apps/web/src/lib/shop-combo.ts:11`: `addCartItemsBatch(coreHttp, items, 'ctv_sheet', cartStorefrontSlug())` cho mọi lần "Thêm cả combo" và "Thêm n món".
- Bằng chứng chạy thật: `flow-mini.mjs combo-add` ghi được thân POST `{"items":[...],"addSource":"ctv_sheet"}` cho cả combo lẫn mua kèm ở PDP.
- API `apps/api/src/modules/cart/cart.service.ts:499-547` chỉ đưa vào thuộc tính phân tích; `ADD_SOURCES` ở `cart.dto.ts:7` không có giá trị riêng cho combo. Hậu quả: báo cáo chuyển đổi tính combo PDP là "từ trang gian hàng CTV".
- Đề xuất: thêm giá trị nguồn riêng (ví dụ `bundle_combo`, `bundle_addon`) vào `ADD_SOURCES` và để hook truyền theo ngữ cảnh. Việc đổi enum API là hợp đồng nhỏ, nhưng không đụng điểm, giá hay luật pháp lý.

### PDP-04 (P3, web) Giờ vàng web không gửi nguồn `buy_now`

- Mini `flash-sale.tsx:113` truyền `'buy_now'`, web `flash-slots-view.tsx:112` bỏ trống. Lệch dữ liệu phân tích giữa hai nền tảng. Đề xuất truyền `'buy_now'` cho khớp.

### PDP-05 (P3, Mini) Tên thương hiệu dài làm nút chia sẻ bị bóp còn 29x44

- Ảnh `state-longname__returning__mini.png` (thương hiệu 56 ký tự): nút chia sẻ đo được 29x44, chấm màu thương hiệu bị bóp. `apps/miniapp/src/pages/product-detail.tsx:603-614`: khối chia sẻ có `width: 44` nhưng không `flexShrink: 0`.
- Web chưa kiểm. Dữ liệu lane toàn tên ngắn ("Fuwa3e", "Visante", "BH.Nong") nên là biên hiếm. Đề xuất: `flexShrink: 0` cho tim và chia sẻ, cắt tên thương hiệu bằng ellipsis.

### PDP-06 (P3, Mini + web) Bấm tim thất bại không báo gì

- `apps/miniapp/src/components/wishlist-heart.tsx:21` và `apps/web/src/components/catalog/wishlist-heart.tsx:25`: `catch {}` rỗng; tim chỉ tự về trạng thái thật sau khi tải lại. Chủ ý theo chú thích mã, nhưng khách mất mạng không biết vì sao tim quay lại. Đề xuất: một câu báo ngắn khi lỗi (khác 401).

### PDP-07 (P3, Mini + web) Tim ở PDP đổi `aria-label` song song với `aria-pressed`

- Đo khi chạy (`flow-write.mjs`): trước bấm `aria-label="Thêm yêu thích"` `aria-pressed=false`, sau bấm `"Bỏ yêu thích"` `true`. PDP gọi `<WishlistHeart productId size={22}/>` không truyền `productName` (Mini `product-detail.tsx:602`, web `page.tsx:128`), nên rơi vào nhánh nhãn đổi (`wishlist-heart.tsx:84-85` Mini, `:89-90` web). Trình đọc màn hình đọc trạng thái hai lần.
- Đề xuất: truyền `productName` để nhãn cố định "Yêu thích <tên>" như các thẻ khác.

### PDP-08 (P3, Mini + web) `UpcomingFlashSales` không còn ai dùng

- Xuất khẩu ở `apps/miniapp/src/components/flash-sale.tsx:257` và `apps/web/src/components/home/flash-sale.tsx:270`, `grep` không thấy nơi gọi. Có `onError` hoàn tác không báo và `role="button"` không tên riêng theo sản phẩm. Mã chết, chưa ảnh hưởng khách. Đề xuất xoá hoặc dùng.

### PDP-09 (P3, Mini) Trang 404 sản phẩm lặp hai lần "Không tìm thấy"

- Ảnh `state-404__returning__mini.png`: tiêu đề "Không tìm thấy" rồi thân "Không tìm thấy sản phẩm này." (`product-detail.tsx:373`, chữ viết thẳng, không qua `shop-copy`). Hàng gợi ý "Có thể bạn thích" và số điện thoại hỗ trợ hiện đủ. Web chưa chụp. Đề xuất đổi thân thành câu dẫn đường ("Sản phẩm đã gỡ hoặc đổi địa chỉ. Xem gợi ý bên dưới.") qua `shop-copy`.

### PDP-10 (P3, Mini + web) Chữ viết thẳng trong PDP, có biểu tượng cảm xúc trong thông báo

- Mini `product-detail.tsx:360` ("Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé" kèm emoji giỏ), `:853`, `:933`; web `pdp-extras.tsx:408`, `pdp-sections.tsx:65`, `mua-chung/group-buy-view.tsx:61`. Luật tubu-ui: chữ lấy từ `shop-copy.ts`. Đề xuất chuyển sang `shop-copy` kèm ngân sách độ dài, bỏ emoji.

### PDP-11 (P3, web 375) Tim lệch Mini khoảng 6px sang phải

- So `docs/2026-10-28-review/screens/web375/product-slug__returning__web375__s1.png` (tim ở x=586 trên ảnh 2x) với Mini `pdp-img/write-4-after-add__new_nophone__mini.png` (x=574): khoảng cách tim-chia sẻ web nhỏ hơn 12px ảnh 2x, tức khoảng 6px CSS. Tiêu đề và giá web cao hơn Mini khoảng 2px CSS. Mini dùng `size={22}` trong `Box` `marginLeft:auto`, web dùng mặc định của `WishlistHeart`. Đề xuất ép cùng kích thước vùng chạm và khoảng cách.

### PDP-12 (P3, web) Phân loại mở sẵn ở web chọn khác Mini (chỉ từ mã)

- Web `page.tsx:94`: `PdpSelectionProvider initialId = variations.find(v => v.stock > 0) ?? variations[0]` (thứ tự API là giá lẻ tăng dần). Mini `product-detail.tsx:229` dùng `pickDefaultVariation` (giá hiệu lực thấp nhất, còn hàng). Khác nhau khi một phân loại đắt hơn lại có `salePrice` thấp hơn. Không sản phẩm nào của lane 5 rơi vào trường hợp này, chưa tái hiện. Đề xuất web dùng `pickDefaultVariation` từ app-core.

## Đã kiểm và đạt (không đưa vào phát hiện)

- PDP Mini 375 với Giờ vàng + Combo + Mua kèm (`pdp-flash__returning__mini.png`): bố cục, giá, thanh đếm ngược, chip phân loại đúng; giống web 375 trừ hàng "Đặt định kỳ" chỉ có ở web (chủ ý).
- Tờ chọn phân loại với suất còn 1 và 0: câu giải thích đúng, nút ghi cả dòng.
- Thêm giỏ của `new_nophone`: tờ chọn mở, `POST /api/cart/items` trả 201, thanh dưới đổi thành "Đã thêm", "Mua ngay 240.000đ" là chủ ý (giỏ đã có 1 thì Mua ngay thanh toán cả dòng, có câu giải thích).
- Giờ vàng: khung đang mở, chuyển tab khung sắp mở, "Nhắc tôi" (toast đúng), món hết suất khoá; trạng thái lỗi, ngoại tuyến, rỗng nhất quán với web 375.
- Combo: "Thêm cả combo" thành công và thất bại (lời nghiệp vụ "Dầu tràm cho bé Cobote đã hết hàng." hiện đúng).
- Yêu thích: Mini 375 (ok, rỗng, lỗi 500, ngoại tuyến, chữ dài) ổn; thẻ chữ dài cắt ellipsis, "Tubu chọn" không đẩy vỡ.
- Console và pageErrors sạch ở mọi lượt chạy Mini. CLS Mini khoảng 0,01 đến 0,035 trong các luồng.

## Chưa kiểm được

- Web 375 và web 1280 chạy tương tác: lane 5 web (pid 84401, cổng 3252) không trả lời trong phiên. Các ô web 1280 của `product-slug`, `flash-sale`, `wishlist` trong `index-web1280.jsonl` ghi `url:null` (thất bại); không chụp lại được. Thiếu: PDP web 1280, Giờ vàng web (cả 375 lẫn 1280), Combo/Mua kèm web, trạng thái chờ/lỗi/rỗng/chữ dài của web, `wishlist__guest__web375`.
- Combo và Mua kèm trên web: dữ liệu `initialBundles` do máy chủ dựng khi render, Playwright không giả được; ngay cả khi web chạy cũng chỉ thấy khi lane có combo thật.
- Số đo hiệu năng web (CLS web dev 0,078) không đáng tin vì tải máy cao; không dùng làm kết luận.
- Giờ vàng thật, Combo thật, suất theo khách thật, bước thanh toán với giá Giờ vàng: lane 5 không có dữ liệu, dùng dữ liệu giả.
- Đọc PROD và các luồng ghi ngoài Yêu thích và thêm giỏ của `new_nophone`: không làm.

## Việc ngoài quy ước tôi đã làm (khai báo)

- `combo-guest` (Mini, persona `guest`): POST `/cart/items/batch` không được giả nên ghi thật 2 món vào giỏ khách vãng lai của lane 5 (ngoài phạm vi ghi cho phép là `new_nophone`). Giỏ khách vãng lai của harness, không đụng dữ liệu người thật.
- `new_nophone`: bấm tim 4 lần (cộng rồi trừ, ròng 0) và thêm giỏ 1 lần (Nước rửa chén 1L, giỏ còn 1 dòng).
- Một lần chạy nhầm `capture.mjs --help` (công cụ không có cờ này nên chạy thật với mặc định); dừng sau khoảng 2 phút, không có ảnh mới, có thể thêm vài dòng vào `index-mini375.jsonl`.
