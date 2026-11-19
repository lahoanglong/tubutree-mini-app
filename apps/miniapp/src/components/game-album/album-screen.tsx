import { lazy, Suspense, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { MINI_MIN_ROUND_MS, type MiniStartResponse, type MiniSubmitResponse } from '@tubutree/shared-types';
import { ALBUM_KEY, albumFailure, albumQuery, isAlbumOff, startAlbumReview, submitAlbumReview } from '@tubutree/app-core/game-album/api';
import { albumCopy } from '@tubutree/app-core/game-album/copy';
import type { AlbumCard } from '@tubutree/app-core/game-album/types';
import { ALBUM_PATH, ALBUM_PLAY_PATH, albumAction, albumBadges, albumChips, albumEntry, albumLevel, albumNewCards, albumTiles, type AlbumFilter } from '@tubutree/app-core/game-album/view';
import type { MiniBoardStatus } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniClock, miniProgressLabel, sourceHost } from '@tubutree/app-core/game-mini/format';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { referralViralOn } from '@tubutree/app-core/referral/green-card';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { useSmartNavigate } from '../../lib/smart-nav';
import { getLoadErrorMessage } from '../../services/api';
import { coreHttp } from '../../services/core-http';
import { useAuthStore } from '../../store/auth';
import { SilentBoundary } from '../route-shell';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Chip } from '../ui/chip';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { PageHeader } from '../ui/page-header';
import { ScrollRow } from '../ui/scroll-row';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';
import './album.css';

// Bàn chơi Đố Xanh, màn kết quả và thẻ sản phẩm "Thêm vào giỏ" là chunk lười sẵn có của game mini: ván ôn dùng lại, sổ không mang bản riêng.
const Quiz = lazy(() => import('../game/mini/mini-daily-quiz'));
const MiniResult = lazy(() => import('../game/mini/mini-result'));
const Learned = lazy(() => import('../game/mini/mini-result-cart').then((m) => ({ default: m.LearnedProducts })));
// Thẻ thành tích kèm link mời (cờ growth.referral_viral_enabled): chunk riêng, chỉ nạp khi cờ bật.
const GreenCardBlock = lazy(() => import('../referral/green-card'));

const round = (phase: RoundState['phase'], r: MiniStartResponse | null = null, answers: unknown[] | null = null, result: MiniSubmitResponse | null = null): RoundState => ({
  phase,
  round: r,
  receivedAt: Date.now(),
  deadline: null,
  answers,
  attempts: 1,
  result,
  failure: null,
  failedStep: null,
});

/**
 * Dòng của sổ ở trang khác. Không có `roundId`: dòng lối vào "Sổ tay Xanh · n/m thẻ" kèm vòng tiến độ ở Vườn Xanh, dưới "Chơi hôm nay" (lớp
 * `tubu-mg-*` đã nạp cùng trang). Có `roundId` (màn kết quả ván đã lưu): dòng "+N thẻ mới vào Sổ tay Xanh" khi ván vừa mở thẻ mới. Khách chưa đăng nhập
 * không gọi API. Cờ tắt (404), lỗi mạng, sổ chưa có thẻ hay ván không mở thẻ mới thì không vẽ gì. Chạm mở sổ.
 */
export function AlbumLine({ roundId }: { roundId?: string | null }) {
  const navigate = useSmartNavigate();
  const phase = useAuthPhase();
  const r = useQuery({ ...albumQuery(coreHttp, true), enabled: roundId !== null && phase === 'authenticated' }).data;
  const open = () => navigate(ALBUM_PATH.miniapp);
  if (roundId !== undefined) {
    const n = albumNewCards(r, roundId);
    return n > 0 ? (
      <button type="button" className="tubu-mg-link" data-testid="album-new-cards" onClick={open}>
        {albumCopy('newCards', { n })}
      </button>
    ) : null;
  }
  const e = albumEntry(r);
  return (
    e && (
      <Card variant="flat" padding={16}>
        <button type="button" className="tubu-mg-row" data-testid="album-entry" onClick={open}>
          <svg viewBox="0 0 36 36" width="40" height="40" fill="none" strokeWidth="4" aria-hidden className="album-ring">
            <circle cx="18" cy="18" r="15" />
            <circle cx="18" cy="18" r="15" pathLength={100} strokeDasharray={`${e.pct} 100`} />
          </svg>
          <Text variant="body-md" as="span" className="tubu-mg-row-text">
            {e.text}
          </Text>
          <Icon icon={ChevronRight} size="sm" tone="muted" />
        </button>
      </Card>
    )
  );
}

/**
 * Màn Sổ tay Xanh (`/game/album`, cặp web `/vuon-xanh/so-tay`): chip chủ đề cuộn ngang, lưới thẻ, chạm thẻ mở sheet kiến thức, nguồn và sản
 * phẩm liên quan; đúng một nút chính "Ôn n thẻ". Khách chưa đăng nhập chỉ thấy lời mời đăng nhập, không gọi API.
 * Ván ôn không thưởng: bàn chơi Đố Xanh tự đếm giờ từng câu; nộp sớm hơn mức tối thiểu của máy chủ thì đợi đủ; lỗi mạng lúc nộp thì giữ đáp án để
 * gửi lại (máy chủ chỉ chấm một lần).
 */
export function AlbumScreen() {
  const qc = useQueryClient();
  const navigate = useSmartNavigate();
  const login = useLoginWithNotice();
  const phase = useAuthPhase();
  const viral = referralViralOn(usePublicConfig());
  const q = useQuery({ ...albumQuery(coreHttp, false), enabled: phase === 'authenticated' });
  const [rv, setRv] = useState<RoundState | null>(null);
  const [filter, setFilter] = useState<AlbumFilter>('all');
  const [open, setOpen] = useState<AlbumCard | null>(null);
  const [status, setStatus] = useState<MiniBoardStatus | null>(null);
  const play = () => navigate(ALBUM_PLAY_PATH.miniapp);
  const back = () => {
    setRv(null);
    void qc.invalidateQueries({ queryKey: ALBUM_KEY });
  };
  const submit = (r: MiniStartResponse, answers: unknown[], wait: number) => {
    setRv(round('submitting', r, answers));
    setTimeout(
      () =>
        submitAlbumReview(coreHttp, r.roundId!, answers).then(
          (result) => (setRv(round('result', r, answers, result)), void qc.invalidateQueries({ queryKey: ALBUM_KEY })),
          (e: unknown) => {
            const f = albumFailure(e);
            if (f === 'already_submitted') back();
            else setRv(round('error', r, f === 'network' ? answers : null));
          },
        ),
      wait,
    );
  };
  // Bàn chơi chạy lại hiệu ứng đếm giờ mỗi khi `onFinish` đổi: giữ hàm cố định trong cả ván.
  const finish = useCallback((a: unknown[]) => rv?.round && submit(rv.round, a, rv.receivedAt! + MINI_MIN_ROUND_MS + 500 - Date.now()), [rv]);
  const start = () => {
    if (rv) return;
    setRv(round('starting'));
    // Khung ván game mini mang CSS `tubu-mg-*` của bàn chơi; mở sổ thẳng (không qua Vườn Xanh) thì CSS đó chưa nạp.
    void import('../game/mini/mini-round-shell');
    startAlbumReview(coreHttp).then(
      (r) => setRv(round('playing', r)),
      () => setRv(round('error')),
    );
  };
  const r = q.data;

  let body;
  if (rv?.phase === 'playing') {
    body = (
      <>
        {status && (
          <Text variant="label" tone="secondary" numeric>
            {miniProgressLabel('daily_quiz', status.done, status.total)} · {miniClock(status.msLeft)}
          </Text>
        )}
        <Suspense fallback={<Skeleton height={240} />}>
          <Quiz content={rv.round!.content as never} onFinish={finish} onStatus={setStatus} />
        </Suspense>
      </>
    );
  } else if (rv?.phase === 'submitting') {
    body = <Text>{gameCopy('submitting')}</Text>;
  } else if (rv?.phase === 'result') {
    body = (
      <Suspense fallback={<Skeleton height={240} />}>
        <MiniResult game="daily_quiz" state={rv} onDone={() => (back(), play())} onLogin={() => void login()} />
      </Suspense>
    );
  } else if (rv?.phase === 'error') {
    const again = rv.answers;
    body = <ErrorState message={again ? gameCopy('error.submit') : albumCopy('review.fail')} onRetry={again ? () => submit(rv.round!, again, 0) : back} />;
  } else if (phase === 'unavailable') {
    body = <ErrorState message={vi.errors.sessionUnavailable} onRetry={() => void useAuthStore.getState().restore()} />;
  } else if (q.isError && !isAlbumOff(q.error)) {
    body = <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  } else if (phase === 'guest' || q.isError) {
    body = phase === 'guest' ? <EmptyState art="leaf" heading={albumCopy('guest')} ctaLabel={albumCopy('login')} onCta={() => void login()} /> : <EmptyState art="sprout" heading={albumCopy('off')} />;
  } else if (!r) {
    body = <Skeleton height={240} />;
  } else {
    const action = albumAction(r);
    const chips = albumChips(r);
    const active = chips.some((c) => c.id === filter) ? filter : 'all';
    body =
      action.kind === 'empty' ? (
        <EmptyState art="sprout" heading={action.text} ctaLabel={gameCopy('entry.title')} onCta={play} />
      ) : (
        <>
          <Text variant="body-sm" tone="secondary">
            {albumCopy('progress', { n: r.seen, m: r.total, k: r.mastered })}
            {albumBadges(r).map((b) => ` · ${b}`)}
          </Text>
          {action.kind === 'note' ? (
            <Text variant="body-sm">{action.text}</Text>
          ) : (
            <Button fullWidth size="lg" variant={action.kind === 'review' ? 'primary' : 'ghost'} loading={rv?.phase === 'starting'} onPress={action.kind === 'review' ? start : play}>
              {action.text}
            </Button>
          )}
          <ScrollRow label={albumCopy('title')} className="album-chips">
            {chips.map((c) => (
              <Chip key={c.id} selected={active === c.id} count={c.count} onPress={() => setFilter(c.id)}>
                {c.label}
              </Chip>
            ))}
          </ScrollRow>
          <ul className="album-grid" data-testid="album-grid">
            {albumTiles(r, active).map((t) => (
              <li key={t.key}>
                {t.card ? (
                  <button type="button" className="album-tile" data-fresh={t.fresh || undefined} onClick={() => setOpen(t.card)}>
                    <span>{t.card.title}</span>
                    <span role="img" aria-label={albumLevel(t.card)}>
                      {'●'.repeat(t.card.level) + '○'.repeat(3 - t.card.level)}
                    </span>
                  </button>
                ) : (
                  <span className="album-tile" role="img" aria-label={t.label}>
                    {t.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {viral && (
            <SilentBoundary>
              <Suspense fallback={null}>
                <GreenCardBlock actions />
              </Suspense>
            </SilentBoundary>
          )}
          <BottomSheet open={open !== null} onClose={() => setOpen(null)} title={albumCopy('title')}>
            {open && (
              <div className="album-sheet" data-testid="album-card-sheet">
                <Text variant="body-lg">{open.title}</Text>
                {open.answer && <Text variant="body-sm">{gameCopy('result.expected', { a: open.answer })}</Text>}
                <Text variant="body-sm">{open.explanation}</Text>
                <Text variant="caption" tone="tertiary">
                  {gameCopy('result.sourceHost', { host: sourceHost(open.sourceUrl) ?? open.sourceUrl })}
                </Text>
                {open.product && (
                  <SilentBoundary>
                    <Suspense fallback={null}>
                      <Learned game={open.game} product={open.product} matchSlugs={[]} />
                    </Suspense>
                  </SilentBoundary>
                )}
              </div>
            )}
          </BottomSheet>
        </>
      );
  }

  return (
    <>
      <PageHeader title={albumCopy('title')} />
      <div className="album">{phase === 'loading' ? <Skeleton height={240} /> : body}</div>
    </>
  );
}
