import { homeCopy } from '@tubutree/app-core/home-copy';
import { isCouponExpiring } from '@tubutree/app-core/home-layout';
import type { CouponDTO } from '../../services/account-api';
import { autoCouponName } from '../../utils/coupon-name';
import { formatDate, formatVnd } from '../../utils/format';
import { Text } from '../ui/text';

export function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

/** Một mã giảm giá của khách (Điểm Xanh và Ưu đãi dùng chung). */
export function CouponCard({ coupon: c }: { coupon: CouponDTO }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: 12,
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-control)',
        border: '1px dashed var(--clay-100)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Text variant="body-sm" tone="primary" as="div" style={{ color: 'var(--color-promo-fg)', fontWeight: 700 }}>
          {couponLabel(c)}
        </Text>
        <Text variant="caption" tone="secondary" as="div">
          {autoCouponName(c.code) ?? `Mã ${c.code}`}
          {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
        </Text>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <Text variant="caption" tone="tertiary" as="div">
          HSD {formatDate(c.endAt)}
        </Text>
        {isCouponExpiring(c, Date.now()) && (
          <Text variant="caption" as="div" style={{ color: 'var(--color-text-warning)', fontWeight: 700 }}>
            {homeCopy.offers.couponExpiring}
          </Text>
        )}
      </div>
    </div>
  );
}
