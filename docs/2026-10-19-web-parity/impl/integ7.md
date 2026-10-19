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
| 810e06c9 | Test mở lô lỗi (400 danh sách lô đã đổi): hiện `role=alert`, nút mở lại, body vẫn `{ currency:'SEEDS', slot:4 }` | `apps/web/src/app/vuon-xanh/garden-community.spec.tsx` | Từ review lượt 1 |

Route web đã bỏ pending: lint:parity báo 0 mục pending.

## 2. Kiểm chứng (gate cuối, green=true)
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files 41 passed (41)  Tests 489 passed (489)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files 358 passed (358)  Tests 6175 passed (6175)
web-test-utc rc=0  Test Files 358 passed (358)  Tests 6175 passed (6175)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files 283 passed (283)  Tests 4299 passed (4299)
lint-vars rc=0 OK
lint-parity rc=0 xanh (0 mục pending)
web-build rc=0  Compiled successfully
miniapp-build rc=0
DONE
```
Test đỏ trước khi code: nhóm Điểm Xanh (3 fail), Kho quà (6 fail). Nhóm game sửa test cùng code, không có bước đỏ riêng. Test mở lô lỗi xanh ngay vì `onError` đã có; tạm bỏ `onError` thì đỏ (1 failed), đã khôi phục. Không chạy Playwright.

## 3. Review
- Lượt 1, MINOR: chưa có test cho POST mở lô lỗi 400 (đường lỗi mới do gửi `slot`). Đã sửa ở 810e06c9.
- Lượt 2: không phát hiện. Ghi chú nhỏ: số test 6174 ở bản báo cáo cũ thiếu một test của 810e06c9 (nay 6175), chỉ là tài liệu, đã cập nhật.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng
- Không có mục bỏ dở. Không sửa file Mini App, API, file đổi rác. Nhãn lịch sử điểm, button/timeline Mini App cố ý không port (web đã có hoặc chỉ dùng cho đổi rác).
- Chưa chạy Playwright (đúng luật lane).

## 5. Câu hỏi cho chủ dự án
Không có.
