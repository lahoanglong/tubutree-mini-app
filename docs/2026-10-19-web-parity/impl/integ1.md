# Lane integ1 — báo cáo

## 1. Đã làm
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

## 3. Câu hỏi / ghi chú
- `repurchaseOrder` ở `lib/shop-client.ts` không còn nơi dùng (file của lane core, không xoá).
- Nhắc mua lại ở thông báo không gửi sự kiện phân tích như Mini App (`trackReorderReminderCta`, `trackReorderCompleted`): web chưa có kênh sự kiện mua lại.
- Header của `order-actions.spec.tsx` còn câu mô tả cũ ("chỉ có dòng gọi hotline"); thuộc lane order, không sửa.
