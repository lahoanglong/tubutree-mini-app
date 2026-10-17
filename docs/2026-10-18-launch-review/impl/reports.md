# Gói `reports` — báo cáo KPI, nguồn khách, CSV tài chính

Nhánh `lr/reports`. Agent code không ghi được file báo cáo nên điều phối viên chép lại từ báo cáo trả về (nội dung không đổi).

## 1. Đã làm

Mỗi mục là một commit. `admin.controller.ts` không sửa.

- **D1-04a** (`a9368bbe`)
  - CSV đơn thêm 5 cột ở cuối: Nền tảng, Nguồn đơn, CTV giới thiệu, SĐT CTV, Gian hàng.
  - Thêm CSV theo dòng hàng: `GET /admin/reports/order-items/export`.
  - File chính: `admin-export.ts`, `admin-order-items-export.ts`, `order-channel.ts`.
- **D1-04b** (`5a2b998a`)
  - `GET /admin/reports/revenue?from&to`: tính theo giờ VN, mặc định 30 ngày, tối đa 366 ngày. Trả KPI cả kỳ và doanh thu theo ngày × kênh.
  - Chỉ có một định nghĩa doanh thu, ở `admin-revenue.ts`. `getDashboardStats` đổi sang dùng chung định nghĩa này (diff 17 dòng).
  - Tab web "Báo cáo" gồm `reports-tab.tsx` và các file `reports-*-section.tsx`. Ở `page.tsx` chỉ thêm import, union, 1 dòng menu và 1 dòng render.
- **D2-02** (`b3a84e77`)
  - `GET /admin/reports/sources`, tối đa 180 ngày. Bảng theo nguồn chạm đầu × tuần: khách mới, đơn đầu và đơn 2 trong 30 ngày, doanh thu 30 ngày đầu.
  - Migration `20261018140000_lr_reports_source_indexes`: index `users(createdAt)` và `orders(userId, createdAt)`.
  - Đo trên 200k khách / 400k đơn tổng hợp: khoảng 180 ngày mất 1,1 giây, khoảng 7 ngày mất 0,1 giây.
- **D3-18** (`7025bd76`)
  - `checkout.service.ts:375`: đơn qua gian hàng có nguồn `storefront`. Nguồn `ctv_assisted` chỉ còn dùng khi CTV lên đơn hộ (`affiliate.service.ts:731`).
  - Đã grep: không có mã nào đọc `Order.source` để rẽ nhánh. Hoa hồng dựa vào `referrerUserId`/`placedForCustomer`.
  - Không điền bù dữ liệu cũ vì chưa có khách thật. Đơn cũ có `ctv_assisted` + `placedForCustomer=false` chính là khách tự mua.
- **D1-14** (`2f3b855e`, `3ef8fa2b`)
  - 3 file CSV theo khoảng ngày: `exports/tax` (TNCN CTV), `exports/payouts`, `exports/refunds`.
  - Chỉ ADMIN. Test chạy `RolesGuard` thật: STAFF, khách, CTV, đại lý đều bị 403 ở cả 6 route.
  - Có BOM UTF-8. Chống CSV injection bằng helper dùng chung `csvCell`/`csvText`.
  - Web: `reports-finance-section.tsx`.
- **Sửa theo review** (nhánh đã gộp `review/2026-10-18-launch`, merge `56526473`)
  - `page.spec.tsx`: giữ cả "Báo cáo" lẫn "Cộng đồng"; số mục menu là 32 (git tự gộp ra 31, sai vì cây gộp có cả hai tab).
  - Đơn hai bị tính khống (`38486520`): checkout tách một lần thanh toán thành nhiều đơn cùng `checkoutGroup` (mỗi nơi giao một đơn). Truy vấn nguồn × tuần giờ đánh số lần mua theo `COALESCE(checkoutGroup, code)` với `MIN(createdAt)` của nhóm. Doanh thu 30 ngày đầu vẫn cộng mọi đơn trong nhóm.
  - Khách vãng lai đã gộp (`893edf4d`): `NEW_CUSTOMER_SQL` (trong `admin-source-report.ts`) loại ADMIN/STAFF, dòng có `mergedIntoId` và khách được gắn nguồn lúc gộp. Bảng nguồn và thẻ "Khách mới" của `revenueReport` dùng chung định nghĩa này nên tổng khớp nhau.

## 2. Kiểm chứng (agent báo)

- Jest API (admin, checkout, affiliate, common): 64 suite, 1298 test xanh.
- Race trên Postgres thật:
  - `admin-reports`, `admin-dashboard-kpi`, `r6-checkout`, `r9-ctv-checkout`: 4 suite, 36 test xanh.
  - Thêm `ctv-assisted-refund`, `r12-dealer-storefront-stats`: xanh.
- Migration: `prisma migrate status` có 189 migration, đã cập nhật đủ. `migrate diff --exit-code` báo "No difference detected."
- API: `tsc` và eslint sạch.
- Vitest web (`components/admin`, `app/admin`, `lib`): 41 file, 652 test xanh. Web: `tsc` và eslint sạch.
- Đối chiếu tiền với sổ:
  - Test race so tổng báo cáo với số tính tay và với `getDashboardStats`. Các ca: đơn huỷ, đơn trả, hoàn một phần kể cả phí ship, đại lý trả trước/công nợ, COD đối tác, biên ngày VN.
  - TNCN so từng người với `AffiliateService.pitReport`.
- Chạy lại sau khi gộp nhánh đích và sửa theo review (Postgres cổng 5562, DB `tubutree_it`):
  - Race `admin-reports` (10 test, thêm 2 ca: nhóm đơn cùng `checkoutGroup`, khách vãng lai đã gộp), `admin-dashboard-kpi`, `r6-checkout`, `r9-ctv-checkout`: 4 suite, 38 test xanh. Hai ca mới đỏ trước khi sửa (`secondOrderUsers` 4 thay vì 2; `newUsers` 3 thay vì 2).
  - `jest src/modules/admin src/modules/checkout src/common prisma/reference-data src/modules/system-config`: 66 suite, 1295 test xanh. Không gói nào thêm khoá SystemConfig mới cần duyệt vào `APPROVED_LOADED_KEYS`.
  - `prisma migrate deploy` trên DB mới + `migrate diff --exit-code`: "No difference detected."
  - `tsc` API và web: sạch. Vitest web `src/components/admin src/app/admin`: 40 file, 655 test xanh.
- Không chạy full suite, build hay Playwright.

## 3. Chưa làm hoặc cố ý để lại

- **Phễu sự kiện theo nguồn: để sau.** Lý do:
  - `add_to_cart` không mang `entrySource`/`sessionId`.
  - `order_placed` chỉ có `firstTouchSource` (tính theo người).
  - `app_opened` có thể gửi trước khi đăng nhập.
  - Ghép lại sẽ trộn đếm theo phiên với đếm theo người. Muốn làm, miniapp phải gửi `entrySource`/`sessionId` kèm thêm giỏ và đặt đơn (đụng `cart`/`checkout`).
- Thẻ "Tổng quan KPI" cũ vẫn cộng dồn mọi thời gian. KPI theo khoảng ngày nằm ở tab "Báo cáo".
- Doanh thu ghi vào ngày đặt đơn, không phải ngày thu tiền. Hoàn một phần trừ vào ngày đặt của đơn gốc.
- Không thêm index cho `payouts`/`order_customer_refunds` vì bảng nhỏ và truy vấn đã giới hạn khoảng ngày.
- CSV đơn không có trần số dòng; file được ghi dần theo từng lô.
- "Khách mới":
  - Vẫn tính tài khoản vãng lai CHƯA gộp (chưa đăng nhập bằng số điện thoại), vì schema không có cột đánh dấu.
  - Không tính ADMIN/STAFF, dòng khách đã gộp (`mergedIntoId`) và khách được gộp muộn.
- CSV tài chính (`exports/tax`, `exports/payouts`, `exports/refunds`) xuất SĐT, MST/CCCD và số tài khoản đầy đủ, không che. Chỉ ADMIN tải được.
- Migration index `users(createdAt)`, `orders(userId, createdAt)` tạo không có `CONCURRENTLY`: DB hiện gần rỗng nên khoá ghi dưới 1 giây. Nếu chạy lại khi bảng lớn thì nên tạo bằng tay với `CONCURRENTLY`.
- Mã nguồn: tối đa 40 mã, phần còn lại gộp thành "Nguồn khác". Cửa sổ 30 ngày là hằng số trong mã.
- Rủi ro khi gộp nhánh:
  - `page.spec.tsx` số mục menu hiện là 32 (đã tính cả "Báo cáo" và "Cộng đồng"). Gói khác thêm tab sẽ xung đột ở số này; cộng lại cho đúng.
  - `admin.service.ts` `getDashboardStats` đã đổi sang hằng dùng chung.

## 4. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

- Doanh thu tính theo ngày đặt hay ngày thu tiền? Mặc định: ngày đặt, khớp với danh sách và CSV đơn.
- Có cần phễu theo nguồn không? Mặc định: để sau. Cần đồng ý sửa miniapp gửi `entrySource`/`sessionId` kèm thêm giỏ và đặt đơn.
- "Khách mới" có loại tài khoản vãng lai chưa gộp và chưa có SĐT không? Mặc định: không loại.
- CSV tài chính có cần che SĐT, MST/CCCD, số tài khoản không? Mặc định: không che vì kế toán cần đối chiếu, và chỉ ADMIN tải được.
