import type {
  WasteCloseReason,
  WasteGiftKind,
  WasteGiftRedemptionStatus,
  WasteGiftStatus,
  WasteItemStatus,
  WasteMethod,
  WastePointKind,
  WastePointStatus,
  WasteRejectionReason,
  WasteRequestStatus,
  WasteShortfallReason,
  WasteUnmatchedReason,
} from '@tubutree/shared-types';

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
