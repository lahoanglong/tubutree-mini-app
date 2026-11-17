import { lazy, Suspense, useCallback, useEffect, useReducer, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { classifyMiniError, miniDeviceId, startMiniRound, submitMiniRound } from '@tubutree/app-core/game-mini/api';
import { isMiniDisabled, miniTodayQuery } from '@tubutree/app-core/game-mini/today';
import { type MiniBoardProps, type MiniBoardStatus } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniClock, miniFailureView, miniGameRules, miniGameTitle, miniIntroReward, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { initialRoundState, roundReducer, submitDelayMs } from '@tubutree/app-core/game-mini/round-machine';
import { useLoginWithNotice } from '../../ui/auth-gate';
import { Button } from '../../ui/button';
import { PageHeader } from '../../ui/page-header';
import { Heading, Text } from '../../ui/text';
import { useAuthPhase } from '../../../hooks/use-auth-phase';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { getDailyCheckInStatus } from '../../../services/account-api';
import { coreHttp } from '../../../services/core-http';
import { browserStorage } from '../../../utils/recently-viewed';
import { useLockedMutation } from '../use-locked-mutation';
import './mini-game.css';

// Mỗi game một chunk lười: màn chơi chỉ tải bàn chơi của game đang mở.
const BOARDS: Record<PlayableMiniGame, ComponentType<MiniBoardProps<never>>> = {
  daily_quiz: lazy(() => import('./mini-daily-quiz')) as ComponentType<MiniBoardProps<never>>,
  sort: lazy(() => import('./mini-sort')) as ComponentType<MiniBoardProps<never>>,
};
const loadResult = () => import('./mini-result');
const MiniResult = lazy(loadResult);
const skeleton = <div className="tubu-mg-board-skeleton" aria-hidden />;

const GAME_PATH = '/game';
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function useMiniRound(game: PlayableMiniGame) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(roundReducer, initialRoundState);
  const startM = useLockedMutation({
    mutationFn: () => startMiniRound(coreHttp, game),
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
      submitMiniRound(coreHttp, game, { roundId, token, answers, deviceId: miniDeviceId(browserStorage(), randomBytes) })
        .then((result) => live && dispatch({ type: 'submitted', result }))
        .catch((err: unknown) => live && dispatch({ type: 'submit_failed', failure: classifyMiniError(err), now: Date.now() }));
    }, submitDelayMs(state, Date.now()));
    return () => {
      live = false;
      clearTimeout(t);
    };
    // Mỗi lần gửi ứng với đúng một cặp (phase, attempts).
  }, [state.phase, state.attempts]);

  useEffect(() => {
    const open = state.phase === 'playing' || state.phase === 'submitting' || (state.phase === 'error' && state.failedStep === 'submit');
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

/**
 * Khung ván dùng chung của game mini (chunk lười `mini-round-shell`): thanh trên (tên, chuỗi ngày ở Đố Xanh), tiến độ và đồng hồ, vùng chơi,
 * màn kết quả, lỗi và quá hạn. Logic chuyển pha ở `roundReducer` (app-core), bàn chơi từng game tải lười riêng.
 */
export default function MiniRoundShell({ game }: { game: PlayableMiniGame }) {
  const navigate = useSmartNavigate();
  const login = useLoginWithNotice();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const todayQ = useQuery({ ...miniTodayQuery(coreHttp, authed), enabled: phase !== 'loading' });
  const streakQ = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: authed && game === 'daily_quiz' });
  const { state, dispatch, start } = useMiniRound(game);
  const [status, setStatus] = useState<MiniBoardStatus | null>(null);
  const onStatus = useCallback(
    (s: MiniBoardStatus) =>
      setStatus((prev) => (prev && prev.done === s.done && prev.total === s.total && Math.ceil(prev.msLeft / 1000) === Math.ceil(s.msLeft / 1000) ? prev : s)),
    [],
  );
  const onFinish = useCallback((answers: unknown[]) => dispatch({ type: 'finish', answers, now: Date.now() }), [dispatch]);
  const back = () => navigate(GAME_PATH);
  useEffect(() => {
    if (state.phase === 'playing') void loadResult();
  }, [state.phase]);

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
          <Suspense fallback={skeleton}>
            <Board content={content as never} onFinish={onFinish} onStatus={onStatus} />
          </Suspense>
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
    body = (
      <Suspense fallback={skeleton}>
        <MiniResult game={game} state={state} onDone={back} onLogin={() => void login()} />
      </Suspense>
    );
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
    const act = { retry: () => dispatch({ type: 'retry', now: Date.now() }), new: start, back, login: () => void login() }[view.action];
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
        actions={
          game === 'daily_quiz' && streak > 0 ? (
            <span className="tubu-mg-chip" data-tone="brand" data-testid="mini-streak">
              {gameCopy('top.streak', { n: streak })}
            </span>
          ) : undefined
        }
      />
      <div className="tubu-mg-shell" data-game={game} data-phase={state.phase}>
        <div className="tubu-mg-main">{body}</div>
      </div>
    </>
  );
}
