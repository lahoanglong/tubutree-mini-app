import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { PublicImageService } from '../../src/modules/catalog/public-image.service';
import { createUser, randCode, warmPool } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_DRAFT = 'data:image/png;base64,iVBORw0KGgoAAAA=';

/** Danh sách của admin không nhúng ảnh base64; ảnh mở qua đường dẫn, và quyền xem ảnh đúng với từng loại đường dẫn. */
describe('Admin image payload (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;
  let reviews: ReviewsService;
  let publicImages: PublicImageService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    reviews = new ReviewsService(prisma, none, none);
    publicImages = new PublicImageService(prisma);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('L3-03 — danh sách đánh giá', () => {
    async function reviewWithImages(isVisible: boolean) {
      const tag = randCode(8);
      const p = await prisma.product.create({
        data: { pancakeId: `itip-${tag}`, brand: 'IT', slug: `itip-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 1000, images: [] },
      });
      const u = await createUser(prisma, { fullName: `Khách ${tag}` });
      const order = await prisma.order.create({
        data: { code: `ITIP${Date.now()}${randCode(4)}`, userId: u.id, type: 'RETAIL', status: 'DELIVERED', subtotal: 1000, total: 1000, paymentMethod: 'COD', paymentStatus: 'PAID', shippingAddress: {} },
      });
      return prisma.review.create({
        data: { userId: u.id, productId: p.id, orderId: order.id, rating: 5, comment: `ok ${tag}`, isVisible, images: [PNG, 'https://cdn.example/x.jpg'] },
      });
    }

    it('đánh giá đang hiện: JSON không còn data:image, ảnh mở được qua route công khai', async () => {
      const r = await reviewWithImages(true);
      const row = (await admin.listReviews(1, 100, 'visible')).data.find((x) => x.id === r.id)!;
      expect(JSON.stringify(row)).not.toContain('data:image');
      expect(row.images[0]).toMatch(new RegExp(`^/reviews/${r.id}/images/0\\?v=[0-9a-f]{10}$`));
      expect(row.images[1]).toBe('https://cdn.example/x.jpg');
      expect((await reviews.getImage(r.id, 0)).mime).toBe('image/png');
    });

    it('đánh giá đã ẩn: route công khai 404, route admin vẫn phát ảnh', async () => {
      const r = await reviewWithImages(false);
      const row = (await admin.listReviews(1, 100, 'hidden')).data.find((x) => x.id === r.id)!;
      expect(JSON.stringify(row)).not.toContain('data:image');
      expect(row.images[0]).toMatch(new RegExp(`^/admin/reviews/${r.id}/images/0\\?v=[0-9a-f]{10}$`));
      await expect(reviews.getImage(r.id, 0)).rejects.toBeInstanceOf(NotFoundException);
      expect((await admin.reviewImage(r.id, 0)).mime).toBe('image/png');
      await expect(admin.reviewImage(r.id, 1)).rejects.toBeInstanceOf(NotFoundException);
      await expect(admin.reviewImage(r.id, 7)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('L3-02 — hàng chờ duyệt sản phẩm đối tác', () => {
    const slug = () => randCode(8).toLowerCase();
    async function partner() {
      const owner = await createUser(prisma, { role: 'DEALER' });
      const tag = slug();
      const store = await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `itip-${tag}`, title: `Shop ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 } });
      return store;
    }
    async function pending(storefrontId: string, data: Record<string, unknown> = {}) {
      const tag = slug();
      return prisma.product.create({
        data: {
          brand: 'IT', slug: `itip-p-${tag}`, name: `SP chờ ${tag}`, description: 'IT', basePrice: 1000, storefrontId, fulfilment: 'MERCHANT',
          approvalStatus: 'PENDING_REVIEW', images: [PNG, 'https://cdn.example/b.jpg'], thumbnail: PNG, ...data,
        },
      });
    }
    const rowOf = async (id: string) => (await admin.listPendingMerchantProducts(1, 50)).data.find((r) => r.id === id)!;

    it('sản phẩm chờ duyệt lần đầu: JSON không còn data:image, ảnh mở qua route admin, route công khai 404', async () => {
      const store = await partner();
      const p = await pending(store.id);
      const row = await rowOf(p.id);
      expect(JSON.stringify(row)).not.toContain('data:image');
      expect(row.thumbnail).toMatch(new RegExp(`^/admin/merchant-products/${p.id}/images/product/thumb\\?v=[0-9a-f]{10}$`));
      expect(row.images[0]).toMatch(new RegExp(`^/admin/merchant-products/${p.id}/images/product/0\\?v=[0-9a-f]{10}$`));
      expect(row.images[1]).toBe('https://cdn.example/b.jpg');
      expect((await admin.merchantProductImage(p.id, 'product', 0)).mime).toBe('image/png');
      expect((await admin.merchantProductImage(p.id, 'product', 'thumb')).mime).toBe('image/png');
      await expect(admin.merchantProductImage(p.id, 'draft', 0)).rejects.toBeInstanceOf(NotFoundException);
      await expect(admin.merchantProductImage(p.id, 'product', 1)).rejects.toBeInstanceOf(NotFoundException);
      await expect(publicImages.get('product', p.id, '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
      await expect(publicImages.get('product', p.id, 'thumb', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bản sửa chờ duyệt của sản phẩm đang bán: route admin phát ảnh nháp, route công khai chỉ phát ảnh đang bán', async () => {
      const store = await partner();
      const p = await pending(store.id, { approvalStatus: 'APPROVED', approvedAt: new Date(), images: [PNG], thumbnail: PNG });
      await prisma.productEditDraft.create({ data: { productId: p.id, name: 'Tên mới', description: 'Mô tả mới', images: [PNG_DRAFT], thumbnail: PNG_DRAFT } });
      const row = await rowOf(p.id);
      expect(row).toMatchObject({ isEdit: true, name: 'Tên mới' });
      expect(JSON.stringify(row)).not.toContain('data:image');
      expect(row.thumbnail).toContain(`/admin/merchant-products/${p.id}/images/draft/thumb?v=`);
      expect(row.live!.thumbnail).toContain(`/admin/merchant-products/${p.id}/images/product/thumb?v=`);
      const draft = await admin.merchantProductImage(p.id, 'draft', 0);
      const live = await admin.merchantProductImage(p.id, 'product', 0);
      expect(draft.data.equals(live.data)).toBe(false);
      const pub = await publicImages.get('product', p.id, '0', undefined);
      expect(pub.data.equals(live.data)).toBe(true);
      expect(pub.data.equals(draft.data)).toBe(false);
    });

    it('liên kết Pancake của cả trang tính đúng trên DB thật: nhận lại từ sản phẩm đang bán, và mã không tồn tại', async () => {
      const store = await partner();
      const tag = slug();
      const live = await prisma.product.create({
        data: {
          brand: 'IT', slug: `itip-live-${tag}`, name: `Đang bán ${tag}`, description: 'IT', basePrice: 50_000, pancakeId: `itip-pk-${tag}`,
          variations: { create: { sku: `ITIP-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 50_000, stock: 9, pancakeId: `ITIP-VAR-${tag}` } },
        },
      });
      const takeover = await pending(store.id, { pancakeLinkCode: `ITIP-VAR-${tag}` });
      const missing = await pending(store.id, { pancakeLinkCode: `ITIP-NONE-${tag}` });
      const plain = await pending(store.id);
      const page = (await admin.listPendingMerchantProducts(1, 50)).data;
      const byId = new Map(page.map((r) => [r.id, r]));
      expect(byId.get(takeover.id)!.pancakeLink).toMatchObject({ state: 'TAKEOVER', origin: { id: live.id }, variation: { stock: 9, retailPrice: 50_000 } });
      expect(byId.get(missing.id)!.pancakeLink).toMatchObject({ state: 'UNAVAILABLE', variation: null });
      expect(byId.get(plain.id)!.pancakeLink).toBeNull();
    });
  });
});
