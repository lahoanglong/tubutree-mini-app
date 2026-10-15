import { ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { MERCHANT_PRODUCT_ALREADY_REVIEWED, MERCHANT_PRODUCT_CONTENT_CHANGED } from '../../src/modules/merchant/merchant-product-review';
import { PANCAKE_TAKEOVER_UNCONFIRMED } from '../../src/modules/merchant/merchant-pancake-link';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R5-PARTNER-1/4/5 trên Postgres THẬT: dòng sản phẩm chờ duyệt lần đầu chỉ duyệt/từ chối được khi vẫn đúng như admin đã xem
 * (`updatedAt` lúc tải danh sách), admin thứ hai bấm trên sản phẩm đã xử lý nhận 409, và đối tác không thể ghi nội dung thẳng lên
 * sản phẩm vừa được duyệt giữa lúc đọc và lúc ghi.
 */
describe('Duyệt sản phẩm đối tác chờ duyệt lần đầu đúng phiên bản admin đã xem (real Postgres)', () => {
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

  beforeEach(() => notify.mockClear());

  async function pendingProduct(tag = randCode(8).toLowerCase()) {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itrv-${tag}`, title: `Shop IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await merchant.createProduct(owner.id, {
      name: `Khăn tre ${tag}`,
      description: 'Mô tả ban đầu',
      basePrice: 80_000,
      stock: 10,
    });
    return { owner, store, product };
  }

  /** Dòng admin thấy sau khi tải danh sách: tên đã xem và phiên bản gửi lại khi bấm. */
  async function viewedRow(productId: string) {
    const row = (await admin.listPendingMerchantProducts(1, 500)).data.find((r) => r.id === productId)!;
    expect(row.isEdit).toBe(false);
    return { name: row.name, updatedAt: row.updatedAt.toISOString() };
  }

  /** Tin gửi đối tác: bỏ tin OPS_* báo admin vì nó tới mọi ADMIN có trong DB (số admin do các race spec khác tạo tuỳ thứ tự chạy). */
  const partnerNotices = () => notify.mock.calls.map((c) => c[1] as string).filter((t) => !t.startsWith('OPS_'));

  const row = (productId: string) => prisma.product.findUniqueOrThrow({ where: { id: productId } });

  it('hàng chờ duyệt mang updatedAt của sản phẩm để màn admin gửi lại khi bấm', async () => {
    const { product } = await pendingProduct();
    const seen = await viewedRow(product.id);
    expect(seen.updatedAt).toBe((await row(product.id)).updatedAt.toISOString());
  });

  it('đối tác sửa tên/mô tả/ảnh sau khi admin tải danh sách: duyệt bị 409, nội dung mới chưa lên sàn; tải lại rồi duyệt đúng bản mới', async () => {
    const { owner, product } = await pendingProduct();
    const seen = await viewedRow(product.id);
    await new Promise((r) => setTimeout(r, 5));
    await merchant.updateProduct(owner.id, product.id, {
      name: 'Khăn tre — CHỮA BÁCH BỆNH',
      description: 'Quảng cáo sai sự thật',
      images: ['https://cdn.example/vi-pham.jpg'],
      thumbnail: 'https://cdn.example/vi-pham.jpg',
    });

    const res = admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt });
    await expect(res).rejects.toBeInstanceOf(ConflictException);
    await expect(res).rejects.toMatchObject({ response: expect.objectContaining({ code: MERCHANT_PRODUCT_CONTENT_CHANGED }) });
    expect(await row(product.id)).toMatchObject({ approvalStatus: 'PENDING_REVIEW', name: 'Khăn tre — CHỮA BÁCH BỆNH' });
    expect(partnerNotices()).not.toContain('MERCHANT_PRODUCT_APPROVED');

    await expect(
      admin.reviewMerchantProduct('admin-a', product.id, false, 'Nội dung cũ', false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: MERCHANT_PRODUCT_CONTENT_CHANGED }) });

    const reloaded = await viewedRow(product.id);
    expect(reloaded.name).toBe('Khăn tre — CHỮA BÁCH BỆNH');
    await admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, undefined, { pancakeCode: '', updatedAt: reloaded.updatedAt });
    expect(await row(product.id)).toMatchObject({ approvalStatus: 'APPROVED', name: 'Khăn tre — CHỮA BÁCH BỆNH' });
  });

  it('không gửi phiên bản (client khác màn duyệt): duyệt như trước và ghi cảnh báo nêu admin và sản phẩm', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { owner, product } = await pendingProduct();
      await merchant.updateProduct(owner.id, product.id, { name: 'Tên đã sửa' });
      await admin.reviewMerchantProduct('admin-legacy', product.id, true);
      expect(await row(product.id)).toMatchObject({ approvalStatus: 'APPROVED', name: 'Tên đã sửa' });
      const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('expectedUpdatedAt'));
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain('admin-legacy');
      expect(msgs[0]).toContain(product.id);
    } finally {
      warn.mockRestore();
    }
  });

  it('hai admin cùng duyệt hoặc duyệt rồi từ chối: đúng một bên thắng, bên kia 409 MERCHANT_PRODUCT_ALREADY_REVIEWED, sản phẩm giữ kết quả của bên thắng', async () => {
    for (let round = 0; round < 4; round++) {
      const { product } = await pendingProduct();
      const seen = await viewedRow(product.id);
      const click = (adminId: string, approve: boolean) =>
        admin.reviewMerchantProduct(adminId, product.id, approve, approve ? undefined : 'Không đạt', false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt });
      const results = await Promise.allSettled([click('admin-a', true), click('admin-b', round % 2 === 0)]);
      const s = summarize(results);
      console.log('[two admins] round=%d fulfilled=%d errors=%j', round, s.fulfilled.length, s.errors);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected[0]!.reason).toBeInstanceOf(ConflictException);
      expect((s.rejected[0]!.reason as ConflictException).getResponse()).toMatchObject({ code: MERCHANT_PRODUCT_ALREADY_REVIEWED });
      const after = await row(product.id);
      expect(after.approvalStatus).toBe(results[0].status === 'fulfilled' ? 'APPROVED' : after.approvalStatus);
      const winnerApproved = s.fulfilled[0]!.value.approvalStatus === 'APPROVED';
      expect(after.approvalStatus).toBe(winnerApproved ? 'APPROVED' : 'REJECTED');
    }
    notify.mockClear();
    const { product } = await pendingProduct();
    const seen = await viewedRow(product.id);
    await admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt });
    await expect(
      admin.reviewMerchantProduct('admin-b', product.id, false, 'Muộn rồi', false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: MERCHANT_PRODUCT_ALREADY_REVIEWED, message: expect.stringContaining('duyệt') }) });
    expect(await row(product.id)).toMatchObject({ approvalStatus: 'APPROVED', rejectReason: null });
    expect(partnerNotices()).toEqual(['MERCHANT_PRODUCT_APPROVED']);
  });

  it('đối tác đã đọc sản phẩm (đang chờ duyệt) mà admin duyệt xong rồi mới tới lúc ghi: 409, nội dung đối tác gõ không ghi thẳng lên sản phẩm đã APPROVED', async () => {
    const { owner, product } = await pendingProduct();
    const seen = await viewedRow(product.id);
    // Đối tác đọc xong (còn PENDING_REVIEW) thì dừng; admin duyệt đúng bản đã xem; rồi đối tác mới ghi.
    let partnerRead!: () => void;
    const read = new Promise<void>((r) => (partnerRead = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = prisma.product.findFirst.bind(prisma.product);
    const spy = jest.spyOn(prisma.product as never, 'findFirst').mockImplementation((async (...args: Parameters<typeof original>) => {
      const found = await original(...args);
      partnerRead();
      await gate;
      return found;
    }) as never);
    try {
      const patch = merchant.updateProduct(owner.id, product.id, { name: 'Tên chen vào sau khi duyệt', description: 'Mô tả chưa ai xem' });
      const patched = patch.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await read;
      await admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt });
      release();
      const outcome = await patched;
      const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true } });
      expect(after.approvalStatus).toBe('APPROVED');
      expect({ name: after.name, description: after.description }).toEqual({ name: seen.name, description: 'Mô tả ban đầu' });
      expect(outcome.ok).toBe(false);
      expect((outcome as { error: unknown }).error).toBeInstanceOf(ConflictException);
    } finally {
      spy.mockRestore();
    }
  });

  it('20 lần đối tác sửa chồng với admin duyệt: sản phẩm đã APPROVED luôn mang đúng nội dung admin đã xem; nội dung mới chỉ ở bản chờ hoặc chặn bằng 409', async () => {
    let approvedRounds = 0;
    for (let round = 0; round < 20; round++) {
      const { owner, product } = await pendingProduct();
      const seen = await viewedRow(product.id);
      const results = await Promise.allSettled([
        admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, undefined, { pancakeCode: '', updatedAt: seen.updatedAt }),
        merchant.updateProduct(owner.id, product.id, { name: `Tên mới ${round}` }),
      ]);
      const s = summarize(results);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true } });
      if (after.approvalStatus === 'APPROVED') {
        approvedRounds++;
        expect(after.name).toBe(seen.name);
        expect(after.editDraft === null || after.editDraft.name === `Tên mới ${round}`).toBe(true);
      } else {
        expect(after.approvalStatus).toBe('PENDING_REVIEW');
        expect(after.name).toBe(`Tên mới ${round}`);
        expect(results[0].status).toBe('rejected');
      }
      for (const r of s.rejected) expect(r.reason).toBeInstanceOf(ConflictException);
    }
    console.log('[20 rounds] approved=%d', approvedRounds);
  });

  it('R5-PARTNER-2: đối tác đổi mã Pancake khi đang chờ duyệt → giá của sản phẩm và biến thể chờ liên kết theo Pancake của mã mới, thẻ duyệt của admin hiện giá đúng', async () => {
    const tag = randCode(6);
    const tubuVariation = (suffix: string, retail: number, sale: number | null) =>
      prisma.product.create({
        data: {
          brand: 'IT',
          slug: `itrv-${suffix}-${tag.toLowerCase()}`,
          name: `Tinh dầu ${suffix} ${tag}`,
          description: 'IT',
          basePrice: retail,
          pancakeId: `itrv-pk-${suffix}-${tag}`,
          isActive: false,
          variations: { create: { sku: `ITRV-${suffix}-${tag}`, name: 'Chai', attributes: {}, retailPrice: retail, salePrice: sale, stock: 9, pancakeId: `ITRV-${suffix}-${tag}` } },
        },
      });
    await tubuVariation('A', 120_000, null);
    await tubuVariation('B', 70_000, 60_000);
    const owner = await createUser(prisma, { role: 'DEALER' });
    await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itrv-p2-${tag.toLowerCase()}`, title: `Shop ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await merchant.createProduct(owner.id, {
      name: `Dầu ${tag}`,
      description: 'Tubu giao hộ',
      basePrice: 1,
      tubuFulfils: true,
      pancakeCode: `ITRV-A-${tag}`,
    });
    expect(product).toMatchObject({ basePrice: 120_000, salePrice: null });

    await merchant.updateProduct(owner.id, product.id, { pancakeCode: `ITRV-B-${tag}` });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variations: true } });
    expect(after).toMatchObject({ approvalStatus: 'PENDING_REVIEW', pancakeLinkCode: `ITRV-B-${tag}`, basePrice: 70_000, salePrice: 60_000 });
    expect(after.variations[0]).toMatchObject({ retailPrice: 70_000, salePrice: 60_000 });
    const card = (await admin.listPendingMerchantProducts(1, 500)).data.find((r) => r.id === product.id)!;
    expect(card).toMatchObject({ basePrice: 70_000, salePrice: 60_000 });
  });

  it('expectedTakeoverProductId rỗng coi như không gửi: tích xác nhận thì chuyển sản phẩm đang giữ mã, chưa tích thì vẫn 409 PANCAKE_TAKEOVER_UNCONFIRMED', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const tag = randCode(6);
      const live = await prisma.product.create({
        data: {
          brand: 'IT',
          slug: `itrv-live-${tag.toLowerCase()}`,
          name: `Muối tre ${tag}`,
          description: 'IT',
          basePrice: 50_000,
          pancakeId: `itrv-pk-${tag}`,
          variations: { create: { sku: `ITRV-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 50_000, stock: 9, pancakeId: `ITRV-VAR-${tag}` } },
        },
      });
      const { owner, product } = await pendingProduct();
      await prisma.product.update({ where: { id: product.id }, data: { pancakeLinkCode: `ITRV-VAR-${tag}` } });
      const seen = await viewedRow(product.id);
      const click = (confirm: boolean) =>
        admin.reviewMerchantProduct('admin-a', product.id, true, undefined, confirm, undefined, {
          pancakeCode: `ITRV-VAR-${tag}`,
          takeoverProductId: '',
          updatedAt: seen.updatedAt,
        });
      await expect(click(false)).rejects.toMatchObject({ response: expect.objectContaining({ code: PANCAKE_TAKEOVER_UNCONFIRMED }) });
      expect(await row(product.id)).toMatchObject({ approvalStatus: 'PENDING_REVIEW' });
      await click(true);
      expect(await row(product.id)).toMatchObject({ approvalStatus: 'APPROVED', fulfilment: 'TUBU' });
      expect(await prisma.merchantPancakeLink.findFirstOrThrow({ where: { productId: product.id } })).toMatchObject({ originProductId: live.id, takeover: true });
      expect(owner.id).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });
});
