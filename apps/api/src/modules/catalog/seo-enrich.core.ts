import { claimsIn, normalizeCopyText, sanitizeCopyText } from '@tubutree/shared-types';
import { foldVietnamese } from './search-text';

/** Trần hiển thị: Google cắt tiêu đề quanh 60 ký tự và mô tả quanh 155, nên không đặt cao hơn. */
export const SEO_TITLE_MAX = 65;
export const SEO_DESC_MAX = 155;
export const SEO_BRAND = 'Tubu Tree';
/** Tên thương hiệu dài hơn mức này thì hậu tố tiêu đề dùng "Tubu Tree", để tên sản phẩm còn chỗ. */
const BRAND_SUFFIX_MAX = 32;
const VARIANT_NAMES_MAX = 4;
/** Phần câu mô tả còn lại ngắn hơn mức này thì bỏ hẳn câu, không cắt thành mẩu cụt. */
const MIN_SENTENCE_ROOM = 40;

export interface SeoProductInput {
  name: string;
  brand: string | null;
  shortDesc: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDesc: string | null;
  /** `name` kiểu `unknown`: đồng bộ Pancake từng ghi "[object Object]" hay đối tượng vào tên phân loại. */
  variations: ReadonlyArray<{ name: unknown; isActive: boolean }>;
}

export interface SeoDraft {
  metaTitle: string;
  metaDesc: string;
}

const fold = (s: string): string => foldVietnamese(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Chữ một dòng như người đọc thấy: bỏ thẻ HTML, giải mã thực thể, gộp khoảng trắng. Không phải chuỗi thì rỗng. */
function flat(v: unknown): string {
  return typeof v === 'string' ? normalizeCopyText(v).replace(/\s+/g, ' ').trim() : '';
}

export const isBlank = (v: string | null | undefined): boolean => typeof v !== 'string' || v.trim() === '';

const TRAILING_JUNK = /[\s,;:.\-–—|/&]+$/;

/** Cắt ở ranh giới từ để kết quả ≤ `max`; có `ellipsis` thì thêm "…" (vẫn ≤ `max`). Một từ dài hơn `max` bị cắt cứng. */
function cutWords(text: string, max: number, ellipsis = false): string {
  if (text.length <= max) return text;
  const budget = ellipsis ? max - 1 : max;
  const head = text.slice(0, budget);
  const cut = text[budget] === ' ' ? head : head.includes(' ') ? head.slice(0, head.lastIndexOf(' ')) : head;
  const tidy = cut.replace(TRAILING_JUNK, '');
  return ellipsis ? `${tidy}…` : tidy;
}

/** Thương hiệu hiển thị: rỗng khi trống hoặc chính là Tubu Tree (không lặp tên cửa hàng làm thương hiệu). */
function realBrand(brand: string | null): string {
  const b = flat(brand);
  return b === '' || fold(b) === fold(SEO_BRAND) ? '' : b;
}

export function buildMetaTitle(p: Pick<SeoProductInput, 'name' | 'brand'>): string {
  const name = flat(p.name);
  const own = realBrand(p.brand);
  const brand = own !== '' && own.length <= BRAND_SUFFIX_MAX ? own : SEO_BRAND;
  if (name === '') return brand;
  const suffix = ` | ${brand}`;
  return `${cutWords(name, SEO_TITLE_MAX - suffix.length)}${suffix}`;
}

const SENTENCE = /[\s\S]*?[.!?…](?=\s|$)|[\s\S]+$/g;

/**
 * Câu đầu dùng được của mô tả ngắn, rồi của mô tả đầy đủ. Câu có tuyên bố y tế, chứng nhận, "hữu cơ", "thiên nhiên" bị bỏ (kể cả khi nguồn có viết):
 * meta mô tả hiện ngoài Google, không có giấy tờ đi kèm, nên chỉ lấy câu sạch kế tiếp. Không có câu nào thì trả chuỗi rỗng.
 */
function leadSentence(p: Pick<SeoProductInput, 'name' | 'shortDesc' | 'description'>): string {
  const name = fold(flat(p.name));
  for (const src of [p.shortDesc, p.description]) {
    if (typeof src !== 'string') continue;
    const kept = sanitizeCopyText(src, 'strict').text;
    for (const raw of kept.match(SENTENCE) ?? []) {
      const s = raw.replace(/^[•\s]+/, '').trim();
      if (s.length < 8 || fold(s) === name) continue;
      return /[.!?…]$/.test(s) ? s : `${s}.`;
    }
  }
  return '';
}

/** Tên phân loại thật: đang bán, là chuỗi, không phải "[object Object]", không trùng tên sản phẩm hay nhau, không dính tuyên bố. */
function variantNames(p: Pick<SeoProductInput, 'name' | 'variations'>): string[] {
  const seen = new Set([fold(flat(p.name))]);
  const out: string[] = [];
  for (const v of p.variations) {
    if (!v.isActive || typeof v.name !== 'string') continue;
    const name = flat(v.name);
    const key = fold(name);
    if (name === '' || name.includes('[object Object]') || key === '' || seen.has(key) || claimsIn(name).length > 0) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= VARIANT_NAMES_MAX) break;
  }
  return out;
}

export function buildMetaDesc(p: Pick<SeoProductInput, 'name' | 'brand' | 'shortDesc' | 'description' | 'variations'>): string {
  const name = flat(p.name).replace(TRAILING_JUNK, '');
  const brand = realBrand(p.brand);
  const lead = brand !== '' && !fold(name).includes(fold(brand)) ? `${name} của ${brand}.` : `${name}.`;
  let out = cutWords(lead, SEO_DESC_MAX, true);

  const variants = variantNames(p);
  const pieces: Array<{ text: string; cuttable: boolean }> = [
    { text: leadSentence(p), cuttable: true },
    { text: variants.length > 0 ? `Phân loại: ${variants.join(', ')}.` : '', cuttable: false },
    { text: `Mua tại ${SEO_BRAND}.`, cuttable: false },
  ];
  for (const piece of pieces) {
    if (piece.text === '') continue;
    const next = `${out} ${piece.text}`;
    if (next.length <= SEO_DESC_MAX) {
      out = next;
      continue;
    }
    const room = SEO_DESC_MAX - out.length - 1;
    if (piece.cuttable && room >= MIN_SENTENCE_ROOM) {
      out = `${out} ${cutWords(piece.text, room, true)}`;
      break;
    }
  }
  return out;
}

/** `onlyMissing`: trường người đã điền (kể cả sửa tay) giữ nguyên, chỉ điền trường còn trống. Không có `onlyMissing` thì sinh lại cả hai. */
export function draftSeo(p: SeoProductInput, opts: { onlyMissing: boolean }): SeoDraft {
  return {
    metaTitle: opts.onlyMissing && !isBlank(p.metaTitle) ? (p.metaTitle as string) : buildMetaTitle(p),
    metaDesc: opts.onlyMissing && !isBlank(p.metaDesc) ? (p.metaDesc as string) : buildMetaDesc(p),
  };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Nhóm tuyên bố trong `text` sau khi gỡ tên sản phẩm (cả các đoạn đầu của tên, vì tiêu đề có thể cắt tên) và thương hiệu:
 * chữ như "hữu cơ" nằm trong tên thật của sản phẩm là nguồn thật, còn chữ admin thêm vào ngoài tên thì phải qua bộ chặn.
 */
export function claimsOutsideName(text: string, name: string, brand: string | null): string[] {
  const words = flat(name).split(' ').filter(Boolean);
  const phrases = [flat(brand), ...words.map((_, i) => words.slice(0, words.length - i).join(' '))].filter((s) => s !== '');
  let rest = normalizeCopyText(text);
  for (const ph of phrases.sort((a, b) => b.length - a.length)) rest = rest.replace(new RegExp(escapeRe(ph), 'giu'), ' ');
  return claimsIn(rest);
}

const MARKUP = /<[^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);/i;

/** Lý do chữ SEO không dùng được (độ dài, trống, mã HTML, "[object Object]"); mảng rỗng là dùng được. Chưa xét tuyên bố. */
export function seoTextProblems(label: string, text: string, max: number): string[] {
  const flatText = text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (flatText === '') out.push(`${label} đang trống.`);
  if (flatText.length > max) out.push(`${label} dài quá ${max} ký tự (đang ${flatText.length}).`);
  if (MARKUP.test(flatText)) out.push(`${label} có mã HTML, chỉ nhập chữ thường.`);
  if (flatText.includes('[object Object]')) out.push(`${label} có chuỗi "[object Object]".`);
  return out;
}
