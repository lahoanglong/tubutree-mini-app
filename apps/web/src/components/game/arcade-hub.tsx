'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import type { ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import { arcadeWindowBadge } from '@tubutree/app-core/arcade/badge';
import { buildHubCards, hubCardLabel, type HubCard } from '@tubutree/app-core/game-hub/cards';
import { browserSessionStore, markHubReturn } from '@tubutree/app-core/game-hub/hub-return';
import { miniPlayPath } from '@tubutree/app-core/game-mini/format';
import { MATCHER_PATH } from '@tubutree/app-core/game-mini/matcher';
import { matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { gameArcadeStatusQuery } from '@tubutree/app-core/queries/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { sfx } from '@/lib/sfx';
import { Button, Heading, Icon, SectionHeader, Text } from '@/components/mini';
import { ArcadeGameOverlay, rewardLines } from './arcade-game-overlay';
import { readGuestBest } from './arcade-storage';
import { HubArtIcon } from './hub-art';
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

/**
 * Dải báo ván khách chơi trước khi đăng nhập đã được gửi nốt: điểm, rồi phần thưởng (hoặc lý do không thưởng) đúng như màn kết quả.
 * Chỉ vẽ khi có kết quả để báo, và chính dải mang `role` (status cho đã lưu và cho ván đã được ghi từ lần gửi trước, alert cho lỗi): không có vùng live rỗng nằm sẵn ở trang Vườn Xanh
 * (trang đã có vùng thông báo riêng, vùng rỗng thứ hai làm công cụ và test lấy nhầm).
 */
function PendingSaved({ state, retry }: { state: PendingSaveState; retry: () => void }) {
  if (state.status === 'idle' || state.status === 'saving') return null;
  const box = 'flex flex-col items-start gap-1 rounded-card bg-[var(--color-bg-subtle)] p-3';
  if (state.status === 'error' && state.kind === 'replayed') {
    // Mã đã dùng: ván đã được ghi từ lần gửi trước, nên là thông báo trung tính chứ không phải lỗi.
    return (
      <div data-testid="arcade-pending-replayed" role="status" className={box}>
        <Text variant="body-sm" tone="secondary" as="p">
          {fillCopy('arcade.result.replayed')}
        </Text>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div data-testid="arcade-pending-error" role="alert" className={box}>
        <Text variant="body-sm" tone="danger" as="p">
          {fillCopy(state.kind === 'invalid' ? 'arcade.result.invalid' : 'arcade.result.error')}
        </Text>
        {state.kind === 'retry' && (
          <Button variant="secondary" onPress={retry}>
            {gameNewbieCopy.loadError.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div data-testid="arcade-pending-saved" role="status" className={box}>
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

function cardTestId(card: HubCard): string {
  if (card.action.kind === 'arcade') return `arcade-card-${card.id}`;
  if (card.action.kind === 'wheel') return 'hub-card-wheel';
  return `mini-play-row-${card.id}`;
}

function statusTestId(card: HubCard): string | undefined {
  if (card.action.kind === 'arcade') return `arcade-used-${card.id}`;
  if (card.action.kind === 'mini') return `mini-play-status-${card.id}`;
  return undefined;
}

/** Đường dẫn của thẻ mở trang riêng (game mini, Chọn Chuẩn Xanh): là liên kết thật để mở tab mới, chép link được. */
function cardHref(card: HubCard): string | null {
  if (card.action.kind === 'mini') return miniPlayPath.web(card.action.game);
  if (card.action.kind === 'matcher') return `${MATCHER_PATH}?from=play_today`;
  return null;
}

/** Một thẻ (bản web của Mini `HubCardView`, cùng lớp CSS): hình trên nền chuyển màu, tên (h3, chứa nút hoặc liên kết phủ cả thẻ), thưởng, kỷ lục, lượt. */
function HubCardView({ card, loading, onPlay }: { card: HubCard; loading: boolean; onPlay: (card: HubCard) => void }) {
  const metaId = useId();
  const href = cardHref(card);
  const hit = { className: 'tubu-hub-hit', 'aria-label': hubCardLabel(card), 'aria-describedby': metaId };
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
            {href ? (
              <Link
                href={href}
                {...hit}
                onClick={() => {
                  sfx.play('pop');
                  markHubReturn(browserSessionStore);
                }}
              >
                {card.title}
              </Link>
            ) : (
              <button type="button" {...hit} onClick={() => onPlay(card)}>
                {card.title}
              </button>
            )}
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
 * Sảnh Game của Vườn Xanh (bản web của Mini `ArcadeHub`, cùng props): MỌI game chơi được trong một lưới hai cột thẻ có hình (hai game hành động
 * canvas, game mini của "Chơi hôm nay", Chọn Chuẩn Xanh, Vòng quay); danh sách dựng ở `buildHubCards`. Thẻ mở trang game riêng đặt dấu
 * `markHubReturn` để ván xong quay về đúng Sảnh Game. Đã đăng nhập: kỷ lục và số lượt thưởng lấy từ máy chủ; khách chơi thử, kỷ lục lưu trên máy (`readGuestBest`). Giữ luôn trạng thái mở
 * `ArcadeGameOverlay` và dải báo ván chơi trước khi đăng nhập. `wheel`: thẻ Vòng quay cuộn tới khối vòng quay (có `anchorId`) cùng tab.
 */
export function ArcadeHub({ mini, wheel = null }: { mini: MiniTodayResponse | null; wheel?: { cost: number; anchorId: string } | null }) {
  const authed = useAuthPhase() === 'authenticated';
  const status = useQuery({ ...gameArcadeStatusQuery(coreHttp), enabled: authed });
  const matcher = matcherOn(useQuery({ ...matcherStatusQuery(coreHttp), enabled: mini !== null }).data);
  const badge = arcadeWindowBadge(useMinuteClock());
  const pending = usePendingArcadeSave(authed);
  const [open, setOpen] = useState<ArcadeGameId | null>(null);
  const headingId = useId();
  // Đọc kỷ lục khách sau khi mount và mỗi lần đóng lớp phủ: máy chủ dựng HTML không có localStorage nên không đọc trong lúc render.
  const [guestBest, setGuestBest] = useState<Record<ArcadeGameId, number> | null>(null);
  useEffect(() => {
    if (open === null) setGuestBest({ dew_catcher: readGuestBest('dew_catcher'), refill_rush: readGuestBest('refill_rush') });
  }, [open]);
  const cards = buildHubCards({
    real: authed,
    arcade: status.data,
    guestBest: authed ? null : guestBest,
    bonusWindow: badge.activeWindow !== null,
    mini,
    matcher,
    wheelCost: wheel?.cost ?? null,
  });

  const play = (card: HubCard) => {
    sfx.play('pop');
    const a = card.action;
    if (a.kind === 'arcade') setOpen(a.game);
    else if (a.kind === 'wheel' && wheel) document.getElementById(wheel.anchorId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-testid="arcade-hub">
      <SectionHeader id={headingId} title={fillCopy('arcade.hub.title')} subtitle={fillCopy('arcade.hub.sub')} />
      {/* Cùng kiểu với bản Mini (arcade.css `.tubu-arcade-badge`): nền dịu, khung đang chạy thì nền xanh nhạt kèm viền trong. */}
      <div
        role="note"
        data-testid="arcade-badge"
        data-active={badge.activeWindow ?? undefined}
        className={`flex flex-col gap-1 rounded-card p-3 ${badge.activeWindow ? 'bg-[var(--color-action-secondary-bg)] shadow-[inset_0_0_0_1px_var(--color-action-secondary-border)]' : 'bg-[var(--color-bg-subtle)]'}`}
      >
        <Text variant="caption" tone="primary" as="p">
          {badge.label}
        </Text>
        <Text variant="caption" tone={badge.activeWindow ? 'brand' : 'secondary'} as="p" style={badge.activeWindow ? { fontWeight: 'var(--type-label-weight)' } : undefined}>
          {badge.hint}
        </Text>
      </div>
      <PendingSaved state={pending.state} retry={pending.retry} />
      {!authed && (
        <Text variant="caption" tone="secondary" as="p">
          {fillCopy('arcade.guest.demo')}
        </Text>
      )}
      <ul className="tubu-hub-grid">
        {cards.map((card) => (
          <HubCardView key={card.id} card={card} loading={authed && card.action.kind === 'arcade' && status.isLoading} onPlay={play} />
        ))}
      </ul>
      {open && <ArcadeGameOverlay key={open} gameId={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
