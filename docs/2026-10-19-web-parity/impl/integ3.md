# Lane integ3 — báo cáo

| Mục | Kết quả | Commit |
|---|---|---|
| 1. Hub `/tai-khoan` | Đã đủ từ buildAccountMenu (cùng chữ, điều kiện, queryKey `['dealer-me']`, `['owned-brand','profile']` với Mini App); thêm spec khoá bằng route map thật | a9c31cde |
| 2. shop:3 khối đại lý `/brand/[slug]` | Giữ BUYERWEB-18 (30cfe565, quyết định cố ý trên main: ẩn chương trình đại lý B2B với khách lẻ, không liên quan `/dai-ly`). 94e40f36 làm khối hiện cho mọi người đã bị revert ở cc748264; câu hỏi mở cho chủ: theo Mini App hay giữ BUYERWEB-18. Thêm test `/dealer/me` được gọi, lỗi và REJECTED đều ẩn khối | cc748264, 385d3f82 |
| 3. MiniAppOnlyNotice `compact` | Đệm py-4, dùng ở thẻ chấm công; mặc định py-16 | 018bf051 |
| 4. mock-api `put` | Thêm, đổi pro.web.spec; tsc e2e sạch, không chạy Playwright | 20520b53 |
| 6. Docs 98 và pro.md | Ghi "đã xử lý ở" | 81a54361 |

Mục 5, nơi dùng `isWebRouteReady(` cho route pro:

| Nơi | Route | Kết quả |
|---|---|---|
| account-menu (isReady) | `/dai-ly`, `/nhan-vien`, `/nhan-vien/bang-luong`, `/chu-thuong-hieu` | nay hiện, đúng Mini App |
| brand-actions BrandDealerBlock | `/dai-ly` | nút hiện; giữ guard dự phòng |
| notification-view resolveWebRoute | mọi đích pro | nay tra ra route web |

## Kiểm chứng (summary.txt của gate cuối, commit 17bfc5b4)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)  Tests  488 passed (488)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  342 passed (342)  Tests  5636 passed (5636)
web-test-utc rc=0  Test Files  342 passed (342)  Tests  5636 passed (5636)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)  Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (9 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0 (chỉ cảnh báo chunk size)
DONE
```

## Review

| Lượt | Phát hiện | Xử lý |
|---|---|---|
| 1 | MAJOR: lý do đảo BUYERWEB-18 sai (30cfe565 là quyết định cố ý ẩn B2B với khách lẻ, không liên quan `/dai-ly`); trang ISR công khai lộ ngưỡng B2B | Đã sửa: revert 94e40f36 ở cc748264; ghi lại lý do đúng và shop:3 là câu hỏi mở ở 385d3f82 |
| 1 | MINOR: test khách đã đăng nhập không khẳng định `/dealer/me` được gọi; thiếu test lỗi và REJECTED | Đã sửa ở 385d3f82 |
| 2 | MINOR: báo cáo ghi "Câu hỏi: không", thiếu hash | Đã sửa ở 17bfc5b4 |
| 2 | MINOR: test lỗi/REJECTED chỉ kiểm rỗng, không chứng minh đã gọi `/dealer/me` | Đã sửa ở 17bfc5b4 (thêm `toHaveBeenCalledWith('/dealer/me')`, có mockClear giữa hai nửa) |

## Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa làm: shop:3 giữ hành vi BUYERWEB-18, chưa theo Mini App, chờ chủ quyết.
- Playwright không chạy (chỉ viết/typecheck spec e2e).
- Spec mục 1 và 3 xanh ngay khi viết (hub đã đúng sẵn, compact thêm cùng lúc), không đỏ trước như TDD.

## Câu hỏi cho chủ dự án

- shop:3 (khối chương trình đại lý ở `/brand/[slug]`): giữ BUYERWEB-18 (30cfe565, ẩn chương trình B2B với khách lẻ), hay theo Mini App brand-view (cherry-pick 94e40f36, chấp nhận trang SSR hiện ngưỡng B2B cho mọi người). Hiện đang giữ BUYERWEB-18.
