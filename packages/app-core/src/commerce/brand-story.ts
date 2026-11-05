import { STORY_LIMITS, type HudCalloutPoint, type ProductStoryConfig } from '@tubutree/shared-types';

/**
 * Câu chuyện cấp thương hiệu cho sản phẩm của năm nhãn chủ lực (Sokfarm, BH.NONG, Pơ Lang, Fuwa3e, DURICA) chưa có kịch bản riêng.
 *
 * PROD ghi `brand = "Tubu Tree"` cho mọi sản phẩm nên nhãn chỉ nhận ra được từ tên và slug. Kịch bản đợt đầu (`story-presets-launch`) là
 * của từng sản phẩm cụ thể (nước rửa chén 3,8L, đường hoa dừa...), đem áp cho cả nhãn sẽ ghi sai (nước giặt hương Bạc hà mà ghi "hương dứa"),
 * nên tầng này chỉ nói điều đúng với MỌI sản phẩm của nhãn: tên nhãn, quy cách và hương đọc thẳng từ tên sản phẩm đang xem. Không có
 * nguồn gốc, thành phần, chứng nhận hay công dụng; muốn thêm phải có nguồn do chủ nhãn xác nhận.
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
  /** Khớp trên chuỗi đã bỏ dấu, chữ thường, mọi ký tự không phải chữ số/chữ cái thành một dấu cách. */
  match: RegExp;
}

// "Sokfram" là chính tả đang dùng trong catalog (cột brand cũ), nhận cả hai.
const BRANDS: readonly BrandProfile[] = [
  { id: 'sokfarm', display: 'Sokfarm', match: /\bsokf(?:ar|ra)m\b/ },
  { id: 'bhnong', display: 'BH.NONG', match: /\bbh ?nong\b/ },
  { id: 'polang', display: 'Pơ Lang', match: /\bpo ?lang\b/ },
  { id: 'fuwa3e', display: 'Fuwa3e', match: /\bfuwa ?3e\b/ },
  { id: 'durica', display: 'DURICA', match: /\bdurica\b/ },
];

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function profileOf(p: BrandStoryInput): BrandProfile | null {
  const hay = fold(`${p.brand ?? ''} ${p.name} ${p.slug}`);
  return BRANDS.find((b) => b.match.test(hay)) ?? null;
}

/** Mã nhãn chủ lực của sản phẩm (từ tên, slug hoặc cột brand), null nếu không thuộc năm nhãn. */
export function detectStoryBrand(p: BrandStoryInput): string | null {
  return profileOf(p)?.id ?? null;
}

const UNIT: Record<string, string> = { ml: 'ml', l: 'L', g: 'g', kg: 'kg', gói: 'gói', goi: 'gói' };
// Số có đơn vị đứng riêng: "A08" hay "SRM-2" không phải quy cách vì số dính liền chữ đứng trước.
const SIZE = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s?(ml|kg|g|l|gói|goi)(?![\p{L}\p{N}])/giu;
const ANY_BRAND_WORD = /^(sokfarm|sokfram|fuwa3e|durica|polang|po|bh|bhnong|nong)$/;

/** Quy cách đọc từ tên ("500ml", "3,8L", "12 gói"): tối đa hai, không lặp. */
export function titleSizes(name: string): string[] {
  const out: string[] = [];
  for (const m of name.matchAll(SIZE)) {
    const unit = UNIT[m[2]!.toLowerCase()] ?? m[2]!;
    // "gói" cách số một dấu cách; đơn vị đo (ml, L, g, kg) dính liền như in trên bao bì. Không đọc "thỏi", "chai": trong combo số đó chỉ một phần của bộ.
    const label = unit === 'gói' ? `${m[1]} ${unit}` : `${m[1]}${unit}`;
    if (!out.includes(label)) out.push(label);
    if (out.length >= 2) break;
  }
  return out;
}

/** Hương đọc từ tên: các từ sau "hương" tới khi gặp tên nhãn, chữ số hay dấu ngăn; tối đa hai từ ("Bạc hà", "Cam", "Xuân"). */
export function titleScent(name: string): string | null {
  const tokens = name.split(/\s+/);
  const at = tokens.findIndex((t) => fold(t) === 'huong');
  if (at < 0) return null;
  const words: string[] = [];
  for (const t of tokens.slice(at + 1)) {
    if (words.length >= 2 || /[\d\-–()[\],/&]/.test(t) || ANY_BRAND_WORD.test(fold(t))) break;
    words.push(t);
  }
  return words.length > 0 ? words.join(' ').slice(0, STORY_LIMITS.maxLabel) : null;
}

const SLOTS: readonly { x: number; y: number; side: 'left' | 'right' }[] = [
  { x: 26, y: 34, side: 'left' },
  { x: 74, y: 52, side: 'right' },
  { x: 26, y: 72, side: 'left' },
];

/** Kịch bản cấp nhãn: ba điểm chỉ trên ảnh (Thương hiệu, Quy cách, Hương) lấy từ tên sản phẩm; null khi không thuộc năm nhãn chủ lực. */
export function buildBrandStoryConfig(p: BrandStoryInput): ProductStoryConfig | null {
  const brand = profileOf(p);
  if (!brand) return null;
  const facts: { label: string; value: string }[] = [{ label: 'Thương hiệu', value: brand.display }];
  const sizes = titleSizes(p.name);
  if (sizes.length > 0) facts.push({ label: 'Quy cách', value: sizes.join(' / ') });
  const scent = titleScent(p.name);
  if (scent) facts.push({ label: 'Hương', value: scent });
  const points: HudCalloutPoint[] = facts.map((f, i) => {
    const slot = SLOTS[i]!;
    return { id: `b${i + 1}`, xPct: slot.x, yPct: slot.y, label: f.label, value: f.value.slice(0, STORY_LIMITS.maxLabel), side: slot.side };
  });
  return { version: 1, enabled: true, scenes: [{ kind: 'hud_callouts', points, closing: `${brand.display}, có tại Tubu Tree`.slice(0, STORY_LIMITS.maxClosing) }] };
}
