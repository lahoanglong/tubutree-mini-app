import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import {
  PANCAKE_CODE_CHANGED,
  PANCAKE_TAKEOVER_CHANGED,
  PANCAKE_TAKEOVER_UNCONFIRMED,
} from '../../src/modules/merchant/merchant-pancake-link';
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

  /** Dòng ở màn "Duyệt SP đối tác" như admin đang thấy. */
  async function pendingRow(productId: string) {
    return (await admin.listPendingMerchantProducts(1, 500)).data.find((r) => r.id === productId)!;
  }

  /** Những gì màn duyệt gửi kèm khi bấm Duyệt: mã đang hiện ('' khi dòng không có mã) và sản phẩm đang bán admin đã tích xác nhận chuyển. */
  function seenOn(row: Awaited<ReturnType<typeof pendingRow>>) {
    const origin = row.pancakeLink?.state === 'TAKEOVER' ? row.pancakeLink.origin?.id : undefined;
    return { pancakeCode: row.pancakeLinkCode ?? '', takeoverProductId: origin };
  }

  /** Admin mở màn duyệt, tích xác nhận (nếu cần) rồi bấm Duyệt. */
  async function approveShown(productId: string) {
    const row = await pendingRow(productId);
    return admin.reviewMerchantProduct('admin-it', productId, true, undefined, row.pancakeLink?.state === 'TAKEOVER', undefined, seenOn(row));
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

    const row = await pendingRow(p.id);
    expect(row.pancakeLink).toMatchObject({
      state: 'TAKEOVER',
      variation: { stock: 150 },
      origin: { id: tubu.product.id, name: tubu.product.name, brandName: tubu.brand.name, sold: 42, onSale: true },
    });

    await expect(admin.reviewMerchantProduct('admin-it', p.id, true, undefined, false, undefined, seenOn(row))).rejects.toMatchObject({
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
    await approveShown(p.id);

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
      await expect(admin.reviewMerchantProduct('admin-it', p.id, approve, 'Nhầm', false, editRow.editVersion!)).rejects.toBeInstanceOf(ConflictException);
      await expect(admin.reviewMerchantProduct('admin-it', p.id, approve, 'Nhầm')).rejects.toBeInstanceOf(ConflictException);
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
      await approveShown(p.id);
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
    const [rowA, rowB] = await Promise.all([pendingRow(pa.id), pendingRow(pb.id)]);
    const results = await Promise.allSettled([
      admin.reviewMerchantProduct('admin-it', pa.id, true, undefined, true, undefined, seenOn(rowA)),
      admin.reviewMerchantProduct('admin-it', pb.id, true, undefined, true, undefined, seenOn(rowB)),
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
    await approveShown(p.id);
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

  it('(f) R4-PARTNER-6: sản phẩm đã gỡ liên kết không còn kẹt — đổi sang mã khác (chờ duyệt rồi liên kết lại) hoặc bỏ mã để tự giao và sửa giá/tồn', async () => {
    const a = await tubuProduct();
    const b = await tubuProduct();
    const { owner } = await merchantStore();
    const p = await requestLink(owner, a.code);
    await approveShown(p.id);
    await admin.unlinkMerchantProduct('admin-it', p.id, 'Hết hợp tác');

    // Trước đây: kẹt — không sửa giá/tồn, không đổi được mã.
    await expect(merchant.updateProduct(owner.id, p.id, { stock: 5 })).rejects.toThrow('theo kho Tubu');
    await expect(merchant.updateProduct(owner.id, p.id, { pancakeCode: 'khong-co-ma-nay' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).pancakeLinkCode).toBe(a.code);

    // Đổi sang mã khác: về chờ duyệt, admin duyệt thì liên kết đúng biến thể mới.
    await merchant.updateProduct(owner.id, p.id, { pancakeCode: ` ${b.code} ` });
    const requested = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(requested).toMatchObject({ pancakeLinkCode: b.code, approvalStatus: 'PENDING_REVIEW', fulfilment: 'MERCHANT', isActive: true });
    const row = (await admin.listPendingMerchantProducts(1, 100)).data.find((r) => r.id === p.id)!;
    expect(row.pancakeLink).toMatchObject({ state: 'TAKEOVER', origin: { id: b.product.id } });
    await approveShown(p.id);
    const [linked, mine, open] = await Promise.all([
      prisma.variation.findUniqueOrThrow({ where: { id: b.variation.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
      prisma.merchantPancakeLink.findFirst({ where: { productId: p.id, unlinkedAt: null } }),
    ]);
    expect(linked.productId).toBe(p.id);
    expect(mine).toMatchObject({ fulfilment: 'TUBU', approvalStatus: 'APPROVED', pancakeLinkCode: b.code, isActive: true });
    expect(open).toMatchObject({ variationId: b.variation.id, originProductId: b.product.id });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).toMatchObject({ isActive: false });
    expect(linked.isActive).toBe(true);
    // Đã liên kết lại: không đổi/bỏ mã được nữa nếu chưa gỡ.
    await expect(merchant.updateProduct(owner.id, p.id, { pancakeCode: null })).rejects.toThrow('đang được Tubu giao hộ');
    await expect(merchant.updateProduct(owner.id, p.id, { pancakeCode: a.code })).rejects.toThrow('đang được Tubu giao hộ');

    // Bỏ mã: tự giao, sửa giá/tồn và mở bán lại ngay, không cần duyệt lại (nội dung đã được duyệt).
    const c = await tubuProduct();
    const q = await requestLink(owner, c.code);
    await approveShown(q.id);
    await admin.unlinkMerchantProduct('admin-it', q.id, 'Hết hợp tác');
    await merchant.updateProduct(owner.id, q.id, { pancakeCode: null, basePrice: 95_000, stock: 7 });
    await merchant.updateProduct(owner.id, q.id, { isActive: true });
    const selfShip = await prisma.product.findUniqueOrThrow({ where: { id: q.id }, include: { variations: true } });
    expect(selfShip).toMatchObject({ fulfilment: 'MERCHANT', pancakeLinkCode: null, approvalStatus: 'APPROVED', isActive: true, basePrice: 95_000 });
    expect(selfShip.variations).toHaveLength(1);
    expect(selfShip.variations[0]).toMatchObject({ pancakeId: null, stock: 7, retailPrice: 95_000, isActive: true });
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: c.variation.id } })).productId).toBe(c.product.id);
    const listed = (await merchant.listMyProducts(owner.id)).ownProducts.find((x) => x.id === q.id) as unknown as { linkState: unknown };
    expect(listed.linkState).toBeNull();
    // Sau khi đã tự giao, các sửa giá/tồn tiếp theo vẫn bình thường.
    await merchant.updateProduct(owner.id, q.id, { stock: 9 });
    expect((await prisma.variation.findUnique({ where: { id: selfShip.variations[0]!.id } }))!.stock).toBe(9);
  });

  it('(g) R4-PARTNER-6: admin duyệt liên kết chồng với đối tác đổi/bỏ mã → chỉ mã admin đã xem được liên kết, sản phẩm Tubu của mã mới không bị đụng tới', async () => {
    for (let round = 0; round < 6; round++) {
      const a = await tubuProduct();
      const b = await tubuProduct();
      const { owner } = await merchantStore();
      const p = await requestLink(owner, a.code);
      const row = await pendingRow(p.id);
      expect(row.pancakeLink).toMatchObject({ state: 'TAKEOVER', origin: { id: a.product.id } });
      const approve = () => admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true, undefined, seenOn(row));
      const change = round % 2 === 0 ? { pancakeCode: b.code } : { pancakeCode: null };
      const results = await Promise.allSettled(
        round % 3 === 0
          ? [merchant.updateProduct(owner.id, p.id, change), approve()]
          : [approve(), merchant.updateProduct(owner.id, p.id, change)],
      );
      const s = summarize(results);
      console.log('[g] round=%d errors=%j', round, s.errors);
      const [mine, open, va, vb, originB] = await Promise.all([
        prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
        prisma.merchantPancakeLink.findMany({ where: { productId: p.id, unlinkedAt: null } }),
        prisma.variation.findUniqueOrThrow({ where: { id: a.variation.id } }),
        prisma.variation.findUniqueOrThrow({ where: { id: b.variation.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: b.product.id } }),
      ]);
      // Admin chỉ xem và xác nhận chuyển sản phẩm A: biến thể B không bao giờ rời sản phẩm Tubu của nó.
      expect(vb.productId).toBe(b.product.id);
      expect(originB.isActive).toBe(true);
      expect(open.filter((l) => l.variationId === vb.id)).toHaveLength(0);
      const movedHere = va.productId === p.id;
      expect(open).toHaveLength(movedHere ? 1 : 0);
      if (movedHere) {
        expect(open[0]).toMatchObject({ variationId: va.id, originProductId: a.product.id });
        expect(mine).toMatchObject({ fulfilment: 'TUBU', pancakeLinkCode: a.code, approvalStatus: 'APPROVED' });
      } else {
        expect(mine.fulfilment).toBe('MERCHANT');
        expect([a.code, b.code, null]).toContain(mine.pancakeLinkCode);
      }
      for (const r of s.rejected) expect([BadRequestException, ConflictException].some((E) => r.reason instanceof E)).toBe(true);
    }
  });

  it('(h) đối tác đổi sang mã của sản phẩm Tubu khác giữa lúc admin xem và bấm Duyệt → 409, không chuyển gì, sản phẩm Tubu kia vẫn bán', async () => {
    const x = await tubuProduct();
    const y = await tubuProduct();
    const { owner } = await merchantStore();
    const p = await requestLink(owner, x.code);
    const shown = await pendingRow(p.id);
    expect(shown.pancakeLink).toMatchObject({ state: 'TAKEOVER', origin: { id: x.product.id } });

    await merchant.updateProduct(owner.id, p.id, { pancakeCode: y.code });
    const nothingMoved = async () => {
      const [vx, vy, px, py, mine, links] = await Promise.all([
        prisma.variation.findUniqueOrThrow({ where: { id: x.variation.id } }),
        prisma.variation.findUniqueOrThrow({ where: { id: y.variation.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: x.product.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: y.product.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
        prisma.merchantPancakeLink.count({ where: { productId: p.id } }),
      ]);
      expect(vx.productId).toBe(x.product.id);
      expect(vy.productId).toBe(y.product.id);
      expect(px.isActive).toBe(true);
      expect(py.isActive).toBe(true);
      expect(mine).toMatchObject({ approvalStatus: 'PENDING_REVIEW', fulfilment: 'MERCHANT', pancakeLinkCode: y.code });
      expect(links).toBe(0);
    };

    const stale = admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true, undefined, seenOn(shown));
    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    await expect(stale).rejects.toMatchObject({
      response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED, message: expect.stringContaining('Hãy xem lại') }),
    });
    await nothingMoved();
    // Màn duyệt mở lúc dòng chưa có mã ('' = không có mã) mà đối tác đã thêm mã sau đó: vẫn 409, không duyệt mã admin chưa xem.
    await expect(admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true, undefined, { pancakeCode: '' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED }),
    });
    await nothingMoved();
    // Xác nhận chuyển gắn với sản phẩm admin đã xem: đúng mã mới nhưng xác nhận cho sản phẩm X → 409.
    await expect(
      admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true, undefined, { pancakeCode: y.code, takeoverProductId: x.product.id }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: PANCAKE_TAKEOVER_CHANGED }) });
    await nothingMoved();

    // Tải lại: màn duyệt hiện sản phẩm Y sẽ bị chuyển; xác nhận đúng Y thì mới chuyển.
    const reloaded = await pendingRow(p.id);
    expect(reloaded).toMatchObject({ pancakeLinkCode: y.code, pancakeLink: { state: 'TAKEOVER', origin: { id: y.product.id } } });
    await approveShown(p.id);
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: y.variation.id } })).productId).toBe(p.id);
    expect((await prisma.variation.findUniqueOrThrow({ where: { id: x.variation.id } })).productId).toBe(x.product.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: x.product.id } })).isActive).toBe(true);
  });

  it('(i) cùng mã nhưng biến thể đã sang sản phẩm đang bán khác sau khi admin xem → xác nhận cũ không còn hiệu lực (409)', async () => {
    const x = await tubuProduct();
    const z = await tubuProduct();
    const { owner } = await merchantStore();
    const p = await requestLink(owner, x.code);
    const shown = await pendingRow(p.id);
    await prisma.variation.update({ where: { id: x.variation.id }, data: { productId: z.product.id } });

    await expect(admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true, undefined, seenOn(shown))).rejects.toMatchObject({
      response: expect.objectContaining({ code: PANCAKE_TAKEOVER_CHANGED }),
    });
    const [v, mine, pz] = await Promise.all([
      prisma.variation.findUniqueOrThrow({ where: { id: x.variation.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
      prisma.product.findUniqueOrThrow({ where: { id: z.product.id } }),
    ]);
    expect(v.productId).toBe(z.product.id);
    expect(mine.approvalStatus).toBe('PENDING_REVIEW');
    expect(pz.isActive).toBe(true);
  });

  it('(j) client bỏ trống mã và sản phẩm đã xem: duyệt theo mã đang có lúc bấm (vẫn phải tích xác nhận chuyển), ghi cảnh báo nêu admin, liên kết và mã', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const x = await tubuProduct();
      const y = await tubuProduct();
      const { owner } = await merchantStore();
      const p = await requestLink(owner, x.code);
      await merchant.updateProduct(owner.id, p.id, { pancakeCode: y.code });

      await expect(admin.reviewMerchantProduct('admin-it', p.id, true)).rejects.toMatchObject({
        response: expect.objectContaining({ code: PANCAKE_TAKEOVER_UNCONFIRMED }),
      });
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: y.variation.id } })).productId).toBe(y.product.id);

      await admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true);
      const [vx, vy, mine, link] = await Promise.all([
        prisma.variation.findUniqueOrThrow({ where: { id: x.variation.id } }),
        prisma.variation.findUniqueOrThrow({ where: { id: y.variation.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
        prisma.merchantPancakeLink.findFirstOrThrow({ where: { productId: p.id, unlinkedAt: null } }),
      ]);
      expect(vx.productId).toBe(x.product.id);
      expect(vy.productId).toBe(p.id);
      expect(mine).toMatchObject({ approvalStatus: 'APPROVED', fulfilment: 'TUBU', pancakeLinkCode: y.code });
      expect(link).toMatchObject({ variationId: y.variation.id, originProductId: y.product.id, takeover: true, linkedBy: 'admin-it' });
      const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('không gửi'));
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual(expect.stringContaining('admin-it'));
      expect(msgs[0]).toEqual(expect.stringContaining(link.id));
      expect(msgs[0]).toEqual(expect.stringContaining(y.code));
    } finally {
      warn.mockRestore();
    }
  });

  it('(k) client bỏ trống mã đã xem, duyệt chồng với đối tác đổi/bỏ mã → chỉ liên kết đúng mã đang nằm trên sản phẩm lúc duyệt thành công, không bao giờ lệch mã hay chuyển hai biến thể', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      for (let round = 0; round < 6; round++) {
        const a = await tubuProduct();
        const b = await tubuProduct();
        const { owner } = await merchantStore();
        const p = await requestLink(owner, a.code);
        const approve = () => admin.reviewMerchantProduct('admin-it', p.id, true, undefined, true);
        const change = round % 2 === 0 ? { pancakeCode: b.code } : { pancakeCode: null };
        const results = await Promise.allSettled(
          round % 3 === 0 ? [merchant.updateProduct(owner.id, p.id, change), approve()] : [approve(), merchant.updateProduct(owner.id, p.id, change)],
        );
        const s = summarize(results);
        console.log('[k] round=%d errors=%j', round, s.errors);
        const [mine, open, va, vb] = await Promise.all([
          prisma.product.findUniqueOrThrow({ where: { id: p.id } }),
          prisma.merchantPancakeLink.findMany({ where: { productId: p.id, unlinkedAt: null } }),
          prisma.variation.findUniqueOrThrow({ where: { id: a.variation.id } }),
          prisma.variation.findUniqueOrThrow({ where: { id: b.variation.id } }),
        ]);
        const moved = [va, vb].filter((v) => v.productId === p.id);
        expect(moved.length).toBeLessThanOrEqual(1);
        expect(open).toHaveLength(moved.length);
        if (moved.length === 1) {
          expect(mine).toMatchObject({ fulfilment: 'TUBU', approvalStatus: 'APPROVED', pancakeLinkCode: moved[0]!.pancakeId });
          expect(open[0]).toMatchObject({ variationId: moved[0]!.id });
        }
        for (const r of s.rejected) expect([BadRequestException, ConflictException].some((E) => r.reason instanceof E)).toBe(true);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
