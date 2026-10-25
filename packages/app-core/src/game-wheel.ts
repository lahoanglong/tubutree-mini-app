/**
 * Bánh xe Vòng quay may mắn: 8 ô cố định theo loại giải. API chỉ trả giải trúng (không gửi danh sách ô), nên ô dừng
 * được chọn theo loại giải; nhiều ô cùng loại thì chọn ngẫu nhiên trong các ô đó. Mini App và web dùng chung file này.
 */
export type WheelKind = 'SEEDS' | 'COUPON' | 'POINTS' | 'NONE';

export interface WheelSlot {
  kind: WheelKind;
  emoji: string;
  label: string;
}

export const WHEEL_SLOTS: readonly WheelSlot[] = [
  { kind: 'SEEDS', emoji: '💧', label: 'Giọt nước' },
  { kind: 'COUPON', emoji: '🎁', label: 'Mã giảm' },
  { kind: 'POINTS', emoji: '⭐', label: 'Điểm' },
  { kind: 'NONE', emoji: '🍀', label: 'Chúc may mắn' },
  { kind: 'SEEDS', emoji: '💧', label: 'Giọt nước' },
  { kind: 'COUPON', emoji: '🎁', label: 'Mã giảm' },
  { kind: 'POINTS', emoji: '⭐', label: 'Điểm' },
  { kind: 'NONE', emoji: '🍀', label: 'Chúc may mắn' },
];

export const WHEEL_SEG = 360 / WHEEL_SLOTS.length;

export interface WheelPrizeLike {
  rewardType: string;
  value: number;
  coupon?: unknown;
}

/** Loại ô tương ứng với giải; giải lạ hoặc không có giá trị rơi vào "Chúc may mắn" (khớp hộp kết quả). */
export function wheelKindOf(prize: WheelPrizeLike): WheelKind {
  if (prize.rewardType === 'COUPON' && prize.coupon) return 'COUPON';
  if (prize.rewardType === 'SEEDS' && prize.value > 0) return 'SEEDS';
  if (prize.rewardType === 'POINTS' && prize.value > 0) return 'POINTS';
  return 'NONE';
}

/** Chỉ số ô sẽ dừng cho giải trúng. `rand` trả số trong [0, 1). */
export function pickWheelSlot(prize: WheelPrizeLike, rand: () => number = Math.random): number {
  const kind = wheelKindOf(prize);
  const matches = WHEEL_SLOTS.flatMap((s, i) => (s.kind === kind ? [i] : []));
  const pool = matches.length > 0 ? matches : WHEEL_SLOTS.flatMap((s, i) => (s.kind === 'NONE' ? [i] : []));
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? 0;
}

/**
 * Góc quay (độ, luôn tăng) để kim ở đỉnh chỉ vào giữa ô `slot`, quay thêm tối thiểu `turns` vòng từ góc `current`.
 * `jitter` trong [-0.5, 0.5] lệch khỏi tâm ô tối đa 30% bề rộng ô, cho cảm giác tự nhiên mà vẫn nằm trong ô.
 */
export function wheelRotationFor(current: number, slot: number, turns = 5, jitter = 0): number {
  const center = slot * WHEEL_SEG + WHEEL_SEG / 2 + jitter * WHEEL_SEG * 0.6;
  const base = ((-center - current) % 360 + 360) % 360;
  return current + 360 * turns + base;
}

/** Ô đang nằm dưới kim khi bánh xe quay tới góc `rotation`. */
export function slotUnderPointer(rotation: number): number {
  const angle = (((360 - (rotation % 360)) % 360) + 360) % 360;
  return Math.floor(angle / WHEEL_SEG) % WHEEL_SLOTS.length;
}
