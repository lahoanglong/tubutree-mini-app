import { isCouponEligible } from './coupon-scope';

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
});
