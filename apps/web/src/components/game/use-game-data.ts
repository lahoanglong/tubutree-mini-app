'use client';

import { useQuery } from '@tanstack/react-query';
import { SEASON_PASS_ENABLED } from '@tubutree/app-core/features';
import {
  gameBoardQuery,
  gameCollectionQuery,
  gameCommunityQuery,
  gameForestQuery,
  gameFriendsQuery,
  gameGardenQuery,
  gameMissionsQuery,
  gameProfileQuery,
  gameQuizQuery,
  gameSeasonBoardQuery,
  gameSeasonPassQuery,
  gameSeasonQuery,
} from '@tubutree/app-core/queries/game';
import { coreHttp } from '@/lib/core-http';

/**
 * Mọi truy vấn của trang Vườn Xanh, cùng khoá `['game', ...]` với Mini App: `refresh()` ở use-game-actions invalidate
 * theo tiền tố nên đổi tên khoá phải đổi cả hai nơi. Bảng xếp hạng và mùa là dữ liệu công khai nên chạy cả khi chưa đăng
 * nhập; phần còn lại cần phiên. Chặng Mùa chỉ gọi API khi cờ SEASON_PASS_ENABLED bật. Dữ liệu của tab Vườn và tab Cộng đồng
 * chỉ tải khi mở tab đó (mở game chỉ cần hồ sơ, câu đố, nhiệm vụ); truy vấn tắt vẫn trả dữ liệu đã có trong cache.
 */
export function useGameData(authed: boolean, tabs: { garden: boolean; community: boolean; friends: boolean }) {
  const profileQ = useQuery({ ...gameProfileQuery(coreHttp), enabled: authed });
  const quizQ = useQuery({ ...gameQuizQuery(coreHttp), enabled: authed });
  const quiz = quizQ.data;
  const { data: missions } = useQuery({ ...gameMissionsQuery(coreHttp), enabled: authed });
  const { data: forest } = useQuery({ ...gameForestQuery(coreHttp), enabled: authed && tabs.garden });
  const boardQ = useQuery({ ...gameBoardQuery(coreHttp), enabled: tabs.community });
  const board = boardQ.data;
  const { data: community } = useQuery({ ...gameCommunityQuery(coreHttp), enabled: authed && tabs.garden });
  const { data: codex } = useQuery({ ...gameCollectionQuery(coreHttp), enabled: authed && tabs.garden });
  const { data: season } = useQuery({ ...gameSeasonQuery(coreHttp), enabled: tabs.community });
  const { data: seasonBoard } = useQuery({ ...gameSeasonBoardQuery(coreHttp), enabled: tabs.community });
  const { data: friends } = useQuery({ ...gameFriendsQuery(coreHttp), enabled: authed && tabs.friends });
  const gardenQ = useQuery({ ...gameGardenQuery(coreHttp), enabled: authed && tabs.garden });
  const garden = gardenQ.data;
  const { data: seasonPass } = useQuery({ ...gameSeasonPassQuery(coreHttp), enabled: authed && tabs.community && SEASON_PASS_ENABLED });

  return { profileQ, quizQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, gardenQ, boardQ, seasonPass };
}
