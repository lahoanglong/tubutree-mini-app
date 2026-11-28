import { isMiniArcadeGameId, type MiniArcadeGameId, type MiniReview, type MergeDir } from '@tubutree/shared-types';
import { formatVnNumber } from '../number-format';
import { arcadeCopy } from './arcade-copy';
import { mergeTierName } from './eco-merge';

/**
 * Phần chung của hai game thao tác: nhận cử chỉ vuốt, kỷ lục trên máy, dòng kết quả. Thuần, không DOM: app truyền toạ độ và kho lưu.
 */
export { isMiniArcadeGameId };
export type { MiniArcadeGameId };

/** Vuốt ngắn hơn chừng này (px) là chạm, không phải vuốt. */
export const SWIPE_MIN_PX = 24;

/** Hướng vuốt theo trục trội; quãng ngắn hơn `SWIPE_MIN_PX` thì null. */
export function swipeDir(dx: number, dy: number, min: number = SWIPE_MIN_PX): MergeDir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < min) return null;
  if (ax > ay) return dx > 0 ? 'r' : 'l';
  return dy > 0 ? 'd' : 'u';
}

export interface ArcadeBestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const arcadeBestKey = (game: MiniArcadeGameId) => `tubu.game-mini.best.${game}`;

/** Kỷ lục điểm của game trên máy này; kho bị chặn hay giá trị hỏng thì 0. */
export function readArcadeBest(storage: ArcadeBestStorage | null, game: MiniArcadeGameId): number {
  try {
    const n = Number(storage?.getItem(arcadeBestKey(game)) ?? '0');
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Ghi điểm máy chủ vừa chấm nếu cao hơn kỷ lục cũ. `isNew` chỉ đúng khi đã có kỷ lục trước đó (ván đầu không khoe "kỷ lục mới"). */
export function saveArcadeBest(storage: ArcadeBestStorage | null, game: MiniArcadeGameId, score: number): { best: number; isNew: boolean; previous: number } {
  const previous = readArcadeBest(storage, game);
  if (!Number.isSafeInteger(score) || score <= previous) return { best: previous, isNew: false, previous };
  try {
    storage?.setItem(arcadeBestKey(game), String(score));
  } catch {
    /* kho bị chặn: vẫn báo điểm ván này */
  }
  return { best: score, isNew: previous > 0, previous };
}

export interface ArcadeResultView {
  /** Dòng lớn thay "Đúng c/t": tên bậc cao nhất (Ghép Mầm Xanh), giữ "Đúng c/t" ở Băng Chuyền Xanh. */
  headline: string | null;
  line: string;
  score: number;
}

/** Dòng kết quả riêng của game thao tác từ phần chấm của máy chủ; game nội dung thì null. */
export function arcadeResultView(review: MiniReview): ArcadeResultView | null {
  if (review.game === 'eco_merge') {
    return {
      headline: mergeTierName(Math.max(2, review.maxTile)),
      line: arcadeCopy('result.mergeLine', { score: formatVnNumber(review.score), moves: review.moves }),
      score: review.score,
    };
  }
  if (review.game === 'green_conveyor') {
    return {
      headline: null,
      line: arcadeCopy('result.conveyorLine', { score: review.score, combo: review.bestCombo, golden: review.golden }),
      score: review.score,
    };
  }
  return null;
}

/** Kiểu rung ngắn theo sự kiện (ms), app tự quy về API rung của nền tảng. */
export const ARCADE_HAPTIC_MS = { tap: 8, merge: 14, combo: 28, wrong: 40, win: 60 } as const;
export type ArcadeHaptic = keyof typeof ARCADE_HAPTIC_MS;
