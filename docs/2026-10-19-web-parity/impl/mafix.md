# Lane mafix: sửa hai lỗi Mini App theo quyết định chủ 2026-10-19

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Thanh toán: đóng băng body và Idempotency-Key sau lần đặt chưa rõ kết quả; chỉ lựa chọn của khách mới mở băng (choiceRev); màn "Đơn của bạn có thể đã được tạo"; màn QR theo `o.paymentMethod` | 21cf0dc2 | apps/miniapp/src/pages/checkout.tsx, checkout.spec.tsx |
| Hồ sơ: chỉ gửi ngày sinh khi khách chưa có, ô readOnly khi đã có | e2e38279 | apps/miniapp/src/pages/edit-profile.tsx, edit-profile.spec.tsx |
| Review vòng 1: chạm lại đúng phương thức đang chọn không mở băng; khối báo cố định `place-notice` cạnh StickyActionBar (hai nhánh chữ như web, nút "Đơn của tôi" sang /orders) | 3dc2183c | checkout.tsx, checkout.spec.tsx |
| Sửa cỡ nút khối báo cho đúng kiểu Button (tsc) | becd4663 | checkout.tsx |

Route web: lane này không đụng web, không có route nào bỏ pending.

## 2. Kiểm chứng (summary.txt của gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)  Tests  489 passed (489)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  358 passed (358)  Tests  6178 passed (6178)
web-test-utc rc=0  Test Files  358 passed (358)  Tests  6178 passed (6178)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)  Tests  4313 passed (4313)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0 (chỉ cảnh báo chunk size)
DONE
```

Test Mini App 4313 (sàn 4299). Chưa chạy Playwright (luật cứng).

## 3. Review

Vòng 1 (3 MINOR, cả ba đã sửa):
- Chạm lại đúng phương thức đang chọn vẫn tăng choiceRev: đã sửa ở 3dc2183c (chỉ đếm khi giá trị đổi, có test).
- Thiếu khối báo cố định và lối sang Đơn của tôi khi giỏ còn hàng: đã sửa ở 3dc2183c (hai test).
- Ba test cũ bị sửa chưa nêu trong commit: đã nêu trong thân 3dc2183c. Commit 21cf0dc2 và e2e38279 không amend, nên mô tả PR cần nhắc lại (hoặc chủ amend khi gộp).

Vòng 2: không có phát hiện. Ghi chú không phải lỗi: sau lần bị chặn PREVIOUS, trong lúc request đang bay Mini App vẫn hiện chữ "previous" (web ẩn vì đọc isError); nút đang loading nên khách không gửi đôi được.

Test cũ đã sửa: checkout "5xx rồi bấm lại... đổi cách thanh toán" (R2-MONEY-2, thêm một lần bấm bị chặn); edit-profile "lưu thành công" (dùng khách chưa có dob) và "gửi lại avatar" (kỳ vọng dob undefined).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa chạy Playwright; đã grep apps/e2e/tests/checkout.miniapp.spec.ts, không có ca khoá hành vi cũ.
- Câu nhắc ngày sinh là Text riêng, nội dung giống web.
- use-idempotency-key.ts không đụng (checkout dùng createOrderKeyRing).

## 5. Câu hỏi cho chủ dự án

1. Yêu cầu ghi "đổi lựa chọn thì key mới, body mới ngay", nhưng web chặn một lần rồi mới gửi đơn mới. Mặc định đã dùng: giống web (chặn một lần, an toàn tiền hơn).
2. Mô tả PR có nhắc ba test cũ đã sửa, hay amend thân commit 21cf0dc2 và e2e38279 khi gộp? Mặc định: không amend, nhắc ở PR.
