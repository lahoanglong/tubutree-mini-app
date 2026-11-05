import type { ReactNode } from 'react';
import { shortDateTime, type OrderTrackView, type TrackStep } from '@tubutree/app-core/commerce/order-tracking';
import { Timeline } from '../ui/timeline';
import { Text } from '../ui/text';

export interface OrderTrackProps {
  track: OrderTrackView;
  /** Giờ hiện tại (ms) để bỏ năm khi cùng năm; thiếu thì lấy giờ máy. */
  now?: number;
}

function StepHint({ step, now }: { step: TrackStep; now?: number }): ReactNode {
  if (!step.at && !step.eta && step.events.length === 0) return null;
  return (
    <>
      {step.at && (
        <Text variant="caption" tone="tertiary" as="div">
          {shortDateTime(step.at, now)}
        </Text>
      )}
      {step.eta && (
        <Text variant="caption" tone="tertiary" as="div">
          {step.eta}
        </Text>
      )}
      {step.events.length > 0 && (
        <ul aria-label="Mốc vận chuyển" style={{ listStyle: 'none', margin: 0, marginTop: 'var(--space-stack-xs)', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
          {step.events.map((ev, i) => (
            <li key={`${ev.at ?? ''}-${i}`} data-latest={ev.latest ? 'true' : undefined}>
              <Text variant="caption" tone={ev.latest ? 'primary' : 'secondary'} as="div" style={{ fontWeight: ev.latest ? 600 : 400 }}>
                {ev.label}
              </Text>
              {ev.at && (
                <Text variant="caption" tone="tertiary" as="div">
                  {shortDateTime(ev.at, now)}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Hành trình 5 bước của đơn: bước hiện tại có `aria-current="step"`, mỗi bước kèm giờ thật; mốc hãng vận chuyển gộp dưới bước "Đang giao", mới nhất trên cùng. */
export function OrderTrack({ track, now }: OrderTrackProps) {
  const hints: Record<number, ReactNode> = {};
  track.steps.forEach((s, i) => {
    const hint = StepHint({ step: s, now });
    if (hint) hints[i] = hint;
  });
  return <Timeline steps={track.steps.map((s) => s.label)} current={track.current} label="Hành trình đơn hàng" hints={hints} />;
}
