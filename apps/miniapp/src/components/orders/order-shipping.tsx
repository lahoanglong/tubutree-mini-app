import { useSnackbar } from 'zmp-ui';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { shortDateTime, type TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Text } from '../ui/text';
import { Button } from '../ui/button';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';

export interface OrderShippingProps {
  partner?: string | null;
  code?: string | null;
  /** Trạng thái hãng đã dịch ("Đang giao hàng"). */
  status?: string | null;
  /** Mốc hãng ghi, chỉ truyền khi đơn không có hành trình 5 bước (đơn đã hoàn): còn lại các mốc nằm trong OrderTrack. */
  events?: readonly TrackEvent[];
}

/** Hãng vận chuyển và mã vận đơn có nút chép mã, đặt liền dưới hành trình. */
export function OrderShipping({ partner, code, status, events = [] }: OrderShippingProps) {
  const { openSnackbar } = useSnackbar();
  if (!partner && !code && events.length === 0) return null;
  const copy = () => {
    haptic('light');
    void copyText(code!).then((ok) =>
      openSnackbar(ok ? { text: 'Đã sao chép mã vận đơn', type: 'success' } : { text: 'Không sao chép được — hãy chép mã thủ công.', type: 'error' }),
    );
  };
  return (
    <section aria-label={fillCopy('order.shipping.title')} data-testid="order-shipping" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {fillCopy('order.shipping.code')}
            </Text>
            <Text variant="body-md" as="div" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {code}
            </Text>
          </div>
          <Button variant="secondary" onPress={copy} style={{ flex: '0 0 auto' }}>
            {fillCopy('order.shipping.copy')}
          </Button>
        </div>
      )}
      {status && (
        <Text variant="caption" tone="success" as="div">
          {status}
        </Text>
      )}
      {events.length > 0 && (
        <ul aria-label="Mốc vận chuyển" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map((ev, i) => (
            <li key={`${ev.at ?? ''}-${i}`}>
              <Text variant="caption" tone={ev.latest ? 'primary' : 'secondary'} as="div" style={{ fontWeight: ev.latest ? 600 : 400 }}>
                {ev.label}
              </Text>
              {ev.at && (
                <Text variant="caption" tone="tertiary" as="div">
                  {shortDateTime(ev.at)}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
