import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { OPS_EMAIL_KEYS, parseEmailRecipients, resolveOpsEmailConfig, type OpsEmailConfig } from '../../../config/ops-email-config';
import { scrubSecrets } from '../../ops/ops-email';
import {
  AUTO_MAIL_HEADERS,
  defaultMailTransportFactory,
  EMAIL_SEND_TIMEOUT_MS,
  OPS_MAIL_TRANSPORT,
  withTimeout,
  type MailTransport,
  type MailTransportFactory,
} from '../../ops/smtp-transport';
import { SystemConfigService } from '../../system-config/system-config.service';
import { TUBU_ZALO_PHONE_DEFAULT, TUBU_ZALO_PHONE_KEY, tubuZaloPhoneOf } from '../../system-config/order-zalo-config';
import { MSS_FLAG_KEYS } from '../../integrations/mss/mss-flag-keys';
import {
  MSS_EMAIL_EVENT_TYPES,
  MSS_FALLBACK_ZNS_GRACE_MS,
  mssEmailEligible,
  ORDER_ZALO_ACTIVE_STATUSES,
  type MssOutboxStatus,
} from '../../integrations/mss/mss-order-event-types';
import { MSS_ORDER_LINK_ORIGIN, orderDetailUrl } from '../../integrations/mss/mss-order-link';
import { isLiveGuestOwner } from '../../checkout/guest/guest-track-link';
import {
  buildOrderConfirmEmail,
  maskEmail,
  ORDER_CONFIRM_EMAIL_TEMPLATE,
  ORDER_EMAIL_CHANNEL,
  orderEmailDedupeKey,
  type OrderConfirmEmail,
} from './order-confirm-email';

/** Cờ email xác nhận đơn dự phòng (mặc định tắt). Tắt thì không đọc đơn, không ghi log, không gửi. */
export const ORDER_EMAIL_FALLBACK_FLAG = 'notify.order_email_fallback_enabled';

/**
 * Kết quả một lần gọi: SENT/FAILED = đã nhận phần việc và gọi SMTP; DUPLICATE = đơn đã có email đang gửi hoặc đã gửi (hoặc đã ghi
 * không có địa chỉ, hoặc lần lỗi trước không chắc thư chưa tới); NOT_ELIGIBLE = sự kiện/đơn không thuộc diện email (khách đã nhận tin Zalo
 * của đơn, đơn đã đóng, kết quả MSS có thể đã gửi); NO_EMAIL = ghi log SKIPPED, không gửi; còn lại là không làm gì (không ghi log).
 */
export type OrderEmailOutcome = 'SENT' | 'FAILED' | 'DUPLICATE' | 'NO_EMAIL' | 'FLAG_OFF' | 'SMTP_NOT_READY' | 'NOT_ELIGIBLE' | 'STALE' | 'ERROR';

type Ready = Extract<OpsEmailConfig, { state: 'ready' }>;
type EmailEventType = 'order.created' | 'order.payment_confirmed';

const ERROR_MAX = 300;
/** Lỗi SMTP chắc chắn trước bước DATA (thư chưa thể tới hộp nhận): chỉ những lần lỗi này mới cho sự kiện kế của đơn gửi lại. */
const RETRYABLE_SMTP_CODES = ['EDNS', 'ETLS', 'EAUTH', 'EENVELOPE'] as const;
/** Khoá chống trùng tìm log từ trước lúc tạo đơn một ngày (đồng hồ Node và Postgres có thể lệch): giới hạn quét theo chỉ mục (templateCode, sentAt). */
const DEDUPE_LOOKBACK_MS = 86_400_000;

const retryableSmtpError = (error: string | null) => !!error && RETRYABLE_SMTP_CODES.some((c) => error.startsWith(`${c}:`));

/** Địa chỉ nhận: email tài khoản, không có thì email xuất hoá đơn VAT của đơn. Chuỗi phải là đúng một địa chỉ hợp lệ. */
export function orderEmailRecipient(userEmail: string | null | undefined, invoiceRequest: unknown): string | null {
  const one = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const { valid, invalid } = parseEmailRecipients(raw);
    return valid.length === 1 && invalid.length === 0 ? valid[0]! : null;
  };
  const vat = invoiceRequest && typeof invoiceRequest === 'object' && !Array.isArray(invoiceRequest) ? (invoiceRequest as { email?: unknown }).email : null;
  return one(userEmail) ?? one(vat);
}

/**
 * Email xác nhận đơn khi tin Zalo của MSS không tới khách (PO A3). Đúng một email mỗi đơn: khoá advisory theo mã đơn + dòng
 * `notification_logs` kênh EMAIL (PENDING/SENT chặn lần sau; FAILED chỉ cho sự kiện kế của cùng đơn thử lại khi lỗi chắc chắn trước bước DATA). Gửi ngoài transaction,
 * tối đa 30 giây. Không bao giờ ném: đường lui MSS và cron quét không thể bị email làm hỏng.
 */
@Injectable()
export class OrderConfirmEmailService {
  private readonly logger = new Logger(OrderConfirmEmailService.name);
  private readonly factory: MailTransportFactory;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly env: ConfigService<Env, true>,
    @Optional() @Inject(OPS_MAIL_TRANSPORT) factory?: MailTransportFactory,
  ) {
    this.factory = factory ?? defaultMailTransportFactory;
  }

  async enabled(): Promise<boolean> {
    try {
      return (await this.config.get<unknown>(ORDER_EMAIL_FALLBACK_FLAG, false)) === true;
    } catch {
      return false;
    }
  }

  /** SMTP đủ cấu hình để gửi (cùng điều kiện `run` dùng): cron quét bỏ cả câu chọn khi chưa sẵn sàng, vì lần gọi nào cũng ra SMTP_NOT_READY. */
  ready(): boolean {
    return this.smtp().state === 'ready';
  }

  private smtp(): OpsEmailConfig {
    try {
      return resolveOpsEmailConfig(Object.fromEntries(OPS_EMAIL_KEYS.map((k) => [k, this.env.get(k, { infer: true })])));
    } catch {
      return { state: 'disabled' };
    }
  }

  /** Gửi email cho một dòng outbox (sự kiện người mua `order.created` / `order.payment_confirmed`). */
  async sendForEvent(outboxRowId: string, now = Date.now()): Promise<OrderEmailOutcome> {
    try {
      return await this.run(outboxRowId, now);
    } catch (err) {
      this.logger.error(`Email xác nhận đơn (dòng outbox ${outboxRowId}) lỗi không lường trước: ${err instanceof Error ? err.message : String(err)}`);
      return 'ERROR';
    }
  }

  private async run(outboxRowId: string, now: number): Promise<OrderEmailOutcome> {
    if (!(await this.enabled())) return 'FLAG_OFF';
    const cfg = this.smtp();
    if (cfg.state !== 'ready') return 'SMTP_NOT_READY';
    const row = await this.prisma.mssOrderEventOutbox.findUnique({
      where: { id: outboxRowId },
      select: {
        orderId: true,
        eventId: true,
        eventType: true,
        recipientRole: true,
        status: true,
        resultReason: true,
        lastHttpStatus: true,
        expiresAt: true,
        order: {
          select: {
            code: true,
            status: true,
            createdAt: true,
            userId: true,
            guestTokenHash: true,
            total: true,
            paymentMethod: true,
            paymentStatus: true,
            invoiceRequest: true,
            user: { select: { email: true, zaloId: true, phone: true, mergedIntoId: true } },
            items: { orderBy: { id: 'asc' }, select: { productName: true, variationName: true, quantity: true, isGift: true } },
          },
        },
      },
    });
    if (!row || row.recipientRole !== 'buyer' || !MSS_EMAIL_EVENT_TYPES.has(row.eventType)) return 'NOT_ELIGIBLE';
    if (!mssEmailEligible(row.status as MssOutboxStatus, row.resultReason, row.lastHttpStatus)) return 'NOT_ELIGIBLE';
    // Đơn đã huỷ/giao/trả trong lúc chờ ZNS lỗi hẳn: thư "đã nhận đơn" lúc này sai sự thật.
    if (!ORDER_ZALO_ACTIVE_STATUSES.includes(row.order.status)) return 'NOT_ELIGIBLE';
    // Cùng hạn với ZNS đường lui: báo xác nhận trễ hàng giờ còn tệ hơn không báo.
    if (now > row.expiresAt.getTime() + MSS_FALLBACK_ZNS_GRACE_MS) return 'STALE';
    // Khách đã nhận một tin Zalo khác của chính đơn này qua MSS (kể cả tin người lạ): không email.
    const zaloSent = await this.prisma.mssOrderEventOutbox.findFirst({ where: { orderId: row.orderId, recipientRole: 'buyer', status: 'RESULT_SENT' }, select: { id: true } });
    if (zaloSent) return 'NOT_ELIGIBLE';
    const { order } = row;
    const to = orderEmailRecipient(order.user.email, order.invoiceRequest);
    const content = to ? await this.contentOf(row.eventType as EmailEventType, order, now) : null;

    const key = orderEmailDedupeKey(order.code);
    const base = { userId: order.userId, templateCode: ORDER_CONFIRM_EMAIL_TEMPLATE, channel: ORDER_EMAIL_CHANNEL };
    // Không lọc theo userId: đơn đổi chủ khi khách vãng lai đăng nhập (gộp tài khoản chuyển đơn, không chuyển log), mã đơn là duy nhất.
    const mine = {
      templateCode: ORDER_CONFIRM_EMAIL_TEMPLATE,
      channel: ORDER_EMAIL_CHANNEL,
      sentAt: { gte: new Date(order.createdAt.getTime() - DEDUPE_LOOKBACK_MS) },
      payload: { path: ['dedupeKey'], equals: key },
    };
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if (!to) {
        if (await tx.notificationLog.findFirst({ where: mine, select: { id: true } })) return { kind: 'DUPLICATE' as const };
        await tx.notificationLog.create({ data: { ...base, status: 'SKIPPED', error: 'no_email', payload: { dedupeKey: key, eventId: row.eventId } } });
        return { kind: 'NO_EMAIL' as const };
      }
      if (await tx.notificationLog.findFirst({ where: { ...mine, status: { in: ['PENDING', 'SENT'] } }, select: { id: true } })) return { kind: 'DUPLICATE' as const };
      // Lần lỗi trước không chắc thư chưa tới (hết 30 giây, mất kết nối giữa chừng): không gửi lại, thà thiếu còn hơn gửi đôi.
      const prior = await tx.notificationLog.findMany({ where: { ...mine, status: 'FAILED' }, select: { error: true } });
      if (prior.some((f) => !retryableSmtpError(f.error))) return { kind: 'DUPLICATE' as const };
      const failed = prior.length;
      const log = await tx.notificationLog.create({
        data: { ...base, status: 'PENDING', payload: { dedupeKey: key, eventId: row.eventId, to: maskEmail(to), attempts: failed + 1 } },
        select: { id: true },
      });
      return { kind: 'CLAIMED' as const, logId: log.id };
    });
    if (claim.kind !== 'CLAIMED') return claim.kind;

    const sent = await this.deliver(cfg, to!, content!);
    if (sent.ok) {
      await this.prisma.notificationLog.update({ where: { id: claim.logId }, data: { status: 'SENT', error: null } }).catch((err: unknown) => {
        // Log còn PENDING vẫn chặn email lần hai cho đơn này: thà mất dấu SENT còn hơn gửi đôi.
        this.logger.error(`Email đơn ${order.code} đã gửi nhưng ghi SENT lỗi (log ${claim.logId}): ${err instanceof Error ? err.message : String(err)}`);
      });
      this.logger.log(`order_confirm_email SENT order=${order.code} event=${row.eventId}`);
      return 'SENT';
    }
    await this.prisma.notificationLog.update({ where: { id: claim.logId }, data: { status: 'FAILED', error: sent.error } }).catch(() => undefined);
    this.logger.warn(`order_confirm_email FAILED order=${order.code} event=${row.eventId}: ${sent.error}`);
    return 'FAILED';
  }

  private async contentOf(
    eventType: EmailEventType,
    order: {
      code: string;
      guestTokenHash: string | null;
      total: number;
      paymentMethod: string;
      paymentStatus: string;
      user: { zaloId: string | null; phone: string | null; mergedIntoId: string | null };
      items: { productName: string; variationName: string; quantity: number; isGift: boolean }[];
    },
    now: number,
  ): Promise<OrderConfirmEmail> {
    const [billOn, zalo] = await Promise.all([
      this.config.get<unknown>(MSS_FLAG_KEYS.orderBill, false),
      this.config.get<unknown>(TUBU_ZALO_PHONE_KEY, TUBU_ZALO_PHONE_DEFAULT),
    ]);
    // Link khoá dài hạn của khách vãng lai đi theo cùng công tắc với tin Zalo (`mss.order_bill_enabled`); tắt thì trỏ trang tra cứu (khách gõ SĐT).
    const link =
      orderDetailUrl({
        origin: MSS_ORDER_LINK_ORIGIN,
        code: order.code,
        guestTokenHash: order.guestTokenHash,
        owner: order.user,
        secret: this.env.get('JWT_ACCESS_SECRET', { infer: true }) || undefined,
        now,
        guestLinks: billOn === true,
      }) ?? (order.guestTokenHash && isLiveGuestOwner(order.user) ? `${MSS_ORDER_LINK_ORIGIN}/don?ma=${encodeURIComponent(order.code)}` : null);
    return buildOrderConfirmEmail({
      code: order.code,
      eventType,
      items: order.items.map((it) => ({ name: it.productName, variant: it.variationName || null, quantity: it.quantity, gift: it.isGift })),
      totalVnd: order.total,
      paymentMethod: order.paymentMethod,
      paid: eventType === 'order.payment_confirmed' || order.paymentStatus === 'PAID',
      link,
      zaloPhone: tubuZaloPhoneOf(zalo),
    });
  }

  private async deliver(cfg: Ready, to: string, content: OrderConfirmEmail): Promise<{ ok: true } | { ok: false; error: string }> {
    let transport: MailTransport | undefined;
    try {
      transport = this.factory(cfg.smtp);
      await withTimeout(
        transport.sendMail({
          from: cfg.from.name ? { name: cfg.from.name, address: cfg.from.address } : cfg.from.address,
          to: [to],
          subject: content.subject,
          text: content.text,
          html: content.html,
          headers: { ...AUTO_MAIL_HEADERS },
        }),
        EMAIL_SEND_TIMEOUT_MS,
      );
      return { ok: true };
    } catch (e) {
      const code = typeof (e as { code?: unknown } | null)?.code === 'string' ? `${(e as { code: string }).code}: ` : '';
      const line = scrubSecrets(`${code}${e instanceof Error ? e.message : String(e)}`, [cfg.smtp.auth?.user ?? '', cfg.smtp.auth?.pass ?? '', to])
        .replace(/\s+/g, ' ')
        .trim();
      return { ok: false, error: line.length > ERROR_MAX ? `${line.slice(0, ERROR_MAX - 1)}…` : line };
    } finally {
      try {
        transport?.close();
      } catch {
        /* đóng kết nối là việc dọn dẹp */
      }
    }
  }
}
