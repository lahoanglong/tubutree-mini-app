import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MERCHANT_FULFIL_STATUSES, MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;
const randPhone = (prefix: string) => `${prefix}${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

const BUYER_BANK = { bankName: 'Ngân hàng Riêng Tư', accountNumber: '9704123456789012', accountName: 'CHU TAI KHOAN RIENG' };
const RECIPIENT = { recipient: 'Lê Văn Nhận Quà', phone: '0933000222', street: '12 Đường Người Nhận' };

/** Khoá JSON mà phản hồi dành cho đối tác không bao giờ được mang (tài khoản người mua, tài khoản nhận hoàn, dữ liệu nội bộ). */
const FORBIDDEN_KEYS = new Set([
  'user',
  'userId',
  'email',
  'bankName',
  'bankAccountNo',
  'bankAccountName',
  'accountNumber',
  'accountName',
  'referrerUserId',
  'endCustomerKey',
  'invoiceRequest',
  'reviewedBy',
  'receivedBy',
  'adminNote',
]);

function keysIn(value: unknown, path = '$', out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => keysIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'tubuAccount' || k === 'bankInfo') continue;
      if (FORBIDDEN_KEYS.has(k)) out.push(`${path}.${k}`);
      keysIn(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/**
 * R5-PARTNER-6 trên Postgres THẬT: mọi phản hồi đơn/đổi trả/đối soát dành cho đối tác chỉ mang dữ liệu giao hàng của người nhận,
 * không mang họ tên, SĐT, email, mã tài khoản hay tài khoản ngân hàng nhận hoàn của người mua. Đi qua từng endpoint của
 * /merchant (danh sách đơn, đơn cần giao ở mọi trạng thái, accept/pack/ship/deliver/fail/cancel, hàng trả về, đối soát) và đối chiếu
 * toàn bộ JSON với danh sách cấm; có đối chứng dương: dữ liệu người nhận vẫn phải hiện ở đơn cần giao.
 */
describe('Đối tác không thấy tài khoản người mua (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let merchant: MerchantService;
  let fulfil: MerchantFulfilmentService;
  let returns: OrderReturnsService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantFulfilmentService,
        MerchantService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    merchant = moduleRef.get(MerchantService);
    fulfil = moduleRef.get(MerchantFulfilmentService);
    returns = moduleRef.get(OrderReturnsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup() {
    const tag = randCode(8);
    const buyer = await createUser(prisma, {
      role: 'CUSTOMER',
      fullName: `Trần Thị Mua${tag}`,
      phone: randPhone('094'),
      email: `mua.${tag.toLowerCase()}@example.com`,
    });
    const owner = await createUser(prisma, { role: 'DEALER' });
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itbp-${tag.toLowerCase()}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itbp-${tag.toLowerCase()}`,
        name: `Bưởi ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITBP-${tag}`, name: 'Quả', attributes: {}, retailPrice: 50_000, stock: 50 } },
      },
      include: { variations: true },
    });
    const variationId = product.variations[0]!.id;
    const place = (status: 'CONFIRMED' | 'SHIPPING' | 'DELIVERED') =>
      createOrder(prisma, {
        userId: buyer.id,
        status,
        ...(status === 'DELIVERED' ? { deliveredAt: new Date(Date.now() - 2 * DAY) } : {}),
        fulfiller: 'MERCHANT',
        fulfillerStorefrontId: store.id,
        merchantCommissionPct: 0.15,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        subtotal: 100_000,
        shippingFee: 30_000,
        total: 130_000,
        note: 'Giao giờ hành chính',
        shippingAddress: { ...RECIPIENT, ward: 'Phường IT', district: '', province: 'Hà Nội', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
        items: { create: { variationId, productName: 'Bưởi', variationName: 'Quả', unitPrice: 50_000, quantity: 2, total: 100_000 } },
      });
    const denied: [string, string][] = [
      ['id tài khoản người mua', buyer.id],
      ['họ tên người mua', buyer.fullName!],
      ['SĐT người mua', buyer.phone!],
      ['email người mua', buyer.email!],
      ['mã giới thiệu của người mua', buyer.referralCode],
      ['số tài khoản nhận hoàn', BUYER_BANK.accountNumber],
      ['tên chủ tài khoản nhận hoàn', BUYER_BANK.accountName],
      ['tên ngân hàng nhận hoàn', BUYER_BANK.bankName],
      ['họ tên người mua đã che', `${buyer.fullName!.split(/\s+/).pop()}***`],
      ['SĐT người mua đã che', `${buyer.phone!.slice(0, 3)}****${buyer.phone!.slice(-3)}`],
    ];
    return { tag, buyer, owner, store, variationId, place, denied };
  }

  function expectClean(label: string, payload: unknown, denied: [string, string][], opts: { forbidKeys?: boolean } = { forbidKeys: true }) {
    const json = JSON.stringify(payload);
    const leaked = denied.filter(([, needle]) => json.includes(needle)).map(([what]) => what);
    expect({ label, leaked }).toEqual({ label, leaked: [] });
    if (opts.forbidKeys) expect({ label, keys: keysIn(payload) }).toEqual({ label, keys: [] });
  }

  it('đơn cần giao ở mọi trạng thái và mọi bước accept/pack/ship/deliver/fail/cancel: chỉ có người nhận giao hàng, không có tài khoản người mua', async () => {
    const { owner, place, denied } = await setup();
    const toDeliver = await place('CONFIRMED');
    const toFail = await place('SHIPPING');
    const toCancel = await place('CONFIRMED');

    const all = await fulfil.listOrders(owner.id, undefined);
    expect(all.data.length).toBeGreaterThanOrEqual(3);
    expectClean('GET /merchant/fulfil-orders', all, denied);
    for (const status of MERCHANT_FULFIL_STATUSES) {
      expectClean(`GET /merchant/fulfil-orders?status=${status}`, await fulfil.listOrders(owner.id, status), denied);
    }

    // Đối chứng dương: người nhận (không phải người mua) vẫn đủ để giao hàng.
    const row = all.data.find((o) => o.id === toDeliver.id)!;
    expect(row.shippingAddress).toMatchObject({ recipient: RECIPIENT.recipient, phone: RECIPIENT.phone, street: RECIPIENT.street });
    expect(row.note).toBe('Giao giờ hành chính');

    expectClean('accept', await fulfil.accept(owner.id, toDeliver.id), denied);
    expectClean('pack', await fulfil.pack(owner.id, toDeliver.id), denied);
    expectClean('ship', await fulfil.ship(owner.id, toDeliver.id, { carrier: 'GHN', trackingCode: 'GHN123' }), denied);
    expectClean('deliver', await fulfil.deliver(owner.id, toDeliver.id), denied);
    expectClean('fail', await fulfil.fail(owner.id, toFail.id, 'Khách không nhận'), denied);
    expectClean('cancel', await fulfil.cancel(owner.id, toCancel.id, 'Hết hàng'), denied);
  });

  it('GET /merchant/orders của gian hàng đối tác: không trả tài khoản người mua (kể cả bản đã che)', async () => {
    const { owner, place, denied } = await setup();
    await place('CONFIRMED');
    await place('DELIVERED');
    const res = await merchant.listMerchantOrders(owner.id);
    expect(res.data.length).toBeGreaterThanOrEqual(2);
    expectClean('GET /merchant/orders', res, denied);
    for (const status of ['CONFIRMED', 'DELIVERED']) {
      expectClean(`GET /merchant/orders?status=${status}`, await merchant.listMerchantOrders(owner.id, status), denied);
    }
  });

  it('hàng trả về: danh sách và phản hồi "đã nhận hàng" không mang tài khoản người mua hay tài khoản ngân hàng nhận hoàn', async () => {
    const { owner, buyer, place, denied } = await setup();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const order = await place('DELIVERED');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const req = await returns.request(buyer.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Một quả bị dập khi nhận',
      refundMethod: 'BANK',
      ...BUYER_BANK,
      items: [{ orderItemId: item.id, quantity: 1 }],
    });

    const pending = await returns.listForMerchant(owner.id);
    expect(pending.map((r) => r.id)).toContain(req.id);
    expectClean('GET /merchant/returns (chờ duyệt)', pending, denied);

    await returns.review(admin.id, req.id, { approve: true });
    const approved = await returns.listForMerchant(owner.id);
    expect(approved.find((r) => r.id === req.id)).toMatchObject({ status: 'APPROVED', orderCode: order.code });
    expectClean('GET /merchant/returns (đã duyệt)', approved, denied);

    const received = await returns.markReceivedByMerchant(owner.id, req.id);
    expectClean('POST /merchant/returns/:id/received', received, denied);
    expect(received).toMatchObject({ id: req.id, orderCode: order.code });
    expect((received as { receivedAt: Date | null }).receivedAt).toBeInstanceOf(Date);
  });

  it('bảng kê đối soát của gian hàng chỉ có mã đơn và số tiền, không có người mua', async () => {
    const { owner, store, place, denied } = await setup();
    const order = await place('DELIVERED');
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 10 * DAY) } });
    const statement = await fulfil.myStatement(owner.id);
    expect(JSON.stringify(statement)).toContain(order.code);
    expectClean('GET /merchant/settlement', statement, denied);
    await fulfil.createPayout('admin-it', store.id);
    expectClean('GET /merchant/settlement (sau khi lập phiếu)', await fulfil.myStatement(owner.id), denied);
  });

  it('CTV (AFFILIATE): vẫn thấy khách đã che như cũ nhưng không bao giờ thấy họ tên, SĐT, email đầy đủ', async () => {
    const tag = randCode(8);
    const buyer = await createUser(prisma, { role: 'CUSTOMER', fullName: `Phạm Thị Khach${tag}`, phone: randPhone('095'), email: `khach.${tag.toLowerCase()}@example.com` });
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const store = await prisma.storefront.create({
      data: { type: 'CTV', slug: `itbp-ctv-${tag.toLowerCase()}`, title: `CTV ${tag}`, ownerUserId: ctv.id },
    });
    await createOrder(prisma, { userId: buyer.id, storefrontId: store.id, referrerUserId: ctv.id });
    const res = await merchant.listMerchantOrders(ctv.id);
    expect(res.data.length).toBeGreaterThanOrEqual(1);
    const denied: [string, string][] = [
      ['id tài khoản người mua', buyer.id],
      ['họ tên người mua', buyer.fullName!],
      ['SĐT người mua', buyer.phone!],
      ['email người mua', buyer.email!],
      ['địa chỉ giao đầy đủ', '1 Duong IT'],
    ];
    expectClean('GET /merchant/orders (CTV)', res, denied, { forbidKeys: false });
  });
});
