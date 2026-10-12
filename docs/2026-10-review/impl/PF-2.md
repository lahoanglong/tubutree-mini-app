# PF-2 — Miniapp: hành vi và hiển thị (Home, Danh mục, giá, ngày, key trùng, gợi ý sản phẩm)

Chỉ sửa `apps/miniapp`. Không đụng API, không chạy Playwright. Nhánh `hz16/PF-2`, base `0c481225`.

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| 1a. Home chớp khối lỗi/khung chờ khi tải lại nền; `retrying/isFetching` chết | XONG | a67f42b7 |
| 1b. Kệ "Mua lại" mất im lặng khi làm mới lỗi còn dữ liệu cũ | XONG | 63d1dcd4 |
| 1c. Danh mục: chạm chip không trả ô tìm về `state.q` | XONG | 9d600181 |
| 2a. `formatVnd` che giá thiếu thành "0đ" | XONG | 8bf69bc9 |
| 2b. Ngày dd/MM/yyyy chưa phủ hết các chỗ `toLocale*` trực tiếp | XONG (còn 2 file của gói khác) | 4eac6e57 |
| 2c. Guard thuật ngữ "TubuXu / Tubu Xu / xu" | Không có chỗ vi phạm; bổ sung guard | f4152db8 |
| 3. Cảnh báo React "same key" ở Điểm Xanh và Vườn | Không tái hiện được ở hai trang đó; tìm ra và sửa 2 nguồn thật ở Ví và Danh mục | 0d53e5d8 |
| 4. `/search/suggest` từ 1 ký tự ở ô chọn sản phẩm cộng đồng và CTV | XONG | 6751ace3 |

## Mục 1 — Home và Danh mục

Nguyên nhân gốc của 1a (đã kiểm bằng test với `QueryClient` thật, không dùng đối tượng query giả): React Query v5 đưa query lỗi và chưa có dữ liệu về trạng thái chờ (`isLoading=true`, `error=null`) mỗi lần nó tải lại, kể cả poll `refetchInterval: 60_000` của giờ vàng lẫn nút "Thử lại". Khối vẽ thẳng theo `isLoading/isError` nên khối lỗi biến mất (giờ vàng trả `null`) hoặc nhường chỗ cho khung chờ (các khối lưới) ở mỗi nhịp. Vì vậy `retrying={isFetching}` không bao giờ có cơ hội hiện: lúc `isFetching` true thì khối lỗi đã bị thay. Các test C-084 cũ không bắt được vì dùng đối tượng query giả có `isError: true, isFetching: true` cùng lúc, tổ hợp mà React Query thật không bao giờ tạo ra.

Đã làm:
- `components/home/use-block-query.ts` (mới): bọc kết quả `useQuery`, giữ trạng thái lỗi trong lúc tải lại; `isLoading/isPending` chỉ còn true ở lần tải đầu hoặc sau khi query bị reset (`errorUpdateCount` về 0). `isFetching` thật đi tới nút "Thử lại" nên nút báo đang tải đúng. Áp cho giờ vàng, Bán chạy, Tubu chọn cho bạn, Mới về vườn, Dành cho bạn và khối lỗi kệ "Mua lại" ở Trang chủ. Hệ quả kèm theo: "Tubu chọn cho bạn" không còn bị đẩy về khung chờ khi "Dành cho bạn" thử lại (nó chờ `forYou.isPending`).
- 1b: `PurchasedRail` trả `null` khi `q.isError` kể cả còn dữ liệu cũ (v5 giữ dữ liệu cũ, `status=error`), nên kệ biến mất. Nay chỉ ẩn khi không có món nào; còn dữ liệu cũ thì giữ kệ, thêm một dòng báo nhẹ (cùng câu `getErrorMessage`) và nút "Thử lại" 44px. Lỗi ở lần tải đầu vẫn ẩn (Trang chủ tự dựng khối lỗi; tab Đơn hàng giữ như cũ). Tải lại sau lỗi không còn chớp khung chờ.
- 1c: chip sắp xếp và chip lọc đang bật đi chung đường với nút "Hủy" (`leaveSearchField`: thoát chế độ gõ và `setDraft(state.q)`). Tình huống tái hiện: URL `?q=nuoc`, khách xoá chữ trong ô, chạm chip → trước đây ô trống trong khi lưới vẫn là kết quả của `nuoc`; chip lọc còn để nút "Hủy" kẹt thay giỏ.

Test (đỏ trước khi sửa, lý do đúng): `flash-sale.spec.tsx` 1 ca đỏ (vùng "Ưu đãi giờ vàng" biến mất khi tải lại); `home.spec.tsx` 3 ca đỏ (khung chờ chen vào khối Bán chạy; Tubu chọn cho bạn về khung chờ; nút Thử lại của Mua lại biến mất); `purchased-rail.spec.tsx` 2 ca đỏ; `browse.spec.tsx` 2 ca đỏ (ô tìm rỗng thay vì `nuoc`). `use-block-query.spec.tsx` (3 ca: lần đầu, tải lại khi lỗi, reset, làm mới lỗi còn dữ liệu) viết sau khi hook có, không có bước đỏ.

Test không mô phỏng được poll 60 giây thật: dùng `qc.refetchQueries` có promise treo, cùng đường chuyển trạng thái với `refetchInterval` (cả hai gọi `query.fetch()`). Không dùng đồng hồ giả vì nó làm treo `waitFor` của Testing Library.

## Mục 2 — Giá, ngày, thuật ngữ

2a. `formatVnd` đi qua `formatNumber` nên `null`, `undefined`, `''` và `NaN` ra "0đ", trong khi "0đ" là giá miễn phí hợp lệ. Nay giá thiếu hoặc không phải số hiện "—" (`MISSING_AMOUNT`); `0` và `"0"` vẫn "0đ"; nhận thêm chuỗi số (Decimal qua API). `formatVndShort` đổi theo cùng quy tắc. `formatNumber` không còn in "-0" (test đỏ thật: `formatVnd(-0)` ra "-0đ"). 4 ca đỏ trước khi sửa.

Rà các chỗ gọi: 138 lệnh `formatVnd(` ở mã không phải spec, tất cả khai báo kiểu `number`; những chỗ có thể thiếu đã tự ghi `?? 0` (giữ nguyên "0đ": `cashback.tsx`, `dealer.tsx`, `profile.tsx`, `admin.tsx`, `affiliate.tsx`, `my-payroll.tsx`) nên không đổi nghĩa. Chạy lại 36 spec có chữ "0đ" (577 ca) đều xanh. Chỗ có thể đổi hiển thị khi dữ liệu thật thiếu (không sửa vì ngoài nhóm file): `checkout-rules.ts:38` ("cần thêm ${formatVnd(total - balance)}" ra "—" nếu số dư thiếu thay vì "0đ"), `i18n/vi.ts:459` (`formatVnd(minOrder)` khi cấu hình thiếu), các chuỗi ghép `-${formatVnd(...)}` ở checkout/cart (có điều kiện `> 0` hoặc số do máy chủ trả).

2b. Có 11 chỗ gọi `toLocaleDateString('vi-VN')` và 1 chỗ `toLocaleString` trực tiếp: đánh giá sản phẩm, gói định kỳ, đại lý (2), đổi vỏ chai, kiểm duyệt cộng đồng, thông báo, sự kiện cộng đồng, cộng tác viên, và `groupThousands` ở `checkout-rules.ts`. Đã chuyển sang `formatDate`/`formatNumber`. Spec đổi vỏ chai tự tính kỳ vọng bằng chính `toLocaleDateString` (ra "15-03" trên Node này) nên che đúng lỗi; đổi sang chuỗi cố định "15/03/2026". Ngày đổi vỏ chai nay có thêm năm (trước chỉ dd/MM).
- Guard mới trong `pages/format-guard.spec.ts`: quét toàn bộ `src`, chỉ `utils/format.ts` được gọi `toLocale*`. Đỏ trước khi sửa (9 file). Hai file thuộc phạm vi gói PF-1 vẫn còn gọi trực tiếp và nằm trong danh sách ngoại lệ có kiểm ngược (ca thứ hai báo đỏ nếu file đã sạch mà quên xoá khỏi danh sách): `components/orders/order-card.tsx:78` và `components/checkout/voucher-sheet.tsx:160`. Việc còn lại: đổi hai dòng đó sang `formatDate`, xoá `OWNED_ELSEWHERE`.
- Các file ngoài danh sách nhóm nhưng nằm trong chính mục này (mỗi file một dòng đổi): `components/reviews-section.tsx`, `components/subscriptions-panel.tsx`, `pages/{dealer,refill,community-moderation,notifications,community-events,affiliate}.tsx`, `utils/checkout-rules.ts`. Điều phối viên nên soát xung đột khi gộp với các gói khác.

2c. Hiện không còn "TubuXu"/"Tubu Xu" ở mã hiển thị (PD-3 đã gộp vào Điểm Xanh; guard cũ vẫn xanh). Quét chữ "xu" đứng riêng bằng regex Unicode trên toàn bộ mã không phải spec: chỉ còn cụm "xu cũ" dùng để giải thích lô điểm quy đổi (`vi.ts:376` nhãn XU, `wallet-rules.ts:36`, `about-data.ts:33`, `account-api.ts:235`). Giữ nguyên vì đó là chữ giải thích có chủ đích của PD-3 (lô này không hết hạn, quy tắc khác lô thường); nếu chủ dự án muốn bỏ hẳn chữ "xu" thì đổi 4 chuỗi này. Guard cũ chỉ bắt "TubuXu" và "Tubu Xu"; mở rộng thêm các dạng viết khác (khoảng trắng không-ngắt, gạch nối) và chữ "xu" đứng riêng làm đơn vị tiền (chừa "xu cũ", "xu hướng"), kèm ca đối chứng cho hai regex. Đây là guard phòng ngừa, không có bước đỏ.

## Mục 3 — Cảnh báo React "same key"

Điểm Xanh và Vườn: không tái hiện được với dữ liệu đúng hình của API. Đọc `apps/api`: mã giảm giá `Coupon.code @unique`; phần thưởng đổi điểm có `id` cố định trong `DEFAULT_REWARD_CATALOG`; 7 ô điểm danh `day = idx + 1`; hạng `tiers[].id`; nhiệm vụ `Mission.code @unique`; chứng nhận cây `certificateCode @unique`; bảng xếp hạng tuần và mùa `rank = i + 1`; Chặng Mùa mỗi hạng một dòng. Mọi `key` trong `pages/loyalty.tsx` và `components/game/*` đều lấy từ các giá trị này hoặc từ chỉ số. Chỗ lỗi mã duy nhất là bảng tuần (PE-1b đã sửa). Cảnh báo mà bộ chụp ảnh thấy là do dữ liệu giả (`fabricate.mjs`) gán `rank/day/tier` trùng, như PE-1b đã kết luận. Bằng chứng giữ lại: `components/game/leaderboard-keys.spec.tsx` (10 ca: 1 đến 25 người chơi trùng nickname, trùng số giọt nước, chuỗi ngày, số cây, cho cả bảng tuần và bảng mùa); hai ca sẵn có `loyalty-behavior.spec.tsx` và `game-behavior.spec.tsx` dựng mọi danh sách bằng dữ liệu đúng hình và đếm `console.error`. Không sửa mã ở hai trang này vì không có lỗi.

Hai nguồn trùng thật tìm được trong cùng nhóm file: sao kê Ví (`pages/wallet.tsx`) và lưới Danh mục (`pages/browse.tsx`) nối trang theo số trang (`page/limit`, `skipTake`). Nếu dữ liệu đổi giữa hai lần tải (giao dịch mới chen vào sao kê xếp mới trước; bán chạy xếp lại; sync Pancake 15 phút) thì dòng cuối trang 1 lặp lại ở đầu trang 2: khách thấy một dòng hai lần và React báo "two children with the same key". Đã thêm `utils/unique-by-id.ts` (`uniqueById`) và áp cho hai nơi. Test dựng đúng tình huống (trang 2 lặp dòng cuối trang 1), đỏ trước khi sửa (hiện hai dòng); xanh sau đó, kèm khẳng định không có cảnh báo key.
Cùng kiểu lỗi chắc chắn có ở các danh sách nối trang khác ngoài nhóm file (tab Đơn hàng, Feed, cộng đồng); chưa kiểm, gói sở hữu các trang đó nên dùng `uniqueById`.

## Mục 4 — Gợi ý sản phẩm từ 2 ký tự

`/search/suggest` gấp dấu rồi trả `[]` cho dưới 2 ký tự, nhưng `components/community/product-picker.tsx` và `components/affiliate/ctv-order-sheet.tsx` gọi từ 1 ký tự và hiện "Không tìm thấy sản phẩm phù hợp" sai. Nay hai ô gọi API chỉ khi `isSuggestable` (export từ `hooks/use-suggest.ts`, cùng ngưỡng `SUGGEST_MIN_CHARS` của ô tìm Danh mục, tính theo từ khoá đã gấp dấu nên "đ" và " a " chưa đủ) và hiện "Nhập ít nhất 2 ký tự" (`vi.common.suggestMinChars`). Cổng xét cả từ khoá đang gõ chứ không chỉ bản đã debounce nên xoá về 1 ký tự thì gợi ý ẩn ngay. Không đổi API. 7 ca mới (5 ca đỏ trước khi sửa vì không thấy câu báo; 2 ca còn lại là đối chứng ngưỡng và ô trống, xanh sẵn), tất cả xanh sau khi sửa.

## Lệnh kiểm và kết quả thật

Chạy trong `apps/miniapp` của worktree, `PATH` Node 22.23.3:

- `npx tsc --noEmit`: exit 0.
- `npx eslint --max-warnings=0 <37 file .ts/.tsx đã sửa hoặc thêm>`: exit 0 (cả ESLint `tubu-ds`).
- `npx vitest run <51 spec đã sửa hoặc nhắc "0đ" + các thư mục src/components/{home,game,reorder,community,affiliate,catalog} src/hooks src/utils src/i18n>`: exit 0, 107 file, 1357 ca xanh.

## Chưa verify

- Không chạy Playwright e2e và không chạy toàn bộ vitest của miniapp (theo phân công); các spec ngoài danh sách trên chưa chạy lại sau khi `formatVnd`/`formatNumber` đổi.
- Chưa xem bằng mắt: dòng báo lỗi nhẹ của kệ "Mua lại" (bố cục 320/375/390px), nút "Thử lại" trong khối lỗi lúc báo đang tải, câu "Nhập ít nhất 2 ký tự" ở hai ô chọn. Vùng chạm 44px dựa vào `Button` DS v2, chưa đo.
- Chưa thử trong WebView Zalo thật: `useBlockQuery` phụ thuộc đúng hành vi React Query v5 (đã kiểm bằng `QueryClient` thật trong jsdom).
- Poll 60 giây của giờ vàng không chạy thật (xem mục 1).

## Rủi ro

- `useBlockQuery` giữ lỗi trong lúc tải lại: nếu khối lỗi cũ không còn đúng (vd khách đã có mạng lại) khách vẫn thấy khối lỗi cho tới khi lượt tải xong, chỉ khác là nút báo đang tải.
- `formatVnd` hiện "—" cho dữ liệu thiếu ở mọi màn có gọi; nếu API từng trả `null` cho khoản miễn phí (vd phí ship) thì màn đó đổi từ "0đ" sang "—". Chưa thấy chỗ nào như vậy trong DTO, nhưng chưa quét hết dữ liệu thật.
- Ngày đổi vỏ chai có thêm năm.
- Hai file ngoại lệ trong guard ngày (`order-card.tsx`, `voucher-sheet.tsx`) cần chủ gói tương ứng dọn.
