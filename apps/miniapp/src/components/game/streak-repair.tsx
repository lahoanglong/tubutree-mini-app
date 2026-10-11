import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

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
    <div
      style={{
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px dashed var(--clay-500)',
        padding: 12,
      }}
    >
      <Text variant="body-sm" as="div" style={{ color: 'var(--color-promo-fg)', fontWeight: 600 }}>
        {vi.game.streakRepair.title(brokenStreakDays ?? 0)}
      </Text>
      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
        {vi.game.streakRepair.body}
      </Text>
      <Button variant="flash" fullWidth loading={pending} disabled={pending} onPress={() => onRepair()} style={{ marginTop: 10 }}>
        {vi.game.streakRepair.cta(cost ?? 0)}
      </Button>
    </div>
  );
}
