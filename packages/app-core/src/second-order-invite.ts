import type { ReturnPackagingSuggestion, WasteMeDTO, WasteMeItemDTO, WasteMethod } from '@tubutree/shared-types';
import { formatVnNumber } from './number-format';
import { homePickupEnabled } from './recycle-home-pickup-state';
import { packagingItemsText } from './return-packaging';
import { fillCopy } from './shop-copy';
import { itemQtyMax } from './waste-copy';

/**
 * Thẻ mời ở chi tiết đơn đã giao: giữ bao bì gửi kèm đơn mua kế tiếp (đường PICKUP của Đổi rác) để miễn ship và tích Điểm Xanh.
 * Quyết định hiện/ẩn nằm ở đây để Mini App và web cùng một luật; hai nền tảng chỉ vẽ và gắn điều hướng.
 */

/** Hết 14 ngày kể từ lúc giao thì thôi mời: đúng cửa sổ đo "khách đặt đơn thứ hai" của bảng theo dõi launch. */
export const SECOND_ORDER_INVITE_DAYS = 14;

/** Cách giao mà thẻ mời và `?method=` ở màn tạo yêu cầu cùng dùng. */
export const SECOND_ORDER_METHOD = 'PICKUP' as const satisfies WasteMethod;

/** Đơn của đại lý hoặc CTV lên hộ khách: người mở đơn không phải người dùng bao bì, nên không mời. */
const NOT_FOR_SECOND_ORDER_SOURCES = ['ctv_assisted', 'dealer'] as const;

export const secondOrderInviteCopy = {
  /** Tối đa 28 ký tự (hiện 26). */
  title: 'Giữ bao bì gửi kèm đơn sau',
  /** Tối đa 36 ký tự để nằm một dòng ở 375px. */
  subtitle: 'Miễn ship 100% và tích Điểm Xanh',
  aria: 'Gửi bao bì kèm đơn mua kế tiếp',
} as const;

export interface SecondOrderInviteOrder {
  /** Mã đơn: thẻ hỏi bao bì của đúng đơn này và gửi kèm `?from=` sang màn tạo yêu cầu. */
  code?: string | null;
  status: string;
  type?: string | null;
  source?: string | null;
  hasRecyclingPickup?: boolean;
  deliveredAt?: string | null;
  /** Mốc giao dự phòng khi `deliveredAt` trống (đơn cũ, hoặc đơn lật trạng thái không qua luồng giao). */
  statusTimes?: Partial<Record<string, string>> | null;
  updatedAt?: string | null;
}

export type SecondOrderInviteMe = Pick<WasteMeDTO, 'programmeEnabled' | 'eligibility' | 'blocked' | 'shipLockedAt' | 'laneFlags' | 'thresholds' | 'openRequests'>;

export type SecondOrderInviteHidden =
  | 'ORDER_NOT_DELIVERED'
  | 'ORDER_TOO_OLD'
  | 'ORDER_NOT_RETAIL'
  | 'ALREADY_ATTACHED'
  | 'WASTE_UNAVAILABLE'
  | 'PICKUP_ALREADY_OPEN'
  | 'AT_OPEN_CAP'
  | 'LOADING';

export type SecondOrderInviteDecision = { show: true } | { show: false; reason: SecondOrderInviteHidden };

/** Điều kiện chỉ cần đơn: dùng để khỏi gọi `/waste/me` cho đơn chắc chắn không hiện thẻ. */
export function secondOrderOrderGate(order: SecondOrderInviteOrder, now: Date = new Date()): SecondOrderInviteHidden | null {
  if (order.status !== 'DELIVERED') return 'ORDER_NOT_DELIVERED';
  if (order.type === 'DEALER' || (NOT_FOR_SECOND_ORDER_SOURCES as readonly string[]).includes(order.source ?? '')) return 'ORDER_NOT_RETAIL';
  if (order.hasRecyclingPickup) return 'ALREADY_ATTACHED';
  const delivered = Date.parse(order.deliveredAt ?? order.statusTimes?.DELIVERED ?? order.updatedAt ?? '');
  // Không biết đơn giao lúc nào thì không đếm được 14 ngày: ẩn thẻ còn hơn mời mãi.
  if (!Number.isFinite(delivered) || now.getTime() - delivered > SECOND_ORDER_INVITE_DAYS * 86_400_000) return 'ORDER_TOO_OLD';
  return null;
}

/**
 * Hiện thẻ khi đơn đã giao trong 14 ngày, chưa kèm rác, và khách thật sự tạo được yêu cầu PICKUP: chương trình và cổng đường kèm đơn bật,
 * tài khoản đủ điều kiện, không bị khoá vận chuyển, chưa có yêu cầu kèm đơn nào đang chờ và còn dưới trần yêu cầu mở (W179 `WASTE_MAX_OPEN`).
 * Khách chạm trần thì ẩn hẳn thẻ: một lối vào dẫn tới màn đã chặn là ngõ cụt.
 */
export function secondOrderInviteDecision(args: {
  order: SecondOrderInviteOrder;
  cfgPickup: boolean;
  me: SecondOrderInviteMe | undefined;
  now?: Date;
}): SecondOrderInviteDecision {
  const gate = secondOrderOrderGate(args.order, args.now);
  if (gate) return { show: false, reason: gate };
  const { me } = args;
  if (!me) return { show: false, reason: 'LOADING' };
  const shipLocked = !!me.shipLockedAt;
  const usable = me.programmeEnabled && me.eligibility === 'OK' && !me.blocked && homePickupEnabled({ cfgPickup: args.cfgPickup, lanePickup: me.laneFlags.pickup, shipLocked });
  if (!usable) return { show: false, reason: 'WASTE_UNAVAILABLE' };
  if (me.openRequests.some((r) => r.method === SECOND_ORDER_METHOD)) return { show: false, reason: 'PICKUP_ALREADY_OPEN' };
  if (me.openRequests.length >= me.thresholds.maxOpenRequests) return { show: false, reason: 'AT_OPEN_CAP' };
  return { show: true };
}

/** `?method=PICKUP` ở màn tạo yêu cầu chọn sẵn đường kèm đơn; mọi giá trị khác (kể cả cách giao hợp lệ khác) bị bỏ để link lạ không đặt trước cách giao. */
export function preferredWasteMethodFromSearch(search: string): typeof SECOND_ORDER_METHOD | null {
  try {
    return new URLSearchParams(search).get('method') === SECOND_ORDER_METHOD ? SECOND_ORDER_METHOD : null;
  } catch {
    return null;
  }
}

export interface SecondOrderInviteCopy {
  title: string;
  subtitle: string;
  aria: string;
}

/**
 * Chữ của thẻ khi đã biết bao bì của đơn (cờ `checkout.return_packaging_nudge_enabled`): giữ tiêu đề cũ, dòng dưới nêu đúng món và điểm dự kiến.
 * Chỉ hứa miễn ship khi riêng bao bì đơn này đã đủ ngưỡng điểm thu kèm; chưa đủ thì nói rõ ngưỡng. Không có bao bì thì giữ chữ cũ.
 */
export function secondOrderInviteCopyFor(packaging: ReturnPackagingSuggestion | null | undefined): SecondOrderInviteCopy {
  if (!packaging || packaging.lines.length === 0) return secondOrderInviteCopy;
  const items = packagingItemsText(packaging.lines);
  const points = formatVnNumber(packaging.estimatedPoints);
  const subtitle =
    packaging.estimatedPoints >= packaging.minPoints
      ? fillCopy('order.packagingInvite.enough', { items: upperFirst(items), points })
      : fillCopy('order.packagingInvite.more', { items: upperFirst(items), points, min: formatVnNumber(packaging.minPoints) });
  return { title: secondOrderInviteCopy.title, subtitle, aria: `${secondOrderInviteCopy.title}. ${subtitle}` };
}

const upperFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : s);

/** Mã đơn hợp lệ trong `?from=`: chữ, số, gạch; tối đa 32 ký tự như API nhận. */
const ORDER_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Đường tới màn tạo yêu cầu với cách giao kèm đơn chọn sẵn; có bao bì thì kèm `from=<mã đơn>` để màn đó điền sẵn số lượng. */
export function secondOrderInvitePath(base: string, orderCode: string | null | undefined, withPackaging: boolean): string {
  const from = withPackaging && orderCode && ORDER_CODE_RE.test(orderCode) ? `&from=${encodeURIComponent(orderCode)}` : '';
  return `${base}?method=${SECOND_ORDER_METHOD}${from}`;
}

/** `?from=<mã đơn>` của màn tạo yêu cầu; giá trị lạ (sai dạng, quá dài) thì bỏ. */
export function returnPackagingOrderFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('from');
    return v && ORDER_CODE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Món màn tạo yêu cầu đang cho chọn, kèm phần trần tháng/ngày còn lại (`WasteMeItemDTO`). */
export type PackagingWizardItem = Pick<WasteMeItemDTO, 'id' | 'monthRemainingQty' | 'dayRemainingQty' | 'hazardous'>;

/** Số lượng điền sẵn cho màn tạo yêu cầu: chỉ món màn đó đang cho chọn, số nguyên từ 1, không quá trần còn lại của món và `max` của ô số. */
export function packagingWizardLines(
  packaging: ReturnPackagingSuggestion | null | undefined,
  items: readonly PackagingWizardItem[],
  max: number,
): Record<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Record<string, number> = {};
  for (const l of packaging?.lines ?? []) {
    const item = byId.get(l.itemId);
    if (!item) continue;
    const q = Math.min(Math.trunc(l.qty), max, itemQtyMax(item, 0, max));
    if (q >= 1) out[l.itemId] = q;
  }
  return out;
}
