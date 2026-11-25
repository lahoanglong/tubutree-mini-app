import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../src/common/body-limits';
import { PrismaService } from '../../src/prisma/prisma.service';
import { readMssEnv } from '../../src/modules/integrations/mss/mss-config';
import { MSS_ENV_READER } from '../../src/modules/integrations/mss/mss-flags';
import { MssOrderEventsCallbackController } from '../../src/modules/integrations/mss/mss-order-events.controller';
import { computeMssSignature } from '../../src/modules/integrations/mss/mss-signer';
import type { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssFlagsService } from '../../src/modules/integrations/mss/mss-flags';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import type { MssOrderEventDispatcher } from '../../src/modules/integrations/mss/mss-order-event.dispatch';
import { MssOrderEventFallback } from '../../src/modules/integrations/mss/mss-order-event.fallback';
import { MssOrderEventRecorder } from '../../src/modules/integrations/mss/mss-order-event.recorder';
import { MssOrderEventSender } from '../../src/modules/integrations/mss/mss-order-event.sender';
import { MssOrderEventReconcileService } from '../../src/modules/integrations/mss/mss-order-events.reconcile';
import { MssZnsHoldService } from '../../src/modules/integrations/mss/mss-zns-hold';
import { MSS_SENT_VIA_STRANGER, mssEmailEligible, type MssOutboxStatus } from '../../src/modules/integrations/mss/mss-order-event-types';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ORDER_CONFIRM_EMAIL_TEMPLATE, orderEmailDedupeKey } from '../../src/modules/notifications/order-email/order-confirm-email';
import { ORDER_EMAIL_FALLBACK_FLAG, OrderConfirmEmailService } from '../../src/modules/notifications/order-email/order-confirm-email.service';
import type { MailTransportFactory } from '../../src/modules/ops/smtp-transport';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

/**
 * Email xác nhận đơn dự phòng (wave tubu-w38-01, PO A3) trên Postgres THẬT: đường lui MSS gửi email khi khách chắc chắn chưa nhận tin Zalo
 * nào, cron quét gửi email sau ZNS lỗi hẳn, và khoá advisory + log EMAIL giữ đúng một email mỗi đơn dù nhiều sự kiện chạy song song.
 * SMTP giả qua MailTransportFactory tiêm vào; không gọi mạng.
 */
describe('Order confirm email fallback (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  let variationId: string;

  const flagsOn = {
    isEnabled: async () => true,
    configured: () => true,
    snapshot: async () => ({ orderEventsRolloutPct: 100 }),
  } as unknown as MssFlagsService;
  const health = { assertCapability: async () => true } as unknown as MssHealthService;
  const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
  const dispatcher = { enqueue: () => undefined } as unknown as MssOrderEventDispatcher;
  const SECRET = 'it-secret-order-confirm-email';
  const RECORDER_ENV = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? SECRET : undefined) } as unknown as ConfigService<Env, true>;

  const cfg: Record<string, unknown> = {};
  const config = { get: async (k: string, fb: unknown) => (k in cfg ? cfg[k] : fb) } as unknown as SystemConfigService;
  const READY_SMTP: Record<string, string> = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'Tubu Tree <no-reply@tubutree.com>',
    OPS_ALERT_EMAIL_TO: 'ops@tubutree.com',
    JWT_ACCESS_SECRET: SECRET,
  };
  let envMap: Record<string, string | undefined> = {};
  const EMAIL_ENV = { get: (k: string) => envMap[k] } as unknown as ConfigService<Env, true>;

  type Mail = { to: string[]; subject: string; text: string; html: string };
  const mails: Mail[] = [];
  let mailDelayMs = 0;
  let mailFail: Error | null = null;
  const factory: MailTransportFactory = () => ({
    sendMail: async (m) => {
      if (mailDelayMs) await new Promise((r) => setTimeout(r, mailDelayMs));
      if (mailFail) throw mailFail;
      mails.push(m);
    },
    close: () => undefined,
  });

  const sendHeldZns = jest.fn();
  const notifications = { sendHeldZns } as unknown as NotificationsService;

  let recorder: MssOrderEventRecorder;
  let hold: MssZnsHoldService;
  let email: OrderConfirmEmailService;
  let fallback: MssOrderEventFallback;
  let reconcile: MssOrderEventReconcileService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const tag = Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvw'[Math.floor(Math.random() * 20)]).join('');
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itmail-${tag}`,
        name: `Hàng email ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITMAIL-${tag}`, name: 'Can', attributes: {}, retailPrice: 100_000, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(product.id);
    variationId = product.variations[0]!.id;

    recorder = new MssOrderEventRecorder(flagsOn, health, circuitClient, dispatcher, RECORDER_ENV);
    await recorder.refreshGate();
    hold = new MssZnsHoldService(prisma, flagsOn);
    email = new OrderConfirmEmailService(prisma, config, EMAIL_ENV, factory);
    fallback = new MssOrderEventFallback(prisma, notifications, email);
    reconcile = new MssOrderEventReconcileService(prisma, flagsOn, {} as MssOrderEventSender, fallback, email);
  });

  beforeEach(() => {
    for (const k of Object.keys(cfg)) delete cfg[k];
    cfg[ORDER_EMAIL_FALLBACK_FLAG] = true;
    envMap = { ...READY_SMTP };
    mails.length = 0;
    mailDelayMs = 0;
    mailFail = null;
    sendHeldZns.mockReset().mockResolvedValue('DISPATCHED');
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.$disconnect();
  });

  async function buyerOrder(
    over: { email?: string | null; guest?: boolean; invoiceEmail?: string; paymentMethod?: 'COD' | 'BANK_TRANSFER' } = {},
  ) {
    const phone = uniquePhone('09');
    const user = await createUser(prisma, {
      phone: over.guest ? null : phone,
      email: over.email === undefined ? `lan.${randCode(8).toLowerCase()}@example.com` : over.email,
      fullName: over.guest ? 'Khách' : 'Nguyễn Thị Lan',
      notifyOrderZalo: true,
      notifyOrderZaloAt: new Date(),
      notifyOrderZaloSource: 'checkout',
      ...(over.guest ? { zaloId: `guest_it_${randCode(8)}` } : {}),
    });
    userIds.push(user.id);
    const order = await createOrder(prisma, {
      userId: user.id,
      platform: over.guest ? 'web' : 'miniapp',
      orderZaloConsent: true,
      orderZaloConsentAt: new Date(),
      total: 250_000,
      paymentMethod: over.paymentMethod ?? 'COD',
      ...(over.guest ? { guestPhone: phone, guestTokenHash: `h${randCode(40)}` } : {}),
      ...(over.invoiceEmail ? { invoiceRequest: { companyName: 'Cty IT', taxCode: '0101234567', address: '1 IT', email: over.invoiceEmail } } : {}),
      shippingAddress: { recipient: 'Lan', phone, street: '1 IT', ward: 'P', district: '', province: 'Ha Noi', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, variationId, productName: 'Nước giặt Fuwa3e 2L', variationName: 'Can', unitPrice: 125_000, quantity: 2, total: 250_000 },
    });
    return { user, order };
  }

  const recordIn = (orderId: string, type: Parameters<MssOrderEventRecorder['record']>[2]) => prisma.$transaction((tx) => recorder.record(tx, orderId, type));
  async function eventOf(orderId: string, type: Parameters<MssOrderEventRecorder['record']>[2]) {
    await recordIn(orderId, type);
    const row = await prisma.mssOrderEventOutbox.findFirst({ where: { orderId, eventType: type, recipientRole: 'buyer' } });
    if (!row) throw new Error(`thiếu dòng outbox ${type}`);
    return row;
  }
  const settle = (eventId: string, status: MssOutboxStatus, resultReason: string | null, extra: { expiresAt?: Date; lastHttpStatus?: number | null } = {}) =>
    prisma.mssOrderEventOutbox.update({ where: { eventId }, data: { status, resultReason, resultAt: new Date(), ...extra } });
  /** Sự kiện MSS bỏ qua vì quyền riêng tư (khách chắc chắn chưa nhận tin Zalo): diện email. */
  async function failedEvent(orderId: string, type: Parameters<MssOrderEventRecorder['record']>[2]) {
    const row = await eventOf(orderId, type);
    await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
    return row;
  }
  /** Đường lui gửi email nền (không giữ callback MSS): chờ xong rồi mới đếm thư. */
  const runFallback = async (eventId: string) => {
    const decision = await fallback.run(eventId);
    await fallback.emailsSettled();
    return decision;
  };
  const emailLogs = (userId: string) =>
    prisma.notificationLog.findMany({ where: { userId, channel: 'EMAIL', templateCode: ORDER_CONFIRM_EMAIL_TEMPLATE }, orderBy: { sentAt: 'asc' } });
  const mailsFor = (code: string) => mails.filter((m) => m.subject.includes(code));

  it('E1 tạo đơn, MSS bỏ qua privacy_blocked, không có ZNS hoãn: chỉ trong app + đúng 1 email, log EMAIL SENT', async () => {
    const { user, order } = await buyerOrder();
    const row = await eventOf(order.id, 'order.created');
    await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
    expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
    expect(await runFallback(row.eventId)).toBeNull();
    expect(sendHeldZns).not.toHaveBeenCalled();
    expect(mailsFor(order.code)).toHaveLength(1);
    expect(mailsFor(order.code)[0]!.to).toEqual([user.email]);
    expect(mailsFor(order.code)[0]!.text).toContain(`Xem đơn: https://tubutree.com/tai-khoan/don-hang/${order.code}`);
    expect(mailsFor(order.code)[0]!.text).toContain('https://zalo.me/0899149229');
    const logs = await emailLogs(user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 'SENT', channel: 'EMAIL', error: null });
    expect(logs[0]!.payload).toMatchObject({ dedupeKey: orderEmailDedupeKey(order.code), eventId: row.eventId, attempts: 1 });
    expect(JSON.stringify(logs[0]!.payload)).not.toContain(user.email!);
  });

  it('E2 đặt đơn + đã nhận tiền chạy đường lui đồng thời (SMTP chậm): đúng 1 email cho đơn', async () => {
    const { user, order } = await buyerOrder({ paymentMethod: 'BANK_TRANSFER' });
    const created = await eventOf(order.id, 'order.created');
    const paid = await eventOf(order.id, 'order.payment_confirmed');
    await settle(created.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
    await settle(paid.eventId, 'RESULT_FAILED', 'zalo_error');
    mailDelayMs = 300;
    const outcomes = await Promise.all([
      fallback.run(created.eventId),
      fallback.run(paid.eventId),
      email.sendForEvent(created.id),
      email.sendForEvent(paid.id),
      reconcile.emailRescueOnce(),
    ]);
    await fallback.emailsSettled();
    expect(outcomes.slice(0, 2)).toEqual(['IN_APP_ONLY', 'IN_APP_ONLY']);
    expect(mailsFor(order.code)).toHaveLength(1);
    expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
  });

  it('E3 ZNS hoãn đã gửi: không email; log ZNS của sự kiện về FAILED: lượt quét gửi đúng 1 email, lượt sau 0', async () => {
    const { user, order } = await buyerOrder();
    const row = await eventOf(order.id, 'order.created');
    expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl')).toBe(true);
    await settle(row.eventId, 'RESULT_SKIPPED', 'no_zalo');
    expect(await runFallback(row.eventId)).toBe('ZNS');
    expect(sendHeldZns).toHaveBeenCalledTimes(1);
    expect(mailsFor(order.code)).toHaveLength(0);

    await reconcile.emailRescueOnce();
    expect(mailsFor(order.code)).toHaveLength(0);
    const zns = await prisma.notificationLog.create({
      data: { userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'SENT', payload: { dedupeKey: `mss:${row.eventId}` } },
    });
    await reconcile.emailRescueOnce();
    expect(mailsFor(order.code)).toHaveLength(0);
    await prisma.notificationLog.update({
      where: { id: zns.id },
      data: { status: 'FAILED', error: 'zns_quota', payload: { dedupeKey: `mss:${row.eventId}:failed:${zns.id}` } },
    });
    await Promise.all([reconcile.emailRescueOnce(), reconcile.emailRescueOnce()]);
    await reconcile.emailRescueOnce();
    expect(mailsFor(order.code)).toHaveLength(1);
    expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
  });

  it('E3 ZNS lỗi hẳn nhưng một log ZNS khác của sự kiện còn chờ gửi lại: lượt quét chưa gửi email', async () => {
    const { user, order } = await buyerOrder();
    const row = await eventOf(order.id, 'order.created');
    await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl');
    // Kết quả đủ điều kiện email (EXPIRED mss_unavailable không có mã HTTP thì không bao giờ email, ca sẽ xanh mà không kiểm gì).
    await settle(row.eventId, 'RESULT_FAILED', 'zalo_error');
    expect(await runFallback(row.eventId)).toBe('ZNS');
    await prisma.notificationLog.createMany({
      data: [
        { userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'FAILED', payload: { dedupeKey: `mss:${row.eventId}:failed:old` } },
        { userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'RETRYING', payload: { dedupeKey: `mss:${row.eventId}` } },
      ],
    });
    await reconcile.emailRescueOnce();
    expect(mailsFor(order.code)).toHaveLength(0);
  });

  it.each(['NO_PHONE', 'PREFS'] as const)('E3 đường lui ZNS không gửi được (%s): gửi email ngay', async (outcome) => {
    sendHeldZns.mockResolvedValue(outcome);
    const { user, order } = await buyerOrder();
    const row = await eventOf(order.id, 'order.created');
    await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl');
    await settle(row.eventId, 'DEAD', 'http_413');
    expect(await runFallback(row.eventId)).toBe('ZNS');
    expect(mailsFor(order.code)).toHaveLength(1);
  });

  describe('E4 không gửi email', () => {
    it.each([
      ['RESULT_UNKNOWN', null],
      ['RESULT_SKIPPED', 'superseded'],
      ['DEAD', 'event_id_reused'],
      ['CANCELLED', 'consent_withdrawn'],
    ] as const)('kết quả %s (%s): đường lui chỉ trong app, không email, không log EMAIL', async (status, reason) => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, status, reason);
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      await reconcile.emailRescueOnce();
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it.each([
      ['RESULT_SENT', null, null],
      ['RESULT_SENT', 'stranger', null],
      ['RESULT_UNKNOWN', 'stranger', 'IN_APP_ONLY'],
    ] as const)('MSS đã/có thể đã gửi (%s, reason %s): đường lui %s, không email, không log EMAIL', async (status, reason, decision) => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, status, reason);
      expect(await runFallback(row.eventId)).toBe(decision);
      await reconcile.emailRescueOnce();
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it('sự kiện giao hàng (order.shipping): không email, gọi thẳng cũng NOT_ELIGIBLE', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.shipping');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(await email.sendForEvent(row.id)).toBe('NOT_ELIGIBLE');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it('cờ tắt: không đọc đơn, không log; lượt quét trả 0', async () => {
      cfg[ORDER_EMAIL_FALLBACK_FLAG] = false;
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(await email.sendForEvent(row.id)).toBe('FLAG_OFF');
      expect(await reconcile.emailRescueOnce()).toBe(0);
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it('SMTP chưa cấu hình (thiếu SMTP_HOST): SMTP_NOT_READY, không log', async () => {
      delete envMap.SMTP_HOST;
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(await email.sendForEvent(row.id)).toBe('SMTP_NOT_READY');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it('quá hạn sống + 15 phút: đường lui không email, gọi thẳng STALE', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      // Kết quả đủ diện email (EXPIRED/503 từ w39-01 đã NOT_ELIGIBLE trước khi tới bước kiểm hạn sống).
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked', { expiresAt: new Date(Date.now() - 16 * 60_000) });
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(await email.sendForEvent(row.id)).toBe('STALE');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });
  });

  it('E5 không có email tài khoản lẫn email hoá đơn: log SKIPPED no_email đúng 1 dòng, không gửi', async () => {
    const { user, order } = await buyerOrder({ email: null, paymentMethod: 'BANK_TRANSFER' });
    const created = await failedEvent(order.id, 'order.created');
    const paid = await failedEvent(order.id, 'order.payment_confirmed');
    await Promise.all([email.sendForEvent(created.id), email.sendForEvent(created.id), email.sendForEvent(paid.id)]);
    expect(mailsFor(order.code)).toHaveLength(0);
    const logs = await emailLogs(user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 'SKIPPED', error: 'no_email' });
  });

  it('E5 không có email tài khoản: dùng email xuất hoá đơn VAT của đơn', async () => {
    const { order } = await buyerOrder({ email: null, invoiceEmail: 'ketoan@cty-it.vn' });
    const row = await failedEvent(order.id, 'order.created');
    expect(await email.sendForEvent(row.id)).toBe('SENT');
    expect(mailsFor(order.code).map((m) => m.to)).toEqual([['ketoan@cty-it.vn']]);
  });

  it('SMTP lỗi: log FAILED (không lộ địa chỉ), sự kiện kế của đơn thử lại một lần; lần sau DUPLICATE', async () => {
    const { user, order } = await buyerOrder({ paymentMethod: 'BANK_TRANSFER' });
    const created = await failedEvent(order.id, 'order.created');
    const paid = await failedEvent(order.id, 'order.payment_confirmed');
    mailFail = Object.assign(new Error(`550 mailbox ${user.email} unavailable`), { code: 'EENVELOPE' });
    expect(await email.sendForEvent(created.id)).toBe('FAILED');
    let logs = await emailLogs(user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('FAILED');
    expect(logs[0]!.error).toContain('EENVELOPE');
    expect(logs[0]!.error).not.toContain(user.email!);
    mailFail = null;
    expect(await email.sendForEvent(paid.id)).toBe('SENT');
    expect(await email.sendForEvent(paid.id)).toBe('DUPLICATE');
    logs = await emailLogs(user.id);
    expect(logs.map((l) => l.status)).toEqual(['FAILED', 'SENT']);
    expect(logs[1]!.payload).toMatchObject({ attempts: 2 });
    expect(mailsFor(order.code)).toHaveLength(1);
    expect(mailsFor(order.code)[0]!.text).toContain(`Tubu Tree đã nhận đủ thanh toán cho đơn ${order.code}.`);
  });

  describe('link xem đơn trong email', () => {
    it('khách vãng lai, cờ bill bật: /don/<mã>#k=<khoá đã ký>', async () => {
      cfg['mss.order_bill_enabled'] = true;
      const { order } = await buyerOrder({ guest: true });
      const row = await failedEvent(order.id, 'order.created');
      expect(await email.sendForEvent(row.id)).toBe('SENT');
      expect(mailsFor(order.code)[0]!.text).toMatch(new RegExp(`Xem đơn: https://tubutree\\.com/don/${order.code}#k=\\S+`));
    });

    it('khách vãng lai, cờ bill tắt: trang tra cứu /don?ma=<mã> (khách tự nhập SĐT)', async () => {
      const { order } = await buyerOrder({ guest: true });
      const row = await failedEvent(order.id, 'order.created');
      expect(await email.sendForEvent(row.id)).toBe('SENT');
      const text = mailsFor(order.code)[0]!.text;
      expect(text).toContain(`Xem đơn: https://tubutree.com/don?ma=${order.code}`);
      expect(text).not.toContain('#k=');
    });
  });

  describe('review w38-01', () => {
    const failZns = (userId: string, eventId: string) =>
      prisma.notificationLog.create({
        data: { userId, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'FAILED', error: 'zns_quota', payload: { dedupeKey: `mss:${eventId}:failed:it` } },
      });

    it('MAJOR 1 đơn đổi chủ sau email đầu (khách vãng lai đăng nhập): sự kiện kế DUPLICATE, cron không gửi lại; ZNS lỗi dưới chủ cũ vẫn được cron thấy', async () => {
      const { user, order } = await buyerOrder({ paymentMethod: 'BANK_TRANSFER' });
      const created = await failedEvent(order.id, 'order.created');
      const paid = await failedEvent(order.id, 'order.payment_confirmed');
      expect(await email.sendForEvent(created.id)).toBe('SENT');
      const owner = await createUser(prisma, { phone: uniquePhone('09'), email: `owner.${randCode(6).toLowerCase()}@example.com` });
      userIds.push(owner.id);
      await prisma.order.update({ where: { id: order.id }, data: { userId: owner.id } });
      expect(await email.sendForEvent(paid.id)).toBe('DUPLICATE');
      await prisma.mssOrderEventOutbox.update({ where: { eventId: paid.eventId }, data: { fallbackAt: new Date(), fallbackChannel: 'ZNS' } });
      await failZns(user.id, paid.eventId);
      await reconcile.emailRescueOnce();
      expect(mailsFor(order.code)).toHaveLength(1);

      const second = await buyerOrder();
      const row = await failedEvent(second.order.id, 'order.created');
      await prisma.mssOrderEventOutbox.update({ where: { eventId: row.eventId }, data: { fallbackAt: new Date(), fallbackChannel: 'ZNS' } });
      await failZns(second.user.id, row.eventId);
      const owner2 = await createUser(prisma, { phone: uniquePhone('09'), email: `owner.${randCode(6).toLowerCase()}@example.com` });
      userIds.push(owner2.id);
      await prisma.order.update({ where: { id: second.order.id }, data: { userId: owner2.id } });
      await reconcile.emailRescueOnce();
      expect(mailsFor(second.order.code).map((m) => m.to)).toEqual([[owner2.email]]);
    });

    it('MAJOR 2 đơn đã huỷ khi ZNS lỗi hẳn: cron và gọi thẳng đều không gửi "đã nhận đơn"', async () => {
      const { user, order } = await buyerOrder();
      const row = await failedEvent(order.id, 'order.created');
      await prisma.mssOrderEventOutbox.update({ where: { eventId: row.eventId }, data: { fallbackAt: new Date(), fallbackChannel: 'ZNS' } });
      await failZns(user.id, row.eventId);
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', reversalEffectsAt: new Date() } });
      const spy = jest.spyOn(email, 'sendForEvent');
      try {
        await reconcile.emailRescueOnce();
        expect(spy.mock.calls.map((c) => c[0])).not.toContain(row.id);
      } finally {
        spy.mockRestore();
      }
      expect(await email.sendForEvent(row.id)).toBe('NOT_ELIGIBLE');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    it('MINOR 3 dòng quá hạn sống không vào lô cron (không chiếm chỗ dòng còn gửi được)', async () => {
      const { user, order } = await buyerOrder();
      const row = await failedEvent(order.id, 'order.created');
      await prisma.mssOrderEventOutbox.update({
        where: { eventId: row.eventId },
        data: { fallbackAt: new Date(), fallbackChannel: 'ZNS', expiresAt: new Date(Date.now() - 16 * 60_000) },
      });
      await failZns(user.id, row.eventId);
      const spy = jest.spyOn(email, 'sendForEvent');
      try {
        await reconcile.emailRescueOnce();
        expect(spy.mock.calls.map((c) => c[0])).not.toContain(row.id);
      } finally {
        spy.mockRestore();
      }
    });

    it('MINOR 4 lần trước hết giờ chờ SMTP (có thể đã tới hộp thư): sự kiện kế không gửi lại', async () => {
      const { user, order } = await buyerOrder({ paymentMethod: 'BANK_TRANSFER' });
      const created = await failedEvent(order.id, 'order.created');
      const paid = await failedEvent(order.id, 'order.payment_confirmed');
      mailFail = new Error('quá 30 giây không gửi xong');
      expect(await email.sendForEvent(created.id)).toBe('FAILED');
      mailFail = null;
      expect(await email.sendForEvent(paid.id)).toBe('DUPLICATE');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['FAILED']);
    });

    it('MINOR 5 đường lui trả kết quả trước khi SMTP xong (callback MSS không chờ thư)', async () => {
      const { order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      mailDelayMs = 400;
      const t0 = Date.now();
      expect(await fallback.run(row.eventId)).toBe('IN_APP_ONLY');
      expect(Date.now() - t0).toBeLessThan(350);
      expect(mailsFor(order.code)).toHaveLength(0);
      await fallback.emailsSettled();
      expect(mailsFor(order.code)).toHaveLength(1);
    });

    it('MINOR 6 khách đã nhận tin Zalo của sự kiện khác cùng đơn (RESULT_SENT): không email ở cả đường lui lẫn cron', async () => {
      const { user, order } = await buyerOrder({ paymentMethod: 'BANK_TRANSFER' });
      const created = await eventOf(order.id, 'order.created');
      const paid = await eventOf(order.id, 'order.payment_confirmed');
      await settle(paid.eventId, 'RESULT_SENT', MSS_SENT_VIA_STRANGER);
      await settle(created.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      expect(await runFallback(created.eventId)).toBe('IN_APP_ONLY');
      await prisma.mssOrderEventOutbox.update({ where: { eventId: created.eventId }, data: { fallbackChannel: 'ZNS' } });
      await failZns(user.id, created.eventId);
      await reconcile.emailRescueOnce();
      expect(await email.sendForEvent(created.id)).toBe('NOT_ELIGIBLE');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);
    });

    // w39-01 (NIT-3): 5xx/429 ở lượt cuối không chứng minh MSS chưa nhận (một lượt trước có thể đã tới và tin đã đi): không email.
    it.each([
      ['ttl', null, 0],
      ['retries_exhausted', null, 0],
      ['mss_unavailable', null, 0],
      ['retries_exhausted', 503, 0],
      ['ttl', 502, 0],
      ['ttl', 429, 0],
      ['mss_lost', 202, 1],
    ] as const)('MINOR 7 EXPIRED %s, HTTP lượt cuối %s: số email %i (lượt cuối hết giờ/lỗi mạng/5xx/429 thì MSS có thể đã gửi)', async (reason, http, n) => {
      const { order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'EXPIRED', reason, { lastHttpStatus: http });
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(mailsFor(order.code)).toHaveLength(n);
    });
  });

  describe('MSS W37/W38: tin người lạ (stranger / stranger_cap)', () => {
    it('skipped/stranger_cap, không có ZNS hoãn: chỉ trong app + đúng 1 email', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'stranger_cap');
      expect(await runFallback(row.eventId)).toBe('IN_APP_ONLY');
      expect(sendHeldZns).not.toHaveBeenCalled();
      expect(mailsFor(order.code)).toHaveLength(1);
      expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
    });

    it('skipped/stranger_cap, có ZNS hoãn: ZNS đi, chưa email; log ZNS về FAILED: lượt quét gửi đúng 1 email', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      expect(await hold.holdZns(user.id, 'ORDER_CONFIRMED', { order_code: order.code }, 'zns-tpl')).toBe(true);
      await settle(row.eventId, 'RESULT_SKIPPED', 'stranger_cap');
      expect(await runFallback(row.eventId)).toBe('ZNS');
      expect(sendHeldZns).toHaveBeenCalledTimes(1);
      expect(mailsFor(order.code)).toHaveLength(0);
      await prisma.notificationLog.create({
        data: { userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'FAILED', error: 'zns_quota', payload: { dedupeKey: `mss:${row.eventId}:failed:it` } },
      });
      await reconcile.emailRescueOnce();
      await reconcile.emailRescueOnce();
      expect(mailsFor(order.code)).toHaveLength(1);
      expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
    });

    describe('qua controller thật (chữ ký HMAC)', () => {
      const INBOUND = 'inbound-secret-not-for-prod-0123456789abcdef';
      const mssEnv = readMssEnv({
        NODE_ENV: 'test',
        MSS_BASE_URL: 'https://mss.example.test',
        MSS_KEY_ID: 'tubu-test',
        MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
        MSS_INBOUND_SECRET: INBOUND,
      });
      let app: INestApplication;
      let base: string;
      let quietWarn: jest.SpyInstance | undefined;

      beforeAll(async () => {
        quietWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const sender = new MssOrderEventSender(prisma, {} as MssClient, flagsOn, dispatcher, fallback);
        const mod = await Test.createTestingModule({
          controllers: [MssOrderEventsCallbackController],
          providers: [
            { provide: MSS_ENV_READER, useValue: () => mssEnv },
            { provide: MssOrderEventSender, useValue: sender },
          ],
        }).compile();
        app = mod.createNestApplication({ bodyParser: false, logger: false });
        app.use(...createBodyParsers('access-secret-not-for-prod-0123456789abc', 30), bodyParserErrorHandler, requestInputGuard);
        app.setGlobalPrefix('api');
        await app.listen(0, '127.0.0.1');
        base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
      });
      afterAll(async () => {
        await app?.close();
        quietWarn?.mockRestore();
      });

      /** MSS báo kết quả qua callback đã ký (đường thật: guard HMAC, parser, sender.applyResult, đường lui); chờ email nền xong. */
      async function callback(row: { eventId: string; orderCode: string; eventType: string }, status: string, reason: string | null) {
        const raw = JSON.stringify({ event_id: row.eventId, order_code: row.orderCode, event_type: row.eventType, status, reason, sent_at: new Date().toISOString() });
        const ts = Math.floor(Date.now() / 1000);
        const res = await fetch(`${base}/api/integrations/mss/order-event-results`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-mss-key-id': 'tubu-test',
            'x-mss-timestamp': String(ts),
            'x-mss-signature': computeMssSignature(INBOUND, ts, Buffer.from(raw)),
          },
          body: raw,
        });
        await fallback.emailsSettled();
        return { status: res.status, body: (await res.json()) as { ok: boolean; outcome: string } };
      }

      it('skipped/stranger_cap: applied, chỉ trong app + đúng 1 email; MSS gửi lại cùng callback: noop, không email thêm', async () => {
        const { user, order } = await buyerOrder();
        const row = await eventOf(order.id, 'order.created');
        expect(await callback(row, 'skipped', 'stranger_cap')).toEqual({ status: 200, body: { ok: true, outcome: 'applied' } });
        const after = await prisma.mssOrderEventOutbox.findUniqueOrThrow({ where: { eventId: row.eventId } });
        expect(after).toMatchObject({ status: 'RESULT_SKIPPED', resultReason: 'stranger_cap', fallbackChannel: 'IN_APP_ONLY' });
        expect(mailsFor(order.code)).toHaveLength(1);
        expect(await callback(row, 'skipped', 'stranger_cap')).toEqual({ status: 200, body: { ok: true, outcome: 'noop' } });
        expect(mailsFor(order.code)).toHaveLength(1);
        expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
      });

      it('sent/stranger: applied, RESULT_SENT không đường lui, không email (lượt quét cũng không)', async () => {
        const { user, order } = await buyerOrder();
        const row = await eventOf(order.id, 'order.created');
        expect(await callback(row, 'sent', 'stranger')).toEqual({ status: 200, body: { ok: true, outcome: 'applied' } });
        const after = await prisma.mssOrderEventOutbox.findUniqueOrThrow({ where: { eventId: row.eventId } });
        expect(after).toMatchObject({ status: 'RESULT_SENT', resultReason: 'stranger', fallbackChannel: null, fallbackAt: null });
        await reconcile.emailRescueOnce(Date.now() + 3 * 60_000);
        expect(mailsFor(order.code)).toHaveLength(0);
        expect(await emailLogs(user.id)).toHaveLength(0);
      });
    });
  });

  describe('review w38-02 MINOR-2: quét email (luật đủ điều kiện trong SQL, nhánh cứu IN_APP_ONLY)', () => {
    const HOUR = 3_600_000;
    type Spec = { status: MssOutboxStatus; reason: string | null; http: number | null };
    const label = (r: Spec) => `${r.status}/${r.reason ?? '-'}/${r.http ?? '-'}`;

    /**
     * Dòng outbox người mua dựng thẳng (không qua recorder) với trạng thái/lý do/mã HTTP tuỳ ý, hai sự kiện email mỗi đơn, đường lui đã
     * chốt lúc `fallbackAt`. Kênh ZNS thì kèm log ZNS FAILED của từng sự kiện (nhánh A).
     */
    async function rawRows(specs: Spec[], fallbackAt: Date, channel: 'ZNS' | 'IN_APP_ONLY' = 'ZNS') {
      const user = await createUser(prisma, { email: `p.${randCode(8).toLowerCase()}@example.com` });
      userIds.push(user.id);
      const orders = await Promise.all(Array.from({ length: Math.ceil(specs.length / 2) }, () => createOrder(prisma, { userId: user.id, total: 250_000 })));
      const created = await prisma.mssOrderEventOutbox.createManyAndReturn({
        data: specs.map((sp, i) => {
          const order = orders[Math.floor(i / 2)]!;
          return {
            eventId: `itp${randCode(24)}`,
            orderId: order.id,
            orderCode: order.code,
            eventType: i % 2 === 0 ? 'order.created' : 'order.payment_confirmed',
            sequence: (i % 2) + 1,
            occurredAt: new Date(),
            body: '{}',
            bodySha256: 'it',
            status: sp.status,
            resultReason: sp.reason,
            lastHttpStatus: sp.http,
            resultAt: new Date(),
            expiresAt: new Date(Date.now() + 6 * HOUR),
            fallbackAt,
            fallbackChannel: channel,
          };
        }),
        select: { id: true, eventId: true },
      });
      if (channel === 'ZNS') {
        await prisma.notificationLog.createMany({
          data: created.map((r) => ({ userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'FAILED', error: 'zns_quota', payload: { dedupeKey: `mss:${r.eventId}:failed:it` } })),
        });
      }
      return created.map((r, i) => ({ ...r, ...specs[i]! }));
    }
    const retire = (ids: string[]) => prisma.mssOrderEventOutbox.updateMany({ where: { id: { in: ids } }, data: { fallbackChannel: null } });

    it('P1 bảng chéo: dòng câu SQL chọn = dòng mssEmailEligible (TS) trả true, trên mọi tổ hợp trạng thái × lý do × mã HTTP', async () => {
      const STATUSES: MssOutboxStatus[] = ['RESULT_SKIPPED', 'RESULT_FAILED', 'DEAD', 'EXPIRED', 'CANCELLED', 'RESULT_UNKNOWN'];
      const REASONS = [null, 'superseded', 'stranger_cap', 'event_id_reused', 'ttl', 'mss_lost', 'consent_withdrawn'];
      const HTTP = [null, 401, 408, 409, 422, 429, 503];
      const matrix: Spec[] = STATUSES.flatMap((status) => REASONS.flatMap((reason) => HTTP.map((http) => ({ status, reason, http }))));
      const spy = jest.spyOn(email, 'sendForEvent').mockResolvedValue('NOT_ELIGIBLE');
      let eligible = 0;
      try {
        // Lô quét 50 dòng: mỗi phần 40 dòng, cũ nhất trong cửa sổ để đứng đầu lô; xong phần nào rút phần đó khỏi diện quét.
        for (let i = 0; i < matrix.length; i += 40) {
          const rows = await rawRows(matrix.slice(i, i + 40), new Date(Date.now() - 23 * HOUR));
          spy.mockClear();
          await reconcile.emailRescueOnce();
          const picked = new Set(spy.mock.calls.map((c) => c[0]));
          const want = rows.filter((r) => mssEmailEligible(r.status, r.reason, r.http));
          expect(rows.filter((r) => picked.has(r.id)).map(label)).toEqual(want.map(label));
          eligible += want.length;
          await retire(rows.map((r) => r.id));
        }
      } finally {
        spy.mockRestore();
      }
      expect(matrix).toHaveLength(294);
      expect(eligible).toBeGreaterThan(0);
      expect(eligible).toBeLessThan(matrix.length);
    });

    it('P2 đói lô: 60 dòng không đủ điều kiện (CANCELLED, ZNS lỗi) cũ hơn không đẩy dòng hợp lệ ra khỏi lô, một lượt gửi đúng 1 email', async () => {
      const junk = await rawRows(
        Array.from({ length: 60 }, () => ({ status: 'CANCELLED' as const, reason: 'consent_withdrawn', http: null })),
        new Date(Date.now() - 22 * HOUR),
      );
      const { user, order } = await buyerOrder();
      const row = await failedEvent(order.id, 'order.created');
      await prisma.mssOrderEventOutbox.update({ where: { eventId: row.eventId }, data: { fallbackAt: new Date(Date.now() - 21 * HOUR), fallbackChannel: 'ZNS' } });
      await prisma.notificationLog.create({
        data: { userId: user.id, templateCode: 'ORDER_CONFIRMED', channel: 'ZNS', status: 'FAILED', error: 'zns_quota', payload: { dedupeKey: `mss:${row.eventId}:failed:it` } },
      });
      try {
        await reconcile.emailRescueOnce();
        expect(mailsFor(order.code)).toHaveLength(1);
      } finally {
        await retire(junk.map((r) => r.id));
      }
    });

    it('P3 SMTP chưa sẵn sàng: lượt quét trả 0 và không chạy câu chọn', async () => {
      delete envMap.SMTP_HOST;
      const q = jest.spyOn(prisma, '$queryRaw');
      try {
        expect(email.ready()).toBe(false);
        expect(await reconcile.emailRescueOnce()).toBe(0);
        expect(q).not.toHaveBeenCalled();
        envMap = { ...READY_SMTP };
        expect(email.ready()).toBe(true);
        await reconcile.emailRescueOnce();
        expect(q).toHaveBeenCalled();
      } finally {
        q.mockRestore();
      }
    });

    it('P4 nhánh cứu: app tắt khi đường lui chốt IN_APP_ONLY (email chưa nhận việc); 1 phút sau chưa gửi, 3 phút sau đúng 1 email, lượt sau 0', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      const closing = new MssOrderEventFallback(prisma, notifications, email);
      await closing.onModuleDestroy();
      expect(await closing.run(row.eventId)).toBe('IN_APP_ONLY');
      expect(mailsFor(order.code)).toHaveLength(0);
      expect(await emailLogs(user.id)).toHaveLength(0);

      await reconcile.emailRescueOnce(Date.now() + 60_000);
      expect(mailsFor(order.code)).toHaveLength(0);
      await reconcile.emailRescueOnce(Date.now() + 3 * 60_000);
      expect(mailsFor(order.code)).toHaveLength(1);
      const spy = jest.spyOn(email, 'sendForEvent');
      try {
        await reconcile.emailRescueOnce(Date.now() + 4 * 60_000);
        expect(spy.mock.calls.map((c) => c[0])).not.toContain(row.id);
      } finally {
        spy.mockRestore();
      }
      expect(mailsFor(order.code)).toHaveLength(1);
      expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
    });

    it('P5 nhánh cứu chạy cùng lúc với email trong tiến trình (SMTP chậm 3 giây): tổng đúng 1 email', async () => {
      const { user, order } = await buyerOrder();
      const row = await eventOf(order.id, 'order.created');
      await settle(row.eventId, 'RESULT_SKIPPED', 'privacy_blocked');
      mailDelayMs = 3_000;
      const later = Date.now() + 3 * 60_000;
      expect(await fallback.run(row.eventId)).toBe('IN_APP_ONLY');
      await Promise.all([reconcile.emailRescueOnce(later), reconcile.emailRescueOnce(later), email.sendForEvent(row.id, later)]);
      await fallback.emailsSettled();
      expect(mailsFor(order.code)).toHaveLength(1);
      expect((await emailLogs(user.id)).map((l) => l.status)).toEqual(['SENT']);
    });
  });
});
