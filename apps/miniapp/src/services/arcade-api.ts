import { completeArcade, completeHomeQuiz, type ArcadeCompleteBody } from '@tubutree/app-core/api/game';
import type { HomeQuizAnswers } from '@tubutree/app-core/arcade/home-quiz';
import { gameArcadeStatusQuery } from '@tubutree/app-core/queries/game';
import { coreHttp } from './core-http';

/** Khoá `['game', 'arcade']` nằm dưới tiền tố `['game']` nên làm mới hồ sơ Vườn cũng làm mới trạng thái mini game. */
export const arcadeStatusQuery = gameArcadeStatusQuery(coreHttp);

/** Mỗi lời gọi là một ván: nơi gọi tự chặn gọi đúp (xem `use-arcade-complete`). */
export const submitArcadeRun = (body: ArcadeCompleteBody) => completeArcade(coreHttp, body);

export const submitHomeQuiz = (answers: HomeQuizAnswers) => completeHomeQuiz(coreHttp, answers);
