# T5-FIX miniapp (hz12/miniapp-copy)

| Mục | Commit | Test đỏ -> xanh | tsc / eslint |
|---|---|---|---|
| 1 Mời bạn: điều kiện + ẩn với CTV | e20ec172 | jest reward-points.service.spec (windowDays/minOrderAmount) và vitest wallet.spec (3 ca) đỏ rồi xanh | api + miniapp tsc sạch, eslint 0 cảnh báo |
| 3 Về Tubu Tree: mặc định Q-17 + bấm gọi | 83a8d9e2 | vitest about.spec (2 ca) đỏ rồi xanh | sạch |
| 4 Giá vòng quay | 39e5f8c9 | jest game.service.spec (spinCostPoints), vitest game-behavior.spec đỏ rồi xanh | api + miniapp sạch |
| 5 Xác nhận góp quỹ trồng cây | 527cb188 | vitest tree-actions.spec (mới, 3 ca đỏ), game-behavior.spec cập nhật | sạch |
| 6 Chữ Điểm Xanh | (commit cuối trước báo cáo) | terminology.spec đỏ (guard mới) rồi xanh | sạch |

## Lệnh đã chạy
- API: `npx jest src/modules/wallet`, `npx jest src/modules/game` (192 pass), `npx tsc --noEmit`.
- Miniapp: vitest nhắm file từng mục; cuối cùng `npx vitest run src/i18n src/utils src/pages src/components` = 157 file, 1713 test pass; `npx tsc --noEmit` sạch.

## Khác spec
- Mục 1: `ReferralOverview.windowDays/minOrderAmount` để optional ở FE (API cũ chưa trả thì rơi về 30 / 200.000). Khối bị ẩn hoàn toàn với AFFILIATE (không có chuỗi hoa hồng sẵn để thay). API dùng chung helper `referralOrderRules()` với code thưởng.
- Mục 3: chỉ rơi về mặc định khi query lỗi. Hotline/email admin để trống (null) vẫn ẩn dòng như Q-17 hiện có (web thì thay bằng mặc định); `callPhone` mới trong zmp-bridge dùng `openPhone` của zmp-sdk, ngoài Zalo rơi về `tel:`.
- Mục 5: hộp xác nhận ghi "Điểm thường trừ trước, rồi điểm quy đổi không hết hạn".
- Mục 6: đổi cả `vi.checkout.pointsEarn` và `pointsEarnLabel` thành "Nhận +N Điểm Xanh khi giao thành công"; bỏ tiền tố "Tích lũy" ở checkout.tsx.
