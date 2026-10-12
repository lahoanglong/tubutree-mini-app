# Test Inventory + Baseline — Hardening 2026-10

**Ngày:** 2026-10-09  
**Commit:** 080bc75 (feat(miniapp): navigation type provider for animation routes)  
**Phạm vi:** Baseline test suite trên hardening/2026-10 (main + 38 commit đợt 4b)  
**Phương pháp:** Chạy tuần tự từng app + project E2E (--maxWorkers=2 để tránh OOM)  
**Giới hạn:** Chỉ baseline, không fix lỗi; typecheck bị workspace setup issue (missing @tubutree/shared-types)

---

## 1. Kiểm Kê Test Files

| App | Loại | Số file | Module lớn nhất |
|-----|------|---------|-----------------|
| API | src unit | 133 | game (10), dealer (7), analytics (5) |
| API | integration race | 10 | — |
| Miniapp | unit/component | 98 | (99 files passed) |
| Web | unit/component | 12 | (13 files passed) |
| E2E | spec | 18 | API / Web Admin / Zalo Mini App |
| **TỔNG** | | **271** | |

---

## 2. Kết Quả Tổng Hợp

| App | Pass | Fail | Thời gian | Trạng thái |
|-----|------|------|-----------|-----------|
| API unit (2356 tests) | ✅ 2356 | 1 suite* | 37.6s | Mostly pass |
| API race (39 tests) | ✅ 39 | 0 | 24.5s | Clean |
| Miniapp (838 tests) | ✅ 838 | 0 | 71.2s | Clean |
| Web (162 tests) | ✅ 162 | 0 | 4.5s | Clean |
| E2E Total | ✅ 113 | ❌ 8 | 160s | 88% pass |
| Typecheck API | — | ❌ ~30 errors | — | Workspace issue |
| Typecheck Miniapp | — | ❌ ~20 errors | — | Workspace issue |
| Typecheck Web | ✅ clean | 0 | — | OK |
| Lint API | — | ❌ 2 errors | — | Minor |
| Lint Miniapp | — | ❌ 105 errors | — | DS v2 migration |
| Lint Web | ✅ clean | 0 | — | OK |

**Total:** 3,395 unit/integration tests passed, 8 E2E failed

---

## 3. E2E Failed Tests

### API E2E (1 fail)
- **Test:** POST /checkout/quote — error when cart empty
- **Issue:** Message returned "tham chiếu không hợp lệ" ≠ expected pattern /trống|empty|address/
- **File:** apps/e2e/tests/api.spec.ts:47

### Web Admin E2E (1 fail)
- **Test:** Dealer applications queue > 1 page pagination
- **Issue:** Text "Còn 1 hồ sơ cũ hơn chưa tải" not found in DOM
- **File:** apps/e2e/tests/admin.spec.ts:132

### Miniapp E2E (6 failed)
- **Tests:** 5 loyalty point tests + 1 storefront CTV test
- **Issue:** POST /events API call unmocked + UI selectors not found
- **Files:** apps/e2e/tests/loyalty.miniapp.spec.ts (lines 154, 176, 210, 227, 255) + design-system-pilot.miniapp.spec.ts:236

---

## 4. Độ Phủ Luồng Sống Còn (12 Luồng Chính)

| # | Luồng | Mức Phủ | Test Suite | Ghi Chú |
|----|-------|---------|-----------|---------|
| 1 | Checkout | ⚠️ Một phần | E2E API | Message validation fail |
| 2 | ZaloPay webhook | ❌ Không | — | Không test tách |
| 3 | VietQR/chuyển khoản | ✅ Tốt | API unit + Web E2E | Đủ coverage |
| 4 | COD | ✅ Tốt | API race | Atomicity tested |
| 5 | Ví + TubuXu | ✅ Tốt | Miniapp unit + race | Full flow |
| 6 | Hoa hồng CTV | ✅ Tốt | API race + Web unit | Commission + withdraw |
| 7 | Coupon/voucher | ✅ Tốt | API unit + Miniapp | Validation + redemption |
| 8 | Flash sale quota | ✅ Tốt | E2E Miniapp | Atomicity implicit |
| 9 | Backorder đại lý | ⚠️ Một phần | API race + E2E Web | Pagination issue in UI |
| 10 | Lương/chấm công | ✅ Tốt | API unit | Checkin + payroll calc |
| 11 | Auth/token refresh | ✅ Tốt | API + Miniapp unit | JWT + refresh |
| 12 | Phân quyền staff | ⚠️ Một phần | API unit | Role guard, no matrix test |

**Kết luận:** 11/12 luồng có test (92%). Không có: webhook ZaloPay, coupon farm prevention, COD refund dedicated, commission reconcile.

---

## 5. Phát Hiện P1 (Nên Sửa Trước Giao Khách)

| ID | Tiêu đề | File:Line | Tác Động | Độ Phức Tạp |
|----|---------|----------|---------|-----------|
| E2E-001 | 6 E2E fail: loyalty POST /events mock + UI | loyalty.miniapp.spec.ts:154/176/210/227/255 + design-system-pilot:236 | Miniapp E2E không pass | M |
| E2E-002 | API checkout quote message validation | api.spec.ts:47 | 1 API E2E fail | S |
| E2E-003 | Web Admin dealer pagination text | admin.spec.ts:132 | 1 Web E2E fail | S |

---

## 6. Phát Hiện P2 (Cải Thiện)

| ID | Tiêu đề | File | Độ Phức Tạp |
|----|---------|------|-----------|
| API-001 | game-gift test file read error | jest output | S |
| API-002 | 2 lint errors (any + unused) | analytics.controller.ts + community-feed.service.spec.ts | S |
| Miniapp-001 | 105 lint: Button import + raw colors | apps/miniapp/src/pages/ (5–10 files) | M |
| Typecheck-001 | Missing @tubutree/shared-types | workspace tsc | S (pnpm install) |

---

## 7. Quyết Định Nghiệp Vụ Cần Chủ Dự Án

**1. E2E fail: 6 loyalty/storefront tests**
- Phương án A (khuyến nghị): Mock POST /events hoàn chỉnh trong tests/support/mock-api.ts + chạy playwright show-trace để debug UI selectors.
- Phương án B: Skip tests này (deferred sang dự án khác), focus P0.

**2. Typecheck workspace setup**
- Phương án A (khuyến nghị): Chạy pnpm install toàn monorepo để rebuild @tubutree/shared-types symlink.
- Phương án B: Chấp nhận lỗi tạm (dev local chạy tốt, CI sẽ fix).

**3. Miniapp lint: 105 errors (DS v2 migration)**
- Phương án A (khuyến nghị): Batch refactor pages/ để dùng DS v2 Button + token colors (5–10 tệp, medium effort).
- Phương án B: Chấp nhận kỷ luật code, defer sang release hardening khác.



---

## Kiểm chứng độc lập (verifier)

**Ngày:** 2026-10-09 · **Commit:** 080bc75 (cây làm việc sạch, chỉ có thư mục docs/scripts chưa theo dõi) · **Phương pháp:** chạy lại API jest đầy đủ (`--maxWorkers=2`), `jest src/modules/game`, web `vitest run`, 3 lượt Playwright (api.spec, admin.spec dealer, loyalty + design-system-pilot) với server đang chạy sẵn, `tsc --noEmit` API, đọc code/trace. Không chạy lại miniapp (838 test) và race test (cần DB) do giới hạn RAM — **chưa kiểm chứng** hai bộ này. Báo cáo không có mục P0; xét 3 mục P1 + các khẳng định khác.

| ID | Phán quyết | Bằng chứng | Mức đề xuất |
|----|-----------|-----------|-------------|
| E2E-001 (6 E2E miniapp fail) | XÁC NHẬN lỗi tái hiện (6/6, cùng dòng 154/176/210/227/255 + pilot:236), nhưng NGUYÊN NHÂN báo cáo sơ sài. 5 test loyalty: lời gọi `POST /events` (analytics, `miniapp/src/services/analytics.ts:53`) chưa mock → fixture `mock-api.ts:334` fail; spec loyalty không gọi `api.allowUnmocked('POST /events')` như buy-flow-mocks.ts:77 / pilot-mocks.ts:123 / browse-defaults.spec:16. Đã thấy trực tiếp "POST /events" ở các lượt fail loyalty (lần log cuối là test 227 và 255; 3 test còn lại cùng spec/cùng cách fail, không đọc riêng từng cái). Test storefront CTV (pilot:236): KHÔNG phải selector sai — trang hiện ErrorBoundary "Đã có lỗi xảy ra"; trace có `504 Outdated Optimize Dep` + `TypeError: Importing a module script failed` khi tải lazy `storefront-view.tsx` trên Vite dev 3113 đang chạy lâu; chạy lại lần 2 vẫn fail → nghi dev-server Vite cache dep cũ (môi trường), CHƯA RÕ có phải lỗi sản phẩm không. Các test khác cùng project (7) pass. | P2 (trôi mock/fixture, không phải lỗi sản phẩm; riêng pilot:236 giữ "CHƯA RÕ" tới khi chạy lại trên Vite sạch) |
| E2E-002 (api.spec.ts:47) | XÁC NHẬN fail tái hiện; nhận định "message validation" sai gốc. `apps/e2e/global-setup.ts:50-55` ký JWT với `sub:'e2e-test-user-00000000'` — user KHÔNG tồn tại trong DB; API trả 400 "Tham chiếu không hợp lệ." (`common/filters/prisma-exception.filter.ts:62`, P2003 FK) thay vì "Giỏ hàng trống". Nghĩa là test dùng user giả đã lỗi thời so với code (cart/analytics ghi FK). Không phải lỗi checkout (`checkout.service.ts:508-510` vẫn kiểm địa chỉ → "Địa chỉ giao hàng không hợp lệ."). | P3 (sửa fixture: seed user thật hoặc nới regex) |
| E2E-003 (admin.spec.ts:132) | XÁC NHẬN fail tái hiện; LÀ TEST CŨ, không phải lỗi UI. `apps/web/src/app/admin/page.tsx:294-303` (commit b756c4a, 2026-09-27) đổi API sang `order=asc` và thông báo thành "Còn N hồ sơ **mới hơn** chưa tải"; test (mock trang 1 = mới, trang 2 = cũ nhất, tìm "cũ hơn") chưa cập nhật. | P2 |
| API-001 (game-gift read error) | BÁC BỎ / không tái hiện. `jest src/modules/game`: 10 suite, 149 test PASS (gồm game-gift.service.spec.ts). Chạy đầy đủ `jest --maxWorkers=2`: **133 suite pass, 2364 test pass, 0 fail** (báo cáo ghi 2356 + 1 suite fail → 8 test chênh khớp một suite không chạy được, nhiều khả năng do áp lực RAM/OOM khi chạy đồng thời). | Bỏ (flake môi trường) |
| Typecheck-001 | XÁC NHẬN lỗi, SAI nguyên nhân/biện pháp. `tsc --noEmit` API: 22 dòng lỗi, đều `TS2307 Cannot find module '@tubutree/shared-types'`. Symlink workspace có sẵn (`apps/api/node_modules/@tubutree/shared-types`) — thiếu `packages/shared-types/dist` (package.json:5-6 trỏ `./dist/index.d.ts`, thư mục `dist` không tồn tại). `pnpm install` KHÔNG sửa được; cần `pnpm --filter @tubutree/shared-types build` (hoặc turbo build). Quyết định nghiệp vụ #2 phương án A của báo cáo cần sửa. | P2 (kiểm: build shared-types rồi tsc lại) |
| "ZaloPay webhook: ❌ không test" (mục 4 #2, và kết luận mục 4) | BÁC BỎ. `apps/api/src/modules/integrations/payment/zalopay.service.spec.ts` có describe `handleCallback (verify MAC §10.1)` (dòng 42): MAC sai, MAC đúng + atomic tx, idempotent, đơn đã hủy/đã trả hàng nhận callback trễ, số tiền khác, PaymentAttempt cũ, Gomdon sau thanh toán (≥12 test, dòng 65-307). Luồng này có phủ unit tốt. | Sửa bảng: ✅ |
| "COD refund dedicated: không có" (mục 4) | BÁC BỎ. `apps/api/test/integration-race/cod-return-refund.race-spec.ts` (3 case) tồn tại. | — |
| "commission reconcile: không có" | CHƯA RÕ / nhiều khả năng sai. Có `cashback/cashback.service.spec.ts`, `providers/access-trade.provider.spec.ts`, `loyalty/points-reconcile.spec.ts`, `affiliate.race-spec.ts`; chưa đọc từng case nên chưa kết luận hoa hồng CTV có reconcile riêng hay không. | — |
| "coupon farm prevention: không có" | CHƯA RÕ. `coupons.service.spec.ts` có test `perUserLimit` (dòng 68) và `coupon-scope.spec.ts`; không grep thấy test tên "farm" cho coupon; chưa kiểm cơ chế chống farm cụ thể. | — |
| Kiểm kê số file (mục 1) | LỆCH nhẹ. Đếm lại: API spec 133 ✓, race 10 ✓, E2E spec 18 ✓, miniapp 98 ✓ (bảng ghi "99 files passed" — chưa chạy lại), Web: 13 file (bảng ghi 12, text ghi 13; vitest xác nhận 13 file / 162 test pass ✓). | — |
| Tổng hợp mục 2 | Web 162/162 ✓ (4.5-5.2s). API sai: thực tế 2364/2364. E2E tái hiện đúng 8 fail (1 API + 1 Web Admin + 6 miniapp). Miniapp 838 và race 39: chưa kiểm chứng. | — |

**Tóm tắt phán quyết:** 3 mục P1 đều đúng là test đang fail nhưng cả 3 là trôi fixture/test so với code (không có lỗi sản phẩm được chứng minh) → hạ P1 → P2/P3. Hai khẳng định "không có test" (ZaloPay callback, COD refund) là SAI. API-001 không tái hiện. Biện pháp cho Typecheck-001 sai (cần build shared-types, không phải pnpm install).
