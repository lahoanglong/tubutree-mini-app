import { useEffect, useRef, useState } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Text } from '../ui/text';
import { Button } from '../ui/button';
import { TrackEventsList } from './track-events-list';
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

const COPIED_MS = 2000;
const FAILED_MS = 4000;

/** Hãng vận chuyển và mã vận đơn có nút chép mã, đặt liền dưới hành trình. */
export function OrderShipping({ partner, code, status, events = [] }: OrderShippingProps) {
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [announce, setAnnounce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!partner && !code && events.length === 0) return null;
  const copy = async () => {
    haptic('light');
    const ok = await copyText(code!);
    clearTimeout(timer.current);
    setResult(ok ? 'ok' : 'fail');
    setAnnounce((n) => n + 1);
    timer.current = setTimeout(() => setResult(null), ok ? COPIED_MS : FAILED_MS);
  };
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inset-card)' }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {fillCopy('order.shipping.code')}
            </Text>
            <Text variant="body-md" as="div" numeric style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {code}
            </Text>
            <div role="status">
              {result && (
                <Text key={announce} variant="caption" tone={result === 'ok' ? 'success' : 'danger'} as="div">
                  {result === 'ok' ? 'Đã sao chép mã vận đơn' : 'Không sao chép được — hãy chép mã thủ công.'}
                </Text>
              )}
            </div>
          </div>
          <Button variant="secondary" onPress={copy} aria-label={fillCopy('order.shipping.copyAria', { code })} style={{ flex: '0 0 auto' }}>
            {fillCopy('order.shipping.copy')}
          </Button>
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
