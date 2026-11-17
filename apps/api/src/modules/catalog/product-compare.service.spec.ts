import { NotFoundException } from '@nestjs/common';
import { ProductCompareService, PDP_COMPARE_ENABLED_KEY } from './product-compare.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

type V = { id: string; sku: string; name: string; retailPrice: number; salePrice: number | null; stock: number };

const v = (id: string, name: string, retailPrice: number, stock: number, salePrice: number | null = null): V => ({ id, sku: id, name, retailPrice, salePrice, stock });

const product = (over: Record<string, unknown> & { id: string; name: string }) => ({
  slug: over.id,
  brand: 'Fuwa3e',
  thumbnail: `https://cdn.example/${over.id}.jpg`,
  isCombo: false,
  ingredients: [{ name: 'Gốc dừa' }, { name: 'Enzyme' }, { name: 'Tinh dầu sả' }],
  basePrice: 0,
  salePrice: null,
  isActive: true,
  approvalStatus: 'APPROVED',
  forSegment: ['home'],
  soldApp: 0,
  soldExternal: 0,
  fulfilment: 'TUBU',
  storefront: null,
  variations: [] as V[],
  ...over,
});

const CURRENT = product({
  id: 'p-cur',
  name: 'Nước rửa chén Fuwa3e 3.8L',
  variations: [v('c-small', '500ml', 39_000, 10), v('c-big', '3.8L', 189_000, 4)],
});

function setup(opts: { flag?: unknown; current?: unknown; candidates?: unknown[] } = {}) {
  const findUnique = jest.fn().mockResolvedValue('current' in opts ? opts.current : CURRENT);
  const findMany = jest.fn().mockResolvedValue(opts.candidates ?? []);
  const queryRaw = jest.fn().mockResolvedValue([]);
  const prisma = { product: { findUnique, findMany }, $queryRaw: queryRaw } as unknown as PrismaService;
  const get = jest.fn().mockImplementation(async (_k: string, fb: unknown) => ('flag' in opts ? opts.flag : true) ?? fb);
  const config = { get } as unknown as SystemConfigService;
  return { svc: new ProductCompareService(prisma, config), findUnique, findMany, queryRaw, get };
}

describe('ProductCompareService.compare (GET /products/:slug/compare)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([[false], [undefined], ['true'], [1]])('cờ %p (chỉ đúng boolean true mới bật) → 404 và không đụng Prisma', async (flag) => {
    const { svc, findUnique, findMany, get } = setup({ flag });
    await expect(svc.compare('p-cur')).rejects.toBeInstanceOf(NotFoundException);
    expect(get).toHaveBeenCalledWith(PDP_COMPARE_ENABLED_KEY, false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('slug không có → 404', async () => {
    const { svc, findMany } = setup({ current: null });
    await expect(svc.compare('khong-co')).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['ẩn', { isActive: false }],
    ['chưa duyệt', { approvalStatus: 'PENDING_REVIEW' }],
    ['bị từ chối', { approvalStatus: 'REJECTED' }],
  ])('sản phẩm %s → 404', async (_label, over) => {
    const { svc } = setup({ current: { ...CURRENT, ...over } });
    await expect(svc.compare('p-cur')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('món đang xem: phân loại còn hàng rẻ nhất, dung tích và giá/100ml từ tên phân loại, 2 thành phần đầu, ảnh công khai', async () => {
    const { svc } = setup();
    const r = await svc.compare('p-cur');
    expect(r.current).toEqual({
      productId: 'p-cur',
      slug: 'p-cur',
      name: 'Nước rửa chén Fuwa3e 3.8L',
      brand: 'Fuwa3e',
      thumbnail: 'https://cdn.example/p-cur.jpg',
      price: 39_000,
      variationName: '500ml',
      size: '500ml',
      unitPrice: { per: '100ml', value: 7800 },
      keyIngredients: ['Gốc dừa', 'Enzyme'],
    });
    expect(r.others).toEqual([]);
  });

  it('truy vấn ứng viên: công khai, cùng phân khúc, khác món đang xem, còn hàng', async () => {
    const { svc, findMany } = setup();
    await svc.compare('p-cur');
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      isActive: true,
      approvalStatus: 'APPROVED',
      id: { not: 'p-cur' },
      forSegment: { hasSome: ['home'] },
      variations: { some: { isActive: true, stock: { gt: 0 } } },
    });
  });

  it('chỉ giữ món cùng nhóm tên; tối đa 2, xếp theo đã bán giảm dần rồi giá tăng dần rồi slug', async () => {
    const candidates = [
      product({ id: 'giat', brand: 'Ecocare', name: 'Nước giặt Ecocare 3.8L', soldApp: 999, variations: [v('g1', '3.8L', 150_000, 5)] }),
      product({ id: 'b-eco', brand: 'Ecocare', name: 'Nước rửa chén Ecocare 4L', soldApp: 10, variations: [v('e1', '4L', 160_000, 5)] }),
      product({ id: 'a-eco2', brand: 'Ecocare', name: 'Nước rửa chén sả chanh', soldApp: 10, variations: [v('e2', '1L', 60_000, 5)] }),
      product({ id: 'top', brand: 'Sokfarm', name: 'Nước rửa chén Sokfarm 500ml', soldApp: 50, soldExternal: 50, variations: [v('s1', '500ml', 45_000, 5)] }),
      product({ id: 'nhan-dau', brand: 'Ecocare', name: 'Ecocare nước rửa chén', soldApp: 5000, variations: [v('n1', '1L', 50_000, 5)] }),
    ];
    const { svc } = setup({ candidates });
    const r = await svc.compare('p-cur');
    expect(r.others.map((o) => o.slug)).toEqual(['top', 'a-eco2']);
    expect(r.others[1]).toMatchObject({ price: 60_000, size: '1L', unitPrice: { per: '100ml', value: 6000 } });
  });

  it('hoà đã bán và giá thì xếp theo slug', async () => {
    const candidates = [
      product({ id: 'zz', brand: 'B', name: 'Nước rửa chén B', variations: [v('z1', '1L', 50_000, 5)] }),
      product({ id: 'aa', brand: 'C', name: 'Nước rửa chén C', variations: [v('a1', '1L', 50_000, 5)] }),
      product({ id: 'mm', brand: 'D', name: 'Nước rửa chén D', variations: [v('m1', '1L', 50_000, 5)] }),
    ];
    const { svc } = setup({ candidates });
    expect((await svc.compare('p-cur')).others.map((o) => o.slug)).toEqual(['aa', 'mm']);
  });

  it('ứng viên: bỏ phân loại hết hàng và giá ≤ 0; không còn phân loại nào thì bỏ cả món', async () => {
    const candidates = [
      product({ id: 'mot', brand: 'B', name: 'Nước rửa chén B', variations: [v('m0', 'Tặng', 0, 9), v('m1', '1L', 50_000, 0), v('m2', '2L', 90_000, 3)] }),
      product({ id: 'hai', brand: 'C', name: 'Nước rửa chén C', variations: [v('h0', '1L', 0, 9)] }),
    ];
    const { svc } = setup({ candidates });
    const r = await svc.compare('p-cur');
    expect(r.others).toHaveLength(1);
    expect(r.others[0]).toMatchObject({ slug: 'mot', variationName: '2L', price: 90_000, size: '2L', unitPrice: { per: '100ml', value: 4500 } });
  });

  it('hàng gian hàng đối tác đang tạm nghỉ bị bỏ (trang của nó tắt nút mua)', async () => {
    const store = (paused: boolean) => ({ type: 'MERCHANT', isPartner: true, ordersPausedAt: paused ? new Date() : null, owner: { role: 'DEALER', isBlocked: false } });
    const candidates = [
      product({ id: 'nghi', brand: 'B', name: 'Nước rửa chén B', fulfilment: 'MERCHANT', storefront: store(true), soldApp: 100, variations: [v('n1', '1L', 50_000, 5)] }),
      product({ id: 'mo', brand: 'C', name: 'Nước rửa chén C', fulfilment: 'MERCHANT', storefront: store(false), variations: [v('o1', '1L', 50_000, 5)] }),
    ];
    const { svc } = setup({ candidates });
    expect((await svc.compare('p-cur')).others.map((o) => o.slug)).toEqual(['mo']);
  });

  it('món đang xem không có phân khúc hoặc tên mở đầu bằng nhãn → không tìm ứng viên', async () => {
    const a = setup({ current: { ...CURRENT, forSegment: [] } });
    expect((await a.svc.compare('p-cur')).others).toEqual([]);
    expect(a.findMany).not.toHaveBeenCalled();
    const b = setup({ current: { ...CURRENT, name: 'Fuwa3e nước rửa chén 3.8L' } });
    expect((await b.svc.compare('p-cur')).others).toEqual([]);
    expect(b.findMany).not.toHaveBeenCalled();
  });

  it('món đang xem hết hàng mọi phân loại → vẫn trả current với phân loại rẻ nhất', async () => {
    const current = { ...CURRENT, variations: [v('c-big', '3.8L', 189_000, 0), v('c-small', '500ml', 45_000, 0, 39_000)] };
    const { svc } = setup({ current });
    const r = await svc.compare('p-cur');
    expect(r.current).toMatchObject({ variationName: '500ml', price: 39_000, size: '500ml' });
  });

  it('món không tách được đơn vị: size và unitPrice null', async () => {
    const current = product({ id: 'xp', name: 'Xà phòng thảo mộc', variations: [v('x1', 'Mùi sả', 35_000, 5)] });
    const candidates = [product({ id: 'xp2', brand: 'B', name: 'Xà phòng thảo dược 100g', variations: [v('y1', 'Mặc định', 30_000, 5)] })];
    const { svc } = setup({ current, candidates });
    const r = await svc.compare('xp');
    expect(r.current).toMatchObject({ size: null, unitPrice: null, variationName: 'Mùi sả' });
    // Món đang xem không tách được thì không món nào có giá/100g, nhưng dung tích của món kia vẫn hiện.
    expect(r.others[0]).toMatchObject({ slug: 'xp2', size: '100g', unitPrice: null });
  });

  it('khác loại đơn vị với món đang xem (g so với ml) → unitPrice null, size vẫn có', async () => {
    const candidates = [product({ id: 'bot', brand: 'B', name: 'Nước rửa chén dạng bột 1kg', variations: [v('b1', 'Mặc định', 80_000, 5)] })];
    const { svc } = setup({ candidates });
    const r = await svc.compare('p-cur');
    expect(r.others[0]).toMatchObject({ size: '1kg', unitPrice: null });
    expect(r.current.unitPrice).toEqual({ per: '100ml', value: 7800 });
  });

  it('sản phẩm combo: không tính dung tích và giá trên đơn vị', async () => {
    const candidates = [product({ id: 'cb', brand: 'B', name: 'Nước rửa chén B 500ml', isCombo: true, variations: [v('cb1', '500ml', 70_000, 5)] })];
    const { svc } = setup({ candidates });
    expect((await svc.compare('p-cur')).others[0]).toMatchObject({ size: null, unitPrice: null });
  });

  it('thành phần hỏng bị bỏ; dạng chuỗi tách theo dấu phẩy', async () => {
    const candidates = [product({ id: 'tp', brand: 'B', name: 'Nước rửa chén B', ingredients: 'Nước, , Muối, Chanh', variations: [v('t1', '1L', 50_000, 5)] })];
    const current = { ...CURRENT, ingredients: [{ name: '[object Object]' }, 7, { name: '  ' }, { name: 'Gốc dừa' }] };
    const { svc } = setup({ current, candidates });
    const r = await svc.compare('p-cur');
    expect(r.current.keyIngredients).toEqual(['Gốc dừa']);
    expect(r.others[0]!.keyIngredients).toEqual(['Nước', 'Muối']);
  });

  it('thiếu thumbnail thì lấy ảnh đầu qua đường dẫn công khai, không trả base64', async () => {
    const current = { ...CURRENT, thumbnail: null };
    const { svc, queryRaw } = setup({ current });
    queryRaw.mockResolvedValue([{ id: 'p-cur', cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }]);
    const r = await svc.compare('p-cur');
    expect(r.current.thumbnail).not.toMatch(/^data:/);
    expect(r.current.thumbnail).toContain('/product/p-cur/0');
  });

  describe('đệm 10 phút theo slug', () => {
    it('lần hai trong hạn không gọi Prisma; quá hạn thì đọc lại', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const { svc, findUnique } = setup();
      const first = await svc.compare('p-cur');
      now.mockReturnValue(1_000_000 + 9 * 60_000);
      expect(await svc.compare('p-cur')).toBe(first);
      expect(findUnique).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_000_000 + 10 * 60_000 + 1);
      await svc.compare('p-cur');
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('cờ tắt không đọc từ đệm', async () => {
      const { svc, get } = setup();
      await svc.compare('p-cur');
      get.mockResolvedValue(false);
      await expect(svc.compare('p-cur')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('slug không có không vào đệm', async () => {
      const { svc, findUnique } = setup({ current: null });
      await expect(svc.compare('x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.compare('x')).rejects.toBeInstanceOf(NotFoundException);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('có trần số khoá: đầy thì bỏ khoá cũ nhất', async () => {
      const { svc, findUnique } = setup();
      for (let i = 0; i < 501; i++) await svc.compare(`s${i}`);
      expect(findUnique).toHaveBeenCalledTimes(501);
      await svc.compare('s500');
      expect(findUnique).toHaveBeenCalledTimes(501);
      await svc.compare('s0');
      expect(findUnique).toHaveBeenCalledTimes(502);
    });
  });
});
