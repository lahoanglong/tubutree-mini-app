import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService, type ZnsSendJobData } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import type { ZaloOaTokenService } from '../../src/modules/integrations/zns/zalo-oa-token.service';
import { createUser, warmPool, uniquePhone } from './helpers';

/** Worker ZNS chạy 5 job song song: hai log cùng (khách, dedupeKey) chỉ gửi Zalo một lần dù Zalo trả chậm. */
describe('deliverZns song song cùng dedupeKey (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let zns: Server;
  let hits = 0;
  let svc: NotificationsService;

  beforeAll(async () => {
    zns = createServer((req, res) => {
      hits += 1;
      req.resume();
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 0, message: 'Success' }));
        }, 200);
      });
    });
    await new Promise<void>((resolve) => zns.listen(0, '127.0.0.1', resolve));
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const client = new ZnsClient({ get: () => `http://127.0.0.1:${(zns.address() as AddressInfo).port}` } as never, { getAccessToken: async () => 'tok' } as unknown as ZaloOaTokenService);
    svc = new NotificationsService(prisma, client, { recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => zns.close(() => resolve()));
    await moduleRef?.close();
  });

  beforeEach(() => {
    hits = 0;
  });

  const mkLog = (userId: string, dedupeKey: string, n: number, over: { sentAt?: Date; status?: string } = {}, db: Pick<PrismaService, 'notificationLog'> = prisma) =>
    db.notificationLog.create({
      data: { userId, templateCode: 'IT_DEDUPE', channel: 'ZNS', payload: { data: { n: String(n) }, dedupeKey }, status: over.status ?? 'PENDING', ...(over.sentAt ? { sentAt: over.sentAt } : {}) },
    });
  const jobOf = (logId: string, n: number): ZnsSendJobData => ({ notificationLogId: logId, phone: '0900000001', templateId: 'zt', templateData: { n: String(n) } });
  const newUser = () => createUser(prisma, { phone: uniquePhone() });

  it('log A có sentAt sớm hơn nhưng commit sau log B (hai tx chồng nhau), hai worker song song: Zalo nhận đúng một lần', async () => {
    const u = await newUser();
    const key = `it-dedupe:${Date.now()}`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let aId = '';
    const txA = prisma.$transaction(async (tx) => {
      aId = (await mkLog(u.id, key, 1, { sentAt: new Date(Date.now() - 5_000) }, tx)).id;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 100));
    const b = await mkLog(u.id, key, 2);
    // Worker của B chạy khi log A (sentAt sớm hơn) chưa commit nên chưa thấy A; A commit trong lúc B còn đang gọi Zalo rồi worker của A chạy.
    const deliverB = svc.deliverZns(jobOf(b.id, 2), false);
    await new Promise((r) => setTimeout(r, 50));
    release();
    await txA;
    const outcomes = [await svc.deliverZns(jobOf(aId, 1), false), await deliverB];
    expect(outcomes.filter((o) => o === 'SENT')).toHaveLength(1);
    expect(outcomes.filter((o) => o !== 'SENT').every((o) => o === 'RETRY' || o === 'SKIPPED')).toBe(true);
    expect(hits).toBe(1);

    expect(outcomes[1]).toBe('SENT');
    expect(outcomes[0]).toBe('RETRY');
    expect(await svc.deliverZns(jobOf(aId, 1), false)).toBe('SKIPPED');
    expect(hits).toBe(1);
  });

  it('nhiều worker (6) cùng khoá chạy cùng lúc: đúng một lần gọi Zalo', async () => {
    const u = await newUser();
    const key = `it-dedupe-many:${Date.now()}`;
    const logs = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => mkLog(u.id, key, n)));
    const outcomes = await Promise.all(logs.map((l, i) => svc.deliverZns(jobOf(l.id, i), false)));
    expect(outcomes.filter((o) => o === 'SENT')).toHaveLength(1);
    expect(hits).toBe(1);
  });

  it('log cùng khoá kia đã FAILED hẳn: log này nhận quyền và gửi', async () => {
    const u = await newUser();
    const key = `it-dedupe-failed:${Date.now()}`;
    await mkLog(u.id, key, 1, { status: 'FAILED' });
    const b = await mkLog(u.id, key, 2);
    expect(await svc.deliverZns(jobOf(b.id, 2), false)).toBe('SENT');
    expect(hits).toBe(1);
  });

  it('log kia đang RETRYING: hoãn (RETRY), log vẫn PENDING; khi log kia SENT thì bị bỏ qua', async () => {
    const u = await newUser();
    const key = `it-dedupe-wait:${Date.now()}`;
    const a = await mkLog(u.id, key, 1, { status: 'RETRYING' });
    const b = await mkLog(u.id, key, 2);
    expect(await svc.deliverZns(jobOf(b.id, 2), false)).toBe('RETRY');
    expect((await prisma.notificationLog.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('PENDING');
    expect(hits).toBe(0);
    await prisma.notificationLog.update({ where: { id: a.id }, data: { status: 'SENT' } });
    expect(await svc.deliverZns(jobOf(b.id, 2), false)).toBe('SKIPPED');
    expect(hits).toBe(0);
  });

  it('dedupeWithinMs: log SENT cũ hơn cửa sổ không chặn tin mới cùng khoá', async () => {
    const u = await newUser();
    const key = `it-dedupe-window:${Date.now()}`;
    await mkLog(u.id, key, 1, { status: 'SENT', sentAt: new Date(Date.now() - 2 * 3_600_000) });
    const b = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_DEDUPE', channel: 'ZNS', payload: { data: {}, dedupeKey: key, dedupeWithinMs: 3_600_000 }, status: 'PENDING' },
    });
    expect(await svc.deliverZns(jobOf(b.id, 2), false)).toBe('SENT');
    expect(hits).toBe(1);
  });

  it('newUser: hai khách tạo liên tiếp trong cùng một mili giây không đụng khoá duy nhất của phone', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const a = await newUser();
      const b = await newUser();
      expect(a.phone).not.toBe(b.phone);
    } finally {
      now.mockRestore();
    }
  });

  it('khoá khác nhau thì cả hai đều gửi', async () => {
    const a = await mkLog((await newUser()).id, `it-dedupe-a:${Date.now()}`, 1);
    const b = await mkLog((await newUser()).id, `it-dedupe-b:${Date.now()}`, 2);
    expect(await Promise.all([svc.deliverZns(jobOf(a.id, 1), false), svc.deliverZns(jobOf(b.id, 2), false)])).toEqual(['SENT', 'SENT']);
    expect(hits).toBe(2);
  });
});
