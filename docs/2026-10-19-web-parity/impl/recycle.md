# Lane recycle: Đổi rác lấy quà trên web

Nhánh `web/recycle`, đỉnh `ecb068fe`. Chưa push, chưa PR, chưa deploy.

## 1. Đã làm

| Mục | Commit chính | File chính |
|---|---|---|
| Hub, quy định, danh sách yêu cầu | b416910b, 03774308, e2f5d574, 95e74f8c, d1ef3cff | `components/recycle/recycle-home`, `recycle-rules`, `recycle-requests`, `app/doi-rac/` |
| Tạo yêu cầu, chọn điểm nhận | 3a38c6e4, 7df6a78b, e2111a42, 394b2ca9, 29de9ddb | `recycle-new.tsx`, `recycle-points.tsx`, `waste-item-step.tsx`, `waste-point-picker.tsx`, `lib/recycle-wizard.ts` |
| Chi tiết, sửa, hoàn tất | a6db06d1, fc166314, b5119178 | `recycle-request`, `recycle-edit`, `recycle-done`, `recycle-support.tsx`, `declared-counted-table.tsx` |
| Quầy nhận | d3fb5d1e | `recycle-desk.tsx`, `recycle-desk-perk.tsx` |
| Sửa theo review | 683deec4, 9e29f269, 9c182fa4, ecb068fe | `recycle-new.tsx`, `recycle-desk.tsx`, `auth-context.tsx`, `route-map.spec.ts` |

Route web đã xong (đã bỏ `pending` trong `packages/app-core/src/route-map.json`): `/doi-rac`, `/doi-rac/quy-dinh`, `/doi-rac/yeu-cau`, `/doi-rac/tao`, `/doi-rac/diem-nhan`, `/doi-rac/yeu-cau/[id]`, `/doi-rac/yeu-cau/[id]/sua`, `/doi-rac/xong/[id]`, `/doi-rac/quay`.

## 2. Kiểm chứng (summary.txt của gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  40 passed (40)       Tests  484 passed (484)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  330 passed (330)       Tests  5495 passed (5495)
web-test-utc rc=0  Test Files  330 passed (330)       Tests  5495 passed (5495)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (10 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
DONE
```

Playwright không chạy (đúng luật); 15 ca e2e trong `apps/e2e/tests/recycle.web.spec.ts` chỉ được typecheck.

## 3. Review

| Lượt | Phát hiện | Xử lý |
|---|---|---|
| 1 | MAJOR: `route-map.spec.ts` dùng route đã hết pending trên integration | Sửa ở 683deec4, 9e29f269: test dùng bản đồ route giả |
| 1 | MAJOR: nháp sessionStorage sống qua lần vào mới, mang món ẩn hoặc nháp tài khoản khác | Sửa một phần ở 683deec4 (cờ nạp lại chỉ khi đi trong wizard) |
| 1 | MINOR: `WasteDeskPerk` giữ trạng thái "đã gửi" khi đổi điểm | Sửa ở 683deec4 (`key={point.id}` và test) |
| 2 | MAJOR: cờ nạp lại còn sau khi rời wizard, đăng xuất không xoá `tubu_recycle_*` | Sửa ở 9c182fa4 (dọn cờ khi unmount, `clearWizardStorage()` trong logout) |
| 3 | MINOR: rời từ trang chọn điểm bằng đường khác thì nháp cũ nạp lại một lần, món ẩn có thể chặn tạo | Sửa ở ecb068fe: cắt món không ACTIVE khỏi nháp và khỏi body ước tính. Không làm phần dọn cờ khi rời `RecyclePoints` vì nháp không còn mang món ẩn; chỉ còn `NAV_KEY` cũ tới khi tạo thành công hoặc đăng xuất |

Review không thấy lỗi về tiền, điểm hay xác thực: endpoint, body, Idempotency-Key khớp Mini App.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Playwright chưa chạy, các ca e2e Đổi rác chưa kiểm chứng.
- Không có "điểm gần tôi" (web không xin vị trí).
- Chưa kiểm bằng trình duyệt thật: không cuộn ngang ở 320px, lưới hai cột của quầy trên desktop.
- `NAV_KEY` cũ có thể tồn tại tới khi tạo thành công hoặc đăng xuất.
- Khi merge vào integration, bốn spec danh sách dùng chung (`guest-auth-gate`, `page-titles`, `session-unavailable`, `ds-palette-pc11`) sẽ xung đột với lane khác; người tích hợp giải quyết.
- Mini App không bị sửa file nào.

## 5. Câu hỏi cho chủ dự án

1. Khách chưa đăng nhập mà cấu hình công khai chưa tải: web mời đăng nhập, chỉ hiện "tạm dừng" khi cấu hình đã tải và chương trình tắt (Mini App hiện "tạm dừng" ngay). Mặc định: cách của web.
2. Sau khi tạo yêu cầu xong, web xoá nháp nên Back ra trang trống; Mini App giữ cờ đã gửi (`submittedSids`) để thoát hẳn về `/doi-rac`. Mặc định: xoá nháp.
3. Câu 403 ở quầy "Tài khoản này không có quyền nhận hàng tại điểm" là chữ tự đặt, Mini App không có. Mặc định: giữ.
4. Khối hỗ trợ dùng `mailto:` và `tel:` thay cho chép email vào bộ nhớ tạm như Mini App. Mặc định: `mailto:`.
