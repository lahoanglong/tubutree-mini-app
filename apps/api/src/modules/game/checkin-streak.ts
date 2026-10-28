import { vnDateKey } from '../../common/vn-time';
import type { SystemConfigService } from '../system-config/system-config.service';
import {
  COMEBACK_GAP_DAYS_DEFAULT,
  COMEBACK_SEEDS_DEFAULT,
  DAILY_LOGIN_SEEDS_DEFAULT,
  FIRST_CHECKIN_BONUS_DEFAULT,
  configInt,
  streak7Seeds,
} from './game.constants';

const DAY = 864e5;

export interface CheckInStreakInput {
  lastCheckInAt: Date | null;
  streakDays: number;
  streakFreezes: number;
}

export interface CheckInProjection {
  /** Đã điểm danh giờ VN hôm nay. */
  doneToday: boolean;
  /** Số ngày từ lần điểm danh trước tới hôm nay; null = chưa từng. */
  gapDays: number | null;
  /** Chuỗi của lần điểm danh hôm nay: đã nhận thì là chuỗi hiện có, chưa thì là chuỗi sẽ có sau khi bấm. */
  streakDays: number;
  /** Lần điểm danh kế tiếp phải tiêu một vé giữ lửa để không đứt chuỗi. */
  usesFreeze: boolean;
  /** Chuỗi còn sống để hiển thị: hôm nay đã xong thì chuỗi hôm nay; chưa thì chuỗi tới hôm qua (đứt = 0). */
  aliveStreak: number;
}

/** Ngày 1..7 của một chuỗi: chuỗi 7 là ngày 7, chuỗi 8 quay về ngày 1. */
export function streakCycleDay(streakDays: number): number {
  return ((Math.max(1, streakDays) - 1) % 7) + 1;
}

/**
 * MỘT chuỗi điểm danh cho Điểm Xanh và giọt nước: chuỗi nằm ở hồ sơ Vườn (lastCheckInAt/streakDays/streakFreezes), luật lỡ
 * ngày và vé giữ lửa là của chuỗi nước. Điểm Xanh chỉ đọc ngày của chuỗi này, không giữ chuỗi riêng.
 */
export function projectCheckIn(p: CheckInStreakInput | null, today: string = vnDateKey()): CheckInProjection {
  if (!p || !p.lastCheckInAt) return { doneToday: false, gapDays: null, streakDays: 1, usesFreeze: false, aliveStreak: 0 };
  const lastKey = vnDateKey(p.lastCheckInAt);
  if (lastKey === today) {
    return { doneToday: true, gapDays: 0, streakDays: Math.max(1, p.streakDays), usesFreeze: false, aliveStreak: p.streakDays };
  }
  // Đếm ngày bằng khoá YYYY-MM-DD giờ VN để không lệch theo múi giờ máy chủ.
  const gapDays = Math.round((Date.parse(today) - Date.parse(lastKey)) / DAY);
  if (gapDays === 1) return { doneToday: false, gapDays, streakDays: p.streakDays + 1, usesFreeze: false, aliveStreak: p.streakDays };
  if (gapDays === 2 && p.streakFreezes > 0) {
    return { doneToday: false, gapDays, streakDays: p.streakDays + 1, usesFreeze: true, aliveStreak: p.streakDays };
  }
  return { doneToday: false, gapDays, streakDays: 1, usesFreeze: false, aliveStreak: 0 };
}

export interface CheckInSeedPlan {
  /** Tổng giọt nước vào bình (đã gồm mọi khoản thưởng). */
  seeds: number;
  notes: string[];
  /** Các khoản đã nằm trong `seeds`: màn hình ghi "gồm", không cộng dồn lần hai. */
  bonuses: Array<{ seeds: number; label: string }>;
}

/** Giọt nước của một lần điểm danh theo luật chuỗi: gốc + mốc chuỗi 3/7 ngày + quà lần đầu hoặc quà quay lại. */
export async function planCheckInSeeds(
  config: Pick<SystemConfigService, 'get'>,
  input: { first: boolean; gapDays: number | null; streakDays: number },
): Promise<CheckInSeedPlan> {
  let seeds = await configInt(config, 'game.daily_login_seeds', DAILY_LOGIN_SEEDS_DEFAULT);
  const notes: string[] = [];
  const bonuses: Array<{ seeds: number; label: string }> = [];
  if (input.streakDays % 7 === 0) {
    const bonus = await streak7Seeds(config);
    seeds += bonus;
    notes.push(`+${bonus} 💧 chuỗi 7 ngày!`);
    bonuses.push({ seeds: bonus, label: 'chuỗi 7 ngày' });
  } else if (input.streakDays % 3 === 0) {
    seeds += 5;
    notes.push('+5 💧 chuỗi 3 ngày!');
    bonuses.push({ seeds: 5, label: 'chuỗi 3 ngày' });
  }
  if (input.first) {
    const first = await configInt(config, 'game.first_checkin_bonus', FIRST_CHECKIN_BONUS_DEFAULT);
    if (first > 0) {
      seeds += first;
      notes.push(`+${first} 💧 quà điểm danh đầu tiên!`);
      bonuses.push({ seeds: first, label: 'quà điểm danh đầu tiên' });
    }
  } else if (input.gapDays !== null) {
    const gapNeeded = await configInt(config, 'game.comeback_gap_days', COMEBACK_GAP_DAYS_DEFAULT);
    const comeback = await configInt(config, 'game.comeback_seeds', COMEBACK_SEEDS_DEFAULT);
    if (input.gapDays >= gapNeeded && comeback > 0) {
      seeds += comeback;
      notes.unshift(`Chào mừng bạn quay lại! +${comeback} 💧`);
      bonuses.unshift({ seeds: comeback, label: 'quà quay lại' });
    }
  }
  return { seeds, notes, bonuses };
}
