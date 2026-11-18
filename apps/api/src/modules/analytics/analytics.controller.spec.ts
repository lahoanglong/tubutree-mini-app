import { createHash } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEventsService } from './analytics-events.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { IngestEventsDto, WebBeaconDto, WebIngestEventsDto } from './dto/ingest-events.dto';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SERVER_EVENT_NAMES } from '@tubutree/shared-types';
import { THROTTLER_LIMIT, THROTTLER_TRACKER, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { BODY_TOO_COMPLEX_MESSAGE } from '../../common/body-limits';
import { VitalsIngestGate } from './vitals/vitals-ingest.gate';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Cổng số đo cho các ca không thử số đo: cho mọi sự kiện đi qua. */
const passGate = { filter: async <T,>(events: T[]) => events } as unknown as VitalsIngestGate;

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

describe('AnalyticsController.ingest', () => {
  it('map userId từ JWT, anonymousId ưu tiên body rồi mới tới header', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordManyBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc, passGate);

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

  it('không có anonymousId ở body: dùng băm sha256 cắt 32 ký tự của X-Device-Id, không chép header thô (deviceId là khoá đăng nhập khách)', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);

    await ctrl.ingest(
      { sub: 'u1', role: 'CUSTOMER' } as JwtPayload,
      { events: [{ eventId: 'e1', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }] },
      'd_secretdevice0001',
    );

    const [rec] = recordManyBestEffort.mock.calls[0]![0] as Array<{ anonymousId: string }>;
    expect(rec!.anonymousId).toBe(createHash('sha256').update('d_secretdevice0001').digest('hex').slice(0, 32));
    expect(rec!.anonymousId).not.toContain('secretdevice');
    expect(rec!.anonymousId).toHaveLength(32);
  });

  it('không có anonymousId và không có header → null', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
    await ctrl.ingest(undefined, { events: [{ eventId: 'e1', eventName: 'app_opened', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }] });
    expect((recordManyBestEffort.mock.calls[0]![0] as Array<{ anonymousId: unknown }>)[0]!.anonymousId).toBeNull();
  });

  it('user undefined (edge case) → userId null, không throw', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const svc = { recordManyBestEffort } as unknown as AnalyticsEventsService;
    const ctrl = new AnalyticsController(svc, passGate);

    await ctrl.ingest(undefined, {
      events: [{ eventId: 'e2', eventName: 'client_error', occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp' }],
    });

    expect(recordManyBestEffort).toHaveBeenCalledWith([expect.objectContaining({ userId: null })]);
  });

  describe('recycle_funnel_step (W176)', () => {
    const ev = (props: Record<string, unknown> | undefined, platform: 'web' | 'miniapp' = 'web', i = 0) => ({
      eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      eventName: 'recycle_funnel_step',
      occurredAt: '2026-11-16T00:00:00Z',
      platform,
      ...(props ? { props } : {}),
    });

    it('DTO nhận tên mới của client, và vẫn chặn tên server recycle_confirmed', async () => {
      await expect(asBody(IngestEventsDto, { events: [ev({ step: 'enter', surface: 'web' })] })).resolves.toBeDefined();
      await expect(
        asBody(IngestEventsDto, { events: [{ ...ev({ step: 'enter', surface: 'web' }), eventName: 'recycle_confirmed' }] }),
      ).rejects.toThrow();
    });

    it('ghi đủ 5 bước hợp lệ cùng lane, accepted đếm đúng', async () => {
      const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
      const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
      const steps = ['enter', 'phone_saved', 'geo_granted', 'geo_denied', 'submitted'] as const;
      const res = await ctrl.ingest(undefined, {
        events: steps.map((step, i) => ev({ step, surface: 'miniapp', lane: 'DROP_OFF' }, 'miniapp', i)),
      });
      expect(res).toEqual({ accepted: 5 });
      expect(recordManyBestEffort.mock.calls[0]![0]).toHaveLength(5);
    });

    it('W180: nhận hai bước của thẻ mời đơn sau (second_order_shown, second_order_click) với lane PICKUP', async () => {
      const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
      const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
      const res = await ctrl.ingest(undefined, {
        events: [ev({ step: 'second_order_shown', surface: 'web', lane: 'PICKUP' }, 'web', 0), ev({ step: 'second_order_click', surface: 'miniapp', lane: 'PICKUP' }, 'miniapp', 1)],
      });
      expect(res).toEqual({ accepted: 2 });
      expect(recordManyBestEffort.mock.calls[0]![0].map((e: { props: { step: string } }) => e.props.step)).toEqual(['second_order_shown', 'second_order_click']);
    });

    it('sai khuôn (step lạ, surface lệch platform, lane bẩn, thiếu props) bị bỏ riêng, sự kiện khác trong lô vẫn được ghi, không 400', async () => {
      const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
      const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
      const res = await ctrl.ingest(undefined, {
        events: [
          ev({ step: 'enter', surface: 'web' }, 'web', 0),
          ev({ step: 'hacked', surface: 'web' }, 'web', 1),
          ev({ step: 'enter', surface: 'miniapp' }, 'web', 2),
          ev({ step: 'enter', surface: 'web', lane: '<script>' }, 'web', 3),
          ev({ step: 'enter', surface: 'web', lane: 7 }, 'web', 4),
          ev(undefined, 'web', 5),
          { eventId: '00000000-0000-4000-8000-0000000000aa', eventName: 'app_opened', occurredAt: '2026-11-16T00:00:00Z', platform: 'web' },
        ],
      });
      expect(res).toEqual({ accepted: 2 });
      const rec = recordManyBestEffort.mock.calls[0]![0] as Array<{ eventName: string }>;
      expect(rec.map((r) => r.eventName)).toEqual(['recycle_funnel_step', 'app_opened']);
    });
  });

  describe('ghi cả lô một lần (D9-02)', () => {
    const base = { occurredAt: '2026-09-27T00:00:00Z', platform: 'miniapp', eventName: 'screen_viewed' };
    const batch = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...base, eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, props: { route: '/', msToContent: i } }));
    const setup = (createMany: jest.Mock, create: jest.Mock = jest.fn().mockResolvedValue(undefined)) => {
      const prisma = { analyticsEvent: { createMany, create } } as unknown as PrismaService;
      return { ctrl: new AnalyticsController(new AnalyticsEventsService(prisma), passGate), create };
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
      expect(arg.data[0]).toMatchObject({ eventName: 'screen_viewed', userId: 'u1', anonymousId: createHash('sha256').update('dev-1').digest('hex').slice(0, 32), platform: 'miniapp', props: { route: '/', msToContent: 0 } });
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
      const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
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

describe('Sự kiện website (khách ẩn danh được gửi)', () => {
  const SID = '0b9c2f4e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
  const AID = '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716';
  const ev = (i: number, over: Record<string, unknown> = {}) => ({
    eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    eventName: 'pdp_action',
    occurredAt: '2026-11-16T15:00:00Z',
    platform: 'web',
    anonymousId: AID,
    sessionId: SID,
    props: { action: 'add_to_cart', productSlug: 'nuoc-rua-chen-fuwa3e' },
    ...over,
  });
  const setup = () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    return { ctrl: new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate), recordManyBestEffort };
  };
  const rows = (m: jest.Mock) => m.mock.calls[0]![0] as Array<Record<string, unknown>>;

  it('route web là @Public, gắn OptionalJwtAuthGuard; beacon @Public; trần ẩn danh 60 lô/phút và 30 beacon/phút', () => {
    for (const [h, limit] of [
      [AnalyticsController.prototype.ingestWeb, 60],
      [AnalyticsController.prototype.ingestWebBeacon, 30],
    ] as const) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, h)).toBe(limit);
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, h)).toBe(60_000);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController.prototype.ingestWeb)).toEqual([OptionalJwtAuthGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AnalyticsController.prototype.ingest)).toBeUndefined();
  });

  it('khách ẩn danh: ghi userId null, giữ anonymousId và sessionId; có JWT thì gắn userId', async () => {
    const a = setup();
    await expect(a.ctrl.ingestWeb(undefined, { events: [ev(1)] } as WebIngestEventsDto)).resolves.toEqual({ accepted: 1 });
    expect(rows(a.recordManyBestEffort)[0]).toMatchObject({ userId: null, anonymousId: AID, sessionId: SID, platform: 'web', eventName: 'pdp_action' });
    const b = setup();
    await b.ctrl.ingestWeb({ sub: 'u9', role: 'CUSTOMER' } as JwtPayload, { events: [ev(1)] } as WebIngestEventsDto);
    expect(rows(b.recordManyBestEffort)[0]).toMatchObject({ userId: 'u9' });
  });

  it('bỏ riêng sự kiện platform miniapp, props lạ, chuỗi giống SĐT; mã phiên/ẩn danh không phải UUID thành null', async () => {
    const { ctrl, recordManyBestEffort } = setup();
    const res = await ctrl.ingestWeb(undefined, {
      events: [
        ev(1, { platform: 'miniapp' }),
        ev(2, { props: { action: 'share', productSlug: 'a', email: 'x' } }),
        ev(3, { eventName: 'search_performed', props: { q: '0912345678', resultsCount: 0 } }),
        ev(4, { sessionId: 'not-a-uuid', anonymousId: 'abc' }),
      ],
    } as WebIngestEventsDto);
    expect(res).toEqual({ accepted: 1 });
    expect(rows(recordManyBestEffort)).toHaveLength(1);
    expect(rows(recordManyBestEffort)[0]).toMatchObject({ eventId: ev(4).eventId, sessionId: null, anonymousId: null });
  });

  it('không lưu appVersion/notificationId/refCode/storefrontSlug do web gửi', async () => {
    const { ctrl, recordManyBestEffort } = setup();
    await ctrl.ingestWeb(undefined, {
      events: [ev(1, { appVersion: 'x'.repeat(64), notificationId: 'n1', refCode: 'r'.repeat(64), storefrontSlug: 'shop' })],
    } as WebIngestEventsDto);
    expect(rows(recordManyBestEffort)[0]).toMatchObject({ appVersion: null, notificationId: null, refCode: null, storefrontSlug: null });
  });

  it('DTO web: tối đa 20 sự kiện mỗi lô', async () => {
    await expect(asBody(WebIngestEventsDto, { events: Array.from({ length: 20 }, (_, i) => ev(i)) })).resolves.toBeDefined();
    await expect(asBody(WebIngestEventsDto, { events: Array.from({ length: 21 }, (_, i) => ev(i)) })).rejects.toThrow();
  });

  it('beacon: đọc payload JSON trong thân form, ghi như khách ẩn danh, trả 204', async () => {
    const { ctrl, recordManyBestEffort } = setup();
    const dto = (await asBody(WebBeaconDto, { payload: JSON.stringify({ events: [ev(1), ev(2, { eventName: 'checkout_abandoned', props: { lastStep: 'started' } })] }) })) as WebBeaconDto;
    await expect(ctrl.ingestWebBeacon(dto)).resolves.toBeUndefined();
    expect(rows(recordManyBestEffort).map((r) => [r.eventName, r.userId])).toEqual([
      ['pdp_action', null],
      ['checkout_abandoned', null],
    ]);
    expect(Reflect.getMetadata('__httpCode__', AnalyticsController.prototype.ingestWebBeacon)).toBe(204);
  });

  it('beacon: payload hỏng, sai khuôn hoặc tên sự kiện máy chủ → 400, không ghi gì', async () => {
    const { ctrl, recordManyBestEffort } = setup();
    await expect(ctrl.ingestWebBeacon({ payload: '{not json' })).rejects.toThrow('payload không phải JSON');
    await expect(ctrl.ingestWebBeacon({ payload: JSON.stringify({ events: [ev(1, { eventName: 'order_placed' })] }) })).rejects.toThrow('payload sai khuôn');
    await expect(ctrl.ingestWebBeacon({ payload: JSON.stringify({ events: [ev(1)], extra: 1 }) })).rejects.toThrow('payload sai khuôn');
    await expect(ctrl.ingestWebBeacon({ payload: JSON.stringify({ events: Array.from({ length: 21 }, (_, i) => ev(i)) }) })).rejects.toThrow('payload sai khuôn');
    expect(recordManyBestEffort).not.toHaveBeenCalled();
  });

  it('beacon: JSON nhiều khoá hoặc lồng sâu bị từ chối trước khi dựng DTO; payload quá 32 KB không qua DTO', async () => {
    const { ctrl, recordManyBestEffort } = setup();
    const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`a${i}`, 0]));
    await expect(ctrl.ingestWebBeacon({ payload: JSON.stringify({ events: [ev(1, { props: wide })] }) })).rejects.toThrow(BODY_TOO_COMPLEX_MESSAGE);
    let deep: unknown = 0;
    for (let i = 0; i < 12; i++) deep = { d: deep };
    await expect(ctrl.ingestWebBeacon({ payload: JSON.stringify({ events: [ev(1, { props: { x: deep } })] }) })).rejects.toThrow(BODY_TOO_COMPLEX_MESSAGE);
    expect(recordManyBestEffort).not.toHaveBeenCalled();
    await expect(asBody(WebBeaconDto, { payload: 'x'.repeat(32_001) })).rejects.toThrow();
  });
});

describe('/events (Mini App) áp danh sách trắng props', () => {
  it('bỏ sự kiện có khoá lạ hoặc chuỗi giống email, giữ sự kiện đúng', async () => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const ctrl = new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, passGate);
    const base = { occurredAt: '2026-11-16T15:00:00Z', platform: 'miniapp' as const };
    const res = await ctrl.ingest({ sub: 'u1', role: 'CUSTOMER' } as JwtPayload, {
      events: [
        { ...base, eventId: 'a', eventName: 'cart_viewed', props: { itemCount: 1, subtotalBucket: '0-99k' } },
        { ...base, eventId: 'b', eventName: 'cart_viewed', props: { itemCount: 1, subtotalBucket: '0-99k', address: 'x' } },
        { ...base, eventId: 'c', eventName: 'search_performed', props: { q: 'an@gmail.com', resultsCount: 1 } },
      ],
    } as IngestEventsDto);
    expect(res).toEqual({ accepted: 1 });
    expect((recordManyBestEffort.mock.calls[0]![0] as Array<{ eventId: string }>).map((r) => r.eventId)).toEqual(['a']);
  });
});

describe('số đo tốc độ (web_vital, mini_vital)', () => {
  const AID = '3f2b0a91-0123-4567-8901-a23456789012';
  const vital = (i: number, over: Record<string, unknown> = {}) => ({
    eventId: `00000000-0000-4000-8000-00000000000${i}`,
    eventName: 'web_vital',
    occurredAt: '2026-11-18T15:00:00Z',
    platform: 'web',
    anonymousId: AID,
    sessionId: AID,
    props: { name: 'LCP', value: 2100, rating: 'good', route: '/san-pham/:slug', vp: 's', et: '4g', nav: 'navigate' },
    ...over,
  });
  const setup = (flag: unknown) => {
    const recordManyBestEffort = jest.fn().mockResolvedValue(undefined);
    const gate = new VitalsIngestGate({ get: async () => flag } as unknown as SystemConfigService);
    return { ctrl: new AnalyticsController({ recordManyBestEffort } as unknown as AnalyticsEventsService, gate), recordManyBestEffort };
  };

  it('beacon web: cờ bật thì ghi, cờ tắt thì bỏ', async () => {
    const payload = JSON.stringify({ events: [vital(1)] });
    const on = setup(true);
    await on.ctrl.ingestWebBeacon({ payload });
    expect(on.recordManyBestEffort.mock.calls[0]![0]).toEqual([expect.objectContaining({ eventName: 'web_vital', userId: null, props: expect.objectContaining({ name: 'LCP', value: 2100 }) })]);
    const off = setup(false);
    await off.ctrl.ingestWebBeacon({ payload });
    expect(off.recordManyBestEffort.mock.calls[0]![0]).toEqual([]);
  });

  it('URL thô, giá trị vô lý và số đo của nền tảng khác bị bỏ dù cờ bật', async () => {
    const { ctrl, recordManyBestEffort } = setup(true);
    const res = await ctrl.ingestWeb(undefined, {
      events: [
        vital(1, { props: { name: 'LCP', value: 2100, route: '/san-pham/nuoc-giat-cho-be-pineboo-2-1l-22a73c', vp: 's' } }),
        vital(2, { props: { name: 'LCP', value: 600_000, route: '/', vp: 's' } }),
        vital(3, { props: { name: 'READY', value: 100, route: '/', vp: 's' } }),
        vital(4, { eventName: 'mini_vital', props: { name: 'LCP', value: 100, route: '/', vp: 's' } }),
        vital(5, { props: { name: 'CLS', value: 0.05, route: '/', vp: 'l' } }),
      ],
    } as WebIngestEventsDto);
    expect(res).toEqual({ accepted: 1 });
    expect((recordManyBestEffort.mock.calls[0]![0] as Array<{ props: { name: string } }>).map((r) => r.props.name)).toEqual(['CLS']);
  });

  it('Mini App gửi mini_vital qua /events: dòng ghi không mang userId, mã phiên hay nguồn vào', async () => {
    const { ctrl, recordManyBestEffort } = setup(true);
    await ctrl.ingest({ sub: 'u1', role: 'CUSTOMER' } as JwtPayload, {
      events: [
        vital(1, { eventName: 'mini_vital', platform: 'miniapp', entrySource: 'zalo_oa', campaign: 'tet', props: { name: 'READY', value: 2300, route: '/', vp: 's' } }),
      ],
    } as IngestEventsDto, 'device-1');
    expect(recordManyBestEffort.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ eventName: 'mini_vital', userId: null, anonymousId: null, sessionId: null, entrySource: null, campaign: null }),
    ]);
  });
});
