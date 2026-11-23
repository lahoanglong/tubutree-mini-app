import type { PrismaService } from '../../prisma/prisma.service';
import {
  SearchZeroResultsService,
  ZERO_RESULT_LIMIT,
  isZeroResultCandidate,
  zeroResultDays,
  zeroResultSql,
} from './search-synonyms-zero-results.service';

const NOW = new Date('2026-11-23T10:00:00Z');
const row = (term: string, over: Record<string, unknown> = {}) => ({
  key: term.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase(),
  term,
  count: 3,
  people: 2,
  lastSeenAt: new Date('2026-11-22T08:00:00Z'),
  ...over,
});

function prismaWith(rows: unknown[], synonyms: unknown[] = []) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    searchSynonym: { findMany: jest.fn().mockResolvedValue(synonyms) },
  } as unknown as PrismaService & { $queryRaw: jest.Mock; searchSynonym: { findMany: jest.Mock } };
}

describe('Từ khoá tìm chưa ra (search_zero_result)', () => {
  it('isZeroResultCandidate: bỏ SĐT (kể cả có dấu cách/chấm/gạch), email, link, chuỗi gõ bừa, cụm chỉ có số, quá ngắn hay quá dài', () => {
    for (const t of ['0912345678', '0912 345 678', '091.234.5678', '0912-345-678', 'an@gmail.com', 'mua 0912345678', 'https://shopee.vn/abc', 'www.abc.vn']) {
      expect(isZeroResultCandidate(t)).toBe(false);
    }
    expect(isZeroResultCandidate('a')).toBe(false);
    expect(isZeroResultCandidate('x'.repeat(61))).toBe(false);
    expect(isZeroResultCandidate('asdkjhaskjdhaksjdhaksjdhaksjd')).toBe(false);
    expect(isZeroResultCandidate('500 1000')).toBe(false);
    for (const t of ['nước rửa bát', 'xà bông 500ml', 'fuwa3e', 'kem 50ml', 'túi 3 lớp']) expect(isZeroResultCandidate(t)).toBe(true);
  });

  it('zeroResultDays: mặc định 14, kẹp 1..90, chữ hay số âm thì về 14', () => {
    expect(zeroResultDays(undefined)).toBe(14);
    expect(zeroResultDays('7')).toBe(7);
    expect(zeroResultDays('365')).toBe(90);
    expect(zeroResultDays('0')).toBe(14);
    expect(zeroResultDays('-3')).toBe(14);
    expect(zeroResultDays('abc')).toBe(14);
    expect(zeroResultDays(['7'])).toBe(14);
  });

  it('zeroResultSql: chỉ sự kiện search_zero_result trong khung, gộp theo vn_search_fold, lọc @ và dãy số ngay trong SQL, mọi giá trị là tham số', () => {
    const since = new Date('2026-11-09T10:00:00Z');
    const until = new Date('2026-11-24T10:00:00Z');
    const sql = zeroResultSql(since, until);
    expect(sql.sql).toContain(`"eventName" = 'search_zero_result'`);
    expect(sql.sql).toContain('vn_search_fold');
    expect(sql.sql).toContain("position('@' in s.q) = 0");
    expect(sql.sql).toContain("!~ '[0-9]{6,}'");
    expect(sql.sql).toContain('GROUP BY s.k');
    expect(sql.sql).toContain('MAX(s.at) AS last_seen');
    expect(sql.values).toEqual(expect.arrayContaining([since, until]));
    expect(sql.sql).not.toContain('2026-');
  });

  it('report: khung 14 ngày tính từ bây giờ, lọc PII lần nữa ở TS, đánh dấu cụm đã có từ đồng nghĩa', async () => {
    const prisma = prismaWith(
      [row('nước rửa bát', { count: 9, people: 5 }), row('0912 345 678'), row('chị lan@gmail'), row('xà bông cục', { lastSeenAt: new Date('2026-11-30T00:00:00Z') })],
      [{ term: 'nuoc rua bat', canonical: 'nuoc rua chen', isActive: false }],
    );
    const out = await new SearchZeroResultsService(prisma).report(14, NOW);
    const [sql] = prisma.$queryRaw.mock.calls[0] as [{ values: unknown[] }];
    expect(sql.values).toContainEqual(new Date('2026-11-09T10:00:00Z'));
    expect(out.days).toBe(14);
    expect(out.items.map((i) => i.term)).toEqual(['nước rửa bát', 'xà bông cục']);
    expect(out.items[0]).toEqual({ term: 'nước rửa bát', count: 9, people: 5, lastSeenAt: '2026-11-22T08:00:00.000Z', synonym: { canonical: 'nuoc rua chen', isActive: false } });
    // Đồng hồ máy khách chạy trước: ngày thấy gần nhất không vượt quá bây giờ.
    expect(out.items[1]!.lastSeenAt).toBe(NOW.toISOString());
    expect(out.items[1]!.synonym).toBeNull();
    expect(prisma.searchSynonym.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { term: { in: ['nuoc rua bat', 'xa bong cuc'] } } }));
  });

  it('report: tối đa 30 cụm; không có dòng nào thì không đọc bảng từ đồng nghĩa', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(`cụm thứ ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`));
    expect((await new SearchZeroResultsService(prismaWith(many)).report(14, NOW)).items).toHaveLength(ZERO_RESULT_LIMIT);
    const empty = prismaWith([]);
    expect(await new SearchZeroResultsService(empty).report(7, NOW)).toEqual({ days: 7, items: [] });
    expect(empty.searchSynonym.findMany).not.toHaveBeenCalled();
  });
});
