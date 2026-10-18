/**
 * Dữ liệu Vườn Xanh mà cả `seed.ts` (dev) lẫn `seed-reference.ts` (prod) dùng chung, để hai nơi không lệch nhau.
 */

/** Mốc cộng đồng góp quỹ trồng cây đang mở. */
export const COMMUNITY_GOAL_SEED = {
  id: 'cg-cangio-2026',
  title: 'Cùng Tubu góp quỹ trồng cây',
  region: 'Cộng đồng Tubu',
  targetDrops: 100000,
  currentDrops: 0,
  treesToPlant: 200,
  status: 'ACTIVE',
} as const;

/** Mùa hè 2026. Đã hết hạn: `seed-reference.ts` chỉ nạp mùa còn hạn nên bỏ qua dòng này. */
export const SEASON_SEED = {
  id: 'se-2026-he-cangio',
  name: 'Mùa Hè Xanh — Phủ xanh Cần Giờ',
  theme: 'Rừng ngập mặn miền Nam',
  region: 'Cần Giờ, TP.HCM',
  featuredSpeciesIds: ['sp-duoc', 'sp-tram', 'sp-sao'],
  startAt: new Date('2026-06-01T00:00:00+07:00'),
  endAt: new Date('2026-08-31T23:59:59+07:00'),
};
