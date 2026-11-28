/**
 * Nạp nội dung giáo dục có nguồn của 6 game mini (Đúng Thùng, Đố Xanh, Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Căn Bếp Xanh) và của Chọn Chuẩn Xanh
 * (`matcher.json`: câu nhu cầu, câu đố xen giữa, bộ sản phẩm) từ `reference-data/game-mini/*.json` vào `game_content_items`, và gắn link
 * nguồn cho vài câu đố cũ (`game_quizzes`) đã kiểm được. Mục Chọn Chuẩn Xanh luôn nạp ở trạng thái tắt: chuyên gia duyệt rồi bật trong admin.
 *
 *  - Mục mới: tạo theo `id` ổn định (INSERT ... ON CONFLICT DO NOTHING), nên chạy lại hay hai tiến trình chạy cùng lúc đều không nhân đôi.
 *  - Mục đã có: chỉ cập nhật khi `version` trong JSON LỚN HƠN `version` trong DB. Admin sửa nội dung thì `version` DB tăng, nên seed
 *    không đè chỉnh sửa của admin trừ khi người soạn cố ý đặt version JSON cao hơn. Không bao giờ bật lại mục admin đã tắt.
 *  - Câu đố cũ: chỉ điền `sourceUrl` khi câu đang chưa có nguồn; không sửa chữ, không xoá câu nào.
 *  - Kiểm toàn bộ gói trước khi ghi (payload theo luật từng game, giải thích ≤ 220 ký tự, link https, cụm từ cấm, slug có trong ảnh
 *    chụp sản phẩm). Sai một mục là dừng, không ghi dòng nào.
 *
 * Chạy (trong apps/api, sau `prisma migrate deploy`): `pnpm exec tsx prisma/seed-game-mini.ts`
 * Luật nguồn, cụm cấm, cách thêm mục: `docs/game/content-guidelines.md`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { MINI_BASKET_PICK, MINI_CONTENT_GAME_IDS, MINI_MIN_ACTIVE_ITEMS, claimsIn, type MiniContentGameId } from '@tubutree/shared-types';
import { MINI_GAMES } from '../src/modules/game/mini/games';
import { SLUG_RE } from '../src/modules/game/mini/games/game-def';
import { readBasketPayload } from '../src/modules/game/mini/games/basket';
import { readChoicePayload } from '../src/modules/game/mini/games/choice';
import { readKitchenSwapPayload } from '../src/modules/game/mini/games/kitchen-swap';
import { MINI_CONTENT_KIND, MINI_EXPLANATION_MAX } from '../src/modules/game/mini/game-mini-admin.service';
import {
  MATCHER_GAME,
  MATCHER_TRIVIA_PER_RUN,
  isMatcherKind,
  matcherContentGaps,
  matcherPayloadError,
  outcomeSlugs,
  readMatcherOutcome,
  readMatcherQuestion,
  readMatcherTrivia,
  type MatcherKind,
  type MatcherOutcome,
  type MatcherQuestion,
} from '../src/modules/game/mini/matcher/matcher.rules';
import { QUIZZES, type SeedQuiz } from './seed-game-quiz';

export const GAME_MINI_DATA_DIR = join(__dirname, 'reference-data', 'game-mini');

export const GAME_MINI_FILES: Record<MiniContentGameId, string> = {
  sort: 'sort.json',
  daily_quiz: 'daily-quiz.json',
  match: 'match.json',
  origin: 'origin.json',
  basket: 'basket.json',
  kitchen_swap: 'kitchen-swap.json',
};

export const GAME_MATCHER_FILE = 'matcher.json';
const MATCHER_ID_PREFIX = 'gm-matcher-';

const ID_PREFIX: Record<MiniContentGameId, string> = {
  sort: 'gm-sort-',
  daily_quiz: 'gm-quiz-',
  match: 'gm-match-',
  origin: 'gm-origin-',
  basket: 'gm-basket-',
  kitchen_swap: 'gm-kitchen-',
};

const SOURCE_URL_MAX = 500;
const PAYLOAD_JSON_MAX = 4_000;
const ID_RE = /^gm-[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_LINKED_DAILY_QUIZ = 3;

export interface GameMiniItem {
  id: string;
  active: boolean;
  version: number;
  payload: unknown;
  explanation: string;
  sourceUrl: string;
  /** Chỗ trong nguồn (mục, bảng, câu số) để người duyệt mở đúng chỗ; không lưu vào DB. */
  sourceRef: string;
  sourceCheckedAt: string;
  productSlug?: string | null;
  /** Bắt buộc khi `active` = false: vì sao chưa bật (báo cáo và người duyệt đọc). */
  inactiveReason?: string;
}

export interface GameMatcherItem extends GameMiniItem {
  kind: MatcherKind;
}

export interface GameMiniSource {
  code: string;
  url: string;
  grade: string;
  publisher: string;
  title: string;
  note: string;
  checkedAt: string;
}

export interface LegacyQuizSource {
  id: string;
  sourceUrl: string;
  note: string;
}

export interface ProductSnapshotEntry {
  slug: string;
  name: string;
  inStock: boolean;
}

export interface GameMiniPack {
  games: Record<MiniContentGameId, GameMiniItem[]>;
  /** Chọn Chuẩn Xanh: câu nhu cầu, câu đố xen giữa, bộ sản phẩm (`matcher.json`). */
  matcher: GameMatcherItem[];
  legacy: LegacyQuizSource[];
  sources: GameMiniSource[];
  /** Danh sách sản phẩm công khai chụp lúc soạn (slug, tên, còn hàng). */
  products: ProductSnapshotEntry[];
}

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
}

export function loadGameMiniPack(dir: string = GAME_MINI_DATA_DIR): GameMiniPack {
  const games = {} as Record<MiniContentGameId, GameMiniItem[]>;
  for (const game of MINI_CONTENT_GAME_IDS) {
    const file = readJson<{ game: string; items: GameMiniItem[] }>(dir, GAME_MINI_FILES[game]);
    if (file.game !== game) throw new Error(`${GAME_MINI_FILES[game]}: trường "game" là "${file.game}", phải là "${game}"`);
    games[game] = file.items;
  }
  const matcher = readJson<{ game: string; items: GameMatcherItem[] }>(dir, GAME_MATCHER_FILE);
  if (matcher.game !== MATCHER_GAME) throw new Error(`${GAME_MATCHER_FILE}: trường "game" là "${matcher.game}", phải là "${MATCHER_GAME}"`);
  return {
    games,
    matcher: matcher.items,
    legacy: readJson<{ items: LegacyQuizSource[] }>(dir, 'legacy-quiz-sources.json').items,
    sources: readJson<{ sources: GameMiniSource[] }>(dir, 'sources.json').sources,
    products: readJson<{ products: ProductSnapshotEntry[] }>(dir, 'products-snapshot.json').products,
  };
}

const TONE_OLD_STYLE: Record<string, string> = {
  oá: 'óa', oà: 'òa', oả: 'ỏa', oã: 'õa', oạ: 'ọa',
  oé: 'óe', oè: 'òe', oẻ: 'ỏe', oẽ: 'õe', oẹ: 'ọe',
  uý: 'úy', uỳ: 'ùy', uỷ: 'ủy', uỹ: 'ũy', uỵ: 'ụy',
};

/**
 * Chữ thường, NFC, một khoảng trắng, dấu thanh của vần mở "oa/oe/uy" đặt kiểu cũ ("hoá" → "hóa", "thuỷ" → "thủy") để cụm cấm bắt
 * được cả hai cách gõ. Vần đóng ("toàn", "khuyết") không đổi vì hai kiểu gõ trùng nhau.
 */
export function normalizeForPhraseCheck(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/(?:o[áàảãạéèẻẽẹ]|u[ýỳỷỹỵ])(?!\p{L})/gu, (m) => TONE_OLD_STYLE[m] ?? m)
    .replace(/\s+/g, ' ');
}

/**
 * Cụm từ game không được nói (Luật Quảng cáo 2012 Điều 8, 20; mục 6 và 7 của nghiên cứu nguồn), so trên chữ đã qua
 * `normalizeForPhraseCheck`. Ranh giới chữ dùng lớp ký tự Unicode vì `\b` không hiểu chữ có dấu.
 */
const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';
/** Thân mẫu đi qua cùng phép chuẩn hoá với chữ cần soi (cả chữ thường), nên không dùng lối tắt viết hoa như `\S`, `\p{L}`. */
const word = (body: string) => new RegExp(`${L}(?:${normalizeForPhraseCheck(body)})${R}`, 'u');
const near = (num: string, context: string) => {
  const n = `(?<![\\d,.])${num}\\s?%`;
  return new RegExp(`${n}[^.]{0,60}(?:${context})|(?:${context})[^.]{0,60}${n}`, 'u');
};
const NUM = '(?<![\\d,.])';
const NATURAL = 'tự nhiên|thiên nhiên|hữu cơ|organic';
const KILL_TARGET = '(?:vi )?(?:khuẩn|trùng|virus|vi rút|côn trùng|muỗi|nấm|mầm bệnh|vi sinh vật)';

export const BANNED_PHRASES: { label: string; pattern: RegExp }[] = [
  { label: 'diệt khuẩn / diệt virus / diệt côn trùng', pattern: word(`diệt(?: [^ ]+){0,2} ${KILL_TARGET}`) },
  { label: '99,9%', pattern: /99[,.]9+\s?%/u },
  { label: 'chữa (bệnh)', pattern: word('(?<!sửa )chữa(?! cháy)') },
  { label: 'trị / điều trị', pattern: word('(?<!(?:giá|quản|chính|cai|thống|địa|bình|hồ|thuỷ điện) )trị(?! (?:giá|số))') },
  { label: 'ngừa / phòng bệnh', pattern: word('(?:ngừa|phòng|phòng ngừa) (?:các )?(?:bệnh|dịch(?! vụ))') },
  { label: 'an toàn tuyệt đối', pattern: word('an toàn (?:tuyệt đối|100\\s?%|hoàn toàn)') },
  { label: 'không hoá chất', pattern: word('không (?:chứa |có |dùng )?(?:hoá chất|chất hoá học)|0\\s?% (?:hoá chất|chất hoá học)') },
  {
    label: '100% tự nhiên',
    pattern: new RegExp(`${NUM}100\\s?%[^.]{0,25}?(?:${NATURAL})|(?:${NATURAL})\\s?100\\s?%|${L}hoàn toàn (?:${NATURAL})${R}`, 'u'),
  },
  {
    label: 'kháng khuẩn / sát khuẩn / khử trùng',
    pattern: word('kháng khuẩn|sát khuẩn|khử khuẩn|khử trùng|sát trùng|tẩy trùng|kháng viêm|kháng nấm'),
  },
  { label: 'vô hại', pattern: word('vô hại') },
  { label: 'chống / đuổi muỗi', pattern: word('(?:chống|đuổi|xua) (?:muỗi|côn trùng)') },
  { label: 'thân thiện môi trường', pattern: word('thân thiện (?:với )?môi trường') },
  { label: 'phân huỷ hoàn toàn', pattern: word('(?:tự )?phân huỷ (?:sinh học )?(?:hoàn toàn|100\\s?%)') },
  { label: 'so sánh tuyệt đối (nhất, duy nhất, số một)', pattern: word('(?:tốt|an toàn|xanh|sạch|lành|hiệu quả|mạnh) nhất|duy nhất|số một|hàng đầu thế giới') },
  { label: 'số yếu: nhựa phân huỷ 450 năm', pattern: new RegExp(`${NUM}450\\s?năm`, 'u') },
  { label: 'số yếu: 3,9 triệu tấn / 33% tái chế', pattern: new RegExp(`${NUM}3[,.]9 triệu tấn`, 'u') },
  { label: 'số yếu: 3,9 triệu tấn / 33% tái chế', pattern: near('33', 'tái chế|nhựa') },
  { label: 'số yếu: refill giảm 44% / 90%', pattern: near('(?:44|90)', 'refill|bao bì|nhựa|giảm') },
  { label: 'số yếu: EPR 22%', pattern: near('22', 'epr|tái chế|pet') },
  { label: 'số yếu: nhựa số 1, 2, 5 tái chế được', pattern: /nhựa (?:số )?1\s?,\s?2\s?(?:,|và)\s?5/u },
  { label: 'số yếu: CMC bồ hòn', pattern: new RegExp(`${NUM}(?:0[,.]032|1[,.]7\\s?wt)`, 'u') },
  { label: 'số yếu: axit axetic eco-enzyme', pattern: new RegExp(`${NUM}(?:0[,.]81|1[,.]08\\s?%|3[,.]32\\s?%|4[,.]8\\s?g/ml)`, 'u') },
];

/** Nhãn các cụm cấm có trong đoạn chữ (rỗng là sạch). */
export function findBannedPhrases(text: string): string[] {
  const t = normalizeForPhraseCheck(text);
  return [...new Set(BANNED_PHRASES.filter((b) => b.pattern.test(t)).map((b) => b.label))];
}

/** Mọi chữ người chơi thấy của một mục: payload (nhãn, câu hỏi, lựa chọn, lý do) và lời giải thích. */
export function visibleTexts(item: Pick<GameMiniItem, 'payload' | 'explanation'>): string[] {
  const out: string[] = [item.explanation];
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key !== 'slug' && key !== 'bin' && key !== 'emoji') out.push(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key === 'correct' ? 'slug' : key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  walk(item.payload);
  return out;
}

/** Chữ người chơi thấy của một món Căn Bếp Xanh: tên món, điều nó giấu, điều nhãn của từng sản phẩm, lời giải thích. Góc nhà và slug là mã máy. */
export function kitchenVisibleTexts(item: Pick<GameMiniItem, 'payload' | 'explanation'>): string[] {
  const p = readKitchenSwapPayload(item.payload);
  return p ? [item.explanation, p.item, p.hidden, ...p.options.map((o) => o.fact)] : [item.explanation];
}

/** Chữ người chơi thấy của một mục Chọn Chuẩn Xanh: lời hỏi, nhãn lựa chọn, tên bộ, câu "vì sao hợp", lời giải thích. Mã và nhãn máy bỏ qua. */
export function matcherVisibleTexts(item: Pick<GameMatcherItem, 'kind' | 'payload' | 'explanation'>): string[] {
  const out: string[] = [item.explanation];
  if (item.kind === 'question') {
    const q = readMatcherQuestion(item.payload);
    if (q) out.push(q.prompt, ...q.options.map((o) => o.label));
  } else if (item.kind === 'trivia') {
    const t = readMatcherTrivia(item.payload);
    if (t) out.push(t.prompt, ...t.options);
  } else {
    const o = readMatcherOutcome(item.payload);
    if (o) out.push(o.title, ...o.slots.flatMap((s) => s.why.map((w) => w.text)));
  }
  return out;
}

function sourceUrlError(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw.length === 0) return 'thiếu sourceUrl';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return `sourceUrl không đúng dạng: ${raw}`;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.') || raw.length > SOURCE_URL_MAX) return `sourceUrl phải là https đầy đủ ≤ ${SOURCE_URL_MAX} ký tự: ${raw}`;
  return null;
}

function isValidDay(s: unknown): boolean {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isTubuHost = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === 'tubutree.com' || h.endsWith('.tubutree.com');
  } catch {
    return false;
  }
};

/**
 * Căn Bếp Xanh gửi điều nhãn của cả 3 sản phẩm ngay lúc bắt đầu ván. Điều nhãn đi theo sản phẩm, không theo món: cùng một slug ở mọi món phải
 * cùng một chữ, kẻo câu chỉ viết cho đáp án (vd "rót lại vào chai cũ") lộ đáp án trước khi chấm. Cách dùng hợp với món để ở `explanation`, chỉ
 * trả sau khi chấm.
 */
function kitchenFactErrors(pack: GameMiniPack): string[] {
  const errors: string[] = [];
  const factOf = new Map<string, { fact: string; at: string }>();
  for (const item of pack.games.kitchen_swap) {
    const p = readKitchenSwapPayload(item.payload);
    if (!p) continue;
    for (const { slug, fact } of p.options) {
      const first = factOf.get(slug);
      if (!first) factOf.set(slug, { fact, at: item.id });
      else if (first.fact !== fact) {
        errors.push(`${GAME_MINI_FILES.kitchen_swap} ${item.id}: điều nhãn của ${slug} khác ở ${first.at} ("${fact}" / "${first.fact}"); một sản phẩm chỉ có một điều nhãn`);
      }
    }
  }
  return errors;
}

/**
 * Lỗi của cả gói (rỗng là hợp lệ). Dùng chung cho seed (chặn trước khi ghi) và spec nội dung. `quizzes` là chữ gốc của câu đố cũ
 * (`seed-game-quiz.ts`): câu được gắn nguồn cũng phải qua luật trắc nghiệm và cụm cấm, vì gắn nguồn là đưa câu vào Đố Xanh.
 */
export function validateGameMiniPack(pack: GameMiniPack, quizzes: readonly SeedQuiz[] = QUIZZES): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const products = new Map(pack.products.map((p) => [p.slug, p]));
  const sourceUrls = new Set(pack.sources.map((s) => s.url));
  const labelSource = pack.sources.find((s) => s.grade === 'label');

  for (const s of pack.sources) {
    const e = sourceUrlError(s.url);
    if (e) errors.push(`sources.json ${s.code}: ${e}`);
    if (!isValidDay(s.checkedAt)) errors.push(`sources.json ${s.code}: checkedAt phải là YYYY-MM-DD`);
  }

  for (const game of MINI_CONTENT_GAME_IDS) {
    const def = MINI_GAMES[game];
    for (const item of pack.games[game]) {
      const at = `${GAME_MINI_FILES[game]} ${item.id ?? '(thiếu id)'}`;
      if (typeof item.id !== 'string' || !ID_RE.test(item.id) || !item.id.startsWith(ID_PREFIX[game]) || item.id.length > 100) {
        errors.push(`${at}: id phải dạng ${ID_PREFIX[game]}<chữ-thường-gạch-nối>`);
      }
      if (seen.has(item.id)) errors.push(`${at}: trùng id`);
      seen.add(item.id);
      if (typeof item.active !== 'boolean') errors.push(`${at}: active phải là true/false`);
      if (item.active === false && !(typeof item.inactiveReason === 'string' && item.inactiveReason.trim().length > 0)) {
        errors.push(`${at}: mục tắt phải ghi inactiveReason`);
      }
      if (!Number.isInteger(item.version) || item.version < 1) errors.push(`${at}: version phải là số nguyên ≥ 1`);
      const payloadError = def.payloadError(item.payload);
      if (payloadError) errors.push(`${at}: ${payloadError}`);
      if (JSON.stringify(item.payload ?? null).length > PAYLOAD_JSON_MAX) errors.push(`${at}: payload quá ${PAYLOAD_JSON_MAX} ký tự`);
      const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
      if (explanation.length < 1 || explanation.length > MINI_EXPLANATION_MAX || explanation !== item.explanation) {
        errors.push(`${at}: giải thích phải 1–${MINI_EXPLANATION_MAX} ký tự, không thừa khoảng trắng (đang ${explanation.length})`);
      }
      const urlError = sourceUrlError(item.sourceUrl);
      if (urlError) errors.push(`${at}: ${urlError}`);
      else if (game === 'basket') {
        if (!labelSource || !item.sourceUrl.startsWith(labelSource.url)) errors.push(`${at}: đề Giỏ Đúng Việc dẫn nhãn trên trang sản phẩm`);
      } else {
        if (isTubuHost(item.sourceUrl)) errors.push(`${at}: không dùng trang Tubu làm nguồn cho khẳng định khoa học`);
        if (!sourceUrls.has(item.sourceUrl)) errors.push(`${at}: sourceUrl chưa có trong sources.json`);
      }
      if (typeof item.sourceRef !== 'string' || item.sourceRef.trim().length === 0) errors.push(`${at}: thiếu sourceRef`);
      if (!isValidDay(item.sourceCheckedAt)) errors.push(`${at}: sourceCheckedAt phải là YYYY-MM-DD`);
      if (item.productSlug != null) {
        if (typeof item.productSlug !== 'string' || !SLUG_RE.test(item.productSlug)) errors.push(`${at}: productSlug sai dạng`);
        else if (!products.has(item.productSlug)) errors.push(`${at}: productSlug ${item.productSlug} không có trong ảnh chụp sản phẩm`);
      }
      if (game === 'kitchen_swap') {
        const p = readKitchenSwapPayload(item.payload);
        if (p) {
          for (const { slug } of p.options) {
            const snap = products.get(slug);
            if (!snap) errors.push(`${at}: slug ${slug} không có trong ảnh chụp sản phẩm`);
            else if (item.active && !snap.inStock) errors.push(`${at}: slug ${slug} hết hàng lúc chụp, món bật sẽ không phát được`);
          }
        }
        // Điều nhãn của sản phẩm đứng cạnh thẻ sản phẩm: cùng mức chặn tuyên bố với chữ sản phẩm (strict), không chỉ cụm cấm của game.
        for (const text of kitchenVisibleTexts(item)) {
          for (const claim of claimsIn(text, 'strict')) errors.push(`${at}: lời tuyên bố (${claim}) trong "${text}"`);
        }
      }
      if (game === 'basket') {
        const p = readBasketPayload(item.payload);
        if (p) {
          for (const slug of [...p.correct, ...p.wrong.map((w) => w.slug)]) {
            const snap = products.get(slug);
            if (!snap) errors.push(`${at}: slug ${slug} không có trong ảnh chụp sản phẩm`);
            else if (item.active && !snap.inStock) errors.push(`${at}: slug ${slug} hết hàng lúc chụp, đề bật sẽ không phát được`);
          }
          if (p.correct.length !== MINI_BASKET_PICK) errors.push(`${at}: cần đúng ${MINI_BASKET_PICK} món đúng`);
        }
      }
      for (const text of game === 'kitchen_swap' ? kitchenVisibleTexts(item) : visibleTexts(item)) {
        for (const label of findBannedPhrases(text)) errors.push(`${at}: cụm cấm "${label}" trong "${text}"`);
      }
    }
  }

  errors.push(...kitchenFactErrors(pack));
  errors.push(...validateMatcherItems(pack, seen, products, sourceUrls, labelSource));

  const linkedQuiz = pack.games.daily_quiz.filter((i) => i.active && i.productSlug).length;
  if (linkedQuiz > 0 && linkedQuiz < MIN_LINKED_DAILY_QUIZ) {
    errors.push(
      `${GAME_MINI_FILES.daily_quiz}: ${linkedQuiz} câu bật gắn sản phẩm; cần 0 hoặc ít nhất ${MIN_LINKED_DAILY_QUIZ} (câu thứ 3 mỗi ngày xoay vòng trong nhóm này, ít quá thì ngày nào cũng lặp)`,
    );
  }

  const quizById = new Map(quizzes.map((q) => [q.id, q]));
  const legacySeen = new Set<string>();
  for (const l of pack.legacy) {
    const at = `legacy-quiz-sources.json ${l.id}`;
    if (legacySeen.has(l.id)) errors.push(`${at}: trùng id`);
    legacySeen.add(l.id);
    const e = sourceUrlError(l.sourceUrl);
    if (e) errors.push(`${at}: ${e}`);
    else if (!sourceUrls.has(l.sourceUrl)) errors.push(`${at}: sourceUrl chưa có trong sources.json`);
    const q = quizById.get(l.id);
    if (!q) {
      errors.push(`${at}: không có trong seed-game-quiz.ts, không biết chữ của câu để đối chiếu nguồn`);
      continue;
    }
    if (!readChoicePayload({ prompt: q.question, options: q.options, answer: q.correct })) {
      errors.push(`${at}: câu cũ không qua luật trắc nghiệm của Đố Xanh (lời hỏi ≤ 300, 2–4 lựa chọn ≤ 120 ký tự, không trùng)`);
    }
    for (const text of [q.question, ...q.options, q.explanation]) {
      for (const label of findBannedPhrases(text)) errors.push(`${at}: cụm cấm "${label}" trong "${text}"`);
    }
  }
  return errors;
}

/**
 * Luật riêng của `matcher.json`: luôn tắt, payload theo loại, câu đố dẫn nguồn khoa học trong sources.json, câu nhu cầu và bộ kết quả
 * dẫn trang sản phẩm Tubu, chữ qua cụm cấm và bộ chặn tuyên bố (mức strict), slug có trong ảnh chụp và còn hàng, mọi nhánh đáp án có bộ.
 */
function validateMatcherItems(
  pack: GameMiniPack,
  seen: Set<string>,
  products: ReadonlyMap<string, ProductSnapshotEntry>,
  sourceUrls: ReadonlySet<string>,
  labelSource: GameMiniSource | undefined,
): string[] {
  const errors: string[] = [];
  const questions: MatcherQuestion[] = [];
  const outcomes: MatcherOutcome[] = [];
  let trivia = 0;
  for (const item of pack.matcher) {
    const at = `${GAME_MATCHER_FILE} ${item.id ?? '(thiếu id)'}`;
    if (typeof item.id !== 'string' || !ID_RE.test(item.id) || !item.id.startsWith(MATCHER_ID_PREFIX) || item.id.length > 100) {
      errors.push(`${at}: id phải dạng ${MATCHER_ID_PREFIX}<chữ-thường-gạch-nối>`);
    }
    if (seen.has(item.id)) errors.push(`${at}: trùng id`);
    seen.add(item.id);
    if (item.active !== false) errors.push(`${at}: mục Chọn Chuẩn Xanh nạp ở trạng thái tắt, chuyên gia duyệt rồi bật trong admin`);
    if (!(typeof item.inactiveReason === 'string' && item.inactiveReason.trim().length > 0)) errors.push(`${at}: mục tắt phải ghi inactiveReason`);
    if (!Number.isInteger(item.version) || item.version < 1) errors.push(`${at}: version phải là số nguyên ≥ 1`);
    if (!isMatcherKind(item.kind)) {
      errors.push(`${at}: kind phải là question, trivia hoặc outcome`);
      continue;
    }
    const payloadError = matcherPayloadError(item.kind, item.payload);
    if (payloadError) errors.push(`${at}: ${payloadError}`);
    if (JSON.stringify(item.payload ?? null).length > PAYLOAD_JSON_MAX) errors.push(`${at}: payload quá ${PAYLOAD_JSON_MAX} ký tự`);
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (explanation.length < 1 || explanation.length > MINI_EXPLANATION_MAX || explanation !== item.explanation) {
      errors.push(`${at}: giải thích phải 1–${MINI_EXPLANATION_MAX} ký tự, không thừa khoảng trắng (đang ${explanation.length})`);
    }
    const urlError = sourceUrlError(item.sourceUrl);
    if (urlError) errors.push(`${at}: ${urlError}`);
    else if (item.kind === 'trivia') {
      if (isTubuHost(item.sourceUrl)) errors.push(`${at}: không dùng trang Tubu làm nguồn cho khẳng định khoa học`);
      if (!sourceUrls.has(item.sourceUrl)) errors.push(`${at}: sourceUrl chưa có trong sources.json`);
    } else if (!labelSource || !item.sourceUrl.startsWith(labelSource.url)) {
      errors.push(`${at}: câu nhu cầu và bộ kết quả dẫn trang sản phẩm Tubu`);
    }
    if (typeof item.sourceRef !== 'string' || item.sourceRef.trim().length === 0) errors.push(`${at}: thiếu sourceRef`);
    if (!isValidDay(item.sourceCheckedAt)) errors.push(`${at}: sourceCheckedAt phải là YYYY-MM-DD`);
    if (item.productSlug != null) errors.push(`${at}: Chọn Chuẩn Xanh không dùng productSlug, slug nằm trong payload bộ kết quả`);
    for (const text of matcherVisibleTexts(item)) {
      for (const label of findBannedPhrases(text)) errors.push(`${at}: cụm cấm "${label}" trong "${text}"`);
      for (const claim of claimsIn(text, 'strict')) errors.push(`${at}: lời tuyên bố (${claim}) trong "${text}"`);
    }
    if (item.kind === 'question') {
      const q = readMatcherQuestion(item.payload);
      if (q) questions.push(q);
    } else if (item.kind === 'trivia') {
      if (readMatcherTrivia(item.payload)) trivia++;
    } else {
      const o = readMatcherOutcome(item.payload);
      if (!o) continue;
      outcomes.push(o);
      for (const slug of outcomeSlugs(o)) {
        const snap = products.get(slug);
        if (!snap) errors.push(`${at}: slug ${slug} không có trong ảnh chụp sản phẩm`);
        else if (!snap.inStock) errors.push(`${at}: slug ${slug} hết hàng lúc chụp`);
      }
    }
  }
  const dupes = (codes: string[]) => codes.filter((c, i) => codes.indexOf(c) !== i);
  for (const c of dupes(questions.map((q) => q.code))) errors.push(`${GAME_MATCHER_FILE}: trùng mã câu nhu cầu ${c}`);
  for (const c of dupes(outcomes.map((o) => o.code))) errors.push(`${GAME_MATCHER_FILE}: trùng mã bộ kết quả ${c}`);
  if (trivia < MATCHER_TRIVIA_PER_RUN) errors.push(`${GAME_MATCHER_FILE}: cần ít nhất ${MATCHER_TRIVIA_PER_RUN} câu đố xen giữa`);
  for (const gap of matcherContentGaps(questions, outcomes)) errors.push(`${GAME_MATCHER_FILE}: ${gap}`);
  return errors;
}

/** Số mục bật của từng game và game nào chưa đủ `MINI_MIN_ACTIVE_ITEMS` (sẽ tự ẩn). */
export function activeCounts(pack: GameMiniPack): Record<MiniContentGameId, { total: number; active: number; belowMinimum: boolean }> {
  const out = {} as Record<MiniContentGameId, { total: number; active: number; belowMinimum: boolean }>;
  for (const game of MINI_CONTENT_GAME_IDS) {
    const items = pack.games[game];
    const legacy = game === 'daily_quiz' ? pack.legacy.length : 0;
    const active = items.filter((i) => i.active).length + legacy;
    out[game] = { total: items.length + legacy, active, belowMinimum: active < MINI_MIN_ACTIVE_ITEMS };
  }
  return out;
}

export interface GameMiniSeedResult {
  game: MiniContentGameId;
  total: number;
  created: number;
  updated: number;
}

export interface GameMatcherSeedResult {
  total: number;
  created: number;
  updated: number;
}

export interface LegacySeedResult {
  total: number;
  filled: number;
  /** Câu cũ không có trong DB (bỏ qua). */
  missing: string[];
  /** Câu cũ có trong DB nhưng chữ đã khác bản đã đối chiếu nguồn (không gắn nguồn). */
  changed: string[];
}

function contentData(game: MiniContentGameId, item: GameMiniItem) {
  return {
    game,
    kind: MINI_CONTENT_KIND[game],
    payload: item.payload as Prisma.InputJsonValue,
    explanation: item.explanation,
    sourceUrl: item.sourceUrl,
    sourceCheckedAt: new Date(`${item.sourceCheckedAt}T00:00:00Z`),
    productSlug: item.productSlug ?? null,
    version: item.version,
  };
}

function matcherData(item: GameMatcherItem) {
  return {
    game: MATCHER_GAME,
    kind: item.kind,
    payload: item.payload as Prisma.InputJsonValue,
    explanation: item.explanation,
    sourceUrl: item.sourceUrl,
    sourceCheckedAt: new Date(`${item.sourceCheckedAt}T00:00:00Z`),
    productSlug: null,
    version: item.version,
  };
}

export async function seedGameMini(
  prisma: PrismaClient,
  pack: GameMiniPack = loadGameMiniPack(),
): Promise<{ games: GameMiniSeedResult[]; matcher: GameMatcherSeedResult; legacy: LegacySeedResult }> {
  const errors = validateGameMiniPack(pack);
  if (errors.length > 0) throw new Error(`seed-game-mini: gói nội dung có ${errors.length} lỗi, không ghi gì:\n- ${errors.join('\n- ')}`);

  const games: GameMiniSeedResult[] = [];
  for (const game of MINI_CONTENT_GAME_IDS) {
    const items = pack.games[game];
    const { count: created } = await prisma.gameContentItem.createMany({
      data: items.map((item) => ({ id: item.id, ...contentData(game, item), active: item.active })),
      skipDuplicates: true,
    });
    let updated = 0;
    for (const item of items) {
      const { count } = await prisma.gameContentItem.updateMany({
        where: { id: item.id, game, version: { lt: item.version } },
        data: { ...contentData(game, item), ...(item.active ? {} : { active: false }) },
      });
      updated += count;
    }
    games.push({ game, total: items.length, created, updated });
  }

  // Nội dung mới hay nâng version đều về trạng thái tắt: chữ đổi thì chuyên gia phải duyệt lại trước khi bật.
  const { count: matcherCreated } = await prisma.gameContentItem.createMany({
    data: pack.matcher.map((item) => ({ id: item.id, ...matcherData(item), active: false })),
    skipDuplicates: true,
  });
  let matcherUpdated = 0;
  for (const item of pack.matcher) {
    const { count } = await prisma.gameContentItem.updateMany({
      where: { id: item.id, game: MATCHER_GAME, version: { lt: item.version } },
      data: { ...matcherData(item), active: false },
    });
    matcherUpdated += count;
  }
  const matcher: GameMatcherSeedResult = { total: pack.matcher.length, created: matcherCreated, updated: matcherUpdated };

  // Nguồn chỉ khớp chữ đã đối chiếu: câu admin đã sửa (chữ khác bản trong seed-game-quiz.ts) thì không gắn.
  const quizById = new Map(QUIZZES.map((q) => [q.id, q]));
  let filled = 0;
  for (const l of pack.legacy) {
    const q = quizById.get(l.id)!;
    const { count } = await prisma.gameQuiz.updateMany({
      where: {
        id: l.id,
        question: q.question,
        options: { equals: q.options },
        correct: q.correct,
        explanation: q.explanation,
        OR: [{ sourceUrl: null }, { sourceUrl: '' }],
      },
      data: { sourceUrl: l.sourceUrl },
    });
    filled += count;
  }
  const ids = pack.legacy.map((l) => l.id);
  const present = await prisma.gameQuiz.findMany({
    where: { id: { in: ids } },
    select: { id: true, question: true, options: true, correct: true, explanation: true },
  });
  const missing = ids.filter((id) => !present.some((p) => p.id === id));
  const changed = present
    .filter((p) => {
      const q = quizById.get(p.id)!;
      return p.question !== q.question || p.correct !== q.correct || p.explanation !== q.explanation || JSON.stringify(p.options) !== JSON.stringify(q.options);
    })
    .map((p) => p.id);
  return { games, matcher, legacy: { total: pack.legacy.length, filled, missing, changed } };
}

export function formatGameMiniResults(result: { games: GameMiniSeedResult[]; matcher: GameMatcherSeedResult; legacy: LegacySeedResult }): string[] {
  const lines = result.games.map(
    (r) => `[seed-game-mini] ${r.game}: +${r.created} mới, ${r.updated} cập nhật theo version, ${r.total - r.created - r.updated} giữ nguyên`,
  );
  const m = result.matcher;
  lines.push(`[seed-game-mini] matcher: +${m.created} mới (tắt), ${m.updated} cập nhật theo version (tắt lại), ${m.total - m.created - m.updated} giữ nguyên`);
  const missing = result.legacy.missing.length > 0 ? `; không có trong DB: ${result.legacy.missing.join(', ')}` : '';
  const changed = result.legacy.changed.length > 0 ? `; chữ đã bị sửa nên không gắn: ${result.legacy.changed.join(', ')}` : '';
  lines.push(`[seed-game-mini] game_quizzes: gắn nguồn ${result.legacy.filled}/${result.legacy.total} câu cũ${missing}${changed}`);
  return lines;
}

export function parseGameMiniArgs(argv: readonly string[]): void {
  const unknown = argv.filter((a) => a !== '--');
  if (unknown.length > 0) throw new Error(`Tham số không hợp lệ: ${unknown.join(' ')}. Lệnh này không nhận tham số.`);
}

async function main() {
  parseGameMiniArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    for (const line of formatGameMiniResults(await seedGameMini(prisma))) console.log(line);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
