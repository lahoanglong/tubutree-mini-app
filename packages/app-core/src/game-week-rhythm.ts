/**
 * Dải "Nhịp Sống Xanh 7 Ngày" ở đầu Vườn Xanh (Mini App và web dùng chung): tuần theo giờ VN (Thứ 2 đến Chủ nhật), mỗi ngày một dấu
 * "đã chăm vườn" (tưới, điểm danh, hứng sương hay chơi mini game). Không gọi API riêng: nhận dữ liệu hồ sơ Vườn, lịch điểm danh và trạng thái
 * mini game mà trang đã tải, cộng các ngày đã ghi trên máy (ngày chỉ chơi mini game không nằm trong chuỗi điểm danh của máy chủ).
 */

export type RhythmCellState = 'done' | 'today-open' | 'missed' | 'upcoming';

export interface RhythmCell {
  /** Ngày dạng `YYYY-MM-DD` theo giờ VN. */
  key: string;
  /** Nhãn ngắn trong ô: T2…T7, CN. */
  label: string;
  state: RhythmCellState;
  today: boolean;
  /** Câu đọc cho trình đọc màn hình: tên thứ + trạng thái. */
  aria: string;
}

export interface WeekRhythmInput {
  now: Date;
  /** Chuỗi điểm danh của máy chủ (ngày liên tiếp kết thúc ở ngày điểm danh gần nhất). */
  streakDays: number | undefined;
  /** Thời điểm điểm danh gần nhất (ISO); quá hôm qua thì chuỗi không còn phủ ngày nào của tuần này. */
  lastCheckInAt: string | null | undefined;
  /** Hôm nay đã tưới, điểm danh, hứng sương hay chơi mini game. */
  todayDone: boolean;
  /** Các ngày đã ghi trên máy (xem `mergeLocalRhythmDays`). */
  localDays: readonly string[];
}

export const weekRhythmCopy = {
  title: 'Nhịp Sống Xanh 7 Ngày',
  count: (done: number) => `${done}/7`,
  /** Nhãn trong ô, đầu tuần là Thứ 2. */
  labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
  names: ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'],
  state: {
    done: 'đã chăm vườn',
    todayOpen: 'hôm nay chưa chăm vườn',
    missed: 'chưa chăm vườn',
    upcoming: 'chưa tới',
  },
  /** Mô tả cả dải cho trình đọc màn hình. */
  listLabel: (done: number) => `Nhịp Sống Xanh 7 Ngày, đã chăm vườn ${done} trên 7 ngày`,
} as const;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
/** Chỉ giữ ngày của 14 ngày gần nhất: đủ phủ tuần này và tuần trước, bộ nhớ không phình. */
export const RHYTHM_KEEP_DAYS = 14;
export const RHYTHM_STORAGE_KEY = 'tubu.week-rhythm.v1';

/** Khoá ngày theo giờ VN (UTC+7) bằng số học UTC: không phụ thuộc múi giờ của máy. */
export const vnDayKey = (d: Date): string => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

const keyMs = (key: string): number => Date.parse(`${key}T00:00:00Z`);
const shiftDay = (key: string, days: number): string => new Date(keyMs(key) + days * DAY_MS).toISOString().slice(0, 10);
/** 0 = Thứ 2 … 6 = Chủ nhật. */
const weekdayIndex = (key: string): number => (new Date(keyMs(key)).getUTCDay() + 6) % 7;
const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(keyMs(v));

/** Đọc danh sách ngày đã ghi: giá trị hỏng hay sai kiểu cho mảng rỗng, không bao giờ ném. */
export function parseLocalRhythmDays(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDayKey) : [];
  } catch {
    return [];
  }
}

/**
 * Danh sách ngày sau khi ghi thêm hôm nay (nếu đã chăm vườn): bỏ trùng, bỏ ngày quá cũ hoặc ở tương lai (đồng hồ máy lệch), sắp tăng dần.
 * Trả về cùng nội dung `existing` khi không có gì đổi để nơi gọi bỏ qua việc ghi.
 */
export function mergeLocalRhythmDays(existing: readonly string[], now: Date, todayDone: boolean): string[] {
  const today = vnDayKey(now);
  const oldest = shiftDay(today, -(RHYTHM_KEEP_DAYS - 1));
  const kept = new Set(existing.filter((k) => k >= oldest && k <= today));
  if (todayDone) kept.add(today);
  return [...kept].sort();
}

export function weekRhythm(input: WeekRhythmInput): { cells: RhythmCell[]; doneCount: number } {
  const { now, streakDays, lastCheckInAt, todayDone, localDays } = input;
  const today = vnDayKey(now);
  const monday = shiftDay(today, -weekdayIndex(today));

  // Chuỗi phủ các ngày liên tiếp kết thúc ở ngày điểm danh gần nhất, chỉ khi ngày đó là hôm nay hoặc hôm qua (chuỗi còn sống).
  const covered = new Set<string>();
  const lastKey = lastCheckInAt ? vnDayKey(new Date(lastCheckInAt)) : null;
  if (lastKey && lastKey <= today && lastKey >= shiftDay(today, -1) && streakDays && streakDays > 0) {
    for (let i = 0; i < Math.min(streakDays, 7); i++) covered.add(shiftDay(lastKey, -i));
  }
  for (const k of localDays) covered.add(k);

  const cells: RhythmCell[] = Array.from({ length: 7 }, (_, i) => {
    const key = shiftDay(monday, i);
    const isToday = key === today;
    const state: RhythmCellState = isToday ? (todayDone ? 'done' : 'today-open') : key > today ? 'upcoming' : covered.has(key) ? 'done' : 'missed';
    const status = weekRhythmCopy.state[state === 'today-open' ? 'todayOpen' : state];
    const name = isToday && state === 'done' ? `Hôm nay (${weekRhythmCopy.names[i]})` : weekRhythmCopy.names[i];
    return { key, label: weekRhythmCopy.labels[i]!, state, today: isToday, aria: `${name}: ${status}` };
  });
  return { cells, doneCount: cells.filter((c) => c.state === 'done').length };
}
