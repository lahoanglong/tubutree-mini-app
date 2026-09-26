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
      return { label: 'Huỷ vận đơn thất bại', tone: 'danger', hint: 'Huỷ tay trên Gomdon để bưu tá không tới lấy hàng.' };
    case 'TOO_LATE':
      return {
        label: 'Bưu tá đã lấy hàng — không huỷ được',
        tone: 'danger',
        hint: 'Liên hệ Gomdon/BestExpress chặn giao và hoàn hàng về kho.',
      };
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
}

/** Kho đã giao bằng hãng khác (Pancake ghi mã vận đơn hãng đó) — mã do Gomdon ghi luôn kèm BestExpress. */
function shippedByOtherCarrier(o: { shippingCode?: string | null; shippingPartner?: string | null }): boolean {
  return !!o.shippingCode && o.shippingPartner !== GOMDON_CARRIER;
}

/** Đơn nằm trong hàng đợi "Cần xử lý thu gom" — cùng điều kiện với BE (admin-order-filter.ts). */
export function needsRecyclingAttention(o: RecyclingOrderFields): boolean {
  if (!o.hasRecyclingPickup) return false;
  const s = o.gomdonStatus ?? null;
  if (s === GOMDON_STATE.MANUAL_HANDLED) return false;
  if (o.gomdonCancelStatus === 'FAILED' || o.gomdonCancelStatus === 'TOO_LATE') return true;
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
  const canMarkHandled = !!s && MANUAL_HANDLEABLE.has(s);
  return { canRetry, retryNeedsConfirm, retryWarning, canCancel, canMarkHandled };
}

// ── Web shop ──────────────────────────────────────────────────────────────────────────────────

/** Giới hạn ghi chú thu gom — trùng @MaxLength(500) của PlaceOrderDto.recyclingNote. */
export const RECYCLING_NOTE_MAX = 500;

/**
 * Trường gửi kèm POST /checkout/place-order. CHỈ có mặt khi tính năng bật VÀ khách chọn — mặc định body
 * y hệt bản cũ (API bật forbidNonWhitelisted; API cũng từ chối `true` khi tính năng tắt). Trùng
 * recyclingCheckoutFields của miniapp (apps/miniapp/src/utils/format.ts).
 */
export function recyclingCheckoutFields(
  enabled: boolean,
  selected: boolean,
  note: string,
): { hasRecyclingPickup?: true; recyclingNote?: string } {
  if (!enabled || !selected) return {};
  const trimmed = note.trim().slice(0, RECYCLING_NOTE_MAX);
  return trimmed ? { hasRecyclingPickup: true, recyclingNote: trimmed } : { hasRecyclingPickup: true };
}

/** Đơn trả trước qua cổng/chuyển khoản: lịch thu gom chỉ đặt SAU khi Tubu nhận tiền (BE isGomdonPayable). */
export function recyclingBookedAfterPayment(paymentMethod: string): boolean {
  return paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'ZALOPAY';
}

export type RecyclingTone = 'progress' | 'success' | 'warning' | 'muted';

export interface RecyclingPickupView {
  tone: RecyclingTone;
  title: string;
  detail: string;
  /** Mã vận đơn BestExpress để khách đối chiếu với bưu tá (ẩn khi đơn đã huỷ). */
  waybill: string | null;
}

const PICKED_UP_OR_MOVING = new Set(['3', '4', '5']);
const NEEDS_CSKH = new Set(['NEEDS_MANUAL_CHECK', 'FAILED', 'NOT_CONFIGURED', '2', '6', '8', '9', '10', '11', '12']);
/**
 * Câu trung tính khi hàng đợi CSKH KHÔNG còn đơn này (đã giao / "Đã xử lý tay" / hàng đã rời kho bằng
 * vận đơn tay) — không hứa "CSKH sẽ liên hệ" vì sẽ không ai được nhắc liên hệ.
 */
const NEUTRAL_PICKUP_DETAIL = 'Nếu bưu tá chưa nhận vật liệu tái chế, nhắn Zalo OA Tubu để được hẹn lại.';

/**
 * Trạng thái thu gom hiển thị cho KHÁCH — cùng nội dung với recyclingPickupView của miniapp: nói đúng
 * những gì hệ thống đã làm (không hứa "bưu tá sẽ tới" khi vận đơn chưa tạo được / chưa thanh toán / đã huỷ,
 * không hứa "CSKH sẽ liên hệ" khi đơn đã rời hàng đợi CSKH — xem needsRecyclingAttention).
 */
export function recyclingPickupView(o: {
  status: string;
  paymentMethod: string;
  paymentStatus?: string;
  gomdonStatus?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonCancelStatus?: string | null;
  shippingCode?: string | null;
  shippingPartner?: string | null;
}): RecyclingPickupView {
  const s = o.gomdonStatus ?? null;
  const waybill = o.gomdonPartnerCode ?? null;
  /** Mã BestExpress còn để đối chiếu với bưu tá: vận đơn Gomdon có mã số, trừ vận đơn đã huỷ (2). */
  const liveWaybill = s && /^\d+$/.test(s) && s !== '2' ? waybill : null;

  if (o.status === 'CANCELLED' || o.status === 'RETURNED') {
    const pending = o.gomdonCancelStatus === 'FAILED' || o.gomdonCancelStatus === 'TOO_LATE';
    return {
      tone: 'muted',
      title: 'Đã huỷ thu gom',
      detail: pending
        ? 'Đơn đã huỷ. Tubu đang huỷ lịch thu gom với đơn vị vận chuyển, CSKH sẽ liên hệ nếu cần.'
        : 'Đơn đã huỷ nên lịch thu gom vật liệu tái chế cũng được huỷ.',
      waybill: null,
    };
  }
  if (s === '7') {
    return {
      tone: 'success',
      title: 'Đã giao hàng',
      detail: 'Cảm ơn bạn đã chung tay tái chế 🌿 Nếu bưu tá chưa nhận vật liệu của bạn, nhắn Zalo OA Tubu để được hỗ trợ.',
      waybill,
    };
  }
  if (o.status === 'DELIVERED') {
    // Đơn giao xong nhưng Gomdon chưa/không báo "Giao thành công" (giao bằng vận đơn tay / hãng khác).
    return { tone: 'muted', title: 'Đã giao hàng', detail: NEUTRAL_PICKUP_DETAIL, waybill: liveWaybill };
  }
  const handledOutside =
    s === GOMDON_STATE.MANUAL_HANDLED ||
    (!!s && NO_WAYBILL_ATTENTION.has(s) && (o.status === 'SHIPPING' || shippedByOtherCarrier(o)));
  if (handledOutside) {
    return {
      tone: 'muted',
      title: o.status === 'SHIPPING' ? 'Đang giao hàng' : 'Thu gom được xử lý riêng',
      detail: NEUTRAL_PICKUP_DETAIL,
      waybill: null,
    };
  }
  if (s && NEEDS_CSKH.has(s)) {
    return {
      tone: 'warning',
      title: 'CSKH sẽ liên hệ hẹn thu gom',
      detail: 'Lịch thu gom tự động chưa thực hiện được. CSKH Tubu sẽ liên hệ bạn để hẹn lại thời gian.',
      waybill: s === '2' ? null : waybill,
    };
  }
  if (s && PICKED_UP_OR_MOVING.has(s)) {
    return {
      tone: 'progress',
      title: 'Bưu tá đang giao hàng',
      detail: 'Khi nhận hàng, bạn gửi vật liệu tái chế đã đóng gói gọn cho bưu tá nhé.',
      waybill,
    };
  }
  if (s === '1') {
    return {
      tone: 'progress',
      title: 'Đã đặt lịch thu gom',
      detail: 'Bưu tá BestExpress sẽ giao hàng và nhận lại vật liệu tái chế cùng lúc.',
      waybill,
    };
  }
  const unpaidPrepaid = o.paymentMethod !== 'COD' && o.paymentStatus !== 'PAID';
  if (s === 'AWAITING_PAYMENT' || unpaidPrepaid) {
    return {
      tone: 'muted',
      title: 'Chờ thanh toán',
      detail: 'Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.',
      waybill: null,
    };
  }
  return {
    tone: 'progress',
    title: 'Đang đặt lịch thu gom',
    detail: 'Tubu đang hẹn bưu tá giao hàng kèm thu gom vật liệu tái chế cho đơn này.',
    waybill,
  };
}
