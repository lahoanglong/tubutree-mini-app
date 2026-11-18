import type { MiniStartResponse, MiniSubmitResponse } from '@tubutree/shared-types';
import { albumCopy } from '../../../../packages/app-core/src/game-album/copy';
import type { AlbumCard, AlbumResponse } from '../../../../packages/app-core/src/game-album/types';
import { QUIZ_PRODUCT } from './game-mini-mocks';
import { reply, type MockApi } from './mock-api';

/**
 * Dữ liệu và API mock của Sổ tay Xanh (Mini App và web) như máy chủ thật khi cờ `game.album_enabled` bật: thẻ chưa gặp chỉ có trong số đếm theo
 * chủ đề; ván ôn có dạng ván Đố Xanh không thưởng.
 */

export { albumCopy };

const DAY = '2026-11-18';
const SOURCE = 'https://www.moitruong.gov.vn/phan-loai-rac';

const card = (id: string, topic: AlbumCard['topic'], game: AlbumCard['game'], level: AlbumCard['level'], title: string, over: Partial<AlbumCard> = {}): AlbumCard => ({
  id,
  topic,
  game,
  level,
  seen: level + 1,
  correct: level - 1,
  lastSeenDay: '2026-11-15',
  title,
  answer: null,
  explanation: `Giải thích của thẻ ${id}.`,
  sourceUrl: SOURCE,
  product: null,
  retired: false,
  ...over,
});

export const ALBUM_CARDS: AlbumCard[] = [
  card('c1', 'waste', 'sort', 3, '🧴 Chai nhựa PET', { answer: 'Tái chế' }),
  card('c2', 'waste', 'sort', 1, '🍌 Vỏ chuối', { answer: 'Rác hữu cơ', lastSeenDay: DAY }),
  card('c3', 'quiz', 'daily_quiz', 2, 'Bồ kết dùng để làm gì trong nhà?', { answer: 'Rửa chén, gội đầu', product: QUIZ_PRODUCT }),
  card('c4', 'quiz', 'daily_quiz', 1, 'Vỏ hộp sữa giấy nên bỏ vào thùng nào?', { answer: 'Tái chế' }),
  card('c5', 'ingredients', 'match', 2, 'Baking soda', { answer: 'Tẩy dầu mỡ bếp' }),
  card('c6', 'origin', 'origin', 1, 'Mật ong hoa cà phê thường đến từ vùng nào?', { answer: 'Tây Nguyên' }),
];

export function albumResponse(over: Partial<AlbumResponse> = {}): AlbumResponse {
  return {
    dayKey: DAY,
    total: 86,
    seen: 6,
    mastered: 1,
    topics: [
      { id: 'waste', total: 40, seen: 2, mastered: 1 },
      { id: 'quiz', total: 20, seen: 2, mastered: 0 },
      { id: 'ingredients', total: 10, seen: 1, mastered: 0 },
      { id: 'origin', total: 16, seen: 1, mastered: 0 },
    ],
    cards: ALBUM_CARDS,
    review: { due: 6, leftToday: 20 },
    lastRound: { roundId: 'r-daily_quiz', newCards: 2 },
    badges: [
      { id: 'ALBUM_MASTER_10', earned: false, earnedAt: null },
      { id: 'ALBUM_TOPIC', earned: true, earnedAt: `${DAY}T03:00:00.000Z` },
      { id: 'ALBUM_ALL', earned: false, earnedAt: null },
    ],
    ...over,
  };
}

export const REVIEW_ITEMS = ALBUM_CARDS.slice(0, 5).map((c) => ({ id: c.id, prompt: `Ôn: ${c.title}`, options: ['Đáp án A', 'Đáp án B', 'Đáp án C'], product: null }));

function reviewStart(): MiniStartResponse {
  const now = Date.now();
  return {
    game: 'daily_quiz',
    roundId: 'rv-1',
    token: null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    rewarded: false,
    noRewardReason: null,
    content: { game: 'daily_quiz', items: REVIEW_ITEMS },
  };
}

function reviewResult(): MiniSubmitResponse {
  return {
    game: 'daily_quiz',
    roundId: 'rv-1',
    correct: 4,
    total: 5,
    durationMs: 12_000,
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
      items: REVIEW_ITEMS.map((q, i) => ({
        contentId: q.id,
        prompt: q.prompt,
        correct: i !== 4,
        given: i === 4 ? 1 : 0,
        expected: 0,
        explanation: `Giải thích của thẻ ${q.id}.`,
        sourceUrl: SOURCE,
        productSlug: null,
      })),
    },
  };
}

/**
 * Bật sổ: `GET /game/album` (bản tóm tắt `?summary=1` không có `cards`), bắt đầu và nộp ván ôn. `off` trả 404 như máy chủ khi cờ tắt;
 * `failLoads` trả 503 cho n lần tải đầu của bản đầy đủ (query tự thử lại một lần). Trả các lời gọi sổ để spec kiểm (vd. khách chưa đăng nhập không gọi gì).
 */
export function mockAlbum(api: MockApi, opts: { album?: AlbumResponse; off?: boolean; failLoads?: number } = {}) {
  const calls: { path: string; body?: unknown }[] = [];
  let failures = 0;
  const album = opts.album ?? albumResponse();
  api.get('/game/album', (ctx: { call: { query: URLSearchParams } }) => {
    calls.push({ path: `/game/album?${ctx.call.query.toString()}` });
    if (opts.off) return reply(404, { statusCode: 404, code: 'GAME_DISABLED', message: 'Not Found' });
    if (failures < (opts.failLoads ?? 0) && ctx.call.query.get('summary') !== '1') {
      failures += 1;
      return reply(503, { statusCode: 503, message: 'Service Unavailable' });
    }
    return ctx.call.query.get('summary') === '1' ? { ...album, cards: [] } : album;
  });
  api.post('/game/album/review/start', () => {
    calls.push({ path: '/game/album/review/start' });
    return reviewStart();
  });
  api.post('/game/album/review/submit', (ctx: { call: { body: unknown } }) => {
    calls.push({ path: '/game/album/review/submit', body: ctx.call.body });
    return reviewResult();
  });
  return { calls };
}
