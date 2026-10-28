import { WATER_STEP } from './game-newbie';

// Tách khỏi game-newbie.ts: Mini App nạp game-newbie vào gói đầu (qua i18n/vi.ts) nên hàm chỉ Vườn dùng phải ở file riêng.

export interface PrimaryWaterInput {
  totalSeeds: number;
  /** Cây đã đủ nước (hồ sơ cũ tưới vượt đích): nút chính là thu hoạch, không cần thêm giọt nào. */
  harvestReady?: boolean;
  checkedInToday: boolean;
  /** Điểm danh gộp chưa xong dù phần nước đã xong (Điểm Xanh còn thiếu): nút chính nhận nốt, vì Vườn không còn nút điểm danh thứ hai. */
  pointsPending?: boolean;
  dewToday: boolean;
  dailyLoginSeeds?: number;
  dewSeeds?: number;
  firstCheckinBonus?: number;
  /**
   * Giọt nước của lần điểm danh hôm nay do API tính (trạng thái điểm danh gộp `todayWater`: đã gồm thưởng mốc chuỗi, quà lần đầu, quà quay lại,
   * đã cắt theo chỗ trống của bình). Có thì dùng số này thay cho `dailyLoginSeeds` + quà lần đầu, để cùng một nguồn với Ưu đãi và toast.
   */
  checkInSeeds?: number;
  /** Sức chứa bình: biết thì "+N💧" của nút nhận nước bị cắt theo chỗ trống (cùng luật với server), bình đầy thì bỏ "+N". */
  tankCapacity?: number;
}

export type PrimaryWaterAction =
  | { kind: 'harvest' }
  /** Chưa nhận nước hôm nay. `first`: lần điểm danh đầu (chỉ điểm danh, sương để bước 3). `withDew`: gộp luôn hứng sương. */
  | { kind: 'claim'; first: boolean; withDew: boolean; gain: number | null; pointsOnly?: boolean }
  | { kind: 'water'; drops: number }
  | { kind: 'earn' };

/** Nút chính trên cây: nhận nước hôm nay, tưới hết, hoặc mở sheet "Kiếm nước". Không bao giờ dẫn tới lỗi thiếu nước. */
export function primaryWaterAction(p: PrimaryWaterInput): PrimaryWaterAction {
  const seeds = Math.max(0, Math.floor(Number.isFinite(p.totalSeeds) ? p.totalSeeds : 0));
  if (p.harvestReady) return { kind: 'harvest' };
  if (p.checkedInToday && p.pointsPending) return { kind: 'claim', first: false, withDew: false, gain: null, pointsOnly: true };
  if (!p.checkedInToday) {
    const bonus = p.firstCheckinBonus ?? 0;
    const first = bonus > 0;
    const withDew = !first && !p.dewToday;
    const base = p.checkInSeeds ?? (p.dailyLoginSeeds == null ? null : p.dailyLoginSeeds + (first ? bonus : 0));
    const raw = base == null || (withDew && p.dewSeeds == null) ? null : base + (withDew ? (p.dewSeeds ?? 0) : 0);
    const room = p.tankCapacity == null ? null : Math.max(0, p.tankCapacity - seeds);
    const gain = raw == null || room == null ? raw : room === 0 ? null : Math.min(raw, room);
    return { kind: 'claim', first, withDew, gain };
  }
  if (seeds >= WATER_STEP) return { kind: 'water', drops: seeds };
  return { kind: 'earn' };
}
