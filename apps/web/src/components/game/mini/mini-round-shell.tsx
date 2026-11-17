'use client';

import { useCallback, useEffect, useReducer, useState, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { classifyMiniError, miniDeviceId, startMiniRound, submitMiniRound } from '@tubutree/app-core/game-mini/api';
import { isMiniDisabled, miniTodayQuery, withFreshSession, type MiniSessionRefresh } from '@tubutree/app-core/game-mini/today';
import { type MiniBoardProps, type MiniBoardStatus } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import {
  MINI_RECYCLE_PATH,
  miniClock,
  miniFailureView,
  miniGameRules,
  miniGameTitle,
  miniIntroReward,
  miniPlayPath,
  miniProductPath,
  miniResultSummary,
  safeSourceUrl,
  sourceHost,
  type PlayableMiniGame,
} from '@tubutree/app-core/game-mini/format';
import { MINI_REVIEW_BADGE, miniQuizProduct, miniReviewRows, type MiniReviewRow } from '@tubutree/app-core/game-mini/review';
import { initialRoundState, roundReducer, submitDelayMs, type RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { checkInQuery } from '@tubutree/app-core/queries/loyalty';
import { Button, Heading, ProductThumb, Text } from '@/components/mini';
import { PageHeader } from '@/components/ui/page-header';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useAuthPhase } from '@/lib/auth-phase';
import { refreshSession as refreshWebSession } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { loginHref } from '@/lib/return-to';
import { isWebRouteReady } from '@/lib/route-map';
import { usePublicConfig } from '@/lib/use-public-config';
import './mini-game.css';

const boardSkeleton = () => <div className="tubu-mg-board-skeleton" aria-hidden />;

// Mỗi game một chunk lười: màn chơi chỉ tải bàn chơi của game đang mở.
const BOARDS: Record<PlayableMiniGame, ComponentType<MiniBoardProps<never>>> = {
  daily_quiz: dynamic(() => import('./mini-daily-quiz'), { ssr: false, loading: boardSkeleton }) as ComponentType<MiniBoardProps<never>>,
  sort: dynamic(() => import('./mini-sort'), { ssr: false, loading: boardSkeleton }) as ComponentType<MiniBoardProps<never>>,
};

const GAME_PATH = '/vuon-xanh';
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function webStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const refreshSession: MiniSessionRefresh = () => refreshWebSession().then((o) => o.kind === 'ok');

function useMiniRound(game: PlayableMiniGame, authed: boolean) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(roundReducer, initialRoundState);
  const startM = useLockedMutation({
    mutationFn: () => withFreshSession(() => startMiniRound(coreHttp, game), authed, refreshSession),
    onSuccess: (round) => dispatch({ type: 'started', round, now: Date.now() }),
    onError: (err) => dispatch({ type: 'start_failed', failure: classifyMiniError(err) }),
  });
  const busy = state.phase === 'starting' || state.phase === 'playing' || state.phase === 'submitting';
  const start = () => {
    if (busy) return;
    dispatch({ type: 'start' });
    startM.mutate();
  };

  // Nộp bài: lần đầu đợi đủ thời gian tối thiểu, mất mạng thì máy trạng thái tăng `attempts` và hiệu ứng này gửi lại cùng đáp án.
  useEffect(() => {
    if (state.phase !== 'submitting' || !state.round || !state.answers) return;
    const { roundId, token } = state.round;
    const answers = state.answers;
    let live = true;
    const t = setTimeout(() => {
      submitMiniRound(coreHttp, game, { roundId, token, answers, deviceId: miniDeviceId(webStorage(), randomBytes) })
        .then((result) => live && dispatch({ type: 'submitted', result }))
        .catch((err: unknown) => live && dispatch({ type: 'submit_failed', failure: classifyMiniError(err), now: Date.now() }));
    }, submitDelayMs(state, Date.now()));
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mỗi lần gửi ứng với đúng một cặp (phase, attempts)
  }, [state.phase, state.attempts]);

  // Đang nộp thì không tự cắt: máy chủ có thể đã nhận bài trước hạn của nó, để `ROUND_EXPIRED` của máy chủ quyết thay vì bỏ kết quả về muộn.
  useEffect(() => {
    const open = state.phase === 'playing' || (state.phase === 'error' && state.failedStep === 'submit');
    if (!open || state.deadline === null) return;
    const t = setTimeout(() => dispatch({ type: 'expire' }), Math.max(0, state.deadline - Date.now()));
    return () => clearTimeout(t);
  }, [state.phase, state.failedStep, state.deadline]);

  // Đã chấm (hoặc máy chủ báo ván đã ghi): làm mới lượt thưởng, 💧, Điểm Xanh và thẻ điểm danh ở Vườn Xanh, không cần tải lại trang.
  useEffect(() => {
    if (state.phase !== 'result' && !(state.phase === 'error' && state.failure === 'already_submitted')) return;
    for (const key of [['game'], ['loyalty'], ['loyalty-checkin'], ['me']]) void qc.invalidateQueries({ queryKey: key });
  }, [state.phase, state.failure, qc]);

  return { state, dispatch, start };
}

function StatusBar({ game, status, rewarded }: { game: PlayableMiniGame; status: MiniBoardStatus | null; rewarded: boolean }) {
  const done = status?.done ?? 0;
  const total = status?.total ?? 0;
  const msLeft = status?.msLeft ?? 0;
  const label = game === 'daily_quiz' ? gameCopy('progress.question', { n: Math.min(done + 1, total || 1), m: total || 1 }) : gameCopy('progress.items', { n: done, m: total });
  return (
    <div className="tubu-mg-status" data-testid="mini-status">
      <div className="tubu-mg-status-row">
        <Text variant="label" tone="secondary" numeric>
          {label}
        </Text>
        <span className="tubu-mg-clock" role="timer" aria-label={gameCopy('top.clockAria', { n: Math.ceil(msLeft / 1000) })}>
          <Text variant="label" tone={msLeft <= 5_000 ? 'danger' : 'primary'} numeric>
            {miniClock(msLeft)}
          </Text>
        </span>
      </div>
      <div className="tubu-mg-track" role="progressbar" aria-label={gameCopy('progress.aria', { n: done, m: total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="tubu-mg-fill" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
      </div>
      {!rewarded && <span className="tubu-mg-chip">{gameCopy('chip.noReward')}</span>}
    </div>
  );
}

/** Nguồn ở web: liên kết thật mở tab mới (chỉ http/https), kèm tên miền để khách biết sẽ sang trang nào. */
function SourceLink({ url, n }: { url: string; n: number }) {
  const href = safeSourceUrl(url);
  const host = sourceHost(url);
  if (!href || !host) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tubu-mg-link" aria-label={gameCopy('result.sourceAria', { n })}>
      {gameCopy('result.sourceHost', { host })}
    </a>
  );
}

function ReviewList({ rows }: { rows: MiniReviewRow[] }) {
  return (
    <ol className="tubu-mg-review" data-testid="mini-review">
      {rows.map((r, i) => (
        <li key={r.key} className="tubu-mg-review-item" data-testid="mini-review-item">
          <span className="tubu-mg-badge" data-state={r.state}>
            {gameCopy(MINI_REVIEW_BADGE[r.state])}
          </span>
          <Text variant="body-sm" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
            {r.title}
          </Text>
          {r.state === 'wrong' && r.given && (
            <Text variant="caption" tone="secondary" as="p">
              {gameCopy('result.given', { a: r.given })}
            </Text>
          )}
          {r.state !== 'correct' && r.expected && (
            <Text variant="caption" tone="secondary" as="p">
              {gameCopy('result.expected', { a: r.expected })}
            </Text>
          )}
          <Text variant="body-sm" as="p">
            <strong>{gameCopy('result.why')}: </strong>
            {r.explanation}
          </Text>
          <SourceLink url={r.sourceUrl} n={i + 1} />
        </li>
      ))}
    </ol>
  );
}

function ResultView({ game, state, onDone, onLogin }: { game: PlayableMiniGame; state: RoundState; onDone: () => void; onLogin: () => void }) {
  const waste = usePublicConfig().waste.enabled && isWebRouteReady(MINI_RECYCLE_PATH.web);
  const r = state.result!;
  const summary = miniResultSummary(r);
  const product = miniQuizProduct(state.round?.content);
  return (
    <section className="tubu-mg-panel" aria-labelledby="mini-result-title" data-testid="mini-result">
      <Heading id="mini-result-title" as="h2" variant="title-md" font="ui">
        {gameCopy('result.title')}
      </Heading>
      <Heading as="p" variant="display-md" className="tubu-mg-score" data-testid="mini-result-score">
        {summary.score}
      </Heading>
      {summary.gains.length > 0 && (
        <div className="tubu-mg-gains">
          {summary.gains.map((g) => (
            <span key={g} className="tubu-mg-chip" data-tone="brand">
              {g}
            </span>
          ))}
        </div>
      )}
      {summary.notes.length > 0 && (
        <ul className="tubu-mg-lines" aria-live="polite">
          {summary.notes.map((n) => (
            <li key={n}>
              <Text variant="body-sm" tone="secondary" as="span">
                {n}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <Button fullWidth size="lg" onPress={summary.loginToReward ? onLogin : onDone}>
        {gameCopy(summary.loginToReward ? 'result.login' : 'result.done')}
      </Button>
      {game === 'sort' && waste && (
        <Link href={MINI_RECYCLE_PATH.web} className="tubu-mg-link">
          {gameCopy('invite.sort')}
        </Link>
      )}
      {game === 'daily_quiz' && product && (
        <div className="tubu-mg-panel">
          <Text variant="caption" tone="secondary" as="p">
            {gameCopy('result.product')}
          </Text>
          <Link href={miniProductPath.web(product.slug, game)} className="tubu-mg-product" data-testid="mini-result-product">
            <ProductThumb src={product.imageUrl} alt={product.name} size={48} />
            <span className="tubu-mg-row-text">
              <Text variant="body-sm" as="span" className="tubu-mg-one-line">
                {product.name}
              </Text>
              <Text variant="price-sm" as="span" numeric>
                {formatVnd(product.price)}
              </Text>
            </span>
          </Link>
        </div>
      )}
      <Heading as="h3" variant="title-sm" font="ui">
        {gameCopy('result.review')}
      </Heading>
      {state.round && <ReviewList rows={miniReviewRows(r.review, state.round.content)} />}
    </section>
  );
}

/**
 * Khung ván dùng chung của game mini trên web: thanh trên (tên, chuỗi ngày ở Đố Xanh), tiến độ và đồng hồ, vùng chơi, màn kết quả, lỗi và quá
 * hạn. Logic chuyển pha ở `roundReducer` (app-core), bàn chơi từng game tải lười riêng. Từ 1024px vùng chơi ≤ 720px, cột phải là "Cách chơi".
 */
export default function MiniRoundShell({ game }: { game: PlayableMiniGame }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const todayQ = useQuery({ ...miniTodayQuery(coreHttp, authed, refreshSession), enabled: phase !== 'loading' });
  const streakQ = useQuery({ ...checkInQuery(coreHttp), enabled: authed && game === 'daily_quiz' });
  const { state, dispatch, start } = useMiniRound(game, authed);
  const [status, setStatus] = useState<MiniBoardStatus | null>(null);
  const onStatus = useCallback(
    (s: MiniBoardStatus) =>
      setStatus((prev) => (prev && prev.done === s.done && prev.total === s.total && Math.ceil(prev.msLeft / 1000) === Math.ceil(s.msLeft / 1000) ? prev : s)),
    [],
  );
  const onFinish = useCallback((answers: unknown[]) => dispatch({ type: 'finish', answers, now: Date.now() }), [dispatch]);
  const back = () => router.push(GAME_PATH);
  const login = () => router.push(loginHref(miniPlayPath.web(game)));

  const title = miniGameTitle(game);
  const streak = state.result?.checkIn?.streakDays ?? streakQ.data?.streakDays ?? 0;
  const disabled = (todayQ.isError && isMiniDisabled(todayQ.error)) || (todayQ.isSuccess && !todayQ.data.games.some((g) => g.game === game));
  const intro = miniIntroReward(todayQ.data, game);
  const Board = BOARDS[game];
  const content = state.round?.content;

  let body;
  if (state.phase === 'idle' || state.phase === 'starting') {
    body = disabled ? (
      <div className="tubu-mg-panel" data-testid="mini-disabled">
        <Text variant="body-md" as="p">
          {gameCopy('error.disabled')}
        </Text>
        <Button fullWidth size="lg" onPress={back}>
          {gameCopy('result.done')}
        </Button>
      </div>
    ) : (
      <div className="tubu-mg-panel" data-testid="mini-intro">
        <Text variant="body-md" as="p">
          {miniGameRules(game)}
        </Text>
        {!intro.rewarded && todayQ.isSuccess && (
          <span className="tubu-mg-chip" data-testid="mini-no-reward">
            {gameCopy('intro.noReward')}
          </span>
        )}
        <ul className="tubu-mg-lines">
          {intro.lines.map((l) => (
            <li key={l}>
              <Text variant="body-sm" tone="secondary" as="span">
                {l}
              </Text>
            </li>
          ))}
        </ul>
        <Button fullWidth size="lg" loading={state.phase === 'starting'} disabled={todayQ.isPending} onPress={start}>
          {gameCopy('intro.start')}
        </Button>
      </div>
    );
  } else if ((state.phase === 'playing' || state.phase === 'submitting') && state.round && content) {
    body = (
      <>
        <StatusBar game={game} status={status} rewarded={state.round.rewarded} />
        {state.phase === 'playing' ? (
          <Board content={content as never} onFinish={onFinish} onStatus={onStatus} />
        ) : (
          <div className="tubu-mg-panel" role="status" aria-live="polite">
            <Text variant="body-md" as="p">
              {gameCopy(state.attempts > 1 ? 'submitRetry' : 'submitting')}
            </Text>
          </div>
        )}
      </>
    );
  } else if (state.phase === 'result' && state.result) {
    body = <ResultView game={game} state={state} onDone={back} onLogin={login} />;
  } else if (state.phase === 'expired') {
    body = (
      <div className="tubu-mg-panel" role="alert" data-testid="mini-expired">
        <Heading as="h2" variant="title-sm" font="ui">
          {gameCopy('expired.title')}
        </Heading>
        <Text variant="body-md" as="p">
          {gameCopy('expired.body')}
        </Text>
        <Button fullWidth size="lg" onPress={start}>
          {gameCopy('error.newRound')}
        </Button>
      </div>
    );
  } else {
    const view = miniFailureView(state.failure ?? 'network', state.failedStep ?? 'start');
    const act = { retry: () => dispatch({ type: 'retry', now: Date.now() }), new: start, back, login }[view.action];
    const label = { retry: 'error.retry', new: 'error.newRound', back: 'result.done', login: 'result.login' } as const;
    body = (
      <div className="tubu-mg-panel" role="alert" data-testid="mini-error">
        <Text variant="body-md" as="p">
          {view.message}
        </Text>
        <Button fullWidth size="lg" onPress={act}>
          {gameCopy(label[view.action])}
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        backHref={GAME_PATH}
        actions={
          game === 'daily_quiz' && streak > 0 ? (
            <span className="tubu-mg-chip" data-tone="brand" data-testid="mini-streak">
              {gameCopy('top.streak', { n: streak })}
            </span>
          ) : undefined
        }
      />
      <div className="tubu-mg-shell" data-game={game} data-phase={state.phase} data-wide="true">
        <div className="tubu-mg-main">{body}</div>
        <aside className="tubu-mg-aside" aria-labelledby="mini-aside-title">
          <div className="tubu-mg-panel">
            <Heading id="mini-aside-title" as="h2" variant="title-sm" font="ui">
              {gameCopy('aside.how')}
            </Heading>
            <Text variant="body-sm" tone="secondary" as="p">
              {miniGameRules(game)}
            </Text>
          </div>
        </aside>
      </div>
    </>
  );
}
