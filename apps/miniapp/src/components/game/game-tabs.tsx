import type { ReactNode } from 'react';

export const GAME_TABS = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'garden', label: 'Vườn' },
] as const;

export type GameTabKey = (typeof GAME_TABS)[number]['key'];

/**
 * Mỗi tab là một khối luôn được dựng, chỉ ẩn khi không chọn: vòng quay đang quay và đáp án quiz đang hiện
 * không bị mất khi người chơi đổi tab. `display` đặt tường minh vì style flex của chính khối sẽ thắng thuộc
 * tính `hidden` của trình duyệt.
 */
export function GameTabPanel({ tab, active, children }: { tab: GameTabKey; active: boolean; children: ReactNode }) {
  const label = GAME_TABS.find((t) => t.key === tab)?.label;
  return (
    <div
      role="tabpanel"
      aria-label={label}
      hidden={!active}
      style={{ display: active ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}
    >
      {children}
    </div>
  );
}
