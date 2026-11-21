import { audienceWhere, BANNER_FETCH_LIMIT, liveWhere, listLiveBanners, listPublicCampaignSlugs, PUBLIC_SLUGS_LIMIT, toBannerDTO } from './campaign-public';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz4=';
const NOW = new Date('2026-11-10T17:30:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  placement: 'HOME_TOP',
  image: 'https://cdn.example.com/a.jpg',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: new Date('2026-11-01T00:00:00Z'),
  endAt: new Date('2026-11-11T16:59:59Z'),
  ...over,
}) as never;

describe('liveWhere', () => {
  it('đang bật, startAt <= now < endAt: đúng lúc endAt thì đã hết, đúng lúc startAt thì đã mở', () => {
    expect(liveWhere(NOW, 'HOME_TOP')).toEqual({ placement: 'HOME_TOP', isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } });
  });
  it('không truyền vị trí thì không lọc vị trí (trang chiến dịch theo slug)', () => {
    expect(liveWhere(NOW)).toEqual({ isActive: true, startAt: { lte: NOW }, endAt: { gt: NOW } });
  });
});

describe('audienceWhere', () => {
  it('hỏi theo loại khách thì lấy ALL cộng loại đó (lọc ở DB để trần BANNER_FETCH_LIMIT không cắt mất chiến dịch hợp lệ); không hỏi thì không lọc', () => {
    expect(audienceWhere('NEW')).toEqual({ audience: { in: ['ALL', 'NEW'] } });
    expect(audienceWhere('RETURNING')).toEqual({ audience: { in: ['ALL', 'RETURNING'] } });
    expect(audienceWhere(undefined)).toEqual({});
  });
});

describe('toBannerDTO', () => {
  it('link https giữ nguyên, ngày ra ISO', () => {
    expect(toBannerDTO(row())).toEqual({
      id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'https://cdn.example.com/a.jpg', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL',
      startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-11T16:59:59.000Z',
    });
  });
  it('ảnh base64 ra đường dẫn công khai, không lộ data:', () => {
    const dto = toBannerDTO(row({ image: PNG }))!;
    expect(dto.image).toMatch(/^\/public-image\/campaign\/c1\/cover\?v=[0-9a-f]{16}$/);
  });
  it('ảnh không phục vụ được (SVG) hoặc rỗng: bỏ chiến dịch khỏi banner thay vì để slide trống', () => {
    expect(toBannerDTO(row({ image: SVG }))).toBeNull();
    expect(toBannerDTO(row({ image: '' }))).toBeNull();
  });
});

describe('listLiveBanners', () => {
  const make = (rows: unknown[]) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    return { prisma: { campaign: { findMany } } as never, findMany };
  };

  it('xếp theo thứ tự rồi mới nhất, tối đa BANNER_FETCH_LIMIT, chỉ chiến dịch đang chạy của đúng vị trí', async () => {
    const { prisma, findMany } = make([row()]);
    await listLiveBanners(prisma, 'HOME_TOP', { now: NOW });
    expect(BANNER_FETCH_LIMIT).toBe(10);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: liveWhere(NOW, 'HOME_TOP'),
        orderBy: [{ sortOrder: 'asc' }, { startAt: 'desc' }, { id: 'asc' }],
        take: 10,
      }),
    );
  });

  it('bỏ chiến dịch có ảnh hỏng', async () => {
    const { prisma } = make([row({ id: 'a', image: SVG }), row({ id: 'b' })]);
    expect((await listLiveBanners(prisma, 'HOME_TOP', { now: NOW })).map((b) => b.id)).toEqual(['b']);
  });

  it('hỏi theo loại khách thì đẩy điều kiện đối tượng xuống truy vấn', async () => {
    const { prisma, findMany } = make([row()]);
    await listLiveBanners(prisma, 'HOME_TOP', { now: NOW, audience: 'RETURNING' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...liveWhere(NOW, 'HOME_TOP'), audience: { in: ['ALL', 'RETURNING'] } } }));
  });
});

describe('listPublicCampaignSlugs', () => {
  type Row = Record<string, unknown> & { isActive: boolean; startAt: Date; endAt: Date; linkType: string };
  /** Prisma giả chạy đúng các điều kiện `where` mà hàm gửi xuống, và cố tình trả CẢ dòng (bỏ qua `select`) để thử hàm không làm lộ cột nội bộ. */
  const make = (rows: Row[]) => {
    const findMany = jest.fn(async (args: { where: { isActive?: boolean; startAt?: { lte: Date }; endAt?: { gt: Date }; linkType?: string } }) =>
      rows.filter(
        (r) =>
          (args.where.isActive === undefined || r.isActive === args.where.isActive) &&
          (!args.where.startAt || r.startAt <= args.where.startAt.lte) &&
          (!args.where.endAt || r.endAt > args.where.endAt.gt) &&
          (args.where.linkType === undefined || r.linkType === args.where.linkType),
      ),
    );
    return { prisma: { campaign: { findMany } } as never, findMany };
  };
  const full = (over: Record<string, unknown>): Row =>
    ({
      ...(row(over) as unknown as Row),
      isActive: true,
      subtitle: 'Nội bộ',
      sortOrder: 3,
      placement: 'HOME_TOP',
      createdAt: new Date('2026-10-30T00:00:00Z'),
      updatedAt: new Date('2026-11-09T02:00:00Z'),
      coupons: [{ code: 'BIMAT' }],
      products: [{ productId: 'p1' }],
      ...over,
    }) as Row;

  it('chỉ chiến dịch đang chạy có trang riêng: bỏ bản tắt (nháp), chưa mở, đã hết (đúng lúc endAt) và banner trỏ sản phẩm/danh mục', async () => {
    const { prisma } = make([
      full({ id: 'live', slug: 'giua-thu' }),
      full({ id: 'off', slug: 'ban-nhap', isActive: false }),
      full({ id: 'soon', slug: 'sap-mo', startAt: new Date('2026-11-20T00:00:00Z') }),
      full({ id: 'ended', slug: 'da-het', endAt: NOW }),
      full({ id: 'product', slug: 'tro-san-pham', linkType: 'PRODUCT', linkValue: 'tinh-dau-sa' }),
      full({ id: 'live2', slug: 'black-friday', startAt: NOW, updatedAt: new Date('2026-11-10T01:00:00Z') }),
    ]);
    const out = await listPublicCampaignSlugs(prisma, NOW);
    expect(out.map((c) => c.slug).sort()).toEqual(['black-friday', 'giua-thu']);
  });

  it('mỗi dòng đúng hai khoá slug + updatedAt (ISO): không lộ id, tiêu đề, ảnh, mã giảm giá, sản phẩm hay cờ nội bộ', async () => {
    const { prisma } = make([full({ id: 'live', slug: 'giua-thu' })]);
    const out = await listPublicCampaignSlugs(prisma, NOW);
    expect(out).toEqual([{ slug: 'giua-thu', updatedAt: '2026-11-09T02:00:00.000Z' }]);
    expect(Object.keys(out[0]!)).toEqual(['slug', 'updatedAt']);
    expect(JSON.stringify(out)).not.toMatch(/BIMAT|Nội bộ|p1|live|cdn\.example/);
  });

  it('truy vấn: liveWhere + linkType CAMPAIGN_PAGE, chỉ select slug/updatedAt, mới sửa trước, có trần', async () => {
    const { prisma, findMany } = make([]);
    expect(await listPublicCampaignSlugs(prisma, NOW)).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { ...liveWhere(NOW), linkType: 'CAMPAIGN_PAGE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: PUBLIC_SLUGS_LIMIT,
      select: { slug: true, updatedAt: true },
    });
    expect(PUBLIC_SLUGS_LIMIT).toBe(500);
  });
});
