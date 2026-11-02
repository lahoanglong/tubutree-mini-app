import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService, type ZnsSendJobData } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { TierDropNoticeService, TIER_DROP_ZNS_TEMPLATE_KEY } from '../../src/modules/loyalty/tier-drop-notice.service';
import { QUEUE_NOTIFICATIONS } from '../../src/jobs/queues';
import { createUser, pinConfig, randCode, warmPool } from './helpers';

/**
 * R-181: job đã vào Redis nhưng queue.add báo lỗi quá hạn, nên catch của dispatchZns chạy xen với worker (deliverZns).
 * Hàng đợi giả: `add` ghi job rồi treo tới khi test cho nó ném lỗi; worker là lời gọi deliverZns tay ở từng điểm.
 * Mỗi ca kiểm số lần Zalo được gọi sau đêm đầu và sau lượt cron đêm sau (job mới xếp ở đêm sau cũng được worker chạy nốt).
 */
describe('ZNS: catch của dispatchZns xen với deliverZns (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: TierDropNoticeService;
  let notifications: NotificationsService;
  let restoreCfg: () => Promise<void>;
  const sendTemplate = jest.fn();
  const add = jest.fn();
  const tierId = `tier-${randCode(6)}`;
  const DAY = 864e5;
  const OK = { ok: true } as const;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        NotificationsService,
        TierDropNoticeService,
        { provide: ZnsClient, useValue: { sendTemplate } },
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: { add } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(TierDropNoticeService);
    notifications = moduleRef.get(NotificationsService);
    restoreCfg = await pinConfig(prisma, TIER_DROP_ZNS_TEMPLATE_KEY, '123456');
    await prisma.membershipTier.create({
      data: { id: tierId, name: 'Hạng thử ZNS xen', minPoints: 0, minSpending: 1_000_000, discountPct: 0, pointMultiplier: 1, perks: {}, sortOrder: 96 },
    });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { tierId }, data: { tierId: null } });
    await prisma.membershipTier.deleteMany({ where: { id: tierId } });
    await restoreCfg?.();
    await moduleRef?.close();
  });

  beforeEach(() => {
    add.mockReset().mockResolvedValue(undefined);
    sendTemplate.mockReset();
  });

  let seq = 0;
  const phone = () => `09${(Date.now() % 1e6).toString().padStart(6, '0')}${String(seq++).padStart(2, '0')}`;
  const mkUser = (until: Date) => createUser(prisma, { tierId, tierGraceUntil: until, phone: phone() });
  const znsLogs = (userId: string, code = 'TIER_DROP_NOTICE') =>
    prisma.notificationLog.findMany({ where: { userId, templateCode: code, channel: 'ZNS' }, orderBy: { sentAt: 'asc' } });
  const noticeFor = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tierDropNoticeFor;
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(cond()).toBe(true);
  };

  /** Điều khiển một lượt xếp hàng: `add` ghi job và treo tới khi `expire()` làm nó ném lỗi quá hạn. */
  function stuckQueue() {
    const jobs: ZnsSendJobData[] = [];
    let expire!: () => void;
    const gate = new Promise<never>((_, reject) => {
      expire = () => reject(new Error('Redis không phản hồi sau 2000ms'));
    });
    add.mockImplementationOnce((_name: string, job: ZnsSendJobData) => {
      jobs.push(job);
      return gate;
    });
    return { jobs, expire, added: () => waitFor(() => jobs.length === 1) };
  }

  /** Đêm sau: cron chạy lại; hàng đợi nay nhận được, worker chạy nốt mọi job mới. */
  async function nextNight() {
    const before = add.mock.calls.length;
    add.mockResolvedValue(undefined);
    const n = await svc.sendNotices();
    for (const [, job] of add.mock.calls.slice(before)) await notifications.deliverZns(job as ZnsSendJobData, false);
    return n;
  }

  it('catch chạy TRƯỚC khi worker đọc log: job đến muộn bị bỏ, đêm sau gửi đúng một lần', async () => {
    const user = await mkUser(new Date(Date.now() + 5 * DAY));
    sendTemplate.mockResolvedValue(OK);
    const q = stuckQueue();
    const notice = svc.sendNotices();
    await q.added();
    q.expire();
    expect(await notice).toBe(0);
    expect(await notifications.deliverZns(q.jobs[0]!, false)).toBe('SKIPPED');
    expect(sendTemplate).toHaveBeenCalledTimes(0);

    expect(await nextNight()).toBe(1);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(await nextNight()).toBe(0);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect((await znsLogs(user.id)).filter((l) => l.status === 'SENT')).toHaveLength(1);
  });

  it('catch chạy GIỮA LÚC worker gọi Zalo: một ZNS tới khách, khách tính đã báo, đêm sau không gửi thêm', async () => {
    const until = new Date(Date.now() + 5 * DAY);
    const user = await mkUser(until);
    let finishSend!: () => void;
    sendTemplate.mockImplementationOnce(() => new Promise((r) => { finishSend = () => r(OK); })).mockResolvedValue(OK);
    const q = stuckQueue();
    const notice = svc.sendNotices();
    await q.added();
    const worker = notifications.deliverZns(q.jobs[0]!, false);
    await waitFor(() => sendTemplate.mock.calls.length === 1);
    q.expire();
    const night1 = await notice;
    finishSend();
    expect(await worker).toBe('SENT');
    const night2 = await nextNight();

    expect({ night1, night2, zaloCalls: sendTemplate.mock.calls.length }).toEqual({ night1: 1, night2: 0, zaloCalls: 1 });
    expect((await noticeFor(user.id))?.getTime()).toBe(until.getTime());
    const logs = await znsLogs(user.id);
    expect(logs.map((l) => l.status)).toEqual(['SENT']);
    expect((logs[0]!.payload as { dedupeKey: string }).dedupeKey).toBe(`tier-drop:${until.toISOString()}`);
  });

  it('catch chạy SAU khi worker đã ghi SENT: không ném lỗi, sendNotices đếm đủ một khách', async () => {
    const user = await mkUser(new Date(Date.now() + 5 * DAY));
    sendTemplate.mockResolvedValue(OK);
    const q = stuckQueue();
    const notice = svc.sendNotices();
    await q.added();
    expect(await notifications.deliverZns(q.jobs[0]!, false)).toBe('SENT');
    q.expire();
    const night1 = await notice;
    const night2 = await nextNight();

    expect({ night1, night2, zaloCalls: sendTemplate.mock.calls.length }).toEqual({ night1: 1, night2: 0, zaloCalls: 1 });
    expect(await noticeFor(user.id)).not.toBeNull();
  });

  it('catch chạy khi log đang RETRYING (Zalo lỗi tạm thời lượt đầu): không ném lỗi, lượt thử lại gửi được, đêm sau không gửi thêm', async () => {
    const user = await mkUser(new Date(Date.now() + 5 * DAY));
    sendTemplate.mockResolvedValueOnce({ ok: false, retryable: true, code: -100, reason: 'tạm lỗi' }).mockResolvedValue(OK);
    const q = stuckQueue();
    const notice = svc.sendNotices();
    await q.added();
    expect(await notifications.deliverZns(q.jobs[0]!, false)).toBe('RETRY');
    q.expire();
    const night1 = await notice;
    expect(await notifications.deliverZns(q.jobs[0]!, false)).toBe('SENT');
    const night2 = await nextNight();

    expect({ night1, night2, zaloCalls: sendTemplate.mock.calls.length }).toEqual({ night1: 1, night2: 0, zaloCalls: 2 });
    expect((await znsLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
  });

  it('tin thường (không khoá chống trùng): job đến muộn sau catch vẫn được gửi, đúng một lần', async () => {
    const user = await createUser(prisma, { phone: phone() });
    sendTemplate.mockResolvedValue(OK);
    const q = stuckQueue();
    const sent = notifications.notify(user.id, 'ORDER_CONFIRMED', { orderCode: 'X1' }, { znsTemplateId: '123456' });
    await q.added();
    q.expire();
    await sent;
    expect((await znsLogs(user.id, 'ORDER_CONFIRMED')).map((l) => l.status)).toEqual(['FAILED']);

    expect(await notifications.deliverZns(q.jobs[0]!, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect((await znsLogs(user.id, 'ORDER_CONFIRMED')).map((l) => l.status)).toEqual(['SENT']);
  });
});
