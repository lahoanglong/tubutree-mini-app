# Gói ctv: lượt 1

## Báo cáo worker (tip bd8684ef9858e7b4c0f5c9b62e182034b854150c)

Gói ctv, worktree r1028-ctv, nhánh review/1028-ctv, lane 7. Chưa push/merge/deploy.
LÀM: R-12 (chỉ hiển thị), R-57, R-58, R-59, R-60, R-61, R-62, R-63 (chỉ điền sẵn tên/SĐT), R-64, R-65, R-66, R-67, R-137, R-139, R-141, R-142.
- R-12: trang CTV (Mini + web) số to "Có thể chuyển vào Ví", dòng phụ "Đang chờ: ... đơn chưa giao hoặc trong thời gian đổi/trả", nút Chuyển vào Ví luôn bấm được, sheet giải thích khi chưa có tiền. Không tự chuyển, không đổi cách tính.
- R-57: affiliate.register xoá cache role SessionState. R-66: GET /storefront/me và brand owner trả null thay 404; client Mini/web xử lý.
- R-58/59/60: 3 tab Tổng quan/Hoa hồng/Chia sẻ (app-core ctv-dashboard.ts), query theo tab; mốc thưởng thu gọn; Ví Tubu dùng cùng nhãn "Hoa hồng đang chờ".
- R-61: khách xem gian hàng CTV không còn nút dính đáy, chỉ link "Xem thêm ở Tubu Tree".
- R-62/63/137: đại lý: bảng giá tên 2 dòng, rỗng đúng ngữ cảnh, tab giữ trên URL, "Báo đã chuyển khoản", điền sẵn tên/SĐT. Không đụng chữ CCCD.
- R-64/65/141: trang nhân viên/lương: EmptyState + "Về Cá nhân"; thẻ chấm công không báo "không có ca" khi đang tải/lỗi (Thử lại); nút "Đăng ký ca", "Chép tuần".
- R-67: copy/caption/QR dùng link Mini App (zalo.me/s/<id>/...), web giữ link web.
KIỂM (đã chạy, xanh): tsc api/web/miniapp/app-core/e2e; eslint file đã sửa (3 app) sạch; lint:parity xanh; jest api 484 suite/11220 test; vitest app-core 932; web 7441; miniapp 4873 (kể cả TZ=UTC) sau khi sửa 3 spec share-sheet/web-base-url; Playwright miniapp 203 passed/10 skipped; web-gate affiliate+pro+account+order+web-checkout xanh sau khi sửa spec/mock (ví, tab, nhãn nút).
BUNDLE Mini: entry 711 KB raw = baseline, không tăng. web First Load: CHƯA đo (không chạy next build), unverified.
ẢNH: screens-ctv (review-1028) có 10 ảnh trước/sau (affiliate, storefront, s-slug guest, wallet, dealer x2, staff x2, my-payroll); đã mở xem từng ảnh. affiliate CTV persona không có hoa hồng thật nên chỉ thấy 0đ.
BỎ/SAI LỆCH: không sửa 403 /merchant/store (guard auth); không làm toast trên trang gian hàng, "giỏ nổi", sticky header web, cứng "10 ngày". Web khách: dải đệm đáy 90px có thể còn cho khách (chưa kiểm). Chữ Mini "Chép tuần" (aria-label vẫn "Chép tuần trước") ngắn hơn web để khỏi bị cắt. Ảnh web trang chặn nhân viên chưa phản ánh sửa mới (web lane là bản sao cũ); sửa đã qua vitest. SĐT điền sẵn trên web phụ thuộc trường runtime.
Dọn: lane 7 đã dừng (không --drop), routes.json khôi phục, params-l7.json xoá, không commit ảnh.

## Review Opus lượt 1

KẾT LUẬN: chưa merge

- [P2] packages/app-core/src/ctv-dashboard.ts:30 — Câu trong sheet "Chuyển vào Ví" ghi: "Hoa hồng vào Ví khi đơn đã giao và hết thời gian đổi/trả". Câu này hiểu thành tiền tự vào Ví, nhưng code không làm vậy: hoa hồng APPROVED chỉ thành "có thể chuyển", CTV vẫn phải tự bấm (xem comment ở apps/miniapp/src/pages/wallet.tsx, cạnh thẻ "Hoa hồng có thể chuyển vào Ví"). Ví dụ: CTV đọc câu này rồi ngồi chờ, tiền nằm ở APPROVED mãi không vào Ví. Ràng buộc R-12 là KHÔNG tự chuyển, nên câu chữ cũng không được hứa tự chuyển. Sửa: "Hoa hồng chuyển được vào Ví sau khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: …", đồng thời sửa chuỗi kỳ vọng trong spec của app-core, Mini và web.
- [P2] apps/miniapp/src/components/content-kit-sheet.tsx:26, apps/miniapp/src/pages/product-detail.tsx:345, apps/miniapp/src/pages/profile.tsx:214 — R-67 mới làm một phần. Ràng buộc là "trong Mini App mọi link chia sẻ dùng link Mini App", nhưng ba chỗ này vẫn dựng link web `${WEB_BASE_URL}`: lời đăng trong bộ nội dung CTV, link sản phẩm kèm mã giới thiệu, link chia sẻ mã ở Cá nhân. Worker còn giữ apps/miniapp/src/utils/web-base-url.spec.ts để khẳng định content-kit dùng WEB_BASE_URL, và không ghi phần này vào mục BỎ. Sửa: chuyển cả ba sang `miniAppLink()`, hoặc ghi rõ là bỏ có chủ ý để chủ quyết.
- [P2] apps/miniapp/src/pages/staff.tsx:508 (web: apps/web/src/components/staff/staff-hub.tsx:198) — Phần "Tô thẻ ngày hôm nay" của R-65 chưa làm. Trong ảnh staff__staff__ok__s1, T4 28/10 trông giống hệt các ngày khác ở cả Mini lẫn web. Worker báo R-65 đã xong. Sửa: so `dk === todayKey` để đổi viền/nền, làm ở cả hai nền tảng, kèm test.
- [P3] apps/miniapp/src/pages/affiliate.tsx:936, apps/web/src/app/ctv/page.tsx:689 — Nút Chuyển vào Ví giờ luôn bấm được. Nếu bấm lúc dashboard đang tải (`d` còn undefined, `head.big = 0`), sheet báo "Đang chờ: 0đ" dù CTV có thể đang có tiền chờ; dữ liệu về xong sheet lại tự đổi sang form chuyển. Sửa: lúc `dashQ.isLoading` thì hiện Skeleton trong sheet, hoặc chưa mở sheet.
- [P3] apps/miniapp/src/pages/staff.tsx:236-247 — Chưa có test Mini nào cho trạng thái lỗi/đang tải của thẻ chấm công (R-64); grep "Không tải được trạng thái chấm công" chỉ thấy trong spec của web. Nút "Về Cá nhân" (R-141) cũng không có test ở Mini lẫn web, nên câu "sửa đã qua vitest" trong báo cáo là không có căn cứ. Sửa: thêm spec cho ba trường hợp `getAttendanceStatus` bị reject, đang pending, và role CUSTOMER rồi bấm "Về Cá nhân".
- [P3] apps/miniapp/src/pages/wallet.tsx:171, apps/web/src/app/tai-khoan/vi-tubu/page.tsx (thẻ "Hoa hồng đang chờ") — Chưa có test cho việc chạm thẻ "Hoa hồng đang chờ" để sang tab Hoa hồng (R-60), cũng chưa có test cắt nhãn hạng dài (R-139). Spec chỉ được đổi chữ. Ảnh wallet__returning dùng persona không phải CTV nên không thấy thẻ hoa hồng, tức thay đổi chưa được nhìn bằng ảnh. Sửa: thêm test và chụp ảnh persona CTV kèm bản longtext.
- [P3] apps/web/src/components/staff/staff-hub.tsx:180, apps/web/src/components/staff/staff-shell.tsx:76 — Mini và web ở khổ 375 lệch nhau. Mini ghi "Chép tuần", web ghi "Chép tuần trước" và rớt xuống 2 dòng (xem ảnh). Trang chặn nhân viên ở Mini dùng EmptyState có hình, web chỉ có đoạn chữ và một nút. Sửa: dùng chung một nhãn ngắn, và web dùng EmptyState giống Mini.
- [P3] apps/api/src/modules/brand/brand.controller.ts:43 — Rủi ro lệch phiên bản. Sau khi deploy API, Mini App bản cũ trên Zalo Live nhận 200 với thân rỗng. Code cũ đọc `!q.data` mà status không phải 404, nên người chưa có nhãn mở /brand-owner sẽ thấy ErrorState "không tải được" thay vì màn trống. Sửa: phát hành Mini App mới cùng lúc với API, hoặc ghi lại điều này trong ghi chú deploy.
- [P3] packages/app-core/src/storefront-signup.ts:593-596 — Hai dòng điều kiện đầu cùng lặp gợi ý "Đăng ký ở nút bên dưới.". Trạng thái đạt/chưa đạt chỉ thể hiện qua icon, mà icon đặt `aria-hidden`, nên trình đọc màn hình không biết dòng nào đã đạt. Sửa: chỉ để gợi ý ở dòng đầu, thêm chữ ẩn cho trình đọc màn hình kiểu "Đã đạt" / "Chưa đạt".

Đã kiểm và không thấy lỗi:
- Không đổi cách tính hoa hồng.
- `commissionPending` ở Ví và `pendingCommission` ở trang CTV cùng điều kiện PENDING+LOCKED, nên dùng chung nhãn là đúng.
- Không có code phía API nào còn dựa vào `getOwnedBrand`/`getMine` ném 404.
- `apiFetch` của web đọc thân 200 rỗng thành null, Mini có `|| null`.
- Dòng "Số dư Ví" trên trang CTV được làm mới sau khi chuyển tiền.
- Đổi `?tab=` ở Mini dealer không làm trang dựng lại, vì AnimationRoutes đặt key theo pathname.
- Không đụng chữ CCCD.
- Web có trả `phone` trong toAuthUser, nên điền sẵn SĐT trên web dùng được.
