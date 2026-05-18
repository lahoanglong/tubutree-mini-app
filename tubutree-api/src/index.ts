/**
 * ========================================
 * TUBU TREE API - Điểm khởi đầu ứng dụng
 * ========================================
 *
 * Đây là file chính, nơi server Express được cấu hình và khởi chạy.
 *
 * Cấu trúc dự án:
 * ├── src/
 * │   ├── index.ts              ← BẠN ĐANG Ở ĐÂY
 * │   ├── lib/                  ← Các module dùng chung (prisma, helpers)
 * │   ├── middlewares/          ← Xử lý trước khi vào controller (xác thực JWT)
 * │   ├── controllers/          ← Logic xử lý cho mỗi API
 * │   ├── services/             ← Giao tiếp với bên ngoài (Zalo, Pancake, Redis)
 * │   └── routes/               ← Định nghĩa URL cho mỗi API
 * └── prisma/
 *     └── schema.prisma         ← Cấu trúc database
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import prisma from './lib/prisma';
import apiRoutes from './routes';

// Đọc file .env để lấy cấu hình
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// ========== MIDDLEWARE (xử lý trước mỗi request) ==========
app.use(helmet());        // Bảo mật HTTP headers
app.use(cors());          // Cho phép gọi API từ domain khác
app.use(express.json());  // Parse JSON body
app.use(morgan('dev'));   // Log request ra console

// ========== ROUTES (các API) ==========
app.use('/api', apiRoutes);

// Trang chủ - kiểm tra server còn sống
app.get('/', (req, res) => {
  res.json({ message: 'Tubu Tree API đang chạy 🌳' });
});

// Health check - kiểm tra kết nối database
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ========== KHỞI CHẠY SERVER ==========
app.listen(port, () => {
  console.log(`🌳 Tubu Tree API đang chạy tại http://localhost:${port}`);
});
