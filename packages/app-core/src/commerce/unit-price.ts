import { variationPricing, type FlashPriceItem } from '../flash-price';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';

/** Lượng tịnh quy về một chiều: `ml` (thể tích), `g` (khối lượng) hoặc tên món đếm được ("viên", "gói"...). */
export interface NetAmount {
  unit: string;
  qty: number;
}

// Không dùng lookbehind: webview Zalo cũ trên iOS không hiểu cú pháp này. Ranh giới trái được bắt vào nhóm 1 thay cho lookbehind;
// "x" được làm ranh giới để đọc "20x20g". Ranh giới phải: không dính chữ hay số ("2 lớp", "10 gói" không phải lít, gam).
const L = String.raw`(^|[^\p{L}\p{N}.,/]|[x×])`;
const R = String.raw`(?![\p{L}\p{N}])`;
const MEASURE = new RegExp(String.raw`${L}(\d+(?:[.,]\d+)?)\s*(ml|lít|lit|l|kg|gram|gr|g)${R}`, 'giu');
const COUNT = new RegExp(String.raw`${L}(\d+)\s*(viên|miếng|tờ|cuộn|gói|túi)${R}`, 'giu');
// Vỏ đựng đứng sau một số rồi tới lượng: "2 chai 1L", "12 hộp 330ml" là số món của gói.
const BOX = 'chai|hộp|túi|gói|lon|lọ|hũ|hủ|bình|can|tuýp|bịch|vỉ|khay';
const BEFORE = new RegExp(String.raw`(\d+)\s*(?:[x×*]|(?:${BOX})${R})\s*$`, 'iu');
const AFTER = /^\s*[x×*]\s*(\d+)(?![\d.,]|\s*(?:ml|l|g|kg)(?![\p{L}]))/iu;
// Số món còn sót sau khi đã đọc lượng ("2 chai, 500ml", "Combo 2"): giá là của cả gói mà không biết nhân với gì.
// Cũng không đọc: số nhân không dính lượng ("x 12 lốc", "×2 1L") và lượng còn sót không đọc được ("100ml/55ml").
const LEFT = new RegExp(String.raw`\d\s*(?:[x×*]\s*\d|(?:${BOX}|viên|miếng|tờ|cuộn|thỏi|set|lốc|thùng|ml|lít|lit|l|kg|gram|gr|g)${R})|[x×*]\s*\d`, 'iu');
const PACK = new RegExp(String.raw`(?:^|[^\p{L}])(?:combo|bộ|set|lốc|thùng|cặp)${R}`, 'iu');
const FACTOR: Record<string, [string, number]> = { ml: ['ml', 1], l: ['ml', 1e3], lít: ['ml', 1e3], lit: ['ml', 1e3], g: ['g', 1], gr: ['g', 1], gram: ['g', 1], kg: ['g', 1e3] };

/** Số kiểu Việt: "1,5" và "1.5" là 1,5; "1.000"/"2.500" ở đơn vị nhỏ (ml, g) là phân cách nghìn. */
function num(raw: string, factor: number): number {
  const n = Number(factor === 1 && /^\d+[.,]\d{3}$/.test(raw) ? raw.replace(/[.,]/, '') : raw.replace(',', '.'));
  return Math.round(n * factor * 1e3) / 1e3;
}

/** Một chuỗi: lượng đọc được, `null` khi không có gì để đọc, `false` khi có số mà không đọc chắc (gói nhiều món, hai lượng khác nhau). */
function scan(raw: string): NetAmount | null | false {
  const text = raw.normalize('NFC').toLowerCase();
  const measures = [...text.matchAll(MEASURE)];
  const hits = measures.length > 0 ? measures : [...text.matchAll(COUNT)];
  if (hits.length === 0) return PACK.test(text) || /\d/.test(text) ? false : null;
  // Đếm món mà tên còn một đơn vị đo trơ không số ("Hộp g x 10 gói"): tên hỏng, không biết lượng thật.
  if (measures.length === 0 && /(^|[^\p{L}\p{N}])(ml|l|g|gr|kg)(?![\p{L}\p{N}])/u.test(text)) return false;
  // Hai lượng nối bằng "+" hay "&" ("Dầu gội 500ml + Dầu xả 500ml") là hai món, không phải một; "xả & làm bóng 500ml" vẫn là một món.
  if (hits.length > 1 && /[+&]/.test(text)) return false;
  let found: NetAmount | null = null;
  let rest = text;
  for (const m of hits) {
    const [unit, factor] = measures.length > 0 ? FACTOR[m[3]!]! : [m[3]!, 1];
    const start = m.index! + m[1]!.length;
    const end = m.index! + m[0].length;
    const before = BEFORE.exec(text.slice(0, start));
    const after = AFTER.exec(text.slice(end));
    if ((before && after) || (!before && !after && PACK.test(text))) return false;
    const qty = num(m[2]!, factor) * Number(before?.[1] ?? after?.[1] ?? 1);
    if (!(qty > 0) || (found && (found.unit !== unit || found.qty !== qty))) return false;
    found = { unit, qty };
    rest = rest.replace(text.slice(before ? before.index : start, end + (after?.[0].length ?? 0)), ' ');
  }
  return LEFT.test(rest) ? false : found;
}

/**
 * Lượng tịnh của một phân loại: đọc tên phân loại, tên phân loại không có chữ số nào ("Mùi sả", "Mặc định") thì đọc tên sản phẩm. Không đoán:
 * tên phân loại có số mà không đọc chắc ("Combo 2", "A05", "1 set") thì dừng, không lùi về tên sản phẩm (tên sản phẩm ghi lượng của một món,
 * giá lại là của cả gói). Nhận "3 x 500ml", "500ml x 3", "20x20g", "Combo 2 chai 1L", "Thùng 12 hộp 330ml", "1,5L", "Hộp 30 viên".
 */
export function parseNetAmount(variationName: string, productName: string): NetAmount | null {
  const own = scan(variationName ?? '');
  if (own !== null) return own || null;
  return scan(productName ?? '') || null;
}

export interface UnitPriceVariation {
  id: string;
  name: string;
  stock: number;
  /** Giá khách thật sự trả cho một đơn vị ở trang này (Giờ vàng nếu đang chạy), đúng số chip đang ghi. */
  price: number;
}

export interface UnitPriceView {
  /** Dòng dưới giá của phân loại đang chọn: "≈ 12.300đ / 100ml". */
  line: string;
  /** Dòng phụ trong chip của từng phân loại; null khi mọi phân loại cùng một lượng (khác mùi, khác màu) nên dòng chỉ lặp. */
  chips: Record<string, string> | null;
  /** Nhãn "Lợi hơn 18% mỗi 100ml" của đúng một phân loại; null khi không có. */
  better: { id: string; text: string } | null;
}

/** Tên phân loại bỏ lượng: "Da khô – 30ml" và "Da khô – 150ml" cùng loại. */
const kindOf = (name: string) => (name ?? '').normalize('NFC').toLowerCase().replace(MEASURE, '$1').replace(/[\s–-]+/g, ' ').trim();

/**
 * Giá trên 100ml, 100g hay một món, làm tròn để đọc: từ 1.000đ tròn trăm, từ 100đ tròn chục. Bảng so sánh cỡ (API
 * `product-compare.unit.ts`, `roundUnitPrice`) làm tròn đúng luật này để một trang không ghi hai số cho cùng một giá.
 */
export const roundUnitPrice = (v: number) => {
  const step = v >= 1e3 ? 100 : v >= 100 ? 10 : 1;
  return Math.max(step, Math.round(v / step) * step);
};

/**
 * Giá theo đơn vị ở trang chi tiết. Chỉ hiện khi MỌI phân loại đọc được lượng và cùng một chiều; một phân loại không đọc được thì cả sản phẩm
 * không có gì. Nhãn "Lợi hơn": phân loại còn hàng có giá theo đơn vị thấp nhất, khác lượng với phân loại đang chọn và rẻ hơn nó từ 5% trở lên;
 * phần trăm làm tròn xuống để không nói quá. Chỉ là phép chia giá, không phải tuyên bố nào khác.
 */
export function unitPriceView(variations: readonly UnitPriceVariation[], productName: string, selectedId?: string | null): UnitPriceView | null {
  const rows = variations.map((v) => ({ v, a: parseNetAmount(v.name, productName), kind: kindOf(v.name) }));
  const unit = rows[0]?.a?.unit;
  if (!unit || rows.some((r) => !r.a || r.a.unit !== unit || !(r.v.price > 0))) return null;
  // Phân loại không ghi lượng thì mượn lượng ở tên sản phẩm: chỉ tin khi các phân loại cùng giá (khác mùi); khác giá ("Chai nhỏ", "Chai lớn") là khác cỡ.
  if (rows.some((r) => scan(r.v.name ?? '') === null) && rows.some((r) => r.v.price !== rows[0]!.v.price)) return null;
  const per = unit === 'ml' || unit === 'g' ? `100${unit}` : unit;
  const of = (r: (typeof rows)[number]) => (r.v.price / r.a!.qty) * (per === unit ? 1 : 100);
  const text = (r: (typeof rows)[number]) => fillCopy('pdp.unitPrice', { price: vnd(roundUnitPrice(of(r))), per });
  const sel = rows.find((r) => r.v.id === selectedId) ?? rows[0]!;
  // Bằng giá theo đơn vị thì nhãn ưu tiên phân loại cùng loại với cái đang chọn ("Da khô 150ml" khi đang chọn "Da khô 30ml", không sang "Da dầu").
  const other = (r: (typeof rows)[number]) => (r.kind === sel.kind ? 0 : 1);
  const best = rows.filter((r) => r.v.stock > 0).sort((x, y) => of(x) - of(y) || other(x) - other(y))[0];
  // Cộng 1e-9 trước khi làm tròn xuống: 1 − 350/437,5 ra 0,1999…96 trong số thực, không được thành 19%.
  const pct = best && best.a!.qty !== sel.a!.qty ? Math.floor((1 - of(best) / of(sel)) * 100 + 1e-9) : 0;
  return {
    line: text(sel),
    chips: rows.some((r) => r.a!.qty !== sel.a!.qty) ? Object.fromEntries(rows.map((r) => [r.v.id, text(r)])) : null,
    better: pct >= 5 ? { id: best!.v.id, text: fillCopy('pdp.unitBetter', { pct, per }) } : null,
  };
}

/** Như `unitPriceView` nhưng lấy giá từ phân loại thô theo đúng luật Giờ vàng chip đang ghi (`variationPricing`), để trang và bảng chọn chia cùng một giá. */
export function variationUnitPrices(
  variations: readonly { id: string; name: string; stock: number; retailPrice: number; salePrice?: number | null }[],
  flash: readonly FlashPriceItem[],
  productName: string,
  selectedId?: string | null,
): UnitPriceView | null {
  return unitPriceView(
    variations.map((v) => ({ id: v.id, name: v.name, stock: v.stock, price: variationPricing(v, flash).price })),
    productName,
    selectedId,
  );
}
