import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import {
  SUGGESTION_MAX,
  SUGGESTION_POPULAR_LIMIT,
  SUGGESTION_POPULAR_TTL_MS,
  SearchZeroResultsService,
  ZERO_RESULT_LIMIT,
  isZeroResultCandidate,
  liveKeywordsSql,
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

type RawSql = { sql: string; values: unknown[] };
/**
 * `$queryRaw` trả theo câu SQL: bảng tìm chưa ra (`rows`), cụm tìm phổ biến có hàng (`popular`), hay cụm admin còn ra hàng (`live`: khoá gấp
 * dấu; bỏ trống thì mọi khoá gửi lên đều còn ra hàng).
 */
function prismaWith(rows: unknown[], synonyms: unknown[] = [], popular: unknown[] = [], live?: string[]) {
  const $queryRaw = jest.fn((q: RawSql) => {
    if (q.sql.includes("'search_zero_result'")) return Promise.resolve(rows);
    if (q.sql.includes("'search_performed'")) return Promise.resolve(popular.map((display) => ({ display })));
    const keys = q.values[0] as string[];
    return Promise.resolve(keys.filter((k) => !live || live.includes(k)).map((key) => ({ key })));
  });
  return {
    $queryRaw,
    searchSynonym: { findMany: jest.fn().mockResolvedValue(synonyms) },
  } as unknown as PrismaService & { $queryRaw: jest.Mock; searchSynonym: { findMany: jest.Mock } };
}
const sqlCalls = (prisma: { $queryRaw: jest.Mock }, marker: string) =>
  prisma.$queryRaw.mock.calls.map((c) => c[0] as RawSql).filter((q) => q.sql.includes(marker));

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
    expect(suggestCanonicals('do cho be', CURATED)).toEqual(['cho bé']);
    // "nước rửa chén" (2/3 điểm) đứng trước "nước giặt" (1/2, chữ khớp "nuoc" dài 4); "rửa tay" cũng 1/2 nhưng chữ khớp "rua" quá ngắn.
    expect(suggestCanonicals('nước rửa', CURATED)).toEqual(['nước rửa chén', 'nước giặt']);
    expect(suggestCanonicals('nuoc rua', ['nước giặt', 'nước lau sàn', 'nước rửa chén'], 1)).toEqual(['nước rửa chén']);
    expect(SUGGESTION_MAX).toBe(2);
  });

  it('suggestCanonicals: đúng nửa điểm chỉ đủ khi chữ khớp dài từ 4 ký tự', () => {
    expect(suggestCanonicals('bột giặt', CURATED)).toEqual(['nước giặt']);
    expect(suggestCanonicals('cho mèo', CURATED)).toEqual([]);
    expect(suggestCanonicals('nhỏ bé', CURATED)).toEqual([]);
    expect(suggestCanonicals('ca pha', CURATED)).toEqual([]);
    expect(suggestCanonicals('xà bông', CURATED)).toEqual([]);
  });

  it('suggestCanonicals: gõ sai một ký tự ở chữ dài, hay dính/tách chữ, vẫn gợi ý; chữ ngắn lệch một ký tự thì không', () => {
    expect(suggestCanonicals('granla', CURATED)).toEqual(['granola']);
    expect(suggestCanonicals('nuocgiat', CURATED)).toEqual(['nước giặt']);
    expect(suggestCanonicals('gra nola', CURATED)).toEqual(['granola']);
    expect(suggestCanonicals('kem', ['kim'])).toEqual([]);
  });

  it('suggestCanonicals: bỏ cụm trùng sau khi gấp dấu, cụm lặp, giá trị không phải chuỗi và cụm ngoài biên; hạ chữ hoa có dấu', () => {
    expect(suggestCanonicals('nuoc giat', ['nước giặt', 'Nước Giặt'])).toEqual([]);
    expect(suggestCanonicals('nuoc rua bat', [42, null, 'nước rửa chén', 'nuoc rua chen'])).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('nuoc rua bat', ['nƯỚc  RỬA chén'])).toEqual(['nước rửa chén']);
    expect(suggestCanonicals('nuoc rua bat', ['nước rửa ' + 'x'.repeat(60)])).toEqual([]);
    expect(suggestCanonicals('   ', CURATED)).toEqual([]);
  });

  it('liveKeywordsSql: mọi chữ của cụm phải có trong tên một món đang bán; danh sách là tham số mảng', () => {
    const sql = liveKeywordsSql(['nuoc giat', 'cho be']);
    expect(sql.text).toContain('unnest($1::text[])');
    expect(sql.sql).toMatch(/FROM products p[\s\S]*"isActive" = true[\s\S]*"approvalStatus" = 'APPROVED'[\s\S]*strpos\(p\."nameSearch", w\.t\) = 0/);
    expect(sql.values).toEqual([['nuoc giat', 'cho be']]);
  });

  it('report: dòng chưa có từ đồng nghĩa nhận gợi ý từ cụm admin còn ra hàng trước, rồi cụm tìm phổ biến có hàng', async () => {
    const prisma = prismaWith(
      [row('nuoc rua bat', { count: 5 }), row('granla', { count: 4 }), row('nuoc lau kinh', { count: 3 }), row('nước giặt xả')],
      [{ term: 'nuoc giat xa', canonical: 'nuoc giat', isActive: true }],
      ['nước lau kính', 'granola hạt', 'nước rửa chén', 'GRANOLA'],
      ['nuoc giat', 'nuoc rua chen', 'rua tay', 'cho be', 'granola', 'ca phe', 'dong trung ha thao'],
    );
    const get = jest.fn().mockResolvedValue([...CURATED, 7]);
    const out = await new SearchZeroResultsService(prisma, configWith(get)).report(14, NOW);
    expect(get).toHaveBeenCalledWith('catalog.search_popular_terms', []);
    const [popular] = sqlCalls(prisma, "'search_performed'");
    expect(popular!.values).toContain(SUGGESTION_POPULAR_LIMIT);
    expect(popular!.values).toContainEqual(new Date('2026-11-09T10:00:00Z'));
    const [live] = sqlCalls(prisma, 'AS c(k)');
    expect(live!.values[0]).toEqual(['nuoc giat', 'nuoc rua chen', 'nuoc lau san', 'rua tay', 'cho be', 'granola', 'ca phe', 'dong trung ha thao']);
    expect(Object.fromEntries(out.items.map((i) => [i.term, i.suggestions]))).toEqual({
      'nuoc rua bat': ['nước rửa chén'],
      // "granola hạt" chỉ khớp gần một chữ trên hai (0,375 điểm); "GRANOLA" trùng "granola" của admin.
      granla: ['granola'],
      // "nước lau sàn" của admin không còn món nào; "nước lau kính" trùng chính cụm khách gõ.
      'nuoc lau kinh': [],
      'nước giặt xả': [],
    });
  });

  it('report: cụm tìm phổ biến cho gợi ý đệm 5 phút; mọi dòng đã có từ đồng nghĩa thì không đọc nguồn gợi ý', async () => {
    const prisma = prismaWith([row('nuoc rua bat')], [], ['nước rửa chén']);
    const svc = new SearchZeroResultsService(prisma);
    expect((await svc.report(14, NOW)).items[0]!.suggestions).toEqual(['nước rửa chén']);
    await svc.report(14, new Date(NOW.getTime() + SUGGESTION_POPULAR_TTL_MS - 1));
    expect(sqlCalls(prisma, "'search_performed'")).toHaveLength(1);
    await svc.report(14, new Date(NOW.getTime() + SUGGESTION_POPULAR_TTL_MS));
    expect(sqlCalls(prisma, "'search_performed'")).toHaveLength(2);

    const done = prismaWith([row('nuoc rua bat')], [{ term: 'nuoc rua bat', canonical: 'nuoc rua chen', isActive: true }]);
    const get = jest.fn();
    await new SearchZeroResultsService(done, configWith(get)).report(14, NOW);
    expect(get).not.toHaveBeenCalled();
    expect(done.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('report: nguồn gợi ý lỗi thì bỏ nguồn đó, bảng vẫn trả về; lỗi không được đệm', async () => {
    const failing = (prisma: { $queryRaw: jest.Mock }, marker: string) => {
      const impl = prisma.$queryRaw.getMockImplementation()!;
      prisma.$queryRaw.mockImplementation((q: RawSql) => (q.sql.includes(marker) ? Promise.reject(new Error('timeout')) : impl(q)));
    };
    const broken = prismaWith([row('nuoc rua bat')], [], ['nước rửa chén']);
    failing(broken, "'search_performed'");
    const out = await new SearchZeroResultsService(broken, configWith(jest.fn().mockRejectedValue(new Error('db')))).report(14, NOW);
    expect(out.items).toEqual([expect.objectContaining({ term: 'nuoc rua bat', synonym: null, suggestions: [] })]);

    // Kiểm cụm admin còn ra hàng lỗi: bỏ cả danh sách admin (không gợi ý cụm chưa kiểm), cụm phổ biến vẫn dùng.
    const liveDown = prismaWith([row('nuoc rua bat'), row('bot giat')], [], ['nước rửa chén']);
    failing(liveDown, 'AS c(k)');
    const viaPopular = await new SearchZeroResultsService(liveDown, configWith(jest.fn().mockResolvedValue(CURATED))).report(14, NOW);
    expect(viaPopular.items.map((i) => i.suggestions)).toEqual([['nước rửa chén'], []]);

    const retry = prismaWith([row('nuoc rua bat')], [], ['nước rửa chén']);
    failing(retry, "'search_performed'");
    const svc = new SearchZeroResultsService(retry);
    await svc.report(14, NOW);
    retry.$queryRaw.mockImplementation(prismaWith([row('nuoc rua bat')], [], ['nước rửa chén']).$queryRaw.getMockImplementation()!);
    expect((await svc.report(14, new Date(NOW.getTime() + 1000))).items[0]!.suggestions).toEqual(['nước rửa chén']);
  });
});
