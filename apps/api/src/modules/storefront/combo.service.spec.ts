import { ComboService, allocateComboDiscounts } from './combo.service';

describe('allocateComboDiscounts (thuần)', () => {
  it('không có combo → không giảm', () => {
    const out = allocateComboDiscounts([], [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out).toEqual({ total: 0, perLine: {} });
  });

  it('combo chỉ áp khi MỌI sản phẩm của combo có trong giỏ', () => {
    const combos = [{ pct: 10, productIds: ['p1', 'p2'] }];
    // thiếu p2 → không áp
    const miss = allocateComboDiscounts(combos, [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(miss.total).toBe(0);
    // đủ p1+p2 → áp 10% mỗi dòng
    const hit = allocateComboDiscounts(combos, [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 200 },
    ]);
    expect(hit.perLine).toEqual({ v1: 10, v2: 20 });
    expect(hit.total).toBe(30);
  });

  it('floor khi giảm lẻ', () => {
    const out = allocateComboDiscounts([{ pct: 10, productIds: ['p1'] }], [{ variationId: 'v1', productId: 'p1', total: 99 }]);
    expect(out.perLine.v1).toBe(9); // floor(9.9)
    expect(out.total).toBe(9);
  });

  it('dòng khớp nhiều combo → lấy pct cao nhất', () => {
    const combos = [
      { pct: 10, productIds: ['p1'] },
      { pct: 25, productIds: ['p1'] },
    ];
    const out = allocateComboDiscounts(combos, [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.perLine.v1).toBe(25);
  });

  it('bỏ qua combo pct<=0 và productIds rỗng', () => {
    const out = allocateComboDiscounts(
      [{ pct: 0, productIds: ['p1'] }, { pct: 10, productIds: [] }],
      [{ variationId: 'v1', productId: 'p1', total: 100 }],
    );
    expect(out.total).toBe(0);
  });

  it('kẹp pct tối đa 100% (không giảm quá giá)', () => {
    const out = allocateComboDiscounts([{ pct: 150, productIds: ['p1'] }], [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.perLine.v1).toBe(100);
  });

  it('nhiều biến thể cùng productId đều được giảm', () => {
    const out = allocateComboDiscounts(
      [{ pct: 10, productIds: ['p1'] }],
      [
        { variationId: 'v1', productId: 'p1', total: 100 },
        { variationId: 'v2', productId: 'p1', total: 50 },
      ],
    );
    expect(out.perLine).toEqual({ v1: 10, v2: 5 });
    expect(out.total).toBe(15);
  });
});

describe('ComboService.computeForStorefront', () => {
  function makePrisma(collections: any[] | null) {
    return {
      storefront: {
        findFirst: jest.fn().mockResolvedValue(collections === null ? null : { collections }),
      },
    } as any;
  }

  it('slug rỗng → không giảm (không query)', async () => {
    const prisma = makePrisma([]);
    const svc = new ComboService(prisma);
    const out = await svc.computeForStorefront(null, [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out).toEqual({ total: 0, perLine: {} });
    expect(prisma.storefront.findFirst).not.toHaveBeenCalled();
  });

  it('giỏ rỗng → không giảm', async () => {
    const prisma = makePrisma([]);
    const svc = new ComboService(prisma);
    const out = await svc.computeForStorefront('linh-shop', []);
    expect(out.total).toBe(0);
  });

  it('storefront không tồn tại/chưa publish → không giảm', async () => {
    const prisma = makePrisma(null);
    const svc = new ComboService(prisma);
    const out = await svc.computeForStorefront('x', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.total).toBe(0);
  });

  it('chỉ lấy collection COMBO, bỏ item ẩn, áp giảm đúng', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 10, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: false }] },
    ]);
    const svc = new ComboService(prisma);
    const out = await svc.computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
    ]);
    expect(out.total).toBe(20);
    // query chỉ kind COMBO
    expect(prisma.storefront.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'linh-shop', isPublished: true } }),
    );
  });

  it('item ẩn bị loại khỏi điều kiện combo', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 10, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: true }] },
    ]);
    const svc = new ComboService(prisma);
    // combo giờ chỉ cần p1 (p2 ẩn) → giỏ có p1 là đủ
    const out = await svc.computeForStorefront('linh-shop', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.perLine.v1).toBe(10);
  });
});
