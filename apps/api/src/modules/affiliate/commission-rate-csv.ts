import { splitSkuCsvLine } from '../../common/sku-csv';

/**
 * % hoa hồng CTV của biến thể (`Variation.affiliateRate`) là PHẦN TRĂM: 10 nghĩa là 10% — createCommissionForOrder tính
 * `floor(tiền dòng × rate / 100)`. Khác các khoá cấu hình lưu phân số (0.1), nên luật nhập ghi rõ đơn vị ở mọi câu lỗi.
 */

export const AFFILIATE_MAX_RATE_KEY = 'affiliate.max_rate_pct';
/** Trần mặc định khi chưa có khoá cấu hình: chặn gõ nhầm (100 thay vì 10), không phải mức kinh doanh. */
export const DEFAULT_AFFILIATE_MAX_RATE_PCT = 50;
/**
 * Số chữ số thập phân tối đa của một mức %: 0 = chỉ số nguyên. Chặn gõ phân số kiểu cấu hình (0.1 thay vì 10) và giữ mức %
 * CTV đọc được ngay.
 */
export const RATE_MAX_DECIMALS = 0;
/** Gợi ý kèm mọi câu lỗi về dạng số của mức %. */
export const RATE_INPUT_HINT = 'nhập số nguyên, vd 10 cho 10%';
/** Một lần nhập CSV tối đa ngần này dòng có dữ liệu — danh mục Tubu vài trăm biến thể. */
export const RATE_CSV_MAX_ROWS = 5000;
/** Chiều dài tối đa của nội dung CSV (ký tự) — chặn ở DTO. */
export const RATE_CSV_MAX_LENGTH = 300_000;

/** Lỗi của một mức %, null = hợp lệ. `max` là trần đang áp. */
export function rateProblem(rate: unknown, max: number): string | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return `phải là số phần trăm — ${RATE_INPUT_HINT}`;
  if (rate < 0) return 'không được âm';
  if (Math.round(rate * 10 ** RATE_MAX_DECIMALS) / 10 ** RATE_MAX_DECIMALS !== rate) {
    return RATE_MAX_DECIMALS === 0 ? `không phải số nguyên — ${RATE_INPUT_HINT}` : `tối đa ${RATE_MAX_DECIMALS} chữ số thập phân`;
  }
  if (rate > max) return `vượt trần ${max}% (khoá cấu hình ${AFFILIATE_MAX_RATE_KEY})`;
  return null;
}

/** Trần đọc từ cấu hình; giá trị hỏng (không phải số 0–100) thì dùng mặc định thay vì mở toang hay khoá hết. */
export function sanitizeMaxRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_AFFILIATE_MAX_RATE_PCT;
}

export type RateCsvRow = {
  /** Số dòng trong nội dung dán (bắt đầu từ 1), để admin tìm lại trong Excel. */
  line: number;
  sku: string;
  /** Ô % đúng như admin gõ. */
  input: string;
  rate: number | null;
  /** Ô % là từ khoá "mặc định": xoá % riêng của biến thể (rate = null) thay vì đặt số. */
  clear: boolean;
  /** Lỗi định dạng (thiếu cột, không phải số…), null = đọc được. Trần và SKU kiểm sau, ở service. */
  problem: string | null;
};

/** Từ khoá ở ô % để đưa biến thể về mức mặc định (xoá % riêng). */
export const CLEAR_KEYWORDS: ReadonlySet<string> = new Set(['mặc định', 'mac dinh', 'macdinh', 'default']);

/** Ô đầu của dòng tiêu đề Excel hay gặp. So nguyên ô (không so tiền tố) để SKU thật như "MA001" không bị coi là tiêu đề. */
const HEADER_SKU_CELLS = new Set(['sku', 'mã', 'ma', 'mã sku', 'ma sku', 'mã hàng', 'ma hang', 'mã sp', 'ma sp']);

/**
 * Đọc CSV "sku,%" dán từ Excel. Cột tách bằng tab, dấu chấm phẩy hoặc dấu phẩy (xét theo từng dòng: có tab thì tách tab, có `;`
 * thì tách `;`, còn lại tách `,`; ô trong ngoặc kép được bỏ ngoặc — splitSkuCsvLine). Ô % nhận `10`, `10%`. Số lẻ (`7.5`, `0.1`, hay `7,5` khi tách bằng `;`/tab hoặc nằm trong ngoặc kép) vẫn đọc
 * ra số để bước kiểm mức báo "không phải số nguyên" kèm gợi ý, thay vì câu chung "không phải số". Dòng đầu là tiêu đề (cột đầu đúng là "SKU"/"Mã"/"Mã hàng"… và cột % không phải số) thì bỏ. Không bao giờ bỏ im lặng một dòng có dữ liệu: dòng đọc
 * không được trả về kèm `problem`.
 */
export function parseRateCsv(csv: string): RateCsvRow[] {
  const rows: RateCsvRow[] = [];
  const lines = csv.split(/\r?\n/);
  let seenData = false;
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const { delim, cells } = splitSkuCsvLine(line);
    const sku = cells[0] ?? '';
    const input = cells.length >= 2 ? cells.slice(1).join(delim) : '';
    const isFirst = !seenData;
    seenData = true;
    if (isFirst && HEADER_SKU_CELLS.has(sku.toLowerCase()) && !/^\d/.test(cells[1] ?? '')) return;

    const row: RateCsvRow = { line: idx + 1, sku, input, rate: null, clear: false, problem: null };
    if (!sku) row.problem = 'thiếu SKU ở cột đầu';
    else if (cells.length < 2 || cells[1] === '') row.problem = 'thiếu cột % (dạng "sku,10")';
    else if (cells.length > 2) {
      row.problem =
        delim === ',' && cells.length === 3 && /^\d+%?$/.test(cells[2] ?? '')
          ? `có dấu phẩy trong số — ${RATE_INPUT_HINT}`
          : 'thừa cột — mỗi dòng chỉ gồm "sku,%"';
    } else {
      const cell = (cells[1] ?? '').replace(/%$/, '').trim();
      const normalized = cell.replace(',', '.');
      if (CLEAR_KEYWORDS.has(cell.toLowerCase())) row.clear = true;
      else if (!/^\d+(\.\d+)?$/.test(normalized)) row.problem = `cột % không phải số — ${RATE_INPUT_HINT}`;
      else row.rate = Number(normalized);
    }
    rows.push(row);
  });
  return rows;
}
