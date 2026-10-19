# Lane core-shell: báo cáo

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Route map, script parity, AGENTS.md | 893f36f1 | `packages/app-core/src/route-map.json`, `scripts/check-platform-parity.mjs`, `route-map-parity.spec.ts`, `AGENTS.md`, CI `lint:parity` |
| Dùng route map cho redirect 307, robots, sitemap, MiniAppOnlyNotice | 6e18bc61 | `apps/web/src/lib/route-map.ts`, `miniapp-redirects.mjs`, `next.config.mjs`, `components/mini-app-only-notice.tsx` |
| Ghi nguồn `?s=` như Mini App | b6da905f | `components/storefront-tracker.tsx`, `lib/storefront-context.ts` |
| Biến build Zalo OA, Cloudinary, CSP | a9dacdfb | `Dockerfile`, hai file compose, `.env*.example`, `next.config.mjs` |
| Thanh đáy, nav header, AppGates | 33cda22c | `components/bottom-nav.tsx`, `lib/web-nav.ts`, `components/app-gates.tsx` |
| Tách danh sách spec theo lane | a09602b1 | `ds-v2-guest.spec.ts`, `ds-palette-pc11.spec.ts`, `page-titles.spec.ts`, ... |
| Bỏ pending `storefront-source` | 521f1920 | `route-map.json` |

Route web đã bỏ pending: feature `storefront-source`; 11 route đã có file web sẵn không pending. Còn 41 mục pending cho các lane sau.

## 2. Kiểm chứng (gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  3 passed (3)       Tests  63 passed (63)
web-typecheck rc=0
web-lint rc=0 No ESLint warnings or errors
web-test rc=0  Test Files  201 passed (201)       Tests  3117 passed (3117)
web-test-utc rc=0  Test Files  201 passed (201)       Tests  3117 passed (3117)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=1  Test Files  1 failed | 281 passed (282)       Tests  1 failed | 4258 passed (4259)
lint-vars rc=0 OK
lint-parity rc=0 lint:parity xanh (41 mục pending)
web-build rc=0  Compiled successfully
miniapp-build rc=0
```

`miniapp-test` đỏ do một ca chập chờn dưới tải: `edit-profile.spec.tsx` "mỗi ô nhập có nhãn gắn với ô". Chạy riêng file đó hai lần: 15/15 xanh cả hai. Tổng 4259 test, trên mức sàn 4243. Chưa chạy lại gate đầy đủ sau đó, nên summary vẫn ghi rc=1 ở bước này. Không sửa file Mini App nào.

## 3. Review

Lượt 1 (4 MINOR):
- `/academy/:courseId` lệch với ma trận và community.json: đã sửa ở a3c44d93 (đồng bộ `[courseId]` ở cả ba file, vì redirect Next cần cùng tên tham số hai phía).
- Feature `storefront-source` kiểm symbol đã có sẵn nên vô nghĩa: đã sửa ở ddd8fb46 (kiểm `rememberEntryLink`).
- Script parity sập khi dòng thiếu `web` và `skip`: đã sửa ở 66ff24ac, có test đỏ trước.
- `mini-app-only-notice.tsx` thiếu trong ratchet CORE: đã sửa ở ba441b93.
- Phụ: cde8466c sửa kiểu spec parity để typecheck xanh.

Lượt 2 (1 MINOR):
- Thanh đáy gọi `/orders/active-count` dù tab Đơn hàng còn ẩn: đã sửa ở 0cdafd9a (query chỉ bật khi tab nằm trong `readyNavTabs()`), có test đỏ trước.

Không có BLOCKER hay MAJOR. Lượt 2 xác nhận cả 4 phát hiện lượt 1 đã sửa đúng.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa viết Playwright cho vỏ web (không thuộc mục của lane); không chạy Playwright.
- Badge đơn trên web không có tối ưu `takeMeBlock('activeOrderCount')` như Mini App.
- Dockerfile, compose, `.env` mới chỉ được `next build` kiểm gián tiếp; chưa build Docker thật (chưa kiểm chứng).
- Redirect trỏ tới route web còn pending sẽ cho 404 đến khi lane tương ứng xoá cờ pending.
- `isWebRouteReady` trả false cho đường dẫn không có trong map (chọn an toàn).
- `robots`: `/cong-dong` và `/doi-rac/quy-dinh` có allow và disallow cùng độ dài, dựa vào quy tắc allow thắng của Google; bộ thu thập khác có thể hiểu khác.
- Ca test `miniAppLink('/gio-hang')` cũ đã đổi: nay mở `/cart` thay vì trang chủ Mini App.
- Gate đầy đủ chưa chạy lại sau lần xanh lại file edit-profile.

## 5. Câu hỏi cho chủ dự án

1. Hành vi nút "Mở trên Zalo" ở trang đăng nhập đổi thành deep link đúng màn (`/gio-hang` mở `/cart`). Mặc định: deep link đúng màn.
2. Web nay gửi `kind` và `storefrontSlug` trong `/affiliate/touch` từ `ReferralCapture`, ref được viết hoa. API so khớp không phân biệt hoa thường. Mặc định: giống Mini App; cần xác nhận API xử lý đúng.
3. Khi `?s=` không kèm ref và context gian hàng là nhãn (kind khác CTV) thiếu mã giới thiệu: web không gửi touch bằng slug, Mini App thì gửi. Mặc định: không gửi (an toàn hơn). Muốn giống hệt Mini App thì cần quyết.
4. Tên biến compose `ZALO_OA_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` do lane đặt; cần đặt giá trị ở môi trường deploy. Mặc định: dùng các tên này.
5. `/cashback` đặt `private: false` theo ma trận. Khi hết pending, `/hoan-tien` vào sitemap dù cờ `CASHBACK_ENABLED` tắt. Mặc định: giữ nguyên; lane loyalty cần cân nhắc.
