import { readTodoRows, writeTodoRows, type MemoryStorage } from './home-layout';

/**
 * Khách vừa đặt đơn: lần mở Trang chủ sau (kể cả mở lạnh) chắc chắn có Việc cần làm, nhưng /me/summary chưa về thì chưa biết. Nhớ ít nhất 1 dòng
 * để khung chờ giữ chỗ ngay từ khung hình đầu, thay vì chèn dải vào làm Danh mục và Bán chạy nhảy xuống. Không hạ số dòng đã nhớ.
 */
export function rememberActiveOrder(storage: MemoryStorage | null, userId: string | null | undefined): void {
  if (!storage || !userId) return;
  if (readTodoRows(storage, userId) === 0) writeTodoRows(storage, userId, 1);
}
