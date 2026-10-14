import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { PANCAKE_TAKEOVER_UNCONFIRMED } from '../../src/modules/merchant/merchant-pancake-link';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

/**
 * "Tubu giao hộ" (D4, R2-MERCHANT-1/5) trên Postgres THẬT: gian hàng xin mã của sản phẩm Tubu đang bán chỉ được chuyển khi admin
 * xác nhận; từ chối / ngừng bán / admin gỡ liên kết trả biến thể về sản phẩm gốc; gian hàng chỉ thấy đơn trong thời gian liên kết.
 */
describe('Merchant Pancake link (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let merchant: MerchantService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const notifications = { notify } as unknown as NotificationsService;
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, none, none, none);
    merchant = new MerchantService(prisma, {} as OrderStatusService, notifications);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function merchantStore() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itpl-${tag}`, title: `Shop IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    return { owner, store };
  }

  /** Sản phẩm Tubu đang bán (thương hiệu khác), có lượt bán: biến thể Pancake mà gian hàng xin liên kết. */
  async function tubuProduct() {
    const tag = randCode(8);
    const brand = await prisma.brand.create({ data: { slug: `itpl-${tag.toLowerCase()}`, name: `BH IT ${tag}` } });
    const code = `itpl-pv-${tag}`;
    const product = await prisma.product.create({
      data: {
        pancakeId: `itpl-pp-${tag}`,
        brand: brand.name,
        brandId: brand.id,
        slug: `itpl-${tag.toLowerCase()}`,
        name: `Tiêu đen IT ${tag}`,
        description: 'IT',
        basePrice: 120_000,
        soldApp: 30,
        soldExternal: 12,
        variations: {
          create: { pancakeId: code, sku: code, name: '200g', attributes: {}, retailPrice: 120_000, stock: 150 },
        },
      },
      include: { variations: true },
    });
    return { product, variation: product.variations[0]!, code, brand };
  }

  async function requestLink(owner: { id: string }, code: string) {
    return merchant.createProduct(owner.id, {
      name: `Tiêu đen gian hàng ${randCode(4)}`,
      description: 'Tiêu đen hạt',
      basePrice: 120_000,
      tubuFulfils: true,
      pancakeCode: code,
    });
  }

  it('(a) mã của sản phẩm Tubu đang bán: màn duyệt hiện sản phẩm/thương hiệu/tồn/lượt bán sẽ chuyển; duyệt không xác nhận → 409, không chuyển gì', async () => {
    const tubu = await tubuProduct();
    const { owner } = await merchantStore();
    const check = await merchant.checkPancakeVariation(owner.id, tubu.code);
    expect(check).toMatchObject({ requiresAdminConfirm: true, stock: null });
    const p = await requestLink(owner, tubu.code);

    const pending = await admin.listPendingMerchantProducts(1, 100);
    const row = pending.data.find((r) => r.id === p.id)!;
    expect(row.pancakeLink).toMatchObject({
      state: 'TAKEOVER',
      variation: { stock: 150 },
      origin: { id: tubu.product.id, name: tubu.product.name, brandName: tubu.brand.name, sold: 42, onSale: true },
    });

    await expect(admin.reviewMerchantProduct('admin-it', p.id, true)).rejects.toMatchObject({
      response: expect.objectContaining({ code: PANCAKE_TAKEOVER_UNCONFIRMED }),
    });
    const [v, origin, mine] = await Promise.all([
      prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: tubu.product.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
    ]);
    expect(v.productId).toBe(tubu.product.id);
    expect(origin.isActive).toBe(true);
    expect(mine.approvalStatus).toBe('PENDING_REVIEW');
    expect(await prisma.merchantPancakeLink.count({ where: { productId: p.id } })).toBe(0);
  });

  it('(b) duyệt có xác nhận → chuyển; sửa nội dung không làm mất liên kết, từ chối bản sửa giữ nội dung đang bán; admin gỡ liên kết → biến thể về sản phẩm gốc, gốc bán lại, gian hàng khác xin được mã', async () => {
    const tubu = await tubuProduct();
    const a = await merchantStore();
    const p = await requestLink(a.owner, tubu.code);
    await admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true);

    const linked = await prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } });
    expect(linked.productId).toBe(p.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: tubu.product.id } })).isActive).toBe(false);
    expect(await prisma.merchantPancakeLink.findFirst({ where: { productId: p.id, unlinkedAt: null } })).toMatchObject({
      originProductId: tubu.product.id,
      takeover: true,
      originDeactivated: true,
      linkedBy: 'admin-it',
    });
    const liveName = (await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).name;

    await merchant.updateProduct(a.owner.id, p.id, { name: 'Tiêu đen Shop A' });
    const editing = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { editDraft: true } });
    expect(editing).toMatchObject({ approvalStatus: 'APPROVED', isActive: true, name: liveName, fulfilment: 'TUBU' });
    expect(editing.editDraft?.name).toBe('Tiêu đen Shop A');
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } })).productId).toBe(p.id);
    expect(await prisma.merchantPancakeLink.count({ where: { productId: p.id, unlinkedAt: null } })).toBe(1);

    const editRow = (await admin.listPendingMerchantProducts(1, 100)).data.find((r) => r.id === p.id)!;
    expect(editRow).toMatchObject({ isEdit: true, pancakeLinkCode: tubu.code });
    await admin.reviewMerchantProduct('admin-it', p.id, false, 'Nhầm', false, editRow.editVersion!);
    for (const approve of [false, true]) {
      await expect(admin.reviewMerchantProduct('admin-it', p.id, approve, 'Nhầm', false, editRow.editVersion!)).rejects.toBeInstanceOf(BadRequestException);
      await expect(admin.reviewMerchantProduct('admin-it', p.id, approve, 'Nhầm')).rejects.toBeInstanceOf(BadRequestException);
    }
    const rejectedEdit = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { editDraft: true } });
    expect(rejectedEdit).toMatchObject({ approvalStatus: 'APPROVED', isActive: true, name: liveName, rejectReason: 'Nhầm' });
    expect(rejectedEdit.editDraft).toBeNull();
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } })).productId).toBe(p.id);
    expect(await prisma.merchantPancakeLink.count({ where: { productId: p.id, unlinkedAt: null } })).toBe(1);

    await admin.unlinkMerchantProduct('admin-it', p.id, 'Hết hợp tác');
    const [v, origin, mine] = await Promise.all([
      prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: tubu.product.id }, include: { variations: true } }),
      prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { variations: true } }),
    ]);
    expect(v.productId).toBe(tubu.product.id);
    expect(origin.isActive).toBe(true);
    expect(origin.variations.map((x) => x.id)).toEqual([tubu.variation.id]);
    expect(mine.isActive).toBe(false);
    expect(mine.fulfilment).toBe('MERCHANT');
    expect(mine.variations.every((x) => x.pancakeId === null)).toBe(true);

    const b = await merchantStore();
    await expect(merchant.checkPancakeVariation(b.owner.id, tubu.code)).resolves.toMatchObject({ pancakeId: tubu.code });
  });

  it('(c) admin "Gỡ liên kết" chồng với đối tác ngừng bán → biến thể về gốc đúng một lần, không còn liên kết mở, đối tác được báo', async () => {
    for (let round = 0; round < 4; round++) {
      const tubu = await tubuProduct();
      const { owner } = await merchantStore();
      const p = await requestLink(owner, tubu.code);
      await admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true);
      notify.mockClear();

      const results = await Promise.allSettled([
        admin.unlinkMerchantProduct('admin-it', p.id, 'Sai thương hiệu'),
        merchant.stopSellingProduct(owner.id, p.id),
      ]);
      const s = summarize(results);
      const [v, origin, mine, open, closed] = await Promise.all([
        prisma.variation.findUniqueOrThrow({ where: { id: tubu.variation.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: tubu.product.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { variations: true } }),
        prisma.merchantPancakeLink.count({ where: { productId: p.id, unlinkedAt: null } }),
        prisma.merchantPancakeLink.count({ where: { productId: p.id, unlinkedAt: { not: null } } }),
      ]);
      console.log('[c] round=%d fulfilled=%d errors=%j', round, s.fulfilled.length, s.errors);
      expect(v.productId).toBe(tubu.product.id);
      expect(origin.isActive).toBe(true);
      expect(mine.isActive).toBe(false);
      expect(mine.variations.filter((x) => x.pancakeId === null)).toHaveLength(1);
      expect(open).toBe(0);
      expect(closed).toBe(1);
      for (const r of s.rejected) expect(String((r.reason as Error).message)).toContain('không còn liên kết');
      if (results[0].status === 'fulfilled') {
        expect(notify).toHaveBeenCalledWith(owner.id, 'MERCHANT_PRODUCT_UNLINKED', expect.objectContaining({ reason: 'Sai thương hiệu' }));
      }
    }
  });

  it('(d) hai gian hàng xin cùng mã, admin xác nhận duyệt cả hai cùng lúc → 1 thắng; mã đang ở gian hàng khác thì không ai xin được', async () => {
    const tubu = await tubuProduct();
    const a = await merchantStore();
    const b = await merchantStore();
    const pa = await requestLink(a.owner, tubu.code);
    const pb = await requestLink(b.owner, tubu.code);
    const results = await Promise.allSettled([
      admin.reviewMerchantProduct('admin-it', pa.id, true, undefined, true),
      admin.reviewMerchantProduct('admin-it', pb.id, true, undefined, true),
    ]);
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected[0]!.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.merchantPancakeLink.count({ where: { variationId: tubu.variation.id, unlinkedAt: null } })).toBe(1);
    const c = await merchantStore();
    await expect(merchant.checkPancakeVariation(c.owner.id, tubu.code)).rejects.toThrow('Không tìm thấy');
  });

  it('(e) R2-MERCHANT-5: gian hàng chỉ thấy đơn từ lúc liên kết tới lúc gỡ, chỉ dòng hàng của mình, không thấy tổng đơn', async () => {
    const tubu = await tubuProduct();
    const other = await tubuProduct();
    const buyer = await createUser(prisma);
    const { owner } = await merchantStore();
    const order = (when: Date) =>
      createOrder(prisma, {
        userId: buyer.id,
        createdAt: when,
        pancakeOrderId: `itpl-${randCode(10)}`,
        pancakePushStatus: 'SYNCED',
        total: 300_000,
        items: {
          create: [
            { variationId: tubu.variation.id, productName: 'Tiêu', variationName: '200g', unitPrice: 120_000, quantity: 1, total: 120_000 },
            { variationId: other.variation.id, productName: 'Hàng nhãn khác', variationName: '200g', unitPrice: 180_000, quantity: 1, total: 180_000 },
          ],
        },
      });
    const before = await order(new Date(Date.now() - 86_400_000));
    const p = await requestLink(owner, tubu.code);
    await admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true);
    await sleep(10);
    const during = await order(new Date());
    await sleep(10);
    await admin.unlinkMerchantProduct('admin-it', p.id, 'Hết hợp tác');
    await sleep(10);
    const after = await order(new Date());

    const res = await merchant.listMerchantOrders(owner.id, undefined, 1, 50);
    const codes = res.data.map((o) => o.code);
    expect(codes).toContain(during.code);
    expect(codes).not.toContain(before.code);
    expect(codes).not.toContain(after.code);
    const seen = res.data.find((o) => o.code === during.code)!;
    expect(seen.items.map((i) => i.productName)).toEqual(['Tiêu']);
    expect(seen).toMatchObject({ total: null, ownTotal: 120_000, partial: true, selfFulfilled: false });
  });
});
