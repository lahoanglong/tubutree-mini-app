'use client';

import type { RetentionDailyRow } from '@/lib/admin-client';

export interface Ns1Summary {
  /** Tổng số khách mới trong các cohort đã đủ 30 ngày theo dõi. */
  cohort: number;
  /** Số khách trong đó có đơn thứ 2 trong 30 ngày kể từ đơn đầu. */
  repeat: number;
  /** Số ngày (dòng snapshot) đã có NS-1. */
  days: number;
  pct: number | null;
}

/**
 * Gộp NS-1 qua các dòng snapshot theo SỐ ĐẾM. Mỗi dòng là cohort của MỘT ngày, nên trung bình các tỉ lệ ngày sẽ để
 * ngày chỉ có 1 khách mới (lặp = 100%) nặng bằng ngày có 50 khách. Dòng chưa tính (null) bị bỏ qua.
 */
export function summarizeNs1(rows: RetentionDailyRow[]): Ns1Summary {
  let cohort = 0;
  let repeat = 0;
  let days = 0;
  for (const r of rows) {
    if (r.ns1CohortSize == null || r.ns1RepeatCount == null) continue;
    cohort += r.ns1CohortSize;
    repeat += r.ns1RepeatCount;
    days++;
  }
  return { cohort, repeat, days, pct: cohort > 0 ? (repeat / cohort) * 100 : null };
}

/** Dưới ngần này khách thì một khách lặp thêm/bớt đã làm tỉ lệ nhảy vài điểm %. */
const SMALL_SAMPLE = 30;

const formatPct = (p: number) => `${Number(p.toFixed(1)).toLocaleString('vi-VN')}%`;

/** North-star NS-1: % khách mới có đơn thứ 2 trong 30 ngày. */
export function Ns1Card({ rows }: { rows: RetentionDailyRow[] }) {
  const s = summarizeNs1(rows);
  return (
    <div className="mb-3 rounded-card border border-forest-200 bg-forest-50 p-3">
      <div className="text-xs font-medium text-forest-800">Khách có đơn thứ 2 trong 30 ngày (NS-1)</div>
      <div className="text-2xl font-semibold text-forest-900">{s.pct === null ? '—' : formatPct(s.pct)}</div>
      <p className="mt-0.5 text-xs text-stone-600">
        {s.pct === null
          ? 'Chưa có cohort nào đủ 30 ngày để tính. Số liệu tự cập nhật mỗi đêm.'
          : `${s.repeat}/${s.cohort} khách mới, gộp cohort của ${s.days} ngày (mỗi khách đã đủ 30 ngày theo dõi).${
              s.cohort < SMALL_SAMPLE ? ' Mẫu còn nhỏ, chỉ tham khảo.' : ''
            }`}
      </p>
    </div>
  );
}
