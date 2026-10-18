import type { ReactNode } from 'react';

export const GAME_TABS = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'garden', label: 'Vườn' },
  { key: 'community', label: 'Cộng đồng' },
] as const;

export type GameTabKey = (typeof GAME_TABS)[number]['key'];

export const GAME_TAB_KEYS: readonly string[] = GAME_TABS.map((t) => t.key);

/**
 * Mỗi tab là một khối luôn được dựng, chỉ ẩn khi không chọn: vòng quay đang quay và đáp án quiz đang hiện không bị
 * mất khi khách đổi tab.
 */
export function GameTabPanel({ tab, active, children }: { tab: GameTabKey; active: boolean; children: ReactNode }) {
  const label = GAME_TABS.find((t) => t.key === tab)?.label;
  return (
    <div role="tabpanel" aria-label={label} hidden={!active} className={active ? 'flex flex-col gap-3' : 'hidden'}>
      {children}
    </div>
  );
}
