# Lane integ5: nối lối vào đổi rác sau khi recycle gộp

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Khoá lối vào đổi rác bằng route map thật (spec xanh ngay, không có bước đỏ vì không có lệch) | 0d732366 | apps/web/src/lib/recycle-entry.spec.ts |
| Ghi "đã xử lý" vào dòng 170 và 186 (không xoá dòng) | de72a2ad | docs/2026-10-19-web-parity/98-cau-hoi-va-chua-kiem-chung.md |

Đối chiếu Mini App -> web, tất cả giống, không cần sửa code chức năng:
- Hub tài khoản: profile.tsx:47 -> account-menu.ts:46.
- Thanh toán "Thu kèm rác": checkout.tsx:726 -> thanh-toan/page.tsx:115, :569 (link /doi-rac/tao).
- Game: game.tsx:171 -> vuon-xanh/page.tsx:82, :154 (điều kiện waste.enabled).
- Điểm Xanh: loyalty.tsx:471 -> tai-khoan/diem-xanh/page.tsx:178.
- Chi tiết đơn: order-detail.tsx:602 -> don-hang/[code]/order-extras.tsx:43, :54.
- Thông báo: notifications.tsx:108-111 -> notification-view.ts:105-111 (dịch qua route map).
- Trang chủ: Mini App không có link /recycle, không có gì để nối.

Route web đã xong (bỏ pending): toàn bộ nhóm /doi-rac đã bỏ pending từ lane recycle; lane này không đổi route map. Các nhánh `isWebRouteReady('/doi-rac...')` nay luôn chạy nhánh chính; giữ nguyên guard, không dọn.

## 2. Kiểm chứng (gate cuối, mọi bước rc=0)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)  Tests  488 passed (488)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  357 passed (357)  Tests  6067 passed (6067)
web-test-utc rc=0  Test Files  357 passed (357)  Tests  6067 passed (6067)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)  Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 xanh (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

Test Mini App 4214, không giảm. Test thêm: 11 (recycle-entry.spec.ts).

## 3. Review

Một lượt, không có phát hiện (findings rỗng). Reviewer đối chiếu từng lối vào, chạy lint:parity, tsc và vitest vùng liên quan (156 file, 2106 test) đều xanh. Không có gì để sửa.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Cố ý để lại: các guard `isWebRouteReady('/doi-rac...')` nay thừa, chưa dọn.
- Không chạy Playwright (luật lane).
- Không có mục chưa kiểm chứng.

## 5. Câu hỏi cho chủ dự án

- Có dọn các guard `isWebRouteReady('/doi-rac...')` đã thừa không? Mặc định: giữ nguyên.
