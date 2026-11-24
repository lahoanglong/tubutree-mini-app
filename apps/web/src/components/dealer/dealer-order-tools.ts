import type { OrderDTO, OrderStatus } from '@tubutree/shared-types';
import type { CreditEntry, PricelistRow } from '@tubutree/app-core/api/dealer';
import { DEALER_MAX_QTY, csvTextCell } from '@tubutree/app-core/dealer-pricing';

/**
 * Chip lọc ở tab Đơn hàng. "Đang giao" gom đơn đã nhận tới lúc đang trên đường (đã xác nhận, đã đóng gói, đang giao): với đại lý đó là
 * một chặng "chờ hàng tới". Đơn huỷ và hoàn chỉ hiện ở "Tất cả".
 */
export const DEALER_ORDER_FILTERS = [
  { key: 'all', label: 'Tất cả', statuses: null },
  { key: 'pending', label: 'Chờ thanh toán', statuses: ['PENDING_PAYMENT'] },
  { key: 'shipping', label: 'Đang giao', statuses: ['CONFIRMED', 'PACKED', 'SHIPPING'] },
  { key: 'delivered', label: 'Đã giao', statuses: ['DELIVERED'] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly OrderStatus[] | null }>;
export type DealerOrderFilter = (typeof DEALER_ORDER_FILTERS)[number]['key'];

export function filterDealerOrders<T extends Pick<OrderDTO, 'status'>>(orders: readonly T[], filter: DealerOrderFilter): T[] {
  const statuses: readonly string[] | null = DEALER_ORDER_FILTERS.find((f) => f.key === filter)?.statuses ?? null;
  return statuses ? orders.filter((o) => statuses.includes(o.status)) : [...orders];
}

export type ReorderLine = { variationId: string; quantity: number; name: string };
/**
 * Dòng nạp vào giỏ của tab Bảng giá. `label` thay "đơn #<mã>" trong lời báo (vd "đơn tháng 10/2026"); `skipped` là tên máy chủ đã bỏ trước
 * (không còn bán sỉ), cộng vào phần bỏ của bảng giá để lời báo nêu đủ.
 */
export type ReorderRequest = { code: string; lines: ReorderLine[]; label?: string; skipped?: string[] };

type ItemLike = Partial<Pick<OrderDTO['items'][number], 'variationId' | 'quantity' | 'productName' | 'variationName' | 'isGift'>>;

const lineName = (it: ItemLike) =>
  [it.productName, it.variationName].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).join(' – ') || 'Mặt hàng';

/** Dòng đặt lại được của một đơn: có mã phân loại, số lượng nguyên dương, không phải quà 0đ. */
export function reorderLinesOf(order: { items?: readonly ItemLike[] | null }): ReorderLine[] {
  const out: ReorderLine[] = [];
  for (const it of order.items ?? []) {
    if (typeof it.variationId !== 'string' || it.variationId === '' || it.isGift) continue;
    if (typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity <= 0) continue;
    out.push({ variationId: it.variationId, quantity: it.quantity, name: lineName(it) });
  }
  return out;
}

/** Nút "Đặt lại đơn sỉ": đơn còn chờ thanh toán không có (thẻ đó đã có lời "Thanh toán ngay"), đơn không còn dòng hàng nào cũng không. */
export function canReorder(order: { status: string; items?: readonly ItemLike[] | null }): boolean {
  return order.status !== 'PENDING_PAYMENT' && reorderLinesOf(order).length > 0;
}

export interface ReorderResult {
  /** Số lượng theo phân loại để nạp vào giỏ của tab Bảng giá (thay cả giỏ, như chạm một mẫu đơn). */
  qty: Record<string, number>;
  /** Số mặt hàng nạp được. */
  added: number;
  /** Tên mặt hàng không còn trong bảng giá sỉ của đại lý (ngừng bán, ngừng bán sỉ hay đổi bậc), mỗi tên một lần. */
  skipped: string[];
}

/**
 * Nạp lại dòng của đơn cũ theo bảng giá hiện tại: phân loại không còn trong bảng giá thì bỏ và nêu tên; hai dòng cùng phân loại thì cộng;
 * số lượng kẹp ở `DEALER_MAX_QTY` như ô số lượng. Giá, tồn, đặt trước tính lại theo bảng giá hôm nay ở tab Bảng giá.
 */
export function reorderQuantities(lines: readonly ReorderLine[], pricelist: readonly Pick<PricelistRow, 'variationId'>[]): ReorderResult {
  const sellable = new Set(pricelist.map((r) => r.variationId));
  const qty: Record<string, number> = {};
  const skipped: string[] = [];
  for (const l of lines) {
    if (!sellable.has(l.variationId)) {
      if (!skipped.includes(l.name)) skipped.push(l.name);
      continue;
    }
    qty[l.variationId] = Math.min(DEALER_MAX_QTY, (qty[l.variationId] ?? 0) + l.quantity);
  }
  return { qty, added: Object.keys(qty).length, skipped };
}

/** Lời báo sau khi nạp đơn cũ; `error` khi có mặt hàng bị bỏ (đại lý phải thấy rõ đơn mới thiếu món). */
export function reorderNotice(
  code: string,
  r: Pick<ReorderResult, 'added' | 'skipped'>,
  label = `đơn #${code}`,
): { text: string; error: boolean } {
  const skippedText = r.skipped.length > 0 ? ` Bỏ qua ${r.skipped.length} mặt hàng không còn bán sỉ: ${r.skipped.join(', ')}.` : '';
  if (r.added === 0) {
    return { text: `${label.charAt(0).toUpperCase()}${label.slice(1)} không còn mặt hàng nào đang bán sỉ, giỏ chưa đổi.${skippedText}`, error: true };
  }
  return {
    text: `Đã nạp ${r.added} mặt hàng của ${label} theo giá hôm nay, kiểm tra số lượng rồi đặt.${skippedText}`,
    error: r.skipped.length > 0,
  };
}

/** Nạp `ReorderRequest` theo bảng giá hôm nay: tên bỏ gồm phần máy chủ đã bỏ trước và phần bảng giá không còn, mỗi tên một lần. */
export function applyReorderRequest(
  r: ReorderRequest,
  pricelist: readonly Pick<PricelistRow, 'variationId'>[],
): { qty: Record<string, number>; added: number; notice: { text: string; error: boolean } } {
  const res = reorderQuantities(r.lines, pricelist);
  const skipped = [...new Set([...(r.skipped ?? []), ...res.skipped])];
  return { qty: res.qty, added: res.added, notice: reorderNotice(r.code, { added: res.added, skipped }, r.label) };
}

// Mọi số liệu đơn đại lý đổi theo (hạn mức, giá, tồn, tối thiểu): đơn bị từ chối thì tải lại hết, như Mini App (apps/miniapp/src/pages/dealer.tsx).
export const DEALER_ORDER_REFRESH_KEYS = [
  'dealer-orders',
  'dealer-me',
  'dealer-credit',
  'dealer-rewards',
  'dealer-report',
  'dealer-tier-progress',
  'dealer-pricelist',
  'dealer-last-month-reorder',
] as const;
/** Đặt xong: công nợ, đơn, thưởng, doanh số tháng và hạn mức còn lại của "Đặt lại đơn tháng trước" đều đổi. */
export const DEALER_ORDER_PLACED_KEYS = [
  'dealer-orders',
  'dealer-me',
  'dealer-credit',
  'dealer-rewards',
  'dealer-report',
  'dealer-tier-progress',
  'dealer-last-month-reorder',
] as const;

/** Nhãn nút một chạm: "Đặt lại đơn tháng 10" từ tháng "10/2026". */
export const lastMonthReorderLabel = (month: string): string => `Đặt lại đơn tháng ${month.split('/')[0]}`;

/** Hạn mức còn lại sau đơn: âm thì nói rõ phần vượt. */
export function creditAfterText(after: number, money: (n: number) => string): string {
  return after >= 0 ? money(after) : `Vượt ${money(-after)}`;
}

const BOM = String.fromCharCode(0xfeff);

/** Ô số: chỉ số nguyên hữu hạn (có thể âm), còn lại để trống. Chuỗi chỉ gồm dấu trừ và chữ số không mang được công thức nên giữ là số. */
const csvIntCell = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '');

export const CREDIT_LEDGER_CSV_HEADERS = ['Thời gian', 'Diễn giải', 'Loại', 'Phát sinh (đ)', 'Dư nợ sau giao dịch (đ)'] as const;

/**
 * Sổ công nợ thành CSV mở thẳng bằng Excel: BOM UTF-8, CRLF, mọi ô chữ qua `csvTextCell` (thêm nháy đơn trước `=`, `+`, `-`, `@`, tab, CR:
 * ghi chú do admin gõ có thể mở đầu bằng các ký tự đó). Dòng theo thứ tự API trả (mới nhất trước). "Dư nợ sau giao dịch" tính lùi từ dư nợ
 * hiện tại (`balance` là tổng cả sổ) nên vẫn đúng khi API chỉ trả 200 dòng gần nhất.
 */
export function dealerCreditLedgerCsv(entries: readonly CreditEntry[], balance: number, dateTime: (iso: string) => string): string {
  const lines = [CREDIT_LEDGER_CSV_HEADERS.map(csvTextCell).join(',')];
  let after = balance;
  for (const e of entries) {
    lines.push([csvTextCell(dateTime(e.createdAt)), csvTextCell(e.note ?? e.refType), csvTextCell(e.refType), csvIntCell(e.delta), csvIntCell(after)].join(','));
    after -= Number.isFinite(e.delta) ? e.delta : 0;
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Tên file theo ngày (`yyyy-mm-dd` giờ VN do nơi gọi đưa). */
export const dealerCreditLedgerFileName = (isoDay: string): string => `so-cong-no-dai-ly-tubu-${isoDay}.csv`;

/** Tải chuỗi CSV (đã có BOM) thành tệp; tự dựng ở đây vì `lib/export-csv.ts` kéo theo mã của trang quản trị. */
export function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
