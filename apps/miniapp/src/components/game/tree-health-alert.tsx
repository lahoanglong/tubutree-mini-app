import { TriangleAlert } from 'lucide-react';
import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

// Cảnh báo héo/chết (§6.7.3)
export function TreeHealthAlert({ health }: { health: GameProfile['treeHealth'] }) {
  // Cây quá hạn chỉ héo, không mất tiến độ: DEAD (hồ sơ cũ) cũng hiện như héo.
  if (health !== 'WILTED' && health !== 'DEAD') return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: 12,
        background: 'var(--color-status-warning-bg)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <Icon icon={TriangleAlert} size="sm" style={{ stroke: 'var(--color-status-warning-fg)', flexShrink: 0, marginTop: 2 }} />
      <Text variant="caption" tone="warning">
        {vi.game.newbie.treeWilted}
      </Text>
    </div>
  );
}
