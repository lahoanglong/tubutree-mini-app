import { MINI_GAME_RULES, MINI_SORT_BINS, type MiniSortBin } from '@tubutree/shared-types';
import { isRecord, text, type MiniContentRow, type MiniGameDef } from './game-def';
import { shuffled } from './random';

/** Đúng Thùng: `payload` = { label, bin, emoji? }. Đáp án là `bin`, không bao giờ rời máy chủ trước khi nộp. */
interface SortPayload {
  label: string;
  bin: MiniSortBin;
  emoji: string | null;
}

const STANDARD_BINS: MiniSortBin[] = ['recycle', 'food', 'other'];

function isBin(v: unknown): v is MiniSortBin {
  return typeof v === 'string' && (MINI_SORT_BINS as readonly string[]).includes(v);
}

export function readSortPayload(raw: unknown): SortPayload | null {
  if (!isRecord(raw)) return null;
  const label = text(raw.label, 80);
  if (!label || !isBin(raw.bin)) return null;
  const emoji = raw.emoji === undefined || raw.emoji === null ? null : text(raw.emoji, 16);
  if (raw.emoji !== undefined && raw.emoji !== null && emoji === null) return null;
  return { label, bin: raw.bin, emoji };
}

function payloadOf(row: MiniContentRow): SortPayload {
  const p = readSortPayload(row.payload);
  if (!p) throw new Error(`game_content_items ${row.id}: payload Đúng Thùng hỏng`);
  return p;
}

export const sortGame: MiniGameDef = {
  game: 'sort',
  payloadError: (payload) =>
    readSortPayload(payload) ? null : `Đúng Thùng cần { label: chữ 1–80 ký tự, bin: ${MINI_SORT_BINS.join(' | ')}, emoji?: chữ ≤ 16 ký tự }.`,
  productSlugs: () => [],
  usable: (row) => readSortPayload(row.payload) !== null,
  pick(pool, ctx) {
    const size = MINI_GAME_RULES.sort.items;
    const usable = pool.filter((r) => readSortPayload(r.payload) !== null);
    if (usable.length < size) return null;
    return shuffled(usable, ctx.rng).slice(0, size);
  },
  build(rows, ctx) {
    return {
      game: 'sort',
      bins: ctx.sortHazardous ? [...STANDARD_BINS, 'hazardous'] : [...STANDARD_BINS],
      items: rows.map((r) => {
        const p = payloadOf(r);
        return { id: r.id, label: p.label, emoji: p.emoji };
      }),
    };
  },
  parseAnswers(raw, rows) {
    if (raw.length !== rows.length) return null;
    if (!raw.every((a) => a === null || isBin(a))) return null;
    return raw as (MiniSortBin | null)[];
  },
  grade(rows, answers) {
    const given = answers as (MiniSortBin | null)[];
    const items = rows.map((r, i) => {
      const p = payloadOf(r);
      const g = given[i] ?? null;
      return { contentId: r.id, label: p.label, given: g, expected: p.bin, correct: g === p.bin, explanation: r.explanation, sourceUrl: r.sourceUrl };
    });
    return {
      correct: items.filter((i) => i.correct).length,
      total: rows.length,
      correctIds: items.filter((i) => i.correct).map((i) => i.contentId),
      review: { game: 'sort', items },
    };
  },
};
