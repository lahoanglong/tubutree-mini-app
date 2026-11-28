import { MERGE_GOAL, MERGE_MAX_MOVES, MERGE_SIZE, MERGE_TIERS, mergeReplay, mergeTier } from '@tubutree/shared-types';
import type { MiniGameDef } from './game-def';
import { ARCADE_CONTENT_ID, arcadePayloadError } from './arcade';

const MOVES_RE = new RegExp(`^[udlr]{0,${MERGE_MAX_MOVES}}$`);

/**
 * Mỗi nước trong bài nộp tốn ít nhất chừng này: người bấm phím liên tục cũng khó quá 20 nước một giây, còn bài giải sẵn ngoài máy (biết hạt
 * giống) phải chờ đủ thời gian mới nộp được.
 */
export const MERGE_MIN_MS_PER_MOVE = 50;

/**
 * Ghép Mầm Xanh (2048, 4×4): ván là một `seed`, bài nộp là chuỗi hướng vuốt. Máy chủ chơi lại cả ván bằng `mergeReplay` nên điểm và ô lớn
 * nhất là của máy chủ, không tin số máy khách gửi. "Đúng" là bậc cây cao nhất đã ghép được (1..8, tới Rừng Tubu là đủ 8); chưa vuốt nước
 * nào thì 0, để hai ô mở đầu không tính là công.
 */
export const ecoMergeGame: MiniGameDef = {
  game: 'eco_merge',
  payloadError: () => arcadePayloadError('Ghép Mầm Xanh'),
  productSlugs: () => [],
  usable: (row) => row.id === ARCADE_CONTENT_ID.eco_merge,
  pick: (pool) => {
    const row = pool.find((r) => r.id === ARCADE_CONTENT_ID.eco_merge);
    return row ? [row] : null;
  },
  build: (_rows, ctx) => ({ game: 'eco_merge', seed: ctx.arcadeSeed, size: MERGE_SIZE, goal: MERGE_GOAL, maxMoves: MERGE_MAX_MOVES }),
  parseAnswers(raw) {
    if (raw.length !== 1 || typeof raw[0] !== 'string' || !MOVES_RE.test(raw[0])) return null;
    return raw[0];
  },
  minDurationMs: (answers) => (answers as string).length * MERGE_MIN_MS_PER_MOVE,
  grade(_rows, answers, ctx) {
    const replay = mergeReplay(ctx.arcadeSeed, answers as string);
    if (!replay) throw new Error('eco_merge: bài nộp đã qua parseAnswers mà không chơi lại được');
    return {
      correct: replay.moves > 0 ? mergeTier(replay.maxTile) : 0,
      total: MERGE_TIERS,
      correctIds: [],
      review: { game: 'eco_merge', score: replay.score, maxTile: replay.maxTile, moves: replay.moves, won: replay.won },
    };
  },
};
