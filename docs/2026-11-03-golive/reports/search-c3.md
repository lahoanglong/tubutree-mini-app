# search-c3 (sửa theo review Opus lượt 3)

Nhánh gl/1103-search, commit 7662c2802 trên 42cda6555. Không push.

| Phát hiện | Kết quả |
|---|---|
| P2 cổng kiểm | MỘT PHẦN. Đã làm: Playwright Mini 4 spec browse (buy-flow-4b-browse, browse-defaults, browse-hub, browse-misc), --workers=1, mock-api: 37/37 xanh. Bundle Mini đo lại bằng bundle-report.mjs --build-miniapp: entry raw 675199 B, bằng đúng gốc 52fd5cd65 (675199); gz 209242 vs 209221 đo lượt 1 (khác phép nén, raw không đổi); entry 659/205 KB bằng gốc. CHƯA làm: ảnh app thật 375 (từ khoá dài, ?q=nuoc%20chen, minPrice>maxPrice), Playwright web (shop.web, web-customer qua web-gate.sh), e2e thứ tự Liên quan với API thật. Lý do: cần lane 5 + Postgres/Next build, máy load ~19 (đã khởi động lại 2 lần hôm nay), lệnh bắt không bật lane nếu không bắt buộc. Điều phối chạy khi máy rảnh theo mục fix của reviewer. |
| P3 BrowseView web không đọc lại lịch sử sau khi phiên hết hạn xoá | Đã sửa (cách 1). recent-searches.ts phát window event `tubu:recent-searches` khi scope/forget thật sự xoá; BrowseView nghe và setRecent(readRecentSearches()). Test browse-view.spec đỏ với mã cũ (bảng "Tìm gần đây" vẫn hiện 'thuốc X' sau forget), xanh sau sửa. |
| P3 ngắt dòng "Không tìm thấy" Mini (ZWSP) khác web (break-words) | Không sửa. Reviewer ghi chấp nhận được; không tràn; muốn khớp phải chuyển hàm sang app-core hoặc thêm CSS vào chunk Mini, ngoài phạm vi gói đã khoá entry. |
| P3 Mini xoá lịch sử khi refresh bị từ chối | Không sửa, chủ ý. Coi phiên hết hạn như đăng xuất (khớp web), không lộ dữ liệu; đổi sang "chỉ xoá khi đổi chủ" làm máy dùng chung có nguy cơ hiện lịch sử người trước. Ghi để chủ biết đánh đổi. |

Kiểm (Node 22.23.3; vitest web phải truyền --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1 vì --maxWorkers=2 lỗi "minThreads/maxThreads conflict" ở config này):
- vitest web src/components/catalog + recent-searches.spec + auth-context: 15 file, 170/170 xanh
- tsc --noEmit web: sạch
- Playwright Mini browse: 37/37 xanh
Đã dọn: không bật lane; tiến trình Vite của Playwright tự thoát.
