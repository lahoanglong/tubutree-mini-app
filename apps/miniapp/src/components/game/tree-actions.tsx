import { Droplets, ShowerHead } from 'lucide-react';
import { primaryWaterAction, type PrimaryWaterAction } from '@tubutree/app-core/game-newbie';
import type { GameProfile } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { isSameVNDay } from './game-utils';

const t = vi.game.newbie.primary;

export function primaryActionOf(profile: GameProfile | undefined): PrimaryWaterAction {
  return primaryWaterAction({
    totalSeeds: profile?.totalSeeds ?? 0,
    checkedInToday: isSameVNDay(profile?.lastCheckInAt ?? null),
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
  pending,
  onClaim,
  onWater,
  onEarn,
}: {
  profile: GameProfile | undefined;
  pending: boolean;
  onClaim: (action: Extract<PrimaryWaterAction, { kind: 'claim' }>) => void;
  onWater: (drops: number) => void;
  onEarn: () => void;
}) {
  const action = primaryActionOf(profile);
  const label =
    action.kind === 'claim' ? (action.first ? t.claimFirst(action.gain) : t.claim(action.gain)) : action.kind === 'water' ? t.water(action.drops) : t.earn;
  const press = () => {
    if (action.kind === 'claim') onClaim(action);
    else if (action.kind === 'water') onWater(action.drops);
    else onEarn();
  };
  return (
    <Button size="lg" fullWidth icon={action.kind === 'water' ? ShowerHead : Droplets} disabled={pending} loading={pending} onPress={press}>
      {label}
    </Button>
  );
}
