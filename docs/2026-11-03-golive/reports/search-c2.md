# search-c2 (sửa theo review Opus lượt 2)

Nhánh gl/1103-search, commit mới trên 3a914795f (xem git log). Không push.

| Phát hiện | Kết quả |
|---|---|
| P2 thiếu ảnh 375 + Playwright | CHƯA đủ. Load máy 26 (đã khởi động lại 2 lần) nên không bật lane 5. Chỉ làm bằng chứng nhẹ: render riêng ở Chromium 375px hai cách ngắt (Mini ZWSP mỗi 12 ký tự, web break-words) với 100 chữ 'a': cả hai không tràn (scrollWidth 375), cùng 5 dòng, chỉ khác điểm ngắt (Mini ngắt dòng đầu sau 12 ký tự). Ảnh: docs/2026-11-03-golive/screens-search/wrap-long-term-375-after.png. Không phải ảnh app thật. Chưa chụp /browse?q=nuoc%20chen và minPrice>maxPrice, chưa chạy Playwright; điều phối chạy `capture.mjs --lane 5 --phase mini375,web375 --force` khi máy rảnh. Không bỏ ZWSP: heading của EmptyState là string, bọc span phải sửa empty-state.tsx (đổi entry Mini, lượt 1 đã cố tránh). |
| P3 guest gộp sang Zalo mất lịch sử | Đã sửa. scopeRecentSearchesToUser(userId, storage, isGuest): chủ ghi `guest:<id>`, guest -> tài khoản thật giữ lịch sử và đổi chủ; guest->guest, thật->guest, thật->thật khác vẫn xoá. Mini truyền isGuestUser (browse.tsx). Web dùng chung hàm, web không có khách guest nên mặc định false. Test util đỏ với mã cũ trước, và test browse (đã gỡ dòng nối thì đỏ). |
| P3 web logout không xoá chủ | Đã sửa. logout() gọi forgetRecentSearchesOfSignedOutUser (xoá lịch sử + chủ); thêm effect: initialized, idle, không sessionUnavailable, không user thì forget (khớp Mini; lỗi mạng không xoá). Test auth-context đỏ trước. |
| P3 nối KHAMPHA-15 chưa có test | Đã thêm. browse.spec: A -> phiên hết (xoá lịch sử + chủ), A -> B qua rerender (xoá), guest -> Zalo (giữ). Gỡ dòng nối effect thì 2 test đỏ (đã thử). auth-context.spec web: restore u1 khi owner u0 (xoá), phiên chết (xoá), lỗi tạm (giữ). |
| P3 matchCache thứ tự bỏ khoá | Đã sửa. rememberMatch delete(key) trước set rồi mới bỏ khoá đầu khi size >= 50. Test catalog.service.spec đỏ trước (size 49 vì xoá thừa). |

Kiểm (Node 22.23.3, maxWorkers=2, không lane):
- jest src/modules/catalog: 23 suite, 410/410 xanh
- vitest miniapp browse.spec + src/utils: 43 file, 699/699 xanh
- vitest web src/lib: 133 file, 1538/1538 xanh
- tsc --noEmit miniapp, web, api: sạch
