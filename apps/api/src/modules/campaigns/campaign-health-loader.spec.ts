import { campaignHealthBatch, type HealthRequest } from './campaign-health-loader';
import type { HealthSubject } from './campaign-health';

const NOW = new Date('2026-11-05T05:00:00Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);

const subject = (id: string, over: Partial<HealthSubject> = {}): HealthSubject => ({
  id,
  placement: 'HOME_TOP',
  audience: 'ALL',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  startAt: at(-1),
  endAt: at(10),
  sortOrder: 0,
  ...over,
});

const prod = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `SP ${id}`,
  slug: `sp-${id}`,
  isActive: true,
  approvalStatus: 'APPROVED',
  variations: [{ isActive: true, stock: 5 }],
  ...over,
});

function fakePrisma(world: {
  links?: { campaignId: string; product: ReturnType<typeof prod> }[];
  couponLinks?: { campaignId: string; coupon: Record<string, unknown> }[];
  products?: ReturnType<typeof prod>[];
  coupons?: Record<string, unknown>[];
  categories?: { slug: string }[];
  peers?: Record<string, unknown>[];
  /** Dòng truy vấn đầu ảnh (`left(image, 32)`) của các chiến dịch bật cùng vị trí; chiến dịch không có dòng thì coi là ảnh phục vụ được. */
  imageHeads?: { id: string; head: string }[];
} = {}) {
  return {
    campaignProduct: { findMany: jest.fn().mockResolvedValue(world.links ?? []) },
    campaignCoupon: { findMany: jest.fn().mockResolvedValue(world.couponLinks ?? []) },
    product: { findMany: jest.fn().mockResolvedValue(world.products ?? []) },
    coupon: { findMany: jest.fn().mockResolvedValue(world.coupons ?? []) },
    category: { findMany: jest.fn().mockResolvedValue(world.categories ?? []) },
    campaign: { findMany: jest.fn().mockResolvedValue(world.peers ?? []) },
    $queryRaw: jest.fn().mockResolvedValue(world.imageHeads ?? []),
  };
}
const calls = (p: ReturnType<typeof fakePrisma>) =>
  p.$queryRaw.mock.calls.length + Object.values(p).reduce((n, m) => n + ('findMany' in m ? m.findMany.mock.calls.length : 0), 0);

describe('campaignHealthBatch', () => {
  it('không N+1: số truy vấn như nhau cho 3 hay 60 chiến dịch', async () => {
    const small = fakePrisma();
    await campaignHealthBatch(small as never, [1, 2, 3].map((n) => ({ subject: subject(`c${n}`) })), NOW);
    const big = fakePrisma();
    const many: HealthRequest[] = Array.from({ length: 60 }, (_, n) => ({
      subject: subject(`c${n}`, n % 2 ? { linkType: 'PRODUCT', linkValue: `sp-${n}` } : { linkType: 'CATEGORY', linkValue: `dm-${n}` }),
    }));
    await campaignHealthBatch(big as never, many, NOW);
    expect(calls(big)).toBe(calls(small) + 2);
    expect(calls(big)).toBeLessThanOrEqual(7);
    expect(big.campaignProduct.findMany).toHaveBeenCalledTimes(1);
    expect(big.campaignCoupon.findMany).toHaveBeenCalledTimes(1);
  });

  it('sản phẩm/mã gắn trong DB: dựng đúng dữ kiện, ẩn và hết hàng thành cảnh báo', async () => {
    const prisma = fakePrisma({
      links: [
        { campaignId: 'c1', product: prod('a') },
        { campaignId: 'c1', product: prod('b', { variations: [{ isActive: true, stock: 0 }] }) },
        { campaignId: 'c2', product: prod('c', { approvalStatus: 'PENDING_REVIEW' }) },
      ],
      couponLinks: [{ campaignId: 'c1', coupon: { code: 'HET', isActive: true, startAt: at(-9), endAt: at(-1), usageLimit: null, usedCount: 0 } }],
    });
    const [c1 = [], c2 = [], c3 = []] = await campaignHealthBatch(prisma as never, [{ subject: subject('c1') }, { subject: subject('c2') }, { subject: subject('c3') }], NOW);
    expect(c1.map((i) => i.code)).toEqual(['COUPON_EXPIRED', 'PRODUCTS_UNAVAILABLE']);
    expect(c2.map((i) => i.code)).toEqual(['PAGE_EMPTY', 'PRODUCTS_UNAVAILABLE']);
    expect(c3.map((i) => i.code)).toEqual(['PAGE_EMPTY']);
  });

  it('chiến dịch đang soạn (chưa lưu): dùng danh sách gửi lên, không đọc liên kết trong DB', async () => {
    const prisma = fakePrisma({ products: [prod('a')], coupons: [{ code: 'GIAM10', isActive: false, startAt: at(-9), endAt: at(30), usageLimit: null, usedCount: 0 }] });
    const [issues = []] = await campaignHealthBatch(prisma as never, [{ subject: { ...subject('x'), id: undefined }, productIds: ['a'], couponCodes: ['giam10'] }], NOW);
    expect(issues.map((i) => i.code)).toEqual(['COUPON_OFF']);
    expect(prisma.campaignProduct.findMany).not.toHaveBeenCalled();
    expect(prisma.coupon.findMany.mock.calls[0][0].where).toEqual({ code: { in: ['GIAM10'] } });
  });

  it('đích sản phẩm/danh mục tra theo lô bằng slug', async () => {
    const prisma = fakePrisma({
      products: [prod('p1', { slug: 'an', isActive: false }), prod('p2', { slug: 'ok' })],
      categories: [{ slug: 'sua' }],
    });
    const reqs: HealthRequest[] = [
      { subject: subject('a', { linkType: 'PRODUCT', linkValue: 'an' }) },
      { subject: subject('b', { linkType: 'PRODUCT', linkValue: 'ok' }) },
      { subject: subject('c', { linkType: 'PRODUCT', linkValue: 'khong' }) },
      { subject: subject('d', { linkType: 'CATEGORY', linkValue: 'sua' }) },
      { subject: subject('e', { linkType: 'CATEGORY', linkValue: 'khac' }) },
    ];
    const out = await campaignHealthBatch(prisma as never, reqs.map((r) => ({ ...r, productIds: ['x'], couponCodes: [] })), NOW);
    const first = out.map((i) => i.find((x) => x.level === 'BLOCK')?.code ?? null);
    expect(first).toEqual(['LINK_PRODUCT_HIDDEN', null, 'LINK_PRODUCT_MISSING', null, 'LINK_CATEGORY_MISSING']);
  });

  it('chiến dịch bật khác cùng vị trí được nạp một lần để tính chồng banner', async () => {
    const peers = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, placement: 'HOME_TOP', audience: 'ALL', startAt: at(-1), endAt: at(10), sortOrder: 0, linkType: 'CAMPAIGN_PAGE', linkValue: null }));
    const prisma = fakePrisma({ peers, products: [prod('a')] });
    const [issues = []] = await campaignHealthBatch(prisma as never, [{ subject: subject('zz', { sortOrder: 9 }), productIds: ['a'], couponCodes: [] }], NOW);
    expect(issues.map((i) => i.code)).toEqual(['CROWDED']);
    expect(prisma.campaign.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.campaign.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, placement: { in: ['HOME_TOP'] } });
  });

  it('đối thủ ảnh rỗng, SVG hỏng hay đích không dựng được link không tính là slide: 5 đối thủ như vậy không làm chiến dịch này CROWDED', async () => {
    const mk = (id: string, over: Record<string, unknown> = {}) => ({ id, placement: 'HOME_TOP', audience: 'ALL', startAt: at(-1), endAt: at(10), sortOrder: 0, linkType: 'CAMPAIGN_PAGE', linkValue: null, ...over });
    const peers = [mk('p1'), mk('p2'), mk('p3', { linkType: 'PRODUCT', linkValue: 'có dấu' }), mk('p4', { linkType: 'URL_INTERNAL', linkValue: '/khong-co' }), mk('p5', { linkType: 'CATEGORY', linkValue: null })];
    const prisma = fakePrisma({ peers, imageHeads: [{ id: 'p1', head: '' }, { id: 'p2', head: 'data:image/svg+xml;base64,PHN2Zz4=' }, { id: 'p3', head: 'https://cdn.test/a.jpg' }], products: [prod('a')] });
    const [issues = []] = await campaignHealthBatch(prisma as never, [{ subject: subject('zz', { sortOrder: 9 }), productIds: ['a'], couponCodes: [] }], NOW);
    expect(issues.map((i) => i.code)).toEqual([]);
    // Chỉ đọc 32 ký tự đầu của ảnh ở DB (không kéo cả base64, không buộc Postgres đọc trọn TOAST), tham số hoá theo id.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ids] = prisma.$queryRaw.mock.calls[0] as [string[], { values: unknown[] }];
    expect(strings.join('?')).toContain('left("image", 32)');
    expect(ids.values).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('đầu ảnh raster hợp lệ thì ra slide; đầu data URL lạ hay rỗng thì không', async () => {
    const mk = (id: string) => ({ id, placement: 'HOME_TOP', audience: 'ALL', startAt: at(-1), endAt: at(10), sortOrder: 0, linkType: 'CAMPAIGN_PAGE', linkValue: null });
    const peers = ['p1', 'p2', 'p3', 'p4', 'p5'].map(mk);
    const run = async (head: string) => {
      const imageHeads = peers.map((p) => ({ id: p.id, head }));
      const [issues = []] = await campaignHealthBatch(fakePrisma({ peers, imageHeads, products: [prod('a')] }) as never, [{ subject: subject('zz', { sortOrder: 9 }), productIds: ['a'], couponCodes: [] }], NOW);
      return issues.map((i) => i.code);
    };
    expect(await run('data:image/png;base64,iVBORw0KGgo')).toEqual(['CROWDED']);
    expect(await run('https://cdn.test/banner.jpg')).toEqual(['CROWDED']);
    expect(await run('data:image/svg+xml;base64,PHN2Zz4')).toEqual([]);
    expect(await run('')).toEqual([]);
  });

  it('chiến dịch đã kết thúc: không nạp liên kết, đích hay chiến dịch khác; chỉ báo ngày kết thúc', async () => {
    const prisma = fakePrisma();
    const [issues = []] = await campaignHealthBatch(prisma as never, [{ subject: subject('old', { endAt: at(-1), linkType: 'PRODUCT', linkValue: 'sp' }) }], NOW);
    expect(issues.map((i) => i.code)).toEqual(['ENDED']);
    expect(calls(prisma)).toBe(0);
  });

  it('danh sách rỗng: không truy vấn', async () => {
    const prisma = fakePrisma();
    expect(await campaignHealthBatch(prisma as never, [], NOW)).toEqual([]);
    expect(calls(prisma)).toBe(0);
  });
});
