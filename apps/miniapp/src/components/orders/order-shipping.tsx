import type { ReactNode } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Text } from '../ui/text';
import { OrderTrackingPill } from './order-tracking-pill';
import { TrackEventsList } from './track-events-list';

export interface OrderShippingProps {
  partner?: string | null;
  code?: string | null;
  /** Trạng thái hãng đã dịch ("Đang giao hàng"). */
  status?: string | null;
  /** Mốc hãng ghi, chỉ truyền khi đơn không có hành trình 5 bước (đơn đã hoàn): còn lại các mốc nằm trong hành trình (`children`). */
  events?: readonly TrackEvent[];
  /** Hành trình của đơn (thanh tiến trình, mốc hãng), vẽ ngay dưới tiêu đề thẻ. */
  children?: ReactNode;
  /** Địa chỉ nhận, vẽ cuối thẻ sau một vạch ngăn. */
  address?: ReactNode;
}

const ADDRESS_SLOT = { borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-inset-card)' } as const;

/**
 * Thẻ Vận chuyển của Chi tiết đơn, MỘT thẻ cho mọi thứ về đường đi của đơn: tiêu đề, viên mã vận đơn chạm để chép (nút chép DUY NHẤT của trang, mọi
 * trạng thái có mã; đứng trên hành trình để khách thấy mã không phải cuộn) hoặc hãng khi chưa có mã, hành trình, trạng thái hãng, mốc hãng của đơn đã
 * hoàn, rồi địa chỉ nhận.
 */
export function OrderShipping({ partner, code, status, events = [], children, address }: OrderShippingProps) {
  if (!children && !address && !partner && !code && events.length === 0) return null;
  const title = fillCopy('order.shipping.title');
  return (
    <section aria-label={title} data-testid="order-shipping" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)' }}>
      <Text variant="body-sm" as="h2" style={{ fontWeight: 700 }}>
        {title}
      </Text>
      {code ? (
        <OrderTrackingPill code={code} partner={partner} />
      ) : (
        partner && (
          <div>
            <Text variant="caption" tone="tertiary" as="div">
              {fillCopy('order.shipping.carrier')}
            </Text>
            <Text variant="body-md" as="div">
              {partner}
            </Text>
          </div>
        )
      )}
      {children}
      {status && (
        <Text variant="caption" tone="success" as="div">
          {status}
        </Text>
      )}
      <TrackEventsList events={events} />
      {address && (
        <div data-testid="order-shipping-address" style={ADDRESS_SLOT}>
          {address}
        </div>
      )}
    </section>
  );
}
