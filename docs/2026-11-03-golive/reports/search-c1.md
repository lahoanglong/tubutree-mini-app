# search-c1 (sửa theo review Opus, lượt continue)

Nhánh gl/1103-search, tip 3a914795f (lần chạy trước bị khởi động lại cắt, nhưng commit này đã đủ; worktree sạch, không cần commit mới).

| Phát hiện | Kết quả |
|---|---|
| P2 entry Mini +40 B (empty-state.tsx) | Đã sửa ở 3a914795f: empty-state.tsx về đúng bản gốc (diff so với 52fd5cd65 = 0 dòng), ngắt dòng chuyển sang softBreakLongWords trong browse.tsx (chunk lazy) + test browse.spec. Entry không đổi theo cấu trúc; chưa đo lại bundle-report (không build). |
| P2 thiếu ảnh 375 / Playwright | Chưa làm: cần bật lane + chụp, bị cấm do tải máy. Để phiên điều phối chạy `capture.mjs --lane 5 --phase mini375,web375` cho /browse?q=<130 'a'>, q='nuoc chen', ?minPrice=500000&maxPrice=100000. |
| P3 lịch sử tìm khi đăng xuất (Mini) | Đã sửa 3a914795f: forgetRecentSearchesOfSignedOutUser khi idle không user; test recent-searches.spec. |
| P3 web đổi tài khoản không qua logout | Đã sửa 3a914795f: auth-context gọi scopeRecentSearchesToUser(userId); test web recent-searches.spec. |
| P3 thứ tự Liên quan lệch giữa các trang | Đã sửa 3a914795f: matchCache khoá ngắn theo từ khoá 60 giây (tối đa 50 khoá), test catalog.service.spec dòng 815. |
| P3 rankCache bị tìm kiếm đẩy khoá | Đã sửa 3a914795f: listByRelevance truyền cacheable=false; test khẳng định không ghi rankCache. |

Kiểm lại (Node 22.23.3, pool forks tối đa 2):
- jest catalog.service.spec: 136/136 xanh
- vitest miniapp browse.spec: 72/72 xanh; recent-searches.spec: 14/14 xanh
- vitest web recent-searches.spec: 10/10 xanh
- tsc --noEmit api, miniapp, web: sạch
Không bật lane, không chạy Playwright.
