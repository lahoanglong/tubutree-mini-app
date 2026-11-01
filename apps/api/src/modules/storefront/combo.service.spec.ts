import { ComboService, allocateComboDiscounts } from './combo.service';
import { publicStorefrontWhere } from './storefront-visibility';

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
  function makePrisma(collections: any[] | null, bundles: any[] = [], ownerUserId: string | null = null) {
    return {
      storefront: {
        findFirst: jest.fn().mockResolvedValue(collections === null ? null : { ownerUserId, collections }),
      },
      bundle: { findMany: jest.fn().mockResolvedValue(bundles) },
    } as any;
  }
  // Config mặc định trần 30% (fallback), test riêng override khi cần trần khác.
  const config = { get: async (k: string, fb?: unknown) => (k === 'storefront.require_approval' ? false : fb) } as any;

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
      expect.objectContaining({ where: { slug: 'linh-shop', ...publicStorefrontWhere({ eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false }) } }),
    );
  });

  it('gian hàng bị ẩn với khách (gỡ, chủ khoá, chủ hết vai trò CTV) bị loại ngay ở truy vấn, nên không có combo', async () => {
    const prisma = makePrisma([
      { comboDiscountPct: 10, items: [{ productId: 'p1', isHidden: false }, { productId: 'p2', isHidden: false }] },
    ]);
    await new ComboService(prisma, config).computeForStorefront('linh-shop', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    const where = prisma.storefront.findFirst.mock.calls[0][0].where;
    expect(where.takenDownAt).toBeNull();
    expect(where.AND).toContainEqual({ OR: [{ ownerUserId: null }, { owner: { isBlocked: false } }] });
    expect(where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE', 'DEALER', 'ADMIN'] } } }] });
  });

  it('cờ bắt duyệt bật thì gian hàng CTV chưa duyệt cũng không có combo', async () => {
    const prisma = makePrisma([]);
    const requireApproval = { get: async (k: string, fb?: unknown) => (k === 'storefront.require_approval' ? true : fb) } as any;
    await new ComboService(prisma, requireApproval).computeForStorefront('linh-shop', [{ variationId: 'v1', productId: 'p1', total: 100 }]);
    expect(prisma.storefront.findFirst.mock.calls[0][0].where.AND).toContainEqual({
      OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }],
    });
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
      bundle: { findMany: jest.fn().mockResolvedValue([]) },
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

describe('ComboService.computeForStorefront: combo toàn sàn (bundle)', () => {
  const config = { get: async (k: string, fb?: unknown) => (k === 'storefront.require_approval' ? false : fb) } as any;
  const bundle = (id: string, pct: number, createdById: string | null = null) => ({
    id,
    kind: 'BUNDLE_PCT',
    pct,
    anchorProductId: null,
    anchorProduct: null,
    createdById,
    items: [
      { productId: 'p1', variationId: null, addonPrice: null, refPrice: null, maxQty: 1, product: { storefrontId: null } },
      { productId: 'p2', variationId: null, addonPrice: null, refPrice: null, maxQty: 1, product: { storefrontId: null } },
    ],
  });
  const lines = [
    { variationId: 'v1', productId: 'p1', total: 100_000, quantity: 1 },
    { variationId: 'v2', productId: 'p2', total: 100_000, quantity: 1 },
  ];
  const storeCombo = (pct: number) => [{ comboDiscountPct: pct, items: [{ productId: 'p1', isHidden: false, product: { storefrontId: null } }, { productId: 'p2', isHidden: false, product: { storefrontId: null } }] }];
  const makePrisma = (collections: any[] | null, bundles: any[], ownerUserId: string | null = null, buyerRole: string | null = 'STAFF') =>
    ({
      storefront: { findFirst: jest.fn().mockResolvedValue(collections === null ? null : { ownerUserId, collections }) },
      bundle: { findMany: jest.fn().mockResolvedValue(bundles) },
      user: { findUnique: jest.fn().mockResolvedValue(buyerRole === null ? null : { role: buyerRole }) },
    }) as any;

  it('không gian hàng (slug null) vẫn giảm theo bundle đang chạy, không truy vấn gian hàng', async () => {
    const prisma = makePrisma([], [bundle('b1', 10)]);
    const out = await new ComboService(prisma, config).computeForStorefront(null, lines);
    expect(out).toEqual({ total: 20_000, perLine: { v1: 10_000, v2: 10_000 } });
    expect(prisma.storefront.findFirst).not.toHaveBeenCalled();
  });

  it('combo gian hàng 10% và bundle 20% cùng dòng: lấy 20%, không cộng 30%', async () => {
    const out = await new ComboService(makePrisma(storeCombo(10), [bundle('b1', 20)]), config).computeForStorefront('linh-shop', lines);
    expect(out.perLine).toEqual({ v1: 20_000, v2: 20_000 });
    expect(out.total).toBe(40_000);
  });

  it('combo gian hàng 30% lớn hơn bundle 10%: lấy 30%', async () => {
    const out = await new ComboService(makePrisma(storeCombo(30), [bundle('b1', 10)]), config).computeForStorefront('linh-shop', lines);
    expect(out.perLine).toEqual({ v1: 30_000, v2: 30_000 });
  });

  it('chủ gian hàng mua ở chính gian hàng mình mất combo gian hàng nhưng vẫn được bundle toàn sàn', async () => {
    const out = await new ComboService(makePrisma(storeCombo(30), [bundle('b1', 10)], 'owner'), config).computeForStorefront('linh-shop', lines, 'owner');
    expect(out.perLine).toEqual({ v1: 10_000, v2: 10_000 });
  });

  it('bundle.max_pct đọc lại ở nơi tính tiền: bộ lưu 90% khi trần 25% chỉ giảm 25%', async () => {
    const capped = { get: async (k: string, fb?: unknown) => (k === 'bundle.max_pct' ? 25 : fb) } as any;
    const out = await new ComboService(makePrisma([], [bundle('b1', 90)]), capped).computeForStorefront(null, lines);
    expect(out.perLine).toEqual({ v1: 25_000, v2: 25_000 });
  });

  it('dòng chưa có quantity coi như 1; không bundle thì kết quả y như combo gian hàng', async () => {
    const noQty = lines.map(({ quantity: _q, ...l }) => l);
    expect((await new ComboService(makePrisma(storeCombo(10), []), config).computeForStorefront('linh-shop', noQty)).total).toBe(20_000);
  });

  it('giỏ rỗng không truy vấn bundle', async () => {
    const prisma = makePrisma([], [bundle('b1', 10)]);
    expect(await new ComboService(prisma, config).computeForStorefront(null, [])).toEqual({ total: 0, perLine: {} });
    expect(prisma.bundle.findMany).not.toHaveBeenCalled();
  });
});

describe('ComboService.computeForStorefront: nhân viên không hưởng bộ do chính mình tạo', () => {
  const config = { get: async (k: string, fb?: unknown) => (k === 'storefront.require_approval' ? false : fb) } as any;
  const item = (productId: string, o: Record<string, unknown> = {}) => ({ productId, variationId: null, addonPrice: null, refPrice: null, maxQty: 1, product: { storefrontId: null }, ...o });
  const pct = (id: string, createdById: string | null, p = 10) => ({ id, kind: 'BUNDLE_PCT', pct: p, anchorProductId: null, anchorProduct: null, createdById, items: [item('p1'), item('p2')] });
  const addon = (id: string, createdById: string | null) => ({
    id,
    kind: 'ADDON',
    pct: null,
    anchorProductId: 'p1',
    anchorProduct: { storefrontId: null },
    createdById,
    items: [item('p2', { variationId: 'v2', addonPrice: 39_000, refPrice: 50_000 })],
  });
  const lines = [
    { variationId: 'v1', productId: 'p1', total: 100_000, quantity: 1 },
    { variationId: 'v2', productId: 'p2', total: 50_000, quantity: 1 },
  ];
  const prismaOf = (bundles: any[], role: string | null = 'STAFF') =>
    ({ bundle: { findMany: jest.fn().mockResolvedValue(bundles) }, user: { findUnique: jest.fn().mockResolvedValue(role === null ? null : { role }) } }) as any;
  const compute = (prisma: any, buyerId?: string) => new ComboService(prisma, config).computeForStorefront(null, lines, buyerId);

  it('người tạo (nhân viên) tự mua: BUNDLE_PCT và ADDON do mình tạo đều không giảm', async () => {
    expect(await compute(prismaOf([pct('b1', 'staff1')]), 'staff1')).toEqual({ total: 0, perLine: {} });
    expect(await compute(prismaOf([addon('a1', 'staff1')]), 'staff1')).toEqual({ total: 0, perLine: {} });
  });

  it('người tạo là ADMIN thì được hưởng (như mã giảm giá và Giờ vàng)', async () => {
    expect((await compute(prismaOf([pct('b1', 'admin1')], 'ADMIN'), 'admin1')).total).toBe(15_000);
    expect(await compute(prismaOf([addon('a1', 'admin1')], 'ADMIN'), 'admin1')).toEqual({ total: 11_000, perLine: { v2: 11_000 } });
  });

  it('không tra được người mua (role không rõ) thì coi như nhân viên: chặn', async () => {
    expect((await compute(prismaOf([pct('b1', 'staff1')], null), 'staff1')).total).toBe(0);
  });

  it('khách khác mua bộ của nhân viên vẫn được giảm, và không tốn thêm một lần tra vai trò', async () => {
    const prisma = prismaOf([pct('b1', 'staff1')]);
    expect((await compute(prisma, 'buyer9')).total).toBe(15_000);
    expect((await compute(prisma)).total).toBe(15_000);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('bộ không rõ người tạo (null) không chặn ai, không tra vai trò', async () => {
    const prisma = prismaOf([pct('b1', null)]);
    expect((await compute(prisma, 'staff1')).total).toBe(15_000);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('giỏ có bộ của nhân viên (bị chặn) và bộ của người khác: chỉ bộ của người khác áp', async () => {
    const out = await compute(prismaOf([pct('mine', 'staff1', 40), pct('other', 'admin1', 10)]), 'staff1');
    expect(out.perLine).toEqual({ v1: 10_000, v2: 5_000 });
  });
});

