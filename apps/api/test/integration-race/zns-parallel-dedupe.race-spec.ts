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

  async function twoLogs(dedupeKey: string) {
    const u = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
    const jobs: ZnsSendJobData[] = [];
    for (const i of [1, 2]) {
      const log = await prisma.notificationLog.create({
        data: { userId: u.id, templateCode: 'IT_DEDUPE', channel: 'ZNS', payload: { data: { n: String(i) }, dedupeKey }, status: 'PENDING' },
      });
      jobs.push({ notificationLogId: log.id, phone: '0900000001', templateId: 'zt', templateData: { n: String(i) } });
    }
    return { u, jobs };
  }

  it('hai job cùng dedupeKey chạy cùng lúc: Zalo nhận đúng một lần, log sau bị đóng', async () => {
    const { u, jobs } = await twoLogs(`it-dedupe:${Date.now()}`);
    const outcomes = await Promise.all(jobs.map((j) => svc.deliverZns(j, false)));
    expect(outcomes.sort()).toEqual(['SENT', 'SKIPPED']);
    expect(hits).toBe(1);
    const logs = await prisma.notificationLog.findMany({ where: { userId: u.id, channel: 'ZNS' }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }] });
    expect(logs.map((l) => l.status)).toEqual(['SENT', 'FAILED']);
    expect(logs[1]!.error).toContain(logs[0]!.id);
  });

  it('khoá khác nhau thì cả hai đều gửi', async () => {
    const a = await twoLogs(`it-dedupe-a:${Date.now()}`);
    const b = await twoLogs(`it-dedupe-b:${Date.now()}`);
    const outcomes = await Promise.all([a.jobs[0]!, b.jobs[0]!].map((j) => svc.deliverZns(j, false)));
    expect(outcomes).toEqual(['SENT', 'SENT']);
    expect(hits).toBe(2);
  });
});
