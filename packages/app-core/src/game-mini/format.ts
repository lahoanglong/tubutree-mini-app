import {
  MINI_GAME_RULES,
  MINI_REWARD,
  miniBaseReward,
  type MiniCapId,
  type MiniGameId,
  type MiniNoRewardReason,
  type MiniSubmitResponse,
  type MiniTodayGame,
  type MiniTodayResponse,
} from '@tubutree/shared-types';
import type { RoundFailure } from './api';
import { GAME_MINI_COPY, gameCopy, type GameMiniCopyKey } from './copy';

/** Game đã có giao diện, theo thứ tự hiện trong "Chơi hôm nay" (hai game thao tác mới đứng đầu). */
export const PLAYABLE_MINI_GAMES = ['daily_quiz', 'eco_merge', 'green_conveyor', 'sort', 'match', 'origin', 'basket', 'kitchen_swap'] as const satisfies readonly MiniGameId[];
export type PlayableMiniGame = (typeof PLAYABLE_MINI_GAMES)[number];

export function isPlayableMiniGame(v: unknown): v is PlayableMiniGame {
  return typeof v === 'string' && (PLAYABLE_MINI_GAMES as readonly string[]).includes(v);
}

/** Đường dẫn màn chơi theo nền tảng (cặp `/game/play/:game` ↔ `/vuon-xanh/choi/:game` của route-map). */
export const miniPlayPath = {
  miniapp: (game: PlayableMiniGame) => `/game/play/${game}`,
  web: (game: PlayableMiniGame) => `/vuon-xanh/choi/${game}`,
} as const;

/** Lời mời Đổi rác ở màn kết quả Đúng Thùng (cặp `/recycle/new` ↔ `/doi-rac/tao`). */
export const MINI_RECYCLE_PATH = { miniapp: '/recycle/new', web: '/doi-rac/tao' } as const;

/** Thẻ sản phẩm trong game dẫn sang trang chi tiết, kèm nguồn để đo sau (`entrySource=game:<game>`). */
export const miniProductPath = {
  miniapp: (slug: string, game: MiniGameId) => `/product/${encodeURIComponent(slug)}?entrySource=game:${game}`,
  web: (slug: string, game: MiniGameId) => `/san-pham/${encodeURIComponent(slug)}?entrySource=game:${game}`,
} as const;

/** "Chơi hôm nay": game đã có giao diện và máy chủ đang bật (đủ nội dung), theo thứ tự cố định. */
export function playableToday(today: MiniTodayResponse | undefined): Array<MiniTodayGame & { game: PlayableMiniGame }> {
  if (!today) return [];
  return PLAYABLE_MINI_GAMES.flatMap((g) => today.games.filter((x): x is MiniTodayGame & { game: PlayableMiniGame } => x.game === g));
}

/** `xmas`: tên mùa Noel nếu game có (`game.<mã>.xmasTitle`), không thì tên thường. */
export const miniGameTitle = (game: PlayableMiniGame, xmas = false) =>
  gameCopy(xmas && `game.${game}.xmasTitle` in GAME_MINI_COPY ? (`game.${game}.xmasTitle` as GameMiniCopyKey) : `game.${game}.title`);
export const miniGameDesc = (game: PlayableMiniGame) => gameCopy(`game.${game}.desc`);
export const miniGameRules = (game: PlayableMiniGame) => gameCopy(`game.${game}.rules`);

/** Dòng trạng thái của một game trong danh sách: chơi thử, còn lượt thưởng, hay đã nhận đủ. */
export function miniRowStatus(today: MiniTodayResponse, g: MiniTodayGame): { text: string; tone: 'brand' | 'secondary' } {
  if (!today.rewardEligible) return { text: gameCopy('row.trial'), tone: 'secondary' };
  if (today.caps.accountCapReached || g.rewardedRoundsLeft <= 0) return { text: gameCopy('row.full'), tone: 'secondary' };
  return { text: gameCopy('row.left', { n: g.rewardedRoundsLeft }), tone: 'brand' };
}

/** Số câu Đố Xanh còn được thưởng hôm nay, cho dòng "Làm câu đố (còn N câu)" của sheet Kiếm nước khi game mini thay khối đố vui cũ. */
export function miniEarnQuizLeft(today: MiniTodayResponse): number {
  const g = today.games.find((x) => x.game === 'daily_quiz');
  if (!g || !today.rewardEligible || today.caps.accountCapReached) return 0;
  return Math.max(0, g.rewardedRoundsLeft) * MINI_GAME_RULES.daily_quiz.items;
}

const reasonLine = (r: MiniNoRewardReason) => gameCopy(`reason.${r}`);

/**
 * Dòng thưởng ở màn mở đầu, nói trước khi khách bấm Bắt đầu: ván có tính thưởng không và vì sao (bảng 8.6). `rewarded=false` thì giao
 * diện gắn nhãn "Ván này không tính thưởng".
 */
export function miniIntroReward(today: MiniTodayResponse | undefined, game: MiniGameId): { rewarded: boolean; lines: string[] } {
  if (!today) return { rewarded: false, lines: [] };
  if (!today.rewardEligible) return { rewarded: false, lines: [reasonLine(today.noRewardReason ?? 'NOT_LOGGED_IN')] };
  const g = today.games.find((x) => x.game === game);
  if (!g || g.rewardedRoundsLeft <= 0) return { rewarded: false, lines: [reasonLine('NO_REWARDED_ROUNDS_LEFT')] };
  if (today.caps.accountCapReached) return { rewarded: false, lines: [gameCopy('cap.account')] };
  // Mức trần của chính game này theo công thức máy chủ (đúng hết số câu/món của ván), hạ theo phần 💧 tài khoản còn nhận được hôm nay.
  const best = miniBaseReward(g.items, g.items);
  const water = Math.min(best.water, Math.max(0, today.caps.waterCap - today.caps.waterUsed));
  const pointsOpen = !today.caps.pointsBudgetExhausted && today.caps.pointsUsed < today.caps.pointsCap;
  if (water <= 0 && !pointsOpen) return { rewarded: false, lines: [gameCopy('cap.account')] };
  const lines: string[] = [];
  if (water <= 0) lines.push(gameCopy('cap.accountWater'));
  else if (pointsOpen && game === 'eco_merge') lines.push(gameCopy('intro.rewardMerge', { water, points: best.points }));
  else if (pointsOpen) lines.push(gameCopy('intro.reward', { water, points: best.points, pct: Math.round(MINI_REWARD.pointsMinRatio * 100) }));
  else lines.push(gameCopy('intro.rewardWater', { water }));
  if (!pointsOpen) lines.push(gameCopy('cap.points'));
  return { rewarded: true, lines };
}

/** Câu nói thật về trần đã hạ thưởng của ván (bảng 8.6), mỗi trần một câu, trần tài khoản cả 💧 lẫn điểm gộp thành một câu. */
export function miniCapLines(capped: readonly MiniCapId[]): string[] {
  const has = (c: MiniCapId) => capped.includes(c);
  const lines: string[] = [];
  if (has('account_water') && has('account_points')) lines.push(gameCopy('cap.account'));
  else if (has('account_water')) lines.push(gameCopy('cap.accountWater'));
  else if (has('account_points')) lines.push(gameCopy('cap.accountPoints'));
  if (has('global') && !has('account_points')) lines.push(gameCopy('cap.points'));
  if (has('device')) lines.push(gameCopy('cap.device'));
  if (has('tank')) lines.push(gameCopy('cap.tank'));
  return lines;
}

export interface MiniResultSummary {
  score: string;
  /** "+8 Giọt nước", "+10 Điểm Xanh": chỉ phần thưởng thật đã cộng. */
  gains: string[];
  /** Vì sao không có hoặc bị hạ thưởng, và dòng điểm danh của Đố Xanh. */
  notes: string[];
  /** Khách chưa đăng nhập hoặc tài khoản khách theo thiết bị (Mini App): nút chính là "Đăng nhập để nhận thưởng". */
  loginToReward: boolean;
}

export function miniResultSummary(r: MiniSubmitResponse): MiniResultSummary {
  const gains: string[] = [];
  if (r.water > 0) gains.push(gameCopy('result.water', { n: r.water }));
  if (r.points > 0) gains.push(gameCopy('result.points', { n: r.points }));
  const notes: string[] = [];
  if (!r.rewarded) notes.push(r.noRewardReason ? reasonLine(r.noRewardReason) : gameCopy('result.noReward'));
  else notes.push(...miniCapLines(r.capped));
  if (r.rewarded && gains.length === 0 && notes.length === 0) notes.push(gameCopy('result.noReward'));
  if (r.checkIn?.done) {
    notes.push(r.checkIn.newlyCheckedIn && r.checkIn.streakDays ? gameCopy('result.checkIn', { n: r.checkIn.streakDays }) : gameCopy('result.checkInDone'));
  }
  return {
    score: gameCopy('result.score', { c: r.correct, t: r.total }),
    gains,
    notes,
    loginToReward: !r.rewarded && (r.noRewardReason === 'NOT_LOGGED_IN' || r.noRewardReason === 'NOT_REAL_USER'),
  };
}

/** Hành động duy nhất của màn lỗi: gửi lại bài (đáp án còn giữ), chơi ván mới, về Vườn Xanh, hoặc đăng nhập lại. */
export type MiniFailureAction = 'retry' | 'new' | 'back' | 'login';

export function miniFailureView(failure: RoundFailure, step: 'start' | 'submit'): { message: string; action: MiniFailureAction } {
  switch (failure) {
    case 'disabled':
      return { message: gameCopy('error.disabled'), action: 'back' };
    case 'no_content':
      return { message: gameCopy('error.noContent'), action: 'back' };
    case 'limit':
      return { message: gameCopy('error.limit'), action: 'back' };
    case 'login_required':
      return { message: gameCopy('error.login'), action: 'login' };
    case 'already_submitted':
      return { message: gameCopy('error.already'), action: 'new' };
    case 'expired':
      return { message: gameCopy('expired.body'), action: 'new' };
    case 'rejected':
      return { message: gameCopy('error.rejected'), action: 'new' };
    case 'network':
    case 'too_fast':
      return step === 'submit' ? { message: gameCopy('error.submit'), action: 'retry' } : { message: gameCopy('error.start'), action: 'new' };
  }
}

/**
 * Chữ tiến độ của thanh trên: câu/lượt đang làm (Đố Xanh, Đoán Xuất Xứ), số cặp đã ghép, số món đã chọn, bậc cây đã ghép tới (Ghép Mầm
 * Xanh), số món đã phân loại (Đúng Thùng, Băng Chuyền Xanh).
 */
export function miniProgressLabel(game: PlayableMiniGame, done: number, total: number): string {
  const m = total || 1;
  if (game === 'daily_quiz') return gameCopy('progress.question', { n: Math.min(done + 1, m), m });
  if (game === 'origin') return gameCopy('progress.turn', { n: Math.min(done + 1, m), m });
  if (game === 'match') return gameCopy('progress.pairs', { n: done, m: total });
  if (game === 'basket') return gameCopy('progress.picked', { n: done, m: total });
  if (game === 'kitchen_swap') return gameCopy('progress.swapped', { n: done, m: total });
  if (game === 'eco_merge') return gameCopy('progress.tier', { n: done, m: total });
  return gameCopy('progress.items', { n: done, m: total });
}

/** Đồng hồ đếm ngược dạng "0:38". */
export function miniClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Tên miền của nguồn để hiện cạnh liên kết (và thay liên kết ở Mini App, nơi Zalo không cho mở trang ngoài). */
export function sourceHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Chỉ liên kết http(s) mới được gắn vào thẻ `<a>`: nội dung do admin nhập, không để `javascript:` lọt ra. */
export function safeSourceUrl(url: string): string | null {
  return sourceHost(url) === null ? null : url;
}
