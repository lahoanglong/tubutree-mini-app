TITLE: fix(quan-tri): tab kiểm duyệt một nhãn "Báo cáo" cho Mini và web; test ngăn kéo Lọc đơn ở 375 (R-189)

## Vấn đề
R-189 (P3, backlog review 28/10), phần còn lại của R-70 ở admin web khổ 375:
- Trên danh sách đơn có ba nhóm chip (hàng đợi, tablist Gomdon, chip trạng thái), nên danh sách bị đẩy xuống.
- Tab kiểm duyệt cộng đồng: web ghi "Báo cáo vi phạm (n)", Mini ghi "Báo cáo".

## Có gì trong PR
- **Chip ở 375:** main đã làm đúng từ trước, không sửa mã.
  - Ở khổ hẹp chỉ còn hàng chip trạng thái có số. Hàng đợi, Gomdon, Pancake và VAT đều nằm trong ngăn kéo "Lọc (n)".
  - `activeFilterCount` đếm đủ mọi bộ lọc trong ngăn kéo.
  - PR thêm test ở `apps/web/src/app/admin/page.spec.tsx`:
    - Trước khi mở ngăn kéo: không có tablist Gomdon, tablist VAT, nút Pancake hay nhóm "Cần xử lý" trên danh sách.
    - URL có ba bộ lọc thì nút ghi "Lọc (3)"; tắt một chip trong ngăn kéo thì còn "Lọc (2)".
- **Nhãn tab kiểm duyệt:**
  - `packages/app-core/src/community-moderation-views.ts` giữ một `label` cho mỗi mục, hai app cùng đọc. Tab báo cáo ghi "Báo cáo" ở cả hai nền.
  - Bỏ `shortLabel` và `communityViewLabel`, vì không còn nơi nào cần hai nhãn.
  - Sửa 4 chỗ spec đang kỳ vọng chữ cũ.
- **Test R-75:** ca "thẻ báo cáo vi phạm mở thẳng danh sách" đỏ khi chạy riêng, vì đọc DOM ngay sau `flush()`. Đổi sang `waitFor`, giống ca bên cạnh.

Không đổi API, không có migration. Khổ máy tính không đổi bố cục, chỉ đổi chữ nhãn tab.

## Cách kiểm
- Ảnh admin375 và admin1280 trước/sau (tab đơn, ngăn kéo mở, tab kiểm duyệt) ở `docs/2026-10-28-review/screens-1028h-quantri/`, không commit.
- Review Opus: "merge được", không có P0, P1, P2. Hai P3 về test đã sửa ở commit cuối.
- Giữ một P3: trên admin web có hai nút cùng tên "Báo cáo" (mục Báo cáo ở thanh bên và chip trong Cộng đồng).
  - Chip nằm trong nhóm "Mục kiểm duyệt cộng đồng", nên trình đọc màn hình đọc kèm tên nhóm.
  - Mini dùng đúng nhãn này.
- Gate (`tools/gate.sh --no-jest`), bản trước commit test cuối:
  - PASS: tsc 6 gói, eslint (API, Mini App, web), lint:parity, lint-vars, vite build.
  - vitest: app-core 2325, Mini App 6308, web 9330.
  - bundle Mini: entry 651/203 KB.
  - Một FAIL ở lượt Mini giờ UTC: `product-detail-info.spec.tsx` đo được 327 ms, ngưỡng là dưới 300 ms, lúc máy tải 35. File đó thuộc phần shop, nhánh này không đụng. Chạy lại riêng 3/3 xanh.
- Sau commit test cuối: `page.spec.tsx` 263/263 xanh, ca R-75 chạy riêng xanh.
- Không chạy jest API (không đụng API) và Playwright (không có spec e2e nào nhắc hai nhãn này).
