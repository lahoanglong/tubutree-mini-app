'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, LayoutGrid, MapPin, Recycle, RefreshCw, ShoppingCart, Sparkles, type LucideIcon } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { CONVEYOR_ART, MERGE_TIER_ART, type ArcadeShape } from '@tubutree/app-core/game-mini/arcade-art';
import { miniGameCards, type MiniCardId, type MiniGameCard } from '@tubutree/app-core/game-mini/cards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniPlayPath } from '@tubutree/app-core/game-mini/format';
import { MATCHER_PATH } from '@tubutree/app-core/game-mini/matcher';
import { matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { Card, Heading, Icon, Text } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { ArcadeArt } from './mini-arcade-ui';
import './mini-game.css';
import './mini-arcade.css';

/** Hình của thẻ: game mới có hình vector riêng, game cũ giữ biểu tượng. */
const CARD_ART: Record<MiniCardId, { art: readonly ArcadeShape[] } | { icon: LucideIcon }> = {
  eco_merge: { art: MERGE_TIER_ART[3]! },
  green_conveyor: { art: CONVEYOR_ART.refill_pump },
  daily_quiz: { icon: CircleHelp },
  sort: { icon: Recycle },
  match: { icon: LayoutGrid },
  origin: { icon: MapPin },
  basket: { icon: ShoppingCart },
  kitchen_swap: { icon: RefreshCw },
  matcher: { icon: Sparkles },
};

/** Một thẻ game: hình trên nền tông riêng, nhãn "Mới", tên, mô tả hai dòng, lượt thưởng còn lại; chạm thẻ mở màn chơi. */
function GameCard({ card, href }: { card: MiniGameCard; href: string }) {
  const art = CARD_ART[card.id];
  return (
    <li>
      <Link href={href} className="tubu-mg-gcard" data-tone={card.tone} data-testid={`mini-play-row-${card.id}`}>
        <span className="tubu-mg-gcard-art" aria-hidden>
          {'art' in art ? <ArcadeArt shapes={art.art} className="tubu-mg-gcard-svg" /> : <Icon icon={art.icon} tone="brand" />}
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
      </Link>
    </li>
  );
}

/**
 * Thẻ "Chơi hôm nay" ở Vườn Xanh (chỉ khi máy chủ bật `game.mini.enabled`): thay khối đố vui cũ và hai thẻ arcade. Lưới 2 cột, mỗi game một
 * thẻ có hình (dữ liệu và thứ tự ở `miniGameCards`, app-core), chạm thẻ mở màn chơi. Cùng bố cục với Mini App
 * (`apps/miniapp/.../play-today-card.tsx`); cờ `game.matcher_enabled` bật thì thêm thẻ Chọn Chuẩn Xanh cuối lưới.
 */
export function PlayTodayCard({ today }: { today: MiniTodayResponse }) {
  const titleId = useId();
  const cards = miniGameCards(today, matcherOn(useQuery(matcherStatusQuery(coreHttp)).data));
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
          <ul className="tubu-mg-gcards">
            {cards.map((c) => (
              <GameCard key={c.id} card={c} href={c.id === 'matcher' ? `${MATCHER_PATH}?from=play_today` : miniPlayPath.web(c.id)} />
            ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}
