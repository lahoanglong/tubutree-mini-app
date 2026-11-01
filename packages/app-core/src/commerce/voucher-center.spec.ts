import { describe, expect, it } from 'vitest';
import type { CollectableCouponDTO, CollectableMineDTO } from '../api/coupon-collect';
import type { CouponDTO, CouponHistoryDTO } from '../api/loyalty';
import { voucherView } from './voucher';
import { MINE_PREVIEW_MAX, VOUCHER_TABS, collectRows, filterVouchers, historyRows, mineRows, minePreview, voucherFilters, walletCodeSet } from './voucher-center';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const collectable = (code: string, over: Partial<CollectableCouponDTO> = {}): CollectableCouponDTO => ({
  code,
  title: null,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  startAt: iso(NOW - D),
  endAt: iso(NOW + 10 * D),
  newCustomerOnly: false,
  claimedCount: 0,
  usageLimit: null,
  ...over,
});
const wallet = (code: string, over: Partial<CouponDTO> = {}): CouponDTO => ({
  code,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  endAt: iso(NOW + 10 * D),
  ...over,
});
const history = (code: string, over: Partial<CouponHistoryDTO> = {}): CouponHistoryDTO => ({
  code,
  title: null,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: null,
  maxDiscount: null,
  endAt: iso(NOW - D),
  state: 'expired',
  usedAt: null,
  ...over,
});

describe('VOUCHER_TABS', () => {
  it('ba tab theo thứ tự Nhận mã, Mã của tôi, Đã dùng–hết hạn', () => {
    expect(VOUCHER_TABS).toEqual([
      { key: 'claim', label: 'Nhận mã' },
      { key: 'mine', label: 'Mã của tôi' },
      { key: 'history', label: 'Đã dùng–hết hạn' },
    ]);
  });
});

describe('collectRows', () => {
  it('chưa nhận đứng đầu, rồi đã lưu, rồi hết lượt; mã đã có trong ví là saved, hết lượt là soldout', () => {
    const rows = collectRows(
      [
        collectable('A'),
        collectable('B', { usageLimit: 5, claimedCount: 5 }),
        collectable('C', { usageLimit: 50, claimedCount: 47 }),
      ],
      new Set(['A']),
      NOW,
    );
    expect(rows.map((r) => [r.view.code, r.view.state])).toEqual([
      ['C', 'collectable'],
      ['A', 'saved'],
      ['B', 'soldout'],
    ]);
  });

  it('quota "Còn n lượt" khi còn 1 đến 10 lượt; còn nhiều lượt hoặc không giới hạn thì không có', () => {
    const [few, many, unlimited] = collectRows(
      [
        collectable('FEW', { usageLimit: 5, claimedCount: 2 }),
        collectable('MANY', { usageLimit: 100, claimedCount: 50 }),
        collectable('UNL', { usageLimit: null }),
      ],
      new Set(),
      NOW,
    );
    expect(few!.view.quota).toBe('Còn 3 lượt');
    expect(many!.view.quota).toBeNull();
    expect(unlimited!.view.quota).toBeNull();
  });

  it('mã khách đã nhận mà vừa hết lượt thì vẫn là saved, không thành hết lượt', () => {
    const [row] = collectRows([collectable('A', { usageLimit: 1, claimedCount: 1 })], new Set(['A']), NOW);
    expect(row!.view.state).toBe('saved');
    expect(row!.view.quota).toBeNull();
  });

  it('trong cùng nhóm sắp hết hạn trước; mã đã hết hạn (danh sách cache cũ) xuống cuối', () => {
    const rows = collectRows(
      [
        collectable('LATE', { endAt: iso(NOW + 9 * D) }),
        collectable('GONE', { endAt: iso(NOW - 1000) }),
        collectable('SOON', { endAt: iso(NOW + D) }),
      ],
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.view.code)).toEqual(['SOON', 'LATE', 'GONE']);
    expect(rows[2]!.view.state).toBe('expired');
  });

  it('tên admin đặt đi vào view.name; danh sách rỗng cho mảng rỗng', () => {
    expect(collectRows([collectable('A', { title: ' Chào bạn mới ' })], new Set(), NOW)[0]!.view.name).toBe('Chào bạn mới');
    expect(collectRows([], new Set(), NOW)).toEqual([]);
  });

  it('coupon của dòng khớp view: voucherView(row.coupon) bằng row.view', () => {
    const [row] = collectRows([collectable('A', { usageLimit: 4, claimedCount: 1 })], new Set(), NOW);
    expect(voucherView(row!.coupon, NOW)).toEqual(row!.view);
  });
});

describe('collectRows với phần riêng của khách (mine)', () => {
  const mineOf = (over: Partial<CollectableMineDTO> = {}): CollectableMineDTO => ({ claimed: [], newCustomerOnly: [], ...over });

  it('ví rỗng mà mã đã nhận (đã dùng hết lượt nên ví ẩn): không còn là collectable, thành used và đứng sau mã chưa nhận', () => {
    const rows = collectRows([collectable('USED', { usageLimit: 100, claimedCount: 10 }), collectable('NEW')], new Set(), NOW, mineOf({ claimed: ['USED'] }));
    expect(rows.map((r) => [r.view.code, r.view.state])).toEqual([
      ['NEW', 'collectable'],
      ['USED', 'used'],
    ]);
    expect(rows.filter((r) => r.view.state === 'collectable').map((r) => r.view.code)).toEqual(['NEW']);
  });

  it('mã đã nhận mà còn trong ví vẫn là saved: ví quyết định', () => {
    const [row] = collectRows([collectable('A')], new Set(['A']), NOW, mineOf({ claimed: ['A'] }));
    expect(row!.view.state).toBe('saved');
  });

  it('mã đã nhận cũng không thành hết lượt khi lượt cuối chính khách này lấy', () => {
    const [row] = collectRows([collectable('A', { usageLimit: 1, claimedCount: 1 })], new Set(), NOW, mineOf({ claimed: ['A'] }));
    expect(row!.view.state).toBe('used');
  });

  it('mã chỉ-khách-mới của khách cũ: ineligible kèm lý do, không phải collectable', () => {
    const [row] = collectRows([collectable('NEWONLY', { newCustomerOnly: true })], new Set(), NOW, mineOf({ newCustomerOnly: ['NEWONLY'] }));
    expect(row!.view.state).toBe('ineligible');
    expect(row!.reason).toBe('Chỉ dành cho khách đặt đơn đầu tiên');
  });

  it('mã đã nhận ưu tiên hơn chỉ-khách-mới (khách đã có nó, lý do thật là đã dùng)', () => {
    const [row] = collectRows([collectable('A', { newCustomerOnly: true })], new Set(), NOW, mineOf({ claimed: ['A'], newCustomerOnly: ['A'] }));
    expect(row!.view.state).toBe('used');
    expect(row!.reason).toBeUndefined();
  });

  it('không truyền mine (khách chưa đăng nhập, hoặc truy vấn lỗi) thì như cũ: mọi mã chưa có trong ví là collectable, không lý do', () => {
    const rows = collectRows([collectable('A'), collectable('B')], new Set(), NOW);
    expect(rows.map((r) => r.view.state)).toEqual(['collectable', 'collectable']);
    expect(rows.every((r) => r.reason === undefined)).toBe(true);
  });

  it('coupon của dòng khớp view với cả mã used và ineligible', () => {
    const rows = collectRows([collectable('U'), collectable('I', { newCustomerOnly: true })], new Set(), NOW, mineOf({ claimed: ['U'], newCustomerOnly: ['I'] }));
    for (const r of rows) expect(voucherView(r.coupon, NOW)).toEqual(r.view);
  });
});

describe('collectRows khi ví chưa tải được (walletCodes = null)', () => {
  const mineOf = (over: Partial<CollectableMineDTO> = {}): CollectableMineDTO => ({ claimed: [], newCustomerOnly: [], ...over });

  it('mã đã nhận không bị suy ra "Đã dùng": saved, đánh dấu chưa kiểm chứng, mã chưa nhận vẫn collectable', () => {
    const rows = collectRows([collectable('HELD'), collectable('FREE')], null, NOW, mineOf({ claimed: ['HELD'] }));
    const held = rows.find((r) => r.view.code === 'HELD')!;
    expect(held.view.state).toBe('saved');
    expect(held.unverified).toBe(true);
    expect(rows.find((r) => r.view.code === 'FREE')!.view.state).toBe('collectable');
    expect(rows.find((r) => r.view.code === 'FREE')!.unverified).toBeUndefined();
  });

  it('coupon của dòng khớp view', () => {
    const [row] = collectRows([collectable('HELD')], null, NOW, mineOf({ claimed: ['HELD'] }));
    expect(voucherView(row!.coupon, NOW)).toEqual(row!.view);
  });
});

describe('walletCodeSet', () => {
  it('ví lỗi mà chưa có dữ liệu: null (chưa biết); chưa lỗi: tập rỗng; lỗi nhưng còn dữ liệu cũ trong cache: dùng dữ liệu cũ', () => {
    expect(walletCodeSet(undefined, true)).toBeNull();
    expect(walletCodeSet(undefined, false)).toEqual(new Set());
    expect(walletCodeSet([wallet('A')], true)).toEqual(new Set(['A']));
  });
});

describe('collectRows với mã đã nhận mà không còn áp dụng (claimedIneligible)', () => {
  const mineOf = (over: Partial<CollectableMineDTO> = {}): CollectableMineDTO => ({ claimed: [], newCustomerOnly: [], ...over });

  it('đã nhận, chỉ-khách-mới, khách đã có đơn, ví không còn hiện: ineligible kèm lý do "không còn áp dụng", không phải used', () => {
    const [row] = collectRows([collectable('I', { newCustomerOnly: true })], new Set(), NOW, mineOf({ claimed: ['I'], claimedIneligible: ['I'] }));
    expect(row!.view.state).toBe('ineligible');
    expect(row!.reason).toBe('Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng');
    expect(voucherView(row!.coupon, NOW)).toEqual(row!.view);
  });

  it('ví vẫn giữ mã thì ví quyết định (saved)', () => {
    const [row] = collectRows([collectable('I', { newCustomerOnly: true })], new Set(['I']), NOW, mineOf({ claimed: ['I'], claimedIneligible: ['I'] }));
    expect(row!.view.state).toBe('saved');
  });

  it('API cũ chưa có claimedIneligible: như trước, mã đã nhận ngoài ví là used', () => {
    const [row] = collectRows([collectable('I', { newCustomerOnly: true })], new Set(), NOW, mineOf({ claimed: ['I'] }));
    expect(row!.view.state).toBe('used');
  });

  it('ví lỗi (null) vẫn nhận ra mã không còn áp dụng từ API', () => {
    const [row] = collectRows([collectable('I', { newCustomerOnly: true })], null, NOW, mineOf({ claimed: ['I'], claimedIneligible: ['I'] }));
    expect(row!.view.state).toBe('ineligible');
    expect(row!.unverified).toBeUndefined();
  });
});

describe('mineRows', () => {
  it('ví: mọi mã là saved, sắp hết hạn trước, không đổi mảng vào', () => {
    const list = [wallet('LATE', { endAt: iso(NOW + 9 * D) }), wallet('SOON', { endAt: iso(NOW + D) })];
    const copy = [...list];
    const rows = mineRows(list, NOW);
    expect(rows.map((r) => [r.view.code, r.view.state])).toEqual([
      ['SOON', 'saved'],
      ['LATE', 'saved'],
    ]);
    expect(list).toEqual(copy);
  });

  it('mã freeship trong ví có kind freeship; title admin vào name', () => {
    const [row] = mineRows([wallet('SHIP', { type: 'FREESHIP', value: 0, title: 'Giao miễn phí' })], NOW);
    expect(row!.view.kind).toBe('freeship');
    expect(row!.view.name).toBe('Giao miễn phí');
  });
});

describe('minePreview (Ưu đãi chỉ vẽ ba mã, còn lại ở trang Mã giảm giá)', () => {
  const rows = (n: number) => mineRows(Array.from({ length: n }, (_, i) => wallet(`C${i}`, { endAt: iso(NOW + (i + 1) * D) })), NOW);
  it('trần là 3', () => {
    expect(MINE_PREVIEW_MAX).toBe(3);
  });
  it('0, 1, 3 mã: không cắt, không "Tất cả (n)"', () => {
    for (const n of [0, 1, 3]) {
      const p = minePreview(rows(n));
      expect(p).toMatchObject({ total: n, hasMore: false });
      expect(p.shown).toHaveLength(n);
    }
  });
  it('4 mã trở lên: cắt còn 3 theo thứ tự sắp hết hạn, hasMore, total là tổng', () => {
    const p = minePreview(rows(8));
    expect(p.shown.map((r) => r.view.code)).toEqual(['C0', 'C1', 'C2']);
    expect(p).toMatchObject({ total: 8, hasMore: true });
  });
  it('mã hết hạn nằm cuối nên không chiếm ba chỗ đầu', () => {
    const list = [wallet('OLD', { endAt: iso(NOW - D) }), ...Array.from({ length: 3 }, (_, i) => wallet(`OK${i}`, { endAt: iso(NOW + (i + 1) * D) }))];
    expect(minePreview(mineRows(list, NOW)).shown.map((r) => r.view.code)).toEqual(['OK0', 'OK1', 'OK2']);
  });
});

describe('historyRows', () => {
  it('state used hoặc expired đúng theo máy chủ, expiry rỗng, giữ thứ tự máy chủ trả', () => {
    const rows = historyRows(
      [
        history('USED', { state: 'used', endAt: iso(NOW + 5 * D), usedAt: iso(NOW - 3600_000) }),
        history('OLD', { state: 'expired', endAt: iso(NOW - 2 * D) }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.view.code, r.view.state, r.view.expiry])).toEqual([
      ['USED', 'used', ''],
      ['OLD', 'expired', ''],
    ]);
  });

  it('máy khách chạy chậm hơn máy chủ: mã máy chủ báo hết hạn vẫn là expired, không hiện như còn dùng', () => {
    const [row] = historyRows([history('SKEW', { state: 'expired', endAt: iso(NOW + 1000) })], NOW);
    expect(row!.view.state).toBe('expired');
  });
});

describe('voucherFilters', () => {
  const view = (kind: 'discount' | 'freeship' | 'shop') =>
    voucherView({ ...wallet('X', { type: kind === 'freeship' ? 'FREESHIP' : 'AMOUNT' }), shop: kind === 'shop' }, NOW);

  it('luôn có Tất cả, Giảm giá, Miễn phí giao hàng, Sắp hết hạn; Của shop chỉ khi có mã shop', () => {
    expect(voucherFilters([view('discount')])).toEqual([
      { key: 'all', label: 'Tất cả' },
      { key: 'discount', label: 'Giảm giá' },
      { key: 'freeship', label: 'Miễn phí giao hàng' },
      { key: 'expiring', label: 'Sắp hết hạn' },
    ]);
    expect(voucherFilters([]).map((f) => f.key)).toEqual(['all', 'discount', 'freeship', 'expiring']);
    expect(voucherFilters([view('discount'), view('shop')]).map((f) => f.key)).toEqual([
      'all',
      'discount',
      'freeship',
      'shop',
      'expiring',
    ]);
  });
});

describe('filterVouchers', () => {
  const rows = mineRows(
    [
      wallet('DISC', { endAt: iso(NOW + 9 * D) }),
      wallet('SHIP', { type: 'FREESHIP', value: 0, endAt: iso(NOW + 2 * D) }),
      wallet('SOON', { endAt: iso(NOW + D) }),
      wallet('EDGE', { endAt: iso(NOW + 3 * D) }),
      wallet('FAR', { endAt: iso(NOW + 3 * D + 1000) }),
    ],
    NOW,
  );
  const codes = (f: Parameters<typeof filterVouchers>[1]) => filterVouchers(rows, f, NOW).map((r) => r.view.code);

  it('all giữ nguyên thứ tự và số dòng', () => {
    expect(codes('all')).toEqual(rows.map((r) => r.view.code));
  });
  it('discount chỉ mã giảm giá; freeship chỉ mã miễn phí giao hàng', () => {
    expect(codes('discount')).toEqual(codes('all').filter((c) => c !== 'SHIP'));
    expect(codes('freeship')).toEqual(['SHIP']);
  });
  it('shop: chỉ dòng có view.kind shop', () => {
    const shopRows = [{ ...rows[0]!, view: { ...rows[0]!.view, kind: 'shop' as const } }, rows[1]!];
    expect(filterVouchers(shopRows, 'shop', NOW)).toHaveLength(1);
  });
  it('expiring: còn trong 3 ngày; mã quá 3 ngày hoặc đã hết hạn thì không', () => {
    expect(codes('expiring').sort()).toEqual(['EDGE', 'SHIP', 'SOON']);
    const withGone = [...rows, ...mineRows([wallet('GONE', { endAt: iso(NOW - 1) })], NOW)];
    expect(filterVouchers(withGone, 'expiring', NOW).map((r) => r.view.code)).not.toContain('GONE');
  });
});
