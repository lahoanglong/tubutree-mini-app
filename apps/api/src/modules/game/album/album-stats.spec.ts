import type { AlbumItem } from './album-cards';
import { dayKeyMinus, levelOf, newCardsIn, reviewCandidates, type AlbumStatRow } from './album-stats';

const at = (iso: string) => new Date(iso);
const row = (cid: string, over: Partial<AlbumStatRow> = {}): AlbumStatRow => ({
  cid,
  seen: 1,
  correct: 0,
  correctDays: 0,
  lastSeenDay: '2032-01-01',
  firstAt: at('2032-01-01T03:00:00Z'),
  lastAt: at('2032-01-01T03:00:00Z'),
  lastWrongAt: at('2032-01-01T03:00:00Z'),
  ...over,
});
const items = (ids: string[], inactive: string[] = []) =>
  new Map<string, AlbumItem>(
    ids.map((id) => [id, { id, game: 'daily_quiz', payload: {}, explanation: '', sourceUrl: '', productSlug: null, active: !inactive.includes(id) }]),
  );

describe('bậc thuộc bài', () => {
  it('chưa gặp 0, gặp mà chưa đúng 1, đúng ở một ngày (kể cả hai lần cùng ngày) 2, đúng ở hai ngày khác nhau 3', () => {
    expect(levelOf(undefined)).toBe(0);
    expect(levelOf({ seen: 0, correct: 0, correctDays: 0 })).toBe(0);
    expect(levelOf({ seen: 3, correct: 0, correctDays: 0 })).toBe(1);
    expect(levelOf({ seen: 2, correct: 2, correctDays: 1 })).toBe(2);
    expect(levelOf({ seen: 2, correct: 2, correctDays: 2 })).toBe(3);
  });

  it('lùi ngày VN qua biên tháng, năm', () => {
    expect(dayKeyMinus('2032-03-01', 3)).toBe('2032-02-27');
    expect(dayKeyMinus('2032-01-02', 3)).toBe('2031-12-30');
  });
});

describe('chọn mục ôn', () => {
  const today = '2032-01-10';

  it('ưu tiên mục mà lần làm gần nhất là sai (mới nhất trước), rồi mục bậc 1–2 lâu chưa gặp từ 3 ngày', () => {
    const stats = [
      row('wrong-old', { lastAt: at('2032-01-08T03:00:00Z'), lastWrongAt: at('2032-01-08T03:00:00Z'), lastSeenDay: '2032-01-08' }),
      row('wrong-new', { lastAt: at('2032-01-10T01:00:00Z'), lastWrongAt: at('2032-01-10T01:00:00Z'), lastSeenDay: '2032-01-10' }),
      // Sai rồi sau đó làm đúng: không còn là "sai gần nhất"; bậc 2, gặp lại hôm nay nên chưa tới hạn.
      row('fixed', { correct: 1, correctDays: 1, lastAt: at('2032-01-10T02:00:00Z'), lastWrongAt: at('2032-01-09T02:00:00Z'), lastSeenDay: '2032-01-10' }),
      row('spaced-6', { correct: 1, correctDays: 1, lastWrongAt: null, lastSeenDay: '2032-01-04' }),
      row('spaced-3', { correct: 1, correctDays: 1, lastWrongAt: null, lastSeenDay: '2032-01-07' }),
      row('recent-2', { correct: 1, correctDays: 1, lastWrongAt: null, lastSeenDay: '2032-01-08' }),
      row('mastered', { correct: 2, correctDays: 2, lastWrongAt: null, lastSeenDay: '2031-12-01' }),
    ];
    const ids = stats.map((s) => s.cid);
    expect(reviewCandidates(stats, items(ids), today, new Set())).toEqual(['wrong-new', 'wrong-old', 'spaced-6', 'spaced-3']);
  });

  it('bỏ mục đã ôn hôm nay, mục admin đã tắt và mục không còn trong sổ', () => {
    const stats = [row('a'), row('b'), row('c'), row('gq:legacy')];
    expect(reviewCandidates(stats, items(['a', 'b', 'c'], ['b']), today, new Set(['c']))).toEqual(['a']);
  });
});

describe('thẻ mới của ván', () => {
  it('chỉ đếm mục có trong sổ lần đầu gặp ở chính ván đó', () => {
    const t = at('2032-01-10T03:00:00Z');
    const stats = new Map([
      ['a', row('a', { firstAt: t })],
      ['b', row('b', { firstAt: at('2032-01-05T03:00:00Z') })],
      ['gq:1', row('gq:1', { firstAt: t })],
    ]);
    expect(newCardsIn(['a', 'b', 'gq:1', 'a'], t, stats, items(['a', 'b']))).toBe(1);
  });
});
