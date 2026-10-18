import { describe, it, expect } from 'vitest';
import { adminClaimErrorText, claimActions, creditedOnClosedOrder, groupThousands, isIntroducer } from './external-claims';

const who = (over: Partial<Parameters<typeof claimActions>[1]> = {}) => ({ isAdmin: false, canAct: false, meId: 'x', ...over });
const c = (over: Record<string, unknown> = {}) => ({ state: 'REVIEW' as const, userId: 'u1', reviewReason: null as string | null, ...over });

describe('claimActions', () => {
  it('KE_TOAN không có nút; CSKH duyệt/huỷ claim chưa cộng; chỉ ADMIN đảo và giữ điểm', () => {
    expect(claimActions(c(), who())).toEqual({ approve: false, void: false, voidAndReopen: false, reverse: false, keepPoints: false });
    expect(claimActions(c(), who({ canAct: true }))).toMatchObject({ approve: true, void: true, voidAndReopen: true, reverse: false });
    expect(claimActions(c({ state: 'PENDING' }), who({ canAct: true }))).toMatchObject({ approve: false, void: true });
    const credited = c({ state: 'CREDITED', reviewReason: 'hoàn một phần' });
    expect(claimActions(credited, who({ canAct: true }))).toMatchObject({ void: false, reverse: false, keepPoints: false });
    expect(claimActions(credited, who({ isAdmin: true, canAct: true }))).toMatchObject({ reverse: true, keepPoints: true });
    expect(claimActions(c({ state: 'CREDITED' }), who({ isAdmin: true }))).toMatchObject({ reverse: true, keepPoints: false });
  });
  it('claim của chính mình: không nút nào', () => {
    expect(claimActions(c({ userId: 'x' }), who({ isAdmin: true, canAct: true }))).toEqual({ approve: false, void: false, voidAndReopen: false, reverse: false, keepPoints: false });
  });
});

describe('helpers', () => {
  it('isIntroducer chỉ tính ATTACH và TO_REVIEW của chính mình', () => {
    expect(isIntroducer([{ action: 'ATTACH', actorId: 'x' }], 'x')).toBe(true);
    expect(isIntroducer([{ action: 'VOID', actorId: 'x' }], 'x')).toBe(false);
    expect(isIntroducer([{ action: 'TO_REVIEW', actorId: 'y' }], 'x')).toBe(false);
    expect(isIntroducer([{ action: 'ATTACH', actorId: 'x' }], undefined)).toBe(false);
  });
  it('creditedOnClosedOrder', () => {
    expect(creditedOnClosedOrder({ state: 'CREDITED', orderStatus: 'CANCELLED' })).toBe(true);
    expect(creditedOnClosedOrder({ state: 'CREDITED', orderStatus: 'PARTIAL_RETURN' })).toBe(false);
    expect(creditedOnClosedOrder({ state: 'PENDING', orderStatus: 'RETURNED' })).toBe(false);
  });
  it('adminClaimErrorText: mỗi mã có câu riêng, mã lạ dùng message', () => {
    for (const code of ['SELF_ACTION', 'SAME_INTRODUCER', 'ATTACH_ADMIN_ONLY', 'NOTE_REQUIRED', 'NOT_FLAGGED']) {
      const t = adminClaimErrorText(Object.assign(new Error('english'), { code }));
      expect(t).toMatch(/[ăâêôơưđ]/);
      expect(t).not.toBe('english');
    }
    expect(adminClaimErrorText(Object.assign(new Error('Không tìm thấy claim.'), { code: 'KHAC' }))).toBe('Không tìm thấy claim.');
  });
  it('groupThousands', () => {
    expect(groupThousands(1250000)).toBe('1.250.000');
    expect(groupThousands(999)).toBe('999');
  });
});
