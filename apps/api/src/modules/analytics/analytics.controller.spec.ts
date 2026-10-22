import { ValidationPipe } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEventsService } from './analytics-events.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { IngestEventsDto } from './dto/ingest-events.dto';
import { SERVER_EVENT_NAMES } from '@tubutree/shared-types';
import { THROTTLER_LIMIT, THROTTLER_TRACKER, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

describe('AnalyticsController.ingest', () => {
  it('map userId từ JWT, anonymousId ưu tiên body rồi mới tới header', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordManyBestEffort } as unknown as AnalyticsEventsService;
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
    expect(recordManyBestEffort).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'u1', anonymousId: 'body-anon-1', eventName: 'app_opened' }),
    ]);
  });

  it('user undefined (edge case) → userId null, không throw', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordManyBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc);

    await ctrl.ingest(undefined, {
      events: [{ eventId: 'e2', eventName: 'client_error', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }],
    });

    expect(recordManyBestEffort).toHaveBeenCalledWith([expect.objectContaining({ userId: null })]);
  });

  describe('ghi cả lô một lần (D9-02)', () => {
    const base = { occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp', eventName: 'screen_viewed' };
    const batch = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...base, eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, props: { i } }));
    const setup = (createMany: jest.Mock, create: jest.Mock = jest.fn().mockResolvedValue(undefined)) => {
      const prisma = { analyticsEvent: { createMany, create } } as unknown as PrismaService;
      return { ctrl: new AnalyticsController(new AnalyticsEventsService(prisma)), create };
    };

    it('50 sự kiện → đúng 1 lần createMany với 50 dòng, không INSERT từng dòng', async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 50 });
      const { ctrl, create } = setup(createMany);
      const res = await ctrl.ingest({ sub: 'u1', role: 'CUSTOMER' } as JwtPayload, { events: batch(50) } as IngestEventsDto, 'dev-1');
      expect(res).toEqual({ accepted: 50 });
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
      const arg = createMany.mock.calls[0][0];
      expect(arg.data).toHaveLength(50);
      expect(arg.skipDuplicates).toBe(true);
      expect(arg.data[0]).toMatchObject({ eventName: 'screen_viewed', userId: 'u1', anonymousId: 'dev-1', platform: 'miniapp', props: { i: 0 } });
      expect(arg.data[0].occurredAt).toEqual(new Date('2026-09-27T00:00:00Z'));
    });

    it('createMany lỗi (không phải trùng) → lùi về ghi từng dòng, accepted không đổi, không throw', async () => {
      const createMany = jest.fn().mockRejectedValue(new Error('DB down'));
      const { ctrl, create } = setup(createMany);
      const res = await ctrl.ingest(undefined, { events: batch(3) } as IngestEventsDto);
      expect(res).toEqual({ accepted: 3 });
      expect(create).toHaveBeenCalledTimes(3);
    });

    it('dòng lỗi trong lúc lùi về từng dòng bị nuốt, các dòng còn lại vẫn được ghi', async () => {
      const createMany = jest.fn().mockRejectedValue(new Error('DB down'));
      const create = jest.fn().mockRejectedValueOnce(new Error('bad row')).mockResolvedValue(undefined);
      const { ctrl } = setup(createMany, create);
      await expect(ctrl.ingest(undefined, { events: batch(3) } as IngestEventsDto)).resolves.toEqual({ accepted: 3 });
      expect(create).toHaveBeenCalledTimes(3);
    });
  });

  describe('nguồn khách (entrySource, campaign) trên phong bì sự kiện', () => {
    const base = { eventId: '11111111-1111-4111-8111-111111111111', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' };
    const run = async (extra: Record<string, unknown>) => {
      const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
      const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService);
      const dto = (await asBody(IngestEventsDto, { events: [{ ...base, eventName: 'app_opened', ...extra }] })) as IngestEventsDto;
      await ctrl.ingest({ sub: 'u1', role: 'CUSTOMER' } as JwtPayload, dto);
      return (recordManyBestEffort.mock.calls[0]![0] as Record<string, unknown>[])[0]!;
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
