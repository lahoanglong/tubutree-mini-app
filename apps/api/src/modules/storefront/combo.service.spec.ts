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
    const out = allocateComboDiscounts(
      [{ pct: 10, productIds: ['p1', 'p2'] }],
      [
        { variationId: 'v1', productId: 'p1', total: 99 },
        { variationId: 'v2', productId: 'p2', total: 100 },
      ],
    );
    expect(out.perLine.v1).toBe(9); // floor(9.9)
    expect(out.total).toBe(19);
  });

  it('dòng khớp nhiều combo → lấy pct cao nhất', () => {
    const combos = [
      { pct: 10, productIds: ['p1', 'p2'] },
      { pct: 25, productIds: ['p1', 'p2'] },
    ];
    const out = allocateComboDiscounts(combos, [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
    ]);
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
    const out = allocateComboDiscounts(
      [{ pct: 150, productIds: ['p1', 'p2'] }],
      [
        { variationId: 'v1', productId: 'p1', total: 100 },
        { variationId: 'v2', productId: 'p2', total: 100 },
      ],
    );
    expect(out.perLine.v1).toBe(100);
  });

  it('nhiều biến thể cùng productId đều được giảm', () => {
    const out = allocateComboDiscounts(
      [{ pct: 10, productIds: ['p1', 'p2'] }],
      [
        { variationId: 'v1', productId: 'p1', total: 100 },
        { variationId: 'v2', productId: 'p1', total: 50 },
        { variationId: 'v3', productId: 'p2', total: 10 },
      ],
    );
    expect(out.perLine).toEqual({ v1: 10, v2: 5, v3: 1 });
    expect(out.total).toBe(16);
  });

  it('MONEY-5: "combo" chỉ 1 sản phẩm (hoặc 2 dòng trùng 1 sản phẩm) → không phải combo, không giảm', () => {
    const lines = [{ variationId: 'v1', productId: 'p1', total: 345000 }];
    expect(allocateComboDiscounts([{ pct: 30, productIds: ['p1'] }], lines).total).toBe(0);
    expect(allocateComboDiscounts([{ pct: 30, productIds: ['p1', 'p1'] }], lines).total).toBe(0);
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
  // Config mặc định trần 30% (fallback), test riêng override khi cần trần khác.
  const config = { get: async (_k: string, fb?: unknown) => fb } as any;

  it('slug rỗng → không giảm (không query)', async () => {
    const prisma = makePrisma([]);
    const svc = new ComboService(prisma, config);
    const out = await svc.computeForStorefront(null, [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out).toEqual({ total: 0, perLine: {} });
    expect(prisma.storefront.findFirst).not.toHaveBeenCalled();
  });

  it('giỏ rỗng → không giảm', async () => {
    const prisma = makePrisma([]);
    const svc = new ComboService(prisma, config);
    const out = await svc.computeForStorefront('linh-shop', []);
    expect(out.total).toBe(0);
  });

  it('storefront không tồn tại/chưa publish → không giảm', async () => {
    const prisma = makePrisma(null);
    const svc = new ComboService(prisma, config);
    const out = await svc.computeForStorefront('x', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.total).toBe(0);
  });

  it('chỉ lấy collection COMBO, bỏ item ẩn, áp giảm đúng', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 10, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: false }] },
    ]);
    const svc = new ComboService(prisma, config);
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

  // P0 (docs/2026-09-08-review-progress.md), lớp phòng thủ thứ 2: dữ liệu collection có
  // comboDiscountPct=100 (ghi từ trước khi có trần, hoặc ghi thẳng DB) — computeForStorefront
  // vẫn PHẢI tự clamp theo config hiện hành, không tin nguyên giá trị lưu trong DB.
  it('comboDiscountPct trong DB vượt trần cấu hình → clamp lại khi tính (defense in depth)', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 100, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: false }] },
    ]);
    const cappedConfig = { get: async (k: string, fb?: unknown) => (k === 'storefront.max_combo_pct' ? 20 : fb) } as any;
    const svc = new ComboService(prisma, cappedConfig);
    const out = await svc.computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
    ]);
    expect(out.perLine.v1).toBe(20); // KHÔNG phải 100
  });

  it('item ẩn bị loại khỏi điều kiện combo', async () => {
    const prisma = makePrisma([
      {
        comboDiscountPct: 10,
        items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: true }, { productId: 'p3', isHidden: false }],
      },
    ]);
    const svc = new ComboService(prisma, config);
    // combo giờ chỉ cần p1 + p3 (p2 ẩn)
    const out = await svc.computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v3', productId: 'p3', total: 100 },
    ]);
    expect(out.perLine.v1).toBe(10);
  });

  it('item ẩn làm combo chỉ còn 1 sản phẩm hiện → không còn là combo', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 10, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: true }] },
    ]);
    const out = await new ComboService(prisma, config).computeForStorefront('linh-shop', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(out.total).toBe(0);
  });

  it('Q8 S2: hàng của gian hàng đối tác trong combo không được giảm và không tính vào điều kiện combo', async () => {
    const prisma = makePrisma([
      {
        comboDiscountPct: 10,
        items: [
          { productId: 'p1', isHidden: false, product: { storefrontId: null } },
          { productId: 'p2', isHidden: false, product: { storefrontId: null } },
          { productId: 'p3', isHidden: false, product: { storefrontId: 'sf-doi-tac' } },
        ],
      },
    ]);
    const svc = new ComboService(prisma, config);
    const out = await svc.computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
      { variationId: 'v3', productId: 'p3', total: 100 },
    ]);
    expect(out).toEqual({ total: 20, perLine: { v1: 10, v2: 10 } });
    const withoutPartner = await svc.computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
    ]);
    expect(withoutPartner.total).toBe(20);
    expect((prisma.storefront.findFirst as jest.Mock).mock.calls[0][0].select.collections.select.items.select).toEqual({
      productId: true,
      isHidden: true,
      product: { select: { storefrontId: true } },
    });
  });

  it('Q8 S2: combo một sản phẩm Tubu + một hàng đối tác chỉ còn một sản phẩm → không còn là combo', async () => {
    const prisma = makePrisma([
      {
        comboDiscountPct: 15,
        items: [
          { productId: 'p1', isHidden: false, product: { storefrontId: null } },
          { productId: 'p3', isHidden: false, product: { storefrontId: 'sf-doi-tac' } },
        ],
      },
    ]);
    const out = await new ComboService(prisma, config).computeForStorefront('linh-shop', [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v3', productId: 'p3', total: 100 },
    ]);
    expect(out).toEqual({ total: 0, perLine: {} });
  });

  it('MONEY-5: chủ gian hàng tự mua qua gian hàng của mình → không có giảm combo', async () => {
    const prisma = {
      storefront: {
        findFirst: jest.fn().mockResolvedValue({
          ownerUserId: 'ctv1',
          collections: [{ comboDiscountPct: 30, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: false }] }],
        }),
      },
    } as any;
    const lines = [
      { variationId: 'v1', productId: 'p1', total: 100 },
      { variationId: 'v2', productId: 'p2', total: 100 },
    ];
    const svc = new ComboService(prisma, config);
    expect((await svc.computeForStorefront('ctv-shop', lines, 'ctv1')).total).toBe(0);
    expect((await svc.computeForStorefront('ctv-shop', lines, 'buyer2')).total).toBe(60);
  });
});
