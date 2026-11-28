/**
 * Hợp đồng chung của game mini "Lượt chơi có thưởng" (API `/game/mini/*`, Mini App và web).
 *
 * Hai nhóm game:
 * - Game nội dung (`MINI_CONTENT_GAME_IDS`): máy chủ giữ đáp án. `start` chỉ trả nội dung không kèm đáp án, `submit` chấm theo danh sách
 *   mục đã phát cho ván rồi mới trả đáp án, lời giải thích và nguồn.
 * - Game thao tác (`MINI_ARCADE_GAME_IDS`, Ghép Mầm Xanh và Băng Chuyền Xanh): luật cài sẵn, không có mục trong admin. Ván dựng từ một
 *   `seed` máy chủ suy từ mã ván; máy chủ chơi lại bài nộp bằng cùng động cơ (`game-arcade.ts`) để tự tính kết quả.
 *
 * Thưởng (💧 và Điểm Xanh) của cả hai nhóm do máy chủ tính bằng cùng công thức và cùng trần theo tài khoản, thiết bị và toàn hệ thống.
 */

export const MINI_CONTENT_GAME_IDS = ['sort', 'daily_quiz', 'match', 'origin', 'basket', 'kitchen_swap'] as const;
export type MiniContentGameId = (typeof MINI_CONTENT_GAME_IDS)[number];
export const MINI_ARCADE_GAME_IDS = ['eco_merge', 'green_conveyor'] as const;
export type MiniArcadeGameId = (typeof MINI_ARCADE_GAME_IDS)[number];
// Viết nguyên mảng (không trải hai mảng trên): Rollup không chứng minh được phép trải là thuần nên sẽ giữ cả mô-đun trong gói đầu Mini App.
export const MINI_GAME_IDS = ['sort', 'daily_quiz', 'match', 'origin', 'basket', 'kitchen_swap', 'eco_merge', 'green_conveyor'] as const;
export type MiniGameId = (typeof MINI_GAME_IDS)[number];

export function isMiniGameId(v: unknown): v is MiniGameId {
  return typeof v === 'string' && (MINI_GAME_IDS as readonly string[]).includes(v);
}

export function isMiniArcadeGameId(v: unknown): v is MiniArcadeGameId {
  return typeof v === 'string' && (MINI_ARCADE_GAME_IDS as readonly string[]).includes(v);
}

export function isMiniContentGameId(v: unknown): v is MiniContentGameId {
  return typeof v === 'string' && (MINI_CONTENT_GAME_IDS as readonly string[]).includes(v);
}

/** Thùng của game Đúng Thùng, theo phân loại tại nguồn của Việt Nam; `hazardous` chỉ có ở vòng có vật nguy hại. */
export const MINI_SORT_BINS = ['recycle', 'food', 'other', 'hazardous'] as const;
export type MiniSortBin = (typeof MINI_SORT_BINS)[number];

export interface MiniGameRule {
  /**
   * Số mục trong một ván (Giỏ Đúng Việc: một đề, chọn 3 trong 6). Ghép Mầm Xanh: số bậc cây (đạt bậc cao nhất là đúng hết); Băng Chuyền
   * Xanh: số món chạy qua băng trong một ván.
   */
  items: number;
  /** Thời lượng một ván để client đếm giờ; máy chủ chỉ chặn ván nộp sớm hơn `MINI_MIN_ROUND_MS` và ván quá `MINI_ROUND_TTL_MS`. */
  timeLimitMs: number;
}

export const MINI_GAME_RULES: Record<MiniGameId, MiniGameRule> = {
  sort: { items: 10, timeLimitMs: 45_000 },
  daily_quiz: { items: 3, timeLimitMs: 60_000 },
  match: { items: 6, timeLimitMs: 60_000 },
  origin: { items: 5, timeLimitMs: 60_000 },
  basket: { items: 1, timeLimitMs: 45_000 },
  kitchen_swap: { items: 3, timeLimitMs: 45_000 },
  eco_merge: { items: 8, timeLimitMs: 180_000 },
  green_conveyor: { items: 24, timeLimitMs: 30_000 },
};

/**
 * Mức nộp sớm nhất riêng của game, cao hơn `MINI_MIN_ROUND_MS`. Băng Chuyền Xanh luôn chạy đủ 30 giây (món cuối ra băng ở giây 27), và
 * đáp án của từng món nằm sẵn ở máy khách để chấm ngay: bài nộp trước 20 giây không phải một ván thật.
 */
export const MINI_GAME_MIN_ROUND_MS: Partial<Record<MiniGameId, number>> = { green_conveyor: 20_000 };

export function miniMinRoundMs(game: MiniGameId): number {
  return Math.max(MINI_MIN_ROUND_MS, MINI_GAME_MIN_ROUND_MS[game] ?? 0);
}

/** Giỏ Đúng Việc: mỗi đề có đúng 3 sản phẩm đúng và 3 sản phẩm sai. */
export const MINI_BASKET_PICK = 3;

/** Góc nhà của Căn Bếp Xanh. Một ván đi qua `MINI_GAME_RULES.kitchen_swap.items` góc khác nhau, mỗi góc một món cần đổi. */
export const MINI_KITCHEN_CORNERS = ['table', 'kitchen', 'bathroom', 'bag'] as const;
export type MiniKitchenCorner = (typeof MINI_KITCHEN_CORNERS)[number];
/** Căn Bếp Xanh: mỗi món có đúng 3 sản phẩm Tubu để đổi, một sản phẩm đúng việc. */
export const MINI_KITCHEN_OPTIONS = 3;
/** Ván nộp sớm hơn mức này bị từ chối (không phải người chơi thật). */
export const MINI_MIN_ROUND_MS = 5_000;
/** Ván quá hạn sau chừng này kể từ lúc phát: không chấm, không thưởng, không tính lượt. */
export const MINI_ROUND_TTL_MS = 10 * 60_000;
/** Số ván tối đa một tài khoản bắt đầu cho một game trong một ngày (chặn bơm dòng vào DB; ván thứ 3 trở đi đã không thưởng). */
export const MINI_MAX_ROUNDS_PER_GAME_PER_DAY = 60;
/** Game có ít mục đang bật hơn mức này thì tự ẩn; Giỏ Đúng Việc còn cần ít nhất một đề có cả 6 sản phẩm còn hàng. */
export const MINI_MIN_ACTIVE_ITEMS = 10;

/** Thưởng một ván có thưởng TRƯỚC khi áp trần: 💧 4 + 1 mỗi mục đúng (tối đa 10), 10 Điểm Xanh nếu đúng từ 80%. */
export const MINI_REWARD = {
  waterBase: 4,
  waterPerCorrect: 1,
  waterMax: 10,
  points: 10,
  pointsMinRatio: 0.8,
} as const;

export function miniBaseReward(correct: number, total: number): { water: number; points: number } {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0) return { water: 0, points: 0 };
  const c = Math.min(correct, total);
  const water = Math.min(MINI_REWARD.waterMax, MINI_REWARD.waterBase + MINI_REWARD.waterPerCorrect * c);
  const points = c / total >= MINI_REWARD.pointsMinRatio ? MINI_REWARD.points : 0;
  return { water, points };
}

export const MINI_ERROR_CODES = {
  disabled: 'GAME_DISABLED',
  noContent: 'GAME_NO_CONTENT',
  roundNotFound: 'ROUND_NOT_FOUND',
  roundSubmitted: 'ROUND_SUBMITTED',
  roundExpired: 'ROUND_EXPIRED',
  tooFast: 'ROUND_TOO_FAST',
  answersInvalid: 'ANSWERS_INVALID',
  tokenInvalid: 'ROUND_TOKEN_INVALID',
  loginRequired: 'LOGIN_REQUIRED',
  roundLimit: 'ROUND_LIMIT',
} as const;
export type MiniErrorCode = (typeof MINI_ERROR_CODES)[keyof typeof MINI_ERROR_CODES];

/** Vì sao ván không có thưởng (biết trước khi chơi, hiện "ván này không tính thưởng"). */
export type MiniNoRewardReason = 'NOT_LOGGED_IN' | 'NOT_REAL_USER' | 'ACCOUNT_TOO_NEW' | 'NO_REWARDED_ROUNDS_LEFT';

/** Trần đã hạ thưởng của một ván: 💧/điểm trong ngày của tài khoản, số tài khoản trên thiết bị, ngân sách điểm toàn hệ thống, bình 💧 đầy. */
export const MINI_CAP_IDS = ['account_water', 'account_points', 'device', 'global', 'tank'] as const;
export type MiniCapId = (typeof MINI_CAP_IDS)[number];

export interface MiniProductCard {
  slug: string;
  name: string;
  imageUrl: string | null;
  /** Giá đang bán (đ) của phân loại rẻ nhất còn bán. */
  price: number;
  inStock: boolean;
}

export interface MiniSortItem {
  id: string;
  label: string;
  emoji: string | null;
}

export interface MiniChoiceItem {
  id: string;
  /** Câu hỏi (Đố Xanh) hoặc nguyên liệu/sản phẩm cần đoán vùng (Đoán Xuất Xứ). */
  prompt: string;
  options: string[];
  product: MiniProductCard | null;
}

export interface MiniMatchCard {
  /** Mã thẻ riêng của ván, không lộ thẻ nào đi với thẻ nào. */
  cardId: string;
  label: string;
  side: 'ingredient' | 'use';
}

/** Sản phẩm Tubu khách có thể đổi vào, kèm điều nhãn sản phẩm ghi (hiện ngay sau khi đổi, không nói đúng hay sai). */
export interface MiniKitchenOption {
  product: MiniProductCard;
  fact: string;
}

/** Một món trong góc nhà của Căn Bếp Xanh: món đang dùng, điều nó giấu (vỏ nhựa, chất tẩy), 3 sản phẩm Tubu đã xáo. */
export interface MiniKitchenSwap {
  id: string;
  corner: MiniKitchenCorner;
  item: string;
  emoji: string | null;
  hidden: string;
  options: MiniKitchenOption[];
}

/** Thùng của Băng Chuyền Xanh: Tái chế, Hữu cơ, Refill (mang vỏ chai về Tubu nạp lại). */
export const MINI_CONVEYOR_BINS = ['recycle', 'organic', 'refill'] as const;
export type MiniConveyorBin = (typeof MINI_CONVEYOR_BINS)[number];

/** Hình vẽ của món trên băng (bộ hình vector cài sẵn trong hai app, không dùng emoji của hệ điều hành). */
export const MINI_CONVEYOR_ART = [
  'pet_bottle',
  'can',
  'carton',
  'newspaper',
  'glass_jar',
  'banana_peel',
  'coffee_grounds',
  'eggshell',
  'leaf',
  'apple_core',
  'refill_pump',
  'refill_jug',
  'refill_spray',
] as const;
export type MiniConveyorArt = (typeof MINI_CONVEYOR_ART)[number];

/**
 * Một món trên Băng Chuyền Xanh. `bin` đi kèm vì game chấm ngay từng món (chuỗi nhân điểm, rung khi sai); thưởng vẫn do máy chủ đếm lại
 * từ bài nộp và kẹp bằng trần chung nên biết trước đáp án không mở thêm 💧 hay điểm. `golden`: món vàng, đúng thì +5 điểm ván.
 */
export interface MiniConveyorItem {
  id: string;
  label: string;
  art: MiniConveyorArt;
  bin: MiniConveyorBin;
  golden: boolean;
}

export interface MiniBasketTask {
  id: string;
  task: string;
  /** 6 sản phẩm đã xáo, chọn đúng `MINI_BASKET_PICK`. */
  products: MiniProductCard[];
}

export type MiniRoundContent =
  | { game: 'sort'; bins: MiniSortBin[]; items: MiniSortItem[] }
  | { game: 'daily_quiz'; items: MiniChoiceItem[] }
  | { game: 'origin'; items: MiniChoiceItem[] }
  | { game: 'match'; cards: MiniMatchCard[] }
  | { game: 'basket'; task: MiniBasketTask }
  | { game: 'kitchen_swap'; swaps: MiniKitchenSwap[] }
  | { game: 'eco_merge'; seed: number; size: number; goal: number; maxMoves: number }
  | { game: 'green_conveyor'; seed: number; bins: MiniConveyorBin[]; items: MiniConveyorItem[] };

export interface MiniStartResponse {
  game: MiniGameId;
  /** Ván đã lưu (khách đã đăng nhập); null khi chưa đăng nhập, lúc đó gửi lại `token`. */
  roundId: string | null;
  /** Mã ván ký của khách chưa đăng nhập (không thưởng); null khi có `roundId`. */
  token: string | null;
  issuedAt: string;
  expiresAt: string;
  /** Ván này có tính thưởng không (biết trước khi chơi). */
  rewarded: boolean;
  noRewardReason: MiniNoRewardReason | null;
  content: MiniRoundContent;
}

/**
 * `answers` theo game, cùng thứ tự với nội dung đã phát:
 * - sort: `(MiniSortBin | null)[]`, một phần tử mỗi vật phẩm.
 * - daily_quiz, origin: `(number | null)[]`, chỉ số lựa chọn mỗi câu.
 * - match: `[cardId, cardId][]`, các cặp khách đã ghép (tối đa 6).
 * - basket: `string[]`, slug sản phẩm khách chọn (tối đa 3).
 * - kitchen_swap: `(string | null)[]`, slug sản phẩm khách đổi vào ở mỗi món.
 * - eco_merge: `[string]`, một chuỗi hướng vuốt có làm bàn đổi (`u` lên, `d` xuống, `l` trái, `r` phải), theo thứ tự đã chơi.
 * - green_conveyor: `[string]`, một chuỗi mỗi món một ký tự theo thứ tự ra băng (`r` Tái chế, `o` Hữu cơ, `f` Refill, `-` để trôi).
 * `null` = bỏ trống (hết giờ).
 */
export interface MiniSubmitRequest {
  roundId?: string | null;
  token?: string | null;
  answers: unknown[];
  /** Mã thiết bị do ứng dụng tự sinh và giữ (8–128 ký tự); BẮT BUỘC để ván có thưởng được cộng. Chỉ là lớp ma sát chống nhiều tài khoản trên một máy. */
  deviceId?: string | null;
}

interface MiniReviewBase {
  contentId: string;
  correct: boolean;
  explanation: string;
  sourceUrl: string;
}

export type MiniReview =
  | { game: 'sort'; items: Array<MiniReviewBase & { label: string; given: MiniSortBin | null; expected: MiniSortBin }> }
  | {
      game: 'daily_quiz' | 'origin';
      items: Array<MiniReviewBase & { prompt: string; given: number | null; expected: number; productSlug: string | null }>;
    }
  | { game: 'match'; items: Array<MiniReviewBase & { ingredient: string; use: string; productSlug: string | null }> }
  | {
      game: 'basket';
      items: Array<MiniReviewBase & { correctSlugs: string[]; picks: Array<{ slug: string; correct: boolean; reason: string | null }> }>;
    }
  | {
      game: 'kitchen_swap';
      items: Array<MiniReviewBase & { corner: MiniKitchenCorner; item: string; given: string | null; expected: string }>;
    }
  /** Máy chủ chơi lại chuỗi vuốt: điểm ghép, ô lớn nhất, số nước đi có hiệu lực, đã tới Rừng Tubu chưa. */
  | { game: 'eco_merge'; score: number; maxTile: number; moves: number; won: boolean }
  /** Máy chủ đếm lại từ bài nộp: điểm ván (có nhân chuỗi và món vàng), chuỗi dài nhất, số món vàng đúng, số món để trôi. */
  | { game: 'green_conveyor'; score: number; bestCombo: number; golden: number; missed: number };

export interface MiniCheckInResult {
  /** Điểm danh của ngày đã xong (lần này hoặc từ trước). */
  done: boolean;
  /** Lần nộp này vừa điểm danh (cộng thưởng điểm danh). */
  newlyCheckedIn: boolean;
  streakDays: number | null;
}

export interface MiniSubmitResponse {
  game: MiniGameId;
  roundId: string | null;
  correct: number;
  total: number;
  durationMs: number;
  rewarded: boolean;
  noRewardReason: MiniNoRewardReason | null;
  /** Thưởng trước trần. */
  baseWater: number;
  basePoints: number;
  /** Thưởng thật đã cộng. */
  water: number;
  points: number;
  capped: MiniCapId[];
  totalSeeds: number | null;
  /** Chỉ Đố Xanh: hoàn thành tính là điểm danh của ngày. */
  checkIn: MiniCheckInResult | null;
  review: MiniReview;
}

export interface MiniTodayGame {
  game: MiniGameId;
  items: number;
  timeLimitMs: number;
  rewardedRoundsPerDay: number;
  rewardedRoundsLeft: number;
  /** Số ván đã nộp hôm nay (có và không thưởng). */
  playedToday: number;
}

export interface MiniTodayResponse {
  dayKey: string;
  /** Chỉ game đang bật và đủ nội dung. */
  games: MiniTodayGame[];
  rewardEligible: boolean;
  noRewardReason: MiniNoRewardReason | null;
  caps: {
    waterUsed: number;
    waterCap: number;
    pointsUsed: number;
    pointsCap: number;
    /** Đã nhận đủ cả 💧 và điểm hôm nay. */
    accountCapReached: boolean;
    /** Ngân sách điểm toàn hệ thống hôm nay đã hết: ván còn lại chỉ nhận 💧. */
    pointsBudgetExhausted: boolean;
  };
  dailyQuizDoneToday: boolean;
}

/** Thuộc tính sự kiện máy chủ `game_round_completed`. */
export interface MiniRoundCompletedProps {
  game: MiniGameId;
  correct: number;
  total: number;
  durationMs: number;
  water: number;
  points: number;
  capped: MiniCapId[];
  rewarded: boolean;
}
