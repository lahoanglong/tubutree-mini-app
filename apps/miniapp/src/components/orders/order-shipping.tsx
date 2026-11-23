import { Copy } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { CopyTrackingStatus, copyTrackingLabel, useCopyTrackingCode } from './order-tracking-pill';
import { TrackEventsList } from './track-events-list';

export interface OrderShippingProps {
  partner?: string | null;
  code?: string | null;
  /** Trạng thái hãng đã dịch ("Đang giao hàng"). */
  status?: string | null;
  /** Mốc hãng ghi, chỉ truyền khi đơn không có hành trình 5 bước (đơn đã hoàn): còn lại các mốc nằm trong OrderTrack. */
  events?: readonly TrackEvent[];
  /**
   * Có nút "Chép mã" cạnh mã: chỉ khi trang không có viên vận đơn (`showTrackingPill` sai, tức đơn đã huỷ/hoàn mà kho đã gắn mã), để mỗi trang vẫn
   * đúng một nút chép và khách đối chiếu hay khiếu nại với hãng vẫn lấy được mã.
   */
  copyable?: boolean;
}

function CopyCodeButton({ code, partner }: { code: string; partner?: string | null }) {
  const { copy, result, announce } = useCopyTrackingCode(code);
  return (
    <div style={{ flex: 'none' }}>
      <Button variant="secondary" icon={Copy} aria-label={copyTrackingLabel(code, partner)} onPress={copy}>
        {fillCopy('order.shipping.copy')}
      </Button>
      <CopyTrackingStatus result={result} announce={announce} />
    </div>
  );
}

/**
 * Hãng vận chuyển và mã vận đơn, đặt liền dưới hành trình. Đơn còn chờ hàng thì nút "Chép mã" nằm ở `OrderTrackingPill` dưới thẻ trạng thái (một nút chép
 * mỗi trang) nên ở đây mã chỉ để đọc; đơn đã huỷ/hoàn không có viên nên nơi dùng bật `copyable`.
 */
export function OrderShipping({ partner, code, status, events = [], copyable = false }: OrderShippingProps) {
  if (!partner && !code && events.length === 0) return null;
  return (
    <section aria-label={fillCopy('order.shipping.title')} data-testid="order-shipping" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)' }}>
      <Text variant="body-sm" as="h2" style={{ fontWeight: 700 }}>
        {fillCopy('order.shipping.title')}
      </Text>
      {partner && (
        <div>
          <Text variant="caption" tone="tertiary" as="div">
            {fillCopy('order.shipping.carrier')}
          </Text>
          <Text variant="body-md" as="div">
            {partner}
          </Text>
        </div>
      )}
      {code && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-inline-md)' }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {fillCopy('order.shipping.code')}
            </Text>
            <Text variant="body-md" as="div" numeric style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {code}
            </Text>
          </div>
          {copyable && <CopyCodeButton code={code} partner={partner} />}
        </div>
      )}
      {status && (
        <Text variant="caption" tone="success" as="div">
          {status}
        </Text>
      )}
      <TrackEventsList events={events} />
    </section>
  );
}
