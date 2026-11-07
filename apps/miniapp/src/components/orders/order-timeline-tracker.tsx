import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { OrderTimelineState, OrderTimelineStep } from '@tubutree/app-core/commerce/order-timeline';
import { shortDateTime } from '@tubutree/app-core/commerce/order-tracking';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { copyText } from '../../utils/clipboard';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';

export interface OrderTimelineTrackerProps {
  steps: readonly OrderTimelineStep[];
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
 * và viền sáng nhẹ (đứng yên khi người dùng giảm chuyển động). Số đo ở lớp `.order-timeline*` (css/tokens.css). Dữ liệu từ `buildOrderTimelineSteps`.
 */
export function OrderTimelineTracker({ steps, now, shareText }: OrderTimelineTrackerProps) {
  return (
    <div data-testid="order-timeline-tracker" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
      <ol className="order-timeline" aria-label={fillCopy('order.timeline.barLabel')}>
        {steps.map((s) => {
          const spoken = STATE_SPOKEN[s.state];
          return (
            <li key={s.key} className="order-timeline__step" data-step={s.key} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="order-timeline__dot" aria-hidden>
                {s.state === 'completed' && <Icon icon={Check} size="sm" tone="inverse" />}
                {s.state === 'cancelled' && <Icon icon={X} size="sm" tone="inverse" />}
              </span>
              <Text variant="caption" as="span" tone={s.state === 'upcoming' ? 'tertiary' : s.state === 'cancelled' ? 'danger' : 'primary'} style={{ fontWeight: s.state === 'current' ? 600 : 400 }}>
                {s.label}
                {spoken && <span style={SR_ONLY}>{`, ${fillCopy(spoken)}`}</span>}
              </Text>
              {s.at && (
                <Text variant="caption" as="span" tone="tertiary" numeric>
                  {shortDateTime(s.at, now)}
                </Text>
              )}
            </li>
          );
        })}
      </ol>
      {shareText && <CopyOrderButton text={shareText} />}
    </div>
  );
}
