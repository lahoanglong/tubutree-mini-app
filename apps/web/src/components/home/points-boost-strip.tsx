'use client';

import { Leaf } from 'lucide-react';
import { pointsBoostText } from '@/lib/home-text';
import { percentLabel, pointsBoostOf } from '@/lib/points-boost';
import { usePublicConfig } from '@/lib/use-public-config';

/**
 * Dải "mua trực tiếp tại Tubu Tree tích nhiều hơn" ở Trang chủ. Mọi số lấy từ config công khai. Cờ tích đơn sàn tắt thì không so với
 * sàn mà chỉ nói mức đơn Tubu. `omitPlain` cho chỗ trang chủ đã có dòng nói mức tích (khối "Quà khách mới"), tránh nói hai lần.
 */
export function PointsBoostStrip({ omitPlain = false }: { omitPlain?: boolean }) {
  const cfg = usePublicConfig();
  const boost = pointsBoostOf(cfg.isLoaded ? cfg.loyalty : undefined);
  if (!boost) return null;
  if (boost.kind === 'plain') {
    if (omitPlain) return null;
    return (
      <p data-testid="points-boost" className="flex items-center gap-1.5 py-2 text-sm font-semibold text-forest-700">
        <Leaf className="h-4 w-4 flex-none" aria-hidden="true" />
        {pointsBoostText.plain(percentLabel(boost.appPct))}
      </p>
    );
  }
  return (
    <div className="py-2">
      <div data-testid="points-boost" className="flex items-start gap-2 rounded-card bg-forest-50 px-3.5 py-3">
        <Leaf className="mt-0.5 h-4 w-4 flex-none text-forest-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-forest-700">{boost.double ? pointsBoostText.titleDouble : pointsBoostText.titleMore}</p>
          <p className="mt-0.5 text-xs text-stone-600">{pointsBoostText.sub(percentLabel(boost.marketplacePct), percentLabel(boost.appPct))}</p>
        </div>
      </div>
    </div>
  );
}
