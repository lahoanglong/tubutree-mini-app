import { ARCADE_HAPTIC_MS, type ArcadeHaptic } from '@tubutree/app-core/game-mini/arcade';

/** Kho lưu kỷ lục và lựa chọn âm thanh của game thao tác trên web; trình duyệt chặn kho thì null (vẫn chơi được, không nhớ). */
export function arcadeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Rung ngắn qua `navigator.vibrate`; iPhone và máy tính không có thì bỏ qua êm. */
export function arcadeHaptic(kind: ArcadeHaptic): void {
  try {
    navigator.vibrate?.(ARCADE_HAPTIC_MS[kind]);
  } catch {
    /* trình duyệt chặn rung */
  }
}
