import { MINI_SORT_BINS, type MiniProductCard, type MiniSortBin } from '@tubutree/shared-types';
import { readChoicePayload } from '../mini/games/choice';
import { readKitchenSwapPayload } from '../mini/games/kitchen-swap';
import { readMatchPayload } from '../mini/games/match';
import { shuffled } from '../mini/games/random';
import { readSortPayload } from '../mini/games/sort';
import { ALBUM_MATCH_OPTIONS, type AlbumGame } from './album.constants';
import { ALBUM_BIN_LABEL, albumQuestion } from './album-notice';

/** Một mục nội dung có vào sổ: game có vào sổ, đã kiểm nguồn (`sourceCheckedAt`). `active` = false là mục admin đã tắt. */
export interface AlbumItem {
  id: string;
  game: AlbumGame;
  payload: unknown;
  explanation: string;
  sourceUrl: string;
  productSlug: string | null;
  active: boolean;
}

/** Nội dung dùng chung cho mọi khách (đệm 60 giây): mục, thẻ sản phẩm đang bán, thùng của Đúng Thùng. */
export interface AlbumContent {
  items: ReadonlyMap<string, AlbumItem>;
  products: ReadonlyMap<string, MiniProductCard>;
  /** Thùng của câu ôn Đúng Thùng: 3 thùng chuẩn, thêm "Nguy hại" khi kho đang bật có vật nguy hại (như game: số thùng không lộ đáp án). */
  sortBins: MiniSortBin[];
}

/** Câu ôn đã phát, lưu trong `game_album_reviews.questions` để chấm đúng câu đã phát dù nội dung đổi sau đó. */
export interface AlbumQuestion {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  sourceUrl: string;
  productSlug: string | null;
}

const STANDARD_BINS: MiniSortBin[] = ['recycle', 'food', 'other'];

export function sortBinsFor(items: Iterable<AlbumItem>): MiniSortBin[] {
  for (const item of items) {
    if (item.game === 'sort' && item.active && readSortPayload(item.payload)?.bin === 'hazardous') return [...STANDARD_BINS, 'hazardous'];
  }
  return [...STANDARD_BINS];
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Slug sản phẩm mục này cần thẻ: sản phẩm gắn với câu/cặp, hoặc 3 sản phẩm để đổi của Căn Bếp Xanh. */
export function albumProductSlugs(item: AlbumItem): string[] {
  if (item.game === 'kitchen_swap') return readKitchenSwapPayload(item.payload)?.options.map((o) => o.slug) ?? [];
  return item.productSlug ? [item.productSlug] : [];
}

/** Chữ của thẻ: tiêu đề (câu, món, nguyên liệu) và đáp án đúng. null khi payload hỏng. */
export function cardText(item: AlbumItem, products: ReadonlyMap<string, MiniProductCard>): { title: string; answer: string | null } | null {
  switch (item.game) {
    case 'sort': {
      const p = readSortPayload(item.payload);
      return p ? { title: p.emoji ? `${p.emoji} ${p.label}` : p.label, answer: ALBUM_BIN_LABEL[p.bin] } : null;
    }
    case 'daily_quiz':
    case 'origin': {
      const p = readChoicePayload(item.payload);
      return p ? { title: p.prompt, answer: p.options[p.answer] ?? null } : null;
    }
    case 'match': {
      const p = readMatchPayload(item.payload);
      return p ? { title: p.ingredient, answer: p.use } : null;
    }
    case 'kitchen_swap': {
      const p = readKitchenSwapPayload(item.payload);
      return p ? { title: p.emoji ? `${p.emoji} ${p.item}` : p.item, answer: products.get(p.answer)?.name ?? null } : null;
    }
  }
}

/** Sản phẩm liên quan của thẻ (tối đa một): đang bán và còn hàng. Căn Bếp Xanh lấy sản phẩm đáp án. */
export function relatedProduct(item: AlbumItem, products: ReadonlyMap<string, MiniProductCard>): MiniProductCard | null {
  const slug = item.game === 'kitchen_swap' ? readKitchenSwapPayload(item.payload)?.answer : item.productSlug;
  const card = slug ? products.get(slug) : undefined;
  return card?.inStock ? card : null;
}

/**
 * Câu ôn trắc nghiệm một đáp án dựng từ một thẻ, cùng dạng câu của Đố Xanh để dùng lại bàn chơi sẵn có:
 * - Đố Xanh, Đoán Xuất Xứ: đúng câu và lựa chọn của mục.
 * - Đúng Thùng: "món: bỏ vào thùng nào?", lựa chọn là các thùng (đủ bộ thùng của kho, không chỉ thùng đúng).
 * - Ghép Cặp: "nguyên liệu dùng để làm gì?", công dụng đúng và công dụng của cặp khác đang bật (bỏ cặp có nguyên liệu lồng nhau, vd "Baking soda"
 *   và "Baking soda trộn giấm", để không có hai đáp án cùng đúng).
 * - Căn Bếp Xanh: "món: đổi sang sản phẩm nào?", tên 3 sản phẩm của món (cả 3 phải còn đang bán, không thì bỏ câu).
 * null khi không dựng được câu.
 */
export function buildQuestion(item: AlbumItem, content: AlbumContent, rng: () => number): AlbumQuestion | null {
  const base = { id: item.id, explanation: item.explanation, sourceUrl: item.sourceUrl, productSlug: item.productSlug };
  switch (item.game) {
    case 'daily_quiz':
    case 'origin': {
      const p = readChoicePayload(item.payload);
      return p ? { ...base, prompt: p.prompt, options: p.options, answer: p.answer } : null;
    }
    case 'sort': {
      const p = readSortPayload(item.payload);
      if (!p) return null;
      const bins = content.sortBins.includes(p.bin) ? content.sortBins : [...content.sortBins, p.bin];
      const ordered = MINI_SORT_BINS.filter((b) => bins.includes(b));
      const label = p.emoji ? `${p.emoji} ${p.label}` : p.label;
      return { ...base, prompt: albumQuestion.sort(label), options: ordered.map((b) => ALBUM_BIN_LABEL[b]), answer: ordered.indexOf(p.bin) };
    }
    case 'match': {
      const p = readMatchPayload(item.payload);
      if (!p) return null;
      const own = norm(p.ingredient);
      const uses = new Set([norm(p.use)]);
      const distractors: string[] = [];
      for (const other of shuffled([...content.items.values()], rng)) {
        if (other.id === item.id || other.game !== 'match' || !other.active) continue;
        const q = readMatchPayload(other.payload);
        if (!q) continue;
        const ing = norm(q.ingredient);
        if (ing.includes(own) || own.includes(ing) || uses.has(norm(q.use))) continue;
        uses.add(norm(q.use));
        distractors.push(q.use);
        if (distractors.length === ALBUM_MATCH_OPTIONS - 1) break;
      }
      if (distractors.length < ALBUM_MATCH_OPTIONS - 1) return null;
      const options = shuffled([p.use, ...distractors], rng);
      return { ...base, prompt: albumQuestion.match(p.ingredient), options, answer: options.indexOf(p.use) };
    }
    case 'kitchen_swap': {
      const p = readKitchenSwapPayload(item.payload);
      if (!p) return null;
      const named = p.options.map((o) => ({ slug: o.slug, name: content.products.get(o.slug)?.name }));
      if (named.some((o) => !o.name)) return null;
      if (new Set(named.map((o) => norm(o.name!))).size !== named.length) return null;
      const order = shuffled(named, rng);
      return {
        ...base,
        productSlug: p.answer,
        prompt: albumQuestion.kitchen(p.item),
        options: order.map((o) => o.name!),
        answer: order.findIndex((o) => o.slug === p.answer),
      };
    }
  }
}
