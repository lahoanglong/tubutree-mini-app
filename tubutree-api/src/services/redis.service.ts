/**
 * Redis Service - Bộ nhớ đệm (Cache)
 *
 * Dùng Redis để lưu tạm dữ liệu (sản phẩm, danh mục...)
 * giúp tải trang nhanh hơn, giảm gọi API Pancake POS.
 *
 * 3 thao tác chính:
 * - getCache(key)         → Lấy dữ liệu từ cache
 * - setCache(key, data)   → Lưu dữ liệu vào cache
 * - deleteCache(key)      → Xóa dữ liệu khỏi cache
 */
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.log('Lỗi Redis:', err));

// Tự động kết nối khi cần
let isConnected = false;
async function ensureConnected() {
  if (!isConnected) {
    await redisClient.connect();
    isConnected = true;
    console.log('✅ Đã kết nối Redis');
  }
}

// Lấy dữ liệu từ cache
export const getCache = async (key: string): Promise<any | null> => {
  try {
    await ensureConnected();
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null; // Cache lỗi → bỏ qua, lấy từ nguồn gốc
  }
};

// Lưu dữ liệu vào cache (mặc định 5 phút)
export const setCache = async (key: string, value: any, ttlSeconds = 300) => {
  try {
    await ensureConnected();
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Cache lỗi → bỏ qua
  }
};

// Xóa 1 key khỏi cache
export const deleteCache = async (key: string) => {
  try {
    await ensureConnected();
    await redisClient.del(key);
  } catch {
    // Cache lỗi → bỏ qua
  }
};

export default redisClient;
