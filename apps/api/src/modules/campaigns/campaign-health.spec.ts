import { campaignHealth, countHealth, usableCounts, type HealthCoupon, type HealthFacts, type HealthProduct, type HealthSubject } from './campaign-health';
import { compareBannerOrder } from './campaign-public';

const NOW = new Date('2026-11-05T05:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const subject = (over: Partial<HealthSubject> = {}): HealthSubject => ({
  id: 'c1',
  placement: 'HOME_TOP',
  audience: 'ALL',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  startAt: at(-1),
  endAt: at(10),
  sortOrder: 0,
  ...over,
});
const product = (over: Partial<HealthProduct> = {}): HealthProduct => ({ name: 'Sữa hạt', visible: true, inStock: true, ...over });
const coupon = (over: Partial<HealthCoupon> = {}): HealthCoupon => ({ code: 'GIAM10', isActive: true, startAt: at(-5), endAt: at(30), usageLimit: null, usedCount: 0, ...over });
const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({ now: NOW, target: null, products: [product()], coupons: [], peers: [], ...over });
const codes = (s: HealthSubject, f: HealthFacts) => campaignHealth(s, f).map((i) => `${i.level}:${i.code}`);

describe('campaignHealth', () => {
  it('chiến dịch bình thường: không có vấn đề nào', () => {
    expect(campaignHealth(subject(), facts())).toEqual([]);
  });

  describe('đích sản phẩm/danh mục', () => {
    it('PRODUCT trỏ slug không tồn tại: BLOCK, câu nêu slug', () => {
      const issues = campaignHealth(subject({ linkType: 'PRODUCT', linkValue: 'khong-co' }), facts({ target: { exists: false, visible: false } }));
      expect(issues[0]).toMatchObject({ level: 'BLOCK', code: 'LINK_PRODUCT_MISSING' });
      expect(issues[0]?.message).toContain('khong-co');
    });
    it('PRODUCT đang ẩn: BLOCK; sản phẩm hiển thị: xanh', () => {
      const s = subject({ linkType: 'PRODUCT', linkValue: 'sua-hat' });
      expect(codes(s, facts({ target: { exists: true, visible: false } }))).toEqual(['BLOCK:LINK_PRODUCT_HIDDEN']);
      expect(codes(s, facts({ target: { exists: true, visible: true } }))).toEqual([]);
    });
    it('CATEGORY không tồn tại: BLOCK; tồn tại: xanh', () => {
      const s = subject({ linkType: 'CATEGORY', linkValue: 'sua' });
      expect(codes(s, facts({ target: { exists: false, visible: false } }))).toEqual(['BLOCK:LINK_CATEGORY_MISSING']);
      expect(codes(s, facts({ target: { exists: true, visible: true } }))).toEqual([]);
    });
    it('đích là trang trong app: không kiểm sản phẩm/trang trống', () => {
      expect(codes(subject({ linkType: 'URL_INTERNAL', linkValue: '/offers' }), facts({ products: [] }))).toEqual([]);
    });
    it('slug đích 121 ký tự: WARN; đúng 120: xanh', () => {
      const ok = { target: { exists: true, visible: true } };
      expect(codes(subject({ linkType: 'PRODUCT', linkValue: 'a'.repeat(121) }), facts(ok))).toEqual(['WARN:SLUG_LONG']);
      expect(codes(subject({ linkType: 'PRODUCT', linkValue: 'a'.repeat(120) }), facts(ok))).toEqual([]);
    });
  });

  describe('trang chiến dịch trống', () => {
    const page = subject();
    it('không sản phẩm hiển thị và không mã dùng được: BLOCK', () => {
      expect(codes(page, facts({ products: [] }))).toEqual(['BLOCK:PAGE_EMPTY']);
      expect(codes(page, facts({ products: [product({ visible: false })] }))).toContain('BLOCK:PAGE_EMPTY');
    });
    it('có mã dùng được thì không trống', () => {
      expect(codes(page, facts({ products: [], coupons: [coupon()] }))).toEqual([]);
    });
    it('mã tắt hoặc hết hạn không cứu được trang trống', () => {
      expect(codes(page, facts({ products: [], coupons: [coupon({ isActive: false })] }))).toContain('BLOCK:PAGE_EMPTY');
      expect(codes(page, facts({ products: [], coupons: [coupon({ endAt: at(-1) })] }))).toContain('BLOCK:PAGE_EMPTY');
    });
    it('sản phẩm hiển thị nhưng hết hàng vẫn là trang có nội dung (chỉ cảnh báo)', () => {
      expect(codes(page, facts({ products: [product({ inStock: false })] }))).toEqual(['WARN:PRODUCTS_UNAVAILABLE']);
    });
    it('đích sản phẩm thì không áp luật trang trống', () => {
      expect(codes(subject({ linkType: 'PRODUCT', linkValue: 'x' }), facts({ products: [], target: { exists: true, visible: true } }))).toEqual([]);
    });
  });

  it('endAt đã qua: chỉ báo ENDED, các luật còn lại không còn nghĩa (không BLOCK trang trống, không CROWDED)', () => {
    expect(codes(subject({ endAt: at(-1) }), facts())).toEqual(['WARN:ENDED']);
    expect(codes(subject({ endAt: at(-1) }), facts({ products: [], coupons: [coupon({ isActive: false })] }))).toEqual(['WARN:ENDED']);
  });

  describe('mã gắn kèm', () => {
    const run = (c: HealthCoupon, s = subject()) => codes(s, facts({ coupons: [c] }));
    it('mã bình thường: xanh', () => expect(run(coupon())).toEqual([]));
    it('mã tắt: WARN', () => expect(run(coupon({ isActive: false }))).toEqual(['WARN:COUPON_OFF']));
    it('mã hết hạn: WARN', () => expect(run(coupon({ endAt: at(-2) }))).toEqual(['WARN:COUPON_EXPIRED']));
    it('mã hết lượt: WARN; còn lượt: xanh', () => {
      expect(run(coupon({ usageLimit: 10, usedCount: 10 }))).toEqual(['WARN:COUPON_EXHAUSTED']);
      expect(run(coupon({ usageLimit: 10, usedCount: 9 }))).toEqual([]);
    });
    it('mã hết hạn trước endAt của chiến dịch: WARN', () => {
      expect(run(coupon({ endAt: at(5) }))).toEqual(['WARN:COUPON_ENDS_EARLY']);
      expect(run(coupon({ endAt: at(10) }))).toEqual([]);
    });
    it('chiến dịch chưa mở: mã tính theo lúc chiến dịch mở, không theo hôm nay', () => {
      const s = subject({ startAt: at(3), endAt: at(8) });
      expect(run(coupon({ startAt: at(3), endAt: at(9) }), s)).toEqual([]);
      expect(run(coupon({ startAt: at(-5), endAt: at(2) }), s)).toEqual(['WARN:COUPON_EXPIRED']);
    });
    it('mã chưa tới giờ mở: WARN riêng, không tính là dùng được (trang công khai chỉ hiện mã đã mở)', () => {
      expect(run(coupon({ startAt: at(2) }))).toEqual(['WARN:COUPON_NOT_STARTED']);
      expect(codes(subject(), facts({ products: [], coupons: [coupon({ startAt: at(2) })] }))).toEqual(['BLOCK:PAGE_EMPTY', 'WARN:COUPON_NOT_STARTED']);
    });
    it('mã mở đúng lúc chiến dịch mở: xanh', () => {
      expect(run(coupon({ startAt: at(-1) }))).toEqual([]);
    });
    it('gom theo loại và nêu mã', () => {
      const issues = campaignHealth(subject(), facts({ coupons: [coupon({ code: 'A', isActive: false }), coupon({ code: 'B', isActive: false })] }));
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain('A, B');
    });
  });

  describe('sản phẩm gắn kèm', () => {
    it('đếm sản phẩm ẩn/hết hàng, nêu tối đa 3 tên', () => {
      const products = [product(), ...['An', 'Bình', 'Chi', 'Dũng'].map((name) => product({ name, inStock: false }))];
      const [issue = { code: '', level: '', message: '' }] = campaignHealth(subject(), facts({ products }));
      expect(issue).toMatchObject({ level: 'WARN', code: 'PRODUCTS_UNAVAILABLE' });
      expect(issue.message).toContain('4 sản phẩm');
      expect(issue.message).toContain('An, Bình, Chi');
      expect(issue.message).not.toContain('Dũng');
    });
    it('sản phẩm ẩn cũng tính', () => {
      expect(codes(subject(), facts({ products: [product(), product({ visible: false })] }))).toEqual(['WARN:PRODUCTS_UNAVAILABLE']);
    });
  });

  describe('quá nhiều banner cùng chỗ', () => {
    const peer = (id: string, over: Record<string, unknown> = {}) => ({ id, audience: 'ALL' as const, startAt: at(-1), endAt: at(10), sortOrder: 0, ...over });
    const five = (over: Record<string, unknown> = {}) => ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => peer(id, over));

    it('5 chiến dịch khác đứng trước: chiến dịch này rơi ra ngoài, WARN', () => {
      const s = subject({ id: 'zz', sortOrder: 9 });
      expect(codes(s, facts({ peers: five() }))).toEqual(['WARN:CROWDED']);
    });
    it('đứng trong 5 đầu theo thứ tự hiển thị thật: xanh', () => {
      const s = subject({ id: 'zz', sortOrder: -1 });
      expect(codes(s, facts({ peers: five() }))).toEqual([]);
    });
    it('chỉ 4 chiến dịch khác: vừa 5 slide', () => {
      expect(codes(subject({ id: 'zz', sortOrder: 9 }), facts({ peers: five().slice(0, 4) }))).toEqual([]);
    });
    it('chiến dịch không chạy chồng giờ không tính', () => {
      expect(codes(subject({ id: 'zz', sortOrder: 9 }), facts({ peers: five({ startAt: at(20), endAt: at(30) }) }))).toEqual([]);
    });
    it('đã hết hạn không tính', () => {
      expect(codes(subject({ id: 'zz', sortOrder: 9 }), facts({ peers: five({ startAt: at(-30), endAt: at(-20) }) }))).not.toContain('WARN:CROWDED');
    });
    it('đối tượng khác nhau không tranh chỗ: khách cũ không thấy banner khách mới', () => {
      expect(codes(subject({ id: 'zz', sortOrder: 9, audience: 'RETURNING' }), facts({ peers: five({ audience: 'NEW' }) }))).toEqual([]);
    });
    it('chiến dịch ALL bị đẩy ra với khách mới thì cảnh báo', () => {
      expect(codes(subject({ id: 'zz', sortOrder: 9, audience: 'ALL' }), facts({ peers: five({ audience: 'NEW' }) }))).toEqual(['WARN:CROWDED']);
    });
    it('đồng thứ tự: startAt mới hơn đứng trước, rồi id', () => {
      const peers = five({ startAt: at(0) });
      expect(codes(subject({ id: 'zz', startAt: at(-1) }), facts({ peers }))).toEqual(['WARN:CROWDED']);
      expect(codes(subject({ id: 'zz', startAt: at(1) }), facts({ peers: five({ startAt: at(0) }) }))).toEqual([]);
    });
    it('(a) 10 chiến dịch RETURNING đứng trước làm API cắt ở 10 trước khi lọc đối tượng: chiến dịch NEW sau chúng không bao giờ tới máy khách', () => {
      const peers = Array.from({ length: 10 }, (_, i) => peer(`r${i}`, { audience: 'RETURNING' }));
      const issues = campaignHealth(subject({ id: 'zz', audience: 'NEW', sortOrder: 1 }), facts({ peers }));
      expect(issues.map((i) => i.code)).toEqual(['CROWDED']);
      expect(issues[0]?.message).toContain('suốt thời gian');
    });
    it('(b) 5 chiến dịch nối tiếp nhau 1 ngày và một chiến dịch 1 tuần: không bao giờ quá 2 cùng lúc, không cảnh báo', () => {
      const s = subject({ id: 'zz', sortOrder: 9, startAt: at(0), endAt: at(7) });
      const peers = [0, 1, 2, 3, 4].map((d) => peer(`d${d}`, { startAt: at(d), endAt: at(d + 1) }));
      expect(codes(s, facts({ peers }))).toEqual([]);
    });
    it('có lúc bị khuất: báo "có lúc không hiện" kèm mốc đầu tiên (giờ Việt Nam)', () => {
      const s = subject({ id: 'zz', sortOrder: 9, startAt: at(0), endAt: at(7) });
      const peers = five({ startAt: at(3), endAt: at(4) });
      const [first] = campaignHealth(s, facts({ peers }));
      expect(first).toMatchObject({ level: 'WARN', code: 'CROWDED' });
      expect(first?.message).toContain('có lúc');
      expect(first?.message).toContain('08/11 12:00');
      expect(first?.message).not.toContain('suốt');
    });
    it('chiến dịch này bắt đầu sau: chỉ xét từ khi nó chạy, không tính các chiến dịch đã hết trước đó', () => {
      const s = subject({ id: 'zz', sortOrder: 9, startAt: at(5), endAt: at(8) });
      expect(codes(s, facts({ peers: five({ startAt: at(-1), endAt: at(2) }) }))).toEqual([]);
    });
    it('không tự tính mình hai lần khi peers có chính nó', () => {
      expect(codes(subject({ id: 'p1' }), facts({ peers: five() }))).toEqual([]);
    });
  });

  it('BLOCK luôn đứng trước WARN', () => {
    const levels = campaignHealth(subject(), facts({ products: [], coupons: [coupon({ isActive: false })] })).map((i) => i.level);
    expect(levels).toEqual(['BLOCK', 'WARN']);
  });

  it('countHealth đếm từng mức', () => {
    expect(countHealth(campaignHealth(subject(), facts({ products: [], coupons: [coupon({ isActive: false })] })))).toEqual({ blockers: 1, warnings: 1 });
  });
});

describe('compareBannerOrder (cùng thứ tự với truy vấn banner công khai)', () => {
  const o = (id: string, sortOrder: number, days: number) => ({ id, sortOrder, startAt: at(days) });
  it('sortOrder tăng, startAt giảm, id tăng', () => {
    const list = [o('b', 1, 0), o('c', 0, -1), o('a', 0, 1), o('d', 0, -1)];
    expect([...list].sort(compareBannerOrder).map((x) => x.id)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('usableCounts (món dùng được trên trang chiến dịch)', () => {
  it('đếm sản phẩm khách thấy và mã dùng được đúng như luật trang trống', () => {
    const f = facts({
      products: [product(), product({ visible: false }), product({ inStock: false })],
      coupons: [coupon(), coupon({ code: 'TAT', isActive: false }), coupon({ code: 'CHUA', startAt: at(2) }), coupon({ code: 'HET', endAt: at(-1) })],
    });
    expect(usableCounts(subject(), f)).toEqual({ products: 2, coupons: 1 });
  });
});

