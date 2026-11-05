import { audienceWhere, BANNER_FETCH_LIMIT, liveWhere, listLiveBanners, toBannerDTO } from './campaign-public';

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
