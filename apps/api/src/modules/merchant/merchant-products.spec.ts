import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT, MerchantService } from './merchant.service';
import {
  linkTubuFulfilledVariation,
  unlinkTubuFulfilledVariation,
  LINK_TAKEN_MESSAGE,
  PANCAKE_TAKEOVER_CHANGED,
  PANCAKE_TAKEOVER_UNCONFIRMED,
} from './merchant-pancake-link';
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
  product: { id: 'tubu-shell', name: 'Mật ong rừng', storefrontId: null, isActive: false, approvalStatus: 'APPROVED' },
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

  it('kiểm mã: chỉ biến thể Pancake đang bán, kho Tubu giao, thuộc sản phẩm Tubu chưa có chủ — không lấy mã của gian hàng nào', async () => {
    const { svc, prisma } = build();
    const res = await svc.checkPancakeVariation('u1', 'PK-123');
    expect(res).toEqual({
      pancakeId: 'PK-123',
      productName: 'Mật ong rừng',
      variationName: '500ml',
      retailPrice: 150_000,
      salePrice: 129_000,
      stock: 40,
      requiresAdminConfirm: false,
    });
    const where = prisma.variation.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"fulfilment":"TUBU"');
    expect(where.AND[1]).toEqual({ pancakeId: 'PK-123', isActive: true, product: { OR: [{ storefrontId: null }] } });
  });

  it('R2-MERCHANT-1: mã của sản phẩm Tubu ĐANG BÁN → đối tác chỉ gửi xin được (cần admin xác nhận), không thấy tồn kho Tubu', async () => {
    const onSale = { ...PANCAKE_ROW, product: { ...PANCAKE_ROW.product, isActive: true } };
    const { svc, productCreate, notify } = build({ pancakeRow: onSale });
    const res = await svc.checkPancakeVariation('u1', 'PK-123');
    expect(res.requiresAdminConfirm).toBe(true);
    expect(res.stock).toBeNull();
    expect(res).not.toHaveProperty('variationId');
    expect(res).not.toHaveProperty('productId');
    await svc.createProduct('u1', { ...BASE, tubuFulfils: true, pancakeCode: 'PK-123' });
    expect(productCreate.mock.calls[0][0].data.pancakeLinkCode).toBe('PK-123');
    expect(notify).toHaveBeenCalledWith(
      'admin-1',
      'OPS_MERCHANT_PRODUCT_PENDING',
      expect.objectContaining({ mode: expect.stringContaining('cần admin xác nhận') }),
    );
  });

  it('SELLER-14: giá khuyến mãi cao hơn giá gốc → 400', async () => {
    const { svc } = build();
    await expect(svc.createProduct('u1', { ...BASE, salePrice: 250_000 })).rejects.toThrow('không được cao hơn giá gốc');
  });
});

describe('linkTubuFulfilledVariation — admin duyệt "Tubu giao hộ"', () => {
  function tx(opts: { moved?: number; left?: number; row?: unknown; originActive?: boolean } = {}) {
    return {
      variation: {
        findFirst: jest.fn().mockResolvedValue(opts.row === undefined ? PANCAKE_ROW : opts.row),
        updateMany: jest.fn().mockResolvedValue({ count: opts.moved ?? 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(opts.left ?? 0),
      },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ isActive: opts.originActive ?? true }),
      },
      merchantPancakeLink: { create: jest.fn().mockResolvedValue({}) },
    };
  }
  const OPTS = { adminId: 'admin-1' };
  const product = { id: 'prod-a', storefrontId: 'sf-a', pancakeLinkCode: 'PK-123' };

  it('chuyển CHÍNH dòng biến thể Pancake sang sản phẩm đối tác (có điều kiện productId cũ), xoá biến thể tạm, tắt sản phẩm vỏ', async () => {
    const t = tx();
    await linkTubuFulfilledVariation(t as never, product, OPTS);
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
    expect(t.merchantPancakeLink.create).toHaveBeenCalledWith({
      data: {
        productId: 'prod-a',
        storefrontId: 'sf-a',
        variationId: 'var-pk',
        originProductId: 'tubu-shell',
        originDeactivated: true,
        takeover: false,
        stockAtLink: 40,
        linkedBy: 'admin-1',
      },
    });
  });

  it('R2-MERCHANT-1: mã của sản phẩm Tubu đang bán, admin chưa xác nhận chuyển → 409 có mã riêng, không chuyển gì', async () => {
    const t = tx({ row: { ...PANCAKE_ROW, product: { ...PANCAKE_ROW.product, isActive: true } } });
    await expect(linkTubuFulfilledVariation(t as never, product, OPTS)).rejects.toMatchObject({
      response: expect.objectContaining({ code: PANCAKE_TAKEOVER_UNCONFIRMED }),
    });
    expect(t.variation.updateMany).not.toHaveBeenCalled();
    expect(t.merchantPancakeLink.create).not.toHaveBeenCalled();
  });

  it('R2-MERCHANT-1: admin xác nhận chuyển → chuyển và ghi takeover để gỡ liên kết trả về đúng chỗ', async () => {
    const t = tx({ row: { ...PANCAKE_ROW, product: { ...PANCAKE_ROW.product, isActive: true } } });
    await linkTubuFulfilledVariation(t as never, product, { adminId: 'admin-1', confirmTakeover: true, takeoverProductId: 'tubu-shell' });
    expect(t.variation.updateMany).toHaveBeenCalledWith({ where: { id: 'var-pk', productId: 'tubu-shell' }, data: { productId: 'prod-a' } });
    expect(t.merchantPancakeLink.create.mock.calls[0][0].data).toMatchObject({ takeover: true, originDeactivated: true });
  });

  it.each([
    ['không kèm sản phẩm đã xem', undefined],
    ['xác nhận cho sản phẩm đang bán khác', 'tubu-other'],
  ])('xác nhận chuyển %s → 409 PANCAKE_TAKEOVER_CHANGED, không chuyển gì', async (_label, takeoverProductId) => {
    const t = tx({ row: { ...PANCAKE_ROW, product: { ...PANCAKE_ROW.product, isActive: true } } });
    await expect(
      linkTubuFulfilledVariation(t as never, product, { adminId: 'admin-1', confirmTakeover: true, takeoverProductId }),
    ).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: PANCAKE_TAKEOVER_CHANGED }) });
    expect(t.variation.updateMany).not.toHaveBeenCalled();
    expect(t.merchantPancakeLink.create).not.toHaveBeenCalled();
  });

  it('sản phẩm vỏ còn biến thể khác → giữ nguyên đang bán, gỡ liên kết không tự bật/tắt nó', async () => {
    const t = tx({ left: 2 });
    await linkTubuFulfilledVariation(t as never, product, OPTS);
    expect(t.product.update).not.toHaveBeenCalledWith({ where: { id: 'tubu-shell' }, data: { isActive: false } });
    expect(t.merchantPancakeLink.create.mock.calls[0][0].data.originDeactivated).toBe(false);
  });

  it('mã vừa bị sản phẩm khác lấy (cập nhật có điều kiện trượt) → ConflictException để rollback cả lần duyệt', async () => {
    const t = tx({ moved: 0 });
    await expect(linkTubuFulfilledVariation(t as never, product, OPTS)).rejects.toThrow(new ConflictException(LINK_TAKEN_MESSAGE));
    expect(t.variation.deleteMany).not.toHaveBeenCalled();
  });

  it('duyệt lại sau khi đối tác sửa nội dung: biến thể Pancake đã thuộc chính sản phẩm này → không làm gì, không ném lỗi', async () => {
    const t = tx({ row: { ...PANCAKE_ROW, product: { ...PANCAKE_ROW.product, id: 'prod-a', storefrontId: 'sf-a' } } });
    await expect(linkTubuFulfilledVariation(t as never, product, OPTS)).resolves.toBeUndefined();
    expect(t.variation.updateMany).not.toHaveBeenCalled();
    expect(t.variation.deleteMany).not.toHaveBeenCalled();
    expect(t.product.update).not.toHaveBeenCalled();
  });

  it('duyệt lại khi biến thể đã liên kết đang tạm ngừng bán (không còn "liên kết được") → vẫn coi là đã liên kết', async () => {
    const t = tx({ row: null });
    t.variation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'var-pk' });
    await expect(linkTubuFulfilledVariation(t as never, product, OPTS)).resolves.toBeUndefined();
    expect(t.variation.findFirst).toHaveBeenLastCalledWith({
      where: { productId: 'prod-a', pancakeId: 'PK-123' },
      select: { id: true },
    });
    expect(t.variation.updateMany).not.toHaveBeenCalled();
  });

  it('mã không còn trong danh mục và chưa thuộc sản phẩm này → ConflictException', async () => {
    const t = tx({ row: null });
    await expect(linkTubuFulfilledVariation(t as never, product, OPTS)).rejects.toThrow(new ConflictException(LINK_TAKEN_MESSAGE));
  });

  it('sản phẩm không xin "Tubu giao hộ" → không làm gì', async () => {
    const t = tx();
    await linkTubuFulfilledVariation(t as never, { ...product, pancakeLinkCode: null }, OPTS);
    expect(t.variation.findFirst).not.toHaveBeenCalled();
  });
});

describe('unlinkTubuFulfilledVariation — gỡ liên kết trả biến thể về sản phẩm gốc (R2-MERCHANT-1)', () => {
  function tx(link: Record<string, unknown> | null, closed = 1) {
    return {
      merchantPancakeLink: {
        findFirst: jest.fn().mockResolvedValue(link),
        updateMany: jest.fn().mockResolvedValue({ count: closed }),
      },
      variation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({}) },
      product: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ basePrice: 150_000, salePrice: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }
  const LINK = { id: 'l1', variationId: 'var-pk', originProductId: 'tubu-shell', originDeactivated: true };

  it('trả biến thể về sản phẩm gốc, bật lại sản phẩm gốc, sản phẩm đối tác nhận biến thể tạm và tắt bán', async () => {
    const t = tx(LINK);
    const res = await unlinkTubuFulfilledVariation(t as never, 'prod-a', { actorId: 'admin-1', reason: 'Nhầm', deactivate: true });
    expect(res).toEqual({ id: 'l1', variationId: 'var-pk', originProductId: 'tubu-shell' });
    expect(t.merchantPancakeLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'l1', unlinkedAt: null },
      data: expect.objectContaining({ unlinkedBy: 'admin-1', unlinkReason: 'Nhầm' }),
    });
    expect(t.variation.updateMany).toHaveBeenCalledWith({
      where: { id: 'var-pk', productId: 'prod-a' },
      data: { productId: 'tubu-shell' },
    });
    expect(t.variation.create.mock.calls[0][0].data).toMatchObject({ productId: 'prod-a', pancakeId: null, stock: 0 });
    expect(t.product.update).toHaveBeenCalledWith({ where: { id: 'prod-a' }, data: { fulfilment: 'MERCHANT', isActive: false } });
    expect(t.product.updateMany).toHaveBeenCalledWith({ where: { id: 'tubu-shell', isActive: false }, data: { isActive: true } });
  });

  it('lần liên kết không tắt sản phẩm gốc → gỡ cũng không bật nó (admin có thể đã tắt vì lý do khác)', async () => {
    const t = tx({ ...LINK, originDeactivated: false });
    await unlinkTubuFulfilledVariation(t as never, 'prod-a', { actorId: 'a', reason: 'x', deactivate: false });
    expect(t.product.updateMany).not.toHaveBeenCalled();
    expect(t.product.update).toHaveBeenCalledWith({ where: { id: 'prod-a' }, data: { fulfilment: 'MERCHANT' } });
  });

  it('không có liên kết mở, hoặc lần gỡ khác vừa đóng nó → không làm gì', async () => {
    const none = tx(null);
    await expect(unlinkTubuFulfilledVariation(none as never, 'prod-a', { actorId: 'a', reason: 'x', deactivate: true })).resolves.toBeNull();
    const raced = tx(LINK, 0);
    await expect(unlinkTubuFulfilledVariation(raced as never, 'prod-a', { actorId: 'a', reason: 'x', deactivate: true })).resolves.toBeNull();
    expect(raced.variation.updateMany).not.toHaveBeenCalled();
  });

  it('liên kết cũ không rõ sản phẩm gốc: admin gỡ tay → 400; ngừng bán/từ chối → bỏ qua', async () => {
    const t = tx({ ...LINK, originProductId: null });
    await expect(
      unlinkTubuFulfilledVariation(t as never, 'prod-a', { actorId: 'a', reason: 'x', deactivate: true, legacy: 'throw' }),
    ).rejects.toThrow(BadRequestException);
    await expect(unlinkTubuFulfilledVariation(t as never, 'prod-a', { actorId: 'a', reason: 'x', deactivate: true })).resolves.toBeNull();
    expect(t.variation.updateMany).not.toHaveBeenCalled();
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
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
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
  function buildEdit(product: Record<string, unknown>, linkable: unknown = PANCAKE_ROW) {
    const variationFindFirst = jest.fn().mockResolvedValue(linkable);
    const productUpdate = jest.fn().mockResolvedValue({});
    const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const variationUpdate = jest.fn().mockResolvedValue({});
    const draftUpsert = jest.fn().mockResolvedValue({});
    const draftDelete = jest.fn().mockResolvedValue({ count: 1 });
    const notify = jest.fn().mockResolvedValue(undefined);
    const p = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
      },
      storefront: { findFirst: jest.fn().mockResolvedValue(MERCHANT_STORE) },
      product: {
        findFirst: jest.fn().mockResolvedValue(product),
        update: productUpdate,
        updateMany: productUpdateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, editDraft: null }),
      },
      productEditDraft: { upsert: draftUpsert, deleteMany: draftDelete },
      variation: { update: variationUpdate, findFirst: variationFindFirst },
      $transaction: jest.fn(),
    };
    p.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(p));
    return {
      svc: new MerchantService(p as unknown as PrismaService, orderStatus, { notify } as never),
      variationFindFirst,
      productUpdate,
      productUpdateMany,
      variationUpdate,
      draftUpsert,
      draftDelete,
      notify,
    };
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
    editDraft: null,
    variations: [{ id: 'v-a' }],
  };
  const DRAFT = { id: 'd1', name: 'Mật ong rừng', description: 'x', shortDesc: null, images: [], thumbnail: null };

  it('đổi giá/tồn có hiệu lực ngay, không phải duyệt lại', async () => {
    const { svc, productUpdate, variationUpdate, draftUpsert } = buildEdit(OWN);
    await svc.updateProduct('u1', 'prod-a', { basePrice: 180_000, stock: 5 });
    expect(productUpdate.mock.calls[0][0].data.approvalStatus).toBeUndefined();
    expect(draftUpsert).not.toHaveBeenCalled();
    expect(variationUpdate).toHaveBeenCalledWith({
      where: { id: 'v-a' },
      data: { retailPrice: 180_000, salePrice: null, stock: 5 },
    });
  });

  describe('R3-MERCHANT-4: sửa nội dung sản phẩm đang bán không gỡ nó khỏi trang bán', () => {
    it('đổi tên → lưu bản sửa chờ duyệt, tên/mô tả/ảnh đang bán và trạng thái APPROVED giữ nguyên', async () => {
      const { svc, productUpdate, draftUpsert } = buildEdit(OWN);
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng U Minh' });
      expect(draftUpsert).toHaveBeenCalledWith({
        where: { productId: 'prod-a' },
        create: { productId: 'prod-a', name: 'Mật ong rừng U Minh', description: 'x', shortDesc: null, images: [], thumbnail: null },
        update: { name: 'Mật ong rừng U Minh', description: 'x', shortDesc: null, images: [], thumbnail: null },
      });
      const data = productUpdate.mock.calls[0]?.[0].data ?? {};
      expect(data.approvalStatus).toBeUndefined();
      expect(data.name).toBeUndefined();
      expect(data.description).toBeUndefined();
      expect(data.images).toBeUndefined();
    });

    it('báo admin một lần có bản sửa mới; đối tác sửa tiếp khi bản trước còn chờ thì gộp vào bản chờ, không báo lại', async () => {
      const first = buildEdit(OWN);
      await first.svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng' });
      expect(first.notify).toHaveBeenCalledWith('admin-1', 'OPS_MERCHANT_PRODUCT_EDIT_PENDING', expect.objectContaining({ product_name: 'Mật ong rừng' }));

      const again = buildEdit({ ...OWN, editDraft: DRAFT });
      await again.svc.updateProduct('u1', 'prod-a', { description: 'Mật ong U Minh nguyên chất' });
      expect(again.draftUpsert.mock.calls[0]![0].update).toEqual({
        name: 'Mật ong rừng',
        description: 'Mật ong U Minh nguyên chất',
        shortDesc: null,
        images: [],
        thumbnail: null,
      });
      expect(again.notify).not.toHaveBeenCalled();
    });

    it('sửa về đúng nội dung đang bán → bỏ bản chờ, không còn gì để duyệt', async () => {
      const { svc, draftUpsert, draftDelete } = buildEdit({ ...OWN, editDraft: DRAFT });
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong' });
      expect(draftUpsert).not.toHaveBeenCalled();
      expect(draftDelete).toHaveBeenCalledWith({ where: { productId: 'prod-a' } });
    });

    it('lưu lại đúng nội dung (không đổi gì) → không tạo bản sửa, không báo admin', async () => {
      const { svc, draftUpsert, notify } = buildEdit(OWN);
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong', description: 'x' });
      expect(draftUpsert).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('đổi cả giá lẫn tên cùng lúc: giá có hiệu lực ngay, tên chờ duyệt', async () => {
      const { svc, productUpdate, variationUpdate, draftUpsert } = buildEdit(OWN);
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng', basePrice: 190_000 });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ basePrice: 190_000 });
      expect(productUpdate.mock.calls[0]![0].data.name).toBeUndefined();
      expect(variationUpdate.mock.calls[0]![0].data).toMatchObject({ retailPrice: 190_000 });
      expect(draftUpsert).toHaveBeenCalledTimes(1);
    });

    it('sản phẩm "Tubu giao hộ" đã liên kết: sửa mô tả không về chờ duyệt, nên mã Pancake vẫn bán', async () => {
      const { svc, productUpdate, draftUpsert } = buildEdit({ ...OWN, fulfilment: 'TUBU', pancakeLinkCode: 'PK-1' });
      await svc.updateProduct('u1', 'prod-a', { shortDesc: 'Sửa lỗi chính tả' });
      expect(draftUpsert).toHaveBeenCalledTimes(1);
      expect(productUpdate.mock.calls[0]?.[0].data.approvalStatus).toBeUndefined();
    });

    it('sản phẩm chưa được duyệt (chờ duyệt): sửa thẳng vào sản phẩm, không có bản sửa riêng và không báo lại', async () => {
      const { svc, productUpdate, draftUpsert, notify } = buildEdit({ ...OWN, approvalStatus: 'PENDING_REVIEW' });
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng' });
      expect(draftUpsert).not.toHaveBeenCalled();
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ name: 'Mật ong rừng' });
      expect(productUpdate.mock.calls[0]![0].data.approvalStatus).toBeUndefined();
      expect(notify).not.toHaveBeenCalled();
    });

    it('sản phẩm bị từ chối: sửa xong về chờ duyệt (chưa từng bán nên không có gì phải giữ)', async () => {
      const { svc, productUpdate, draftUpsert, notify } = buildEdit({ ...OWN, approvalStatus: 'REJECTED', rejectReason: 'Ảnh mờ' });
      await svc.updateProduct('u1', 'prod-a', { name: 'Mật ong rừng' });
      expect(draftUpsert).not.toHaveBeenCalled();
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ name: 'Mật ong rừng', approvalStatus: 'PENDING_REVIEW', rejectReason: null });
      expect(notify).toHaveBeenCalledWith('admin-1', 'OPS_MERCHANT_PRODUCT_PENDING', expect.objectContaining({ product_name: 'Mật ong rừng' }));
    });

    it('mở bán lại sản phẩm đã gỡ liên kết: về chờ duyệt, bản sửa đang chờ được gộp vào sản phẩm', async () => {
      const { svc, productUpdate, draftDelete } = buildEdit({
        ...OWN,
        fulfilment: 'MERCHANT',
        pancakeLinkCode: 'PK-1',
        isActive: false,
        editDraft: DRAFT,
      });
      await svc.updateProduct('u1', 'prod-a', { isActive: true });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ name: 'Mật ong rừng', approvalStatus: 'PENDING_REVIEW', isActive: true });
      expect(draftDelete).toHaveBeenCalledWith({ where: { productId: 'prod-a' } });
    });

    it('đối tác xem lại: danh sách sản phẩm kèm bản sửa đang chờ (pendingEdit) bên cạnh nội dung đang bán', async () => {
      const submitted = new Date('2026-10-14T03:00:00Z');
      const findMany = jest.fn().mockResolvedValue([{ ...OWN, variations: [], editDraft: { ...DRAFT, updatedAt: submitted } }]);
      const p = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(MERCHANT_STORE) },
        product: { count: jest.fn().mockResolvedValue(1), findMany },
        storefrontItem: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
        orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
      };
      const res = await new MerchantService(p as unknown as PrismaService, orderStatus).listMyProducts('u1');
      const row = res.ownProducts[0] as unknown as Record<string, unknown>;
      expect(row.name).toBe('Mật ong');
      expect(row.pendingEdit).toEqual({ name: 'Mật ong rừng', description: 'x', shortDesc: null, images: [], thumbnail: null, submittedAt: submitted });
      expect(row).not.toHaveProperty('editDraft');
    });
  });

  describe('R4-PARTNER-6: sản phẩm đã gỡ liên kết đổi được mã Pancake hoặc chuyển sang tự giao', () => {
    const UNLINKED = {
      ...OWN,
      fulfilment: 'MERCHANT',
      pancakeLinkCode: 'PK-OLD',
      isActive: false,
      variations: [{ id: 'v-a' }],
    };

    it('bỏ mã (null) → chuyển hẳn sang tự giao: xoá mã, vẫn APPROVED, không báo admin, không cần duyệt lại', async () => {
      const { svc, productUpdate, productUpdateMany, notify } = buildEdit(UNLINKED);
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: null });
      expect(productUpdateMany).toHaveBeenCalledWith({
        where: { id: 'prod-a', fulfilment: { not: 'TUBU' }, pancakeLinkCode: 'PK-OLD' },
        data: { pancakeLinkCode: null },
      });
      expect(productUpdate.mock.calls[0]![0].data.approvalStatus).toBeUndefined();
      expect(notify).not.toHaveBeenCalled();
    });

    it('chuỗi rỗng cũng là bỏ mã; bỏ mã cùng lúc với sửa giá và tồn kho thì sửa được ngay (không còn "chờ liên kết")', async () => {
      const { svc, productUpdate, productUpdateMany, variationUpdate } = buildEdit(UNLINKED);
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: '  ', basePrice: 90_000, stock: 5 });
      expect(productUpdateMany.mock.calls[0]![0].data).toEqual({ pancakeLinkCode: null });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ basePrice: 90_000 });
      expect(variationUpdate).toHaveBeenCalledWith({ where: { id: 'v-a' }, data: { retailPrice: 90_000, salePrice: null, stock: 5 } });
    });

    it('chưa bỏ mã thì vẫn không sửa được giá/tồn kho (400 như trước)', async () => {
      const { svc, productUpdate } = buildEdit(UNLINKED);
      await expect(svc.updateProduct('u1', 'prod-a', { stock: 5 })).rejects.toThrow('theo kho Tubu');
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('đổi sang mã khác còn liên kết được → ghi mã mới, về chờ duyệt, báo admin "Tubu giao hộ"', async () => {
      const { svc, productUpdate, productUpdateMany, notify, variationFindFirst } = buildEdit(
        { ...UNLINKED, isActive: true },
        { ...PANCAKE_ROW, pancakeId: 'PK-NEW' },
      );
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: ' PK-NEW ' });
      expect(variationFindFirst).toHaveBeenCalled();
      expect(productUpdateMany.mock.calls[0]![0].data).toEqual({ pancakeLinkCode: 'PK-NEW' });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', rejectReason: null });
      expect(notify).toHaveBeenCalledWith('admin-1', 'OPS_MERCHANT_PRODUCT_PENDING', expect.objectContaining({ mode: 'Tubu giao hộ' }));
    });

    it('sản phẩm đã bị admin gỡ liên kết (isActive=false) xin mã khác → mở bán lại cùng lúc, nếu không duyệt xong vẫn ẩn và SKU không bán ở đâu', async () => {
      const { svc, productUpdate } = buildEdit(UNLINKED, { ...PANCAKE_ROW, pancakeId: 'PK-NEW' });
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-NEW' });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', isActive: true });
    });

    it('sản phẩm bị từ chối rồi ngừng bán xin mã khác → cũng mở bán lại cùng lúc xin mã', async () => {
      const { svc, productUpdate } = buildEdit({ ...UNLINKED, approvalStatus: 'REJECTED', rejectReason: 'Mã đã có chủ' }, { ...PANCAKE_ROW, pancakeId: 'PK-NEW' });
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-NEW' });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', isActive: true });
    });

    it('vừa ngừng bán vừa xin mã Pancake mới là yêu cầu mâu thuẫn → 400, không ghi gì', async () => {
      const { svc, productUpdate, productUpdateMany } = buildEdit(UNLINKED, { ...PANCAKE_ROW, pancakeId: 'PK-NEW' });
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-NEW', isActive: false })).rejects.toThrow('vừa ngừng bán vừa xin mã Pancake mới');
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('bỏ mã (tự giao) không tự mở bán: trạng thái bán do đối tác chọn', async () => {
      const { svc, productUpdate } = buildEdit(UNLINKED);
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: null });
      expect(productUpdate.mock.calls[0]![0].data.isActive).toBeUndefined();
    });

    it('mã mới không có trong danh mục hoặc đã có chủ → 400, không ghi gì', async () => {
      const { svc, productUpdate, productUpdateMany, notify } = buildEdit(UNLINKED, null);
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-XX' })).rejects.toThrow('Mã biến thể Pancake không có trong danh mục');
      expect(productUpdate).not.toHaveBeenCalled();
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('đổi mã cùng lúc với sửa giá/tồn kho → 400 (sản phẩm đang chờ liên kết lấy giá và tồn theo Pancake)', async () => {
      const { svc, productUpdate } = buildEdit(UNLINKED);
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-NEW', basePrice: 90_000 })).rejects.toThrow('theo kho Tubu');
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('gửi lại đúng mã đang có → không đổi gì', async () => {
      const { svc, productUpdate, productUpdateMany, notify } = buildEdit(UNLINKED);
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-OLD' });
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(productUpdate.mock.calls[0]![0].data.approvalStatus).toBeUndefined();
      expect(notify).not.toHaveBeenCalled();
    });

    it('sản phẩm bị từ chối vì mã đã có chủ: nhập mã khác → về chờ duyệt, xoá lý do từ chối cũ', async () => {
      const { svc, productUpdate, productUpdateMany } = buildEdit({ ...UNLINKED, approvalStatus: 'REJECTED', rejectReason: 'Mã đã liên kết cho sản phẩm khác', isActive: true }, { ...PANCAKE_ROW, pancakeId: 'PK-NEW' });
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-NEW' });
      expect(productUpdateMany.mock.calls[0]![0].data).toEqual({ pancakeLinkCode: 'PK-NEW' });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', rejectReason: null });
    });

    it('sản phẩm bị từ chối: bỏ mã chuyển sang tự giao → gửi duyệt lại kiểu "Đối tác tự giao"', async () => {
      const { svc, productUpdate, productUpdateMany, notify } = buildEdit({ ...UNLINKED, approvalStatus: 'REJECTED', rejectReason: 'Mã đã liên kết cho sản phẩm khác', isActive: true });
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: null });
      expect(productUpdateMany.mock.calls[0]![0].data).toEqual({ pancakeLinkCode: null });
      expect(productUpdate.mock.calls[0]![0].data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', rejectReason: null });
      expect(notify).toHaveBeenCalledWith('admin-1', 'OPS_MERCHANT_PRODUCT_PENDING', expect.objectContaining({ mode: 'Đối tác tự giao' }));
    });

    it('sản phẩm Tubu giao hộ đang liên kết: không đổi/bỏ mã được, phải ngừng bán để gỡ liên kết trước', async () => {
      const { svc, productUpdate } = buildEdit({ ...OWN, fulfilment: 'TUBU', pancakeLinkCode: 'PK-1' });
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: null })).rejects.toThrow('đang được Tubu giao hộ');
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-2' })).rejects.toThrow('đang được Tubu giao hộ');
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('sản phẩm tự giao chưa có mã: không đổi sang Tubu giao hộ bằng cách thêm mã (đã có đơn/biến thể gắn với hàng của gian hàng)', async () => {
      const { svc, productUpdate, productUpdateMany } = buildEdit(OWN);
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: 'PK-9' })).rejects.toThrow('Sản phẩm tự giao không đổi sang Tubu giao hộ');
      expect(productUpdate).not.toHaveBeenCalled();
      await svc.updateProduct('u1', 'prod-a', { pancakeCode: null, basePrice: 180_000 });
      expect(productUpdateMany).not.toHaveBeenCalled();
    });

    it('admin duyệt (liên kết) cùng lúc: đổi mã có điều kiện trượt → 409, không ghi đè mã lên sản phẩm đã nhận biến thể', async () => {
      const { svc, productUpdate, productUpdateMany } = buildEdit(UNLINKED);
      productUpdateMany.mockResolvedValue({ count: 0 });
      await expect(svc.updateProduct('u1', 'prod-a', { pancakeCode: null })).rejects.toThrow(ConflictException);
      expect(productUpdate).not.toHaveBeenCalled();
    });
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
