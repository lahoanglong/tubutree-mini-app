'use client';

import { useQuery } from '@tanstack/react-query';
import { dealerTierProgressQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { tierProgressLines, tierProgressPct } from './dealer-tier-tools';

/**
 * Doanh số tháng này so với mốc bậc chiết khấu kế tiếp, nằm trong thẻ tổng quan tối của hub (cùng kiểu thanh với tab Báo cáo).
 * Đang tải, lỗi, hay chưa được gán bậc thì không vẽ gì: thẻ tổng quan vẫn đủ nghĩa, không chen khung chờ hay lời lỗi vào thẻ.
 */
export function TierProgress() {
  const q = useQuery(dealerTierProgressQuery(coreHttp));
  const p = q.data;
  const lines = p ? tierProgressLines(p, formatVnd) : null;
  if (!p || !lines) return null;
  const next = p.nextTier;
  const pct = tierProgressPct(p);
  return (
    <div data-testid="dealer-tier-progress" className="mt-3 border-t border-stone-0/20 pt-3">
      {next && (
        <>
          <div className="flex items-baseline justify-between gap-2 text-xs text-stone-100">
            <span>Doanh số tháng {p.month}</span>
            <span className="tabular-nums">
              {formatVnd(p.volume)} / {formatVnd(next.minOrderVolume)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Doanh số tháng ${p.month} tới mốc ${next.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-0/20"
          >
            <div className="h-full rounded-full bg-promo-solid max-md:bg-[var(--color-dealer-accent)]" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <p className={`${next ? 'mt-1.5 ' : ''}text-xs text-stone-100`}>{lines.headline}</p>
      {lines.pending && <p className="text-xs text-stone-100">{lines.pending}</p>}
    </div>
  );
}
