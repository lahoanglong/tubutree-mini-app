import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import {
  SUGGESTION_MAX,
  SUGGESTION_POPULAR_LIMIT,
  SearchZeroResultsService,
  ZERO_RESULT_LIMIT,
  isZeroResultCandidate,
  suggestCanonicals,
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

/** Lần gọi `$queryRaw` đầu là bảng tìm chưa ra, lần sau là cụm tìm phổ biến có hàng (nguồn gợi ý). */
function prismaWith(rows: unknown[], synonyms: unknown[] = [], popular: unknown[] = []) {
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(popular.map((display) => ({ display }))),
    searchSynonym: { findMany: jest.fn().mockResolvedValue(synonyms) },
  } as unknown as PrismaService & { $queryRaw: jest.Mock; searchSynonym: { findMany: jest.Mock } };
}

const configWith = (get: jest.Mock) => ({ get }) as unknown as SystemConfigService;
const CURATED = ['nước giặt', 'nước rửa chén', 'nước lau sàn', 'rửa tay', 'cho bé', 'granola', 'cà phê', 'đông trùng hạ thảo'];

describe('Từ khoá tìm chưa ra (search_zero_result)', () => {
  it('isZeroResultCandidate: bỏ SĐT (kể cả có dấu cách/chấm/gạch), email, link, chuỗi gõ bừa, cụm chỉ có số, quá ngắn hay quá dài', () => {
    for (const t of ['0912345678', '0912 345 678', '091.234.5678', '0912-345-678', 'an@gmail.com', 'mua 0912345678', 'https://shopee.vn/abc', 'www.abc.vn']) {
      expect(isZeroResultCandidate(t)).toBe(false);
    }
    expect(isZeroResultCandidate('a')).toBe(false);
    expect(isZeroResultCandidate('x'.repeat(61))).toBe(false);
    expect(isZeroResultCandidate('asdkjhaskjdhaksjdhaksjdhaksjd')).toBe(false);
    expect(isZeroResultCandidate('500 1000')).toBe(false);
    // Chữ số toàn khổ (bàn phím IME) vẫn là số điện thoại.
    expect(isZeroResultCandidate('mua ０９１２３４５６７８')).toBe(false);
    expect(isZeroResultCandidate('mua ０９１２ ３４５ ６７８')).toBe(false);
    expect(isZeroResultCandidate('chị lan＠gmail')).toBe(false);
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
    // Rác bị lọc trước LIMIT, không chiếm chỗ của cụm thật.
    expect(sql.sql).toContain("s.k ~ '[a-z]'");
    expect(sql.sql).toContain("s.k !~ '(https?:|www[.]|://)'");
    expect(sql.values).toContain('[^ ]{26,}');
    expect(sql.values).toEqual(expect.arrayContaining([since, until]));
    expect(sql.sql).not.toContain('2026-');
  });

  it('report: khung 14 ngày tính từ bây giờ, lọc PII lần nữa ở TS, đánh dấu cụm đã có từ đồng nghĩa', async () => {
    const prisma = prismaWith(
      [row('nước rửa bát', { count: 9, people: 5 }), row('0912 345 678'), row('chị lan@gmail'), row('xà bông cục', { term: 'xà bÔNG cỤC', lastSeenAt: new Date('2026-11-30T00:00:00Z') })],
      [{ term: 'nuoc rua bat', canonical: 'nuoc rua chen', isActive: false }],
    );
    const out = await new SearchZeroResultsService(prisma).report(14, NOW);
    const [sql] = prisma.$queryRaw.mock.calls[0] as [{ values: unknown[] }];
    expect(sql.values).toContainEqual(new Date('2026-11-09T10:00:00Z'));
    expect(out.days).toBe(14);
    expect(out.items.map((i) => i.term)).toEqual(['nước rửa bát', 'xà bông cục']);
    expect(out.items[0]).toEqual({
      term: 'nước rửa bát',
      count: 9,
      people: 5,
      lastSeenAt: '2026-11-22T08:00:00.000Z',
      synonym: { canonical: 'nuoc rua chen', isActive: false },
      suggestions: [],
    });
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

  it('suggestCanonicals: cụm có dấu và không dấu ra cùng gợi ý, xếp theo độ giống rồi thứ tự nguồn, tối đa 2', () => {
    expect(suggestCanonicals('nước rửa bát', CURATED)).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('nuoc rua bat', CURATED)).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('NUOC  RUA   BAT', CURATED)).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('bột giặt', CURATED)).toEqual(['nước giặt']);
    expect(suggestCanonicals('do cho be', CURATED)).toEqual(['cho bé']);
    // "nước rửa chén" (2/3 điểm) đứng trước; "nước giặt" và "rửa tay" cùng 1/2 điểm thì giữ thứ tự nguồn.
    expect(suggestCanonicals('nước rửa', CURATED)).toEqual(['nước rửa chén', 'nước giặt']);
    expect(SUGGESTION_MAX).toBe(2);
  });

  it('suggestCanonicals: gõ sai một ký tự hay dính chữ vẫn gợi ý; chữ ngắn lệch một ký tự thì không', () => {
    expect(suggestCanonicals('granla', CURATED)).toEqual(['granola']);
    expect(suggestCanonicals('nuocgiat', CURATED)).toEqual(['nước giặt']);
    expect(suggestCanonicals('ca pha', CURATED)).toEqual(['cà phê']);
    expect(suggestCanonicals('xà bông', CURATED)).toEqual([]);
    expect(suggestCanonicals('kem', ['kim'])).toEqual([]);
  });

  it('suggestCanonicals: bỏ cụm trùng sau khi gấp dấu, cụm bị chặn, cụm lặp, giá trị không phải chuỗi và cụm ngoài biên', () => {
    expect(suggestCanonicals('nuoc giat', ['nước giặt', 'Nước Giặt'])).toEqual([]);
    expect(suggestCanonicals('nuoc rua bat', ['nước rửa chén'], new Set(['nuoc rua chen']))).toEqual([]);
    expect(suggestCanonicals('nuoc rua bat', [42, null, 'nước rửa chén', 'nuoc rua chen'])).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('nuoc rua bat', ['nƯỚc  RỬA chén'])).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('nuoc rua bat', ['nước rửa ' + 'x'.repeat(60)])).toEqual([]);
    expect(suggestCanonicals('   ', CURATED)).toEqual([]);
  });

  it('report: dòng chưa có từ đồng nghĩa nhận gợi ý từ system_configs trước rồi cụm tìm phổ biến có hàng; cụm chuẩn cũng tìm chưa ra thì không gợi ý', async () => {
    const prisma = prismaWith(
      [row('nuoc rua bat', { count: 5 }), row('granla', { count: 4 }), row('nuoc lau kinh', { count: 3 }), row('nước giặt xả')],
      [{ term: 'nuoc giat xa', canonical: 'nuoc giat', isActive: true }],
      ['nước lau kính', 'granola hạt', 'nước rửa chén'],
    );
    const get = jest.fn().mockResolvedValue(CURATED);
    const out = await new SearchZeroResultsService(prisma, configWith(get)).report(14, NOW);
    expect(get).toHaveBeenCalledWith('catalog.search_popular_terms', []);
    const [, popular] = prisma.$queryRaw.mock.calls.map((c) => c[0] as { sql: string; values: unknown[] });
    expect(popular!.sql).toContain(`"eventName" = 'search_performed'`);
    expect(popular!.values).toContain(SUGGESTION_POPULAR_LIMIT);
    expect(popular!.values).toContainEqual(new Date('2026-11-09T10:00:00Z'));
    expect(Object.fromEntries(out.items.map((i) => [i.term, i.suggestions]))).toEqual({
      'nuoc rua bat': ['nước rửa chén'],
      // "granola hạt" chỉ khớp gần một chữ trên hai (0,375 điểm).
      granla: ['granola'],
      // "nước lau kính" của dữ liệu cũng nằm trong bảng tìm chưa ra: bỏ; còn "nước lau sàn" của admin.
      'nuoc lau kinh': ['nước lau sàn'],
      'nước giặt xả': [],
    });
  });

  it('report: mọi dòng đã có từ đồng nghĩa thì không đọc nguồn gợi ý; nguồn gợi ý lỗi vẫn trả bảng', async () => {
    const done = prismaWith([row('nuoc rua bat')], [{ term: 'nuoc rua bat', canonical: 'nuoc rua chen', isActive: true }]);
    const get = jest.fn();
    await new SearchZeroResultsService(done, configWith(get)).report(14, NOW);
    expect(get).not.toHaveBeenCalled();
    expect(done.$queryRaw).toHaveBeenCalledTimes(1);

    const broken = prismaWith([row('nuoc rua bat')]);
    broken.$queryRaw.mockReset().mockResolvedValueOnce([row('nuoc rua bat')]).mockRejectedValueOnce(new Error('timeout'));
    const out = await new SearchZeroResultsService(broken, configWith(jest.fn().mockRejectedValue(new Error('db')))).report(14, NOW);
    expect(out.items).toEqual([expect.objectContaining({ term: 'nuoc rua bat', synonym: null, suggestions: [] })]);

    const curatedOnly = prismaWith([row('nuoc rua bat')]);
    curatedOnly.$queryRaw.mockReset().mockResolvedValueOnce([row('nuoc rua bat')]).mockRejectedValueOnce(new Error('timeout'));
    const viaConfig = await new SearchZeroResultsService(curatedOnly, configWith(jest.fn().mockResolvedValue(CURATED))).report(14, NOW);
    expect(viaConfig.items[0]!.suggestions).toEqual(['nước rửa chén']);
  });
});
