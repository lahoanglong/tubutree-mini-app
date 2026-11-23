import type { CohortRepeatSnapshot, FunnelDailySnapshot } from '@prisma/client';
import { PURCHASE_FUNNEL_STEPS, type CohortRepeatRowDTO, type FunnelDailyDTO, type PurchaseFunnelStep } from '@tubutree/shared-types';
import { FUNNEL_SESSIONS_STEP } from './analytics-aggregation.service';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Dòng cohort_repeat_snapshot cho bảng Phân tích. `medianDaysToSecondOrder` là Decimal (JSON ra chuỗi) nên ép về số ở đây. */
export function cohortRowView(r: CohortRepeatSnapshot): CohortRepeatRowDTO {
  return {
    cohortMonth: r.cohortMonth.toISOString().slice(0, 7),
    newBuyers: r.newBuyersInCohort,
    d30: { count: r.repeat30dCount, complete: r.repeat30dComplete },
    d60: { count: r.repeat60dCount, complete: r.repeat60dComplete },
    d90: { count: r.repeat90dCount, complete: r.repeat90dComplete },
    medianDaysToSecondOrder: r.medianDaysToSecondOrder === null ? null : Number(r.medianDaysToSecondOrder),
    computedAt: r.computedAt.toISOString(),
  };
}

/**
 * Gom các dòng funnel_daily_snapshot (mỗi dòng một bước × nền tảng) thành một phễu mỗi ngày, ngày tăng dần. Bước thiếu dòng là 0;
 * `entrySource` ngoài web/miniapp (không có ở job hiện tại) bị bỏ.
 */
export function funnelDailyView(rows: Pick<FunnelDailySnapshot, 'date' | 'step' | 'entrySource' | 'count'>[]): FunnelDailyDTO[] {
  const byDay = new Map<string, Map<string, { web: number; miniapp: number }>>();
  for (const r of rows) {
    if (r.entrySource !== 'web' && r.entrySource !== 'miniapp') continue;
    const key = dayKey(r.date);
    const steps = byDay.get(key) ?? new Map<string, { web: number; miniapp: number }>();
    const cell = steps.get(r.step) ?? { web: 0, miniapp: 0 };
    cell[r.entrySource] = r.count;
    steps.set(r.step, cell);
    byDay.set(key, steps);
  }
  return [...byDay.keys()].sort().map((date) => {
    const steps = byDay.get(date)!;
    const pick = (step: string) => steps.get(step) ?? { web: 0, miniapp: 0 };
    const s = pick(FUNNEL_SESSIONS_STEP);
    return {
      date,
      sessions: { web: s.web, miniapp: s.miniapp, total: s.web + s.miniapp },
      rows: PURCHASE_FUNNEL_STEPS.map((step: PurchaseFunnelStep) => {
        const c = pick(step);
        return { step, web: c.web, miniapp: c.miniapp, total: c.web + c.miniapp };
      }),
    };
  });
}

/**
 * Mốc `date` nhỏ nhất của `days` ngày phễu đã chốt gần nhất. Dòng phễu lưu ngày VN ở 00:00 UTC và ngày mới nhất là hôm qua (giờ VN), nên
 * mốc là hôm nay (giờ VN) − `days`: days=30 trả đủ 30 ngày, không mất ngày đầu vì so với giờ hiện tại.
 */
export function funnelDailySince(days: number, now: Date = new Date()): Date {
  const todayVn = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${todayVn}T00:00:00Z`) - days * 86_400_000);
}
