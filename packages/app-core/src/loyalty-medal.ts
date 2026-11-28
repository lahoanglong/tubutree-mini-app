/**
 * Huy chương của 4 hạng thành viên (§6.6), vẽ SVG ở cả hai app thay emoji 56px của hệ điều hành (mỗi máy vẽ một kiểu).
 * Tra theo THỨ HẠNG chứ không theo tên: đổi tên hạng trong admin vẫn giữ hình và màu. Màu trỏ thẳng primitive v2 (thang sage → forest,
 * hạng cao nhất có viền mật ong): hạng phân biệt nhau theo độ "già" của xanh, không token semantic nào diễn đạt được.
 * `ink`/`bg` giữ đúng cặp màu chữ/nền của thẻ hạng trước đây (đã qua kiểm tương phản).
 */
export type TierMedalKind = 'sprout' | 'sapling' | 'tree' | 'crown';

export interface TierMedal {
  kind: TierMedalKind;
  /** Viền ngoài và hai dải ruy băng. */
  ring: string;
  /** Mặt huy chương. */
  face: string;
  /** Lá, thân. */
  leaf: string;
  /** Điểm nhấn: quả, ngôi sao. */
  accent: string;
  /** Màu chữ tên hạng trên nền `bg`. */
  ink: string;
  /** Nền thẻ hạng. */
  bg: string;
}

export const TIER_MEDALS: readonly TierMedal[] = [
  { kind: 'sprout', ring: 'var(--sage-600)', face: 'var(--stone-0)', leaf: 'var(--sage-700)', accent: 'var(--forest-300)', ink: 'var(--sage-700)', bg: 'var(--sage-50)' },
  { kind: 'sapling', ring: 'var(--forest-400)', face: 'var(--stone-0)', leaf: 'var(--forest-500)', accent: 'var(--forest-300)', ink: 'var(--sage-600)', bg: 'var(--sage-100)' },
  { kind: 'tree', ring: 'var(--forest-600)', face: 'var(--forest-50)', leaf: 'var(--forest-700)', accent: 'var(--honey-500)', ink: 'var(--forest-700)', bg: 'var(--forest-50)' },
  { kind: 'crown', ring: 'var(--honey-500)', face: 'var(--forest-800)', leaf: 'var(--forest-200)', accent: 'var(--honey-500)', ink: 'var(--forest-900)', bg: 'var(--clay-50)' },
];

/** Huy chương theo thứ hạng (0 = hạng đầu); ngoài khoảng thì kẹp về hạng gần nhất. */
export const tierMedalAt = (rank: number): TierMedal => TIER_MEDALS[Math.min(Math.max(Math.trunc(rank) || 0, 0), TIER_MEDALS.length - 1)]!;

export interface NextTierInput {
  name: string;
  /** Tiền mua hàng còn thiếu; null khi hạng xét theo điểm. */
  spendingToGo?: number | null;
  pointsToGo: number;
}

/**
 * Dòng tiến độ lên hạng kế, một ý một dòng: phần số (`amount`, in đậm) đứng giữa `before` và `after`.
 * Theo tiền: "Còn 2,5 triệu mua hàng để lên hạng Lộc Biếc". Theo điểm: "Còn 120 điểm (≈ 6.000đ mua hàng) để lên hạng Lộc Biếc";
 * chưa có tỉ lệ quy đổi thì "Còn 120 điểm tích từ mua hàng để lên hạng Lộc Biếc".
 */
export function tierNextLine(
  next: NextTierInput,
  fmt: { money: (n: number) => string; points: (n: number) => string; spendFor?: ((points: number) => number) | null },
): { before: string; amount: string; after: string } {
  const goal = ` để lên hạng ${next.name}`;
  if (next.spendingToGo != null) return { before: 'Còn ', amount: fmt.money(next.spendingToGo), after: ` mua hàng${goal}` };
  const amount = `${fmt.points(next.pointsToGo)} điểm`;
  if (fmt.spendFor && next.pointsToGo > 0) return { before: 'Còn ', amount, after: ` (≈ ${fmt.money(fmt.spendFor(next.pointsToGo))} mua hàng)${goal}` };
  return { before: 'Còn ', amount, after: ` tích từ mua hàng${goal}` };
}
