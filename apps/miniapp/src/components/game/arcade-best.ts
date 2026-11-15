import type { ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';

const key = (gameId: ArcadeGameId) => `tubu.arcade.best.${gameId}`;

/** Kỷ lục chơi thử của khách (chưa đăng nhập) trên máy này. Bộ nhớ hỏng hay bị chặn thì coi như chưa có kỷ lục. */
export function readLocalBest(gameId: ArcadeGameId): number {
  try {
    const n = Number(window.localStorage.getItem(key(gameId)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Ghi kỷ lục nếu `score` vượt kỷ lục cũ. Không ghi được thì kỷ lục chỉ còn trong bảng điểm của ván này. */
export function saveLocalBest(gameId: ArcadeGameId, score: number): { best: number; isNewBest: boolean } {
  const prev = readLocalBest(gameId);
  if (!(score > prev)) return { best: prev, isNewBest: false };
  try {
    window.localStorage.setItem(key(gameId), String(Math.floor(score)));
  } catch {
    // Không có chỗ lưu: ván sau khách chơi lại từ kỷ lục cũ.
  }
  return { best: Math.floor(score), isNewBest: true };
}
