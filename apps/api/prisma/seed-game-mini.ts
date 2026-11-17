/**
 * Nạp nội dung giáo dục có nguồn của 5 game mini (Đúng Thùng, Đố Xanh, Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc) từ
 * `reference-data/game-mini/*.json` vào `game_content_items`, và gắn link nguồn cho vài câu đố cũ (`game_quizzes`) đã kiểm được.
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
import { MINI_BASKET_PICK, MINI_GAME_IDS, MINI_MIN_ACTIVE_ITEMS, type MiniGameId } from '@tubutree/shared-types';
import { MINI_GAMES } from '../src/modules/game/mini/games';
import { SLUG_RE } from '../src/modules/game/mini/games/game-def';
import { readBasketPayload } from '../src/modules/game/mini/games/basket';
import { MINI_CONTENT_KIND, MINI_EXPLANATION_MAX } from '../src/modules/game/mini/game-mini-admin.service';

export const GAME_MINI_DATA_DIR = join(__dirname, 'reference-data', 'game-mini');

export const GAME_MINI_FILES: Record<MiniGameId, string> = {
  sort: 'sort.json',
  daily_quiz: 'daily-quiz.json',
  match: 'match.json',
  origin: 'origin.json',
  basket: 'basket.json',
};

const ID_PREFIX: Record<MiniGameId, string> = {
  sort: 'gm-sort-',
  daily_quiz: 'gm-quiz-',
  match: 'gm-match-',
  origin: 'gm-origin-',
  basket: 'gm-basket-',
};

const SOURCE_URL_MAX = 500;
const PAYLOAD_JSON_MAX = 4_000;
const ID_RE = /^gm-[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  games: Record<MiniGameId, GameMiniItem[]>;
  legacy: LegacyQuizSource[];
  sources: GameMiniSource[];
  /** Danh sách sản phẩm công khai chụp lúc soạn (slug, tên, còn hàng). */
  products: ProductSnapshotEntry[];
}

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
}

export function loadGameMiniPack(dir: string = GAME_MINI_DATA_DIR): GameMiniPack {
  const games = {} as Record<MiniGameId, GameMiniItem[]>;
  for (const game of MINI_GAME_IDS) {
    const file = readJson<{ game: string; items: GameMiniItem[] }>(dir, GAME_MINI_FILES[game]);
    if (file.game !== game) throw new Error(`${GAME_MINI_FILES[game]}: trường "game" là "${file.game}", phải là "${game}"`);
    games[game] = file.items;
  }
  return {
    games,
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
const word = (body: string) => new RegExp(`${L}(?:${normalizeForPhraseCheck(body)})${R}`, 'u');
const near = (num: string, context: string) => {
  const n = `(?<![\\d,.])${num}\\s?%`;
  return new RegExp(`${n}[^.]{0,60}(?:${context})|(?:${context})[^.]{0,60}${n}`, 'u');
};

export const BANNED_PHRASES: { label: string; pattern: RegExp }[] = [
  { label: 'diệt khuẩn / diệt virus / diệt côn trùng', pattern: word('diệt (?:vi )?(?:khuẩn|trùng|virus|vi rút|côn trùng|muỗi|nấm|mầm bệnh)') },
  { label: '99,9%', pattern: /99[,.]9\s?%/u },
  { label: 'chữa (bệnh)', pattern: word('(?<!sửa )chữa') },
  { label: 'trị / điều trị', pattern: word('(?<!(?:giá|quản|chính|cai|thống|địa|bình) )trị(?! (?:giá|số))') },
  { label: 'ngừa / phòng bệnh', pattern: word('(?:ngừa|phòng|phòng ngừa) (?:các )?(?:bệnh|dịch)') },
  { label: 'an toàn tuyệt đối', pattern: word('an toàn (?:tuyệt đối|100\\s?%|hoàn toàn)') },
  { label: 'không hoá chất', pattern: word('không (?:chứa |có |dùng )?hoá chất') },
  { label: '100% tự nhiên', pattern: /100\s?%\s?(?:tự nhiên|thiên nhiên|hữu cơ|organic)/u },
  { label: 'kháng khuẩn / sát khuẩn / khử trùng', pattern: word('kháng khuẩn|sát khuẩn|khử trùng|kháng viêm|kháng nấm') },
  { label: 'vô hại', pattern: word('vô hại') },
  { label: 'chống / đuổi muỗi', pattern: word('(?:chống|đuổi|xua) (?:muỗi|côn trùng)') },
  { label: 'thân thiện môi trường', pattern: word('thân thiện (?:với )?môi trường') },
  { label: 'phân huỷ hoàn toàn', pattern: word('phân huỷ (?:sinh học )?hoàn toàn') },
  { label: 'so sánh tuyệt đối (nhất, duy nhất, số một)', pattern: word('(?:tốt|an toàn|xanh|sạch|lành|hiệu quả|mạnh) nhất|duy nhất|số một|hàng đầu thế giới') },
  { label: 'số yếu: nhựa phân huỷ 450 năm', pattern: /450\s?năm/u },
  { label: 'số yếu: 3,9 triệu tấn / 33% tái chế', pattern: /3[,.]9 triệu tấn/u },
  { label: 'số yếu: 3,9 triệu tấn / 33% tái chế', pattern: near('33', 'tái chế|nhựa') },
  { label: 'số yếu: refill giảm 44% / 90%', pattern: near('(?:44|90)', 'refill|bao bì|nhựa|giảm') },
  { label: 'số yếu: EPR 22%', pattern: near('22', 'epr|tái chế|pet') },
  { label: 'số yếu: nhựa số 1, 2, 5 tái chế được', pattern: /nhựa (?:số )?1\s?,\s?2\s?(?:,|và)\s?5/u },
  { label: 'số yếu: CMC bồ hòn', pattern: /0[,.]032|1[,.]7\s?wt/u },
  { label: 'số yếu: axit axetic eco-enzyme', pattern: /0[,.]81|1[,.]08\s?%|3[,.]32\s?%|4[,.]8\s?g\/ml/u },
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
 * Lỗi của cả gói (rỗng là hợp lệ). Dùng chung cho seed (chặn trước khi ghi) và spec nội dung.
 */
export function validateGameMiniPack(pack: GameMiniPack): string[] {
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

  for (const game of MINI_GAME_IDS) {
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
      for (const text of visibleTexts(item)) {
        for (const label of findBannedPhrases(text)) errors.push(`${at}: cụm cấm "${label}" trong "${text}"`);
      }
    }
  }

  const legacySeen = new Set<string>();
  for (const l of pack.legacy) {
    if (legacySeen.has(l.id)) errors.push(`legacy-quiz-sources.json ${l.id}: trùng id`);
    legacySeen.add(l.id);
    const e = sourceUrlError(l.sourceUrl);
    if (e) errors.push(`legacy-quiz-sources.json ${l.id}: ${e}`);
    else if (!sourceUrls.has(l.sourceUrl)) errors.push(`legacy-quiz-sources.json ${l.id}: sourceUrl chưa có trong sources.json`);
  }
  return errors;
}

/** Số mục bật của từng game và game nào chưa đủ `MINI_MIN_ACTIVE_ITEMS` (sẽ tự ẩn). */
export function activeCounts(pack: GameMiniPack): Record<MiniGameId, { total: number; active: number; belowMinimum: boolean }> {
  const out = {} as Record<MiniGameId, { total: number; active: number; belowMinimum: boolean }>;
  for (const game of MINI_GAME_IDS) {
    const items = pack.games[game];
    const active = items.filter((i) => i.active).length + (game === 'daily_quiz' ? pack.legacy.length : 0);
    out[game] = { total: items.length, active, belowMinimum: active < MINI_MIN_ACTIVE_ITEMS };
  }
  return out;
}

export interface GameMiniSeedResult {
  game: MiniGameId;
  total: number;
  created: number;
  updated: number;
}

export interface LegacySeedResult {
  total: number;
  filled: number;
  /** Câu cũ không có trong DB (bỏ qua). */
  missing: string[];
}

function contentData(game: MiniGameId, item: GameMiniItem) {
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

export async function seedGameMini(
  prisma: PrismaClient,
  pack: GameMiniPack = loadGameMiniPack(),
): Promise<{ games: GameMiniSeedResult[]; legacy: LegacySeedResult }> {
  const errors = validateGameMiniPack(pack);
  if (errors.length > 0) throw new Error(`seed-game-mini: gói nội dung có ${errors.length} lỗi, không ghi gì:\n- ${errors.join('\n- ')}`);

  const games: GameMiniSeedResult[] = [];
  for (const game of MINI_GAME_IDS) {
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

  let filled = 0;
  for (const l of pack.legacy) {
    const { count } = await prisma.gameQuiz.updateMany({
      where: { id: l.id, OR: [{ sourceUrl: null }, { sourceUrl: '' }] },
      data: { sourceUrl: l.sourceUrl },
    });
    filled += count;
  }
  const present = await prisma.gameQuiz.findMany({ where: { id: { in: pack.legacy.map((l) => l.id) } }, select: { id: true } });
  const missing = pack.legacy.map((l) => l.id).filter((id) => !present.some((p) => p.id === id));
  return { games, legacy: { total: pack.legacy.length, filled, missing } };
}

export function formatGameMiniResults(result: { games: GameMiniSeedResult[]; legacy: LegacySeedResult }): string[] {
  const lines = result.games.map(
    (r) => `[seed-game-mini] ${r.game}: +${r.created} mới, ${r.updated} cập nhật theo version, ${r.total - r.created - r.updated} giữ nguyên`,
  );
  const missing = result.legacy.missing.length > 0 ? `; không có trong DB: ${result.legacy.missing.join(', ')}` : '';
  lines.push(`[seed-game-mini] game_quizzes: gắn nguồn ${result.legacy.filled}/${result.legacy.total} câu cũ${missing}`);
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
