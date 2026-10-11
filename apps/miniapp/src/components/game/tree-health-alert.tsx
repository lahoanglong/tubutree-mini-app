import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { GameProfile } from '../../services/game-api';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

// Cảnh báo héo/chết (§6.7.3)
export function TreeHealthAlert({ health }: { health: GameProfile['treeHealth'] }) {
  if (health === 'WILTED') {
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
          Cây đang héo vì lâu chưa tưới — tưới ngay để hồi phục nhé!
        </Text>
      </div>
    );
  }
  if (health === 'DEAD') {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          padding: 12,
          background: 'var(--color-status-danger-bg)',
          borderRadius: 'var(--radius-control)',
        }}
      >
        <Icon icon={CircleAlert} size="sm" tone="danger" style={{ flexShrink: 0, marginTop: 2 }} />
        <Text variant="caption" tone="danger">
          Cây đã héo úa do quá 7 ngày không tưới. Tưới lại sẽ trồng cây mới từ đầu.
        </Text>
      </div>
    );
  }
  return null;
}
