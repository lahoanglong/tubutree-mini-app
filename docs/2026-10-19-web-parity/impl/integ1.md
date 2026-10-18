# Lane integ1 — báo cáo

## 1. Đã làm
Commit: 0f31dd5b (nguồn notification), edb82389 (Đơn hàng dùng bản hợp nhất), 32e7005a (chi tiết đơn), 3a8543dd (nhắc mua lại ở thông báo), a71fb529 (báo cáo), 01e86ba2 và 8ed45b60 (sửa theo review). Route đã xong, bỏ pending: /tai-khoan/don-hang (mua lại), /tai-khoan/thong-bao (nhắc mua lại).

| Mục | Kết quả |
|---|---|
| Hợp nhất mua lại | Gốc là `apps/web/src/components/reorder/*` (lane shop). Bản `components/orders/{reorder,reorder-sheet,purchased-rail,use-reorder}` và spec đã xoá. |
| Chi tiết đơn | "Mua lại đơn này" mở `ReorderSheet` như Mini App (trước đó gọi `repurchaseOrder(code)` không body, không addSource). |
| Thông báo nhắc mua lại | `tai-khoan/thong-bao/page.tsx` tra purchased-items theo `variation_id`, mở sheet (nguồn `notification`), dự phòng điều hướng. Logic chọn ở `components/reorder/reorder-reminder.ts`. |
| Danh sách spec ds-v2 | Bỏ hai dòng `components/orders/*` đã xoá; hai file hợp nhất đã nằm ở khối SHOP. |

## 2. Bảng khác biệt đã xử lý
| Hành vi | Bản shop (`reorder/`) | Bản order (`orders/`) | Mini App | Chọn |
|---|---|---|---|---|
| Endpoint một SP | POST /cart/items, addSource repurchase | giống | giống; nguồn thông báo gửi reorder_notification | Giữ; thêm `source: 'notification'` gửi `reorder_notification` |
| Endpoint cả đơn | POST /orders/{code}/repurchase {items, addSource: repurchase} | giống | giống | Giữ |
| Khoá nút | khoá cả khi đã thêm một phần (tránh nhân đôi) | chỉ khoá khi đang gửi | chỉ khi đang gửi | Giữ bản shop (an toàn cho số lượng) |
| Thêm một phần | sheet ở lại, nêu từng món và lý do, kèm lối "Xem giỏ" | sheet đóng, dải báo ở trang gọi (`onNotice`) | đóng, snackbar | Giữ bản shop; web không có snackbar. Bỏ `onNotice` và dải báo ở trang Đơn hàng |
| Không thêm được món nào | ở lại, báo, cho thử lại | giống | snackbar lỗi | Giữ |
| Lỗi mạng | `homeErrorMessage`, giữ lựa chọn | `e.message`, giữ lựa chọn | snackbar | Giữ bản shop |
| Chữ hiển thị | `reorderText` (lib/home-text) | chuỗi rải rác, trùng nội dung | `vi.reorder` | Giữ bản shop |
| Tham số `source` analytics | không | có nhưng không dùng (`_source`) | gửi sự kiện | Bỏ; web chưa gửi sự kiện, chỉ giữ nguồn thông báo vì đổi addSource |
| Kệ Mua lại | cùng khoá cache `['purchased-items', 10]`, dùng `useBlockQuery` | `useQuery` riêng, có dải "Thử lại" | rail | Giữ bản shop cho cả Trang chủ và trang Đơn hàng |
| Ca test của bản order | | đổi target khi đang mở; mua một SP | | Chuyển sang `reorder-sheet.spec.tsx` / `use-reorder.spec.tsx`; ca còn lại trùng ý nên bỏ |
| Ca test chi tiết đơn "thêm một phần" | | | | Ý nghĩa nằm ở `reorder-sheet.spec.tsx` ("có dòng không thêm được"); spec chi tiết đơn chỉ còn mở sheet, gửi body, báo hết hàng |


## 3. Kiểm chứng
Gate cuối (gate-logs/integ1/run3/summary.txt), ĐỎ vì tải máy (load ~120), chưa có lần xanh liền mạch:
```
install rc=0 
shared-types rc=0 
app-core-typecheck rc=0 
app-core-test rc=0  Test Files  38 passed (38)       Tests  463 passed (463) 
web-typecheck rc=0 
web-lint rc=0 ✔ No ESLint warnings or errors 
web-test rc=1  Test Files  4 failed | 291 passed (295)       Tests  22 failed | 4469 passed (4491)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @tubutree/web@0.0.0 test: `vitest run` 
web-test-utc rc=1  Test Files  3 failed | 292 passed (295)       Tests  32 failed | 4459 passed (4491)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @tubutree/web@0.0.0 test: `vitest run` 
miniapp-typecheck rc=0 
miniapp-lint rc=0 
miniapp-test rc=1  Test Files  17 failed | 265 passed (282)       Tests  24 failed | 4190 passed (4214)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @tubutree/miniapp@0.0.0 test: `vitest run` 
lint-vars rc=0 OK — every var(--x) reference is defined. 
lint-parity rc=0 > tubutree@0.0.0 lint:parity /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-integ1 lint:parity xanh (23 mục pending) 
web-build rc=0  ✓ Compiled successfully 
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit. 
DONE
```
Chạy riêng lại các file đỏ, tất cả xanh: 7 file web (cai-dat, waste-point-form, waste-tab, subscriptions-panel, login-flow, don-hang, hub) 133/133; 17 file Mini App với --no-file-parallelism --testTimeout=30000: 474/474. Review vòng 2 chạy thong-bao, components/reorder, don-hang: 12 file 210/210; eslint và tsc apps/web sạch. Không có file apps/miniapp nào bị sửa. Gate chưa chạy lại sau commit 8ed45b60 (chỉ chạy riêng thong-bao 22/22).

## 4. Review
| Lượt | Phát hiện | Xử lý |
|---|---|---|
| 1 | MAJOR: nhắc mua lại thêm đủ rồi đóng sheet, không có phản hồi, có thể bấm lần hai thêm trùng | Sửa ở 01e86ba2: ReorderSheet có onDone(summary), trang thông báo hiện "Đã thêm… Xem giỏ" 4 giây |
| 1 | MINOR: test chạm đúp không chạm reminderBusyRef; nhánh tra cứu quá hạn chưa test | Sửa ở 01e86ba2: hai click trong một act, thêm test tra cứu quá hạn; đã kiểm bằng xoá guard thì test đỏ |
| 1 | MINOR: nút không có trạng thái tải | Sửa ở 01e86ba2: Loader2 và test |
| 2 | MINOR: thông báo nằm đầu trang, danh sách dài thì không thấy; role=status gắn cùng nội dung | Sửa ở 8ed45b60: cố định đáy, vùng role=status luôn có sẵn. Không viết test đỏ trước (sửa code và test cùng lúc, 22/22). Chưa kiểm chứng trực quan với thanh điều hướng đáy (không chạy Playwright) |

## 5. Chưa làm, cố ý để lại, chưa kiểm chứng
- Gate toàn phần xanh liền mạch: chưa có, cần chạy lại khi máy rảnh.
- Không xác nhận được số test Mini App lúc bắt đầu lane; tổng 4214 bằng ngưỡng tối thiểu (không giảm vì không đụng Mini App).
- Playwright không chạy; ca nào dựa vào luồng mua lại cũ ở chi tiết đơn hoặc thông báo cần chạy lại ở lane tích hợp sau.
- `repurchaseOrder` ở lib/shop-client.ts không còn nơi dùng (file lane core); header order-actions.spec.tsx còn mô tả cũ (lane order); không sửa.
- Web chưa gửi sự kiện phân tích mua lại (trackReorderReminderCta, trackReorderCompleted).
- bottom: calc(5rem + safe-area) cố định cho thông báo chưa kiểm chứng trực quan.

## 6. Câu hỏi cho chủ dự án
- Web có cần kênh sự kiện phân tích cho mua lại như Mini App không? Mặc định: không gửi.
- Xoá `repurchaseOrder` khỏi lib/shop-client.ts khi lane core cho phép? Mặc định: giữ.
