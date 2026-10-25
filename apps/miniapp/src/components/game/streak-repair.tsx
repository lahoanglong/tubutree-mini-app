import { Flame } from 'lucide-react';
import { missingDrops } from '@tubutree/app-core/game-newbie';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

// Hồi sinh chuỗi vừa mất (§streak-repair) — trang chỉ dựng khối này trong cửa sổ hồi sinh
export function StreakRepair({
  brokenStreakDays,
  cost,
  totalSeeds,
  pending,
  onRepair,
  onNeedWater,
}: {
  brokenStreakDays: number | undefined;
  cost: number | undefined;
  totalSeeds: number | undefined;
  pending: boolean;
  onRepair: () => void;
  /** Thiếu nước: mở sheet "Kiếm nước" với số giọt còn thiếu. */
  onNeedWater: (missing: number) => void;
}) {
  const short = cost != null && totalSeeds != null ? missingDrops(totalSeeds, cost) : 0;
  return (
    <div
      style={{
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px dashed var(--clay-500)',
        padding: 12,
      }}
    >
      <Text
        variant="body-sm"
        as="div"
        style={{ color: 'var(--color-promo-fg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Icon icon={Flame} size="sm" tone="current" />
        {vi.game.streakRepair.title(brokenStreakDays ?? 0)}
      </Text>
      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
        {vi.game.streakRepair.body}
      </Text>
      <Button variant="flash" fullWidth loading={pending} disabled={pending} onPress={() => (short > 0 ? onNeedWater(short) : onRepair())} style={{ marginTop: 10 }}>
        {short > 0 ? vi.game.newbie.short(short) : vi.game.streakRepair.cta(cost ?? 0)}
      </Button>
    </div>
  );
}
