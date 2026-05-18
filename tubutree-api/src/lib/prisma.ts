/**
 * Prisma Client - Kết nối Database
 *
 * Tạo 1 instance duy nhất để dùng chung toàn bộ ứng dụng.
 * Tránh tạo nhiều kết nối không cần thiết.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
