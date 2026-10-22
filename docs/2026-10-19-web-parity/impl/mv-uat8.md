# mv-uat8 — Lô 8

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| % bậc thưởng quý đại lý kiểu Việt | 2181c73d, sửa ở 157b00a2, 545ebed5, 159fef3b | `apps/web/src/lib/dealer-view.ts` (`bonusPctText` = `formatRatePct(pct / 100)`, như Mini App fb9bd099), `components/dealer/report-tab.tsx` (3 chỗ), `app/dai-ly/page.spec.tsx`, `lib/dealer-view.spec.ts` |
| Báo mã chưa áp dụng theo lý do máy chủ | 3fb702c0, sửa ở 0d456003 | `apps/web/src/components/coupon-box.tsx`, `coupon-box.spec.tsx` |
| Sửa báo cáo lane cho khớp code | 970dd8fa | file này |

- Không gọi toLocaleString trực tiếp; không còn dòng bonus-pct.ts trong `no-raw-date-format.spec.ts`.
- Mã chưa áp dụng: `Mã chưa được áp dụng cho đơn này: {reason}` (role=status, tự tắt 5 giây) khi xem trước eligible:false + reason và giỏ discount 0. Ca `heldOnly` (couponNotice, discount 0, không freeship, xem trước không eligible) không hiện cảnh báo này; cảnh báo cũng ẩn khi prop `notice` đang hiển thị.
- Không thêm request (dùng xem trước sẵn có), không đổi endpoint/body/Idempotency-Key. Không đụng Mini App/API/packages.
- Route web: `/dai-ly` (báo cáo quý), `/gio-hang`, `/thanh-toan` (hộp mã). Lane không có mục pending riêng; `lint:parity` báo 0 mục pending.

## 2. Kiểm chứng (summary.txt gate cuối, green=true)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  42 passed (42)       Tests  497 passed (497)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  400 passed (400)       Tests  6746 passed (6746)
web-test-utc rc=0  Test Files  400 passed (400)       Tests  6746 passed (6746)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)       Tests  4313 passed (4313)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
DONE
```

## 3. Review

| Lượt | Phát hiện | Xử lý |
|---|---|---|
| 1 | MINOR: thiếu nhánh `heldOnly` như Mini App; cảnh báo và `notice` chồng nhau (trùng chữ ở FREESHIP /thanh-toan); thiếu test | Đã sửa ở 0d456003 (heldOnly trước, ẩn cảnh báo khi có notice, 2 test mới) |
| 2 | MAJOR: `bonusPctText` còn gọi toLocaleString trực tiếp, chưa theo fb9bd099 (1000% in "1.000%", âm in "-4%") | Đã sửa ở 157b00a2 (dùng `formatRatePct`, xoá bonus-pct.ts) |
| 2 | MAJOR: dòng cho phép bonus-pct.ts trong `no-raw-date-format.spec.ts` | Đã sửa ở 157b00a2 / 159fef3b (bỏ dòng) |
| 3 | MINOR: báo cáo lane lệch code | Đã sửa ở 970dd8fa |

Lượt 3 không còn phát hiện mở.

## 4. Chưa làm / cố ý để lại / chưa kiểm chứng

- Chưa chạy Playwright (luật cứng); chưa có spec e2e riêng cho hai hành vi này.
- Không có mục cố ý để lại khác.

## 5. Câu hỏi cho chủ dự án

Không có.
