import { Box, Text, Button } from 'zmp-ui';
import { vi } from '../../i18n/vi';

// Hồi sinh chuỗi vừa mất (§streak-repair) — trang chỉ dựng khối này trong cửa sổ hồi sinh
export function StreakRepair({
  brokenStreakDays,
  cost,
  pending,
  onRepair,
}: {
  brokenStreakDays: number | undefined;
  cost: number | undefined;
  pending: boolean;
  onRepair: () => void;
}) {
  return (
    <Box
      mx={3}
      mt={2}
      p={3}
      style={{ background: 'var(--clay-50)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--clay-500)' }}
    >
      <Text size="small" bold style={{ color: 'var(--clay-700)' }}>
        {vi.game.streakRepair.title(brokenStreakDays ?? 0)}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-500)', marginTop: 2 }}>
        {vi.game.streakRepair.body}
      </Text>
      <Button
        fullWidth
        size="small"
        loading={pending}
        disabled={pending}
        onClick={() => onRepair()}
        style={{ marginTop: 10, background: 'var(--clay-500)' }}
      >
        {vi.game.streakRepair.cta(cost ?? 0)}
      </Button>
    </Box>
  );
}
