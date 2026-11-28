import { ARCADE_HAPTIC_MS, type ArcadeHaptic } from '@tubutree/app-core/game-mini/arcade';
import { vibrate } from 'zmp-sdk/apis';
import { browserStorage } from '../../../utils/recently-viewed';

/** Kho lưu kỷ lục và lựa chọn âm thanh của game thao tác trên Mini App. */
export const arcadeStorage = browserStorage;

/** Rung ngắn qua Zalo; máy không hỗ trợ thì bỏ qua êm. */
export function arcadeHaptic(kind: ArcadeHaptic): void {
  void vibrate({ type: 'oneShot', milliseconds: ARCADE_HAPTIC_MS[kind] }).catch(() => {
    /* thiết bị không rung được */
  });
}
