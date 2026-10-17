import { ValidationPipe } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsEventsService } from './analytics-events.service';
import { IngestEventsDto } from './dto/ingest-events.dto';
import { SERVER_EVENT_NAMES } from '@tubutree/shared-types';
import { THROTTLER_LIMIT, THROTTLER_TRACKER, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

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

  describe('nguồn khách (entrySource, campaign) trên phong bì sự kiện', () => {
    const base = { eventId: '11111111-1111-4111-8111-111111111111', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' };
    const run = async (extra: Record<string, unknown>) => {
      const recordBestEffort = jest.fn().mockResolvedValue(undefined);
      const ctrl = new AnalyticsController({ recordBestEffort } as unknown as AnalyticsEventsService);
      const dto = (await asBody(IngestEventsDto, { events: [{ ...base, eventName: 'app_opened', ...extra }] })) as IngestEventsDto;
      await ctrl.ingest({ sub: 'u1', role: 'CUSTOMER' } as JwtPayload, dto);
      return recordBestEffort.mock.calls[0]![0] as Record<string, unknown>;
    };

    it('chuyển entrySource và campaign xuống service, chuẩn hoá chữ thường', async () => {
      const rec = await run({ entrySource: 'Shopee', campaign: 'Card-2610' });
      expect(rec).toMatchObject({ entrySource: 'shopee', campaign: 'card-2610' });
    });

    it('vắng → null', async () => {
      expect(await run({})).toMatchObject({ entrySource: null, campaign: null });
    });

    it('giá trị bẩn bị bỏ chứ không làm cả lô 400 (mất 50 sự kiện vì một nhãn sai là không đáng)', async () => {
      const rec = await run({ entrySource: 'x y;drop table', campaign: '<b>' });
      expect(rec).toMatchObject({ entrySource: null, campaign: null });
    });
  });

  describe('IngestEventsDto qua ValidationPipe — platform allowlist', () => {
    it('reject platform=admin (FE không được claim admin/pos/system)', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e3', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'admin' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=pos', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e4', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'pos' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=system', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e5', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'system' },
          ],
        }),
      ).rejects.toThrow();
    });

    it('reject platform=invalid (any value outside miniapp|web)', async () => {
      await expect(
        asBody(IngestEventsDto, {
          events: [
            { eventId: 'e6', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'invalid' },
          ],
        }),
      ).rejects.toThrow();
    });
  });

  describe('IngestEventsDto - whitelist eventName (C-030)', () => {
    const base = { eventId: '11111111-1111-4111-8111-111111111111', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' };
    const ingest = (events: Array<Record<string, unknown>>) => asBody(IngestEventsDto, { events });

    it.each(SERVER_EVENT_NAMES)('chặn sự kiện server-side %s do client gửi', async (eventName) => {
      await expect(ingest([{ ...base, eventName }])).rejects.toThrow();
    });

    it('chặn tên lạ', async () => {
      await expect(ingest([{ ...base, eventName: 'not_a_real_event' }])).rejects.toThrow();
    });

    it('một sự kiện server-side lẫn trong lô hợp lệ làm cả lô bị 400', async () => {
      await expect(
        ingest([{ ...base, eventName: 'screen_viewed' }, { ...base, eventName: 'order_paid' }]),
      ).rejects.toThrow();
    });

    it('nhận các sự kiện client đang phát', async () => {
      await expect(ingest([{ ...base, eventName: 'screen_viewed', props: { route: '/home' } }])).resolves.toBeDefined();
    });

    it('props quá 4KB bị chặn', async () => {
      await expect(
        ingest([{ ...base, eventName: 'client_error', props: { blob: 'x'.repeat(5000) } }]),
      ).rejects.toThrow();
    });

    it('props quá 30 khoá bị chặn', async () => {
      const props = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, i]));
      await expect(ingest([{ ...base, eventName: 'client_error', props }])).rejects.toThrow();
    });

    it('trường chuỗi quá dài bị chặn', async () => {
      await expect(
        ingest([{ ...base, eventName: 'app_opened', sessionId: 's'.repeat(500) }]),
      ).rejects.toThrow();
    });

    it('lô quá 50 sự kiện bị chặn', async () => {
      const events = Array.from({ length: 51 }, () => ({ ...base, eventName: 'screen_viewed' }));
      await expect(ingest(events)).rejects.toThrow();
    });
  });

  describe('throttle', () => {
    it('đếm theo khoá toàn cục (userId/IP), KHÔNG theo x-device-id', () => {
      const handler = AnalyticsController.prototype.ingest;
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBeLessThanOrEqual(120);
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
      expect(Reflect.getMetadata(`${THROTTLER_TRACKER}default`, handler)).toBeUndefined();
    });
  });
});
