# Lane core-ui — báo cáo

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| PlatformBridge (interface, bản web, bản Mini App) | 41239326 | `packages/app-core/src/bridge.ts`, `apps/web/src/lib/platform-bridge.ts`, `apps/miniapp/src/services/platform-bridge.ts` (kèm spec) |
| 10 primitive web: Sheet, SegmentedTabs (+useTabParam), PageHeader, ErrorState, Skeleton, Badge, ProgressBar, QuantitySelector, QrCode, Field | 7db853aa | `apps/web/src/components/ui/*`, `apps/web/package.json` (thêm `qrcode`, `@types/qrcode`), `ds-v2-guest.spec.ts` (MIGRATED) |
| Hạ tầng e2e web cô lập (`E2E_SCOPE=web`, cổng qua env, project Web Customer Mobile, `web-gate.sh`) | d0f5e463 | `apps/e2e/playwright.config.ts`, `apps/e2e/global-setup.ts`, `apps/e2e/scripts/web-gate.sh` |
| Sửa review lượt 1 | 982ceb65, fba6ea11, 06d14b80, 1ba272f1 | xem mục 3 |
| Sửa review lượt 2 | 06a70334, d8a224be, 8eb38281 | xem mục 3 |

Route web đã bỏ pending: không có. Lane này chỉ cấp hạ tầng (bridge, primitive, e2e); chưa trang nào import bridge hay primitive mới.

## 2. Kiểm chứng (gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  2 passed (2)  Tests  48 passed (48)
web-typecheck rc=0
web-lint rc=0  No ESLint warnings or errors
web-test rc=0  Test Files  206 passed (206)  Tests  3141 passed (3141)
web-test-utc rc=0  Test Files  206 passed (206)  Tests  3141 passed (3141)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)  Tests  4272 passed (4272)
lint-vars rc=0  OK - every var(--x) reference is defined.
lint-parity skip (chưa có)
web-build rc=0  Compiled successfully
miniapp-build rc=0
DONE
```

Test Mini App 4272, không dưới mốc 4243. Chứng minh `web-gate.sh` (lúc làm việc 3): `web-checkout.web.spec.ts` + `web-customer.web.spec.ts` cho `20 passed (1.8m)`, dọn sạch container và cổng. Các sửa review sau đó cho `web-gate.sh` (982ceb65, 8eb38281) chỉ kiểm `bash -n`, chưa chạy lại e2e.

## 3. Review

Lượt 1 (4 MAJOR, 4 MINOR):
- MAJOR web-gate.sh vẫn nạp `apps/api/.env` (đơn e2e đẩy sang Pancake/Gomdon thật, CORS sai): đã sửa ở 982ceb65 (export rỗng khoá tích hợp, CORS_ORIGINS chỉ web e2e).
- MAJOR bridge Mini App trả `failed` khi khách đóng hộp chia sẻ (-2003): đã sửa ở 1ba272f1 (trả `cancelled`).
- MAJOR Sheet chồng nhau, Tab kẹt và Esc đóng cả hai: đã sửa ở fba6ea11 (ngăn xếp sheet).
- MAJOR web `openExternal` không kiểm scheme: đã sửa ở 06d14b80 (chỉ http/https).
- MINOR Sheet thiếu safe-area đáy, MINOR đổi `dismissible` giật focus: đã sửa ở fba6ea11 (bộ đếm khoá cuộn, dismissibleRef).
- MINOR `oa.openChat` Mini App có thể reject: đã sửa ở 1ba272f1 (`.catch`).
- MINOR webServer thiếu `API_BASE_URL`: đã sửa ở 982ceb65.

Lượt 2 (1 MAJOR, 2 MINOR):
- MAJOR Sheet mở chồng với ConfirmDialog (Esc đóng cả Sheet, Tab giằng focus): đã sửa ở 06a70334 (Sheet chỉ xử lý khi panel là `aria-modal` cuối trong DOM; giữ cả openStack).
- MINOR bridge Mini App `openExternal` chưa chặn scheme: đã sửa ở d8a224be (hàm `isHttpUrl` dùng chung trong app-core).
- MINOR web-gate.sh thiếu khoá AUTH_COOKIE_DOMAIN, AUTH_COOKIE_SAMESITE, ZALO_APP_ID, ZALO_OA_ID, THROTTLE_BYPASS_TOKEN: đã sửa ở 8eb38281.

Mỗi sửa code có test đỏ rồi xanh (trừ web-gate.sh, chỉ `bash -n`).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa chuyển code Mini App cũ sang dùng bridge (theo spec lane); không sửa `zmp-bridge.ts`.
- Chưa chạy spec Web Admin qua gate; gate chạy 1 worker nên mất khoảng 2 phút 20 giây cho 2 spec.
- `web-gate.sh` sau hai lần sửa review chưa chạy lại e2e (không chạy Playwright trong lượt review).
- `lint-parity` bị bỏ qua vì chưa có script.
- `web-gate.sh` không chạy `pnpm build`; cần `shared-types` đã có `dist`.
- Câu chữ global-setup vẫn ghi "từ api/.env" dù secret nay lấy từ `process.env`.
- Không tách QuantitySelector cho add-to-cart (khác giao diện và cách kẹp số lượng, đổi sẽ đổi hành vi). PageHeader dùng `backHref` (Link), không có nút lùi lịch sử như Mini App. Sheet không có hoạt ảnh đóng.
- Lane core-shell đang tách mảng `MIGRATED`; 10 dòng `components/ui/*.tsx` ở cuối mảng có thể phải gộp tay.
- `bridge.ts` vốn chỉ có type, nay có thêm hàm runtime `isHttpUrl`.
- Primitive: spec và code viết cùng lượt, không ghi nhận lần đỏ riêng.

## 5. Câu hỏi cho chủ dự án

1. `oa.follow()` trên web mở `https://zalo.me/<id>` và luôn trả false vì web không đọc được trạng thái theo dõi. Mặc định: giữ vậy.
2. `oa.openChat` web bỏ tham số `message` (link zalo.me không nhận nội dung). Mặc định: bỏ qua.
3. OA id có ký tự ngoài `[A-Za-z0-9_-]` coi như chưa cấu hình. Mặc định: coi như chưa cấu hình.
4. `share` web không tự gắn `?ref=`; bên gọi phải gắn. Mặc định: bên gọi gắn (chỗ hoa hồng/giới thiệu phải dùng đúng như Mini App).
5. Bản Mini App của bridge gọi thẳng `getStorage/setStorage` của zmp-sdk vì `zmp-bridge` không có storage chung. Mặc định: gọi thẳng, như nhiều file Mini App khác.
