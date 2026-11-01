import {
  addonPayPrice,
  addonUnitDiscount,
  allocateBundleDiscounts,
  allocateBundleDiscountsCapped,
  bundleExposure,
  clampDiscountTotal,
  isOwnStaffBundle,
  mergeMaxPerLine,
  type BundleLine,
  type LiveBundle,
  type StaffBundleCap,
} from './bundle-rules';

const line = (variationId: string, productId: string, total: number, quantity = 1): BundleLine => ({ variationId, productId, total, quantity });
const pct = (id: string, p: number, items: LiveBundle['items']): LiveBundle => ({ id, kind: 'BUNDLE_PCT', pct: p, anchorProductId: null, createdById: null, items });
const addon = (id: string, anchor: string | null, items: LiveBundle['items']): LiveBundle => ({ id, kind: 'ADDON', pct: null, anchorProductId: anchor, createdById: null, items });
const item = (productId: string, o: Partial<LiveBundle['items'][number]> = {}) => ({ productId, variationId: null, addonPrice: null, refPrice: null, maxQty: 1, ...o });
/** Món mua kèm như admin ghi: ghim phân loại, giá tham chiếu = giá lúc tạo bộ (50.000đ). */
const kem = (productId: string, variationId: string, addonPrice: number, o: Partial<LiveBundle['items'][number]> = {}) => item(productId, { variationId, addonPrice, refPrice: 50_000, ...o });
const NONE = { total: 0, perLine: {} };

describe('allocateBundleDiscounts: BUNDLE_PCT', () => {
  const set = pct('b1', 10, [item('p1'), item('p2')]);

  it('đủ bộ: mỗi món giảm %, chỉ maxQty đơn vị mỗi món được hưởng', () => {
    const out = allocateBundleDiscounts([set], [line('v1', 'p1', 60_000), line('v2', 'p2', 80_000, 2)], 50);
    expect(out).toEqual({ total: 10_000, perLine: { v1: 6_000, v2: 4_000 } });
  });

  it('thiếu một món của bộ → không giảm', () => {
    expect(allocateBundleDiscounts([set], [line('v1', 'p1', 60_000)], 50)).toEqual(NONE);
  });

  it('bộ chỉ có một sản phẩm khác nhau hoặc % không dương → không giảm (không phải combo)', () => {
    expect(allocateBundleDiscounts([pct('b', 10, [item('p1')])], [line('v1', 'p1', 60_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([pct('b', 0, [item('p1'), item('p2')])], [line('v1', 'p1', 100), line('v2', 'p2', 100)], 50)).toEqual(NONE);
  });

  it('% vượt trần cấu hình thì kẹp về trần', () => {
    const out = allocateBundleDiscounts([pct('b', 90, [item('p1'), item('p2')])], [line('v1', 'p1', 100_000), line('v2', 'p2', 100_000)], 30);
    expect(out.perLine).toEqual({ v1: 30_000, v2: 30_000 });
  });

  it('món ghim phân loại: phân loại khác của cùng sản phẩm không đủ bộ; đúng phân loại thì giảm đúng dòng đó', () => {
    const pinned = pct('b', 10, [item('p1', { variationId: 'v1a' }), item('p2')]);
    expect(allocateBundleDiscounts([pinned], [line('v1b', 'p1', 100_000), line('v2', 'p2', 100_000)], 50)).toEqual(NONE);
    const out = allocateBundleDiscounts([pinned], [line('v1a', 'p1', 100_000), line('v1b', 'p1', 100_000), line('v2', 'p2', 100_000)], 50);
    expect(out.perLine).toEqual({ v1a: 10_000, v2: 10_000 });
  });

  it('món không ghim, hai phân loại cùng sản phẩm: tổng đơn vị được hưởng đúng maxQty', () => {
    const b = pct('b', 10, [item('p1', { maxQty: 2 }), item('p2')]);
    const out = allocateBundleDiscounts([b], [line('v1a', 'p1', 200_000, 2), line('v1b', 'p1', 200_000, 2), line('v2', 'p2', 100_000)], 50);
    expect(out.perLine).toEqual({ v1a: 20_000, v2: 10_000 });
  });

  it('làm tròn xuống từng dòng và không bao giờ vượt total của dòng', () => {
    const out = allocateBundleDiscounts([pct('b', 100, [item('p1'), item('p2')])], [line('v1', 'p1', 99), line('v2', 'p2', 1)], 100);
    expect(out.perLine).toEqual({ v1: 99, v2: 1 });
    const odd = allocateBundleDiscounts([pct('b', 10, [item('p1'), item('p2')])], [line('v1', 'p1', 99), line('v2', 'p2', 100)], 50);
    expect(odd.perLine.v1).toBe(9);
  });

  it('dòng không có số lượng hợp lệ bị bỏ, không chia cho 0', () => {
    expect(allocateBundleDiscounts([set], [line('v1', 'p1', 100, 0), line('v2', 'p2', 100)], 50)).toEqual(NONE);
  });
});

describe('allocateBundleDiscounts: ADDON', () => {
  const deal = addon('a1', 'p1', [kem('p2', 'v2', 39_000)]);

  it('có sản phẩm chính: món kèm về giá kèm', () => {
    const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50);
    expect(out).toEqual({ total: 11_000, perLine: { v2: 11_000 } });
  });

  it('thiếu sản phẩm chính hoặc bộ mất sản phẩm chính → không giảm', () => {
    expect(allocateBundleDiscounts([deal], [line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([addon('a', null, [kem('p2', 'v2', 1)])], [line('v1', 'p1', 1), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
  });

  it('giá kèm không thấp hơn đơn giá hiện tại (sale tụt) → không giảm, không bao giờ làm giá tăng', () => {
    expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 30_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 39_000)], 50)).toEqual(NONE);
  });

  it('giá kèm 0đ hợp lệ: giảm đủ đơn giá, không vượt total của dòng', () => {
    const free = addon('a', 'p1', [kem('p2', 'v2', 0)]);
    const out = allocateBundleDiscounts([free], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50);
    expect(out.perLine).toEqual({ v2: 50_000 });
  });

  it('chỉ maxQty đơn vị được giá kèm', () => {
    const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 150_000, 3)], 50);
    expect(out.perLine).toEqual({ v2: 11_000 });
    const two = addon('a', 'p1', [kem('p2', 'v2', 39_000, { maxQty: 2 })]);
    expect(allocateBundleDiscounts([two], [line('v1', 'p1', 80_000), line('v2', 'p2', 150_000, 3)], 50).perLine).toEqual({ v2: 22_000 });
  });

  it('giá kèm là giá của MỘT phân loại: khách chọn phân loại đắt hơn của cùng sản phẩm không được giá kèm', () => {
    // Phân loại rẻ 50.000 (ghim, giá kèm 39.000), phân loại lớn 500.000 trong giỏ: dòng lớn không bị giảm 461.000 mỗi đơn vị.
    const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2-large', 'p2', 1_000_000, 2)], 50);
    expect(out).toEqual(NONE);
    const both = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000), line('v2-large', 'p2', 1_000_000, 2)], 50);
    expect(both).toEqual({ total: 11_000, perLine: { v2: 11_000 } });
  });

  it('món kèm không ghim phân loại (dữ liệu ghi tay) không nhận giá kèm: giá kèm cố định không có nghĩa trên nhiều phân loại', () => {
    const unpinned = addon('a', 'p1', [item('p2', { addonPrice: 39_000, refPrice: 50_000 })]);
    expect(allocateBundleDiscounts([unpinned], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
    expect(allocateBundleDiscounts([unpinned], [line('v1', 'p1', 80_000), line('v2-large', 'p2', 1_000_000, 2)], 50)).toEqual(NONE);
  });

  it('món kèm trùng sản phẩm chính bị bỏ; món không có giá kèm bị bỏ', () => {
    const odd = addon('a', 'p1', [item('p1', { addonPrice: 0 }), item('p2')]);
    expect(allocateBundleDiscounts([odd], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
  });

  describe('trần theo giá tham chiếu lúc tạo (giá phân loại đổi lên sau khi tạo bộ)', () => {
    it('phân loại tăng 50.000đ → 500.000đ: giảm vẫn 11.000đ mỗi đơn vị (refPrice 50.000 − giá kèm 39.000), không phải 461.000đ', () => {
      const out = allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 500_000)], 50);
      expect(out).toEqual({ total: 11_000, perLine: { v2: 11_000 } });
    });

    it('maxQty đơn vị đều bị kẹp trần: hai đơn vị ở giá 500.000đ giảm 22.000đ', () => {
      const two = addon('a', 'p1', [kem('p2', 'v2', 39_000, { maxQty: 2 })]);
      expect(allocateBundleDiscounts([two], [line('v1', 'p1', 80_000), line('v2', 'p2', 1_000_000, 2)], 50).perLine).toEqual({ v2: 22_000 });
    });

    it('giá tụt dưới giá tham chiếu (sale mới): giảm theo giá hiện tại, không vượt trần', () => {
      expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 45_000)], 50).perLine).toEqual({ v2: 6_000 });
    });

    it('giá hiện tại đúng bằng giá tham chiếu: giảm đủ (giá kèm không đổi)', () => {
      expect(allocateBundleDiscounts([deal], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50).perLine).toEqual({ v2: 11_000 });
    });

    it('thiếu giá tham chiếu (dòng ghi tay, không do admin tạo) → không giảm, như món không ghim phân loại', () => {
      const noRef = addon('a', 'p1', [kem('p2', 'v2', 39_000, { refPrice: null })]);
      expect(allocateBundleDiscounts([noRef], [line('v1', 'p1', 80_000), line('v2', 'p2', 50_000)], 50)).toEqual(NONE);
    });

    it('giá kèm không thấp hơn giá tham chiếu → không giảm dù giá hiện tại cao', () => {
      const bad = addon('a', 'p1', [kem('p2', 'v2', 50_000)]);
      expect(allocateBundleDiscounts([bad], [line('v1', 'p1', 80_000), line('v2', 'p2', 500_000)], 50)).toEqual(NONE);
    });

    it('addonUnitDiscount và addonPayPrice: giá khách trả = giá hiện tại − khoản giảm đã kẹp (API công khai dùng cùng hàm với giỏ)', () => {
      expect(addonUnitDiscount(500_000, 39_000, 50_000)).toBe(11_000);
      expect(addonPayPrice(500_000, 39_000, 50_000)).toBe(489_000);
      expect(addonPayPrice(50_000, 39_000, 50_000)).toBe(39_000);
      expect(addonPayPrice(45_000, 39_000, 50_000)).toBe(39_000);
      expect(addonUnitDiscount(30_000, 39_000, 50_000)).toBe(0);
      expect(addonPayPrice(30_000, 39_000, 50_000)).toBe(30_000);
    });

    it('thiếu giá tham chiếu (null/undefined): không giảm đồng nào, giá khách trả = giá hiện tại, để API công khai và giỏ cùng nhận một câu trả lời', () => {
      expect(addonUnitDiscount(500_000, 39_000, null)).toBe(0);
      expect(addonUnitDiscount(500_000, 39_000, undefined)).toBe(0);
      expect(addonPayPrice(500_000, 39_000, null)).toBe(500_000);
    });
  });
});

describe('gộp nhiều bộ: mỗi dòng lấy khoản LỚN NHẤT, không cộng', () => {
  it('hai bộ cùng dòng', () => {
    const lines = [line('v1', 'p1', 100_000), line('v2', 'p2', 100_000)];
    const out = allocateBundleDiscounts([pct('a', 10, [item('p1'), item('p2')]), pct('b', 25, [item('p1'), item('p2')])], lines, 50);
    expect(out.perLine).toEqual({ v1: 25_000, v2: 25_000 });
    expect(out.total).toBe(50_000);
  });

  it('mergeMaxPerLine lấy max từng dòng và tính lại total', () => {
    expect(mergeMaxPerLine({ total: 14, perLine: { v1: 5, v2: 9 } }, { total: 7, perLine: { v1: 7 } })).toEqual({ total: 16, perLine: { v1: 7, v2: 9 } });
    expect(mergeMaxPerLine(NONE, NONE)).toEqual(NONE);
  });
});

describe('thứ tự dòng giỏ không đổi khoản giảm', () => {
  // Giỏ, báo giá và đặt đơn đọc dòng theo thứ tự heap của Postgres, có thể khác nhau: kết quả chỉ được phụ thuộc vào NỘI DUNG dòng.
  const b = pct('b', 10, [item('p1'), item('p2')]);
  const cheap = line('v1a', 'p1', 100_000);
  const dear = line('v1b', 'p1', 300_000);
  const other = line('v2', 'p2', 100_000);

  it('maxQty=1, hai phân loại khác giá của cùng một món: hai thứ tự đầu vào ra cùng số', () => {
    const one = allocateBundleDiscounts([b], [cheap, dear, other], 50);
    const two = allocateBundleDiscounts([b], [dear, other, cheap], 50);
    const three = allocateBundleDiscounts([b], [other, dear, cheap], 50);
    expect(two).toEqual(one);
    expect(three).toEqual(one);
    expect(one.perLine).toEqual({ v1a: 10_000, v2: 10_000 });
  });

  it('mọi hoán vị của ba dòng ra cùng kết quả (món maxQty=2 chia đơn vị theo khoá ổn định, không theo thứ tự dòng)', () => {
    const wide = pct('w', 10, [item('p1', { maxQty: 2 }), item('p2')]);
    const rows = [line('v1a', 'p1', 100_000, 1), line('v1b', 'p1', 300_000, 1), line('v1c', 'p1', 500_000, 2), other];
    const perms = [rows, [...rows].reverse(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!], [rows[1]!, rows[3]!, rows[2]!, rows[0]!]];
    const outs = perms.map((r) => allocateBundleDiscounts([wide], r, 50));
    for (const o of outs) expect(o).toEqual(outs[0]);
    expect(outs[0]!.perLine).toEqual({ v1a: 10_000, v1b: 30_000, v2: 10_000 });
  });
});

describe('isOwnStaffBundle: nhân viên không hưởng bộ do mình tạo (cùng luật isOwnStaffCoupon)', () => {
  it('người tạo không phải ADMIN → chặn; ADMIN tạo thì không chặn', () => {
    expect(isOwnStaffBundle({ createdById: 'u1' }, { id: 'u1', role: 'STAFF' })).toBe(true);
    expect(isOwnStaffBundle({ createdById: 'u1' }, { id: 'u1', role: undefined })).toBe(true);
    expect(isOwnStaffBundle({ createdById: 'u1' }, { id: 'u1', role: 'ADMIN' })).toBe(false);
  });

  it('người khác mua, hay bộ không rõ người tạo → không chặn', () => {
    expect(isOwnStaffBundle({ createdById: 'u1' }, { id: 'u2', role: 'STAFF' })).toBe(false);
    expect(isOwnStaffBundle({ createdById: null }, { id: 'u1', role: 'STAFF' })).toBe(false);
  });
});

describe('bundleExposure: số tiền tối đa một đơn được giảm', () => {
  it('BUNDLE_PCT cộng floor(giá × % / 100) × maxQty từng món', () => {
    const items = [{ price: 60_000, addonPrice: null, maxQty: 1 }, { price: 40_000, addonPrice: null, maxQty: 2 }];
    expect(bundleExposure({ kind: 'BUNDLE_PCT', pct: 10 }, items)).toBe(14_000);
  });

  it('ADDON cộng (giá − giá kèm) × maxQty, giá kèm cao hơn giá thì 0', () => {
    expect(bundleExposure({ kind: 'ADDON', pct: null }, [{ price: 50_000, addonPrice: 39_000, maxQty: 2 }])).toBe(22_000);
    expect(bundleExposure({ kind: 'ADDON', pct: null }, [{ price: 30_000, addonPrice: 39_000, maxQty: 2 }])).toBe(0);
  });
});

describe('trần tổng của bộ do nhân viên tạo (clampDiscountTotal, allocateBundleDiscountsCapped)', () => {
  const by = (b: LiveBundle, createdById: string | null): LiveBundle => ({ ...b, createdById });
  /** `staffIds` rỗng nghĩa là chỉ createdById null là nhân viên; id nằm trong `adminIds` là ADMIN, còn lại (kể cả null) bị kẹp. */
  const capOf = (adminIds: string[], maxAmount = 100_000): StaffBundleCap => ({ isStaff: (b) => b.createdById === null || !adminIds.includes(b.createdById), maxAmount });
  /** Bộ mua kèm đúng ví dụ: chính `P`, món ghim giá tham chiếu 340.000đ, giá kèm 240.000đ → mỗi bộ giảm đúng 100.000đ (bằng trần). */
  const addonOn = (id: string, productId: string, createdById: string | null) =>
    by(addon(id, 'P', [item(productId, { variationId: `v${productId}`, addonPrice: 240_000, refPrice: 340_000 })]), createdById);
  const cartPXY = [line('vP', 'P', 80_000), line('vX', 'X', 340_000), line('vY', 'Y', 340_000)];

  describe('clampDiscountTotal', () => {
    it('tổng không vượt trần thì trả nguyên', () => {
      const d = { total: 90_000, perLine: { v1: 50_000, v2: 40_000 } };
      expect(clampDiscountTotal(d, 100_000)).toEqual(d);
    });

    it('cắt theo variationId tăng dần, không theo thứ tự khoá được chèn vào', () => {
      expect(clampDiscountTotal({ total: 200_000, perLine: { v2: 100_000, v1: 100_000 } }, 100_000)).toEqual({ total: 100_000, perLine: { v1: 100_000 } });
      expect(clampDiscountTotal({ total: 140_000, perLine: { v2: 70_000, v1: 70_000 } }, 100_000)).toEqual({ total: 100_000, perLine: { v1: 70_000, v2: 30_000 } });
    });

    it('trần lẻ không tạo khoản giảm lẻ; trần 0 hoặc âm không giảm đồng nào', () => {
      expect(clampDiscountTotal({ total: 200_000, perLine: { v1: 100_000, v2: 100_000 } }, 150_000.5).total).toBe(150_000);
      expect(clampDiscountTotal({ total: 5, perLine: { v1: 5 } }, 0)).toEqual(NONE);
      expect(clampDiscountTotal({ total: 5, perLine: { v1: 5 } }, -10)).toEqual(NONE);
    });
  });

  describe('cộng dồn nhiều bộ của nhân viên', () => {
    it('hai bộ, mỗi bộ đúng trần khi đứng một mình: thô cộng 200.000đ, kẹp ra đúng trần', () => {
      const two = [addonOn('B1', 'X', 's1'), addonOn('B2', 'Y', 's2')];
      expect(allocateBundleDiscounts(two, cartPXY, 50).total).toBe(200_000);
      const out = allocateBundleDiscountsCapped(two, cartPXY, 50, capOf([]));
      expect(out.total).toBe(100_000);
      expect(out.perLine).toEqual({ vX: 100_000 });
    });

    it('thứ tự bộ và thứ tự dòng giỏ không đổi kết quả sau khi kẹp', () => {
      const two = [addonOn('B1', 'X', 's1'), addonOn('B2', 'Y', 's2')];
      const base = allocateBundleDiscountsCapped(two, cartPXY, 50, capOf([]));
      expect(allocateBundleDiscountsCapped([...two].reverse(), cartPXY, 50, capOf([]))).toEqual(base);
      expect(allocateBundleDiscountsCapped(two, [...cartPXY].reverse(), 50, capOf([]))).toEqual(base);
      expect(allocateBundleDiscountsCapped(two, [cartPXY[1]!, cartPXY[2]!, cartPXY[0]!], 50, capOf([]))).toEqual(base);
    });

    it('BUNDLE_PCT 30% (hai món maxQty 1) sau khi giá tăng 150.000đ → 400.000đ: thô 240.000đ, kẹp 100.000đ', () => {
      const b = by(pct('b', 30, [item('pA'), item('pB')]), 's1');
      expect(allocateBundleDiscounts([b], [line('vA', 'pA', 150_000), line('vB', 'pB', 150_000)], 50).total).toBe(90_000);
      const raised = [line('vA', 'pA', 400_000), line('vB', 'pB', 400_000)];
      expect(allocateBundleDiscounts([b], raised, 50).total).toBe(240_000);
      expect(allocateBundleDiscountsCapped([b], raised, 50, capOf([])).total).toBe(100_000);
    });

    it('thêm phân loại 2.000.000đ không ghim của món A: thô 720.000đ, kẹp 100.000đ', () => {
      const b = by(pct('b', 30, [item('pA'), item('pB')]), 's1');
      const lines = [line('vA-big', 'pA', 2_000_000), line('vB', 'pB', 400_000)];
      expect(allocateBundleDiscounts([b], lines, 50).total).toBe(720_000);
      expect(allocateBundleDiscountsCapped([b], lines, 50, capOf([])).total).toBe(100_000);
    });

    it('tổng dưới trần thì không đổi gì so với hàm thô', () => {
      const b = by(pct('b', 10, [item('p1'), item('p2')]), 's1');
      const lines = [line('v1', 'p1', 100_000), line('v2', 'p2', 100_000)];
      expect(allocateBundleDiscountsCapped([b], lines, 50, capOf([]))).toEqual(allocateBundleDiscounts([b], lines, 50));
    });

    it('người tạo không rõ (createdById null) bị kẹp như nhân viên', () => {
      const two = [addonOn('B1', 'X', null), addonOn('B2', 'Y', null)];
      expect(allocateBundleDiscountsCapped(two, cartPXY, 50, capOf(['a1'])).total).toBe(100_000);
    });
  });

  describe('bộ ADMIN không bị kẹp', () => {
    it('hai bộ ADMIN cộng 200.000đ giữ nguyên', () => {
      const two = [addonOn('B1', 'X', 'a1'), addonOn('B2', 'Y', 'a1')];
      expect(allocateBundleDiscountsCapped(two, cartPXY, 50, capOf(['a1']))).toEqual(allocateBundleDiscounts(two, cartPXY, 50));
      expect(allocateBundleDiscountsCapped(two, cartPXY, 50, capOf(['a1'])).total).toBe(200_000);
    });

    it('không có bộ nhân viên nào: kết quả đúng hàm thô', () => {
      const only = [addonOn('B1', 'X', 'a1')];
      expect(allocateBundleDiscountsCapped(only, cartPXY, 50, capOf(['a1']))).toEqual(allocateBundleDiscounts(only, cartPXY, 50));
    });

    it('trộn: ADMIN giảm 100.000đ trên X, hai bộ nhân viên giảm 100.000đ trên Y và Z: ADMIN nguyên vẹn, nhân viên kẹp riêng', () => {
      const lines = [...cartPXY, line('vZ', 'Z', 340_000)];
      const bundles = [addonOn('A1', 'X', 'a1'), addonOn('B1', 'Y', 's1'), addonOn('B2', 'Z', 's2')];
      const adminAlone = allocateBundleDiscounts([bundles[0]!], lines, 50);
      const out = allocateBundleDiscountsCapped(bundles, lines, 50, capOf(['a1']));
      expect(out.total).toBe(200_000);
      expect(out.perLine.vX).toBe(adminAlone.perLine.vX);
      expect(out.perLine.vY! + (out.perLine.vZ ?? 0)).toBe(100_000);
      expect(allocateBundleDiscountsCapped([...bundles].reverse(), [...lines].reverse(), 50, capOf(['a1']))).toEqual(out);
    });

    it('dòng trùng không giúp nhân viên lọt trần: ADMIN và nhân viên cùng giảm trên X, nhân viên còn giảm thêm trên Y', () => {
      const lines = [...cartPXY];
      const bundles = [addonOn('A1', 'X', 'a1'), addonOn('B1', 'X', 's1'), addonOn('B2', 'Y', 's1')];
      const out = allocateBundleDiscountsCapped(bundles, lines, 50, capOf(['a1']));
      // Phần nhân viên kẹp theo variationId (vX trước): giữ vX 100.000đ, cắt vY; gộp với ADMIN (vX 100.000đ) ra tổng 100.000đ.
      expect(out).toEqual({ total: 100_000, perLine: { vX: 100_000 } });
      const adminAlone = allocateBundleDiscounts([bundles[0]!], lines, 50);
      const marginal = Object.entries(out.perLine).reduce((s, [k, v]) => s + Math.max(0, v - (adminAlone.perLine[k] ?? 0)), 0);
      expect(marginal).toBeLessThanOrEqual(100_000);
    });
  });

  it('bất biến trên 200 giỏ sinh ngẫu nhiên (hạt giống cố định): phần nhân viên đóng góp ≤ trần, ADMIN không bị cắt, không dòng nào vượt khoản thô', () => {
    let seed = 20_261_101;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % n;
    };
    const creators = ['s1', 's2', 'a1', null];
    let clamped = 0;
    for (let round = 0; round < 200; round++) {
      const products = Array.from({ length: 2 + rnd(5) }, (_, i) => `p${i}`);
      const lines = products.map((p) => line(`v${p}`, p, (1 + rnd(60)) * 10_000, 1 + rnd(2)));
      const bundles: LiveBundle[] = Array.from({ length: 1 + rnd(5) }, (_, k) => {
        const createdById = creators[rnd(creators.length)]!;
        const picked = [...products].sort(() => rnd(3) - 1).slice(0, 2 + rnd(2));
        if (rnd(2) === 0 || picked.length < 2) {
          const anchor = products[rnd(products.length)]!;
          const others = products.filter((p) => p !== anchor).slice(0, 1 + rnd(2));
          return by(addon(`a${k}`, anchor, others.map((p) => item(p, { variationId: `v${p}`, addonPrice: rnd(30) * 1000, refPrice: 100_000 + rnd(400) * 1000, maxQty: 1 + rnd(3) }))), createdById);
        }
        return by(pct(`b${k}`, 1 + rnd(50), picked.map((p) => item(p, { maxQty: 1 + rnd(3) }))), createdById);
      });
      const cap = capOf(['a1'], 50_000 + rnd(150) * 1000);
      const out = allocateBundleDiscountsCapped(bundles, lines, 50, cap);
      const raw = allocateBundleDiscounts(bundles, lines, 50);
      const admin = allocateBundleDiscounts(bundles.filter((b) => !cap.isStaff(b)), lines, 50);
      const staffAlone = allocateBundleDiscounts(bundles.filter(cap.isStaff), lines, 50);
      const marginal = Object.entries(out.perLine).reduce((s, [k, v]) => s + Math.max(0, v - (admin.perLine[k] ?? 0)), 0);
      expect(marginal).toBeLessThanOrEqual(cap.maxAmount);
      expect(out.total).toBe(Object.values(out.perLine).reduce((s, d) => s + d, 0));
      for (const [k, v] of Object.entries(admin.perLine)) expect(out.perLine[k] ?? 0).toBeGreaterThanOrEqual(v);
      for (const [k, v] of Object.entries(out.perLine)) expect(v).toBeLessThanOrEqual(raw.perLine[k] ?? 0);
      if (staffAlone.total <= cap.maxAmount) expect(out).toEqual(raw);
      else clamped++;
    }
    // Bộ sinh phải thật sự chạm trần ở một phần đáng kể các giỏ, nếu không bất biến ở trên chưa được thử.
    expect(clamped).toBeGreaterThan(20);
  });
});
