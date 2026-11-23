import { fillTemplate } from './copy-template';
import { RESCHEDULE_MAX_DAYS_AHEAD, type SubscriptionDTO, type SubscriptionFirstOrder } from './api/subscriptions';

/**
 * Chữ của các thao tác tự phục vụ trên gói định kỳ (Mini App và web cùng dùng): bỏ qua kỳ này ngay trên thẻ, "Đặt kỳ này ngay",
 * dời ngày giao kỳ tới trong sheet Sửa, viên bậc giảm kế tiếp. Ngân sách độ dài sau khi điền giá trị xấu nhất ở `SUBSCRIPTION_SELF_SERVE_MAX`.
 */
export const SUBSCRIPTION_SELF_SERVE_COPY = {
  skip: 'Bỏ qua kỳ này',
  skipDone: 'Đã bỏ qua kỳ này, lần kế {date}',
  runNow: 'Đặt kỳ này ngay',
  runNowTitle: 'Đặt đơn kỳ này ngay?',
  runNowBody: 'Tubu tạo đơn {name} ngay, giá định kỳ như mọi kỳ. Kỳ kế giao ngày {date}.',
  runNowConfirm: 'Đặt ngay',
  runNowCancel: 'Để sau',
  runNowDone: 'Đã đặt đơn {code}, Tubu giao sớm nhé',
  runNowAwaitTransfer: 'Đã tạo đơn {code}, bạn chuyển khoản để Tubu giao nhé',
  rescheduleLabel: 'Ngày giao kỳ tới',
  plusDays: '+{n} ngày',
  pickDate: 'Chọn ngày',
  rescheduleHint: 'Chọn một ngày từ mai tới {max} ngày tới.',
  rescheduleNext: 'Kỳ tới giao ngày {date}',
  tierPill: 'Thêm {n} gói định kỳ để được giảm {pct}%',
} as const;

export type SubscriptionSelfServeCopyKey = keyof typeof SUBSCRIPTION_SELF_SERVE_COPY;

/** Số ký tự tối đa sau khi điền giá trị xấu nhất; null = câu trong tấm xác nhận (xuống dòng tự do, có tên sản phẩm). Chỉ spec đọc. */
export const SUBSCRIPTION_SELF_SERVE_MAX: Record<SubscriptionSelfServeCopyKey, number | null> = {
  skip: 16,
  skipDone: 44,
  runNow: 18,
  runNowTitle: 24,
  runNowBody: null,
  runNowConfirm: 12,
  runNowCancel: 12,
  runNowDone: 48,
  runNowAwaitTransfer: 64,
  rescheduleLabel: 20,
  plusDays: 10,
  pickDate: 12,
  rescheduleHint: 44,
  rescheduleNext: 32,
  tierPill: 44,
};

export function selfServeCopy(key: SubscriptionSelfServeCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(SUBSCRIPTION_SELF_SERVE_COPY[key], vars, key);
}

const VN_OFFSET_MS = 7 * 3600e3;
const DAY_MS = 864e5;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày lịch giờ Việt Nam 'yyyy-mm-dd' của một mốc. */
const vnDay = (ms: number): string => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
/** 'yyyy-mm-dd' + n ngày (tính trên ngày lịch, không qua giờ máy). */
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** "2026-12-01" thành "01/12/2026". */
export function dayKeyText(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/** Bước dời nhanh trong sheet Sửa (ngày), tính từ ngày giao kỳ tới đang hẹn. */
export const RESCHEDULE_STEPS = [7, 14] as const;

/** Khoảng được dời: từ ngày mai (hôm nay là "Đặt kỳ này ngay") tới hết `RESCHEDULE_MAX_DAYS_AHEAD` ngày, như API. */
export function rescheduleRange(now: Date = new Date()): { min: string; max: string } {
  const today = vnDay(now.getTime());
  return { min: addDays(today, 1), max: addDays(today, RESCHEDULE_MAX_DAYS_AHEAD) };
}

/** Đúng dạng 'yyyy-mm-dd' và trong khoảng dời được. Ngày không có thật (30/02) do ô ngày không cho chọn; lọt tới API thì API báo "không hợp lệ". */
export function isRescheduleDateAllowed(day: string, now: Date = new Date()): boolean {
  const { min, max } = rescheduleRange(now);
  return DAY_KEY.test(day) && day >= min && day <= max;
}

export interface RescheduleOption {
  days: number;
  /** Ngày mới 'yyyy-mm-dd' giờ VN. */
  date: string;
  /** Nằm trong khoảng API nhận; ngoài khoảng thì nút khoá. */
  allowed: boolean;
}

/**
 * "+7 ngày" / "+14 ngày" tính từ ngày giao kỳ tới đang hẹn; kỳ đã đến hạn hay đang thử lại (ngày hẹn không sau hôm nay) thì tính từ hôm nay.
 * `nextRunAt` hỏng thì không có bước nào.
 */
export function rescheduleOptions(nextRunAt: string, now: Date = new Date()): RescheduleOption[] {
  const at = Date.parse(nextRunAt);
  if (Number.isNaN(at)) return [];
  const today = vnDay(now.getTime());
  const scheduled = vnDay(at);
  const base = scheduled > today ? scheduled : today;
  return RESCHEDULE_STEPS.map((days) => {
    const date = addDays(base, days);
    return { days, date, allowed: isRescheduleDateAllowed(date, now) };
  });
}

/** Ngày giao kế tiếp sau "Đặt kỳ này ngay": hôm nay (giờ VN) + chu kỳ, cùng luật API. */
export function runNowNextDay(intervalWeeks: number, now: Date = new Date()): string {
  return addDays(vnDay(now.getTime()), intervalWeeks * 7);
}

/** Câu trong tấm xác nhận "Đặt kỳ này ngay". */
export function runNowConfirmBody(sub: Pick<SubscriptionDTO, 'productName' | 'intervalWeeks'>, now: Date = new Date()): string {
  return selfServeCopy('runNowBody', { name: sub.productName, date: dayKeyText(runNowNextDay(sub.intervalWeeks, now)) });
}

/** Lời báo sau "Đặt kỳ này ngay": đơn chuyển khoản còn chờ tiền thì nhắc chuyển khoản. */
export function runNowDoneText(order: Pick<SubscriptionFirstOrder, 'code' | 'status'> | null | undefined): string {
  const code = order?.code ?? '';
  return order?.status === 'PENDING_PAYMENT' ? selfServeCopy('runNowAwaitTransfer', { code }) : selfServeCopy('runNowDone', { code });
}

/** Lời báo sau khi bỏ qua kỳ trên thẻ, kèm ngày kỳ kế do máy chủ trả; thiếu ngày thì chỉ câu đầu. */
export function skipDoneText(nextRunAt: string | null | undefined): string {
  const at = Date.parse(nextRunAt ?? '');
  const text = selfServeCopy('skipDone', { date: Number.isNaN(at) ? '' : dayKeyText(vnDay(at)) });
  return Number.isNaN(at) ? text.split(',')[0]! : text;
}

/** Bỏ qua kỳ và "Đặt kỳ này ngay" chỉ cho gói đang chạy (API trả 400 với gói khác). */
export const canActOnCycle = (sub: Pick<SubscriptionDTO, 'status'>): boolean => sub.status === 'ACTIVE';

/**
 * Viên "Thêm {n} gói định kỳ để được giảm {pct}%" từ `nextTier` máy chủ trả (cùng giá trị trên mọi gói, đọc gói đầu). Không có, API cũ hay số hỏng: null.
 */
export function nextTierText(subs: readonly Pick<SubscriptionDTO, 'nextTier'>[]): string | null {
  const t = subs[0]?.nextTier;
  if (!t || !(t.countNeeded >= 1) || t.countNeeded % 1 || !(t.discountPct > 0 && t.discountPct < 1)) return null;
  return selfServeCopy('tierPill', { n: t.countNeeded, pct: Math.round(t.discountPct * 100) });
}
