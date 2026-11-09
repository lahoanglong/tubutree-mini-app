'use client';

// Nguồn: apps/miniapp/src/components/orders/order-shipping.tsx (web chép bằng clipboard của trình duyệt và có liên kết tra cứu của hãng)
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { Text } from '@/components/mini/text';
import { Button } from '@/components/mini/button';
import { copyText } from '@/lib/copy-text';
import { TrackEventsList } from './track-events-list';

export interface OrderShippingProps {
  partner?: string | null;
  code?: string | null;
  /** Trạng thái hãng đã dịch ("Đang giao hàng"). */
  status?: string | null;
  /** Mốc hãng ghi, chỉ truyền khi đơn không có hành trình 5 bước (đơn đã hoàn): còn lại các mốc nằm trong OrderTrack. */
  events?: readonly TrackEvent[];
  /** Liên kết tra cứu trên trang hãng (chỉ http/https đã lọc); Mini App không mở trang ngoài nên không có. */
  trackingHref?: string | null;
}

/** Hãng vận chuyển và mã vận đơn có nút chép mã, đặt liền dưới hành trình. */
export function OrderShipping({ partner, code, status, events = [], trackingHref }: OrderShippingProps) {
  // `n` đếm số lần báo: chạm lần hai (cùng chữ) vẫn dựng lại lời báo, như thanh thông báo của Mini App hiện lại mỗi lần chạm.
  const [result, setResult] = useState<{ ok: boolean; n: number } | null>(null);
  if (!partner && !code && !trackingHref && events.length === 0) return null;
  const copy = async () => {
    const ok = await copyText(code!);
    setResult((prev) => ({ ok, n: (prev?.n ?? 0) + 1 }));
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
            {/* Vùng báo phải có sẵn trong trang trước khi bấm thì trình đọc màn hình mới đọc lúc chữ đổi; rỗng nên không chiếm chỗ. */}
            <div role="status">
              {result?.ok && (
                <Text key={result.n} variant="caption" tone="success" as="div">
                  Đã sao chép mã vận đơn
                </Text>
              )}
            </div>
            {/* Lỗi hiện sau một lần chạm nên là role="alert" (đọc ngay); dựng riêng khỏi vùng status để chữ thành công không lẫn vào. */}
            {result && !result.ok && (
              <div role="alert" key={result.n}>
                <Text variant="caption" tone="danger" as="div">
                  Không sao chép được — hãy chép mã thủ công.
                </Text>
              </div>
            )}
          </div>
          <Button variant="secondary" onPress={() => void copy()} aria-label={fillCopy('order.shipping.copyAria', { code })} style={{ flex: '0 0 auto' }}>
            {fillCopy('order.shipping.copy')}
          </Button>
        </div>
      )}
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
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest-700 underline"
        >
          {fillCopy('order.shipping.track')}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
      <TrackEventsList events={events} />
    </section>
  );
}
