import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type User } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { isRealUser } from '../../../common/real-user';
import { hashIp } from '../../../common/ip-hash';
import { safeEqualStrings } from '../../../common/safe-equal';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AnalyticsEventsService } from '../../analytics/analytics-events.service';
import { AuthService } from '../../auth/auth.service';
import { BankTransferService } from '../../integrations/payment/bank-transfer.service';
import { FlashSaleService } from '../../flash-sale/flash-sale.service';
import { CheckoutService, type GuestCheckoutContext } from '../checkout.service';
import type { PlaceOrderDto, QuoteDto } from '../dto/checkout.dto';
import { MAX_ITEM_QUANTITY } from '../../cart/dto/cart.dto';
import type { GuestAddressDto, GuestLineDto, GuestPlaceOrderDto, GuestQuoteDto } from './dto/guest-checkout.dto';
import {
  GUEST_CLOSED_STATUSES,
  GUEST_DEVICE_DAILY_CAP,
  GUEST_MIN_FILL_MS,
  GUEST_PHONE_OPEN_CAP,
  GUEST_PHONE_WINDOW_CAP,
  GUEST_PHONE_WINDOW_DAYS,
  GUEST_TRACK_TTL_DAYS,
  guestCodOverMaxMessage,
  readGuestCheckoutSettings,
  type GuestCheckoutSettings,
} from './guest-checkout.config';

const DAY_MS = 86_400_000;
/** Đơn vãng lai chưa xong cũ hơn mốc này không còn được đếm vào trần "đơn chưa hoàn tất" (đếm theo chỉ mục createdAt, không quét cả bảng). */
const OPEN_LOOKBACK_DAYS = 90;
/** Lần gửi khác khoá (tab thứ hai) trong khoảng này với đúng các món của đơn vừa đặt: không dựng lại giỏ, checkout trả đơn vừa đặt. */
const RECENT_REPLAY_MS = 2 * 60_000;
/** Dòng địa chỉ của một khách vãng lai: giữ vài dòng gần nhất (đơn lưu bản chụp địa chỉ nên xoá dòng cũ không ảnh hưởng đơn). */
const MAX_GUEST_ADDRESSES = 5;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_:-]{8,128}$/;

export const GUEST_LIMIT = 'GUEST_LIMIT';
export const GUEST_LOGIN_REQUIRED = 'GUEST_LOGIN_REQUIRED';
/** Một câu cho mọi lần chặn (trần SĐT, IP, thiết bị, số bị chặn, ô bẫy, điền quá nhanh): không lộ lớp nào đã chặn. */
export const GUEST_LIMIT_MESSAGE = 'Hiện chưa đặt thêm được đơn khi chưa đăng nhập. Bạn đăng nhập Zalo để đặt tiếp và theo dõi đơn ở một nơi nhé.';
const LOGIN_REQUIRED_MESSAGE = 'Trình duyệt này đã gắn với một tài khoản. Bạn đăng nhập Zalo để đặt hàng nhé.';
const NOT_FOUND_MESSAGE = 'Không tìm thấy đơn hàng.';

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
/** Băm giả để nhánh "không có đơn" vẫn so một lần như nhánh có đơn. */
const DUMMY_HASH = sha256Hex('guest-order-key-missing');

/** 0912345678 → 091****678. */
export function maskPhone(phone: string): string {
  return phone.length >= 10 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

function guestLimit(): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: GUEST_LIMIT, message: GUEST_LIMIT_MESSAGE });
}

function mergeLines(lines: readonly GuestLineDto[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.variationId, Math.min(MAX_ITEM_QUANTITY, (merged.get(l.variationId) ?? 0) + l.quantity));
  return merged;
}

const ADDRESS_FIELDS = ['recipient', 'phone', 'province', 'district', 'ward', 'street', 'provinceCode', 'districtCode', 'wardCode'] as const;
const sameAddress = (snapshot: unknown, a: GuestAddressDto) =>
  typeof snapshot === 'object' && snapshot !== null && ADDRESS_FIELDS.every((k) => (snapshot as Record<string, unknown>)[k] === a[k]);

const sameLines = (a: ReadonlyMap<string, number>, b: readonly { variationId: string; quantity: number }[]) =>
  a.size === b.length && b.every((l) => a.get(l.variationId) === l.quantity);

export interface GuestRequestMeta {
  deviceId: string;
  ip: string;
}

/**
 * Đặt hàng trên web không cần đăng nhập Zalo (cờ web.guest_checkout_enabled). Khách là một dòng users vãng lai theo deviceId của trình
 * duyệt (không cấp phiên), giỏ trên trình duyệt được chép vào giỏ máy chủ của dòng đó rồi đi đúng đường tính tiền và đặt đơn của
 * CheckoutService (chế độ khách: không mã, không hạng, không Điểm Xanh, không giá Giờ vàng). Đơn mang SĐT khách gõ (orders.guestPhone),
 * băm khoá theo dõi (orders.guestTokenHash) và băm IP (orders.guestIpHash) để kiểm trần.
 */
@Injectable()
export class GuestCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly auth: AuthService,
    private readonly bankTransfer: BankTransferService,
    private readonly config: SystemConfigService,
    private readonly analytics: AnalyticsEventsService,
    private readonly env: ConfigService<Env, true>,
    private readonly flash: FlashSaleService,
  ) {}

  private async settingsOrNotFound(): Promise<GuestCheckoutSettings> {
    const settings = await readGuestCheckoutSettings(this.config);
    if (!settings.enabled) throw new NotFoundException();
    return settings;
  }

  private async guestUser(deviceId: string): Promise<User> {
    const user = await this.auth.ensureGuestUser(deviceId);
    if (user.isBlocked) throw guestLimit();
    if (isRealUser(user)) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict', code: GUEST_LOGIN_REQUIRED, message: LOGIN_REQUIRED_MESSAGE });
    }
    return user;
  }

  /**
   * Chép giỏ trình duyệt vào giỏ máy chủ của khách (thay toàn bộ, bỏ mã giảm giá và lựa chọn quà cũ), dưới khoá dòng giỏ như đặt đơn.
   * Không dựng lại khi lần gửi này là lần gửi lại của đơn đã có (cùng Idempotency-Key, hoặc tab khác gửi đúng các món, địa chỉ và cách
   * trả của đơn vừa đặt): giỏ đã được đơn đó dọn, dựng lại là đặt thêm một đơn. Dòng trỏ biến thể không có thật bị bỏ (khoá ngoại).
   */
  private async syncCart(
    userId: string,
    lines: readonly GuestLineDto[],
    replayGuard?: { idempotencyKey: string; address: GuestAddressDto; paymentMethod: string },
  ): Promise<void> {
    const merged = mergeLines(lines);
    const known = await this.prisma.variation.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true } });
    const knownIds = new Set(known.map((v) => v.id));
    const wanted = [...merged].filter(([id]) => knownIds.has(id)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let cartId: string;
    try {
      cartId = (await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } })).id;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      cartId = (await this.prisma.cart.findUniqueOrThrow({ where: { userId }, select: { id: true } })).id;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "carts" WHERE "id" = ${cartId} FOR NO KEY UPDATE`;
      if (replayGuard) {
        if (await tx.order.findUnique({ where: { idempotencyKey: replayGuard.idempotencyKey }, select: { id: true } })) return;
        const recent = await tx.order.findFirst({
          where: { userId, guestPhone: { not: null }, status: { not: 'CANCELLED' }, createdAt: { gte: new Date(Date.now() - RECENT_REPLAY_MS) } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, checkoutGroup: true, paymentMethod: true, shippingAddress: true },
        });
        if (recent && recent.paymentMethod === replayGuard.paymentMethod && sameAddress(recent.shippingAddress, replayGuard.address)) {
          const items = await tx.orderItem.findMany({
            where: recent.checkoutGroup ? { order: { checkoutGroup: recent.checkoutGroup, userId } } : { orderId: recent.id },
            select: { variationId: true, quantity: true, isGift: true },
          });
          if (sameLines(new Map(wanted), items.filter((i) => !i.isGift))) return;
        }
      }
      await tx.cartItem.deleteMany({ where: { cartId, variationId: { notIn: wanted.map(([id]) => id) } } });
      for (const [variationId, quantity] of wanted) {
        await tx.cartItem.upsert({
          where: { cartId_variationId: { cartId, variationId } },
          update: { quantity },
          create: { cartId, variationId, quantity },
        });
      }
      // Giỏ máy chủ của khách chỉ là bản sao để tính tiền: đánh dấu "đã nhắc" cùng mốc cập nhật để cron nhắc giỏ bỏ quên bỏ qua nó.
      const now = new Date();
      await tx.cart.update({ where: { id: cartId }, data: { couponCode: null, giftChoice: null, abandonRemindedAt: now, updatedAt: now } });
    });
  }

  /** Dòng địa chỉ cho lần tính tiền này: dùng lại dòng cùng nội dung (gửi lại cùng địa chỉ ra cùng bản chụp), không thì tạo mới. */
  private async addressFor(userId: string, a: GuestAddressDto): Promise<string> {
    const fields = {
      recipient: a.recipient,
      phone: a.phone,
      province: a.province,
      district: a.district,
      ward: a.ward,
      street: a.street,
      provinceCode: a.provinceCode,
      districtCode: a.districtCode,
      wardCode: a.wardCode,
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-address:${userId}`}))`;
      const same = await tx.address.findFirst({ where: { userId, ...fields }, select: { id: true } });
      if (same) return same.id;
      const created = await tx.address.create({ data: { ...fields, userId, isDefault: true }, select: { id: true } });
      await tx.address.updateMany({ where: { userId, id: { not: created.id } }, data: { isDefault: false } });
      // addresses không có cột thời gian; id cuid tăng theo thời điểm tạo nên giữ các dòng có id lớn nhất.
      const stale = await tx.address.findMany({ where: { userId }, orderBy: { id: 'desc' }, skip: MAX_GUEST_ADDRESSES, select: { id: true } });
      if (stale.length > 0) await tx.address.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      return created.id;
    });
  }

  async quote(meta: GuestRequestMeta, dto: GuestQuoteDto) {
    const settings = await this.settingsOrNotFound();
    const user = await this.guestUser(meta.deviceId);
    await this.syncCart(user.id, dto.lines);
    const addressId = await this.addressFor(user.id, dto.address);
    const q = await this.checkout.quote(user.id, { addressId } as QuoteDto, true);
    const blockedPaymentMethods: Record<string, string> = {};
    for (const method of ['COD', 'BANK_TRANSFER'] as const) {
      const reason = q.blockedPaymentMethods[method];
      if (reason) blockedPaymentMethods[method] = reason;
    }
    if (!blockedPaymentMethods.COD && q.total > settings.codMax) blockedPaymentMethods.COD = guestCodOverMaxMessage(settings.codMax);
    // Món đang có giá Giờ vàng (tính như khách chưa xác định, không theo lượt đã mua): khách vãng lai mua giá thường nên web mời đăng nhập.
    const flashNow = await this.flash.resolveEffective([...new Set(dto.lines.map((l) => l.variationId))]);
    return {
      flashNotice: flashNow.size > 0,
      shipments: q.shipments,
      blockedPaymentMethods,
      codMax: settings.codMax,
      subtotal: q.subtotal,
      discount: q.discount,
      comboDiscount: q.comboDiscount,
      ...(q.greenBoxDiscount !== undefined ? { greenBoxDiscount: q.greenBoxDiscount } : {}),
      shippingFee: q.shippingFee,
      ...(q.giftTrial ? { giftTrial: q.giftTrial } : {}),
      total: q.total,
      items: q.items.map((it) => ({
        id: it.id,
        variationId: it.variationId,
        productName: it.productName,
        variationName: it.variationName,
        slug: it.slug,
        thumbnail: it.thumbnail,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        total: it.total,
      })),
    };
  }

  /** Kiểm trần dưới khoá theo SĐT rồi theo IP (luôn cùng thứ tự nên hai lần đặt không khoá chéo). Đếm theo lần đặt (một nhóm tách = một). */
  private capsChecker(userId: string, phone: string, ipHash: string | null, settings: GuestCheckoutSettings) {
    return async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-phone:${phone}`}))`;
      if (ipHash) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-ip:${ipHash}`}))`;
      const now = Date.now();
      const closed = Prisma.join(GUEST_CLOSED_STATUSES.map((s) => Prisma.sql`${s}`));
      const [row] = await tx.$queryRaw<{ open: bigint; window: bigint; ip: bigint; device: bigint }[]>`
        SELECT
          (SELECT COUNT(DISTINCT COALESCE("checkoutGroup", "code")) FROM "orders"
            WHERE "guestPhone" = ${phone} AND "createdAt" >= ${new Date(now - OPEN_LOOKBACK_DAYS * DAY_MS)}
              AND "status"::text NOT IN (${closed})) AS "open",
          (SELECT COUNT(DISTINCT COALESCE("checkoutGroup", "code")) FROM "orders"
            WHERE "guestPhone" = ${phone} AND "createdAt" >= ${new Date(now - GUEST_PHONE_WINDOW_DAYS * DAY_MS)}) AS "window",
          (SELECT COUNT(DISTINCT COALESCE("checkoutGroup", "code")) FROM "orders"
            WHERE "guestIpHash" = ${ipHash ?? ''} AND "createdAt" >= ${new Date(now - DAY_MS)}) AS "ip",
          (SELECT COUNT(DISTINCT COALESCE("checkoutGroup", "code")) FROM "orders"
            WHERE "userId" = ${userId} AND "guestPhone" IS NOT NULL AND "createdAt" >= ${new Date(now - DAY_MS)}) AS "device"`;
      const n = (v: bigint | undefined) => Number(v ?? 0);
      if (
        n(row?.open) >= GUEST_PHONE_OPEN_CAP ||
        n(row?.window) >= GUEST_PHONE_WINDOW_CAP ||
        (ipHash !== null && n(row?.ip) >= settings.dailyIpCap) ||
        n(row?.device) >= GUEST_DEVICE_DAILY_CAP
      ) {
        throw guestLimit();
      }
    };
  }

  async placeOrder(meta: GuestRequestMeta, dto: GuestPlaceOrderDto, idempotencyKey: string | undefined) {
    const settings = await this.settingsOrNotFound();
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new BadRequestException('Phiên đặt hàng không hợp lệ, bạn tải lại trang nhé.');
    }
    const phone = dto.address.phone;
    if ((dto.website ?? '').trim() !== '' || dto.fillMs < GUEST_MIN_FILL_MS || settings.blockedPhones.has(phone)) throw guestLimit();
    const user = await this.guestUser(meta.deviceId);
    const startedAt = new Date();
    await this.syncCart(user.id, dto.lines, { idempotencyKey, address: dto.address, paymentMethod: dto.paymentMethod });
    const addressId = await this.addressFor(user.id, dto.address);
    const tokenHash = sha256Hex(dto.trackingKey);
    const ipHash = meta.ip ? hashIp(meta.ip, this.env.get('JWT_ACCESS_SECRET', { infer: true }), 'guest-checkout') : null;
    const ctx: GuestCheckoutContext = {
      phone,
      tokenHash,
      ipHash,
      codMax: settings.codMax,
      assertCaps: this.capsChecker(user.id, phone, ipHash, settings),
    };
    const placeDto = {
      addressId,
      paymentMethod: dto.paymentMethod,
      expectedTotal: dto.expectedTotal,
      note: dto.note,
      giftVariationId: dto.giftVariationId,
      orderZaloConsent: dto.orderZaloConsent === true,
    } as PlaceOrderDto;
    const placed = await this.checkout.placeOrder(user.id, placeDto, idempotencyKey, 'web', ctx);
    const primary = await this.prisma.order.findUniqueOrThrow({
      where: { id: placed.id },
      select: { id: true, code: true, status: true, paymentMethod: true, total: true, checkoutGroup: true, guestTokenHash: true, createdAt: true },
    });
    const group = primary.checkoutGroup
      ? await this.prisma.order.findMany({ where: { checkoutGroup: primary.checkoutGroup, userId: user.id }, orderBy: { code: 'asc' }, select: { code: true, total: true } })
      : [{ code: primary.code, total: primary.total }];
    const keyAccepted = primary.guestTokenHash !== null && safeEqualStrings(primary.guestTokenHash, tokenHash);
    const total = group.reduce((s, o) => s + o.total, 0);
    if (keyAccepted && primary.createdAt >= startedAt) {
      await this.analytics.recordBestEffort({
        eventName: 'guest_order_placed',
        userId: user.id,
        platform: 'web',
        props: { paymentMethod: primary.paymentMethod, total, orderCount: group.length },
      });
    }
    return {
      code: primary.code,
      status: primary.status,
      paymentMethod: primary.paymentMethod,
      total,
      codes: group.map((o) => o.code),
      // false: lần gửi này trả lại đơn đã đặt từ khoá theo dõi khác (tab khác), trình duyệt dùng khoá đã lưu cho mã đơn đó.
      keyAccepted,
    };
  }

  /** Đơn theo mã + khoá; mọi trường hợp sai (không có mã, không phải đơn vãng lai, sai khoá, hết hạn) cùng một 404. */
  private async orderByKey(code: string, key: string | undefined) {
    const order = await this.prisma.order.findUnique({ where: { code }, include: { items: { orderBy: { id: 'asc' } } } });
    const matches = safeEqualStrings(order?.guestTokenHash ?? DUMMY_HASH, sha256Hex(key ?? ''));
    if (!order?.guestTokenHash || !key || !matches) throw new NotFoundException(NOT_FOUND_MESSAGE);
    const statusTimes = await this.statusTimesOf(order.id);
    const closedStamp = order.status === 'CANCELLED' || order.status === 'RETURNED' ? statusTimes[order.status] : undefined;
    const closedAt =
      order.status === 'DELIVERED'
        ? (order.deliveredAt ?? (statusTimes.DELIVERED ? new Date(statusTimes.DELIVERED) : order.updatedAt))
        : order.status === 'CANCELLED' || order.status === 'RETURNED'
          ? (closedStamp ? new Date(closedStamp) : order.updatedAt)
          : null;
    if (closedAt && Date.now() - closedAt.getTime() > GUEST_TRACK_TTL_DAYS * DAY_MS) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return { order, statusTimes, closedAt };
  }

  private async statusTimesOf(orderId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      distinct: ['toStatus'],
      select: { fromStatus: true, toStatus: true, createdAt: true },
    });
    const times: Record<string, string> = {};
    for (const r of rows) {
      if (r.fromStatus === r.toStatus || r.toStatus in times) continue;
      times[r.toStatus] = r.createdAt.toISOString();
    }
    return times;
  }

  /** Trang theo dõi đơn: chỉ trạng thái, món, tiền, SĐT che 4 số giữa, phường/xã và tỉnh (không tên, không số nhà). */
  async track(code: string, key: string | undefined) {
    const { order, statusTimes, closedAt } = await this.orderByKey(code, key);
    const address = (order.shippingAddress ?? {}) as { ward?: unknown; province?: unknown };
    const siblings = order.checkoutGroup
      ? await this.prisma.order.findMany({
          where: { checkoutGroup: order.checkoutGroup, userId: order.userId, guestTokenHash: order.guestTokenHash },
          orderBy: { code: 'asc' },
          select: { code: true, status: true, total: true },
        })
      : [];
    return {
      code: order.code,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      statusTimes,
      subtotal: order.subtotal,
      discount: order.discount,
      shippingFee: order.shippingFee,
      total: order.total,
      items: order.items.map((it) => ({
        productName: it.productName,
        variationName: it.variationName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
        isGift: it.isGift,
      })),
      phoneMasked: maskPhone(order.guestPhone ?? ''),
      area: {
        ward: typeof address.ward === 'string' ? address.ward : '',
        province: typeof address.province === 'string' ? address.province : '',
      },
      siblings,
      expiresAt: closedAt ? new Date(closedAt.getTime() + GUEST_TRACK_TTL_DAYS * DAY_MS).toISOString() : null,
    };
  }

  async bankQr(code: string, key: string | undefined) {
    const { order } = await this.orderByKey(code, key);
    return this.bankTransfer.getBankQr(order.code, order.userId);
  }

  /** Đưa đơn vãng lai của trình duyệt này về tài khoản Zalo đang đăng nhập (chạy được cả khi cờ đã tắt, cho đơn đã đặt). */
  async claim(userId: string, deviceId: string): Promise<{ claimed: number }> {
    const claimed = await this.auth.claimGuestOrders(userId, deviceId);
    if (claimed > 0) {
      await this.analytics.recordBestEffort({ eventName: 'guest_order_claimed', userId, platform: 'web', props: { orderCount: claimed } });
    }
    return { claimed };
  }
}
