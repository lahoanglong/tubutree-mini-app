import { HttpException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { GameMiniContentService } from '../mini/game-mini-content.service';
import { GameAlbumService, readQuestions } from './album.service';

type Flags = Record<string, unknown>;

function setup(flags: Flags = { 'game.album_enabled': true, 'game.mini.enabled': true }) {
  const config = { get: jest.fn(async (key: string, fallback: unknown) => (key in flags ? flags[key] : fallback)) } as unknown as SystemConfigService;
  const prisma = {
    gameContentItem: { findMany: jest.fn(async () => []) },
    gamePlayRound: { findFirst: jest.fn(async () => null) },
    gameAlbumReview: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), findUnique: jest.fn(), updateMany: jest.fn() },
    userBadge: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const content = { products: jest.fn(async () => new Map()) } as unknown as GameMiniContentService;
  return { service: new GameAlbumService(prisma as unknown as PrismaService, config, content), prisma };
}

async function httpOf(p: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), code: (err.getResponse() as { code?: unknown }).code };
    throw err;
  }
  throw new Error('không ném lỗi');
}

const NOW = new Date('2032-01-10T03:00:00Z');
const question = { id: 'q1', prompt: 'Câu?', options: ['A', 'B', 'C'], answer: 1, explanation: 'Vì vậy.', sourceUrl: 'https://example.gov.vn', productSlug: null };

describe('GameAlbumService', () => {
  it.each([
    ['cờ sổ tắt', { 'game.album_enabled': false, 'game.mini.enabled': true }],
    ['cờ game mini tắt', { 'game.album_enabled': true, 'game.mini.enabled': false }],
    ['chưa có dòng cờ', {}],
    ['giá trị lạ', { 'game.album_enabled': 'yes', 'game.mini.enabled': true }],
  ])('%s: cả ba route 404 GAME_DISABLED, kể cả khách chưa đăng nhập, không đọc bảng nào', async (_name, flags) => {
    const { service, prisma } = setup(flags);
    for (const userId of ['u1', null]) {
      await expect(httpOf(service.album(userId, {}, NOW))).resolves.toEqual({ status: 404, code: 'GAME_DISABLED' });
      await expect(httpOf(service.startReview(userId, NOW))).resolves.toEqual({ status: 404, code: 'GAME_DISABLED' });
      await expect(httpOf(service.submitReview(userId, { roundId: 'r', answers: [] }, NOW))).resolves.toEqual({ status: 404, code: 'GAME_DISABLED' });
    }
    expect(prisma.gameContentItem.findMany).not.toHaveBeenCalled();
    expect(prisma.gameAlbumReview.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cờ bật mà chưa đăng nhập: 401 LOGIN_REQUIRED', async () => {
    const { service } = setup();
    await expect(httpOf(service.album(null, {}, NOW))).resolves.toEqual({ status: 401, code: 'LOGIN_REQUIRED' });
    await expect(httpOf(service.startReview(null, NOW))).resolves.toEqual({ status: 401, code: 'LOGIN_REQUIRED' });
  });

  it('khách chưa chơi ván nào: sổ rỗng đúng khuôn, không ván ôn nào tới hạn', async () => {
    const { service } = setup();
    const r = await service.album('u1', {}, NOW);
    expect(Object.keys(r).sort()).toEqual(['badges', 'cards', 'dayKey', 'lastRound', 'mastered', 'review', 'seen', 'topics', 'total']);
    expect(r).toMatchObject({ dayKey: '2032-01-10', total: 0, seen: 0, mastered: 0, cards: [], review: { due: 0, leftToday: 20 }, lastRound: null });
    expect(r.badges.map((b) => [b.id, b.earned])).toEqual([
      ['ALBUM_MASTER_10', false],
      ['ALBUM_TOPIC', false],
      ['ALBUM_ALL', false],
    ]);
  });

  describe('nộp ván ôn', () => {
    const review = (over: Record<string, unknown> = {}) => ({
      id: 'r1',
      userId: 'u1',
      submittedAt: null,
      issuedAt: new Date(NOW.getTime() - 30_000),
      questions: [question],
      ...over,
    });

    it('ván của người khác trả như ván không có (404); đã nộp 409; quá hạn và nộp quá nhanh 400', async () => {
      const { service, prisma } = setup();
      prisma.gameAlbumReview.findUnique.mockResolvedValueOnce(review({ userId: 'u2' }));
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers: [1] }, NOW))).resolves.toEqual({ status: 404, code: 'ROUND_NOT_FOUND' });
      prisma.gameAlbumReview.findUnique.mockResolvedValueOnce(review({ submittedAt: NOW }));
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers: [1] }, NOW))).resolves.toEqual({ status: 409, code: 'ROUND_SUBMITTED' });
      prisma.gameAlbumReview.findUnique.mockResolvedValueOnce(review({ issuedAt: new Date(NOW.getTime() - 11 * 60_000) }));
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers: [1] }, NOW))).resolves.toEqual({ status: 400, code: 'ROUND_EXPIRED' });
      prisma.gameAlbumReview.findUnique.mockResolvedValueOnce(review({ issuedAt: new Date(NOW.getTime() - 1_000) }));
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers: [1] }, NOW))).resolves.toEqual({ status: 400, code: 'ROUND_TOO_FAST' });
      expect(prisma.gameAlbumReview.updateMany).not.toHaveBeenCalled();
    });

    it.each([[[]], [[1, 1]], [[3]], [[-1]], [[0.5]], [['1']]])('đáp án sai dạng %j: 400 ANSWERS_INVALID', async (answers) => {
      const { service, prisma } = setup();
      prisma.gameAlbumReview.findUnique.mockResolvedValueOnce(review());
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers }, NOW))).resolves.toEqual({ status: 400, code: 'ANSWERS_INVALID' });
    });

    it('chấm theo câu đã lưu, 0 💧 và 0 điểm; lần nộp song song thua (updateMany 0 dòng) nhận 409', async () => {
      const { service, prisma } = setup();
      prisma.gameAlbumReview.findUnique.mockResolvedValue(review());
      prisma.gameAlbumReview.updateMany.mockResolvedValueOnce({ count: 1 });
      const r = await service.submitReview('u1', { roundId: 'r1', answers: [1] }, NOW);
      expect(r).toEqual({
        game: 'daily_quiz',
        roundId: 'r1',
        correct: 1,
        total: 1,
        durationMs: 30_000,
        rewarded: false,
        noRewardReason: null,
        baseWater: 0,
        basePoints: 0,
        water: 0,
        points: 0,
        capped: [],
        totalSeeds: null,
        checkIn: null,
        review: { game: 'daily_quiz', items: [{ contentId: 'q1', prompt: 'Câu?', given: 1, expected: 1, correct: true, explanation: 'Vì vậy.', sourceUrl: 'https://example.gov.vn', productSlug: null }] },
      });
      expect(prisma.gameAlbumReview.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', submittedAt: null },
        data: { submittedAt: NOW, correctIds: ['q1'], correct: 1, total: 1 },
      });
      prisma.gameAlbumReview.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(httpOf(service.submitReview('u1', { roundId: 'r1', answers: [null] }, NOW))).resolves.toEqual({ status: 409, code: 'ROUND_SUBMITTED' });
    });
  });

  it('câu ôn đọc lại từ JSON: dữ liệu hỏng thì null', () => {
    expect(readQuestions([question])).toEqual([question]);
    expect(readQuestions([])).toBeNull();
    expect(readQuestions([{ ...question, answer: 3 }])).toBeNull();
    expect(readQuestions([{ ...question, options: ['A'] }])).toBeNull();
    expect(readQuestions('x')).toBeNull();
  });
});
