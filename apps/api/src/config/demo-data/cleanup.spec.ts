import { databaseNameOf, formatPlan, formatResult, formatUndoSql, hasDemoData, parseCleanupArgs, type CleanupResult, type DemoCleanupPlan } from './cleanup';

const END = new Date('2026-12-31T17:00:00.000Z');

function plan(over: Partial<DemoCleanupPlan> = {}): DemoCleanupPlan {
  return {
    products: { expected: 44, found: 44, active: 44, idMismatch: [], editedAfterLoad: [] },
    variations: { expected: 48, found: 48, active: 48, extraActive: 0, skuToPrefix: 48 },
    references: [
      { label: 'dòng đơn hàng', table: 'order_items', rows: 2, detail: '1 đơn' },
      { label: 'giỏ hàng', table: 'cart_items', rows: 0 },
    ],
    coupons: [
      { id: 'cmqfuw9l0000gw1vf8f2wozy0', code: 'WELCOME30', kind: 'migration', termsChanged: false, isActive: true, endAt: END, live: true, willExpire: true, refs: { redemptions: 0, orders: 0, carts: 0, brandPromotions: 0, missions: 0 } },
    ],
    categories: [
      { id: 'cat-baby', slug: 'cho-be', exists: true, publicDemo: 5, publicNonDemo: 0 },
      { id: 'cat-food', slug: 'nong-san-thuc-pham', exists: true, publicDemo: 9, publicNonDemo: 3 },
    ],
    brands: [{ id: '75ae0443eea88aa90f3c2bec9bc3ece1', name: 'Fuwa3e', exists: true, isPublished: false, nonDemoActive: 0 }],
    ...over,
  };
}

describe('parseCleanupArgs', () => {
  it('mặc định chỉ xem trước, giữ mã', () => {
    expect(parseCleanupArgs([])).toEqual({ apply: false, coupons: 'keep', keepCoupons: [], expectDb: null });
  });

  it('nhận --apply, --coupons=expire|keep, bỏ qua "--" do pnpm/npm chuyển tiếp', () => {
    expect(parseCleanupArgs(['--', '--apply', '--expect-db=tubutree', '--coupons=expire'])).toEqual({ apply: true, coupons: 'expire', keepCoupons: [], expectDb: 'tubutree' });
    expect(parseCleanupArgs(['--coupons=keep'])).toEqual({ apply: false, coupons: 'keep', keepCoupons: [], expectDb: null });
  });

  it('--keep-coupon giữ lại mã demo được duyệt khi tắt các mã còn lại; chỉ nhận mã demo, chỉ đi kèm --coupons=expire', () => {
    expect(parseCleanupArgs(['--coupons=expire', '--keep-coupon=welcome30, xanh10'])).toEqual({
      apply: false,
      coupons: 'expire',
      keepCoupons: ['WELCOME30', 'XANH10'],
      expectDb: null,
    });
    expect(() => parseCleanupArgs(['--coupons=expire', '--keep-coupon=SALE50'])).toThrow(/SALE50/);
    expect(() => parseCleanupArgs(['--keep-coupon=WELCOME30'])).toThrow(/--coupons=expire/);
  });

  it('--apply bắt buộc --expect-db=<tên DB>; --expect-db rỗng là sai', () => {
    expect(() => parseCleanupArgs(['--apply'])).toThrow(/--expect-db/);
    expect(() => parseCleanupArgs(['--apply', '--expect-db='])).toThrow(/--expect-db cần tên DB/);
    expect(parseCleanupArgs(['--expect-db=tubutree']).expectDb).toBe('tubutree');
  });

  it('databaseNameOf: tên DB trong DATABASE_URL', () => {
    expect(databaseNameOf('postgresql://u:p@postgres:5432/tubutree?connection_limit=20')).toBe('tubutree');
    expect(databaseNameOf('postgresql://u:p@localhost:5565/tubutree_it?schema=public')).toBe('tubutree_it');
    expect(databaseNameOf('postgresql://u:p@localhost:5432')).toBeNull();
    expect(databaseNameOf('khong-phai-url')).toBeNull();
  });

  it('tham số lạ (gõ nhầm --aply, --coupons=delete) thì từ chối thay vì lặng lẽ chạy', () => {
    expect(() => parseCleanupArgs(['--aply'])).toThrow(/--aply/);
    expect(() => parseCleanupArgs(['--coupons=delete'])).toThrow(/--coupons=delete/);
  });
});

describe('hasDemoData', () => {
  it('có sản phẩm, biến thể hoặc mã đúng dòng migration là có', () => {
    expect(hasDemoData(plan())).toBe(true);
    const none = plan({ products: { expected: 44, found: 0, active: 0, idMismatch: [], editedAfterLoad: [] }, variations: { expected: 48, found: 0, active: 0, extraActive: 0, skuToPrefix: 0 } });
    expect(hasDemoData(none)).toBe(true);
    expect(hasDemoData({ ...none, coupons: [] })).toBe(false);
  });

  it('mã do seed tạo (id khác, điều kiện như bản demo) vẫn tính là có demo; chỉ trùng tên thì không', () => {
    const none = plan({ products: { expected: 44, found: 0, active: 0, idMismatch: [], editedAfterLoad: [] }, variations: { expected: 48, found: 0, active: 0, extraActive: 0, skuToPrefix: 0 } });
    expect(hasDemoData({ ...none, coupons: [{ ...none.coupons[0]!, kind: 'name-only' }] })).toBe(false);
    expect(hasDemoData({ ...none, coupons: [{ ...none.coupons[0]!, kind: 'seed' }] })).toBe(true);
  });
});

describe('formatPlan', () => {
  it('xem trước: nói rõ không ghi gì, số dòng sẽ tắt, tham chiếu, mã giữ nguyên kèm cảnh báo, danh mục sẽ trống', () => {
    const text = formatPlan(plan({ coupons: [{ ...plan().coupons[0]!, willExpire: false }] }), { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null });
    expect(text).toContain('XEM TRƯỚC');
    expect(text).toMatch(/Sản phẩm demo: tìm thấy 44\/44, đang bán 44 → sẽ TẮT 44/);
    expect(text).toMatch(/Biến thể demo: tìm thấy 48\/48, đang bán 48 → sẽ TẮT 48/);
    expect(text).toContain('sẽ đổi 48 SKU demo thành DEMO-<sku>');
    expect(text).toContain('order_items');
    expect(text).toContain('1 đơn');
    expect(text).toMatch(/WELCOME30.*GIỮ NGUYÊN/);
    expect(text).toContain('CẢNH BÁO');
    expect(text).toMatch(/cat-baby.*TRỐNG/);
    expect(text).not.toMatch(/cat-food.*TRỐNG/);
    expect(text).toContain('Fuwa3e');
  });

  it('--coupons=expire: mã sẽ bị tắt và cắt hạn, trừ mã --keep-coupon', () => {
    const text = formatPlan(plan(), { apply: true, coupons: 'expire', keepCoupons: [], expectDb: null });
    expect(text).toContain('THỰC HIỆN');
    expect(text).toMatch(/WELCOME30.*sẽ TẮT/);
    expect(formatPlan(plan(), { apply: true, coupons: 'expire', keepCoupons: ['WELCOME30'], expectDb: null })).toMatch(/WELCOME30.*GIỮ theo --keep-coupon/);
  });

  it('đúng dòng migration nhưng điều kiện đã sửa: vẫn sẽ TẮT, kèm cảnh báo kiểm tay và gợi ý --keep-coupon', () => {
    const p = plan({ coupons: [{ ...plan().coupons[0]!, termsChanged: true }] });
    for (const coupons of ['expire', 'keep'] as const) {
      const text = formatPlan(p, { apply: false, coupons, keepCoupons: [], expectDb: null });
      expect(text).toContain('WELCOME30 [ĐIỀU KIỆN ĐÃ SỬA so với bản demo: kiểm tay, dùng --keep-coupon=WELCOME30 nếu là mã thật]');
    }
    expect(formatPlan(p, { apply: false, coupons: 'expire', keepCoupons: [], expectDb: null })).toMatch(/ĐIỀU KIỆN ĐÃ SỬA.*sẽ TẮT/);
    expect(formatPlan(plan(), { apply: false, coupons: 'expire', keepCoupons: [], expectDb: null })).not.toContain('ĐIỀU KIỆN ĐÃ SỬA');
  });

  it('mã do seed tạo được nêu nguồn và cũng bị tắt; mã chỉ trùng tên thì KHÔNG ĐỤNG', () => {
    const base = plan().coupons[0]!;
    const p = plan({ coupons: [{ ...base, id: 'cuid-seed', kind: 'seed' }, { ...base, id: 'cuid-real', code: 'XANH10', kind: 'name-only', willExpire: false }] });
    const text = formatPlan(p, { apply: false, coupons: 'expire', keepCoupons: [], expectDb: null });
    expect(text).toMatch(/WELCOME30 \[do seed tạo.*sẽ TẮT/);
    expect(text).toMatch(/XANH10:.*KHÔNG ĐỤNG: trùng tên mã demo nhưng điều kiện khác/);
  });

  it('đã dọn: không còn gì để đổi', () => {
    const done = plan({
      products: { expected: 44, found: 44, active: 0, idMismatch: [], editedAfterLoad: [] },
      variations: { expected: 48, found: 48, active: 0, extraActive: 0, skuToPrefix: 0 },
    });
    expect(formatPlan(done, { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null })).toMatch(/đang bán 0 → không cần đổi/);
  });

  it('id lệch migration và biến thể thêm sau đều được nêu', () => {
    const text = formatPlan(
      plan({
        products: { expected: 44, found: 44, active: 44, idMismatch: [{ id: 'cmx', pancakeId: 'seed-p-fuwa-floor' }], editedAfterLoad: [] },
        variations: { expected: 48, found: 48, active: 48, extraActive: 2, skuToPrefix: 48 },
      }),
      { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null },
    );
    expect(text).toContain('seed-p-fuwa-floor');
    expect(text).toMatch(/2 biến thể khác/);
  });

  it('sản phẩm demo sửa sau lúc migration nạp: nêu tên, bảo kiểm tay, không tự bỏ qua', () => {
    const edited = { id: 'p-fuwa-floor', pancakeId: 'seed-p-fuwa-floor', name: 'Nước lau sàn Fuwa3e', updatedAt: new Date('2026-08-01T03:00:00.000Z') };
    const text = formatPlan(
      plan({ products: { expected: 44, found: 44, active: 44, idMismatch: [], editedAfterLoad: [edited] } }),
      { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null },
    );
    expect(text).toContain('KIỂM TAY TRƯỚC KHI APPLY: 1 sản phẩm demo');
    expect(text).toContain('--apply vẫn tắt');
    expect(text).toContain('Nước lau sàn Fuwa3e (seed-p-fuwa-floor, id p-fuwa-floor), sửa lần cuối 2026-08-01T03:00:00.000Z');
    expect(text).toMatch(/đang bán 44 → sẽ TẮT 44/);
    expect(formatPlan(plan(), { apply: false, coupons: 'keep', keepCoupons: [], expectDb: null })).not.toContain('KIỂM TAY');
  });
});

describe('formatResult', () => {
  it('in số dòng đã đổi', () => {
    const undo = { productIds: [], variationIds: [], skuVariationIds: [], coupons: [] };
    expect(formatResult({ productsDeactivated: 44, variationsDeactivated: 48, skusPrefixed: 48, couponsExpired: 0, undo })).toMatch(/44 sản phẩm.*48 biến thể.*48 SKU sang DEMO-.*0 mã/s);
  });
});

describe('formatUndoSql', () => {
  const base: CleanupResult = {
    productsDeactivated: 1,
    variationsDeactivated: 1,
    skusPrefixed: 1,
    couponsExpired: 1,
    undo: {
      productIds: ['p-visante-serum'],
      variationIds: ['v1'],
      skuVariationIds: ['v1'],
      coupons: [{ id: 'cmqfuw9l0000gw1vf8f2wozy0', code: 'WELCOME30', isActive: true, endAt: new Date('2026-12-31T17:00:00.000Z') }],
    },
  };

  it('một transaction bật lại đúng dòng đã đổi, gỡ tiền tố SKU, trả mã về isActive và endAt cũ', () => {
    const sql = formatUndoSql(base);
    expect(sql.split('\n')).toEqual([
      '-- HOÀN TÁC (chỉ trưởng kỹ thuật, khi thật cần): chạy nguyên khối dưới đây qua psql.',
      'BEGIN;',
      `UPDATE "products" SET "isActive" = true WHERE "id" IN ('p-visante-serum');`,
      `UPDATE "variations" SET "isActive" = true WHERE "id" IN ('v1');`,
      `UPDATE "variations" SET "sku" = substr("sku", 6) WHERE "id" IN ('v1') AND "sku" LIKE 'DEMO-%';`,
      `UPDATE "coupons" SET "isActive" = true, "endAt" = '2026-12-31T17:00:00.000Z' WHERE "id" = 'cmqfuw9l0000gw1vf8f2wozy0'; -- WELCOME30`,
      'COMMIT;',
    ]);
  });

  it('không đổi gì thì không có câu nào; id có nháy đơn được thoát', () => {
    expect(formatUndoSql({ ...base, undo: { productIds: [], variationIds: [], skuVariationIds: [], coupons: [] } })).toMatch(/không đổi dòng nào/);
    expect(formatUndoSql({ ...base, undo: { ...base.undo, productIds: ["a'b"] } })).toContain(`IN ('a''b')`);
  });
});
