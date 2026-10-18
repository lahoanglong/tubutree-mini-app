# Lane affiliate (web/affiliate)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| CTV: đăng ký (termsVersion 2026-10) và bảng điều khiển hoa hồng | 7a558c87 | `apps/web/src/app/ctv/page.tsx`, `components/affiliate/ctv-copy.ts`, `ctv-shortcuts.tsx` |
| Quy tắc thuần: thuế rút, MST, mức rút, SĐT gõ tay, key ring đơn | 803f7d57 | `packages/app-core/src/affiliate-rules.ts`, `order-key-ring.ts` |
| Rút hoa hồng về Ví/Ngân hàng, thuế TNCN, MST | b97f9fd7 | `components/affiliate/withdraw-sheet.tsx` |
| Bậc CTV, thưởng mốc, phân tích gian hàng/sản phẩm | 3b7169b7 | `components/affiliate/` (TierCard, MilestoneRewards, phân tích) |
| CTV lên đơn hộ (báo giá rồi tạo đơn) | b9df7e8f | `components/affiliate/ctv-order-sheet.tsx`, `recent-customers.ts` |
| e2e CTV (chưa chạy), sửa spec formatCount | 4f6412ff, 6d5ae9da | `apps/e2e/tests/affiliate.web.spec.ts` |
| `/s/[slug]` nhận ra chủ gian hàng | fb8ef845 | `components/affiliate/storefront-owner.tsx` |
| Quy tắc thuần trình dựng gian hàng | 45a744fd | `storefront-rules.ts`, `storefront-theme.ts` |
| Trình dựng `/ctv/gian-hang` | a645d838 | `app/ctv/gian-hang/*`, `storefront-*.tsx` |
| Sửa review vòng 1 và 2 | 541c87e6, bc3e70e3, 0a9dad76, c6a49942, 1f7ef158, 969e2ebc, 737d7334 | xem mục 3 |

Route đã bỏ pending: `/ctv`, `/storefront` (web: `/ctv/gian-hang`). `/s/[slug]` đã có từ trước, được mở rộng.

## 2. Kiểm chứng (gate cuối, xanh)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  40 passed (40)  Tests  483 passed (483)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  247 passed (247)  Tests  3967 passed (3967)
web-test-utc rc=0  Test Files  247 passed (247)  Tests  3967 passed (3967)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)  Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (29 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

Không sửa file Mini App nào.

## 3. Review

Vòng 1 (5 MINOR, không BLOCKER/MAJOR):
- Đơn hộ chuyển khoản dẫn CTV sang Mini App lấy QR: đã sửa ở bc3e70e3 (dẫn tới `/tai-khoan/don-hang/:code`).
- `withdrawView` không chờ config cho ví: đã sửa ở 541c87e6.
- Tạo bộ sưu tập xoá tên trước khi API trả lời, thiếu maxLength 80: đã sửa ở 0a9dad76.
- `/s/[slug]`: chủ mất nút chia sẻ, khách luôn về `/`: đã sửa ở c6a49942, test cập nhật ở 969e2ebc.
- Khách gần đây còn trong localStorage sau đăng xuất: đã sửa ở 1f7ef158.

Vòng 2 (1 MINOR):
- Config rút tiền lỗi làm nút kẹt "Đang tải…" không có Thử lại (do sửa vòng 1): đã sửa ở 737d7334, 2 test mới trong `withdraw-sheet.spec.tsx`, test đỏ trước.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Playwright không chạy (luật cứng): `apps/e2e/tests/affiliate.web.spec.ts` mới chỉ typecheck; selector GeoPicker và ô tìm sản phẩm có thể cần chỉnh.
- Mini App không có chọn năm cho bảng kê thuế nên web cũng không thêm.
- Lệch hành vi đã biết: web chờ config cho cả ví (Mini App chỉ chờ cho BANK), theo app-core `withdrawView`.
- Spec `ctv-order-sheet` chạy khoảng 30 giây; nếu timeout do tải thì chạy lại riêng.
- Đưa `/ctv` vào menu/hub tài khoản thuộc lane khác, chưa sửa.

## 5. Câu hỏi cho chủ dự án

1. Web có UI chọn loại COMBO, bố cục, % giảm combo mà Mini App không có (đề lane yêu cầu). Mặc định: body chỉ thêm `kind`/`layout`/`comboDiscountPct` khi khác mặc định; % số nguyên 0-100. Cần duyệt.
2. Trang `/thanh-toan/chuyen-khoan/:code` còn pending. Mặc định: dẫn sang `/tai-khoan/don-hang/:code` (có QR); khi route mở sẽ hiện "Mở trang thanh toán (gửi khách)".
3. Tạo gian hàng xong mà áp mẫu lỗi: giữ sheet mở, chọn lại gọi lại `POST /storefront` (giống Mini App). Mặc định: không đổi.
4. Nút "Xem trước" khi còn nháp báo cần đăng trước, không điều hướng (giống Mini App).
5. `shareLink` tuyệt đối của nơi khác: nút Chia sẻ chép bài mẫu kèm link. Mặc định: dùng cách này.
6. Nhãn trạng thái đơn cạnh dòng hoa hồng dùng chữ Mini App ("Giao thành công"), khác "Đã giao" ở danh sách đơn web. Mặc định: giữ chữ Mini App.
