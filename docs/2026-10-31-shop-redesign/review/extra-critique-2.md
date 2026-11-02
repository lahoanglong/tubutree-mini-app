# Review bổ sung 2: sheet và màn mua sắm chưa chụp ở bước chốt (2026-11-02)

Phần còn thiếu của `final-critique.md` (mục "Không kiểm được"): sheet chọn phân loại, sheet mã giảm giá (PDP và thanh toán), Combo + Mua kèm ở PDP, giỏ có combo, thanh toán đầy đủ và thiếu địa chỉ, gian hàng CTV bậc 2 cùng trình dựng và trang CTV. Chụp ba khổ mini375, web375, web1280; so Mini với web 375 từng màn theo `DESIGN.md` và skill `tubu-ui`; đối chiếu mã để chỉ file:dòng.

## Kết luận

- Mã chụp: nhánh `shop/I2-capture-review` = `4364ec325` (main sau PR #114). API thật, DB riêng chép từ `tubutree_uat_l7`.
- 109 ảnh: mini375 39, web375 36, web1280 34; 39 cặp ghép Mini | web 375. 0 tràn ngang ở mọi ảnh (`scrollWidth` = khung). Lần chụp cuối không có lỗi API, lỗi trang.
- **P0: 0.** Đề nghị chủ cân nhắc nâng P1 #1 lên P0: nút "Mua ngay" ghi số tiền khác số tiền giỏ tính, trái nguyên tắc 7 (giá khách thấy bằng giá khách trả). Trang thanh toán vẫn hiện đúng tổng trước khi đặt, nên chưa tính P0.
- **P1: 10.** Nặng nhất: giá trên nút sai khi mua quá giới hạn Giờ vàng; thanh toán web 1280 giấu dòng hàng trong vùng cuộn lồng; Mini thiếu địa chỉ khoá nút "Đặt hàng" mà không nói lý do và ghi "Tổng cộng" như đã đủ; hai bảng chọn mã ở thanh toán khác hẳn nhau và không dùng `VoucherTicket`; phiếu không dùng được mờ tới 2,3:1.
- **P2: 18.**
- Làm tốt: sheet phân loại, sheet Ưu đãi PDP, Combo, Mua kèm, giỏ, `/s/:slug` bậc 1 và bậc 2 gần như trùng giữa Mini và web 375. Mọi số tiền khớp (mục Làm tốt).
- File phiên 9b đang sửa: chỉ P2 #15 (trang CTV) chạm `apps/miniapp/src/pages/affiliate.tsx` và `apps/web/src/app/ctv/page.tsx`. Không lỗi nào cần sửa `apps/web/src/components/ui/sheet.tsx`, `flash-sale.tsx` hai app, hay `packages/app-core/src/home-layout.ts`.

## Ảnh

Thư mục `docs/2026-10-31-shop-redesign/screens/extra2/` (bị `.gitignore`, chỉ có trên máy, worktree `shop-I2`). Tên ảnh `<khổ>/<màn>__<persona>__<khổ>__<nhãn>.png`; ảnh ghép ở `pairs/<màn>__<persona>__pair__<nhãn>.png` (trái Mini, phải web 375, DPR 1). Mọi đường dẫn ảnh dưới đây tính từ `extra2/`. Mỗi ảnh có một dòng trong `audit.jsonl`: `scrollWidth`, phần tử bấm dưới 44px, chữ bị cắt, chữ dưới 12px. `index.jsonl` ghi lỗi API, lỗi trang, chữ trong sheet.

| Màn | Mini | Web | Persona | mini375 | web375 | web1280 |
|---|---|---|---|---|---|---|
| Sheet phân loại (2 phân loại, "Combo 3 gói" hết hàng, "Gói 80 tờ" đang Giờ vàng) | `/product/khan-uot-khong-con-be-na` | `/san-pham/…` | returning | add1, soldout-tap, buy | add1, soldout-tap, buy | page, inline (chọn ngay trên trang, không có sheet) |
| Sheet "Mua ngay" số lượng 5 (quá giới hạn 3) | như trên | như trên | returning | qty5 | qty5 | không có sheet; cùng lỗi ở `add-to-cart.tsx:304` |
| Sheet Ưu đãi ở PDP | `/product/nuoc-giat-fuwa3e` | `/san-pham/…` | returning | row, sheet1, copied | row, sheet1, copied | row, sheet1, copied |
| Thanh toán đầy đủ (combo, THANG11, ví, điểm) | `/checkout` | `/thanh-toan` | returning | p1–p3 | p1–p3 | p1–p3 |
| Chọn mã ở thanh toán (khách cũ) | `/checkout` | `/thanh-toan` | returning | row, sheet1–4 (sheet) | row, panel1–2 (panel tại chỗ) | aside, after-remove (chip đã áp, bấm X rồi chụp panel) |
| Thanh toán thiếu địa chỉ (giỏ 1 món 26.000đ) | `/checkout` | `/thanh-toan` | new | p1–p2 | p1–p2 | p1–p2 |
| Chọn mã ở thanh toán (khách mới, gần hết mã không dùng được) | `/checkout` | `/thanh-toan` | new | sheet1–3 | panel1–2 | panel1–2 |
| Combo ưu đãi + Mua kèm ở PDP | `/product/nuoc-giat-fuwa3e` | `/san-pham/…` | returning | combo, addon, addon-picked | như Mini | như Mini |
| Giỏ có combo | `/cart` | `/gio-hang` | returning | p1–p2 | p1–p2 | p1–p3 |
| Gian hàng CTV bậc 1 / bậc 2 | `/s/uatctv` | `/s/uatctv` | guest | p1–p3 mỗi bậc | p1–p3 mỗi bậc | p1–p3 mỗi bậc |
| Trình dựng gian hàng bậc 1 / bậc 2 | `/storefront` | `/ctv/gian-hang` | ctv | p1–p2 mỗi bậc | p1–p2 mỗi bậc | p1–p2 mỗi bậc |
| Trang CTV bậc 1 / bậc 2 | `/affiliate` | `/ctv` | ctv | p1–p2 mỗi bậc | p1–p2 mỗi bậc | p1–p2 mỗi bậc |

Ghi chú chụp:
- Ảnh ghép `checkout-voucher*__pair__sheet*` chỉ có bên Mini: web 375 không mở sheet mà mở panel tại chỗ, ảnh ở `web375/checkout-voucher__returning__web375__panel1.png`, `panel2.png`.
- Mỗi ô thanh toán xoá mã đang áp trong giỏ trước khi mở (`update carts set "couponCode"=null`), nên ảnh thể hiện mã tự áp lúc vào trang.
- Số đo thanh toán 375 (bảng ở P1 #9) đo riêng ở DPR 1 bằng `getBoundingClientRect`.

## Môi trường và dữ liệu

Không chạm DB lane 7 hay container của phiên khác. Mọi thay đổi chỉ trên bản sao riêng, đã xoá khi dừng.

- Postgres `i2-pg` cổng 3455 (Docker `--rm --tmpfs`), Redis `i2-redis` cổng 3456. DB `tubutree_i2` = `pg_dump` của `tubutree_uat_l7` (seed 01/11 của `final-critique.md`, 261 migration).
- API (`apps/api/dist`, build từ worktree này) cổng 3451, web `next dev` 3452, Mini Vite 3453, Pancake giả 3454. Khung chụp: bản sao `docs/2026-10-20-uat/tools/uat-harness` ở scratchpad, vá cổng thành lane 25.
- Thay đổi dữ liệu trên `tubutree_i2`:
  - Kéo dài khung Giờ vàng đang chạy tới 11:59 ngày 02/11 để chụp sheet đang Giờ vàng.
  - Ví khách `uat_returning` = 50.000đ để thấy dòng ví ở thanh toán.
  - Thêm một hoa hồng APPROVED 3.500.000đ cho `uat_ctv` để lên bậc Đồng (bậc 2) khi chạy `CTV_TIER=tier2`.
- Script (cùng thư mục `screens/`, bị `.gitignore`): `capture-extra2.mjs` (khung chụp + đo), `extra2-steps.mjs` (các ô), `pair-extra2.mjs` (ghép). Chạy lại một ô: `UAT_HARNESS=<harness> CTV_TIER=tier2 node capture-extra2.mjs --phase mini375,web375 --only s-ctv-tier2`.

## Cách review

- So từng cặp ảnh ghép Mini | web 375, rồi xem web 1280 riêng theo khuôn `apps/web/src/components/layouts/`.
- Đọc `audit.jsonl` cho tràn ngang, vùng chạm, chữ cắt, chữ nhỏ.
- Tính tương phản từ màu token và `opacity` thật của phần tử (không ước lượng bằng mắt).
- Đối chiếu số tiền với API (`GET /cart`, báo giá thanh toán) và dữ liệu DB.
- Soát chữ theo `FORBIDDEN_TERMS` (`packages/app-core/src/shop-copy.ts:296-311`) và danh sách miễn ở `packages/app-core/src/terminology.spec.ts`.

## P0

Không có. Xem đề nghị ở P1 #1.

## P1

| # | Màn | Khổ | Vấn đề | Ảnh | File:dòng | Cách sửa | File của 9b |
|---|---|---|---|---|---|---|---|
| 1 | Sheet phân loại "Mua ngay" / "Thêm vào giỏ", thanh mua PDP | mọi khổ | Giá trên nút bỏ qua giới hạn Giờ vàng "Mỗi khách tối đa 3". Số lượng 5: nút ghi "Mua ngay · 130.000đ" (5 × 26.000), giỏ tính 175.000đ vì máy chủ tính CẢ dòng giá thường 35.000đ khi vượt suất. Số lượng 4: nút 104.000đ, giỏ 140.000đ. `QuantitySelector` chỉ kẹp theo tồn kho (245), không theo suất còn lại. Trái nguyên tắc 7. | `pairs/variant-sheet-qty__returning__pair__qty5.png` | Mini `apps/miniapp/src/components/variation-sheet.tsx:88,152-154`; web `apps/web/src/components/variation-sheet.tsx:79,131`; `packages/app-core/src/variation-picker.ts:19-22` (`clampPickerQty`); `apps/miniapp/src/pages/product-detail.tsx:764-766,1065-1070`; `apps/web/src/components/add-to-cart.tsx:304`; luật máy chủ `apps/api/src/modules/flash-sale/flash-line-price.ts` | Thêm hàm app-core `commerce/` (kèm spec) tính tổng dòng đúng luật máy chủ: trong suất thì giá Giờ vàng, vượt suất thì cả dòng giá thường. Khi Giờ vàng đang chạy, kẹp `max` của `QuantitySelector` bằng `perUserLeft` và ghi "Mỗi khách tối đa 3 suất Giờ vàng" cạnh ô số lượng. Dùng chung cho hai sheet, thanh mua Mini, `add-to-cart` web. | không |
| 2 | Thanh toán, danh sách hàng ở cột phải | web1280 | Khung tóm tắt dính có `overflow-y-auto`, danh sách hàng bên trong `max-h-40 overflow-auto`. Dòng thứ 6 "Xịt tẩy vết bẩn cổ áo Fuwa3e 80.000đ" bị giấu, không có dấu hiệu cuộn. Cộng các dòng thấy được không ra "Tạm tính 1.019.000đ". Trái luật "không cột dính, không vùng cuộn riêng trong trang web". | `web1280/checkout-full__returning__web1280__p1.png` | `apps/web/src/app/thanh-toan/page.tsx:667` (`lg:sticky … lg:max-h-[…] overflow-y-auto`), `:678` (`max-h-40 overflow-auto`) | Bỏ `max-h-40 overflow-auto`, hiện đủ dòng (nhiều hơn 5 món thì "Xem thêm n sản phẩm" mở rộng tại chỗ). Bỏ cột dính và vùng cuộn của khung tóm tắt theo luật khuôn trang; nút "Đặt hàng" đặt cuối khung. | không |
| 3 | Thanh toán thiếu địa chỉ | mini375 | Nút "Đặt hàng" bị khoá nhưng cạnh nút không có lý do. Web có "Chọn địa chỉ giao hàng để đặt hàng.". Mini ghi "Tổng cộng 26.000đ" khi chưa tính phí giao, như thể đã đủ; web ghi "Chưa tính". | `pairs/checkout-noaddr__new__pair__p1.png`, `pairs/checkout-noaddr__new__pair__p2.png` | Mini `apps/miniapp/src/pages/checkout.tsx:1122-1126` (tổng `previewTotal`), `:1156-1180` (thanh đặt hàng); web `apps/web/src/app/thanh-toan/page.tsx:467,476` | Đưa câu lý do (`barHint`) và chữ "Chưa tính" của web lên Mini, chữ lấy từ shop-copy dùng chung. Bấm vào nút khoá thì cuộn tới khối địa chỉ. | không |
| 4 | Chọn mã ở thanh toán | mini375, web375 | Hai bảng khác hẳn nhau. Mini mở sheet `VoucherSheet`: thẻ tự dựng cao 160–200px, hiện đủ 8 mã, không xếp mã dùng được lên trước. Web mở panel tại chỗ `CouponBox` nền cam: 3 mã + "Xem thêm 5 mã". Nhãn nút khác nhau: Mini "Dùng / Chưa đủ / Bỏ", web "Dùng mã / Không áp dụng / Không cần / Đang dùng". Không bảng nào dùng `VoucherTicket` (DESIGN.md cấm tự dựng phiếu). Chữ viết thẳng, không qua shop-copy. | `pairs/checkout-voucher__returning__pair__sheet1.png`…`sheet4.png`, `web375/checkout-voucher__returning__web375__panel1.png`, `pairs/checkout-voucher-new__new__pair__sheet1.png` | Mini `apps/miniapp/src/components/checkout/voucher-sheet.tsx:228-328`; web `apps/web/src/components/coupon-box.tsx:262-356`, gọi ở `apps/web/src/app/thanh-toan/page.tsx:735-751` | Một bảng chọn mã cùng tên, cùng props ở hai app: sheet ở Mini và web dưới `md`, panel ở `lg`. Mỗi mã là `VoucherTicket variant="row"` với `reason`. Hàm xếp ở app-core: đang áp, dùng được (giảm nhiều trước), chưa đủ điều kiện (thiếu ít trước), không áp dụng. Nhãn nút là khoá shop-copy mới. Thêm màn vào `ds-parity.shop.spec.ts`. | không |
| 5 | Chọn mã ở thanh toán, phiếu không dùng được | mini375, web375, web1280 | Mini mờ cả thẻ `opacity 0.55`: chữ còn 2,28–2,58:1. Web `opacity-80` / `opacity-60`: chữ cảnh báo 3,77:1, chữ khác 2,58–3,92:1. Đúng phần chữ lý do khách cần đọc để biết vì sao không dùng được. Dưới 4,5:1. | `pairs/checkout-voucher-new__new__pair__sheet1.png`, `web375/checkout-voucher-new__new__web375__panel1.png` | Mini `apps/miniapp/src/components/checkout/voucher-sheet.tsx:238`; web `apps/web/src/components/coupon-box.tsx:300-302` | Bỏ `opacity` cả thẻ. Làm nhạt viền và icon, giữ chữ lý do và điều kiện đủ 4,5:1 (đúng cách `VoucherTicket` vẽ trạng thái không dùng được). Thêm cặp màu vào `contrast.spec.ts`. | không |
| 6 | Sheet phân loại khi đang Giờ vàng | mini375, web375 | Sheet không nói đây là giá Giờ vàng. Giá 26.000đ màu chữ thường vì `PriceTag` thiếu `tone="deal"`. Không nhãn Giờ vàng, không -%, không giới hạn "Mỗi khách tối đa 3", không đồng hồ. Ngoài trang PDP thì có đủ. Khách tăng số lượng mà không biết có giới hạn (dẫn tới #1). | `pairs/variant-sheet__returning__pair__buy.png`, `pairs/variant-sheet__returning__pair__add1.png` | Mini `apps/miniapp/src/components/variation-sheet.tsx:95`; web `apps/web/src/components/variation-sheet.tsx:86` | Phân loại đang Giờ vàng: `PriceTag tone="deal"`, thêm dòng nhãn Giờ vàng + giới hạn suất (chữ từ shop-copy, cùng thành phần đang dùng ở `FlashPriceBar`). | không |
| 7 | Lý do mã không dùng được, lời báo Giờ vàng ở giỏ | mọi khổ | Chữ API trả cho khách vi phạm thuật ngữ và gây hiểu nhầm. Phiếu SHIP0D hiện lý do "…mã FREESHIP được giữ cho đơn sau." như thể nói về một mã khác tên FREESHIP. "giờ vàng" viết thường ở 6 câu. Lời báo vượt suất dùng "Chỉ còn". `terminology.spec` không quét `apps/api`. | `pairs/checkout-voucher-new__new__pair__sheet1.png` (dòng cảnh báo của SHIP0D) | `apps/api/src/modules/coupons/coupon-notice.ts:12,15,19,28` ("mã FREESHIP"), `:36,45,50,55` ("giờ vàng"); `apps/api/src/modules/flash-sale/flash-line-price.ts:10-12` ("giờ vàng", "Chỉ còn") | Đổi "mã FREESHIP" thành "mã miễn phí giao" (hoặc chèn đúng mã đang xét), "giờ vàng" thành "Giờ vàng", "Chỉ còn n suất" thành "Còn n suất". Mở rộng `terminology.spec` sang các file chữ khách đọc của API (`*-notice.ts`, `*-price.ts`). | không |
| 8 | Chọn mã ở thanh toán, hạn dùng | mini375, web375, web1280 | Chữ cấm "HSD" hiện cho khách ở cả hai app. Mini đang nằm trong danh sách miễn. Web lọt `terminology.spec`: chuỗi template `HSD ${d}` không khớp `ASCII_PROSE` nên không được coi là chữ khách đọc. | `pairs/checkout-voucher__returning__pair__sheet1.png`, `web375/checkout-voucher__returning__web375__panel1.png` | Mini `apps/miniapp/src/components/checkout/voucher-sheet.tsx:300` (miễn ở `terminology.spec.ts:226`); web `apps/web/src/lib/coupon-view.ts:21` | Dùng `expiryText` của `packages/app-core/src/commerce/voucher.ts` ở cả hai bảng (sẽ tự có khi làm #4). Gỡ dòng miễn của `voucher-sheet.tsx`. Sửa `displayStrings` để đầu chuỗi template có chữ cấm cũng bị quét. | không |
| 9 | Thanh toán đầy đủ | web375 | Web 375 lệch số đo Mini (bảng dưới). Thêm: ghi chú Mini là ô một dòng, web là ô nhiều dòng; tóm tắt Mini có "Chi tiết ›", web không; dòng đồng ý điều khoản Mini ở cuối nội dung, web nằm trong thanh dính (thanh cao thêm khoảng 40px); lý do ví "Số dư chưa đủ" ở web không thụt lề; web khách mới thiếu khối "Điểm Xanh – Tích điểm từ đơn đầu tiên nhé". | `pairs/checkout-full__returning__pair__p1.png`…`p3.png`, `pairs/checkout-noaddr__new__pair__p2.png` | `apps/web/src/app/thanh-toan/page.tsx` (các khối `data-mini-block`: address, items, payment, summary, note) | Sửa từng khối web dưới `md` theo số đo Mini, rồi thêm thanh toán vào bảng chuẩn của `ds-parity.shop.spec.ts`. | không |
| 10 | Giỏ có combo | mọi khổ | Các món của "Bộ giặt sạch Fuwa3e" nằm rời nhau trong giỏ, chỉ có dòng "Giảm giá combo -65.250đ" ở chân. Khách không biết món nào thuộc bộ, bỏ một món thì mất giảm mà không được báo trước. Gốc: API chỉ trả tổng `comboDiscount`, không nói món nào thuộc bộ nào. | `pairs/cart-combo__returning__pair__p1.png`, `pairs/cart-combo__returning__pair__p2.png` | API `apps/api/src/modules/cart/cart.service.ts:318`; Mini `apps/miniapp/src/pages/cart.tsx:780`; web `apps/web/src/app/gio-hang/page.tsx` | API trả thêm danh sách combo đã khớp (id, tên, món, số tiền giảm). Giỏ gom các món của bộ dưới đầu nhóm "Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ". Cần việc API, làm sau #1–#9. | không |

Số đo thanh toán 375 (P1 #9), DPR 1:

| Chỉ số | Mini | Web 375 |
|---|---|---|
| Chiều cao thẻ địa chỉ | 90 | 112 ("Mặc định" xuống dòng) |
| Bước dòng sản phẩm | 66 | 72 |
| Bước dòng phương thức thanh toán | 68 | 56 |
| Bước dòng tóm tắt | 35 | 24 |
| Chữ "Tổng cộng" | 14/400 | 16/700 |
| Chữ tiêu đề khối | 14/500 | 14/600 |

## P2

| # | Màn | Khổ | Vấn đề | Ảnh | File:dòng | Cách sửa | File của 9b |
|---|---|---|---|---|---|---|---|
| 1 | Sheet phân loại, chip hết hàng | mini375, web375 | Chip "Combo 3 gói" hết hàng chỉ gạch ngang và mờ, không có chữ hết hàng. Ba cách ghi hết hàng: chip PDP Mini "Tạm hết — sẽ về sớm", chip PDP web "Hết hàng", nút và chú thích sheet "Hết hàng". Chữ chuẩn là "Tạm hết hàng". Chip trong sheet không có giá và dấu Giờ vàng như chip ngoài trang. | `pairs/variant-sheet__returning__pair__soldout-tap.png` | Mini `apps/miniapp/src/components/variation-sheet.tsx:123-140`, web `apps/web/src/components/variation-sheet.tsx:107-119`; `apps/miniapp/src/i18n/vi.ts:131`; `apps/web/src/components/add-to-cart.tsx:383`; `packages/app-core/src/variation-picker.ts:25` | Dùng chung chip phân loại của PDP trong sheet (có giá, dấu Giờ vàng, chữ "Tạm hết hàng"). Đổi `pickerStockText` và nhãn nút sang "Tạm hết hàng". | không |
| 2 | Tiêu đề sheet ("Chọn phân loại", "Mã giảm giá", "Chọn mã giảm giá"); tiêu đề khối thanh toán web 1280 | mọi khổ | Dùng Fraunces 18px. DESIGN.md: Fraunces chỉ cho tiêu đề trang và số lớn từ 22px; tiêu đề khối là Inter 16/700. | `pairs/offers-sheet__returning__pair__sheet1.png`, `web1280/checkout-noaddr__new__web1280__p1.png` | Mini `apps/miniapp/src/components/ui/bottom-sheet.tsx:174`; web `apps/web/src/components/mini/bottom-sheet.tsx:114` (`Heading variant="title-md"`, font display mặc định); `apps/web/src/app/thanh-toan/page.tsx` (tiêu đề khối) | Tiêu đề sheet dùng biến thể tiêu đề khối (Inter 16/700) ở cả hai app. | không |
| 3 | Sheet trên web máy tính | web1280 | Sheet vẫn là bottom sheet trải hết chiều ngang, cao gần hết màn, còn tay nắm kéo. | `web1280/offers-sheet__returning__web1280__sheet1.png`, `web1280/variant-sheet__returning__web1280__inline.png` (so sánh) | `apps/web/src/components/mini/mini.css:674-719` (`.mini-sheet-panel`) | Từ `md`: hộp thoại giữa màn rộng tối đa 480px, bỏ tay nắm. Không đụng `components/ui/sheet.tsx` (file của 9b). | không (không phải `ui/sheet.tsx`) |
| 4 | Sheet Ưu đãi ở PDP | mọi khổ | Hiện cả 8 mã trong ví, mỗi mã nút "Sao chép", không xếp theo mức có lợi cho món đang xem, không ghi "mua thêm bao nhiêu". Chép mã: Mini báo bằng toast; web chèn ghi chú ở đáy sheet làm sheet cao thêm (CLS), chữ viết thẳng. | `pairs/offers-sheet__returning__pair__sheet1.png`, `pairs/offers-sheet__returning__pair__copied.png` | `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx:164-172` | Xếp mã bằng hàm app-core theo giá trị giảm cho món đang xem, ghi điều kiện còn thiếu. Web báo chép mã qua `useNotify` như Mini, chữ từ shop-copy. Mã đã có trong ví thì đổi nút thành "Dùng khi thanh toán". | không |
| 5 | Hạn dùng của mã | mọi khổ | "Dùng đến 01/01" thiếu năm. Mã FREESHIP hết hạn lúc 00:00 ngày 01/01/2027 (giờ VN) nên ngày dùng được cuối là 31/12, nhưng chữ ghi 01/01. | `pairs/offers-sheet__returning__pair__sheet1.png` | `packages/app-core/src/commerce/voucher.ts:177-188` (`expiryText`) | Hạn đúng 00:00 thì lùi một ngày. Ghi năm khi hạn khác năm hiện tại. Thêm ca vào spec. | không |
| 6 | Chọn mã ở thanh toán, dòng điều kiện | mini375, web375 | Lý do máy chủ "Đơn tối thiểu 199.000đ để dùng mã này." lặp dòng "Đơn tối thiểu 199.000đ" ngay dưới. SHIP0D vẫn hiện "Đơn tối thiểu 0đ". | `pairs/checkout-voucher-new__new__pair__sheet2.png`, `web375/checkout-voucher-new__new__web375__panel1.png` | Mini `apps/miniapp/src/components/checkout/voucher-sheet.tsx:274-298`; web `apps/web/src/components/coupon-box.tsx:323-332` | Có lý do thì không vẽ dòng điều kiện trùng (đúng cách `VoucherTicket` làm). Ẩn "Đơn tối thiểu" khi bằng 0. | không |
| 7 | Chọn mã ở thanh toán, mã bị máy chủ chặn | mini375 | Mini vẫn ghi nút "Dùng" (bị khoá) cho mã máy chủ đã báo không áp dụng; web ghi "Không áp dụng". Nút khoá ghi "Dùng" đọc như lỗi. | `pairs/checkout-voucher-new__new__pair__sheet1.png` | `apps/miniapp/src/components/checkout/voucher-sheet.tsx:324` | Gộp vào P1 #4 (một bộ nhãn nút ở shop-copy). | không |
| 8 | Thanh toán, mã đã áp | web1280 | Đã áp mã thì chỉ còn chip kèm X. Muốn so mã khác phải gỡ mã trước; Mini bấm dòng "Mã giảm giá" là mở được bảng chọn để đổi. Khách không biết mã do Tubu tự áp. Nút "Đặt hàng" ở 1280 không ghi số tiền. | `web1280/checkout-voucher__returning__web1280__aside.png`, `after-remove.png` | `apps/web/src/components/coupon-box.tsx:414-428` | Thêm "Đổi mã ›" cạnh chip, mở bảng chọn mã. Thêm khoá shop-copy cho chữ "Đã tự áp mã tốt nhất" và dùng ở cả hai app. Nút "Đặt hàng · {tổng}". | không |
| 9 | Thanh toán, chip mã, ô số lượng | mọi khổ | Chip mã ở thanh toán Mini dùng `fontSize: 11` và primitive `--clay-*`. `QuantitySelector` Mini dùng `var(--stone-100)`. Web `coupon-box.tsx` và `thanh-toan/page.tsx` dùng lớp primitive `stone/forest/clay` (51 và 18 chỗ). | `mini375/checkout-full__returning__mini375__p2.png` | `apps/miniapp/src/pages/checkout.tsx:649-676`; `apps/miniapp/src/components/ui/quantity-selector.tsx:31`; `apps/web/src/components/coupon-box.tsx`; `apps/web/src/app/thanh-toan/page.tsx` | Đổi sang token semantic (`--color-promo-bg`, `--color-promo-fg`, token nền khoá của nút), cỡ chữ theo thang `--type-*`. Chạy `ds-ratchet` để hạ baseline. | không |
| 10 | Chọn mã ở thanh toán | mini375 | `VoucherSheet` gọi thẳng `useSnackbar` / `openSnackbar` của zmp-ui, trái luật đi qua `useNotify`. | (mã) | `apps/miniapp/src/components/checkout/voucher-sheet.tsx:2,59` | Đổi sang `useNotify`. | không |
| 11 | Khối "Mua kèm deal sốc" ở PDP | mọi khổ | "deal sốc" là chữ giục mua, trái luật "bỏ chữ giục mua" về nghĩa. Mẫu `/SỐC/` trong `FORBIDDEN_TERMS` phân biệt hoa thường nên spec không bắt. Chủ quyết chữ. | `pairs/bundle-pdp__returning__pair__addon.png` | `packages/app-core/src/shop-copy.ts:194` (`addon.title`), `:310` | Đề xuất "Mua kèm giá tốt". Đổi mẫu thành `/SỐC/i` sau khi chủ chốt chữ. | không |
| 12 | Mua kèm, chọn món | mọi khổ | Chọn món mua kèm làm dòng "Tiết kiệm 26.000đ" xuất hiện, đẩy nút và nội dung dưới xuống khoảng 22px (CLS). | `pairs/bundle-pdp__returning__pair__addon.png` → `addon-picked.png` | Mini `apps/miniapp/src/components/product/pdp-bundles.tsx:171-176`; web bản tương ứng | Giữ chỗ dòng tiết kiệm khi chưa chọn (chữ rỗng cùng chiều cao), hoặc đặt số tiết kiệm trong nhãn nút. | không |
| 13 | Gian hàng CTV bậc 2 | mọi khổ | Huy hiệu bậc chỉ ghi "Đồng". Emoji bị `aria-hidden` nên trình đọc màn hình chỉ đọc "Đồng", nghĩa mơ hồ. Trang CTV lại ghi "CTV Đồng". | `pairs/s-ctv-tier2__guest__pair__p1.png` | Mini `apps/miniapp/src/components/ui/tier-badge.tsx:11-14`, web `apps/web/src/components/mini/tier-badge.tsx:14-17`; dùng ở `apps/miniapp/src/pages/storefront-view.tsx:146` | Ghi "CTV {tên bậc}" ở huy hiệu, chữ từ shop-copy. | không |
| 14 | Trình dựng gian hàng | mini375, web375 | Không có chỗ cho CTV xem trước huy hiệu bậc mà khách thấy. Ô thống kê Mini "Đơn 30 ngày" xuống 2 dòng; cả khối Mini thấp hơn web khoảng 36px (liên quan P2 #28 của `final-critique.md`). Tiêu đề "Thống kê 30 ngày", "Bố cục gian hàng" dùng Fraunces. | `pairs/storefront-tier2__ctv__pair__p1.png` | `apps/miniapp/src/pages/storefront-builder.tsx`, `apps/web/src/app/ctv/gian-hang/page.tsx` (khối thống kê, tiêu đề khối) | Thêm phần đầu xem trước như khách thấy (dùng lại `ShopHeader`). Nhãn ô thống kê ngắn hơn hoặc một dòng có `nowrap`. Tiêu đề khối Inter 16/700. | không |
| 15 | Trang CTV, khối "Thưởng mốc doanh số tháng" | web375 | Web dùng `text-xs` / `text-sm`, Mini dùng `caption` / `body-sm`: chữ web nhỏ hơn. Cả trang web thấp hơn Mini khoảng 125px. | `pairs/affiliate-tier2__ctv__pair__p1.png`, `pairs/affiliate-tier2__ctv__pair__p2.png` | web `apps/web/src/components/affiliate/milestone-rewards.tsx:112-155`; Mini `apps/miniapp/src/components/affiliate/milestone-rewards.tsx`; trang chứa `apps/miniapp/src/pages/affiliate.tsx`, `apps/web/src/app/ctv/page.tsx` | Sửa `milestone-rewards.tsx` web theo thang chữ Mini (không thuộc 9b). Phần lệch còn lại của trang làm sau khi 9b gộp. | **có**: `affiliate.tsx`, `ctv/page.tsx` |
| 16 | Thanh toán, dòng sản phẩm | mini375, web375 | Tên sản phẩm cắt một dòng ("Nước rửa chén hương chanh L…"), không biết đúng phân loại nào. | `pairs/checkout-full__returning__pair__p1.png` | Mini `apps/miniapp/src/pages/checkout.tsx` (khối hàng); web `apps/web/src/app/thanh-toan/page.tsx` (khối `items`) | Cho tên hai dòng; phân loại ở dòng riêng. | không |
| 17 | Thanh toán, chữ cấm đang được miễn | mini375, web375 | Còn nợ chữ cấm (không có trên ảnh đã chụp, hiện ở trạng thái lỗi và đang tính): "Vui lòng" ở `thanh-toan/page.tsx:472,491` và `checkout.tsx:1013`; "Đang tính..." ở `checkout.tsx:1124,1273`; `pickerStockText` ghi "Chỉ còn n". | (mã) | `apps/web/src/app/thanh-toan/page.tsx:472,491`; `apps/miniapp/src/pages/checkout.tsx:1013,1124,1273`; `packages/app-core/src/variation-picker.ts:26` | Đổi chữ theo bảng `FORBIDDEN_TERMS`, gỡ dòng miễn tương ứng trong `terminology.spec.ts`. | không |
| 18 | Lưới chặn chữ cấm | (mã) | Ba lỗ của `terminology.spec`: không quét `apps/api` (P1 #7); chuỗi template bắt đầu bằng chữ ASCII viết hoa như `HSD ${d}` không bị coi là chữ khách đọc (P1 #8); mẫu `/SỐC/` phân biệt hoa thường (P2 #11). | (mã) | `packages/app-core/src/terminology.spec.ts:15,23`; `packages/app-core/src/shop-copy.ts:310` | Sửa ba chỗ để lần sau spec đỏ thay vì cần người soát. | không |

## Làm tốt

- Sheet phân loại, sheet Ưu đãi PDP, Combo ưu đãi, Mua kèm, giỏ, `/s/:slug` bậc 1 và bậc 2: Mini và web 375 gần như trùng từng px.
- 0 tràn ngang ở mọi ảnh, cả ba khổ.
- Tiền đúng: combo "Bộ giặt sạch Fuwa3e" 369.750đ (tiết kiệm 65.250đ); mua kèm 69.000đ / 109.000đ (-27%); thanh toán khách cũ "Tổng 893.750đ" = 1.019.000 − combo 65.250 − THANG11 60.000.
- Hai app đều tự áp THANG11 khi vào thanh toán.
- Web 1280 chọn phân loại ngay trên trang, không cần sheet.
- Gian hàng bậc 2 hiện huy hiệu bậc, bậc 1 ẩn đúng (`publicBadge=false`).

## Không kiểm được

- Sheet chọn mã ở giỏ web (`CouponBox sheet=true`) và sheet mã ở giỏ Mini: không chụp, chỉ chụp ở thanh toán.
- Trạng thái combo "Đã kết thúc" / "Tạm hết hàng": seed không có combo hết hạn.
- Lỗi đặt hàng thật sau khi bấm "Đặt hàng" (giá đổi, hết suất, lỗi máy chủ): không bấm đặt đơn.
- Sheet "Mua ngay" quá suất ở web 1280: không có sheet, lỗi cùng gốc ở `add-to-cart.tsx:304` (đọc mã, chưa chụp).
- Trình đọc màn hình và axe: chỉ soát `aria-*` trong mã, chưa chạy `a11y-shop.*.spec.ts`.
