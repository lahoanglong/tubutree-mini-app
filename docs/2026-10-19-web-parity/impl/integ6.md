# Lane integ6: Đồng bộ web đổi rác với Mini App đổi rác bản mới

## 1. Đã làm
Bảng commit Mini App (`07ac5aa1..13ffd242`) sang file web. Cột cuối: đã theo, hoặc không cần và lý do.

| Commit Mini App | Hành vi/chữ đổi | File web | Kết quả |
|---|---|---|---|
| 967de78a, fcff6dde, cab3fd8b, 51296fc1 | `requestStatusText`, `isRequestPaused`: một dòng trạng thái theo cách giao, "Đang tạm dừng" cho Mang tới và Thu kèm đơn chưa gắn khi chương trình tắt, khách bị khoá, cờ pickup tắt | `recycle-labels.ts`, `recycle-home.tsx`, `recycle-requests.tsx`, `recycle-request.tsx` | Đã theo (056031d0, d2619c60, 3a1d3753) |
| 967de78a, 3ad093f2 | Timeline gọn có chữ bước hiện tại; `hints` dưới tên bước, canh trên khi có hint | `recycle-timeline.tsx` (+spec mới) | Đã theo (d2619c60) |
| 29b6ccf2, 7db929e1, 52e60534 | Chi tiết yêu cầu: nhãn trạng thái, bước 2 ghi điểm nhận, địa chỉ, hạn; dòng "Ước tính" chỉ khi đang chạy; ẩn gợi ý khi tạm dừng hoặc điểm hết hạn mức; SĐT người nhận nhóm số; tiêu đề không lặp mã khi khối mã đã hiện | `recycle-request.tsx` | Đã theo (3a1d3753) |
| f5bf6306, 0adb2df5 | Câu huỷ, câu khoá viết hoa đầu câu; `monthRemainingText`; `voucherPhrase` ("mã giảm 50.000đ") | `recycle-labels.ts`, `waste-item-step.tsx` | Đã theo (056031d0, 475fe8a5) |
| 4a740055, e2bfa53d, e5cdcae4 | Thẻ cách giao: phí ship ghi tên tỉnh, bỏ mã tỉnh khi chưa có tên; NEED_PROVINCE chỉ khi chọn Gửi về kho, tông trung tính; lý do khoá tông cảnh báo, chỉ mờ phần chữ | `recycle-new.tsx` | Đã theo (475fe8a5) |
| d4652d20 | Điểm nhận: chip món, lý do khoá xuống dòng, chỉ radio và phần chữ mờ | `waste-point-picker.tsx` | Đã theo (475fe8a5) |
| 502e810f | Quầy vẫn vào được khi chưa đủ điều kiện (NEED_PHONE) | `recycle-home.tsx` | Đã theo (d2619c60) |
| e38ec2da, 60cc2c22, 98772801, 262762f6 | Quầy: bộ đếm điền sẵn số khai, "Tối đa N", lý do nhận thiếu có nhãn và nhắc, thanh xác nhận dính đáy, thẻ kết quả, hạn mức có thanh tiến độ, "Còn lại", ưu đãi và báo cáo xuống cuối, nhắc "Chọn một lý do" ở sheet từ chối, nút nguy hiểm khoá nhìn như khoá | `recycle-desk.tsx` | Đã theo (a4d3c6e7); nút nguy hiểm khoá: web đã có `disabled:opacity-50`, không cần |
| fa98a8e8, eb9ecde0, b82a7ad4, 7832d7e1 | Kho quà, Quà của tôi, `pointsRulesNote` | `app/kho-qua/**` | Không làm: thuộc lane loyalty (xem mục 5) |
| fa8cfbab, 51bfdb25 | Nhãn lịch sử điểm đơn tư vấn viên, đơn sàn | `lib/ledger-labels.ts` | Không cần: web đã có bốn mã này |
| 587c4b0c | Khoá mốc hạng `tubu_last_tier_min_v2` | `app/tai-khoan/diem-xanh/page.tsx` | Không làm: thuộc lane loyalty (xem mục 5) |
| 653b3e19, 89c3c778, 6c682012 | Game: slot khi mở lô, giá vòng quay | game | Không làm: ngoài phạm vi lane đổi rác |
| button.tsx, timeline.tsx (UI Mini App) | Primitive UI | `recycle-timeline.tsx` | Timeline đã theo; button không cần |
| Thẻ đổi rác ở trang chủ/hub | Không có thay đổi Mini App ở trang chủ/hub trong khoảng này | không | Không cần |

Không đổi endpoint, body, Idempotency-Key nào. Bộ đếm quầy điền sẵn số khai: body xác nhận cùng dạng dòng (`itemId`, `declaredQty`, `receivedQty`, `shortfallReason`), giá trị mặc định đổi theo Mini App.

## 2. Kiểm chứng
```
cd apps/web && npx vitest run
 Test Files  358 passed (358)
      Tests  6166 passed (6166)
npx tsc --noEmit            (không lỗi)
npx eslint src/components/recycle src/app/doi-rac   (không lỗi)
```
Test đỏ trước khi code ở từng nhóm (nhãn, trang tổng, tạo yêu cầu, chi tiết, quầy). Mini App không bị sửa file nào nên test Mini App không chạy lại.

## 3. Review
Chưa chạy review Opus trong lần này. Điểm nên soi: quầy (số mặc định của bộ đếm, thẻ kết quả, hai bản thanh xác nhận), `isRequestPaused` khớp Mini App.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng
- Playwright không chạy; `apps/e2e/tests/recycle.web.spec.ts` đã cập nhật cho chữ mới của quầy nhận (hạn mức, bộ đếm điền sẵn, thẻ kết quả), chưa chạy được ở lane này.
- Chưa kiểm bằng trình duyệt thật: bố cục quầy hai cột trên desktop sau khi dời ưu đãi và báo cáo, thanh dính đáy trên điện thoại.
- Bản máy tính của thanh xác nhận quầy nằm trong thẻ yêu cầu, bản điện thoại là thanh dính; hai bản cùng nội dung nên jsdom thấy hai nút "Xác nhận đã nhận".

## 5. Câu hỏi cho chủ dự án
- Kho quà web (`app/kho-qua/page.tsx`, `cua-toi`) cần theo Mini App: biểu tượng theo loại quà, hàng giá và nút, ẩn dòng "Đổi quà dùng được" khi trùng tổng, ghi chú luật dùng điểm (`pointsRulesNote`), thẻ mã voucher dạng card, nhãn "Chờ nhận", QR canh giữa. Ngoài phạm vi file lane này; giao cho lane loyalty hoặc một lane riêng?
- `app/tai-khoan/diem-xanh/page.tsx` còn khoá `tubu_last_tier_min`; Mini App đã đổi sang `_v2`. Cùng câu hỏi lane.
