import { ShoppingBag } from 'lucide-react';
import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';

const t = vi.game.newbie.orderWater;

/** Nguồn nước "Từ đơn hàng" kèm tiến độ tuần (thứ Hai đến Chủ nhật, giờ VN). Ẩn khi admin tắt hoặc API cũ không trả. */
export function OrderWaterCard({ info, onShop }: { info: GameProfile['orderWater']; onShop: () => void }) {
  if (!info || info.perOrder <= 0 || info.weeklyCap <= 0) return null;
  const got = Math.min(info.weeklyGranted, info.weeklyCap);
  const pct = Math.round((got / info.weeklyCap) * 100);
  const full = got >= info.weeklyCap;
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Heading variant="title-sm" as="h2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={ShoppingBag} tone="brand" />
            {t.title}
          </Heading>
          <Text variant="caption" tone="tertiary" as="div">
            {t.perOrder(info.perOrder)}
          </Text>
        </div>
        <Button variant="secondary" onPress={onShop} style={{ flexShrink: 0 }}>
          {t.cta}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label={t.progress(got, info.weeklyCap)}
        aria-valuemin={0}
        aria-valuemax={info.weeklyCap}
        aria-valuenow={got}
        style={{ background: 'var(--stone-100)', borderRadius: 'var(--radius-pill)', height: 8, marginTop: 12, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: 8, background: 'var(--color-action-primary-bg)', borderRadius: 'var(--radius-pill)' }} />
      </div>
      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 6 }} data-testid="order-water-progress">
        {full ? t.full : t.progress(got, info.weeklyCap)}
      </Text>
    </Card>
  );
}
