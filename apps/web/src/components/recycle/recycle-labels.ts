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
  WasteRequestSummaryDTO,
  WasteShortfallReason,
} from '@tubutree/shared-types';
import { pointAddress } from '@tubutree/app-core/reward-rules';
import { formatCount } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';

export const PAUSED_TEXT = 'Chương trình đang tạm dừng';
export const BLOCKED_TEXT = 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree';
export const LOGIN_TEXT = 'Đăng nhập để đổi rác lấy quà';

/** 1 điểm = 1đ (thang Điểm Xanh mới). */
export const POINT_VALUE_VND = 1;
/** Trần bộ đếm cho món không có trần nào; spec không đặt, đây là mức của kế hoạch (cùng Mini App). */
export const UNCAPPED_QTY_MAX = 999;
/** Chờ khách ngừng bấm +/- rồi mới xin ước tính, để nhiều lần bấm nhanh chỉ tốn một lời gọi. */
export const PREVIEW_DEBOUNCE_MS = 300;

export const formatPoints = (n: number | null | undefined) => `${formatCount(Number.isFinite(n) ? (n as number) : 0)} điểm`;
export { formatVnd };

export const METHOD_LABELS: Record<WasteMethod, string> = {
  DROP_OFF: 'Mang tới điểm nhận',
  MAIL_IN: 'Gửi về kho Tubu HCM',
  PICKUP: 'Thu kèm đơn mua',
};

export const METHOD_FLAG = { DROP_OFF: 'dropoff', MAIL_IN: 'mailin', PICKUP: 'pickup' } as const;
export const METHOD_ORDER: readonly WasteMethod[] = ['DROP_OFF', 'MAIL_IN', 'PICKUP'];
export const METHOD_LINE: Record<WasteMethod, string> = {
  DROP_OFF: 'Miễn phí, nhận điểm khi người ở điểm xác nhận',
  MAIL_IN: 'Tự gửi qua hãng bất kỳ và tự trả phí ship',
  PICKUP: 'Miễn phí, bưu tá lấy khi giao đơn Tubu kế tiếp',
};

export const TIMELINE_STEPS: Record<WasteMethod, readonly string[]> = {
  MAIL_IN: ['Gửi kiện', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm'],
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

/** "25/10" theo giờ Việt Nam, lấy từ dd/MM/yyyy của `formatDate` để cả web chung một cách đổi múi giờ. */
export const dayMonth = (iso: string): string => formatDate(iso).slice(0, 5);

/** Một chữ số thập phân; dưới 50 g làm tròn về 0 kg thì không có dòng nào (null). */
export function impactLine(grams: number | null | undefined): string | null {
  if (grams == null) return null;
  const kg = Math.round(grams / 100) / 10;
  return kg > 0 ? `Bạn đã gửi khoảng ${formatCount(kg)} kg bao bì cho Tubu` : null;
}

export function ruleText(item: WasteItemDTO): string {
  return `${item.unitsPerPoint} ${item.unitLabel} = ${formatPoints(item.pointsPerGroup)}`;
}

export interface RequestPauseFacts {
  programmeEnabled?: boolean;
  blocked?: boolean;
  shipLockedAt?: string | null;
  cfg: { enabled: boolean; pickup: boolean; isLoaded: boolean };
}

/** Yêu cầu đang mở mà bước khách phải làm tiếp đang tạm dừng (chương trình tắt, khách bị khoá, kênh Thu kèm đơn tắt). */
export function isRequestPaused(r: Pick<WasteRequestSummaryDTO, 'method' | 'status' | 'orderCode'>, f: RequestPauseFacts): boolean {
  if (r.status !== 'OPEN') return false;
  if (r.method === 'DROP_OFF') return (f.cfg.isLoaded && !f.cfg.enabled) || f.programmeEnabled === false || !!f.blocked;
  if (r.method === 'PICKUP') return !r.orderCode && (f.programmeEnabled === false || !!f.blocked || !!f.shipLockedAt || !f.cfg.pickup);
  return false;
}

/** Dòng trạng thái của một yêu cầu cho khách (danh sách, thẻ trang chủ, trang chi tiết); tên bước theo §4.6. */
export function requestStatusText(
  r: Pick<WasteRequestSummaryDTO, 'method' | 'status' | 'closeReason' | 'orderCode' | 'pointsAwarded'>,
  opts: { blocked?: boolean; paused?: boolean } = {},
): string {
  switch (r.status) {
    case 'OPEN':
      if (opts.paused && (r.method === 'DROP_OFF' || (r.method === 'PICKUP' && !r.orderCode))) return 'Đang tạm dừng';
      if (r.method === 'DROP_OFF') return 'Chờ bạn mang tới';
      if (r.method === 'MAIL_IN') return 'Chờ bạn gửi kiện';
      return r.orderCode ? 'Chờ kho nhận' : 'Chờ gắn vào đơn';
    case 'IN_TRANSIT':
      return 'Đang vận chuyển';
    case 'RECEIVED':
      return opts.blocked ? 'Đang chờ Tubu xem lại' : 'Kho đã nhận, đang đếm';
    case 'COMPLETED':
      return (r.pointsAwarded ?? 0) > 0 ? `Đã cộng ${formatPoints(r.pointsAwarded ?? 0)}` : 'Chưa đủ để cộng điểm';
    case 'REJECTED':
      return 'Bị từ chối';
    case 'CANCELLED':
      return 'Đã huỷ';
    case 'REVERSED':
      return 'Đã thu hồi điểm';
    default:
      return closedLabel({ ...r, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null })!.label;
  }
}

/** "Thùng carton cũ: 3 thùng": tên món đã mở đầu bằng danh từ đơn vị nên không đặt đơn vị trước tên. */
export function formatLineQty(itemName: string, qty: number, unitLabel: string): string {
  return `${itemName}: ${qty} ${unitLabel}`;
}

export type WasteTimeline = { steps: readonly string[]; current: number };

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
  ORDER_CANCELLED: 'Đơn mua đã bị huỷ',
  SHIP_LOCKED: 'Đường kho đang tạm dừng',
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
      return { label: 'Đã huỷ', reason: r.closeReason === null ? 'Bạn đã huỷ yêu cầu này' : (CANCELLED_REASONS[r.closeReason] ?? null) };
    case 'REVERSED':
      return { label: `Đã thu hồi ${formatPoints(r.reversedPoints ?? 0)}`, reason: r.reversalReason };
    default:
      return null;
  }
}

function voucherPhrase(name: string): string {
  return /^giảm/i.test(name) ? `mã ${name.charAt(0).toLowerCase()}${name.slice(1)}` : `mã giảm giá ${name}`;
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
    rewardName: next.kind === 'VOUCHER' ? voucherPhrase(next.name) : next.name,
    cost: next.pointsCost,
    have,
    missing: next.pointsCost - have,
  };
}

export function equivalentUnits(missingPoints: number, item: WasteItemDTO): number {
  return Math.ceil(missingPoints / item.pointsPerGroup) * item.unitsPerPoint;
}

export function capSentence(item: WasteItemDTO): string | null {
  const parts: string[] = [];
  if (item.monthlyCapQty != null) parts.push(`Tối đa ${formatCount(item.monthlyCapQty)} ${item.unitLabel} mỗi tháng`);
  if (item.dailyCapQty != null) parts.push(`Mang tới điểm nhận: tối đa ${formatCount(item.dailyCapQty)} ${item.unitLabel} mỗi ngày`);
  return parts.length ? parts.join('. ') : null;
}

/** Trần tháng còn lại, chỉ khi đã bớt so với trần (hoặc hết hẳn) để khách hiểu vì sao bộ đếm bị chặn. */
export function monthRemainingText(item: Pick<WasteItemDTO, 'monthlyCapQty' | 'unitLabel'> & { monthRemainingQty?: number | null }): string | null {
  const left = item.monthRemainingQty;
  if (left == null || item.monthlyCapQty == null) return null;
  if (left <= 0) return 'Tháng này bạn đã đủ trần cho món này';
  return left < item.monthlyCapQty ? `Tháng này còn ${formatCount(left)} ${item.unitLabel}` : null;
}

export function groupProgressText(qty: number, item: WasteItemDTO): string | null {
  if (qty <= 0 || item.unitsPerPoint <= 1) return null;
  return `thêm ${item.unitsPerPoint - (qty % item.unitsPerPoint)} ${item.unitLabel} nữa được +${formatPoints(item.pointsPerGroup)}`;
}

export type BlockContext = {
  items: readonly WasteItemDTO[];
  maxOpenRequests: number;
  itemCaps: WastePreviewDTO['itemCaps'];
  method?: WasteMethod;
};

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
      return `Cần thêm ${formatPoints(block.missingPoints ?? 0)}`;
    case 'MONTH_CAP_FOR_MIN':
      return `Tháng này bạn không còn đủ trần cho một gói ${ctx.method === 'PICKUP' ? 'thu kèm đơn' : 'gửi kho'}`;
    case 'NEED_PROVINCE':
      return 'Chọn tỉnh để ước tính phí ship';
    case 'ITEM_DAY_CAP':
      return `${name}: mang tới điểm nhận hôm nay chỉ còn ${formatCount(caps?.dayRemainingQty ?? 0)} ${unit}`;
    case 'ITEM_MONTH_CAP':
      return `Tháng này ${name} chỉ còn ${formatCount(caps?.monthRemainingQty ?? 0)} ${unit}`;
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

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');
// Giờ VN tính từ mốc thời gian, không đọc múi giờ máy (spec 16.1, 17.3).
const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3_600_000);

export function isOpenNow(hours: WasteOpeningHours, now: Date): boolean {
  const v = vnTime(now);
  const t = `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
  return (hours[WEEKDAYS[v.getUTCDay()]!] ?? []).some((w) => w.open <= t && t < w.close);
}

type PointAddress = Pick<WastePointContactDTO, 'addressLine' | 'communeName' | 'provinceName'>;

export { pointAddress };

export function mapsUrl(p: PointAddress): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pointAddress(p))}`;
}
