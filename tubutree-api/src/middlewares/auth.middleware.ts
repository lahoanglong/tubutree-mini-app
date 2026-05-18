/**
 * Middleware Xác Thực (Authentication)
 *
 * Kiểm tra JWT token trong header "Authorization: Bearer <token>"
 * Nếu token hợp lệ → cho đi tiếp (next)
 * Nếu không → trả lỗi 401/403
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// Mở rộng Request để thêm thông tin user đã đăng nhập
export interface AuthRequest extends Request {
  user?: {
    userId: number;
    zaloUid: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Lấy token từ header: "Authorization: Bearer abc123..."
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Không có token → chưa đăng nhập
  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng cung cấp token.' });
  }

  // Kiểm tra token có hợp lệ không
  jwt.verify(token, JWT_SECRET, (err, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Token không hợp lệ hoặc đã hết hạn.' });
    }

    // Gắn thông tin user vào request để các controller dùng
    req.user = user;
    next();
  });
};
