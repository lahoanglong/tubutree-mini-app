import { MINI_GAME_RULES } from '@tubutree/shared-types';
import { isRecord, text, type MiniContentRow, type MiniGameDef, type MiniPickCtx } from './game-def';
import { dayNumber, shuffled } from './random';

/**
 * Trắc nghiệm một đáp án: Đố Xanh (`daily_quiz`) và Đoán Xuất Xứ (`origin`, lựa chọn là vùng). `payload` = { prompt, options, answer }
 * với `answer` là chỉ số trong `options`. Câu `game_quizzes` cũ đi qua bộ chuyển (question → prompt, correct → answer).
 */
interface ChoicePayload {
  prompt: string;
  options: string[];
  answer: number;
}

export function readChoicePayload(raw: unknown): ChoicePayload | null {
  if (!isRecord(raw)) return null;
  const prompt = text(raw.prompt, 300);
  if (!prompt || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 4) return null;
  const options = raw.options.map((o) => text(o, 120));
  if (options.some((o) => o === null)) return null;
  if (new Set(options.map((o) => o!.toLowerCase())).size !== options.length) return null;
  const answer = raw.answer;
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return { prompt, options: options as string[], answer };
}

function payloadOf(row: MiniContentRow): ChoicePayload {
  const p = readChoicePayload(row.payload);
  if (!p) throw new Error(`nội dung ${row.id}: payload trắc nghiệm hỏng`);
  return p;
}

const PAYLOAD_HINT = '{ prompt: chữ 1–300 ký tự, options: 2–4 lựa chọn khác nhau (mỗi lựa chọn 1–120 ký tự), answer: chỉ số đáp án đúng (0 là lựa chọn đầu) }';

/**
 * Đố Xanh: 3 câu cố định theo ngày VN, cùng bộ cho mọi người. Câu thứ 3 là câu gắn sản phẩm (nếu kho có), xoay vòng riêng; 2 câu đầu
 * xoay vòng trên phần còn lại theo thứ tự id. Chọn theo việc câu CÓ gắn slug (không theo sản phẩm còn bán) để bộ câu không đổi giữa
 * ngày khi một sản phẩm bị ẩn: lúc đó câu vẫn ở đó, chỉ thiếu thẻ sản phẩm.
 */
export function pickDailyQuiz(pool: readonly MiniContentRow[], ctx: Pick<MiniPickCtx, 'dayKey'>): MiniContentRow[] | null {
  const size = MINI_GAME_RULES.daily_quiz.items;
  const usable = pool.filter((r) => readChoicePayload(r.payload) !== null).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (usable.length < size) return null;
  const day = dayNumber(ctx.dayKey);
  const linked = usable.filter((r) => r.productSlug);
  const rotate = (list: readonly MiniContentRow[], count: number): MiniContentRow[] => {
    const offset = (((day * count) % list.length) + list.length) % list.length;
    return Array.from({ length: count }, (_, i) => list[(offset + i) % list.length]!);
  };
  if (linked.length === 0) return rotate(usable, size);
  const third = linked[((day % linked.length) + linked.length) % linked.length]!;
  const rest = usable.filter((r) => r.id !== third.id);
  return [...rotate(rest, size - 1), third];
}

/** Đoán Xuất Xứ: 5 mục ngẫu nhiên; lượt cuối là mục gắn sản phẩm đang bán nếu có, để màn kết quả dẫn sang trang sản phẩm. */
export function pickOrigin(pool: readonly MiniContentRow[], ctx: MiniPickCtx): MiniContentRow[] | null {
  const size = MINI_GAME_RULES.origin.items;
  const usable = shuffled(pool.filter((r) => readChoicePayload(r.payload) !== null), ctx.rng);
  if (usable.length < size) return null;
  const withProduct = usable.find((r) => r.productSlug && ctx.products.has(r.productSlug));
  if (!withProduct) return usable.slice(0, size);
  return [...usable.filter((r) => r.id !== withProduct.id).slice(0, size - 1), withProduct];
}

function choiceGame(game: 'daily_quiz' | 'origin', name: string): MiniGameDef {
  return {
    game,
    payloadError: (payload) => (readChoicePayload(payload) ? null : `${name} cần ${PAYLOAD_HINT}.`),
    productSlugs: (row) => (row.productSlug ? [row.productSlug] : []),
    usable: (row) => readChoicePayload(row.payload) !== null,
    pick: (pool, ctx) => (game === 'daily_quiz' ? pickDailyQuiz(pool, ctx) : pickOrigin(pool, ctx)),
    build(rows, ctx) {
      return {
        game,
        items: rows.map((r) => {
          const p = payloadOf(r);
          return { id: r.id, prompt: p.prompt, options: p.options, product: (r.productSlug && ctx.products.get(r.productSlug)) || null };
        }),
      };
    },
    parseAnswers(raw, rows) {
      if (raw.length !== rows.length) return null;
      const ok = raw.every((a, i) => a === null || (typeof a === 'number' && Number.isInteger(a) && a >= 0 && a < payloadOf(rows[i]!).options.length));
      return ok ? (raw as (number | null)[]) : null;
    },
    grade(rows, answers) {
      const given = answers as (number | null)[];
      const items = rows.map((r, i) => {
        const p = payloadOf(r);
        const g = given[i] ?? null;
        return {
          contentId: r.id,
          prompt: p.prompt,
          given: g,
          expected: p.answer,
          correct: g === p.answer,
          explanation: r.explanation,
          sourceUrl: r.sourceUrl,
          productSlug: r.productSlug,
        };
      });
      return {
        correct: items.filter((i) => i.correct).length,
        total: rows.length,
        correctIds: items.filter((i) => i.correct).map((i) => i.contentId),
        review: { game, items },
      };
    },
  };
}

export const dailyQuizGame = choiceGame('daily_quiz', 'Đố Xanh');
export const originGame = choiceGame('origin', 'Đoán Xuất Xứ');
