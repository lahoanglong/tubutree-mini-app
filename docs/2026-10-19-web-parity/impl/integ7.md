# Lane integ7: Đồng bộ web game, Điểm Xanh, kho quà với Mini App bản mới

## 1. Đã làm
Bảng commit Mini App (`07ac5aa1..13ffd242`, bỏ file đổi rác) sang file web.

| Commit Mini App | Hành vi/chữ đổi | File web | Kết quả |
|---|---|---|---|
| 653b3e19, 89c3c778, 269116cc | `unlockPlot(slot)` gửi `{ currency: 'SEEDS', slot }`; nơi gọi truyền `garden.nextUnlock.slot` | `packages/app-core/src/api/game.ts`, `components/game/garden-plots.tsx`, `use-game-actions.ts`, `app/vuon-xanh/page.tsx` | Đã theo (adc9f096). Không truyền slot thì body vẫn `{ currency: 'SEEDS' }` |
| 6c682012 | Giá vòng quay mặc định `10_000` khi API chưa trả `spinCostPoints` | `app/vuon-xanh/page.tsx` | Đã theo (adc9f096) |
| 587c4b0c | Khoá mốc hạng `tubu_last_tier_min_v2`, khoá cũ bị bỏ qua | `app/tai-khoan/diem-xanh/page.tsx` | Đã theo (bcd0e1a4) |
| fa98a8e8, eb9ecde0 | `pointsRulesNote` (trần %, phí ship, hạn điểm từ cấu hình công khai, ẩn khi chưa tải); dòng "Đổi quà dùng được" chỉ khi khác tổng | `lib/loyalty-copy.ts`, `app/kho-qua/page.tsx` | Đã theo (e18a62df) |
| b82a7ad4 | Thẻ quà: biểu tượng theo loại (Ticket, Leaf, Sprout, Gift), hàng giá cùng nút, thanh tiến độ riêng | `app/kho-qua/page.tsx` | Đã theo (e18a62df) |
| 7832d7e1 | Quà của tôi: nhãn "Chờ nhận" cho READY, QR căn giữa, thẻ mã giảm giá cùng kiểu thẻ | `app/kho-qua/cua-toi/page.tsx` | Đã theo (e18a62df); kiểu thẻ mã giảm giá: web đã dùng chung `ui.card`, không cần |
| fa8cfbab, 51bfdb25 | Nhãn lịch sử điểm đơn tư vấn viên, đơn sàn | `lib/ledger-labels.ts` | Không cần: web đã có bốn mã |
| button.tsx, timeline.tsx | Primitive Mini App | không | Không cần: nút nguy hiểm khoá và timeline chỉ phục vụ đổi rác, integ6 đã xử lý |
| Commit đổi rác còn lại | Màn đổi rác | `/doi-rac`, `components/recycle` | Ngoài lane (integ6) |

Endpoint, body, Idempotency-Key giữ nguyên, chỉ thêm `slot` vào body mở lô như Mini App.

## 2. Kiểm chứng
```
cd apps/web && npx vitest run
 Test Files  358 passed (358)
      Tests  6174 passed (6174)
cd packages/app-core && npx vitest run
 Test Files  41 passed (41)
      Tests  489 passed (489)
cd apps/web && npx tsc --noEmit        (không lỗi)
cd packages/app-core && npx tsc --noEmit   (không lỗi)
```
Test đỏ trước khi code ở nhóm Điểm Xanh và Kho quà. Nhóm game: test sửa cùng lúc với code, chưa xác nhận đỏ riêng. Không sửa file Mini App nên không chạy lại test Mini App. Không chạy Playwright.

## 3. Câu hỏi mở
Không có.
