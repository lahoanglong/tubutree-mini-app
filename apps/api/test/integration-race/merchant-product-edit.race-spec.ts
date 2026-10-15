import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { OpsInboxService } from '../../src/modules/ops/ops-inbox.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R3-MERCHANT-4 trên Postgres THẬT: sửa tên/mô tả/ảnh của sản phẩm đang bán lưu thành bản chờ duyệt; sản phẩm giữ nguyên
 * nội dung, trạng thái APPROVED, isActive, mã Pancake suốt thời gian chờ nên trang bán và giỏ khách không đứt.
 */
describe('Merchant product edit draft (real Postgres)', () => {
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

  async function liveProduct() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itpe-${tag}`, title: `Shop IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        approvalStatus: 'APPROVED',
        brand: 'IT',
        slug: `itpe-${tag}`,
        name: `Nến IT ${tag}`,
        description: 'Mô tả đang bán',
        shortDesc: 'Ngắn đang bán',
        images: ['https://cdn.example/old.jpg'],
        thumbnail: 'https://cdn.example/old.jpg',
        basePrice: 90_000,
        variations: { create: { sku: `itpe-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 90_000, stock: 20 } },
      },
      include: { variations: true },
    });
    return { owner, store, product };
  }

  /** Phiên bản bản sửa mà dòng "Bản sửa chờ duyệt" mang tới màn admin: admin duyệt/từ chối đúng bản họ đã xem. */
  async function viewedVersion(productId: string) {
    const row = (await admin.listPendingMerchantProducts(1, 500)).data.find((r) => r.id === productId)!;
    expect(row.isEdit).toBe(true);
    return row.editVersion!;
  }

  /**
   * Tin do admin duyệt/từ chối gửi đi. Bỏ tin báo admin "có bản sửa mới" (OPS_MERCHANT_PRODUCT_EDIT_PENDING) vì nó tới mọi
   * ADMIN đang có trong DB — số admin do các race spec khác tạo trước tuỳ thứ tự chạy.
   */
  function reviewNotices() {
    return notify.mock.calls.map((c) => c[1] as string).filter((t) => t !== 'OPS_MERCHANT_PRODUCT_EDIT_PENDING');
  }

  async function expectUntouched(productId: string, liveName: string, rejectReason: string | null = null) {
    const after = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(after).toMatchObject({ approvalStatus: 'APPROVED', isActive: true, name: liveName, rejectReason });
  }

  it('(a) sửa tên/mô tả/ảnh: sản phẩm vẫn APPROVED + isActive + nội dung cũ; giá/tồn đổi cùng lúc có hiệu lực ngay; sửa tiếp gộp vào cùng một bản chờ', async () => {
    const { owner, product } = await liveProduct();
    await merchant.updateProduct(owner.id, product.id, { name: 'Tên mới', basePrice: 95_000, stock: 18 });
    await merchant.updateProduct(owner.id, product.id, { description: 'Mô tả mới', images: ['https://cdn.example/new.jpg'], thumbnail: 'https://cdn.example/new.jpg' });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true, variations: true } });
    expect(after).toMatchObject({
      approvalStatus: 'APPROVED',
      isActive: true,
      name: product.name,
      description: 'Mô tả đang bán',
      thumbnail: 'https://cdn.example/old.jpg',
      basePrice: 95_000,
    });
    expect(after.variations[0]).toMatchObject({ retailPrice: 95_000, stock: 18 });
    expect(after.editDraft).toMatchObject({
      name: 'Tên mới',
      description: 'Mô tả mới',
      shortDesc: 'Ngắn đang bán',
      images: ['https://cdn.example/new.jpg'],
      thumbnail: 'https://cdn.example/new.jpg',
    });
    expect(await prisma.productEditDraft.count({ where: { productId: product.id } })).toBe(1);
  });

  it('(b) hàng chờ duyệt và số "Việc cần xử lý" đều đếm bản sửa; duyệt xong thì ghi đè nội dung, xoá bản chờ, hàng chờ hết dòng này', async () => {
    const { owner, product } = await liveProduct();
    await merchant.updateProduct(owner.id, product.id, { name: 'Tên đã duyệt' });
    const inbox = new OpsInboxService(prisma, {
      countOverdue: async () => 0,
      countStoresToSettle: async () => 0,
    } as unknown as MerchantFulfilmentService);
    const count = async () => (await inbox.counts({ role: 'ADMIN' })).items.find((i) => i.key === 'merchantProducts')!.count;

    const pending = await admin.listPendingMerchantProducts(1, 500);
    const row = pending.data.find((r) => r.id === product.id)!;
    expect(row).toMatchObject({ isEdit: true, name: 'Tên đã duyệt', live: { name: product.name } });
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(1);

    await admin.reviewMerchantProduct('admin-it', product.id, true, undefined, false, row.editVersion!);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true } });
    expect(after).toMatchObject({ name: 'Tên đã duyệt', approvalStatus: 'APPROVED', isActive: true });
    expect(after.editDraft).toBeNull();
    expect(await count()).toBe(before - 1);
    expect((await admin.listPendingMerchantProducts(1, 500)).data.some((r) => r.id === product.id)).toBe(false);
    expect(notify).toHaveBeenCalledWith(
      (await prisma.storefront.findUniqueOrThrow({ where: { id: product.storefrontId! } })).ownerUserId,
      'MERCHANT_PRODUCT_EDIT_APPROVED',
      expect.objectContaining({ product_name: 'Tên đã duyệt' }),
    );
  });

  it('(c) hai admin duyệt/từ chối cùng một bản sửa: đúng 1 bên thắng, bên kia nhận lỗi tải lại, không áp nội dung hai lần', async () => {
    for (let round = 0; round < 4; round++) {
      const { owner, product } = await liveProduct();
      await merchant.updateProduct(owner.id, product.id, { name: `Tên mới ${round}` });
      const version = await viewedVersion(product.id);
      const results = await Promise.allSettled([
        admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, version),
        admin.reviewMerchantProduct('admin-b', product.id, false, 'Không đạt', false, version),
      ]);
      const s = summarize(results);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true } });
      console.log('[c] round=%d fulfilled=%d errors=%j name=%s', round, s.fulfilled.length, s.errors, after.name);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected[0]!.reason).toBeInstanceOf(ConflictException);
      expect(after.editDraft).toBeNull();
      expect(after.approvalStatus).toBe('APPROVED');
      expect(after.isActive).toBe(true);
      const approved = results[0].status === 'fulfilled';
      expect(after.name).toBe(approved ? `Tên mới ${round}` : product.name);
      expect(after.rejectReason).toBe(approved ? null : 'Không đạt');
    }
  });

  it('(d) admin duyệt chồng với đối tác sửa tiếp: không bao giờ mất chữ đối tác vừa gõ (hoặc nằm ở nội dung đang bán, hoặc ở bản chờ mới)', async () => {
    for (let round = 0; round < 6; round++) {
      const { owner, product } = await liveProduct();
      await merchant.updateProduct(owner.id, product.id, { name: `Bản một ${round}` });
      const version = await viewedVersion(product.id);
      const results = await Promise.allSettled([
        admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, version),
        merchant.updateProduct(owner.id, product.id, { description: `Mô tả bản hai ${round}` }),
      ]);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { editDraft: true } });
      const s = summarize(results);
      console.log('[d] round=%d fulfilled=%d errors=%j live=%s/%s draft=%s/%s', round, s.fulfilled.length, s.errors, after.name, after.description, after.editDraft?.name, after.editDraft?.description);
      for (const r of s.rejected) expect([BadRequestException, ConflictException].some((E) => r.reason instanceof E)).toBe(true);
      expect(after.approvalStatus).toBe('APPROVED');
      expect(after.isActive).toBe(true);
      const second = `Mô tả bản hai ${round}`;
      expect(after.description === second || after.editDraft?.description === second).toBe(true);
      expect(after.name === `Bản một ${round}` || after.editDraft?.name === `Bản một ${round}`).toBe(true);
    }
  });

  it('(f) admin bấm lại trên dòng đã cũ: từ chối hai lần, duyệt rồi từ chối, từ chối rồi duyệt đều 409 và sản phẩm vẫn APPROVED + isActive, không gỡ liên kết', async () => {
    const { owner, product } = await liveProduct();
    notify.mockClear();
    await merchant.updateProduct(owner.id, product.id, { name: 'Tên chờ 1' });
    const v1 = await viewedVersion(product.id);
    await admin.reviewMerchantProduct('admin-a', product.id, false, 'Không đạt', false, v1);
    await expect(admin.reviewMerchantProduct('admin-a', product.id, false, 'Không đạt', false, v1)).rejects.toBeInstanceOf(ConflictException);
    await expect(admin.reviewMerchantProduct('admin-b', product.id, true, undefined, false, v1)).rejects.toBeInstanceOf(ConflictException);
    await expectUntouched(product.id, product.name, 'Không đạt');
    expect(reviewNotices()).toEqual(['MERCHANT_PRODUCT_EDIT_REJECTED']);

    await merchant.updateProduct(owner.id, product.id, { name: 'Tên chờ 2' });
    const v2 = await viewedVersion(product.id);
    await admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, v2);
    await expect(admin.reviewMerchantProduct('admin-b', product.id, false, 'Không đạt', false, v2)).rejects.toBeInstanceOf(ConflictException);
    await expect(admin.reviewMerchantProduct('admin-b', product.id, true, undefined, false, v2)).rejects.toBeInstanceOf(ConflictException);
    await expectUntouched(product.id, 'Tên chờ 2');
    expect(reviewNotices()).toEqual(['MERCHANT_PRODUCT_EDIT_REJECTED', 'MERCHANT_PRODUCT_EDIT_APPROVED']);
  });

  it('(g) đối tác sửa rồi sửa lại đúng nội dung đang bán (bản chờ bị xoá), admin bấm trên dòng cũ: 409, sản phẩm vẫn bán', async () => {
    const { owner, product } = await liveProduct();
    notify.mockClear();
    await merchant.updateProduct(owner.id, product.id, { name: 'Tên tạm' });
    const version = await viewedVersion(product.id);
    await merchant.updateProduct(owner.id, product.id, { name: product.name });
    expect(await prisma.productEditDraft.count({ where: { productId: product.id } })).toBe(0);
    await expect(admin.reviewMerchantProduct('admin-a', product.id, false, 'Không đạt', false, version)).rejects.toBeInstanceOf(ConflictException);
    await expect(admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, version)).rejects.toBeInstanceOf(ConflictException);
    await expectUntouched(product.id, product.name);
    expect(reviewNotices()).toEqual([]);
  });

  it('(h) dòng cũ không mang phiên bản (client cũ, hoặc dòng chờ duyệt lần đầu đã được xử lý) không bao giờ đổi sản phẩm APPROVED', async () => {
    const { owner, product } = await liveProduct();
    notify.mockClear();
    await expect(admin.reviewMerchantProduct('admin-a', product.id, false, 'Không đạt')).rejects.toBeInstanceOf(ConflictException);
    await merchant.updateProduct(owner.id, product.id, { name: 'Tên chờ' });
    await expect(admin.reviewMerchantProduct('admin-a', product.id, false, 'Không đạt')).rejects.toBeInstanceOf(ConflictException);
    await expect(admin.reviewMerchantProduct('admin-a', product.id, true)).rejects.toBeInstanceOf(ConflictException);
    await expectUntouched(product.id, product.name);
    expect(await prisma.productEditDraft.count({ where: { productId: product.id } })).toBe(1);
    expect(reviewNotices()).toEqual([]);
  });

  it('(i) đối tác sửa tiếp giữa lúc admin mở danh sách và bấm: bản mới không bị duyệt khi chưa ai xem, admin tải lại rồi duyệt đúng bản mới', async () => {
    const { owner, product } = await liveProduct();
    await merchant.updateProduct(owner.id, product.id, { name: 'Bản một' });
    const seen = await viewedVersion(product.id);
    await new Promise((r) => setTimeout(r, 5));
    await merchant.updateProduct(owner.id, product.id, { name: 'Bản hai' });
    await expect(admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, seen)).rejects.toBeInstanceOf(ConflictException);
    await expectUntouched(product.id, product.name);
    await admin.reviewMerchantProduct('admin-a', product.id, true, undefined, false, await viewedVersion(product.id));
    await expectUntouched(product.id, 'Bản hai');
  });

  it('(e) xoá sản phẩm kéo theo xoá bản chờ (cascade), không để bản mồ côi', async () => {
    const { owner, product } = await liveProduct();
    await merchant.updateProduct(owner.id, product.id, { name: 'Sẽ bị xoá' });
    expect(await prisma.productEditDraft.count({ where: { productId: product.id } })).toBe(1);
    await prisma.variation.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    expect(await prisma.productEditDraft.count({ where: { productId: product.id } })).toBe(0);
  });
});
