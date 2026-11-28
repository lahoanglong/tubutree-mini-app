import { CalendarCheck, Check, Info, ShowerHead, TreePine } from 'lucide-react';
import { WATER_STEP, missingDrops } from '@tubutree/app-core/game-newbie';
import { gardenDayActions, gardenDayCopy, type PrimaryWaterAction } from '@tubutree/app-core/game-primary-action';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import { guestCheckInCopy } from '@tubutree/app-core/daily-check-in-guest-copy';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import type { GameProfile } from '@tubutree/app-core/api/game';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { Sheet } from '@/components/ui/sheet';
import { usePressLock } from '@/lib/use-press-lock';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { CheckInStreak } from './checkin-streak';
import { isSameVNDay } from './game-utils';
import { OrderWaterCard } from './order-water-card';

type Claim = Extract<PrimaryWaterAction, { kind: 'claim' }>;

/**
 * Bản web của Mini `GardenDayActions` (cùng props, cùng lớp CSS ở components/game/game-hub.css): hai nút màu "Tưới cây" / "Điểm danh" và viên
 * chuỗi ngày kèm số giọt của lần điểm danh; luật chuỗi, vé giữ lửa và nước từ đơn hàng nằm trong sheet ⓘ (`onRules`).
 * Nút bận không `disabled` (Chromium thả focus về body ngay khi khách vừa bấm): báo bằng aria-busy/aria-disabled và chặn trong handler.
 */
export function GardenDayActions({
  profile,
  streakDays,
  pointsPending,
  pointsBlocked,
  checkInSeeds,
  statusError,
  onRetryStatus,
  waterPending,
  checkInPending,
  onClaim,
  onWater,
  onHarvest,
  onEarn,
  onRules,
}: {
  profile: GameProfile | undefined;
  streakDays: number | undefined;
  /** Trạng thái điểm danh gộp báo còn phần Điểm Xanh chưa nhận (chỉ true khi đã tải được trạng thái đó). */
  pointsPending?: boolean;
  /** Khách vãng lai (API báo `pointsBlocked`): không có phần Điểm Xanh để nhận. */
  pointsBlocked?: boolean;
  /** `todayWater` của trạng thái điểm danh gộp (xem PrimaryWaterInput.checkInSeeds); chưa tải được thì bỏ trống. */
  checkInSeeds?: number;
  /** Lịch điểm danh chung tải lỗi: một dòng + Thử lại (hai nút vẫn theo hồ sơ giọt nước nên không chặn việc tưới). */
  statusError?: boolean;
  onRetryStatus?: () => void | PromiseLike<unknown>;
  waterPending: boolean;
  checkInPending: boolean;
  onClaim: (action: Claim) => void;
  onWater: (drops: number) => void;
  onHarvest: () => void;
  onEarn: (missing: number) => void;
  onRules: () => void;
}) {
  const retryStatus = usePressLock(onRetryStatus);
  const { water, checkIn } = gardenDayActions({
    totalSeeds: profile?.totalSeeds ?? 0,
    harvestReady: profile?.harvestReady,
    checkedInToday: isSameVNDay(profile?.lastCheckInAt ?? null),
    pointsPending,
    dewToday: isSameVNDay(profile?.lastDewAt ?? null),
    dailyLoginSeeds: profile?.dailyLoginSeeds,
    dewSeeds: profile?.dewSeeds,
    firstCheckinBonus: profile?.firstCheckinBonus,
    checkInSeeds,
    tankCapacity: profile?.tankCapacity,
  });
  const busy = waterPending || checkInPending;
  const checkInLabel = !checkIn
    ? gardenDayCopy.checkInDone
    : checkIn.pointsOnly
      ? pointsBlocked
        ? guestCheckInCopy.claimToday
        : gameMoreCopy.claimPoints
      : gardenDayCopy.checkIn;
  const gain = checkIn && !checkIn.pointsOnly ? checkIn.gain : null;
  const pressWater = () => {
    if (busy) return;
    if (water.kind === 'water') onWater(water.drops);
    else if (water.kind === 'harvest') onHarvest();
    else onEarn(missingDrops(profile?.totalSeeds ?? 0, WATER_STEP));
  };
  const WaterIcon = water.kind === 'harvest' ? TreePine : ShowerHead;
  return (
    <section className="tubu-day" data-testid="garden-day-actions">
      <div className="tubu-day-buttons">
        <button
          type="button"
          aria-busy={waterPending || undefined}
          aria-disabled={busy || undefined}
          onClick={pressWater}
          className="tubu-day-btn tubu-day-btn--water"
        >
          <WaterIcon className="h-5 w-5 flex-none" aria-hidden="true" />
          {water.kind === 'harvest' ? gardenDayCopy.harvest : gardenDayCopy.water}
        </button>
        {checkIn ? (
          <button
            type="button"
            aria-busy={checkInPending || undefined}
            aria-disabled={busy || undefined}
            onClick={() => !busy && onClaim(checkIn)}
            className="tubu-day-btn tubu-day-btn--checkin tubu-day-btn--ready"
          >
            <CalendarCheck className="h-5 w-5 flex-none" aria-hidden="true" />
            {checkInLabel}
          </button>
        ) : (
          <div className="tubu-day-done" data-testid="garden-checkin-done">
            <Check className="h-4 w-4 flex-none" aria-hidden="true" />
            {checkInLabel}
          </div>
        )}
      </div>
      <div className="tubu-day-meta">
        <span className="tubu-day-streak tabular-nums" data-testid="garden-streak-pill">
          {gardenDayCopy.streak(streakDays ?? 0, gain)}
        </span>
        <button
          type="button"
          aria-label={gardenDayCopy.rules}
          aria-haspopup="dialog"
          onClick={onRules}
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-forest-700 transition active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <Info className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {statusError && (
        <div className="tubu-day-error">
          <span role="alert" className="min-w-0 text-caption text-danger-fg">
            {checkInCopy.loadErrorTitle}
          </span>
          <button
            type="button"
            aria-busy={retryStatus.busy || undefined}
            aria-disabled={retryStatus.busy || undefined}
            onClick={retryStatus.press}
            className={`${miniBtnSecondary} flex-none`}
          >
            Thử lại
          </button>
        </div>
      )}
    </section>
  );
}

/** Sheet ⓘ "Luật chăm vườn" (như Mini `GardenRulesSheet`): thẻ chuỗi đầy đủ (thưởng mốc, vé giữ lửa, hứng sương) và nước từ đơn hàng. Tự đóng trước khi mở sheet "Kiếm nước". */
export function GardenRulesSheet({
  open,
  onClose,
  profile,
  status,
  freezePending,
  dewPending,
  onBuyFreeze,
  onCollectDew,
  onNeedWater,
  shopHref,
}: {
  open: boolean;
  onClose: () => void;
  profile: GameProfile | undefined;
  status?: CheckInStatusResponse;
  freezePending: boolean;
  dewPending: boolean;
  onBuyFreeze: () => void;
  onCollectDew: () => void;
  onNeedWater: (missing: number) => void;
  shopHref: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={gardenDayCopy.rules}>
      <div className="flex flex-col gap-3">
        <CheckInStreak
          profile={profile}
          status={status}
          onBuyFreeze={onBuyFreeze}
          freezePending={freezePending}
          onCollectDew={onCollectDew}
          dewPending={dewPending}
          onNeedWater={(missing) => {
            onClose();
            onNeedWater(missing);
          }}
        />
        <OrderWaterCard info={profile?.orderWater} shopHref={shopHref} />
      </div>
    </Sheet>
  );
}
