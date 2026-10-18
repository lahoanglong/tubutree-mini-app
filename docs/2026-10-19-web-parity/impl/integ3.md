# Lane integ3 — báo cáo

| Mục | Kết quả | Commit |
|---|---|---|
| 1. Hub `/tai-khoan` | Đã đủ từ buildAccountMenu (cùng chữ, điều kiện, queryKey `['dealer-me']`, `['owned-brand','profile']` với Mini App); thêm spec khoá bằng route map thật | a9c31cde |
| 2. shop:3 khối đại lý `/brand/[slug]` | Giữ BUYERWEB-18 (30cfe565, quyết định cố ý trên main: ẩn chương trình đại lý B2B với khách lẻ, không liên quan `/dai-ly`). 94e40f36 làm khối hiện cho mọi người đã bị revert ở cc748264; câu hỏi mở cho chủ: theo Mini App hay giữ BUYERWEB-18. Thêm test `/dealer/me` được gọi, lỗi và REJECTED đều ẩn khối | cc748264 |
| 3. MiniAppOnlyNotice `compact` | Đệm py-4, dùng ở thẻ chấm công; mặc định py-16 | 018bf051 |
| 4. mock-api `put` | Thêm, đổi pro.web.spec; tsc e2e sạch, không chạy Playwright | 20520b53 |
| 6. Docs 98 và pro.md | Ghi "đã xử lý ở" | commit docs |

Mục 5, nơi dùng `isWebRouteReady(` cho route pro:

| Nơi | Route | Kết quả |
|---|---|---|
| account-menu (isReady) | `/dai-ly`, `/nhan-vien`, `/nhan-vien/bang-luong`, `/chu-thuong-hieu` | nay hiện, đúng Mini App |
| brand-actions BrandDealerBlock | `/dai-ly` | nút hiện; giữ guard dự phòng |
| notification-view resolveWebRoute | mọi đích pro | nay tra ra route web |

Câu hỏi: không.
