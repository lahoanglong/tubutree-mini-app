import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { freezeDefaultCommissionChange } from '../../src/modules/merchant/merchant-terms-history';
import { termsAt } from '../../src/modules/merchant/merchant-consignment';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';
import type { OrderStatus, Prisma } from '@prisma/client';


const PRICE = 100_000;
const STOCK = 10;
const ROUNDS = 3;
const DAY = 86_400_000;
const STORE_CHANGED = 'Gian hàng vừa thay đổi, vui lòng đặt lại.';

/**
 * Thu hồi vai trò DEALER (AdminService.setUserRole) tắt cờ isPartner của gian hàng CTV của chủ trong cùng tx, hoặc bị từ chối 409
 * khi gian hàng còn đúng các vướng mắc đang chặn POST /admin/storefronts/:id/partner. Đua với đặt đơn tự giao: khoá gian hàng
 * trước users (như checkout) nên hoặc thu hồi thắng (đặt đơn 409, không tạo gì), hoặc đơn vào trước (thu hồi 409, vai trò giữ).
 */
describe('Thu hồi vai trò đại lý tắt cờ đối tác (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let merchant: MerchantFulfilmentService;
  let admin: AdminService;
  let rbac: RbacService;
  let portal: MerchantService;
  let deletion: AccountDeletionService;
  const CONFIG_KEYS = ['merchant.settlement_hold_days', 'merchant.consignment_settle_from'];
  let savedConfig: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], productIds: [] as string[], storefrontIds: [] as string[], tierIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        WalletLedgerService,
        CashbackService,
        ComboService,
        FlashSaleService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    merchant = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    const none = {} as never;
    rbac = new RbacService(prisma, merchant);
    admin = new AdminService(prisma, none, none, none, none, none, none, rbac, none, none, merchant);
    portal = new MerchantService(prisma, none);
    deletion = new AccountDeletionService(prisma, merchant);
  });

  afterAll(async () => {
    if (prisma) {
      const { userIds, storefrontIds } = created;
      await prisma.merchantPayout.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
      await prisma.merchantPancakeLink.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
      await prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.roleGrant.deleteMany({ where: { grantedBy: { in: userIds } } });
      await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.storefront.updateMany({ where: { id: { in: storefrontIds } }, data: { ownerUserId: null } });
      await deleteItData(prisma, created);
      await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
      await prisma.dealerTier.deleteMany({ where: { id: { in: created.tierIds } } });
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  async function user(role: 'ADMIN' | 'DEALER' | 'CUSTOMER' | 'AFFILIATE') {
    const u = await createUser(prisma, { role, phone: phone() });
    created.userIds.push(u.id);
    return u;
  }

  /** Đại lý (DEALER) có gian hàng CTV là đối tác, không vướng mắc nào. */
  async function dealerStore(o: { isPartner?: boolean; type?: 'CTV' | 'MERCHANT'; ownerRole?: 'DEALER' | 'STAFF' | 'ADMIN' } = {}) {
    const adminUser = await user('ADMIN');
    const owner = await user(o.ownerRole ?? 'DEALER');
    const buyer = await user('CUSTOMER');
    const tag = randCode(8).toLowerCase();
    const sf = await prisma.storefront.create({
      data: { type: o.type ?? 'CTV', isPartner: o.isPartner ?? true, slug: `itdr-${tag}`, ownerUserId: owner.id, title: `Shop ${tag}`, isPublished: true },
    });
    created.storefrontIds.push(sf.id);
    const flag = async () => (await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner;
    const type = async () => (await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).type;
    const role = async () => (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role;
    const partnerEvents = () => prisma.userAdminEvent.findMany({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } });
    const revoke = () => admin.setUserRole(adminUser.id, owner.phone!, 'CUSTOMER');
    return { adminUser, owner, buyer, sf, tag, flag, type, role, partnerEvents, revoke };
  }
  type Ctx = Awaited<ReturnType<typeof dealerStore>>;

  async function product(sf: { id: string }, fulfilment: 'MERCHANT' | 'TUBU', isActive: boolean) {
    const p = await prisma.product.create({
      data: {
        storefrontId: sf.id, fulfilment, isActive, brand: 'IT', slug: `itdr-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: 1000,
        variations: { create: [{ sku: `ITDR-${randCode(8)}`, pancakeId: `itdr-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
      include: { variations: true },
    });
    created.productIds.push(p.id);
    return p;
  }
  const selfShip = (c: Ctx, status: OrderStatus, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
    createOrder(prisma, { userId: c.buyer.id, status, fulfiller: 'MERCHANT', fulfillerStorefrontId: c.sf.id, storefrontSlug: c.sf.slug, paymentStatus: 'UNPAID', paymentMethod: 'COD', ...extra });

  async function conflictMessage(p: Promise<unknown>) {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).message;
  }

  it('không vướng mắc: thu hồi DEALER tắt cờ isPartner, ghi STOREFRONT_PARTNER và ROLE trong cùng lần đổi', async () => {
    const c = await dealerStore();
    await selfShip(c, 'CANCELLED');
    await expect(c.revoke()).resolves.toMatchObject({ ok: true, role: 'CUSTOMER', previousRole: 'DEALER' });
    expect(await c.flag()).toBe(false);
    expect(await c.role()).toBe('CUSTOMER');
    const ev = await c.partnerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: 'true', toValue: 'false', actorId: c.adminUser.id, reason: c.sf.id });
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE', fromValue: 'DEALER', toValue: 'CUSTOMER' } })).toBe(1);
    const detail = await admin.getUserDetail(c.owner.id);
    expect(detail.partnerHistory).toEqual([
      expect.objectContaining({ kind: 'STOREFRONT_PARTNER', fromValue: 'true', toValue: 'false', reason: c.sf.id, actorId: c.adminUser.id, actorName: expect.any(String) }),
    ]);
  });

  const blockers: [string, (c: Ctx) => Promise<unknown>, string][] = [
    ['đơn tự giao chưa xong', (c) => selfShip(c, 'SHIPPING'), '1 đơn tự giao chưa xong'],
    ['phiếu đối soát PENDING', (c) => prisma.merchantPayout.create({ data: { storefrontId: c.sf.id, amount: 1000, createdBy: c.adminUser.id } }), '1 phiếu đối soát chưa chuyển'],
    [
      'liên kết giao hộ đang hiệu lực',
      async (c) => {
        const p = await product(c.sf, 'TUBU', true);
        await prisma.merchantPancakeLink.create({ data: { productId: p.id, storefrontId: c.sf.id, variationId: p.variations[0]!.id } });
      },
      '1 liên kết hàng Tubu giao hộ đang hiệu lực',
    ],
    ['khoản chờ đối soát', (c) => selfShip(c, 'DELIVERED', { deliveredAt: new Date(Date.now() - DAY), paymentStatus: 'PAID' }), 'khoản chờ đối soát'],
    [
      'yêu cầu trả REQUESTED',
      async (c) => {
        const o = await selfShip(c, 'CANCELLED');
        await prisma.returnRequest.create({ data: { orderId: o.id, userId: c.buyer.id, reason: 'IT', status: 'REQUESTED' } });
      },
      '1 yêu cầu trả hàng chờ xử lý',
    ],
    [
      'yêu cầu trả APPROVED chưa nhận về',
      async (c) => {
        const o = await selfShip(c, 'CANCELLED');
        await prisma.returnRequest.create({ data: { orderId: o.id, userId: c.buyer.id, reason: 'IT', status: 'APPROVED' } });
      },
      '1 yêu cầu trả đã duyệt chưa xác nhận nhận hàng',
    ],
    ['sản phẩm tự giao đang bán', (c) => product(c.sf, 'MERCHANT', true), '1 sản phẩm tự giao đang bán'],
  ];

  it.each(blockers)('vướng mắc "%s" → 409 liệt kê bằng tiếng Việt, vai trò và cờ giữ nguyên, không ghi sổ', async (_name, setup, expected) => {
    const c = await dealerStore();
    await setup(c);
    const msg = await conflictMessage(c.revoke());
    expect(msg).toContain(expected);
    expect(msg).toContain('Chưa thể thu hồi vai trò đại lý');
    expect(msg).not.toContain('chủ gian hàng vẫn là đại lý');
    expect(await c.role()).toBe('DEALER');
    expect(await c.flag()).toBe(true);
    expect(await c.partnerEvents()).toHaveLength(0);
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE' } })).toBe(0);
  });

  it('không có gian hàng hoặc cờ đã tắt: thu hồi chạy như trước, không ghi STOREFRONT_PARTNER', async () => {
    const adminUser = await user('ADMIN');
    const bare = await user('DEALER');
    await expect(admin.setUserRole(adminUser.id, bare.phone!, 'CUSTOMER')).resolves.toMatchObject({ role: 'CUSTOMER' });

    const off = await dealerStore({ isPartner: false });
    await selfShip(off, 'SHIPPING');
    await expect(off.revoke()).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(await off.flag()).toBe(false);
    expect(await off.partnerEvents()).toHaveLength(0);
  });

  it('gian hàng MERCHANT sạch vướng mắc: thu hồi chuyển thành CTV + isPartner=false, ghi STOREFRONT_PARTNER, giữ dữ liệu bán hàng; duyệt lại DEALER + vào Cổng người bán bật lại cờ', async () => {
    const m = await dealerStore({ type: 'MERCHANT' });
    await prisma.storefront.update({ where: { id: m.sf.id }, data: { bankName: 'ACB', bankAccountNo: '123456', commissionPct: 0.12 } });
    const p = await product(m.sf, 'MERCHANT', false);
    const paid = await prisma.merchantPayout.create({ data: { storefrontId: m.sf.id, amount: 5000, createdBy: m.adminUser.id, status: 'PAID' } });
    await selfShip(m, 'CANCELLED');

    await expect(m.revoke()).resolves.toMatchObject({ ok: true, role: 'CUSTOMER', previousRole: 'DEALER' });
    expect(await m.type()).toBe('CTV');
    expect(await m.flag()).toBe(false);
    expect(await m.role()).toBe('CUSTOMER');
    const ev = await m.partnerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: 'true', toValue: 'false', actorId: m.adminUser.id, reason: m.sf.id });
    const after = await prisma.storefront.findUniqueOrThrow({ where: { id: m.sf.id } });
    expect(after).toMatchObject({ bankName: 'ACB', bankAccountNo: '123456', ownerUserId: m.owner.id });
    expect(Number(after.commissionPct)).toBeCloseTo(0.12);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).storefrontId).toBe(m.sf.id);
    expect((await prisma.merchantPayout.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('PAID');

    const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(tier.id);
    await admin.setUserRole(m.adminUser.id, m.owner.phone!, 'DEALER', tier.id);
    expect(await m.flag()).toBe(false);
    const reopened = await portal.getOrCreateStore(m.owner.id);
    expect(reopened).toMatchObject({ id: m.sf.id, isPartner: true, type: 'CTV' });
    expect(await m.flag()).toBe(true);
  });

  const merchantBlockers: [string, (c: Ctx) => Promise<unknown>, string][] = [
    ['đơn tự giao chưa xong', (c) => selfShip(c, 'SHIPPING'), '1 đơn tự giao chưa xong'],
    ['phiếu đối soát PENDING', (c) => prisma.merchantPayout.create({ data: { storefrontId: c.sf.id, amount: 1000, createdBy: c.adminUser.id } }), '1 phiếu đối soát chưa chuyển'],
  ];
  it.each(merchantBlockers)('gian hàng MERCHANT vướng "%s" → 409, vai trò/loại/cờ giữ nguyên, không ghi sổ', async (_name, setup, expected) => {
    const c = await dealerStore({ type: 'MERCHANT' });
    await setup(c);
    const msg = await conflictMessage(c.revoke());
    expect(msg).toContain(expected);
    expect(await c.role()).toBe('DEALER');
    expect(await c.type()).toBe('MERCHANT');
    expect(await c.flag()).toBe(true);
    expect(await c.partnerEvents()).toHaveLength(0);
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE' } })).toBe(0);
  });

  describe.each(['CUSTOMER', 'AFFILIATE'] as const)('STAFF/ADMIN hạ về %s (luật B)', (finalRole) => {
    it.each(['STAFF', 'ADMIN'] as const)('%s có gian hàng đối tác còn vướng → 409, vai trò giữ nguyên', async (from) => {
      const c = await dealerStore({ ownerRole: from });
      await selfShip(c, 'SHIPPING');
      await conflictMessage(admin.setUserRole(c.adminUser.id, c.owner.phone!, finalRole));
      expect(await c.role()).toBe(from);
      expect(await c.flag()).toBe(true);
    });

    it('STAFF sạch vướng mắc → tắt cờ và ghi STOREFRONT_PARTNER cùng ROLE', async () => {
      const c = await dealerStore({ ownerRole: 'STAFF' });
      await expect(admin.setUserRole(c.adminUser.id, c.owner.phone!, finalRole)).resolves.toMatchObject({ role: finalRole, previousRole: 'STAFF' });
      expect(await c.flag()).toBe(false);
      expect(await c.partnerEvents()).toHaveLength(1);
    });
  });

  it('STAFF sở hữu gian hàng MERCHANT sạch vướng mắc hạ về CUSTOMER → chuyển CTV, cờ tắt', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF', type: 'MERCHANT' });
    await admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    expect(await c.type()).toBe('CTV');
    expect(await c.flag()).toBe(false);
  });

  it('DEALER → STAFF / ADMIN không đụng gian hàng dù đang vướng (thăng tạm thời)', async () => {
    for (const to of ['STAFF', 'ADMIN'] as const) {
      const c = await dealerStore();
      await selfShip(c, 'SHIPPING');
      await expect(admin.setUserRole(c.adminUser.id, c.owner.phone!, to)).resolves.toMatchObject({ role: to });
      expect(await c.flag()).toBe(true);
      expect(await c.partnerEvents()).toHaveLength(0);
    }
  });

  async function grant(c: Ctx) {
    await prisma.roleGrant.create({ data: { phone: c.owner.phone!, role: 'STAFF', grantedBy: c.adminUser.id } });
  }
  const activeGrants = (c: Ctx) => prisma.roleGrant.count({ where: { phone: c.owner.phone!, revokedAt: null } });

  it('revokeGrant: STAFF (→ CUSTOMER) có gian hàng vướng → vẫn gỡ quyền nhân viên về CUSTOMER, gian hàng giữ nguyên, storeBlocked=true', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF', type: 'MERCHANT' });
    await grant(c);
    await selfShip(c, 'SHIPPING');
    await expect(rbac.revokeGrant(c.adminUser.id, c.owner.phone!)).resolves.toMatchObject({ revoked: 1, downgraded: true, role: 'CUSTOMER', storeBlocked: true });
    expect(await c.role()).toBe('CUSTOMER');
    expect(await activeGrants(c)).toBe(0);
    expect(await c.flag()).toBe(true);
    expect(await c.type()).toBe('MERCHANT');
    expect(await c.partnerEvents()).toHaveLength(0);
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE', fromValue: 'STAFF', toValue: 'CUSTOMER' } })).toBe(1);
  });

  it('revokeGrant: không vướng → storeBlocked không bật', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF' });
    await grant(c);
    const res = await rbac.revokeGrant(c.adminUser.id, c.owner.phone!);
    expect(res).toMatchObject({ role: 'CUSTOMER' });
    expect(res).not.toHaveProperty('storeBlocked', true);
  });

  it('setUserRole STAFF → CUSTOMER vướng: 409 không nhắc "vai trò đại lý", nêu cách xử lý', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF' });
    await selfShip(c, 'SHIPPING');
    const msg = await conflictMessage(admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER'));
    expect(msg).not.toContain('thu hồi vai trò đại lý');
    expect(msg).toContain('1 đơn tự giao chưa xong');
    expect(msg).toContain('DEALER');
  });

  it('hồi quy: DEALER (setUserRole) → CUSTOMER → cấp STAFF → thu hồi: vai trò cuối CUSTOMER, bậc đại lý cũ không khôi phục DEALER', async () => {
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(tier.id);
    const adminUser = await user('ADMIN');
    const owner = await user('AFFILIATE');
    await admin.setUserRole(adminUser.id, owner.phone!, 'DEALER', tier.id);
    await admin.setUserRole(adminUser.id, owner.phone!, 'CUSTOMER');
    await rbac.addGrant(adminUser.id, owner.phone!, 'STAFF');
    await expect(rbac.revokeGrant(adminUser.id, owner.phone!)).resolves.toMatchObject({ downgraded: true, role: 'CUSTOMER' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe('CUSTOMER');
  });

  it('đại lý cấp qua setUserRole (không có hồ sơ): mở cổng → MERCHANT; cấp STAFF rồi thu hồi → CUSTOMER, gian hàng sạch vướng thì về CTV không đối tác', async () => {
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(tier.id);
    const adminUser = await user('ADMIN');
    const owner = await user('AFFILIATE');
    await admin.setUserRole(adminUser.id, owner.phone!, 'DEALER', tier.id);
    const sf = await portal.getOrCreateStore(owner.id);
    created.storefrontIds.push(sf.id);
    expect(sf).toMatchObject({ type: 'MERCHANT', isPartner: true });
    await rbac.addGrant(adminUser.id, owner.phone!, 'STAFF');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe('STAFF');
    await expect(rbac.revokeGrant(adminUser.id, owner.phone!)).resolves.toMatchObject({ downgraded: true, role: 'CUSTOMER' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe('CUSTOMER');
    expect(await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).toMatchObject({ type: 'CTV', isPartner: false });
    expect(await prisma.userAdminEvent.count({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } })).toBe(1);
  });

  it('freeze phí sàn mặc định áp cho cả gian hàng đã thôi là đối tác nhưng còn lịch sử; mở lại thì đơn mới tính mức mới', async () => {
    const m = await dealerStore({ type: 'MERCHANT' });
    await prisma.storefrontTermsHistory.create({ data: { storefrontId: m.sf.id, commissionPct: 0.1, consignmentFeePct: 0, consignmentFeeFixed: 0, effectiveFrom: new Date(0) } });
    await m.revoke();
    expect(await m.flag()).toBe(false);
    const at = new Date();
    await prisma.$transaction((tx) => freezeDefaultCommissionChange(tx, 0.1, 0.12, at, m.adminUser.id));
    const rows = (await prisma.storefrontTermsHistory.findMany({ where: { storefrontId: m.sf.id } })).map((r) => ({
      effectiveFrom: r.effectiveFrom, commissionPct: Number(r.commissionPct), feePct: Number(r.consignmentFeePct), feeFixed: r.consignmentFeeFixed,
    }));
    expect(rows).toHaveLength(2);
    const current = { commissionPct: 0.12, feePct: 0, feeFixed: 0 };
    expect(termsAt(rows, current, new Date(at.getTime() - 1000)).commissionPct).toBeCloseTo(0.1);
    expect(termsAt(rows, current, new Date(at.getTime() + 1000)).commissionPct).toBeCloseTo(0.12);
  });

  it('revokeGrant: STAFF → CUSTOMER sạch vướng mắc → tắt cờ, ghi STOREFRONT_PARTNER', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF' });
    await grant(c);
    await expect(rbac.revokeGrant(c.adminUser.id, c.owner.phone!)).resolves.toMatchObject({ revoked: 1, downgraded: true });
    expect(await c.role()).toBe('CUSTOMER');
    expect(await c.flag()).toBe(false);
    expect(await c.partnerEvents()).toHaveLength(1);
  });

  it('revokeGrant: về DEALER (có hồ sơ APPROVED) không đụng gian hàng dù đang vướng', async () => {
    const c = await dealerStore({ ownerRole: 'STAFF' });
    await grant(c);
    await prisma.dealerApplication.create({
      data: { userId: c.owner.id, status: 'APPROVED', businessName: 'IT', ownerName: 'IT', phone: c.owner.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
    });
    await selfShip(c, 'SHIPPING');
    await expect(rbac.revokeGrant(c.adminUser.id, c.owner.phone!)).resolves.toMatchObject({ downgraded: true });
    expect(await c.role()).toBe('DEALER');
    expect(await c.flag()).toBe(true);
    expect(await c.partnerEvents()).toHaveLength(0);
  });

  it('applyGrants nâng DEALER lên STAFF không đụng gian hàng và không lỗi', async () => {
    const c = await dealerStore();
    await selfShip(c, 'SHIPPING');
    await grant(c);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } });
    await expect(rbac.applyGrants(fresh)).resolves.toMatchObject({ role: 'STAFF' });
    expect(await c.flag()).toBe(true);
    expect(await c.partnerEvents()).toHaveLength(0);
  });

  it('thua tranh khoá / deadlock trong thu hồi → 503 chứ không phải 500', async () => {
    const c = await dealerStore();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((() => Promise.reject(new Error('ERROR: deadlock detected 40P01'))) as never);
    try {
      await expect(c.revoke()).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      spy.mockRestore();
    }
    expect(await c.role()).toBe('DEALER');
  });

  it('cấp DEALER không đụng cờ isPartner', async () => {
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(tier.id);
    const adminUser = await user('ADMIN');
    const owner = await user('AFFILIATE');
    const sf = await prisma.storefront.create({ data: { type: 'CTV', isPartner: false, slug: `itdr-${randCode(8).toLowerCase()}`, ownerUserId: owner.id, title: 'Shop' } });
    created.storefrontIds.push(sf.id);
    await admin.setUserRole(adminUser.id, owner.phone!, 'DEALER', tier.id);
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner).toBe(false);
    expect(await prisma.userAdminEvent.count({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } })).toBe(0);
  });

  /** Gian hàng CTV đối tác, một sản phẩm tự giao đang bán; khách có giỏ chứa sản phẩm đó và địa chỉ. */
  async function raceScenario() {
    const c = await dealerStore();
    const p = await product(c.sf, 'MERCHANT', true);
    const v = p.variations[0]!;
    await prisma.variation.update({ where: { id: v.id }, data: { retailPrice: PRICE, stock: STOCK } });
    const addr = await prisma.address.create({
      data: {
        userId: c.buyer.id, recipient: 'Khach IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '1 Duong IT',
        provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    await cart.addItem(c.buyer.id, { variationId: v.id, quantity: 1 });
    expect((await cart.getCart(c.buyer.id)).items.map((l) => l.fulfiller.kind)).toEqual(['MERCHANT']);
    return { ...c, p, v, addr };
  }

  async function hold(lock: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await lock(tx);
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitUntil(cond: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; !(await cond()); i++) {
      if (i > 200) throw new Error(`${what} không tới chỗ chờ khoá`);
      await sleep(25);
    }
  }

  /** Đặt đơn chạy tới khi kẹt sau tx giữ khoá; chủ gỡ sản phẩm tự giao; thu hồi chạy tới khi xong hoặc kẹt; thả khoá. */
  async function race(s: Awaited<ReturnType<typeof raceScenario>>, holder: Awaited<ReturnType<typeof hold>>) {
    const running: Promise<unknown>[] = [];
    try {
      let placeSettled = false;
      running.push(
        checkout.placeOrder(s.buyer.id, { addressId: s.addr.id, paymentMethod: 'COD' } as never).finally(() => (placeSettled = true)),
      );
      await waitUntil(async () => placeSettled || (await lockWaiters(holder.pid)) >= 1, 'đặt đơn');
      expect(placeSettled).toBe(false);
      await prisma.product.update({ where: { id: s.p.id }, data: { isActive: false } });
      let revokeSettled = false;
      running.push(s.revoke().finally(() => (revokeSettled = true)));
      await waitUntil(async () => revokeSettled || (await lockWaiters(holder.pid)) >= 2, 'thu hồi');
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    return { place: settled[0]!, revoke: settled[1]!, summary: summarize(settled) };
  }

  it(`thu hồi commit trước khi đặt đơn khoá gian hàng → đặt đơn 409 "${STORE_CHANGED}", không tạo gì, cờ tắt (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await raceScenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${s.v.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.summary.errors.join(" ")).not.toMatch(/40P01|deadlock/i);
      expect(r.revoke).toMatchObject({ status: 'fulfilled' });
      expect(r.place.status).toBe('rejected');
      const err = (r.place as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(STORE_CHANGED);
      expect(await s.flag()).toBe(false);
      expect(await s.role()).toBe('CUSTOMER');
      expect(await prisma.order.count({ where: { fulfillerStorefrontId: s.sf.id } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: s.v.id } })).stock).toBe(STOCK);
    }
  });

  it(`đặt đơn đã khoá gian hàng trước → thu hồi chờ rồi thấy đơn tự giao vừa đặt, 409; vai trò và cờ giữ nguyên, không đơn mồ côi (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await raceScenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${s.buyer.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.summary.errors.join(" ")).not.toMatch(/40P01|deadlock/i);
      expect(r.place.status).toBe('fulfilled');
      expect(r.revoke.status).toBe('rejected');
      const err = (r.revoke as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('1 đơn tự giao chưa xong');
      expect(await s.flag()).toBe(true);
      expect(await s.role()).toBe('DEALER');
      expect(await s.partnerEvents()).toHaveLength(0);
      const orders = await prisma.order.findMany({ where: { userId: s.buyer.id } });
      expect(orders.map((o) => [o.fulfiller, o.fulfillerStorefrontId])).toEqual([['MERCHANT', s.sf.id]]);
    }
  });

  /** Cổng người bán mở lại (chủ DEALER, gian hàng CTV cờ tắt) đua với thu hồi; giữ khoá dòng gian hàng để ép thứ tự tới. */
  describe.each([
    ['cổng trước, thu hồi sau', true],
    ['thu hồi trước, cổng sau', false],
  ] as const)('Cổng người bán đua với thu hồi: %s', (_label, portalFirst) => {
    it(`không bao giờ để lại chủ không còn là DEALER mà cờ đối tác bật (${ROUNDS} vòng)`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const c = await dealerStore({ isPartner: false });
        const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "storefronts" WHERE "id" = ${c.sf.id} FOR UPDATE`);
        const running: Promise<unknown>[] = [];
        try {
          const start = (kind: 'portal' | 'revoke') => {
            let settled = false;
            running.push((kind === 'portal' ? portal.getOrCreateStore(c.owner.id) : c.revoke()).finally(() => (settled = true)));
            return () => settled;
          };
          const first = start(portalFirst ? 'portal' : 'revoke');
          await waitUntil(async () => first() || (await lockWaiters(holder.pid)) >= 1, 'bên đến trước');
          const second = start(portalFirst ? 'revoke' : 'portal');
          await waitUntil(async () => second() || (await lockWaiters(holder.pid)) >= 2, 'bên đến sau');
        } finally {
          holder.release();
          await holder.done;
        }
        const settled = await Promise.allSettled(running);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock/i);
        const role = await c.role();
        const flag = await c.flag();
        expect({ role, flag }).toEqual({ role: 'CUSTOMER', flag: false });
      }
    });
  });

  /** Thu hồi đua với ẩn danh tài khoản của cùng chủ: gian hàng khoá trước users ở cả hai bên, nên không deadlock. */
  describe('Thu hồi đua với ẩn danh tài khoản của cùng chủ', () => {
    async function deletable() {
      const c = await dealerStore();
      const addr = await prisma.address.create({
        data: {
          userId: c.owner.id, recipient: 'IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'P', street: '1',
          provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
        },
      });
      const request = await prisma.accountDeletionRequest.create({ data: { userId: c.owner.id, reason: 'IT' } });
      return { ...c, addr, request };
    }

    it(`ẩn danh giữ users rồi đợi dòng địa chỉ, thu hồi đã giữ gian hàng: không 40P01 tới người gọi, kết quả nhất quán (${ROUNDS} vòng)`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const d = await deletable();
        const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${d.addr.id} FOR UPDATE`);
        const running: Promise<unknown>[] = [];
        try {
          let delSettled = false;
          running.push(deletion.process(d.request.id, d.adminUser.id).finally(() => (delSettled = true)));
          await waitUntil(async () => delSettled || (await lockWaiters(holder.pid)) >= 1, 'xoá tài khoản');
          let revSettled = false;
          running.push(d.revoke().finally(() => (revSettled = true)));
          await waitUntil(async () => revSettled || (await lockWaiters(holder.pid)) >= 2, 'thu hồi');
        } finally {
          holder.release();
          await holder.done;
        }
        const settled = await Promise.allSettled(running);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock/i);
        expect(settled[0]).toMatchObject({ status: 'fulfilled' });
        expect(settled[1]).toMatchObject({ status: 'fulfilled' });
        const u = await prisma.user.findUniqueOrThrow({ where: { id: d.owner.id } });
        expect(u).toMatchObject({ isBlocked: true, role: 'CUSTOMER' });
        expect(await d.flag()).toBe(false);
        expect((await prisma.storefront.findUniqueOrThrow({ where: { id: d.sf.id } })).isPublished).toBe(false);
      }
    });

    it.each([
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ])(`duyệt hồ sơ đại lý đua với ẩn danh của cùng người nộp (có gian hàng: %s, duyệt đến trước: %s): không 40P01, cả hai xong (${ROUNDS} vòng)`, async (hasStore, approvalFirst) => {
      const none = {} as never;
      const approver = new AdminService(prisma, none, none, none, { notify: jest.fn().mockResolvedValue(undefined) } as never, none, none, rbac, none, none, merchant);
      const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
      created.tierIds.push(tier.id);
      const warn = jest.spyOn(Logger.prototype, 'warn');
      for (let round = 0; round < ROUNDS; round++) {
        warn.mockClear();
        const d = await deletable();
        await prisma.user.update({ where: { id: d.owner.id }, data: { role: 'AFFILIATE' } });
        if (hasStore) await prisma.storefront.update({ where: { id: d.sf.id }, data: { isPartner: false } });
        else await prisma.storefront.update({ where: { id: d.sf.id }, data: { ownerUserId: null } });
        const app = await prisma.dealerApplication.create({
          data: { userId: d.owner.id, businessName: 'IT', ownerName: 'IT', phone: d.owner.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
        });
        const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${d.owner.id} FOR UPDATE`);
        const running: Promise<unknown>[] = [];
        try {
          const startApproval = () => {
            let s = false;
            running.push(approver.reviewDealerApplication(d.adminUser.id, app.id, true, tier.id).finally(() => (s = true)));
            return () => s;
          };
          const startDeletion = () => {
            let s = false;
            running.push(deletion.process(d.request.id, d.adminUser.id).finally(() => (s = true)));
            return () => s;
          };
          const first = approvalFirst ? startApproval() : startDeletion();
          await waitUntil(async () => first() || (await lockWaiters(holder.pid)) >= 1, 'bên đến trước');
          const second = approvalFirst ? startDeletion() : startApproval();
          await waitUntil(async () => second() || (await lockWaiters(holder.pid)) >= 2, 'bên đến sau');
        } finally {
          holder.release();
          await holder.done;
        }
        const settled = await Promise.allSettled(running);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock/i);
        // Duyệt đến sau mà ẩn danh đã xong thì bị từ chối (người nộp đã xoá); ẩn danh luôn phải xong.
        const [approval, del] = approvalFirst ? [settled[0]!, settled[1]!] : [settled[1]!, settled[0]!];
        expect(del.status).toBe('fulfilled');
        if (approvalFirst) expect(approval.status).toBe('fulfilled');
        else {
          // Ẩn danh xong trước: duyệt phải bị từ chối vì người nộp đã bị khoá/xoá, hồ sơ còn PENDING, không thành DEALER.
          expect(approval.status).toBe('rejected');
          expect((approval as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
          expect(((approval as PromiseRejectedResult).reason as Error).message).toMatch(/khoá|xoá/);
          expect((await prisma.dealerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('PENDING');
          expect(await d.role()).not.toBe('DEALER');
        }
        if (approval.status === 'rejected') expect(approval.reason).not.toBeInstanceOf(ServiceUnavailableException);
        // Ẩn danh tự chạy lại một lần khi gặp deadlock nên che mất nó: không được rơi vào nhánh đó.
        expect(warn.mock.calls.filter(([m]) => String(m).includes('chạy lại một lần'))).toHaveLength(0);
        if (hasStore && approval.status === 'fulfilled') expect(await d.flag()).toBe(true);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: d.owner.id } })).isBlocked).toBe(true);
      }
    });

    /** Người nộp CTV (gian hàng chưa đối tác, đã có địa chỉ) + hồ sơ PENDING + bậc đại lý; duyệt bằng AdminService riêng. */
    async function applicant() {
      const none = {} as never;
      const approver = new AdminService(prisma, none, none, none, { notify: jest.fn().mockResolvedValue(undefined) } as never, none, none, rbac, none, none, merchant);
      const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
      created.tierIds.push(tier.id);
      const d = await deletable();
      await prisma.user.update({ where: { id: d.owner.id }, data: { role: 'AFFILIATE', metadata: { segments: ['home'] } } });
      await prisma.storefront.update({ where: { id: d.sf.id }, data: { isPartner: false } });
      const app = await prisma.dealerApplication.create({
        data: { userId: d.owner.id, businessName: 'IT', ownerName: 'IT', phone: d.owner.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
      });
      return { d, approver, tier, app, approve: () => approver.reviewDealerApplication(d.adminUser.id, app.id, true, tier.id) };
    }

    it('duyệt hồ sơ chỉ khoá users kiểu NO KEY UPDATE: không chờ FOR KEY SHARE của khoá ngoại (đặt đơn / tạo dòng trỏ tới users)', async () => {
      const a = await applicant();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${a.d.owner.id} FOR KEY SHARE`);
      let settled = false;
      const approval = a.approve().finally(() => (settled = true));
      try {
        await waitUntil(() => settled, 'duyệt hồ sơ khi users đang bị KEY SHARE');
      } finally {
        holder.release();
        await holder.done;
      }
      await approval;
      expect(await a.d.role()).toBe('DEALER');
    });

    it('metadata ghi chen vào users trước khi duyệt lấy được khoá không bị mất (duyệt gộp metadata từ dòng đã khoá)', async () => {
      const a = await applicant();
      const holder = await hold(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${a.d.owner.id} FOR UPDATE`;
        await tx.user.update({ where: { id: a.d.owner.id }, data: { metadata: { segments: ['home'], onboardedAt: '2026-10-01' } } });
      });
      let settled = false;
      const approval = a.approve().finally(() => (settled = true));
      try {
        await waitUntil(async () => settled || (await lockWaiters(holder.pid)) >= 1, 'duyệt hồ sơ');
      } finally {
        holder.release();
        await holder.done;
      }
      await approval;
      const meta = (await prisma.user.findUniqueOrThrow({ where: { id: a.d.owner.id } })).metadata as Record<string, unknown>;
      expect(meta).toEqual({ segments: ['home'], onboardedAt: '2026-10-01', dealerTierId: a.tier.id });
    });

    it.each([true, false])(`CTV nộp hồ sơ vừa đặt đơn qua chính slug của mình vừa được duyệt (duyệt đến trước: %s): không 40P01, không 503 (${ROUNDS} vòng)`, async (approvalFirst) => {
      for (let round = 0; round < ROUNDS; round++) {
        const a = await applicant();
        const p = await prisma.product.create({
          data: {
            fulfilment: 'TUBU', isActive: true, brand: 'IT', slug: `itdr-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: PRICE,
            variations: { create: [{ sku: `ITDR-${randCode(8)}`, pancakeId: `itdr-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: PRICE, stock: STOCK }] },
          },
          include: { variations: true },
        });
        created.productIds.push(p.id);
        const addr = await prisma.address.findFirstOrThrow({ where: { userId: a.d.owner.id } });
        await cart.addItem(a.d.owner.id, { variationId: p.variations[0]!.id, quantity: 1 });
        const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "storefronts" WHERE "id" = ${a.d.sf.id} FOR UPDATE`);
        const running: Promise<unknown>[] = [];
        try {
          const startApproval = () => {
            let s = false;
            running.push(a.approve().finally(() => (s = true)));
            return () => s;
          };
          const startCheckout = () => {
            let s = false;
            running.push(checkout.placeOrder(a.d.owner.id, { addressId: addr.id, paymentMethod: 'COD', storefrontSlug: a.d.sf.slug } as never).finally(() => (s = true)));
            return () => s;
          };
          const first = approvalFirst ? startApproval() : startCheckout();
          await waitUntil(async () => first() || (await lockWaiters(holder.pid)) >= 1, 'bên đến trước');
          const second = approvalFirst ? startCheckout() : startApproval();
          await waitUntil(async () => second() || (await lockWaiters(holder.pid)) >= 2, 'bên đến sau');
        } finally {
          holder.release();
          await holder.done;
        }
        const settled = await Promise.allSettled(running);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock|bận/i);
        for (const r of settled) if (r.status === 'rejected') expect(r.reason).not.toBeInstanceOf(ServiceUnavailableException);
        expect(settled.some((r) => r.status === 'fulfilled')).toBe(true);
        expect(await a.d.role()).toBe('DEALER');
      }
    });

    it('duyệt hồ sơ của người nộp đã bị khoá / đã ẩn danh → từ chối, hồ sơ vẫn PENDING, vai trò không đổi', async () => {
      const none = {} as never;
      const approver = new AdminService(prisma, none, none, none, { notify: jest.fn().mockResolvedValue(undefined) } as never, none, none, rbac, none, none, merchant);
      const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
      created.tierIds.push(tier.id);
      const d = await deletable();
      await prisma.user.update({ where: { id: d.owner.id }, data: { role: 'AFFILIATE' } });
      const app = await prisma.dealerApplication.create({
        data: { userId: d.owner.id, businessName: 'IT', ownerName: 'IT', phone: d.owner.phone!, address: 'IT', cccdFrontUrl: 'x', cccdBackUrl: 'x' },
      });
      await deletion.process(d.request.id, d.adminUser.id);
      await expect(approver.reviewDealerApplication(d.adminUser.id, app.id, true, tier.id)).rejects.toThrow(/khoá|xoá/);
      expect((await prisma.dealerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('PENDING');
      expect(await d.role()).toBe('AFFILIATE');
    });

    it(`hai bên chạy tự do (${ROUNDS * 2} vòng): không 40P01, trạng thái cuối nhất quán`, async () => {
      for (let round = 0; round < ROUNDS * 2; round++) {
        const d = await deletable();
        const settled = await Promise.allSettled(round % 2 ? [d.revoke(), deletion.process(d.request.id, d.adminUser.id)] : [deletion.process(d.request.id, d.adminUser.id), d.revoke()]);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock/i);
        const [del, rev] = round % 2 ? [settled[1]!, settled[0]!] : [settled[0]!, settled[1]!];
        expect(del.status).toBe('fulfilled');
        expect((await prisma.user.findUniqueOrThrow({ where: { id: d.owner.id } })).isBlocked).toBe(true);
        if (rev.status === 'fulfilled') {
          expect(await d.flag()).toBe(false);
          expect(await d.role()).toBe('CUSTOMER');
        } else {
          // Ẩn danh xong trước: SĐT đã gỡ nên thu hồi không tìm thấy người dùng, vai trò và cờ giữ nguyên.
          expect(rev.reason).toBeInstanceOf(NotFoundException);
          expect(await d.role()).toBe('DEALER');
        }
      }
    });
  });

  /** Đại lý chưa có gian hàng: Cổng người bán tạo gian hàng đua với thu hồi (không có dòng nào để khoá). Giữ khoá dòng users để ép thứ tự tới. */
  describe.each([
    ['cổng trước, thu hồi sau', true],
    ['thu hồi trước, cổng sau', false],
  ] as const)('Tạo gian hàng đầu tiên đua với thu hồi: %s', (_label, portalFirst) => {
    it(`không bao giờ để lại chủ không còn là DEALER mà gian hàng là đối tác (${ROUNDS} vòng)`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const adminUser = await user('ADMIN');
        const owner = await user('DEALER');
        const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${owner.id} FOR UPDATE`);
        const running: Promise<unknown>[] = [];
        try {
          const start = (kind: 'portal' | 'revoke') => {
            let settled = false;
            running.push((kind === 'portal' ? portal.getOrCreateStore(owner.id) : admin.setUserRole(adminUser.id, owner.phone!, 'CUSTOMER')).finally(() => (settled = true)));
            return () => settled;
          };
          const first = start(portalFirst ? 'portal' : 'revoke');
          await waitUntil(async () => first() || (await lockWaiters(holder.pid)) >= 1, 'bên đến trước');
          const second = start(portalFirst ? 'revoke' : 'portal');
          await waitUntil(async () => second() || (await lockWaiters(holder.pid)) >= 2, 'bên đến sau');
        } finally {
          holder.release();
          await holder.done;
        }
        const settled = await Promise.allSettled(running);
        expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock/i);
        const store = await prisma.storefront.findFirst({ where: { ownerUserId: owner.id } });
        if (store) created.storefrontIds.push(store.id);
        const role = (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role;
        expect(role).toBe('CUSTOMER');
        expect(store?.isPartner ?? false).toBe(false);
        expect(store?.type ?? 'CTV').not.toBe('MERCHANT');
      }
    });
  });
});
