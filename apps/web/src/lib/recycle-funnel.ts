'use client';

import type { RecycleFunnelProps, RecycleFunnelStep } from '@tubutree/shared-types';
import { trackWebEvent } from './analytics';

/** Một bước phễu Đổi rác của web. Chỉ đo hành vi trên màn hình; "đã nhận rác thật" do server ghi (`recycle_confirmed`). */
export function trackRecycleStep(step: RecycleFunnelStep, lane?: string): void {
  const props: RecycleFunnelProps = { step, surface: 'web', ...(lane ? { lane } : {}) };
  trackWebEvent('recycle_funnel_step', { ...props });
}
