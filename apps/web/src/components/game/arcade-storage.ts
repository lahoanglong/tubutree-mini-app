import type { ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';

const key = (gameId: ArcadeGameId) => `tubu.arcade.best.${gameId}`;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Kỷ lục của khách (chưa đăng nhập) trên máy này; 0 khi chưa chơi, storage hỏng hay giá trị lạ. */
export function readGuestBest(gameId: ArcadeGameId): number {
  try {
    const n = Number(store()?.getItem(key(gameId)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Chỉ ghi khi cao hơn kỷ lục đang lưu; storage đầy hay bị chặn thì bỏ qua, ván vẫn chơi được. */
export function writeGuestBest(gameId: ArcadeGameId, score: number): void {
  if (score <= readGuestBest(gameId)) return;
  try {
    store()?.setItem(key(gameId), String(Math.floor(score)));
  } catch {
    /* kỷ lục chỉ là tiện ích trên máy này */
  }
}
