import { Allow } from 'class-validator';
import { ECO_LIMITS, isEcoFactKind, type EcoFactKindName } from './eco-facts.rules';

/** Một dòng nhập (form hoặc CSV), đã kiểm kiểu và độ dài. Chưa đủ điều kiện duyệt vẫn lưu được (nháp), `approvalBlockers` quyết lúc duyệt. */
export interface EcoFactInput {
  productSlug: string;
  variationSku: string | null;
  kind: EcoFactKindName;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
  sourceNote: string;
}

/**
 * Thân POST/PATCH `/admin/eco-facts`. Chỉ khai khoá để ValidationPipe toàn cục (whitelist, chặn trường lạ) cho qua; kiểu và giới hạn kiểm ở
 * `parseEcoFactInput` để lỗi nói đúng trường bằng tiếng Việt. Mọi trường `unknown`: null là giá trị bộ đọc xử lý có chủ ý (bỏ chữ, bỏ số).
 */
export class EcoFactBodyDto {
  @Allow() productSlug?: unknown;
  @Allow() variationSku?: unknown;
  @Allow() kind?: unknown;
  @Allow() valueGrams?: unknown;
  @Allow() baselineText?: unknown;
  @Allow() label?: unknown;
  @Allow() co2Grams?: unknown;
  @Allow() sourceUrl?: unknown;
  @Allow() sourceNote?: unknown;
  /** Chỉ PATCH: `updatedAt` của bản admin đang sửa (chặn ghi đè lần sửa chen giữa). */
  @Allow() expectedUpdatedAt?: unknown;
}

export const CSV_HEADER = ['productSlug', 'variationSku', 'kind', 'valueGrams', 'baselineText', 'label', 'co2Grams', 'sourceUrl', 'sourceNote'] as const;
export const CSV_MAX_ROWS = 1_000;
export const CSV_MAX_CHARS = 300_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number, name: string): Parsed<string | null> => {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${name} phải là chữ.` };
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) return { ok: false, error: `${name} dài quá ${max} ký tự.` };
  return { ok: true, value: s === '' ? null : s };
};

const grams = (v: unknown, name: string): Parsed<number | null> => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > ECO_LIMITS.maxGrams) return { ok: false, error: `${name} phải là số gam nguyên từ 0 đến ${ECO_LIMITS.maxGrams}.` };
  return { ok: true, value: n === 0 ? null : n };
};

/** Đọc thân form hoặc một dòng CSV đã tách cột. Khoá lạ bị bỏ qua; sai kiểu, quá dài hay loại không có thì trả lỗi tiếng Việt. */
export function parseEcoFactInput(body: unknown): Parsed<EcoFactInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Thiếu dữ liệu.' };
  const b = body as Record<string, unknown>;
  const slug = text(b.productSlug, 200, 'Mã sản phẩm (slug)');
  if (!slug.ok) return slug;
  if (!slug.value) return { ok: false, error: 'Thiếu mã sản phẩm (slug).' };
  const sku = text(b.variationSku, 100, 'SKU phân loại');
  if (!sku.ok) return sku;
  const kind = typeof b.kind === 'string' ? b.kind.trim().toUpperCase() : b.kind;
  if (!isEcoFactKind(kind)) return { ok: false, error: 'Loại sự thật không có trong danh sách.' };
  const value = grams(b.valueGrams, 'Số gam nhựa giảm');
  if (!value.ok) return value;
  const co2 = grams(b.co2Grams, 'Số gam CO₂');
  if (!co2.ok) return co2;
  const baseline = text(b.baselineText, ECO_LIMITS.baselineText, 'Mốc so sánh');
  if (!baseline.ok) return baseline;
  const label = text(b.label, ECO_LIMITS.label, 'Chữ hiển thị');
  if (!label.ok) return label;
  const url = text(b.sourceUrl, ECO_LIMITS.sourceUrl, 'Link nguồn');
  if (!url.ok) return url;
  const note = text(b.sourceNote, ECO_LIMITS.sourceNote, 'Ghi chú nguồn');
  if (!note.ok) return note;
  if (value.value !== null && kind !== 'PLASTIC_AVOIDED') return { ok: false, error: 'Số gam nhựa chỉ dùng cho loại Giảm nhựa.' };
  return {
    ok: true,
    value: {
      productSlug: slug.value,
      variationSku: sku.value,
      kind,
      valueGrams: value.value,
      baselineText: baseline.value,
      label: label.value,
      co2Grams: co2.value,
      sourceUrl: url.value ?? '',
      sourceNote: note.value ?? '',
    },
  };
}

/** Tách CSV (RFC 4180: dấu phẩy, ngoặc kép, "" trong ngoặc là một dấu ngoặc, xuống dòng trong ngoặc giữ nguyên). Bỏ BOM và dòng trống. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** Dòng CSV thành đối tượng theo tiêu đề; tiêu đề phải có đủ `productSlug`, `kind`. Cột lạ bị bỏ qua. */
export function csvRecords(input: string): { ok: true; records: { line: number; data: Record<string, string> }[] } | { ok: false; error: string } {
  if (input.length > CSV_MAX_CHARS) return { ok: false, error: `Tệp CSV dài quá ${CSV_MAX_CHARS} ký tự.` };
  const rows = parseCsv(input);
  if (rows.length === 0) return { ok: false, error: 'Tệp CSV trống.' };
  const header = (rows[0] ?? []).map((h) => h.trim());
  if (!header.includes('productSlug') || !header.includes('kind')) return { ok: false, error: `Dòng đầu cần các cột: ${CSV_HEADER.join(', ')}.` };
  if (rows.length - 1 > CSV_MAX_ROWS) return { ok: false, error: `Tối đa ${CSV_MAX_ROWS} dòng mỗi lần nhập.` };
  return {
    ok: true,
    records: rows.slice(1).map((r, i) => ({ line: i + 2, data: Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])) })),
  };
}
