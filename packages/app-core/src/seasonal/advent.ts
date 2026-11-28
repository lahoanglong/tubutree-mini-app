/**
 * Lịch quà 12 ngày Noel Xanh (`AdventGreenStrip` trên thẻ cây thông ở Trang chủ): 12 ô từ 14/12 tới Giáng sinh 25/12, ngày tính theo giờ Việt Nam (UTC+7)
 * dù máy khách ở múi giờ nào. Ô hôm nay mở quà bằng đúng lượt điểm danh ngày (`POST /me/daily-check-in`, một lần mỗi ngày); ô đã nhận đọc từ
 * `checkInDays` của `GET /me/daily-check-in`. Tháng 1 vẫn thuộc mùa năm trước (lịch đã qua hết), để admin tắt giao diện muộn vài ngày cũng không hiện lịch năm sau.
 */
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export const ADVENT_DAYS = 12;
/** Ô cuối là ngày Giáng sinh; ô đầu là `ADVENT_LAST_DAY - ADVENT_DAYS + 1` (14/12). */
export const ADVENT_LAST_DAY = 25;

/** Ngày giờ VN 'YYYY-MM-DD' của một mốc ms. */
export function vnDayKeyOf(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 giờ VN của một ngày 'YYYY-MM-DD', tính bằng ms. */
export function vnDayStartMs(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00+07:00`);
}

/** Còn bao lâu tới 00:00 giờ VN kế tiếp (lúc quà ngày mới mở). Luôn trong (0, 1 ngày]. */
export function msUntilNextVnDay(nowMs: number): number {
  const todayStart = Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  return todayStart + DAY_MS - nowMs;
}

export function adventYear(todayKey: string): number {
  const y = Number(todayKey.slice(0, 4));
  return Number(todayKey.slice(5, 7)) === 1 ? y - 1 : y;
}

export function adventDayKeys(year: number): string[] {
  const first = ADVENT_LAST_DAY - ADVENT_DAYS + 1;
  return Array.from({ length: ADVENT_DAYS }, (_, i) => `${year}-12-${String(first + i).padStart(2, '0')}`);
}

/** `claimed`: đã mở quà ngày đó; `missed`: ngày đã qua mà chưa mở; `open`: hôm nay, chưa mở; `locked`: chưa tới ngày. */
export type AdventTileState = 'claimed' | 'missed' | 'open' | 'locked';

export interface AdventTile {
  /** 1..12 */
  day: number;
  dateKey: string;
  /** "14/12" */
  dateLabel: string;
  state: AdventTileState;
  isToday: boolean;
  /** Ô khoá gần nhất: ô hiện đồng hồ đếm tới lúc mở. */
  isNext: boolean;
}

export interface AdventView {
  tiles: AdventTile[];
  /** `before`: chưa tới ô đầu; `during`: hôm nay là một ô; `after`: đã qua ô cuối. */
  phase: 'before' | 'during' | 'after';
  claimed: number;
  /** Vị trí ô hôm nay, -1 khi không trong lịch. */
  todayIndex: number;
  /** Vị trí ô khoá gần nhất, -1 khi không còn ô khoá. */
  nextIndex: number;
  /** Số ngày tới ô đầu (chỉ > 0 khi `before`). */
  daysUntilStart: number;
  /** ms tới lúc ô khoá gần nhất mở (00:00 giờ VN của ngày đó); 0 khi không còn ô khoá. */
  msToNextUnlock: number;
}

export function adventView(o: { nowMs: number; checkInDays?: readonly string[] | null; claimedToday?: boolean }): AdventView {
  const todayKey = vnDayKeyOf(o.nowMs);
  const keys = adventDayKeys(adventYear(todayKey));
  const done = new Set(o.checkInDays ?? []);
  // Ô hôm nay theo `claimedToday` (đủ cả Điểm Xanh lẫn giọt nước) khi có: `checkInDays` chỉ ghi phần Điểm Xanh, nhận thiếu một phần thì thẻ cây
  // vẫn mời mở quà nên ô hôm nay cũng phải còn mở.
  if (o.claimedToday !== undefined) {
    if (o.claimedToday) done.add(todayKey);
    else done.delete(todayKey);
  }
  let nextIndex = -1;
  const tiles = keys.map((dateKey, i): AdventTile => {
    const isToday = dateKey === todayKey;
    const state: AdventTileState =
      dateKey < todayKey ? (done.has(dateKey) ? 'claimed' : 'missed') : isToday ? (done.has(dateKey) ? 'claimed' : 'open') : 'locked';
    if (state === 'locked' && nextIndex < 0) nextIndex = i;
    return { day: i + 1, dateKey, dateLabel: `${Number(dateKey.slice(8, 10))}/${Number(dateKey.slice(5, 7))}`, state, isToday, isNext: false };
  });
  if (nextIndex >= 0) tiles[nextIndex] = { ...tiles[nextIndex]!, isNext: true };
  const todayIndex = keys.indexOf(todayKey);
  const phase = todayKey < keys[0]! ? 'before' : todayKey > keys[keys.length - 1]! ? 'after' : 'during';
  return {
    tiles,
    phase,
    claimed: tiles.filter((t) => t.state === 'claimed').length,
    todayIndex,
    nextIndex,
    daysUntilStart: phase === 'before' ? Math.round((Date.parse(`${keys[0]}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS) : 0,
    msToNextUnlock: nextIndex >= 0 ? Math.max(0, vnDayStartMs(keys[nextIndex]!) - o.nowMs) : 0,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Đồng hồ trên ô khoá gần nhất: "05:12" (giờ:phút, làm tròn phút LÊN để chưa mở thì không hiện 00:00). Từ 1 ngày trở lên không vừa ô 44px nên trả
 * rỗng: ô chỉ có ổ khoá, số ngày còn lại nằm ở dòng phụ của thẻ.
 */
export function adventTileClock(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000);
  if (!(ms > 0) || totalMin >= 24 * 60) return '';
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}
