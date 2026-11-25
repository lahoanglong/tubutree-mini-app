import { randomBytes } from 'node:crypto';
import type { Job } from 'bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LEGACY_ORDER_CODE_RE, SHORT_ORDER_CODE_RE } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { GiftTrialService } from '../../src/modules/gift-tiers/gift-trial.service';
import { GIFT_TRIAL_ENABLED_KEY } from '../../src/modules/gift-tiers/gift-trial';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { BankTransferService } from '../../src/modules/integrations/payment/bank-transfer.service';
import { GuestCheckoutService } from '../../src/modules/checkout/guest/guest-checkout.service';
import { GUEST_BLOCKED_PHONES_KEY, GUEST_COD_MAX_KEY, GUEST_DAILY_IP_CAP_KEY, WEB_GUEST_CHECKOUT_ENABLED_KEY } from '../../src/modules/checkout/guest/guest-checkout.config';
import { GuestLookupDto, type GuestPlaceOrderDto } from '../../src/modules/checkout/guest/dto/guest-checkout.dto';
import type { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssFlagsService } from '../../src/modules/integrations/mss/mss-flags';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import type { MssOrderEventDispatcher } from '../../src/modules/integrations/mss/mss-order-event.dispatch';
import { MssOrderEventRecorder } from '../../src/modules/integrations/mss/mss-order-event.recorder';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, deleteItData, pinConfig, randCode, setConfig, uniquePhone, warmPool } from './helpers';

/**
 * Chuỗi đặt đơn trước khi gửi duyệt Zalo (tubu-w36-02) trên Postgres thật, nối đúng các service chạy ở PROD: CheckoutService (Mini App, đăng nhập)
 * và GuestCheckoutService (web, không đăng nhập) đặt đơn chuyển khoản → mã đơn ngắn (w34-01) → BankTransferService sinh QR từ `system_configs`
 * (chuỗi EMV giải lại bằng bộ giải độc lập trong tệp, CRC16 đúng) → webhook Pancake đi PancakeProcessor + OrderStatusService thật tới PAID,
 * SHIPPING, DELIVERED → outbox MSS (recorder thật, cờ và năng lực MSS giả là bật): dòng người mua đủ bốn tin, dòng người nhận (PO A1) chỉ ở
 * order.shipping và order.delivered, không giá, không tên món, không link. Mã dài cũ `TUBU…` vẫn tra được, ra QR và nhận tiền Pancake.
 */
describe('Chuỗi đặt đơn chuyển khoản → QR → Pancake → outbox MSS (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let config: SystemConfigService;
  let bank: BankTransferService;
  let guest: GuestCheckoutService;
  let processor: PancakeProcessor;
  const restores: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const productIds: string[] = [];

  /** Tài khoản nhận riêng của spec (không phải số trong seed hay PROD): QR phải đọc đúng bốn khoá `payment.bank_*` này. */
  const BANK = { bin: '970436', name: 'IT Ngân hàng thử', accountNo: '0071000123456', accountName: 'IT PRE SUBMIT' };

  const flags = { isEnabled: async () => true, configured: () => true, snapshot: async () => ({ orderEventsRolloutPct: 100 }) } as unknown as MssFlagsService;
  const health = { assertCapability: async () => true } as unknown as MssHealthService;
  const circuitClient = { circuit: { isTripped: () => false } } as unknown as MssClient;
  const dispatcher = { enqueue: () => undefined } as unknown as MssOrderEventDispatcher;
  const recorder = new MssOrderEventRecorder(flags, health, circuitClient, dispatcher);
  const notify = jest.fn().mockResolvedValue(true);
  const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;

  beforeAll(async () => {
    await recorder.refreshGate();
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        ComboService,
        FlashSaleService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        GiftTrialService,
        { provide: MssOrderEventRecorder, useValue: recorder },
        { provide: LifecycleService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    config = moduleRef.get(SystemConfigService);
    const analytics = moduleRef.get(AnalyticsEventsService);
    bank = new BankTransferService(prisma, config);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-pre-submit', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30, JWT_REFRESH_REUSE_GRACE_SECONDS: 30 };
    const env = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const rbac = new RbacService(prisma, new MerchantFulfilmentService(prisma, {} as never, undefined, new SystemConfigService(prisma)));
    const auth = new AuthService(prisma, new JwtService(), env, {} as ZaloService, rbac);
    guest = new GuestCheckoutService(prisma, checkout, auth, bank, config, analytics, env, {} as never);
    const loyalty = { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics, undefined, undefined, undefined, recorder);
    processor = new PancakeProcessor(prisma, notifications, orderStatus);

    restores.push(await pinConfig(prisma, 'payment.bank_bin', BANK.bin));
    restores.push(await pinConfig(prisma, 'payment.bank_name', BANK.name));
    restores.push(await pinConfig(prisma, 'payment.bank_account_no', BANK.accountNo));
    restores.push(await pinConfig(prisma, 'payment.bank_account_name', BANK.accountName));
    restores.push(await pinConfig(prisma, WEB_GUEST_CHECKOUT_ENABLED_KEY, true));
    restores.push(await pinConfig(prisma, GUEST_COD_MAX_KEY, 2_000_000));
    restores.push(await pinConfig(prisma, GUEST_DAILY_IP_CAP_KEY, 50));
    restores.push(await pinConfig(prisma, GUEST_BLOCKED_PHONES_KEY, []));
    restores.push(await pinConfig(prisma, GIFT_TRIAL_ENABLED_KEY, false));
    restores.push(await pinConfig(prisma, 'shipping.free_threshold', 199_000));
    restores.push(await pinConfig(prisma, 'shipping.flat_fee_below_threshold', 19_000));
    await setConfig(prisma, 'merchant.default_shipping_fee', 25_000);
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await deleteItData(prisma, { userIds, productIds });
    await moduleRef?.close();
  });

  async function variation(price = 150_000) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `itps-p-${tag}`,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itps-${tag.toLowerCase()}`,
        name: `Nước rửa chén IT ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: { create: { pancakeId: `itps-v-${tag}`, sku: `ITPS-${tag}`, name: 'Chai', attributes: {}, retailPrice: price, stock: 500 } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    return p.variations[0]!.id;
  }

  const addressOf = (recipient: string, phone: string) => ({
    recipient,
    phone,
    province: 'Ha Noi',
    district: '',
    ward: 'Phuong IT',
    street: '12 Ngo IT',
    provinceCode: '84_VN01',
    districtCode: '',
    wardCode: '00001',
  });

  /** Khách Mini App đã đăng nhập (số đã xác minh), đã có một đơn giao trước, địa chỉ giao là quà cho số khác. */
  async function buyerWithGiftAddress() {
    const phone = uniquePhone();
    const giftPhone = uniquePhone();
    const u = await createUser(prisma, { phone, fullName: 'Nguyễn Thị Lan', zaloId: `zalo_itps_${randCode(10)}` });
    userIds.push(u.id);
    await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 10 * 86_400_000) });
    const addr = await prisma.address.create({ data: { userId: u.id, ...addressOf('Ba Ngoai', giftPhone) } });
    return { userId: u.id, addressId: addr.id, phone, giftPhone };
  }

  const meta = () => ({ deviceId: `w_${randomBytes(24).toString('base64url')}`, ip: `10.36.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

  async function placeGuestBankTransfer(phone: string) {
    const trackingKey = randomBytes(32).toString('base64url');
    const dto = {
      lines: [{ variationId: await variation(), quantity: 1 }],
      address: addressOf('Khach Vang Lai', phone),
      paymentMethod: 'BANK_TRANSFER',
      orderZaloConsent: true,
      trackingKey,
      fillMs: 20_000,
    } as GuestPlaceOrderDto;
    const placed = await guest.placeOrder(meta(), dto, `itpsg-${randCode(14)}`);
    const order = await prisma.order.findUniqueOrThrow({ where: { code: placed.code } });
    userIds.push(order.userId);
    return { order, trackingKey };
  }

  /** Đơn đã đẩy lên Pancake (PancakeOrderService là giả trong spec): tiền Pancake chỉ lật PAID cho đơn đã có `pancakeOrderId`. */
  const linkPancake = (orderId: string, code: string) => prisma.order.update({ where: { id: orderId }, data: { pancakeOrderId: `pc-${code}` } });

  async function pancake(code: string, status: number, bankPayment: number) {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: { id: `pc-${code}`, extension: { external_order_id: code }, status, bank_payment: bankPayment }, status: 'PENDING' },
    });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('PROCESSED');
  }

  async function outbox(orderId: string) {
    const rows = await prisma.mssOrderEventOutbox.findMany({ where: { orderId }, orderBy: { sequence: 'asc' } });
    return rows.map((r) => ({ eventType: r.eventType, role: r.recipientRole, body: JSON.parse(r.body) as MssBody, raw: r.body }));
  }

  it('Mini App đăng nhập, chuyển khoản, đồng ý Zalo + công tắc người nhận: mã ngắn, QR đúng tài khoản cấu hình, Pancake → PAID/SHIPPING/DELIVERED, outbox đủ vai', async () => {
    const b = await buyerWithGiftAddress();
    await cart.addItem(b.userId, { variationId: await variation(), quantity: 2 });
    const placed = await checkout.placeOrder(
      b.userId,
      { addressId: b.addressId, paymentMethod: 'BANK_TRANSFER', orderZaloConsent: true, notifyRecipientZalo: true } as never,
      `itps-${randCode(14)}`,
      'miniapp',
    );
    let order = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.code).toMatch(SHORT_ORDER_CODE_RE);
    expect(order.code.startsWith('TB')).toBe(true);
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', platform: 'miniapp', orderZaloConsent: true, notifyRecipientZalo: true });

    const qr = await bank.getBankQr(order.code, b.userId);
    expect(qr).toMatchObject({ orderCode: order.code, amount: order.total, paidSoFar: 0, paymentStatus: 'UNPAID', memo: order.code, bank: BANK });
    expectVietQr(qr.qrString, BANK, order.total, order.code);
    expectQrImage(qr.qrImageUrl, BANK, order.total, order.code);
    expect(await outbox(order.id)).toEqual([expect.objectContaining({ eventType: 'order.created', role: 'buyer' })]);

    await linkPancake(order.id, order.code);
    // Khách chuyển thiếu (Pancake trạng thái 0 "Mới" không đổi trạng thái đơn): QR thật từ API đòi đúng phần còn lại, không đòi lại tổng đơn.
    const partial = Math.floor(order.total / 3);
    await pancake(order.code, 0, partial);
    order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', pancakePaidReported: partial });
    const rest = await bank.getBankQr(order.code, b.userId);
    expect(rest).toMatchObject({ amount: order.total - partial, paidSoFar: partial, paymentStatus: 'UNPAID', memo: order.code });
    expectVietQr(rest.qrString, BANK, order.total - partial, order.code);
    expectQrImage(rest.qrImageUrl, BANK, order.total - partial, order.code);
    expect(await outbox(order.id)).toHaveLength(1);

    await pancake(order.code, 2, order.total);
    order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(order).toMatchObject({ status: 'SHIPPING', paymentStatus: 'PAID' });
    expect((await bank.getBankQr(order.code, b.userId)).paymentStatus).toBe('PAID');
    await pancake(order.code, 3, order.total);
    order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(order).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });

    const rows = await outbox(order.id);
    expect(rows.map((r) => `${r.eventType}:${r.role}`)).toEqual([
      'order.created:buyer',
      'order.payment_confirmed:buyer',
      'order.shipping:buyer',
      'order.shipping:recipient',
      'order.delivered:buyer',
      'order.delivered:recipient',
    ]);
    for (const r of rows.filter((x) => x.role === 'buyer')) {
      expect(r.body.order).toMatchObject({ code: order.code, total_vnd: order.total, payment_method: 'PREPAID', channel: 'miniapp' });
      expect(r.body.recipient).toEqual({ phone: b.phone, phone_source: 'account_verified', name: 'Lan' });
    }
    for (const r of rows.filter((x) => x.role === 'recipient')) {
      expect(r.body.order).toMatchObject({ code: order.code, total_vnd: 0 });
      expect(r.body.order).not.toHaveProperty('first_item_name');
      expect(r.body.order).not.toHaveProperty('tracking_url');
      expect(r.body.recipient).toEqual({ phone: b.giftPhone, phone_source: 'checkout_contact', role: 'recipient' });
      expect(r.raw).not.toContain(String(order.total));
      expect(r.raw).not.toMatch(/Nước rửa chén|https?:|Lan/);
    }

    // Webhook lặp lại: không thêm dòng nào.
    await pancake(order.code, 3, order.total);
    expect(await outbox(order.id)).toHaveLength(6);
  });

  it('cùng đơn quà nhưng không bật công tắc người nhận: chỉ dòng người mua; đơn tự giao cho mình bật công tắc vẫn không có dòng người nhận', async () => {
    for (const variant of ['toggle_off', 'same_phone'] as const) {
      const b = await buyerWithGiftAddress();
      const addressId =
        variant === 'same_phone' ? (await prisma.address.create({ data: { userId: b.userId, ...addressOf('Nguyen Thi Lan', b.phone) } })).id : b.addressId;
      await cart.addItem(b.userId, { variationId: await variation(), quantity: 1 });
      const placed = await checkout.placeOrder(
        b.userId,
        { addressId, paymentMethod: 'BANK_TRANSFER', orderZaloConsent: true, notifyRecipientZalo: variant === 'same_phone' } as never,
        `itps-${randCode(14)}`,
        'miniapp',
      );
      const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
      await linkPancake(order.id, order.code);
      await pancake(order.code, 2, order.total);
      await pancake(order.code, 3, order.total);
      const rows = await outbox(order.id);
      expect({ variant, rows: rows.map((r) => `${r.eventType}:${r.role}`) }).toEqual({
        variant,
        rows: [
        'order.created:buyer',
        'order.payment_confirmed:buyer',
        'order.shipping:buyer',
        'order.delivered:buyer',
        ],
      });
    }
  });

  it('khách vãng lai web, chuyển khoản, đồng ý Zalo: mã ngắn, QR qua khoá theo dõi, Pancake → PAID/DELIVERED, outbox người mua theo số khách gõ, không link, không người nhận', async () => {
    const phone = uniquePhone();
    const { order: placed, trackingKey } = await placeGuestBankTransfer(phone);
    expect(placed.code).toMatch(SHORT_ORDER_CODE_RE);
    expect(placed).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', platform: 'web', guestPhone: phone, orderZaloConsent: true, notifyRecipientZalo: false });

    const qr = await guest.bankQr(placed.code, trackingKey);
    expect(qr).toMatchObject({ orderCode: placed.code, amount: placed.total, memo: placed.code, bank: BANK });
    expectVietQr(qr.qrString, BANK, placed.total, placed.code);
    expectQrImage(qr.qrImageUrl, BANK, placed.total, placed.code);

    await linkPancake(placed.id, placed.code);
    await pancake(placed.code, 2, placed.total);
    await pancake(placed.code, 3, placed.total);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });

    const rows = await outbox(order.id);
    expect(rows.map((r) => `${r.eventType}:${r.role}`)).toEqual(['order.created:buyer', 'order.payment_confirmed:buyer', 'order.shipping:buyer', 'order.delivered:buyer']);
    for (const r of rows) {
      expect(r.body.order).toMatchObject({ code: order.code, total_vnd: order.total, channel: 'web' });
      expect(r.body.order).not.toHaveProperty('tracking_url');
      expect(r.body.recipient).toEqual({ phone, phone_source: 'checkout_contact' });
    }

    const looked = await guest.lookup({ orderCode: order.code, phone });
    expect(looked.order).toMatchObject({ code: order.code, status: 'DELIVERED', paymentStatus: 'PAID' });
    expect(looked.bankPath).toBeNull();
  });

  it('mã dài cũ TUBU… vẫn chạy: DTO tra đơn nhận cả hai dạng (chữ thường, #, khoảng trắng), tra được, trang QR đang chờ, QR mang mã cũ, Pancake nhận tiền theo mã cũ', async () => {
    const phone = uniquePhone();
    const { order: placed } = await placeGuestBankTransfer(phone);
    const legacy = `TUBU${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    expect(legacy).toMatch(LEGACY_ORDER_CODE_RE);
    await prisma.order.update({ where: { id: placed.id }, data: { code: legacy } });

    for (const code of [placed.code, legacy]) {
      const dto = plainToInstance(GuestLookupDto, { orderCode: ` #${code.toLowerCase()} `, phone });
      expect(await validate(dto)).toEqual([]);
      expect(dto.orderCode).toBe(code);
    }
    const bad = plainToInstance(GuestLookupDto, { orderCode: 'TB', phone });
    expect((await validate(bad)).map((e) => e.property)).toEqual(['orderCode']);

    const looked = await guest.lookup({ orderCode: legacy, phone });
    expect(looked.order).toMatchObject({ code: legacy, status: 'PENDING_PAYMENT' });
    expect(looked.bankPath).toBe(`/thanh-toan/chuyen-khoan/${legacy}#k=${looked.trackingKey}`);
    const qr = await guest.bankQr(legacy, looked.trackingKey);
    expectVietQr(qr.qrString, BANK, placed.total, legacy);
    expectQrImage(qr.qrImageUrl, BANK, placed.total, legacy);

    await linkPancake(placed.id, legacy);
    await pancake(legacy, 2, placed.total);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).toMatchObject({ code: legacy, status: 'SHIPPING', paymentStatus: 'PAID' });
    const rows = await outbox(placed.id);
    expect(rows.map((r) => `${r.eventType}:${r.role}`)).toEqual(['order.created:buyer', 'order.payment_confirmed:buyer', 'order.shipping:buyer']);
    expect(rows.slice(1).map((r) => r.body.order.code)).toEqual([legacy, legacy]);
  });
});

interface MssBody {
  order: Record<string, unknown> & { code: string };
  recipient: Record<string, unknown>;
}

/** Bộ giải TLV EMVCo viết riêng cho spec (không dùng hàm sinh QR của API): id 2 số, độ dài 2 số, giá trị. */
function tlv(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < s.length; ) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) throw new Error(`TLV hỏng tại vị trí ${i}: ${s}`);
    out.set(id, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi 0xFFFF) theo từng bit. */
function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function expectVietQr(qr: string, bank: { bin: string; accountNo: string }, amount: number, memo: string): void {
  expect(crc16('123456789')).toBe('29B1');
  const top = tlv(qr);
  expect([...top.keys()].pop()).toBe('63');
  expect(qr.slice(-8, -4)).toBe('6304');
  expect(top.get('63')).toBe(crc16(qr.slice(0, -4)));
  expect(top.get('01')).toBe('12');
  const acct = tlv(top.get('38')!);
  expect(acct.get('00')).toBe('A000000727');
  expect(Object.fromEntries(tlv(acct.get('01')!))).toEqual({ '00': bank.bin, '01': bank.accountNo });
  expect(acct.get('02')).toBe('QRIBFTTA');
  expect(top.get('53')).toBe('704');
  expect(top.get('54')).toBe(String(amount));
  expect(top.get('58')).toBe('VN');
  expect(tlv(top.get('62')!).get('08')).toBe(memo);
}

function expectQrImage(url: string, bank: { bin: string; accountNo: string; accountName: string }, amount: number, memo: string): void {
  const u = new URL(url);
  expect(`${u.origin}${u.pathname}`).toBe(`https://img.vietqr.io/image/${bank.bin}-${bank.accountNo}-compact2.png`);
  expect(Object.fromEntries(u.searchParams)).toEqual({ amount: String(amount), addInfo: memo, accountName: bank.accountName });
}
