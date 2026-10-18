'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AffiliateDashboard, CtvTiersResponse } from '@tubutree/app-core/api/affiliate';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { ProgressBar } from '@/components/ui/progress-bar';
import { progressPct, tierRewardLabel } from './milestone-copy';

/** Bậc doanh số tháng và bảng 5 bậc CTV kèm thưởng mốc Điểm Xanh (mở rộng khi bấm). */
export function TierCard({ dash, tiers }: { dash: Pick<AffiliateDashboard, 'tier' | 'monthRevenue'>; tiers: CtvTiersResponse | undefined }) {
  const [showAll, setShowAll] = useState(false);
  const { tier } = dash;
  return (
    <section aria-label="Bậc CTV" className={`${ui.card} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none" aria-hidden="true">
            {tier.emoji}
          </span>
          <div>
            <div className="text-base font-semibold text-stone-900">CTV {tier.name}</div>
            <div className="text-xs text-forest-700">Bậc theo doanh số đã chốt tháng này</div>
          </div>
        </div>
        <div className="text-xs text-stone-600">Đã chốt: {formatVnd(dash.monthRevenue)}</div>
      </div>
      {tier.nextName && tier.nextThreshold && (
        <div className="mt-3">
          <ProgressBar value={progressPct(dash.monthRevenue, tier.nextThreshold)} max={100} />
          <div className="mt-1 text-xs text-stone-700">
            Còn <b>{formatVnd(tier.toNext)}</b> doanh số đã chốt để lên bậc {tier.nextName}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={showAll}
        onClick={() => setShowAll((v) => !v)}
        className="mt-3 flex min-h-11 w-full items-center justify-between gap-2.5 border-t border-stone-200 py-3 text-left"
      >
        <span className="text-sm font-semibold text-stone-900">Bảng 5 bậc CTV & thưởng mốc Điểm Xanh</span>
        {showAll ? <ChevronUp className="h-4 w-4 text-forest-600" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 text-forest-600" aria-hidden="true" />}
      </button>

      {showAll && tiers && (
        <ul className="mt-3 space-y-1.5">
          {tiers.allTiers.map((t) => {
            const current = t.name === tier.name;
            return (
              <li
                key={t.name}
                aria-current={current || undefined}
                className={`flex items-center justify-between rounded-control border p-2 ${current ? 'border-forest-600 bg-forest-50' : 'border-transparent bg-stone-50'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true">{t.emoji}</span>
                  <span className={`text-xs ${current ? 'font-semibold text-forest-700' : 'text-stone-900'}`}>
                    {t.name} {current ? '(Hiện tại)' : ''}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-forest-700">{tierRewardLabel(t)}</div>
                  <div className="text-xs text-stone-600">{t.min === 0 ? 'Mặc định' : `DS từ ${formatVnd(t.min)}`}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
