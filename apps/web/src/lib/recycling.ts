/**
 * Thu gom vật liệu tái chế (vận đơn đổi hàng Gomdon/BestExpress) — helper THUẦN dùng chung cho web shop
 * (checkout, đơn của tôi) và web admin (danh sách/chi tiết đơn, thao tác vận đơn).
 *
 * Nguồn sự thật phía BE: apps/api/src/modules/integrations/gomdon/gomdon-status.ts (GOMDON_STATE,
 * GOMDON_STATUS_TEXT, GOMDON_CANCEL) và GomdonOrderService.retryPush/cancelWaybill. Bản sao nhãn ở đây
 * chỉ để HIỂN THỊ; mọi quyết định cho phép/từ chối vẫn do BE — FE chỉ ẩn nút chắc chắn vô nghĩa để
 * admin ít bấm nhầm.
 */

/** Trạng thái nội bộ trước khi có vận đơn (Order.gomdonStatus). */
export const GOMDON_STATE = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CREATING: 'CREATING',
  NEEDS_MANUAL_CHECK: 'NEEDS_MANUAL_CHECK',
  FAILED: 'FAILED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** Admin bấm "Đã xử lý tay" — hệ thống không tự tạo vận đơn nữa, đơn rời hàng đợi cần xử lý. */
  MANUAL_HANDLED: 'MANUAL_HANDLED',
} as const;

/** Hãng của vận đơn Gomdon (Order.shippingPartner do Gomdon ghi) — trùng GOMDON_CARRIER phía BE. */
export const GOMDON_CARRIER = 'BestExpress';

/** Mã số Gomdon gửi qua webhook — trùng GOMDON_STATUS_TEXT phía BE. */
export const GOMDON_STATUS_TEXT: Record<string, string> = {
  '1': 'Tạo đơn thành công',
  '2': 'Đơn hủy',
  '3': 'Đã lấy hàng',
  '4': 'Đang vận chuyển đến bưu cục nhận',
  '5': 'Đang đi giao hàng',
  '6': 'Đang chuyển hoàn',
  '7': 'Giao thành công',
  '8': 'Đã hoàn hàng',
  '9': 'Đơn hỏng, mất hàng',
  '10': 'Đơn lấy hàng không thành công',
  '11': 'Đơn giao hàng thất bại',
  '12': 'Đơn hoàn hàng thất bại',
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusLabel {
  label: string;
  tone: Tone;
  /** Giải thích ngắn cho admin: việc cần làm tiếp theo. */
  hint?: string;
}

const INTERNAL_LABEL: Record<string, StatusLabel> = {
  AWAITING_PAYMENT: {
    label: 'Chờ khách thanh toán',
    tone: 'neutral',
    hint: 'Vận đơn tự tạo khi đơn trả trước được thanh toán.',
  },
  CREATING: { label: 'Đang tạo vận đơn', tone: 'info', hint: 'Hệ thống đang gọi Gomdon — thử lại sau ít phút.' },
  NEEDS_MANUAL_CHECK: {
    label: 'Cần kiểm tra trên Gomdon',
    tone: 'danger',
    hint: 'Không rõ Gomdon đã tạo vận đơn chưa. Tra Gomdon theo mã đơn trước khi tạo lại.',
  },
  FAILED: {
    label: 'Tạo vận đơn thất bại',
    tone: 'danger',
    hint: 'Gomdon từ chối sau nhiều lần thử. Kho có thể đã tạo vận đơn tay theo ghi chú Pancake.',
  },
  NOT_CONFIGURED: {
    label: 'Chưa cấu hình Gomdon',
    tone: 'warning',
    hint: 'Thiếu tài khoản Gomdon (env) lúc đặt đơn — kho tạo vận đơn tay theo ghi chú Pancake.',
  },
  MANUAL_HANDLED: {
    label: 'Đã xử lý tay',
    tone: 'neutral',
    hint: 'Admin đã xử lý vận đơn thu gom ngoài hệ thống — hệ thống không tự tạo vận đơn Gomdon cho đơn này nữa.',
  },
};

const PROBLEM_CODES = new Set(['2', '6', '8', '9', '10', '11', '12']);

/** Nhãn tiếng Việt cho Order.gomdonStatus (mã số Gomdon hoặc trạng thái nội bộ). null → chưa xử lý. */
export function gomdonStatusLabel(status: string | null | undefined): StatusLabel {
  if (!status) return { label: 'Chưa tạo vận đơn', tone: 'neutral' };
  const internal = INTERNAL_LABEL[status];
  if (internal) return internal;
  const text = GOMDON_STATUS_TEXT[status];
  if (!text) return { label: `Trạng thái ${status}`, tone: 'neutral' };
  if (status === '7') return { label: text, tone: 'success' };
  if (PROBLEM_CODES.has(status)) {
    return {
      label: text,
      tone: status === '2' ? 'warning' : 'danger',
      hint: status === '2' ? 'Vận đơn đã huỷ phía Gomdon. Đơn còn hiệu lực thì tạo lại vận đơn hoặc giao hãng khác.' : 'Liên hệ khách / Gomdon để xử lý. Hệ thống KHÔNG tự hoàn tiền.',
    };
  }
  return { label: text, tone: 'info' };
}

/** Nhãn cho Order.gomdonCancelStatus (kết quả huỷ vận đơn khi đơn bị huỷ). */
export function gomdonCancelLabel(cancelStatus: string | null | undefined): StatusLabel | null {
  switch (cancelStatus) {
    case 'CANCELLED':
      return { label: 'Đã huỷ vận đơn', tone: 'neutral' };
    case 'NOT_NEEDED':
      return { label: 'Không có vận đơn cần huỷ', tone: 'neutral' };
    case 'FAILED':
      return {
        label: 'Huỷ vận đơn thất bại',
        tone: 'danger',
        hint: 'Hệ thống tự thử huỷ lại trong 6 giờ. Huỷ tay trên Gomdon để bưu tá không tới lấy hàng, xong thì bấm "Đã xử lý tay".',
      };
    case 'TOO_LATE':
      return {
        label: 'Bưu tá đã lấy hàng — không huỷ được',
        tone: 'danger',
        hint: 'Liên hệ Gomdon/BestExpress chặn giao và hoàn hàng về kho, xong thì bấm "Đã xử lý tay".',
      };
    case 'MANUAL_HANDLED':
      return { label: 'Đã xử lý huỷ tay', tone: 'neutral' };
    default:
      return null;
  }
}

/** Bưu tá đã cầm hàng (khác 1/2/10) — API Gomdon không huỷ được nữa. Trùng isGomdonPickedUp phía BE. */
export function isGomdonPickedUp(status: string | null | undefined): boolean {
  if (!status || !/^\d+$/.test(status)) return false;
  return !['1', '2', '10'].includes(status);
}

/** Chưa có vận đơn tự động (kho tạo tay / kiểm tra tay) — BE RECYCLING_ATTENTION_NO_WAYBILL_STATUSES. */
const NO_WAYBILL_ATTENTION = new Set(['FAILED', 'NEEDS_MANUAL_CHECK', 'NOT_CONFIGURED']);
/** Mã Gomdon báo huỷ / hoàn / hỏng / lấy-giao thất bại — BE RECYCLING_ATTENTION_PROBLEM_CODES. */
const PROBLEM_ATTENTION = new Set(['2', '6', '8', '9', '10', '11', '12']);
const CLOSED_ORDER = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
/** Hàng đã rời kho — không tạo thêm vận đơn Gomdon (BE GomdonOrderService.retryPush từ chối). */
const SHIPPED_ORDER = new Set(['SHIPPING', 'DELIVERED']);
/** Trạng thái được bấm "Đã xử lý tay" — trùng GOMDON_MANUAL_HANDLEABLE phía BE. */
const MANUAL_HANDLEABLE = new Set([...NO_WAYBILL_ATTENTION, ...PROBLEM_ATTENTION]);
/** Huỷ vận đơn cần người xử lý — trùng GOMDON_CANCEL_NEEDS_ATTENTION phía BE. */
const CANCEL_NEEDS_ATTENTION = new Set(['FAILED', 'TOO_LATE']);

/** Báo động Gomdon chưa xử lý (bảng gomdon_alerts, API trả tối đa 10 cái mới nhất). */
export interface GomdonAlertView {
  id: string;
  message: string;
  createdAt: string;
}

export interface RecyclingOrderFields {
  status: string;
  paymentMethod: string;
  paymentStatus?: string;
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonStatus?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonOrderId?: string | null;
  gomdonCancelStatus?: string | null;
  deliveredAt?: string | null;
  shippingCode?: string | null;
  shippingPartner?: string | null;
  gomdonAlerts?: GomdonAlertView[];
}

/** Kho đã giao bằng hãng khác (Pancake ghi mã vận đơn hãng đó) — mã do Gomdon ghi luôn kèm BestExpress. */
function shippedByOtherCarrier(o: { shippingCode?: string | null; shippingPartner?: string | null }): boolean {
  return !!o.shippingCode && o.shippingPartner !== GOMDON_CARRIER;
}

/** Đơn nằm trong hàng đợi "Cần xử lý thu gom" — cùng điều kiện với BE (admin-order-filter.ts). */
export function needsRecyclingAttention(o: RecyclingOrderFields): boolean {
  if (!o.hasRecyclingPickup) return false;
  // Báo động chưa ai xử lý: kể cả vận đơn trông bình thường (vd Gomdon tự gắn vận đơn cho đơn đã báo tạo tay).
  if ((o.gomdonAlerts?.length ?? 0) > 0) return true;
  const s = o.gomdonStatus ?? null;
  if (s === GOMDON_STATE.MANUAL_HANDLED) return false;
  if (o.gomdonCancelStatus && CANCEL_NEEDS_ATTENTION.has(o.gomdonCancelStatus)) return true;
  if (!s) return false;
  if (NO_WAYBILL_ATTENTION.has(s)) {
    // Hàng đã rời kho / kho đã giao bằng hãng khác → việc tạo vận đơn tay đã xong.
    return !CLOSED_ORDER.has(o.status) && !SHIPPED_ORDER.has(o.status) && !shippedByOtherCarrier(o);
  }
  return PROBLEM_ATTENTION.has(s) && !CLOSED_ORDER.has(o.status);
}

export interface GomdonAdminActions {
  /** Hiện nút "Tạo lại vận đơn". */
  canRetry: boolean;
  /** NEEDS_MANUAL_CHECK: bắt buộc tick xác nhận đã tra Gomdon không có vận đơn (gửi confirmedNoWaybill=true). */
  retryNeedsConfirm: boolean;
  /** Cảnh báo hiện cạnh nút tạo lại. */
  retryWarning: string | null;
  /** Hiện nút "Huỷ vận đơn Gomdon". */
  canCancel: boolean;
  /** Hiện nút "Đã xử lý tay" (POST …/gomdon/mark-handled). */
  canMarkHandled: boolean;
}

/**
 * Nút nào có nghĩa với trạng thái hiện tại — bám luật GomdonOrderService.retryPush/cancelWaybill.
 * Chỉ để ẩn nút chắc chắn bị từ chối; BE vẫn kiểm lại và FE hiện nguyên văn lỗi nếu có.
 */
export function gomdonAdminActions(o: RecyclingOrderFields): GomdonAdminActions {
  const none: GomdonAdminActions = {
    canRetry: false,
    retryNeedsConfirm: false,
    retryWarning: null,
    canCancel: false,
    canMarkHandled: false,
  };
  if (!o.hasRecyclingPickup) return none;
  const s = o.gomdonStatus ?? null;
  const dead = o.status === 'CANCELLED' || o.status === 'RETURNED';
  const shipped = SHIPPED_ORDER.has(o.status);
  const hasWaybill = !!(o.gomdonOrderId || o.gomdonPartnerCode);
  const payable = o.paymentMethod === 'COD' || o.paymentStatus === 'PAID';

  const manualWaybillWarning =
    'Kho có thể ĐÃ tạo vận đơn tay theo ghi chú trên Pancake. Kiểm tra Pancake/Gomdon trước — tạo thêm vận đơn là bưu tá giao 2 lần.';

  let canRetry = false;
  let retryNeedsConfirm = false;
  let retryWarning: string | null = null;
  // Hàng đã rời kho (đang giao / đã giao) → không tạo thêm vận đơn: dùng "Đã xử lý tay" sau khi hẹn thu gom riêng.
  if (!dead && !shipped && payable && s !== GOMDON_STATE.CREATING && s !== GOMDON_STATE.MANUAL_HANDLED) {
    if (s === '2') {
      canRetry = true;
      retryWarning = 'Vận đơn cũ đã huỷ phía Gomdon. Tạo vận đơn mới sẽ đặt lại bưu tá tới giao + thu gom.';
    } else if (!hasWaybill) {
      if (s === GOMDON_STATE.NEEDS_MANUAL_CHECK) {
        canRetry = true;
        retryNeedsConfirm = true;
        retryWarning = `Chưa rõ Gomdon đã tạo vận đơn chưa. Tra Gomdon theo mã đơn, chỉ tạo lại khi chắc chắn KHÔNG có vận đơn. ${manualWaybillWarning}`;
      } else if (s === GOMDON_STATE.FAILED || s === GOMDON_STATE.NOT_CONFIGURED) {
        canRetry = true;
        retryWarning = manualWaybillWarning;
      } else if (s === null || s === GOMDON_STATE.AWAITING_PAYMENT) {
        canRetry = true; // job kẹt: đơn đã thanh toán được mà chưa có vận đơn
      }
    }
  }

  let canCancel = false;
  if (o.status === 'CANCELLED') {
    // Đơn đã huỷ: job huỷ tự chạy; nút này để THỬ LẠI khi lần trước lỗi. Chưa có mã vận đơn / bưu tá đã
    // lấy hàng (TOO_LATE) thì API Gomdon không huỷ được → không hiện nút, xem gợi ý xử lý tay.
    canCancel = !!o.gomdonOrderId && (o.gomdonCancelStatus == null || o.gomdonCancelStatus === 'FAILED');
  } else if (!dead) {
    canCancel = !!o.gomdonOrderId && s !== '2' && s !== GOMDON_STATE.MANUAL_HANDLED && !isGomdonPickedUp(s);
  }
  // Đơn đã huỷ/trả mà huỷ vận đơn lỗi: CSKH huỷ tay trên cổng Gomdon rồi đánh dấu (BE GomdonOrderService.markHandled).
  const cancelNeedsHand = dead && !!o.gomdonCancelStatus && CANCEL_NEEDS_ATTENTION.has(o.gomdonCancelStatus);
  const canMarkHandled = cancelNeedsHand || (!!s && MANUAL_HANDLEABLE.has(s));
  return { canRetry, retryNeedsConfirm, retryWarning, canCancel, canMarkHandled };
}
