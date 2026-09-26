/** Định dạng VND: 289000 → "289.000đ". */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

/** "Đã bán" kiểu Shopee: <1 → null (ẩn); <1000 → "Đã bán 12"; ≥1000 → "Đã bán 1,2k+"; ≥1tr → "...tr+". */
export function formatSold(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return `Đã bán ${v}`;
  if (v < 1_000_000) return `Đã bán ${trim(v / 1000)}k+`;
  return `Đã bán ${trim(v / 1_000_000)}tr+`;
}

/** Ghép dòng địa chỉ, bỏ phần rỗng (hệ 2 cấp không còn quận/huyện → tránh ", ,"). */
export function addressLine(a?: {
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
} | null): string {
  if (!a) return '';
  return [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');
}

/**
 * Tỉ lệ hoàn tiền lưu ở DB dạng PHÂN SỐ (0.035 = 3,5%) — không phải phần trăm.
 * Trước đây FE render thẳng `{Number(baseRate)}%` nên mọi sàn đều hiện "0.035%" thay vì
 * "3,5%", sai 100 lần trên đúng con số mời chào người dùng.
 * Trả chuỗi đã kèm "%", dùng dấu phẩy thập phân kiểu Việt, bỏ ",0" thừa.
 */
export function formatRatePct(rate: number | string | null | undefined): string {
  const v = Number(rate ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0%';
  const pct = v * 100;
  // 1 chữ số thập phân là đủ cho khoảng 0,5%–10% thường gặp; số tròn thì bỏ phần thập phân.
  return `${pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
}

/**
 * Điểm Xanh: LUÔN có dấu phân cách nghìn + đơn vị "điểm".
 * Trước đây mỗi màn tự format một kiểu — "1.250 điểm" (Ví), "1250 Điểm Xanh" (Điểm Xanh),
 * "1250" (Cá nhân) — cùng một con số trông như ba giá trị khác nhau.
 */
export function formatPoints(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${(Number.isFinite(v) ? v : 0).toLocaleString('vi-VN')} điểm`;
}

/**
 * VND rút gọn cho câu chữ marketing: 50000 → "50k", 1500000 → "1,5tr".
 * Số lẻ không tròn nghìn thì trả về dạng đầy đủ để không nói sai con số.
 */
export function formatVndShort(amount: number | null | undefined): string {
  const v = Number(amount ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0đ';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v >= 1_000_000 && v % 100_000 === 0) return `${trim(v / 1_000_000)}tr`;
  if (v >= 1_000 && v % 1_000 === 0) return `${Math.round(v / 1_000)}k`;
  return formatVnd(v);
}

/** Hệ số nhân kiểu Việt: 1.5 → "1,5" (không có ",0" thừa với số tròn). */
export function formatMultiplier(x: number | null | undefined): string {
  const v = Number(x ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '1';
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

// ── Thu gom vật liệu tái chế (đơn đổi hàng Gomdon/BestExpress) ─────────────────────────────

/** Cân nặng mặc định mỗi sản phẩm khi variation chưa khai (gram) — trùng fallback phía BE. */
export const RECYCLING_WEIGHT_FALLBACK_GRAMS = 500;

/**
 * Số kg thu gom tối đa ≈ tổng cân nặng đơn (cùng công thức BE gomdon-weight.ts): dòng thiếu/0 gram
 * lấy 500g, tối thiểu 500g. Trả chuỗi "2.4".
 */
export function recyclingMaxKg(lines: { weight?: number | null; quantity: number }[]): string {
  const fb = RECYCLING_WEIGHT_FALLBACK_GRAMS;
  const grams = lines.reduce((s, it) => s + (typeof it.weight === 'number' && it.weight > 0 ? it.weight : fb) * it.quantity, 0);
  return (Math.max(grams, fb) / 1000).toFixed(1);
}

/**
 * Trường gửi kèm POST /checkout cho lựa chọn thu gom. CHỈ có mặt khi tính năng đang bật VÀ khách
 * chọn — mặc định body y hệt bản cũ (API bản cũ bật forbidNonWhitelisted sẽ trả 400 cho mọi đơn nếu
 * luôn gửi `hasRecyclingPickup:false`; API bản mới cũng từ chối `true` khi tính năng tắt).
 */
export function recyclingCheckoutFields(
  enabled: boolean,
  selected: boolean,
  note: string,
): { hasRecyclingPickup?: true; recyclingNote?: string } {
  if (!enabled || !selected) return {};
  const trimmed = note.trim();
  return trimmed ? { hasRecyclingPickup: true, recyclingNote: trimmed } : { hasRecyclingPickup: true };
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

/**
 * Bưu tá Gomdon đã cầm hàng (mã số khác 1/2/10) — BE không cho khách tự huỷ nữa (orders.service),
 * nên FE ẩn nút huỷ thay vì để khách bấm rồi nhận lỗi.
 */
export function isRecyclingPickedUp(gomdonStatus: string | null | undefined): boolean {
  if (!gomdonStatus || !/^\d+$/.test(gomdonStatus)) return false;
  return !['1', '2', '10'].includes(gomdonStatus);
}

const NEEDS_CSKH = new Set(['NEEDS_MANUAL_CHECK', 'FAILED', 'NOT_CONFIGURED', '2', '6', '8', '9', '10', '11', '12']);
/** Chưa có vận đơn tự động (kho tạo tay / kiểm tra tay) — trùng hàng đợi "Cần xử lý thu gom" của admin. */
const NO_WAYBILL_STATES = new Set(['NEEDS_MANUAL_CHECK', 'FAILED', 'NOT_CONFIGURED']);
/** Admin bấm "Đã xử lý tay" (BE GOMDON_STATE.MANUAL_HANDLED). */
const MANUAL_HANDLED = 'MANUAL_HANDLED';
/** Hãng của vận đơn Gomdon (Order.shippingPartner do Gomdon ghi). */
const GOMDON_CARRIER = 'BestExpress';
/**
 * Câu trung tính khi hàng đợi CSKH KHÔNG còn đơn này (đã giao / "Đã xử lý tay" / hàng đã rời kho bằng
 * vận đơn tay) — không hứa "CSKH sẽ liên hệ" vì sẽ không ai được nhắc liên hệ.
 */
const NEUTRAL_PICKUP_DETAIL = 'Nếu bưu tá chưa nhận vật liệu tái chế, nhắn Zalo OA Tubu để được hẹn lại.';

/**
 * Trạng thái thu gom hiển thị cho KHÁCH ở chi tiết đơn — nói đúng những gì hệ thống đã làm
 * (không hứa "bưu tá sẽ tới" khi vận đơn chưa tạo được / đơn chưa thanh toán / đã huỷ, không hứa
 * "CSKH sẽ liên hệ" khi đơn đã rời hàng đợi CSKH). Cùng nội dung recyclingPickupView của web
 * (apps/web/src/lib/recycling.ts).
 * gomdonStatus: mã Gomdon "1".."12" hoặc trạng thái nội bộ (xem shared-types OrderDTO).
 */
export function recyclingPickupView(o: {
  status: string;
  paymentMethod: string;
  paymentStatus: string;
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
  /** Kho đã giao bằng hãng khác (Pancake ghi mã vận đơn hãng đó). */
  const shippedByOtherCarrier = !!o.shippingCode && o.shippingPartner !== GOMDON_CARRIER;

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
    s === MANUAL_HANDLED || (!!s && NO_WAYBILL_STATES.has(s) && (o.status === 'SHIPPING' || shippedByOtherCarrier));
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
