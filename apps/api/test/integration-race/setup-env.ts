/**
 * Chốt an toàn: race test ghi dữ liệu thật — CHỈ được chạy trên DB throwaway `tubutree_it`.
 * Thiếu biến / trỏ DB khác (vd `tubutree` dev) → dừng ngay trước khi PrismaClient kịp kết nối.
 */
const url = process.env.DATABASE_URL ?? '';
if (!/\/tubutree_it(\?|$)/.test(url)) {
  throw new Error(
    `integration-race: DATABASE_URL phải trỏ tới DB throwaway "tubutree_it" (hiện: "${url.replace(/\/\/[^@]*@/, '//***@')}").`,
  );
}
