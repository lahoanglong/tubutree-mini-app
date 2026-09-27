import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsEventsService } from './analytics-events.service';

describe('AnalyticsController.ingest', () => {
  it('map userId từ JWT, anonymousId ưu tiên body rồi mới tới header', async () => {
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    const res = await ctrl.ingest(
      { sub: 'u1', role: 'CUSTOMER' } as JwtPayload,
      {
        events: [
          { eventId: 'e1', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' },
        ],
      },
      'device-header-1',
    );

    expect(res).toEqual({ accepted: 1 });
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', anonymousId: 'device-header-1', eventName: 'app_opened' }),
    );
  });

  it('user undefined (edge case) → userId null, không throw', async () => {
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    await ctrl.ingest(undefined, {
      events: [{ eventId: 'e2', eventName: 'client_error', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }],
    });

    expect(recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});
