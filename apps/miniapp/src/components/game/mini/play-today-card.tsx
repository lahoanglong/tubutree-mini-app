import { useId } from 'react';
import { ChevronRight, CircleHelp, Recycle, type LucideIcon } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniGameDesc, miniGameTitle, miniPlayPath, miniRowStatus, playableToday, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { Card } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { Heading, Text } from '../../ui/text';
import './mini-game.css';

const GAME_ICON: Record<PlayableMiniGame, LucideIcon> = { daily_quiz: CircleHelp, sort: Recycle };

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Mỗi game một dòng gọn
 * (tên, mô tả một dòng, lượt thưởng còn lại), chạm dòng mở màn chơi.
 */
export function PlayTodayCard({ today }: { today: MiniTodayResponse }) {
  const titleId = useId();
  const navigate = useSmartNavigate();
  const games = playableToday(today);
  return (
    <section aria-labelledby={titleId} data-testid="mini-play-today">
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
