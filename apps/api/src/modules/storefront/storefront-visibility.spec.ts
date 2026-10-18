import { isStorefrontApproved, ownerHiddenReason, publicStorefrontWhere } from './storefront-visibility';

const ROLES = ['AFFILIATE', 'DEALER'] as const;

describe('publicStorefrontWhere', () => {
  it('chỉ lấy gian hàng đã đăng, chưa bị gỡ, chủ không bị khoá', () => {
    const where = publicStorefrontWhere({ eligibleRoles: ROLES, requireApproval: false });
    expect(where.isPublished).toBe(true);
    expect(where.takenDownAt).toBeNull();
    expect(where.AND).toContainEqual({ OR: [{ ownerUserId: null }, { owner: { isBlocked: false } }] });
  });

  it('gian hàng CTV phải có chủ thuộc vai trò hưởng hoa hồng; gian hàng loại khác (MERCHANT, BRAND) không xét vai trò', () => {
    const where = publicStorefrontWhere({ eligibleRoles: ROLES, requireApproval: false });
    expect(where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE', 'DEALER'] } } }] });
  });

  it('cờ duyệt tắt: không xét duyệt; bật: CTV phải được duyệt (đối tác và nhãn hàng luôn tính là đã duyệt)', () => {
    const off = publicStorefrontWhere({ eligibleRoles: ROLES, requireApproval: false });
    expect(JSON.stringify(off)).not.toContain('approvedAt');
    const on = publicStorefrontWhere({ eligibleRoles: ROLES, requireApproval: true });
    expect(on.AND).toContainEqual({ OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }] });
  });
});

describe('isStorefrontApproved', () => {
  it('CTV chỉ đã duyệt khi có approvedAt; đối tác và nhãn hàng luôn đã duyệt', () => {
    expect(isStorefrontApproved({ type: 'CTV', isPartner: false, approvedAt: null })).toBe(false);
    expect(isStorefrontApproved({ type: 'CTV', isPartner: false, approvedAt: new Date() })).toBe(true);
    expect(isStorefrontApproved({ type: 'CTV', isPartner: true, approvedAt: null })).toBe(true);
    expect(isStorefrontApproved({ type: 'MERCHANT', isPartner: true, approvedAt: null })).toBe(true);
    expect(isStorefrontApproved({ type: 'BRAND', isPartner: false, approvedAt: null })).toBe(true);
  });
});

describe('ownerHiddenReason', () => {
  const live = { type: 'CTV' as const, isPartner: false, isPublished: true, approvedAt: new Date(), takenDownAt: null, takenDownReason: null };
  const owner = { role: 'AFFILIATE' as const, isBlocked: false };
  const opts = { eligibleRoles: ROLES, requireApproval: false };

  it('gian hàng đang hiện với khách: không có lý do ẩn', () => {
    expect(ownerHiddenReason(live, owner, opts)).toBeNull();
  });

  it('gian hàng nháp: chủ tự biết, không cần dòng giải thích', () => {
    expect(ownerHiddenReason({ ...live, isPublished: false }, owner, opts)).toBeNull();
  });

  it('bị admin gỡ đăng: nêu lý do của admin', () => {
    const reason = ownerHiddenReason({ ...live, isPublished: false, takenDownAt: new Date(), takenDownReason: 'Ảnh bìa vi phạm' }, owner, opts);
    expect(reason).toContain('Ảnh bìa vi phạm');
    expect(reason).toContain('gỡ');
  });

  it('chủ bị khoá', () => {
    expect(ownerHiddenReason(live, { ...owner, isBlocked: true }, opts)).toContain('khoá');
  });

  it('CTV bị hạ về khách thường: gian hàng ẩn, có giải thích; MERCHANT cùng chủ thì không bị ảnh hưởng', () => {
    expect(ownerHiddenReason(live, { ...owner, role: 'CUSTOMER' }, opts)).toContain('CTV');
    expect(ownerHiddenReason({ ...live, type: 'MERCHANT', isPartner: true }, { ...owner, role: 'CUSTOMER' }, opts)).toBeNull();
  });

  it('cờ duyệt bật mà chưa duyệt: báo đang chờ duyệt; đã duyệt thì không', () => {
    const on = { ...opts, requireApproval: true };
    expect(ownerHiddenReason({ ...live, approvedAt: null }, owner, on)).toContain('duyệt');
    expect(ownerHiddenReason(live, owner, on)).toBeNull();
  });
});
