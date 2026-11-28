import type { NoelWindowDays } from '@tubutree/shared-types';
import { VN_OFFSET_MS, vnDateKey } from '../../common/vn-time';

const DAY_MS = 86_400_000;

export const NOEL_WINDOW_OPTIONS: readonly NoelWindowDays[] = [1, 7, 14];
export const NOEL_DEFAULT_WINDOW: NoelWindowDays = 7;

/** Lịch quà Noel Xanh: trùng ADVENT_DAYS / ADVENT_LAST_DAY ở packages/app-core/src/seasonal/advent.ts (API không import app-core). */
export const ADVENT_DAYS = 12;
export const ADVENT_LAST_DAY = 25;

/** Sáu món trang trí cây thông, khớp ORNAMENTS ở packages/app-core/src/seasonal/xmas-tree.ts. */
export const NOEL_ORNAMENT_SLOTS = ['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath'] as const;

/** `?days=` chỉ nhận 1, 7 hoặc 14; giá trị lạ về mặc định 7 thay vì để khách tự chọn khoảng quét lớn. */
export function parseNoelDays(raw: unknown): NoelWindowDays {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : Number.NaN;
  return NOEL_WINDOW_OPTIONS.find((d) => d === n) ?? NOEL_DEFAULT_WINDOW;
}

/** Cộng/trừ ngày trên khoá 'YYYY-MM-DD' (lịch, không phụ thuộc múi giờ máy). */
export function shiftDayKey(dayKey: string, delta: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 00:00 giờ VN của một ngày 'YYYY-MM-DD', trả về thời điểm UTC tương ứng. */
export function vnDayStart(dayKey: string): Date {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) - VN_OFFSET_MS);
}

export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey; k = shiftDayKey(k, 1)) out.push(k);
  return out;
}

export interface NoelWindow {
  days: NoelWindowDays;
  todayKey: string;
  fromKey: string;
  toKey: string;
  dayKeys: string[];
  /** [since, until): từ 00:00 VN ngày đầu tới 00:00 VN ngày mai (hôm nay chưa đủ ngày). */
  since: Date;
  until: Date;
  /** Khoảng ngay trước đó cùng số ngày, để so thưởng kinh tế. */
  prevFromKey: string;
  prevToKey: string;
  prevSince: Date;
  prevUntil: Date;
  /**
   * Nhóm quay lại D+1: chỉ ngày đã có đủ ngày kế tiếp (tới hôm kia), `days` ngày cuối. Hoạt động đọc trong [cohortSince, cohortUntil)
   * với cohortUntil = 00:00 VN hôm nay, tức ngày kế tiếp của ngày cuối nhóm là hôm qua và đã đủ 24 giờ.
   */
  cohortFromKey: string;
  cohortToKey: string;
  cohortSince: Date;
  cohortUntil: Date;
}

export function noelWindow(now: Date, days: NoelWindowDays): NoelWindow {
  const todayKey = vnDateKey(now);
  const fromKey = shiftDayKey(todayKey, -(days - 1));
  const prevToKey = shiftDayKey(fromKey, -1);
  const prevFromKey = shiftDayKey(prevToKey, -(days - 1));
  const cohortToKey = shiftDayKey(todayKey, -2);
  const cohortFromKey = shiftDayKey(cohortToKey, -(days - 1));
  return {
    days,
    todayKey,
    fromKey,
    toKey: todayKey,
    dayKeys: dayKeysBetween(fromKey, todayKey),
    since: vnDayStart(fromKey),
    until: vnDayStart(shiftDayKey(todayKey, 1)),
    prevFromKey,
    prevToKey,
    prevSince: vnDayStart(prevFromKey),
    prevUntil: vnDayStart(fromKey),
    cohortFromKey,
    cohortToKey,
    cohortSince: vnDayStart(cohortFromKey),
    cohortUntil: vnDayStart(todayKey),
  };
}

export interface AdventSpan {
  year: number;
  phase: 'before' | 'during' | 'after';
  /** 12 khoá ngày 14/12..25/12. */
  keys: string[];
  /** Số ô đã tới ngày tính tới hôm nay (0..12). */
  daysElapsed: number;
}

/** Tháng 1 vẫn thuộc mùa năm trước, như `adventYear` của app-core: tắt giao diện muộn vài ngày không mở lịch năm sau. */
export function adventSpan(todayKey: string): AdventSpan {
  const y = Number(todayKey.slice(0, 4));
  const year = Number(todayKey.slice(5, 7)) === 1 ? y - 1 : y;
  const first = ADVENT_LAST_DAY - ADVENT_DAYS + 1;
  const keys = Array.from({ length: ADVENT_DAYS }, (_, i) => `${year}-12-${String(first + i).padStart(2, '0')}`);
  const daysElapsed = keys.filter((k) => k <= todayKey).length;
  const phase = todayKey < keys[0]! ? 'before' : todayKey > keys[ADVENT_DAYS - 1]! ? 'after' : 'during';
  return { year, phase, keys, daysElapsed };
}

/**
 * Số ô phải mở đủ mới tính hoàn thành. Lịch đang chạy thì chỉ tới hôm qua: ô hôm nay chưa hết ngày, nếu bắt mở đủ cả hôm nay thì tỉ lệ
 * rơi về 0 mỗi sáng sớm rồi leo dần trong ngày. Sau 25/12 là đủ 12 ô; trước 14/12 và đúng ngày 14/12 là 0 (chưa có ô nào trọn ngày).
 */
export function adventRequiredDays(span: Pick<AdventSpan, 'phase' | 'daysElapsed'>): number {
  return span.phase === 'after' ? ADVENT_DAYS : Math.max(0, span.daysElapsed - 1);
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function round1(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
}
