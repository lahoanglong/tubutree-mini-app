import { useQuery } from '@tanstack/react-query';
import {
  getGameProfile,
  getTodayQuiz,
  getLeaderboard,
  getMissions,
  getForest,
  getCommunity,
  getCollection,
  getSeason,
  getSeasonLeaderboard,
  getFriends,
  getGarden,
  fetchSeasonPass,
} from '../../services/game-api';
import { SEASON_PASS_ENABLED } from '../../utils/features';

/**
 * Mọi truy vấn của trang Vườn Xanh. Khoá `['game', ...]` là hợp đồng với `refresh()` ở use-game-actions
 * (invalidate theo tiền tố), nên đổi tên khoá phải đổi cả hai nơi. Bảng xếp hạng và mùa là dữ liệu công khai
 * nên chạy cả khi chưa đăng nhập; phần còn lại cần phiên.
 */
export function useGameData(authed: boolean) {
  const profileQ = useQuery({ queryKey: ['game', 'profile'], queryFn: getGameProfile, enabled: authed });
  const quizQ = useQuery({ queryKey: ['game', 'quiz'], queryFn: getTodayQuiz, enabled: authed });
  const quiz = quizQ.data;
  const { data: board } = useQuery({ queryKey: ['game', 'board'], queryFn: getLeaderboard });
  const { data: missions } = useQuery({ queryKey: ['game', 'missions'], queryFn: getMissions, enabled: authed });
  const { data: forest } = useQuery({ queryKey: ['game', 'forest'], queryFn: getForest, enabled: authed });
  const { data: community } = useQuery({ queryKey: ['game', 'community'], queryFn: getCommunity, enabled: authed });
  const { data: codex } = useQuery({ queryKey: ['game', 'collection'], queryFn: getCollection, enabled: authed });
  const { data: season } = useQuery({ queryKey: ['game', 'season'], queryFn: getSeason });
  const { data: seasonBoard } = useQuery({ queryKey: ['game', 'seasonBoard'], queryFn: getSeasonLeaderboard });
  const { data: friends } = useQuery({ queryKey: ['game', 'friends'], queryFn: getFriends, enabled: authed });
  const { data: garden } = useQuery({ queryKey: ['game', 'garden'], queryFn: getGarden, enabled: authed });
  const { data: seasonPass } = useQuery({ queryKey: ['game', 'seasonPass'], queryFn: fetchSeasonPass, enabled: authed && SEASON_PASS_ENABLED });

  return { profileQ, quizQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass };
}
