import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { POPULAR_MAX, POPULAR_MIN_PEOPLE, SEARCH_POPULAR_FLAG, SearchPopularService, isPopularCandidate, mergePopular, popularSql } from './search-popular.service';

const config = (values: Record<string, unknown>) =>
  ({ get: jest.fn(async (k: string, fb: unknown) => (k in values ? values[k] : fb)) }) as unknown as SystemConfigService;

describe('Từ khoá phổ biến', () => {
  it('isPopularCandidate: bỏ cụm có @, dãy ≥ 6 chữ số (kể cả cách nhau bằng dấu cách/chấm), quá ngắn hay quá dài', () => {
    expect(isPopularCandidate('nước giặt')).toBe(true);
    expect(isPopularCandidate('fuwa3e 500ml')).toBe(true);
    expect(isPopularCandidate('0912345678')).toBe(false);
    expect(isPopularCandidate('0912 345 678')).toBe(false);
    expect(isPopularCandidate('091.234.5678')).toBe(false);
    expect(isPopularCandidate('an@gmail.com')).toBe(false);
    expect(isPopularCandidate('a')).toBe(false);
    expect(isPopularCandidate('x'.repeat(41))).toBe(false);
    expect(isPopularCandidate('12345')).toBe(true);
  });

  it('mergePopular: dữ liệu trước, gộp theo dạng gấp dấu; đủ 4 cụm thì không bù; tối đa 8', () => {
    expect(mergePopular(['nước giặt', 'nuoc giat', 'cà phê', 'granola', 'cho bé'], ['rửa tay'])).toEqual(['nước giặt', 'cà phê', 'granola', 'cho bé']);
    expect(mergePopular(['nước giặt'], ['Nuoc giat', 'rửa tay', 42, '0912345678'])).toEqual(['nước giặt', 'rửa tay']);
    expect(mergePopular([], Array.from({ length: 20 }, (_, i) => `cụm ${i}`))).toHaveLength(POPULAR_MAX);
  });

  it('isPopularCandidate: số điện thoại ngăn bằng ký tự bất kỳ vẫn bị bỏ; số đo ngắn trong tên hàng vẫn giữ', () => {
    for (const t of ['0912 345 678', '0912_345_678', '0912/345/678', '0912,345,678', 'a@b.vn']) expect(isPopularCandidate(t)).toBe(false);
    for (const t of ['kem 50ml', 'túi 3 lớp', 'nước giặt']) expect(isPopularCandidate(t)).toBe(true);
  });

  it('popularSql: 14 ngày, có kết quả, ≥ 3 người, lọc @ và dãy số ngay trong SQL, mọi giá trị là tham số', () => {
    const since = new Date('2026-11-04T00:00:00Z');
    const sql = popularSql(since);
    expect(sql.sql).toContain(`"eventName" = 'search_performed'`);
    expect(sql.sql).toContain('vn_search_fold');
    expect(sql.sql).toContain("position('@' in s.q) = 0");
    expect(sql.sql).toContain("!~ '[0-9]{6,}'");
    expect(sql.sql).toContain("regexp_replace(s.q, '[^[:alnum:]]', '', 'g')");
    // Mọi từ của cụm phải có trong tên một sản phẩm đang bán.
    expect(sql.sql).toMatch(/FROM products p[\s\S]*"approvalStatus" = 'APPROVED'[\s\S]*strpos\(p\."nameSearch", w\.t\) = 0/);
    expect(sql.values).toContain(since);
    expect(sql.values).toContain(POPULAR_MIN_PEOPLE);
  });

  it('cờ tắt: rỗng, không đọc analytics', async () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    const svc = new SearchPopularService(prisma, config({ [SEARCH_POPULAR_FLAG]: false }));
    await expect(svc.popular()).resolves.toEqual({ terms: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('cờ bật: dữ liệu ít thì bù dự phòng; đệm 1 giờ; SQL lỗi thì vẫn có dự phòng', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValueOnce([{ display: 'nước giặt' }]).mockRejectedValue(new Error('down')) } as unknown as PrismaService;
    const svc = new SearchPopularService(prisma, config({ [SEARCH_POPULAR_FLAG]: true, 'catalog.search_popular_terms': ['rửa tay', 'cà phê'] }));
    await expect(svc.popular()).resolves.toEqual({ terms: ['nước giặt', 'rửa tay', 'cà phê'] });
    await svc.popular();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const fresh = new SearchPopularService(prisma, config({ [SEARCH_POPULAR_FLAG]: true, 'catalog.search_popular_terms': ['rửa tay'] }));
    await expect(fresh.popular()).resolves.toEqual({ terms: ['rửa tay'] });
  });
});
