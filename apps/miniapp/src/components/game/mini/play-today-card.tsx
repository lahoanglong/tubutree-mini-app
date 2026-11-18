import { lazy, Suspense, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleHelp, LayoutGrid, MapPin, Recycle, RefreshCw, ShoppingCart, Sparkles, type LucideIcon } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniTodayQuery } from '@tubutree/app-core/game-mini/today';
import { MATCHER_MINI_PATH, matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { miniEarnQuizLeft, miniGameDesc, miniGameTitle, miniPlayPath, miniRowStatus, playableToday, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { refreshAccessToken } from '../../../services/api';
import { coreHttp } from '../../../services/core-http';
import type { EarnQuizState } from '../earn-water-sheet';
import { SilentBoundary } from '../../route-shell';
import { Card } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { Heading, Text } from '../../ui/text';
import './mini-game.css';

const GAME_ICON: Record<PlayableMiniGame, LucideIcon> = {
  daily_quiz: CircleHelp,
  sort: Recycle,
  match: LayoutGrid,
  origin: MapPin,
  basket: ShoppingCart,
  kitchen_swap: RefreshCw,
};

const refreshSession = () => refreshAccessToken().then(Boolean);

// Dòng "Sổ tay Xanh" ngay dưới khối, chunk riêng của sổ (`game.tsx` đã chạm trần 400 dòng của game-layout.spec).
const AlbumLine = lazy(() => import('../../../pages/game-album').then((m) => ({ default: m.AlbumLine })));

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

/** Một dòng game: biểu tượng, tên, mô tả một dòng, lượt thưởng còn lại (nếu game có thưởng theo lượt); chạm dòng mở màn chơi. */
function Row({ id, icon, title, desc, status, to }: { id: string; icon: LucideIcon; title: string; desc: string; status?: ReturnType<typeof miniRowStatus>; to: string }) {
  const navigate = useSmartNavigate();
  return (
    <li>
      <button type="button" className="tubu-mg-row" data-testid={`mini-play-row-${id}`} onClick={() => navigate(to)}>
        <span className="tubu-mg-row-icon" aria-hidden>
          <Icon icon={icon} tone="brand" />
        </span>
        <span className="tubu-mg-row-text">
          <Text variant="body-md" as="span" className="tubu-mg-one-line" style={{ fontWeight: 'var(--type-label-weight)' }}>
            {title}
          </Text>
          <Text variant="caption" tone="secondary" as="span" className="tubu-mg-one-line">
            {desc}
          </Text>
          {status && (
            <Text variant="caption" tone={status.tone} as="span" data-testid={`mini-play-status-${id}`}>
              {status.text}
            </Text>
          )}
        </span>
        <Icon icon={ChevronRight} size="sm" tone="muted" />
      </button>
    </li>
  );
}

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Mỗi game một dòng gọn
 * (tên, mô tả một dòng, lượt thưởng còn lại), chạm dòng mở màn chơi ngay trong Mini App. Cùng bố cục với web: cờ `game.matcher_enabled` bật thì
 * thêm dòng Chọn Chuẩn Xanh cuối danh sách (không dòng lượt thưởng: thưởng của nó không hứa trước). `inset`: đứng ngoài lưới thẻ của trang (dưới
 * cổng đăng nhập) nên tự lùi lề.
 */
export function PlayTodayCard({ today, inset = false }: { today: MiniTodayResponse; inset?: boolean }) {
  const titleId = useId();
  const games = playableToday(today);
  const matcher = matcherOn(useQuery(matcherStatusQuery(coreHttp)).data);
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
          <ul className="tubu-mg-rows">
            {games.map((g) => (
              <Row
                key={g.game}
                id={g.game}
                icon={GAME_ICON[g.game]}
                title={miniGameTitle(g.game)}
                desc={miniGameDesc(g.game)}
                status={miniRowStatus(today, g)}
                to={miniPlayPath.miniapp(g.game)}
              />
            ))}
            {matcher && (
              <Row id="matcher" icon={Sparkles} title={gameCopy('game.matcher.title')} desc={gameCopy('game.matcher.desc')} to={`${MATCHER_MINI_PATH}?from=play_today`} />
            )}
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
