import { MINI_REWARD } from '@tubutree/shared-types';
import { SLUG_RE, isRecord, text } from '../games/game-def';

/**
 * "Chọn Chuẩn Xanh": 3 câu nhu cầu rẽ nhánh theo câu 1, xen 2 câu kiến thức có nguồn, ra một bộ khởi đầu 2–4 món thật. Nội dung nằm
 * trong `game_content_items` với `game = 'matcher'` và ba loại `kind`: câu nhu cầu, câu kiến thức, bộ kết quả. Mọi hàm ở đây là hàm thuần
 * (kiểm payload, dựng chuỗi câu theo đáp án, chọn bộ): cùng đáp án luôn ra cùng bộ.
 */
export const MATCHER_GAME = 'matcher';
/** Viết nguyên chữ: spec khoá chết và `route-map.json` (gaps) tìm đúng tên khoá trong mã đọc. */
export const MATCHER_ENABLED_KEY = 'game.matcher_enabled';

export const MATCHER_KINDS = ['question', 'trivia', 'outcome'] as const;
export type MatcherKind = (typeof MATCHER_KINDS)[number];
export const isMatcherKind = (v: unknown): v is MatcherKind => typeof v === 'string' && (MATCHER_KINDS as readonly string[]).includes(v);

/** Số câu nhu cầu của một lượt (bước 1..3); câu kiến thức không tính vào chuỗi này. */
export const MATCHER_STEPS = 3;
export const MATCHER_TRIVIA_PER_RUN = 2;
export const MATCHER_MIN_ITEMS = 2;
export const MATCHER_MAX_ITEMS = 4;
/** Ứng viên dự phòng "Bán chạy còn hàng" khi bộ chính còn dưới `MATCHER_MIN_ITEMS` món. */
export const MATCHER_FALLBACK_ITEMS = 3;
/**
 * 💧 của lượt hoàn thành đầu tiên trong ngày, trước trần. Tính theo hoàn thành chứ không theo câu kiến thức đúng: đáp án kiến thức
 * nằm trong nội dung công khai (để hiện lời giải ngay), chấm đúng/sai ở máy chủ không chặn được ai. Không có Điểm Xanh.
 */
export const MATCHER_REWARD = { water: MINI_REWARD.waterBase, points: 0 } as const;

export const MATCHER_SIZES = ['small', 'large', 'refill'] as const;
export type MatcherSize = (typeof MATCHER_SIZES)[number];

const TAG_RE = /^[a-z][a-z0-9_]{0,23}$/;
const CODE_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const PROMPT_MAX = 160;
const LABEL_MAX = 48;
const TITLE_MAX = 60;
const WHY_MAX = 120;
const TRIVIA_OPTION_MAX = 120;
const MAX_TAGS = 4;
const MAX_SLOTS = 6;
const MAX_CANDIDATES = 6;

export interface MatcherOption {
  value: string;
  label: string;
  tags: string[];
}

export interface MatcherQuestion {
  code: string;
  step: number;
  prompt: string;
  options: MatcherOption[];
  /** Hiện khi đáp án trước có một trong các nhãn này; không có thì luôn hiện. */
  when: string[] | null;
}

export interface MatcherTrivia {
  prompt: string;
  options: string[];
  answer: number;
}

export interface MatcherWhy {
  /** Câu dùng khi khách đã chọn đáp án có nhãn này; không có nhãn là câu mặc định. */
  tag: string | null;
  text: string;
}

export type MatcherPick = Partial<Record<MatcherSize | 'any', string[]>>;

export interface MatcherSlot {
  /** Ứng viên theo thứ tự ưu tiên cho cỡ khách chọn; `any` là ứng viên chung, xét sau ứng viên của cỡ. */
  pick: MatcherPick;
  /** Chỉ có trong bộ khi khách chọn đáp án có nhãn này. */
  when: string | null;
  /** Đưa lên đầu bộ khi khách chọn đáp án có nhãn này. */
  lead: string | null;
  why: MatcherWhy[];
}

export interface MatcherOutcome {
  code: string;
  title: string;
  /** Nhãn của đáp án câu 1 mà bộ này phục vụ. */
  need: string;
  /** Mọi nhãn phải có trong đáp án; bộ khớp nhiều nhãn hơn thắng. */
  require: string[];
  slots: MatcherSlot[];
  /** Danh mục (slug) để lấy bộ dự phòng "Bán chạy còn hàng". */
  fallbackCategory: string;
}

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

function readTags(v: unknown, max = MAX_TAGS): string[] | null {
  if (!Array.isArray(v) || v.length > max || !v.every((t) => typeof t === 'string' && TAG_RE.test(t)) || !unique(v as string[])) return null;
  return v as string[];
}

export function readMatcherQuestion(payload: unknown): MatcherQuestion | null {
  if (!isRecord(payload)) return null;
  const code = typeof payload.code === 'string' && CODE_RE.test(payload.code) ? payload.code : null;
  const step = payload.step;
  const prompt = text(payload.prompt, PROMPT_MAX);
  if (!code || !prompt || typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > MATCHER_STEPS) return null;
  if (!Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > 5) return null;
  const options: MatcherOption[] = [];
  for (const o of payload.options) {
    if (!isRecord(o)) return null;
    const value = typeof o.value === 'string' && CODE_RE.test(o.value) ? o.value : null;
    const label = text(o.label, LABEL_MAX);
    const tags = readTags(o.tags);
    if (!value || !label || !tags) return null;
    options.push({ value, label, tags });
  }
  if (!unique(options.map((o) => o.value)) || !unique(options.map((o) => o.label))) return null;
  let when: string[] | null = null;
  if (payload.when !== undefined && payload.when !== null) {
    when = readTags(payload.when, 8);
    if (!when || when.length === 0) return null;
  }
  if (step === 1 && when) return null;
  return { code, step, prompt, options, when };
}

export function readMatcherTrivia(payload: unknown): MatcherTrivia | null {
  if (!isRecord(payload)) return null;
  const prompt = text(payload.prompt, PROMPT_MAX);
  const { options, answer } = payload;
  if (!prompt || !Array.isArray(options) || options.length < 2 || options.length > 4) return null;
  const opts = options.map((o) => text(o, TRIVIA_OPTION_MAX));
  if (opts.some((o) => o === null) || !unique(opts as string[])) return null;
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= opts.length) return null;
  return { prompt, options: opts as string[], answer };
}

function readSlot(v: unknown): MatcherSlot | null {
  if (!isRecord(v) || !isRecord(v.pick)) return null;
  const pick: MatcherPick = {};
  let total = 0;
  for (const [key, list] of Object.entries(v.pick)) {
    if (key !== 'any' && !(MATCHER_SIZES as readonly string[]).includes(key)) return null;
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CANDIDATES) return null;
    if (!list.every((s) => typeof s === 'string' && s.length <= 160 && SLUG_RE.test(s)) || !unique(list as string[])) return null;
    pick[key as MatcherSize | 'any'] = list as string[];
    total += list.length;
  }
  if (total === 0) return null;
  const tagOrNull = (t: unknown): string | null | undefined => (t === undefined || t === null ? null : typeof t === 'string' && TAG_RE.test(t) ? t : undefined);
  const when = tagOrNull(v.when);
  const lead = tagOrNull(v.lead);
  if (when === undefined || lead === undefined) return null;
  if (!Array.isArray(v.why) || v.why.length === 0 || v.why.length > 6) return null;
  const why: MatcherWhy[] = [];
  for (const w of v.why) {
    if (!isRecord(w)) return null;
    const tag = tagOrNull(w.tag);
    const t = text(w.text, WHY_MAX);
    if (tag === undefined || !t) return null;
    why.push({ tag, text: t });
  }
  // Câu mặc định (không nhãn) phải có và đứng cuối: câu theo nhãn xét trước.
  if (why[why.length - 1]!.tag !== null || why.slice(0, -1).some((w) => w.tag === null)) return null;
  return { pick, when, lead, why };
}

export function readMatcherOutcome(payload: unknown): MatcherOutcome | null {
  if (!isRecord(payload)) return null;
  const code = typeof payload.code === 'string' && CODE_RE.test(payload.code) ? payload.code : null;
  const title = text(payload.title, TITLE_MAX);
  const need = typeof payload.need === 'string' && TAG_RE.test(payload.need) ? payload.need : null;
  const require = readTags(payload.require ?? []);
  const fallbackCategory = typeof payload.fallbackCategory === 'string' && SLUG_RE.test(payload.fallbackCategory) ? payload.fallbackCategory : null;
  if (!code || !title || !need || !require || !fallbackCategory) return null;
  if (!Array.isArray(payload.slots) || payload.slots.length < 1 || payload.slots.length > MAX_SLOTS) return null;
  const slots: MatcherSlot[] = [];
  for (const s of payload.slots) {
    const slot = readSlot(s);
    if (!slot) return null;
    slots.push(slot);
  }
  return { code, title, need, require, slots, fallbackCategory };
}

const KIND_ERROR: Record<MatcherKind, string> = {
  question:
    'Câu nhu cầu cần: code (chữ thường), step 1–3, prompt ≤ 160 ký tự, 2–5 lựa chọn {value, label ≤ 48, tags} không trùng; when (tuỳ chọn, không dùng ở bước 1) là danh sách nhãn.',
  trivia: 'Câu kiến thức cần: prompt ≤ 160 ký tự, 2–4 lựa chọn ≤ 120 ký tự không trùng, answer là chỉ số của lựa chọn đúng.',
  outcome:
    'Bộ kết quả cần: code, title ≤ 60 ký tự, need (nhãn câu 1), require (nhãn), fallbackCategory (slug danh mục), 1–6 vị trí {pick theo cỡ small/large/refill/any, when, lead, why (câu mặc định đứng cuối)}.',
};

export function matcherPayloadError(kind: string, payload: unknown): string | null {
  if (!isMatcherKind(kind)) return 'Loại mục Chọn Chuẩn Xanh không hợp lệ.';
  const ok = kind === 'question' ? readMatcherQuestion(payload) : kind === 'trivia' ? readMatcherTrivia(payload) : readMatcherOutcome(payload);
  return ok ? null : KIND_ERROR[kind];
}

/** Slug sản phẩm một bộ có thể dùng (mọi vị trí, mọi cỡ). */
export function outcomeSlugs(o: MatcherOutcome): string[] {
  return [...new Set(o.slots.flatMap((s) => Object.values(s.pick).flat()))];
}

/** Câu nhu cầu đã sắp: theo bước rồi theo mã, để máy chủ và máy khách cùng lấy "câu đầu tiên khớp" ở mỗi bước. */
export function sortQuestions(qs: readonly MatcherQuestion[]): MatcherQuestion[] {
  return [...qs].sort((a, b) => a.step - b.step || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Câu của bước `step` với các nhãn đã chọn: câu đầu tiên (theo `sortQuestions`) không có điều kiện hoặc có nhãn khớp. */
export function questionFor(sorted: readonly MatcherQuestion[], step: number, tags: ReadonlySet<string>): MatcherQuestion | null {
  return sorted.find((q) => q.step === step && (q.when === null || q.when.some((t) => tags.has(t)))) ?? null;
}

export interface MatcherAnswer {
  code: string;
  value: string;
}

export interface MatcherChain {
  picks: Array<{ question: MatcherQuestion; option: MatcherOption }>;
  tags: Set<string>;
}

/**
 * Dựng lại chuỗi 3 câu từ đáp án: mỗi bước lấy đúng câu mà máy khách phải thấy, đáp án phải là một lựa chọn của câu đó. Thừa, thiếu
 * hay sai câu là null (máy chủ trả 400).
 */
export function resolveChain(sorted: readonly MatcherQuestion[], answers: readonly MatcherAnswer[]): MatcherChain | null {
  if (answers.length !== MATCHER_STEPS || !unique(answers.map((a) => a.code))) return null;
  const tags = new Set<string>();
  const picks: MatcherChain['picks'] = [];
  for (let step = 1; step <= MATCHER_STEPS; step++) {
    const question = questionFor(sorted, step, tags);
    if (!question) return null;
    const given = answers.find((a) => a.code === question.code);
    const option = given ? question.options.find((o) => o.value === given.value) : undefined;
    if (!option) return null;
    picks.push({ question, option });
    for (const t of option.tags) tags.add(t);
  }
  return { picks, tags };
}

/** Cỡ khách chọn (nhãn small/large/refill đầu tiên trong đáp án); không chọn thì null. */
export function sizeOf(tags: ReadonlySet<string>): MatcherSize | null {
  return MATCHER_SIZES.find((s) => tags.has(s)) ?? null;
}

/** Bộ khớp: đúng nhu cầu, có đủ nhãn `require`; khớp nhiều nhãn hơn thắng, hoà thì mã nhỏ hơn. Tất định. */
export function pickOutcome(outcomes: readonly MatcherOutcome[], tags: ReadonlySet<string>): MatcherOutcome | null {
  const fit = outcomes.filter((o) => tags.has(o.need) && o.require.every((t) => tags.has(t)));
  fit.sort((a, b) => b.require.length - a.require.length || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return fit[0] ?? null;
}

export interface PlannedSlot {
  candidates: string[];
  why: string;
}

/** Vị trí của bộ theo đáp án: bỏ vị trí có `when` không khớp, đưa vị trí `lead` khớp lên đầu, ứng viên theo cỡ rồi ứng viên chung. */
export function planSlots(outcome: MatcherOutcome, tags: ReadonlySet<string>): PlannedSlot[] {
  const size = sizeOf(tags);
  const kept = outcome.slots.filter((s) => s.when === null || tags.has(s.when));
  const leads = (s: MatcherSlot) => s.lead !== null && tags.has(s.lead);
  const ordered = [...kept.filter(leads), ...kept.filter((s) => !leads(s))];
  return ordered.map((s) => ({
    candidates: [...new Set([...(size ? (s.pick[size] ?? []) : []), ...(s.pick.any ?? [])])],
    why: (s.why.find((w) => w.tag !== null && tags.has(w.tag)) ?? s.why[s.why.length - 1]!).text,
  }));
}

/**
 * Chọn món cho từng vị trí: ứng viên đầu tiên còn bán, còn hàng và chưa có trong bộ; vị trí không còn ứng viên thì bỏ. Tối đa
 * `MATCHER_MAX_ITEMS` món.
 */
export function fillSlots(plan: readonly PlannedSlot[], available: (slug: string) => boolean): Array<{ slug: string; why: string }> {
  const out: Array<{ slug: string; why: string }> = [];
  const used = new Set<string>();
  for (const slot of plan) {
    if (out.length >= MATCHER_MAX_ITEMS) break;
    const slug = slot.candidates.find((s) => !used.has(s) && available(s));
    if (!slug) continue;
    used.add(slug);
    out.push({ slug, why: slot.why });
  }
  return out;
}

/** Mọi tổ hợp đáp án dựng được từ bộ câu (để kiểm kho nội dung đủ mọi nhánh). Nhánh thiếu câu dừng sớm (ngắn hơn 3 đáp án). */
export function allAnswerPaths(sorted: readonly MatcherQuestion[]): MatcherAnswer[][] {
  const out: MatcherAnswer[][] = [];
  const walk = (step: number, tags: Set<string>, acc: MatcherAnswer[]) => {
    const q = step > MATCHER_STEPS ? null : questionFor(sorted, step, tags);
    if (!q) {
      out.push(acc);
      return;
    }
    for (const o of q.options) walk(step + 1, new Set([...tags, ...o.tags]), [...acc, { code: q.code, value: o.value }]);
  };
  walk(1, new Set(), []);
  return out;
}

/** Lỗi của bộ câu + bộ kết quả (rỗng là đủ): mỗi nhánh có đủ 3 câu và có một bộ khớp. */
export function matcherContentGaps(questions: readonly MatcherQuestion[], outcomes: readonly MatcherOutcome[]): string[] {
  const sorted = sortQuestions(questions);
  if (!questionFor(sorted, 1, new Set())) return ['thiếu câu bước 1'];
  const gaps: string[] = [];
  for (const path of allAnswerPaths(sorted)) {
    const label = path.map((a) => `${a.code}=${a.value}`).join(', ');
    const chain = path.length === MATCHER_STEPS ? resolveChain(sorted, path) : null;
    if (!chain) {
      gaps.push(`nhánh [${label}] thiếu câu ở bước ${path.length + 1}`);
      continue;
    }
    if (!pickOutcome(outcomes, chain.tags)) gaps.push(`nhánh [${label}] không có bộ kết quả khớp`);
  }
  return gaps;
}
