import { vnDateRangeInvalid, vnDayKeyOfIso, vnPromoWindowIso } from '@tubutree/app-core/vn-day';

interface PromoDates { startAt: string; endAt: string }

export function promoWindow(f: PromoDates, now = Date.now()) {
  return vnPromoWindowIso(f.startAt, f.endAt, now);
}

export function promoDateRangeInvalid(f: PromoDates, now = Date.now()): boolean {
  return vnDateRangeInvalid(f.startAt, f.endAt, now);
}

export function promoFormDates(p: { startAt?: string | null; endAt?: string | null }): PromoDates {
  return { startAt: vnDayKeyOfIso(p.startAt), endAt: vnDayKeyOfIso(p.endAt) };
}
