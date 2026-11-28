'use client';

// Nguồn: apps/miniapp/src/components/orders/order-shipping.tsx (web có thêm liên kết tra cứu của hãng)
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Text } from '@/components/mini/text';
import { OrderTrackingPill } from './order-tracking-pill';
import { TrackEventsList } from './track-events-list';

export interface OrderShippingProps {
  partner?: string | null;
  code?: string | null;
  /** Trạng thái hãng đã dịch ("Đang giao hàng"). */
  status?: string | null;
  /** Mốc hãng ghi, chỉ truyền khi đơn không có hành trình 5 bước (đơn đã hoàn): còn lại các mốc nằm trong hành trình (`children`). */
  events?: readonly TrackEvent[];
  /** Liên kết tra cứu trên trang hãng (chỉ http/https đã lọc, đơn còn chờ hàng); Mini App không mở trang ngoài nên không có. */
  trackingHref?: string | null;
  /** Hành trình của đơn (thanh tiến trình, mốc hãng), vẽ ngay dưới tiêu đề thẻ. */
  children?: ReactNode;
  /** Địa chỉ nhận, vẽ cuối thẻ sau một vạch ngăn. */
  address?: ReactNode;
}

const ADDRESS_SLOT = { borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-inset-card)' } as const;

/**
 * Thẻ Vận chuyển của Chi tiết đơn, MỘT thẻ như Mini App: tiêu đề, viên mã vận đơn chạm để chép (nút chép duy nhất của trang; đứng trên hành trình để khách
 * thấy mã không phải cuộn) hoặc hãng khi chưa có mã, hành trình, trạng thái hãng, liên kết tra cứu trang hãng, mốc hãng của đơn đã hoàn, rồi địa chỉ nhận.
 */
export function OrderShipping({ partner, code, status, events = [], trackingHref, children, address }: OrderShippingProps) {
  if (!children && !address && !partner && !code && !trackingHref && events.length === 0) return null;
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
      {trackingHref && (
        <a
          href={trackingHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="order-tracking-link"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-[color:var(--color-text-brand)] underline"
        >
          {fillCopy('order.shipping.track')}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
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
