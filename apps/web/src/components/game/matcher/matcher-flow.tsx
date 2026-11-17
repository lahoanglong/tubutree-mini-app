'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { MATCHER_ENTRIES, type MatcherEntry } from '@tubutree/shared-types';
import { miniDeviceId } from '@tubutree/app-core/game-mini/api';
import {
  MATCHER_FLOW,
  MATCHER_FLOW_LENGTH,
  classifyMatcherError,
  matcherAnswer,
  matcherAnswers,
  matcherBack,
  matcherChooseTrivia,
  matcherContentQuery,
  matcherCurrent,
  matcherNext,
  matcherQuestionAt,
  matcherSeconds,
  matcherStart,
  pickMatcherTrivia,
  postMatcherResult,
  type MatcherContent,
  type MatcherFailure,
  type MatcherResult as Result,
  type MatcherState,
  type MatcherTrivia,
} from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { Button, Heading, Text } from '@/components/mini';
import { PageHeader } from '@/components/ui/page-header';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { MatcherResultView } from './matcher-result';
import { takePendingMatcher } from './matcher-pending';
import '../mini/mini-game.css';
import './matcher.css';

const GAME_PATH = '/vuon-xanh';
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function webStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function entryFromUrl(): MatcherEntry {
  try {
    const from = new URLSearchParams(window.location.search).get('from');
    return (MATCHER_ENTRIES as readonly string[]).includes(from ?? '') ? (from as MatcherEntry) : 'direct';
  } catch {
    return 'direct';
  }
}

type View =
  | { kind: 'intro' }
  | { kind: 'steps' }
  | { kind: 'submitting' }
  | { kind: 'result'; result: Result; pending: boolean }
  | { kind: 'failed'; reason: MatcherFailure };

const FAILURE_TEXT: Record<MatcherFailure, Parameters<typeof matcherCopy>[0]> = {
  disabled: 'error.disabled',
  no_content: 'error.noContent',
  invalid: 'error.result',
  network: 'error.result',
};

/** Hàng đầu: nút lùi 44px, chữ "Bước n/5" và 5 nấc. */
function StepBar({ index, onBack }: { index: number; onBack: () => void }) {
  const n = index + 1;
  return (
    <div className="tubu-mx-steps">
      <button type="button" className="tubu-mx-back" aria-label={matcherCopy('back')} onClick={onBack} data-testid="matcher-back">
        <ChevronLeft size={20} aria-hidden />
      </button>
      <ol className="tubu-mx-notches" aria-label={matcherCopy('step.aria', { n, total: MATCHER_FLOW_LENGTH })} data-testid="matcher-notches">
        {MATCHER_FLOW.map((_, i) => (
          <li key={i} className="tubu-mx-notch" data-on={i <= index} />
        ))}
      </ol>
      <Text variant="caption" tone="secondary" as="span" aria-hidden style={{ fontVariantNumeric: 'tabular-nums' }}>
        {matcherCopy('step.label', { n, total: MATCHER_FLOW_LENGTH })}
      </Text>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function TriviaStep({ trivia, chosen, onChoose, onNext }: { trivia: MatcherTrivia; chosen: number | undefined; onChoose: (i: number) => void; onNext: () => void }) {
  const done = chosen !== undefined;
  const right = chosen === trivia.answer;
  return (
    <div className="tubu-mg-panel" data-testid="matcher-trivia">
      <Text variant="caption" tone="brand" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
        {matcherCopy('trivia.kicker')}
      </Text>
      <div tabIndex={-1} className="tubu-mg-question" data-matcher-focus>
        <Heading as="h2" variant="title-sm" font="ui">
          {trivia.prompt}
        </Heading>
      </div>
      <ul className="tubu-mg-options">
        {trivia.options.map((label, i) => (
          <li key={label}>
            <button type="button" className="tubu-mg-option" aria-pressed={chosen === i} disabled={done && chosen !== i} onClick={() => onChoose(i)}>
              <span className="tubu-mg-letter" aria-hidden>
                {String.fromCharCode(65 + i)}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite">
        {done && (
          <div className="tubu-mg-panel" data-testid="matcher-trivia-feedback">
            <span className="tubu-mg-badge" data-state={right ? 'correct' : 'wrong'}>
              {right ? matcherCopy('trivia.right') : matcherCopy('trivia.wrong', { a: trivia.options[trivia.answer] ?? '' })}
            </span>
            <Text variant="body-sm" as="p">
              {trivia.explanation}
            </Text>
            <a
              href={trivia.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="tubu-mg-link"
              aria-label={`${matcherCopy('trivia.source', { host: hostOf(trivia.sourceUrl) })}. ${matcherCopy('trivia.sourceAria')}`}
            >
              {matcherCopy('trivia.source', { host: hostOf(trivia.sourceUrl) })}
            </a>
          </div>
        )}
      </div>
      {done && (
        <Button fullWidth size="lg" onPress={onNext}>
          {matcherCopy('next')}
        </Button>
      )}
    </div>
  );
}

function Steps({
  content,
  state,
  trivia,
  onAnswer,
  onChoose,
  onNext,
}: {
  content: MatcherContent;
  state: MatcherState;
  trivia: MatcherTrivia[];
  onAnswer: (value: string) => void;
  onChoose: (i: number) => void;
  onNext: () => void;
}) {
  const cur = matcherCurrent(state);
  if (!cur) return null;
  if (cur.kind === 'trivia') {
    const t = trivia[cur.slot];
    return t ? <TriviaStep key={t.id} trivia={t} chosen={state.trivia[cur.slot]} onChoose={onChoose} onNext={onNext} /> : null;
  }
  const q = matcherQuestionAt(content.questions, state, cur.step);
  if (!q) return null;
  const picked = state.answers[q.code];
  return (
    <div className="tubu-mg-panel" data-testid={`matcher-question-${cur.step}`}>
      <div tabIndex={-1} className="tubu-mg-question" data-matcher-focus>
        <Heading as="h2" variant="title-sm" font="ui">
          {q.prompt}
        </Heading>
      </div>
      <ul className="tubu-mg-options">
        {q.options.map((o) => (
          <li key={o.value}>
            <button type="button" className="tubu-mg-option" aria-pressed={picked === o.value} onClick={() => onAnswer(o.value)} data-value={o.value}>
              {o.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Chọn Chuẩn Xanh" trên web: mở đầu, 5 bước (3 câu nhu cầu, 2 câu đố có nguồn), rồi bộ 2–4 món còn hàng do máy chủ chọn. Chọn đáp án là sang
 * bước kế; quay lại giữ đáp án. Cờ `game.matcher_enabled` tắt thì nội dung trả 404 và màn chỉ báo đang tạm nghỉ. Không tự chuyển trang sau khi
 * thêm giỏ. Khách chưa đăng nhập chơi trọn; bộ chờ sau đăng nhập hiện lại một lần (`matcher-pending.ts`).
 */
export default function MatcherFlow() {
  const phase = useAuthPhase();
  const contentQ = useQuery(matcherContentQuery(coreHttp));
  const [view, setView] = useState<View>({ kind: 'intro' });
  const [state, setState] = useState<MatcherState>(matcherStart);
  const [trivia, setTrivia] = useState<MatcherTrivia[]>([]);
  const startedAt = useRef(0);
  const submitting = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pending = takePendingMatcher();
    if (pending) setView({ kind: 'result', result: pending, pending: true });
  }, []);

  // Đổi bước thì đưa tiêu điểm về câu mới: trình đọc màn hình đọc câu hỏi, bàn phím không kẹt ở nút đã biến mất.
  useEffect(() => {
    if (view.kind !== 'steps') return;
    rootRef.current?.querySelector<HTMLElement>('[data-matcher-focus]')?.focus({ preventScroll: true });
  }, [view.kind, state.index]);

  const content = contentQ.data;

  const start = () => {
    if (!content) return;
    startedAt.current = Date.now();
    setTrivia(pickMatcherTrivia(content.trivia, randomBytes(2).reduce((n, b) => n * 256 + b, 0)));
    setState(matcherStart());
    setView({ kind: 'steps' });
    trackWebEvent('matcher_started', { entry: entryFromUrl() });
  };

  const submit = async (s: MatcherState) => {
    if (!content || submitting.current) return;
    const answers = matcherAnswers(content.questions, s);
    if (!answers) return;
    submitting.current = true;
    setView({ kind: 'submitting' });
    try {
      const deviceId = phase === 'authenticated' ? miniDeviceId(webStorage(), randomBytes) : undefined;
      const result = await postMatcherResult(coreHttp, { answers, ...(deviceId ? { deviceId } : {}) });
      trackWebEvent('matcher_completed', { outcomeId: result.outcomeId, fallback: result.fallback, seconds: matcherSeconds(Date.now() - startedAt.current) });
      setView({ kind: 'result', result, pending: false });
    } catch (err) {
      setView({ kind: 'failed', reason: classifyMatcherError(err) });
    } finally {
      submitting.current = false;
    }
  };

  const advance = (next: MatcherState) => {
    if (next === state) return;
    trackWebEvent('matcher_question_answered', { index: state.index + 1 });
    setState(next);
    if (next.index >= MATCHER_FLOW_LENGTH) void submit(next);
  };

  const onAnswer = (value: string) => content && advance(matcherAnswer(content.questions, state, value));
  const onChoose = (i: number) => setState((s) => matcherChooseTrivia(s, i));
  const onNext = () => content && advance(matcherNext(content.questions, state));
  const onBack = () => (state.index === 0 ? setView({ kind: 'intro' }) : setState(matcherBack(state)));
  const again = () => {
    setState(matcherStart());
    setView({ kind: 'intro' });
  };
  // Lỗi mạng: gửi lại đúng đáp án đang giữ. Đáp án bị từ chối (nội dung vừa đổi): tải lại câu hỏi và chơi lại từ đầu.
  const retry = () => {
    if (view.kind === 'failed' && view.reason === 'network') {
      void submit(state);
      return;
    }
    void contentQ.refetch();
    again();
  };

  const loadFailure: MatcherFailure | null = contentQ.isError ? classifyMatcherError(contentQ.error) : null;
  let body: React.ReactNode;
  if (view.kind === 'result') {
    body = <MatcherResultView result={view.result} pending={view.pending} onAgain={again} />;
  } else if (loadFailure === 'disabled' || loadFailure === 'no_content' || (view.kind === 'failed' && view.reason !== 'network' && view.reason !== 'invalid')) {
    const reason = loadFailure ?? (view.kind === 'failed' ? view.reason : 'disabled');
    body = (
      <div className="tubu-mg-panel" data-testid="matcher-off">
        <Text variant="body-md" as="p">
          {matcherCopy(FAILURE_TEXT[reason])}
        </Text>
        <Link href={GAME_PATH} className="tubu-mg-link">
          {matcherCopy('error.home')}
        </Link>
      </div>
    );
  } else if (loadFailure) {
    body = (
      <div className="tubu-mg-panel" data-testid="matcher-load-error">
        <Text variant="body-md" as="p">
          {matcherCopy('error.load')}
        </Text>
        <Button fullWidth size="lg" onPress={() => void contentQ.refetch()}>
          {matcherCopy('error.retry')}
        </Button>
      </div>
    );
  } else if (view.kind === 'failed') {
    body = (
      <div className="tubu-mg-panel" data-testid="matcher-result-error">
        <Text variant="body-md" as="p">
          {matcherCopy(FAILURE_TEXT[view.reason])}
        </Text>
        <Button fullWidth size="lg" onPress={retry}>
          {matcherCopy('error.retry')}
        </Button>
      </div>
    );
  } else if (view.kind === 'submitting') {
    body = (
      <div className="tubu-mg-panel" role="status" aria-live="polite" data-testid="matcher-submitting">
        <Text variant="body-md" tone="secondary" as="p">
          {matcherCopy('loading')}
        </Text>
      </div>
    );
  } else if (view.kind === 'steps' && content) {
    body = (
      <>
        <StepBar index={state.index} onBack={onBack} />
        <Steps content={content} state={state} trivia={trivia} onAnswer={onAnswer} onChoose={onChoose} onNext={onNext} />
      </>
    );
  } else {
    body = (
      <div className="tubu-mg-panel" data-testid="matcher-intro">
        <Text variant="body-md" tone="secondary" as="p">
          {matcherCopy('intro.sub')}
        </Text>
        <Button fullWidth size="lg" loading={contentQ.isPending} onPress={start}>
          {matcherCopy('intro.start')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={matcherCopy('title')} backHref={GAME_PATH} />
      <div ref={rootRef} className="tubu-mg-shell" data-testid="matcher" data-view={view.kind}>
        {body}
      </div>
    </>
  );
}
