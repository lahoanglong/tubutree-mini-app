import { Check, Droplets, Flame, Snowflake } from 'lucide-react';
import { STREAK_3_SEEDS, gameNewbieCopy, missingDrops } from '@tubutree/app-core/game-newbie';
import type { GameProfile } from '@tubutree/app-core/api/game';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary, miniCard, miniSectionTitle } from '@/components/loyalty/mini-surface';
import { formatDrops } from './format';
import { isSameVNDay } from './game-utils';

// 💧 và 🎁 trong ô ngày là phần thưởng của chuỗi (nội dung game), còn lại là icon Lucide.
export function CheckInStreak({
  profile,
  allDone,
  onCheckIn,
  checkInPending,
  onBuyFreeze,
  freezePending,
  onCollectDew,
  dewPending,
  onNeedWater,
}: {
  profile: GameProfile | undefined;
  /** Cả Điểm Xanh và giọt nước đã xong hôm nay (trạng thái gộp); quyết định nút. Dòng giọt nước vẫn theo `lastCheckInAt`. */
  allDone: boolean;
  onCheckIn: () => void;
  checkInPending: boolean;
  onBuyFreeze: () => void;
  freezePending: boolean;
  onCollectDew: () => void;
  dewPending: boolean;
  /** Thiếu nước cho vé giữ lửa: mở sheet "Kiếm nước" với số giọt còn thiếu. */
  onNeedWater: (missing: number) => void;
}) {
  const streakDays = profile?.streakDays ?? 0;
  const dewCollectedToday = isSameVNDay(profile?.lastDewAt ?? null);
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);
  const t = gameNewbieCopy.checkin;
  const freezeCost = profile?.streakFreezeCost ?? 80;
  const freezeShort = profile ? missingDrops(profile.totalSeeds, freezeCost) : 0;
  const dayReward = (day: number): number | null => (day === 7 ? (profile?.streak7Seeds ?? null) : day === 3 ? STREAK_3_SEEDS : null);
  return (
    <section className={`p-4 ${miniCard}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-1.5 ${ui.sectionTitle} ${miniSectionTitle}`}>
            <Flame className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
            Điểm danh chuỗi {streakDays} ngày
          </h2>
          <p className="text-xs text-stone-600">{t.sub(profile?.dailyLoginSeeds ?? null, checkedInToday ? 0 : (profile?.firstCheckinBonus ?? 0))}</p>
        </div>
        <button type="button" disabled={allDone || checkInPending} onClick={onCheckIn} className={`${ui.btnPrimary} flex-none gap-1`}>
          {allDone && <Check className="h-4 w-4" aria-hidden="true" />}
          {allDone ? 'Đã điểm danh' : 'Điểm danh'}
        </button>
      </div>
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          const done = streakDays % 7 === 0 && streakDays > 0 ? true : day <= streakDays % 7;
          const bonus = day === 3 || day === 7;
          const reward = dayReward(day);
          return (
            <div key={day} className="flex-1 text-center">
              <div
                data-testid="streak-cell"
                className={`flex h-10 items-center justify-center rounded-control text-sm ${done ? 'bg-forest-600 text-stone-0' : 'bg-stone-100 text-stone-600'}`}
              >
                {done ? '💧' : bonus ? '🎁' : day}
              </div>
              <div className="mt-0.5 text-xs text-stone-600">N{day}</div>
              {bonus && reward != null && <div className="text-xs font-bold text-stone-700">{t.dayReward(reward)}💧</div>}
            </div>
          );
        })}
      </div>

      {/* Vé giữ lửa (streak-freeze) + giọt sương sáng (dew) */}
      <div className="mt-3 border-t border-stone-200 pt-1">
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-stone-700">
            <Snowflake className="h-4 w-4 text-stone-500" aria-hidden="true" />
            Vé giữ lửa: <span className="font-bold text-stone-900">{profile?.streakFreezes ?? 0}</span>
          </span>
          <button
            type="button"
            disabled={freezePending}
            onClick={() => (freezeShort > 0 ? onNeedWater(freezeShort) : onBuyFreeze())}
            className={`${miniBtnSecondary} flex-none`}
          >
            {freezeShort > 0 ? gameNewbieCopy.short(freezeShort) : `Mua (${formatDrops(freezeCost)})`}
          </button>
        </div>
        <button type="button" disabled={dewCollectedToday || dewPending} onClick={onCollectDew} className={`${miniBtnSecondary} mt-2 w-full gap-1.5`}>
          <Droplets className="h-4 w-4" aria-hidden="true" />
          {dewCollectedToday ? 'Đã hứng sương' : t.dew(profile?.dewSeeds ?? null)}
        </button>
        <p className="mt-2 text-xs text-stone-600">Vé giữ lửa giúp chuỗi không đứt khi bạn lỡ 1 ngày. Giọt sương sáng tặng 💧 mỗi ngày.</p>
      </div>
    </section>
  );
}
