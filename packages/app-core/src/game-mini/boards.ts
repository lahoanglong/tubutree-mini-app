import { MINI_SORT_BINS, type MiniSortBin } from '@tubutree/shared-types';

/**
 * Logic thuần của bàn chơi Đố Xanh (G2) và Đúng Thùng (G1), dùng chung Mini App và web. Máy chủ giữ đáp án nên bàn chơi chỉ ghi lựa chọn
 * của khách; đúng/sai, "Vì sao" và nguồn hiện ở màn kết quả sau khi máy chủ chấm.
 */

/** Bàn chơi báo cho khung ván: thời gian còn lại (của ván, hoặc của câu ở Đố Xanh) và tiến độ. */
export interface MiniBoardStatus {
  msLeft: number;
  done: number;
  total: number;
}

/** Props chung của bàn chơi (Mini App và web cùng hình dạng). Bàn chơi tự đếm giờ và gọi `onFinish` đúng một lần. */
export interface MiniBoardProps<C> {
  content: C;
  onFinish: (answers: unknown[]) => void;
  onStatus: (s: MiniBoardStatus) => void;
}

/** Nhịp vẽ lại đồng hồ của bàn chơi. */
export const BOARD_TICK_MS = 250;

// ── Đố Xanh ──

export const QUIZ_QUESTION_MS = 20_000;

export interface QuizProgress {
  index: number;
  answers: (number | null)[];
  /** Lựa chọn đang đánh dấu của câu hiện tại, chưa chốt (khách còn đổi được tới khi bấm Câu tiếp). */
  chosen: number | null;
  questionStartedAt: number;
}

export function quizStart(total: number, now: number): QuizProgress {
  return { index: 0, answers: Array.from({ length: total }, () => null), chosen: null, questionStartedAt: now };
}

export const quizDone = (p: QuizProgress) => p.index >= p.answers.length;

export function quizChoose(p: QuizProgress, option: number, optionCount: number): QuizProgress {
  if (quizDone(p) || !Number.isInteger(option) || option < 0 || option >= optionCount) return p;
  return p.chosen === option ? p : { ...p, chosen: option };
}

/** Chốt câu hiện tại (bấm Câu tiếp, hoặc hết 20 giây: lựa chọn đang đánh dấu vẫn được tính, chưa chọn thì bỏ trống). */
export function quizNext(p: QuizProgress, now: number): QuizProgress {
  if (quizDone(p)) return p;
  const answers = p.answers.slice();
  answers[p.index] = p.chosen;
  return { index: p.index + 1, answers, chosen: null, questionStartedAt: now };
}

export function quizTimeLeft(p: QuizProgress, now: number): number {
  return Math.max(0, p.questionStartedAt + QUIZ_QUESTION_MS - now);
}

export const QUIZ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

// ── Đúng Thùng ──

/** Hai lần đặt cách nhau dưới mức này bị bỏ qua: chạm đúp vào thùng không bỏ luôn món kế tiếp vào cùng thùng. */
export const SORT_TAP_COOLDOWN_MS = 300;

export interface SortProgress {
  index: number;
  answers: (MiniSortBin | null)[];
  lastPlacedAt: number | null;
}

export function sortStart(total: number): SortProgress {
  return { index: 0, answers: Array.from({ length: total }, () => null), lastPlacedAt: null };
}

export const sortDone = (p: SortProgress) => p.index >= p.answers.length;

/**
 * Bỏ món thứ `itemIndex` vào `bin`. Chỉ món đang hiện được đặt (cú chạm thứ hai mang chỉ số cũ thì bỏ qua) và không đặt hai lần trong
 * `SORT_TAP_COOLDOWN_MS`. Trả lại đúng đối tượng cũ khi bỏ qua để nơi gọi so sánh được.
 */
export function sortPlace(p: SortProgress, itemIndex: number, bin: MiniSortBin, now: number): SortProgress {
  if (sortDone(p) || itemIndex !== p.index) return p;
  if (p.lastPlacedAt !== null && now - p.lastPlacedAt < SORT_TAP_COOLDOWN_MS) return p;
  const answers = p.answers.slice();
  answers[p.index] = bin;
  return { index: p.index + 1, answers, lastPlacedAt: now };
}

/** Thùng theo thứ tự cố định (Tái chế, Thực phẩm, Còn lại, Nguy hại), chỉ thùng máy chủ phát cho ván. */
export function sortBinsFor(bins: readonly MiniSortBin[]): MiniSortBin[] {
  return MINI_SORT_BINS.filter((b) => bins.includes(b));
}

export interface BinRect {
  bin: MiniSortBin;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Thùng dưới điểm thả (toạ độ màn hình); ngoài mọi thùng thì null và món về chỗ. */
export function binUnderPoint(rects: readonly BinRect[], x: number, y: number): MiniSortBin | null {
  const hit = rects.find((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  return hit ? hit.bin : null;
}

/** Kéo dưới mức này coi là chạm (chọn món), không phải kéo. */
export const DRAG_SLOP_PX = 8;
