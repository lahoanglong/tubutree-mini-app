import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminService } from './admin.service';
import {
  AdminController,
  ListReviewsQuery,
  ListSubscriptionsQuery,
  ListUsersQuery,
  ProductSearchQuery,
  VariationLookupQuery,
} from './admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * C-092 (A1-031): admin phải nhập ID thô (Variation ID, Product ID, userId, Tier ID), không duyệt được đánh giá
 * và không thấy gói định kỳ. Các endpoint đọc dưới đây cấp dữ liệu cho ô chọn và hai tab mới; việc ẩn/hiện đánh giá
 * dùng lại POST /reviews/:id/visibility sẵn có.
 */

function mkAdmin(prisma: unknown) {
  return new AdminService(
    prisma as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}
const tx = jest.fn((arr: Promise<unknown>[]) => Promise.all(arr));

describe('AdminService.searchProducts — ô chọn sản phẩm/biến thể', () => {
  const PRODUCT = {
    id: 'p1',
    name: 'Nước rửa chén Tubu',
    slug: 'nuoc-rua-chen',
    brand: 'Tubu',
    thumbnail: 'https://img/1.jpg',
    isActive: true,
    variations: [
      { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', retailPrice: 59000, salePrice: 49000, stock: 12, isActive: true },
      { id: 'v2', name: 'Can 2L', sku: 'NRC-2000', retailPrice: 150000, salePrice: null, stock: 0, isActive: false },
    ],
  };

  it('từ khoá ngắn hơn 2 ký tự → không truy vấn, trả mảng rỗng', async () => {
    const findMany = jest.fn();
    expect(await mkAdmin({ product: { findMany } }).searchProducts(' a ')).toEqual([]);
    expect(await mkAdmin({ product: { findMany } }).searchProducts('')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('tìm theo tên đã gấp dấu (không dấu, không phân biệt hoa thường), slug hoặc SKU; tối đa 20; trả giá = salePrice ?? retailPrice', async () => {
    const findMany = jest.fn().mockResolvedValue([PRODUCT]);
    const out = await mkAdmin({ product: { findMany } }).searchProducts('  Nước Rửa ');
    const args = findMany.mock.calls[0]![0];
    expect(args.take).toBe(20);
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { nameSearch: { contains: 'nuoc rua' } },
        { slug: { contains: 'nuoc-rua' } },
        { variations: { some: { sku: { contains: 'Nước Rửa', mode: 'insensitive' } } } },
      ]),
    );
    expect(out).toEqual([
      {
        id: 'p1',
        name: 'Nước rửa chén Tubu',
        slug: 'nuoc-rua-chen',
        brand: 'Tubu',
        thumbnail: 'https://img/1.jpg',
        isActive: true,
        variations: [
          { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', price: 49000, stock: 12, isActive: true },
          { id: 'v2', name: 'Can 2L', sku: 'NRC-2000', price: 150000, stock: 0, isActive: false },
        ],
      },
    ]);
  });
});

describe('AdminService.lookupVariations — nhãn cho Variation ID đã lưu', () => {
  it('chuỗi id phân tách bằng dấu phẩy → bỏ trống/trùng, tra một lượt, trả tên SP + biến thể', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', productId: 'p1', product: { name: 'Nước rửa chén' } },
    ]);
    const out = await mkAdmin({ variation: { findMany } }).lookupVariations(' v1, v1 ,, v2 ');
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['v1', 'v2'] } });
    expect(out).toEqual([{ id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', productId: 'p1', productName: 'Nước rửa chén' }]);
  });

  it('không có id nào → không truy vấn; quá 100 id → chỉ lấy 100 đầu', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = mkAdmin({ variation: { findMany } });
    expect(await svc.lookupVariations(' , ')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    await svc.lookupVariations(Array.from({ length: 150 }, (_, i) => `v${i}`).join(','));
    expect(findMany.mock.calls[0]![0].where.id.in).toHaveLength(100);
  });
});

describe('AdminService.listUsers — tìm khách theo SĐT/tên/id', () => {
  it('không search → hành vi cũ (không where)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    await mkAdmin({ user: { findMany, count }, $transaction: tx }).listUsers(1, 20);
    expect(findMany.mock.calls[0]![0].where).toBeUndefined();
    expect(count).toHaveBeenCalledWith({ where: undefined });
  });

  it('có search → lọc OR theo SĐT chứa, tên chứa (không phân biệt hoa thường), id đúng; count dùng cùng where', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    await mkAdmin({ user: { findMany, count }, $transaction: tx }).listUsers(1, 8, '  0901 ');
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toEqual({
      OR: [{ phone: { contains: '0901' } }, { fullName: { contains: '0901', mode: 'insensitive' } }, { id: '0901' }],
    });
    expect(count).toHaveBeenCalledWith({ where });
  });
});

describe('AdminService.listDealerTiers', () => {
  it('trả bậc đại lý theo mốc doanh số tăng dần để chọn thay vì nhập Tier ID', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'dealer_l1', name: 'Đại lý L1', minOrderVolume: 0, creditLimit: 0, paymentTerms: null, discountRules: {} }]);
    const out = await mkAdmin({ dealerTier: { findMany } }).listDealerTiers();
    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ minOrderVolume: 'asc' });
    expect(out).toEqual([{ id: 'dealer_l1', name: 'Đại lý L1', minOrderVolume: 0, creditLimit: 0, paymentTerms: null }]);
  });
});

describe('AdminService.listReviews — duyệt đánh giá', () => {
  const ROW = {
    id: 'r1',
    rating: 1,
    comment: 'Spam link',
    images: [],
    videoUrl: null,
    isVisible: true,
    isVerified: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    user: { id: 'u1', fullName: 'Lan', phone: '0900000001' },
    product: { id: 'p1', name: 'Nước rửa chén', slug: 'nuoc-rua-chen' },
  };

  it('mặc định mới nhất trước; lọc ẩn/hiện + số sao; count dùng cùng where; trả kèm khách + sản phẩm', async () => {
    const findMany = jest.fn().mockResolvedValue([ROW]);
    const count = jest.fn().mockResolvedValue(1);
    const svc = mkAdmin({ review: { findMany, count }, $transaction: tx });
    const out = await svc.listReviews(1, 20, 'hidden', 1);
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ isVisible: false, rating: 1 });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(count).toHaveBeenCalledWith({ where: args.where });
    expect(out.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(out.data[0]).toMatchObject({ id: 'r1', comment: 'Spam link', user: { fullName: 'Lan' }, product: { name: 'Nước rửa chén' } });
    await svc.listReviews(2, 10, 'visible');
    expect(findMany.mock.calls[1]![0].where).toEqual({ isVisible: true });
    expect(findMany.mock.calls[1]![0].skip).toBe(10);
    await svc.listReviews(1, 20);
    expect(findMany.mock.calls[2]![0].where).toEqual({});
  });
});

describe('AdminService.listSubscriptions — gói mua định kỳ (chỉ xem)', () => {
  it('lọc theo trạng thái, kèm khách + sản phẩm/biến thể; trả số lượng, chu kỳ, lần chạy tới', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 's1',
        status: 'ACTIVE',
        quantity: 2,
        intervalWeeks: 4,
        nextRunAt: new Date('2026-11-01T00:00:00Z'),
        lastOrderId: 'o9',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        user: { id: 'u1', fullName: 'Lan', phone: '0900000001' },
        variation: { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', product: { id: 'p1', name: 'Nước rửa chén' } },
      },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const out = await mkAdmin({ subscription: { findMany, count }, $transaction: tx }).listSubscriptions(1, 20, 'ACTIVE');
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ status: 'ACTIVE' });
    expect(count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    expect(out.data[0]).toMatchObject({ id: 's1', status: 'ACTIVE', quantity: 2, intervalWeeks: 4, user: { fullName: 'Lan' }, variation: { sku: 'NRC-500', product: { name: 'Nước rửa chén' } } });
    expect(JSON.stringify(out)).not.toContain('addressId');
  });

  it('không lọc → where rỗng', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await mkAdmin({ subscription: { findMany, count: jest.fn().mockResolvedValue(0) }, $transaction: tx }).listSubscriptions(1, 20);
    expect(findMany.mock.calls[0]![0].where).toEqual({});
  });
});

describe('AdminController — route + DTO của các endpoint tra cứu', () => {
  const proto = AdminController.prototype as unknown as Record<string, object>;
  const route = (m: string) => [Reflect.getMetadata(METHOD_METADATA, proto[m]!), Reflect.getMetadata(PATH_METADATA, proto[m]!)];

  it('đúng đường dẫn/method, chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    expect(route('searchProducts')).toEqual([RequestMethod.GET, 'products/search']);
    expect(route('lookupVariations')).toEqual([RequestMethod.GET, 'variations/lookup']);
    expect(route('dealerTiers')).toEqual([RequestMethod.GET, 'dealer-tiers']);
    expect(route('reviews')).toEqual([RequestMethod.GET, 'reviews']);
    expect(route('subscriptions')).toEqual([RequestMethod.GET, 'subscriptions']);
  });

  it('controller chuyển tham số xuống service', async () => {
    const admin = {
      searchProducts: jest.fn().mockResolvedValue([]),
      lookupVariations: jest.fn().mockResolvedValue([]),
      listDealerTiers: jest.fn().mockResolvedValue([]),
      listReviews: jest.fn().mockResolvedValue({}),
      listSubscriptions: jest.fn().mockResolvedValue({}),
      listUsers: jest.fn().mockResolvedValue({}),
    };
    const ctl = new AdminController(admin as never, {} as never);
    await ctl.searchProducts(Object.assign(new ProductSearchQuery(), { q: 'nuoc' }));
    expect(admin.searchProducts).toHaveBeenCalledWith('nuoc');
    await ctl.lookupVariations(Object.assign(new VariationLookupQuery(), { ids: 'a,b' }));
    expect(admin.lookupVariations).toHaveBeenCalledWith('a,b');
    await ctl.dealerTiers();
    expect(admin.listDealerTiers).toHaveBeenCalled();
    await ctl.reviews(Object.assign(new ListReviewsQuery(), { page: 2, limit: 10, visibility: 'hidden', rating: 1 }));
    expect(admin.listReviews).toHaveBeenCalledWith(2, 10, 'hidden', 1);
    await ctl.subscriptions(Object.assign(new ListSubscriptionsQuery(), { page: 1, limit: 20, status: 'PAUSED' }));
    expect(admin.listSubscriptions).toHaveBeenCalledWith(1, 20, 'PAUSED');
    await ctl.users(Object.assign(new ListUsersQuery(), { page: 1, limit: 8, search: '090' }));
    expect(admin.listUsers).toHaveBeenCalledWith(1, 8, '090');
  });

  it('DTO: visibility/rating/status hợp lệ, giá trị lạ bị chặn; ids/q giới hạn độ dài', async () => {
    expect(await validate(plainToInstance(ListReviewsQuery, { visibility: 'hidden', rating: '3' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListReviewsQuery, { visibility: 'x' }))).some((e) => e.property === 'visibility')).toBe(true);
    expect((await validate(plainToInstance(ListReviewsQuery, { rating: '9' }))).some((e) => e.property === 'rating')).toBe(true);
    expect(await validate(plainToInstance(ListSubscriptionsQuery, { status: 'CANCELLED' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListSubscriptionsQuery, { status: 'HACK' }))).some((e) => e.property === 'status')).toBe(true);
    expect((await validate(plainToInstance(ProductSearchQuery, { q: 'x'.repeat(101) }))).some((e) => e.property === 'q')).toBe(true);
    expect((await validate(plainToInstance(VariationLookupQuery, { ids: 'x'.repeat(3001) }))).some((e) => e.property === 'ids')).toBe(true);
    expect((await validate(plainToInstance(ListUsersQuery, { search: 'x'.repeat(101) }))).some((e) => e.property === 'search')).toBe(true);
  });
});
