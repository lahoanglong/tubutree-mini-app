import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService, type ZnsSendJobData } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import type { ZaloOaTokenService } from '../../src/modules/integrations/zns/zalo-oa-token.service';
import { createUser, warmPool } from './helpers';

/**
 * R2-ENGAGE-1 / R2-ENGAGE-2 trên Postgres thật + máy chủ ZNS giả: Zalo trả HTTP 200 kèm {error:-124} thì thông báo
 * KHÔNG được ghi SENT; mã + lý do nằm ở cột error; lỗi tạm thời giữ RETRYING cho tới lượt cuối; notify() chỉ xếp job.
 */
describe('Gửi ZNS: HTTP 200 kèm lỗi trong body (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let zns: Server;
  let reply: { status: number; body: unknown } = { status: 200, body: { error: 0, message: 'Success' } };
  let hits = 0;
  const queued: ZnsSendJobData[] = [];

  async function build(withQueue: boolean) {
    const tokens = { getAccessToken: async () => 'tok' } as unknown as ZaloOaTokenService;
    const client = new ZnsClient(
      { get: () => `http://127.0.0.1:${(zns.address() as AddressInfo).port}` } as never,
      tokens,
    );
    const add = jest.fn(async (_name: string, data: ZnsSendJobData) => {
      queued.push(data);
    });
    const svc = new NotificationsService(
      prisma,
      client,
      { recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService,
      withQueue ? ({ add } as never) : undefined,
    );
    return { svc, add };
  }

  beforeAll(async () => {
    zns = createServer((req, res) => {
      hits += 1;
      req.resume();
      req.on('end', () => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => zns.listen(0, '127.0.0.1', resolve));
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await prisma.notificationTemplate.upsert({
      where: { code: 'IT_ZNS_DELIVERY' },
      create: { id: 'it-zns-delivery', code: 'IT_ZNS_DELIVERY', channel: 'ZNS', zaloTemplateId: '231570', bodyTemplate: 'Đơn {{order_code}}' },
      update: { channel: 'ZNS', zaloTemplateId: '231570' },
    });
  });

  afterAll(async () => {
    await prisma.notificationTemplate.deleteMany({ where: { code: 'IT_ZNS_DELIVERY' } });
    await new Promise<void>((resolve) => zns.close(() => resolve()));
    await moduleRef?.close();
  });

  beforeEach(() => {
    hits = 0;
    queued.length = 0;
    reply = { status: 200, body: { error: 0, message: 'Success', data: { msg_id: 'm1' } } };
  });

  const znsLog = async (userId: string) =>
    prisma.notificationLog.findFirstOrThrow({ where: { userId, channel: 'ZNS' } });

  it('có queue: notify() không gọi Zalo, log PENDING; HTTP 200 + {error:-118} → FAILED ngay + mã/lý do', async () => {
    const { svc } = await build(true);
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    await svc.notify(u.id, 'IT_ZNS_DELIVERY', { order_code: 'IT1' });
    expect(hits).toBe(0);
    expect((await znsLog(u.id)).status).toBe('PENDING');
    expect(queued).toHaveLength(1);

    reply = { status: 200, body: { error: -118, message: 'user not exist' } };
    expect(await svc.deliverZns(queued[0]!, false)).toBe('FAILED');
    const log = await znsLog(u.id);
    expect(log.status).toBe('FAILED');
    expect(log.error).toContain('-118');
    expect(log.error).toContain('user not exist');
    expect(hits).toBe(1);
  });

  it('HTTP 200 + {error:-124} không bao giờ là SENT: còn lượt thì RETRYING, kèm lý do', async () => {
    const { svc } = await build(true);
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    await svc.notify(u.id, 'IT_ZNS_DELIVERY', { order_code: 'IT0' });
    reply = { status: 200, body: { error: -124, message: 'template not approved' } };
    expect(await svc.deliverZns(queued[0]!, false)).toBe('RETRY');
    expect(await znsLog(u.id)).toMatchObject({ status: 'RETRYING', error: expect.stringContaining('template not approved') });
  });

  it('lỗi tạm thời (HTTP 503) → RETRYING rồi thành công ở lượt sau → SENT, xoá lỗi', async () => {
    const { svc } = await build(true);
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    await svc.notify(u.id, 'IT_ZNS_DELIVERY', { order_code: 'IT2' });

    reply = { status: 503, body: 'bad gateway' };
    expect(await svc.deliverZns(queued[0]!, false)).toBe('RETRY');
    expect(await znsLog(u.id)).toMatchObject({ status: 'RETRYING', error: expect.stringContaining('503') });

    reply = { status: 200, body: { error: 0, message: 'Success' } };
    expect(await svc.deliverZns(queued[0]!, false)).toBe('SENT');
    expect(await znsLog(u.id)).toMatchObject({ status: 'SENT', error: null });
  });

  it('lỗi tạm thời ở lượt cuối → FAILED; chạy lặp job đã SENT không gửi lần hai', async () => {
    const { svc } = await build(true);
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    await svc.notify(u.id, 'IT_ZNS_DELIVERY', { order_code: 'IT3' });
    reply = { status: 200, body: { error: -100, message: 'system error' } };
    expect(await svc.deliverZns(queued[0]!, true)).toBe('FAILED');
    expect((await znsLog(u.id)).status).toBe('FAILED');

    const v = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    await svc.notify(v.id, 'IT_ZNS_DELIVERY', { order_code: 'IT4' });
    reply = { status: 200, body: { error: 0, message: 'Success' } };
    const before = hits;
    await svc.deliverZns(queued[1]!, false);
    await svc.deliverZns(queued[1]!, false);
    expect(hits - before).toBe(1);
  });

  it('không có queue: gửi ngay, {error != 0} vẫn không phải SENT', async () => {
    const { svc } = await build(false);
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    reply = { status: 200, body: { error: -108, message: 'invalid phone' } };
    await svc.notify(u.id, 'IT_ZNS_DELIVERY', { order_code: 'IT5' });
    expect(await znsLog(u.id)).toMatchObject({ status: 'FAILED', error: expect.stringContaining('-108') });
  });
});
