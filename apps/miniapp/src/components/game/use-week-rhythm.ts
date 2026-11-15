import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RHYTHM_STORAGE_KEY, mergeLocalRhythmDays, parseLocalRhythmDays, vnDayKey, weekRhythm } from '@tubutree/app-core/game-week-rhythm';
import { useRealUser } from '../../hooks/use-real-user';
import { arcadeStatusQuery } from '../../services/arcade-api';
import { useAuthStore } from '../../store/auth';
import { browserStorage } from '../../utils/recently-viewed';

const DAY_CHECK_MS = 60_000;

function readDays(key: string): string[] {
  try {
    return parseLocalRhythmDays(browserStorage()?.getItem(key));
  } catch {
    return [];
  }
}

function writeDays(key: string, days: string[]): void {
  try {
    browserStorage()?.setItem(key, JSON.stringify(days));
  } catch {
    // Ghi nhớ trên máy chỉ để bù ngày chỉ chơi mini game; hỏng thì dải vẫn đúng với dữ liệu máy chủ.
  }
}

const sameDays = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * Dữ liệu của dải Nhịp Sống Xanh: chuỗi điểm danh và việc hôm nay từ hồ sơ Vườn (trang đã tải), số ván mini game hôm nay từ cùng truy vấn với `ArcadeHub`
 * (cùng khoá nên không thêm request), cộng ngày đã ghi trên máy theo tài khoản. Qua nửa đêm giờ VN thì dải đổi ngày mà không cần mở lại trang.
 */
export function useWeekRhythm({ streakDays, lastCheckInAt, activeToday }: { streakDays: number | undefined; lastCheckInAt: string | null | undefined; activeToday: boolean }) {
  const userId = useAuthStore((s) => s.user?.id);
  const real = useRealUser();
  const arcade = useQuery({ ...arcadeStatusQuery, enabled: real, staleTime: 30_000 });
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
    [streakDays, lastCheckInAt, todayDone, localDays, dayKey],
  );
}
