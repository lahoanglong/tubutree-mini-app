import { resolveAttribution } from './attribution';
import { publicStorefrontWhere } from '../storefront/storefront-visibility';

const VISIBILITY = { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: true } as const;
const STORE = { id: 's1', slug: 'linh', type: 'CTV', ownerUserId: 'ctv1' };

function setup(opts: { storefront?: typeof STORE | null; touch?: { referrerUserId: string; storefrontSlug: string | null; kind: string } | null; eligible?: boolean; referrer?: string | null } = {}) {
  const findFirst = jest.fn().mockResolvedValue(opts.storefront === undefined ? STORE : opts.storefront);
  const prisma = { storefront: { findFirst } } as any;
  const affiliate = {
    storefrontVisibility: jest.fn().mockResolvedValue(VISIBILITY),
    findEligibleReferrer: jest.fn().mockResolvedValue(opts.referrer ?? null),
    isCommissionEligible: jest.fn().mockResolvedValue(opts.eligible ?? true),
    getActiveTouch: jest.fn().mockResolvedValue(opts.touch ?? null),
  };
  return { prisma, affiliate, findFirst };
}

describe('resolveAttribution với gian hàng bị ẩn và người giới thiệu bị khoá', () => {
  it('tra gian hàng bằng bộ lọc công khai (gỡ, chủ khoá, mất vai trò CTV, chưa duyệt khi cờ bật)', async () => {
    const { prisma, affiliate, findFirst } = setup();
    await resolveAttribution(prisma, affiliate, 'buyer', { storefrontSlug: 'Linh' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ ...publicStorefrontWhere(VISIBILITY), OR: [{ slug: 'linh' }, { subdomain: 'linh' }, { customDomain: 'linh' }] });
  });

  it('không có slug nào để tra thì không đọc điều kiện hiển thị và không truy vấn gian hàng', async () => {
    const { prisma, affiliate, findFirst } = setup();
    const out = await resolveAttribution(prisma, affiliate, 'buyer', {});
    expect(out).toEqual({ referrerUserId: null, storefront: null });
    expect(affiliate.storefrontVisibility).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('gian hàng ẩn → không gian hàng, không người giới thiệu từ chủ gian hàng', async () => {
    const { prisma, affiliate } = setup({ storefront: null });
    const out = await resolveAttribution(prisma, affiliate, 'buyer', { storefrontSlug: 'linh' });
    expect(out).toEqual({ referrerUserId: null, storefront: null });
    expect(affiliate.isCommissionEligible).not.toHaveBeenCalled();
  });

  it('chạm cũ trỏ vào gian hàng đang ẩn → bỏ slug, vẫn ghi công người giới thiệu còn đủ điều kiện', async () => {
    const { prisma, affiliate, findFirst } = setup({ storefront: null, touch: { referrerUserId: 'ctv2', storefrontSlug: 'hidden', kind: 'ctv' } });
    const out = await resolveAttribution(prisma, affiliate, 'buyer', {});
    expect(out).toEqual({ referrerUserId: 'ctv2', storefront: null });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('người giới thiệu bị khoá (isCommissionEligible false) → không ghi công đơn mới', async () => {
    const { prisma, affiliate } = setup({ eligible: false, touch: { referrerUserId: 'ctv9', storefrontSlug: null, kind: 'ctv' } });
    const out = await resolveAttribution(prisma, affiliate, 'buyer', { storefrontSlug: 'linh' });
    expect(out.referrerUserId).toBeNull();
    expect(out.storefront).toEqual(STORE);
  });
});
