import { isStorefrontApproved, ownerHiddenReason, ownerStorefrontState, publicStorefrontWhere } from './storefront-visibility';

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
    expect(where.AND).toContainEqual({ OR: [{ type: { not: 'CTV' } }, { owner: { role: { in: ['AFFILIATE', 'DEALER', 'ADMIN'] } } }] });
  });

  it('gian hàng CTV của ADMIN vẫn hiện dù ADMIN không hưởng hoa hồng; không thêm ADMIN hai lần khi khoá đã có', () => {
    const roles = (opts: { eligibleRoles: readonly ('AFFILIATE' | 'ADMIN')[] }) =>
      (publicStorefrontWhere({ ...opts, requireApproval: false }).AND as { OR: { owner?: { role: { in: string[] } } }[] }[])
        .flatMap((c) => c.OR)
        .find((c) => c.owner?.role)!.owner!.role.in;
    expect(roles({ eligibleRoles: ['AFFILIATE'] })).toEqual(['AFFILIATE', 'ADMIN']);
    expect(roles({ eligibleRoles: ['AFFILIATE', 'ADMIN'] })).toEqual(['AFFILIATE', 'ADMIN']);
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

  it('gian hàng CTV của ADMIN: không ẩn, không bảo "Đăng ký lại CTV"', () => {
    expect(ownerHiddenReason(live, { ...owner, role: 'ADMIN' }, opts)).toBeNull();
  });

  it('cờ duyệt bật mà chưa duyệt: báo đang chờ duyệt; đã duyệt thì không', () => {
    const on = { ...opts, requireApproval: true };
    expect(ownerHiddenReason({ ...live, approvedAt: null }, owner, on)).toContain('duyệt');
    expect(ownerHiddenReason(live, owner, on)).toBeNull();
  });
});

describe('ownerStorefrontState', () => {
  const live = { type: 'CTV' as const, isPartner: false, isPublished: true, approvedAt: new Date(), takenDownAt: null, takenDownReason: null };
  const owner = { role: 'AFFILIATE' as const, isBlocked: false };
  const opts = { eligibleRoles: ROLES, requireApproval: true };

  it('chưa đăng: DRAFT', () => {
    expect(ownerStorefrontState({ ...live, isPublished: false, approvedAt: null }, owner, opts).status).toBe('DRAFT');
  });

  it('đã đăng nhưng chưa duyệt lần đầu khi cờ bật: PENDING_APPROVAL, không phải LIVE', () => {
    const r = ownerStorefrontState({ ...live, approvedAt: null }, owner, opts);
    expect(r.status).toBe('PENDING_APPROVAL');
    expect(r.reason).toContain('chờ');
  });

  it('cờ duyệt tắt: đăng xong là LIVE dù chưa có tick xanh', () => {
    expect(ownerStorefrontState({ ...live, approvedAt: null }, owner, { ...opts, requireApproval: false }).status).toBe('LIVE');
  });

  it('đã duyệt: LIVE; bị gỡ: TAKEN_DOWN; chủ bị khoá hoặc hết là CTV: HIDDEN', () => {
    expect(ownerStorefrontState(live, owner, opts).status).toBe('LIVE');
    expect(ownerStorefrontState({ ...live, takenDownAt: new Date(), isPublished: false }, owner, opts).status).toBe('TAKEN_DOWN');
    expect(ownerStorefrontState(live, { ...owner, isBlocked: true }, opts).status).toBe('HIDDEN');
    expect(ownerStorefrontState(live, { ...owner, role: 'CUSTOMER' }, opts).status).toBe('HIDDEN');
  });

  it('gian hàng đối tác chưa có approvedAt vẫn LIVE (đã qua bước duyệt đại lý)', () => {
    expect(ownerStorefrontState({ ...live, type: 'MERCHANT', isPartner: true, approvedAt: null }, owner, opts).status).toBe('LIVE');
  });
});
