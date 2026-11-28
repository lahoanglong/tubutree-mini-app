import { WATER_STEP } from './game-newbie';
import { formatVnNumber } from './number-format';

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

export interface GardenDayActions {
  /** Nút "Tưới cây": thu hoạch khi cây đã đủ nước, tưới hết khi có từ 20💧, thiếu nước thì mở sheet "Kiếm nước". */
  water: Exclude<PrimaryWaterAction, { kind: 'claim' }>;
  /** Nút "Điểm danh": còn nhận được hôm nay (nước, hoặc nốt phần Điểm Xanh); null khi đã xong cả hai. */
  checkIn: Extract<PrimaryWaterAction, { kind: 'claim' }> | null;
}

/** Hai nút của Chăm vườn tách từ cùng luật `primaryWaterAction`: điểm danh không còn chặn nút tưới, thu hoạch không che nút điểm danh. */
export function gardenDayActions(p: PrimaryWaterInput): GardenDayActions {
  const claim = primaryWaterAction({ ...p, harvestReady: false });
  const rest = primaryWaterAction({ ...p, checkedInToday: true, pointsPending: false });
  return { water: rest.kind === 'claim' ? { kind: 'earn' } : rest, checkIn: claim.kind === 'claim' ? claim : null };
}

const drops = (v: number) => `${formatVnNumber(v)}💧`;

/** Chữ của hai nút Chăm vườn và viên chuỗi ngày; số giọt của lần điểm danh nằm ở viên chuỗi nên nhãn nút giữ ngắn. */
export const gardenDayCopy = {
  water: 'Tưới cây',
  harvest: 'Thu hoạch',
  checkIn: 'Điểm danh',
  checkInDone: 'Đã điểm danh',
  /** Chưa có chuỗi (khách mới, hoặc chuỗi vừa đứt) thì mời bắt đầu thay vì "Chuỗi 0 ngày". */
  streak: (days: number, gain: number | null) => {
    const head = days > 0 ? `🔥 Chuỗi ${formatVnNumber(days)} ngày` : '🔥 Bắt đầu chuỗi';
    return gain == null ? head : `${head} · +${drops(gain)}`;
  },
  rules: 'Luật chăm vườn',
} as const;
