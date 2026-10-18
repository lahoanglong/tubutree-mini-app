# Báo cáo lane game (nhánh web/game)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Vườn Xanh: khung và tab Hôm nay | 8b297727 | `apps/web/src/app/vuon-xanh/{page,layout}.tsx`, `apps/web/src/components/game/{use-game-data,use-game-actions,use-locked-mutation,game-notice}` |
| Vườn Xanh: tab Vườn và Cộng đồng | 8519d1be | `apps/web/src/app/vuon-xanh/garden-community.spec.tsx`, các component lô đất, sổ tay, tặng nước, mục tiêu, xếp hạng, hộp thu hoạch |
| Trợ lý AI | 6bc39b2f | `apps/web/src/app/tu-van/{page,layout}.tsx`, `page.spec.tsx` |

Route đã xong, đã bỏ `pending` trong `packages/app-core/src/route-map.json`: `/vuon-xanh`, `/tu-van`.
Spec e2e viết thêm ở `apps/e2e/tests/game.web.spec.ts` (không chạy Playwright). Spec danh sách lane khác chỉ thêm dòng cho file mới.

## 2. Kiểm chứng (summary.txt của gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  38 passed (38)  Tests  463 passed (463)
web-typecheck rc=0
web-lint rc=0 No ESLint warnings or errors
web-test rc=0  Test Files  281 passed (281)  Tests  4537 passed (4537)
web-test-utc rc=0  Test Files  281 passed (281)  Tests  4537 passed (4537)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=1  Test Files  2 failed | 280 passed (282)  Tests  2 failed | 4212 passed (4214)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL
lint-vars rc=0 OK
lint-parity rc=0 xanh (24 mục pending)
web-build rc=0 Compiled successfully
miniapp-build rc=0
DONE
```

Gate KHÔNG xanh hoàn toàn: `miniapp-test` rc=1 do 2 test chập chờn khi máy tải cao (`profile-hub.spec.tsx` C-086, `subscribe-sheet.spec.tsx` C-015). Chạy riêng lại sau gate: 2 file, 20 test đạt. Chưa chạy lại toàn gate để có một summary xanh. Lane không sửa file Mini App.

## 3. Review

Lượt 1 (không BLOCKER):
- MAJOR thông báo game (z-40) bị Sheet (z-50) che, và bottom-20 thấp hơn thanh nav iPhone: sửa ở f19a85eb (portal ra body, z-[60], `calc(76px + safe-area)`).
- MINOR thanh tab dính dưới header: sửa ở f19a85eb (đo chiều cao header bằng ResizeObserver).
- MINOR thanh nhập /tu-van `bottom-16` hở 64px vì không có bottom nav: sửa ở d05ef42a.
- MINOR `navigator.clipboard` có thể ném lỗi đồng bộ: sửa ở f19a85eb (try/catch, có test).
- MINOR thiếu test làm mới `['loyalty']`: sửa ở f19a85eb.
- MINOR khung hẹp một cột trên máy tính: sửa ở f19a85eb (`lg:max-w-5xl`, `lg:grid-cols-2`).

Lượt 2:
- MINOR thông báo `md:bottom-6` đè ô nhập /tu-van trên desktop: sửa ở a7123b57 (prop `raised`).
Lượt 2 xác nhận sáu phát hiện lượt 1 đã sửa. Chưa có lượt review sau a7123b57.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa kiểm tra giao diện thật (máy tính, 320px): không chạy Playwright, chỉ viết spec.
- Gate chưa có một lần xanh trọn vẹn (xem mục 2).
- Season pass ẩn theo cờ `SEASON_PASS_ENABLED=false`, API không được gọi.
- Link đổi rác và link Bảng tin cộng đồng chỉ hiện khi `/doi-rac`, `/cong-dong` đã bỏ pending (lane khác).
- Haptic không có bản web, bỏ qua.
- Nút Gửi của /tu-van chỉ báo đang gửi bằng `aria-busy`, không có spinner.
- Spec /tu-van có 28 test so với 29 của Mini App (gộp vài ca, cùng ý nghĩa).
- Mini App gọi sớm các truy vấn board, community, friends...; web gọi theo khối dùng chúng.

## 5. Câu hỏi cho chủ dự án

1. EcoImpact ở tab Vườn hay Hôm nay? Mặc định: tab Vườn như Mini App (đổi một dòng trong `page.tsx`).
2. FriendGifts ở Cộng đồng, CommunityGoal ở Vườn (như Mini App), dù mô tả task ghi ngược lại. Mặc định: như Mini App.
3. Chữ khung đăng nhập: "Đăng nhập để xem cộng đồng" và nút "Đăng nhập với Zalo" của `LoginRequired` chung. Mặc định: giữ như vậy.
4. Nút "Dùng ngay" khi trúng voucher đi tới `/san-pham`. Mặc định: `/san-pham`.
5. Khách chưa đăng nhập vào /tu-van khi server tắt AI vẫn bị đưa về `/`, không hiện cổng đăng nhập. Mặc định: về `/`.
6. Có cần chạy lại gate khi máy rảnh để có summary xanh? Mặc định: chưa chạy.
