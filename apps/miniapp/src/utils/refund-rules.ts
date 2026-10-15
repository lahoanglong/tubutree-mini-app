import type { OrderStatus, PaymentMethod, PaymentStatus } from '@tubutree/shared-types';
import { formatDateTime, formatVnd } from './format';

/** Lý do đổi/trả chọn sẵn — cùng mã với API (return-reasons.ts). "Lý do khác" bắt buộc mô tả. */
export const RETURN_REASONS = [
  { code: 'DEFECTIVE', label: 'Sản phẩm lỗi, hỏng' },
  { code: 'WRONG_ITEM', label: 'Giao sai sản phẩm' },
  { code: 'DAMAGED', label: 'Bể vỡ, móp méo khi vận chuyển' },
  { code: 'EXPIRED', label: 'Hết hạn hoặc sai hạn sử dụng' },
  { code: 'OTHER', label: 'Lý do khác' },
] as const;
export type ReturnReasonCode = (typeof RETURN_REASONS)[number]['code'];

export type RefundMethodChoice = 'WALLET' | 'BANK';

export interface RefundBankInput {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export const EMPTY_BANK: RefundBankInput = { bankName: '', accountNumber: '', accountName: '' };

/** Phương thức có thể hoàn về tài khoản ngân hàng (D2). Đơn trả bằng Ví luôn hoàn về Ví. */
const BANK_REFUNDABLE: readonly PaymentMethod[] = ['BANK_TRANSFER', 'ZALOPAY', 'VNPAY', 'COD'];

export function canRefundToBank(method: PaymentMethod): boolean {
  return BANK_REFUNDABLE.includes(method);
}

type CancelOrder = { paymentMethod: PaymentMethod; paymentStatus: PaymentStatus };

/**
 * Điều sheet huỷ đơn cần nói về tiền:
 * - choose: đơn đã trả tiền và hoàn được về ngân hàng → khách chọn Ví Tubu hay tài khoản ngân hàng.
 * - wallet: đơn đã trả bằng Ví → hoàn ngay về Ví.
 * - unpaidTransfer: đơn chuyển khoản chưa ghi nhận tiền → cảnh báo nếu đã chuyển thì đừng huỷ vội.
 * - none: chưa thu tiền (COD chưa giao) → không có gì để hoàn.
 */
export function cancelRefundMode(o: CancelOrder): 'choose' | 'wallet' | 'unpaidTransfer' | 'none' {
  if (o.paymentStatus === 'PAID') return canRefundToBank(o.paymentMethod) ? 'choose' : 'wallet';
  if (o.paymentStatus === 'UNPAID' && (o.paymentMethod === 'BANK_TRANSFER' || o.paymentMethod === 'ZALOPAY')) return 'unpaidTransfer';
  return 'none';
}

/** Kiểm tài khoản nhận hoàn tiền giống API (refund-destination.ts), lỗi theo từng ô để hiện dưới đúng ô sai. */
export function bankFieldErrors(b: RefundBankInput): Partial<Record<keyof RefundBankInput, string>> {
  const errors: Partial<Record<keyof RefundBankInput, string>> = {};
  if (b.bankName.trim().length < 2) errors.bankName = 'Vui lòng nhập tên ngân hàng.';
  if (!/^\d{6,24}$/.test(b.accountNumber.replace(/[\s.-]/g, ''))) errors.accountNumber = 'Số tài khoản chỉ gồm chữ số, từ 6 đến 24 số.';
  if (b.accountName.trim().length < 2) errors.accountName = 'Vui lòng nhập tên chủ tài khoản.';
  return errors;
}

/** Lỗi đầu tiên của tài khoản nhận hoàn tiền, null khi hợp lệ. */
export function bankDetailsError(b: RefundBankInput): string | null {
  const e = bankFieldErrors(b);
  return e.bankName ?? e.accountNumber ?? e.accountName ?? null;
}

/** Body nơi nhận tiền hoàn gửi API: chọn Ví thì không gửi tài khoản. */
export function destinationBody(method: RefundMethodChoice, bank: RefundBankInput) {
  return method === 'BANK'
    ? { refundMethod: 'BANK' as const, bankName: bank.bankName.trim(), accountNumber: bank.accountNumber.trim(), accountName: bank.accountName.trim() }
    : { refundMethod: 'WALLET' as const };
}

/** "Techcombank ••• 5678" — không hiện đủ số tài khoản trên màn hình. */
export function maskedBank(bankName: string | null | undefined, accountNo: string | null | undefined): string {
  const tail = (accountNo ?? '').slice(-4);
  return [bankName?.trim() || 'Tài khoản', tail ? `••• ${tail}` : ''].filter(Boolean).join(' ');
}

export interface ReturnLineState {
  orderItemId: string;
  productName: string;
  variationName: string;
  /** Số còn trả được (đã trừ yêu cầu đã duyệt). */
  remaining: number;
  selected: boolean;
  quantity: number;
}

interface ReturnHistory {
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  items?: { orderItemId: string; quantity: number }[];
}

/** Số còn trả được của từng dòng: số mua trừ số đã duyệt trả ở các yêu cầu trước. */
export function remainingByLine(
  items: { id: string; quantity: number }[],
  returns: ReturnHistory[],
): Map<string, number> {
  const taken = new Map<string, number>();
  for (const r of returns) {
    if (r.status !== 'APPROVED') continue;
    for (const it of r.items ?? []) taken.set(it.orderItemId, (taken.get(it.orderItemId) ?? 0) + it.quantity);
  }
  return new Map(items.map((i) => [i.id, Math.max(0, i.quantity - (taken.get(i.id) ?? 0))]));
}

/** Kiểm form đổi/trả trước khi gửi. Trả câu lỗi đầu tiên, hoặc null khi hợp lệ. */
export function returnFormError(input: {
  lines: ReturnLineState[];
  reasonCode: ReturnReasonCode | null;
  reason: string;
  refundMethod: RefundMethodChoice;
  bank: RefundBankInput;
}): string | null {
  if (!input.lines.some((l) => l.selected && l.quantity > 0)) return 'Chọn ít nhất một sản phẩm muốn trả.';
  if (!input.reasonCode) return 'Chọn lý do đổi/trả.';
  if (input.reasonCode === 'OTHER' && input.reason.trim().length < 5) return 'Mô tả lý do (tối thiểu 5 ký tự).';
  if (input.refundMethod === 'BANK') return bankDetailsError(input.bank);
  return null;
}

export interface MyRefund {
  id: string;
  orderId: string;
  orderCode: string;
  kind: 'END_CUSTOMER' | 'CANCEL' | 'RETURN' | 'LATE_PAYMENT' | 'OVERPAYMENT';
  /** Khoản trả hàng: id yêu cầu trả. API cũ chưa trả. */
  refKey?: string;
  amount: number;
  method: 'WALLET' | 'MANUAL_TRANSFER';
  /** PROCESSING: Tubu đã bắt đầu chuyển khoản — nơi nhận đã chốt. */
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  bankRef: string | null;
  completedAt: string | null;
  createdAt: string;
  canChooseDestination: boolean;
}

/** Một dòng trạng thái khoản hoàn cho khách: đang ở đâu, cần làm gì. */
const REFUND_LEAD: Record<MyRefund['kind'], string> = {
  LATE_PAYMENT: 'Tiền về sau khi đơn đã huỷ',
  OVERPAYMENT: 'Tiền bạn trả dư',
  RETURN: 'Hoàn tiền trả hàng',
  CANCEL: 'Hoàn tiền huỷ đơn',
  END_CUSTOMER: 'Hoàn tiền huỷ đơn',
};

export function refundStatusText(r: MyRefund): { title: string; detail: string; tone: 'success' | 'warning' | 'muted' } {
  const lead = REFUND_LEAD[r.kind] ?? 'Hoàn tiền huỷ đơn';
  if (r.status === 'COMPLETED') {
    return r.method === 'WALLET'
      ? { title: `${lead}: đã hoàn vào Ví Tubu`, detail: r.completedAt ? `Đã cộng vào Ví Tubu lúc ${formatDateTime(r.completedAt)}.` : '', tone: 'success' }
      : {
          title: `${lead}: đã chuyển khoản`,
          detail: `Về ${maskedBank(r.bankName, r.bankAccountNo)}${r.bankRef ? ` · Mã GD ${r.bankRef}` : ''}`,
          tone: 'success',
        };
  }
  if (!r.bankAccountNo) {
    return { title: `${lead}: chờ bạn chọn nơi nhận`, detail: 'Nhận về Ví Tubu ngay, hoặc tài khoản ngân hàng trong 1-3 ngày làm việc (miễn phí).', tone: 'warning' };
  }
  if (r.status === 'PROCESSING') {
    return {
      title: `${lead}: Tubu đang chuyển khoản`,
      detail: `Về ${maskedBank(r.bankName, r.bankAccountNo)} trong 1-3 ngày làm việc, miễn phí. Nơi nhận đã chốt, không đổi được nữa.`,
      tone: 'muted',
    };
  }
  return {
    title: `${lead}: chờ Tubu chuyển khoản`,
    detail: `Về ${maskedBank(r.bankName, r.bankAccountNo)} trong 1-3 ngày làm việc, miễn phí. Bạn vẫn đổi sang Ví Tubu được tới khi Tubu bắt đầu chuyển.`,
    tone: 'muted',
  };
}

/**
 * Chi tiết đơn có thể có khoản hoàn: đơn đã huỷ/trả/giao (hoàn khi huỷ, trả hàng, tiền về muộn), hoặc đơn đã nhận tiền
 * (khách trả hai lần / chuyển dư thành khoản "Tiền bạn trả dư" ngay cả khi đơn đang giao).
 */
export function showsRefundPanel(o: { status: OrderStatus; paymentStatus: PaymentStatus }): boolean {
  return (
    o.status === 'CANCELLED' || o.status === 'RETURNED' || o.status === 'DELIVERED' || o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED'
  );
}

/** Đơn trả trước đang chờ tiền và còn hạn — hiện "Thanh toán trước HH:mm dd/MM/yyyy". */
export function showsPaymentDeadline(o: { status: OrderStatus; paymentStatus: PaymentStatus; paymentDeadline?: string | null }): boolean {
  return o.status === 'PENDING_PAYMENT' && o.paymentStatus === 'UNPAID' && !!o.paymentDeadline;
}

export interface ReturnLike {
  status: string;
  adminNote?: string | null;
  refundMethod?: 'WALLET' | 'BANK';
  bankName?: string | null;
  bankAccountNo?: string | null;
  refundAmount?: number | null;
  shippingRefund?: number;
  receivedAt?: string | null;
  items?: { orderItemId: string; quantity: number }[];
}

/** Khoản hoàn thật của một yêu cầu trả (khoản RETURN có refKey = id yêu cầu) trong danh sách khoản hoàn của đơn. */
export function refundOfReturn<T extends Pick<MyRefund, 'kind' | 'refKey'>>(
  refunds: readonly T[] | undefined,
  returnId: string | undefined,
): T | undefined {
  if (!returnId) return undefined;
  return refunds?.find((f) => f.kind === 'RETURN' && f.refKey === returnId);
}

/**
 * Câu trạng thái một yêu cầu đổi/trả: đã duyệt thì nói rõ hoàn bao nhiêu, về đâu (D2/D3). Có khoản hoàn thật thì nơi nhận
 * và trạng thái lấy từ khoản đó (khách có thể đã đổi ngân hàng → Ví, Tubu có thể chưa chuyển), không theo lựa chọn lúc gửi.
 */
export function returnStatusLabel(
  r: ReturnLike,
  refund?: Pick<MyRefund, 'method' | 'status' | 'bankName' | 'bankAccountNo'>,
  placedForCustomer = false,
): string {
  if (r.status === 'REJECTED') return `Đổi/trả bị từ chối${r.adminNote ? `: ${r.adminNote}` : ''}`;
  if (r.status !== 'APPROVED') return 'Yêu cầu đổi/trả đang xử lý (trong 24h)';
  // Đơn CTV lên hộ: tiền hoàn đi về khách của CTV, không vào ví của người đang xem.
  if (placedForCustomer) {
    const total = (r.refundAmount ?? 0) + (r.shippingRefund ?? 0);
    return total > 0 ? `Đổi/trả đã duyệt — Tubu hoàn ${formatVnd(total)} cho khách của bạn` : 'Đổi/trả đã duyệt';
  }
  // Yêu cầu duyệt trước khi có trả theo dòng không lưu số tiền.
  if (r.refundAmount == null) return 'Đổi/trả đã duyệt — tiền hoàn vào Ví Tubu';
  const money = formatVnd(r.refundAmount + (r.shippingRefund ?? 0));
  if (r.refundAmount + (r.shippingRefund ?? 0) <= 0) return 'Đổi/trả đã duyệt';
  if (refund) {
    if (refund.method === 'WALLET') return `Đổi/trả đã duyệt — đã hoàn ${money} vào Ví Tubu`;
    if (!refund.bankAccountNo) return `Đổi/trả đã duyệt — hoàn ${money}, chờ bạn chọn nơi nhận`;
    const bank = maskedBank(refund.bankName, refund.bankAccountNo);
    return refund.status === 'COMPLETED'
      ? `Đổi/trả đã duyệt — Tubu đã chuyển khoản ${money} về ${bank}`
      : `Đổi/trả đã duyệt — Tubu chuyển khoản ${money} về ${bank} (1-3 ngày làm việc)`;
  }
  return r.refundMethod === 'BANK' && r.bankAccountNo
    ? `Đổi/trả đã duyệt — Tubu chuyển khoản ${money} về ${maskedBank(r.bankName, r.bankAccountNo)} (1-3 ngày làm việc)`
    : `Đổi/trả đã duyệt — đã hoàn ${money} vào Ví Tubu`;
}

/** "Nước giặt ×1, Xịt khoáng ×2" — các dòng của một yêu cầu trả. */
export function returnLinesText(r: ReturnLike, items: { id: string; productName: string }[]): string {
  const names = new Map(items.map((i) => [i.id, i.productName]));
  return (r.items ?? []).map((l) => `${names.get(l.orderItemId) ?? 'Sản phẩm'} ×${l.quantity}`).join(', ');
}
