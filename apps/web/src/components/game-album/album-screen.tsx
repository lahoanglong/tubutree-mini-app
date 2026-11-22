'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MINI_MIN_ROUND_MS, type MiniChoiceItem, type MiniStartResponse, type MiniSubmitResponse } from '@tubutree/shared-types';
import { ALBUM_KEY, albumFailure, albumQuery, isAlbumOff, startAlbumReview, submitAlbumReview } from '@tubutree/app-core/game-album/api';
import { albumCopy } from '@tubutree/app-core/game-album/copy';
import type { AlbumCard } from '@tubutree/app-core/game-album/types';
import { ALBUM_PATH, ALBUM_PLAY_PATH, albumAction, albumBadges, albumChips, albumLevel, albumTiles, type AlbumFilter } from '@tubutree/app-core/game-album/view';
import type { MiniBoardStatus } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniClock, miniProgressLabel } from '@tubutree/app-core/game-mini/format';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { referralViralOn } from '@tubutree/app-core/referral/viral-flag';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { Button, Chip, EmptyState, ScrollRow, Text } from '@/components/mini';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { loginHref } from '@/lib/return-to';
import { GreenCardBlock } from '@/components/referral/green-card-lazy';
import './album.css';

const skeleton = () => <Skeleton height={240} />;
// Bàn chơi Đố Xanh và màn kết quả là của game mini (chunk lười sẵn có): ván ôn dùng lại, sổ không mang bản riêng.
const Quiz = dynamic(() => import('@/components/game/mini/mini-daily-quiz'), { ssr: false, loading: skeleton });
const ResultView = dynamic(() => import('@/components/game/mini/mini-round-shell').then((m) => m.ResultView), { ssr: false, loading: skeleton });
const CardSheet = dynamic(() => import('./album-card-sheet'), { ssr: false });

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
 * Màn Sổ tay Xanh trên web (`/vuon-xanh/so-tay`, cặp Mini `/game/album`, cùng hành vi với `apps/miniapp/.../album-screen.tsx`): chip chủ đề
 * cuộn ngang, lưới thẻ 2 cột (4 cột từ 1024px), chạm thẻ mở sheet kiến thức, nguồn và sản phẩm; đúng một nút chính "Ôn n thẻ". Khách chưa đăng
 * nhập chỉ thấy lời mời đăng nhập, không gọi API. Ván ôn không thưởng: nộp sớm hơn mức tối thiểu của máy chủ thì đợi đủ; lỗi mạng lúc nộp thì giữ
 * đáp án để gửi lại (máy chủ chỉ chấm một lần).
 */
export function AlbumScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const phase = useAuthPhase();
  const q = useQuery({ ...albumQuery(coreHttp, false), enabled: phase === 'authenticated' });
  const viral = referralViralOn(useQuery({ ...publicConfigQuery(coreHttp), enabled: phase === 'authenticated' }).data);
  const [rv, setRv] = useState<RoundState | null>(null);
  const [filter, setFilter] = useState<AlbumFilter>('all');
  const [open, setOpen] = useState<AlbumCard | null>(null);
  const [status, setStatus] = useState<MiniBoardStatus | null>(null);
  const play = () => router.push(ALBUM_PLAY_PATH.web);
  const back = useCallback(() => {
    setRv(null);
    void qc.invalidateQueries({ queryKey: ALBUM_KEY });
  }, [qc]);
  const submit = useCallback(
    (r: MiniStartResponse, answers: unknown[], wait: number) => {
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
    },
    [qc, back],
  );
  // Bàn chơi chạy lại hiệu ứng đếm giờ mỗi khi `onFinish` đổi: giữ hàm cố định trong cả ván.
  const finish = useCallback((a: unknown[]) => rv?.round && submit(rv.round, a, rv.receivedAt! + MINI_MIN_ROUND_MS + 500 - Date.now()), [rv, submit]);
  const start = () => {
    if (rv) return;
    setRv(round('starting'));
    startAlbumReview(coreHttp).then(
      (r) => setRv(round('playing', r)),
      () => setRv(round('error')),
    );
  };
  const r = q.data;

  if (phase === 'loading') return <AuthLoading />;
  if (phase === 'unavailable') return <SessionUnavailable />;

  let body;
  if (rv?.phase === 'playing') {
    body = (
      <>
        {status && (
          <Text variant="label" tone="secondary" numeric as="p">
            {miniProgressLabel('daily_quiz', status.done, status.total)} · {miniClock(status.msLeft)}
          </Text>
        )}
        <Quiz content={rv.round!.content as { items: MiniChoiceItem[] }} onFinish={finish} onStatus={setStatus} />
      </>
    );
  } else if (rv?.phase === 'submitting') {
    body = (
      <div role="status" aria-live="polite">
        <Text variant="body-md" as="p">
          {gameCopy('submitting')}
        </Text>
      </div>
    );
  } else if (rv?.phase === 'result') {
    body = <ResultView game="daily_quiz" state={rv} onDone={() => (back(), play())} onLogin={() => router.push(loginHref(ALBUM_PATH.web))} />;
  } else if (rv?.phase === 'error') {
    const again = rv.answers;
    body = <ErrorState variant="inline" message={again ? gameCopy('error.submit') : albumCopy('review.fail')} onRetry={again ? () => submit(rv.round!, again, 0) : back} />;
  } else if (phase === 'guest') {
    body = <EmptyState art="leaf" heading={albumCopy('guest')} ctaLabel={albumCopy('login')} onCta={() => router.push(loginHref(ALBUM_PATH.web))} />;
  } else if (q.isError) {
    body = isAlbumOff(q.error) ? <EmptyState art="sprout" heading={albumCopy('off')} /> : <ErrorState message={loadErrorText(q.error)} onRetry={() => q.refetch()} />;
  } else if (!r) {
    body = skeleton();
  } else {
    const action = albumAction(r);
    const chips = albumChips(r);
    const active = chips.some((c) => c.id === filter) ? filter : 'all';
    body =
      action.kind === 'empty' ? (
        <EmptyState art="sprout" heading={action.text} ctaLabel={gameCopy('entry.title')} onCta={play} />
      ) : (
        <>
          <Text variant="body-sm" tone="secondary" as="p">
            {albumCopy('progress', { n: r.seen, m: r.total, k: r.mastered })}
            {albumBadges(r).map((b) => ` · ${b}`)}
          </Text>
          {action.kind === 'note' ? (
            <Text variant="body-sm" as="p">
              {action.text}
            </Text>
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
          {viral && <GreenCardBlock actions />}
          {open && <CardSheet card={open} onClose={() => setOpen(null)} />}
        </>
      );
  }

  return (
    <>
      <PageHeader title={albumCopy('title')} backHref={ALBUM_PLAY_PATH.web} />
      <div className="album-sheet mt-3" data-testid="album">
        {body}
      </div>
    </>
  );
}
