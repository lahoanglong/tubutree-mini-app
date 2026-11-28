import type { MiniTodayResponse } from '@tubutree/shared-types';
import type { ArcadeStatus } from '../api/game';
import { ARCADE_GAME_IDS, type ArcadeGameId } from '../arcade/arcade-config';
import { gameCopy } from '../game-mini/copy';
import { miniGameTitle, miniRowStatus, playableToday, type PlayableMiniGame } from '../game-mini/format';
import { fillCopy } from '../shop-copy';
import { hubCopy } from './copy';

/** Hình minh hoạ của thẻ (mỗi app vẽ SVG theo khoá này). Game chưa có hình riêng dùng `leaf`. */
export type HubArt = 'dew' | 'rush' | 'quiz' | 'sort' | 'match' | 'origin' | 'basket' | 'kitchen' | 'merge' | 'conveyor' | 'matcher' | 'wheel' | 'leaf';
/** Nền chuyển màu của thẻ: mỗi game một tông để lưới hai cột không thành một mảng xanh đều. */
export type HubTone = 'sky' | 'mint' | 'sun' | 'berry' | 'earth' | 'leaf';

export type HubAction =
  | { kind: 'arcade'; game: ArcadeGameId }
  | { kind: 'mini'; game: PlayableMiniGame }
  | { kind: 'matcher' }
  | { kind: 'wheel' };

export interface HubCard {
  /** Mã game: `dew_catcher`, mã game mini, `matcher`, `wheel`. */
  id: string;
  title: string;
  art: HubArt;
  tone: HubTone;
  /** "+💧 · Điểm Xanh": thứ khách nhận được; null khi game không hứa thưởng trước. */
  reward: string | null;
  best: string | null;
  status: { text: string; tone: 'brand' | 'secondary' } | null;
  badge: { kind: 'new' | 'bonus'; text: string } | null;
  cta: string;
  action: HubAction;
}

export interface HubInput {
  /** Khách thật đã đăng nhập: kỷ lục và lượt thưởng arcade lấy từ máy chủ. */
  real: boolean;
  arcade: ArcadeStatus | undefined;
  /** Kỷ lục lưu trên máy của khách chơi thử. */
  guestBest: Partial<Record<ArcadeGameId, number>> | null;
  /** Đang trong khung giờ thưởng của arcade (Sương Sớm, Mưa Rào). */
  bonusWindow: boolean;
  /** "Chơi hôm nay" của game mini; null khi `game.mini.enabled` tắt. */
  mini: MiniTodayResponse | null;
  matcher: boolean;
  /** Giá một lượt quay; null thì không có thẻ Vòng quay (khách chưa đăng nhập). */
  wheelCost: number | null;
}

const ARCADE_META: Record<ArcadeGameId, { copy: 'dew' | 'rush'; art: HubArt; tone: HubTone }> = {
  dew_catcher: { copy: 'dew', art: 'dew', tone: 'sky' },
  refill_rush: { copy: 'rush', art: 'rush', tone: 'sun' },
};

/** Theo mã chuỗi (không theo kiểu `PlayableMiniGame`): game mini mới thêm ở gói khác tự có hình và tông khi mã khớp, mã lạ rơi về `leaf`. */
const MINI_META: Readonly<Record<string, { art: HubArt; tone: HubTone }>> = {
  daily_quiz: { art: 'quiz', tone: 'mint' },
  sort: { art: 'sort', tone: 'leaf' },
  match: { art: 'match', tone: 'berry' },
  origin: { art: 'origin', tone: 'earth' },
  basket: { art: 'basket', tone: 'sun' },
  kitchen_swap: { art: 'kitchen', tone: 'mint' },
  eco_merge: { art: 'merge', tone: 'leaf' },
  green_conveyor: { art: 'conveyor', tone: 'sky' },
};

/** Game mới ra: gắn huy hiệu "Mới" và xếp lên đầu sảnh. Bỏ mã khỏi đây khi game đã quen. */
export const HUB_NEW_GAMES: readonly string[] = ['eco_merge', 'green_conveyor'];

const fmt = (n: number) => n.toLocaleString('vi-VN');

function arcadeStatus(input: HubInput, id: ArcadeGameId): HubCard['status'] {
  if (!input.real) return { text: gameCopy('row.trial'), tone: 'secondary' };
  const s = input.arcade?.games[id];
  if (!s) return null;
  const left = Math.max(0, s.cap - s.used);
  return left > 0 ? { text: gameCopy('row.left', { n: left }), tone: 'brand' } : { text: gameCopy('row.full'), tone: 'secondary' };
}

function arcadeCard(input: HubInput, id: ArcadeGameId): HubCard {
  const meta = ARCADE_META[id];
  const best = input.real ? input.arcade?.games[id]?.bestScore ?? 0 : input.guestBest?.[id] ?? 0;
  return {
    id,
    title: fillCopy(`arcade.${meta.copy}.title`),
    art: meta.art,
    tone: meta.tone,
    reward: hubCopy('reward.water'),
    best: best > 0 ? hubCopy('best', { n: fmt(best) }) : null,
    status: arcadeStatus(input, id),
    badge: input.bonusWindow ? { kind: 'bonus', text: hubCopy('badge.bonus') } : null,
    cta: hubCopy(input.real ? 'cta.play' : 'cta.try'),
    action: { kind: 'arcade', game: id },
  };
}

/**
 * Mọi game chơi được ở Sảnh Game, theo thứ tự hiện: game "Mới" trước, rồi hai game hành động (canvas), game mini theo thứ tự của "Chơi hôm nay",
 * Chọn Chuẩn Xanh, Vòng quay. Game mini chỉ có khi máy chủ bật `game.mini.enabled` và đủ nội dung; hai game hành động luôn có.
 * Logic ở đây để Mini App và web vẽ cùng một danh sách.
 */
export function buildHubCards(input: HubInput): HubCard[] {
  const cards: HubCard[] = ARCADE_GAME_IDS.map((id) => arcadeCard(input, id));
  const today = input.mini;
  if (today) {
    for (const g of playableToday(today)) {
      const meta = MINI_META[g.game] ?? { art: 'leaf' as const, tone: 'leaf' as const };
      cards.push({
        id: g.game,
        title: miniGameTitle(g.game),
        art: meta.art,
        tone: meta.tone,
        reward: hubCopy('reward.waterPoints'),
        best: null,
        status: miniRowStatus(today, g),
        badge: HUB_NEW_GAMES.includes(g.game) ? { kind: 'new', text: hubCopy('badge.new') } : null,
        cta: hubCopy(today.rewardEligible ? 'cta.play' : 'cta.try'),
        action: { kind: 'mini', game: g.game },
      });
    }
  }
  if (input.matcher) {
    cards.push({
      id: 'matcher',
      title: gameCopy('game.matcher.title'),
      art: 'matcher',
      tone: 'berry',
      reward: hubCopy('reward.matcher'),
      best: null,
      status: null,
      badge: null,
      cta: hubCopy('cta.open'),
      action: { kind: 'matcher' },
    });
  }
  if (input.wheelCost != null) {
    cards.push({
      id: 'wheel',
      title: hubCopy('wheel.title'),
      art: 'wheel',
      tone: 'sun',
      reward: hubCopy('reward.wheel'),
      best: null,
      status: { text: hubCopy('wheel.cost', { n: fmt(input.wheelCost) }), tone: 'secondary' },
      badge: null,
      cta: hubCopy('cta.wheel'),
      action: { kind: 'wheel' },
    });
  }
  const isNew = (c: HubCard) => (c.badge?.kind === 'new' ? 0 : 1);
  return cards.map((c, i) => ({ c, i })).sort((a, b) => isNew(a.c) - isNew(b.c) || a.i - b.i).map((x) => x.c);
}

/**
 * Tên đọc của cả thẻ (thẻ là một nút): đúng chữ nút và tên game nhìn thấy, để khách điều khiển bằng giọng gọi được (WCAG 2.5.3). Huy hiệu, thưởng,
 * kỷ lục, lượt còn lại là phần mô tả (`aria-describedby`), không nhồi vào tên.
 */
export const hubCardLabel = (card: HubCard): string => `${card.cta} ${card.title}`;
