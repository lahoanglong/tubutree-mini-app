'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleHelp, CookingPot, ListChecks, MapPin, Puzzle, Recycle, ShoppingBasket, type LucideIcon } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniGameDesc, miniGameTitle, miniPlayPath, miniRowStatus, playableToday, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { MATCHER_PATH } from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { Card, Heading, Icon, Text } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import './mini-game.css';

const GAME_ICON: Record<PlayableMiniGame, LucideIcon> = {
  daily_quiz: CircleHelp,
  sort: Recycle,
  match: Puzzle,
  origin: MapPin,
  basket: ShoppingBasket,
  kitchen_swap: CookingPot,
};

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Mỗi game một dòng gọn
 * (tên, mô tả một dòng, lượt thưởng còn lại), chạm dòng mở màn chơi. Cùng bố cục với Mini App (`apps/miniapp/.../play-today-card.tsx`).
 * Cờ `game.matcher_enabled` bật thì thêm dòng Chọn Chuẩn Xanh cuối danh sách (không dòng lượt thưởng: thưởng của nó không hứa trước).
 */
export function PlayTodayCard({ today }: { today: MiniTodayResponse }) {
  const titleId = useId();
  const games = playableToday(today);
  const matcher = matcherOn(useQuery(matcherStatusQuery(coreHttp)).data);
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
                  <Link href={miniPlayPath.web(g.game)} className="tubu-mg-row" data-testid={`mini-play-row-${g.game}`}>
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
                  </Link>
                </li>
              );
            })}
            {matcher && (
              <li>
                <Link href={`${MATCHER_PATH}?from=play_today`} className="tubu-mg-row" data-testid="mini-play-row-matcher">
                  <span className="tubu-mg-row-icon" aria-hidden>
                    <Icon icon={ListChecks} tone="brand" />
                  </span>
                  <span className="tubu-mg-row-text">
                    <Text variant="body-md" as="span" className="tubu-mg-one-line" style={{ fontWeight: 'var(--type-label-weight)' }}>
                      {matcherCopy('title')}
                    </Text>
                    <Text variant="caption" tone="secondary" as="span" className="tubu-mg-one-line">
                      {matcherCopy('entry.desc')}
                    </Text>
                  </span>
                  <Icon icon={ChevronRight} size="sm" tone="muted" />
                </Link>
              </li>
            )}
          </ul>
        </div>
      </Card>
    </section>
  );
}
