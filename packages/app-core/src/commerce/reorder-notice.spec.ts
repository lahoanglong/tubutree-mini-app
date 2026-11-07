import { describe, expect, it } from 'vitest';
import {
  cartUnitsByVariation,
  cartUnitsReady,
  isDiscontinuedItem,
  reorderComparablePrice,
  reorderLineNotices,
  reorderPriceAt,
  reorderPricing,
  reorderSkippedNote,
  type ReorderLineFacts,
} from './reorder-notice';

const line = (over: Partial<ReorderLineFacts> = {}): ReorderLineFacts => ({
  available: true,
  discontinued: false,
  orderedQuantity: 2,
  stock: 50,
  cap: 99,
  paidPrice: 120_000,
  currentPrice: 120_000,
  ...over,
});

describe('reorderLineNotices: câu dưới từng dòng sheet Mua lại', () => {
  it('còn bán, đủ hàng, giá như cũ: không có câu nào', () => {
    expect(reorderLineNotices(line())).toEqual([]);
  });

  it('hết hàng: "Tạm hết hàng"; ngừng bán: "Ngừng bán"; không kèm câu giá hay số lượng', () => {
    expect(reorderLineNotices(line({ available: false, stock: 0, currentPrice: 150_000 }))).toEqual([{ kind: 'out', tone: 'danger', text: 'Tạm hết hàng' }]);
    expect(reorderLineNotices(line({ available: false, discontinued: true }))).toEqual([{ kind: 'discontinued', tone: 'danger', text: 'Ngừng bán' }]);
  });

  it('còn ít hơn số đã mua: báo đã giảm, nêu số đơn trước, không in số tồn', () => {
    const [n] = reorderLineNotices(line({ orderedQuantity: 5, stock: 2 }));
    expect(n).toEqual({ kind: 'reduced', tone: 'warning', text: 'Không đủ 5 như đơn trước, đã giảm số lượng' });
    expect(n!.text).not.toContain('2');
    expect(reorderLineNotices(line({ orderedQuantity: 2, stock: 2 }))).toEqual([]);
  });

  it('tồn trên 20 mà ít hơn số đã mua: không báo gì ở sheet (báo "không đủ" là lộ tồn đang dưới số đã mua), máy chủ kẹp lúc thêm', () => {
    expect(reorderLineNotices(line({ orderedQuantity: 30, stock: 25 }))).toEqual([]);
    expect(reorderLineNotices(line({ orderedQuantity: 30, stock: 21 }))).toEqual([]);
    expect(reorderLineNotices(line({ orderedQuantity: 30, stock: 20 })).map((n) => n.kind)).toEqual(['reduced']);
  });

  it('đơn trước mua quá trần của sheet: báo trần dù còn đủ hàng; tồn dưới trần mà thiếu thì báo không đủ', () => {
    const capped = { kind: 'reduced', tone: 'warning', text: 'Mua lại tối đa 99 mỗi món, đã giảm số lượng' };
    expect(reorderLineNotices(line({ orderedQuantity: 120, stock: 500 }))).toEqual([capped]);
    expect(reorderLineNotices(line({ orderedQuantity: 300, stock: 150 }))).toEqual([capped]);
    expect(reorderLineNotices(line({ orderedQuantity: 120, stock: null }))).toEqual([capped]);
    expect(reorderLineNotices(line({ orderedQuantity: 120, stock: 50 }))).toEqual([capped]);
    expect(reorderLineNotices(line({ orderedQuantity: 120, stock: 15 })).map((n) => n.text)).toEqual(['Không đủ 120 như đơn trước, đã giảm số lượng']);
    expect(reorderLineNotices(line({ orderedQuantity: 99, stock: 500 }))).toEqual([]);
  });

  it('API cũ không cho biết tồn hay giá: không đoán', () => {
    expect(reorderLineNotices(line({ orderedQuantity: 5, stock: null, currentPrice: null }))).toEqual([]);
  });

  it('giá tăng: cảnh báo kèm giá đã trả; giá giảm: báo tin vui kèm giá đã trả', () => {
    expect(reorderLineNotices(line({ currentPrice: 135_000 }))).toEqual([{ kind: 'priceUp', tone: 'warning', text: 'Giá tăng so với đơn trước (120.000đ)' }]);
    expect(reorderLineNotices(line({ currentPrice: 99_000 }))).toEqual([{ kind: 'priceDown', tone: 'success', text: 'Giá giảm so với đơn trước (120.000đ)' }]);
  });

  it('vừa giảm số lượng vừa đổi giá: hai câu, số lượng trước', () => {
    expect(reorderLineNotices(line({ orderedQuantity: 3, stock: 1, currentPrice: 130_000 })).map((n) => n.kind)).toEqual(['reduced', 'priceUp']);
  });
});

describe('reorderSkippedNote: câu đầu sheet', () => {
  it('mọi dòng còn bán: null; vài dòng: nêu số dòng; cả đơn: câu riêng', () => {
    expect(reorderSkippedNote([{ available: true }])).toBeNull();
    expect(reorderSkippedNote([{ available: true }, { available: false }, { available: false }])).toBe('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');
    expect(reorderSkippedNote([{ available: false }])).toBe('Các món trong đơn này đều đã hết hàng hoặc ngừng bán.');
  });
});

describe('reorderComparablePrice: chỉ so giá khi Giờ vàng không xen vào', () => {
  it('không Giờ vàng: giá đang bán', () => {
    expect(reorderComparablePrice({ currentPrice: 99_000, flashActive: false, flashSaleItemId: null })).toBe(99_000);
    expect(reorderComparablePrice({ currentPrice: 99_000, flashActive: false })).toBe(99_000);
  });

  it('dòng mua giá Giờ vàng, biến thể đang có Giờ vàng, API cũ chưa có cờ, thiếu giá: không so', () => {
    expect(reorderComparablePrice({ currentPrice: 120_000, flashActive: false, flashSaleItemId: 'fi1' })).toBeNull();
    expect(reorderComparablePrice({ currentPrice: 120_000, flashActive: true, flashSaleItemId: null })).toBeNull();
    expect(reorderComparablePrice({ currentPrice: 120_000 })).toBeNull();
    expect(reorderComparablePrice({ currentPrice: null, flashActive: false })).toBeNull();
  });
});

// Giỏ tính giá Giờ vàng cho cả dòng khi số lượng không vượt số suất khách còn mua được, vượt thì cả dòng giá thường
// (priceFlashLine ở API). Sheet Mua lại tính cùng luật để giá và tạm tính khớp giỏ.
describe('reorderPricing + reorderPriceAt: giá hiệu lực theo số lượng chọn', () => {
  const order = (over: Partial<Parameters<typeof reorderPricing>[0]> = {}) =>
    reorderPricing({ unitPrice: 120_000, currentPrice: 120_000, flashPrice: null, flashAllowance: null, ...over });

  it('không có Giờ vàng: giá đang bán ở mọi số lượng', () => {
    expect(reorderPriceAt(order(), 1).unitPrice).toBe(120_000);
    expect(reorderPriceAt(order(), 50).unitPrice).toBe(120_000);
  });

  it('còn suất Giờ vàng: số lượng không vượt suất → giá Giờ vàng; vượt suất → cả dòng giá đang bán', () => {
    const p = order({ flashPrice: 90_000, flashAllowance: 3 });
    expect(reorderPriceAt(p, 1).unitPrice).toBe(90_000);
    expect(reorderPriceAt(p, 3).unitPrice).toBe(90_000);
    expect(reorderPriceAt(p, 4).unitPrice).toBe(120_000);
  });

  it('hết suất của khách (allowance 0): giá đang bán', () => {
    expect(reorderPriceAt(order({ flashPrice: 90_000, flashAllowance: 0 }), 1).unitPrice).toBe(120_000);
  });

  it('giá Giờ vàng không bao giờ cao hơn giá đang bán; không biết số suất thì áp cho mọi số lượng', () => {
    expect(reorderPriceAt(order({ flashPrice: 130_000, flashAllowance: 5 }), 1).unitPrice).toBe(120_000);
    expect(reorderPriceAt(order({ flashPrice: 90_000, flashAllowance: null }), 40).unitPrice).toBe(90_000);
  });

  it('so với giá đã trả theo giá hiệu lực: Giờ vàng thấp hơn giá đã trả → giảm; vượt suất về giá thường cao hơn → tăng', () => {
    const p = order({ unitPrice: 100_000, currentPrice: 120_000, flashPrice: 90_000, flashAllowance: 2 });
    expect(reorderPriceAt(p, 2).notice).toMatchObject({ kind: 'priceDown', text: 'Giá giảm so với đơn trước (100.000đ)' });
    expect(reorderPriceAt(p, 3).notice).toMatchObject({ kind: 'priceUp', text: 'Giá tăng so với đơn trước (100.000đ)' });
  });

  it('dòng đơn trước mua giá Giờ vàng, nay hết suất: so giá hiệu lực hiện tại (giá thường) nên báo tăng thật', () => {
    const p = order({ unitPrice: 90_000, currentPrice: 120_000, flashPrice: null, flashAllowance: null });
    expect(reorderPriceAt(p, 1).notice).toMatchObject({ kind: 'priceUp' });
  });

  it('giá hiệu lực bằng giá đã trả: không báo', () => {
    expect(reorderPriceAt(order({ unitPrice: 90_000, currentPrice: 120_000, flashPrice: 90_000, flashAllowance: 5 }), 2).notice).toBeNull();
  });

  it('API cũ (không có flashPrice): giữ luật cũ, chỉ so khi biết không có Giờ vàng xen vào', () => {
    const base = { unitPrice: 100_000, currentPrice: 120_000 };
    expect(reorderPriceAt(reorderPricing({ ...base, flashActive: false }), 1)).toMatchObject({ unitPrice: 120_000, notice: { kind: 'priceUp' } });
    expect(reorderPriceAt(reorderPricing({ ...base, flashActive: true }), 1)).toMatchObject({ unitPrice: 120_000, notice: null });
    expect(reorderPriceAt(reorderPricing({ ...base, flashSaleItemId: 'fi1', flashActive: false }), 1).notice).toBeNull();
    expect(reorderPriceAt(reorderPricing(base), 1).notice).toBeNull();
  });

  it('thiếu giá đang bán: dùng giá đã trả, không báo', () => {
    expect(reorderPriceAt(reorderPricing({ unitPrice: 100_000, currentPrice: null, flashPrice: null, flashAllowance: null }), 1)).toEqual({ unitPrice: 100_000, notice: null });
  });
});

describe('isDiscontinuedItem: phân biệt ngừng bán với hết hàng', () => {
  it('API mới có cờ: theo cờ', () => {
    expect(isDiscontinuedItem({ available: false, stock: 0, discontinued: true })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 0, discontinued: false })).toBe(false);
  });

  it('API cũ: trang sản phẩm gỡ hoặc không bán được mà còn tồn là ngừng bán; hết tồn là hết hàng', () => {
    expect(isDiscontinuedItem({ available: false, stock: 0, productPublic: false })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 7, productPublic: true })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 0, productPublic: true })).toBe(false);
    expect(isDiscontinuedItem({})).toBe(false);
  });
});

describe('reorderPriceAt: số lượng cùng biến thể đã có trong giỏ (giỏ so suất Giờ vàng theo tổng đã gộp)', () => {
  const flash = (allowance: number | null = 3) =>
    reorderPricing({ unitPrice: 120_000, currentPrice: 120_000, flashPrice: 90_000, flashAllowance: allowance });

  it('số lượng của sheet vừa suất nhưng cộng phần đã có trong giỏ thì vượt: cả dòng về giá đang bán, như giỏ sẽ tính', () => {
    expect(reorderPriceAt(flash(), 2).unitPrice).toBe(90_000);
    expect(reorderPriceAt(flash(), 2, 2).unitPrice).toBe(120_000);
  });

  it('tổng đúng bằng suất vẫn là giá Giờ vàng; không truyền hay truyền 0 thì như trước', () => {
    expect(reorderPriceAt(flash(), 2, 1).unitPrice).toBe(90_000);
    expect(reorderPriceAt(flash(), 2, 0)).toEqual(reorderPriceAt(flash(), 2));
  });

  it('số âm hay rác không làm giá rẻ đi', () => {
    expect(reorderPriceAt(flash(), 4, -5).unitPrice).toBe(120_000);
  });

  it('không biết số suất (null): giá Giờ vàng ở mọi tổng; không có Giờ vàng: giá đang bán dù trong giỏ có bao nhiêu', () => {
    expect(reorderPriceAt(flash(null), 2, 50).unitPrice).toBe(90_000);
    expect(reorderPriceAt(reorderPricing({ unitPrice: 120_000, currentPrice: 120_000 }), 2, 50).unitPrice).toBe(120_000);
  });

  it('câu giá so với giá đã trả theo giá giỏ sẽ tính (đã gộp), không theo giá một mình dòng sheet', () => {
    const p = reorderPricing({ unitPrice: 100_000, currentPrice: 120_000, flashPrice: 90_000, flashAllowance: 3 });
    expect(reorderPriceAt(p, 2).notice).toMatchObject({ kind: 'priceDown' });
    expect(reorderPriceAt(p, 2, 2).notice).toMatchObject({ kind: 'priceUp' });
  });
});

describe('cartUnitsByVariation', () => {
  it('chưa tải giỏ: bảng rỗng', () => {
    expect(cartUnitsByVariation(undefined).size).toBe(0);
    expect(cartUnitsByVariation([]).size).toBe(0);
  });

  it('gom số lượng theo biến thể, cộng dồn nếu trùng', () => {
    const m = cartUnitsByVariation([
      { variationId: 'v1', quantity: 2 },
      { variationId: 'v2', quantity: 1 },
      { variationId: 'v1', quantity: 3 },
    ]);
    expect(m.get('v1')).toBe(5);
    expect(m.get('v2')).toBe(1);
    expect(m.get('v3')).toBeUndefined();
  });
});

describe('cartUnitsReady', () => {
  it('giỏ đang tải lần đầu: chưa sẵn sàng, để sheet không tính như giỏ rỗng', () => {
    expect(cartUnitsReady({ enabled: true, status: 'pending' })).toBe(false);
  });

  it('giỏ đã có dữ liệu (kể cả bản cũ đang tải lại): sẵn sàng', () => {
    expect(cartUnitsReady({ enabled: true, status: 'success' })).toBe(true);
  });

  it('tải giỏ lỗi: sẵn sàng, không giữ khách chờ vô hạn (giá theo số lượng của sheet)', () => {
    expect(cartUnitsReady({ enabled: true, status: 'error' })).toBe(true);
  });

  it('không tải giỏ (sheet đóng, chưa đăng nhập): không có gì để chờ', () => {
    expect(cartUnitsReady({ enabled: false, status: 'pending' })).toBe(true);
  });

  it('đang tải thật (fetching): chưa sẵn sàng', () => {
    expect(cartUnitsReady({ enabled: true, status: 'pending', fetchStatus: 'fetching' })).toBe(false);
  });

  it('mất mạng, truy vấn bị tạm dừng (paused) chưa có giỏ: sẵn sàng, không khoá nút tới khi có mạng lại', () => {
    expect(cartUnitsReady({ enabled: true, status: 'pending', fetchStatus: 'paused' })).toBe(true);
  });
});
