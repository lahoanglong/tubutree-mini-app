import { Flame } from 'lucide-react';
import { gameNewbieCopy, missingDrops } from '@tubutree/app-core/game-newbie';
import { ui } from '@/lib/guest-ui';
import { formatDrops, formatNumber } from './format';

// Hồi sinh chuỗi vừa mất (§streak-repair) — trang chỉ dựng khối này trong cửa sổ hồi sinh
export function StreakRepair({
  brokenStreakDays,
  cost,
  totalSeeds,
  pending,
  onRepair,
  onNeedWater,
}: {
  brokenStreakDays: number | undefined;
  cost: number | undefined;
  totalSeeds: number | undefined;
  pending: boolean;
  onRepair: () => void;
  /** Thiếu nước: mở sheet "Kiếm nước" với số giọt còn thiếu. */
  onNeedWater: (missing: number) => void;
}) {
  const short = cost != null && totalSeeds != null ? missingDrops(totalSeeds, cost) : 0;
  return (
    <div className="rounded-card border border-dashed border-promo-solid bg-promo-bg p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-promo-fg">
        <Flame className="h-4 w-4" aria-hidden="true" />
        {`Bạn vừa mất chuỗi ${formatNumber(brokenStreakDays ?? 0)} ngày`}
      </div>
      <p className="mt-0.5 text-caption text-stone-700">Hồi sinh ngay để giữ lại thành tích trước khi hết hạn.</p>
      <button type="button" disabled={pending} onClick={() => (short > 0 ? onNeedWater(short) : onRepair())} className={`${ui.btnPrimary} mt-2.5 w-full`}>
        {short > 0 ? gameNewbieCopy.short(short) : `Hồi sinh (${formatDrops(cost ?? 0)})`}
      </button>
    </div>
  );
}
