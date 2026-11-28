import { CalendarCheck, Check, Info, ShowerHead, TreePine } from 'lucide-react';
import { WATER_STEP, missingDrops } from '@tubutree/app-core/game-newbie';
import { gardenDayActions, gardenDayCopy, type PrimaryWaterAction } from '@tubutree/app-core/game-primary-action';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import { guestCheckInCopy } from '@tubutree/app-core/daily-check-in-guest-copy';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import type { GameProfile } from '../../services/game-api';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { Text } from '../ui/text';
import { CheckInStreak } from './checkin-streak';
import { isSameVNDay } from './game-utils';
import { OrderWaterCard } from './order-water-card';
import '../../css/game-hub.css';

type Claim = Extract<PrimaryWaterAction, { kind: 'claim' }>;

/**
 * Hai nút màu của Chăm vườn ("Tưới cây", "Điểm danh") và viên chuỗi ngày kèm số giọt của lần điểm danh; luật chuỗi, vé giữ lửa và nước từ
 * đơn hàng nằm trong sheet ⓘ (`onRules`). Thiếu nước thì "Tưới cây" mở sheet "Kiếm nước" với số giọt còn thiếu, không bao giờ bấm ra lỗi.
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
  onRetryStatus?: () => void;
  waterPending: boolean;
  checkInPending: boolean;
  onClaim: (action: Claim) => void;
  onWater: (drops: number) => void;
  onHarvest: () => void;
  onEarn: (missing: number) => void;
  onRules: () => void;
}) {
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
    if (water.kind === 'water') onWater(water.drops);
    else if (water.kind === 'harvest') onHarvest();
    else onEarn(missingDrops(profile?.totalSeeds ?? 0, WATER_STEP));
  };
  return (
    <section className="tubu-day" data-testid="garden-day-actions">
      <div className="tubu-day-buttons">
        <Button
          size="lg"
          fullWidth
          icon={water.kind === 'harvest' ? TreePine : ShowerHead}
          className="tubu-day-btn tubu-day-btn--water"
          disabled={busy}
          loading={waterPending}
          onPress={pressWater}
        >
          {water.kind === 'harvest' ? gardenDayCopy.harvest : gardenDayCopy.water}
        </Button>
        {checkIn ? (
          <Button
            size="lg"
            fullWidth
            icon={CalendarCheck}
            className="tubu-day-btn tubu-day-btn--checkin tubu-day-btn--ready"
            disabled={busy}
            loading={checkInPending}
            onPress={() => onClaim(checkIn)}
          >
            {checkInLabel}
          </Button>
        ) : (
          <div className="tubu-day-done" data-testid="garden-checkin-done">
            <Icon icon={Check} size="sm" tone="current" />
            {checkInLabel}
          </div>
        )}
      </div>
      <div className="tubu-day-meta">
        <span className="tubu-day-streak tubu-nums" data-testid="garden-streak-pill">
          {gardenDayCopy.streak(streakDays ?? 0, gain)}
        </span>
        <IconButton icon={Info} label={gardenDayCopy.rules} onPress={onRules} />
      </div>
      {statusError && (
        <div className="tubu-day-error">
          <Text variant="caption" tone="danger" as="div" style={{ minWidth: 0 }}>
            {checkInCopy.loadErrorTitle}
          </Text>
          <Button variant="secondary" onPress={() => onRetryStatus?.()} style={{ flexShrink: 0 }}>
            Thử lại
          </Button>
        </div>
      )}
    </section>
  );
}

/** Sheet ⓘ "Luật chăm vườn": thẻ chuỗi đầy đủ (thưởng mốc, vé giữ lửa, hứng sương) và nước từ đơn hàng. Tự đóng trước khi mở sheet "Kiếm nước" hay sang trang mua sắm. */
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
  onShop,
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
  onShop: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={gardenDayCopy.rules}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
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
        <OrderWaterCard
          info={profile?.orderWater}
          onShop={() => {
            onClose();
            onShop();
          }}
        />
      </div>
    </BottomSheet>
  );
}
