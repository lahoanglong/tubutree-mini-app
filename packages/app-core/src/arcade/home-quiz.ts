import { fillCopy } from '../shop-copy';

export type HomeQuizFamily = 'baby_pet' | 'adult_only';
export type HomeQuizWorry = 'dry_skin' | 'strong_scent' | 'grease';
export type HomeQuizFormat = 'bottle' | 'refill';
export interface HomeQuizAnswers {
  family: HomeQuizFamily;
  worry: HomeQuizWorry;
  format: HomeQuizFormat;
}

const STEPS: readonly (readonly [keyof HomeQuizAnswers, ...(readonly [string, string])[]])[] = [
  ['family', ['baby_pet', '🐾'], ['adult_only', '🏡']],
  ['worry', ['dry_skin', '🖐️'], ['strong_scent', '👃'], ['grease', '🍳']],
  ['format', ['bottle', '🧴'], ['refill', '🛍️']],
];
export const homeQuizQuestions = () =>
  STEPS.map(([id, ...opts]) => ({ id, title: fillCopy(`homeQuiz.${id}.title`), options: opts.map(([value, emoji]) => ({ value, emoji, label: fillCopy(`homeQuiz.${id}.${value}`) })) }));

/** Từ khoá đã bỏ dấu, khớp theo nguyên từ. */
const KEYWORDS: Record<string, string[]> = {
  baby_pet: ['an toan', 'diu nhe', 'huu co', 'thien nhien', 'bo hon'],
  adult_only: [],
  dry_skin: ['diu nhe', 'duong am', 'da tay', 'rua tay', 'bo hon', 'huu co'],
  strong_scent: ['tinh dau', 'huong nhe', 'khong mui', 'tram', 'sa chanh', 'bo hon', 'huu co'],
  grease: ['rua chen', 'dau mo', 'tay dau', 'chen bat', 'bo hon'],
  bottle: ['chai', 'voi'],
  refill: ['refill', 'tui'],
};
const fold = (s: string) => ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Trường của `ProductCard` và `ProductDTO`; ngoài `id`, `name` đều tuỳ chọn. */
export interface KitProduct {
  id: string;
  name: string;
  category?: string | null;
  tags?: readonly string[] | null;
  shortDesc?: string | null;
  description?: string | null;
  inStock?: boolean;
  isActive?: boolean;
  basePrice?: number;
  isFeatured?: boolean;
  sold?: number;
}

function matchScore(p: KitProduct, a: HomeQuizAnswers): number {
  const [name, meta, desc] = [fold(p.name), fold([p.category, ...(p.tags ?? [])].join(' ')), fold(`${p.shortDesc ?? ''} ${p.description ?? ''}`)];
  let score = 0;
  for (const [key, w] of [[a.family, 1], [a.worry, 1], [a.format, a.format === 'refill' ? 3 : 1]] as const) {
    for (const kw of KEYWORDS[key]!) score += w * ((name.includes(` ${kw} `) ? 3 : 0) + (meta.includes(` ${kw} `) ? 2 : 0) + (desc.includes(` ${kw} `) ? 1 : 0));
  }
  return score;
}

/** 2–3 món còn bán hợp câu trả lời; thiếu thì bổ sung món nổi bật, bán chạy; không có món bán được thì []. */
export function pickKitProducts<T extends KitProduct>(answers: HomeQuizAnswers, products: readonly T[], max = 3): T[] {
  const rows = products
    .map((p, i) => ({ p, i, score: p.isActive !== false && p.inStock !== false && (p.basePrice ?? 1) > 0 ? matchScore(p, answers) : -1 }))
    .filter((r) => r.score >= 0);
  const rank = (a: (typeof rows)[number], b: (typeof rows)[number]) => Number(!!b.p.isFeatured) - Number(!!a.p.isFeatured) || (b.p.sold ?? 0) - (a.p.sold ?? 0) || a.i - b.i;
  const picked = rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || rank(a, b)).slice(0, max);
  if (picked.length < Math.min(2, max)) picked.push(...rows.filter((r) => r.score === 0).sort(rank).slice(0, Math.min(2, max) - picked.length));
  return picked.map((r) => r.p);
}
