import { Box, Text } from 'zmp-ui';
import type { GameProfile } from '../../services/game-api';

// Cảnh báo héo/chết (§6.7.3)
export function TreeHealthAlert({ health }: { health: GameProfile['treeHealth'] }) {
  if (health === 'WILTED') {
    return (
      <Box mx={3} mt={2} p={3} style={{ background: 'var(--warning-bg)', borderRadius: 'var(--radius-md)' }}>
        <Text size="xSmall" style={{ color: 'var(--warning)' }}>
          🥀 Cây đang héo vì lâu chưa tưới — tưới ngay để hồi phục nhé!
        </Text>
      </Box>
    );
  }
  if (health === 'DEAD') {
    return (
      <Box mx={3} mt={2} p={3} style={{ background: 'var(--danger-bg)', borderRadius: 'var(--radius-md)' }}>
        <Text size="xSmall" style={{ color: 'var(--danger)' }}>
          🍂 Cây đã héo úa do quá 7 ngày không tưới. Tưới lại sẽ trồng cây mới từ đầu.
        </Text>
      </Box>
    );
  }
  return null;
}
