import { describe, expect, it } from 'vitest';
import { ALBUM_BADGE_IDS } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { claimsIn } from '../commerce/copy-claims-guard';
import { miniResultSummary } from '../game-mini/format';
import { miniReviewRows } from '../game-mini/review';
import { initialRoundState, roundReducer, submitDelayMs } from '../game-mini/round-machine';
import { albumFailure, albumQuery, isAlbumOff } from './api';
import { ALBUM_COPY, ALBUM_COPY_MAX, albumCopy, type AlbumCopyKey } from './copy';
import type { MiniStartResponse, MiniSubmitResponse } from '@tubutree/shared-types';
import { ALBUM_TOPIC_IDS, type AlbumCard, type AlbumResponse } from './types';
import { ALBUM_PATH, ALBUM_PLAY_PATH, albumAction, albumBadges, albumLevel, albumChips, albumEntry, albumNewCards, albumTiles } from './view';

const card = (id: string, over: Partial<AlbumCard> = {}): AlbumCard => ({
  id,
  topic: 'waste',
  game: 'sort',
  level: 1,
  seen: 1,
  correct: 0,
  lastSeenDay: '2026-11-17',
  title: `Thẻ ${id}`,
  answer: 'Tái chế',
  explanation: 'Vì sao.',
  sourceUrl: 'https://example.org/a',
  product: null,
  retired: false,
  ...over,
});

const album = (over: Partial<AlbumResponse> = {}): AlbumResponse => ({
  dayKey: '2026-11-18',
  total: 20,
  seen: 3,
  mastered: 1,
  topics: [
    { id: 'waste', total: 12, seen: 2, mastered: 1 },
    { id: 'origin', total: 8, seen: 1, mastered: 0 },
  ],
  cards: [card('a', { level: 3, lastSeenDay: '2026-11-18' }), card('b', { level: 2 }), card('c', { topic: 'origin', game: 'origin' })],
  review: { due: 2, leftToday: 20 },
  lastRound: { roundId: 'r1', newCards: 2 },
  badges: ALBUM_BADGE_IDS.map((id) => ({ id, earned: id === 'ALBUM_MASTER_10', earnedAt: null })),
  ...over,
});

describe('chữ Sổ tay Xanh', () => {
  const keys = Object.keys(ALBUM_COPY) as AlbumCopyKey[];
  const sample = { n: 186, m: 186, k: 186, s: 99, c: 99 };

  it('không có thuật ngữ cấm, không lời tuyên bố xanh, không nhắc tre, không hứa thưởng', () => {
    for (const key of keys) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(ALBUM_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(albumCopy(key, sample), 'strict'), key).toEqual([]);
    }
    expect(keys.filter((k) => /(^|\s)tre(\s|$)|bamboo|Giọt nước|Điểm Xanh|thưởng/iu.test(ALBUM_COPY[k]))).toEqual([]);
  });

  it('điền được mọi khoá và không vượt ngân sách độ dài', () => {
    for (const key of keys) {
      const text = albumCopy(key, sample);
      expect(text, key).not.toMatch(/[{}]/);
      const max = ALBUM_COPY_MAX[key];
      if (max) expect(text.length, key).toBeLessThanOrEqual(max);
    }
  });

  it('mỗi chủ đề và mỗi huy hiệu có tên', () => {
    for (const id of ALBUM_TOPIC_IDS) expect(keys).toContain(`topic.${id}`);
    for (const id of ALBUM_BADGE_IDS) expect(keys).toContain(`badge.${id}`);
  });
});

describe('view-model Sổ tay Xanh', () => {
  it('dòng lối vào: "Sổ tay Xanh · n/m thẻ" và phần trăm vòng tiến độ; chưa tải hay sổ chưa có thẻ thì không vẽ', () => {
    expect(albumEntry(album())).toEqual({ text: 'Sổ tay Xanh · 3/20 thẻ', pct: 15 });
    expect(albumEntry(album({ seen: 0 }))).toEqual({ text: 'Sổ tay Xanh · 0/20 thẻ', pct: 0 });
    expect(albumEntry(album({ total: 0, seen: 0 }))).toBeNull();
    expect(albumEntry(undefined)).toBeNull();
  });

  it('chip: "Tất cả" rồi chủ đề máy chủ trả, số là thẻ đã mở', () => {
    expect(albumChips(album())).toEqual([
      { id: 'all', label: 'Tất cả', count: 3 },
      { id: 'waste', label: 'Phân loại rác', count: 2 },
      { id: 'origin', label: 'Vùng miền', count: 1 },
    ]);
  });

  it('lưới: thẻ đã mở rồi ô "?" của thẻ chưa mở, quá 4 ô thì 3 ô "?" và một ô gộp "+N"; thẻ gặp hôm nay được lật', () => {
    const all = albumTiles(album(), 'all');
    expect(all.map((t) => (t.card ? t.card.id : t.text))).toEqual(['a', 'b', 'c', '?', '?', '?', '+14']);
    expect(all.filter((t) => t.card && t.fresh).map((t) => t.key)).toEqual(['a']);
    expect(all.at(3)).toMatchObject({ card: null, label: '1 thẻ chưa mở' });
    expect(all.at(-1)).toMatchObject({ card: null, label: '14 thẻ chưa mở' });
    expect(new Set(all.map((t) => t.key)).size).toBe(all.length);
    const origin = albumTiles(album({ topics: [{ id: 'origin', total: 5, seen: 1, mastered: 0 }] }), 'origin');
    expect(origin.map((t) => (t.card ? t.card.id : t.text))).toEqual(['c', '?', '?', '?', '?']);
    expect(albumTiles(album({ total: 3 }), 'all').every((t) => t.card)).toBe(true);
    expect(albumTiles(album(), 'kitchen')).toEqual([]);
  });

  it('thẻ đã tắt vẫn ở lưới nhưng không làm số ô "?" âm', () => {
    const r = album({ seen: 2, total: 2, topics: [{ id: 'waste', total: 2, seen: 2, mastered: 0 }], cards: [card('a'), card('b'), card('x', { retired: true })] });
    expect(albumTiles(r, 'all').map((t) => t.key)).toEqual(['a', 'b', 'x']);
  });

  it('đúng một hành động: Ôn n thẻ (tối đa 5) khi có thẻ tới hạn và còn lượt; chưa tới hạn thì mời chơi thêm; hết lượt thì chỉ dòng chữ; sổ trống thì trạng thái rỗng', () => {
    expect(albumAction(album())).toEqual({ kind: 'review', text: 'Ôn 2 thẻ' });
    expect(albumAction(album({ review: { due: 9, leftToday: 1 } }))).toEqual({ kind: 'review', text: 'Ôn 5 thẻ' });
    expect(albumAction(album({ review: { due: 9, leftToday: 0 } }))).toEqual({ kind: 'note', text: albumCopy('review.limit') });
    expect(albumAction(album({ review: { due: 0, leftToday: 20 } }))).toEqual({ kind: 'play', text: albumCopy('review.none') });
    expect(albumAction(album({ review: { due: 0, leftToday: 0 } }))).toEqual({ kind: 'play', text: albumCopy('review.none') });
    expect(albumAction(album({ seen: 0, cards: [], review: { due: 0, leftToday: 20 } }))).toEqual({ kind: 'empty', text: 'Chơi một ván để mở thẻ đầu tiên' });
  });

  it('"+N thẻ mới" chỉ khi ván gần nhất của sổ đúng là ván vừa nộp', () => {
    expect(albumNewCards(album(), 'r1')).toBe(2);
    expect(albumNewCards(album(), 'r2')).toBe(0);
    expect(albumNewCards(album(), null)).toBe(0);
    expect(albumNewCards(undefined, 'r1')).toBe(0);
    expect(albumNewCards(album({ lastRound: null }), 'r1')).toBe(0);
  });

  it('huy hiệu: chỉ huy hiệu đã đạt; chữ sheet thẻ', () => {
    expect(albumBadges(album())).toEqual(['Thuộc 10 thẻ']);
    expect(albumLevel(card('a', { level: 2, seen: 3, correct: 1 }))).toBe('Mức thuộc 2/3');
    expect(ALBUM_PATH).toEqual({ miniapp: '/game/album', web: '/vuon-xanh/so-tay' });
    expect(ALBUM_PLAY_PATH).toEqual({ miniapp: '/game', web: '/vuon-xanh' });
  });
});

describe('ván ôn chạy trên máy trạng thái ván và màn kết quả sẵn có', () => {
  // Dạng máy chủ trả (album.service.ts): ván Đố Xanh không thưởng, roundId là mã ván ôn.
  const items = [
    { id: 'q1', prompt: 'Vỏ chai nhựa: bỏ vào thùng nào?', options: ['Tái chế', 'Thực phẩm', 'Còn lại'], product: null },
    { id: 'q2', prompt: 'Câu hai?', options: ['Một', 'Hai'], product: null },
  ];
  const start: MiniStartResponse = {
    game: 'daily_quiz',
    roundId: 'rv1',
    token: null,
    issuedAt: '2026-11-18T01:00:00.000Z',
    expiresAt: '2026-11-18T01:10:00.000Z',
    rewarded: false,
    noRewardReason: null,
    content: { game: 'daily_quiz', items },
  };
  const submit: MiniSubmitResponse = {
    game: 'daily_quiz',
    roundId: 'rv1',
    correct: 1,
    total: 2,
    durationMs: 9000,
    rewarded: false,
    noRewardReason: null,
    baseWater: 0,
    basePoints: 0,
    water: 0,
    points: 0,
    capped: [],
    totalSeeds: null,
    checkIn: null,
    review: {
      game: 'daily_quiz',
      items: [
        { contentId: 'q1', correct: true, explanation: 'Nhựa sạch tái chế được.', sourceUrl: 'https://example.org/a', prompt: items[0]!.prompt, given: 0, expected: 0, productSlug: null },
        { contentId: 'q2', correct: false, explanation: 'Vì sao.', sourceUrl: 'https://example.org/b', prompt: 'Câu hai?', given: 0, expected: 1, productSlug: null },
      ],
    },
  };

  it('bắt đầu, chơi, nộp, ra kết quả: ván không thưởng, kết quả chỉ ghi "không có thưởng", xem lại từng câu', () => {
    let s = roundReducer(initialRoundState, { type: 'start' });
    s = roundReducer(s, { type: 'started', round: start, now: 1_000 });
    expect(s).toMatchObject({ phase: 'playing', deadline: 1_000 + 600_000 });
    s = roundReducer(s, { type: 'finish', answers: [0, 0], now: 2_000 });
    expect(s.phase).toBe('submitting');
    expect(submitDelayMs(s, 2_000)).toBeGreaterThan(0);
    s = roundReducer(s, { type: 'submitted', result: submit });
    expect(s.phase).toBe('result');
    const summary = miniResultSummary(s.result!);
    expect(summary).toMatchObject({ score: 'Đúng 1/2', gains: [], loginToReward: false });
    expect(summary.notes).toEqual(['Ván này không có thưởng.']);
    const rows = miniReviewRows(s.result!.review, s.round!.content, s.answers);
    expect(rows.map((r) => [r.title, r.state, r.given, r.expected])).toEqual([
      [items[0]!.prompt, 'correct', 'Tái chế', 'Tái chế'],
      ['Câu hai?', 'wrong', 'Một', 'Hai'],
    ]);
  });

  it('lỗi: mất mạng/5xx/408/429 không mã là lỗi tạm (gửi lại); có mã nghiệp vụ thì ván không ghi nhận được', () => {
    expect(albumFailure(new Error('offline'))).toBe('network');
    expect(albumFailure({ status: 502 })).toBe('network');
    expect(albumFailure({ status: 408 })).toBe('network');
    expect(albumFailure({ status: 429 })).toBe('network');
    expect(albumFailure({ response: { status: 429, data: { code: 'ROUND_LIMIT' } } })).toBe('rejected');
    expect(albumFailure({ status: 400, code: 'ROUND_EXPIRED' })).toBe('rejected');
    expect(albumFailure({ status: 409, code: 'ROUND_SUBMITTED' })).toBe('already_submitted');
    expect(albumFailure({ status: 404, code: 'GAME_NO_CONTENT' })).toBe('rejected');
    expect(albumFailure({ status: 400 })).toBe('rejected');
  });

  it('query: khoá dưới ["game"], tách bản tóm tắt; cờ tắt (404) không thử lại', async () => {
    const calls: string[] = [];
    const none = async () => ({}) as never;
    const http: HttpClient = { get: async (p: string) => (calls.push(p), album() as never), post: none, put: none, patch: none, delete: none };
    const q = albumQuery(http, true);
    expect(q.queryKey).toEqual(['game', 'album', 'summary']);
    expect(albumQuery(http, false).queryKey).toEqual(['game', 'album', 'full']);
    await q.queryFn();
    await albumQuery(http, false).queryFn();
    expect(calls).toEqual(['/game/album?summary=1', '/game/album']);
    expect(isAlbumOff({ status: 404 })).toBe(true);
    expect(q.retry(0, { status: 404 })).toBe(false);
    expect(q.retry(0, { status: 500 })).toBe(true);
    expect(q.retry(1, { status: 500 })).toBe(false);
  });
});
