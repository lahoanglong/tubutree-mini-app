# taikhoan đợt C

mergeable=True

## Review 1

KẾT LUẬN: chưa merge

- [P2] apps/miniapp/src/pages/order-detail.spec.tsx:754 and apps/web/src/app/tai-khoan/don-hang/[code]/page.spec.tsx:491 — The two ETA tests will start failing on their own soon. Each test fixes `createdAt` at 28/10/2026 and expects "Dự kiến giao 30/10 – 01/11", but neither page passes `now`, so `orderDeliveryEtaLabel` falls back to `new Date()`. From 02/11/2026 Vietnam time, the latest date counts as passed, the label is hidden and both tests fail. I ran each file with the clock moved to 2026-11-03: Mini went from 64/64 passing to 1 failed / 63 passed, and web had 1 failed / 39 passed. The "chưa cấu hình" and "đã giao" tests in the same block will then pass without checking anything, because the label is hidden either way. Fix: add `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime('2026-10-28T03:00:00Z')` to both describe blocks, with `useRealTimers` in afterEach.
- [P2] apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:8-10,48-49 — The required extra task was not done. The worker's own report gives First Load for /tai-khoan/don-hang/[code] as 191→194 KB (+3 KB, over the +2 KB limit) and says it was not cut. The branch tip is still 1f1750968, so no commit cuts it. Fix: load the parts below the first screen with `next/dynamic` (`OrderInvoice`/`OrderWasteLink`/`FollowOaPrompt` from order-extras, `CopyShippingCode`, the Ghi chú block), then re-measure and record before/after numbers.
- [P2] (gate) — The other required extra task was not done either. The web Playwright gate ran only order.web and account.web, and the report says itself "không chạy cả bộ web". This branch changes shared layout: the Shell in don-hang/[code] is now `max-md:flex max-md:flex-col` with `order-N`, and Đăng xuất was removed from about-view. Fix: run the full web Playwright suite and record the real numbers.
- [P2] packages/app-core/src/account-copy.ts:16 — The short label "Chờ trả" for `pending_payment` is ambiguous. In an app that already has "Đổi/trả", "Đã duyệt trả" and "Yêu cầu đổi trả", a customer will read "Chờ trả" as "waiting for a return", not "waiting for payment". The label appears on the order row in Cá nhân on both Mini and web (ảnh orders-row-web360.png). Fix: use a label that cannot be confused, e.g. "Thanh toán" (10 characters, about the same width as "Đang giao"), or ask the owner. Re-take the 360/375 screenshots afterwards.
- [P3] packages/app-core/src/shipping-eta.ts:38 — The ETA is not hidden when `manualHandling=true`. The hero shows "Dự kiến giao …" right next to "Tubu đang xử lý đơn này, liên hệ CSKH", which contradicts it, and the date is guesswork. Fix: pass `manualHandling` into the function and return null when it is true, then add a test.
- [P3] packages/app-core/src/shipping-eta.ts:41-48 — For a bank-transfer order paid late, the minimum date can already be in the past. Example: ordered 20/10, paid (CONFIRMED) 23/10, eta 2–4 days gives "Dự kiến giao 22/10 – 24/10" while today is 23/10. Fix: clamp the minimum date to today in Vietnam time, or hide it.
- [P3] apps/miniapp/src/pages/about.tsx:263, apps/web/src/app/gioi-thieu/about-view.tsx — R-111 is still only partly done: "Xoá tài khoản" is still on Giới thiệu, while the backlog item asks for it to live only in Cài đặt. Mark it as open in the backlog and do not tick it.
- [P3] apps/miniapp/src/pages/edit-profile.tsx:267, apps/web/src/app/tai-khoan/ho-so/page.tsx:262 — R-110 is still only partly done. When no ngày sinh has been saved, the field is still a native `type=date` and shows mm/dd/yyyy depending on the device locale. Mark it as open.

Checked against the code, no problems found:
- Lượt 1 P1 (Tailwind order) is fixed. `max-md:order-last` is valid, and the e2e Y-comparison does catch the old bug (an `order-0` block would have sat above `order-7`).
- The ETA function hides correctly for MERCHANT orders and orders with món đặt trước. The API does return `fulfilment.kind` and `backorderedQty`.
- `canSeeAcademy` matches the API `@Roles`, and Mini `AuthUser.role` exists.
- Logout is still reachable on web through /tai-khoan/cai-dat. On Mini it is hidden for guest accounts (`isGuestUser`), and web has no guest accounts.
- `/product/:slug` exists on Mini.
- The `--forest-*` CSS variables exist.
- Nothing touches tiền, điểm, phí, thể lệ, the API or migrations.

## Sửa trước review 2 (head 80bc77330)

Nhánh review/1028-taikhoan, tip 80bc77330 (chưa push). Commit lượt 2:
- 5ffd3c5f1 fix(tai-khoan): ETA ẩn khi manualHandling, kẹp ngày sớm về hôm nay, nhãn "Thanh toán", test ETA cố định giờ
- 80bc77330 perf(tai-khoan): chi tiết đơn web tải trễ OA/hoá đơn/đổi rác/chép mã vận đơn

Từng phát hiện:
- P2 test ETA phụ thuộc đồng hồ: ĐÃ SỬA (5ffd3c5f1). Cả 2 describe dùng vi.useFakeTimers({toFake:['Date']}) + setSystemTime 2026-10-28, afterEach useRealTimers. Mini 64/64, web page.spec 40/40.
- P2 First Load /tai-khoan/don-hang/[code]: ĐÃ SỬA (80bc77330). next/dynamic ssr:false cho FollowOaPrompt, OrderInvoice, OrderWasteLink, CopyShippingCode. Baseline 191 KB, trước sửa 194, sau sửa 193 KB (+2 KB, đạt giới hạn). Các trang tai-khoan khác không đổi mã.
- P2 web gate cả bộ: ĐÃ CHẠY. 355 passed, 38 skipped, 1 flaky (web-checkout "đặt đơn bằng Ví Tubu", qua ở lần thử lại, không thuộc màn đã đổi), 0 failed.
- P2 nhãn "Chờ trả": ĐÃ SỬA, đổi thành "Thanh toán" (account-copy.ts, hub.spec cập nhật). Ảnh 375 chụp lại, vừa một dòng, web = Mini.
- P3 manualHandling: ĐÃ SỬA, test đỏ rồi xanh (shipping-eta.spec).
- P3 ngày sớm nhất quá khứ: ĐÃ SỬA, kẹp về hôm nay giờ VN; nếu từ = đến thì ghi một ngày (test mới, test cũ "đúng hôm nay" đổi thành "28/10").
- P3 R-111 (Xoá tài khoản còn ở Giới thiệu): KHÔNG LÀM, chỉ làm một phần; đã ghi mở, không tick (di chuyển nút ngoài phạm vi lượt này).
- P3 R-110 (ngày sinh trống còn type=date theo locale): KHÔNG LÀM, vẫn mở, không tick (cần chọn ngày tự dựng, không rẻ).

Kiểm thật:
- tsc app-core, miniapp, web: sạch. eslint src/app/tai-khoan: sạch.
- vitest app-core 71 files/927 pass; miniapp 313/4872 pass (cả TZ=UTC: 313/4872); web 441/7449 pass.
- Playwright Mini App cả bộ: 205 passed, 10 skipped. Web gate cả bộ: như trên.
- pnpm lint:parity: xanh (0 mục pending).
- vite build Mini App: entry 711 KB raw/222 gz (bằng baseline 711), tổng JS 1630 KB raw, tổng 1917 KB raw/740 gz.
- API không đụng, không cần jest/race. Không chạy perf/run-all.

Ảnh trước/sau: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-taikhoan/r2/ (profile__returning__ok__s1.png, order-code__returning__ok__s1.png).
Lane 3 đã dừng (giữ DB). params-l3.json chưa commit (đúng luật). Chưa kiểm: ảnh ETA đang hiện trên đơn đang giao (dữ liệu lane chỉ có đơn đã giao; ETA đã có test đơn vị và page test).

## Review 2

KẾT LUẬN: merge được

No P0, P1 or P2 issues remain. I checked each fix from lượt 1 against the code:

- **P2 ETA tests depending on the clock: fixed.** Both describe blocks now use fake timers fixed at 2026-10-28. I reran them on Node 22:
  - web `don-hang/[code]/*` plus hub.spec: 171/171
  - Mini order-detail plus profile-hub: 100/100
  - app-core shipping-eta plus account-copy: 23/23
- **P2 First Load: done.** The `.next` build (13:41, after commit 80bc77330 at 13:37) shows the route chunk `page-6ec529f5fbc9bf40.js` no longer contains "Theo dõi Tubu Tree trên Zalo", "Hoá đơn VAT", "Chép mã" or "Yêu cầu thu rác". Only "Dự kiến giao" is still in it. I could not re-measure Next's 191→193 KB figure exactly myself, but the split works.
  - The page-parity tests for those four lazy-loaded parts (click Chép mã, Hoá đơn VAT and thu rác order, Theo dõi ngay) still pass. So the parts do load in tests, and the tests that assert "nothing shown" are not passing just because nothing loaded.
- **P2 "Chờ trả": fixed.** The label is now "Thanh toán". In the screenshot `r2/profile__returning__ok__s1.png` it fits on one line and Mini matches web. The screen-reader label still uses the full "Chờ thanh toán".
- **P3 manualHandling: fixed.** See `packages/app-core/src/shipping-eta.ts:40`. Mini passes `o`, whose `OrderDTO` has `manualHandling`, and web's `OrderDetailDTO` has it at `shop-client.ts:142`.
- **P3 earliest date in the past: fixed.** The earliest date is clamped to today (VN time), with tests.
- **P3 R-110 and R-111:** recorded as "MỘT PHẦN" in `reviews/taikhoan-b.md:16-17` and not ticked.

Remaining (all P3):

- [P3] packages/app-core/src/shipping-eta.ts:42 — The ETA counts from `createdAt` (order time). Backlog R-9 says "giờ xác nhận + eta_*". Example: a bank-transfer order placed at 23:00 on 20/10 and paid at 22:00 on 21/10, with eta 2–4, shows "22/10 – 24/10" instead of "23/10 – 25/10". The window ends up to 1 day early (retail TTL 24h, dealer up to 72h at `apps/api/src/modules/orders/pending-payment-ttl.ts:5-8`). The clamp only stops the date going into the past; it does not correct the shift. Fix: use `statusTimes.CONFIRMED` when present, otherwise `createdAt`, and add a test.
- [P3] apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:209 / apps/miniapp/src/pages/order-detail.tsx:290 — There is no screenshot of "Dự kiến giao" on an order that is still being delivered; the lane only has delivered orders. The worker says so. So nobody has visually checked the hero line or the "Giao thành công" timeline line on Mini vs web at 375px. Fix: when there is a CONFIRMED or SHIPPING order in the lane, take a 375 screenshot on both platforms.
- [P3] apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:53-56 — The comment "First Load của trang không tăng" is wrong: the worker's own measurement is still +2 KB. Fix: reword the comment, or leave it.

Not run: Playwright and the full web gate. I relied on the worker's numbers for those (355 passed, 1 flaky in web-checkout).
