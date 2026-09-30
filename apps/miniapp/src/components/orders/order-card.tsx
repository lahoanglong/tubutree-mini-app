import type { KeyboardEvent } from 'react';
import { Package } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { OrderView } from '../../services/shop-api';
import { STATUS_TONE, isReorderable, orderUnitCount } from '../../utils/order-status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';

export interface OrderCardProps {
  order: OrderView;
  onOpen: () => void;
  /** Có = hiện nút "Mua lại" cho đơn đã xong. */
  onReorder?: () => void;
}

/** Thẻ đơn trong tab Đơn hàng (spec 4a.2): ảnh SP đầu (join theo variationId), số món, tổng tiền,
 * trạng thái, nút Mua lại (A2-05). */
export function OrderCard({ order: o, onOpen, onReorder }: OrderCardProps) {
  const first = o.items[0];
  const canReorder = onReorder !== undefined && isReorderable(o.status);
  // Enter/Space mở chi tiết khi thẻ đang focus; phím trên nút "Mua lại" bên trong không tính.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Đơn ${o.code}`}
      className="tubu-press"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text variant="label" style={{ letterSpacing: 0.4 }}>
          {o.code}
        </Text>
        <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{vi.orderStatus[o.status] ?? o.status}</Badge>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden', display: 'grid', placeItems: 'center',
            borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
          }}
        >
          {first?.thumbnail ? (
            <img src={first.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Icon icon={Package} tone="muted" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {first && (
            <Text variant="body-sm" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {first.productName}
              {o.items.length > 1 ? ` +${o.items.length - 1}` : ''}
            </Text>
          )}
          <Text variant="caption" tone="tertiary" as="div">
            {vi.orders.itemCount(orderUnitCount(o.items))} · {new Date(o.createdAt).toLocaleDateString('vi-VN')}
          </Text>
        </div>
        <PriceTag value={o.total} size="sm" />
      </div>
      {canReorder && (
        // Chặn nổi bọt: bấm "Mua lại" không được mở chi tiết đơn (cùng cách ProductTile).
        <div data-testid="order-card-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {/* Chỉ bọc đúng nút: vùng trống cạnh nút vẫn mở chi tiết đơn (không có vùng chết full-width). */}
          <div onClick={(e) => e.stopPropagation()}>
            <Button size="md" variant="secondary" onPress={onReorder} style={{ minWidth: 0 }}>
              {vi.reorder.cardCta}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
