import { Leaf } from 'lucide-react';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { percentLabel, pointsBoostOf } from '../../utils/loyalty-copy';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

export type PointsBoostPlacement = 'scan' | 'product' | 'home';

/**
 * Dải "Mua trong Mini App tích nhiều hơn" dùng chung ở màn quét mã, trang sản phẩm và trang chủ. Mọi số lấy từ config công khai.
 * Cờ tích đơn sàn tắt thì không so với sàn: trang chủ chỉ nói mức đơn app; trang sản phẩm không thêm gì vì đã có dòng
 * "Nhận … Điểm Xanh" ngay dưới giá; màn quét mã không cần dải (trang báo chưa mở).
 */
export function PointsBoostStrip({ placement }: { placement: PointsBoostPlacement }) {
  const cfg = usePublicConfig();
  const boost = pointsBoostOf(cfg.isLoaded ? cfg.loyalty : undefined);
  if (!boost) return null;
  if (boost.kind === 'plain' && placement !== 'home') return null;

  if (boost.kind === 'plain') {
    return (
      <div style={{ padding: '4px 16px 8px' }}>
        <Text variant="body-sm" tone="brand" as="div" data-testid="points-boost" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <Icon icon={Leaf} size="sm" tone="brand" />
          {vi.externalPoints.boostPlain(percentLabel(boost.appPct))}
        </Text>
      </div>
    );
  }

  const compact = placement === 'product';
  return (
    <div style={compact ? { marginTop: 6 } : { padding: placement === 'home' ? '4px 16px 8px' : '12px 16px 0' }}>
      <div
        data-testid="points-boost"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: compact ? '8px 10px' : '12px 14px',
          background: 'var(--color-action-secondary-bg)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <Icon icon={Leaf} size="sm" tone="brand" />
        <div style={{ minWidth: 0 }}>
          <Text variant="label" tone="brand" as="div">
            {boost.double ? vi.externalPoints.boostTitleDouble : vi.externalPoints.boostTitleMore}
          </Text>
          <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
            {vi.externalPoints.boostSub(percentLabel(boost.marketplacePct), percentLabel(boost.appPct))}
          </Text>
        </div>
      </div>
    </div>
  );
}
