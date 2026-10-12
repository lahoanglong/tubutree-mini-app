
## Sửa 8 ca Playwright miniapp đỏ sau merge C3/PC-12/PD-1/PD-2

Kết luận: 0 hồi quy mã; cả 8 là mock thiếu hoặc kỳ vọng/selector cũ. Không sửa mã app.

| # | Ca | Nguyên nhân gốc | Loại | File sửa |
|---|----|-----------------|------|----------|
| 1 | buy-flow-4a:148 | `subscriptions-panel.tsx` gọi GET /me/addresses khi có lịch định kỳ để hiện dòng địa chỉ (phân biệt gói cùng SP khác địa chỉ); chủ đích | mock thiếu | support/buy-flow-mocks.ts (mockOrdersTab) |
| 2 | buy-flow-4a:233 | như trên | mock thiếu | như trên |
| 3 | buy-flow-4b:106 | như trên (tab Định kỳ có lịch) | mock thiếu | support/discovery-mocks.ts (mockDiscovery) |
| 4 | design-system-pilot:194 | address-section di cư DS v2 (99608cc2, C-076): nền thẻ chọn = `--color-bg-subtle` = `--sage-50` (#F2F5EC) thay `--forest-50`; viền `--color-border-selected` = `--forest-600`. Chủ ý di cư | kỳ vọng cũ | tests/design-system-pilot.miniapp.spec.ts |
| 5 | design-system-pilot:236 | Chữ "Tạm hết — sẽ về sớm" vẫn còn trong `ProductTile`. C-072 đưa overlay/tim thành anh em của nút tên (nút chỉ còn aria-label=tên) nên `button.getByText` không còn thấy overlay. Không mất overlay | selector cũ | tests/design-system-pilot.miniapp.spec.ts (xét trong vỏ `.tubu-press` chứa nút; vẫn assert đúng 1 overlay trên trang, SP còn hàng không có) |
| 6 | features:34 | hub Cá nhân (profile.tsx, C-086) đọc GET /me/wallet, /me/coupons cho thanh số dư; chủ đích | mock thiếu | tests/features.miniapp.spec.ts (mockProfile + WALLET) |
| 7 | features:71 | như trên | mock thiếu | như trên |
| 8 | returns-reversal:137 | C-113 bỏ emoji; order-detail.tsx:565 nay là 'Yêu cầu đổi/trả đang xử lý (trong 24h)' | kỳ vọng cũ | tests/returns-reversal.miniapp.spec.ts |

Kiểm chứng (mỗi lệnh: `cd apps/e2e && E2E_SCOPE=miniapp npx playwright test --reporter=dot --workers=1 --retries=0 tests/<file>.miniapp.spec.ts`):
design-system-pilot 8 passed; buy-flow-4a 31 passed; features 2 passed; buy-flow-4b 16 passed; returns-reversal 3 passed. Cả 8 ca ban đầu xanh.
