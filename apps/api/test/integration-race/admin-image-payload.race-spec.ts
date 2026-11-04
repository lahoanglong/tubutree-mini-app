import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { createUser, randCode, warmPool } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** Danh sách của admin không nhúng ảnh base64; ảnh mở qua đường dẫn, và quyền xem ảnh đúng với từng loại đường dẫn. */
describe('Admin image payload (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;
  let reviews: ReviewsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    reviews = new ReviewsService(prisma, none, none);
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
});
