import { foldSourceRows, sourceLabel, weekWindowsClosed, type SourceRow } from './admin-source-report';

const row = (over: Partial<SourceRow>): SourceRow => ({
  week: '2026-10-05',
  source: 'shopee',
  newUsers: 0,
  firstOrderUsers: 0,
  secondOrderUsers: 0,
  revenue: 0,
  ...over,
});

describe('sourceLabel', () => {
  it.each([
    ['shopee', 'Shopee'],
    ['tiktok', 'TikTok Shop'],
    ['fb', 'Facebook'],
    ['oa', 'Zalo OA'],
    ['linkbio', 'Link bio'],
    ['ctv', 'CTV'],
    ['card-2610', 'Thẻ hộp hàng 2610'],
    ['unknown', 'Không rõ'],
    ['abc-xyz', 'abc-xyz'],
    ['__other', 'Nguồn khác'],
    ['__nocampaign', 'Không thuộc chiến dịch nào'],
    ['c:card-2611', 'Thẻ hộp hàng 2611'],
    ['c:shopee', 'shopee'],
    ['c:unknown', 'unknown'],
    ['c:__nocampaign', '__nocampaign'],
  ])('%s → %s', (key, label) => {
    expect(sourceLabel(key)).toBe(label);
  });
});

describe('weekWindowsClosed', () => {
  // Tuần 05/10 kết thúc hết 11/10; đơn đầu tính trong 30 ngày sau lúc tạo (kỳ đóng 10/11), đơn hai thêm 30 ngày sau đơn đầu (kỳ đóng 10/12).
  it('kỳ đơn đầu đóng sau 37 ngày, kỳ đơn hai sau 67 ngày kể từ đầu tuần', () => {
    expect(weekWindowsClosed('2026-10-05', '2026-11-10')).toEqual({ firstWindowClosed: false, secondWindowClosed: false });
    expect(weekWindowsClosed('2026-10-05', '2026-11-11')).toEqual({ firstWindowClosed: true, secondWindowClosed: false });
    expect(weekWindowsClosed('2026-10-05', '2026-12-10')).toEqual({ firstWindowClosed: true, secondWindowClosed: false });
    expect(weekWindowsClosed('2026-10-05', '2026-12-11')).toEqual({ firstWindowClosed: true, secondWindowClosed: true });
  });
});

describe('foldSourceRows', () => {
  it('gộp theo nguồn, sắp theo tuần mới nhất trước rồi nguồn đông khách nhất, kèm cờ kỳ đã đóng và nhãn', () => {
    const r = foldSourceRows(
      [
        row({ week: '2026-10-05', source: 'shopee', newUsers: 10, firstOrderUsers: 4, secondOrderUsers: 1, revenue: 900_000 }),
        row({ week: '2026-10-12', source: 'shopee', newUsers: 6, firstOrderUsers: 1, revenue: 100_000 }),
        row({ week: '2026-10-12', source: 'unknown', newUsers: 8 }),
        row({ week: '2026-10-12', source: 'ctv', newUsers: 2, firstOrderUsers: 2, secondOrderUsers: 1, revenue: 300_000 }),
      ],
      { maxSources: 10, today: '2026-11-17' },
    );
    expect(r.rows.map((x) => [x.week, x.source])).toEqual([
      ['2026-10-12', 'unknown'],
      ['2026-10-12', 'shopee'],
      ['2026-10-12', 'ctv'],
      ['2026-10-05', 'shopee'],
    ]);
    expect(r.rows[0]).toMatchObject({ label: 'Không rõ', firstWindowClosed: false });
    expect(r.rows[3]).toMatchObject({ label: 'Shopee', firstWindowClosed: true, secondWindowClosed: false });
    expect(r.bySource).toEqual([
      { source: 'shopee', label: 'Shopee', newUsers: 16, firstOrderUsers: 5, secondOrderUsers: 1, revenue: 1_000_000 },
      { source: 'unknown', label: 'Không rõ', newUsers: 8, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 },
      { source: 'ctv', label: 'CTV', newUsers: 2, firstOrderUsers: 2, secondOrderUsers: 1, revenue: 300_000 },
    ]);
    expect(r.totals).toEqual({ newUsers: 26, firstOrderUsers: 7, secondOrderUsers: 2, revenue: 1_300_000 });
  });

  it('quá maxSources nguồn thì phần đuôi gộp vào "Nguồn khác" (mã nguồn do khách khai nên số nguồn không có trần)', () => {
    const rows = [
      row({ source: 'a', newUsers: 9, revenue: 90 }),
      row({ source: 'b', newUsers: 8, revenue: 80 }),
      row({ source: 'c', newUsers: 2, revenue: 20 }),
      row({ week: '2026-10-12', source: 'd', newUsers: 1, firstOrderUsers: 1, revenue: 10 }),
      row({ week: '2026-10-05', source: 'e', newUsers: 1, revenue: 5 }),
    ];
    const r = foldSourceRows(rows, { maxSources: 2, today: '2026-12-31' });
    expect(r.bySource.map((s) => [s.source, s.newUsers, s.revenue])).toEqual([
      ['a', 9, 90],
      ['b', 8, 80],
      ['__other', 4, 35],
    ]);
    expect(r.rows.filter((x) => x.source === '__other').map((x) => [x.week, x.newUsers, x.revenue])).toEqual([
      ['2026-10-12', 1, 10],
      ['2026-10-05', 3, 25],
    ]);
    expect(r.totals).toEqual({ newUsers: 21, firstOrderUsers: 1, secondOrderUsers: 0, revenue: 205 });
  });

  it('không có dòng nào: rỗng và tổng bằng 0', () => {
    const r = foldSourceRows([], { maxSources: 5, today: '2026-10-18' });
    expect(r).toEqual({ rows: [], bySource: [], totals: { newUsers: 0, firstOrderUsers: 0, secondOrderUsers: 0, revenue: 0 } });
  });
});
