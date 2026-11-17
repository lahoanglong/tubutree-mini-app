import { catalogBrandSpellings } from '@tubutree/shared-types';
import { foldVietnamese } from './search-text';

/** Lượng quy về đơn vị gốc: ml cho chất lỏng, g cho khối lượng. */
export interface Measure {
  unit: 'ml' | 'g';
  qty: number;
}

export type UnitPrice = { per: '100ml' | '100g'; value: number };

const BASE_OF: Record<string, { unit: Measure['unit']; factor: number }> = {
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  lit: { unit: 'ml', factor: 1000 },
  g: { unit: 'g', factor: 1 },
  gr: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
};

// Chạy trên chữ đã gấp dấu ("lít" → "lit"). Lookbehind không cho số dính sau chữ ("Fuwa3e") hay sau dấu thập phân; lookahead không cho
// đơn vị là đầu một từ khác ("2 lớp", "10 gói").
const MEASURE_RE = /(?<![a-z0-9.,])(\d+(?:[.,]\d+)?)\s*(ml|lit|l|kg|gram|gr|g)(?![a-z0-9])/g;

// Gói nhiều món: giá là của cả gói nên chia theo dung tích một chai sẽ sai.
const PACK_RE = /\bcombo\b|\b(?:loc|set)\s*\d|\d\s*[x×*]\s*\d|\d\s*(?:ml|lit|l|kg|gram|gr|g)\s*[x×*]\s*\d|(?<![a-z0-9])[x×]\s?\d+(?![a-z0-9.,])/;

type Scan = { kind: 'none' } | { kind: 'unclear' } | { kind: 'ok'; measure: Measure };

function toBaseQty(raw: string, factor: number): number {
  // "1.000ml"/"2.500g": dấu chấm/phẩy theo sau đúng 3 chữ số ở đơn vị nhỏ là phân cách hàng nghìn kiểu Việt, không phải thập phân.
  const thousands = factor === 1 && /^\d+[.,]\d{3}$/.test(raw);
  const n = Number(thousands ? raw.replace(/[.,]/, '') : raw.replace(',', '.'));
  // Làm tròn để 3.8 × 1000 ra đúng 3800 (không phải 3799,9999…) và hai cách ghi cùng một lượng so bằng nhau.
  return Math.round(n * factor * 1000) / 1000;
}

function scan(text: string): Scan {
  const folded = foldVietnamese(text ?? '');
  if (PACK_RE.test(folded)) return { kind: 'unclear' };
  let found: Measure | null = null;
  for (const m of folded.matchAll(MEASURE_RE)) {
    const base = BASE_OF[m[2]!]!;
    const qty = toBaseQty(m[1]!, base.factor);
    if (!(qty > 0)) return { kind: 'unclear' };
    // "3.8L (3800ml)" ghi hai lần cùng một lượng thì vẫn dùng được; hai lượng khác nhau thì không biết giá ứng với lượng nào.
    if (found && (found.unit !== base.unit || found.qty !== qty)) return { kind: 'unclear' };
    found = { unit: base.unit, qty };
  }
  return found ? { kind: 'ok', measure: found } : { kind: 'none' };
}

/** Dung tích/khối lượng ghi trong một chuỗi; null khi không có, khi là gói nhiều món, hay khi có nhiều số đo khác nhau. */
export function parseMeasure(text: string): Measure | null {
  const s = scan(text);
  return s.kind === 'ok' ? s.measure : null;
}

/**
 * Lượng của phân loại dùng để so: lấy từ tên phân loại, tên phân loại không ghi lượng ("Mùi sả") thì lấy từ tên sản phẩm. Tên phân loại
 * là gói nhiều món hay mâu thuẫn thì dừng ở đó, không lùi về tên sản phẩm (tên sản phẩm ghi lượng một chai, giá lại là của cả gói).
 */
export function measureOf(variationName: string, productName: string): Measure | null {
  const v = scan(variationName);
  if (v.kind === 'ok') return v.measure;
  if (v.kind === 'unclear') return null;
  return parseMeasure(productName);
}

const decimal = (n: number): string => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** "3,8L", "1L", "500ml", "1,5kg", "250g". */
export function formatSize(m: Measure): string {
  if (m.unit === 'ml') return m.qty >= 1000 ? `${decimal(m.qty / 1000)}L` : `${decimal(m.qty)}ml`;
  return m.qty >= 1000 ? `${decimal(m.qty / 1000)}kg` : `${decimal(m.qty)}g`;
}

/** Giá trên 100ml/100g; null khi món không tách được lượng, khi món đang xem không tách được, hay khi hai món khác loại đơn vị. */
export function unitPriceOf(price: number, measure: Measure | null, reference: Measure | null): UnitPrice | null {
  if (!measure || !reference || measure.unit !== reference.unit) return null;
  return { per: measure.unit === 'ml' ? '100ml' : '100g', value: Math.round((price / measure.qty) * 100) };
}

/** Số từ đầu của tên tạo thành nhóm. */
export const NAME_GROUP_WORDS = 3;

const words = (s: string): string[] => foldVietnamese(s ?? '').split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Nhóm tên để biết hai món có cùng loại hàng: tối đa NAME_GROUP_WORDS từ đầu (không dấu, chữ thường), dừng ở từ đầu tiên là tên nhãn
 * (mọi cách ghi của nhãn, kể cả viết liền) hoặc có chữ số. "Nước rửa chén Fuwa3e 3.8L" → "nuoc rua chen". Tên mở đầu bằng nhãn cho
 * chuỗi rỗng: không đủ dữ kiện để biết là loại hàng gì.
 */
export function nameGroup(name: string, brand: string): string {
  const w = words(name);
  const brandSeqs = catalogBrandSpellings(brand ?? '')
    .map(words)
    .filter((seq) => seq.length > 0);
  const out: string[] = [];
  for (let i = 0; i < w.length && out.length < NAME_GROUP_WORDS; i++) {
    const word = w[i]!;
    if (/\d/.test(word)) break;
    if (brandSeqs.some((seq) => word === seq.join('') || seq.every((s, k) => w[i + k] === s))) break;
    out.push(word);
  }
  return out.join(' ');
}
