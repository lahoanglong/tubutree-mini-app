import { Prisma } from '@prisma/client';
import { foldVietnamese } from './search-text';

/** Cờ bước "chịu gõ sai" (từ đồng nghĩa + gần đúng). Tắt thì `/products` và `/search/suggest` giữ đúng id và thứ tự như trước. */
export const SEARCH_FUZZY_FLAG = 'catalog.search_fuzzy_enabled';

/** Bước khớp chính xác trả ít hơn số này thì mới thử gần đúng: từ khoá đã ra đủ hàng thì không trộn thêm món lạ. */
export const FUZZY_TRIGGER_BELOW = 3;
/** Từ khoá đã gấp dấu, bỏ dấu cách, ngắn hơn thế thì không thử gần đúng: 2–3 chữ khớp gần như mọi tên. */
export const FUZZY_MIN_CHARS = 4;
/** Ngưỡng `word_similarity`, chốt bằng bộ 60 truy vấn gõ sai + 20 truy vấn vô nghĩa (search-fuzzy.race-spec.ts). */
export const FUZZY_THRESHOLD = 0.35;
/** Số dòng tối đa bước gần đúng trả về. */
export const FUZZY_LIMIT = 24;
/** Gợi ý "đang hiện kết quả cho …" dài hơn thế thì cắt (tên sản phẩm dài). */
export const DID_YOU_MEAN_MAX = 60;

export interface TextMatch {
  ids: string[];
  /** Danh sách đang hiện là kết quả gần đúng (bước chính xác không ra gì). */
  corrected: boolean;
  /** Cụm/tên gần nhất để hiện "Đang hiện kết quả cho …"; null khi không sửa. */
  didYouMean: string | null;
}

export const exactMatch = (ids: string[]): TextMatch => ({ ids, corrected: false, didYouMean: null });

export function shouldTryFuzzy(folded: string, exactCount: number): boolean {
  return exactCount < FUZZY_TRIGGER_BELOW && folded.replace(/ /g, '').length >= FUZZY_MIN_CHARS;
}

/**
 * Bước hai: `từ khoá <% "nameSearch"` (= word_similarity ≥ ngưỡng của phiên) đi được chỉ mục GIN `products_nameSearch_trgm_idx`. Ngưỡng
 * đặt bằng `fuzzySessionSql` trong cùng transaction đọc (xem `SearchMatchService.fuzzy`) nên không lọt sang phiên khác của pool.
 * Mọi giá trị là tham số ràng buộc.
 */
export function fuzzyMatchSql(folded: string): Prisma.Sql {
  return Prisma.sql`
    SELECT p.id, p.name FROM products p
    WHERE p."isActive" = true
      AND p."approvalStatus" = 'APPROVED'
      AND ${folded} <% p."nameSearch"
    ORDER BY word_similarity(${folded}, p."nameSearch") DESC,
      p."isFeatured" DESC, (p."soldExternal" + p."soldApp") DESC, p.id ASC
    LIMIT ${FUZZY_LIMIT}`;
}

/**
 * Chạy đầu transaction đọc của bước hai, cả hai giá trị là SET LOCAL (`set_config(..., true)`): ngưỡng `word_similarity`, và cấm quét tuần
 * tự. Planner tính `<%` theo giá mặc định của một phép so sánh nên ở vài nghìn dòng hay chọn quét tuần tự; đo trên 5.550 dòng: quét tuần tự
 * 18–26 ms, chỉ mục trigram dưới 1 ms (search-fuzzy-bench.race-spec.ts).
 */
export function fuzzySessionSql(): Prisma.Sql {
  return Prisma.sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true), set_config('enable_seqscan', 'off', true)`;
}

/** Từ vựng lấy từ tên sản phẩm: từ đã gấp dấu → cách viết có dấu hay gặp nhất và số lần gặp. */
export type Vocabulary = Map<string, { display: string; count: number }>;

const WORD_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function buildVocabulary(names: readonly string[]): Vocabulary {
  const forms = new Map<string, Map<string, number>>();
  for (const name of names) {
    for (const raw of name.toLowerCase().split(/\s+/)) {
      const word = raw.replace(WORD_EDGE, '');
      const key = foldVietnamese(word);
      if (key.length < 2) continue;
      const m = forms.get(key) ?? new Map<string, number>();
      m.set(word, (m.get(word) ?? 0) + 1);
      forms.set(key, m);
    }
  }
  const vocab: Vocabulary = new Map();
  for (const [key, m] of forms) {
    let display = key;
    let best = -1;
    let count = 0;
    for (const [form, n] of m) {
      count += n;
      if (n > best || (n === best && form < display)) {
        display = form;
        best = n;
      }
    }
    vocab.set(key, { display, count });
  }
  return vocab;
}

/** Khoảng cách Damerau–Levenshtein (bản "optimal string alignment"); dừng sớm và trả `max + 1` khi chắc chắn vượt `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n]!;
}

/** Một từ không có trong từ vựng: thay bằng từ gần nhất (1 lỗi, từ 7 chữ thì 2 lỗi) hoặc tách đôi khi khách gõ dính ("nuocgiat"). */
function fixWord(word: string, vocab: Vocabulary): { key: string; display: string } | null {
  const max = word.length >= 7 ? 2 : 1;
  let best: { key: string; display: string; d: number; count: number } | null = null;
  for (let i = 2; i <= word.length - 2; i++) {
    const a = vocab.get(word.slice(0, i));
    const b = vocab.get(word.slice(i));
    if (a && b) {
      const count = Math.min(a.count, b.count);
      if (!best || count > best.count) best = { key: `${word.slice(0, i)} ${word.slice(i)}`, display: `${a.display} ${b.display}`, d: 1, count };
    }
  }
  for (const [key, v] of vocab) {
    if (key.length < 3) continue;
    const d = editDistance(word, key, max);
    if (d > max) continue;
    if (!best || d < best.d || (d === best.d && (v.count > best.count || (v.count === best.count && key < best.key)))) {
      best = { key, display: v.display, d, count: v.count };
    }
  }
  return best ? { key: best.key, display: best.display } : null;
}

/**
 * Sửa chính tả theo từ vựng tên sản phẩm: từ có trong từ vựng giữ nguyên (lấy cách viết có dấu), từ lạ dài từ 3 chữ thì thay bằng từ gần
 * nhất. Trả null khi không từ nào đổi hoặc còn từ lạ không sửa được (cụm đó tìm chính xác cũng không ra gì).
 */
export function correctPhrase(folded: string, vocab: Vocabulary): { folded: string; display: string } | null {
  const keys: string[] = [];
  const shown: string[] = [];
  let changed = false;
  for (const word of folded.split(' ').filter(Boolean)) {
    const known = vocab.get(word);
    if (known) {
      keys.push(word);
      shown.push(known.display);
      continue;
    }
    const fix = word.length >= 3 ? fixWord(word, vocab) : null;
    if (!fix) return null;
    changed = true;
    keys.push(fix.key);
    shown.push(fix.display);
  }
  return changed ? { folded: keys.join(' '), display: shown.join(' ') } : null;
}

/** Từ đồng nghĩa đang bật (đã gấp dấu): cụm `term` nằm trọn trong từ khoá (theo ranh giới từ) thì thay bằng `canonical`. Cụm dài khớp trước. */
export function synonymQuery(folded: string, synonyms: readonly { term: string; canonical: string }[]): string | null {
  const padded = ` ${folded} `;
  const hit = [...synonyms].sort((a, b) => b.term.length - a.term.length).find((s) => s.term && padded.includes(` ${s.term} `));
  if (!hit) return null;
  const next = padded.replace(` ${hit.term} `, ` ${hit.canonical} `).trim();
  return next === folded ? null : next;
}

export function clipDidYouMean(s: string): string {
  const t = s.trim();
  return t.length > DID_YOU_MEAN_MAX ? `${t.slice(0, DID_YOU_MEAN_MAX - 1).trimEnd()}…` : t;
}
