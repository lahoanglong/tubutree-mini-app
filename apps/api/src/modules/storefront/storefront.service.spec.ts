import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorefrontService } from './storefront.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { AffiliateService } from '../affiliate/affiliate.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

// Mặc định không có bậc (null) — test nào cần assert huy hiệu bậc tự override qua tham số thứ 3.
const affiliate = {
  getPublicTier: async () => null,
  commissionEligibleRoles: async () => new Set(['AFFILIATE', 'DEALER']),
} as unknown as AffiliateService;

function makePrisma(over: Record<string, any> = {}) {
  const merged: Record<string, any> = {
    user: { findUniqueOrThrow: jest.fn() },
    storefront: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    ...over,
  };
  // Việc 6: createCollection/addItem giờ bọc count()+create() trong $transaction (Serializable) —
  // mock mặc định hỗ trợ CẢ 2 dạng $transaction Prisma dùng trong service: callback (chạy với
  // chính `merged`, tức tx === prisma trong test, giữ nguyên mọi mock count/create đã set qua
  // `over`) và mảng promise/thao tác (batch, dùng bởi reorderCollections/reorderItems). Test nào
  // tự truyền `$transaction` riêng qua `over` (vd giả lập P2034) thì giữ nguyên override đó.
  merged.$transaction =
    over.$transaction ??
    jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(merged) : Promise.all(arg as unknown[]),
    );
  return merged as unknown as PrismaService;
}

describe('StorefrontService.getOrCreateMine', () => {
  it('tạo gian hàng draft cho CTV nếu chưa có', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'u1', role: 'AFFILIATE', referralCode: 'LINH123', fullName: 'Linh',
    });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.storefront.create as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));

    const svc = new StorefrontService(prisma, config, affiliate);
    const sf = await svc.getOrCreateMine('u1');

    expect(prisma.storefront.create).toHaveBeenCalled();
    // P0 (audit mạch lạc CTV): referralCode LUÔN in hoa (auth.service.ts sinh bằng
    // toUpperCase), trong khi getPublicBySlug hạ chữ mã tra cứu rồi so khớp CHÍNH XÁC.
    // Postgres so sánh chuỗi phân biệt hoa/thường (đã kiểm trên DB thật: 'ABC' = 'abc' → false),
    // nên slug in hoa = gian hàng KHÔNG BAO GIỜ mở được qua link công khai.
    expect(sf.slug).toBe('linh123');
    expect(sf.type).toBe('CTV');
    expect(sf.title).toContain('Linh');
  });

  it('trả gian hàng có sẵn, không tạo mới', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'AFFILIATE', referralCode: 'L', fullName: 'L' });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', type: 'CTV' });

    const svc = new StorefrontService(prisma, config, affiliate);
    const sf = await svc.getOrCreateMine('u1');

    expect(sf.id).toBe('s1');
    expect(prisma.storefront.create).not.toHaveBeenCalled();
  });

  it('từ chối user không phải CTV', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', role: 'CUSTOMER', referralCode: 'L' });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.getOrCreateMine('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  // D3-03: CTV được duyệt lên đại lý giữ gian hàng CTV; mở lại được, nhưng đại lý không tạo gian hàng CTV mới
  // (mô hình bán lẻ online của đại lý chưa chốt, Q1).
  it('đại lý đang có gian hàng CTV: trả gian hàng đó, không tạo mới', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'd1', role: 'DEALER', referralCode: 'D', fullName: 'D' });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', type: 'CTV', isPartner: true });
    const sf = await new StorefrontService(prisma, config, affiliate).getOrCreateMine('d1');
    expect(sf.id).toBe('s1');
    expect(prisma.storefront.findFirst).toHaveBeenCalledWith({ where: { ownerUserId: 'd1', type: 'CTV' } });
    expect(prisma.storefront.create).not.toHaveBeenCalled();
  });

  it('đại lý chưa có gian hàng CTV: không tạo, báo như trước', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'd1', role: 'DEALER', referralCode: 'D', fullName: 'D' });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new StorefrontService(prisma, config, affiliate).getOrCreateMine('d1')).rejects.toThrow('Chỉ CTV mới tạo được gian hàng.');
    expect(prisma.storefront.create).not.toHaveBeenCalled();
  });
});

describe('StorefrontService.getMine', () => {
  it('trả gian hàng kèm collections+items (gồm cả isHidden) theo sortOrder', async () => {
    const sfWithChildren = {
      id: 's1', ownerUserId: 'u1', type: 'CTV',
      collections: [
        {
          id: 'c1',
          sortOrder: 0,
          items: [
            { id: 'i1', isHidden: true, product: { isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' } },
            { id: 'i2', isHidden: false, product: { isActive: true, affiliateBlocked: false, approvalStatus: 'PENDING_REVIEW' } },
            { id: 'i3', isHidden: false, product: { isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' } },
          ],
        },
      ],
    };
    const prisma = makePrisma();
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(sfWithChildren);
    const svc = new StorefrontService(prisma, config, affiliate);
    const sf = await svc.getMine('u1');

    // verify behavior: trả đúng cây dữ liệu, item ẩn vẫn còn (để CTV sửa)
    expect(sf.id).toBe('s1');
    const col0 = sf.collections[0]!;
    expect(col0.items).toHaveLength(3);
    expect(col0.items.some((i: any) => i.isHidden === true)).toBe(true);
    // SELLER-15: builder biết món nào khách không thấy và vì sao.
    expect(col0.items.map((i: any) => i.hiddenReason)).toEqual([
      'Bạn đang ẩn món này',
      'Sản phẩm chưa được duyệt bán',
      null,
    ]);
    // include đúng: có collections.orderBy sortOrder + items
    const arg = (prisma.storefront.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ ownerUserId: 'u1', type: 'CTV' });
    expect(arg.include.collections.orderBy).toEqual({ sortOrder: 'asc' });
    expect(arg.include.collections.include.items).toBeDefined();
  });

  it('throw NotFound khi chưa có gian hàng', async () => {
    const prisma = makePrisma();
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.getMine('u1')).rejects.toThrow();
  });
});

describe('StorefrontService.updateMine/publishMine', () => {
  it('cập nhật title/note/theme', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.updateMine('u1', { title: 'Shop Linh', headerNote: 'xin chào', theme: 'leaf-orange' });
    expect(r.title).toBe('Shop Linh');
    expect(prisma.storefront.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  // P0-1 (docs/2026-09-08-review-progress.md): trước đây chỉ kiểm trùng subdomain-với-subdomain
  // — CTV có thể chiếm subdomain trùng SLUG của gian hàng khác.
  it('chặn subdomain trùng SLUG (không phải subdomain) của gian hàng khác', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 's1', ownerUserId: 'u1' }) // assertOwnedStorefront
      .mockResolvedValueOnce({ id: 's-other', slug: 'organic-tea' }); // trùng SLUG
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.updateMine('u1', { subdomain: 'organic-tea' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefront.update).not.toHaveBeenCalled();
  });

  it('subdomain hợp lệ, không trùng ai → cập nhật thành công', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValueOnce({ id: 's1', ownerUserId: 'u1' }).mockResolvedValueOnce(null);
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.updateMine('u1', { subdomain: 'Pure-Green' });
    expect(r.subdomain).toBe('pure-green');
  });

  it('gửi lại đúng subdomain đang lưu (builder luôn gửi kèm): không kiểm từ khoá hay trùng, không ghi lại, vẫn lưu được trường khác', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1', subdomain: 'admin' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma, config, affiliate);
    await svc.updateMine('u1', { subdomain: ' Admin ', title: 'Shop mới' });
    expect(prisma.storefront.findFirst).toHaveBeenCalledTimes(1);
    expect((prisma.storefront.update as jest.Mock).mock.calls[0][0].data).toEqual({ title: 'Shop mới' });
  });

  it('đổi sang subdomain khác vẫn bị kiểm từ khoá hệ thống', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1', subdomain: 'lan-xanh' });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.updateMine('u1', { subdomain: 'admin' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefront.update).not.toHaveBeenCalled();
  });

  it('publish set isPublished + publishedAt', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn(), update: jest.fn() }, storefrontItem: { count: jest.fn().mockResolvedValue(2) } });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue({ id: 's1', ownerUserId: 'u1' });
    (prisma.storefront.update as jest.Mock).mockImplementation(({ data }) => ({ id: 's1', ...data }));
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.publishMine('u1', true);
    expect(r.isPublished).toBe(true);
    expect(r.publishedAt).toBeInstanceOf(Date);
  });
});

describe('StorefrontService collections', () => {
  it('createCollection gắn vào storefront của tôi, sortOrder kế tiếp', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { count: jest.fn().mockResolvedValue(2), create: jest.fn().mockImplementation(({ data }) => ({ id: 'c3', ...data })) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const c = await svc.createCollection('u1', { title: 'Skincare' });
    expect(c.storefrontId).toBe('s1');
    expect(c.sortOrder).toBe(2);
    expect(c.kind).toBe('NORMAL');
    // Việc 6: count()+create() phải chạy TRONG $transaction Serializable (chống 2 request tạo
    // collection đồng thời trùng sortOrder), không còn gọi count()/create() trực tiếp trên prisma.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('createCollection: race sortOrder đụng Serializable (P2034) → báo thân thiện, không phải lỗi thô', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' }),
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.createCollection('u1', { title: 'Skincare' })).rejects.toThrow(
      'Hệ thống đang bận xử lý, vui lòng thử lại.',
    );
  });

  // P0 (docs/2026-09-08-review-progress.md): comboDiscountPct chỉ bị chặn ở DTO (Max 100) —
  // CTV tự đăng ký (POST /affiliate/register không cần duyệt) đặt combo 100% trên gian hàng
  // của MÌNH thì đơn thật thành 0đ (shop trả tiền). Server phải tự clamp theo config, KHÔNG
  // chỉ tin DTO — trần business khác với trần kiểu dữ liệu.
  it('createCollection COMBO: comboDiscountPct vượt trần cấu hình → CLAMP về trần, không lưu nguyên giá trị CTV gửi', async () => {
    const create = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'c3', ...data }));
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { count: jest.fn().mockResolvedValue(0), create },
    });
    const cappedConfig = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'storefront.max_combo_pct' ? (30 as unknown as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const svc = new StorefrontService(prisma, cappedConfig, affiliate);
    await svc.createCollection('u1', { title: 'Combo sập sàn', kind: 'COMBO', comboDiscountPct: 100 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ comboDiscountPct: 30 }) }));
  });

  it('createCollection COMBO: comboDiscountPct dưới trần → giữ nguyên', async () => {
    const create = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'c3', ...data }));
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { count: jest.fn().mockResolvedValue(0), create },
    });
    const cappedConfig = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'storefront.max_combo_pct' ? (30 as unknown as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const svc = new StorefrontService(prisma, cappedConfig, affiliate);
    await svc.createCollection('u1', { title: 'Combo hợp lý', kind: 'COMBO', comboDiscountPct: 15 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ comboDiscountPct: 15 }) }));
  });

  it('reorderCollections cập nhật sortOrder theo thứ tự mảng', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      storefrontCollection: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), update: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await svc.reorderCollections('u1', ['b', 'a']);
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sortOrder: 1 } });
  });

  it('updateCollection: owner sửa được', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.updateCollection('u1', 'c1', { title: 'New' });
    expect(r.title).toBe('New');
    expect(prisma.storefrontCollection.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { title: 'New' } });
  });

  it('updateCollection: comboDiscountPct vượt trần cấu hình → CLAMP về trần', async () => {
    const update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }));
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }),
        update,
      },
    });
    const cappedConfig = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'storefront.max_combo_pct' ? (30 as unknown as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const svc = new StorefrontService(prisma, cappedConfig, affiliate);
    await svc.updateCollection('u1', 'c1', { comboDiscountPct: 90 });
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { comboDiscountPct: 30 } });
  });

  it('updateCollection: non-owner bị reject, không gọi update', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'OTHER' } }),
        update: jest.fn(),
      },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.updateCollection('u1', 'c1', { title: 'New' })).rejects.toThrow();
    expect(prisma.storefrontCollection.update).not.toHaveBeenCalled();
  });

  it('deleteCollection: owner xoá được', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }),
        delete: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.deleteCollection('u1', 'c1');
    expect(r).toEqual({ ok: true });
    expect(prisma.storefrontCollection.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('deleteCollection: non-owner bị reject, không gọi delete', async () => {
    const prisma = makePrisma({
      storefrontCollection: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'OTHER' } }),
        delete: jest.fn(),
      },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.deleteCollection('u1', 'c1')).rejects.toThrow();
    expect(prisma.storefrontCollection.delete).not.toHaveBeenCalled();
  });
});

describe('StorefrontService.applyTemplate', () => {
  function makeTemplatePrisma(over: Record<string, any> = {}) {
    return makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1' }) },
      category: { findUnique: jest.fn().mockResolvedValue({ id: 'cat1', name: 'Mẹ & bé' }) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]) },
      storefrontCollection: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'newcol', ...data })),
      },
      storefrontItem: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      ...over,
    });
  }

  it('tạo 1 collection tên theo category + item cho tối đa 8 SP nổi bật, sortOrder 0..N-1', async () => {
    const prisma = makeTemplatePrisma();
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.applyTemplate('u1', 'cat1');

    expect((prisma.product.findMany as jest.Mock).mock.calls[0]?.[0]).toEqual({
      // D3-16: như picker — món đối tác chờ duyệt/bị từ chối không lọt vào gian hàng mà khách không thấy.
      where: { categoryIds: { has: 'cat1' }, isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take: 8,
      select: { id: true },
    });
    expect((prisma.storefrontCollection.create as jest.Mock).mock.calls[0]?.[0].data).toMatchObject({
      storefrontId: 's1', title: 'Mẹ & bé', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0,
    });
    expect((prisma.storefrontItem.createMany as jest.Mock).mock.calls[0]?.[0].data).toEqual([
      { collectionId: 'newcol', productId: 'p1', sortOrder: 0 },
      { collectionId: 'newcol', productId: 'p2', sortOrder: 1 },
      { collectionId: 'newcol', productId: 'p3', sortOrder: 2 },
    ]);
    expect(r).toEqual({ collectionId: 'newcol', title: 'Mẹ & bé', itemCount: 3 });
  });

  it('category không tồn tại → BadRequest, KHÔNG đụng transaction', async () => {
    const prisma = makeTemplatePrisma({ category: { findUnique: jest.fn().mockResolvedValue(null) } });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.applyTemplate('u1', 'bad')).rejects.toThrow();
    expect(prisma.storefrontCollection.create).not.toHaveBeenCalled();
  });

  it('category chưa có sản phẩm nào → BadRequest, KHÔNG tạo collection rỗng', async () => {
    const prisma = makeTemplatePrisma({ product: { findMany: jest.fn().mockResolvedValue([]) } });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.applyTemplate('u1', 'cat1')).rejects.toThrow();
    expect(prisma.storefrontCollection.create).not.toHaveBeenCalled();
  });

  it('gian hàng ĐÃ có collection → từ chối, không đè lên gian hàng CTV tự dựng', async () => {
    const prisma = makeTemplatePrisma({ storefrontCollection: { count: jest.fn().mockResolvedValue(2), create: jest.fn() } });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.applyTemplate('u1', 'cat1')).rejects.toThrow();
    expect(prisma.storefrontCollection.create).not.toHaveBeenCalled();
  });

  it('race sortOrder đụng Serializable (P2034) → báo thân thiện, không phải lỗi thô', async () => {
    const prisma = makeTemplatePrisma({
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }),
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.applyTemplate('u1', 'cat1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StorefrontService items', () => {
  it('addItem gắn vào collection của tôi', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' }) },
      storefrontItem: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockImplementation(({ data }) => ({ id: 'i2', ...data })) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const it = await svc.addItem('u1', 'c1', { productId: 'p1', note: 'thích' });
    expect(it.collectionId).toBe('c1');
    expect(it.productId).toBe('p1');
    expect(it.sortOrder).toBe(1);
    // Việc 6: count()+create() phải chạy TRONG $transaction Serializable (chống 2 request thêm
    // item đồng thời vào cùng collection trùng sortOrder).
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('addItem: race sortOrder đụng Serializable (P2034) → báo thân thiện, không phải lỗi thô', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' }) },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' }),
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.addItem('u1', 'c1', { productId: 'p1' })).rejects.toThrow(
      'Hệ thống đang bận xử lý, vui lòng thử lại.',
    );
  });

  it('addItem chặn SP affiliateBlocked=true, không tạo item', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, affiliateBlocked: true }) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.addItem('u1', 'c1', { productId: 'p1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('addItem chặn SP isActive=false, không tạo item', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: false, affiliateBlocked: false }) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.addItem('u1', 'c1', { productId: 'p1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('Q8 S2: không thêm hàng của gian hàng đối tác vào combo (báo rõ lý do); bộ sưu tập thường vẫn thêm được', async () => {
    const partner = { id: 'p9', name: 'Mật ong rừng', isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED', storefrontId: 'sf-doi-tac' };
    const combo = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', kind: 'COMBO', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue(partner) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    await expect(new StorefrontService(combo, config, affiliate).addItem('u1', 'c1', { productId: 'p9' })).rejects.toMatchObject({
      response: {
        code: 'PARTNER_GOODS_NOT_ELIGIBLE',
        message: 'Sản phẩm "Mật ong rừng" là hàng của gian hàng đối tác, không thêm vào combo được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.',
      },
    });
    expect(combo.storefrontItem.create).not.toHaveBeenCalled();

    const normal = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c2', kind: 'NORMAL', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue(partner) },
      storefrontItem: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation(({ data }) => ({ id: 'i1', ...data })) },
    });
    expect((await new StorefrontService(normal, config, affiliate).addItem('u1', 'c2', { productId: 'p9' })).productId).toBe('p9');

    const tubu = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', kind: 'COMBO', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue({ ...partner, id: 'p1', storefrontId: null }) },
      storefrontItem: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation(({ data }) => ({ id: 'i2', ...data })) },
    });
    expect((await new StorefrontService(tubu, config, affiliate).addItem('u1', 'c1', { productId: 'p1' })).productId).toBe('p1');
  });

  it('addItem chặn productId không tồn tại', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      storefrontItem: { count: jest.fn(), create: jest.fn() },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.addItem('u1', 'c1', { productId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storefrontItem.create).not.toHaveBeenCalled();
  });

  it('updateItem chặn người không sở hữu', async () => {
    const prisma = makePrisma({
      storefrontItem: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', collection: { storefront: { ownerUserId: 'OTHER' } } }) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.updateItem('u1', 'i1', { isHidden: true })).rejects.toThrow();
  });

  it('removeItem: owner xoá item của mình', async () => {
    const prisma = makePrisma({
      storefrontItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'i1', collection: { storefront: { ownerUserId: 'u1' } } }),
        delete: jest.fn().mockResolvedValue({ id: 'i1' }),
      },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.removeItem('u1', 'i1');
    expect(r).toEqual({ ok: true });
    expect(prisma.storefrontItem.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });

  it('reorderItems: chỉ cập nhật id thuộc collection, id lạ bị loại khỏi ops', async () => {
    const prisma = makePrisma({
      storefrontCollection: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', storefront: { ownerUserId: 'u1' } }) },
      storefrontItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    // 'STRANGER' không thuộc collection → phải bị loại
    await svc.reorderItems('u1', 'c1', ['i2', 'STRANGER', 'i1']);
    expect(prisma.storefrontItem.update).toHaveBeenCalledWith({ where: { id: 'i2' }, data: { sortOrder: 0 } });
    expect(prisma.storefrontItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { sortOrder: 1 } });
    // id lạ KHÔNG được cập nhật, và chỉ có đúng 2 lần update
    expect(prisma.storefrontItem.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'STRANGER' } }),
    );
    expect(prisma.storefrontItem.update).toHaveBeenCalledTimes(2);
  });
});

describe('StorefrontService.pickerProducts', () => {
  it('loại SP affiliateBlocked, trả maxRate', async () => {
    const prisma = makePrisma({
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'AFFILIATE' }) },
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Dầu gội', slug: 'dau-goi', thumbnail: 't', basePrice: 189000, salePrice: null, ratingAvg: 4.8, reviewCount: 42,
          variations: [{ affiliateRate: '8' }, { affiliateRate: '10' }] },
      ]) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.pickerProducts('u1', { search: 'dầu' });
    expect((prisma.product.findMany as jest.Mock).mock.calls[0]?.[0].where.affiliateBlocked).toBe(false);
    // SELLER-15: SP đối tác chưa duyệt không vào picker.
    expect((prisma.product.findMany as jest.Mock).mock.calls[0]?.[0].where.approvalStatus).toBe('APPROVED');
    const first = r[0]!;
    expect(first.maxAffiliateRate).toBe(10);
    expect(first.name).toBe('Dầu gội');
    // KHÔNG lộ mảng variations (chứa affiliateRate từng biến thể) cho CTV
    expect((first as any).variations).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('affiliateRate');
  });
});

describe('StorefrontService.pickerProducts cho đại lý (D3-03)', () => {
  const picker = (role: string, trace: { storefront?: boolean; commission?: boolean }) => {
    const prisma = makePrisma({
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { findFirst: jest.fn().mockResolvedValue(trace.commission ? { id: 'c1' } : null) },
    });
    (prisma.storefront.findFirst as jest.Mock).mockResolvedValue(trace.storefront ? { id: 's1' } : null);
    return new StorefrontService(prisma, config, affiliate).pickerProducts('u1', {});
  };

  it('đại lý có gian hàng CTV hoặc có hoa hồng xem được danh sách', async () => {
    await expect(picker('DEALER', { storefront: true })).resolves.toEqual([]);
    await expect(picker('DEALER', { commission: true })).resolves.toEqual([]);
  });

  it('đại lý thuần và khách thường vẫn không xem được % hoa hồng', async () => {
    await expect(picker('DEALER', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(picker('CUSTOMER', { storefront: true, commission: true })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StorefrontService.getStats', () => {
  it('đọc doanh thu/đơn/sản phẩm từ SQL gộp (không nạp đơn về Node), hoa hồng từ bảng Commission', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([{ slug: 'linh', orders: 3n, revenue: 700000n }])
      .mockResolvedValueOnce([{ slug: 'linh', orders: 2n, revenue: 100000n }])
      .mockResolvedValueOnce([
        { productSlug: 'p1', productName: 'P1', qty: 1n, revenue: 100000n },
        { productSlug: 'p2', productName: 'P2', qty: 6n, revenue: 550000n },
      ]);
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', slug: 'linh', ownerUserId: 'u1' }) },
      order: { findMany: jest.fn() },
      commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 8000 } }) },
      $queryRaw: queryRaw,
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.getStats('u1');

    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect((prisma.commission.aggregate as jest.Mock).mock.calls[0]?.[0].where).toEqual({
      affiliateUserId: 'u1', order: { storefrontSlug: 'linh' },
      createdAt: { gte: expect.any(Date) }, status: { not: 'REJECTED' },
    });
    expect(r).toEqual({
      orders7d: 2,
      orders30d: 3,
      revenue30d: 700000,
      commission30d: 8000,
      byProduct: [
        { productSlug: 'p2', productName: 'P2', qty: 6, revenue: 550000 },
        { productSlug: 'p1', productName: 'P1', qty: 1, revenue: 100000 },
      ],
      shippingAndOrderDiscount30d: 50000,
    });
  });

  it('ẩn dòng đã trả hết (0 món), phần cấp đơn = doanh thu − tổng các dòng còn hiện', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([{ slug: 'linh', orders: 2n, revenue: 90000n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { productSlug: 'p1', productName: 'P1', qty: 0n, revenue: 0n },
        { productSlug: 'p2', productName: 'P2', qty: 1n, revenue: 120000n },
      ]);
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', slug: 'linh', ownerUserId: 'u1' }) },
      commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
      $queryRaw: queryRaw,
    });
    const r = await new StorefrontService(prisma, config, affiliate).getStats('u1');
    expect(r.byProduct).toEqual([{ productSlug: 'p2', productName: 'P2', qty: 1, revenue: 120000 }]);
    expect(r.orders7d).toBe(0);
    expect(r.shippingAndOrderDiscount30d).toBe(-30000);
  });

  it('404 nếu chưa có gian hàng', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.getStats('u1')).rejects.toThrow();
  });
});

describe('StorefrontService.getPublicList', () => {
  it('chỉ lấy gian hàng isPublished, sắp updatedAt giảm dần, giới hạn 500', async () => {
    const findMany = jest.fn().mockResolvedValue([{ slug: 'a', updatedAt: new Date() }]);
    const prisma = makePrisma({ storefront: { findMany } });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.getPublicList();
    expect(findMany.mock.calls[0]?.[0]).toEqual({
      where: expect.objectContaining({ isPublished: true, takenDownAt: null }),
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    expect(r).toEqual([{ slug: 'a', updatedAt: expect.any(Date) }]);
  });
});

describe('StorefrontService.getPublicBySlug', () => {
  // SELLER-4: khách vào qua subdomain riêng (khác mã giới thiệu) thì web phải lấy mã từ API, không suy từ URL.
  it('gian hàng CTV trả mã giới thiệu của chủ; gian hàng khác không trả', async () => {
    const row = { id: 's1', slug: 'abcd1234', subdomain: 'lan-xanh', title: 'Shop', isPublished: true, collections: [], owner: { referralCode: 'ABCD1234' } };
    const ctv = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...row, type: 'CTV', ownerUserId: 'u9' }) } });
    const affiliateTier = { getPublicTier: jest.fn().mockResolvedValue(null), commissionEligibleRoles: async () => new Set(['AFFILIATE']) } as never;
    expect((await new StorefrontService(ctv, config, affiliateTier).getPublicBySlug('lan-xanh')).referralCode).toBe('ABCD1234');
    const brand = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...row, type: 'MERCHANT' }) } });
    expect((await new StorefrontService(brand, config, affiliateTier).getPublicBySlug('lan-xanh')).referralCode).toBeNull();
  });

  // SELLER-9: route @Public, ai cũng gọi được — STK và họ tên chủ TK của CTV là dữ liệu cá nhân, không
  // trang công khai nào dùng (thanh toán luôn vào TK Tubu, xem bank-transfer.service).
  it('không trả thông tin ngân hàng của chủ gian hàng', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'ctvone1', title: 'Shop', isPublished: true, type: 'MERCHANT', collections: [],
        bankName: 'Vietcombank', bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN CTV MOT',
      }) },
    });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('ctvone1');
    const json = JSON.stringify(r);
    for (const leak of ['bankName', 'bankBin', 'bankAccountNo', 'bankAccountName', '0123456789', 'NGUYEN CTV MOT']) {
      expect(json).not.toContain(leak);
    }
  });

  it('SELLER-8: gian hàng CTV không tự giao nên không trả kho/SĐT kho (dữ liệu cũ còn lưu cũng không lộ); gian hàng đối tác vẫn trả', async () => {
    const base = {
      id: 's1', slug: 'ctvone', title: 'Shop', isPublished: true, collections: [], owner: { referralCode: 'ABCD1234' },
      warehouseAddress: '1 Lê Lợi', warehouseCity: 'HCM', warehouseDistrict: 'Q1', warehouseWard: 'P1', warehousePhone: '0955555555',
    };
    const ctv = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...base, type: 'CTV', ownerUserId: 'u9' }) } });
    const r = await new StorefrontService(ctv, config, affiliate).getPublicBySlug('ctvone');
    expect(JSON.stringify(r)).not.toContain('0955555555');
    expect(JSON.stringify(r)).not.toContain('1 Lê Lợi');
    const merchant = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...base, type: 'MERCHANT' }) } });
    expect((await new StorefrontService(merchant, config, affiliate).getPublicBySlug('ctvone')).warehousePhone).toBe('0955555555');
  });

  it('SELLER-8: CTV sửa gian hàng → không lưu kho/SĐT kho', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', type: 'CTV', subdomain: null }), update },
    });
    await new StorefrontService(prisma, config, affiliate).updateMine('u9', { title: 'Mới', warehousePhone: '0955555555', warehouseAddress: 'x' });
    expect(update.mock.calls[0][0].data).toEqual({ title: 'Mới' });
  });

  it('SELLER-8: gian hàng MERCHANT sửa qua updateMine → vẫn lưu kho và hotline', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's2', type: 'MERCHANT', subdomain: null }), update },
    });
    await new StorefrontService(prisma, config, affiliate).updateMine('u8', {
      title: 'Shop', warehousePhone: '0955555555', warehouseAddress: '1 Lê Lợi', warehouseCity: '',
    });
    expect(update.mock.calls[0][0].data).toEqual({
      title: 'Shop', warehousePhone: '0955555555', warehouseAddress: '1 Lê Lợi', warehouseCity: null,
    });
  });

  it('hợp đồng: trang công khai luôn có isPartner (boolean) và giữ nguyên type; CTV của đại lý có cờ vẫn trả kho và mã giới thiệu', async () => {
    const base = {
      id: 's1', slug: 'ctvone', title: 'Shop', isPublished: true, collections: [], owner: { referralCode: 'ABCD1234' }, ownerUserId: 'u9',
      warehouseAddress: '1 Lê Lợi', warehousePhone: '0955555555',
    };
    const read = async (row: Record<string, unknown>) =>
      new StorefrontService(makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...base, ...row }) } }), config, affiliate).getPublicBySlug('ctvone');
    const plain = await read({ type: 'CTV', isPartner: false });
    expect(plain).toMatchObject({ type: 'CTV', isPartner: false, referralCode: 'ABCD1234' });
    const dealerCtv = await read({ type: 'CTV', isPartner: true });
    expect(dealerCtv).toMatchObject({ type: 'CTV', isPartner: true, referralCode: 'ABCD1234', warehousePhone: '0955555555' });
    expect(await read({ type: 'MERCHANT', isPartner: false })).toMatchObject({ type: 'MERCHANT', isPartner: true });
    expect(await read({ type: 'BRAND', isPartner: false })).toMatchObject({ type: 'BRAND', isPartner: false });
    expect(typeof (await read({ type: 'CTV' })).isPartner).toBe('boolean');
  });

  it('PATCH /storefront/me: gian hàng CTV của đại lý (isPartner) lưu kho/hotline như updateStore của Cổng người bán', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's3', type: 'CTV', isPartner: true, subdomain: null }), update },
    });
    await new StorefrontService(prisma, config, affiliate).updateMine('u7', { title: 'Mới', warehousePhone: '0955555555' });
    expect(update.mock.calls[0][0].data).toEqual({ title: 'Mới', warehousePhone: '0955555555' });
  });

  it('Q8 S2: hàng của gian hàng đối tác đã nằm trong combo thì không hiện trong combo (không được giảm); bộ sưu tập thường vẫn hiện', async () => {
    const item = (id: string, storefrontId: string | null) => ({
      id: `i-${id}`, note: null, variationId: null, isHidden: false,
      product: {
        id, name: `SP ${id}`, slug: id, thumbnail: null, brand: 'B', basePrice: 100_000, salePrice: null, ratingAvg: 0, reviewCount: 0,
        isActive: true, affiliateBlocked: false, soldExternal: 0, soldApp: 0, approvalStatus: 'APPROVED', storefrontId, variations: [{ stock: 1 }],
      },
    });
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'ctv', title: 'Shop', isPublished: true, type: 'CTV', ownerUserId: 'u9', owner: { referralCode: 'ABCD1234' },
        collections: [
          { id: 'c1', title: 'Combo', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 10, items: [item('p1', null), item('p2', null), item('p9', 'sf-doi-tac')] },
          { id: 'c2', title: 'Gợi ý', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: [item('p9', 'sf-doi-tac')] },
        ],
      }) },
    });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('ctv');
    expect(r.collections.map((c) => c.items.map((i) => i.product.id))).toEqual([['p1', 'p2'], ['p9']]);
    expect(JSON.stringify(r)).not.toContain('sf-doi-tac');
  });

  it('Q8 review vòng 3 S4: combo còn dưới 2 sản phẩm được giảm (bỏ hàng của gian hàng đối tác) → không còn mức giảm combo để hiện; combo đủ 2 sản phẩm vẫn giữ', async () => {
    const item = (id: string, storefrontId: string | null) => ({
      id: `i-${id}`, note: null, variationId: null, isHidden: false,
      product: {
        id, name: `SP ${id}`, slug: id, thumbnail: null, brand: 'B', basePrice: 100_000, salePrice: null, ratingAvg: 0, reviewCount: 0,
        isActive: true, affiliateBlocked: false, soldExternal: 0, soldApp: 0, approvalStatus: 'APPROVED', storefrontId, variations: [{ stock: 1 }],
      },
    });
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'ctv', title: 'Shop', isPublished: true, type: 'CTV', ownerUserId: 'u9', owner: { referralCode: 'ABCD1234' },
        collections: [
          { id: 'c1', title: 'Combo 1 Tubu + 1 đối tác', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 10, items: [item('p1', null), item('p9', 'sf-doi-tac')] },
          { id: 'c2', title: 'Combo 2 Tubu', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 15, items: [item('p1', null), item('p2', null), item('p9', 'sf-doi-tac')] },
          { id: 'c3', title: 'Combo 1 sản phẩm 2 biến thể', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 12, items: [item('p3', null), { ...item('p3', null), id: 'i-p3b' }] },
        ],
      }) },
    });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('ctv');
    expect(r.collections.map((c) => [c.id, c.kind, c.comboDiscountPct, c.items.length])).toEqual([
      ['c1', 'COMBO', null, 1],
      ['c2', 'COMBO', 15, 2],
      ['c3', 'COMBO', null, 2],
    ]);
  });

  it('404 nếu chưa publish', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.getPublicBySlug('x')).rejects.toThrow();
  });

  it('ẩn item isHidden + loại SP inactive/affiliateBlocked + không trả affiliateRate', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true,
        collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0,
          items: [
            { id: 'i1', isHidden: false, isPinned: false, sortOrder: 0, note: null, variationId: null,
              product: { id: 'p1', name: 'P1', slug: 'p1', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 4.5, reviewCount: 3, isActive: true, affiliateBlocked: false } },
            { id: 'i2', isHidden: true, isPinned: false, sortOrder: 1, note: null, variationId: null,
              product: { id: 'p2', name: 'P2', slug: 'p2', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: false } },
            { id: 'i3', isHidden: false, isPinned: false, sortOrder: 2, note: null, variationId: null,
              product: { id: 'p3', name: 'P3', slug: 'p3', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: true } },
          ] }],
      }) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.getPublicBySlug('linh');
    const col0 = r.collections[0]!;
    // i2 ẩn (isHidden), i3 bị chặn (affiliateBlocked) → chỉ còn i1
    expect(col0.items).toHaveLength(1);
    expect(col0.items[0]!.id).toBe('i1');
    // affiliateRate không lộ; affiliateBlocked chỉ dùng để lọc, không nằm trong output
    expect(JSON.stringify(r)).not.toContain('affiliateRate');
    expect(JSON.stringify(r)).not.toContain('affiliateBlocked');
  });

  it('tính inStock từ variations.stock (audit A4-06 — lưới gian hàng trước đây không biết SP hết hàng)', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true,
        collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0,
          items: [
            { id: 'i1', isHidden: false, isPinned: false, sortOrder: 0, note: null, variationId: null,
              product: { id: 'p1', name: 'Còn hàng', slug: 'p1', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: false, variations: [{ stock: 0 }, { stock: 5 }] } },
            { id: 'i2', isHidden: false, isPinned: false, sortOrder: 1, note: null, variationId: null,
              product: { id: 'p2', name: 'Hết hàng', slug: 'p2', thumbnail: 't', brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: false, variations: [{ stock: 0 }] } },
          ] }],
      }) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const r = await svc.getPublicBySlug('linh');
    const items = r.collections[0]!.items;
    expect(items.find((i) => i.id === 'i1')!.product.inStock).toBe(true);
    expect(items.find((i) => i.id === 'i2')!.product.inStock).toBe(false);
    // Chỉ tính variation đang bán (isActive) — variation ngừng bán còn tồn kho không làm SP "còn hàng".
    const arg = (prisma.storefront.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.include.collections.include.items.include.product.select.variations)
      .toEqual({ where: { isActive: true }, select: { stock: true } });
  });

  it('SP chỉ còn tồn kho ở variation ngừng bán → inStock=false (DB lọc isActive nên mảng rỗng)', async () => {
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true,
        collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', sortOrder: 0,
          items: [{ id: 'i1', isHidden: false, isPinned: false, sortOrder: 0, note: null, variationId: null,
            product: { id: 'p1', name: 'P', slug: 'p1', thumbnail: 't', brand: 'B', basePrice: 1, salePrice: null, ratingAvg: 0, reviewCount: 0, isActive: true, affiliateBlocked: false, variations: [] } }] }],
      }) },
    });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('linh');
    expect(r.collections[0]!.items[0]!.product.inStock).toBe(false);
  });

  it('gian hàng CTV → trả ownerTier (tên+icon), gọi affiliate.getPublicTier đúng ownerUserId', async () => {
    const getPublicTier = jest.fn().mockResolvedValue({ name: 'Bạc', emoji: '🌳' });
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'linh', title: 'Shop', isPublished: true, type: 'CTV', ownerUserId: 'u1', collections: [],
      }) },
    });
    const svc = new StorefrontService(prisma, config, { getPublicTier, commissionEligibleRoles: async () => new Set(['AFFILIATE']) } as unknown as AffiliateService);
    const r = await svc.getPublicBySlug('linh');
    expect(r.ownerTier).toEqual({ name: 'Bạc', emoji: '🌳' });
    expect(getPublicTier).toHaveBeenCalledWith('u1');
  });

  it('gian hàng MERCHANT/BRAND → ownerTier null, KHÔNG gọi affiliate (bậc chỉ có ý nghĩa cho CTV)', async () => {
    const getPublicTier = jest.fn();
    const prisma = makePrisma({
      storefront: { findFirst: jest.fn().mockResolvedValue({
        id: 's1', slug: 'shop', title: 'Shop', isPublished: true, type: 'MERCHANT', ownerUserId: 'u1', collections: [],
      }) },
    });
    const svc = new StorefrontService(prisma, config, { getPublicTier, commissionEligibleRoles: async () => new Set(['AFFILIATE']) } as unknown as AffiliateService);
    const r = await svc.getPublicBySlug('shop');
    expect(r.ownerTier).toBeNull();
    expect(getPublicTier).not.toHaveBeenCalled();
  });
});

describe('StorefrontService.pickerProducts — guardrail role', () => {
  it('CUSTOMER gọi picker → BadRequest (không lộ %HH cho khách)', async () => {
    const prisma = makePrisma({
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'CUSTOMER' }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    await expect(svc.pickerProducts('u1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).product.findMany).not.toHaveBeenCalled();
  });

  it('AFFILIATE gọi picker → trả SP kèm maxAffiliateRate', async () => {
    const prisma = makePrisma({
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'AFFILIATE' }) },
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'X', slug: 'x', thumbnail: null, brand: 'B', basePrice: 100, salePrice: null, ratingAvg: 0, reviewCount: 0, variations: [{ affiliateRate: 8 }] },
      ]) },
    });
    const svc = new StorefrontService(prisma, config, affiliate);
    const out = await svc.pickerProducts('u1', {});
    expect(out[0]!.maxAffiliateRate).toBe(8);
  });
});


describe('StorefrontService.getPublicBySlug — không phân biệt hoa/thường', () => {
  it('tra cứu khớp cả slug in hoa còn sót trong DB (dữ liệu tạo trước bản vá)', async () => {
    const prisma = makePrisma();
    const found = jest.fn().mockResolvedValue(null);
    (prisma.storefront.findFirst as jest.Mock) = found;
    const svc = new StorefrontService(prisma, config, affiliate);
    await svc.getPublicBySlug('LINH123').catch(() => undefined);
    const where = found.mock.calls[0][0].where;
    // Mỗi nhánh OR phải so khớp không phân biệt hoa/thường, nếu không slug cũ vẫn chết.
    for (const branch of where.OR) {
      const field = Object.values(branch)[0] as { mode?: string };
      expect(field.mode).toBe('insensitive');
    }
  });
});

/**
 * FE gửi chuỗi RỖNG khi CTV chủ động xoá ảnh/lời nhắn (gửi undefined thì PATCH bỏ qua trường đó,
 * nên xoá xong ảnh cũ vẫn còn trên gian hàng công khai). Lưu '' thay vì null sẽ làm bẩn dữ liệu
 * và khiến điều kiện `Boolean(sf.avatarUrl && ...)` của nhiệm vụ hồ sơ đọc khó hiểu.
 */
describe('StorefrontService.updateMine — xoá được ảnh/lời nhắn', () => {
  function mk() {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 'sf1', ownerUserId: 'u1' }), update },
    } as unknown as PrismaService;
    return { svc: new StorefrontService(prisma, config, affiliate), update };
  }

  it('chuỗi rỗng → ghi null (xoá thật)', async () => {
    const { svc, update } = mk();
    await svc.updateMine('u1', { coverUrl: '', headerNote: '   ' });
    expect(update.mock.calls[0][0].data).toEqual({ coverUrl: null, headerNote: null });
  });

  it('undefined → không đụng tới trường đó', async () => {
    const { svc, update } = mk();
    await svc.updateMine('u1', { coverUrl: undefined, headerNote: 'xin chào' });
    expect(update.mock.calls[0][0].data).toEqual({ headerNote: 'xin chào' });
  });
});

describe('StorefrontService.getPublicByHost', () => {
  const mk = () => {
    const prisma = makePrisma();
    return { svc: new StorefrontService(prisma, config, affiliate), prisma };
  };

  it.each([[['a.tubutree.vn', 'b.tubutree.vn']], [{ x: 1 }], [undefined], [''], [123]])(
    'host %p không phải chuỗi hợp lệ → 400 "Host không hợp lệ.", không chạm DB',
    async (host) => {
      const { svc, prisma } = mk();
      const err = await svc.getPublicByHost(host as unknown as string).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe('Host không hợp lệ.');
      expect((prisma.storefront.findFirst as jest.Mock)).not.toHaveBeenCalled();
    },
  );

  it('host dài quá 253 ký tự (trần hostname DNS) → 400, không chạm DB', async () => {
    const { svc, prisma } = mk();
    const err = await svc.getPublicByHost(`${'a'.repeat(254)}.tubutree.vn`).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('Host không hợp lệ.');
    expect((prisma.storefront.findFirst as jest.Mock)).not.toHaveBeenCalled();
  });

  it('host đúng 253 ký tự vẫn được xử lý như cũ', async () => {
    const { svc } = mk();
    const err = await svc.getPublicByHost('a'.repeat(253)).catch((e) => e);
    expect(err).not.toBeInstanceOf(BadRequestException);
  });
});

describe('StorefrontService — gian hàng khách được thấy (D3-02)', () => {
  const configWith = (over: Record<string, unknown>) =>
    ({ get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) }) as unknown as SystemConfigService;
  const sfRow = { id: 's1', slug: 'linh', title: 'Shop', isPublished: true, type: 'CTV', isPartner: false, approvedAt: null, ownerUserId: 'u1', collections: [], owner: { referralCode: 'LINH' } };

  it('trang công khai chỉ tra gian hàng đã đăng, chưa bị gỡ, chủ không bị khoá và (CTV) còn thuộc vai trò hưởng hoa hồng', async () => {
    const findFirst = jest.fn().mockResolvedValue(sfRow);
    const svc = new StorefrontService(makePrisma({ storefront: { findFirst } }), config, affiliate);
    await svc.getPublicBySlug('linh');
    const where = findFirst.mock.calls[0][0].where;
    expect(where.isPublished).toBe(true);
    expect(where.takenDownAt).toBeNull();
    expect(where.AND).toContainEqual({ OR: [{ ownerUserId: null }, { owner: { isBlocked: false } }] });
    expect(where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE', 'DEALER'] } } }] });
  });

  it('vai trò hưởng hoa hồng lấy từ cấu hình: bớt DEALER thì CTV là đại lý cũng ẩn', async () => {
    const findFirst = jest.fn().mockResolvedValue(sfRow);
    const only = { getPublicTier: async () => null, commissionEligibleRoles: async () => new Set(['AFFILIATE']) } as unknown as AffiliateService;
    await new StorefrontService(makePrisma({ storefront: { findFirst } }), config, only).getPublicBySlug('linh');
    expect(findFirst.mock.calls[0][0].where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE'] } } }] });
  });

  it('cờ storefront.require_approval bật: thêm điều kiện đã duyệt; tắt: không', async () => {
    const off = jest.fn().mockResolvedValue(sfRow);
    await new StorefrontService(makePrisma({ storefront: { findFirst: off } }), config, affiliate).getPublicBySlug('linh');
    expect(JSON.stringify(off.mock.calls[0][0].where)).not.toContain('approvedAt');
    const on = jest.fn().mockResolvedValue(sfRow);
    await new StorefrontService(makePrisma({ storefront: { findFirst: on } }), configWith({ 'storefront.require_approval': true }), affiliate).getPublicBySlug('linh');
    expect(on.mock.calls[0][0].where.AND).toContainEqual({ OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }] });
  });

  it('chuỗi "false" không bật cờ duyệt (chỉ đúng boolean true)', async () => {
    const findFirst = jest.fn().mockResolvedValue(sfRow);
    await new StorefrontService(makePrisma({ storefront: { findFirst } }), configWith({ 'storefront.require_approval': 'false' }), affiliate).getPublicBySlug('linh');
    expect(JSON.stringify(findFirst.mock.calls[0][0].where)).not.toContain('approvedAt');
  });

  it('sitemap (getPublicList) dùng cùng điều kiện: gian hàng bị gỡ/chủ bị khoá/CTV bị hạ không lọt vào', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new StorefrontService(makePrisma({ storefront: { findMany } }), config, affiliate).getPublicList();
    const where = findMany.mock.calls[0][0].where;
    expect(where.takenDownAt).toBeNull();
    expect(where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE', 'DEALER'] } } }] });
  });

  it('trả cờ approved để web chỉ hiện tick xanh và "CTV tuyển chọn" khi đã duyệt (CTV chưa duyệt: false; đối tác: true)', async () => {
    const ctv = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(sfRow) } });
    expect((await new StorefrontService(ctv, config, affiliate).getPublicBySlug('linh')).approved).toBe(false);
    const approved = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...sfRow, approvedAt: new Date() }) } });
    expect((await new StorefrontService(approved, config, affiliate).getPublicBySlug('linh')).approved).toBe(true);
    const merchant = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...sfRow, type: 'MERCHANT', isPartner: true }) } });
    expect((await new StorefrontService(merchant, config, affiliate).getPublicBySlug('linh')).approved).toBe(true);
  });

  describe('getMine: chủ vẫn xem được gian hàng của mình, kèm dòng giải thích khi khách không thấy', () => {
    const mine = (over: Record<string, unknown>, owner = { role: 'AFFILIATE', isBlocked: false }) =>
      makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue({ ...sfRow, collections: [], owner, ...over }) } });

    it('CTV hợp lệ: không có lý do ẩn, và không lộ object owner', async () => {
      const sf = await new StorefrontService(mine({}), config, affiliate).getMine('u1');
      expect(sf.publicHiddenReason).toBeNull();
      expect(sf).not.toHaveProperty('owner');
    });

    it('CTV bị hạ về khách thường: vẫn trả gian hàng, kèm lý do ẩn', async () => {
      const sf = await new StorefrontService(mine({}, { role: 'CUSTOMER', isBlocked: false }), config, affiliate).getMine('u1');
      expect(sf.id).toBe('s1');
      expect(sf.publicHiddenReason).toContain('CTV');
    });

    it('bị admin gỡ đăng: lý do của admin hiện cho chủ', async () => {
      const sf = await new StorefrontService(mine({ isPublished: false, takenDownAt: new Date(), takenDownReason: 'Dùng ảnh người khác' }), config, affiliate).getMine('u1');
      expect(sf.publicHiddenReason).toContain('Dùng ảnh người khác');
    });
  });

  describe('publishMine', () => {
    const mk = (row: Record<string, unknown>, itemCount: number) => {
      const update = jest.fn().mockImplementation(({ data }) => ({ id: 's1', ...data }));
      const prisma = makePrisma({
        storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1', takenDownAt: null, takenDownReason: null, ...row }), update },
        storefrontItem: { count: jest.fn().mockResolvedValue(itemCount) },
      });
      return { svc: new StorefrontService(prisma, config, affiliate), update };
    };

    it('đang bị admin gỡ: chủ không tự đăng lại được (403 kèm lý do)', async () => {
      const { svc, update } = mk({ takenDownAt: new Date(), takenDownReason: 'Ảnh vi phạm' }, 3);
      const err = await svc.publishMine('u1', true).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toContain('Ảnh vi phạm');
      expect(update).not.toHaveBeenCalled();
    });

    it('chưa có sản phẩm nào: chưa đăng được', async () => {
      const { svc, update } = mk({}, 0);
      await expect(svc.publishMine('u1', true)).rejects.toThrow('ít nhất 1 sản phẩm');
      expect(update).not.toHaveBeenCalled();
    });

    it('có sản phẩm: đăng, và lệnh ghi chỉ chạy khi gian hàng chưa bị gỡ (admin gỡ chen giữa không bị ghi đè)', async () => {
      const { svc, update } = mk({}, 1);
      const r = await svc.publishMine('u1', true);
      expect(r.isPublished).toBe(true);
      expect(update.mock.calls[0][0].where).toEqual({ id: 's1', takenDownAt: null });
    });

    it('gỡ đăng (isPublished false) luôn được, kể cả khi đang bị admin gỡ hoặc rỗng', async () => {
      const { svc, update } = mk({ takenDownAt: new Date() }, 0);
      const r = await svc.publishMine('u1', false);
      expect(r.isPublished).toBe(false);
      expect(r.publishedAt).toBeNull();
      expect(update).toHaveBeenCalled();
    });

    it('lệnh ghi trượt vì admin vừa gỡ giữa chừng (P2025) → 403 thay vì 500', async () => {
      const { svc, update } = mk({}, 1);
      update.mockRejectedValue(Object.assign(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'x' })));
      await expect(svc.publishMine('u1', true)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

describe('link subdomain theo cờ storefront.subdomain_enabled (D3-11)', () => {
  const flagConfig = (on: boolean) => ({ get: async <T>(k: string, fb?: T) => (k === 'storefront.subdomain_enabled' ? on : fb) }) as unknown as SystemConfigService;
  const row = {
    id: 's1', slug: 'abcd1234', subdomain: 'lan-xanh', customDomain: 'lanxanh.vn', title: 'Shop', isPublished: true, type: 'CTV', ownerUserId: 'u9',
    collections: [], owner: { referralCode: 'ABCD1234', role: 'AFFILIATE', isBlocked: false },
  };

  it('cờ tắt (mặc định): trang công khai không lộ subdomain và tên miền riêng', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row) } });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('abcd1234');
    expect(r.subdomain).toBeNull();
    expect(r.customDomain).toBeNull();
    expect(r.subdomainEnabled).toBe(false);
    expect(JSON.stringify(r)).not.toContain('lan-xanh');
    expect(JSON.stringify(r)).not.toContain('lanxanh.vn');
  });

  it('cờ bật: trang công khai trả subdomain và tên miền riêng', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row) } });
    const r = await new StorefrontService(prisma, flagConfig(true), affiliate).getPublicBySlug('abcd1234');
    expect(r.subdomain).toBe('lan-xanh');
    expect(r.customDomain).toBe('lanxanh.vn');
    expect(r.subdomainEnabled).toBe(true);
  });

  it('cờ tắt: builder của chủ cũng không nhận subdomain, và biết cờ đang tắt', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row) } });
    const sf = await new StorefrontService(prisma, config, affiliate).getMine('u9');
    expect(sf.subdomain).toBeNull();
    expect(sf.customDomain).toBeNull();
    expect(sf.subdomainEnabled).toBe(false);
  });

  it('cờ bật: builder của chủ nhận subdomain', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row) } });
    const sf = await new StorefrontService(prisma, flagConfig(true), affiliate).getMine('u9');
    expect(sf.subdomain).toBe('lan-xanh');
    expect(sf.subdomainEnabled).toBe(true);
  });

  it('builder của chủ nhận mã giới thiệu để chia sẻ link /s/<slug>?ref=, không lộ thêm gì về chủ', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row) } });
    const sf = await new StorefrontService(prisma, config, affiliate).getMine('u9');
    expect(sf.referralCode).toBe('ABCD1234');
    expect(sf).not.toHaveProperty('owner');
  });
});

describe('ảnh gian hàng trong JSON công khai (D3-10)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const row = (over: Record<string, unknown> = {}) => ({
    id: 's1', slug: 'abcd1234', title: 'Shop', isPublished: true, type: 'CTV', ownerUserId: 'u9', collections: [],
    owner: { referralCode: 'ABCD1234', role: 'AFFILIATE', isBlocked: false }, avatarUrl: null, coverUrl: null, ...over,
  });

  it('ảnh đại diện và ảnh bìa base64 được thay bằng đường dẫn tới endpoint ảnh: JSON công khai không chứa base64', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row({ avatarUrl: PNG, coverUrl: PNG })) } });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('abcd1234');
    expect(r.avatarUrl).toMatch(/^\/storefront\/image\/s1\/avatar\?v=[0-9a-f]{32}$/);
    expect(r.coverUrl).toMatch(/^\/storefront\/image\/s1\/cover\?v=[0-9a-f]{32}$/);
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('URL https giữ nguyên', async () => {
    const prisma = makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row({ avatarUrl: 'https://cdn.x/a.jpg' })) } });
    const r = await new StorefrontService(prisma, config, affiliate).getPublicBySlug('abcd1234');
    expect(r.avatarUrl).toBe('https://cdn.x/a.jpg');
    expect(r.coverUrl).toBeNull();
  });

  describe('getPublicImage', () => {
    const svc = (found: unknown) => {
      const findFirst = jest.fn().mockResolvedValue(found);
      return { findFirst, svc: new StorefrontService(makePrisma({ storefront: { findFirst } }), config, affiliate) };
    };

    it('chỉ tìm trong gian hàng khách đang thấy (gỡ đăng, chủ bị khoá… thì ảnh cũng không phục vụ)', async () => {
      const { findFirst, svc: s } = svc({ id: 's1', avatarUrl: PNG, coverUrl: null });
      await s.getPublicImage('s1', 'avatar', 'x');
      expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 's1', isPublished: true, takenDownAt: null });
    });

    it('trả byte và loại ảnh; mã v khớp nội dung thì versionOk', async () => {
      const { svc: s } = svc({ id: 's1', avatarUrl: PNG, coverUrl: null });
      const version = (await new StorefrontService(makePrisma({ storefront: { findFirst: jest.fn().mockResolvedValue(row({ avatarUrl: PNG })) } }), config, affiliate).getPublicBySlug('abcd1234')).avatarUrl!.split('v=')[1];
      const ok = await s.getPublicImage('s1', 'avatar', version);
      expect(ok.mime).toBe('image/png');
      expect(ok.data.length).toBeGreaterThan(0);
      expect(ok.versionOk).toBe(true);
      expect((await s.getPublicImage('s1', 'avatar', 'sai')).versionOk).toBe(false);
      expect((await s.getPublicImage('s1', 'avatar', undefined)).versionOk).toBe(false);
    });

    it('không có gian hàng, không có ảnh, ảnh không phải base64 phục vụ được, loại ảnh lạ: 404', async () => {
      await expect(svc(null).svc.getPublicImage('s1', 'avatar', 'x')).rejects.toThrow('Không tìm thấy ảnh');
      await expect(svc({ id: 's1', avatarUrl: null, coverUrl: null }).svc.getPublicImage('s1', 'avatar', 'x')).rejects.toThrow('Không tìm thấy ảnh');
      await expect(svc({ id: 's1', avatarUrl: 'https://cdn.x/a.jpg', coverUrl: null }).svc.getPublicImage('s1', 'avatar', 'x')).rejects.toThrow('Không tìm thấy ảnh');
      await expect(svc({ id: 's1', avatarUrl: PNG, coverUrl: null }).svc.getPublicImage('s1', 'banner', 'x')).rejects.toThrow('Không tìm thấy ảnh');
    });
  });
});
