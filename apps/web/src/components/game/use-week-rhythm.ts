'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RHYTHM_STORAGE_KEY, mergeLocalRhythmDays, parseLocalRhythmDays, vnDayKey, weekRhythm } from '@tubutree/app-core/game-week-rhythm';
import { gameArcadeStatusQuery } from '@tubutree/app-core/queries/game';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';

const DAY_CHECK_MS = 60_000;

function readDays(key: string): string[] {
  try {
    return parseLocalRhythmDays(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeDays(key: string, days: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(days));
  } catch {
    // Ghi nhớ trên máy chỉ để bù ngày chỉ chơi mini game; hỏng thì dải vẫn đúng với dữ liệu máy chủ.
  }
}

const sameDays = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * Dữ liệu của dải Nhịp Sống Xanh (cùng việc với `use-week-rhythm.ts` của Mini App): chuỗi điểm danh và việc hôm nay từ hồ sơ Vườn (trang đã tải), số ván mini game
 * hôm nay từ cùng truy vấn với `ArcadeHub` (cùng khoá nên không thêm request), cộng ngày đã ghi trên máy theo tài khoản. Qua nửa đêm giờ VN thì dải đổi ngày.
 */
export function useWeekRhythm({ streakDays, lastCheckInAt, activeToday }: { streakDays: number | undefined; lastCheckInAt: string | null | undefined; activeToday: boolean }) {
  const userId = useAuth().user?.id;
  const authed = useAuthPhase() === 'authenticated';
  const arcade = useQuery({ ...gameArcadeStatusQuery(coreHttp), enabled: authed });
  const playedToday = arcade.data ? Object.values(arcade.data.games).some((g) => (g?.used ?? 0) > 0) : false;
  const todayDone = activeToday || playedToday;
  const key = `${RHYTHM_STORAGE_KEY}.${userId ?? 'anon'}`;

  const [dayKey, setDayKey] = useState(() => vnDayKey(new Date()));
  const [localDays, setLocalDays] = useState(() => readDays(key));

  useEffect(() => {
    const id = setInterval(() => setDayKey((k) => {
      const next = vnDayKey(new Date());
      return next === k ? k : next;
    }), DAY_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const stored = readDays(key);
    const next = mergeLocalRhythmDays(stored, new Date(), todayDone);
    if (!sameDays(stored, next)) writeDays(key, next);
    setLocalDays((cur) => (sameDays(cur, next) ? cur : next));
  }, [key, todayDone, dayKey]);

  return useMemo(
    () => weekRhythm({ now: new Date(), streakDays, lastCheckInAt, todayDone, localDays }),
    // dayKey đổi khi qua nửa đêm: buộc tính lại với ngày mới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streakDays, lastCheckInAt, todayDone, localDays, dayKey],
  );
}
