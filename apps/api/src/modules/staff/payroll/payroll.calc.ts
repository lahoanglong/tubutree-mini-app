import { overlapMinutes } from '../shifts/time.util';

export interface SessionLike {
  checkinAt: Date;
  checkoutAt: Date | null;
}
export interface ShiftWindow {
  effStart: Date;
  effEnd: Date;
  sessions: SessionLike[];
}

/** Tổng phút làm = Σ overlap(phiên đã đóng, cửa sổ ca duyệt). Phiên đang mở bỏ qua. */
export function sumWorkedMinutes(windows: ShiftWindow[]): number {
  let total = 0;
  for (const w of windows) {
    for (const s of w.sessions) {
      if (!s.checkoutAt) continue;
      total += overlapMinutes(s.checkinAt, s.checkoutAt, w.effStart, w.effEnd);
    }
  }
  return total;
}

export interface AdjLike {
  amount: number;
}

export interface DayPay {
  workedMinutes: number;
  hourlyRate: number;
  gross: number;
  fines: number;
  net: number;
}

/** gross=round(giờ×đơn giá); fines=Σ khoản dương; net=max(0, gross−Σ điều chỉnh) (MANUAL âm = thưởng). */
export function computeDayPay(minutes: number, rate: number, adjustments: AdjLike[]): DayPay {
  const gross = Math.round((minutes / 60) * rate);
  const adjTotal = adjustments.reduce((s, a) => s + a.amount, 0);
  const fines = adjustments.reduce((s, a) => (a.amount > 0 ? s + a.amount : s), 0);
  const net = Math.max(0, gross - adjTotal);
  return { workedMinutes: minutes, hourlyRate: rate, gross, fines, net };
}
