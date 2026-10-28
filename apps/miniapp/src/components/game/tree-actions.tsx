import { Droplets, ShowerHead, TreePine } from 'lucide-react';
import { gameMoreCopy, primaryWaterAction, type PrimaryWaterAction } from '@tubutree/app-core/game-newbie';
import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { isSameVNDay } from './game-utils';

const t = vi.game.newbie.primary;

export function primaryActionOf(profile: GameProfile | undefined, pointsPending?: boolean): PrimaryWaterAction {
  return primaryWaterAction({
    totalSeeds: profile?.totalSeeds ?? 0,
    harvestReady: profile?.harvestReady,
    checkedInToday: isSameVNDay(profile?.lastCheckInAt ?? null),
    pointsPending,
    dewToday: isSameVNDay(profile?.lastDewAt ?? null),
    dailyLoginSeeds: profile?.dailyLoginSeeds,
    dewSeeds: profile?.dewSeeds,
    firstCheckinBonus: profile?.firstCheckinBonus,
    tankCapacity: profile?.tankCapacity,
  });
}

/**
 * Nút chính trên cây. Không bao giờ bấm ra lỗi "thiếu nước": chưa nhận nước hôm nay thì nhận, đủ 20💧 thì tưới
 * hết, còn lại mở sheet "Kiếm nước".
 */
export function TreeActions({
  profile,
  pointsPending,
  pending,
  onClaim,
  onWater,
  onHarvest,
  onEarn,
}: {
  profile: GameProfile | undefined;
  /** Trạng thái điểm danh gộp báo còn phần Điểm Xanh chưa nhận (chỉ true khi đã tải được trạng thái đó). */
  pointsPending?: boolean;
  pending: boolean;
  onClaim: (action: Extract<PrimaryWaterAction, { kind: 'claim' }>) => void;
  onWater: (drops: number) => void;
  /** Cây đã đủ nước từ trước: thu hoạch không cần thêm giọt nào. */
  onHarvest: () => void;
  onEarn: () => void;
}) {
  const action = primaryActionOf(profile, pointsPending);
  const label =
    action.kind === 'claim'
      ? action.pointsOnly
        ? gameMoreCopy.claimPoints
        : action.first
        ? t.claimFirst(action.gain)
        : t.claim(action.gain)
      : action.kind === 'water'
        ? t.water(action.drops)
        : action.kind === 'harvest'
          ? t.harvest
          : t.earn;
  const press = () => {
    if (action.kind === 'claim') onClaim(action);
    else if (action.kind === 'water') onWater(action.drops);
    else if (action.kind === 'harvest') onHarvest();
    else onEarn();
  };
  return (
    <Button size="lg" fullWidth icon={action.kind === 'harvest' ? TreePine : action.kind === 'water' ? ShowerHead : Droplets} disabled={pending} loading={pending} onPress={press}>
      {label}
    </Button>
  );
}
