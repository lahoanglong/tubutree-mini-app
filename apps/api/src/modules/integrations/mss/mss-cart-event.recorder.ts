import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MssHealthService } from './mss-health.service';
import { buildCartAbandonedBody, MssCartBodyError } from './mss-cart-event-body';
import {
  cartConsentOf,
  cartConsentSource,
  cartDedupeSince,
  cartExpiresAt,
  cartRefOf,
  MSS_CART_LIVE_RESULTS,
  MSS_CART_MAX_AGE_MS,
  type MssCartConsentSkip,
} from './mss-cart-event-types';
import { newEventId } from './mss-order-event-body';

export interface CartAbandonRemindedInput {
  userId: string;
  cartId: string;
  /** `updatedAt` của giỏ TRƯỚC khi job nhắc nhận việc (lần nhận việc đặt lại `updatedAt`). */
  abandonedAt: Date;
  /** Mốc job nhắc nhận việc (cùng giá trị đặt vào `abandonRemindedAt` và `updatedAt` của giỏ). */
  remindedAt: Date;
  /** Dòng còn bán của giỏ, theo thứ tự job nhắc đọc. */
  lines: readonly { name: string; quantity: number }[];
}

export type MssCartRecordOutcome =
  | 'recorded'
  | 'gate_closed'
  | 'too_old'
  | 'empty'
  | 'not_found'
  | MssCartConsentSkip
  | 'zns_channel'
  | 'deduped'
  | 'duplicate'
  | 'body_invalid'
  | 'error';

/** Mẫu tin trong app của job nhắc giỏ; admin đổi nó sang ZNS thì khách đã có một tin ngoài app, MSS không gửi thêm. */
const CART_ABANDONED_TEMPLATE = 'CART_ABANDONED';

/**
 * Ghi một sự kiện `cart.abandoned` để MSS nhắc khách qua Zalo, ngay sau khi job nhắc giỏ trong app gửi xong tin (w36-01). Không bao giờ
 * ném: mọi lý do (cờ, năng lực MSS, đồng ý, SĐT, trần 7 ngày, lỗi DB) chỉ trả về một mã, tin trong app không bị ảnh hưởng.
 */
@Injectable()
export class MssCartEventRecorder {
  private readonly logger = new Logger(MssCartEventRecorder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: MssHealthService,
  ) {}

  async onCartAbandonReminded(input: CartAbandonRemindedInput, now: Date = new Date()): Promise<MssCartRecordOutcome> {
    try {
      const outcome = await this.record(input, now);
      if (outcome === 'recorded') this.logger.log(`mss_cart_event_recorded cart=${input.cartId}`);
      return outcome;
    } catch (err) {
      this.logger.warn(`Không ghi được sự kiện giỏ MSS (cart=${input.cartId}): ${err instanceof Error ? err.message : String(err)}`);
      return 'error';
    }
  }

  private async record(input: CartAbandonRemindedInput, now: Date): Promise<MssCartRecordOutcome> {
    if (!(await this.health.assertCapability('cartAbandonedZalo'))) return 'gate_closed';
    if (now.getTime() - input.abandonedAt.getTime() > MSS_CART_MAX_AGE_MS) return 'too_old';
    const itemCount = input.lines.reduce((s, l) => s + (Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0), 0);
    if (itemCount < 1) return 'empty';

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        phone: true,
        phoneVerifiedAt: true,
        isBlocked: true,
        notifyPromo: true,
        notifyPromoAt: true,
        notifyOrderZalo: true,
        notifyOrderZaloAt: true,
        notifyOrderZaloSource: true,
      },
    });
    if (!user) return 'not_found';
    const consent = cartConsentOf(user, now);
    if (typeof consent === 'string') return consent;

    const tpl = await this.prisma.notificationTemplate.findUnique({ where: { code: CART_ABANDONED_TEMPLATE }, select: { channel: true, zaloTemplateId: true } });
    if (tpl?.channel === 'ZNS' && tpl.zaloTemplateId) return 'zns_channel';

    const lastOrder =
      user.notifyOrderZaloSource === 'checkout'
        ? await this.prisma.order.findFirst({ where: { userId: input.userId }, orderBy: { createdAt: 'desc' }, select: { platform: true } })
        : null;
    const eventId = newEventId(now.getTime());
    const cartRef = cartRefOf(input.cartId, input.abandonedAt);
    let body: { json: string; sha256: string };
    try {
      body = buildCartAbandonedBody({
        eventId,
        occurredAt: now,
        cart: { ref: cartRef, updatedAt: input.abandonedAt, itemCount, firstItemName: input.lines[0]?.name ?? null },
        customer: { phone: consent.phone, phoneSource: consent.phoneSource },
        consent: { at: consent.at, source: cartConsentSource(user.notifyOrderZaloSource, lastOrder?.platform ?? null) },
      });
    } catch (err) {
      if (err instanceof MssCartBodyError) {
        this.logger.warn(`Thân sự kiện giỏ MSS không hợp lệ (cart=${input.cartId}): ${err.message}`);
        return 'body_invalid';
      }
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      // Hai lượt nhắc chồng nhau (hai instance, hai giỏ của cùng khách) đếm rồi chèn tuần tự theo khách: trần 7 ngày không bị vượt.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mss-cart:${input.userId}`}))`;
      const live = await tx.mssCartEvent.count({
        where: {
          userId: input.userId,
          type: 'cart.abandoned',
          createdAt: { gte: cartDedupeSince(now) },
          OR: [
            { status: { in: ['PENDING', 'SENDING'] } },
            // 2xx mà không đọc được mã (null): coi như MSS đang giữ, tính vào trần.
            { status: 'ACCEPTED', OR: [{ resultStatus: { in: [...MSS_CART_LIVE_RESULTS] } }, { resultStatus: null }] },
          ],
        },
      });
      if (live > 0) return 'deduped' as const;
      const created = await tx.mssCartEvent.createMany({
        data: [
          {
            eventId,
            type: 'cart.abandoned',
            userId: input.userId,
            cartRef,
            cartId: input.cartId,
            cartUpdatedAt: input.abandonedAt,
            cartRemindedAt: input.remindedAt,
            occurredAt: now,
            body: body.json,
            bodySha256: body.sha256,
            nextAttemptAt: now,
            expiresAt: cartExpiresAt('cart.abandoned', input.abandonedAt, now),
            createdAt: now,
          },
        ],
        skipDuplicates: true,
      });
      return created.count === 1 ? ('recorded' as const) : ('duplicate' as const);
    });
  }
}
