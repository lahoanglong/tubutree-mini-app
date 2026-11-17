'use client';

// Nguồn: apps/miniapp/src/components/orders/order-timeline-tracker.tsx
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { JOURNEY_EVENTS_OPEN, type OrderJourneyStep, type OrderTimelineState, type OrderTimelineStep } from '@tubutree/app-core/commerce/order-timeline';
import { shortDateTime } from '@tubutree/app-core/commerce/order-tracking';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { copyText } from '@/lib/copy-text';
import { Button } from '@/components/mini/button';
import { Icon } from '@/components/mini/icon';
import { SR_ONLY } from '@/components/mini/sr-only';
import { Text } from '@/components/mini/text';
import { TrackEventsList } from './track-events-list';

type JourneyExtras = Partial<Pick<OrderJourneyStep, 'eta' | 'events' | 'notice' | 'stale'>>;

export interface OrderTimelineTrackerProps {
  steps: readonly (OrderTimelineStep & JourneyExtras)[];
  /** `journey`: dòng thời gian dọc một khối (cờ orders.timeline_v2_enabled), bước kèm giờ, dự kiến giao, tin đã báo qua Zalo và mốc hãng gập lại. */
  layout?: 'bar' | 'journey';
  /** Giờ hiện tại (ms) để bỏ năm khi cùng năm; thiếu thì lấy giờ máy. */
  now?: number;
  /** Có chữ thì dưới thanh hiện nút "Sao chép thông tin đơn" chép đúng chữ này; thiếu thì không có nút. */
  shareText?: string;
}

/** Nhãn đọc thêm cho trình đọc màn hình; bước chưa tới và bước nhánh đã tự nói qua nhãn và `aria-current`. */
const STATE_SPOKEN: Partial<Record<OrderTimelineState, string>> = {
  completed: 'order.timeline.done',
  current: 'order.timeline.current',
};

/** Hiện chữ "Đã sao chép" 2 giây rồi trả nhãn cũ; chép lỗi thì báo cách chép tay. */
const COPIED_MS = 2000;
const FAILED_MS = 4000;

function CopyOrderButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    const ok = await copyText(text);
    clearTimeout(timer.current);
    setState(ok ? 'done' : 'fail');
    timer.current = setTimeout(() => setState('idle'), ok ? COPIED_MS : FAILED_MS);
  };

  return (
    <div data-testid="order-copy" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
      <Button variant="secondary" fullWidth icon={state === 'done' ? Check : Copy} onPress={onCopy}>
        {fillCopy(state === 'done' ? 'order.copy.done' : 'order.copy.button')}
      </Button>
      <span aria-live="polite" style={state === 'idle' ? SR_ONLY : undefined}>
        {state === 'done' && <span style={SR_ONLY}>{fillCopy('order.copy.done')}</span>}
        {state === 'fail' && (
          <Text variant="caption" tone="danger" as="span">
            {fillCopy('order.copy.fail')}
          </Text>
        )}
      </span>
    </div>
  );
}

/**
 * Thanh tiến trình đơn 4 bước (Đã tiếp nhận, Đang chuẩn bị, Đang giao hàng, Hoàn tất; đơn huỷ hoặc hoàn trả rẽ nhánh), bước hiện tại có `aria-current="step"`
 * và viền sáng nhẹ (đứng yên khi người dùng giảm chuyển động). Số đo ở lớp `.order-timeline*` (components/mini/mini.css). Dữ liệu từ `buildOrderTimelineSteps`;
 * `layout="journey"` dựng dọc từ `buildOrderJourney` (giờ, dự kiến giao, tin đã báo qua Zalo, mốc hãng gập lại sau 2 mốc mới nhất).
 */
export function OrderTimelineTracker({ steps, now, shareText, layout = 'bar' }: OrderTimelineTrackerProps) {
  const journey = layout === 'journey';
  return (
    <div data-testid="order-timeline-tracker" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
      <ol className={journey ? 'order-timeline order-timeline--journey' : 'order-timeline'} aria-label={fillCopy('order.timeline.barLabel')}>
        {steps.map((s) => {
          const spoken = STATE_SPOKEN[s.state];
          const head = (
            <>
              <Text
                variant={journey ? 'body-sm' : 'caption'}
                as="span"
                tone={s.state === 'upcoming' ? 'tertiary' : s.state === 'cancelled' ? 'danger' : 'primary'}
                style={{ fontWeight: s.state === 'current' ? 600 : 400 }}
              >
                {s.label}
                {spoken && <span style={SR_ONLY}>{`, ${fillCopy(spoken)}`}</span>}
              </Text>
              {s.at && (
                <Text variant="caption" as="span" tone="tertiary" numeric>
                  {shortDateTime(s.at, now)}
                </Text>
              )}
            </>
          );
          return (
            <li key={s.key} className="order-timeline__step" data-step={s.key} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="order-timeline__dot" aria-hidden>
                {s.state === 'completed' && <Icon icon={Check} size="sm" tone="inverse" />}
                {s.state === 'cancelled' && <Icon icon={X} size="sm" tone="inverse" />}
              </span>
              {journey ? (
                <div className="order-timeline__body">
                  {head}
                  {s.eta && (
                    <Text variant="caption" as="span" tone="secondary" numeric>
                      {s.eta}
                    </Text>
                  )}
                  {s.notice && (
                    <Text variant="caption" as="span" tone="brand" numeric>
                      {s.notice}
                    </Text>
                  )}
                  {s.stale && (
                    <Text variant="caption" as="span" tone="warning">
                      {fillCopy('order.journey.stale')}
                    </Text>
                  )}
                  <TrackEventsList events={s.events ?? []} now={now} open={JOURNEY_EVENTS_OPEN} spaced />
                </div>
              ) : (
                head
              )}
            </li>
          );
        })}
      </ol>
      {shareText && <CopyOrderButton text={shareText} />}
    </div>
  );
}
