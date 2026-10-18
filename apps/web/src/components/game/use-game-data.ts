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
 * nhập; phần còn lại cần phiên. Chặng Mùa chỉ gọi API khi cờ SEASON_PASS_ENABLED bật.
 */
export function useGameData(authed: boolean) {
  const profileQ = useQuery({ ...gameProfileQuery(coreHttp), enabled: authed });
  const { data: quiz } = useQuery({ ...gameQuizQuery(coreHttp), enabled: authed });
  const { data: missions } = useQuery({ ...gameMissionsQuery(coreHttp), enabled: authed });
  const { data: forest } = useQuery({ ...gameForestQuery(coreHttp), enabled: authed });
  const { data: board } = useQuery(gameBoardQuery(coreHttp));
  const { data: community } = useQuery({ ...gameCommunityQuery(coreHttp), enabled: authed });
  const { data: codex } = useQuery({ ...gameCollectionQuery(coreHttp), enabled: authed });
  const { data: season } = useQuery(gameSeasonQuery(coreHttp));
  const { data: seasonBoard } = useQuery(gameSeasonBoardQuery(coreHttp));
  const { data: friends } = useQuery({ ...gameFriendsQuery(coreHttp), enabled: authed });
  const { data: garden } = useQuery({ ...gameGardenQuery(coreHttp), enabled: authed });
  const { data: seasonPass } = useQuery({ ...gameSeasonPassQuery(coreHttp), enabled: authed && SEASON_PASS_ENABLED });

  return { profileQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass };
}
