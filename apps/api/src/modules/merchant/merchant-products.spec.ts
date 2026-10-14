import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT, MerchantService } from './merchant.service';
import { linkTubuFulfilledVariation, LINK_TAKEN_MESSAGE } from './merchant-pancake-link';
import { assertIdentifierAvailable } from '../storefront/identifier-validation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from '../orders/order-status.service';

const orderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
const MERCHANT_STORE = { id: 'sf-a', type: 'MERCHANT', ownerUserId: 'u1', title: 'Xanh Shop', subdomain: 'xanh', customDomain: null, collections: [] };
const PANCAKE_ROW = {
  id: 'var-pk',
  pancakeId: 'PK-123',
  name: '500ml',
  retailPrice: 150_000,
  salePrice: 129_000,
  stock: 40,
  product: { id: 'tubu-shell', name: 'Mật ong rừng' },
};

function build(opts: { role?: string; store?: Record<string, unknown>; pancakeRow?: unknown } = {}) {
  const productCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod-new', ...data }));
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: opts.role ?? 'DEALER' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
    },
    storefront: { findFirst: jest.fn().mockResolvedValue(opts.store ?? MERCHANT_STORE), update: jest.fn() },
    variation: { findFirst: jest.fn().mockResolvedValue(opts.pancakeRow === undefined ? PANCAKE_ROW : opts.pancakeRow) },
    product: { create: productCreate },
    storefrontItem: { count: jest.fn(), create: jest.fn() },
  };
  const svc = new MerchantService(prisma as unknown as PrismaService, orderStatus, { notify } as never);
  return { svc, prisma, productCreate, notify };
}

const BASE = { name: 'Mật ong', description: 'Mật ong rừng U Minh', basePrice: 200_000 };

describe('MerchantService — đăng sản phẩm (SELLER-1, D4)', () => {
  it('CTV (gian hàng CTV) không được đăng sản phẩm riêng', async () => {
    const { svc, productCreate } = build({ role: 'AFFILIATE', store: { ...MERCHANT_STORE, type: 'CTV' } });
    await expect(svc.createProduct('u1', BASE)).rejects.toThrow(new ForbiddenException(CTV_CANNOT_CREATE_PRODUCT));
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('ADMIN trên gian hàng CTV cũng không đăng được: sản phẩm tự giao trên gian hàng không phải đối tác không có ai xử lý đơn', async () => {
    const { svc, productCreate } = build({ role: 'ADMIN', store: { ...MERCHANT_STORE, type: 'CTV' } });
    await expect(svc.createProduct('u1', BASE)).rejects.toThrow(new ForbiddenException(CTV_CANNOT_CREATE_PRODUCT));
    await expect(svc.checkPancakeVariation('u1', 'PK-123')).rejects.toThrow(ForbiddenException);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('đối tác tự giao (mặc định): fulfilment MERCHANT, KHÔNG có mã Pancake nào (không còn mã giả MCH_), báo admin chờ duyệt', async () => {
    const { svc, productCreate, notify } = build();
    await svc.createProduct('u1', { ...BASE, stock: 12 });
    const data = productCreate.mock.calls[0][0].data;
    expect(data.pancakeId).toBeNull();
    expect(data.fulfilment).toBe('MERCHANT');
    expect(data.pancakeLinkCode).toBeNull();
    expect(data.approvalStatus).toBe('PENDING_REVIEW');
    expect(data.variations.create.pancakeId).toBeNull();
    expect(data.variations.create.stock).toBe(12);
    expect(JSON.stringify(data)).not.toContain('MCH_');
    expect(notify).toHaveBeenCalledWith('admin-1', 'OPS_MERCHANT_PRODUCT_PENDING', expect.objectContaining({ mode: 'Đối tác tự giao' }));
  });

  it('không nhập tồn kho → 0, không tự hứa 100 sản phẩm', async () => {
    const { svc, productCreate } = build();
    await svc.createProduct('u1', BASE);
    expect(productCreate.mock.calls[0][0].data.variations.create.stock).toBe(0);
  });

  it('"Tubu giao hộ" với mã hợp lệ: ghi mã xin liên kết, giá theo Pancake, chờ admin duyệt mới chuyển biến thể', async () => {
    const { svc, productCreate } = build();
    await svc.createProduct('u1', { ...BASE, tubuFulfils: true, pancakeCode: ' PK-123 ' });
    const data = productCreate.mock.calls[0][0].data;
    expect(data.pancakeLinkCode).toBe('PK-123');
    expect(data.pancakeId).toBeNull();
    expect(data.basePrice).toBe(150_000);
    expect(data.salePrice).toBe(129_000);
  });

  it('"Tubu giao hộ" với mã không có trong danh mục (hoặc đã có chủ) → 400, không tạo', async () => {
    const { svc, productCreate } = build({ pancakeRow: null });
    await expect(svc.createProduct('u1', { ...BASE, tubuFulfils: true, pancakeCode: 'XX' })).rejects.toThrow(BadRequestException);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('kiểm mã: chỉ biến thể Pancake đang bán, kho Tubu giao, chưa có chủ hoặc của chính gian hàng', async () => {
    const { svc, prisma } = build();
    const res = await svc.checkPancakeVariation('u1', 'PK-123');
    expect(res).toEqual(expect.objectContaining({ variationId: 'var-pk', pancakeId: 'PK-123', retailPrice: 150_000 }));
    const where = prisma.variation.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"fulfilment":"TUBU"');
    expect(where.AND[1]).toEqual({
      pancakeId: 'PK-123',
      isActive: true,
      product: { OR: [{ storefrontId: null }, { storefrontId: 'sf-a' }] },
    });
  });

  it('SELLER-14: giá khuyến mãi cao hơn giá gốc → 400', async () => {
    const { svc } = build();
    await expect(svc.createProduct('u1', { ...BASE, salePrice: 250_000 })).rejects.toThrow('không được cao hơn giá gốc');
  });
});

describe('linkTubuFulfilledVariation — admin duyệt "Tubu giao hộ"', () => {
  function tx(opts: { moved?: number; left?: number; row?: unknown } = {}) {
    return {
      variation: {
        findFirst: jest.fn().mockResolvedValue(opts.row === undefined ? PANCAKE_ROW : opts.row),
        updateMany: jest.fn().mockResolvedValue({ count: opts.moved ?? 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(opts.left ?? 0),
      },
      product: { update: jest.fn().mockResolvedValue({}) },
    };
  }
  const product = { id: 'prod-a', storefrontId: 'sf-a', pancakeLinkCode: 'PK-123' };

  it('chuyển CHÍNH dòng biến thể Pancake sang sản phẩm đối tác (có điều kiện productId cũ), xoá biến thể tạm, tắt sản phẩm vỏ', async () => {
    const t = tx();
    await linkTubuFulfilledVariation(t as never, product);
    expect(t.variation.updateMany).toHaveBeenCalledWith({
      where: { id: 'var-pk', productId: 'tubu-shell' },
      data: { productId: 'prod-a' },
    });
    expect(t.variation.deleteMany).toHaveBeenCalledWith({ where: { productId: 'prod-a', pancakeId: null } });
    expect(t.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-a' },
      data: { fulfilment: 'TUBU', basePrice: 150_000, salePrice: 129_000 },
    });
    expect(t.product.update).toHaveBeenCalledWith({ where: { id: 'tubu-shell' }, data: { isActive: false } });
  });

  it('sản phẩm vỏ còn biến thể khác → giữ nguyên đang bán', async () => {
    const t = tx({ left: 2 });
    await linkTubuFulfilledVariation(t as never, product);
    expect(t.product.update).not.toHaveBeenCalledWith({ where: { id: 'tubu-shell' }, data: { isActive: false } });
  });

  it('mã vừa bị sản phẩm khác lấy (cập nhật có điều kiện trượt) → ConflictException để rollback cả lần duyệt', async () => {
    const t = tx({ moved: 0 });
    await expect(linkTubuFulfilledVariation(t as never, product)).rejects.toThrow(new ConflictException(LINK_TAKEN_MESSAGE));
    expect(t.variation.deleteMany).not.toHaveBeenCalled();
  });

  it('duyệt lại sau khi đối tác sửa nội dung: biến thể Pancake đã thuộc chính sản phẩm này → không làm gì, không ném lỗi', async () => {
    const t = tx({ row: { ...PANCAKE_ROW, product: { id: 'prod-a', name: 'Mật ong rừng' } } });
    await expect(linkTubuFulfilledVariation(t as never, product)).resolves.toBeUndefined();
    expect(t.variation.updateMany).not.toHaveBeenCalled();
    expect(t.variation.deleteMany).not.toHaveBeenCalled();
    expect(t.product.update).not.toHaveBeenCalled();
  });

  it('duyệt lại khi biến thể đã liên kết đang tạm ngừng bán (không còn "liên kết được") → vẫn coi là đã liên kết', async () => {
    const t = tx({ row: null });
    t.variation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'var-pk' });
    await expect(linkTubuFulfilledVariation(t as never, product)).resolves.toBeUndefined();
    expect(t.variation.findFirst).toHaveBeenLastCalledWith({
      where: { productId: 'prod-a', pancakeId: 'PK-123' },
      select: { id: true },
    });
    expect(t.variation.updateMany).not.toHaveBeenCalled();
  });

  it('mã không còn trong danh mục và chưa thuộc sản phẩm này → ConflictException', async () => {
    const t = tx({ row: null });
    await expect(linkTubuFulfilledVariation(t as never, product)).rejects.toThrow(new ConflictException(LINK_TAKEN_MESSAGE));
  });

  it('sản phẩm không xin "Tubu giao hộ" → không làm gì', async () => {
    const t = tx();
    await linkTubuFulfilledVariation(t as never, { ...product, pancakeLinkCode: null });
    expect(t.variation.findFirst).not.toHaveBeenCalled();
  });
});

describe('SELLER-5: định danh gian hàng vừa nhả có thời gian cách ly', () => {
  const recent = new Date(Date.now() - 5 * 86_400_000);
  const prisma = (released: unknown) => ({
    storefront: { findFirst: jest.fn().mockResolvedValue(null) },
    releasedStorefrontIdentifier: { findUnique: jest.fn().mockResolvedValue(released) },
  });

  it('gian hàng khác xin subdomain vừa bị nhả 5 ngày trước → 400', async () => {
    await expect(
      assertIdentifierAvailable(prisma({ value: 'lan', storefrontId: 'sf-old', releasedAt: recent }) as never, 'lan', 'sf-new', 90),
    ).rejects.toThrow('tạm thời chưa thể đăng ký lại');
  });

  it('chủ cũ lấy lại tên của chính mình → được', async () => {
    await expect(
      assertIdentifierAvailable(prisma({ value: 'lan', storefrontId: 'sf-old', releasedAt: recent }) as never, 'lan', 'sf-old', 90),
    ).resolves.toBeUndefined();
  });

  it('quá thời gian cách ly → được', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    await expect(
      assertIdentifierAvailable(prisma({ value: 'lan', storefrontId: 'sf-old', releasedAt: old }) as never, 'lan', 'sf-new', 90),
    ).resolves.toBeUndefined();
  });

  it('đổi subdomain → ghi tên cũ vào danh sách cách ly', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const p = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
      storefront: {
        findFirst: jest.fn().mockResolvedValueOnce(MERCHANT_STORE).mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      releasedStorefrontIdentifier: { findUnique: jest.fn().mockResolvedValue(null), upsert },
    };
    const svc = new MerchantService(p as unknown as PrismaService, orderStatus);
    await svc.updateStore('u1', { subdomain: 'xanh-moi' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { value: 'xanh' }, create: expect.objectContaining({ value: 'xanh', storefrontId: 'sf-a' }) }),
    );
  });
});

describe('SELLER-5: đơn của gian hàng lọc theo khoá ngoại, không so chuỗi slug', () => {
  it('listMerchantOrders lọc storefrontId, không còn storefrontSlug', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const p = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'AFFILIATE' }) },
      storefront: { findFirst: jest.fn().mockResolvedValue({ ...MERCHANT_STORE, type: 'CTV', slug: 'abc' }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      order: { count, findMany },
    };
    const svc = new MerchantService(p as unknown as PrismaService, orderStatus);
    await svc.listMerchantOrders('u1');
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ storefrontId: 'sf-a' }]);
    expect(JSON.stringify(where)).not.toContain('storefrontSlug');
  });
});

describe('MerchantService — sửa/ngừng bán sản phẩm', () => {
  function buildEdit(product: Record<string, unknown>) {
    const productUpdate = jest.fn().mockResolvedValue({});
    const variationUpdate = jest.fn().mockResolvedValue({});
    const p = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storefront: { findFirst: jest.fn().mockResolvedValue(MERCHANT_STORE) },
      product: {
        findFirst: jest.fn().mockResolvedValue(product),
        update: productUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue(product),
      },
      variation: { update: variationUpdate },
      $transaction: jest.fn(),
    };
    p.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(p));
    return { svc: new MerchantService(p as unknown as PrismaService, orderStatus), productUpdate, variationUpdate };
  }
  const OWN = {
    id: 'prod-a',
    name: 'Mật ong',
    description: 'x',
    shortDesc: null,
    images: [],
    thumbnail: null,
    basePrice: 200_000,
    salePrice: null,
    approvalStatus: 'APPROVED',
    fulfilment: 'MERCHANT',
    variations: [{ id: 'v-a' }],
  };

  it('đổi giá/tồn có hiệu lực ngay, không phải duyệt lại', async () => {
    const { svc, productUpdate, variationUpdate } = buildEdit(OWN);
    await svc.updateProduct('u1', 'prod-a', { basePrice: 180_000, stock: 5 });
    expect(productUpdate.mock.calls[0][0].data.approvalStatus).toBeUndefined();
    expect(variationUpdate).toHaveBeenCalledWith({
      where: { id: 'v-a' },
      data: { retailPrice: 180_000, salePrice: null, stock: 5 },
    });
  });

  it('đổi tên sản phẩm đã duyệt → về chờ duyệt lại', async () => {
    const { svc, productUpdate } = buildEdit(OWN);
    await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng U Minh' });
    expect(productUpdate.mock.calls[0][0].data.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('sản phẩm Tubu giao hộ: không sửa giá/tồn ở đây', async () => {
    const { svc } = buildEdit({ ...OWN, fulfilment: 'TUBU' });
    await expect(svc.updateProduct('u1', 'prod-a', { stock: 3 })).rejects.toThrow('theo kho Tubu');
  });

  it('ngừng bán: tắt sản phẩm và biến thể, không xoá', async () => {
    const { svc, productUpdate, variationUpdate } = buildEdit(OWN);
    await svc.stopSellingProduct('u1', 'prod-a');
    expect(productUpdate.mock.calls[0][0].data.isActive).toBe(false);
    expect(variationUpdate.mock.calls[0][0].data.isActive).toBe(false);
  });
});
