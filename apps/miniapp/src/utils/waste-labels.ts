import type {
  RewardCatalogDTO,
  WasteFeeEstimate,
  WasteItemDTO,
  WasteMethod,
  WastePointContactDTO,
  WastePreviewBlockDTO,
  WastePreviewDTO,
  WasteOpeningHours,
  WasteRejectionReason,
  WasteRequestDetailDTO,
  WasteRequestStatus,
  WasteShortfallReason,
} from '@tubutree/shared-types';
import { formatNumber, formatPoints, formatVnd } from './format';

export { PREVIEW_DEBOUNCE_MS } from './use-debounced';

export const PAUSED_TEXT = 'Chương trình đang tạm dừng';

/** Dưới ngưỡng này (km) điểm nhận được gắn "Nhanh nhất" (§4.4). */
export const NEAREST_FAST_KM = 5;
/** 1 điểm = 1đ (thang Điểm Xanh mới). */
export const POINT_VALUE_VND = 1;
/** Trần bộ đếm cho món không có trần nào; spec không đặt, đây là mức của kế hoạch. */
export const UNCAPPED_QTY_MAX = 999;

export const METHOD_LABELS: Record<WasteMethod, string> = {
  DROP_OFF: 'Mang tới điểm nhận',
  MAIL_IN: 'Gửi về kho Tubu HCM',
  PICKUP: 'Thu kèm đơn mua',
};

export const TIMELINE_STEPS: Record<WasteMethod, readonly string[]> = {
  MAIL_IN: ['Đã gửi', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm'],
  DROP_OFF: ['Đã tạo', 'Mang tới điểm', 'Điểm nhận đếm', 'Cộng điểm'],
  PICKUP: ['Đã tạo', 'Gắn vào đơn', 'Chờ kho nhận', 'Cộng điểm'],
};

export const REJECTION_LABELS: Record<WasteRejectionReason, string> = {
  WET: 'Ướt',
  DIRTY: 'Bẩn',
  FOREIGN_OBJECT: 'Lẫn vật lạ',
  WRONG_TYPE: 'Sai loại',
  DAMAGED: 'Hỏng',
  NOT_ACCEPTED: 'Không nhận',
  OVERSIZE: 'Quá khổ',
  HAZARDOUS: 'có vật không nhận',
  UNPAID_POSTAGE: 'Kiện còn cước phải trả khi nhận',
  OTHER: 'Khác',
};

export const SHORTFALL_LABELS: Record<WasteShortfallReason, string> = {
  WET: 'Ướt',
  DIRTY: 'Bẩn',
  FOREIGN_OBJECT: 'Lẫn vật lạ',
  WRONG_TYPE: 'Sai loại',
  DAMAGED: 'Hỏng',
  NOT_ACCEPTED: 'Không nhận',
  OTHER: 'Khác',
};

/** UNPAID_POSTAGE là lý do ở cửa kho, không có trong bộ chọn tại điểm nhận. */
export const DESK_REJECTION_OPTIONS: { value: WasteRejectionReason; label: string }[] = [
  { value: 'WET', label: 'Ướt' },
  { value: 'DIRTY', label: 'Bẩn' },
  { value: 'FOREIGN_OBJECT', label: 'Lẫn vật lạ' },
  { value: 'WRONG_TYPE', label: 'Sai loại' },
  { value: 'DAMAGED', label: 'Hỏng' },
  { value: 'NOT_ACCEPTED', label: 'Không nhận' },
  { value: 'OVERSIZE', label: 'Quá khổ' },
  { value: 'HAZARDOUS', label: 'Có pin hoặc vật nguy hại' },
  { value: 'OTHER', label: 'Khác' },
];

export type WasteTimeline = { steps: readonly string[]; current: number };
export type BlockContext = { items: readonly WasteItemDTO[]; maxOpenRequests: number; itemCaps: WastePreviewDTO['itemCaps'] };

export function ruleText(item: WasteItemDTO): string {
  return `${item.unitsPerPoint} ${item.unitLabel} = ${formatPoints(item.pointsPerGroup)}`;
}

export function capSentence(item: WasteItemDTO): string | null {
  const parts: string[] = [];
  if (item.monthlyCapQty != null) parts.push(`Tối đa ${formatNumber(item.monthlyCapQty)} ${item.unitLabel} mỗi tháng`);
  if (item.dailyCapQty != null) parts.push(`Mang tới điểm nhận: tối đa ${formatNumber(item.dailyCapQty)} ${item.unitLabel} mỗi ngày`);
  return parts.length ? parts.join('. ') : null;
}

export function groupProgressText(qty: number, item: WasteItemDTO): string | null {
  if (qty <= 0 || item.unitsPerPoint <= 1) return null;
  return `thêm ${item.unitsPerPoint - (qty % item.unitsPerPoint)} ${item.unitLabel} nữa được +${formatPoints(item.pointsPerGroup)}`;
}

const CLOSED_STATUSES: readonly WasteRequestStatus[] = ['REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED'];

export function timelineFor(r: { method: WasteMethod; status: WasteRequestStatus; orderCode: string | null }): WasteTimeline | null {
  if (CLOSED_STATUSES.includes(r.status)) return null;
  const steps = TIMELINE_STEPS[r.method];
  if (r.status === 'COMPLETED') return { steps, current: 4 };
  if (r.method === 'MAIL_IN') {
    return { steps, current: r.status === 'IN_TRANSIT' ? 1 : r.status === 'RECEIVED' ? 2 : 0 };
  }
  if (r.method === 'DROP_OFF') return { steps, current: r.status === 'OPEN' ? 1 : 2 };
  return { steps, current: r.status === 'OPEN' && !r.orderCode ? 1 : 2 };
}

const EXPIRED_LABELS: Partial<Record<string, string>> = {
  HOLD_EXPIRED: 'Hết hạn giữ chỗ',
  PICKUP_NO_SHOW: 'Kho chưa nhận được rác thu kèm đơn',
  PICKUP_NOT_DISPATCHED: 'Tubu chưa sắp xếp được người đến lấy rác thu kèm đơn, xin lỗi bạn',
  LOST: 'Đã đóng vì thất lạc',
  LOST_AT_WAREHOUSE: 'Kiện bị thất lạc tại kho Tubu, xin lỗi bạn',
};

const CANCELLED_REASONS: Partial<Record<string, string>> = {
  ORDER_CANCELLED: 'đơn mua bị huỷ',
  SHIP_LOCKED: 'đường kho tạm dừng',
};

export function closedLabel(
  r: Pick<WasteRequestDetailDTO, 'status' | 'closeReason' | 'rejectionReason' | 'rejectionNote' | 'reversedPoints' | 'reversalReason'>,
): { label: string; reason: string | null } | null {
  switch (r.status) {
    case 'REJECTED': {
      const why = r.rejectionReason ? REJECTION_LABELS[r.rejectionReason] : null;
      const note = r.rejectionNote?.trim();
      const reason = why && note && r.rejectionReason !== 'HAZARDOUS' ? `${why}: ${note}` : why;
      return { label: 'Bị từ chối', reason };
    }
    case 'EXPIRED':
      return { label: (r.closeReason && EXPIRED_LABELS[r.closeReason]) || 'Đã hết hạn', reason: null };
    case 'CANCELLED':
      return { label: 'Đã huỷ', reason: r.closeReason === null ? 'bạn huỷ' : (CANCELLED_REASONS[r.closeReason] ?? null) };
    case 'REVERSED':
      return { label: `Đã thu hồi ${formatPoints(r.reversedPoints ?? 0)}`, reason: r.reversalReason };
    default:
      return null;
  }
}

export function blockMessage(block: WastePreviewBlockDTO, ctx: BlockContext): string {
  const item = ctx.items.find((i) => i.id === block.itemId);
  const caps = ctx.itemCaps.find((c) => c.itemId === block.itemId);
  const name = item?.name ?? '';
  const unit = item?.unitLabel ?? '';
  switch (block.code) {
    case 'MAX_OPEN':
      return `Bạn đang có ${ctx.maxOpenRequests} yêu cầu chưa xong`;
    case 'PICKUP_PENDING':
      return `Bạn đã có yêu cầu thu kèm ${block.pickupRequestCode ?? ''}, hãy gắn vào đơn kế tiếp`;
    case 'BELOW_MIN':
      return `cần thêm ${formatPoints(block.missingPoints ?? 0)}`;
    case 'MONTH_CAP_FOR_MIN':
      return 'tháng này bạn không còn đủ trần cho một gói gửi kho';
    case 'NEED_PROVINCE':
      return 'Chọn tỉnh để ước tính phí ship';
    case 'ITEM_DAY_CAP':
      return `Mang tới điểm nhận hôm nay chỉ còn ${formatNumber(caps?.dayRemainingQty ?? 0)} ${unit} ${name}`;
    case 'ITEM_MONTH_CAP':
      return `Tháng này ${name} chỉ còn ${formatNumber(caps?.monthRemainingQty ?? 0)} ${unit}`;
    case 'POINTS_MONTH_CAP':
      return `Tháng này bạn chỉ còn ${formatPoints(block.pointsRemaining ?? 0)} trong trần tháng`;
    case 'POINT_QUOTA_FULL':
      return 'Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác';
    case 'POINT_UNAVAILABLE':
      return 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác';
    case 'ITEM_NOT_ACTIVE':
      return `${name}: món này hiện chưa nhận, hãy bỏ khỏi danh sách`;
    case 'POINT_MISSING_ITEMS':
      return `Điểm này không nhận: ${name}`;
    case 'LANE_DISABLED':
      return 'Cách giao này đang tạm dừng';
    case 'SHIP_LOCKED':
      return 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.';
  }
}

export function feeExceedsPoints(preview: Pick<WastePreviewDTO, 'pointsValueVnd' | 'feeEstimate'>): boolean {
  return preview.feeEstimate != null && preview.pointsValueVnd < preview.feeEstimate.high;
}

export function feeRangeText(fee: WasteFeeEstimate): string {
  return `${formatVnd(fee.low)} – ${formatVnd(fee.high)}`;
}

export function nextRewardProgress(
  catalog: RewardCatalogDTO | undefined,
  extraPoints = 0,
): { rewardName: string; cost: number; have: number; missing: number } | null {
  if (!catalog) return null;
  const have = catalog.redeemablePoints + extraPoints;
  const next = catalog.rewards
    .filter((r) => !r.soldOut && r.kind !== 'TREE' && r.pointsCost > have)
    .sort((a, b) => a.pointsCost - b.pointsCost || a.sortOrder - b.sortOrder)[0];
  if (!next) return null;
  return {
    rewardName: next.kind === 'VOUCHER' ? `mã giảm giá ${next.name}` : next.name,
    cost: next.pointsCost,
    have,
    missing: next.pointsCost - have,
  };
}

export function equivalentUnits(missingPoints: number, item: WasteItemDTO): number {
  return Math.ceil(missingPoints / item.pointsPerGroup) * item.unitsPerPoint;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');
// Giờ VN tính từ mốc thời gian, không đọc múi giờ máy (spec 16.1, 17.3).
const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3_600_000);

export function dayMonth(iso: string): string {
  const v = vnTime(new Date(iso));
  return `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}`;
}

export function isFastest(distanceKm: number | null): boolean {
  return distanceKm != null && distanceKm < NEAREST_FAST_KM;
}

export function isOpenNow(hours: WasteOpeningHours, now: Date): boolean {
  const v = vnTime(now);
  const t = `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
  return (hours[WEEKDAYS[v.getUTCDay()]!] ?? []).some((w) => w.open <= t && t < w.close);
}

type PointAddress = Pick<WastePointContactDTO, 'addressLine' | 'communeName' | 'provinceName'>;

export function pointAddress(p: PointAddress): string {
  return `${p.addressLine}, ${p.communeName}, ${p.provinceName}`;
}

export function mapsUrl(p: PointAddress): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pointAddress(p))}`;
}
