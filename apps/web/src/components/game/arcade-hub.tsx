'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gamepad2 } from 'lucide-react';
import { ARCADE_GAME_IDS, type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import { arcadeWindowBadge } from '@tubutree/app-core/arcade/badge';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { gameArcadeStatusQuery } from '@tubutree/app-core/queries/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { Button, Card, Heading, Text } from '@/components/mini';
import { ARCADE_COPY_KEY, ArcadeGameOverlay, rewardLines } from './arcade-game-overlay';
import { readGuestBest } from './arcade-storage';
import { GameCard } from './game-card';
import { usePendingArcadeSave, type PendingSaveState } from './use-arcade-save';

const MINUTE_MS = 60_000;

/** Giờ hiện tại, cập nhật mỗi phút: huy hiệu khung giờ đổi sang khung đang chạy mà không cần tải lại trang. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Dải báo ván khách chơi trước khi đăng nhập đã được gửi nốt: điểm, rồi phần thưởng (hoặc lý do không thưởng) đúng như màn kết quả. */
function PendingSaved({ state, retry }: { state: PendingSaveState; retry: () => void }) {
  if (state.status === 'idle' || state.status === 'saving') return null;
  const box = 'flex flex-col items-start gap-1 rounded-card bg-[var(--color-bg-subtle)] p-3';
  if (state.status === 'error') {
    return (
      <div data-testid="arcade-pending-error" className={box}>
        <Text variant="body-sm" tone="danger" as="p">
          {fillCopy(state.invalid ? 'arcade.result.invalid' : 'arcade.result.error')}
        </Text>
        {!state.invalid && (
          <Button variant="secondary" onPress={retry}>
            {gameNewbieCopy.loadError.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div data-testid="arcade-pending-saved" className={box}>
      <Text variant="body-sm" tone="primary" as="p" numeric style={{ fontWeight: 600 }}>
        {fillCopy('arcade.pending.saved', { n: state.run.score })}
      </Text>
      {rewardLines(state.data).map((line) => (
        <Text key={line} variant="body-sm" tone="secondary" as="p" numeric>
          {line}
        </Text>
      ))}
    </div>
  );
}

/**
 * Sảnh mini game ở Vườn Xanh: huy hiệu khung giờ thưởng, hai thẻ game (tên, một dòng mô tả, kỷ lục, nút Chơi). Giữ luôn trạng thái mở
 * `ArcadeGameOverlay` nên nơi gắn chỉ là `<ArcadeHub />`. Đã đăng nhập: kỷ lục và số lượt thưởng hôm nay lấy từ máy chủ; khách chơi thử,
 * kỷ lục lưu trên máy (`readGuestBest`).
 */
export function ArcadeHub() {
  const authed = useAuthPhase() === 'authenticated';
  const status = useQuery({ ...gameArcadeStatusQuery(coreHttp), enabled: authed });
  const badge = arcadeWindowBadge(useMinuteClock());
  const pending = usePendingArcadeSave(authed);
  const [open, setOpen] = useState<ArcadeGameId | null>(null);
  // Đọc kỷ lục khách sau khi mount và mỗi lần đóng lớp phủ: máy chủ dựng HTML không có localStorage nên không đọc trong lúc render.
  const [guestBest, setGuestBest] = useState<Record<ArcadeGameId, number> | null>(null);
  useEffect(() => {
    if (open === null) setGuestBest({ dew_catcher: readGuestBest('dew_catcher'), refill_rush: readGuestBest('refill_rush') });
  }, [open]);

  return (
    <>
      <GameCard title={fillCopy('arcade.hub.title')} icon={Gamepad2}>
        <div data-testid="arcade-hub" className="flex flex-col gap-3">
          <Text variant="body-sm" tone="secondary" as="p">
            {fillCopy('arcade.hub.sub')}
          </Text>
          <div
            data-testid="arcade-badge"
            data-active={badge.activeWindow ?? undefined}
            className={`flex flex-col gap-1 rounded-card p-3 ${badge.activeWindow ? 'bg-[var(--color-promo-bg)] text-[var(--color-promo-fg)]' : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]'}`}
          >
            <Text variant="body-sm" as="p" tone={badge.activeWindow ? 'primary' : 'secondary'} style={{ fontWeight: 600, color: 'inherit' }}>
              {badge.label}
            </Text>
            <Text variant="caption" as="p" style={{ color: 'inherit' }}>
              {badge.hint}
            </Text>
          </div>
          {/* Vùng báo luôn có mặt, chỉ đổi phần con: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
          <div role="status" aria-live="polite" data-testid="arcade-pending">
            <PendingSaved state={pending.state} retry={pending.retry} />
          </div>
          {!authed && (
            <Text variant="caption" tone="tertiary" as="p">
              {fillCopy('arcade.guest.demo')}
            </Text>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ARCADE_GAME_IDS.map((id) => {
              const k = ARCADE_COPY_KEY[id];
              const title = fillCopy(`arcade.${k}.title`);
              const play = fillCopy(authed ? 'arcade.play' : 'arcade.tryPlay');
              const mine = status.data?.games[id];
              const best = authed ? mine?.bestScore : guestBest?.[id];
              return (
                <li key={id} data-testid={`arcade-card-${id}`}>
                  <Card variant="flat" padding={12}>
                    <Heading variant="title-sm" font="ui" as="h3">
                      {title}
                    </Heading>
                    <Text variant="body-sm" tone="secondary" as="p" className="mt-1">
                      {fillCopy(`arcade.${k}.desc`)}
                    </Text>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {best ? (
                          <Text variant="caption" tone="tertiary" as="p" numeric>
                            {fillCopy('arcade.best', { n: best })}
                          </Text>
                        ) : null}
                        {authed && mine && (
                          <Text variant="caption" tone="tertiary" as="p" numeric data-testid={`arcade-used-${id}`}>
                            {fillCopy('arcade.result.used', { n: mine.used, m: mine.cap })}
                          </Text>
                        )}
                      </div>
                      <Button variant="secondary" aria-label={`${play} ${title}`} onPress={() => setOpen(id)}>
                        {play}
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      </GameCard>
      {open && <ArcadeGameOverlay key={open} gameId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
