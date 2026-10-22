# Lane mv-uat7b: web theo Mini App 35a716c6 (ownsBrand, chu kỳ gói định kỳ, link CTV)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Hub Tài khoản đọc cờ `ownsBrand` trên `/auth/me` | 4f7678aa | `apps/web/src/app/tai-khoan/page.tsx`, `packages/app-core/src/queries/brand-owner.ts`, `hub.spec.tsx` (+5 test) |
| Chữ 403 Học viện | không có commit | `CtvOnlyNotice` ở `hoc-vien/course-list.tsx` đã khớp `ctvOnlyTitle/Body/Cta`, nút dẫn `/ctv` |
| Chọn chu kỳ chỉ khi API trả `lastOrderAt` | d1b4e518 | `components/orders/subscription-edit-sheet.tsx`, `subscriptions-panel.spec.tsx` |
| Link CTV chỉ ghi lượt bấm, bỏ "N đơn" | c42f72a6 | `apps/web/src/app/ctv/page.tsx`, `ctv/page.spec.tsx` |
| Báo cáo đợt b trong mv-uat7 | 2e61d08f | `impl/mv-uat7.md` |
| Sửa review lượt 1 (e2e, comment mâu thuẫn) | 42cc5c4d | `apps/e2e/tests/{account,affiliate,web-checkout}.web.spec.ts`, `tai-khoan/page.tsx` |
| Sửa review lượt 2 (khoá queryKey, chờ /auth/me) | 7e428a1f | `queries-internal.spec.ts`, `account.web.spec.ts` |

Route: không thêm route, không bỏ pending nào (lint:parity: 0 mục pending).

## 2. Kiểm chứng (gate cuối, xanh)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  42 passed (42)       Tests  497 passed (497)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  400 passed (400)       Tests  6738 passed (6738)
web-test-utc rc=0  Test Files  400 passed (400)       Tests  6738 passed (6738)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)       Tests  4313 passed (4313)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

Playwright không chạy (luật cứng), nên các spec e2e đã sửa chưa kiểm chứng.

## 3. Review

Lượt 1:
- MAJOR `affiliate.web.spec.ts:111` còn chờ "0 lượt bấm · 0 đơn": đã sửa ở 42cc5c4d (chờ "0 lượt bấm", khẳng định không còn "N đơn").
- MAJOR hub luôn gọi `/auth/me`, spec `account.web`, `web-checkout.web` không mock nên fixture báo đỏ: đã sửa ở 42cc5c4d (mock `/auth/me` với `ownsBrand:false`). Không thêm fallback vào `mock-api.ts` vì file dùng chung.
- MINOR comment cũ ở `tai-khoan/page.tsx` mâu thuẫn comment mới: đã sửa ở 42cc5c4d.
- MINOR báo cáo mv-uat7 thiếu ownsBrand và Học viện 403: đã sửa ở 2e61d08f/42cc5c4d.

Lượt 2:
- MINOR `account.web.spec.ts:60` đếm `/brand/owner/me` trước khi `/auth/me` trả lời: đã sửa ở 7e428a1f (chờ `/auth/me` rồi networkidle).
- MINOR `ownsBrandQuery` chưa có test khoá queryKey/route/null: đã sửa ở 7e428a1f (một `it` riêng; không đưa vào mảng `cases` vì `fakeHttp` trả undefined).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa chạy Playwright: 3 spec web đã sửa chỉ được viết, chưa chạy.
- Test `ownsBrandQuery` ở app-core chưa từng đỏ (code đã đúng từ 4f7678aa), chỉ chứng minh được xanh.
- Web gọi thêm một request `GET /auth/me` khi mở hub, giống Mini App. Bỏ request thừa cần API trả `ownsBrand` trong `/me`, ngoài phạm vi.
- Không đụng `apps/miniapp`, `apps/api`, `shared-types`.

## 5. Câu hỏi cho chủ dự án

- Có muốn API trả `ownsBrand` ngay trong `/me` để web và Mini App khỏi gọi `/auth/me` thêm không? Mặc định: giữ hai request như Mini App.
- Chu kỳ gói định kỳ dùng `'lastOrderAt' in sub` làm tín hiệu API hỗ trợ `intervalWeeks`. Mặc định: coi thiếu khoá là API cũ và không gửi `intervalWeeks`; đổi nếu API thêm cờ riêng.
