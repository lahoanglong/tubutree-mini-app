'use client';

// Nguồn: apps/miniapp/src/components/orders/track-events-list.tsx
import { useId, useState } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { shortDateTime, type TrackEvent } from '@tubutree/app-core/commerce/order-tracking';
import { ui } from '@/lib/guest-ui';
import { Text } from '@/components/mini/text';

/** Hãng GHN/GHTK ghi 8–15 mốc quét: quá ngần này mốc thì mặc định chỉ hiện các mốc mới nhất, còn lại nằm sau nút mở. */
export const TRACK_EVENTS_COLLAPSED = 3;

export interface TrackEventsListProps {
  /** Mới nhất trên cùng (đã xếp ở app-core). */
  events: readonly TrackEvent[];
  /** Giờ hiện tại (ms) để bỏ năm khi cùng năm; thiếu thì lấy giờ máy. */
  now?: number;
  /** Cách dòng trên khi danh sách nằm dưới giờ của bước hành trình. */
  spaced?: boolean;
}

/** Mốc hãng vận chuyển: từ mốc thứ 4 trở đi có nút "Xem thêm N mốc vận chuyển" / "Thu gọn mốc vận chuyển". */
export function TrackEventsList({ events, now, spaced }: TrackEventsListProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (events.length === 0) return null;
  const collapsible = events.length > TRACK_EVENTS_COLLAPSED;
  const shown = collapsible && !expanded ? events.slice(0, TRACK_EVENTS_COLLAPSED) : events;
  return (
    <>
      <ul
        id={listId}
        aria-label="Mốc vận chuyển"
        style={{ listStyle: 'none', margin: 0, ...(spaced ? { marginTop: 'var(--space-stack-xs)' } : null), padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}
      >
        {shown.map((ev, i) => (
          <li key={`${ev.at ?? ''}-${i}`} data-latest={ev.latest ? 'true' : undefined}>
            <Text variant="caption" tone={ev.latest ? 'primary' : 'secondary'} as="div" style={{ fontWeight: ev.latest ? 600 : 400 }}>
              {ev.label}
            </Text>
            {ev.at && (
              <Text variant="caption" tone="tertiary" as="div" numeric>
                {shortDateTime(ev.at, now)}
              </Text>
            )}
          </li>
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          data-testid="track-events-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className={`${ui.btnText} -ml-2 self-start text-[color:var(--color-text-brand)]`}
          style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--type-caption-size)' }}
        >
          {expanded ? fillCopy('order.shipping.eventsLess') : fillCopy('order.shipping.eventsMore', { n: events.length - TRACK_EVENTS_COLLAPSED })}
        </button>
      )}
    </>
  );
}
