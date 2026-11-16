import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackWebEvent = vi.fn();
vi.mock('./analytics', () => ({ trackWebEvent: (...a: unknown[]) => trackWebEvent(...a) }));

import { trackRecycleStep } from './recycle-funnel';

describe('trackRecycleStep (web)', () => {
  beforeEach(() => trackWebEvent.mockClear());

  it('gửi recycle_funnel_step với surface web, không lane khi chưa chọn', () => {
    trackRecycleStep('geo_denied');
    expect(trackWebEvent).toHaveBeenCalledWith('recycle_funnel_step', { step: 'geo_denied', surface: 'web' });
  });

  it('kèm lane khi đã biết đường giao', () => {
    trackRecycleStep('submitted', 'MAIL_IN');
    expect(trackWebEvent).toHaveBeenCalledWith('recycle_funnel_step', { step: 'submitted', surface: 'web', lane: 'MAIL_IN' });
  });
});
