import { useEffect, useState, type ReactNode } from 'react';
import { hubCopy } from '@tubutree/app-core/game-hub/copy';
import { browserSessionStore, clearHubReturn, hasHubReturn } from '@tubutree/app-core/game-hub/hub-return';

/** Ba tab của Vườn Xanh: việc chăm cây hằng ngày, mọi game, và khu vườn (lô đất, sổ tay loài, tác động xanh, quỹ cây, mùa). Khoá giữ như cũ cho link sẵn có. */
export const GAME_TABS = [
  { key: 'today', label: hubCopy('tab.care') },
  { key: 'games', label: hubCopy('tab.games') },
  { key: 'garden', label: hubCopy('tab.garden') },
] as const;

export type GameTabKey = (typeof GAME_TABS)[number]['key'];

/** Tab đang mở của Vườn Xanh: mặc định Chăm vườn; mở lại ngay sau một ván ở màn game riêng (dấu `markHubReturn`) thì về Sảnh Game. */
export function useGameTab() {
  const [tab, setTab] = useState<GameTabKey>(() => (hasHubReturn(browserSessionStore) ? 'games' : 'today'));
  useEffect(() => clearHubReturn(browserSessionStore), []);
  return [tab, setTab] as const;
}

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
