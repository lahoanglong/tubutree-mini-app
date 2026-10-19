import { Flame } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { formatDrops, formatNumber } from './format';

// Hồi sinh chuỗi vừa mất (§streak-repair) — trang chỉ dựng khối này trong cửa sổ hồi sinh
export function StreakRepair({
  brokenStreakDays,
  cost,
  pending,
  onRepair,
}: {
  brokenStreakDays: number | undefined;
  cost: number | undefined;
  pending: boolean;
  onRepair: () => void;
}) {
  return (
    <div className="rounded-card border border-dashed border-promo-solid bg-promo-bg p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-promo-fg">
        <Flame className="h-4 w-4" aria-hidden="true" />
        {`Bạn vừa mất chuỗi ${formatNumber(brokenStreakDays ?? 0)} ngày`}
      </div>
      <p className="mt-0.5 text-xs text-stone-700">Hồi sinh ngay để giữ lại thành tích trước khi hết hạn.</p>
      <button type="button" disabled={pending} onClick={onRepair} className={`${ui.btnPrimary} mt-2.5 w-full`}>
        {`Hồi sinh (${formatDrops(cost ?? 0)})`}
      </button>
    </div>
  );
}
