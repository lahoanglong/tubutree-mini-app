import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Env } from '../../../config/env.validation';
import { MssFlagsService } from './mss-flags';
import { MssHealthService } from './mss-health.service';
import { MssClient } from './mss.client';
import { billMoneyConsistent, buildMssEventBody, greetingName, MssEventBodyError, newEventId, type MssBillInput } from './mss-order-event-body';
import { MSS_ORDER_LINK_ORIGIN, orderDetailUrl } from './mss-order-link';
import { MSS_FIRST_JOB_DELAY_MS, MssOrderEventDispatcher } from './mss-order-event.dispatch';
import { orderPhoneEditHistoryWhere } from '../../orders/order-customer-edit';
import {
  buyerPhoneOf,
  inRollout,
  MSS_EVENT_TTL_MS,
  MSS_RECIPIENT_EVENT_TYPES,
  ORDER_ZALO_CONSENT_TEXT_VERSION,
  outboxRecipientPhone,
  recipientPhoneFor,
  type BuyerPhone,
  type MssCancelReason,
  type MssOrderEventType,
  type MssPhoneSource,
  type OrderZaloConsentSource,
} from './mss-order-event-types';

/**
 * Cổng cờ được làm mới nền: transaction nghiệp vụ không chờ cấu hình, Redis hay MSS. Ngoại lệ duy nhất là lúc cổng chưa từng nạp (vừa
 * khởi động API): chờ lần nạp đầu tối đa MSS_COLD_GATE_WAIT_MS.
 */
export const MSS_GATE_REFRESH_MS = 15_000;

/** Đủ ngắn so với hạn 5 giây của transaction checkout; MSS treo thì quá hạn này coi cổng là đóng như trước. */
export const MSS_COLD_GATE_WAIT_MS = 1_500;

export { MSS_ORDER_LINK_ORIGIN };

export interface MssOrderEventGate {
  /** Cờ bật và đủ biến môi trường: worker được gửi, notifications được hỏi luật hoãn ZNS. */
  enabled: boolean;
  /** Thêm điều kiện MSS đã công bố năng lực `order_events`: được ghi sự kiện mới. */
  open: boolean;
  rolloutPct: number;
  /** Thêm `open`, cờ `mss.order_recipient_enabled` bật và MSS công bố `order_events.recipient_role`: được ghi dòng người nhận (PO A1). */
  recipient: boolean;
  /** Thêm `open`, cờ `mss.order_bill_enabled` bật và MSS công bố `order_events.bill_v1`: tin đặt đơn/đã thanh toán của người mua kèm bill. */
  bill: boolean;
  at: number;
}

const CLOSED_GATE: MssOrderEventGate = { enabled: false, open: false, rolloutPct: 0, recipient: false, bill: false, at: 0 };

export type MssRecordSkip =
  | 'gate_closed'
  | 'circuit_open'
  | 'not_found'
  | 'platform_null'
  | 'placed_for_customer'
  | 'dealer_order'
  | 'no_consent'
  | 'rollout'
  | 'no_phone'
  | 'cod_payment'
  | 'payment_timeout_unnotified'
  | 'duplicate'
  | 'body_invalid';

export interface MssRecordExtra {
  cancelReason?: MssCancelReason;
  refundExpected?: boolean;
}

const RECORD_SELECT = {
  id: true,
  code: true,
  type: true,
  userId: true,
  platform: true,
  paymentMethod: true,
  total: true,
  placedForCustomer: true,
  orderZaloConsent: true,
  orderZaloConsentAt: true,
  shippingPartner: true,
  shippingCode: true,
  checkoutGroup: true,
  shippingAddress: true,
  notifyRecipientZalo: true,
  guestPhone: true,
  guestTokenHash: true,
  subtotal: true,
  discount: true,
  shippingFee: true,
  createdAt: true,
  items: { select: { productName: true, variationName: true, quantity: true, unitPrice: true, total: true, isGift: true }, orderBy: { id: 'asc' } },
  user: { select: { phone: true, zaloId: true, mergedIntoId: true, phoneVerifiedAt: true, fullName: true, notifyOrderZalo: true, notifyOrderZaloSource: true } },
} as const satisfies Prisma.OrderSelect;
type RecordedOrder = Omit<Prisma.OrderGetPayload<{ select: typeof RECORD_SELECT }>, 'platform'> & { platform: 'web' | 'miniapp' };

interface PlacedOrderLike {
  id: string;
  userId: string;
  paymentStatus: string;
  paymentMethod: string;
}

/**
 * Một cửa phát sự kiện đơn sang MSS (hợp đồng tubu-mss-order-events v1.2). Mọi hàm `on*` chạy TRONG transaction của nghiệp vụ: dòng
 * outbox commit cùng lần đổi trạng thái hoặc không có gì. Không bao giờ ném vì lý do MSS (cờ, đồng ý, thân không hợp lệ đều bỏ qua
 * êm); lỗi DB thật thì để transaction hỏng như mọi câu lệnh khác trong đó.
 */
@Injectable()
export class MssOrderEventRecorder implements OnModuleInit {
  private readonly logger = new Logger(MssOrderEventRecorder.name);
  private gateState: MssOrderEventGate = CLOSED_GATE;
  private inflight: Promise<MssOrderEventGate> | null = null;
  private coldWaitDone = false;

  constructor(
    private readonly flags: MssFlagsService,
    private readonly health: MssHealthService,
    private readonly client: MssClient,
    private readonly dispatcher: MssOrderEventDispatcher,
    private readonly env: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    void this.refreshGate();
  }

  /** Cổng hiện tại (đồng bộ, không I/O); cũ quá MSS_GATE_REFRESH_MS thì làm mới nền cho lần sau. */
  gate(now = Date.now()): MssOrderEventGate {
    if (now - this.gateState.at >= MSS_GATE_REFRESH_MS) void this.refreshGate();
    return this.gateState;
  }

  refreshGate(): Promise<MssOrderEventGate> {
    this.inflight ??= this.loadGate()
      .then((g) => (this.gateState = g))
      .catch((err: unknown) => {
        this.logger.warn(`Không đọc được cờ MSS order_events, coi như tắt: ${err instanceof Error ? err.message : String(err)}`);
        return (this.gateState = { ...CLOSED_GATE, at: Date.now() });
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async loadGate(): Promise<MssOrderEventGate> {
    // assertCapability gọi cả khi cờ coi như tắt: nó là chỗ báo Ops khi admin bật cờ mà thiếu biến MSS_* hay MSS thiếu năng lực.
    const [enabled, capable, snap, recipientOn, recipientCapable, billOn, billCapable] = await Promise.all([
      this.flags.isEnabled('orderEvents'),
      this.health.assertCapability('orderEvents'),
      this.flags.snapshot(),
      this.flags.isEnabled('orderRecipient'),
      this.health.assertCapability('orderRecipient'),
      this.flags.isEnabled('orderBill'),
      this.health.assertCapability('orderBill'),
    ]);
    if (!enabled) return { ...CLOSED_GATE, at: Date.now() };
    return {
      enabled,
      open: capable,
      rolloutPct: snap.orderEventsRolloutPct,
      recipient: capable && recipientOn && recipientCapable,
      bill: capable && billOn && billCapable,
      at: Date.now(),
    };
  }

  /**
   * Cổng cho một quyết định trong transaction. Cổng chưa từng nạp (`at === 0`: API vừa khởi động, lần nạp ở onModuleInit chưa xong) thì
   * chờ lần nạp đó tối đa MSS_COLD_GATE_WAIT_MS thay vì coi ngay là đóng; đã nạp thì như `gate()`, không I/O.
   * Chỉ chờ một đợt: lần nạp đầu treo (MSS chậm lúc deploy có thể 8–9 giây) mà mọi transaction sau đều chờ thêm thì pool cạn, checkout hỏng.
   */
  private async readyGate(): Promise<MssOrderEventGate> {
    if (this.gateState.at === 0 && !this.coldWaitDone) {
      await settleWithin(this.refreshGate(), MSS_COLD_GATE_WAIT_MS);
      this.coldWaitDone = true;
    }
    return this.gate();
  }

  /**
   * Đặt hàng (checkout, trong tx tạo đơn). `consent` là ô đồng ý của lần đặt này: true/false được nhớ cho khách (`users.notifyOrderZalo`),
   * bỏ trống thì dùng lựa chọn đã nhớ. Cổng đóng thì không ghi lựa chọn đồng ý, chỉ đánh dấu nguồn `gate_closed` lên đơn.
   */
  async onOrdersPlaced(tx: Prisma.TransactionClient, orders: readonly PlacedOrderLike[], consent: boolean | undefined): Promise<void> {
    if (orders.length === 0) return;
    if (!(await this.readyGate()).enabled) {
      // Không hỏi khách nên `orderZaloConsent` để null (bật muộn ở chi tiết đơn vẫn được). Nguồn `gate_closed` cho Ops tách "cổng MSS đóng"
      // khỏi "khách không đồng ý" (false).
      const source: OrderZaloConsentSource = 'gate_closed';
      await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { orderZaloConsentSource: source } });
      return;
    }
    const userId = orders[0]!.userId;
    const now = new Date();
    let granted: boolean;
    let capturedAt: Date | null;
    if (consent === true || consent === false) {
      await tx.user.update({
        where: { id: userId },
        data: { notifyOrderZalo: consent, notifyOrderZaloAt: now, notifyOrderZaloSource: 'checkout', notifyOrderZaloTextVersion: ORDER_ZALO_CONSENT_TEXT_VERSION },
      });
      granted = consent;
      capturedAt = consent ? now : null;
    } else {
      const saved = await tx.user.findUnique({ where: { id: userId }, select: { notifyOrderZalo: true, notifyOrderZaloAt: true } });
      granted = saved?.notifyOrderZalo === true;
      capturedAt = granted ? saved!.notifyOrderZaloAt ?? now : null;
    }
    await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { orderZaloConsent: granted, orderZaloConsentAt: capturedAt } });
    if (!granted) return;
    for (const order of orders) {
      await this.record(tx, order.id, 'order.created');
      if (order.paymentStatus === 'PAID' && order.paymentMethod !== 'COD') await this.record(tx, order.id, 'order.payment_confirmed');
    }
  }

  /** `paymentStatus` vừa lật sang PAID trong `tx` (ZaloPay, admin xác nhận chuyển khoản, đại lý). */
  async onPaid(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    if (!(await this.readyGate()).open) return;
    await this.record(tx, orderId, 'order.payment_confirmed');
  }

  /**
   * Trạng thái đơn vừa đổi trong `tx`. Chỉ SHIPPING, DELIVERED, CANCELLED có sự kiện (PACKED, RETURNED không phát ở v1).
   * `paidBefore`: đơn đã thu tiền trước lần huỷ này (hợp đồng: `refund_expected`).
   */
  async onStatusChanged(
    tx: Prisma.TransactionClient,
    orderId: string,
    to: string,
    ctx: { from: string; actorType?: string | null; paidBefore?: boolean },
  ): Promise<void> {
    if (!(await this.readyGate()).open) return;
    if (to === 'SHIPPING') await this.record(tx, orderId, 'order.shipping');
    else if (to === 'DELIVERED') await this.record(tx, orderId, 'order.delivered');
    else if (to === 'CANCELLED') {
      await this.record(tx, orderId, 'order.cancelled', { cancelReason: cancelReasonOf(ctx.from, ctx.actorType), refundExpected: ctx.paidBefore === true });
    }
  }

  /**
   * Ghi dòng outbox của người mua, và với tin giao hàng thêm dòng người nhận khi khách đã bật (PO A1). Trả lý do bỏ qua của dòng người mua,
   * hoặc null khi đã ghi; dòng người nhận bị bỏ (cờ tắt, cùng số, số hỏng) chỉ ghi log.
   */
  async record(tx: Prisma.TransactionClient, orderId: string, eventType: MssOrderEventType, extra: MssRecordExtra = {}): Promise<MssRecordSkip | null> {
    const gate = await this.readyGate();
    if (!gate.open) return 'gate_closed';
    if (this.client.circuit.isTripped()) return 'circuit_open';
    const order = await tx.order.findUnique({ where: { id: orderId }, select: RECORD_SELECT });
    const skip = (why: MssRecordSkip): MssRecordSkip => {
      this.logger.debug(`mss_order_event_skipped ${eventType} order=${order?.code ?? orderId} reason=${why}`);
      return why;
    };
    if (!order) return skip('not_found');
    if (order.platform !== 'web' && order.platform !== 'miniapp') return skip('platform_null');
    if (order.placedForCustomer) return skip('placed_for_customer');
    if (order.type !== 'RETAIL') return skip('dealer_order');
    if (order.orderZaloConsent !== true || order.user.notifyOrderZalo !== true) return skip('no_consent');
    if (!inRollout(order.userId, gate.rolloutPct)) return skip('rollout');
    const found = buyerPhoneOf({ user: order.user, guestPhone: order.guestPhone, shippingAddress: order.shippingAddress });
    if (!found) return skip('no_phone');
    if (eventType === 'order.payment_confirmed' && order.paymentMethod === 'COD') return skip('cod_payment');
    const buyer = await this.buyerAtPlacement(tx, order.id, eventType, found);

    const placed: RecordedOrder = { ...order, platform: order.platform };
    const bought = await this.writeRow(
      tx,
      placed,
      eventType,
      { role: 'buyer', phone: buyer.phone, source: buyer.source, name: greetingName(order.user.fullName) },
      extra,
      gate.bill && buyer.billOpen,
    );
    if (bought !== null && bought !== 'duplicate') return skip(bought);
    if (MSS_RECIPIENT_EVENT_TYPES.includes(eventType)) await this.recordRecipient(tx, placed, eventType, buyer.phone, gate);
    return bought === null ? null : skip(bought);
  }

  /**
   * Số người mua của dòng này và có được kèm bill không. Tài khoản không có số thì số người mua là SĐT giao hàng, mà khách tự sửa được SĐT đó
   * trước khi đóng gói: tin sau tin đặt đơn đi về số ở dòng người mua sớm nhất của đơn (thân lưu nguyên `recipient.phone` lúc ghi), không về số
   * mới. Bill (giá từng món) chỉ đi khi chứng minh được số đó có từ trước lần sửa SĐT đầu tiên; không chứng minh được (chưa có dòng nào, hoặc
   * dòng sớm nhất ghi sau lần sửa, ví dụ khách bật Zalo muộn) thì vẫn gửi tin trạng thái nhưng bỏ bill. Số tài khoản hay số khách vãng lai
   * không đổi theo địa chỉ nên không đọc gì thêm.
   * Chỉ ghim khi đơn có lần tự sửa SĐT: dòng sớm nhất có thể đã ghi theo số tài khoản mà sau đó bị gỡ (`phoneIfFree` trả số chưa xác minh cho chủ
   * Zalo thật), ghim về số đó là gửi tin đơn cho người khác. Chưa sửa SĐT thì đi theo SĐT giao hàng hiện tại như trước w40-01.
   */
  private async buyerAtPlacement(
    tx: Prisma.TransactionClient,
    orderId: string,
    eventType: MssOrderEventType,
    found: BuyerPhone,
  ): Promise<{ phone: string; source: MssPhoneSource; billOpen: boolean }> {
    if (found.via !== 'shipping') return { phone: found.phone, source: found.source, billOpen: true };
    const firstPhoneEdit = await tx.orderStatusHistory.findFirst({
      where: orderPhoneEditHistoryWhere(orderId),
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!firstPhoneEdit) return { phone: found.phone, source: found.source, billOpen: true };
    const earliest =
      eventType === 'order.created'
        ? null
        : await tx.mssOrderEventOutbox.findFirst({
            where: { orderId, recipientRole: 'buyer' },
            orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
            select: { body: true, createdAt: true },
          });
    const pinned = earliest ? outboxRecipientPhone(earliest.body) : null;
    const phone = pinned ?? found.phone;
    // Chỉ tin đặt đơn và tin đã thanh toán có bill.
    if (eventType !== 'order.created' && eventType !== 'order.payment_confirmed') return { phone, source: found.source, billOpen: true };
    const billOpen = pinned !== null && earliest!.createdAt < firstPhoneEdit.createdAt;
    if (!billOpen) this.logger.log(`mss_order_event_bill_dropped ${eventType} order=${orderId} reason=buyer_phone_edited`);
    return { phone, source: found.source, billOpen };
  }

  /** Dòng người nhận của tin giao hàng (PO A1): không kèm giá, nguồn số `checkout_contact`. Lý do bỏ qua chỉ ghi log. */
  private async recordRecipient(tx: Prisma.TransactionClient, order: RecordedOrder, eventType: MssOrderEventType, buyerPhone: string, gate: MssOrderEventGate): Promise<void> {
    const note = (why: string) => this.logger.debug(`mss_order_event_recipient_skipped ${eventType} order=${order.code} reason=${why}`);
    if (!order.notifyRecipientZalo) return;
    if (!gate.recipient) return note('recipient_off');
    const to = recipientPhoneFor(order, buyerPhone);
    if (!to) return note('same_or_invalid_phone');
    const why = await this.writeRow(tx, order, eventType, { role: 'recipient', phone: to, source: 'checkout_contact', name: null }, {}, false);
    if (why) note(why);
  }

  private async writeRow(
    tx: Prisma.TransactionClient,
    order: RecordedOrder,
    eventType: MssOrderEventType,
    to: { role: 'buyer' | 'recipient'; phone: string; source: MssPhoneSource; name: string | null },
    extra: MssRecordExtra,
    billOpen: boolean,
  ): Promise<'duplicate' | 'payment_timeout_unnotified' | 'not_found' | 'body_invalid' | null> {
    const orderId = order.id;
    const existing = await tx.mssOrderEventOutbox.findUnique({
      where: { orderId_eventType_recipientRole: { orderId, eventType, recipientRole: to.role } },
      select: { id: true },
    });
    if (existing) return 'duplicate';
    if (to.role === 'buyer' && eventType === 'order.cancelled' && extra.cancelReason === 'PAYMENT_TIMEOUT') {
      // Chỉ tin đã tới chính người mua mới tính "đã báo": tin giao hàng gửi người nhận không làm đơn hết hạn thanh toán thành có tin huỷ.
      const notified = await tx.mssOrderEventOutbox.count({ where: { orderId, status: 'RESULT_SENT', recipientRole: 'buyer' } });
      if (notified === 0) return 'payment_timeout_unnotified';
    }

    const groupSize =
      order.checkoutGroup && (eventType === 'order.created' || eventType === 'order.payment_confirmed')
        ? await tx.order.count({ where: { checkoutGroup: order.checkoutGroup } })
        : null;
    const occurredAt = new Date();
    const eventId = newEventId(occurredAt.getTime());
    const seqRows = await tx.$queryRaw<{ seq: number }[]>`UPDATE "orders" SET "mssEventSeq" = "mssEventSeq" + 1 WHERE "id" = ${orderId} RETURNING "mssEventSeq" AS seq`;
    const seq = seqRows[0]?.seq;
    if (seq === undefined) return 'not_found';

    // Chỉ dòng người mua có link và bill. Dòng người nhận (PO A1) không kèm giá, tên món hay link tới trang có giá của người mua.
    // Link khách vãng lai (khoá 60 ngày) đi theo cổng bill ở mọi loại tin, kể cả tracking_url của tin giao hàng. Tắt cờ chỉ dừng cấp link
    // mới: khoá đã gửi vẫn mở được tới hết hạn (verifyGuestLookupKey không xét cờ); thu hồi hết chỉ bằng cách đổi JWT_ACCESS_SECRET.
    const buyerRow = to.role === 'buyer';
    const linkUrl = buyerRow
      ? orderDetailUrl({
          origin: MSS_ORDER_LINK_ORIGIN,
          code: order.code,
          guestTokenHash: order.guestTokenHash,
          owner: order.user,
          secret: this.env.get('JWT_ACCESS_SECRET', { infer: true }) || undefined,
          now: occurredAt.getTime(),
          guestLinks: billOpen,
        })
      : null;
    const bill = buyerRow && billOpen && (eventType === 'order.created' || eventType === 'order.payment_confirmed') ? this.billOf(order) : null;

    let body: { json: string; sha256: string };
    try {
      body = buildMssEventBody({
        eventId,
        eventType,
        occurredAt,
        sequence: seq,
        order: {
          code: order.code,
          total: order.total,
          paymentMethod: order.paymentMethod,
          platform: order.platform,
          itemNames: order.items.map((i) => i.productName),
          shippingPartner: order.shippingPartner,
          shippingCode: order.shippingCode,
          checkoutGroup: order.checkoutGroup,
          groupSize,
          linkUrl,
        },
        bill,
        cancelReason: extra.cancelReason,
        refundExpected: extra.refundExpected,
        recipient: to.role === 'recipient' ? { phone: to.phone, phoneSource: to.source, role: 'recipient' } : { phone: to.phone, phoneSource: to.source, name: to.name },
        consent:
          to.role === 'recipient'
            ? { capturedAt: order.createdAt, source: 'checkout' }
            : { capturedAt: order.orderZaloConsentAt ?? occurredAt, source: order.user.notifyOrderZaloSource === 'account_settings' ? 'account_settings' : 'checkout' },
        // Không dựng được link (khách vãng lai Mini không có tài khoản web, dòng người nhận) thì không gửi link nào.
        linkOrigin: linkUrl ? MSS_ORDER_LINK_ORIGIN : null,
      });
    } catch (err) {
      if (!(err instanceof MssEventBodyError)) throw err;
      this.logger.warn(`Bỏ sự kiện MSS ${eventType} (${to.role}) của đơn ${order.code}: ${err.message}`);
      return 'body_invalid';
    }

    const inserted = await tx.mssOrderEventOutbox.createMany({
      data: [
        {
          eventId,
          orderId,
          orderCode: order.code,
          eventType,
          sequence: seq,
          occurredAt,
          body: body.json,
          bodySha256: body.sha256,
          status: 'PENDING',
          nextAttemptAt: occurredAt,
          expiresAt: new Date(occurredAt.getTime() + MSS_EVENT_TTL_MS[eventType]),
          recipientRole: to.role,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return 'duplicate';
    this.logger.log(`mss_order_event_recorded ${eventType} order=${order.code} event=${eventId} seq=${seq} role=${to.role}`);
    this.dispatcher.enqueue(eventId, 0, MSS_FIRST_JOB_DELAY_MS);
    return null;
  }

  /**
   * Bill theo dòng hàng (`OrderItem.id` tăng dần). `OrderItem.total` đã trừ phần combo/Hộp Xanh phân bổ vào dòng, còn `subtotal` là tiền hàng
   * trước mọi khoản giảm (combo nằm trong `discount`). MSS chỉ in Tạm tính/Giảm/Phí ship khi tổng thành tiền các dòng bằng tạm tính, nên thành tiền
   * gửi `unitPrice × quantity` khi tổng các tích đó bằng `subtotal`; không khớp thì giữ `total`. Tiền lệch tổng đơn chỉ ghi cảnh báo: bộ dựng
   * thân tự bỏ ba khoá tiền, món vẫn đi.
   */
  private billOf(order: RecordedOrder): MssBillInput {
    const gross = order.items.map((i) => i.unitPrice * i.quantity);
    const grossMatchesSubtotal = gross.reduce((sum, v) => sum + v, 0) === order.subtotal;
    const bill: MssBillInput = {
      subtotal: order.subtotal,
      discount: order.discount,
      shippingFee: order.shippingFee,
      items: order.items.map((i, k) => ({
        name: i.productName,
        variant: i.variationName,
        qty: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: grossMatchesSubtotal ? gross[k]! : i.total,
        gift: i.isGift,
      })),
    };
    if (!billMoneyConsistent(order.total, bill)) {
      this.logger.warn(
        `mss_bill_money_mismatch order=${order.code} subtotal=${order.subtotal} discount=${order.discount} shippingFee=${order.shippingFee} total=${order.total}`,
      );
    }
    return bill;
  }
}

/** Hợp đồng mục 3.3: lý do huỷ khách thấy được. Hết hạn thanh toán là lần huỷ tự động của đơn còn chờ tiền. */
export function cancelReasonOf(from: string, actorType: string | null | undefined): MssCancelReason {
  if (actorType === 'CUSTOMER') return 'CUSTOMER';
  if (from === 'PENDING_PAYMENT' && (!actorType || actorType === 'SYSTEM')) return 'PAYMENT_TIMEOUT';
  return 'OTHER';
}

/** Chờ `p` xong hoặc hết `ms`, tuỳ cái nào tới trước. Không ném, không giữ tiến trình sống. */
async function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  try {
    await Promise.race([p.then(() => undefined, () => undefined), expired]);
  } finally {
    clearTimeout(timer);
  }
}

