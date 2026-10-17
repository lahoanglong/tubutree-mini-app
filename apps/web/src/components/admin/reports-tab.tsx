'use client';

import { useState } from 'react';
import { lastDaysRange } from '@/lib/admin-reports';
import { ReportsRevenueSection } from './reports-revenue-section';
import { ReportsSourcesSection } from './reports-sources-section';
import { FIELD_CLASS, TOUCH_H, chipClass } from './ui';

const PRESETS = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
] as const;

/** Báo cáo cho kế toán và marketing: một khoảng ngày (giờ Việt Nam) dùng chung cho mọi phần bên dưới. Mặc định 30 ngày gần nhất. */
export function ReportsTab() {
  const [range, setRange] = useState(() => lastDaysRange(30));
  const [preset, setPreset] = useState<number | null>(30);
  const pick = (days: number) => {
    setRange(lastDaysRange(days));
    setPreset(days);
  };
  const edit = (patch: Partial<typeof range>) => {
    setRange((r) => ({ ...r, ...patch }));
    setPreset(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-900">Báo cáo</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chọn nhanh khoảng ngày">
            {PRESETS.map((p) => (
              <button key={p.days} type="button" aria-pressed={preset === p.days} onClick={() => pick(p.days)} className={chipClass(preset === p.days)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-stone-600">
            Từ ngày
            <input type="date" value={range.from} max={range.to} onChange={(e) => edit({ from: e.target.value })} className={`${FIELD_CLASS} ${TOUCH_H} mt-1 block`} />
          </label>
          <label className="text-xs text-stone-600">
            Đến ngày
            <input type="date" value={range.to} min={range.from} onChange={(e) => edit({ to: e.target.value })} className={`${FIELD_CLASS} ${TOUCH_H} mt-1 block`} />
          </label>
        </div>
      </div>
      <ReportsRevenueSection range={range} />
      <ReportsSourcesSection range={range} />
    </div>
  );
}
