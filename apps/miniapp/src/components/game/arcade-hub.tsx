import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ARCADE_GAME_IDS, type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import { arcadeWindowBadge } from '@tubutree/app-core/arcade/badge';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { arcadeStatusQuery } from '../../services/arcade-api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { SectionHeader } from '../ui/section-header';
import { Heading, Text } from '../ui/text';
import { readLocalBest } from './arcade-best';
import '../../css/arcade.css';

// Lớp phủ và engine chỉ tải khi khách chạm Chơi lần đầu: trang Vườn Xanh không gánh canvas.
const ArcadeGameOverlay = lazy(() => import('./arcade-game-overlay').then((m) => ({ default: m.ArcadeGameOverlay })));

const COPY_KEY = { dew_catcher: 'dew', refill_rush: 'rush' } as const;
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

/**
 * Sảnh mini game ở Vườn Xanh: huy hiệu khung giờ thưởng và hai thẻ game (tên, một dòng mô tả, kỷ lục, nút Chơi). Người đã đăng nhập thấy kỷ lục và số lượt thưởng đã dùng
 * hôm nay từ máy chủ; khách chơi thử, kỷ lục lưu trên máy. Giữ luôn trạng thái mở `ArcadeGameOverlay` nên nơi gắn chỉ cần một dòng `<ArcadeHub />`.
 */
export function ArcadeHub() {
  const authed = useAuthPhase() === 'authenticated';
  const status = useQuery({ ...arcadeStatusQuery, enabled: authed, staleTime: 30_000 });
  const [open, setOpen] = useState<ArcadeGameId | null>(null);
  const headingId = useId();
  const badge = arcadeWindowBadge(useMinuteClock());

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
      {!authed && (
        <Text variant="caption" tone="secondary" as="p">
          {fillCopy('arcade.guest.demo')}
        </Text>
      )}
      <ul className="tubu-arcade-games">
        {ARCADE_GAME_IDS.map((gameId) => {
          const key = COPY_KEY[gameId];
          const title = fillCopy(`arcade.${key}.title`);
          const server = status.data?.games[gameId];
          const best = authed ? server?.bestScore ?? 0 : readLocalBest(gameId);
          return (
            <li key={gameId}>
              <Card variant="outline" padding={12}>
                <div className="tubu-arcade-game" data-testid={`arcade-game-${gameId}`}>
                  <div className="tubu-arcade-game-text">
                    <Heading as="h3" variant="title-sm" font="ui">
                      {title}
                    </Heading>
                    <Text variant="body-sm" tone="secondary" as="p">
                      {fillCopy(`arcade.${key}.desc`)}
                    </Text>
                    <div className="tubu-arcade-meta">
                      {authed && status.isLoading && <div className="tubu-skeleton tubu-arcade-meta" aria-hidden />}
                      {best > 0 && (
                        <Text variant="caption" tone="secondary" as="p" numeric>
                          {fillCopy('arcade.best', { n: best })}
                        </Text>
                      )}
                      {authed && server && (
                        <Text variant="caption" tone="secondary" as="p" numeric>
                          {fillCopy('arcade.result.used', { n: server.used, m: server.cap })}
                        </Text>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    className="tubu-arcade-play"
                    aria-label={`${fillCopy(authed ? 'arcade.play' : 'arcade.tryPlay')} ${title}`}
                    onPress={() => {
                      haptic('light');
                      setOpen(gameId);
                    }}
                  >
                    {fillCopy(authed ? 'arcade.play' : 'arcade.tryPlay')}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {open && (
        <Suspense fallback={null}>
          <ArcadeGameOverlay key={open} gameId={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  );
}
