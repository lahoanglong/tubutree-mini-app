import { useQuery } from '@tanstack/react-query';
import {
  getGameProfile,
  getTodayQuiz,
  getMissions,
  getForest,
  getCommunity,
  getCollection,
  getSeason,
  getGarden,
  fetchSeasonPass,
} from '../../services/game-api';
import { SEASON_PASS_ENABLED } from '../../utils/features';

/**
 * Mọi truy vấn của trang Vườn Xanh. Khoá `['game', ...]` là hợp đồng với `refresh()` ở use-game-actions
 * (invalidate theo tiền tố), nên đổi tên khoá phải đổi cả hai nơi. Bảng xếp hạng và mùa là dữ liệu công khai
 * nên chạy cả khi chưa đăng nhập; phần còn lại cần phiên. Dữ liệu chỉ tab Vườn dùng (lô đất, sổ tay, rừng, cộng đồng,
 * mùa, chặng mùa) chỉ tải khi mở tab đó: mở game chỉ cần hồ sơ, câu đố và nhiệm vụ. Truy vấn tắt vẫn trả dữ liệu đã có trong cache.
 */
export function useGameData(authed: boolean, gardenTab: boolean) {
  const profileQ = useQuery({ queryKey: ['game', 'profile'], queryFn: getGameProfile, enabled: authed });
  const quizQ = useQuery({ queryKey: ['game', 'quiz'], queryFn: getTodayQuiz, enabled: authed });
  const quiz = quizQ.data;
  const { data: missions } = useQuery({ queryKey: ['game', 'missions'], queryFn: getMissions, enabled: authed });
  const { data: forest } = useQuery({ queryKey: ['game', 'forest'], queryFn: getForest, enabled: authed && gardenTab });
  const { data: community } = useQuery({ queryKey: ['game', 'community'], queryFn: getCommunity, enabled: authed && gardenTab });
  const { data: codex } = useQuery({ queryKey: ['game', 'collection'], queryFn: getCollection, enabled: authed && gardenTab });
  const { data: season } = useQuery({ queryKey: ['game', 'season'], queryFn: getSeason, enabled: gardenTab });
  const gardenQ = useQuery({ queryKey: ['game', 'garden'], queryFn: getGarden, enabled: authed && gardenTab });
  const garden = gardenQ.data;
  const { data: seasonPass } = useQuery({ queryKey: ['game', 'seasonPass'], queryFn: fetchSeasonPass, enabled: authed && gardenTab && SEASON_PASS_ENABLED });

  return { profileQ, quizQ, quiz, missions, forest, community, codex, season, garden, gardenQ, seasonPass };
}
