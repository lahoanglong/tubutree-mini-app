# W45A: kiểm bản build Zalo Mini App trước khi tải lên ZMP

Ngày kiểm: 08/11/2026. Cơ sở: `origin/main` `f37ad48ee` (W44B, #217), so với nhánh `feat/w45a-pdp-trust-strip` (thêm `ProductTrustStrip` ở trang chi tiết). Việc tải gói lên ZMP là việc của chủ dự án (cần phiên `zmp login` của chủ); tài liệu này chỉ nói gói đã sẵn sàng đến đâu và cách tải.

## Kết quả kiểm

| Mục | Kết quả |
|---|---|
| `pnpm --filter @tubutree/miniapp build` (gồm `tsc --noEmit` rồi `vite build`, `VITE_API_BASE_URL=https://api.tubutree.com/api`, `VITE_WEB_BASE_URL=https://app.tubutree.com`) | thoát 0 ở cả `f37ad48ee` lẫn nhánh W45A |
| Cảnh báo của build | như cũ, không thêm: chunk lớn hơn 500 kB và `store/auth.ts` vừa nạp tĩnh vừa nạp động |
| Địa chỉ API nhúng trong bundle | `https://api.tubutree.com/api` (2 chỗ). Chuỗi `localhost` còn 1 file, là `new URL(..., "http://localhost")` của react-router và phép thử `hostname.includes("localhost")`, có từ trước, không phải địa chỉ API |
| `app-config.json` | giống hệt `f37ad48ee` (`appId` 2070857098114207963, tiêu đề Tubu Tree); nhánh này không sửa `app-config.json`, `zmp-cli.json`, `package.json`, `vite.config.mts` |
| Test Mini | 459 file, 7.347 test xanh |

## Kích thước (`node scripts/ci/bundle-budget.cjs`)

| | `f37ad48ee` | W45A | chênh |
|---|---|---|---|
| Tất cả, raw | 2.380 KB | 2.384 KB | +4 KB |
| Tất cả, gzip | 917 KB | 918 KB | +1 KB |
| JS, raw | 2.065 KB | 2.068 KB | +3 KB |
| CSS, raw | 155 KB | 157 KB | +2 KB |
| Entry JS, raw / gzip | 730 / 229 KB | 731 / 229 KB | +1 / 0 KB |
| Chunk `product-detail`, raw / gzip | 65 / 21 KB | 66 / 22 KB | +1 / +1 KB |

Entry (700 KB) và tổng (2.048 KB) đã vượt ngưỡng cảnh báo của dự án từ trước W45A; W45A không tạo vượt mới. Đây là ngưỡng của dự án, không phải giới hạn của Zalo (giới hạn dung lượng gói hiện hành của Zalo chưa kiểm được). Dải cam kết nằm trong chunk `product-detail` (tải khi mở trang sản phẩm), CSS của dải đi cùng chunk đó.

## Gói ZMP kế tiếp gồm gì

Mọi wave có đổi Mini App từ W25 đến W45A, trừ W32 và W34, chưa lên Mini App Testing. Bản kế tiếp mang cả chuỗi đó.

## Cách tải (chủ thực hiện)

1. Dựng worktree sạch ở commit cần tải, ví dụ `git worktree add .claude/worktrees/miniapp-release <sha>`, rồi `pnpm install --frozen-lockfile` và `pnpm --filter @tubutree/shared-types build`.
2. Đặt `apps/miniapp/.env.production` có `VITE_API_BASE_URL=https://api.tubutree.com/api` và `VITE_WEB_BASE_URL=https://app.tubutree.com` (file không vào git; `vite build` dừng lỗi nếu thiếu hoặc trỏ localhost).
3. Trong `apps/miniapp`: `zmp login` (phiên hết hạn thì báo "Permission denied. Please login again"), rồi `zmp deploy -t -p -M production -m "<mô tả>"` để lên Mini App Testing.
4. Thử Testing trên điện thoại, sau đó gửi duyệt bản Live. Mini App chưa từng gửi duyệt (KYB Fuwa, ticket Zalo 31131).
