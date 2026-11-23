import { fillCopy } from '../shop-copy';

/** Số dòng hàng hiện sẵn ở khung tóm tắt web trước khi gập; hơn mức này thì có nút "Xem thêm n sản phẩm". */
export const CHECKOUT_LINES_COLLAPSED = 5;

/**
 * Lý do nút Đặt hàng đang khoá, nói ngay cạnh nút (Mini App và web dùng chung). Thiếu địa chỉ thắng lỗi báo giá vì báo giá
 * chưa được hỏi khi chưa có địa chỉ; null khi không có lý do nào của riêng hai điều kiện này. Máy chủ từ chối địa chỉ
 * (ADDRESS_OUTDATED) thì bấm Thử lại không bao giờ qua: chỉ sửa địa chỉ mới qua.
 */
export function checkoutPlaceHint(i: { hasAddress: boolean; quoteFailed: boolean; addressOutdated?: boolean }): string | null {
  if (!i.hasAddress) return fillCopy('checkout.addressNeeded');
  if (i.quoteFailed && i.addressOutdated) return fillCopy('checkout.addressFix');
  if (i.quoteFailed) return fillCopy('checkout.quoteFailed');
  return null;
}

const PAY_CUE_KEYS: Readonly<Record<string, string>> = {
  COD: 'checkout.payCueCod',
  BANK_TRANSFER: 'checkout.payCueBank',
  WALLET: 'checkout.payCueWallet',
};

/**
 * Dòng phụ dưới tên một cách thanh toán (Mini App và web, cả thanh toán không đăng nhập): khi nào trả tiền và khi nào đơn được xác nhận.
 * Cách đang bị khoá thì nơi gọi hiện lý do khoá thay cho dòng này. Cách lạ (máy chủ thêm sau) thì null: không đoán.
 */
export function paymentMethodCue(method: string): string | null {
  const key = PAY_CUE_KEYS[method];
  return key ? fillCopy(key) : null;
}

/**
 * Ô "Tổng cộng". Chỉ số máy chủ báo mới được đứng ở đây: chưa có địa chỉ thì chưa tính phí giao nên không số nào
 * được đóng vai tổng cuối; có địa chỉ mà báo giá chưa về thì "…" (không phải 0đ, trông như đơn không mất tiền).
 */
export function checkoutTotalText(i: { total: number | null; hasAddress: boolean }, formatMoney: (n: number) => string): string {
  if (i.total !== null) return formatMoney(i.total);
  return i.hasAddress ? '…' : fillCopy('checkout.totalPending');
}

/** Gập danh sách dòng hàng: phần ẩn kèm tiền để cộng các dòng thấy được vẫn ra "Tạm tính". */
export function collapseCheckoutLines<T extends { total: number }>(
  lines: readonly T[],
  expanded: boolean,
  max: number = CHECKOUT_LINES_COLLAPSED,
): { shown: T[]; hiddenCount: number; hiddenTotal: number } {
  if (expanded || lines.length <= max) return { shown: [...lines], hiddenCount: 0, hiddenTotal: 0 };
  const hidden = lines.slice(max);
  return { shown: lines.slice(0, max), hiddenCount: hidden.length, hiddenTotal: hidden.reduce((s, l) => s + l.total, 0) };
}

/** SĐT trên dòng địa chỉ gọn: giữ 3 số đầu và 3 số cuối để khách nhận ra, phần giữa che (ảnh chụp màn hình không lộ trọn số). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone.trim();
  const local = digits.startsWith('84') && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  return `${local.slice(0, 3)}****${local.slice(-3)}`;
}

/** Trần ký tự của dòng địa chỉ một dòng; CSS vẫn cắt theo bề ngang, trần này giữ DOM gọn khi địa chỉ dài bất thường. */
export const COMPACT_ADDRESS_MAX = 90;

export interface CompactAddressInput {
  recipient: string;
  phone: string;
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}

/** Khối địa chỉ thu về một dòng ở màn thanh toán: "Tên · 090****567" và địa chỉ một dòng đã cắt. */
export function compactAddressView(a: CompactAddressInput): { title: string; line: string } {
  const full = [a.street, a.ward, a.district, a.province].map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
  const line = full.length > COMPACT_ADDRESS_MAX ? `${full.slice(0, COMPACT_ADDRESS_MAX - 1).trimEnd()}…` : full;
  return { title: `${a.recipient.trim()} · ${maskPhone(a.phone)}`, line };
}

/** Thứ tự trong tấm chọn địa chỉ: mặc định đứng đầu, kế đến địa chỉ dùng gần nhất (mới trước), còn lại giữ thứ tự sổ địa chỉ. */
export function sortAddressesForPicker<T extends { id: string; isDefault: boolean }>(addresses: readonly T[], recentIds: readonly string[] = []): T[] {
  const rank = (a: T): number => {
    if (a.isDefault) return -1;
    const i = recentIds.indexOf(a.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return addresses
    .map((a, index) => ({ a, index, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.index - y.index)
    .map((x) => x.a);
}

/** Địa chỉ vừa dùng để đặt đơn lên đầu danh sách gần nhất (không trùng, tối đa `max`). */
export function pushRecentAddress(recentIds: readonly string[], id: string, max = 5): string[] {
  return [id, ...recentIds.filter((x) => x !== id)].slice(0, max);
}

/** Khoá lưu id địa chỉ dùng gần nhất trên máy (theo tài khoản qua `scopedKey`). Chỉ id, không có địa chỉ hay SĐT. */
export const RECENT_ADDRESS_KEY = 'tubu_recent_address_ids';

export interface RecentStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const recentKey = (userId?: string | null) => (userId ? `${RECENT_ADDRESS_KEY}:${userId}` : RECENT_ADDRESS_KEY);

export function readRecentAddressIds(storage: RecentStorageLike | null, userId?: string | null): string[] {
  try {
    const raw = storage?.getItem(recentKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberRecentAddress(storage: RecentStorageLike | null, id: string, userId?: string | null): void {
  if (!storage || !id) return;
  try {
    storage.setItem(recentKey(userId), JSON.stringify(pushRecentAddress(readRecentAddressIds(storage, userId), id)));
  } catch {
    /* bộ nhớ đầy hoặc bị chặn: thứ tự tấm chọn chỉ thiếu mục "gần nhất" */
  }
}

export interface TransferPreviewInput {
  enabled: boolean;
  bank: { name: string; accountName: string } | null;
}

/**
 * Thẻ xem trước chuyển khoản: cờ tắt, thiếu thông tin ngân hàng hoặc chưa có tổng của báo giá thì null (app ẩn thẻ).
 * Không bao giờ mang số tài khoản hay chuỗi QR: mã quét được khi chưa có mã đơn tạo khoản chuyển không đối soát được.
 */
export function transferPreviewView(
  preview: TransferPreviewInput | null | undefined,
  total: number | null | undefined,
): { bankName: string; accountName: string; amount: number } | null {
  if (!preview?.enabled || !preview.bank) return null;
  const bankName = preview.bank.name.trim();
  const accountName = preview.bank.accountName.trim();
  if (!bankName || !accountName || typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  return { bankName, accountName, amount: total };
}

/** Mốc lúc máy chủ trả lời đặt đơn chuyển khoản, để trang QR đo "thời gian tới QR" (`transfer_qr_shown.msSinceOrder`). */
const transferPlacedAt = new Map<string, number>();

export function markTransferOrderPlaced(code: string, nowMs: number): void {
  if (transferPlacedAt.size > 20) transferPlacedAt.clear();
  transferPlacedAt.set(code, nowMs);
}

/** Lấy một lần (gọi lại trả null): số ms từ lúc đặt tới lúc QR hiện, làm tròn 100 ms; mở lại trang từ link cũ thì null. */
export function takeTransferQrDelay(code: string, nowMs: number): number | null {
  const at = transferPlacedAt.get(code);
  if (at === undefined) return null;
  transferPlacedAt.delete(code);
  return Math.min(600_000, Math.max(0, Math.round((nowMs - at) / 100) * 100));
}
