# Lane mv-uat7: web theo đợt 6 của phiên UAT (Q12, Q13, Q14, Q16, Q18, Q22)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Q12 freeship dự phòng 199.000đ | 24286784 | `apps/web/src/lib/use-public-config.ts`, `apps/web/src/lib/legal.ts` (+ spec khoá số cũ) |
| Q13 chữ Huỷ/Xoá/Khoá | ec6481ad | toàn bộ `apps/web/src` (trừ admin, merchant), e2e web, 1 kỳ vọng `admin/page.spec.tsx` |
| Q14 bỏ "6 vùng đất" | e848d7be | `apps/web/src/lib/home-text.ts` |
| Q16 Việt hoá chữ khách (giữ CTV), Học viện CTV | c605d510 | `ctv/page.tsx`, `hoc-vien`, `season-pass`, `quiz-card`, `season-leaderboard`, `brand-actions`, `storefront-share`, `pdp-extras` |
| Q22 sửa gói định kỳ chọn chu kỳ 4/6/8/10 tuần | 83135644 | `components/orders/subscription-edit-sheet.tsx`, `lib/subscription-options.ts`, `packages/app-core/src/api/subscriptions.ts` |
| Q18 mua chung: đơn tối thiểu theo `minOrder` | 135d6967 | `app/mua-chung/group-buy-view.tsx`, `packages/app-core/src/api/groupbuy.ts` |
| Nốt chữ Q13 còn sót (review lượt 1) | 171494e7 | `notification-view.ts`, `brand-origins.ts`, `export-csv.ts`, `api.spec.ts` |

Route: không thêm route mới, không có mục pending nào của lane này (lint:parity: 0 mục pending).

## 2. Kiểm chứng (gate cuối, xanh)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  42 passed (42)       Tests  496 passed (496)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  400 passed (400)       Tests  6732 passed (6732)
web-test-utc rc=0  Test Files  400 passed (400)       Tests  6732 passed (6732)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)       Tests  4313 passed (4313)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

Playwright không chạy (chỉ sửa chữ trong spec e2e web).

## 3. Review

Lượt 1 (3 MINOR, đã sửa ở 171494e7):
- `notification-view.ts:21` còn "Hóa đơn điện tử": đã đổi "Hoá đơn điện tử".
- `brand-origins.ts:117` còn "ôn hòa/sức khỏe": đã khớp Mini App từng chữ.
- `export-csv.ts:88` header CSV admin "Điểm tích lũy": đã đổi "Điểm tích luỹ", kéo theo 3 kỳ vọng ở `lib/api.spec.ts` (chạm vùng admin, ghi lại ở đây).

Lượt 2: không có phát hiện. Ghi chú, không phải lỗi:
1. API main dùng `forbidNonWhitelisted`; tới khi API uat/int được deploy, chọn chu kỳ mới trên web sẽ nhận 400 "Không nhận trường «intervalWeeks»". Mini App cũng vậy. Không deploy web trước API.
2. Mini App 3362c0a0 chỉ hiện "{clicks} lượt bấm", web `ctv/page.tsx` còn "· {conversions} đơn". Mini App ẩn ở f71cc8ec (gói uat-ctv-su-kien), ngoài lane này.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa chạy Playwright; spec e2e web đã sửa chuỗi (`account`, `order`, `affiliate`, `community`, `game` .web.spec.ts) cần orchestrator chạy.
- Mock freeship 200000 ở `apps/e2e/tests/support/*`, `packages/app-core/src/api/orders.spec.ts`, `test-utils/fixtures/admin-config-rows.ts` để nguyên (ngoài lane); ảnh chụp e2e có thể in "200.000đ" từ mock.
- Không viết test đỏ trước cho 3 sửa chữ MINOR (không có assertion sẵn có để đổi).
- Chữ "Voucher chào mừng" (`home-text.ts`) giữ nguyên vì Mini App 3362c0a0 chưa đổi. Comment code còn "Season Pass/XP/Quiz" (comment dev).
- Admin còn chuỗi "Academy" ở `lib/admin-client.ts` ngoài phần đã sửa.
- Bản Mini App trong worktree này còn chữ cũ (`notifications.tsx:46`, `brand-origins.ts:113`); web đi trước Mini App của nhánh cho tới khi uat/int gộp.
- API main chưa trả `minOrder`/`lastOrderAt`: web chạy như cũ cho tới khi API mới được gộp.

## 5. Câu hỏi cho chủ dự án

- Không có câu hỏi mở. Mặc định đã dùng: web đi theo đúng chữ và luật của Mini App ở 3362c0a0; gửi `intervalWeeks` chỉ khi chu kỳ đổi, cùng endpoint và body như Mini App (không Idempotency-Key, như trước).
