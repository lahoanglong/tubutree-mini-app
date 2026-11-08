'use client';

// Nguồn: apps/miniapp/src/components/orders/order-track.tsx
import type { ReactNode } from 'react';
import { shortDateTime, type OrderTrackView, type TrackStep } from '@tubutree/app-core/commerce/order-tracking';
import { Timeline } from '@/components/mini/timeline';
import { Text } from '@/components/mini/text';
import { TrackEventsList } from './track-events-list';

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
        <Text variant="caption" tone="tertiary" as="div" numeric>
          {shortDateTime(step.at, now)}
        </Text>
      )}
      {step.eta && (
        <Text variant="caption" tone="tertiary" as="div" numeric>
          {step.eta}
        </Text>
      )}
      <TrackEventsList events={step.events} now={now} spaced />
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
