import type { MiniGameId } from '@tubutree/shared-types';
import type { MiniGameDef } from './game-def';
import { sortGame } from './sort';
import { dailyQuizGame, originGame } from './choice';
import { matchGame } from './match';
import { basketGame } from './basket';

export const MINI_GAMES: Record<MiniGameId, MiniGameDef> = {
  sort: sortGame,
  daily_quiz: dailyQuizGame,
  match: matchGame,
  origin: originGame,
  basket: basketGame,
};

export type { MiniBuildCtx, MiniContentRow, MiniGameDef, MiniGrade, MiniPickCtx } from './game-def';
