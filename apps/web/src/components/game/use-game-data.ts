'use client';

import { useQuery } from '@tanstack/react-query';
import {
  gameForestQuery,
  gameMissionsQuery,
  gameProfileQuery,
  gameQuizQuery,
  gameSeasonQuery,
} from '@tubutree/app-core/queries/game';
import { coreHttp } from '@/lib/core-http';

/**
 * Mọi truy vấn của trang Vườn Xanh, cùng khoá `['game', ...]` với Mini App: `refresh()` ở use-game-actions invalidate
 * theo tiền tố nên đổi tên khoá phải đổi cả hai nơi. Mùa là dữ liệu công khai nên chạy cả khi chưa đăng nhập; phần còn
 * lại cần phiên.
 */
export function useGameData(authed: boolean) {
  const profileQ = useQuery({ ...gameProfileQuery(coreHttp), enabled: authed });
  const { data: quiz } = useQuery({ ...gameQuizQuery(coreHttp), enabled: authed });
  const { data: missions } = useQuery({ ...gameMissionsQuery(coreHttp), enabled: authed });
  const { data: forest } = useQuery({ ...gameForestQuery(coreHttp), enabled: authed });
  const { data: season } = useQuery(gameSeasonQuery(coreHttp));

  return { profileQ, quiz, missions, forest, season };
}
