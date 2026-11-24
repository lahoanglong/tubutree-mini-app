import { fillCopy } from '../shop-copy';

export interface RecoveryLine {
  id: string;
  productName: string;
  quantity: number;
  stock: number;
}

export interface SoldOutRecovery {
  /** Dòng hết hàng: bỏ chọn cho lần thanh toán này, vẫn nằm trong giỏ để mua khi có hàng lại. */
  soldOutIds: string[];
  /** Dòng còn lại đi thanh toán (đúng lựa chọn gửi sang màn Thanh toán). */
  keepIds: string[];
  /** Nhãn nút chính thay cho "Thanh toán (n)" đang bị khoá. */
  cta: string;
  /** Câu nói món nào hết và chúng đi đâu sau khi bấm. */
  note: string;
}

/**
 * Khách quay lại giỏ mà vài món đang chọn đã hết hàng trong lúc vắng: thay vì khoá nút Thanh toán, nút chính thành "Bỏ món hết & thanh toán
 * tiếp" (một chạm bỏ chọn món hết rồi sang Thanh toán với phần còn lại). Dùng chung cho giỏ Mini App và web.
 *
 * null (giữ cách chặn cũ) khi: không có món hết; bỏ món hết thì không còn gì để mua; hoặc còn dòng đòi nhiều hơn tồn (tồn > 0). Dòng vượt tồn cần
 * khách tự chọn số lượng, tự giảm hộ là đổi đơn sau lưng khách.
 */
export function soldOutRecovery(selected: readonly RecoveryLine[]): SoldOutRecovery | null {
  const split = recoverySplit(selected);
  if (!split) return null;
  const { soldOut, keep } = split;
  const names = soldOut.map((l) => `"${l.productName}"`).join(', ');
  return {
    soldOutIds: soldOut.map((l) => l.id),
    keepIds: keep.map((l) => l.id),
    cta: fillCopy('cart.dropSoldOutCta'),
    note: fillCopy('cart.dropSoldOutNote', { names }),
  };
}

function recoverySplit<T extends RecoveryLine>(selected: readonly T[]): { soldOut: T[]; keep: T[] } | null {
  const soldOut = selected.filter((l) => l.stock <= 0);
  const keep = selected.filter((l) => l.stock > 0);
  if (soldOut.length === 0 || keep.length === 0) return null;
  if (keep.some((l) => l.quantity > l.stock)) return null;
  return { soldOut, keep };
}

/**
 * Dòng để hỏi và hiện giá cạnh nút Thanh toán (tổng tiền, các dòng giảm, quà dùng thử, xem trước mã): khi nút chính là "Bỏ món hết & thanh toán
 * tiếp" thì chỉ phần còn lại (`keepIds`, đúng phần một chạm gửi sang Thanh toán), không thì đúng các dòng đang chọn. Máy chủ tính giá cả giỏ trên
 * mọi dòng, kể cả dòng hết: giỏ chọn hết mà dùng số đó thì tổng và số giảm cạnh nút gồm món sẽ không mua.
 * Không dùng cho trạng thái ô chọn hay danh sách gửi Thanh toán: món hết vẫn đang được chọn tới lúc khách bấm.
 */
export function cartPricingLines<T extends RecoveryLine>(selected: readonly T[]): T[] {
  return recoverySplit(selected)?.keep ?? [...selected];
}

/** Vắng ít hơn ngần này thì quay lại không đọc lại giỏ: đổi cửa sổ qua lại trên máy tính không gọi mạng mỗi lần. */
export const CART_RETURN_REFETCH_MS = 30_000;

/**
 * Quay lại app/tab (sự kiện focus của TanStack Query) có đọc lại giỏ không: chỉ khi bản đang có đã cũ hơn `CART_RETURN_REFETCH_MS` (tồn kho, giá Giờ vàng
 * có thể đã đổi) và không có lệnh sửa giỏ nào đang bay (bản đọc giữa chừng ghi đè số vừa sửa). Chưa có dữ liệu (`dataUpdatedAt` 0) thì đọc.
 */
export function cartRefetchOnReturn(dataUpdatedAt: number, editsInFlight: number, now: number = Date.now()): boolean {
  return editsInFlight <= 0 && now - dataUpdatedAt >= CART_RETURN_REFETCH_MS;
}
