# Gói taikhoan: lượt 1

## Báo cáo worker (tip 2a558ac8f)

Nhánh review/1028-taikhoan (worktree r1028-taikhoan). Commit:
d0b735fda feat(don-hang) ETA từ shipping.eta + giờ Mini theo giờ VN
a491f1cea feat(don-hang) chi tiết đơn: ETA, ảnh món bấm mở, Ghi chú, khung chờ, màn lỗi
1c3597d14 fix(tai-khoan) trạng thái rỗng đơn/địa chỉ/thông báo web = Mini, BestSellerRail, nút Thêm địa chỉ chính
5eb2e75c9 feat(ca-nhan) hàng đơn có icon + chấm số, chat ở đầu, Học viện theo vai, avatar chữ cái, Đăng xuất chỉ ở Cài đặt
ba0a6e2df fix(tai-khoan) nhãn đơn ngắn, thẻ thống kê không bị che, avatar, tiêu đề trống
2a558ac8f test(e2e) hồ sơ web bỏ dòng chưa đổi được ảnh

Từng mục:
R-9 làm: dòng "Dự kiến giao" (hero + bước cuối timeline) tính từ shipping.eta_min/max_days theo ngày VN, chỉ CONFIRMED/PACKED/SHIPPING; cấu hình trống thì ẩn. Chủ phải đặt eta trên PROD.
R-33,34,35,36 làm (chi tiết đơn Mini+web: ảnh món 48 bấm mở sản phẩm, Ghi chú, skeleton, màn lỗi 404/500, nhãn/tone khớp Mini).
R-107..R-111,R-113,R-115 làm theo mục: avatar chữ cái, hàng đơn icon+chấm số (ẩn khi 0), chat icon, Học viện chỉ AFFILIATE/DEALER/STAFF/ADMIN, lỗi tải số đơn có thử lại, đơn rỗng có món bán chạy, thông báo/địa chỉ rỗng, dob dd/mm.
R-111 MỘT PHẦN: Đăng xuất bỏ ở Cá nhân/Giới thiệu, chỉ còn ở Cài đặt (ẩn với khách); KHÔNG chuyển "Xoá tài khoản" (cần dời test).
R-113: chưa điều tra vì sao new-customer-offer không trả voucher.
R-53 làm: hàng Học viện chỉ hiện đúng vai. R-30 ô "Định kỳ" không đụng (gói muahang). B-151 xong (format.ts giờ VN).

Kiểm (số thật):
tsc app-core/miniapp/web: sạch. eslint file đổi (miniapp, web): sạch. lint:parity: xanh 0 pending.
vitest app-core 922/922; miniapp 4872/4872 (lần đầu 1 fail do tải máy, chạy lại xanh; TZ=UTC 4872/4872); web 7449/7449 (441 file).
Playwright miniapp: 204 passed, 10 skipped, 1 flaky (buy-flow-4b-browse scroll, không liên quan). web-gate account.web 28/28 (sau sửa 1 assert), order.web 24/24.
jest API không chạy (không đụng API).
Bundle Mini: entry 711 KB raw (bằng baseline), tổng 1917 KB raw/740 gz (không có số tổng baseline để so, entry không tăng).
Web First Load (log next build, so log review-1028): /tai-khoan 170->172, dia-chi 140->143 (+3), don-hang 184->190 (+6, do BestSellerRail theo R-113), don-hang/[code] 191->193, ho-so 144->145. VƯỢT +2 KB ở dia-chi và don-hang.

Ảnh trước/sau (đã Read profile, edit-profile, addresses, order-code, orders, notifications, error500): /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-taikhoan/{returning-s1,returning-s2,new-s1,new-s2,guest-s1,guest-s2,error500,offline}. Chưa Read: settings, about, guest, offline.

Chưa kiểm / quyết định / lệch:
- Chưa chụp ảnh đơn SHIPPING có dòng ETA (có unit test 10+5+7, chưa thấy ảnh).
- Ô ngày sinh native vẫn hiện mm/dd/yyyy trong Chromium headless en-US (theo locale); đã lang="vi", ngày đã lưu hiện dd/mm/yyyy.
- Nhãn hàng đơn rút "Chờ trả" (hết đè chữ ở 375px).
- Nút chat ở đầu Cá nhân không có chuông (Mini không có).
- CTA ở thông báo rỗng bỏ cho khớp Mini.
- Sửa ngoài phạm vi: apps/web/src/app/gioi-thieu/about-view.tsx (bản sao Mini) và apps/e2e/tests/account.web.spec.ts.
- Lane 3 đã dừng (không --drop); params-l3.json chưa commit.

## Review Opus lượt 1

KẾT LUẬN: chưa merge

- [P1] apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:396 — Lớp `max-md:order-13` không tồn tại trong Tailwind 3.4.16. Bản cài đặt mặc định chỉ có order-1 đến order-12 và tailwind.config.ts không thêm `order`, nên Tailwind không sinh CSS cho lớp này. Khối SupportContact vì vậy giữ order 0 và nhảy lên ngay sau khối thanh toán, trước "Vận chuyển". Ảnh screens-taikhoan/returning-s2/order-code__returning__ok__s2.png (Web sau) cho thấy đúng như vậy: khối "Chat với Tubu Tree / Gọi hotline / email" nằm trên "Vận chuyển", còn Mini để khối này ở cuối trang. Đây là hồi quy so với trước khi sửa, đi ngược R-108 (thứ tự khối theo Mini). Sửa: dùng `max-md:order-last` hoặc `max-md:order-[13]`. Thêm một kiểm tra Playwright 375 so vị trí Y của "Cần hỗ trợ?" với "Vận chuyển", vì jsdom không bắt được lỗi CSS.
- [P2] apps/miniapp/src/pages/profile.tsx:381, apps/web/src/app/tai-khoan/page.tsx:328 — Nhãn hàng đơn có `whiteSpace: 'nowrap'` trong lưới 5 cột `minmax(0,1fr)`. Ở 375px mỗi cột chỉ khoảng 60px nên "Đang xử lý" tràn sang cột bên. Mọi ảnh "sau" (profile returning/guest/error500, cả Mini lẫn web) đều hiện "Đang xử lýĐang giao" dính liền. Ở 360px hai nhãn sẽ đè lên nhau. Báo cáo ghi "hết đè chữ ở 375px" là sai. Sửa: rút gọn thêm nhãn trong `orderRowLabel` (ví dụ "Xử lý") hoặc cho xuống dòng với chiều cao cố định, rồi chụp lại ảnh 360 và 375.
- [P2] packages/app-core/src/shipping-eta.ts:30 — `orderDeliveryEtaLabel` vẫn hiện ngày đã qua. Ví dụ: đơn SHIPPING xác nhận 15/10, eta 2–4 ngày, hôm nay 28/10, chi tiết đơn vẫn ghi "Dự kiến giao 17/10 – 19/10". Dòng này cũng không xét món đặt trước: đơn có `backorderedQty>0` hiện cả "Đặt trước … chờ hàng về" lẫn "Dự kiến giao" 2–4 ngày, tức là bịa ngày, trái ràng buộc R-9. Sửa: trả null khi ngày max đã qua theo ngày VN hôm nay, và khi có món đặt trước. Hỏi chủ có ẩn luôn với đơn `fulfilment.kind === 'MERCHANT'` không. Thêm unit test cho cả hai trường hợp.
- [P2] apps/web/src/app/tai-khoan/don-hang/page.tsx:9, apps/web/src/app/tai-khoan/dia-chi/page.tsx:13 — First Load vượt mức +2 KB của gd3-worker-brief.md:44: don-hang tăng 6 KB, dia-chi tăng 3 KB. Báo cáo cũng không so tổng bundle Mini với baseline, dù brief yêu cầu "tổng không tăng". Sửa: tải `BestSellerRail` bằng `next/dynamic` (ssr:false, chỉ khi danh sách rỗng), rồi đo lại dia-chi. Đo tổng Mini trên nhánh gốc để so.
- [P3] apps/miniapp/src/pages/edit-profile.tsx:267, apps/web/src/app/tai-khoan/ho-so/page.tsx:262 — R-110 mới làm một phần. Khi chưa có ngày sinh, ô `type=date` vẫn hiện mm/dd/yyyy theo locale máy; `lang="vi"` không có tác dụng trên Chromium hay webview Zalo. Sửa: dùng ô chữ dd/mm/yyyy có mặt nạ nhập, hoặc báo chủ là mục chưa xong.
- [P3] R-111 mới làm một phần: "Xoá tài khoản" vẫn ở trang Giới thiệu (apps/miniapp/src/pages/about.tsx, apps/web/src/app/gioi-thieu/about-view.tsx). R-113 chưa điều tra vì sao `new-customer-offer` không trả mã. Ghi rõ ở backlog là còn mở, không đánh dấu xong.
- [P3] apps/web/src/app/gioi-thieu/about-view.tsx:312 — File này nằm ngoài vùng file của gói (gói chỉ được sửa `app/tai-khoan/**` và `components/account/**`). Thay đổi đúng ý R-111 nhưng cần ghi vào PR để người giữ gioi-thieu biết.
- [P3] apps/e2e/tests/account.web.spec.ts — Assert đổi thành `toHaveCount(0)` cho một câu đã bị xoá khỏi mã, nên lần chạy nào cũng xanh và không kiểm gì. Sửa: assert `profile-avatar-initial` hiện đúng chữ cái đầu.
- [P3] packages/app-core/src/shipping-eta.ts:31 — Ngày dự kiến tính từ giờ CONFIRMED, còn màn thanh toán tính từ lúc đặt. Đơn đặt 23:00, sáng hôm sau mới xác nhận: thanh toán báo "30/10 – 01/11", chi tiết đơn báo "31/10 – 02/11". Hỏi chủ có chấp nhận lệch một ngày không, hoặc tính từ createdAt cho khớp. Chưa có ảnh đơn SHIPPING có dòng dự kiến giao để đối chiếu.

Đã kiểm, không thấy lỗi:
- Quyền Học viện: `canSeeAcademy` khớp `@Roles('AFFILIATE','DEALER','STAFF','ADMIN')` ở apps/api/src/modules/academy/academy.controller.ts:7.
- B-151: format.ts (UTC+7 cố định) đúng; Mini không còn chỗ nào gọi getHours hay toLocale*.
- Logic mới nằm ở app-core và không gọi window hay zmp-sdk.
- Cấu hình trống thì dòng dự kiến giao bị ẩn.
- Không đụng tiền, điểm, phí hay thể lệ.
