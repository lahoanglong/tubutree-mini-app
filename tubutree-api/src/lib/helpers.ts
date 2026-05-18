/**
 * Helper Functions - Các hàm tiện ích dùng chung
 *
 * Tập trung các logic lặp đi lặp lại để code gọn hơn.
 */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';

// ============================================================
// LẤY USER ID - Lấy userId từ request đã xác thực
// ============================================================
export function getUserId(req: AuthRequest): number {
  return req.user!.userId;
}

// ============================================================
// XỬ LÝ LỖI - Trả lỗi 500 với format thống nhất
// ============================================================
export function handleError(res: Response, message: string, error: any) {
  console.error(message, error.message || error);
  res.status(500).json({ error: message });
}

// ============================================================
// PARSE PARAMS - Chuyển string thành số nguyên an toàn
// ============================================================
export function toInt(value: string): number {
  return parseInt(value, 10);
}

// ============================================================
// PAGINATION - Lấy thông tin phân trang từ query string
// ============================================================
export function getPagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 20;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
