import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminService, GUEST_USER_WHERE, REAL_USER_WHERE } from './admin.service';
import {
  AdminController,
  ListReviewsQuery,
  ListSubscriptionsQuery,
  PendingMerchantProductsQuery,
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
  it('không search → mặc định chỉ tài khoản thật (bỏ phiên khách vãng lai), kèm số khách vãng lai riêng; guests=1 → không lọc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const res = await mkAdmin({ user: { findMany, count }, $transaction: tx }).listUsers(1, 20);
    expect(findMany.mock.calls[0]![0].where).toEqual(REAL_USER_WHERE);
    expect(count).toHaveBeenNthCalledWith(1, { where: REAL_USER_WHERE });
    expect(count).toHaveBeenNthCalledWith(2, { where: GUEST_USER_WHERE });
    expect(res).toMatchObject({ guestCount: 2, meta: { total: 5 } });
    const all = jest.fn().mockResolvedValue(0);
    await mkAdmin({ user: { findMany, count: all }, $transaction: tx }).listUsers(1, 20, undefined, true);
    expect(findMany.mock.calls[1]![0].where).toBeUndefined();
  });

  it('file xuất người dùng cùng tập với danh sách: mặc định bỏ khách vãng lai, guests=1 mới xuất đủ', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = mkAdmin({ user: { findMany } });
    for await (const _ of svc.userCsv()) void _;
    expect(findMany.mock.calls[0]![0].where).toEqual(REAL_USER_WHERE);
    for await (const _ of svc.userCsv(undefined, true)) void _;
    expect(findMany.mock.calls[1]![0].where).toBeUndefined();
  });

  it('có search → lọc OR theo SĐT chứa, tên chứa (không phân biệt hoa thường), tên không dấu, id đúng; count dùng cùng where', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    await mkAdmin({ user: { findMany, count }, $transaction: tx }).listUsers(1, 8, '  0901 ');
    const where = findMany.mock.calls[0]![0].where;
    const searchWhere = {
      OR: [
        { phone: { contains: '0901' } },
        { fullName: { contains: '0901', mode: 'insensitive' } },
        { fullNameSearch: { contains: '0901' } },
        { id: '0901' },
      ],
    };
    expect(where).toEqual({ AND: [REAL_USER_WHERE, searchWhere] });
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('ADMINOPS-9: SĐT dạng +84 tìm theo dạng nội địa; tên gõ không dấu khớp cột đã gấp dấu', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const admin = mkAdmin({ user: { findMany, count }, $transaction: tx });
    await admin.listUsers(1, 8, '+84 901 234 567');
    expect(findMany.mock.calls[0]![0].where.AND[1].OR).toEqual(expect.arrayContaining([{ phone: { contains: '0901234567' } }]));
    await admin.listUsers(1, 8, 'Khách MỘT');
    expect(findMany.mock.calls[1]![0].where.AND[1].OR).toEqual(expect.arrayContaining([{ fullNameSearch: { contains: 'khach mot' } }]));
  });
});

describe('AdminService.listUsers — hai lô Điểm Xanh (PD-3)', () => {
  it('select cả pointsConvertedBalance để nhân viên thấy điểm không hết hạn khi xử lý khiếu nại quy đổi', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    await mkAdmin({ user: { findMany, count }, $transaction: tx }).listUsers(1, 20);
    expect(findMany.mock.calls[0]![0].select).toMatchObject({ pointsBalance: true, pointsConvertedBalance: true });
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
    imageVersions: [],
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

describe('AdminService.listReviews — ảnh không nhúng base64 (L3-03)', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'r1', rating: 5, comment: 'ok', imageVersions: [], videoUrl: null, isVisible: true, isVerified: true,
    createdAt: new Date('2026-10-01T00:00:00Z'), user: { id: 'u1', fullName: 'Lan', phone: '0900000001' },
    product: { id: 'p1', name: 'SP', slug: 'sp' }, ...over,
  });

  it('chọn imageVersions, không chọn images', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await mkAdmin({ review: { findMany, count: jest.fn().mockResolvedValue(0) }, $transaction: tx }).listReviews(1, 20);
    const select = findMany.mock.calls[0]![0].select;
    expect(select).toMatchObject({ imageVersions: true });
    expect(select).not.toHaveProperty('images');
  });

  it('đánh giá đang hiện: ảnh base64 thành đường dẫn công khai /reviews/:id/images/:i, ảnh https giữ nguyên, không còn data:image', async () => {
    const findMany = jest.fn().mockResolvedValue([row({ imageVersions: ['0123456789', 'https://cdn/x.jpg'] })]);
    const out = await mkAdmin({ review: { findMany, count: jest.fn().mockResolvedValue(1) }, $transaction: tx }).listReviews(1, 20);
    expect(out.data[0]!.images).toEqual(['/reviews/r1/images/0?v=0123456789', 'https://cdn/x.jpg']);
    expect(out.data[0]).not.toHaveProperty('imageVersions');
    expect(JSON.stringify(out)).not.toContain('data:image');
  });

  it('đánh giá đã ẩn: ảnh base64 đi qua đường dẫn của admin (đường dẫn công khai không phát ảnh của đánh giá ẩn)', async () => {
    const findMany = jest.fn().mockResolvedValue([row({ isVisible: false, imageVersions: ['0123456789', 'https://cdn/x.jpg'] })]);
    const out = await mkAdmin({ review: { findMany, count: jest.fn().mockResolvedValue(1) }, $transaction: tx }).listReviews(1, 20, 'hidden');
    expect(out.data[0]!.images).toEqual(['/admin/reviews/r1/images/0?v=0123456789', 'https://cdn/x.jpg']);
  });
});

describe('AdminService.reviewImage — ảnh đánh giá cho admin (L3-03)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  it('trả byte ảnh kể cả đánh giá đã ẩn; chỉ đọc đúng một phần tử mảng', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ image: PNG }]);
    const out = await mkAdmin({ $queryRaw: queryRaw }).reviewImage('r1', 1);
    expect(out.mime).toBe('image/png');
    expect(out.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(queryRaw.mock.calls[0])).toContain('images');
  });
  it('không có dòng, chỉ số ngoài khoảng hoặc ảnh không phải raster → 404', async () => {
    await expect(mkAdmin({ $queryRaw: jest.fn().mockResolvedValue([]) }).reviewImage('r1', 0)).rejects.toThrow('Không tìm thấy ảnh.');
    const q = jest.fn();
    await expect(mkAdmin({ $queryRaw: q }).reviewImage('r1', 1000)).rejects.toThrow('Không tìm thấy ảnh.');
    expect(q).not.toHaveBeenCalled();
    await expect(mkAdmin({ $queryRaw: jest.fn().mockResolvedValue([{ image: 'data:image/svg+xml;base64,PHN2Zz4=' }]) }).reviewImage('r1', 0)).rejects.toThrow('Không tìm thấy ảnh.');
  });
});

describe('Hàng chờ duyệt sản phẩm đối tác — controller (L3-02)', () => {
  const check = async (raw: Record<string, unknown>) => {
    const q = plainToInstance(PendingMerchantProductsQuery, raw);
    return { q, errors: await validate(q) };
  };
  it('mặc định 20 dòng; limit lớn (web cũ gửi 100) vẫn hợp lệ, trần 50 do service kẹp', async () => {
    expect((await check({})).q).toMatchObject({ page: 1, limit: 20 });
    expect((await check({ limit: '50' })).errors).toHaveLength(0);
    expect((await check({ limit: '51' })).errors).toHaveLength(0);
    expect((await check({ limit: '100' })).errors).toHaveLength(0);
    expect((await check({ limit: '0' })).errors).toHaveLength(1);
  });

  const route = (m: string) => {
    const fn = (AdminController.prototype as unknown as Record<string, unknown>)[m]!;
    return [Reflect.getMetadata(METHOD_METADATA, fn as object), Reflect.getMetadata(PATH_METADATA, fn as object)];
  };
  it('route ảnh nằm dưới controller chỉ ADMIN, không @Public', () => {
    expect(route('merchantProductImage')).toEqual([RequestMethod.GET, 'merchant-products/:id/images/:source/:slot']);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata('isPublic', AdminController.prototype.merchantProductImage)).toBeUndefined();
  });

  it.each([['other', '0'], ['product', 'abc'], ['draft', '01'], ['product', '-1'], ['product', '123']])('nguồn %s ô %s → 404 trước khi chạm DB', async (source, slot) => {
    const admin = { merchantProductImage: jest.fn() };
    const ctrl = new AdminController(admin as never, {} as never);
    await expect(ctrl.merchantProductImage('p1', source, slot, { set: jest.fn() } as never)).rejects.toThrow('Không tìm thấy ảnh.');
    expect(admin.merchantProductImage).not.toHaveBeenCalled();
  });

  it('nguồn và ô hợp lệ → gọi service, ảnh không cache công khai', async () => {
    const set = jest.fn();
    const admin = { merchantProductImage: jest.fn().mockResolvedValue({ mime: 'image/png', data: Buffer.from('x') }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.merchantProductImage('p1', 'draft', 'thumb', { set } as never);
    await ctrl.merchantProductImage('p1', 'product', '3', { set } as never);
    expect(admin.merchantProductImage).toHaveBeenNthCalledWith(1, 'p1', 'draft', 'thumb');
    expect(admin.merchantProductImage).toHaveBeenNthCalledWith(2, 'p1', 'product', 3);
    expect(set.mock.calls[0]![0]['Cache-Control']).toBe('private, no-store');
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
    expect(route('reviewImage')).toEqual([RequestMethod.GET, 'reviews/:id/images/:index']);
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
    await ctl.users(Object.assign(new ListUsersQuery(), { page: 1, limit: 8, search: '090' }), { sub: 'a1', role: 'ADMIN' } as never);
    expect(admin.listUsers).toHaveBeenCalledWith(1, 8, '090', false);
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

describe('AdminService.getTodaySummary (R-74)', () => {
  it('đếm theo ngày giờ VN: mốc hôm nay 00:00 VN, hôm qua, và 7 ngày gồm hôm nay; mỗi truy vấn nhận đúng mốc', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ orders_today: 3, orders_yesterday: 2, orders_week: 9, rev_today: 300n, rev_yesterday: 200n, rev_week: 900n, gmv_today: 450n, gmv_yesterday: 250n, gmv_week: 1200n }])
      .mockResolvedValueOnce([{ today: 4, yesterday: 1, week: 11 }]);
    const admin = mkAdmin({ $queryRaw: queryRaw });
    // 2026-10-28 02:00 UTC = 09:00 VN
    const res = await admin.getTodaySummary(new Date('2026-10-28T02:00:00Z'));
    expect(res).toEqual({
      orders: { today: 3, yesterday: 2, week: 9 },
      revenue: { today: 300, yesterday: 200, week: 900 },
      gmv: { today: 450, yesterday: 250, week: 1200 },
      newUsers: { today: 4, yesterday: 1, week: 11 },
    });
    const dayStart = new Date('2026-10-27T17:00:00Z');
    expect(queryRaw.mock.calls[0]).toContainEqual(dayStart);
    expect(queryRaw.mock.calls[0]).toContainEqual(new Date('2026-10-21T17:00:00Z'));
    expect(queryRaw.mock.calls[1]).toContainEqual(dayStart);
  });
});
