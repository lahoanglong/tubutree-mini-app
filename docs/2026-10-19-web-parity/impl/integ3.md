# Lane integ3 — báo cáo

| Mục | Kết quả | Commit |
|---|---|---|
| 1. Hub `/tai-khoan` | Đã đủ từ buildAccountMenu (cùng chữ, điều kiện, queryKey `['dealer-me']`, `['owned-brand','profile']` với Mini App); thêm spec khoá bằng route map thật | a9c31cde |
| 2. shop:3 khối đại lý `/brand/[slug]` | Hiện cho mọi người khi nhãn có chương trình, chữ nút theo hồ sơ như Mini App; BUYERWEB-18 (ẩn khối với khách lẻ) đổi vì Mini App hiện cho mọi người và `/dai-ly` đã mở | 94e40f36 |
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
