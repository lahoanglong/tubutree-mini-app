# Lane loyalty — báo cáo

Nhánh `web/loyalty`, worktree `.claude/worktrees/web-loyalty`.

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Điểm Xanh và hạng thành viên | 577bd0e7 | `apps/web/src/app/tai-khoan/diem-xanh/page.tsx`, `apps/web/src/lib/loyalty-copy.ts` |
| Ví Tubu | 59438bff, f9abcefb | `apps/web/src/app/tai-khoan/vi-tubu/page.tsx`, `packages/app-core/src/wallet-rules.ts`, `unique-by-id.ts`, `apps/web/src/lib/idempotency-key.ts` |
| Kho quà, Quà của tôi, Hoàn tiền | 6745d013, cb73a1cd, 81ef843d, e26a4365, 4ae458d5, a0fe3b69 | `apps/web/src/app/kho-qua/**`, `apps/web/src/app/hoan-tien/**`, `packages/app-core/src/reward-rules.ts`, `apps/web/src/lib/use-idempotency-key.ts`, `cashback-copy.ts` |
| Sửa review: tab đối tác ở e2e | aa9f4a81 | `apps/e2e/tests/loyalty.web.spec.ts` |
| Sửa review: tab trống đã đóng trước khi POST xong | 0a313590, 7233d78b | `apps/web/src/app/hoan-tien/page.tsx` |
| Đưa hàm chữ Điểm Xanh thuần vào app-core | bf3b7ea0 | `packages/app-core/src/loyalty-copy.ts` |
| Giữ tierProgressPercent ở Mini App | 124da4eb | `apps/web/src/lib/points-lots-guard.spec.ts` |

Route đã bỏ pending: `/tai-khoan/diem-xanh`, `/tai-khoan/vi-tubu` (không có pending từ trước), `/rewards` (`/kho-qua`), `/rewards/mine` (`/kho-qua/cua-toi`), `/cashback` (`/hoan-tien`).

## 2. Kiểm chứng (gate cuối, gate-logs/loyalty/run4b/summary.txt)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  38 passed (38)       Tests  462 passed (462)
web-typecheck rc=0
web-lint rc=0 No ESLint warnings or errors
web-test rc=0  Test Files  218 passed (218)       Tests  3362 passed (3362)
web-test-utc rc=0  Test Files  218 passed (218)       Tests  3362 passed (3362)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (37 mục pending)
web-build rc=0  Compiled successfully
miniapp-build rc=0
DONE
```

Playwright không chạy (luật cấm): mọi ca e2e trong `apps/e2e/tests/loyalty.web.spec.ts` là chưa kiểm chứng.

## 3. Review

Lượt 1:
- MAJOR hoan-tien mở tab sau POST bị chặn popup: đã sửa (mở about:blank trong lúc bấm, link "Mở sàn" khi bị chặn).
- MINOR lỗi rút Ví nằm dưới sheet: đã sửa (role=alert trong sheet).
- MINOR /hoan-tien trong sitemap khi cờ tắt: đã sửa (bỏ khỏi sitemap khi CASHBACK_ENABLED=false).
- MINOR file Mini App ngoài phạm vi, loyalty-copy/useIdempotencyKey trùng bản: phạm vi đã ghi vào 02-ke-hoach.md (c3f6ae07); phần trùng xem lượt 3.
- MINOR nhãn nút Ví: đã sửa thành "Rút ngân hàng".

Lượt 2:
- MAJOR e2e hoàn tiền (URL popup about:blank, route không phủ popup): sửa ở aa9f4a81 (route ở cấp context, waitForURL).
- MINOR link /ctv khi còn pending: đã sửa (ẩn bằng isWebRouteReady).
- MINOR deeplink không phải http(s) vẫn báo "Đang chuyển hướng": đã sửa (giữ sheet, báo lỗi).
- MINOR trùng bản/phạm vi: như trên.

Lượt 3:
- MAJOR e2e chưa sửa thật: đã sửa ở aa9f4a81.
- MINOR không xử lý win.closed: đã sửa ở 0a313590 (spec đỏ) + 7233d78b (code).
- MINOR loyalty-copy / use-idempotency-key còn bản sao: chuyển một phần ở bf3b7ea0; phần còn lại không chuyển, xem mục 4.

## 4. Chưa làm / cố ý để lại / chưa kiểm chứng

- Playwright chưa chạy; e2e chưa kiểm chứng.
- `use-idempotency-key` giữ hai bản (web, Mini App): app-core cấm import react (forbidden-imports.spec).
- Các hàm chữ dùng formatter (moneyShort, redeemRuleLine, tierThresholdLabel, expiringPointsNote, pointExpiryPolicyNote) vẫn ở từng app vì formatter cố ý khác nhau (web theo giờ VN, Mini App theo giờ máy).
- `tierProgressPercent` có hai bản giống công thức: Mini App giữ bản riêng vì guard `points-lots-guard.spec.ts` của Mini App (không được sửa).
- Bỏ dải `PointsBoostStrip` ("Mua trong Mini App tích gấp đôi").
- Nút chép mã chỉ dùng `navigator.clipboard`, không có dự phòng `execCommand`.
- `getMyPointsLock` trong `shop-client.ts` không còn trang nào dùng, chưa xoá.
- Lịch sử Điểm Xanh web dùng `pointsReasonDetail` và tối đa 100 dòng, Mini App dùng `pointsReasonLabel` và 20 dòng.
- Kho quà dùng LedgerShell (liên kết "← Tài khoản") thay PageHeader có nút quay lại.
- Lịch sử git có hai commit cho mục win.closed (0a313590 chỉ spec đỏ, 7233d78b code).
- Khách chưa đăng nhập trong sheet sàn thấy "Đăng nhập để nhận hoàn tiền" thay vì bấm rồi nhận 401.

## 5. Câu hỏi cho chủ dự án

1. Mini App có 4214 test, dưới mốc 4243 của luật. Lane không sửa hay xoá spec Mini App nào. Mặc định: coi sàn đúng là 4214 (commit 35ef41ee ghi sàn này). Xin xác nhận.
2. Có thêm dải thay `PointsBoostStrip` trên web không, và dùng chữ nào? Mặc định: không có.
3. `/hoan-tien` khi cờ tắt: đã bỏ khỏi sitemap; robots.ts vẫn allow. Mặc định: giữ vậy. Có muốn đánh dấu private không?
4. Có muốn thêm link dự phòng "Mở sàn" ngoài trường hợp popup bị chặn (chữ khác Mini App)? Mặc định: chỉ hiện khi bị chặn.
5. Có muốn chèn formatter để chuyển nốt các hàm chữ sang app-core, và hợp nhất `fingerprintOf`/`newIdempotencyKey` với `utils/idempotency.ts` của Mini App? Mặc định: không.
