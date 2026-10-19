import { useId } from 'react';
import { Package } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { OrderView } from '../../services/shop-api';
import { formatDate, formatDateTime } from '../../utils/format';
import { canPayOrderNow, showsPaymentDeadline } from '../../utils/refund-rules';
import { STATUS_TONE, buyerStatusLabel, isReorderable, orderUnitCount } from '../../utils/order-status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { PriceTag } from '../ui/price-tag';
import { STRETCHED_LINK_CLASS, STRETCHED_LINK_RESET, stretchedLinkHit44 } from '../ui/stretched-link';
import { Text } from '../ui/text';

export interface OrderCardProps {
  order: OrderView;
  onOpen: () => void;
  /** Có = hiện nút "Mua lại" cho đơn đã xong. */
  onReorder?: () => void;
  /** Có = hiện nút "Thanh toán ngay" (+ hạn) cho đơn chuyển khoản đang chờ tiền; dẫn tới màn chuyển khoản của đơn. */
  onPay?: () => void;
}

/** Thẻ đơn trong tab Đơn hàng (spec 4a.2): ảnh SP đầu (join theo variationId), số món, tổng tiền,
 * trạng thái, nút Mua lại (A2-05), nút Thanh toán ngay + hạn ở đơn chờ chuyển khoản (D7 #2).
 *
 * Vỏ thẻ KHÔNG tương tác: nút mở đơn là nút mã đơn (`.tubu-tile-link`, `::after` phủ cả thẻ — cùng cách
 * ProductTile), "Mua lại" là anh em của nó nổi lên bằng z-index. Trước đây vỏ là `role="button"` chứa nút
 * "Mua lại" nên trình đọc màn hình không tới được nút con (axe nested-interactive). */
export function OrderCard({ order: o, onOpen, onReorder, onPay }: OrderCardProps) {
  const first = o.items[0];
  const canReorder = onReorder !== undefined && isReorderable(o.status);
  const canPay = onPay !== undefined && canPayOrderNow(o);
  // Tên truy cập = "Đơn <mã>"; món, ngày và tổng tiền là mô tả truy cập của nút.
  const summaryId = useId();
  return (
    <div
      data-testid="order-card"
      className="tubu-press"
      style={{
        position: 'relative',
        isolation: 'isolate',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className={STRETCHED_LINK_CLASS}
          aria-label={`Đơn ${o.code}`}
          aria-describedby={summaryId}
          onClick={onOpen}
          style={{ ...STRETCHED_LINK_RESET, ...stretchedLinkHit44(16) }}
        >
          {/* block: hộp dòng của nút không còn dùng chiều cao chữ của chính nút, nên hộp nút đúng 44px. */}
          <Text variant="label" as="span" style={{ display: 'block', letterSpacing: 0.4 }}>
            {o.code}
          </Text>
        </button>
        <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{buyerStatusLabel(o)}</Badge>
      </div>
      <div id={summaryId} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
            {vi.orders.itemCount(orderUnitCount(o.items))} · {formatDate(o.createdAt)}
          </Text>
        </div>
        <PriceTag value={o.total} size="sm" />
      </div>
      {canPay && (
        <div data-testid="order-card-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {showsPaymentDeadline(o) ? (
            <Text variant="caption" tone="tertiary" as="span">
              {vi.orders.payBy(formatDateTime(o.paymentDeadline))}
            </Text>
          ) : (
            <span />
          )}
          {/* Như "Mua lại": nổi trên lớp phủ của nút mở đơn, vùng trống cạnh nút vẫn mở chi tiết đơn. */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Button size="md" onPress={onPay} style={{ minWidth: 0 }}>
              {vi.orders.payNow}
            </Button>
          </div>
        </div>
      )}
      {canReorder && (
        <div data-testid="order-card-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {/* Nổi trên lớp phủ của nút mở đơn; chỉ bọc đúng nút nên vùng trống cạnh nút vẫn mở chi tiết đơn. */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Button size="md" variant="secondary" onPress={onReorder} style={{ minWidth: 0 }}>
              {vi.reorder.cardCta}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
