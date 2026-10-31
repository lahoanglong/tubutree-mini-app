import { countdownClock, countdownSpoken, countdownText } from './countdown';

export interface CountdownFrame {
  /** Số ms còn lại, đã kẹp về ≥ 0. */
  ms: number;
  ended: boolean;
  clock: string;
  text: string;
  spoken: string;
  /** Số phút trọn còn lại: `aria-label` của đồng hồ chỉ đổi khi số này đổi, dù ô số nhảy từng giây. */
  minute: number;
}

/** Ảnh chụp đồng hồ tại `now`. `endMs` rác (NaN) coi như đã hết giờ để không bao giờ ra "NaN". */
export function countdownFrame(endMs: number, now: number): CountdownFrame {
  const raw = endMs - now;
  const ms = raw > 0 ? raw : 0;
  return {
    ms,
    ended: !(raw > 0),
    clock: countdownClock(ms),
    text: countdownText(ms),
    spoken: countdownSpoken(ms),
    minute: Math.floor(ms / 60_000),
  };
}

/**
 * Bao lâu nữa chữ đổi lần kế tiếp, để một `setTimeout` nối tiếp thay cho `setInterval` mỗi component.
 * clock: giây làm tròn LÊN nên đổi đúng lúc `ms` chạm bội của 1000; text: phút làm tròn XUỐNG nên đổi ngay sau khi `ms` rớt dưới
 * bội của 60000. Hết giờ hoặc số rác trả 1000 (không bao giờ 0, tránh vòng lặp timer).
 */
export function countdownDelay(ms: number, mode: 'clock' | 'text'): number {
  if (!(ms > 0)) return 1000;
  return mode === 'clock' ? Math.max(1, ms % 1000 || 1000) : (ms % 60_000) + 1;
}

/** Tách `countdownClock` thành chữ ngày (nếu có) và các ô số để vẽ ô tối: "2 ngày 03:15" → `{ prefix: '2 ngày', cells: ['03','15'] }`. */
export function countdownClockParts(ms: number): { prefix: string | null; cells: string[] } {
  const clock = countdownClock(ms);
  const day = /^(\d+ ngày) (.+)$/.exec(clock);
  return day ? { prefix: day[1]!, cells: day[2]!.split(':') } : { prefix: null, cells: clock.split(':') };
}
