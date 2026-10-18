import { isGomdonPickedUp } from './recycling';
import { formatCount } from './checkout-points';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};

/** Tab lọc danh sách đơn — cùng nhóm với tab của Mini App (Đang xử lý gồm Đang đóng gói, Đã hủy/hoàn gồm Đã hoàn). */
export const ORDER_TABS = [
  { key: 'all', label: 'Tất cả', filter: {} },
  { key: 'pending_payment', label: 'Chờ thanh toán', filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: 'Đang xử lý', filter: { group: 'processing' } },
  { key: 'shipping', label: 'Đang giao', filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: 'Đã giao', filter: { status: 'DELIVERED' } },
  { key: 'closed', label: 'Đã hủy/hoàn', filter: { group: 'closed' } },
] as const satisfies readonly { key: string; label: string; filter: { status?: string; group?: 'processing' | 'closed' } }[];
export type OrderTabKey = (typeof ORDER_TABS)[number]['key'];

export const orderStatusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

interface CarrierFacts {
  status: string;
  shippingCode?: string | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
}

/**
 * Kho đã đặt hãng cho đơn (Pancake gắn mã vận đơn hãng lúc in phiếu) dù đơn chưa chuyển "Đang giao". Mã vận đơn của vận
 * đơn thu gom Gomdon không tính (bưu tá chưa tới). Cùng mốc CARRIER_WAYBILL của cancelHandover ở BE.
 */
export function isCarrierBooked(o: CarrierFacts): boolean {
  if (o.status !== 'CONFIRMED' && o.status !== 'PACKED') return false;
  return !!o.shippingCode && o.shippingCode !== o.gomdonOrderId && o.shippingCode !== o.gomdonPartnerCode;
}

/** Hàng đã rời kho cho hãng vận chuyển (đang giao, hoặc kho đã đặt hãng): từ đây không hủy được nữa. */
export const isHandedToCarrier = (o: CarrierFacts): boolean => o.status === 'SHIPPING' || isCarrierBooked(o);

/**
 * Mốc thời gian đầu trang chi tiết đơn. `createdAt` là giờ ĐẶT; đứng cạnh "Đã giao" mà không có nhãn thì khách đọc thành giờ
 * giao. Đơn đã giao có mốc giao thật thì hiện mốc đó.
 */
export function orderStamp(o: { status: string; createdAt: string; deliveredAt?: string | null }): { label: string; at: string } {
  return o.status === 'DELIVERED' && o.deliveredAt ? { label: 'Giao lúc', at: o.deliveredAt } : { label: 'Đặt lúc', at: o.createdAt };
}

/**
 * Dòng Điểm Xanh của đơn theo trạng thái: chưa giao thì "sẽ nhận", đã giao thì "đã cộng", đã hoàn thì đã thu hồi.
 * `pointsTaken`: số điểm thực thu lại do trả hàng (API `pointsReturnReversed`). API cũ chưa trả thì chỉ có `pointsReversed`
 * (phần chia chưa kẹp theo số dư) nên ghi "tối đa".
 */
export function orderPointsNote(
  status: string,
  pointsEarned: number,
  pointsReversed = 0,
  pointsTaken?: number,
): { text: string; tone: 'success' | 'muted' } | null {
  if (pointsEarned <= 0 || status === 'CANCELLED') return null;
  const earned = formatCount(pointsEarned);
  if (status === 'DELIVERED' && pointsTaken !== undefined) {
    if (pointsTaken > 0) return { text: `Đã cộng +${earned}, đã thu lại ${formatCount(pointsTaken)} điểm do trả hàng`, tone: 'muted' };
  } else if (status === 'DELIVERED' && pointsReversed > 0) {
    return { text: `Đã cộng +${earned}, đã thu lại tối đa ${formatCount(pointsReversed)} do trả hàng`, tone: 'muted' };
  }
  if (status === 'DELIVERED') return { text: `Đã cộng +${earned} Điểm Xanh vào tài khoản`, tone: 'success' };
  if (status === 'RETURNED') return { text: 'Điểm Xanh của đơn này đã được thu hồi', tone: 'muted' };
  return { text: `Nhận +${earned} Điểm Xanh khi giao thành công`, tone: 'success' };
}

/** Hạn đổi/trả còn mở không, cùng cách tính của API (mốc giao, thiếu thì updatedAt); không có mốc nào thì để API quyết định. */
export function returnWindowState(
  o: { deliveredAt?: string | null; updatedAt?: string | null },
  windowDays: number,
  now: number = Date.now(),
): { open: boolean; daysLeft: number } {
  const base = o.deliveredAt ?? o.updatedAt;
  if (!base) return { open: true, daysLeft: windowDays };
  const left = (new Date(base).getTime() + windowDays * 864e5 - now) / 864e5;
  return left > 0 ? { open: true, daysLeft: Math.ceil(left) } : { open: false, daysLeft: 0 };
}

/** Nhãn trạng thái cho khách: đơn đã đặt hãng thì nói rõ, khỏi khớp chip "Đang đóng gói" với lời "đã bàn giao". */
export const buyerOrderStatusLabel = (o: CarrierFacts): string =>
  isCarrierBooked(o) ? 'Đã đặt đơn vị vận chuyển' : orderStatusLabel(o.status);

/** Chờ thanh toán là việc khách còn phải làm nên dùng màu cảnh báo; đơn đã hủy/hoàn là trạng thái kết thúc. */
export function orderStatusTone(status: string): string {
  if (status === 'PENDING_PAYMENT') return 'bg-warning-bg text-warning-fg';
  if (status === 'CANCELLED' || status === 'RETURNED') return 'bg-stone-100 text-stone-700';
  return 'bg-forest-50 text-forest-800';
}

const METHOD_LABEL: Record<string, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPay',
  WALLET: 'Ví Tubu',
  XU: 'Điểm Xanh (xu cũ)',
};
export const paymentMethodLabel = (method: string): string => METHOD_LABEL[method] ?? method;

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  REFUNDED: 'Đã hoàn tiền',
  FAILED: 'Thanh toán thất bại',
};
export const paymentStatusLabel = (status: string | undefined): string =>
  status ? (PAYMENT_STATUS_LABEL[status] ?? status) : '';

/** Hãng vận chuyển (qua Pancake) gửi trạng thái dạng mã tiếng Anh; Gomdon gửi sẵn chữ tiếng Việt. */
const SHIPPING_STATUS_LABEL: Record<string, string> = {
  ready_to_pick: 'Chờ lấy hàng',
  picking: 'Đang lấy hàng',
  picked: 'Đã lấy hàng',
  storing: 'Đang lưu kho',
  transporting: 'Đang trung chuyển',
  delivering: 'Đang giao',
  delivered: 'Đã giao',
  delivery_fail: 'Giao không thành công',
  waiting_to_return: 'Chờ hoàn',
  returning: 'Đang hoàn',
  returned: 'Đã hoàn',
  cancel: 'Đã huỷ',
  cancelled: 'Đã huỷ',
};
export const shippingStatusLabel = (status: string | null | undefined): string =>
  status ? (SHIPPING_STATUS_LABEL[status.trim().toLowerCase()] ?? status) : '';

interface PaymentView {
  status: string;
  paymentMethod: string;
  paymentStatus?: string;
}

/**
 * Đơn COD đã giao: bưu tá đã thu tiền mặt của khách, nhưng API cố ý giữ paymentStatus = UNPAID (order-reversal dùng
 * nó làm chốt hoàn tiền một lần khi đơn COD đã giao bị trả) — nên chỉ đổi chữ hiển thị, không đổi dữ liệu.
 */
const codCollected = (o: PaymentView): boolean =>
  o.paymentMethod === 'COD' && o.status === 'DELIVERED' && o.paymentStatus === 'UNPAID';

/** Khoản hoàn của đơn: chi tiết đơn của khách (/orders/me/refunds) và danh sách đơn admin (customerRefunds). */
export interface RefundFacts {
  method: string;
  status: string;
  kind?: string;
}

/** Khoản Tubu nợ khách hoặc đã trả; chờ đối soát (UNVERIFIED) và đã bỏ qua (DISMISSED) chưa/không phải tiền hoàn. */
const counted = (r: RefundFacts) => r.status === 'PENDING' || r.status === 'PROCESSING' || r.status === 'COMPLETED';

/**
 * Đơn đã lật REFUNDED (lật ngay khi huỷ/trả) mà còn khoản chuyển khoản Tubu Chờ/Đang chuyển: tiền chưa tới tay khách. Một
 * luật cho chi tiết đơn của khách, danh sách/chi tiết đơn admin và CSV (API admin-export, BANK_REFUND_IN_PROGRESS).
 * Tiền về muộn/chuyển dư (LATE_PAYMENT, OVERPAYMENT) đang chờ hoàn thì đơn vẫn giữ UNPAID nhưng khách đã chuyển tiền: cũng là đang hoàn. Đơn đã PAID thì giữ "Đã thanh toán" (phần chuyển dư là khoản riêng).
 */
export const isRefundInProgress = (o: PaymentView, refunds?: readonly RefundFacts[] | null): boolean => {
  const open = (r: RefundFacts) => r.status === 'PENDING' || r.status === 'PROCESSING';
  if (o.paymentStatus === 'UNPAID' && refunds?.some((r) => (r.kind === 'LATE_PAYMENT' || r.kind === 'OVERPAYMENT') && open(r))) return true;
  return o.paymentStatus === 'REFUNDED' && !!refunds?.some((r) => r.method === 'MANUAL_TRANSFER' && open(r));
};

/**
 * Tình trạng thanh toán hiển thị cho khách. Đơn đã lật REFUNDED nhưng còn khoản chuyển khoản Tubu chưa chuyển xong thì là
 * "Đang hoàn tiền" — "Đã hoàn tiền" chỉ khi mọi khoản đã xong (BUYERWEB-4), kèm nơi tiền về khi mọi khoản cùng một nơi.
 */
export const orderPaymentStatusLabel = (o: PaymentView, refunds?: readonly RefundFacts[] | null): string => {
  if (codCollected(o)) return 'Đã thu tiền khi giao';
  if (isRefundInProgress(o, refunds)) return 'Đang hoàn tiền';
  const done = refunds?.filter(counted) ?? [];
  if (o.paymentStatus === 'REFUNDED' && done.length) {
    if (done.every((r) => r.method === 'WALLET')) return 'Đã hoàn tiền vào Ví Tubu';
    if (done.every((r) => r.method === 'MANUAL_TRANSFER')) return 'Đã hoàn tiền về tài khoản ngân hàng';
  }
  return paymentStatusLabel(o.paymentStatus);
};

/** Ô gọn trong danh sách đơn admin. */
const PAYMENT_STATUS_SHORT: Record<string, string> = { UNPAID: 'Chưa TT', REFUNDED: 'Đã hoàn tiền', FAILED: 'TT lỗi' };

export function orderPaymentStatusShort(o: PaymentView, refunds?: readonly RefundFacts[] | null): string {
  if (codCollected(o)) return 'Đã thu COD';
  if (isRefundInProgress(o, refunds)) return 'Đang hoàn tiền';
  if (o.paymentStatus === 'PAID') return 'Đã TT';
  return (o.paymentStatus && PAYMENT_STATUS_SHORT[o.paymentStatus]) ?? o.paymentStatus ?? '';
}

export const orderDetailHref = (code: string): string => `/tai-khoan/don-hang/${encodeURIComponent(code)}`;
export const bankPaymentHref = (code: string): string => `/thanh-toan/chuyen-khoan/${encodeURIComponent(code)}`;

/**
 * Khớp điều kiện của miniapp (`canPayNow`) và của API: GET /payments/bank-qr từ chối đơn đã hủy/trả,
 * nên khung QR chỉ dựng cho đơn còn chờ thanh toán. Hàng đã bàn giao vận chuyển mà chưa nhận tiền (`manualHandling`) thì CSKH
 * thống nhất cách trả với khách — không mời trả thêm bằng QR để khách không trả hai lần (R5-SYNC-1).
 */
export const canPayAgain = (o: { status: string; paymentMethod: string; manualHandling?: boolean | null }): boolean =>
  o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER' && !o.manualHandling;

export function addressLine(
  a: { street?: string | null; ward?: string | null; district?: string | null; province?: string | null } | null | undefined,
): string {
  if (!a) return '';
  return [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');
}

/** Link tra cứu vận đơn do đối tác vận chuyển trả về: chỉ mở http(s), không bao giờ `javascript:`/`data:`. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 5 bước hành trình chuẩn của đơn; Đã hủy/Đã hoàn là trạng thái kết thúc nên không nằm trên đường này. */
export const TIMELINE_STEPS = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;

/** Vị trí trên hành trình chuẩn; -1 khi trạng thái nằm ngoài (Đã hủy/Đã hoàn). */
export const timelineIndex = (status: string): number => (TIMELINE_STEPS as readonly string[]).indexOf(status);

/** Đơn đã kết thúc thì mới có "Mua lại" — cùng điều kiện với Mini App. */
export const isReorderable = (status: string): boolean => status === 'DELIVERED' || status === 'CANCELLED' || status === 'RETURNED';

/**
 * Khách có tự hủy được không — chỉ để không bày nút chắc chắn bị từ chối; BE vẫn là nơi quyết định. API trả `canCancel`
 * tính bằng đúng luật huỷ của khách (OrdersService.customerCancelBlock) thì theo đó; API cũ thì tự xét: tới trước khi
 * bàn giao vận chuyển (Chờ thanh toán/Đã xác nhận/Đang đóng gói; đơn đại lý chỉ tới Đã xác nhận), kho chưa đặt hãng, đơn
 * CTV lên hộ khách đã trả tiền chỉ admin hủy, đơn thu gom tái chế mà bưu tá đã lấy hàng thì thôi. Kho Pancake đã gửi
 * hàng mà chưa báo về thì BE từ chối kèm lời "liên hệ CSKH".
 */
export function canCancelOrder(
  o: CarrierFacts & {
    type?: string | null;
    paymentStatus?: string | null;
    placedForCustomer?: boolean | null;
    referrerUserId?: string | null;
    hasRecyclingPickup?: boolean | null;
    gomdonStatus?: string | null;
    canCancel?: boolean | null;
  },
  userId: string | null | undefined,
): boolean {
  const cancellable = o.type === 'DEALER' ? ['PENDING_PAYMENT', 'CONFIRMED'] : ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];
  if (!cancellable.includes(o.status)) return false;
  if (typeof o.canCancel === 'boolean') return o.canCancel;
  if (o.placedForCustomer && o.paymentStatus === 'PAID' && !!userId && o.referrerUserId === userId) return false;
  if (o.hasRecyclingPickup && isGomdonPickedUp(o.gomdonStatus)) return false;
  return !isCarrierBooked(o);
}

export interface OrderDiscountParts {
  discount: number;
  pointsUsed?: number;
  couponCode?: string | null;
  /** Mã của lần đặt khi đơn tách này không giữ lượt dùng mã nhưng nhận một phần giảm của mã. */
  groupCouponCode?: string | null;
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
}

/**
 * Các dòng giảm giá ở tóm tắt tiền của chi tiết đơn, cùng cách tách với Mini App và màn Thanh toán: mã, combo, hạng thành viên, Điểm
 * Xanh mỗi khoản một dòng (cộng lại = `discount`). Đơn tạo trước khi API lưu từng khoản chỉ có tổng `discount` (đã gồm tiền Điểm
 * Xanh) nên hiện một dòng và ghi rõ đã gồm điểm.
 */
export function discountRows(o: OrderDiscountParts): { label: string; amount: number }[] {
  const coupon = o.couponDiscount ?? 0;
  const combo = o.comboDiscount ?? 0;
  const tier = o.tierDiscount ?? 0;
  const points = o.pointsDiscount ?? 0;
  const known = coupon + combo + tier + points;
  if (known === 0) {
    if (o.discount <= 0) return [];
    return [{ label: (o.pointsUsed ?? 0) > 0 ? 'Giảm giá (gồm Điểm Xanh)' : 'Giảm giá', amount: o.discount }];
  }
  const code = o.couponCode ?? o.groupCouponCode;
  const rows = [
    { label: code ? `Mã giảm giá (${code})` : 'Mã giảm giá', amount: coupon },
    { label: 'Ưu đãi combo', amount: combo },
    { label: 'Ưu đãi hạng thành viên', amount: tier },
    { label: `Điểm Xanh (${formatCount(o.pointsUsed ?? 0)} điểm)`, amount: points },
    { label: 'Giảm giá khác', amount: o.discount - known },
  ];
  return rows.filter((r) => r.amount > 0);
}
