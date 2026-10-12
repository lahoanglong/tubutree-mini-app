# PF-4: Web a11y admin/đối tác, lỗi PC-7 và PC-9 trên web, cảnh báo key admin-config

Nhánh `hz16/PF-4`, base `0c481225`. Chỉ đụng `apps/web/src/**` (kèm một fixture trong `src/test-utils`). Không sửa `apps/api`, `apps/miniapp`, `apps/e2e`. Không push, không deploy, không ghi DB dùng chung; cổng Postgres 5604 được cấp nhưng không cần dùng.

Commit: `c7cf0f1a` (mục 1), `bd3bb7d0`, `45d4f78f`, `2c596491` (ba lỗi PC-7), `ee4bccca` (mục 3), `bfd974dd` (mục 4, chỉ thêm test), commit kế tiếp là báo cáo này.

## Mục 1: axe serious/critical trên web

Đo bằng `scripts/uiux/capture.mjs web --states normal --force`, 36 route x 2 viewport (390 và 1440), một lần trước khi sửa và một lần sau khi sửa xong cả bốn mục. Server dev web chạy ở 3112, API thật ở 3001, mock theo kiểu của bộ chụp.

Trước: 28 node serious và 28 node critical, trên 25 dòng route/viewport (cộng hai dòng `merchant-denied` thiếu h1 và main). Sau: 0 serious, 0 critical ở cả 72 dòng, không dòng nào lỗi chụp. Mỗi route trước đó có lỗi, đã về 0:

| Route | Lỗi trước (số node) | Sau |
|---|---|---|
| admin-dealers, admin-orders, admin-returns (390 và 1440) | select-name x1 | 0 |
| admin-users (390) | select-name x1, scrollable-region-focusable x1 | 0 |
| admin-users (1440) | select-name x1 | 0 |
| admin-coupons (390 và 1440) | select-name x1, label x2 | 0 |
| admin-brands (390 và 1440) | select-name x2 | 0 |
| admin-flashSales (390 và 1440) | label x2 | 0 |
| admin-dashboard (390) | scrollable-region-focusable x1 | 0 |
| admin-faqs, admin-quickReplies (1440) | target-size x12 mỗi route | 0 |
| merchant-1, merchant-ctv (390 và 1440) | label x1 | 0 |
| merchant-2 (390 và 1440) | select-name x1 | 0 |
| merchant-4, merchant-5 (390) | scrollable-region-focusable x1 | 0 |
| merchant-denied (390 và 1440) | không có h1 và không có main | h1 = 1, có main |

Tổng đề bài: select-name ở 7 màn (admin-dealers, orders, returns, users, coupons, brands và merchant-2), label ở 4 màn (admin-coupons, flashSales, merchant-1, merchant-ctv), target-size ở 2 màn (admin-faqs, quickReplies). Cả bảy, bốn, hai màn này đã sạch. Bốn node `scrollable-region-focusable` (mức serious) nằm ngoài đề bài nhưng cùng một lớp lỗi, nên sửa luôn.

Cách sửa: mỗi `select` và ô ngày/giờ có `aria-label` nêu việc nó lọc hay nhập; 20 `label` của form đối tác nối bằng `htmlFor`/`id`; khối chọn màu giao diện gian hàng dùng `role="group"` có `aria-labelledby`. Vùng cuộn ngang của bảng đi qua `ScrollRegion` mới trong `components/admin/ui.tsx` (`role="region"`, `tabIndex=0`, `aria-label`). `BTN_LINK_BASE` đổi `sm:min-h-0` thành `sm:min-h-6` để nút liên kết đủ 24px khi màn lớn. Trạng thái bị từ chối của `/merchant` (chưa đăng nhập, không phải đối tác) có `<main>` và `<h1>`. `test-utils/a11y.ts` thêm `unlabeledFields` và `scrollRegionProblems` làm tương đương axe trong vitest; test mới đỏ trước khi sửa.

C-114 nói "web 3 trang không h1" (`tai-khoan`, `dang-nhap/callback`, `merchant-denied`). Ở base chỉ còn `merchant-denied` thiếu h1; `tai-khoan` và `dang-nhap/callback` đã có h1 từ trước (kiểm bằng `git show` ở base và bằng axe), nên không đổi hai trang đó.

Chưa xử lý: moderate `heading-order` x22 (không đổi trước và sau, ngoài đề bài).

## Mục 2: ba lỗi PC-7

Link Content Kit `/product/<slug>` ra 404. Tái hiện bằng `curl` trên server dev (404). Sửa phía web bằng route handler `app/product/[slug]/route.ts` trả 307 sang `/san-pham/<slug>`, giữ nguyên query (`?ref=` của CTV) và slug được mã hoá để không thoát khỏi `/san-pham/`. Dùng route handler vì chuyển hướng trong middleware với `Location` tương đối làm Next trả 500, và `redirect()` trong page bị `loading.tsx` stream ra 200. `curl` sau sửa ra 307 đúng đích. Nơi sinh link nằm ngoài nhóm file của gói: `apps/api/src/modules/content-kit/content-kit.service.ts:50` (và `absoluteLink` ở `apps/miniapp/src/components/content-kit-sheet.tsx`). Khuyến nghị sửa nơi sinh thành `/san-pham/<slug>` ở gói có quyền sửa API và miniapp; trong lúc chưa sửa, link cũ vẫn mở được nhờ redirect.

Ô tìm kiếm nháy trên host CTV. Trang ISR có HTML như nhau cho mọi host nên ô tìm kiếm luôn có trong HTML đầu, `SiteSearch` chỉ gỡ ô sau hydrate. Đo bằng Playwright trên `ctv-an.localhost`: nhìn thấy từ khung hình 0, và khi tắt JS thì không bao giờ ẩn. Sửa bằng script nhỏ ở `<head>` (`tenantHostBootScript` trong `lib/site.ts`) đặt `data-tenant-host` trên `<html>` trước khi vẽ, khung tìm kiếm của header mang `data-site-search`, `globals.css` ẩn theo thuộc tính. Không dùng `headers()` ở layout vì sẽ phá ISR. Đo lại: không bao giờ thấy ô trên host CTV (cả khi tắt JS), vẫn thấy ở `localhost` và `app.localhost`, không có cảnh báo hydration. `site.spec.ts` so script với `tenantSubdomainOf` trên cùng bảng 15 host.

Khung "Đã nhận thanh toán" biến mất ngay. Hai nguyên nhân, cả hai tái hiện bằng test đỏ: ở trang chi tiết đơn, khi đơn chuyển sang đã trả thì điều kiện `canPayAgain(o)` thành false và cả khung bị gỡ; ở `bank-transfer-panel`, nhánh lỗi/không có dữ liệu đứng trước nhánh PAID nên một lần refetch lỗi (react-query giữ `data` nhưng `isError` thật) thay khung bằng thông báo lỗi. Sửa: trang đơn có `paidNotice` giữ khung sau lần refresh đầu tiên báo đã trả, panel kiểm PAID trước nhánh lỗi. Khung vẫn ở lại đến khi rời trang, chưa có nút đóng (không nằm trong yêu cầu).

## Mục 3: PC-9

"Nhập mã ưu đãi": không phải lỗi, đã đúng ở base. `grep` không còn "mã ưu đãi" trong `apps/web/src`; `coupon-box.tsx` dùng "Mã giảm giá" và placeholder "Nhập mã giảm giá". Không đổi mã nguồn cho phần này (Mini App đã có guard `terminology.spec.ts`; web chưa có guard tương tự, có thể thêm sau).

Chữ TubuXu/xu khách thấy: không phải lỗi. `lib/no-xu-copy.spec.ts` quét toàn bộ nguồn web (kể cả thanh-toan, tai-khoan) và chỉ cho phép "xu cũ" ở nhãn phương thức thanh toán đơn cũ (`order-view.ts`, hiện "Điểm Xanh (xu cũ)"), nên không đổi.

Ngày dd/MM/yyyy: đã sửa. `toLocaleDateString`/`toLocaleString` ra "1/10/2026" (không đệm số 0) và lệch theo múi giờ máy xem. Thêm `lib/format-date.ts` (`formatDate` dd/MM/yyyy, `formatDateTime` HH:mm dd/MM/yyyy), cố định UTC+7 (Việt Nam không có DST), giá trị sai trả "—". 15 file chuyển sang helper, trong đó `tai-khoan/page.tsx` và `tai-khoan/don-hang/[code]/page.tsx` là hai trang khách. `lib/no-raw-date-format.spec.ts` chặn dùng lại `toLocale*String` trên web, loại trừ `lib/export-csv.ts` (ngày trong file CSV xuất, chưa đổi). Test cho helper (10 ca), cho ngày đơn ở `/tai-khoan` (có ca 00:00Z và 18:00Z để kiểm lệch ngày theo múi giờ) và cho dòng "Đặt lúc" ở chi tiết đơn.

## Mục 4: cảnh báo React trùng key ở admin-config

Không tái hiện được bằng dữ liệu thật. `ConfigTab` dùng key `` `${c.key}:${JSON.stringify(c.value)}` ``. `SystemConfig.key` là khoá chính Prisma, nên API không bao giờ trả hai dòng cùng key; DB dev (sau seed) có 107/107 key khác nhau (đối chiếu trực tiếp trên DB dev). Cảnh báo chỉ ra ở bộ chụp UI/UX vì `fabricate.mjs` tự bịa dữ liệu từ kiểu TypeScript, trả ba dòng "Nội dung mẫu:null" giống hệt nhau. Không đổi mã nguồn: key hiện tại duy nhất với mọi dữ liệu API có thể trả, và phần giá trị ghép vào key làm `ConfigItem` dựng lại khi giá trị đổi.

Chỉ thêm guard: fixture `test-utils/fixtures/admin-config-rows.ts` (107 dòng chụp từ API, cờ `deprecated` theo `DEAD_CONFIG_KEYS`) và hai test trong `admin/page.spec.tsx`: dựng tab Cấu hình bằng 107 dòng không có `console.error` nào; dữ liệu cố ý trùng thì bộ bắt `console.error` ra đúng cảnh báo "same key" (kiểm chứng bộ bắt không câm). Fixture mang nguyên văn mô tả khoá cũ còn chữ "Xu" (`game.plot_unlock_xu_base`, đang gắn nhãn "Không dùng"), nên `no-xu-copy.spec.ts` bỏ qua thư mục `test-utils/fixtures`; thử thêm tạm một file nguồn chứa "TubuXu" thì guard vẫn đỏ.

## Kiểm chứng đã chạy

Chạy ở `apps/web`: `tsc --noEmit` (exit 0); `vitest run` toàn bộ web (63 file, 960 test, xanh, chạy lại sau lần sửa cuối); `next lint --max-warnings=0` trên các file đổi (sạch); ESLint chỉ với luật tubu-ds (`no-raw-color`, `icon-button-aria-label`) trên các file `.tsx` đổi (exit 0, cấu hình tạm ngoài repo vì `apps/web` dùng `next lint`, không dùng cấu hình phẳng `packages/eslint-config`); `next build` (exit 0, không cảnh báo, có `/product/[slug]` là route động). Capture sau sửa ở trên.

## Ngoài phạm vi, để ghi nhận

- Nơi sinh link Content Kit sai đường dẫn ở API và Mini App (mục 2).
- Quy tắc nhận host gian hàng CTV nay có ba bản: `middleware.ts`, `lib/site.ts` (`tenantSubdomainOf`) và script khởi động; `site.spec.ts` ghim script với hàm nhưng middleware chưa có test so cùng bảng.
- Nhiều ô nhập ở admin chỉ có placeholder làm nhãn: axe cho qua nhưng chưa phải nhãn tốt.
- `heading-order` moderate x22.
- Không chạy Playwright e2e theo quy định của gói. Đã `grep` `apps/e2e/tests` (admin, admin-analytics, admin-customer-refunds) tìm nhãn, `getByLabel`, ngày giờ hiển thị và `/product/`: không thấy chuỗi nào trùng với nhãn aria mới hay định dạng ngày cũ (các `/product/` trong e2e là của Mini App), nên không sửa selector; chưa kiểm bằng chạy thật (unverified).
