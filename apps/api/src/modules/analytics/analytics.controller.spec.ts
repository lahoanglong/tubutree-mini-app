import { ValidationPipe } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsEventsService } from './analytics-events.service';
import { IngestEventsDto } from './dto/ingest-events.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

describe('AnalyticsController.ingest', () => {
  it('map userId từ JWT, anonymousId ưu tiên body rồi mới tới header', async () => {
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    const res = await ctrl.ingest(
      { sub: 'u1', role: 'CUSTOMER' } as JwtPayload,
      {
        events: [
          { eventId: 'e1', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp', anonymousId: 'body-anon-1' },
        ],
      },
      'device-header-1',
    );

    expect(res).toEqual({ accepted: 1 });
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', anonymousId: 'body-anon-1', eventName: 'app_opened' }),
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

  describe('IngestEventsDto qua ValidationPipe — platform allowlist', () => {
    it('reject platform=admin (FE không được claim admin/pos/system)', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e3', eventName: 'test', occurredAt: '2026-09-27T00:00:00Z', platform: 'admin' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=pos', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e4', eventName: 'test', occurredAt: '2026-09-27T00:00:00Z', platform: 'pos' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=system', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e5', eventName: 'test', occurredAt: '2026-09-27T00:00:00Z', platform: 'system' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=invalid (any value outside miniapp|web)', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e6', eventName: 'test', occurredAt: '2026-09-27T00:00:00Z', platform: 'invalid' },
          ],
        }),
      ).rejects.toThrow();
    });
  });
});
