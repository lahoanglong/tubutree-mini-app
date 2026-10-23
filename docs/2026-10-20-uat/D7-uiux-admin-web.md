# D7 — UI/UX Admin 1440px (+ web khách 1440 để đối chiếu)

Phiên UAT 2026-10-20, nhánh D7. Worktree `.claude/worktrees/uat`, nhánh `uat/2026-10-20`. Không sửa mã nguồn ứng dụng. Mọi ảnh và kết quả đo nằm trong `docs/2026-10-20-uat/screens/`.

## Tóm tắt

- Không có P0/P1. Có **10 P2** và **26 P3** (17 ở Admin, 9 ở web khách).
- Phân quyền theo vai trò khớp ma trận đã chốt: CSKH, Kế toán, Marketing và Kho mỗi người chỉ thấy đúng tab của mình. Kế toán không có nút "Duyệt" rút tiền.
- Có **một chỗ lệch luật, cần chủ quyết**: CSKH và Marketing ghim được bài cộng đồng. Luật đã chốt: chỉ ADMIN ghim (D7-09).
- Rủi ro lớn nhất là thao tác nặng mà không hỏi lại:
  - Duyệt lệnh rút tiền: duyệt xong thì không từ chối được nữa.
  - "Đã chuyển"/"Đã thu" ở đối soát đối tác.
  - Từ chối hồ sơ đại lý: là quyết định cuối, lý do cố định.
  - Xoá khoá học, xoá món đang chạy trong flash sale.
- Còn 4 chỗ hiện mã thô (PENDING, WALLET, AFFILIATE…) và 1 chỗ hiện số điểm chưa có dấu chấm ngăn cách.
- Vòng tiêu điểm bàn phím: 9/9 tab đo đều có vòng ở 25/25 lần nhấn Tab. Nhưng không có link "Bỏ qua tới nội dung". Sau 25 lần Tab vẫn còn ở menu (41 mục).
- axe serious:
  - `definition-list` ở 13 trang (3 component).
  - `color-contrast` ở tab Cấu hình.
  - `aria-progressbar-name` ở trang chủ web khách.

## Phạm vi và cách làm

**Công cụ.** Đây là bản sao của `scripts/uiux/capture.mjs` và lib, đặt ở `docs/2026-10-20-uat/tools/uiux/d7/`. Không chạy bản gốc.
- `capture.mjs`: chụp và đo. Đầu file có hướng dẫn chạy.
- `routes-d7.mjs`: đọc `NAV_GROUPS`/`STAFF_TABS` thẳng từ `apps/web/src/app/admin/page.tsx`, nên danh sách tab luôn khớp mã.
- `lib/api-router.mjs`: chặn mọi `/api/**` của trình duyệt.
  - Ghi (POST/PATCH/DELETE) luôn giả, không chạm DB.
  - GET công khai chuyển tới API UAT `http://127.0.0.1:3221/api`.
  - GET còn lại dựng giả theo kiểu TS lấy từ mã (`extract-endpoints.mjs` → `generated/web-endpoints.json`, 483 endpoint, gồm cả `packages/app-core/src/api`).
  - Trạng thái (`status`, `paymentMethod`, `role`, `type`) lấy đúng giá trị enum Prisma.
- `ssr-proxy.mjs` (cổng 3231): proxy chỉ cho GET, dùng cho fetch SSR của Next. Có fixture `/storefront/public/:slug` và `/brand/public/:slug`, vì DB UAT có 0 gian hàng và nhãn chưa đăng.
- `debug-page.mjs`: mở một trang, in lỗi console và các call. Dùng để phân biệt lỗi thật với lỗi do mock.

**Chạy lại** (web dev tự bật ở cổng 3222, mở bằng `localhost`):

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
cd .claude/worktrees/uat
UIUX_API=http://127.0.0.1:3221 SSR_PROXY_PORT=3231 node docs/2026-10-20-uat/tools/uiux/d7/ssr-proxy.mjs &
(cd apps/web && NEXT_PUBLIC_API_URL=… npx next dev -H 0.0.0.0 -p 3222) &
UIUX_API=http://127.0.0.1:3221 UIUX_WEB_BASE=http://localhost:3222 node docs/2026-10-20-uat/tools/uiux/d7/capture.mjs --set admin|staff|customer|all [--only '^admin-orders$'] [--states normal,empty,error,long] [--force]
UIUX_API=… UIUX_WEB_BASE=… node docs/2026-10-20-uat/tools/uiux/d7/capture.mjs --set admin --probe danger|focus
```

**Đã chạy.**
- 41 tab admin × normal/empty/error, thêm "long" cho các tab có bảng dài, thêm màn POS.
- 5 vai trò STAFF (CSKH, KE_TOAN, MARKETING, KHO, chưa có quyền):
  - màn đầu;
  - từng tab được phép;
  - một tab cấm mở thẳng bằng URL.
- Khách vào `/admin` và khách chưa đăng nhập vào `/admin`.
- 10 trang web khách.
- Đầu ra:
  - Ảnh: `screens/web/<id>__<state>__1440.png` (khung 1440×900) và `__1440full.png` (cả trang, cắt ở 6000px).
  - Số đo: `screens/web.jsonl` (metrics, axe, menu, bảng, ô tìm, dò mã thô).
  - Kết quả hai probe: `screens/web-probe.jsonl`.
- Probe:
  - `danger`: bấm từng nút có nhãn nguy hiểm trên mỗi tab, ghi nhận có hộp xác nhận hay request ghi đi thẳng. Log: `logs/d7-danger.log`.
  - `focus`: nhấn Tab 25 lần trên 9 tab, đo outline/box-shadow. Log: `logs/d7-focus.log`.
- Log khác: `logs/d7-capture*.log`, `logs/d7-web-3222.log`, `logs/d7-ssr-proxy.log`.

**Thang điểm 1–5.**
- 5: tốt, không cần sửa.
- 4: ổn, lỗi nhỏ.
- 3: dùng được nhưng có lỗi rõ.
- 2: dễ gây nhầm hoặc rủi ro.
- 1: hỏng.

**Đã loại vì là lỗi do dữ liệu giả, không phải lỗi app:**
- `/tai-khoan` sập lúc đầu. Mock `/me` thiếu `walletBalance`, còn API thật trả đủ (`apps/api/src/modules/users/users.service.ts:35-40` → `serialize(user)`). Đã sửa mock và chụp lại: trang hiện đúng.
- `/brand/<slug>` sập lúc đầu (`rewards.length`). Fixture thiếu `dealerRewards`, còn API thật luôn trả (`apps/api/src/modules/brand/brand.service.ts:145`). Đã sửa fixture và chụp lại: trang hiện đúng.
- Các chữ "ACTIVE", "RETAIL", "WALLET" ở Đơn ngoài app, Tích điểm đơn sàn, Đơn đối tác, Sức khoẻ hệ thống. Đây là chuỗi giả cho trường tự do. Code đều có bảng nhãn (`external-claims-tab.tsx:244`, `merchant-fulfilment-tab.tsx:33`, `page.tsx:1366`).
- Các con số vô lý (130000 đại lý, "68 món", "Sàn 6.000%"), "Nội dung mẫu", ảnh CCCD vỡ.
- Ảnh sản phẩm là lá cây: sản phẩm trong DB UAT chưa có thumbnail.
- Ô ngày hiện `mm/dd/yyyy`: do locale của trình duyệt headless. Chưa kiểm chứng trên Chrome tiếng Việt thật.
- Ở trang tài khoản, khách thường thấy "Kênh đại lý" và "Quản lý nhãn hàng". Lý do: mock `/dealer/me` và `/brand/owner/me` trả 200.

---

## Phần 1 — Admin (vùng UAT, sửa được)

Cột "Vùng" ghi theo quy ước:
- **UAT**: `apps/web/src/app/admin/**` và `apps/api/**`. Agent UAT sửa được.
- **web**: `apps/web/src/components/admin/**`. Thuộc vùng file của phiên web, phải hỏi phiên web trước khi sửa (brief: `apps/web/src/**` trừ `app/admin/**`).

### Bảng điểm từng tab (ADMIN, 1440)

| Tab | Điểm | Ghi chú | Ảnh |
|---|---|---|---|
| Việc cần xử lý (inbox) | 4 | Rõ ràng; trống: "Không còn việc nào đang chờ."; lỗi: chữ đỏ, không có Thử lại | `screens/web/admin-inbox__*.png` |
| Tổng quan KPI | 4 | Tiền đã định dạng | `admin-dashboard__*` |
| Retention & North-star | 4 | | `admin-analytics__*` |
| Báo cáo | 4 | axe moderate landmark-unique | `admin-reports__*` |
| Đơn hàng | 3.5 | Có tìm, 4 bộ lọc, chọn ngày, phân trang ("Trang 1/3"); cột chật, chữ xuống dòng (D7-26) | `admin-orders__long__1440full.png` |
| Đơn ngoài app | 4 | axe definition-list | `admin-externalOrders__*` |
| Tích điểm đơn sàn | 3.5 | axe definition-list | `admin-externalClaims__*` |
| Đơn đối tác & đối soát | 3 | D7-02 | `admin-merchantFulfilment__*` |
| Đổi / Trả | 3 | D7-06, D7-14 | `admin-returns__*` |
| Hoàn tiền khách | 4 | Bắt đầu chuyển/Đã chuyển đều hỏi lại, tông đỏ | `admin-customerRefunds__*` |
| Hoàn tiền sàn ngoài (cashback) | 2.5 | D7-05: chip lọc và trạng thái là mã thô | `admin-cashback__normal__1440.png` |
| Đại lý (hồ sơ) | 3 | D7-03 | `admin-dealers__*` |
| Thưởng đại lý | 4 | | `admin-dealerClaims__*` |
| Đại lý & công nợ | 3.5 | axe definition-list | `admin-dealerAccounts__*` |
| Lịch sử giá đại lý | 4 | Có tìm SKU | `admin-dealerPrices__*` |
| Hoa hồng & giá sỉ | 4 | Có tìm và lọc | `admin-commissionRates__*` |
| Danh mục sản phẩm | 3.5 | Lỗi hiện 2 lần (D7-27) | `admin-productCategories__error__1440.png` |
| Duyệt yêu cầu rút tiền | 3 | D7-01, D7-16 | `admin-payouts__normal__1440.png` |
| Duyệt SP đối tác | 4 | | `admin-merchantProducts__*` |
| Gian hàng | 3.5 | D7-11 | `admin-storefronts__*` |
| Nhãn hàng | 3 | D7-12, D7-13 | `admin-brands__normal__1440full.png` |
| Người dùng | 3 | Có tìm; D7-07, D7-04, D7-11 | `admin-users__normal__1440full.png` |
| Đánh giá | 4 | "Ẩn đánh giá" hỏi lại; không có tiêu đề tab (D7-27) | `admin-reviews__*` |
| Cộng đồng | 4 | D7-09 | `admin-community__*` |
| Gói định kỳ | 4 | Chỉ xem; không có tiêu đề tab | `admin-subscriptions__*` |
| Tích điểm tại quầy | 4 | | `admin-posCredits__*` |
| Đổi rác | 3 | Bảng món 11 cột chật (D7-26) | `admin-waste__*` |
| Voucher | 3.5 | "Tắt lô"/"Tắt mã" hỏi lại; form chỉ có placeholder (D7-25) | `admin-coupons__*` |
| Flash Sale | 3 | Xoá đợt hỏi lại; xoá món/Tắt không hỏi (D7-10, D7-13) | `admin-flashSales__*` |
| Nhiệm vụ & quà đổi điểm | 3.5 | Nhãn cũ (D7-23) | `admin-engagement__*` |
| Câu hỏi thường gặp | 3.5 | D7-13, D7-25 | `admin-faqs__normal__1440.png` |
| Content Kit CTV | 4 | | `admin-contentKit__*` |
| Academy | 3 | D7-10, D7-25 | `admin-academy__*` |
| CSKH mẫu tin nhanh | 3.5 | D7-13 | `admin-quickReplies__normal__1440.png` |
| Mẫu thông báo | 3.5 | D7-24 | `admin-notificationTemplates__*` |
| Nhân sự & quyền | 3.5 | Thu hồi quyền hỏi lại; huỷ lời mời không hỏi (D7-15) | `admin-staffRoster__*` |
| Duyệt ca | 3.5 | D7-15 | `admin-shiftApproval__*` |
| Lương | 3.5 | D7-15 | `admin-payroll__*` |
| Chấm công | 4.5 | "Chốt ra ca" hỏi lại (`attendance-tab.tsx:28`) | `admin-attendance__normal__1440.png` |
| Cấu hình | 2.5 | D7-08, D7-18 | `admin-config__normal__1440full.png` |
| Sức khoẻ hệ thống | 3.5 | D7-24 | `admin-opsHealth__*` |
| Màn thu ngân POS | 4 | | `admin-pos__*` |

### Ma trận vai trò (so với luật đã chốt và `STAFF_TABS`)

| Vai trò | Menu thực tế (đo từ `web.jsonl`) | Đúng luật? |
|---|---|---|
| ADMIN | 41 mục | Đúng |
| CSKH | Việc cần xử lý, Đơn hàng, Đơn ngoài app, Tích điểm đơn sàn, Đổi/Trả, Người dùng, Cộng đồng, Đổi rác, CSKH mẫu tin nhanh | Đúng: CSKH duyệt bài cộng đồng. Lệch: CSKH ghim được bài (D7-09) |
| KE_TOAN | Việc cần xử lý, Báo cáo, Đơn hàng, Tích điểm đơn sàn, Đơn đối tác & đối soát, Hoàn tiền khách, Hoàn tiền sàn ngoài, Thưởng đại lý, Đại lý & công nợ, Duyệt yêu cầu rút tiền, Đổi rác | Đúng: có "Đã chi", công nợ, đơn chuyển khoản, VAT (bộ lọc ở Đơn hàng), chi thưởng đại lý, hoàn tiền sàn, tab Đơn hàng. Không có nút Duyệt rút tiền; màn hiện "Chờ quản trị viên duyệt trước khi chuyển khoản". Tên tab gây hiểu nhầm (D7-23) |
| MARKETING | Việc cần xử lý, Báo cáo, Cộng đồng, Đổi rác, Voucher, Flash Sale, Câu hỏi thường gặp, Content Kit CTV, Academy, Mẫu thông báo | Đúng. Lệch: Marketing ghim được bài (D7-09) |
| KHO | Việc cần xử lý, Đơn hàng, Đổi/Trả, Đổi rác | Đúng |
| STAFF chưa có quyền | Đổi rác (`STAFF_TABS.BASE`) | Đúng theo mã |
| Khách vào /admin | "Bạn không có quyền truy cập trang quản trị." | Đúng |
| Chưa đăng nhập | "Cần đăng nhập quản trị. Đăng nhập" | Đúng |
| Tab cấm mở bằng URL (vd KE_TOAN `?tab=users`) | Hiện "Việc cần xử lý", nhưng URL vẫn giữ `?tab=users` | Đúng về quyền; P3 về URL (D7-22) |

Chọn người thắng sự kiện chỉ ADMIN làm được: đúng luật.

### Bảng phát hiện — Admin

| ID | Mức | Nhóm | Vùng | path:line | Mô tả | Kịch bản lỗi | Bằng chứng | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|---|
| D7-01 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/payout-admin-tab.tsx:352-359` (nút Duyệt), `:249-272` (`run()` chỉ hỏi lại khi reject/markPaid); `apps/web/src/lib/payout-admin.ts:14-15` | Nút "Duyệt" lệnh rút tiền bấm là chạy ngay, không hỏi lại. Sau khi duyệt, lệnh không còn từ chối được: chỉ REQUESTED mới có `reject`. | Admin định bấm "Từ chối (hoàn tiền)" nhưng trượt sang "Duyệt" (hai nút cạnh nhau). Lệnh sai chuyển sang APPROVED và không còn đường từ chối hay hoàn hoa hồng trên UI. Kế toán thấy lệnh ở "Đã duyệt, chờ chuyển khoản". | Đọc mã. Ảnh `screens/web/admin-payouts__normal__1440.png` (Duyệt cạnh Từ chối). | Thêm `confirm({ title: 'Duyệt lệnh rút', message: số tiền + tên CTV + ngân hàng/STK, tone: 'danger' })` trước `mut.mutate('approve')`. Test trong `payout-admin-tab.spec.tsx`: bấm Duyệt thì thấy hộp thoại; bấm Huỷ thì không gọi `approvePayout`; xác nhận thì gọi đúng 1 lần. |
| D7-02 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/merchant-fulfilment-tab.tsx:572-586` | "Đã chuyển" (Tubu trả đối tác) và "Đã thu" (đối tác nộp Tubu) là `form onSubmit` → `paidMut.mutate()`, không hỏi lại. Nhấn Enter trong ô mã giao dịch cũng gửi luôn. | Kế toán dán mã giao dịch rồi nhấn Enter để xuống dòng. Phiếu đối soát bị ghi "đã chuyển" khi tiền chưa đi. Lỗi cùng loại với "Đã chi", mà luật yêu cầu bước xác nhận. | Đọc mã. Ảnh `admin-merchantFulfilment__normal__1440full.png`. | Trong `onSubmit`, gọi `confirm` có số tiền, tên đối tác và mã GD, kèm `tone: 'danger'`. Test: submit form thì thấy hộp thoại; Huỷ thì không gọi API; Enter trong input cũng ra hộp thoại. |
| D7-03 | P2 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:708` (nút Từ chối), `:679` (lý do cố định `'Không đạt yêu cầu'`); `apps/api/src/modules/admin/admin.service.ts:296` ("Đơn đã được xử lý.") | "Từ chối" hồ sơ đại lý bấm là gửi ngay, không hỏi lại, không cho nhập lý do. Từ chối là quyết định cuối. | Admin bấm nhầm "Từ chối" (nằm cạnh "Duyệt"). Hồ sơ thành REJECTED, không mở lại được. Người đăng ký chỉ nhận lý do chung chung. | Probe danger: `danger__admin-dealers`, `writesWithoutConfirm: ["POST /admin/dealer-applications/…/review"]` (`screens/web-probe.jsonl`). | Dùng `ask()` của `useConfirm` có ô lý do (giống `cashback-tab.tsx:49`), tông danger, gửi lý do thật. Test ở page/admin spec: bấm Từ chối thì thấy hộp thoại; Huỷ thì không có POST; xác nhận thì body có `reason` đã nhập. |
| D7-04 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/account-deletion-panel.tsx:127` | Duyệt xoá tài khoản dùng `window.confirm` gốc. C-122 (`docs/2026-10-review/findings-catalog.md:169`) chỉ nói `page.tsx` và đã sửa ở đó; chỗ này còn sót. | Hộp thoại trình duyệt không có tông danger. Trình duyệt có thể chặn hoặc tắt hẳn nó ("không hiện thêm hộp thoại"); khi đó lần bấm sau đi thẳng hoặc không làm gì, tuỳ trình duyệt. Thao tác xoá tài khoản là không quay lại được. | `grep -n window.confirm` → dòng 127. | Thay bằng `useConfirm().confirm({ tone: 'danger' })`. Test: dùng `vi.spyOn(window, 'confirm')` để chứng minh không còn gọi; thấy `role="alertdialog"`. |
| D7-05 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/cashback-tab.tsx:62` (chip lọc), `:80` (`{t.status}`) | Tab Hoàn tiền sàn ngoài, Kế toán dùng hằng ngày: chip lọc hiện `PENDING`, `CONFIRMED`, `REJECTED`, `PAID`; mỗi dòng hiện trạng thái thô. | Kế toán không biết `CONFIRMED` khác `PAID` ở chỗ nào, nên dễ chi trùng hoặc bỏ sót. | Ảnh `admin-cashback__normal__1440.png`, `staff-ketoan-cashback__normal__1440.png`; `web.jsonl` enumLeak = PENDING, CONFIRMED, REJECTED, PAID. | Thêm `CASHBACK_STATUS_LABELS` (vd Chờ duyệt / Đã duyệt / Đã từ chối / Đã chi) và dùng cho cả chip lẫn dòng. Test: render không còn chuỗi `PENDING`; chip "Đã chi" lọc `status=PAID`. |
| D7-06 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/return-request-row.tsx:130` | Dòng đổi/trả hiện `Tổng đơn: 89.000đ (WALLET)` hoặc `(BANK_TRANSFER)`. | CSKH và Kho đọc "(WALLET)" mà không biết hoàn về đâu. Đây đúng là lúc cần biết kênh hoàn tiền. | Ảnh `admin-returns__normal__1440.png`, `staff-kho-returns__normal__1440.png`. | Dùng `PAYMENT_METHOD_LABELS` (đã có, `page.tsx:1366` đang dùng). Test: render với `paymentMethod: 'WALLET'` thì thấy "Ví Tubu" và không còn "WALLET". |
| D7-07 | P2 | agent sửa ngay | web | `apps/web/src/components/admin/users-list.tsx:15` | Cột Điểm Xanh hiện `{pts.total}` không dấu chấm ngăn cách (vd "130000"), trong khi ghi chú ngay dưới đã định dạng ("trong đó 65.000 điểm…"). | CSKH xử lý khiếu nại điểm (chú thích ở dòng 10). 130000 và 13000 nhìn lướt rất dễ nhầm. | Ảnh `admin-users__normal__1440full.png`, `staff-cskh-users__normal__1440.png`. | `pts.total.toLocaleString('vi-VN')`. Test: render `pointsBalance: 130000` thì thấy "130.000". |
| D7-08 | P2 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:1885-1904` (`ConfigTab`) | Tab Cấu hình liệt kê toàn bộ 209 khoá thành ô sửa JSON. Không có ô tìm, không chia nhóm. Bản form đã có kế hoạch (launch review D5-06, `docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md:64`); phần mới ở đây là thiếu ô tìm. | Admin cần tắt một cờ (vd so tổng Pancake) phải cuộn qua 209 ô, dễ sửa nhầm khoá bên cạnh. | DB UAT `systemConfig` = 209 dòng; ảnh `admin-config__normal__1440full.png` (bị cắt ở 6000px). | Thêm ô "Tìm khoá" lọc theo `key`/mô tả, nhóm theo tiền tố (`affiliate.`, `loyalty.`…). Test: gõ "affiliate" thì chỉ còn các khoá `affiliate.*`. |
| D7-09 | P2 | cần chủ quyết | UAT (API) + web (UI) | `apps/api/src/modules/feed/community-feed.controller.ts:317-321` (`@AllowStaff(...COMMUNITY_MODERATORS)` trên `POST admin/:id/pin`); `apps/api/src/common/staff-permissions.ts:17`; `apps/api/src/common/staff-permissions.matrix.spec.ts:273`; UI `apps/web/src/components/admin/community-moderation-tab.tsx:288` | Luật đã chốt: "CSKH duyệt bài cộng đồng; chỉ ADMIN ghim và chọn người thắng". Mã và spec ma trận lại cho CSKH và MARKETING ghim. UI hiện nút "Ghim" cho cả hai. | Nhân viên CSKH hoặc Marketing ghim bài lên đầu cộng đồng mà không cần ADMIN. | Đọc mã và spec; ảnh `staff-cskh-community__normal__1440.png`. | Chủ chọn: (a) giữ luật thì đổi `pin` sang chỉ `@Roles('ADMIN')`, sửa spec ma trận thành `ADMIN_ONLY`, ẩn nút Ghim khi không phải ADMIN; (b) đổi luật thì cập nhật brief. Test: matrix spec và UI spec (STAFF CSKH không thấy "Ghim"). |
| D7-10 | P2 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:3186` (Xoá khoá học, `BTN_DANGER_OUTLINE`), `:2503` (xoá món khỏi flash sale) | Xoá cả khoá học, hoặc xoá món khỏi flash sale kể cả khi đợt "Đang bật", bấm là xoá, không hỏi lại. Xoá cả đợt flash sale thì có hỏi lại (`page.tsx:2378`), nên hành vi không nhất quán. | Marketing bấm nhầm "Xoá khoá học" là mất toàn bộ bài học. Xoá nhầm món trong đợt đang chạy thì khách đang xem giá sale thấy giá gốc ngay. | Đọc mã; probe `danger__admin-flashSales`: `Xoá: writesWithoutConfirm`. | Dùng `confirm({ tone: 'danger' })`, nêu tên khoá học hoặc món và số bài học. Test: bấm Xoá thì thấy hộp thoại; Huỷ thì không có DELETE. |
| D7-11 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/account-deletion-panel.tsx:143`; `apps/web/src/components/admin/storefronts-tab.tsx:264` | Badge vai trò hiện `AFFILIATE`, `DEALER`, `STAFF`; chủ gian hàng hiện `· AFFILIATE`. | Người đọc phải tự đoán AFFILIATE là CTV. | Ảnh `admin-users__normal__1440full.png`; `web.jsonl` enumLeak = AFFILIATE, DEALER. | Dùng một bảng nhãn vai trò chung (`ROLE_LABEL` đã có ở `staff-roster-tab.tsx`). Test: render không còn `AFFILIATE`. |
| D7-12 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:1828` (`${r.previousRole} → ${r.role}`), `:2258` (`[{d.type}]`) | Thông báo "Đã đổi …: CUSTOMER → DEALER" và danh sách thưởng đại lý "[TOUR] / [GIFT] / [OTHER]" dùng mã thô. | Như trên. | Ảnh `admin-brands__normal__1440full.png`; `web.jsonl` enumLeak = TOUR, GIFT, OTHER. | Ánh xạ nhãn (Khách / CTV / Đại lý…; Du lịch / Quà / Khác). Test chuỗi hiển thị. |
| D7-13 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:2135` (Gỡ SP khỏi nhãn), `:2148` (Xoá khuyến mãi nhãn), `:2259` (Xoá thưởng đại lý), `:2446` (Tắt flash sale đang chạy), `:2670` (Xoá FAQ), `:2846` (Xoá mẫu tin nhanh), `:3307` (Xoá bài học) | Các nút xoá/gỡ/tắt này bấm là chạy ngay. | Bấm nhầm thì mất dữ liệu nội dung. Tắt nhầm flash sale đang chạy thì giá sale biến mất với khách ngay. | Probe: `danger__admin-brands` (DELETE /admin/dealer-rewards), `danger__admin-faqs` (DELETE /admin/faqs), `danger__admin-quickReplies` (PATCH + DELETE), `danger__admin-flashSales` (PATCH /admin/flash-sales). | Dùng chung `confirm` tông danger cho Xoá/Gỡ; "Tắt" đợt đang chạy cũng hỏi lại. Test từng nút: Huỷ thì không ghi. |
| D7-14 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/return-request-row.tsx:203-212` (Từ chối), `:383` (Đã nhận hàng về) | "Từ chối" đổi/trả chỉ cần ghi chú ≥3 ký tự rồi gửi luôn. "Đã nhận hàng về" một chạm. | Ghi chú đã gõ sẵn cho một yêu cầu khác, bấm Từ chối là khách nhận thông báo từ chối. | Probe `danger__admin-returns`: `Từ chối: WRITE!`. | Hỏi lại tông danger, nhắc lại lý do sẽ gửi cho khách. Test: Huỷ thì không gọi API. |
| D7-15 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/shift-approval-tab.tsx:126` (Duyệt tất cả (N)), `apps/web/src/components/admin/payroll-admin-tab.tsx:178` (Chốt lương), `apps/web/src/components/admin/staff-roster-tab.tsx:166` (Huỷ lời mời) | Thao tác hàng loạt hoặc chốt sổ mà không hỏi lại. Mở lại lương thì có hỏi lại, nên không nhất quán. | Bấm nhầm "Duyệt tất cả (12)" là duyệt cả các ca đáng ra phải từ chối. | Đọc mã. | Hỏi lại kèm số lượng ("Duyệt 12 ca?"). Test: Huỷ thì không gọi bulk API. |
| D7-16 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/payout-admin-tab.tsx:263-269` | Hộp "Xác nhận đã chuyển khoản" (tức "Đã chi") có hỏi lại nhưng không tông danger, và chỉ nêu số tiền, không nêu tên CTV, ngân hàng, STK. | Kế toán xác nhận nhầm lệnh của người khác có cùng số tiền. | Đọc mã. | Thêm `tone: 'danger'` và dòng "Người nhận · Ngân hàng · STK · Mã GD". Test: message chứa STK. |
| D7-17 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/external-orders-tab.tsx:175`, `apps/web/src/components/admin/external-claims-tab.tsx:239`, `apps/web/src/components/admin/dealer-accounts-tab.tsx:193` | axe serious `definition-list`: `<dl>` chứa con không phải `dt`/`dd`/`div` đúng chuẩn. Có trên 13 trang (admin và staff). | Trình đọc màn hình đọc sai cặp nhãn–giá trị. | `web.jsonl` (axe definition-list, 13 bản ghi). | Mỗi cặp bọc trong `<div><dt/><dd/></div>`, hoặc đổi sang `<ul>`. Test: chạy axe trên 3 tab thì 0 serious. |
| D7-18 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/config-item.tsx:52` (badge "Không dùng" trong thẻ `opacity-70`) | axe serious `color-contrast` ở 12 node: chữ #89847c trên #e7e2d6, tỉ lệ 2.87 (cần 4.5); mô tả 2.84. | Khoá "Không dùng" khó đọc. | `web.jsonl` `admin-config__normal__1440` (axe color-contrast, 12 node). | Bỏ `opacity-70` trên cả thẻ; chỉ làm mờ viền và nền. Test axe. |
| D7-19 | P3 | agent sửa ngay | UAT + web | Tab có Thử lại: commissionRates, community, customerRefunds, dealerAccounts, dealerClaims, payouts, payroll, productCategories, shiftApproval, staffRoster, users. Còn lại chỉ có chữ đỏ, vd `apps/web/src/app/admin/page.tsx:1888` (Cấu hình), inbox, dashboard, cashback, orders | Ở trạng thái lỗi, 28/41 tab chỉ hiện chữ đỏ (không tính 11 tab có Thử lại, POS và Content Kit vì hai màn này không tải danh sách lúc mở) ("Không tải được …" hoặc "Máy chủ đang bận, vui lòng thử lại sau."), không có nút "Thử lại". | API chập chờn 1 phút thì nhân viên phải F5 cả trang và mất bộ lọc đang chọn. | `screens/web/admin-*__error__1440.png`; phân loại bằng `web.jsonl` (bodyText 3000 ký tự). | Một component `<LoadError onRetry={q.refetch}/>` dùng chung. Test: nút Thử lại gọi `refetch`. |
| D7-20 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx` (layout), `apps/web/src/components/admin/admin-nav.tsx:75-76` | Không có link "Bỏ qua tới nội dung". Thứ tự Tab: logo, Về cửa hàng, Đăng xuất, Màn thu ngân, rồi 41 mục menu. Sau 25 lần Tab vẫn ở "Nhãn hàng". Vòng tiêu điểm thì có đủ (0/25 thiếu, 9/9 tab). | Người dùng bàn phím cần khoảng 45 lần Tab để tới ô tìm đơn. | Probe focus `screens/web-probe.jsonl` (`focus__admin-*`, phần tử cuối = "Nhãn hàng"); `grep "Bỏ qua\|skip"` không có kết quả. | Thêm `<a href="#admin-main" class="sr-only focus:not-sr-only">Bỏ qua tới nội dung</a>` và `id` cho vùng nội dung. Test: Tab lần 1 tới skip link, Enter thì tiêu điểm vào main. |
| D7-21 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/admin-nav.tsx:76` (menu sticky, `overflow-y-auto`, không gọi `scrollIntoView`) | Mở thẳng tab ở cuối menu (vd `?tab=reviews`, `?tab=config`): mục đang chọn nằm ngoài khung menu, nên không thấy mình đang ở đâu. | Link đồng nghiệp gửi mở tab Đánh giá; menu không có mục nào sáng. | Ảnh `admin-reviews__normal__1440.png` (không có mục nào sáng). | Khi mount, gọi `scrollIntoView({ block: 'nearest' })` cho mục `aria-current="page"`. Test: jsdom spy `scrollIntoView` được gọi. |
| D7-22 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:510` | Tab không có quyền thì rơi về tab đầu, nhưng URL vẫn là `?tab=users`. | KE_TOAN gửi link cho đồng nghiệp, link mang tab sai; F5 lại vẫn vậy. | `web.jsonl` `staff-ketoan-forbidden-users`: `finalUrl=/admin?tab=users`, mục sáng = "Việc cần xử lý". | Khi `active !== tab` thì gọi `writeUrlState(active, …)`. Test: STAFF KE_TOAN mở `?tab=users` thì URL đổi về tab mặc định. |
| D7-23 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:248` ("Duyệt yêu cầu rút tiền"), `:270` ("Nhiệm vụ & quà đổi điểm") | Kế toán không được duyệt nhưng tab vẫn tên "Duyệt…". Quà đổi điểm đã chuyển sang Đổi rác, nhưng nhãn vẫn nhắc "quà". | Kế toán tưởng mình phải duyệt; Marketing đi tìm quà ở sai tab. | Ảnh `staff-ketoan-payouts__normal__1440.png`, `admin-engagement__normal__1440.png`. | Đổi tên thành "Rút tiền CTV" và "Nhiệm vụ". Test nhãn trong admin-nav spec. |
| D7-24 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/notification-templates-tab.tsx:39`, `apps/web/src/components/admin/ops-health-tab.tsx:286` | Giao diện ghi "xem docs/GO-LIVE-KEYS.md mục 2/8": đường dẫn trong repo, nhân viên không mở được. | Nhân viên vận hành không biết làm tiếp thế nào. | Ảnh `admin-notificationTemplates__normal__1440.png`, `admin-opsHealth__normal__1440.png`. | Thay bằng hướng dẫn ngắn, hoặc link tới trang hướng dẫn nội bộ. |
| D7-25 | P3 | agent sửa ngay | UAT | `apps/web/src/app/admin/page.tsx:1975-1983` (form voucher chỉ có placeholder, không có tiêu đề), `:2584-2588` (FAQ "Thứ tự hiển thị": giá trị 0 che mất placeholder, nên chỉ thấy "0"), `:2200`, `:3078` ("Cover URL" tiếng Anh), `:1853` (placeholder "SĐT (user đã mở Mini App)" bị cắt thành "Mini Ap") | Ô nhập không có nhãn. Gõ xong là placeholder biến mất, không còn biết ô đó để làm gì. | Marketing sửa voucher, không biết ô nào là "Giảm tối đa" và ô nào là "Đơn tối thiểu". | Ảnh `admin-coupons__normal__1440.png`, `admin-faqs__normal__1440.png`, `admin-academy__normal__1440.png`, `admin-users__normal__1440.png`. | Thêm `<label>` hiện trên mỗi ô; "Ảnh bìa (URL)". Test: `getByLabelText('Giảm tối đa (đ)')`. |
| D7-26 | P3 | agent sửa ngay | UAT + web | `apps/web/src/app/admin/page.tsx:1307` (tiêu đề "Chi tiết / Cập nhật" xuống dòng), bảng đơn `:1326-1385`; bảng món Đổi rác (`components/admin/waste-*`) | Ở 1440, tên khách, "COD (Tiền mặt)" và "Xem & Sửa" xuống dòng; cột mã đơn rộng thừa. Bảng món Đổi rác dồn 11 cột. | Đọc chậm, khó so dòng. | Ảnh `admin-orders__long__1440full.png`, `admin-waste__normal__1440full.png`. | Đặt `whitespace-nowrap` cho cột trạng thái và nút; thu cột mã; gộp cột phụ ở bảng món. Kiểm bằng ảnh 1440. |
| D7-27 | P3 | agent sửa ngay | web | `apps/web/src/components/admin/reviews-tab.tsx:27`, `apps/web/src/components/admin/subscriptions-tab.tsx:21` (không có tiêu đề tab); `apps/web/src/components/admin/product-categories-tab.tsx:139,143` (lỗi hiện 2 lần) | Hai tab không có `h2` như các tab khác. Tab Danh mục hiện cùng một lỗi 2 lần (khung đỏ và dòng "… Thử lại"). | Không biết đang ở tab nào (cộng thêm D7-21). | Ảnh `admin-reviews__normal__1440.png`, `admin-productCategories__error__1440.png`. | Thêm `<h2>Đánh giá</h2>` / `<h2>Gói định kỳ</h2>`; khi cùng lỗi thì chỉ hiện một thông báo. |

Đã kiểm và **đúng** (có hỏi lại, tông đỏ):
- huỷ đơn (`order-status-actions.tsx:38,112-116`);
- khoá người dùng (`page.tsx:1675-1690`);
- từ chối rút tiền;
- hoàn tiền khách;
- duyệt/từ chối cashback;
- ghi công nợ/thanh toán đại lý;
- gỡ gian hàng;
- ẩn đánh giá;
- thu hồi quyền nhân sự (`staff-roster-tab.tsx:67`);
- từ chối ca;
- mở lại lương;
- tắt mã/lô voucher;
- xoá đợt flash sale (`page.tsx:2378`);
- chốt ra ca;
- "Tắt đối tác"/"Huỷ phiếu" ở đối soát;
- từ chối bài cộng đồng.

Tiền ở các tab đã xem đều định dạng `x.xxx.xxxđ`, trừ D7-07. Riêng Đơn ngoài app hiện "Số đơn 1250000": đó là số đếm giả, không phải tiền.

---

## Phần 2 — Lỗi web khách gửi phiên web

Tất cả thuộc **vùng phiên web** (`apps/web/src/**` ngoài admin). Không sửa, chỉ báo. Chụp ở khung 1440×900 với người dùng "Nguyễn Thị Hoa" (customer). Dữ liệu tài khoản là giả; sản phẩm và cấu hình lấy thật từ API UAT.

| ID | Mức | Route | Rộng | Mô tả | Ảnh | Gợi ý |
|---|---|---|---|---|---|---|
| D7-28 | P3 | `/tai-khoan/don-hang`, `/brand/bhnong` | 1440 | Hai trang dùng `max-w-3xl` (`app/tai-khoan/don-hang/page.tsx:134`, `app/brand/[slug]/page.tsx:40`), nên khung nội dung chỉ rộng 736px. Trang chủ và Danh mục rộng 1120px; giỏ, thanh toán, sản phẩm, tài khoản, cộng đồng rộng khoảng 992px. Ở trang nhãn, lưới sản phẩm chỉ 2 cột: một sản phẩm thành thẻ 360px với ảnh vuông khổng lồ. | `screens/web/web-don-hang__normal__1440.png`, `screens/web/web-brand__normal__1440full.png` | Thống nhất khung desktop (vd `max-w-6xl`); lưới sản phẩm ở trang nhãn 4–5 cột ở `lg`. |
| D7-29 | P3 | `/` (Mua lại) | 1440 | Tên sản phẩm trong thẻ "Mua lại" dùng `line-clamp-2`, nhưng dòng thứ 3 ("Hương chanh gừng", "500ml", "gừng") vẫn lòi nửa dòng sát trên giá. | `screens/web/web-home__normal__1440.png` | `components/reorder/purchased-rail.tsx:32`: xem lại `line-height`/`min-h` hoặc tách tên biến thể sang dòng riêng có `truncate`. |
| D7-30 | P3 | `/` | 1440 | Các rail thẻ rộng cố định (`w-44`, cuộn ngang; `purchased-rail.tsx:24,104`) như "Mua lại" và "Ưu đãi giờ vàng": 4 thẻ chỉ lấp khoảng 2/3 bề ngang, bên phải trống. Các khối khác lại dùng 6 cột. | `screens/web/web-home__normal__1440.png` | Ở `lg`, dùng lưới co giãn hoặc thẻ rộng hơn. |
| D7-31 | P3 | `/` | 1440 | Có 2 ô tìm kiếm chồng nhau: ô ở header ("Tìm sản phẩm...") và ô của trang chủ ("Bạn đang tìm gì hôm nay?", `lib/home-text.ts:6`). | `screens/web/web-home__normal__1440.png` | Ở desktop, ẩn một trong hai (trang Danh mục đã ẩn ô ở header). |
| D7-32 | P3 | `/` (Flash sale) | 1440 | axe serious `aria-progressbar-name`, 4 node: `ProgressBar` của flash sale không có tên (`components/home/flash-sale.tsx:94` gọi mà không có `label`; `components/ui/progress-bar.tsx:16` gắn `aria-label={label}`). | `screens/web.jsonl` (`web-home__normal__1440`) | Truyền `aria-label` dạng "Đã bán x%" mà không hiện nhãn. Test axe. |
| D7-33 | P3 | `/thanh-toan` | 1440 | Địa chỉ mặc định được chọn sẵn có cảnh báo "Địa giới cũ … chưa giao được", nhưng nút "Đặt hàng" vẫn bật. `isLegacyGeo` chỉ dùng để hiện cảnh báo (`app/thanh-toan/page.tsx:868`). API sẽ từ chối với `ADDRESS_OUTDATED` (`apps/api/src/modules/integrations/pancake/address-geo.ts:25`). Khách có địa chỉ cũ từ trước 2025 sẽ bấm rồi mới bị báo lỗi. Chưa kiểm chứng thông báo sau khi bấm. | `screens/web/web-thanh-toan__normal__1440.png` | Không chọn sẵn địa chỉ cũ, hoặc khoá "Đặt hàng" kèm lời nhắc "Sửa địa chỉ". |
| D7-34 | P3 | `/gio-hang` | 1440 | "Chọn tất cả (3)" đếm số dòng (`app/gio-hang/page.tsx:222`), còn "Thanh toán (6)" đếm số lượng (`:423`). Hai con số cạnh nhau, khác nghĩa. | `screens/web/web-gio-hang__normal__1440.png` | Dùng cùng một đơn vị, hoặc ghi rõ "Thanh toán 6 sản phẩm". |
| D7-35 | P3 | `/s/tubu-demo` | 1440 | Thẻ đầu gian hàng: giữa dòng tên/huy hiệu và nút "Chia sẻ gian hàng" là khoảng trống lớn (khoảng 80px). Chưa kiểm chứng với gian hàng thật: DB UAT có 0 gian hàng, đang dùng fixture. | `screens/web/web-gian-hang__normal__1440.png` | Xem lại layout khi không có số liệu phụ. |
| D7-36 | P3 | `/cong-dong` | 1440 | Hai nút chỉ có biểu tượng (cúp = Bảng xếp hạng, pháo = Sự kiện; `app/cong-dong/feed-view.tsx:181,186`). Có `aria-label` nhưng không có chữ hay tooltip, nên ở desktop khó đoán chức năng. | `screens/web/web-cong-dong__normal__1440.png` | Thêm chữ ở `sm:` trở lên, hoặc `title`. |

Các trang khác đã xem, không thấy lỗi rõ:
- Danh mục `/san-pham`: có tìm, bộ lọc, sắp xếp, 44 sản phẩm.
- Chi tiết `/san-pham/<slug>`.
- Tài khoản `/tai-khoan`, sau khi sửa mock.

Ảnh: `screens/web/web-*__normal__1440*.png`.

**Chưa kiểm chứng:**
- Thẻ flash sale trên trang chủ trống: có thể do dữ liệu flash sale giả.
- Ô ngày `mm/dd/yyyy`: do locale headless.

---

## Giới hạn và việc chưa làm

- Dữ liệu tài khoản và admin là giả theo kiểu TS, nên bộ lọc không lọc thật và số đếm vô lý. Bố cục, nhãn và hành vi hỏi lại đã kiểm được; logic lọc và phân trang phía server thì chưa.
- Probe danger không bắt được nút "Duyệt" ở tab rút tiền và khoá học (bản ghi `buttons: []`). D7-01 và D7-10 kết luận từ đọc mã.
- Không chạy được vai trò STAFF có nhiều quyền cùng lúc: giả định là hợp các tập tab (`page.tsx:335-338`).
- Chỉ chụp ở 1440. Không đo 1280 hay 1920.
- Không sửa mã. Mọi đề xuất test ở trên chưa viết.

## Dọn dẹp

- Đã dừng web dev 3222 (cây 46607 → 46666 → 46713) và ssr-proxy 3231 (89928).
- API 3221 (PID 68811) vẫn chạy.
- Không còn trình duyệt Playwright nào do phiên này bật.
