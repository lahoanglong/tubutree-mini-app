TITLE: feat(admin): chip trạng thái đơn có số, tab Đại lý dạng chip, khung xương và giữ dữ liệu khi đổi tab, bộ tab kiểm duyệt dùng chung (R-70, R-148, R-149, R-75)

## Vấn đề
Rà mã trên main `a5469abe9` cho thấy bốn mục quản trị trong backlog đợt 28/10 còn dở:
- R-70: chip trạng thái đơn ở admin không có số. Lý do: chưa có API đếm đơn theo trạng thái cho admin, `order-counts.service.ts` chỉ đếm theo khách.
- R-148: tab Đại lý vẫn lọc bằng ô chọn, không có số "Chờ duyệt".
- R-149: mọi tab admin chờ bằng một dòng "Đang tải…". QueryClient web không có `staleTime`, nên mỗi lần đổi tab lại tải lại từ đầu.
- R-75: Mini có 3 tab kiểm duyệt cộng đồng, web có 5. Tab Báo cáo ở Mini không có số.

## Có gì trong PR
- **R-70:**
  - API mới `GET /admin/orders/status-counts` đếm đơn theo trạng thái (`groupBy status`).
  - API dùng cùng điều kiện `adminOrderWhere` với danh sách đơn, kể cả `exactPhoneOnly` cho nhân viên. DTO giống `ListOrdersQuery` nhưng từ chối `status`.
  - Quyền như các route đơn admin khác: ADMIN và nhân viên CSKH, KHO, KẾ TOÁN. `staff-permissions.matrix.spec.ts` đã có route mới.
  - Web gắn số vào chip trạng thái. Khi số còn đang tải, tải lỗi hoặc khoảng ngày sai, chip không in số, để không hiện "(0)" sai.
- **R-148:**
  - Tab Đại lý đổi ô chọn thành chip có số. Số "Chờ duyệt" lấy từ khoá `dealerApplications` của hộp việc, không thêm request nặng.
  - Duyệt hay từ chối hồ sơ xong thì hộp việc tải lại, kể cả khi thao tác lỗi.
- **R-149:**
  - Khung xương dùng chung cho bảng và thẻ số ở `components/admin/ui.tsx`, thay "Đang tải…" ở các tab chính.
  - `staleTime` 30 giây cho các khoá `admin-*` và huy hiệu. Chat CSKH và chấm công trực tiếp không áp.
  - Thao tác nào của admin xong, thành công hay lỗi, cũng làm cũ mọi khoá `admin-*` qua `MutationCache` (`query-client.ts`). Nhờ vậy dữ liệu không bị cũ sau khi sửa.
- **R-75:**
  - Danh sách tab kiểm duyệt nằm ở `packages/app-core/src/community-moderation-views.ts`, Mini và web dùng chung.
  - Tab Báo cáo ở Mini có số, lấy từ khoá `communityReports` của hộp việc. Mini vẫn chỉ ADMIN mới vào được.

Không đổi schema, không có migration, không đổi luật điểm, giá, phí hay chữ pháp lý.

## Số đo
- Đổi qua lại tab Đơn và tab Đại lý 3 vòng với `createQueryClient` thật: `listOrders` gọi 1 lần, `listDealerApps` gọi 1 lần (test trong `admin/page.spec.tsx`).
- Không có `staleTime` thì mỗi lần mở tab tải lại một lần. Theo kịch bản này là khoảng 4 lần `listOrders` và 3 lần `listDealerApps`. Số "trước" là suy ra từ kịch bản, không đo riêng.
- Ảnh trước/sau ở 375 và 1280 (tab Đơn, Đại lý, Cộng đồng; Mini kiểm duyệt 375) nằm trong thư mục ảnh cục bộ `screens-1028e-quantri/`, không đưa lên git. Ảnh "sau" chụp với một báo cáo đang mở và một hồ sơ đại lý chờ duyệt. Ảnh có "Báo cáo 1" (Mini), "Chờ duyệt (1)", "Tất cả (8)", "Chờ thanh toán (1)".

## Cách kiểm
- Test mới:
  - API: số đếm khớp bộ lọc của danh sách. `RolesGuard` thật cho qua ADMIN, CSKH, KHO, KẾ TOÁN; chặn khách, đại lý, CTV, nhân viên Marketing, nhân viên không có nhóm và người chưa đăng nhập.
  - Web: chip không in số khi đang tải hoặc lỗi. Hộp việc tải lại sau khi duyệt hoặc từ chối đại lý. `staleTime` không áp cho chat và chấm công.
  - Mini và app-core: bộ tab dùng chung, số ở tab Báo cáo.
- Worker chạy:
  - Playwright web-gate, 8 spec admin: 29 passed, 1 skipped.
  - Các file vitest, jest liên quan; tsc web, Mini, API; eslint; lint:parity.
- Reviewer Opus kết luận "merge được" ở lượt 2, sau khi tự chạy lại:
  - vitest web query-client 6, admin/page (R-70, R-148, R-149) 28, community-moderation-tab 44.
  - vitest Mini community-moderation 41, app-core 4.
  - jest API admin-order-list-filters cùng staff-permissions.matrix: 73.
- Gate đầy đủ trên nhánh đã gộp main `6f4fd6733` (tip `f3dfb3dfe` cộng merge): 0 FAIL. Gate gồm:
  - tsc 6 gói, eslint (API, Mini App, web).
  - vitest: app-core 1649, Mini App 5874 (thêm một lượt giờ UTC), web 8635.
  - jest API: 516 suite / 12098 test.
  - lint:parity, vite build, bundle-report (entry Mini 625/194 KB, tổng 2108/823 KB).
- Sau gate chỉ thêm một commit dời chú thích trong `query-client.ts`, không đổi mã. Đã chạy lại query-client.spec (6 passed), eslint, tsc web.

## Còn lại (P3, không chặn merge)
- Thao tác không ghi gì (bấm Huỷ trong hộp xác nhận, gửi từng tin chat CSKH) vẫn làm tải lại các query `admin-*` đang mở. Dữ liệu vẫn đúng, chỉ tốn request. Cách sửa: cho mutation đặt `meta: { skipAdminInvalidate: true }`.
- Ở khổ 375, tab kiểm duyệt web ghi "Báo cáo vi phạm (1)", Mini ghi "Báo cáo 1". Đây là trang quản trị nên để sau.
- Phần còn lại của R-70 trong backlog chưa làm: nút "Lọc (n)" mở ngăn kéo, mỗi đơn một thẻ ở 375, gộp ba nhóm chip.

## Deploy và migration
Không có migration. Đổi API, web và Mini App. Phần API và web lên khi deploy VPS. Phần Mini chỉ tới khách khi chủ đẩy Mini App lên Zalo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
