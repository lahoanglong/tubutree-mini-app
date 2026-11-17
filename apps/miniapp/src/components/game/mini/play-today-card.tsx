import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleHelp, MapPin, Puzzle, Recycle, ShoppingBasket, type LucideIcon } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniTodayQuery } from '@tubutree/app-core/game-mini/today';
import {
  miniEarnQuizLeft,
  miniGameDesc,
  miniGameTitle,
  miniPlayPath,
  miniRowStatus,
  playableToday,
  type PlayableMiniGame,
} from '@tubutree/app-core/game-mini/format';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { refreshAccessToken } from '../../../services/api';
import { coreHttp } from '../../../services/core-http';
import type { EarnQuizState } from '../earn-water-sheet';
import { Card } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { Heading, Text } from '../../ui/text';
import './mini-game.css';

const GAME_ICON: Record<PlayableMiniGame, LucideIcon> = { daily_quiz: CircleHelp, sort: Recycle, match: Puzzle, origin: MapPin, basket: ShoppingBasket };

const refreshSession = () => refreshAccessToken().then(Boolean);

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

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Mỗi game một dòng gọn
 * (tên, mô tả một dòng, lượt thưởng còn lại), chạm dòng mở màn chơi. `inset`: đứng ngoài lưới thẻ của trang (dưới cổng đăng nhập) nên tự lùi lề.
 */
export function PlayTodayCard({ today, inset = false }: { today: MiniTodayResponse; inset?: boolean }) {
  const titleId = useId();
  const navigate = useSmartNavigate();
  const games = playableToday(today);
  return (
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
            {games.map((g) => {
              const status = miniRowStatus(today, g);
              return (
                <li key={g.game}>
                  <button type="button" className="tubu-mg-row" data-testid={`mini-play-row-${g.game}`} onClick={() => navigate(miniPlayPath.miniapp(g.game))}>
                    <span className="tubu-mg-row-icon" aria-hidden>
                      <Icon icon={GAME_ICON[g.game]} tone="brand" />
                    </span>
                    <span className="tubu-mg-row-text">
                      <Text variant="body-md" as="span" className="tubu-mg-one-line" style={{ fontWeight: 'var(--type-label-weight)' }}>
                        {miniGameTitle(g.game)}
                      </Text>
                      <Text variant="caption" tone="secondary" as="span" className="tubu-mg-one-line">
                        {miniGameDesc(g.game)}
                      </Text>
                      <Text variant="caption" tone={status.tone} as="span" data-testid={`mini-play-status-${g.game}`}>
                        {status.text}
                      </Text>
                    </span>
                    <Icon icon={ChevronRight} size="sm" tone="muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </section>
  );
}
