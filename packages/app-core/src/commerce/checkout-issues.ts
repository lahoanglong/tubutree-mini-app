import { fillCopy } from '../shop-copy';

/**
 * Lỗi của dòng hàng và của lần đặt ở màn thanh toán, dùng chung cho Mini App và web: báo đúng dòng, kèm cách sửa nhanh
 * ngay tại màn (bỏ dòng hết hàng, giảm về số còn, nhận giá mới) để khách không phải rời màn rồi mất ô đã nhập.
 */

export interface CheckoutLineInput {
  id: string;
  productName: string;
  quantity: number;
  stock: number;
}

export type LineFix = { kind: 'remove' } | { kind: 'reduce'; quantity: number };

export interface LineProblem {
  kind: 'sold-out' | 'over';
  /** Chữ báo ngay dưới dòng hàng. */
  text: string;
  fix: LineFix;
  /** Nhãn nút sửa nhanh. */
  fixLabel: string;
}

/** Dòng đang đòi nhiều hơn tồn: hết hàng hẳn (tồn không dương) thì bỏ dòng, còn một ít thì giảm về đúng số còn. */
export function checkoutLineProblem(line: CheckoutLineInput): LineProblem | null {
  if (line.quantity <= line.stock) return null;
  if (line.stock <= 0) {
    return { kind: 'sold-out', text: fillCopy('checkout.lineSoldOut'), fix: { kind: 'remove' }, fixLabel: fillCopy('checkout.lineRemove') };
  }
  return {
    kind: 'over',
    text: fillCopy('checkout.lineOver', { n: line.stock }),
    fix: { kind: 'reduce', quantity: line.stock },
    fixLabel: fillCopy('checkout.lineReduce', { n: line.stock }),
  };
}

export function checkoutLineProblems(lines: readonly CheckoutLineInput[]): Record<string, LineProblem> {
  const out: Record<string, LineProblem> = {};
  for (const l of lines) {
    const p = checkoutLineProblem(l);
    if (p) out[l.id] = p;
  }
  return out;
}

/** Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán. */
export const PRICE_CHANGED_CODE = 'PRICE_CHANGED';

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  response?: { data?: { code?: unknown; message?: unknown } };
}

/**
 * Lỗi đặt đơn là PRICE_CHANGED. Mini App (axios) để thân phản hồi ở `response.data`, web (ApiError) để `message` thẳng trên lỗi.
 * Phải đọc `message` thô: câu chung của Mini App (`getErrorMessage`) đã biến mọi chữ không dấu thành "Có chút trục trặc".
 */
export function isPriceChangedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as ErrorLike;
  const data = e.response?.data;
  const message = Array.isArray(data?.message) ? data.message[0] : (data?.message ?? e.message);
  return data?.code === PRICE_CHANGED_CODE || e.code === PRICE_CHANGED_CODE || message === PRICE_CHANGED_CODE;
}

export function priceChangedActions(): { accept: string; viewCart: string } {
  return { accept: fillCopy('checkout.priceAccept'), viewCart: fillCopy('checkout.priceViewCart') };
}
