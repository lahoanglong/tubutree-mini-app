import { lazy, Suspense, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, LayoutGrid, MapPin, Recycle, RefreshCw, ShoppingCart, Sparkles, type LucideIcon } from 'lucide-react';
import { isMiniArcadeGameId, type MiniArcadeGameId, type MiniTodayResponse } from '@tubutree/shared-types';
import { miniGameCards, type MiniCardId, type MiniGameCard } from '@tubutree/app-core/game-mini/cards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniTodayQuery } from '@tubutree/app-core/game-mini/today';
import { MATCHER_MINI_PATH, matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { miniEarnQuizLeft, miniPlayPath, playableToday } from '@tubutree/app-core/game-mini/format';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { refreshAccessToken } from '../../../services/api';
import { coreHttp } from '../../../services/core-http';
import type { EarnQuizState } from '../earn-water-sheet';
import { SilentBoundary } from '../../route-shell';
import { Card } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { Heading, Text } from '../../ui/text';
import './mini-game.css';

/** Biểu tượng thẻ của game cũ; game thao tác có hình vector riêng (`ArcadeCardArt`, nạp lười, ô hình giữ cỡ cố định nên không xô thẻ). */
const CARD_ICON: Record<Exclude<MiniCardId, MiniArcadeGameId>, LucideIcon> = {
  daily_quiz: CircleHelp,
  sort: Recycle,
  match: LayoutGrid,
  origin: MapPin,
  basket: ShoppingCart,
  kitchen_swap: RefreshCw,
  matcher: Sparkles,
};

const refreshSession = () => refreshAccessToken().then(Boolean);

// Dòng "Sổ tay Xanh" ngay dưới khối, chunk riêng của sổ (`game.tsx` đã chạm trần 400 dòng của game-layout.spec).
const AlbumLine = lazy(() => import('../../../pages/game-album').then((m) => ({ default: m.AlbumLine })));
const ArcadeCardArt = lazy(() => import('./mini-arcade-ui').then((m) => ({ default: m.ArcadeCardArt })));

/**
 * Lượt game mini hôm nay cho trang Vườn Xanh. Máy chủ trả 404 khi `game.mini.enabled` tắt: `today` là null và trang giữ khối đố vui, sảnh arcade
 * cũ. `quiz` chỉ có khi chính Đố Xanh đang mở (Đố Xanh tắt riêng được trong khi Đúng Thùng vẫn bật): lúc đó Đố Xanh thay khối đố vui cũ, cả ở sheet
 * Kiếm nước.
 */
export function useMiniToday(enabled: boolean, authed: boolean) {
  const { data } = useQuery({ ...miniTodayQuery(coreHttp, authed, refreshSession), enabled });
  const today = data && playableToday(data).length > 0 ? data : null;
  const quizOpen = today?.games.some((g) => g.game === 'daily_quiz') ?? false;
  const earn: EarnQuizState | null = today && quizOpen ? { status: 'ready', left: miniEarnQuizLeft(today) } : null;
  return { today, quiz: earn && { earn, path: miniPlayPath.miniapp('daily_quiz') } };
}

/** Một thẻ game: hình trên nền tông riêng, nhãn "Mới", tên, mô tả hai dòng, lượt thưởng còn lại; chạm thẻ mở màn chơi. */
function GameCard({ card, to }: { card: MiniGameCard; to: string }) {
  const navigate = useSmartNavigate();
  const id = card.id;
  return (
    <li>
      <button type="button" className="tubu-mg-gcard" data-tone={card.tone} data-testid={`mini-play-row-${card.id}`} onClick={() => navigate(to)}>
        <span className="tubu-mg-gcard-art" aria-hidden>
          {isMiniArcadeGameId(id) ? (
            <SilentBoundary>
              <Suspense fallback={null}>
                <ArcadeCardArt game={id} />
              </Suspense>
            </SilentBoundary>
          ) : (
            <Icon icon={CARD_ICON[id]} tone="brand" />
          )}
        </span>
        {card.badge && <span className="tubu-mg-gcard-badge">{card.badge}</span>}
        <Text variant="label" as="span" className="tubu-mg-gcard-title">
          {card.title}
        </Text>
        <Text variant="caption" tone="secondary" as="span" className="tubu-mg-gcard-desc">
          {card.desc}
        </Text>
        {card.status && (
          <Text variant="caption" tone={card.status.tone} as="span" data-testid={`mini-play-status-${card.id}`}>
            {card.status.text}
          </Text>
        )}
      </button>
    </li>
  );
}

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Lưới 2 cột, mỗi game một
 * thẻ có hình (dữ liệu và thứ tự ở `miniGameCards`, app-core), chạm thẻ mở màn chơi ngay trong Mini App. Cùng bố cục với web: cờ
 * `game.matcher_enabled` bật thì thêm thẻ Chọn Chuẩn Xanh cuối lưới. `inset`: đứng ngoài lưới thẻ của trang (dưới cổng đăng nhập) nên tự lùi lề.
 */
export function PlayTodayCard({ today, inset = false }: { today: MiniTodayResponse; inset?: boolean }) {
  const titleId = useId();
  const cards = miniGameCards(today, matcherOn(useQuery(matcherStatusQuery(coreHttp)).data));
  return (
    <>
    <section
      aria-labelledby={titleId}
      data-testid="mini-play-today"
      style={inset ? { padding: 'var(--space-stack-sm) var(--space-inset-page) 0' } : undefined}
    >
      <Card variant="flat" padding={16}>
        <div className="tubu-mg-today">
          <Heading as="h2" id={titleId} variant="title-sm" font="ui">
            {gameCopy('entry.title')}
          </Heading>
          <Text variant="body-sm" tone="secondary" as="p">
            {gameCopy('entry.sub')}
          </Text>
          <ul className="tubu-mg-gcards">
            {cards.map((c) => (
              <GameCard key={c.id} card={c} to={c.id === 'matcher' ? `${MATCHER_MINI_PATH}?from=play_today` : miniPlayPath.miniapp(c.id)} />
            ))}
          </ul>
        </div>
      </Card>
    </section>
    {!inset && (
      <SilentBoundary>
        <Suspense fallback={null}>
          <AlbumLine />
        </Suspense>
      </SilentBoundary>
    )}
    </>
  );
}
