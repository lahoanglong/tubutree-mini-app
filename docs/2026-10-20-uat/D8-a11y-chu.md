# D8 — A11Y + CHỮ (tĩnh)

Phiên UAT 2026-10-20, nhánh `uat/2026-10-20`. Chỉ đọc mã, không sửa mã nguồn. Phạm vi: `apps/miniapp/src`, `apps/web/src/app/admin`, `apps/web/src/components/admin`; chạm thêm `packages/design-tokens`, `apps/api` (chỉ khi chữ lỗi đi từ API ra khách) và vài file web khách khi chữ/màu dùng chung (ghi rõ vùng web, chỉ báo).

Kết quả: 18 phát hiện. P0: 0. P1: 1. P2: 4. P3: 13.

## Cách làm và nguồn số liệu

| Việc | Công cụ | Kết quả |
|---|---|---|
| Quét tĩnh có sẵn | `tools/static-scan.mjs` (bản sao `scripts/uiux/static-scan.mjs`, ghi ra `static/` thay vì `scripts/uiux/results`) | `static/static-scan.json`: miniapp 313 file, 0 màu cũ, 140 file dùng token DS v2, 5 hex thô nằm trọn trong `utils/storefront-theme.ts` (màu chủ gian hàng chọn, không phải chữ giao diện); web 515 file có 62 hex thô ở 5 file ngoài phạm vi D8 (vùng web). Không file cam kết sẵn bị ghi đè. Quét này không đọc `.css`, nên `brand-theme.css` không nằm trong số đếm |
| Nhãn truy cập, ảnh, ô nhập, vùng chạm | `tools/a11y-ast-scan.mjs` (TypeScript compiler API đi cây JSX) | `static/a11y-ast.json`: 110 mục thô. Sau soát tay: xem D8-8, D8-9, D8-10 và mục "Đã kiểm, loại" |
| Tương phản WCAG | `tools/contrast.mjs` + `tools/ratio.mjs` | `static/contrast.md`, `static/contrast.json`: ma trận token, cặp chữ/nền trong `style={{}}`, cặp lớp Tailwind của admin. Mọi hit đã đọc lại mã để loại dương tính giả |
| Chữ hiện ra | `tools/extract-strings.mjs` | `static/strings.tsv`: 6.559 dòng (zone, file, dòng, loại, chữ). Dùng để đếm biến thể chính tả, tìm tiếng Anh, từ lặp, dấu câu |

Chạy lại: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` rồi `node docs/2026-10-20-uat/tools/<tên>.mjs`. Tính tay một cặp: `node docs/2026-10-20-uat/tools/ratio.mjs '#96650A' '#EFEBE2' 1 0.7 '#FFFFFF'`.

Ngưỡng dùng: chữ thường 4,5:1; chữ lớn (từ 24px, hoặc từ 18,66px nếu đậm 700) 3:1; biểu tượng/đường viền control 3:1 (WCAG 1.4.11); control bị vô hiệu hoá được miễn.

Kết quả sạch (không phải phát hiện):
- Tiền tệ: không có chỗ tự ghép "đ" ngoài `formatVnd`/`formatNumber` trong miniapp và admin. `toLocaleString('vi-VN')` chỉ dùng cho số điểm/đếm (`rg` ra 8 dòng, không dòng nào là tiền).
- Giọng văn: không có "quý khách" nào; toàn bộ dùng "bạn". Không có "Loading", "Submit", "Cancel" lọt ra chữ khách. Không có enum thô ở các màn đã soi.
- "Điểm Xanh" viết đúng hoa/thường ở mọi chỗ (không có "Điểm xanh", "điểm Xanh"). "xu" chỉ còn trong ngữ cảnh điểm quy đổi từ xu cũ (xem D8-16).
- Vùng chạm: quét chiều cao/rộng khai báo dưới 44 trên phần tử bấm được ra 0 mục (Chip 36px có `tubu-hit-44`; Button DS 44/48; IconButton bắt buộc `label` và 44px; admin dùng `TOUCH_H = min-h-[44px] sm:min-h-[36px]`).
- `lang="vi"` có ở `apps/miniapp/index.html:2` và `apps/web/src/app/layout.tsx:29`.
- Lỗi kiểm tra dữ liệu (class-validator) đã được dịch sang tiếng Việt ở `apps/api/src/common/validation-pipe.ts:109-120`; 764 chỗ `Exception('...')` của API không có câu tiếng Anh nào (`rg` trừ file test).

## Bảng tổng hợp

| ID | Mức | Nhóm | Vùng | Vị trí chính | Tóm tắt |
|---|---|---|---|---|---|
| D8-1 | P2 | cần chủ quyết | UAT (miniapp), web (báo) | `apps/miniapp/src/css/brand-theme.css:19-37`, `pages/brand-story.tsx:56,65-68,78-86` | Chữ trắng trên ô gradient nhãn Fuwa3e, Pơ Lang, Visante, Sokfram chỉ 2,1 đến 3,8:1 |
| D8-2 | P2 | cần chủ quyết | UAT | `apps/miniapp/src/css/zaui-bridge.css:44,59,68,78` | Viền ô nhập/checkbox/radio 1,72:1 và nền công tắc tắt 1,39:1, dưới 3:1 |
| D8-3 | P2 | agent sửa ngay | UAT (api) | `apps/api/src/common/guards/jwt-auth.guard.ts:7-21` | Lỗi 401 hiện nguyên chữ "Unauthorized" cho khách/nhân viên |
| D8-4 | P2 | agent sửa ngay | UAT | `apps/miniapp/src/pages/about.tsx:39` | Tóm tắt đổi trả cứng "7 ngày" và nói chỉ hoàn vào Ví Tubu, lệch với cấu hình và màn trả hàng |
| D8-5 | P1 | chủ tự làm | web (báo), dữ liệu cấu hình | `apps/web/src/lib/legal.ts:29,50-52,61,120,207,237-238` | Trang /chinh-sach/* hiện bản nháp còn `[Tên công ty]`, `[số ngày]` vì `legal.*` rỗng |
| D8-6 | P3 | agent sửa ngay | UAT | `apps/miniapp/src/components/game/season-pass.tsx:69-71,108,116` | Hàng bậc đang khoá làm mờ cả hàng, chữ còn 2,55:1 |
| D8-7 | P3 | agent sửa ngay | UAT | `apps/miniapp/src/components/reviews-section.tsx:43-48,492-511` | Sao rỗng màu stone-200, 1,39:1 trên nền trắng |
| D8-8 | P3 | agent sửa ngay | UAT | 18 chỗ ở cart, checkout, product-detail, flash-sale, order-detail | Vùng bấm là div/Box/Text có `onClick` nhưng không role, không phím |
| D8-9 | P3 | agent sửa ngay | UAT | 12 ô nhập miniapp (xem bảng) | Ô nhập chỉ có placeholder hoặc không có tên truy cập |
| D8-10 | P3 | agent sửa ngay | UAT (`app/admin`), web (2 file) | `apps/web/src/app/admin/page.tsx` 68 ô, `components/admin/merchant-products-tab.tsx:243,535` | 70 ô nhập admin chỉ có placeholder |
| D8-11 | P3 | agent sửa ngay | UAT | `apps/miniapp/src/i18n/vi.ts:89-91` | Màn chủ ghi "Voucher chào mừng", còn thanh toán ghi "mã giảm giá" |
| D8-12 | P3 | cần chủ quyết | UAT | `vi.ts:888-893`, `pages/staff.tsx`, `pages/affiliate.tsx:343`, `app/admin/page.tsx:217-278` | Tiếng Anh/biệt ngữ ở game, nhân viên, CTV, thanh điều hướng admin |
| D8-13 | P3 | agent sửa ngay | UAT, web (báo) | `apps/miniapp/src/utils/brand-origins.ts:85`, `pages/recycle-desk.tsx:101` | "Đắc Lắk", "giới hạn hạn mức", "hiện tại tại thời điểm" |
| D8-14 | P3 | cần chủ quyết | UAT, web (báo) | `apps/miniapp/src/i18n/vi.ts:80` | "6 vùng đất" trong khi dữ liệu có 8 nhãn, 7 tỉnh |
| D8-15 | P3 | cần chủ quyết | UAT | `apps/miniapp/src/i18n/vi.ts` (nhiều dòng) | Lẫn hai kiểu bỏ dấu: Hủy/Huỷ, Xóa/Xoá, khóa/khoá |
| D8-16 | P3 | cần chủ quyết | UAT | `apps/miniapp/src/pages/about-data.ts:51` | Câu "điểm quy đổi từ xu cũ" luôn hiện trong FAQ cho mọi khách |
| D8-17 | P3 | chủ tự làm | UAT, web (báo) | `apps/miniapp/src/pages/about-data.ts:92`, `apps/web/src/lib/api.ts:344` | Số hotline/email dự phòng viết cứng, cần chủ xác nhận là số thật |
| D8-18 | P3 | agent sửa ngay | UAT | `apps/miniapp/src/i18n/vi.ts:268-269` | Hai câu `pointsUse`, `pointsAvailable` không ai dùng |

## Chi tiết, gom theo file

### apps/miniapp/src/css/brand-theme.css và pages/brand-story.tsx

#### D8-1 (P2, cần chủ quyết) — chữ trắng trên gradient nhãn không đủ tương phản

Vùng file: miniapp thuộc vùng UAT. Web khách dùng cùng màu (`apps/web/src/app/cau-chuyen/brand-theme.css:19`, `brand-story-view.tsx:46,64`), thuộc vùng web, chỉ báo.

Vị trí: `brand-theme.css:19-37` (đầu gradient), `utils/brand-origins.ts:53-54` (`linear-gradient(135deg, from, to)`), `pages/brand-story.tsx:56` (nền gradient của ô nhãn), `:65-68` (chữ `tone="inverse"` đậm cho tên, caption 12px cho tỉnh), `:78-86` (đầu bảng chi tiết, chữ giữa ô).

Kịch bản: khách mở Hành trình nguyên liệu. Ô Fuwa3e (vàng), Pơ Lang (cam), Visante (xanh ngọc), Sokfram (xanh dương nhạt) có chữ trắng tên nhãn và tên tỉnh nằm ở góc dưới trái, tức khoảng 50 đến 75% đường gradient 135 độ. Chữ khó đọc ngoài nắng trên điện thoại.

Bằng chứng (chữ #FFFFFF; `node tools/ratio.mjs`, trộn tuyến tính hai đầu; tỉ lệ ở 0%, 50%, 100% đường gradient):

| Nhãn | Đầu | Giữa | Cuối | Ở vị trí chữ (50 đến 75%) |
|---|---|---|---|---|
| Fuwa3e | 1,66 | 2,09 | 2,65 | 2,09 đến 2,36 |
| Pơ Lang | 2,37 | 2,70 | 3,08 | 2,70 đến 2,89 |
| Visante | 2,06 | 2,97 | 4,52 | 2,97 đến 3,64 |
| Sokfram | 2,65 | 3,83 | 5,75 | 3,83 đến 4,68 |
| Hector, Cobote | 3,3 | 5,4 đến 5,5 | 9,3 đến 9,7 | đạt |
| BH.Nong, Le Plateau | 4,6 đến 7,6 | 7,2 đến 10,3 | 11 đến 14 | đạt |

Chữ tên nhãn bold cỡ thường và caption 12px nên cần 4,5:1; không rơi vào chữ lớn.

Đề xuất: màu nhãn là quyết định thương hiệu nên để chủ chọn một trong hai cách: (a) đậm hoá đầu `-from` của bốn nhãn đến khi chữ ở 50 đến 75% đạt 4,5; (b) đổi chữ sang mực tối (`--color-brandmap-ink` #211003) cho bốn nhãn sáng; (c) thêm lớp phủ tối nhẹ dưới chữ. Test cần viết: spec đọc `brand-theme.css`, với từng nhãn tính tương phản chữ trắng tại t=0,5 và t=0,75, khẳng định lớn hơn hoặc bằng 4,5 (hoặc chữ tối cho nhãn sáng). Giữ spec chung cho cả `apps/web/src/app/cau-chuyen/brand-theme.css` (vùng web, hỏi trước).

### apps/miniapp/src/css/zaui-bridge.css

#### D8-2 (P2, cần chủ quyết) — viền ô nhập và công tắc tắt dưới 3:1

Vị trí: `zaui-bridge.css:44` (input), `:59` (checkbox), `:68` (radio) đều `var(--color-border-default)`; `:78` công tắc tắt `var(--stone-200)`. `node_modules/zmp-ui/zaui.css:995,1125` xác nhận viền ô nhập lấy đúng biến này.

Kịch bản: khách điền địa chỉ, ghi chú, mã giảm giá; ô nhập trên nền trắng chỉ có viền xám nhạt, người thị lực kém hoặc dùng ngoài trời khó thấy ranh giới ô, ô tick và công tắc (bật/tắt dùng Điểm Xanh ở thanh toán).

Bằng chứng: `static/contrast.md` mục A3. `--color-border-default` #CBC5B8 là 1,72:1 trên trắng và 1,56:1 trên canvas; `--stone-200` (#E0DACB, nền công tắc tắt) là 1,39:1 trên trắng. `--color-border-strong` #938B7E đạt 3,37:1 và 3,06:1. Admin web đã dùng `border-stone-450` (3,37) cho ô nhập (`apps/web/src/components/admin/ui.tsx:75`), nên chỉ miniapp lệch. Bản gốc của zmp-ui (#b9bdc1) cũng chỉ 1,9:1, nên đây là lệch có ý thức so với kiểu mặc định, không phải do tích hợp sai.

Đề xuất: đổi `:44,:59,:68` sang `var(--color-border-strong)`, `:78` sang `var(--stone-450)`. Vì đổi diện mạo mọi form nên cần chủ chốt. Test: spec đọc `zaui-bridge.css`, giải token qua `packages/design-tokens/src/tokens.css`, khẳng định mọi `--zaui-light-*-border-color` và `switch-off-bg-color` đạt ít nhất 3:1 so với `--color-bg-surface` và `--color-bg-canvas`.

### apps/miniapp/src/components/game/season-pass.tsx

#### D8-6 (P3, agent sửa ngay) — chữ ở bậc đang khoá bị làm mờ quá tay

Vị trí: `season-pass.tsx:69-71` (nền `--stone-100` và `opacity: t.unlocked ? 1 : 0.7` trên cả hàng), chữ `--honey-600` ở `:108,:116`, chữ `tone="tertiary"` ở `:77`.

Kịch bản: khách mới vào Vườn Xanh, các bậc phía sau đều khoá. Chữ "Premium" và số thưởng của bậc đó là thông tin cần đọc để biết mục tiêu, nhưng bị làm mờ.

Bằng chứng: `node tools/ratio.mjs '#96650A' '#EFEBE2' 1 0.7 '#FFFFFF'` ra 2,55; chữ tertiary `#6E675B` ra 2,65. Cùng hàng khi mở (không mờ) honey-600 trên nền `--color-bg-subtle` chỉ 4,24 trên stone-100.

Đề xuất: bỏ `opacity` của hàng, dùng nền stone-100 và chữ `tone="secondary"` cho bậc khoá, thêm nhãn "Chưa mở" (đã có `vi.game.seasonPass.locked`). Dùng `--honey-700` nếu cần chữ vàng. Test: spec `season-pass.spec.tsx` thêm ca bậc khoá, khẳng định style hàng không có `opacity` dưới 1.

### apps/miniapp/src/components/reviews-section.tsx

#### D8-7 (P3, agent sửa ngay) — sao rỗng gần như tàng hình

Vị trí: `:48` (dải sao hiển thị `Stars`, hàm bắt đầu ở `:43`), `:511` (sao chọn khi viết đánh giá, 5 nút `role="radio"` 44px, khối bắt đầu ở `:492`): sao chưa chọn dùng `var(--stone-200)`.

Kịch bản: khách viết đánh giá, chạm sao thứ 4; 4 sao đầu vàng (#B07A00, 3,73:1), sao thứ 5 gần như biến mất trên nền trắng (1,39:1), khó biết còn một sao để chọn.

Bằng chứng: `static/contrast.md` mục B (dòng `reviews-section.tsx:492`: 1,27 trên canvas); `ratio.mjs '#E0DACB' '#FFFFFF'` ra 1,39. Admin đã chọn `text-stone-450` cho sao rỗng (`apps/web/src/components/admin/reviews-tab.tsx:96`, 3,37:1), tức đã có tiền lệ.

Đề xuất: đổi sao rỗng sang `var(--stone-450)` ở `:48` và `:511`. Test: `reviews-section.spec.tsx` khẳng định màu sao rỗng không phải `--stone-200`; hoặc test token chung D8-2.

### apps/miniapp/src/pages/about.tsx và about-data.ts

#### D8-4 (P2, agent sửa ngay) — tóm tắt đổi trả nói sai và viết cứng

Vị trí: `about.tsx:39` (`POLICIES.returns.body`): "Đổi/trả áp dụng trong 7 ngày kể từ khi nhận ... hoàn tiền vào Ví Tubu sau khi duyệt."

Kịch bản: admin đổi `returns.window_days` thành 14 (hoặc khách xem trang trong lúc config khác 7). Trang Giới thiệu mục "Chính sách đổi trả" vẫn nói 7 ngày, còn FAQ cạnh bên (`about-data.ts:60,75`) nói 14 ngày. Ngoài ra khách chọn "Tài khoản ngân hàng" khi trả hàng (`components/orders/refund-destination-picker.tsx:22,34-41`: Ví cộng ngay, ngân hàng admin chuyển 1 đến 3 ngày) nhưng tóm tắt chỉ nhắc Ví.

Bằng chứng: `GET http://127.0.0.1:3221/api/config/public` trả `"returnWindowDays":7` (cấu hình, đổi được). `about-data.ts:60` đã đọc số ngày từ cấu hình. `order-detail.tsx:261` có dự phòng `?? 7` nhưng ưu tiên cấu hình.

Đề xuất: dựng `POLICIES.returns.body` từ `publicConfig.returnWindowDays` như `fallbackFaq`, đổi câu hoàn tiền thành "hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt". Test: `about` spec với `returnWindowDays=14` khẳng định thấy "14 ngày", không thấy "7 ngày"; khẳng định câu hoàn tiền có chữ "ngân hàng". Lưu ý web có bản nháp riêng nói thêm cách thứ ba "hoàn theo cách bạn đã thanh toán" (`apps/web/src/lib/legal.ts:206`, vùng web), nên cần chủ thống nhất một cách nói cho cả ba nơi sau khi chốt luật hoàn tiền.

#### D8-16 (P3, cần chủ quyết) — câu về "xu cũ" hiện cho mọi khách

Vị trí: `about-data.ts:49-52`: `pointsAnswer` luôn nối câu "Điểm quy đổi từ xu cũ thì không hết hạn và trừ được tới 100% giá trị hàng ...". Cùng ý ở `vi.ts:448` (`Điểm Xanh (xu cũ)` cho đơn trả bằng xu) và `packages/app-core/src/wallet-rules.ts:36` (nhãn dòng ví "Đổi sang xu cũ (nay là Điểm Xanh)").

Kịch bản: khách mới mở FAQ "Điểm Xanh là gì" đọc về "xu cũ" mà họ chưa từng có, và thấy "100% giá trị hàng" mâu thuẫn với "tối đa 20%" ngay câu trước. Luật 100% là đúng cho lô quy đổi (`utils/checkout-rules.ts:123`, chú thích `about-data.ts:49-50`), không phải lỗi luật.

Đề xuất: chủ quyết có còn khách giữ lô quy đổi không. Nếu không, bỏ câu này khỏi FAQ chung và giữ ghi chú `convertedNote` chỉ hiện khi tài khoản có lô quy đổi (`wallet.tsx:217` đã làm đúng). `packages/app-core` hỏi trước khi sửa. Test: `about-data` spec khẳng định FAQ chung không chứa "xu cũ".

#### D8-17 (P3, chủ tự làm) — số liên hệ dự phòng viết cứng

Vị trí: `about-data.ts:92` (`DEFAULT_SUPPORT` hotline `0984 606 774`, email `tubutree@gmail.com`), bản y hệt ở `apps/web/src/lib/api.ts:344` (vùng web).

Bằng chứng: `GET /api/config/public` hiện cùng hai giá trị (`"support":{"hotline":"0984 606 774","email":"tubutree@gmail.com"}`). Bản dự phòng chỉ hiện khi API lỗi, nên hiện tại không lệch.

Kịch bản: chủ đổi hotline hoặc đổi sang email tên miền công ty ở cấu hình mà quên đổi bản dự phòng; khi API lỗi khách gọi số cũ.

Đề xuất (chủ làm): xác nhận hai giá trị là số thật cho ngày mở; chấp nhận hai bản dự phòng cần đổi cùng lúc. Agent có thể thêm test khẳng định hai `DEFAULT_SUPPORT` trùng nhau.

### apps/miniapp/src/i18n/vi.ts

#### D8-11 (P3, agent sửa ngay) — "Voucher" ở màn chủ, "mã giảm giá" ở thanh toán

Vị trí: `vi.ts:89-91` (`voucherAmount`, `voucherPercent`, `voucherFreeship`), hiển thị ở `components/home/new-customer-gift.tsx:48-50`. Thanh toán và ví dùng "mã giảm giá" (`components/checkout/voucher-sheet.tsx:103,135,150,180`).

Kịch bản: khách mới thấy "Voucher chào mừng 30.000đ" ở trang chủ, sang bước thanh toán nút lại tên "Chọn mã giảm giá". Hai tên cho cùng một thứ; thuật ngữ cho khách là "mã giảm giá" (không có "Voucher" nào khác ở chữ khách ngoài ba dòng này, `static/strings.tsv`).

Đề xuất: đổi ba câu thành "Mã chào mừng ...". Test: thêm "Voucher" vào danh sách cấm của `i18n/terminology.spec.ts` (hiện chỉ cấm "xu"); phạm vi chữ khách ở miniapp.

#### D8-12 (P3, cần chủ quyết) — tiếng Anh và biệt ngữ lộ ra

Vị trí và người thấy:
- Khách ở trang game: `vi.ts:888` "Chặng Mùa (Season Pass)", `:890` "XP", `:893` "Premium" (hiện qua `components/game/season-pass.tsx`, được vẽ ở `pages/game.tsx:205`).
- Nhân viên bán hàng: `pages/staff.tsx:96,202,225,228,257,271,278` dùng "Checkout", "Checkin", "checkin" trộn với "Chấm công" (`:182`).
- CTV: `pages/affiliate.tsx:343` thẻ số "Click" cạnh "Chuyển đổi" (đã Việt hoá).
- Nhân viên admin web: thanh điều hướng `apps/web/src/app/admin/page.tsx:217` "Tổng quan KPI", `:218` "Retention & North-star", `:268` "Voucher", `:269` "Flash Sale", `:277` "Content Kit CTV", `:278` "Academy". `vi.ts:909,911` "CTV Academy".

Bằng chứng: `static/strings.tsv` (lọc từ tiếng Anh) cho đúng danh sách trên; không còn chữ Anh nào khác ở chữ khách.

Kịch bản: người dùng không rành tiếng Anh gặp "XP", "Premium", "Retention & North-star"; nhưng có thể một số từ là tên chương trình do chủ đặt (Flash Sale, Academy, Season Pass).

Đề xuất: chủ quyết từng tên; gợi ý "Điểm kinh nghiệm", "Cao cấp", "Giữ chân khách & chỉ số chính", "Mã giảm giá", "Giờ vàng giá sốc", "Học viện CTV". Không bắt buộc trước khi mở. Test: không cần.

#### D8-14 (P3, cần chủ quyết) — "6 vùng đất" không khớp dữ liệu

Vị trí: `vi.ts:80` (`brandStoryBody: 'Khám phá 6 vùng đất làm nên sản phẩm Tubu'`), web `apps/web/src/lib/home-text.ts:23` (vùng web, chỉ báo).

Bằng chứng: `utils/brand-origins.ts:61,73,85,97,109,121,133,145` có 8 nhãn, 7 tỉnh khác nhau (Thanh Hóa, Quảng Nam, Đắk Lắk, Khánh Hòa, Lâm Đồng hai nhãn, Bến Tre, Trà Vinh). Quyết định A5 cũng chưa chốt 8 nhãn này là nhãn thật (`docs/2026-10-18-launch-review/03-cau-hoi-sang.md:85`).

Kịch bản: khách đếm thấy 8 ô trên màn hình trong khi câu giới thiệu ghi 6.

Đề xuất: chốt danh sách nhãn thật (A5) rồi tính số từ dữ liệu (`BRAND_ORIGINS.length` hoặc số tỉnh khác nhau), hoặc bỏ số: "Khám phá những vùng đất làm nên sản phẩm Tubu". Test: spec khẳng định câu không chứa con số cứng lệch với `BRAND_ORIGINS`.

#### D8-15 (P3, cần chủ quyết) — hai kiểu bỏ dấu lẫn lộn

Bằng chứng: đếm trong `static/strings.tsv` (chỉ miniapp): dạng "huỷ/Huỷ" 45 dòng, "hủy/Hủy" 22; "xoá/Xoá" 27, "xóa/Xóa" 10; "khoá/Khoá" 11, "khóa" 1. Cùng một file `vi.ts` có "Hủy" (`:12,163,327,331`) và "Xoá" (`:233,457,461,503`). Admin web gần như chỉ dùng kiểu cũ: "huỷ/Huỷ" 82, "hủy/Hủy" 3; "xoá/Xoá" 28, "xóa/Xóa" 2; "khoá/Khoá" 69, "khóa" 0. Tên riêng "Thanh Hóa", "Khánh Hòa" (kiểu mới) trong `brand-origins.ts`.

Kịch bản: cùng một màn khách thấy "Hủy đơn" cạnh "Xoá bộ lọc".

Đề xuất: chủ chọn một kiểu (đa số hiện là kiểu cũ: huỷ, xoá, khoá, hoà), rồi thay hàng loạt và thêm vào `terminology.spec.ts` danh sách cấm kiểu còn lại. Tên riêng địa danh giữ theo hành chính. Cũng nên thống nhất "Cổ thụ" (hạng uy tín cộng đồng, `vi.ts:847`) với "Cổ Thụ" (hạng thành viên, `pages/loyalty.tsx:54`).

#### D8-18 (P3, agent sửa ngay) — câu chết trong vi.ts

Vị trí: `vi.ts:268-269` (`checkout.pointsUse`, `checkout.pointsAvailable`).

Bằng chứng: `rg "pointsUse|pointsAvailable" apps/miniapp/src` chỉ ra hai dòng định nghĩa này; nhãn thật nằm ở `utils/checkout-rules.ts:84` (`pointsUseLabel`, có spec). Hai câu chết dùng `${n} điểm` thô, không qua `formatPoints`, nên nếu ai dùng lại sẽ sai định dạng.

Đề xuất: xoá hai dòng. Test: `rg` không còn tham chiếu; test tĩnh liệt kê khoá `vi` không ai dùng nếu muốn gác lâu dài.

### apps/miniapp/src/utils/brand-origins.ts và pages/recycle-desk.tsx

#### D8-13 (P3, agent sửa ngay) — ba lỗi chính tả/lặp từ

- `apps/miniapp/src/utils/brand-origins.ts:85` `province: 'Đắc Lắk'`, hiển thị ở `pages/brand-story.tsx:68,86`. Đúng "Đắk Lắk" (cùng file `:89`, `brand-story.tsx:287`, `apps/api/prisma/seed.ts:892` đều viết "Đắk Lắk"). Bản web lỗi y hệt ở `apps/web/src/lib/brand-origins.ts:89` (vùng web, chỉ báo).
- `pages/recycle-desk.tsx:101` "Không giới hạn hạn mức tháng" lặp "hạn". Sửa thành "Không giới hạn mức tháng" hoặc "Hạn mức tháng: không giới hạn". Màn của nhân viên điểm thu rác.
- `apps/web/src/components/admin/dealer-credit-panel.tsx:88` "dư nợ hiện tại tại thời điểm xác nhận" lặp "tại" (vùng web, chỉ báo). Sửa thành "dư nợ tại thời điểm xác nhận".

Đề xuất và test: `brand-origins.spec.ts` khẳng định mọi `province` nằm trong danh sách tên tỉnh chuẩn (có "Đắk Lắk", không có "Đắc"); ba chuỗi trên sửa trực tiếp.

Ghi chú liên quan, không phải lỗi mới: tên "Sokfarm" (`brand-origins.ts:143`) khác catalog "Sokfram" (`catalogBrand`, `:144`; `apps/api/src/config/demo-data/demo-catalog.ts:233`). Mục D5-22 của đợt launch-review (`docs/2026-10-18-launch-review/D5-uiux-static.md:43`) đã xử lý phần lọc bằng `catalogBrand` nên danh sách không còn rỗng; phần tên hiển thị lệch giữa màn Hành trình và catalog phụ thuộc quyết định A5 về 8 nhãn demo.

### apps/api/src/common/guards/jwt-auth.guard.ts

#### D8-3 (P2, agent sửa ngay) — "Unauthorized" bằng tiếng Anh tới khách và nhân viên

Vị trí: `jwt-auth.guard.ts:7-21` không ghi đè `handleRequest`, nên Passport trả `UnauthorizedException()` mặc định. Đường hiển thị: `apps/miniapp/src/services/api.ts:152-170` (`getErrorMessage` hiện nguyên `message` của mọi lỗi 4xx; chỉ riêng 429 được thay), và web `apps/web/src/lib/client-api.ts:200-204` (`parseError`, vùng web).

Kịch bản: mở Mini App từ thông báo đẩy khi phiên chưa sẵn (đúng trường hợp chú thích ở `api.ts:28-44`: "Hết trần mà authReady vẫn chưa xong thì request VẪN được gửi đi nhưng KHÔNG kèm Authorization → 401 chắc chắn", React Query `retry:false`). Màn lỗi hiện chữ "Unauthorized" thay vì câu Việt. `getErrorMessage` có 200 chỗ gọi.

Bằng chứng: `curl -s http://127.0.0.1:3221/api/orders` trả `{"message":"Unauthorized","statusCode":401}`; `curl -s -i http://127.0.0.1:3221/api/admin/orders` trả `HTTP/1.1 401 Unauthorized` cùng thân này. `RolesGuard` đã trả tiếng Việt cho 403 (`roles.guard.ts:25`: "Bạn không có quyền truy cập tài nguyên này."), nên chỉ thiếu phía 401.

Đề xuất: trong `JwtAuthGuard` ghi đè `handleRequest(err, user)` ném `UnauthorizedException('Phiên đăng nhập đã hết hạn, bạn đăng nhập lại nhé.')` khi không có user (giữ cùng mã 401 để vòng refresh `api.ts:132` không đổi). Test: `jwt-auth.guard.spec.ts` mới khẳng định thông điệp chứa "đăng nhập"; e2e nhỏ `GET /orders` không token trả thông điệp Việt và mã 401. Chưa kiểm chứng: các lỗi trần khác của Nest/Express (413 thân quá lớn, 415) vì không có luồng khách nào gửi chúng trong UI.

### apps/web/src/app/admin/page.tsx (và components/admin)

#### D8-10 (P3, agent sửa ngay) — 70 ô nhập admin chỉ có placeholder

Vùng file: `apps/web/src/app/admin/page.tsx` (68 ô) thuộc vùng UAT. `apps/web/src/components/admin/merchant-products-tab.tsx:243,535` (2 ô) thuộc vùng web, chỉ báo.

Vị trí (từ `static/a11y-ast.json`, luật `field-placeholder-only`): `page.tsx:1851,1975,1978,1979,1982,1983,2018,2019,2153,2154,2199-2204,2212-2214,2275,2276,2577-2597,2678-2682,2734-2754,2854-2864,2965-3001,3063-3083,3195-3199,3216,3231,3240,3247,3314-3329`.

Kịch bản: nhân viên gõ vào "Logo URL", "Tagline", "SĐT (user đã mở Mini App)" (`:2199-2204`, `:1851`); nhãn chỉ là placeholder nên biến mất ngay khi gõ, người dùng đọc màn hình không nghe tên ô, và với form 6 ô liền nhau nhân viên dễ nhập nhầm cột.

Đề xuất: thêm `aria-label` bằng đúng chữ placeholder (cách rẻ nhất, không đổi diện mạo) hoặc dùng nhãn nhìn thấy như `confirm-dialog.tsx:141`. Test: vitest dựng từng form và `getByLabelText` cho mỗi ô; hoặc luật ESLint `tubu-ds` cho `input` không `aria-label`/`id+label`.

Ghi chú: ba chỗ `click-nonsemantic` ở `components/admin/confirm-dialog.tsx:119`, `customer-refund-paid-dialog.tsx:170`, `side-drawer.tsx:29` là lớp nền bấm để đóng hộp thoại, đã loại. `app/admin/page.tsx:1322` là hàng bảng bấm để mở rộng ở khổ hẹp; chưa kiểm chứng có nút phím thay thế trong hàng.

### apps/miniapp (vùng bấm và ô nhập)

#### D8-8 (P3, agent sửa ngay) — vùng bấm không role, không phím

Vị trí (từ `static/a11y-ast.json`, đã loại hai chỗ có lý do ghi sẵn):

| Dạng | Vị trí |
|---|---|
| div/Box/Text có `onClick`, không `role` | `components/flash-sale.tsx:127,197`; `pages/cart.tsx:464,541`; `pages/checkout.tsx:585,935`; `pages/order-detail.tsx:366`; `pages/product-detail.tsx:636` |
| `role="button"` nhưng không `tabIndex`/`onKeyDown` | `components/flash-sale.tsx:225`; `pages/cart.tsx:300,432`; `pages/checkout.tsx:971`; `pages/product-detail.tsx:366,566,676,847,1084,1144` |

Đã loại: `components/orders/return-request-sheet.tsx:192` (chú thích ghi bàn phím và trình đọc màn hình dùng ô tick cạnh), `components/ui/product-tile.tsx:227` (div chỉ chặn nổi bọt cho nút `Button` bên trong).

Kịch bản: khách dùng TalkBack/VoiceOver trong Zalo mở giỏ hàng; thẻ "Mã giảm giá" (`checkout.tsx:585`) và "Tóm tắt" (`:935`) là Box bấm được nhưng không được đọc là nút. Chưa kiểm chứng trên thiết bị thật nên để P3.

Đề xuất: dùng helper có sẵn `components/ui/row-keyboard.ts` (và test `row-keyboard.spec.tsx`) gắn `role="button"`, `tabIndex={0}`, Enter/Space cho 18 chỗ trên; thêm luật ESLint `tubu-ds` bắt `onClick` trên phần tử không tương tác. Test: mỗi chỗ có `getByRole('button', { name })` và `userEvent.keyboard('{Enter}')` kích hoạt.

#### D8-9 (P3, agent sửa ngay) — ô nhập không có tên truy cập

Vị trí (luật `field-placeholder-only`/`field-no-label`):

| Ô | Vị trí | Ghi chú |
|---|---|---|
| Tìm sản phẩm | `components/affiliate/ctv-order-sheet.tsx:610`, `components/community/product-picker.tsx:93`, `pages/storefront-builder.tsx:782` | ô tìm, placeholder đủ hiểu nhưng thiếu `aria-label` |
| Nội dung đánh giá | `components/reviews-section.tsx:518` | placeholder dài là nhãn duy nhất |
| Ghi chú đơn | `pages/checkout.tsx:789` | có tiêu đề ngay trên (`:786`) nhưng không gắn với ô |
| Tên mẫu đơn, dán danh sách, số tiền | `pages/dealer.tsx:490,508,825` | |
| Gian hàng | `pages/storefront-builder.tsx:461,540,591,863` | `:540` (đổi tên bộ sưu tập) không có cả placeholder |
| Thanh phóng to ảnh | `components/avatar-crop-modal.tsx:185` | `input type="range"` không `aria-label` |

Đề xuất: thêm `aria-label` từ `vi.ts`. Chưa kiểm chứng `Input` của zmp-ui chuyển tiếp `aria-label` xuống thẻ `input` (nên viết test trước, nếu không thì dùng `Field label`). Test: `getByLabelText` cho từng ô.

### apps/web/src/lib/legal.ts và app/chinh-sach (vùng web, chỉ báo)

#### D8-5 (P1, chủ tự làm) — trang chính sách hiện chỗ trống chưa điền

Vị trí: `apps/web/src/lib/legal.ts:29` (`LEGAL_DRAFT_NOTICE = 'BẢN NHÁP — chờ Tubu Tree duyệt'`), chỗ trống `[Tên công ty]` (`:50,61,120`), `[Mã số thuế]` (`:51`), `[Địa chỉ trụ sở]` (`:52`), `[số ngày làm việc]` (`:207`), `[số ngày]` (`:237-238`). `apps/web/src/app/chinh-sach/[loai]/page.tsx:21` đặt noindex cho bản nháp. Mini App trỏ khách tới các trang này (`apps/miniapp/src/pages/about.tsx`, bảng `WEB_POLICY_SLUG`).

Kịch bản: khách bấm "Chính sách đổi trả" trong Mini App, mở web, đọc "Thời gian hoàn tiền: [số ngày làm việc]" và "do [Tên công ty] vận hành", dưới dòng "BẢN NHÁP".

Bằng chứng: trên API UAT `curl -s http://127.0.0.1:3221/api/config/legal/dieu-khoan` và `.../doi-tra` trả `"content":null`, tức web dùng bản nháp có chỗ trống. Các khoá chỉ có kiểm hợp lệ nội dung ở `system-config.service.ts:356-359`; kiểm go-live (`apps/api/src/config/go-live/`) không có khoá `legal.*` nào (`rg` ra 0).

Đề xuất: chủ nhập nội dung đã duyệt cho bốn khoá `legal.dieu-khoan|bao-mat|doi-tra|van-chuyen` ở tab Cấu hình trước khi mở khách (điền tên công ty, mã số thuế, địa chỉ, số ngày hoàn tiền/giao hàng). Agent có thể thêm kiểm go-live báo lỗi khi bốn khoá rỗng hoặc còn `[` `]`. Test: `go-live` spec với `legal.*` rỗng phải fail, có nội dung hợp lệ phải pass.

## Đã kiểm, loại (dương tính giả)

- Ảnh không `alt` (7, `img-no-alt`): đều là `Avatar` của zmp-ui, luôn vẽ `<img alt="">`, đặt cạnh tên người nên là trang trí: `reviews-section.tsx:297`, `pages/cashback.tsx:139,227`, `community-moderation.tsx:447,538`, `edit-profile.tsx:160`, `profile.tsx:223`.
- `field-id-only` (7): đều có `<label htmlFor>` khớp: `confirm-dialog.tsx:141-145`, `customer-refund-paid-dialog.tsx:272-311`, `merchant-fulfilment-tab.tsx:440-471`.
- Tương phản:
  - `confirm-dialog.tsx:178` (chữ trắng không nền): nền có điều kiện `bg-danger-fg`/`bg-forest-600`.
  - 13 nút admin `disabled:bg-stone-200 disabled:text-stone-500` (4,01:1): control vô hiệu hoá được miễn.
  - `reviews-tab.tsx:96` (sao admin 3,37 đến 3,73): biểu tượng, cần 3:1, đạt.
  - `dealer-price-history-tab.tsx:74` (mũi tên stone-400): `aria-hidden`, trang trí.
  - `brand-view.tsx:111`, `storefront-view.tsx:80`: Badge đã đè nền `--color-action-primary-bg`, chữ trắng 7,65:1.
  - `staff.tsx:204`: nút trong suốt trên thẻ nền tối (cùng thẻ dùng chữ `tone="inverse"`); chưa soi riêng nền thẻ.
  - `product-tile.tsx:183` (ngôi sao ★ vàng 11px): biểu tượng cạnh số điểm, 3,73:1 đạt 3:1.
  - `flash-sale.tsx:225` (`opacity 0.6` khi `pending`): trạng thái tạm; hai nền nút đạt (`--color-action-primary-fg` trên primary-bg 7,65).
  - Chữ trắng độ mờ 0,7 trên nền tối của thẻ đại lý (`pages/dealer.tsx:923-930`): 7,75:1 đạt; `--color-dealer-accent` trên `--color-dealer-ink` 5,98 đạt.
  - Các token `--color-dealer-accent`, `--color-rating`, `--color-action-primary-fg-disabled` dưới 4,5 trên nền sáng chỉ dùng cho nền tối, biểu tượng hoặc control vô hiệu hoá trong mã hiện tại (`rg` ra `dealer.tsx:930,957` cho dealer-accent).
- `image-upload.tsx:248` ném `Error('upload failed')` (tiếng Anh) nhưng khối `catch` ngay dưới (`:253-254`) thay bằng "Tải video thất bại, thử lại."; khách không thấy chữ Anh.
- `external-claims-tab.tsx:234` hiện `c.channel` thô cạnh nhãn Việt; giá trị là tên sàn (Shopee, TikTok...), không phải enum nội bộ. `waste-gifts-section.tsx:361` dùng `WASTE_GIFT_STATUS_LABELS`, đã Việt hoá.
- Ghim bài cộng đồng cho CSKH/MARKETING (`community-feed.controller.ts:317-322`) trái B8: đã có ở `D2-auth-pii.md` D2-02, không báo lại.

## Chưa làm / chưa kiểm chứng

- Không chạy trình đọc màn hình thật hay thiết bị: D8-8, D8-9 dựa trên mã. Không chụp ảnh tương phản thực tế sau khi áp lớp mờ/gradient; số trong D8-1 là tính trộn tuyến tính hai đầu gradient.
- Không đọc từng dòng các trang đơn hàng, ví, game, đại lý, CTV, hồ sơ ngoài những chỗ `static/strings.tsv` bắt được (từ Anh, từ lặp, dấu câu, chính tả phổ biến). Lỗi diễn đạt tinh tế hơn có thể còn sót.
- Không kiểm tra chữ hiện ra từ `apps/web/src` ngoài admin, ngoài `legal.ts`, `brand-origins.ts`, `home-text.ts`, `cau-chuyen/*` đã nêu.
- Chưa kiểm chứng `Input` zmp-ui chuyển tiếp `aria-label` (D8-9) và hàng bảng `page.tsx:1322` có phím thay thế.
- Chữ trong `apps/api` đi ra khách qua thông báo ZNS/OA thuộc nhánh D5, không soát ở đây.
