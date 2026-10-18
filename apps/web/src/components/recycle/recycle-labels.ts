import type {
  RewardCatalogDTO,
  WasteItemDTO,
  WasteMethod,
  WasteRejectionReason,
  WasteRequestDetailDTO,
  WasteRequestStatus,
} from '@tubutree/shared-types';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';

export const PAUSED_TEXT = 'Chương trình đang tạm dừng';
export const BLOCKED_TEXT = 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree';
export const LOGIN_TEXT = 'Đăng nhập để đổi rác lấy quà';

/** 1 điểm = 1đ (thang Điểm Xanh mới). */
export const POINT_VALUE_VND = 1;

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

/** Một chữ số thập phân; dưới 50 g làm tròn về 0 kg thì không có dòng nào (null). */
export function impactLine(grams: number | null | undefined): string | null {
  if (grams == null) return null;
  const kg = Math.round(grams / 100) / 10;
  return kg > 0 ? `Bạn đã gửi khoảng ${formatCount(kg)} kg bao bì cho Tubu` : null;
}

export function ruleText(item: WasteItemDTO): string {
  return `${item.unitsPerPoint} ${item.unitLabel} = ${formatPoints(item.pointsPerGroup)}`;
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
