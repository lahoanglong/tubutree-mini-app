import { STORY_LIMITS, type HudCalloutPoint, type ProductStoryConfig } from '@tubutree/shared-types';

/**
 * Câu chuyện cấp thương hiệu cho sản phẩm của sáu nhãn chủ lực (Sokfarm, BH.NONG, Pơ Lang, Fuwa3e, DURICA, Pineboo) chưa có kịch bản riêng.
 *
 * PROD ghi `brand = "Tubu Tree"` cho mọi sản phẩm nên nhãn chỉ nhận ra được từ tên sản phẩm (và cột brand khi nó đúng nhãn). Kịch bản đợt đầu (`story-presets-launch`) là
 * của từng sản phẩm cụ thể (nước rửa chén 3,8L, đường hoa dừa...), đem áp cho cả nhãn sẽ ghi sai (nước giặt hương Bạc hà mà ghi "hương dứa"),
 * nên tầng này chỉ nói điều đúng với MỌI sản phẩm của nhãn: tên nhãn, và (khi chỉ có một phân loại) quy cách và hương đọc thẳng từ tên
 * sản phẩm đang xem. Không có nguồn gốc, thành phần, chứng nhận hay công dụng; muốn thêm phải có nguồn do chủ nhãn xác nhận.
 */
export interface BrandStoryInput {
  slug: string;
  name: string;
  brand?: string | null;
}

interface BrandProfile {
  id: string;
  /** Tên hiển thị ở điểm "Thương hiệu". */
  display: string;
  /** Khớp trên chuỗi đã bỏ dấu, chữ thường, giữ dấu chấm và gạch nối (tên "BH.NONG", "Pơ-Lang"); "BH nóng" có dấu cách không phải nhãn. */
  match: RegExp;
}

// "Sokfram" là chính tả đang dùng trong catalog (cột brand cũ), nhận cả hai.
const BRANDS: readonly BrandProfile[] = [
  { id: 'sokfarm', display: 'Sokfarm', match: /\bsokf(?:ar|ra)m\b/ },
  { id: 'bhnong', display: 'BH.NONG', match: /\bbh[.-]?nong\b/ },
  { id: 'polang', display: 'Pơ Lang', match: /\bpo[ -]?lang\b/ },
  { id: 'fuwa3e', display: 'Fuwa3e', match: /\bfuwa[ -]?3e\b/ },
  { id: 'durica', display: 'DURICA', match: /\bdurica\b/ },
  { id: 'pineboo', display: 'Pineboo', match: /\bpine[ -]?boo\b/ },
];

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Nhãn nhận từ tên và cột brand, là thứ khách đọc. Không dùng slug: slug của "BH nóng giòn" cũng là `bh-nong` nên mở lại khớp nhầm, mà mọi
 * sản phẩm của sáu nhãn trên PROD đã có tên nhãn trong tên. Khớp nhiều nhãn (combo hai nhãn) thì không đoán: null.
 */
function profileOf(p: BrandStoryInput): BrandProfile | null {
  const hay = fold(`${p.brand ?? ''} ${p.name}`);
  const hits = BRANDS.filter((b) => b.match.test(hay));
  return hits.length === 1 ? hits[0]! : null;
}

/** Mã nhãn chủ lực của sản phẩm (từ tên hoặc cột brand), null nếu không thuộc sáu nhãn. */
export function detectStoryBrand(p: BrandStoryInput): string | null {
  return profileOf(p)?.id ?? null;
}

const UNIT: Record<string, string> = { ml: 'ml', l: 'L', lít: 'L', lit: 'L', g: 'g', gr: 'g', kg: 'kg', gói: 'gói', goi: 'gói' };
// Số có đơn vị đứng riêng: "A08" hay "SRM-2" không phải quy cách vì số dính liền chữ đứng trước. Thứ tự: đơn vị dài trước đơn vị ngắn.
const SIZE = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s?(ml|kg|gr|g|lít|lit|l|gói|goi)(?![\p{L}\p{N}])/giu;
// Từ "tặng", "kèm" và dấu "+" mở đầu phần hàng đi kèm: con số sau đó không phải quy cách của sản phẩm chính.
const ADDON = /(?<![\p{L}])(?:tặng|kèm)(?![\p{L}])|\+/iu;

/** Quy cách đọc từ tên ("500ml", "3,8L", "12 gói"): tối đa hai, không lặp, dừng ở phần tặng kèm. */
export function titleSizes(name: string): string[] {
  const main = name.normalize('NFC').split(ADDON)[0] ?? '';
  const out: string[] = [];
  for (const m of main.matchAll(SIZE)) {
    const unit = UNIT[m[2]!.toLowerCase()] ?? m[2]!;
    // "gói" cách số một dấu cách; đơn vị đo (ml, L, g, kg) dính liền như in trên bao bì. Không đọc "thỏi", "chai": trong combo số đó chỉ một phần của bộ.
    const label = unit === 'gói' ? `${m[1]} ${unit}` : `${m[1]}${unit}`;
    if (!out.includes(label)) out.push(label);
    if (out.length >= 2) break;
  }
  return out;
}

// Chỉ các hương thông dụng, chữ thường có dấu. "hương nhu", "hương thảo", "hương liệu" là cây hay từ khác, không phải hương thơm: không có ở đây.
const SCENTS = ['bạc hà', 'cam', 'xuân', 'chanh', 'sả chanh', 'sả', 'quế', 'bưởi', 'dứa', 'dừa', 'trà xanh', 'nhài', 'hoa nhài', 'lavender', 'vani', 'gừng'];
const PUNCT_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const JOINER = /^(\+|&|và|\/)$/i;

/**
 * Hương đọc từ tên: một hương trong danh sách cho phép đứng ngay sau chữ "hương" ("Bạc hà", "Cam", "Xuân"). Không đoán hương lạ; "không hương",
 * hai hương nối nhau ("hương Chanh + Sả") hay hương nằm sau dấu ngăn thì null.
 */
export function titleScent(name: string): string | null {
  const tokens = name.normalize('NFC').split(/\s+/);
  const at = tokens.findIndex((t) => fold(t) === 'huong');
  if (at < 0) return null;
  if (at > 0 && fold(tokens[at - 1]!) === 'khong') return null;
  const first = tokens[at + 1];
  if (first === undefined) return null;
  const c1 = first.replace(PUNCT_EDGE, '').toLowerCase();
  const second = tokens[at + 2];
  // Từ thứ hai chỉ ghép khi từ thứ nhất không dính dấu ngăn ở cuối ("Bạc hà," thì dừng ở "Bạc").
  const joinable = second !== undefined && first.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase() === c1;
  const c2 = second !== undefined ? second.replace(PUNCT_EDGE, '').toLowerCase() : '';
  let words: string[] | null = null;
  if (joinable && c2 && SCENTS.includes(`${c1} ${c2}`)) words = [c1, c2];
  else if (SCENTS.includes(c1)) words = [c1];
  if (!words) return null;
  const after = tokens[at + 1 + words.length];
  if (after !== undefined && (JOINER.test(after) || SCENTS.includes(after.replace(PUNCT_EDGE, '').toLowerCase()))) return null;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const SLOTS: readonly { x: number; y: number; side: 'left' | 'right' }[] = [
  { x: 26, y: 34, side: 'left' },
  { x: 74, y: 52, side: 'right' },
  { x: 26, y: 72, side: 'left' },
];

/**
 * Kịch bản cấp nhãn: điểm chỉ trên ảnh lấy từ tên sản phẩm; null khi không thuộc sáu nhãn chủ lực.
 * Có từ hai phân loại thì chỉ ghi Thương hiệu (quy cách và hương trong tên chỉ đúng với một phân loại, mà vòng cung cho khách đổi sang loại khác).
 * Một phân loại mà tên không có quy cách lẫn hương thì không dựng khối: nút "Xem câu chuyện" sẽ hứa nhiều hơn một dòng tên nhãn.
 */
export function buildBrandStoryConfig(p: BrandStoryInput, variationCount = 1): ProductStoryConfig | null {
  const brand = profileOf(p);
  if (!brand) return null;
  const facts: { label: string; value: string }[] = [{ label: 'Thương hiệu', value: brand.display }];
  if (variationCount < 2) {
    const sizes = titleSizes(p.name);
    if (sizes.length > 0) facts.push({ label: 'Quy cách', value: sizes.join(' / ') });
    const scent = titleScent(p.name);
    if (scent) facts.push({ label: 'Hương', value: scent });
    if (facts.length < 2) return null;
  }
  const points: HudCalloutPoint[] = facts.map((f, i) => {
    const slot = SLOTS[i]!;
    return { id: `b${i + 1}`, xPct: slot.x, yPct: slot.y, label: f.label, value: f.value.slice(0, STORY_LIMITS.maxLabel), side: slot.side };
  });
  return { version: 1, enabled: true, scenes: [{ kind: 'hud_callouts', points, closing: `${brand.display}, có tại Tubu Tree`.slice(0, STORY_LIMITS.maxClosing) }] };
}
