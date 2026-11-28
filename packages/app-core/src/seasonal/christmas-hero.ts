import type { CheckInStatusResponse } from '../api/loyalty';
import { checkInTodayLine } from '../daily-check-in-today-line';
import { christmasCopy as c } from './christmas-copy';
import type { HintStorage } from './seasonal-theme';

/**
 * Thẻ "Cây Thông Tubu Tree Rung Quà" (`ChristmasHomeHero`, Mini App và web): chạm cây hay nút → cây rung → hộp quà rơi → "Mở quà".
 * Quà là lượt điểm danh ngày có sẵn (`POST /me/daily-check-in`: Điểm Xanh theo bảng 7 ngày + giọt nước Vườn Xanh), nên trần thưởng, chống trùng
 * ngày (unique DB) và trần ngày giữ nguyên của điểm danh. Thẻ chỉ gọi khi máy chủ chưa báo đã nhận hôm nay, mỗi lần rơi hộp tối đa một lần;
 * khách chưa đăng nhập mở hộp thấy lời chúc và một nút đăng nhập, không gọi API.
 */
export type GiftPhase = 'idle' | 'shaking' | 'dropped' | 'opening' | 'opened';

/** Thời gian cây rung trước khi hộp rơi; CSS `.tubu-xmas-tree.is-shaking` dùng cùng số (seasonal-christmas.css). */
export const SHAKE_MS = 700;

export type HeroStatus = Pick<CheckInStatusResponse, 'checkedInToday' | 'todayPoints' | 'todayWater' | 'tankFull' | 'pointsDone' | 'waterDone' | 'pointsBlocked'>;

export interface HeroInput {
  authed: boolean;
  status: HeroStatus | null | undefined;
  statusFailed: boolean;
  phase: GiftPhase;
  /** Dòng phần thưởng chụp lúc bấm "Mở quà" (`giftPreview`): sau khi nhận, máy chủ trả 0 cho phần đã xong nên không đọc lại được. */
  gift: string | null;
  /** Dòng phụ của lịch quà khi chưa tới ô đầu ("Lịch quà 12 ngày mở từ 14/12 · còn 16 ngày"). */
  advent: string | null;
}

export interface HeroCta {
  label: string;
  action: 'shake' | 'open' | 'login';
  busy: boolean;
}

export interface HeroView {
  claimedToday: boolean;
  cta: HeroCta | null;
  title: string;
  line: string;
  gift: 'none' | 'closed' | 'open';
  /** Dòng "Quà mới sau 05:12:09" dưới chữ. */
  nextClock: boolean;
}

export function claimedTodayOf(authed: boolean, status: Pick<CheckInStatusResponse, 'checkedInToday'> | null | undefined): boolean {
  return authed && status?.checkedInToday === true;
}

/** Bấm "Mở quà" có gọi điểm danh không: chỉ khách đã đăng nhập mà máy chủ chưa báo đã nhận hôm nay (trạng thái lỗi tải: cứ gọi, máy chủ tự chặn trùng ngày). */
export function shouldClaim(i: Pick<HeroInput, 'authed' | 'status' | 'phase'>): boolean {
  return i.authed && i.phase === 'dropped' && !claimedTodayOf(i.authed, i.status);
}

/** Phần thưởng sẽ nhận, đọc từ trạng thái điểm danh lúc mở hộp ("Nhận +1.000 Điểm Xanh · +10 giọt nước"). */
export function giftPreview(status: HeroStatus | null | undefined): string | null {
  return status ? checkInTodayLine(status, { short: true }) : null;
}

/**
 * Lượt mở đang chạy đã xong chưa và đi đâu: máy chủ báo đã nhận hôm nay → `opened`; lời gọi xong mà chưa nhận (lỗi, thiếu một phần) → quay về hộp
 * đóng để khách bấm lại (máy chủ chỉ bù phần thiếu). Còn chạy → null.
 */
export function settleOpening(o: { pending: boolean; claimedToday: boolean; failed?: boolean }): GiftPhase | null {
  if (o.claimedToday && !o.failed) return 'opened';
  if (o.pending) return null;
  return 'dropped';
}

export function christmasHeroView(i: HeroInput): HeroView {
  const claimedToday = claimedTodayOf(i.authed, i.status);
  switch (i.phase) {
    case 'shaking':
      return { claimedToday, cta: { label: c.shaking, action: 'shake', busy: true }, title: c.title, line: c.subtitle, gift: 'none', nextClock: false };
    case 'dropped':
      return { claimedToday, cta: { label: c.open, action: 'open', busy: false }, title: c.title, line: (i.authed && (i.gift ?? giftPreview(i.status))) || c.subtitle, gift: 'closed', nextClock: false };
    case 'opening':
      return { claimedToday, cta: { label: c.opening, action: 'open', busy: true }, title: c.title, line: (i.authed && i.gift) || c.subtitle, gift: 'closed', nextClock: false };
    case 'opened':
      return i.authed
        ? { claimedToday, cta: null, title: c.opened, line: i.gift ?? c.doneToday, gift: 'open', nextClock: true }
        : { claimedToday, cta: { label: c.login, action: 'login', busy: false }, title: c.guestWish, line: c.guestLead, gift: 'open', nextClock: false };
    default:
      if (claimedToday) return { claimedToday, cta: null, title: c.title, line: c.doneToday, gift: 'open', nextClock: true };
      return {
        claimedToday,
        cta: { label: c.shake, action: 'shake', busy: false },
        title: c.title,
        line: i.authed && i.statusFailed ? c.loadFailed : (i.advent ?? c.subtitle),
        gift: 'none',
        nextClock: false,
      };
  }
}

/** Dòng phụ của thẻ khi lịch quà chưa tới ô đầu. */
export function adventLeadLine(o: { phase: 'before' | 'during' | 'after'; daysUntilStart: number; firstLabel: string }): string | null {
  return o.phase === 'before' ? `${c.adventTitle} mở từ ${o.firstLabel} · ${c.adventStartsIn(o.daysUntilStart)}` : null;
}

/**
 * Nút ❄️ trên thẻ cây thông: khách tắt tuyết thì nhớ trên máy này, mọi lần mở sau không rơi tuyết. Nằm ở đây (không ở seasonal-theme.ts) vì chỉ chunk Noel
 * dùng: seasonal-theme.ts nằm trong chunk khối dưới màn đầu của Mini App, chunk Noel import tĩnh từ đó thì rào mini-lazy-chunks.cjs đỏ.
 */
export const SNOW_OFF_KEY = 'tubu_snow_off';

export function readSnowOff(storage: HintStorage | null): boolean {
  try {
    return storage?.getItem(SNOW_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSnowOff(storage: HintStorage | null, off: boolean): void {
  try {
    storage?.setItem(SNOW_OFF_KEY, off ? '1' : '0');
  } catch {
    /* không nhớ được: lựa chọn chỉ giữ trong lần mở này */
  }
}
