import { mergeTier } from '@tubutree/shared-types';

const TIER_NAMES = ['Bông tuyết', 'Lá thông', 'Quả châu', 'Chuông vàng', 'Nguyệt quế', 'Người tuyết', 'Tuần lộc', 'Thông Tubu'] as const;

/**
 * Tên bậc Noel của một giá trị ô Ghép Mầm Xanh: 2 Bông tuyết … 256 trở lên Thông Tubu. Tách khỏi `xmas-arcade.ts` (hình ô, nạp lười cùng CSS mùa) để
 * màn kết quả dùng được mà không kéo chunk áo Noel vào chunk kết quả.
 */
export function xmasTierName(value: number): string {
  return TIER_NAMES[Math.min(8, Math.max(1, mergeTier(value))) - 1]!;
}
