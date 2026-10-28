# Gói doirac: lượt 1

## Báo cáo worker (tip ad67bca607e39793d8fb58e94b4f6efcc8886c32)

Nhánh review/1028-doirac (từ 1384ff380). Commit:
43acdd6d6 feat(go-live): chặn bật Đổi rác khi thể lệ trống; go-live báo chính sách bản nháp, giờ mở cửa, vùng phí
1877c92d3 fix(doi-rac): menu/chân trang web theo cờ Đổi rác; Học viện chỉ hiện + gọi API với CTV/đại lý/NV/admin
a4062b4d7 feat(doi-rac): yêu cầu tự cập nhật, thẻ Vừa cộng điểm, tab rỗng, khách chưa cho số, thẻ khoá xếp cuối, gọn đầu trang Cộng đồng
7f450e427 fix(doi-rac): khung chờ trang Đổi rác, bong bóng chat
c79589df3 revert: bỏ khung chờ ở app.tsx (entry Mini +789 B)
e4395c486 fix(doi-rac): nút Yêu cầu của tôi chữ gọn, không xuống dòng
ad67bca60 test(e2e): mock mặc định /config/public; học viện dùng vai CTV

Trạng thái mục:
- Đã làm: R-1 (chỉ phần mã: go-live FAIL/WARN chính sách legal.* trống), R-11 (chặn waste.enabled ở SystemConfigService.set + go-live), R-46..R-51, R-55, R-128, R-129.
- Làm một phần: R-52 (QuantitySelector Mini đã đủ 44px sẵn; chỉ sửa chip), R-53 (bỏ hàng Học viện ở profile.tsx vì gói taikhoan giữ), R-54 (web: gate query + khung chờ trang; Mini: KHÔNG làm khung chờ đầu tiên ở app.tsx vì entry +789 B), R-56 (web guest recycle-new về /doi-rac, thanh đăng nhập dính đáy; KHÔNG làm đọc feed-id/chat không đăng nhập vì API cần JWT).
- R-48/49: sameProvince xử lý lệch mã 84_VN79 và 79 ở client; khớp vùng phí phía API chưa đổi.

Kiểm (số thật):
- tsc sạch: api, web, miniapp, app-core, e2e. eslint sạch file đã sửa.
- jest api 11228/11228. vitest app-core 925, miniapp 4863, web 7441 (đều xanh).
- Playwright Mini App E2E_SCOPE=miniapp: 205 passed, 10 skipped. Web-gate toàn bộ: 354 passed, 38 skipped. Lần đầu có 42 ca đỏ do đầu/chân trang gọi /config/public chưa mock; đã thêm mock mặc định ở apps/e2e/tests/support/mock-api.ts.
- pnpm lint:parity: xanh (0 mục pending).
- Bundle Mini: entry 711 KB không đổi; tổng 1914 so với 1911 KB (+3 KB).
- Race test: không chạy (không đổi logic điểm/tiền).

Ảnh trước/sau (đã xem từng ảnh): /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-doirac/ (recycle, recycle-new, recycle-requests guest+returning, recycle-points, recycle-rules, feed, academy, chat).

Sửa ngoài danh sách file của gói: apps/miniapp/src/components/waste-item-thumb.tsx (token nền), apps/web/src/lib/recycle-wizard.ts, use-waste-visible.ts, file mới ở packages/app-core, packages/shared-types/src/waste.ts (recentCompleted), go-live fixtures + spec, apps/e2e mock-api.ts và community.web.spec.ts. recycle-desk.tsx không đụng.

Chưa kiểm / cần chủ:
- Điền company.* và 4 chính sách legal.* trong Admin (go-live đang chặn).
- Điền thể lệ, giờ mở cửa điểm nhận, vùng phí mail-in; khi điền bảng phí nhập cả hai dạng mã tỉnh (84_VN79 và 79).
- Quyết định có endpoint đọc feed công khai để web khách xem bài/chat không (R-56).
- R-54 Mini khung chờ đầu tiên cần cách khác không tăng entry.
- Đã dừng lane 1; không push.

## Review Opus lượt 1

KẾT LUẬN: chưa merge

- [P2] apps/web/src/components/recycle/recycle-new.tsx:165 — Lỗi hồi quy. Cờ "vừa gửi yêu cầu" chỉ được xoá ở recycle-home.tsx:189. Sau khi khách gửi yêu cầu ở quầy, quầy xác nhận và trang yêu cầu tự chuyển sang /doi-rac/xong/:id (recycle-request.tsx:144). Trong vòng 30 phút, khách bấm "Đổi thêm rác" (recycle-done.tsx:101) thì takeSubmitted() trả true và khách bị đẩy về /doi-rac thay vì vào bước 1. Lối /doi-rac/tao ở thanh toán (thanh-toan/page.tsx:558) cũng bị như vậy. Không có test nào phủ đường này. — Cách sửa: xoá cờ ở trang chi tiết yêu cầu và trang xong (clearSubmitted khi trang được gắn), hoặc chỉ chuyển hướng khi lần điều hướng là Quay lại. Thêm test: markSubmitted, rồi gắn RecycleDone, rồi gắn bước 1, thì không được gọi replace('/doi-rac').
- [P2] apps/miniapp/src/pages/academy.tsx:70 — Mini, phiên ở trạng thái 'unavailable' (mất mạng hoặc API lỗi lúc khôi phục). Khi đó waitingForRole luôn true, nên màn hiện khung chờ mãi, không có thông báo lỗi và không có nút Thử lại. Trước khi sửa, query vẫn chạy và rơi vào ErrorState có Thử lại. — Cách sửa: phase 'unavailable' thì hiện SessionUnavailable hoặc ErrorState có nút gọi restore(); chỉ phase 'loading' mới hiện khung chờ.
- [P2] apps/api/src/config/go-live/db-checks.ts:295 — Go-live báo PASS sai. Kiểm này chỉ xem bảng phí có ít nhất một vùng. Phía API, estimateMailinFee (waste-fee.ts:4) so `provinceCodes.includes(province.code)` khớp nguyên chuỗi. Theo worker, địa chỉ khách lưu "84_VN79". Fixture và gợi ý trong go-live hướng chủ nhập "79", nên go-live ra PASS mà mọi khách TP.HCM vẫn thấy khung "Toàn quốc" 30.000–85.000đ. Worker cũng ghi rằng phía API chưa đổi. — Cách sửa: chuẩn hoá mã ở waste-fee.ts bằng cùng hàm key của app-core/waste-province (hoặc chuẩn hoá khi lưu ở mailinFeeTableProblem). Go-live kiểm thêm: có vùng chứa mã của tỉnh có kho đang hoạt động.
- [P3] apps/miniapp/src/pages/recycle-points.tsx:125 — Mọi lỗi 403 đều bị coi là "chưa cho số". /waste/points chạy ở chế độ FULL nên cũng trả 403 khi PROGRAMME_OFF hoặc BLOCKED (waste-access.service.ts:63,72). Khách đã có số, nếu chương trình bị tắt giữa chừng hoặc khách bị khoá, sẽ thấy "Cho Tubu số điện thoại" kèm nút xin số, bấm vào lại gặp 403. Trước đây màn hiện đúng câu lỗi của server. — Cách sửa: chỉ hiện WastePhoneNeeded khi me.eligibility là NEED_PHONE hoặc GUEST, còn lại giữ ErrorState với thông báo của server.
- [P3] apps/api/src/modules/system-config/system-config.service.ts:487 — Chặn được việc bật waste.enabled khi thể lệ trống, nhưng không chặn chiều ngược lại. Admin vẫn xoá trắng waste.rules_text được khi cờ đang bật, và khách lại phải tick đồng ý với thể lệ rỗng. — Cách sửa: thêm luật từ chối set waste.rules_text thành chuỗi trống khi waste.enabled đang true.
- [P3] apps/miniapp/src/pages/academy.tsx:67 — Mini lấy vai trò từ store, chỉ được làm mới khi mở app. API thì đọc vai trò từ DB ở mỗi request (jwt.strategy.ts:36). Khách vừa được duyệt CTV trong phiên đang mở sẽ thấy cổng "chỉ dành cho CTV" cho tới khi mở lại app. — Cách sửa: gọi restore() sau khi duyệt CTV, hoặc nếu store ghi CUSTOMER thì vẫn gọi API một lần.
- [P3] R-53 chưa xong: lối vào Học viện vẫn hiện cho mọi khách ở apps/web/src/components/home/earn-sheet.tsx:10 và apps/web/src/components/account/account-menu.ts:47. — Cách sửa: lọc bằng canUseAcademy, hoặc ghi rõ là việc của gói taikhoan.
- [P3] apps/web/src/components/recycle/recycle-new.tsx:380 và apps/miniapp/src/pages/recycle-new.tsx:486 — Hai nền viết lặp cùng một luật sắp thẻ, không đặt ở app-core, trái luật hai nền tảng. Thứ tự thẻ còn đổi khi từng preview tải xong, nên thẻ nhảy chỗ. — Cách sửa: đưa thứ tự phương thức (BASE/MAIL_FIRST, lọc, xếp thẻ khoá cuối) vào app-core. Trong lúc preview chưa đủ thì giữ nguyên thứ tự.
- [P3] apps/miniapp/src/pages/feed.tsx (khối ScrollRow) — Mini và web ở khổ 375 lệch nhau (xem feed__returning__ok__s1.png). Mini đặt "Sự kiện" thành chip nằm chung nhóm có nhãn "pickCategory", tức là một lối điều hướng giả làm bộ lọc. Nút "Hỏi Tubu" chỉ còn biểu tượng. Web vẫn giữ hàng nút Xếp hạng, Sự kiện, Đăng bài và kính lúp cuối hàng. — Cách sửa: thống nhất một bố cục cho hai nền; Sự kiện là nút hoặc link tách khỏi nhóm lọc.
- [P3] apps/miniapp/src/components/recycle-page-skeleton.tsx:5 — Chú thích nói khung chờ này dùng cho Suspense, nhưng phần Suspense đã bị revert (c79589df3). — Cách sửa: sửa chú thích.
- [P3] Còn chưa làm, worker đã tự khai: R-54 (khung chờ ở khung hình đầu của Mini) và R-56 (web cho đọc bài/chat khi chưa đăng nhập). Hai mục này cần ghi vào backlog là chưa xong, không tính là đã làm.

Không tìm thấy lỗi sai tiền/điểm/giọt. Không có chữ pháp lý hay thể lệ nào bị tự viết. Đã kiểm các phần: recentCompleted lọc theo trạng thái COMPLETED nên yêu cầu REVERSED bị loại; SQL đếm giờ mở cửa khớp cấu trúc `{day:[{open,close}]}`; chỉ có một đường ghi cấu hình (admin.service.ts:1370 gọi set) nên chốt chặn waste.enabled phủ đủ.
