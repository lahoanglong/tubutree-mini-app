import { vnd } from '../commerce/money';
import { fillTemplate } from '../copy-template';
import type { SubscriptionDTO, SubscriptionPatch } from '../api/subscriptions';
import { dayKeyText, rescheduleOptions, rescheduleRange, subscriptionCycleView } from '../subscription-self-serve';
import type { RefillLandingDTO } from './refill-landing';

/**
 * Chữ của thẻ "Kỳ Refill tới" trên trang Tiết kiệm với Refill (web `/tiet-kiem-refill`, Mini `/refill-deals`). Tách khỏi `shop-copy.ts` như
 * `refill-landing.ts`: chỉ trang này nạp. Ngân sách độ dài sau khi điền giá trị xấu nhất ở `REFILL_NEXT_COPY_MAX`.
 */
export const REFILL_NEXT_COPY = {
  heading: 'Kỳ Refill tới',
  preparing: 'Tubu đang chuẩn bị kỳ này',
  item: '{name} · SL {qty}',
  saving: 'Giá định kỳ −{pct}%, rẻ hơn giá lẻ {amount}',
  plain: 'Tiền hàng mỗi kỳ',
  postpone: 'Dời lịch kỳ tới (+{n} ngày)',
  postponeAria: 'Dời lịch kỳ tới {n} ngày, sang {date}',
  postponeDone: 'Đã dời kỳ tới sang {date}',
  postponeLimit: 'Chỉ dời được tới {date}',
  manage: 'Quản lý gói định kỳ',
  manageMany: 'Xem cả {n} gói Refill định kỳ',
} as const;

export type RefillNextCopyKey = keyof typeof REFILL_NEXT_COPY;

/** Số ký tự tối đa sau khi điền giá trị xấu nhất; null = dòng có tên sản phẩm (cắt bằng CSS) hay chữ đọc. Chỉ spec đọc. */
export const REFILL_NEXT_COPY_MAX: Record<RefillNextCopyKey, number | null> = {
  heading: 16,
  preparing: 28,
  item: null,
  saving: 44,
  plain: 20,
  postpone: 26,
  postponeAria: null,
  postponeDone: 40,
  postponeLimit: 38,
  manage: 20,
  manageMany: 32,
};

export function refillNextCopy(key: RefillNextCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(REFILL_NEXT_COPY[key], vars, key);
}

/** Bước dời một chạm trên trang Refill (ngày), tính như "+7 ngày" của sheet Sửa: từ ngày đang hẹn, kỳ đã đến hạn thì từ hôm nay. */
export const REFILL_POSTPONE_DAYS = 7;

const VN_OFFSET_MS = 7 * 3600e3;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

/** Ngày lịch giờ Việt Nam 'yyyy-mm-dd' của một mốc. */
const vnDay = (ms: number): string => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);

/** "2026-12-03" thành "Thứ Năm, 03/12/2026". */
export function refillDayText(day: string): string {
  return `${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}, ${dayKeyText(day)}`;
}

type PreviewSub = Pick<
  SubscriptionDTO,
  'id' | 'status' | 'nextRunAt' | 'slug' | 'productName' | 'quantity' | 'unitPrice' | 'effectiveDiscountPct' | 'cycleSubtotal' | 'cycleDiscount' | 'cycleGoods'
>;

export interface RefillNextDeliveryView {
  subscriptionId: string;
  /** `nextRunAt` thẻ đang hiện: gửi làm `expectedNextRunAt`, cron vừa ra đơn kỳ đó thì máy chủ trả 409 thay vì dời kỳ sau. */
  nextRunAt: string;
  /** "Thứ Năm, 03/12/2026"; kỳ đã đến hạn mà chưa ra đơn (đang thử lại vì hết hàng) thì "Tubu đang chuẩn bị kỳ này". */
  dateText: string;
  itemText: string;
  /** Tiền hàng mỗi kỳ sau giảm định kỳ, cùng số đơn kỳ (máy chủ tính). */
  goods: number;
  /** Giá lẻ cả kỳ (giá gạch) khi có giảm; null khi không giảm. */
  retail: number | null;
  savingText: string;
  postpone: {
    /** Ngày mới 'yyyy-mm-dd' giờ VN. */
    date: string;
    label: string;
    aria: string;
    /** Ngoài khoảng API nhận (quá 90 ngày tới): nút khoá, `limitText` nói vì sao. */
    allowed: boolean;
    limitText: string | null;
  };
  /** Chữ lối vào tab Định kỳ: nói số gói khi khách có nhiều gói Refill đang chạy (thẻ chỉ hiện kỳ gần nhất). */
  manageText: string;
}

/** Slug các gói Refill có trên trang (mọi cặp máy chủ trả, kể cả gói đang hết hàng hay không rẻ hơn chai). Cờ tắt, chưa tải: rỗng. */
function refillPackSlugs(landing: RefillLandingDTO | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!landing?.enabled || !Array.isArray(landing.pairs)) return out;
  for (const pair of landing.pairs) {
    const slug = pair?.refill?.slug;
    if (typeof slug === 'string' && slug !== '') out.add(slug);
  }
  return out;
}

/**
 * Thẻ "Kỳ Refill tới": trong các gói định kỳ ĐANG CHẠY của khách mà sản phẩm là một gói Refill của trang, lấy gói có kỳ tới gần nhất. Gói tạm dừng hay đã
 * huỷ không có kỳ tới; gói không phải Refill thuộc tab Định kỳ. Không có gói nào, chưa tải hay dữ liệu hỏng: null (trang không vẽ thẻ).
 */
export function refillNextDelivery(
  subs: readonly PreviewSub[] | null | undefined,
  landing: RefillLandingDTO | null | undefined,
  now: Date = new Date(),
): RefillNextDeliveryView | null {
  if (!Array.isArray(subs) || subs.length === 0) return null;
  const packs = refillPackSlugs(landing);
  if (packs.size === 0) return null;
  const open = subs.filter((s) => s?.status === 'ACTIVE' && typeof s.slug === 'string' && packs.has(s.slug) && !Number.isNaN(Date.parse(s.nextRunAt)));
  if (open.length === 0) return null;
  const sub = open.reduce((a, b) => (Date.parse(b.nextRunAt) < Date.parse(a.nextRunAt) ? b : a));

  const day = vnDay(Date.parse(sub.nextRunAt));
  const cycle = subscriptionCycleView(sub);
  const discounted = cycle.discount > 0 && cycle.subtotal > cycle.goods;
  const step = rescheduleOptions(sub.nextRunAt, now).find((o) => o.days === REFILL_POSTPONE_DAYS)!;
  return {
    subscriptionId: sub.id,
    nextRunAt: sub.nextRunAt,
    dateText: day > vnDay(now.getTime()) ? refillDayText(day) : refillNextCopy('preparing'),
    itemText: refillNextCopy('item', { name: sub.productName, qty: sub.quantity }),
    goods: cycle.goods,
    retail: discounted ? cycle.subtotal : null,
    savingText: discounted ? refillNextCopy('saving', { pct: cycle.savePct, amount: vnd(cycle.subtotal - cycle.goods) }) : refillNextCopy('plain'),
    postpone: {
      date: step.date,
      label: refillNextCopy('postpone', { n: REFILL_POSTPONE_DAYS }),
      aria: refillNextCopy('postponeAria', { n: REFILL_POSTPONE_DAYS, date: refillDayText(step.date) }),
      allowed: step.allowed,
      limitText: step.allowed ? null : refillNextCopy('postponeLimit', { date: refillDayText(rescheduleRange(now).max) }),
    },
    manageText: open.length > 1 ? refillNextCopy('manageMany', { n: open.length }) : refillNextCopy('manage'),
  };
}

/** PATCH của nút dời một chạm; ngoài khoảng API nhận thì null (nút khoá). */
export function refillPostponePatch(view: Pick<RefillNextDeliveryView, 'nextRunAt' | 'postpone'>): SubscriptionPatch | null {
  return view.postpone.allowed ? { nextRunDate: view.postpone.date, expectedNextRunAt: view.nextRunAt } : null;
}

/** Lời báo sau khi dời: ngày kỳ tới do máy chủ trả; thiếu hay hỏng thì ngày đã gửi. */
export function refillPostponeDoneText(nextRunAt: string | null | undefined, requestedDay: string): string {
  const at = Date.parse(nextRunAt ?? '');
  return refillNextCopy('postponeDone', { date: refillDayText(Number.isNaN(at) ? requestedDay : vnDay(at)) });
}
