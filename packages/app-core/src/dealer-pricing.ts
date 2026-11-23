/** Trần số lượng một dòng trên màn đặt hàng đại lý — chỉ để chặn gõ nhầm; hạn mức thật do máy chủ. */
export const DEALER_MAX_QTY = 9999;

/** Phần vượt tồn của một dòng: máy chủ giữ hàng đang có, phần còn lại là đặt trước. */
export function preorderQty(qty: number, stock: number): number {
  return Math.max(0, qty - Math.max(0, stock));
}

/**
 * % giảm tính từ giá thật. `discountPct` máy chủ trả chỉ là mức giảm mặc định của bậc, trong khi
 * giá của từng phân loại có thể được đặt riêng cho bậc (dealerPrices) nên hai con số lệch nhau.
 */
export function realDiscountPct(retailPrice: number, dealerPrice: number): number {
  if (!(retailPrice > 0) || dealerPrice >= retailPrice) return 0;
  return Math.round((1 - dealerPrice / retailPrice) * 100);
}

/** Phần của một dòng bảng giá đại lý (`PricelistRow`) mà bộ lọc, file CSV và lời báo giá cần. */
export interface DealerPriceRowLike {
  sku: string;
  product: string;
  brand: string;
  variation: string;
  retailPrice: number;
  dealerPrice: number;
  stock: number;
}

const keyOf = (s: string) => s.trim().toLocaleLowerCase('vi');

/** Thương hiệu có trong bảng giá để làm chip lọc: bỏ trống, gộp trùng không phân biệt hoa thường (giữ cách viết gặp đầu), sắp theo ABC tiếng Việt. */
export function dealerBrands(rows: readonly Pick<DealerPriceRowLike, 'brand'>[]): string[] {
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const name = r.brand?.trim();
    if (name && !byKey.has(keyOf(name))) byKey.set(keyOf(name), name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'vi'));
}

export interface DealerPriceFilter {
  /** Từ khoá khớp tên, SKU hoặc thương hiệu (không phân biệt hoa thường). */
  query?: string;
  /** Một thương hiệu (so không phân biệt hoa thường); null/trống là mọi thương hiệu. */
  brand?: string | null;
  /** Chỉ dòng còn hàng sẵn (`stock > 0`); dòng hết hàng vẫn đặt trước được nên mặc định vẫn hiện. */
  inStockOnly?: boolean;
}

export function filterDealerPricelist<T extends DealerPriceRowLike>(rows: readonly T[], f: DealerPriceFilter): T[] {
  const q = f.query?.trim().toLocaleLowerCase('vi') ?? '';
  const brand = f.brand?.trim() ? keyOf(f.brand) : null;
  return rows.filter((r) => {
    if (f.inStockOnly && !(r.stock > 0)) return false;
    if (brand && keyOf(r.brand ?? '') !== brand) return false;
    if (!q) return true;
    return [r.product, r.sku, r.brand].some((v) => (v ?? '').toLocaleLowerCase('vi').includes(q));
  });
}

/** Ký tự mở đầu khiến Excel/Google Sheets coi ô là công thức (cùng luật `apps/web/src/lib/export-csv.ts`). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Ô CSV an toàn: chữ mở đầu bằng ký tự công thức thì thêm dấu nháy đơn (Excel đọc như văn bản), luôn bọc ngoặc kép và nhân đôi ngoặc kép bên trong. */
export function csvTextCell(value: string | null | undefined): string {
  const raw = String(value ?? '');
  const s = (FORMULA_START.test(raw) ? `'${raw}` : raw).replace(/\r\n?/g, '\n');
  return `"${s.replace(/"/g, '""')}"`;
}

/** Ô số: chỉ số nguyên hữu hạn, còn lại để trống (không bao giờ ghi chữ lạ vào cột số). */
const csvNumberCell = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '');

export const DEALER_CSV_HEADERS = ['SKU', 'Sản phẩm', 'Phân loại', 'Thương hiệu', 'Giá lẻ (đ)', 'Giá đại lý (đ)', 'Giảm (%)', 'Tồn kho'] as const;

/**
 * Bảng giá đại lý thành file CSV mở thẳng bằng Excel: có BOM UTF-8 (Excel mới đọc đúng dấu tiếng Việt), xuống dòng CRLF, mọi ô chữ chống công thức
 * (tên sản phẩm, SKU do đối tác nhập có thể bắt đầu bằng `=`/`+`/`-`/`@`). % giảm tính từ giá thật như màn hình (`realDiscountPct`).
 */
export function dealerPricelistCsv(rows: readonly DealerPriceRowLike[], variationName: (raw: string) => string | null = (v) => v?.trim() || null): string {
  const lines = [DEALER_CSV_HEADERS.map(csvTextCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvTextCell(r.sku),
        csvTextCell(r.product),
        csvTextCell(variationName(r.variation) ?? ''),
        csvTextCell(r.brand),
        csvNumberCell(r.retailPrice),
        csvNumberCell(r.dealerPrice),
        csvNumberCell(realDiscountPct(r.retailPrice, r.dealerPrice)),
        csvNumberCell(Math.max(0, r.stock)),
      ].join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Tên file CSV theo ngày (`yyyy-mm-dd` do nơi gọi đưa, giờ VN). */
export const dealerPricelistFileName = (isoDay: string): string => `bang-gia-dai-ly-tubu-${isoDay}.csv`;

/** Số dòng tối đa của lời báo giá chép nhanh: dán vào Zalo vẫn đọc được; phần còn lại báo số mặt hàng và gợi ý tải CSV. */
export const DEALER_QUOTE_MAX_LINES = 30;

/**
 * Lời báo giá chép nhanh (dán Zalo/tin nhắn): một dòng mỗi mặt hàng "Tên · Phân loại (SKU): giá đại lý (giá lẻ x, -y%)". `money` là hàm định dạng
 * tiền của app (39.000đ). Quá `maxLines` thì dòng cuối nói còn bao nhiêu mặt hàng.
 */
export function dealerQuoteText(
  rows: readonly DealerPriceRowLike[],
  opts: { dateLabel: string; money: (n: number) => string; variationName?: (raw: string) => string | null; maxLines?: number },
): string {
  const max = Math.max(1, opts.maxLines ?? DEALER_QUOTE_MAX_LINES);
  const name = opts.variationName ?? ((v: string) => v?.trim() || null);
  const head = `Báo giá đại lý Tubu Tree (${opts.dateLabel})`;
  const body = rows.slice(0, max).map((r) => {
    const variation = name(r.variation);
    const title = variation ? `${r.product} · ${variation}` : r.product;
    const pct = realDiscountPct(r.retailPrice, r.dealerPrice);
    const retail = r.retailPrice > r.dealerPrice ? ` (giá lẻ ${opts.money(r.retailPrice)}${pct > 0 ? `, -${pct}%` : ''})` : '';
    const stock = r.stock > 0 ? '' : ' · hết hàng, nhận đặt trước';
    return `- ${title} (${r.sku}): ${opts.money(r.dealerPrice)}${retail}${stock}`;
  });
  const rest = rows.length - body.length;
  return [head, ...body, ...(rest > 0 ? [`… và ${rest} mặt hàng khác (tải file CSV để xem đủ).`] : [])].join('\n');
}
