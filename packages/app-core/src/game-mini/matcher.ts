import type { HttpClient } from '../http';
import { errorCode, errorStatus } from '../api/error-status';
import { productCardView, type ProductCardView } from '../commerce/product-card-view';
import { matcherCopy } from './matcher-copy';

/**
 * "Chọn Chuẩn Xanh" phía khách: 5 bước (3 câu nhu cầu rẽ nhánh theo câu 1, xen 2 câu đố có nguồn), rồi máy chủ chọn bộ 2–4 món còn hàng.
 * Máy chủ giữ mọi luật chọn bộ, giá và thưởng (`apps/api/src/modules/game/mini/matcher`); ở đây chỉ dựng lại đúng câu khách phải thấy
 * (cùng luật `questionFor` của máy chủ) để gửi đáp án máy chủ dựng lại được, rồi vẽ kết quả.
 */

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
  /** Chỉ hỏi khi đáp án trước có một trong các nhãn này; null là hỏi mọi nhánh. */
  when: string[] | null;
}

export interface MatcherTrivia {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  sourceUrl: string;
}

export interface MatcherContent {
  questions: MatcherQuestion[];
  trivia: MatcherTrivia[];
}

export interface MatcherAnswer {
  code: string;
  value: string;
}

export interface MatcherItem {
  slug: string;
  productId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  flash: boolean;
  why: string;
}

export interface MatcherResult {
  outcomeId: string;
  code: string;
  title: string;
  fallback: boolean;
  items: MatcherItem[];
  total: number;
  water: number;
}

export const MATCHER_PATH = '/vuon-xanh/chon-chuan-xanh';
export const MATCHER_CONTENT_KEY = ['game', 'matcher', 'content'] as const;

export const getMatcherContent = (http: HttpClient) => http.get<MatcherContent>('/game/matcher');

export const postMatcherResult = (http: HttpClient, body: { answers: MatcherAnswer[]; deviceId?: string }) =>
  http.post<MatcherResult>('/game/matcher/result', body);

/** Cờ tắt hay chưa bật đủ nội dung là 404: trạng thái bình thường, không thử lại. */
export const matcherContentQuery = (http: HttpClient) => ({
  queryKey: MATCHER_CONTENT_KEY,
  queryFn: () => getMatcherContent(http),
  staleTime: 10 * 60_000,
  retry: (count: number, err: unknown) => errorStatus(err) !== 404 && count < 1,
});

export type MatcherFailure = 'disabled' | 'no_content' | 'invalid' | 'network';

export function classifyMatcherError(err: unknown): MatcherFailure {
  const code = errorCode(err);
  if (code === 'GAME_DISABLED') return 'disabled';
  if (code === 'GAME_NO_CONTENT') return 'no_content';
  if (code === 'ANSWERS_INVALID') return 'invalid';
  const status = errorStatus(err);
  if (status === 404) return 'disabled';
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'invalid' : 'network';
}

export type MatcherStepRef = { kind: 'question'; step: 1 | 2 | 3 } | { kind: 'trivia'; slot: 0 | 1 };

/** Câu 1, đố 1, câu 2, đố 2, câu 3: câu đố chen giữa cho khách nghỉ một nhịp, câu cuối là cỡ mua ngay trước khi ra bộ. */
export const MATCHER_FLOW: readonly MatcherStepRef[] = [
  { kind: 'question', step: 1 },
  { kind: 'trivia', slot: 0 },
  { kind: 'question', step: 2 },
  { kind: 'trivia', slot: 1 },
  { kind: 'question', step: 3 },
];
export const MATCHER_FLOW_LENGTH = MATCHER_FLOW.length;

export interface MatcherState {
  /** Bước đang đứng (0..4); bằng `MATCHER_FLOW_LENGTH` là đã trả lời xong. */
  index: number;
  /** Đáp án theo mã câu: quay lại đổi câu 1 thì đáp án của nhánh cũ vẫn giữ, chọn lại nhánh đó thấy lại lựa chọn cũ. */
  answers: Readonly<Record<string, string>>;
  /** Lựa chọn câu đố theo ô (0, 1); chọn rồi thì khoá để lời giải không đổi. */
  trivia: Readonly<Record<number, number>>;
}

export const matcherStart = (): MatcherState => ({ index: 0, answers: {}, trivia: {} });

const byStep = (a: MatcherQuestion, b: MatcherQuestion) => a.step - b.step || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** Câu đầu tiên của bước (theo bước rồi mã) không điều kiện hoặc có nhãn khớp: cùng luật `questionFor` của máy chủ. */
export function matcherQuestionFor(questions: readonly MatcherQuestion[], step: number, tags: ReadonlySet<string>): MatcherQuestion | null {
  return [...questions].sort(byStep).find((q) => q.step === step && (q.when === null || q.when.some((t) => tags.has(t)))) ?? null;
}

/** Chuỗi câu đã trả lời trên nhánh hiện tại, dừng ở câu đầu chưa trả lời, kèm nhãn gộp. */
function chain(questions: readonly MatcherQuestion[], answers: Readonly<Record<string, string>>, upto: number) {
  const tags = new Set<string>();
  const picks: Array<{ question: MatcherQuestion; option: MatcherOption }> = [];
  for (let step = 1; step < upto; step++) {
    const question = matcherQuestionFor(questions, step, tags);
    const option = question?.options.find((o) => o.value === answers[question.code]);
    if (!question || !option) break;
    picks.push({ question, option });
    for (const t of option.tags) tags.add(t);
  }
  return { picks, tags };
}

/** Câu của bước `step` theo đáp án các bước trước; null khi bước trước chưa trả lời hoặc nội dung hở nhánh. */
export function matcherQuestionAt(questions: readonly MatcherQuestion[], state: MatcherState, step: number): MatcherQuestion | null {
  const { picks, tags } = chain(questions, state.answers, step);
  return picks.length === step - 1 ? matcherQuestionFor(questions, step, tags) : null;
}

export const matcherCurrent = (state: MatcherState): MatcherStepRef | null => MATCHER_FLOW[state.index] ?? null;

export const matcherDone = (state: MatcherState): boolean => state.index >= MATCHER_FLOW_LENGTH;

/** Trả lời câu nhu cầu đang đứng rồi sang bước kế. Giá trị lạ hay đang ở câu đố thì giữ nguyên. */
export function matcherAnswer(questions: readonly MatcherQuestion[], state: MatcherState, value: string): MatcherState {
  const cur = matcherCurrent(state);
  if (cur?.kind !== 'question') return state;
  const q = matcherQuestionAt(questions, state, cur.step);
  if (!q || !q.options.some((o) => o.value === value)) return state;
  return { ...state, answers: { ...state.answers, [q.code]: value }, index: state.index + 1 };
}

/** Chọn đáp án câu đố đang đứng; đã chọn thì khoá. Sang bước kế bằng `matcherNext`. */
export function matcherChooseTrivia(state: MatcherState, choice: number): MatcherState {
  const cur = matcherCurrent(state);
  if (cur?.kind !== 'trivia' || state.trivia[cur.slot] !== undefined || !Number.isInteger(choice) || choice < 0) return state;
  return { ...state, trivia: { ...state.trivia, [cur.slot]: choice } };
}

/** Sang bước kế: câu đố phải chọn xong; câu nhu cầu phải có đáp án (quay lại rồi đi tiếp không cần chọn lại). */
export function matcherNext(questions: readonly MatcherQuestion[], state: MatcherState): MatcherState {
  const cur = matcherCurrent(state);
  if (!cur) return state;
  if (cur.kind === 'trivia') return state.trivia[cur.slot] === undefined ? state : { ...state, index: state.index + 1 };
  const q = matcherQuestionAt(questions, state, cur.step);
  return q && q.options.some((o) => o.value === state.answers[q.code]) ? { ...state, index: state.index + 1 } : state;
}

export const matcherBack = (state: MatcherState): MatcherState => (state.index > 0 ? { ...state, index: state.index - 1 } : state);

/** Đáp án gửi máy chủ: đúng 3 câu của nhánh hiện tại, thiếu câu nào thì null. Đáp án của nhánh đã bỏ không gửi. */
export function matcherAnswers(questions: readonly MatcherQuestion[], state: MatcherState): MatcherAnswer[] | null {
  const { picks } = chain(questions, state.answers, 4);
  return picks.length === 3 ? picks.map((p) => ({ code: p.question.code, value: p.option.value })) : null;
}

/** Hai câu đố khác nhau theo `seed` (cùng seed cùng cặp). Từ 2 câu trở xuống thì trả hết. */
export function pickMatcherTrivia(trivia: readonly MatcherTrivia[], seed: number): MatcherTrivia[] {
  const n = trivia.length;
  if (n <= 2) return [...trivia];
  const s = Math.abs(Math.floor(seed)) || 0;
  const a = s % n;
  const b = (a + 1 + (Math.floor(s / n) % (n - 1))) % n;
  return [trivia[a]!, trivia[b]!];
}

/** Thời gian chơi gửi analytics: tròn 5 giây (không đủ mịn để nhận ra ai), kẹp 0..3600. */
export const matcherSeconds = (ms: number): number => Math.min(3600, Math.max(0, Math.round(ms / 5000) * 5));

export const matcherTotal = (items: readonly MatcherItem[]): number => items.reduce((n, i) => n + i.price, 0);

/** "Vì sao hợp với bạn": câu máy chủ chọn theo đáp án; bộ dự phòng không có câu riêng nên dùng câu chung. */
export const matcherWhy = (item: MatcherItem): string => (item.why.trim() ? item.why : matcherCopy('result.whyFallback'));

export const matcherCartLines = (items: readonly MatcherItem[]) => items.map((i) => ({ variationId: i.variationId, quantity: 1 }));

/** Tên kèm phân loại khi sản phẩm có nhiều phân loại ("Nước giặt · 3,5L"). */
export const matcherItemName = (item: MatcherItem): string => (item.variationName ? `${item.name} · ${item.variationName}` : item.name);

/** Thẻ dòng (`ProductTile variant="line"`): giá máy chủ đã tính (gồm Giờ vàng), giá gạch là giá niêm yết của phân loại. */
export function matcherItemView(item: MatcherItem, now = Date.now()): ProductCardView {
  const product = {
    id: item.productId,
    slug: item.slug,
    brand: '',
    name: matcherItemName(item),
    thumbnail: item.imageUrl,
    basePrice: item.compareAtPrice ?? item.price,
    salePrice: item.compareAtPrice !== null ? item.price : null,
    isFeatured: false,
    inStock: true,
  };
  return productCardView({ product, variant: 'line', now, showBrand: false });
}

/**
 * Giỏ khách tắt thì khách chưa đăng nhập phải sang đăng nhập mới thêm được. Kết quả chỉ nằm trong bộ nhớ trang nên ghi vào `sessionStorage`
 * trước khi đi; quay về trong `MATCHER_PENDING_TTL_MS` thì bộ hiện lại để khách tự bấm thêm (không tự thêm, không chạy lại, không thưởng lại).
 */
export const MATCHER_PENDING_KEY = 'tubu.matcher.pending.v1';
export const MATCHER_PENDING_TTL_MS = 30 * 60_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const IMAGE_RE = /^(https?:\/\/|\/(?!\/))/;

export function encodeMatcherPending(result: MatcherResult, now: number = Date.now()): string {
  return JSON.stringify({ at: now, result: { ...result, water: 0 } });
}

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000_000;

function readItem(v: unknown): MatcherItem | null {
  if (!v || typeof v !== 'object') return null;
  const i = v as Record<string, unknown>;
  if (!isText(i.slug, 200) || !SLUG_RE.test(i.slug)) return null;
  if (!isText(i.productId, 64) || !ID_RE.test(i.productId) || !isText(i.variationId, 64) || !ID_RE.test(i.variationId)) return null;
  if (!isText(i.name, 200) || i.name.length === 0 || !(i.variationName === null || isText(i.variationName, 120))) return null;
  if (!(i.imageUrl === null || (isText(i.imageUrl, 2000) && IMAGE_RE.test(i.imageUrl)))) return null;
  if (!isPrice(i.price) || !(i.compareAtPrice === null || isPrice(i.compareAtPrice)) || typeof i.flash !== 'boolean' || !isText(i.why, 200)) {
    return null;
  }
  return {
    slug: i.slug,
    productId: i.productId,
    variationId: i.variationId,
    name: i.name,
    variationName: i.variationName,
    imageUrl: i.imageUrl,
    price: i.price,
    compareAtPrice: i.compareAtPrice,
    flash: i.flash,
    why: i.why,
  };
}

/** Đọc bộ chờ; quá hạn, hỏng hay sai dạng là null (không tin dữ liệu trong trình duyệt). Giá chỉ để xem lại: giỏ tính lại giá thật. */
export function decodeMatcherPending(raw: string | null, now: number = Date.now()): MatcherResult | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { at, result } = v as { at?: unknown; result?: unknown };
  if (typeof at !== 'number' || at > now || now - at > MATCHER_PENDING_TTL_MS || !result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (!isText(r.outcomeId, 64) || !ID_RE.test(r.outcomeId) || !isText(r.code, 40) || !isText(r.title, 80) || typeof r.fallback !== 'boolean') {
    return null;
  }
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > 4) return null;
  const items: MatcherItem[] = [];
  for (const x of r.items) {
    const item = readItem(x);
    if (!item) return null;
    items.push(item);
  }
  return { outcomeId: r.outcomeId, code: r.code, title: r.title, fallback: r.fallback, items, total: matcherTotal(items), water: 0 };
}
