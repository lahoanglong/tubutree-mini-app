import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import { type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import { arcadeWindowBadge } from '@tubutree/app-core/arcade/badge';
import { buildHubCards, hubCardLabel, type HubCard } from '@tubutree/app-core/game-hub/cards';
import { browserSessionStore, markHubReturn } from '@tubutree/app-core/game-hub/hub-return';
import { miniPlayPath } from '@tubutree/app-core/game-mini/format';
import { MATCHER_MINI_PATH, matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useRealUser } from '../../hooks/use-real-user';
import { useSmartNavigate } from '../../lib/smart-nav';
import { arcadeStatusQuery } from '../../services/arcade-api';
import { coreHttp } from '../../services/core-http';
import { haptic } from '../../utils/haptic';
import { sfx } from '../../utils/sfx';
import { SilentBoundary } from '../route-shell';
import { Icon } from '../ui/icon';
import { SectionHeader } from '../ui/section-header';
import { Heading, Text } from '../ui/text';
import { readLocalBest } from './arcade-best';
import { HubArtIcon } from './hub-art';
import '../../css/arcade.css';
import '../../css/game-hub.css';

// Lớp phủ và engine chỉ tải khi khách chạm Chơi lần đầu: trang Vườn Xanh không gánh canvas.
const ArcadeGameOverlay = lazy(() => import('./arcade-game-overlay').then((m) => ({ default: m.ArcadeGameOverlay })));
// Dòng "Sổ tay Xanh" dưới sảnh khi có game mini, chunk riêng của sổ.
const AlbumLine = lazy(() => import('../../pages/game-album').then((m) => ({ default: m.AlbumLine })));

const CLOCK_MS = 60_000;

/** Giờ hiện tại, vẽ lại mỗi phút để dòng khung giờ thưởng đổi đúng lúc khách đang xem. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function cardTestId(card: HubCard): string {
  if (card.action.kind === 'arcade') return `arcade-game-${card.id}`;
  if (card.action.kind === 'wheel') return 'hub-card-wheel';
  return `mini-play-row-${card.id}`;
}

function statusTestId(card: HubCard): string | undefined {
  if (card.action.kind === 'arcade') return `arcade-status-${card.id}`;
  if (card.action.kind === 'mini') return `mini-play-status-${card.id}`;
  return undefined;
}

/** Một thẻ: hình trên nền chuyển màu, tên (h3, chứa nút phủ cả thẻ), dòng thưởng, kỷ lục, lượt còn lại. */
function HubCardView({ card, loading, onPlay }: { card: HubCard; loading: boolean; onPlay: (card: HubCard) => void }) {
  const metaId = useId();
  return (
    <li>
      <article className="tubu-hub-card" data-testid={cardTestId(card)}>
        <span className="tubu-hub-art" data-tone={card.tone}>
          {card.badge && (
            <span className="tubu-hub-badge" data-kind={card.badge.kind}>
              {card.badge.text}
            </span>
          )}
          <HubArtIcon art={card.art} />
        </span>
        <span className="tubu-hub-body">
          <Heading as="h3" variant="title-sm" font="ui" className="tubu-hub-title">
            <button type="button" className="tubu-hub-hit" aria-label={hubCardLabel(card)} aria-describedby={metaId} onClick={() => onPlay(card)}>
              {card.title}
            </button>
          </Heading>
          <span id={metaId} className="tubu-hub-meta-stack">
            {card.reward && <span className="tubu-hub-chip">{card.reward}</span>}
            {card.best && (
              <Text variant="caption" tone="secondary" as="span" numeric>
                {card.best}
              </Text>
            )}
            {card.status ? (
              <Text variant="caption" tone={card.status.tone} as="span" className="tubu-hub-status" numeric data-testid={statusTestId(card)}>
                {card.status.text}
              </Text>
            ) : (
              loading && <span className="tubu-skeleton tubu-hub-meta" aria-hidden />
            )}
          </span>
          <Text variant="body-sm" as="span" className="tubu-hub-cta" aria-hidden>
            {card.cta}
            <Icon icon={ChevronRight} size="sm" tone="current" />
          </Text>
        </span>
      </article>
    </li>
  );
}

/**
 * Sảnh Game của Vườn Xanh: MỌI game chơi được trong một lưới hai cột thẻ có hình (hai game hành động canvas, game mini của "Chơi hôm nay",
 * Chọn Chuẩn Xanh, Vòng quay); danh sách dựng ở `buildHubCards` cho cả Mini App và web. Khách thật đã đăng nhập thấy kỷ lục và lượt thưởng
 * arcade từ máy chủ; khách chơi thử, kỷ lục lưu trên máy. Giữ luôn trạng thái mở `ArcadeGameOverlay`. Thẻ mở màn game riêng đặt dấu
 * `markHubReturn` để ván xong quay về đúng Sảnh Game. `wheel`: thẻ Vòng quay cuộn tới khối vòng quay (có `anchorId`) cùng tab.
 */
export function ArcadeHub({ mini, wheel = null }: { mini: MiniTodayResponse | null; wheel?: { cost: number; anchorId: string } | null }) {
  const real = useRealUser();
  const navigate = useSmartNavigate();
  const status = useQuery({ ...arcadeStatusQuery, enabled: real, staleTime: 30_000 });
  const matcher = matcherOn(useQuery({ ...matcherStatusQuery(coreHttp), enabled: mini !== null }).data);
  const [open, setOpen] = useState<ArcadeGameId | null>(null);
  const headingId = useId();
  const badge = arcadeWindowBadge(useMinuteClock());
  const xmas = usePublicConfig().seasonalTheme === 'christmas';
  const cards = buildHubCards({
    real,
    arcade: status.data,
    guestBest: real ? null : { dew_catcher: readLocalBest('dew_catcher'), refill_rush: readLocalBest('refill_rush') },
    xmas,
    mini,
    matcher,
    wheelCost: wheel?.cost ?? null,
  });

  const play = (card: HubCard) => {
    haptic('light');
    sfx.play('pop');
    const a = card.action;
    if (a.kind === 'arcade') setOpen(a.game);
    else if (a.kind === 'mini') {
      markHubReturn(browserSessionStore);
      navigate(miniPlayPath.miniapp(a.game));
    } else if (a.kind === 'matcher') {
      markHubReturn(browserSessionStore);
      navigate(`${MATCHER_MINI_PATH}?from=play_today`);
    }
    else if (wheel) document.getElementById(wheel.anchorId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section aria-labelledby={headingId} className="tubu-arcade-hub" data-testid="arcade-hub">
      <SectionHeader id={headingId} title={fillCopy('arcade.hub.title')} subtitle={fillCopy('arcade.hub.sub')} />
      <div role="note" className="tubu-arcade-badge" data-active={badge.activeWindow !== null} data-testid="arcade-window-badge">
        <Text variant="caption" tone="primary" as="p">
          {badge.label}
        </Text>
        <Text variant="caption" tone={badge.activeWindow ? 'brand' : 'secondary'} as="p" style={badge.activeWindow ? { fontWeight: 'var(--type-label-weight)' } : undefined}>
          {badge.hint}
        </Text>
      </div>
      {!real && (
        <Text variant="caption" tone="secondary" as="p">
          {fillCopy('arcade.guest.demo')}
        </Text>
      )}
      <ul className="tubu-hub-grid">
        {cards.map((card) => (
          <HubCardView key={card.id} card={card} loading={real && card.action.kind === 'arcade' && status.isLoading} onPlay={play} />
        ))}
      </ul>
      {mini && (
        <SilentBoundary>
          <Suspense fallback={null}>
            <AlbumLine />
          </Suspense>
        </SilentBoundary>
      )}
      {open && (
        <Suspense fallback={null}>
          <ArcadeGameOverlay key={open} gameId={open} xmas={xmas} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  );
}
