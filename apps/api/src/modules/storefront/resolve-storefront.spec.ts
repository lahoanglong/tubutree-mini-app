import { loadPublicVisibility } from './public-visibility';
import { publicStorefrontWhere } from './storefront-visibility';
import { resolvePublishedStorefront } from './resolve-storefront';

const VISIBILITY = { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false } as const;

const SF = { id: 's1', slug: 'linh', type: 'CTV', ownerUserId: 'u1' };
const insensitive = (v: string) => ({ equals: v, mode: 'insensitive' });

/** prisma giả: `visible` là kết quả các lần tra gian hàng khách thấy được (lần lượt), `slugRow` là dòng mang slug đó bất kể hiển thị, `codeOwner` là chủ mã giới thiệu. */
function fake(visible: unknown[], opts: { slugRow?: unknown; codeOwner?: unknown } = {}) {
  const findFirst = jest.fn();
  for (const v of visible) findFirst.mockResolvedValueOnce(v);
  findFirst.mockResolvedValue(null);
  const slugAny = jest.fn().mockResolvedValue(opts.slugRow ?? null);
  const userFind = jest.fn().mockResolvedValue(opts.codeOwner ?? null);
  const prisma = {
    storefront: { findFirst: jest.fn((args: { select: Record<string, boolean>; where: Record<string, unknown> }) => (args.select.slug ? findFirst(args) : slugAny(args))) },
    user: { findFirst: userFind },
  };
  return { prisma: prisma as any, findFirst, slugAny, userFind };
}

describe('resolvePublishedStorefront', () => {
  it('không có chuỗi định danh → null, không truy vấn', async () => {
    const { prisma, findFirst } = fake([]);
    expect(await resolvePublishedStorefront(prisma, VISIBILITY, '  ')).toBeNull();
    expect(await resolvePublishedStorefront(prisma, VISIBILITY, undefined)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('tra slug đã hạ chữ, không phân biệt hoa thường, và chỉ lấy gian hàng khách thấy được', async () => {
    const { prisma, findFirst } = fake([SF]);
    const out = await resolvePublishedStorefront(prisma, VISIBILITY, ' LINH ');
    expect(out).toEqual(SF);
    expect(findFirst).toHaveBeenCalledWith({
      where: { ...publicStorefrontWhere(VISIBILITY), isSample: false, slug: insensitive('linh') },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    });
  });

  it('slug thắng subdomain thắng tên miền riêng: chỉ hỏi cột sau khi cột trước không có (DLSF-01)', async () => {
    const { prisma, findFirst } = fake([null, null, { ...SF, id: 's3' }]);
    const out = await resolvePublishedStorefront(prisma, VISIBILITY, 'linh');
    expect(out?.id).toBe('s3');
    expect(findFirst.mock.calls.map((c) => Object.keys(c[0].where).filter((k) => ['slug', 'subdomain', 'customDomain'].includes(k))[0])).toEqual(['slug', 'subdomain', 'customDomain']);
  });

  it('có dòng mang slug đó nhưng đang ẩn với khách → null, không rơi xuống subdomain của người khác', async () => {
    const { prisma, findFirst } = fake([null], { slugRow: { id: 'hidden' } });
    expect(await resolvePublishedStorefront(prisma, VISIBILITY, 'linh')).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('chuỗi là mã giới thiệu của một tài khoản → subdomain và tên miền chỉ tính khi thuộc đúng chủ mã', async () => {
    const { prisma, findFirst } = fake([null, null], { codeOwner: { id: 'victim' } });
    await resolvePublishedStorefront(prisma, VISIBILITY, 'linh');
    expect(findFirst.mock.calls[1][0].where).toMatchObject({ subdomain: 'linh', ownerUserId: 'victim' });
    expect(findFirst.mock.calls[2][0].where).toMatchObject({ customDomain: 'linh', ownerUserId: 'victim' });
  });

  it('gian hàng mẫu không bao giờ được ghi công', async () => {
    const { prisma, findFirst } = fake([]);
    await resolvePublishedStorefront(prisma, VISIBILITY, 'mebimla');
    expect(findFirst.mock.calls[0][0].where.isSample).toBe(false);
  });

  it('cờ duyệt bật thì điều kiện duyệt đi theo vào truy vấn', async () => {
    const { prisma, findFirst } = fake([]);
    await resolvePublishedStorefront(prisma, { ...VISIBILITY, requireApproval: true }, 'linh');
    const where = findFirst.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }] });
  });
});

describe('loadPublicVisibility', () => {
  const config = (values: Record<string, unknown>) => ({ get: async (k: string, fb?: unknown) => (k in values ? values[k] : fb) }) as any;

  it('mặc định: CTV + đại lý, bắt duyệt lần đầu', async () => {
    expect(await loadPublicVisibility(config({}))).toEqual({ eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: true });
  });

  it('đọc khoá vai trò và cờ duyệt từ cấu hình; cờ lạ không mở', async () => {
    const out = await loadPublicVisibility(config({ 'affiliate.commission_eligible_roles': ['AFFILIATE'], 'storefront.require_approval': true }));
    expect(out).toEqual({ eligibleRoles: ['AFFILIATE'], requireApproval: true });
    expect((await loadPublicVisibility(config({ 'storefront.require_approval': 'true' }))).requireApproval).toBe(false);
  });
});

describe('resolvePublishedStorefront — ký tự đại diện', () => {
  it.each(['%', '_', 'a%', 'a_b'])('chuỗi %p có ký tự đại diện của ILIKE → null, không chạm DB', async (wild) => {
    const { prisma, findFirst } = fake([]);
    expect(await resolvePublishedStorefront(prisma, VISIBILITY, wild)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
