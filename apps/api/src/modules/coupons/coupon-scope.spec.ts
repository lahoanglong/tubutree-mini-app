import { isCouponEligible, requiresRealUser } from './coupon-scope';

const user = { id: 'u1', tierId: 't1' };

describe('isCouponEligible (nguồn sự thật scope dùng chung list + redeem)', () => {
  it('PUBLIC → luôn eligible', () => {
    expect(isCouponEligible({ scope: 'PUBLIC' }, user)).toBe(true);
  });

  it('scope null/undefined → coi như PUBLIC (phòng thủ)', () => {
    expect(isCouponEligible({ scope: null }, user)).toBe(true);
    expect(isCouponEligible({}, user)).toBe(true);
  });

  describe('USER_GROUP', () => {
    it('đúng userId → eligible', () => {
      expect(isCouponEligible({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } }, user)).toBe(true);
    });
    it('sai userId → KHÔNG eligible', () => {
      expect(isCouponEligible({ scope: 'USER_GROUP', scopeMeta: { userId: 'u-other' } }, user)).toBe(false);
    });
    it('thiếu meta.userId → KHÔNG eligible', () => {
      expect(isCouponEligible({ scope: 'USER_GROUP', scopeMeta: {} }, user)).toBe(false);
      expect(isCouponEligible({ scope: 'USER_GROUP', scopeMeta: null }, user)).toBe(false);
    });
  });

  describe('TIER', () => {
    it('khớp tierId → eligible', () => {
      expect(isCouponEligible({ scope: 'TIER', scopeMeta: { tierId: 't1' } }, user)).toBe(true);
    });
    it('khác tierId → KHÔNG eligible', () => {
      expect(isCouponEligible({ scope: 'TIER', scopeMeta: { tierId: 't2' } }, user)).toBe(false);
    });
    it('thiếu meta.tierId (admin quên set) → KHÔNG eligible — chống list/apply lệch', () => {
      expect(isCouponEligible({ scope: 'TIER', scopeMeta: {} }, user)).toBe(false);
    });
    it('user chưa có hạng (tierId null) + meta.tierId set → KHÔNG eligible', () => {
      expect(isCouponEligible({ scope: 'TIER', scopeMeta: { tierId: 't1' } }, { id: 'u1', tierId: null })).toBe(false);
    });
    it('user chưa có hạng + meta thiếu tierId → KHÔNG eligible (undefined !== null)', () => {
      expect(isCouponEligible({ scope: 'TIER', scopeMeta: {} }, { id: 'u1', tierId: null })).toBe(false);
    });
  });

  it('BIRTHDAY / INVITE / scope lạ → default DENY', () => {
    expect(isCouponEligible({ scope: 'BIRTHDAY' }, user)).toBe(false);
    expect(isCouponEligible({ scope: 'INVITE' }, user)).toBe(false);
    expect(isCouponEligible({ scope: 'SOMETHING_NEW' }, user)).toBe(false);
  });

  describe('CLAIM (mã ẩn, nhận qua thẻ QR)', () => {
    const claimed = { id: 'u1', tierId: null, claimedCouponIds: new Set(['c1']) };
    it('khách đã nhận đúng mã → eligible', () => {
      expect(isCouponEligible({ id: 'c1', scope: 'CLAIM' }, claimed)).toBe(true);
    });
    it('chưa nhận mã này (nhận mã khác, hoặc không có thông tin nhận) → KHÔNG eligible', () => {
      expect(isCouponEligible({ id: 'c2', scope: 'CLAIM' }, claimed)).toBe(false);
      expect(isCouponEligible({ id: 'c1', scope: 'CLAIM' }, user)).toBe(false);
    });
    it('thiếu id mã → KHÔNG eligible', () => {
      expect(isCouponEligible({ scope: 'CLAIM' }, claimed)).toBe(false);
    });
  });
});

describe('requiresRealUser', () => {
  it('mã công khai giới hạn theo người → cần tài khoản thật; không giới hạn → không', () => {
    expect(requiresRealUser({ scope: 'PUBLIC', perUserLimit: 1 })).toBe(true);
    expect(requiresRealUser({ scope: 'PUBLIC', perUserLimit: 0 })).toBe(false);
  });
  it('mã chỉ khách mới → luôn cần tài khoản thật (tài khoản khách tạo mới vô hạn nên luôn "mới")', () => {
    expect(requiresRealUser({ scope: 'PUBLIC', perUserLimit: 0, newCustomerOnly: true })).toBe(true);
    expect(requiresRealUser({ scope: 'USER_GROUP', perUserLimit: 1, newCustomerOnly: true })).toBe(true);
  });
  it('mã CLAIM → cần tài khoản thật', () => {
    expect(requiresRealUser({ scope: 'CLAIM', perUserLimit: 0 })).toBe(true);
  });
  it('mã cá nhân/hạng không cờ khách mới → giữ như cũ (không đòi)', () => {
    expect(requiresRealUser({ scope: 'USER_GROUP', perUserLimit: 1 })).toBe(false);
    expect(requiresRealUser({ scope: 'TIER', perUserLimit: 1 })).toBe(false);
  });
});
