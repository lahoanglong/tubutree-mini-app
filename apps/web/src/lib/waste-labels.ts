import type {
  WasteActorRole,
  WasteCloseReason,
  WasteGiftKind,
  WasteGiftRedemptionStatus,
  WasteGiftStatus,
  WasteItemStatus,
  WasteMatchBasis,
  WasteOpeningHours,
  WasteMethod,
  WastePointKind,
  WastePointStatus,
  WasteRejectionReason,
  WasteRequestStatus,
  WasteShortfallReason,
  WasteUnmatchedReason,
  WasteWeekday,
} from '@tubutree/shared-types';
import { formatCount } from '@/lib/checkout-points';

export type WasteSection = 'items' | 'points' | 'requests' | 'gifts' | 'config';

export const WASTE_METHOD_LABELS: Record<WasteMethod, string> = {
  DROP_OFF: 'Mang tới điểm nhận',
  MAIL_IN: 'Gửi về kho',
  PICKUP: 'Thu kèm đơn',
};

export const WASTE_REQUEST_STATUS_LABELS: Record<WasteRequestStatus, string> = {
  OPEN: 'Đang mở',
  IN_TRANSIT: 'Đang gửi',
  RECEIVED: 'Kho đã nhận',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
  REVERSED: 'Đã thu hồi điểm',
};

export const WASTE_CLOSE_REASON_LABELS: Record<WasteCloseReason, string> = {
  HOLD_EXPIRED: 'Quá hạn giữ chỗ',
  PICKUP_NO_SHOW: 'Không có hàng khi thu',
  PICKUP_NOT_DISPATCHED: 'Chưa điều người thu',
  LOST: 'Thất lạc',
  LOST_AT_WAREHOUSE: 'Thất lạc tại kho',
  SHIP_LOCKED: 'Đang bị khoá gửi kho',
  ORDER_CANCELLED: 'Đơn kèm bị huỷ',
};

export const WASTE_SHORTFALL_REASON_LABELS: Record<WasteShortfallReason, string> = {
  WET: 'Ướt',
  DIRTY: 'Bẩn',
  FOREIGN_OBJECT: 'Lẫn vật lạ',
  WRONG_TYPE: 'Sai loại',
  DAMAGED: 'Hỏng',
  NOT_ACCEPTED: 'Không nhận',
  OTHER: 'Khác',
};

export const WASTE_REJECTION_REASON_LABELS: Record<WasteRejectionReason, string> = {
  ...WASTE_SHORTFALL_REASON_LABELS,
  OVERSIZE: 'Quá khổ',
  HAZARDOUS: 'Hàng nguy hại (pin, hoá chất)',
  UNPAID_POSTAGE: 'Chưa trả đủ cước',
};

export const WASTE_ITEM_STATUS_LABELS: Record<WasteItemStatus, string> = {
  ACTIVE: 'Đang nhận',
  COMING_SOON: 'Sắp nhận',
  HIDDEN: 'Ẩn',
};

export const WASTE_POINT_STATUS_LABELS: Record<WastePointStatus, string> = {
  ACTIVE: 'Đang nhận',
  PAUSED: 'Tạm dừng',
  PENDING: 'Chờ duyệt',
};

export const WASTE_POINT_KIND_LABELS: Record<WastePointKind, string> = {
  WAREHOUSE: 'Kho Tubu',
  PARTNER: 'Đại lý',
};

export const WASTE_GIFT_KIND_LABELS: Record<WasteGiftKind, string> = {
  VOUCHER: 'Mã giảm giá',
  TREE: 'Góp quỹ trồng cây',
  SEED_PACK: 'Gói hạt giống',
  GIFT: 'Quà tặng',
};

export const WASTE_GIFT_STATUS_LABELS: Record<WasteGiftStatus, string> = {
  ACTIVE: 'Đang hiện',
  HIDDEN: 'Ẩn',
};

export const WASTE_GIFT_REDEMPTION_STATUS_LABELS: Record<WasteGiftRedemptionStatus, string> = {
  READY: 'Chờ nhận',
  FULFILLED: 'Đã trao',
  CANCELLED: 'Đã huỷ',
};

export const WASTE_UNMATCHED_REASON_LABELS: Record<WasteUnmatchedReason, string> = {
  NO_MATCH: 'Không khớp yêu cầu nào',
  TRACKING_MULTI: 'Mã vận đơn khớp nhiều yêu cầu',
  TR_TRACKING_CONFLICT: 'Mã TR- và mã vận đơn trỏ hai yêu cầu',
  EXPIRED_REQUEST: 'Yêu cầu đã hết hạn',
  NOT_RECEIVABLE: 'Yêu cầu không còn nhận được',
  MANUAL_ENTRY: 'Nhân viên ghi tay',
};

export const WASTE_SECTION_LABELS: Record<WasteSection, string> = {
  items: 'Hàng nhận',
  points: 'Điểm nhận',
  requests: 'Yêu cầu',
  gifts: 'Quà',
  config: 'Cấu hình chung',
};

export const WASTE_ADMIN_SECTIONS: readonly WasteSection[] = ['items', 'points', 'requests', 'gifts', 'config'];
export const WASTE_STAFF_SECTIONS: readonly WasteSection[] = ['requests', 'gifts'];

export const WASTE_ACTOR_ROLE_LABELS: Record<WasteActorRole, string> = {
  CUSTOMER: 'Khách',
  POINT_STAFF: 'Người ở điểm nhận',
  STAFF: 'Nhân viên kho',
  ADMIN: 'Quản trị viên',
  SYSTEM: 'Hệ thống',
};

export const WASTE_MATCH_BASIS_LABELS: Record<WasteMatchBasis, string> = {
  TR_CODE: 'Khớp theo mã TR-',
  TRACKING_PHONE: 'Khớp theo mã vận đơn và số điện thoại',
  MANUAL: 'Khớp tay',
  ORDER: 'Khớp theo đơn kèm',
};

/** Mirrors the API's WASTE_EVENT_KINDS (the DTO types `kind` as string); an unlisted kind reads as OTHER_EVENT_LABEL. */
const WASTE_EVENT_KIND_KEYS = [
  'REQUEST_CREATED', 'REQUEST_EDITED', 'TRACKING_SET', 'TRACKING_EDITED', 'REQUEST_CANCELLED', 'REQUEST_ATTACHED', 'PICKUP_STARTED',
  'PICKUP_ORDER_CANCELLED', 'REQUEST_EXPIRED', 'HOOK_ANOMALY', 'SHIP_LOCKED', 'REQUEST_CANCELLED_SHIP_LOCK', 'PARCEL_RECEIVED', 'PARCEL_UNMATCHED',
  'UNMATCHED_RECORDED', 'UNMATCHED_RESOLVED', 'UNMATCHED_CLOSED', 'REQUEST_CONFIRMED', 'REQUEST_REJECTED', 'LOOKUP_MISS', 'POINTS_REVERSED',
  'REQUEST_CLOSED_LOST', 'REQUEST_REOPENED', 'REQUEST_COST_UPDATED', 'PERK_SUBMITTED', 'PERK_APPROVED', 'PERK_REJECTED', 'ITEM_CREATED',
  'ITEM_UPDATED', 'ITEMS_REORDERED', 'POINT_CREATED', 'POINT_UPDATED', 'POINTS_REORDERED', 'POINT_STAFF_ADDED', 'POINT_STAFF_REMOVED',
  'GIFT_CREATED', 'GIFT_UPDATED', 'GIFTS_REORDERED', 'GIFT_FULFILLED', 'GIFT_CANCELLED', 'USER_FLAGS_UPDATED',
] as const;
export type WasteEventKindKey = (typeof WASTE_EVENT_KIND_KEYS)[number];

export const WASTE_EVENT_KIND_LABELS: Record<WasteEventKindKey, string> = {
  REQUEST_CREATED: 'Tạo yêu cầu',
  REQUEST_EDITED: 'Sửa yêu cầu',
  TRACKING_SET: 'Nhập mã vận đơn',
  TRACKING_EDITED: 'Sửa mã vận đơn',
  REQUEST_CANCELLED: 'Huỷ yêu cầu',
  REQUEST_ATTACHED: 'Gắn vào đơn mua',
  PICKUP_STARTED: 'Bắt đầu thu hàng',
  PICKUP_ORDER_CANCELLED: 'Đơn kèm bị huỷ',
  REQUEST_EXPIRED: 'Yêu cầu hết hạn',
  HOOK_ANOMALY: 'Cần kiểm tra đơn kèm',
  SHIP_LOCKED: 'Khoá gửi kho',
  REQUEST_CANCELLED_SHIP_LOCK: 'Huỷ vì khoá gửi kho',
  PARCEL_RECEIVED: 'Kho nhận kiện',
  PARCEL_UNMATCHED: 'Kiện chưa khớp yêu cầu',
  UNMATCHED_RECORDED: 'Ghi kiện chưa khớp',
  UNMATCHED_RESOLVED: 'Khớp kiện với yêu cầu',
  UNMATCHED_CLOSED: 'Đóng kiện chưa khớp',
  REQUEST_CONFIRMED: 'Xác nhận và cộng điểm',
  REQUEST_REJECTED: 'Từ chối yêu cầu',
  LOOKUP_MISS: 'Tra mã không thấy',
  POINTS_REVERSED: 'Thu hồi điểm',
  REQUEST_CLOSED_LOST: 'Đóng vì thất lạc',
  REQUEST_REOPENED: 'Mở lại yêu cầu',
  REQUEST_COST_UPDATED: 'Cập nhật phí ship',
  PERK_SUBMITTED: 'Gửi ưu đãi chờ duyệt',
  PERK_APPROVED: 'Duyệt ưu đãi',
  PERK_REJECTED: 'Từ chối ưu đãi',
  ITEM_CREATED: 'Thêm hàng nhận',
  ITEM_UPDATED: 'Sửa hàng nhận',
  ITEMS_REORDERED: 'Sắp xếp lại hàng nhận',
  POINT_CREATED: 'Thêm điểm nhận',
  POINT_UPDATED: 'Sửa điểm nhận',
  POINTS_REORDERED: 'Sắp xếp lại điểm nhận',
  POINT_STAFF_ADDED: 'Thêm người ở điểm',
  POINT_STAFF_REMOVED: 'Bỏ người ở điểm',
  GIFT_CREATED: 'Thêm quà',
  GIFT_UPDATED: 'Sửa quà',
  GIFTS_REORDERED: 'Sắp xếp lại quà',
  GIFT_FULFILLED: 'Trao quà',
  GIFT_CANCELLED: 'Huỷ quà',
  USER_FLAGS_UPDATED: 'Đổi cờ của khách',
};

export const WASTE_EVENT_OTHER_LABEL = 'Sự kiện khác';

const isEventKind = (k: string): k is WasteEventKindKey => Object.prototype.hasOwnProperty.call(WASTE_EVENT_KIND_LABELS, k);
export const wasteEventKindLabel = (kind: string): string => (isEventKind(kind) ? WASTE_EVENT_KIND_LABELS[kind] : WASTE_EVENT_OTHER_LABEL);
export const wasteActorRoleLabel = (role: string): string =>
  Object.prototype.hasOwnProperty.call(WASTE_ACTOR_ROLE_LABELS, role) ? WASTE_ACTOR_ROLE_LABELS[role as WasteActorRole] : WASTE_EVENT_OTHER_LABEL;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const lookup = (map: Record<string, string>, v: unknown): string | null =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v) ? map[v]! : null;

/** Only fields whose meaning is known are rendered; ids, device data and before/after dumps are dropped. */
export function wasteEventMetaLines(kind: string, meta: Record<string, unknown> | null): string[] {
  if (meta === null) return [];
  const after = typeof meta.after === 'object' && meta.after !== null ? (meta.after as Record<string, unknown>) : {};
  const lines: string[] = [];
  // POINTS_REVERSED also stores the original credit in meta.pointsAwarded; showing it there would read as a new credit.
  const awarded = kind === 'REQUEST_CONFIRMED' ? (num(meta.pointsAwarded) ?? num(after.pointsAwarded)) : null;
  if (awarded !== null) lines.push(`Cộng ${formatCount(awarded)} điểm`);
  const taken = num(meta.pointsTaken);
  if (taken !== null) lines.push(`Thu hồi ${formatCount(taken)} điểm`);
  const shortfall = num(meta.shortfallPoints);
  if (shortfall !== null && shortfall > 0) lines.push(`Còn thiếu ${formatCount(shortfall)} điểm chưa thu hồi được`);
  const grams = num(meta.receivedWeightGrams);
  if (grams !== null) lines.push(`Cân nặng thực nhận ${formatCount(grams)} g`);
  const basis = lookup(WASTE_MATCH_BASIS_LABELS, meta.matchBasis);
  if (basis !== null) lines.push(basis);
  const rejection = lookup(WASTE_REJECTION_REASON_LABELS, meta.rejectionReason);
  if (rejection !== null) lines.push(`Lý do từ chối: ${rejection}`);
  const closeReason = lookup(WASTE_CLOSE_REASON_LABELS, meta.closeReason ?? after.closeReason);
  if (closeReason !== null) lines.push(`Lý do đóng: ${closeReason}`);
  if (typeof meta.reason === 'string' && meta.reason.trim() !== '') lines.push(`Lý do: ${meta.reason.trim()}`);
  if (typeof meta.rejectionNote === 'string' && meta.rejectionNote.trim() !== '') lines.push(`Ghi chú: ${meta.rejectionNote.trim()}`);
  return lines;
}

const WEEKDAY_SHORT: Record<WasteWeekday, string> = { MON: 'T2', TUE: 'T3', WED: 'T4', THU: 'T5', FRI: 'T6', SAT: 'T7', SUN: 'CN' };
const WEEKDAY_ORDER = Object.keys(WEEKDAY_SHORT) as WasteWeekday[];

/** Gộp các ngày liền nhau có cùng khung giờ: "T2–T6 08:00–17:00 · T7 08:00–12:00". Không có giờ nào thì trả mảng rỗng. */
export function summarizeOpeningHours(hours: WasteOpeningHours): string[] {
  const groups: { from: WasteWeekday; to: WasteWeekday; text: string }[] = [];
  WEEKDAY_ORDER.forEach((d) => {
    const slots = hours[d];
    if (!slots || slots.length === 0) return;
    const text = slots.map((s) => `${s.open}–${s.close}`).join(', ');
    const last = groups[groups.length - 1];
    if (last && last.text === text && WEEKDAY_ORDER.indexOf(last.to) === WEEKDAY_ORDER.indexOf(d) - 1) last.to = d;
    else groups.push({ from: d, to: d, text });
  });
  return groups.map((g) => `${g.from === g.to ? WEEKDAY_SHORT[g.from] : `${WEEKDAY_SHORT[g.from]}–${WEEKDAY_SHORT[g.to]}`} ${g.text}`);
}
