import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PublicImageService } from '../../src/modules/catalog/public-image.service';
import { publicImageVersion } from '../../src/common/public-image';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createUser, randCode, warmPool } from './helpers';

const PNG_A = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAA=';

/** Endpoint ảnh trên Postgres thật: truy vấn `images[n]` tham số hoá và quyền phát theo trạng thái duyệt. */
describe('PublicImageService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: PublicImageService;
  let merchant: MerchantService;
  const ids: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [PublicImageService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(PublicImageService);
    merchant = new MerchantService(prisma, {} as OrderStatusService, { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await moduleRef?.close();
  });

  const product = async (data: Record<string, unknown>) => {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `itimg-${tag}`, brand: 'IT', slug: `itimg-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 1000, images: [PNG_A, PNG_B], ...data },
    });
    ids.push(p.id);
    return p;
  };

  it('đọc đúng phần tử theo ô, thumb rơi về ảnh đầu khi thumbnail không phải base64', async () => {
    const p = await product({ thumbnail: `/public-image/product/x/0?v=1` });
    expect((await svc.get('product', p.id, '1', publicImageVersion('product', p.id, 1, PNG_B))).versionOk).toBe(true);
    expect((await svc.get('product', p.id, '0', publicImageVersion('product', p.id, 0, PNG_A))).versionOk).toBe(true);
    expect((await svc.get('product', p.id, 'thumb', publicImageVersion('product', p.id, 'thumb', PNG_A))).versionOk).toBe(true);
    await expect(svc.get('product', p.id, '2', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chưa từng được duyệt (chờ duyệt lần đầu, bị từ chối) thì không phát; từng được duyệt rồi chờ duyệt lại thì vẫn phát', async () => {
    const pending = await product({ approvalStatus: 'PENDING_REVIEW' });
    const rejected = await product({ approvalStatus: 'REJECTED', approvedAt: new Date() });
    const again = await product({ approvalStatus: 'PENDING_REVIEW', approvedAt: new Date() });
    for (const slot of ['0', 'thumb']) {
      await expect(svc.get('product', pending.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.get('product', rejected.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect((await svc.get('product', again.id, slot, undefined)).mime).toBe('image/png');
    }
  });

  /** Sản phẩm của gian hàng đối tác, từng được duyệt, đang chờ liên kết mã Pancake. */
  async function partnerProduct(status: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED', extra: Record<string, unknown> = {}) {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `itimg-${tag}`, title: `Shop ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 } });
    const p = await product({
      storefrontId: store.id,
      fulfilment: 'MERCHANT',
      approvalStatus: status,
      approvedAt: new Date(),
      isActive: false,
      pancakeLinkCode: `itimg-pk-${tag}`,
      images: [PNG_A],
      thumbnail: PNG_A,
      variations: { create: { sku: `itimg-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 1000, stock: 5 } },
      ...extra,
    });
    return { owner, p };
  }

  it('mở bán lại (xin liên kết) kèm đổi ảnh: ảnh mới chưa duyệt không phát, ảnh cũ cũng không phát tới khi admin duyệt', async () => {
    const { owner, p } = await partnerProduct('APPROVED');
    expect((await svc.get('product', p.id, '0', undefined)).mime).toBe('image/png');
    await merchant.updateProduct(owner.id, p.id, { isActive: true, images: [PNG_B], thumbnail: PNG_B });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ approvalStatus: 'PENDING_REVIEW', approvedAt: null });
    for (const slot of ['0', 'thumb']) await expect(svc.get('product', p.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mở bán lại không đổi ảnh: vẫn phát ảnh đã duyệt', async () => {
    const { owner, p } = await partnerProduct('APPROVED');
    await merchant.updateProduct(owner.id, p.id, { isActive: true });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).approvalStatus).toBe('PENDING_REVIEW');
    expect((await svc.get('product', p.id, '0', undefined)).mime).toBe('image/png');
  });

  it('bị từ chối (dù từng duyệt) thì không phát; đang chờ duyệt lại mà giữ ảnh cũ thì vẫn phát', async () => {
    const rejected = await partnerProduct('REJECTED');
    for (const slot of ['0', 'thumb']) await expect(svc.get('product', rejected.p.id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
    const pending = await partnerProduct('PENDING_REVIEW');
    await merchant.updateProduct(pending.owner.id, pending.p.id, { name: 'Tên mới' });
    expect((await svc.get('product', pending.p.id, '0', undefined)).mime).toBe('image/png');
    await merchant.updateProduct(pending.owner.id, pending.p.id, { images: [PNG_B], thumbnail: PNG_B });
    await expect(svc.get('product', pending.p.id, '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });
});
