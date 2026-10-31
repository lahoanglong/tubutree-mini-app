/**
 * Xoay thứ tự "Gợi ý hôm nay" theo ngày VN (`YYYYMMDD`, app-core `vnDateSeed`): cùng ngày cùng thứ tự để cuộn và mở lại không làm lưới xáo trộn,
 * sang ngày khác đổi. Thuần hàm, không đọc đồng hồ: máy chủ không tự quyết ngày nên hai nền tảng giống nhau.
 */
export const SEED_PATTERN = /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Ngày VN `YYYYMMDD` của một mốc thời gian, cùng công thức với app-core `vnDateSeed` (API không import được app-core).
 * Khối gộp `/home/me` dựng gợi ý với seed này để lần tải đầu trùng đúng bộ món mà các request lẻ có `seed` trả về trong ngày.
 */
export function vnDateSeed(now: number): string {
  const d = new Date(now + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** FNV-1a trên `seed:id` rồi trộn thêm cho các id gần nhau không ra số gần nhau; 32-bit không dấu. */
export function seedHash(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const text = `${seed}:${id}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Xếp theo `seedHash` tăng dần (hoà thì id), rồi xen: không để 3 món liền nhau cùng nhãn nếu còn món nhãn khác ở phía sau
 * (ia-merch D2: danh sách dài một nhãn trông như đang xem catalog của một nhãn). Hết món nhãn khác thì đành xếp tiếp.
 */
export function seededOrder<T extends { id: string; brandId: string | null }>(rows: readonly T[], seed: string): T[] {
  const pool = [...rows].sort((a, b) => seedHash(seed, a.id) - seedHash(seed, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: T[] = [];
  while (pool.length > 0) {
    const [x, y] = [out[out.length - 2], out[out.length - 1]];
    const blocked = x && y && y.brandId !== null && x.brandId === y.brandId ? y.brandId : null;
    const swap = blocked === null ? -1 : pool.findIndex((r) => r.brandId !== blocked);
    out.push(pool.splice(swap > 0 ? swap : 0, 1)[0]!);
  }
  return out;
}
