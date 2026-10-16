import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { OrderStatus, Prisma, StorefrontType, UserRole } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { linkTubuFulfilledVariation } from '../../src/modules/merchant/merchant-pancake-link';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { createOrder as createOrderRow, createUser as createUserRow, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * POST /admin/storefronts/:id/partner: admin gỡ cờ isPartner bị kẹt (cấp DEALER bằng setUserRole rồi đổi lại) hoặc bật lại. Không
 * cho tắt khi gian hàng còn dữ liệu đối tác sẽ mồ côi (kể cả tiền ký gửi "Tubu giao hộ" đang chạy và hàng trả chưa nhận về); không
 * bật cho gian hàng BRAND; bấm lại không ghi thêm sổ; không tạo liên kết giao hộ cho gian hàng vừa thôi là đối tác.
 */
describe('Admin bật/tắt cờ gian hàng đối tác (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: MerchantFulfilmentService;
  const CONFIG_KEYS = ['merchant.settlement_hold_days', 'merchant.consignment_settle_from'];
  let savedConfig: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], storefrontIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    svc = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
  });

  afterAll(async () => {
    if (prisma) {
      const { userIds, storefrontIds, productIds } = created;
      const orderIds = (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o) => o.id);
      await prisma.$transaction([
        prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.merchantPayout.deleteMany({ where: { storefrontId: { in: storefrontIds } } }),
        prisma.merchantPancakeLink.deleteMany({ where: { storefrontId: { in: storefrontIds } } }),
        prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.variation.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
        prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } }),
      ]);
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  const createUser = async (...args: Parameters<typeof createUserRow>) => {
    const u = await createUserRow(...args);
    created.userIds.push(u.id);
    return u;
  };
  const createOrder = (data: Parameters<typeof createOrderRow>[1]) => createOrderRow(prisma, data);

  async function product(storefrontId: string | null, fulfilment: 'MERCHANT' | 'TUBU', isActive = true, extra: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
    const p = await prisma.product.create({
      data: {
        storefrontId, fulfilment, isActive, brand: 'IT', slug: `it-pf-p-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT',
        basePrice: 1000,
        ...extra,
        variations: { create: [{ sku: `ITPF-${randCode(8)}`, pancakeId: `itpf-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
      include: { variations: true },
    });
    created.productIds.push(p.id);
    return p;
  }

  async function store(o: { role?: UserRole; type?: StorefrontType; isPartner?: boolean } = {}) {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const owner = await createUser(prisma, { role: o.role ?? 'AFFILIATE' });
    const sf = await prisma.storefront.create({
      data: {
        type: o.type ?? 'CTV',
        isPartner: o.isPartner ?? true,
        slug: `it-pf-${randCode(8).toLowerCase()}`,
        ownerUserId: owner.id,
        title: 'Gian hàng IT',
      },
    });
    created.storefrontIds.push(sf.id);
    const buyer = await createUser(prisma);
    const selfShip = (status: OrderStatus, extra: { deliveredAt?: Date; paymentStatus?: 'PAID' | 'UNPAID'; paymentMethod?: 'COD' | 'BANK_TRANSFER' } = {}) =>
      createOrder({
        userId: buyer.id, status, fulfiller: 'MERCHANT', fulfillerStorefrontId: sf.id, storefrontSlug: sf.slug,
        paymentStatus: extra.paymentStatus ?? 'UNPAID', paymentMethod: extra.paymentMethod ?? 'COD',
        ...(extra.deliveredAt ? { deliveredAt: extra.deliveredAt } : {}),
      });
    const events = () => prisma.userAdminEvent.findMany({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } });
    const flag = async () => (await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner;
    return { admin, owner, sf, buyer, selfShip, events, flag };
  }

  async function conflictMessage(p: Promise<unknown>) {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).message;
  }

  it('tắt cờ của gian hàng CTV không còn dữ liệu đối tác (chủ đã về CTV): tắt, ghi sổ một dòng; bấm lại không ghi thêm', async () => {
    const { admin, owner, sf, selfShip, events, flag } = await store();
    await selfShip('CANCELLED');
    await selfShip('RETURNED');
    await expect(svc.setStorePartner(admin.id, sf.id, false)).resolves.toEqual({ id: sf.id, isPartner: false });
    expect(await flag()).toBe(false);
    await expect(svc.setStorePartner(admin.id, sf.id, false)).resolves.toEqual({ id: sf.id, isPartner: false });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ userId: owner.id, fromValue: 'true', toValue: 'false', actorId: admin.id, reason: sf.id });
  });

  it('bật lại cờ cho gian hàng CTV: bật, ghi sổ; bấm lại idempotent', async () => {
    const { admin, sf, events, flag } = await store({ isPartner: false });
    await expect(svc.setStorePartner(admin.id, sf.id, true)).resolves.toEqual({ id: sf.id, isPartner: true });
    await svc.setStorePartner(admin.id, sf.id, true);
    expect(await flag()).toBe(true);
    expect((await events()).map((e) => [e.fromValue, e.toValue])).toEqual([['false', 'true']]);
  });

  it('404 khi không có gian hàng', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    await expect(svc.setStorePartner(admin.id, 'khong-co', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không bật cho gian hàng BRAND; không tắt được gian hàng loại MERCHANT (luôn là đối tác)', async () => {
    const brand = await store({ type: 'BRAND', isPartner: false });
    await expect(svc.setStorePartner(brand.admin.id, brand.sf.id, true)).rejects.toBeInstanceOf(BadRequestException);
    expect(await brand.flag()).toBe(false);
    const merchant = await store({ type: 'MERCHANT', isPartner: true, role: 'DEALER' });
    await expect(svc.setStorePartner(merchant.admin.id, merchant.sf.id, false)).rejects.toBeInstanceOf(BadRequestException);
    expect(await merchant.flag()).toBe(true);
    expect(await brand.events()).toHaveLength(0);
  });

  it('409 liệt kê từng vướng mắc: chủ còn là đại lý, đơn tự giao đang xử lý, khoản chờ đối soát, phiếu chờ, liên kết giao hộ, yêu cầu trả', async () => {
    const { admin, owner, sf, buyer, selfShip, events, flag } = await store({ role: 'DEALER' });
    await selfShip('CONFIRMED');
    await selfShip('SHIPPING');
    await selfShip('PENDING_PAYMENT');
    const delivered = await selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - 20 * DAY), paymentStatus: 'PAID' });
    await prisma.returnRequest.create({ data: { orderId: delivered.id, userId: buyer.id, reason: 'IT', status: 'REQUESTED' } });
    await prisma.merchantPayout.create({ data: { storefrontId: sf.id, amount: 1000, createdBy: admin.id } });
    await product(sf.id, 'MERCHANT');
    await product(sf.id, 'MERCHANT', false);
    const consigned = await product(sf.id, 'TUBU');
    await prisma.merchantPancakeLink.create({ data: { productId: consigned.id, storefrontId: sf.id, variationId: consigned.variations[0]!.id } });
    await prisma.merchantPancakeLink.create({
      data: { productId: consigned.id, storefrontId: sf.id, variationId: consigned.variations[0]!.id, unlinkedAt: new Date() },
    });

    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toContain('chủ gian hàng vẫn là đại lý');
    expect(msg).toContain('3 đơn tự giao chưa xong');
    expect(msg).toContain('khoản chờ đối soát');
    expect(msg).toContain('1 phiếu đối soát chưa chuyển');
    expect(msg).toContain('1 liên kết hàng Tubu giao hộ');
    expect(msg).toContain('1 yêu cầu trả hàng chờ xử lý');
    expect(msg).toContain('1 sản phẩm tự giao đang bán');
    expect(await flag()).toBe(true);
    expect(await events()).toHaveLength(0);

    await prisma.user.update({ where: { id: owner.id }, data: { role: 'AFFILIATE' } });
    const msg2 = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg2).not.toContain('đại lý');
    expect(msg2).toContain('3 đơn tự giao chưa xong');
  });

  it('chỉ còn một vướng mắc (khoản chờ đối soát của đơn mới giao) vẫn 409', async () => {
    const { admin, sf, selfShip, flag } = await store();
    await selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - DAY), paymentStatus: 'PAID' });
    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toContain('khoản chờ đối soát');
    expect(await flag()).toBe(true);
  });

  it('hàng Tubu giao hộ đang chạy: liên kết đã gỡ nhưng đơn đặt trong thời gian liên kết chưa giao xong → 409; đơn huỷ/đặt ngoài cửa sổ không chặn', async () => {
    const { admin, sf, buyer, flag } = await store();
    const consigned = await product(sf.id, 'TUBU');
    const variationId = consigned.variations[0]!.id;
    const linkedAt = new Date(Date.now() - 10 * DAY);
    const unlinkedAt = new Date(Date.now() - 2 * DAY);
    await prisma.merchantPancakeLink.create({ data: { productId: consigned.id, storefrontId: sf.id, variationId, linkedAt, unlinkedAt } });
    const tubuOrder = (status: OrderStatus, daysAgo: number) =>
      createOrder({
        userId: buyer.id, status, fulfiller: 'TUBU', createdAt: new Date(Date.now() - daysAgo * DAY),
        items: { create: [{ variationId, productName: 'SP IT', variationName: 'v', unitPrice: 1000, quantity: 1, total: 1000 }] },
      });
    await tubuOrder('CANCELLED', 5);
    await tubuOrder('SHIPPING', 1);
    await tubuOrder('CONFIRMED', 20);
    const open = await tubuOrder('SHIPPING', 5);

    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toBe(
      `Chưa thể tắt gian hàng đối tác: 1 đơn có hàng Tubu giao hộ của gian hàng chưa bán xong (${open.code}). Xử lý xong rồi thử lại.`,
    );
    expect(await flag()).toBe(true);

    const more = [];
    for (let i = 0; i < 6; i++) more.push(await tubuOrder('CONFIRMED', 9 - i));
    const msg2 = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    const first5 = [...more.slice(0, 4), open].map((o) => o.code);
    expect(msg2).toBe(
      `Chưa thể tắt gian hàng đối tác: 7 đơn có hàng Tubu giao hộ của gian hàng chưa bán xong (${first5.join(', ')}, …). Xử lý xong rồi thử lại.`,
    );
  });

  it('yêu cầu trả đã duyệt mà chưa xác nhận nhận hàng về → 409; đã nhận về thì không chặn', async () => {
    const { admin, sf, buyer, selfShip, flag } = await store();
    const order = await selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - 20 * DAY), paymentMethod: 'BANK_TRANSFER' });
    const rr = await prisma.returnRequest.create({ data: { orderId: order.id, userId: buyer.id, reason: 'IT', status: 'APPROVED', refundAmount: 0 } });
    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toBe('Chưa thể tắt gian hàng đối tác: 1 yêu cầu trả đã duyệt chưa xác nhận nhận hàng. Xử lý xong rồi thử lại.');
    expect(await flag()).toBe(true);
    await prisma.returnRequest.update({ where: { id: rr.id }, data: { receivedAt: new Date() } });
    await expect(svc.setStorePartner(admin.id, sf.id, false)).resolves.toEqual({ id: sf.id, isPartner: false });
  });

  /**
   * Sản phẩm "Tubu giao hộ" chờ duyệt đúng hình dạng merchant.service createProduct: fulfilment MERCHANT, biến thể tạm không mã
   * Pancake, PENDING_REVIEW, nhãn = tên gian hàng. `hidden`: chủ đã ẩn (isActive=false) — sản phẩm đang bật thì vướng mắc 'sản
   * phẩm tự giao đang bán' đã chặn tắt cờ.
   */
  async function pendingConsignment(sf: { id: string; title: string }, hidden = true) {
    const tubu = await product(null, 'TUBU', false);
    const partner = await prisma.product.create({
      data: {
        storefrontId: sf.id, fulfilment: 'MERCHANT', isActive: !hidden, approvalStatus: 'PENDING_REVIEW', brand: sf.title,
        slug: `it-pf-c-${randCode(8).toLowerCase()}`, name: 'SP giao hộ IT', description: 'IT', basePrice: 1000,
        pancakeLinkCode: tubu.variations[0]!.pancakeId,
        variations: { create: [{ sku: `ITPFC-${randCode(8)}`, pancakeId: null, name: 'Mặc định', attributes: {}, retailPrice: 1000, stock: 0 }] },
      },
    });
    created.productIds.push(partner.id);
    return { tubu, partner };
  }

  it('không tạo liên kết Tubu giao hộ cho gian hàng không còn là đối tác', async () => {
    const { admin, sf } = await store({ isPartner: false });
    const { partner } = await pendingConsignment(sf);
    const err = await prisma
      .$transaction((tx) => linkTubuFulfilledVariation(tx, partner, { adminId: admin.id }))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('không còn là gian hàng đối tác');
    expect(await prisma.merchantPancakeLink.count({ where: { storefrontId: sf.id } })).toBe(0);
  });

  it('sản phẩm giao hộ chờ duyệt đang bật (hình dạng thật): tắt cờ bị chặn bởi sản phẩm tự giao đang bán, duyệt vẫn liên kết được', async () => {
    const { admin, sf, flag } = await store();
    const { partner } = await pendingConsignment(sf, false);
    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toBe('Chưa thể tắt gian hàng đối tác: 1 sản phẩm tự giao đang bán. Xử lý xong rồi thử lại.');
    await prisma.$transaction((tx) => linkTubuFulfilledVariation(tx, partner, { adminId: admin.id }));
    expect(await prisma.merchantPancakeLink.count({ where: { storefrontId: sf.id, unlinkedAt: null } })).toBe(1);
    expect(await flag()).toBe(true);
  });

  async function blockedBy(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS "n" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))`;
    return row?.n ?? 0;
  }

  it('duyệt liên kết (đã khoá dòng sản phẩm) ‖ chủ đổi tên gian hàng (khoá gian hàng rồi sửa nhãn sản phẩm), ép xen kẽ: không 40P01, cả hai xong', async () => {
    const { admin, owner, sf } = await store();
    const { partner } = await pendingConsignment(sf);
    const merchant = new MerchantService(prisma, {} as OrderStatusService);
    let pid = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const productLocked = new Promise<void>((r) => (locked = r));
    // Cùng thứ tự với AdminService.reviewMerchantProduct: CAS dòng sản phẩm trước, rồi liên kết trong cùng tx.
    const approval = prisma.$transaction(
      async (tx) => {
        await tx.product.updateMany({ where: { id: partner.id, approvalStatus: 'PENDING_REVIEW' }, data: { approvalStatus: 'APPROVED' } });
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
        return linkTubuFulfilledVariation(tx, partner, { adminId: admin.id });
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    await productLocked;
    const rename = merchant.updateStore(owner.id, { title: 'Tên mới IT' });
    for (let i = 0; (await blockedBy(pid)) < 1; i++) {
      if (i > 200) throw new Error('lần đổi tên không chờ dòng sản phẩm');
      await sleep(25);
    }
    release();
    const r = summarize(await Promise.allSettled([approval, rename]));
    expect(r.errors).toEqual([]);
    expect(await prisma.merchantPancakeLink.count({ where: { storefrontId: sf.id, unlinkedAt: null } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: partner.id } })).brand).toBe('Tên mới IT');
  });

  it('admin tắt cờ ‖ admin duyệt liên kết giao hộ cùng lúc (5 vòng): đúng một bên thành công, không có liên kết sống trên gian hàng đã tắt', async () => {
    for (let round = 0; round < 5; round++) {
      const { admin, sf, flag } = await store();
      const { partner } = await pendingConsignment(sf);
      const link = prisma.$transaction((tx) => linkTubuFulfilledVariation(tx, partner, { adminId: admin.id }));
      const off = svc.setStorePartner(admin.id, sf.id, false);
      const [l, o] = await Promise.allSettled([link, off]);
      const ok = [l, o].filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      for (const r of [l, o]) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
      const live = await prisma.merchantPancakeLink.count({ where: { storefrontId: sf.id, unlinkedAt: null } });
      expect(live).toBe((await flag()) ? 1 : 0);
    }
  });

  it('hai admin bấm tắt cùng lúc: một dòng sổ, cờ tắt', async () => {
    const { admin, sf, events, flag } = await store();
    const r = summarize(await Promise.allSettled([svc.setStorePartner(admin.id, sf.id, false), svc.setStorePartner(admin.id, sf.id, false)]));
    expect(r.errors).toEqual([]);
    expect(await flag()).toBe(false);
    expect(await events()).toHaveLength(1);
  });
});
