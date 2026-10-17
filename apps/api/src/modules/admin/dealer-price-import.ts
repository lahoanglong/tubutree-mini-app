import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Nhập giá sỉ đại lý theo bậc từ Excel. Giá sỉ > 0 được DealerService.unitPrice ưu tiên tuyệt đối, nên một giá đọc sai
 * (`185.000` thành 185đ) là đại lý đặt hàng với giá đó. Vì vậy: đọc số tiền kiểu Việt Nam chặt, số mơ hồ là lỗi dòng,
 * giá ngoài khoảng hợp lý so với giá lẻ là lỗi dòng, và còn dòng lỗi thì không ghi dòng nào.
 */

/** Giá sỉ phải nằm trong [10%, 100%] giá lẻ của biến thể — chặn gõ thiếu/thừa số 0, không phải chính sách giá. */
export const DEALER_PRICE_MIN_RATIO = 0.1;
export const DEALER_PRICE_CSV_MAX_ROWS = 5000;
export const DEALER_PRICE_CSV_MAX_LENGTH = 300_000;

/**
 * Số tiền đồng nguyên viết kiểu Việt Nam/Excel: `185000`, `185.000`, `1.250.000`, `240,000`, `185 000`, kèm `đ`/`VND` tuỳ ý.
 * Dấu chấm/phẩy chỉ được là dấu nhóm nghìn (đúng 3 chữ số mỗi nhóm, một loại dấu). `185.5`, `1.25`, `185.000,00`, `1,250.000`
 * là mơ hồ → null.
 */
export function parseVndAmount(raw: string): number | null {
  const s = raw
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/(vnđ|vnd|đ|d)$/i, '');
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.exec(s);
  return m ? Number(s.split(m[1]!).join('')) : null;
}

export type DealerPriceCsvRow = { line: number; sku: string; input: string; price: number | null; problem: string | null };

const HEADER_SKU_CELLS = new Set(['sku', 'mã', 'ma', 'mã sku', 'ma sku', 'mã hàng', 'ma hang', 'mã sp', 'ma sp']);

/**
 * CSV "sku,giá" dán từ Excel: cột tách bằng tab, `;` hoặc `,` (xét từng dòng). Tách bằng dấu phẩy mà giá viết `240,000` thì
 * Excel cho ra 3 ô `sku`,`240`,`000` — ghép lại nếu đúng dạng nhóm nghìn. Dòng tiêu đề (ô đầu là "SKU"/"Mã"… và ô giá không
 * phải số) bị bỏ; mọi dòng có dữ liệu khác đều được trả về, dòng không đọc được kèm `problem`.
 */
export function parseDealerPriceCsv(csv: string): DealerPriceCsvRow[] {
  const rows: DealerPriceCsvRow[] = [];
  let seenData = false;
  csv.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const delim = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = line.split(delim).map((c) => c.trim());
    while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
    const sku = cells[0] ?? '';
    const input = cells.slice(1).join(delim);
    const isFirst = !seenData;
    seenData = true;
    if (isFirst && HEADER_SKU_CELLS.has(sku.toLowerCase()) && !/^\d/.test(cells[1] ?? '')) return;

    const row: DealerPriceCsvRow = { line: idx + 1, sku, input, price: null, problem: null };
    if (!sku) row.problem = 'thiếu SKU ở cột đầu';
    else if (cells.length < 2 || cells[1] === '') row.problem = 'thiếu cột giá (dạng "sku,185000")';
    else {
      const price = parseVndAmount(input);
      if (price === null) {
        row.problem =
          cells.length > 2 && delim !== ','
            ? 'thừa cột — mỗi dòng chỉ gồm "sku,giá"'
            : 'giá không đọc được — ghi số đồng nguyên, vd 185000 hoặc 185.000';
      } else if (price <= 0) row.problem = 'giá phải lớn hơn 0';
      else row.price = price;
    }
    rows.push(row);
  });
  return rows;
}

/** Dòng JSON `rows` (API cũ) đi chung đường kiểm với CSV: giá phải là số đồng nguyên dương. */
export function dealerPriceRowsFromJson(rows: { sku?: unknown; price?: unknown }[]): DealerPriceCsvRow[] {
  return rows.map((r, i) => {
    const sku = String(r?.sku ?? '').trim();
    const price = r?.price;
    const ok = typeof price === 'number' && Number.isInteger(price) && price > 0;
    return {
      line: i + 1,
      sku,
      input: String(price ?? ''),
      price: ok ? price : null,
      problem: !sku ? 'thiếu SKU' : ok ? null : 'giá phải là số đồng nguyên dương',
    };
  });
}

export type DealerPriceImportStatus = 'OK' | 'UNCHANGED' | 'NOT_FOUND' | 'INVALID' | 'OUT_OF_RANGE' | 'DUPLICATE';

export type DealerPriceImportRow = {
  line: number;
  sku: string;
  input: string;
  status: DealerPriceImportStatus;
  price: number | null;
  currentPrice: number | null;
  retailPrice: number | null;
  productName: string | null;
  variationName: string | null;
  message: string | null;
  /** Nội bộ: id biến thể để ghi — không trả ra ngoài. */
  variationId?: string;
  dealerPrices?: Record<string, number>;
};

const BLOCKING: ReadonlySet<DealerPriceImportStatus> = new Set(['INVALID', 'OUT_OF_RANGE', 'DUPLICATE']);

export type DealerPricePreview = {
  tierId: string;
  rows: DealerPriceImportRow[];
  counts: Record<DealerPriceImportStatus, number>;
  blocking: number;
  canApply: boolean;
};

type Db = PrismaService | Prisma.TransactionClient;

/** Phân loại từng dòng theo dữ liệu hiện tại. `lock`: khoá các biến thể theo id trước khi đọc (lúc áp, trong transaction). */
export async function classifyDealerPrices(
  db: Db,
  tierId: string,
  parsed: DealerPriceCsvRow[],
  opts: { lock?: boolean } = {},
): Promise<DealerPricePreview> {
  const skuCount = new Map<string, number>();
  for (const r of parsed) if (r.sku) skuCount.set(r.sku, (skuCount.get(r.sku) ?? 0) + 1);
  const skus = [...skuCount.keys()];
  if (opts.lock && skus.length) {
    await db.$queryRaw`SELECT "id" FROM "variations" WHERE "sku" = ANY(${skus}) ORDER BY "id" FOR UPDATE`;
  }
  const variations = skus.length
    ? await db.variation.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true, name: true, retailPrice: true, dealerPrices: true, product: { select: { name: true } } },
      })
    : [];
  const bySku = new Map(variations.map((v) => [v.sku, v]));

  const rows = parsed.map((p): DealerPriceImportRow => {
    const v = bySku.get(p.sku);
    const prices = ((v?.dealerPrices as Record<string, number> | null) ?? {}) as Record<string, number>;
    const current = typeof prices[tierId] === 'number' ? prices[tierId] : null;
    const base = {
      line: p.line,
      sku: p.sku,
      input: p.input,
      price: p.price,
      currentPrice: current,
      retailPrice: v?.retailPrice ?? null,
      productName: v?.product.name ?? null,
      variationName: v?.name ?? null,
    };
    if (p.problem) return { ...base, status: 'INVALID', message: p.problem };
    if ((skuCount.get(p.sku) ?? 0) > 1) return { ...base, status: 'DUPLICATE', message: 'SKU xuất hiện nhiều lần trong file' };
    if (!v) return { ...base, status: 'NOT_FOUND', message: 'không có biến thể nào mang SKU này' };
    const min = Math.ceil(v.retailPrice * DEALER_PRICE_MIN_RATIO);
    if (p.price! < min || p.price! > v.retailPrice) {
      return {
        ...base,
        status: 'OUT_OF_RANGE',
        message: `ngoài khoảng 10–100% giá lẻ (${min.toLocaleString('vi-VN')}–${v.retailPrice.toLocaleString('vi-VN')}đ)`,
      };
    }
    if (current === p.price) return { ...base, status: 'UNCHANGED', message: null };
    return { ...base, status: 'OK', message: null, variationId: v.id, dealerPrices: prices };
  });

  const counts: Record<DealerPriceImportStatus, number> = { OK: 0, UNCHANGED: 0, NOT_FOUND: 0, INVALID: 0, OUT_OF_RANGE: 0, DUPLICATE: 0 };
  for (const r of rows) counts[r.status]++;
  const blocking = rows.filter((r) => BLOCKING.has(r.status)).length;
  return { tierId, rows, counts, blocking, canApply: blocking === 0 && counts.OK > 0 };
}

/** Bỏ trường nội bộ trước khi trả cho web. */
export function publicPreview(p: DealerPricePreview): DealerPricePreview {
  return { ...p, rows: p.rows.map(({ variationId: _id, dealerPrices: _dp, ...r }) => r) };
}
