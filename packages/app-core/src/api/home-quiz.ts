import type { HomeQuizAnswers } from '../arcade/home-quiz';
import type { HttpClient } from '../http';

// Tách khỏi `api/game`: Chẩn đoán tổ ấm ở Trang chủ Mini App chỉ cần lời gọi này. Import `api/game` thì mô-đun đó thành phần dùng chung nhỏ giữa Trang chủ và
// Vườn Xanh, dưới `experimentalMinChunkSize` nên Rollup gộp nó vào entry.
export interface HomeQuizResult {
  granted: number;
  alreadyClaimed: boolean;
  totalSeeds: number;
}
export const completeHomeQuiz = (http: HttpClient, answers: HomeQuizAnswers) =>
  http.post<HomeQuizResult>('/game/home-quiz/complete', { family: answers.family, worry: answers.worry, format: answers.format });
