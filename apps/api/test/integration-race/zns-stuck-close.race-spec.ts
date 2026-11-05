import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService, ZNS_REVIEW_PREFIX, type ZnsSendJobData } from '../../src/modules/notifications/notifications.service';
import { ZnsStuckLogCron } from '../../src/modules/notifications/zns-stuck-log.cron';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { createUser, warmPool, uniquePhone } from './helpers';

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

  const newUser = () => createUser(prisma, { phone: uniquePhone() });
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

  it('đóng với from=[PENDING]: log đã sang RETRYING giữa lúc quét và lúc ghi thì không bị đóng', async () => {
    const log = await mkLog((await newUser()).id, null, 'PENDING');
    await prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'RETRYING' } });
    expect(await svc.closeStuckZnsLog(log.id, 'mất job', ['PENDING'])).toBe(false);
    expect((await row(log.id)).status).toBe('RETRYING');
  });

  it('job sống lại (khôi phục Redis, retry tay) sau khi log kẹt bị đóng: deliverZns ra SKIPPED, Zalo không được gọi, khoá đã nhả cho log mới', async () => {
    const u = await newUser();
    const key = `it-stuck-revive:${Date.now()}`;
    const stuck = await mkLog(u.id, key, 'RETRYING');
    await svc.closeStuckZnsLog(stuck.id, 'job hỏng');
    const after = await row(stuck.id);
    expect(after.payload).toMatchObject({ dedupeKey: `${key}:failed:${stuck.id}` });
    expect(await svc.deliverZns(jobOf(stuck.id), false)).toBe('SKIPPED');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect((await row(stuck.id)).status).toBe('FAILED');
  });

  it('worker còn sống ghi SENT sau khi log bị đóng và nhả khoá: khoá gốc được khôi phục trong cùng câu ghi, notify(retryZns) cùng khoá bị chặn', async () => {
    const u = await newUser();
    const key = `it-stuck-revive-sent:${Date.now()}`;
    await prisma.notificationTemplate.upsert({
      where: { code: 'IT_STUCK_TPL' },
      update: {},
      create: { id: 'it-stuck-tpl', code: 'IT_STUCK_TPL', channel: 'ZNS', zaloTemplateId: 'zt-it', bodyTemplate: 'x' },
    });
    await prisma.notificationLog.create({ data: { userId: u.id, templateCode: 'IT_STUCK_TPL', channel: 'INAPP', payload: { body: 'x', data: {}, dedupeKey: key }, status: 'SENT' } });
    const stuck = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_STUCK_TPL', channel: 'ZNS', payload: { data: { a: '1' }, dedupeKey: key, dedupeWithinMs: 3_600_000 }, status: 'RETRYING' },
    });
    await svc.closeStuckZnsLog(stuck.id, 'job hỏng');
    expect((await row(stuck.id)).payload).toMatchObject({ dedupeKey: `${key}:failed:${stuck.id}` });
    // Worker A vẫn sống: Zalo đã nhận, ghi SENT (đường ghi của deliverZns).
    await (svc as unknown as { markZnsSent(id: string): Promise<void> }).markZnsSent(stuck.id);
    const after = await row(stuck.id);
    expect(after.status).toBe('SENT');
    expect(after.payload).toEqual({ data: { a: '1' }, dedupeKey: key, dedupeWithinMs: 3_600_000 });
    const znsCount = () => prisma.notificationLog.count({ where: { userId: u.id, channel: 'ZNS' } });
    const before = await znsCount();
    await svc.notify(u.id, 'IT_STUCK_TPL', {}, { dedupeKey: key, retryZns: true });
    expect(await znsCount()).toBe(before);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('markStuckZnsSent cũng khôi phục khoá đã nhả của chính log đó; khoá của log khác hoặc khoá thường giữ nguyên', async () => {
    const u = await newUser();
    const key = `it-stuck-restore:${Date.now()}`;
    const released = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_STUCK', channel: 'ZNS', payload: { data: {}, dedupeKey: `${key}:failed:placeholder` }, status: 'RETRYING' },
    });
    await prisma.notificationLog.update({ where: { id: released.id }, data: { payload: { data: {}, dedupeKey: `${key}:failed:${released.id}` } } });
    expect(await svc.markStuckZnsSent(released.id)).toBe(true);
    expect((await row(released.id)).payload).toEqual({ data: {}, dedupeKey: key });
    const other = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_STUCK', channel: 'ZNS', payload: { data: {}, dedupeKey: `${key}:failed:log-khac` }, status: 'RETRYING' },
    });
    await svc.markStuckZnsSent(other.id);
    expect((await row(other.id)).payload).toEqual({ data: {}, dedupeKey: `${key}:failed:log-khac` });
    const plain = await mkLog(u.id, null, 'RETRYING');
    await svc.markStuckZnsSent(plain.id);
    expect((await row(plain.id)).payload).toEqual({ data: {} });
  });

  it('log từng bị đánh dấu chờ đối soát mà được worker nhận lại rồi kẹt tiếp: tiền tố đã được xoá nên cron quét lại được', async () => {
    const u = await newUser();
    const log = await mkLog(u.id, null, 'RETRYING');
    expect(await svc.markZnsLogForReview(log.id, 'RETRYING', 'không rõ')).toBe(true);
    expect((await row(log.id)).error).toContain(ZNS_REVIEW_PREFIX);
    // Worker nhận lại log rồi chết giữa chừng (Zalo ném lỗi bất ngờ): log ở lại RETRYING.
    sendTemplate.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(svc.deliverZns(jobOf(log.id), false)).rejects.toThrow('socket hang up');
    const after = await row(log.id);
    expect(after.status).toBe('RETRYING');
    expect(after.error ?? '').not.toContain(ZNS_REVIEW_PREFIX);
  });

  it('log A FAILED vì hết lượt (Zalo chưa nhận), log B cùng khoá đã SENT, rồi job của A bị retry tay: nhả khoá nên ra SKIPPED, Zalo không được gọi', async () => {
    const u = await newUser();
    const key = `it-stuck-final-fail:${Date.now()}`;
    const a = await mkLog(u.id, key, 'PENDING');
    sendTemplate.mockResolvedValueOnce({ ok: false, retryable: true, code: -1, reason: 'timeout' });
    expect(await svc.deliverZns(jobOf(a.id), true)).toBe('FAILED');
    const failed = await row(a.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.payload).toEqual({ data: {}, dedupeKey: `${key}:failed:${a.id}` });
    // Nơi gọi gửi lại bằng log B cùng khoá: B đi bình thường.
    const b = await mkLog(u.id, key, 'PENDING');
    expect(await svc.deliverZns(jobOf(b.id), false)).toBe('SENT');
    sendTemplate.mockClear();
    expect(await svc.deliverZns(jobOf(a.id), false)).toBe('SKIPPED');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  describe('worker chậm ghi kết cục lỗi sau khi worker khác đã ghi SENT cho cùng log', () => {
    /** W1 đang chờ Zalo (sendTemplate treo), W2 ghi SENT xong, rồi Zalo trả lỗi cho W1. */
    const w1FailsAfterW2Sent = async (finalAttempt: boolean) => {
      const u = await newUser();
      const key = `it-late-fail:${finalAttempt}:${Date.now()}`;
      const a = await mkLog(u.id, key, 'RETRYING');
      let settle!: (v: unknown) => void;
      sendTemplate.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
      const w1 = svc.deliverZns(jobOf(a.id), finalAttempt);
      await new Promise((r) => setTimeout(r, 50));
      await (svc as unknown as { markZnsSent(id: string): Promise<void> }).markZnsSent(a.id);
      settle({ ok: false, retryable: true, code: -1, reason: 'timeout' });
      return { u, key, a, outcome: await w1 };
    };

    it('lượt cuối lỗi: log vẫn SENT, khoá nguyên, trả SENT (không ném, không FAILED), log B cùng khoá ra SKIPPED', async () => {
      const { u, key, a, outcome } = await w1FailsAfterW2Sent(true);
      expect(outcome).toBe('SENT');
      const after = await row(a.id);
      expect(after.status).toBe('SENT');
      expect(after.error).toBeNull();
      expect(after.payload).toEqual({ data: {}, dedupeKey: key });
      const b = await mkLog(u.id, key, 'PENDING');
      sendTemplate.mockClear();
      expect(await svc.deliverZns(jobOf(b.id), false)).toBe('SKIPPED');
      expect(sendTemplate).not.toHaveBeenCalled();
    });

    it('lỗi tạm thời còn lượt: log vẫn SENT, trả SENT để BullMQ không thử lại và gửi đôi', async () => {
      const { key, a, outcome } = await w1FailsAfterW2Sent(false);
      expect(outcome).toBe('SENT');
      const after = await row(a.id);
      expect(after.status).toBe('SENT');
      expect(after.error).toBeNull();
      expect(after.payload).toEqual({ data: {}, dedupeKey: key });
    });
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

  it('log mơ hồ được đánh dấu rồi loại khỏi lượt quét sau: 200 log mơ hồ cũ không chặn log kẹt mới hơn', async () => {
    const u = await newUser();
    const ancient = (n: number) => new Date(Date.UTC(2000, 0, 1, 0, 0, n % 60, Math.floor(n / 60)));
    const old = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        prisma.notificationLog.create({ data: { userId: u.id, templateCode: 'IT_STUCK', channel: 'ZNS', payload: { data: {} }, status: 'RETRYING', sentAt: ancient(i) } }),
      ),
    );
    const fresh = await prisma.notificationLog.create({
      data: { userId: u.id, templateCode: 'IT_STUCK', channel: 'ZNS', payload: { data: {} }, status: 'PENDING', sentAt: new Date(Date.UTC(2000, 0, 2)) },
    });
    const mine = new Set([...old.map((l) => l.id), fresh.id]);
    // Chỉ log của spec này "mất job"; log còn sót của spec khác coi như còn sống để cron không đụng.
    const queue = { getJob: async (jobId: string) => (mine.has(jobId.replace(/^zns-/, '')) ? undefined : { getState: async () => 'active' }) };
    const cron = new ZnsStuckLogCron(prisma, svc, queue as never);
    const first = await cron.sweepStuckZnsLogs();
    expect(first).toMatchObject({ scanned: 200, ambiguous: 200, closed: 0 });
    expect((await row(fresh.id)).status).toBe('PENDING');
    const marked = await row(old[0]!.id);
    expect([marked.status, marked.error]).toEqual(['RETRYING', expect.stringContaining(ZNS_REVIEW_PREFIX)]);
    const second = await cron.sweepStuckZnsLogs();
    expect(second).toMatchObject({ closed: 1, ambiguous: 0 });
    expect((await row(fresh.id)).status).toBe('FAILED');
    expect((await row(old[0]!.id)).status).toBe('RETRYING');
  });
});
