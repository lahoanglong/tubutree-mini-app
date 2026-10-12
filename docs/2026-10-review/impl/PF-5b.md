# PF-5b: Dọn các minor còn lại từ review PF-1 đến PF-4

Nhánh `hz17/PF-5b`, base `6c504cf8`. Chỉ đụng file trong nhóm của gói (miniapp, web, `apps/api/src/modules/content-kit`); không đụng `apps/e2e` (không có selector nào bị đổi), không đụng `game/loyalty/reviews/checkout` của API. Không push, không deploy, không ghi DB dùng chung; cổng Postgres 5702 được cấp nhưng không cần dùng (không có race spec).

Commit theo từng mục: `17c349c1` (mục 1), `066aa1e6` và `b7a5b0e0` (mục 2), `c76f1ca2` (mục 3), `4d5a0635` (mục 4), `9df788da` và `bceb000b` (mục 5), `2dfee4ae` (mục 6), `db8f68db` (mục 7), `e99b6c23` (mục 8), `bca06277` và `d6970953` (mục 9), cùng commit báo cáo này. `b7a5b0e0` chỉ sửa lỗi kiểu tsc ở hai spec mới của mục 2 và 3 (vitest xanh nhưng `tsc --noEmit` báo chỉ số có thể undefined); `bceb000b` bỏ chập chờn của một ca ở mục 5 (xem dưới).

| Mục | Kết quả |
|---|---|
| 1. Trang chi tiết sản phẩm: một h1 ở mọi trạng thái | ĐÃ SỬA |
| 2. Hợp đồng chấm chọn không tên (inert) | ĐÃ SỬA (đổi ca test, sửa chú thích, thêm test tĩnh) |
| 3. Tương phản chữ ngày giờ ở khung trạng thái đơn | ĐÃ SỬA |
| 4. Thông báo "Đã cộng Điểm Xanh" khi pointsEarned = 0 | ĐÃ SỬA |
| 5. `useBlockQuery` ghi nhớ lỗi theo từng lần mount | TÁI HIỆN ĐƯỢC MỘT PHẦN, ĐÃ SỬA (phần "dùng chung giữa các instance" không phải lỗi) |
| 6. Ghim bản đồ brand-story dùng data-testid | ĐÃ SỬA |
| 7. Form đối tác: bảo vệ đủ cặp label for/id | ĐÃ SỬA (một chỗ page đỏ, đã sửa page) |
| 8. Guard ngày giờ của web | ĐÃ MỞ RỘNG, không còn chỗ vi phạm |
| 9. Link Content Kit ở nơi sinh | PHÂN LOẠI: API không sai (giữ), Mini App sửa đường web; kèm hai sửa nhỏ ở API |

## Mục 1: một h1 ở mọi trạng thái của product-detail

Đúng như báo cáo PF-1: chỉ trạng thái bình thường có h1 (tên sản phẩm). `PdpSkeleton` và nhánh lỗi/không thấy sản phẩm đều không có. Thêm h1 ẩn `Chi tiết sản phẩm` (`SR_ONLY`, như bank-payment) ở cả hai, hằng `PDP_TITLE` chung. Trạng thái bình thường giữ nguyên (h1 là tên sản phẩm), nên mỗi route đúng một h1.

Test (`pages/product-detail-a11y.spec.tsx`): đang tải, lỗi tải, và API trả rỗng; mỗi ca đúng một h1 tên "Chi tiết sản phẩm". Cả ba đỏ trước khi sửa vì không có h1 nào; ca bình thường có sẵn vẫn xanh.

## Mục 2: hợp đồng chấm chọn không tên

Xác minh: `hitArea` có `inert` cho chấm không tên nên cú chạm không tới input, chỉ tới hàng cha; jsdom bỏ qua `inert` nên ca `Checkbox không tên vẫn nhận onChange khi bấm` (gọi `input.click()` trực tiếp) xanh giả. Ca đó đã được thay: kiểm hit-area có `inert` và `aria-hidden`, một cú chạm vào hit-area tới `onClick` của hàng cha đúng một lần và `onChange` của chấm không bị gọi. Chú thích `DECORATIVE_INPUT` ở `form.tsx` viết lại: chấm không tên là thuần hình, không nhận bấm, không phát onChange; hàng cha giữ `onClick`; chấm không tên chỉ đi với `onChange={() => {}}`; nêu rõ jsdom không mô phỏng inert.

Test tĩnh mới `components/ui/form-decorative-usage.spec.ts` (đọc mã nguồn, bỏ chú thích, tách thẻ JSX mở bằng đếm ngoặc): mọi chỗ gọi `<Checkbox|Radio|Switch>` không tên chỉ được dùng `onChange={() => {}}`. "Có tên" gồm `label`, `aria-label`, `aria-labelledby`, `id`, hoặc có children; chấm bọc ngay trong `<Field>` được coi là có tên. Props lan truyền `{...rest}` không phân xử được nên báo vi phạm thay vì bỏ qua. Hiện tại sạch: 4 chấm không tên ở `checkout.tsx` và 1 ở `subscription-options.tsx` đều dùng no-op. Đã chạy đột biến: đổi `onChange={() => {}}` ở ô hoá đơn VAT của checkout thành hàm thật thì guard đỏ (báo `pages/checkout.tsx:644`), đã trả lại file. Bộ quét có 7 ca đơn vị riêng (vi phạm, hợp lệ nhiều dòng, có nhãn, chuỗi chứa "id=", Field, spread, không nhầm `Radio.Group`/`RadioRow`/`SwitchRow`/chú thích) để guard không vô nghĩa.

## Mục 3: tương phản khung trạng thái đơn

Giá trị token thật (`packages/design-tokens/src/tokens.css`), tương phản của chữ đầy đủ (không opacity) so với nền, tính bằng công thức WCAG như `tokens.spec.ts`; cột cuối là cùng cặp màu với `opacity: 0.8` trộn lên nền:

| Trạng thái | Chữ trên nền | opacity 1 | opacity 0.8 |
|---|---|---|---|
| Chờ thanh toán | `#8A5300` trên `#FFF4E0` | 5,81 | 3,85 (axe báo 3,84) |
| Đã xác nhận, Đã đóng gói | `#1B4B31` trên `#EEF4EF` | 8,97 | 5,26 |
| Đang giao | `#2E6391` trên `#E8F0F7` | 5,51 | 3,69 |
| Đã giao | `#2F7A48` trên `#EAF4EC` | 4,66 | 3,28 |
| Đã trả hàng | `#5A544A` trên `#EFEBE2` | 6,30 | 4,01 |
| Đã huỷ | `#B3362F` trên `#FBEAE8` | 5,17 | 3,71 |

Vậy `opacity: 0.8` làm hỏng năm trong sáu cặp, không riêng chờ thanh toán (axe chỉ báo một nút vì bộ chụp dùng đơn ở trạng thái đó). Bỏ opacity ở `pages/order-detail.tsx` dòng chữ ngày giờ; ý "phụ" giữ bằng cỡ chữ `xSmall` không đậm dưới tiêu đề trạng thái đậm. Cả sáu cặp token đầy đủ đạt từ 4,66 trở lên.

Test (`pages/order-detail.spec.tsx`): với từng trạng thái trong `STATUS_COLOR`, chữ ngày giờ không có opacity khác 1 (đỏ trước khi sửa: `opacity=0.8` ở cả 7 trạng thái); và tương phản từng cặp token đầy đủ đọc từ `tokens.css` >= 4,5 (xanh sẵn, là bằng chứng của bảng trên, và để cặp màu đổi trong tương lai không lùi dưới ngưỡng).

## Mục 4: thông báo khi tạo lại đánh giá không được thưởng

Response thật (`reviews.service.ts`, `save`/`createFirst`): `{ ...dòng Review, updated }`, trong đó `pointsEarned` là cột của dòng Review: 5/10/15 khi được thưởng, 0 khi khách còn giữ phần thưởng cũ (PF-3), và với `updated: true` là phần thưởng của lần tạo gốc (không phải lần này). Kiểu `createReview` của `shop-api.ts` chưa khai báo `pointsEarned` (file ngoài nhóm), nên `reviews-section.tsx` dùng kiểu cục bộ `CreatedReview`.

Logic mới: `updated` thì "Đã cập nhật đánh giá của bạn" (như cũ, không nhắc điểm dù `pointsEarned` của dòng gốc > 0); không thì `pointsEarned > 0` ra "Cảm ơn đánh giá của bạn! Đã cộng N Điểm Xanh" (N qua `formatNumber`); ngược lại (0, thiếu trường) ra "Đã gửi đánh giá của bạn". Test: 4 ca đỏ trước khi sửa (hai ca cũ đổi kỳ vọng sang có N, hai ca mới cho `pointsEarned: 0` và thiếu trường), ca `updated: true` kèm `pointsEarned: 10` xanh cả trước lẫn sau. Câu gợi ý "+5/+10/+15 Điểm Xanh" nằm TRƯỚC khi gửi (dòng 357-362) không đổi: nó không biết khách đã được thưởng ở lần trước hay chưa (xem Rủi ro).

## Mục 5: `useBlockQuery` ghi nhớ lỗi theo từng lần mount

Xác minh trên mã: `lastError` là `useRef` nên không dùng chung giữa các instance; ca "hai instance trên hai query khác nhau không lẫn lỗi" và ca "lần mount mới tự thấy lỗi mới thì hiện đúng lỗi đó" xanh sẵn (đối chứng, không phải lỗi). Nhưng tái hiện được hai chỗ lệch có thật, đo bằng probe trước khi viết test:

1. Instance gắn vào giữa lúc tải lại sau lỗi (instance thứ hai cùng query, vd `PurchasedRail` và Home cùng dùng `usePurchasedItems`, hoặc mount lại sau khi unmount) trả `isError: true` với `error: undefined`. React Query v5 bỏ lỗi (`error = null`) khi tải lại nên ref mới không có gì để nhớ: khối báo lỗi chung chung không có lỗi thật.
2. Cùng một instance đổi key sang query khác (đang tải lại sau lỗi cũ của nó) mượn lỗi của query trước.

Sửa: ref nhớ `{ error, errorUpdatedAt }` của query đã gây lỗi. "Tải lại sau lỗi" chỉ áp khi chính lần mount này đã thấy lỗi đó và `errorUpdatedAt` còn khớp; ngược lại coi là lần tải đầu của nó (khung chờ). Ba ca đỏ trước khi sửa: hai instance, unmount rồi mount lại, đổi key. Hai ca đối chứng xanh cả trước lẫn sau.

Giới hạn ghi trong chú thích hook: hai lỗi trùng đến từng mili giây (hai query khác nhau cùng lỗi trong một mili giây và một instance đổi qua lại giữa chúng) không phân biệt được. Chính giới hạn này làm ca đổi key chập chờn khi chạy cả bộ song song (lỗi của query B nạp sẵn và lỗi của A rơi cùng mili giây): `bceb000b` cách ra 5 ms trong test. Hệ quả hành vi cần biết: instance mount giữa lúc tải lại giờ hiện khung chờ thay vì khối lỗi không có nội dung; instance cũ vẫn hiện khối lỗi kèm nút "Thử lại" đang quay như PF-2 đã làm.

Đã so cảnh báo `act(...)`: 3 cảnh báo (ở `HomePage`) có cả trước lẫn sau sửa (so bằng bản hook cũ lấy từ `git show HEAD`), không do gói này.

## Mục 6: ghim bản đồ brand-story

Đổi: ghim là `button` `aria-hidden` + `tabIndex={-1}` mang `data-testid="brand-pin-<id>"` thay vì `aria-label` "<nhãn> — <tỉnh>" (không đọc ra cho ai). Spec cập nhật: `tile()` tra theo testid, helper `gridTile` không còn phải loại nút có `aria-label` (`getAllByRole` đã bỏ ghim vì `aria-hidden`), thêm khẳng định ghim không còn `aria-label`. `grep` `apps/e2e` và `scripts` không có chỗ nào tra ghim theo nhãn này (chỉ `scripts/uiux/routes.mjs` khai báo route), nên không đổi e2e. 17 ca spec xanh; 13 ca đỏ lúc đổi spec trước khi đổi mã.

## Mục 7: form đối tác, cặp label for/id

Spec `merchant/page.spec.tsx` thêm `labelPairProblems` (cục bộ, vì `test-utils/a11y.ts` ngoài nhóm): mỗi `label[for]` phải trỏ tới `input/select/textarea` có thật; mỗi `input/select/textarea` (trừ hidden, submit, button, reset, image) phải có `el.labels.length > 0`. Áp cho cả năm tab và form thêm sản phẩm, kèm một ca chứng minh hàm bắt được `label[for]` trỏ hụt và ô không có label.

Kết quả: cả 21 `htmlFor` có sẵn trên trang khớp `id` (không cặp nào hỏng); đúng một chỗ đỏ là `select` lọc trạng thái đơn (tab Đơn Hàng Thuộc Kho) chỉ có `aria-label`. Sửa trang: thay bằng `<label htmlFor="merchant-orders-status" className="sr-only">` cùng `id` (cách ô tìm kiếm của site đã dùng); `label` tuyệt đối nên không đổi bố cục flex. Ca test bộ lọc chuyển selector sang `select#merchant-orders-status` và kiểm `select.labels[0]` có đúng chữ.

## Mục 8: guard ngày giờ của web

Cách số đang được web định dạng: `n.toLocaleString('vi-VN')` thẳng tay ở 14 chỗ trong 11 file (không có `formatNumber` như Mini App), nên regex không phân biệt được số với ngày. Quyết định (theo phương án dự phòng của đề): 
- `toLocaleDateString`, `toLocaleTimeString`, `dateStyle`, `timeStyle` và `Intl.DateTimeFormat` bị cấm hẳn trong mọi file nguồn (trừ `lib/format-date.ts` và `lib/export-csv.ts` như cũ); ngoại lệ có tên file và lý do: `lib/loyalty-pos.ts` (`vnDayKey`, khoá máy `YYYY-MM-DD` en-CA khớp `dayKey` của BE, không phải chữ hiển thị);
- `.toLocaleString(` bị cấm khi đứng trên `new Date(...)` (đếm ngoặc cân bằng, nên `new Date(f(x)).toLocaleString(` cũng bị bắt) hay kèm tuỳ chọn ngày giờ (`year`, `month`, `day`, `hour`, `minute`, `second`, `weekday`, `timeZone`...); mọi lần gọi còn lại phải nằm trong `NUMBER_TO_LOCALE_STRING`: 11 file, số lần, lý do là số (điểm, tiền, phần trăm, ngưỡng). Thêm một lần gọi mới là phải mở spec xác nhận.

Giới hạn ghi trong comment spec: một `.toLocaleString(` trên biến ngày (không phải `new Date(...)`, không kèm tuỳ chọn) nằm trong file đã có tên trong danh sách chỉ bị bắt khi số lần gọi tăng. Không còn chỗ vi phạm sẵn nên không sửa file web nào. Đã chứng minh guard bắt được các kiểu regex cũ bỏ lọt: thêm file tạm chứa `d.toLocaleString('vi-VN')`, `new Date(JSON.parse(x).at).toLocaleString(...)` và `d.toLocaleString('vi-VN', { hour: '2-digit' })` thì ba ca đỏ (số đếm và ngày), đã xoá file. Bộ quét có ca đơn vị riêng (5 kiểu ngày bị bắt, 4 kiểu số được chừa, 4 cách viết chỉ-dành-cho-ngày).

## Mục 9: link Content Kit ở nơi sinh

Xác minh `app.miniapp_base_url` trỏ Mini App, không phải web:
- Tên khoá và mô tả khi gieo: "URL gốc Mini App dùng dựng link chia sẻ" (`scripts/audit/seed-audit-personas.ts:651`, giá trị audit `http://localhost:3213` là cổng dev của Mini App, `scripts/audit/README.md:11`).
- Test cũ của dịch vụ dùng `https://zalo.me/s/123` làm base, tức dạng URL Mini App; `/product/:slug` là route thật của Mini App (`apps/miniapp/src/components/app.tsx:193`).
- Runbook (`docs/2026-07-05-batch2-deploy-UAT-runbook.md:126`) nói khoá này không có trong seed, mặc định rỗng, phải đặt tay sau deploy.

Kết luận: `ContentKitService` ghép `${baseUrl}/product/<slug>` đúng với Mini App, GIỮ NGUYÊN (ghi bằng test hợp đồng: base `https://zalo.me/s/123` ra `shareLink` và `{link}` trong bài mẫu đều là URL tuyệt đối vào `/product/<slug>`). Nơi thật sự đi tới domain WEB là `absoluteLink` của Mini App: khi base trống API trả đường dẫn tương đối `/product/<slug>?ref=..` và Mini App ghép `WEB_BASE_URL` (`app.tubutree.com`), nơi trang sản phẩm là `/san-pham/<slug>` và `/product/<slug>` chỉ sống nhờ redirect 307 của PF-4.

Sửa ở Mini App (`content-kit-sheet.tsx`): `absoluteLink` đổi `/product/` sang `/san-pham/` khi ghép domain web; URL tuyệt đối (base cấu hình) giữ nguyên. Bài mẫu: `{link}` do API chèn là đường dẫn tương đối (khi base trống), nên chép ra "Mua ngay /product/x?ref=.." không mở được; nay bài mẫu hiện và chép với link web tuyệt đối đúng đường (thay chỉ khi đứng đầu từ, đầu chuỗi hoặc sau khoảng trắng/ngoặc mở, để link tuyệt đối admin gõ sẵn không bị chèn domain hai lần; không dùng lookbehind vì webview Zalo cũ trên iOS không hiểu cú pháp này). Nút "Chia sẻ Zalo" giữ `path: /product/<slug>` (đường trong Mini App), có test ghim. Redirect 307 của PF-4 ở web giữ nguyên cho link đã chia sẻ. Test vitest: ba ca cũ đổi kỳ vọng sang `/san-pham/`, thêm ba ca (bài mẫu mang link tương đối; URL Mini App giữ nguyên; path Zalo giữ `/product/<slug>`). Bốn ca đỏ trước khi sửa (ba ca cũ đã đổi kỳ vọng và ca bài mẫu); ca URL Mini App xanh sẵn (đối chứng); ca path Zalo thêm sau khi đã sửa mã nên chưa có bước đỏ. Ca cũ "chạm bài mẫu" có bài mẫu chứa sẵn link tuyệt đối vẫn xanh: đó là ca bắt lỗi chèn domain hai lần ở lần sửa đầu (split/join), đã thấy đỏ rồi mới đổi sang regex neo đầu từ.

Sửa nhỏ thêm ở API (cùng nơi sinh link, đã thấy khi xác minh):
- Base có dấu `/` ở cuối (admin gõ thừa) sinh `...//product/<slug>`; nay bỏ `/` cuối. Test đỏ trước khi sửa (`https://zalo.me/s/123///product/...`).
- Giá trị cấu hình lưu `null`, số hay đối tượng (cấu hình là JSON) trước đây sinh chuỗi "null/product/..."; nay coi là chưa cấu hình (đường dẫn tương đối), không ném lỗi. Test này đỏ với `TypeError: Cannot read properties of null (reading 'trim')` trên bản sửa dở chỉ gọi `.trim()`, nên mã cuối kiểm `typeof === 'string'` trước.

## Lệnh kiểm và kết quả thật

Mọi lệnh bắt đầu bằng `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, chạy ở trạng thái cuối (sau commit `bceb000b`) trong worktree.

| Lệnh | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `apps/api: npx prisma generate` | thoát 0 |
| `apps/miniapp: npx tsc --noEmit` | thoát 0 |
| `apps/miniapp: npx eslint --max-warnings=0 <15 file .ts/.tsx đã sửa hoặc thêm>` (kèm luật `tubu-ds`) | thoát 0 |
| `apps/miniapp: npx vitest run src/components/{ui,home,reorder,flash-sale} + reviews-section + content-kit-sheet + subscription-options + src/pages/{product-detail,order-detail,brand-story,checkout,cart,home}* + format-guard + ds-c076-pc10b` | thoát 0: 56 file, 585 ca xanh |
| `apps/web: npx tsc --noEmit` | thoát 0 |
| `apps/web: npx vitest run src/app/merchant src/lib` | thoát 0: 20 file, 267 ca xanh |
| `apps/web: npx next lint --max-warnings=0 --file <3 file đã sửa>` | thoát 0, không cảnh báo |
| `apps/web`: ESLint 9 với cấu hình tạm ngoài repo chỉ có `tubu-ds/no-raw-color` và `tubu-ds/icon-button-aria-label` (`--no-inline-config`) trên `merchant/page.tsx` | thoát 0 |
| `apps/api: npx tsc --noEmit -p tsconfig.json` | thoát 0 |
| `apps/api: npx eslint --max-warnings=0` trên hai file content-kit | thoát 0 |
| `apps/api: npx jest src/modules/content-kit` | thoát 0: 1 suite, 16 ca xanh |
| Đột biến (mục 2): ô VAT của checkout đổi thành onChange thật | guard đỏ (`pages/checkout.tsx:644`), đã trả lại file |
| Đột biến (mục 8): file tạm chứa ba kiểu `toLocaleString` trên ngày | hai ca guard đỏ, đã xoá file |

Đỏ trước khi sửa: mục 1 (3 ca), mục 3 (7 ca), mục 4 (4 ca), mục 5 (3 ca), mục 6 (13 ca lúc đổi spec trước mã), mục 7 (1 ca: select bộ lọc), mục 9 (4 ca miniapp, 2 ca API). Mục 2 và mục 8 không có điều gì để sửa ở mã nguồn nên bước đỏ là đột biến ở bảng trên; mục 2 có ca đổi hợp đồng (ca thay thế xanh ngay, vì chỉ là bỏ khẳng định sai).

## Chưa verify

- Không chạy Playwright e2e, capture/axe, full suite, `next build`, hay race spec (đề bài cấm chạy; điều phối viên chạy). Hệ quả: tương phản `order-detail` mới được chứng minh bằng tính toán từ token và test style, chưa đo lại bằng axe trên trình duyệt; h1 của product-detail ở ba trạng thái mới đo bằng Testing Library, chưa bằng axe `page-has-heading-one`.
- `inert` và hợp đồng chạm xuyên qua hàng cha vẫn chưa kiểm trên webview Zalo thật (đã nêu ở PF-1); mục 2 chỉ sửa chú thích và test.
- Mục 5: hành vi "instance mount giữa lúc tải lại hiện khung chờ" chỉ kiểm bằng `renderHook` với `QueryClient` thật; chưa xem trên Home thật khi chuyển tab qua lại lúc API chậm.
- Mục 9: không biết giá trị thật của `app.miniapp_base_url` trên PROD (runbook nói chưa đặt, mặc định rỗng). Nếu admin đặt nhầm URL web vào khoá này thì link vẫn mở được nhờ redirect 307 nhưng đi một bước vòng.
- Mục 9: không kiểm trên Zalo thật việc dán link `app.tubutree.com/san-pham/<slug>?ref=...` mở đúng trang và ghi nhận `ref` (PF-4 báo `ReferralCapture` ở layout web làm việc đó).

## Rủi ro và việc ngoài nhóm file

- Mục 4: câu gợi ý trước khi gửi ("Thêm video +15 / ảnh +10 Điểm Xanh") vẫn hứa điểm cho khách đã nhận thưởng ở lần trước (sau PF-3 sẽ không được cộng lại). Muốn đúng hẳn thì `canReviewProduct` phải trả thêm "đã nhận thưởng"; API và `shop-api.ts` ngoài nhóm nên chưa làm. `shop-api.ts` (`createReview`) nên khai báo thêm `pointsEarned?: number` rồi bỏ kiểu cục bộ `CreatedReview` ở `reviews-section.tsx`.
- Mục 9: `shareLink` của API vẫn dùng chung cho hai việc (đường `path` của Zalo và link sao chép), như A5-20 của kiểm toán 2026-09; gói này không tách thành `sharePath` và `shareUrl`. Khi base cấu hình là URL tuyệt đối thì `path` của nút Chia sẻ Zalo là URL tuyệt đối chứ không phải đường trong Mini App; chưa kiểm hành vi của `shareLink` ở Zalo với trường hợp này.
- Mục 5: lần mount mới giữa lúc tải lại hiện khung chờ thay vì khối lỗi; nếu muốn hiện lỗi thật cho instance này thì cần chuyển trạng thái lỗi vào bộ nhớ đệm chung (theo query), cần đổi chữ ký hook (thêm `queryKey`) và đổi chỗ gọi ở `pages/home.tsx`, `components/flash-sale.tsx`, `components/reorder/purchased-rail.tsx` (ngoài nhóm).
- Mục 8: 11 file web còn gọi `n.toLocaleString('vi-VN')` trực tiếp cho số; nên có `formatNumber` dùng chung ở web như Mini App (việc ngoài nhóm, nhiều file).
- `form-decorative-usage.spec.ts` chỉ quét `.tsx` không phải spec và bỏ `components/ui/form.tsx`; chấm không tên được dựng qua một wrapper khác (không gọi `<Checkbox|Radio|Switch>` trực tiếp) sẽ không bị quét.
