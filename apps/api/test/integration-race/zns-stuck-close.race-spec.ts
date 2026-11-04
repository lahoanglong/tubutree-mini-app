import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService, type ZnsSendJobData } from '../../src/modules/notifications/notifications.service';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { createUser, warmPool } from './helpers';

/** Log ZNS kẹt vì job đã chết: các đường đóng chạy song song chỉ ghi một lần và không đè log đã có kết cục. */
describe('đóng log ZNS kẹt (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: NotificationsService;
  const sendTemplate = jest.fn().mockResolvedValue({ ok: true });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, { recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => sendTemplate.mockClear());

  const newUser = () => createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}` });
  const mkLog = (userId: string, dedupeKey: string | null, status: string) =>
    prisma.notificationLog.create({
      data: { userId, templateCode: 'IT_STUCK', channel: 'ZNS', payload: dedupeKey ? { data: {}, dedupeKey } : { data: {} }, status },
    });
  const jobOf = (logId: string): ZnsSendJobData => ({ notificationLogId: logId, phone: '0900000001', templateId: 'zt', templateData: {} });
  const row = (id: string) => prisma.notificationLog.findUniqueOrThrow({ where: { id } });

  it('hai lượt đóng song song cùng một log RETRYING: đúng một lượt ghi, lý do của lượt thắng được giữ', async () => {
    const log = await mkLog((await newUser()).id, null, 'RETRYING');
    const results = await Promise.all([svc.closeStuckZnsLog(log.id, 'lý do A'), svc.closeStuckZnsLog(log.id, 'lý do B')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await row(log.id);
    expect(after.status).toBe('FAILED');
    expect(after.error).toBe(results[0] ? 'lý do A' : 'lý do B');
  });

  it('log đã SENT không bị đổi; log đã FAILED giữ nguyên lý do cũ', async () => {
    const u = await newUser();
    const sent = await mkLog(u.id, null, 'SENT');
    const failed = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_STUCK', channel: 'ZNS', payload: { data: {} }, status: 'FAILED', error: 'lý do cũ' },
    });
    expect(await svc.closeStuckZnsLog(sent.id, 'x')).toBe(false);
    expect(await svc.closeStuckZnsLog(failed.id, 'x')).toBe(false);
    expect((await row(sent.id)).status).toBe('SENT');
    const f = await row(failed.id);
    expect([f.status, f.error]).toEqual(['FAILED', 'lý do cũ']);
  });

  it('markStuckZnsSent chỉ từ RETRYING; đua với closeStuckZnsLog thì đúng một bên thắng', async () => {
    const u = await newUser();
    const pending = await mkLog(u.id, null, 'PENDING');
    expect(await svc.markStuckZnsSent(pending.id)).toBe(false);
    expect((await row(pending.id)).status).toBe('PENDING');
    const log = await mkLog(u.id, null, 'RETRYING');
    const [sent, closed] = await Promise.all([svc.markStuckZnsSent(log.id), svc.closeStuckZnsLog(log.id, 'đóng')]);
    expect(Number(sent) + Number(closed)).toBe(1);
    expect((await row(log.id)).status).toBe(sent ? 'SENT' : 'FAILED');
  });

  it('hồi quy: log kẹt cùng dedupeKey bị đóng thì tin sau tạo được log mới và deliverZns của log mới gửi được', async () => {
    const u = await newUser();
    const key = `it-stuck:${Date.now()}`;
    const stuck = await mkLog(u.id, key, 'RETRYING');
    // Trước khi đóng: log mới cùng khoá bị hoãn vì log kia "đang gửi".
    const early = await mkLog(u.id, key, 'PENDING');
    expect(await svc.deliverZns(jobOf(early.id), false)).toBe('RETRY');
    expect(sendTemplate).not.toHaveBeenCalled();
    await svc.closeStuckZnsLog(stuck.id, 'job hỏng');
    // dedupeWhere ZNS không còn thấy log kẹt (chỉ PENDING/RETRYING/SENT tính); log `early` vẫn PENDING nên còn chặn notify() cho tới khi gửi xong.
    expect(await svc.deliverZns(jobOf(early.id), false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect((await row(stuck.id)).status).toBe('FAILED');
    expect((await row(early.id)).status).toBe('SENT');
  });

  it('hồi quy: notify() cùng dedupeKey (retryZns) bị log kẹt chặn; đóng log kẹt rồi thì tạo được log ZNS mới', async () => {
    const u = await newUser();
    const key = `it-stuck-notify:${Date.now()}`;
    await prisma.notificationTemplate.upsert({
      where: { code: 'IT_STUCK_TPL' },
      update: {},
      create: { id: 'it-stuck-tpl', code: 'IT_STUCK_TPL', channel: 'ZNS', zaloTemplateId: 'zt-it', bodyTemplate: 'x' },
    });
    // Lần gọi trước đã lưu tin trong app rồi bước ZNS kẹt: chỉ còn nhánh "gửi nốt ZNS" của retryZns.
    await prisma.notificationLog.create({ data: { userId: u.id, templateCode: 'IT_STUCK_TPL', channel: 'INAPP', payload: { body: 'x', data: {}, dedupeKey: key }, status: 'SENT' } });
    const stuck = await mkLog(u.id, key, 'RETRYING');
    const znsCount = () => prisma.notificationLog.count({ where: { userId: u.id, channel: 'ZNS' } });
    await svc.notify(u.id, 'IT_STUCK_TPL', {}, { dedupeKey: key, retryZns: true });
    expect(await znsCount()).toBe(1);
    expect(sendTemplate).not.toHaveBeenCalled();
    await svc.closeStuckZnsLog(stuck.id, 'job hỏng');
    await svc.notify(u.id, 'IT_STUCK_TPL', {}, { dedupeKey: key, retryZns: true });
    expect(await znsCount()).toBe(2);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});
