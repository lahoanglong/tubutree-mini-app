'use client';

import { useState } from 'react';
import { lastDaysRange, vnMonthRange } from '@/lib/admin-reports';
import { ReportsRevenueSection } from './reports-revenue-section';
import { ReportsSourcesSection } from './reports-sources-section';
import { ReportsFinanceSection } from './reports-finance-section';
import { FIELD_CLASS, TOUCH_H, chipClass } from './ui';
import { VnDateInput } from './vn-date-input';

const PRESETS = [
  { key: '7', label: '7 ngày', range: () => lastDaysRange(7) },
  { key: '30', label: '30 ngày', range: () => lastDaysRange(30) },
  { key: '90', label: '90 ngày', range: () => lastDaysRange(90) },
  { key: 'month', label: 'Tháng này', range: () => vnMonthRange(0) },
  { key: 'lastMonth', label: 'Tháng trước', range: () => vnMonthRange(-1) },
] as const;

export type ReportSection = 'revenue' | 'sources' | 'finance';
const ALL_SECTIONS: readonly ReportSection[] = ['revenue', 'sources', 'finance'];

/**
 * Phần báo cáo mở cho người đang xem — khớp @AllowStaff của AdminReportsController: doanh thu và file tài chính cho KE_TOAN,
 * bảng nguồn khách cho MARKETING. Phần không có quyền thì không render, nên cũng không gọi API (khỏi 403).
 */
export function reportSectionsFor(isAdmin: boolean, perms: readonly string[]): ReportSection[] {
  if (isAdmin) return [...ALL_SECTIONS];
  return ALL_SECTIONS.filter((s) => (s === 'sources' ? perms.includes('MARKETING') : perms.includes('KE_TOAN')));
}

/** Báo cáo cho kế toán và marketing: một khoảng ngày (giờ Việt Nam) dùng chung cho mọi phần bên dưới. Mặc định 30 ngày gần nhất. */
export function ReportsTab({ sections = ALL_SECTIONS }: { sections?: readonly ReportSection[] }) {
  const [range, setRange] = useState(() => lastDaysRange(30));
  const [preset, setPreset] = useState<string | null>('30');
  const pick = (p: (typeof PRESETS)[number]) => {
    setRange(p.range());
    setPreset(p.key);
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
              <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => pick(p)} className={chipClass(preset === p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-stone-600">
            Từ ngày
            <VnDateInput ariaLabel="Từ ngày" value={range.from} max={range.to} onChange={(v) => edit({ from: v })} className={`${FIELD_CLASS} ${TOUCH_H} mt-1`} />
          </label>
          <label className="text-xs text-stone-600">
            Đến ngày
            <VnDateInput ariaLabel="Đến ngày" value={range.to} min={range.from} onChange={(v) => edit({ to: v })} className={`${FIELD_CLASS} ${TOUCH_H} mt-1`} />
          </label>
        </div>
      </div>
      {sections.includes('revenue') && <ReportsRevenueSection range={range} />}
      {sections.includes('sources') && <ReportsSourcesSection range={range} />}
      {sections.includes('finance') && <ReportsFinanceSection range={range} />}
    </div>
  );
}
