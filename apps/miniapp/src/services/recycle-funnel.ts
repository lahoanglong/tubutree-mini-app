import type { RecycleFunnelProps, RecycleFunnelStep } from '@tubutree/shared-types';
import { trackEvent } from './analytics';

/** Một bước phễu Đổi rác của Mini App. Chỉ đo hành vi trên màn hình; "đã nhận rác thật" do server ghi (`recycle_confirmed`). */
export function trackRecycleStep(step: RecycleFunnelStep, lane?: string): void {
  const props: RecycleFunnelProps = { step, surface: 'miniapp', ...(lane ? { lane } : {}) };
  trackEvent('recycle_funnel_step', 'miniapp', { ...props });
}
