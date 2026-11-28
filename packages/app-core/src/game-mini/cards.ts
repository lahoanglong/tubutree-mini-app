import type { MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from './copy';
import { miniGameDesc, miniGameTitle, miniRowStatus, playableToday, type PlayableMiniGame } from './format';

/**
 * Thẻ game 2 cột của "Chơi hôm nay" (Mini App và web cùng dữ liệu, cùng thứ tự): tông nền, nhãn "Mới", tên, mô tả, lượt thưởng. App chỉ
 * chọn hình (biểu tượng hoặc hình vector) theo `id` và vẽ.
 */
export type MiniCardId = PlayableMiniGame | 'matcher';

/** Tông nền của thẻ; CSS ánh sang token ngữ nghĩa (`[data-tone]`). */
export type MiniCardTone = 'leaf' | 'sky' | 'amber' | 'mint' | 'rose' | 'sand' | 'peach' | 'fern' | 'lilac';

export const MINI_CARD_TONE: Record<MiniCardId, MiniCardTone> = {
  eco_merge: 'leaf',
  green_conveyor: 'sky',
  daily_quiz: 'amber',
  sort: 'mint',
  match: 'rose',
  origin: 'sand',
  basket: 'peach',
  kitchen_swap: 'fern',
  matcher: 'lilac',
};

/** Game vừa ra mắt, gắn nhãn "Mới" trên thẻ. */
export const MINI_NEW_GAMES: readonly PlayableMiniGame[] = ['eco_merge', 'green_conveyor'];

export interface MiniGameCard {
  id: MiniCardId;
  title: string;
  desc: string;
  tone: MiniCardTone;
  /** Chữ nhãn "Mới" hoặc null. */
  badge: string | null;
  /** Dòng lượt thưởng; Chọn Chuẩn Xanh không có (thưởng không hứa trước). */
  status: { text: string; tone: 'brand' | 'secondary' } | null;
}

/** Thẻ theo thứ tự cố định: game máy chủ đang bật, Chọn Chuẩn Xanh cuối cùng khi cờ của nó bật. */
export function miniGameCards(today: MiniTodayResponse, matcher: boolean): MiniGameCard[] {
  const cards: MiniGameCard[] = playableToday(today).map((g) => ({
    id: g.game,
    title: miniGameTitle(g.game),
    desc: miniGameDesc(g.game),
    tone: MINI_CARD_TONE[g.game],
    badge: MINI_NEW_GAMES.includes(g.game) ? gameCopy('card.new') : null,
    status: miniRowStatus(today, g),
  }));
  if (matcher) {
    cards.push({ id: 'matcher', title: gameCopy('game.matcher.title'), desc: gameCopy('game.matcher.desc'), tone: MINI_CARD_TONE.matcher, badge: null, status: null });
  }
  return cards;
}
