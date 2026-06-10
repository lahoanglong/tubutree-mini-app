import { vibrate } from 'zmp-sdk/apis';

/**
 * Haptic feedback theo spec §7.6 — light: tap chip/toggle,
 * medium: add to cart, heavy: đặt đơn/level-up.
 * Thiết bị không hỗ trợ → bỏ qua êm, không bao giờ làm vỡ flow chính.
 */
type HapticLevel = 'light' | 'medium' | 'heavy';

const DURATION_MS: Record<HapticLevel, number> = { light: 10, medium: 25, heavy: 50 };

export function haptic(level: HapticLevel = 'light'): void {
  void vibrate({ type: 'oneShot', milliseconds: DURATION_MS[level] }).catch(() => {
    /* thiết bị không hỗ trợ rung — bỏ qua */
  });
}
