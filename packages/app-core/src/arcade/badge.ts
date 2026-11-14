import { fillCopy } from '../shop-copy';
import { arcadeWindowAt, nextArcadeWindowStart, type ArcadeWindowId } from './arcade-config';

/** `label` nêu cả hai khung; `hint` nói khung đang chạy, ngoài khung thì khung kế và giờ mở. */
export function arcadeWindowBadge(now: Date): { activeWindow: ArcadeWindowId | null; label: string; hint: string } {
  const activeWindow = arcadeWindowAt(now);
  const hint = activeWindow ? `arcade.badge.active.${activeWindow}` : `arcade.badge.next.${arcadeWindowAt(nextArcadeWindowStart(now))}`;
  return { activeWindow, label: fillCopy('arcade.badge.label'), hint: fillCopy(hint) };
}
