import { describe, expect, it, vi, beforeEach } from 'vitest';

const trackEvent = vi.fn();
vi.mock('./analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

import { trackRecycleStep } from './recycle-funnel';

describe('trackRecycleStep (Mini App)', () => {
  beforeEach(() => trackEvent.mockClear());

  it('gửi recycle_funnel_step với step + surface miniapp, không có lane khi chưa chọn', () => {
    trackRecycleStep('enter');
    expect(trackEvent).toHaveBeenCalledWith('recycle_funnel_step', 'miniapp', { step: 'enter', surface: 'miniapp' });
  });

  it('kèm lane khi đã biết đường giao', () => {
    trackRecycleStep('submitted', 'HOME_PICKUP');
    expect(trackEvent).toHaveBeenCalledWith('recycle_funnel_step', 'miniapp', { step: 'submitted', surface: 'miniapp', lane: 'HOME_PICKUP' });
  });
});
