import type { MiniGameId } from '@tubutree/shared-types';
import type { MiniGameDef } from './game-def';
import { sortGame } from './sort';
import { dailyQuizGame, originGame } from './choice';
import { matchGame } from './match';
import { basketGame } from './basket';
import { kitchenSwapGame } from './kitchen-swap';
import { ecoMergeGame } from './eco-merge';
import { greenConveyorGame } from './green-conveyor';

export const MINI_GAMES: Record<MiniGameId, MiniGameDef> = {
  sort: sortGame,
  daily_quiz: dailyQuizGame,
  match: matchGame,
  origin: originGame,
  basket: basketGame,
  kitchen_swap: kitchenSwapGame,
  eco_merge: ecoMergeGame,
  green_conveyor: greenConveyorGame,
};

export type { MiniBuildCtx, MiniContentRow, MiniGameDef, MiniGrade, MiniPickCtx } from './game-def';
