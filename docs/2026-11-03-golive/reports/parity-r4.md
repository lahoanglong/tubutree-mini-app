# parity r4

Nhánh gl/1103-parity, merge origin/main (fcd4ac0a1) không xung đột (b57dcc426). Commit: f47b6efea (sửa chính), commit sau đó (nhãn sheet). Chưa push.

1. P1 lint:parity: max-md 71 -> baseline 68 xanh (khai báo mobile-first `opacity-[0.45] md:opacity-60`, `opacity-60 md:opacity-100`; hiển thị giữ nguyên). `node scripts/uiux/ds-ratchet.mjs` và `pnpm lint:parity` xanh, không đụng baseline. Không spec nào so chuỗi lớp cũ.
2. P2 sheet: thêm dòng xanh căn phải "Nhận +N Điểm Xanh khi giao thành công" khi quote.pointsEarned > 0 (cùng câu với thẻ tóm tắt; pointsEarnLabel chỉ có ở utils Mini, web dùng chung một biến earnedLabel cho cả hai chỗ, câu y hệt). "Miễn phí" tông xanh (Row prop valueGreen) ở thẻ và sheet. Sheet: nhãn dòng giảm giá không tô xanh, "Tổng thanh toán" nhãn thường (giống Mini, chỉ giá trị đậm).
3. P2 persona new (chưa có báo giá): previewCombo/Discount/Tier từ giỏ, chỉ khi mua trọn giỏ, mã chỉ khi cart.couponCode, hiện khi !quote ở thẻ (chữ "Giảm giá", "Giảm giá combo", "Ưu đãi hạng thành viên" như thẻ fallback Mini) và sheet. Giữ spec mua một phần không ghi số cả giỏ (thêm ca mới cùng ý cho combo).
4. P3 Sheet -> BottomSheet (@/components/mini/bottom-sheet); nút "Chi tiết" disabled khi quoteQ.isError; hai template literal không nội suy thành chuỗi.

Test (checkout-mini.spec.tsx, +6 ca): đỏ 3/6 trên page.tsx cũ (điểm thưởng, Miễn phí xanh, giỏ trọn có combo khi chưa báo giá), xanh sau sửa; 3 ca còn lại là chốt không hồi quy (không điểm, mua một phần, không mã).
Kiểm: tsc web xanh (cần build shared-types, dist bị ignore); vitest src/app/thanh-toan + src/lib: 162 file/1840 test xanh; src/app/thanh-toan + components/mini: 62/708 xanh; pnpm lint:parity xanh; eslint trên 2 file chạy qua pnpm exec không có lỗi.
Playwright web-gate.sh tests/web-checkout.web.spec.ts --workers=2 (khối 3940): 11 passed, 5 skipped.
First Load /thanh-toan (next build, Node 20, cùng máy): trước 22.6 kB / 206 kB; sau 22.8 kB / 206 kB (+0,2 kB trang, First Load không đổi).
Ảnh + số đo: lane 1 (DB tubutree_uat_l1 tạo lại từ mẫu + migrate + seed), persona returning và new, Mini 375 vs web 375, trước/sau, ở screens-parity/{mini,web}375-{returning,new}-{before,after}-{top,bottom,sheet}.png + probe-{before,after}.json.
 - Sheet trước: web thiếu dòng điểm (returning) và dòng Mã giảm giá (new): panel web thấp hơn Mini 25 px (357 vs 382) và 37 px (321 vs 358).
 - Sheet sau: khoảng cách y giữa các dòng (Tạm tính, Mã giảm giá, Phí, Tổng, Nhận +, Đã hiểu) lệch Mini <= 1 px (0/0/0/0/-1/+1); mép trên sheet cùng y trên ảnh. Chênh 24-25 px của phần tử [role=dialog] là do khung dialog web gồm cả thanh kéo, Mini không: không phải lệch hình.
 - Persona new trong lane có địa chỉ? Không: chưa địa chỉ, ra "Giảm giá -30.000đ" (WELCOME30) ở thẻ web trước khi có báo giá; Mini bản chụp là đầu trang, chưa cuộn tới thẻ tóm tắt (cuộn Mini không qua window), chưa đối chiếu ảnh thẻ tóm tắt Mini của new. Combo/hạng của giỏ không có trong seed nên chỉ test đơn vị phủ.
Còn lại / ghi chú: thẻ tóm tắt ở md giữ Row cũ (nhãn xanh cho dòng quote); chỉ dòng xem trước và sheet dùng valueGreen. Lane 1 đã dừng (không --drop); params-l1.json (untracked) đã xoá.

## r5 (commit sau f34e93f44)
1. Thẻ tóm tắt: Row green nay chỉ tô xanh giá trị dưới md (nhãn secondary), nhãn xanh từ md; hậu tố "(MÃ)" và "(N)" bọc span `hidden md:inline` (không thêm max-md). Spec: nhãn/hàng không lớp success, hậu tố hidden md:inline, giá trị xanh.
2. Thứ tự dòng xem trước: combo, Giảm giá, Ưu đãi hạng (như Mini).
3. Xem trước ở thẻ chỉ khi báo giá không chạy (!quote, không loading, không lỗi) như Mini; sheet vẫn xem trước ở mọi trạng thái như Mini. Spec: lỗi ADDRESS_OUTDATED không có dòng giảm; bấm Dùng Điểm Xanh làm báo giá tải lại thì không chen dòng.
4. Nút "Chi tiết": đọc Mini checkout.tsx:1030-1042: thẻ chỉ bỏ role=button khi lỗi, onClick vẫn mở ("chạm vẫn mở như trước"), nên Mini KHÔNG khoá. Bỏ `disabled` ở web, spec ghim disabled=false khi lỗi.
5. Thêm câu "Mua một phần giỏ: mã giảm giá và ưu đãi được tính lại ở bước thanh toán." (chữ y hệt vi.cart.subsetRecalcNote của Mini; chưa có nguồn app-core, dùng literal) khi chưa có báo giá + mua một phần; spec kiểm thêm "-20.000đ" vắng.
6. Giữ Miễn phí xanh ở 1280.
Kiểm: test mới đỏ 5 ca trên page.tsx cũ, xanh sau sửa; vitest thanh-toan + lib 162 file/1844 test xanh; tsc, eslint, lint:parity (max-md 1013, baseline giữ) xanh; Playwright web-checkout 11 passed/5 skipped (khối 3940).
Ảnh r5 (screens-parity/*-r5-*): thẻ tóm tắt web returning nhãn trơn, giá trị xanh, nhịp dòng 35-36 px = nhịp KeyValueRow của Mini (sheet Mini 36/35); sheet lệch <= 1 px như r4. Ảnh Mini thẻ tóm tắt chưa cuộn tới (cuộn Mini không qua window), so bằng nhịp dòng và ảnh sheet. Lane 1 đã dừng.
