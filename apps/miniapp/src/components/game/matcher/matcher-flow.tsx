import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useLocation } from 'zmp-ui';
import { MATCHER_ENTRIES, type MatcherEntry } from '@tubutree/shared-types';
import { addCartItemsBatch } from '@tubutree/app-core/api/cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniDeviceId } from '@tubutree/app-core/game-mini/api';
import { sourceHost } from '@tubutree/app-core/game-mini/format';
import {
  MATCHER_FLOW,
  MATCHER_FLOW_LENGTH,
  classifyMatcherError,
  matcherAnswer,
  matcherAnswers,
  matcherBack,
  matcherCartLines,
  matcherChooseTrivia,
  matcherContentQuery,
  matcherCurrent,
  matcherItemView,
  matcherNext,
  matcherQuestionAt,
  matcherSeconds,
  matcherStart,
  matcherTotal,
  matcherWhy,
  pickMatcherTrivia,
  postMatcherResult,
  type MatcherFailure,
  type MatcherResult,
  type MatcherState,
  type MatcherTrivia,
} from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { Button } from '../../ui/button';
import { PageHeader } from '../../ui/page-header';
import { Money } from '../../ui/price-tag';
import { ProductTile } from '../../ui/product-tile';
import { Heading, Text } from '../../ui/text';
import { useAuthPhase } from '../../../hooks/use-auth-phase';
import { useLoginWithNotice } from '../../../hooks/use-login-notice';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { trackEvent } from '../../../services/analytics';
import { cartStorefrontSlug } from '../../../services/cart-key';
import { coreHttp } from '../../../services/core-http';
import { useAuthStore } from '../../../store/auth';
import { browserStorage } from '../../../utils/recently-viewed';
import '../mini/mini-game.css';
import './matcher.css';

const GAME_PATH = '/game';
const CART_PATH = '/cart';
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

type View = { kind: 'intro' } | { kind: 'steps' } | { kind: 'submitting' } | { kind: 'result'; result: MatcherResult } | { kind: 'failed'; reason: MatcherFailure };
type AddState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'added'; n: number } | { kind: 'error' };

const FAILURE_TEXT: Record<MatcherFailure, Parameters<typeof matcherCopy>[0]> = {
  disabled: 'error.disabled',
  no_content: 'error.noContent',
  invalid: 'error.result',
  network: 'error.result',
};

/** Khối một dòng chữ kèm hành động (mở đầu, đang gửi, tạm nghỉ, lỗi, bộ rỗng); `live` cho trình đọc màn hình đọc dòng đang gửi. */
function Panel({ id, text, muted, live, children }: { id: string; text: string; muted?: boolean; live?: boolean; children?: ReactNode }) {
  return (
    <div className="tubu-mg-panel" role={live ? 'status' : undefined} data-testid={id}>
      <Text variant="body-md" tone={muted ? 'secondary' : undefined} as="p">
        {text}
      </Text>
      {children}
    </div>
  );
}

/** Đề của một bước: nhận tiêu điểm khi đổi bước để trình đọc màn hình đọc câu mới. */
function Ask({ text }: { text: string }) {
  return (
    <div tabIndex={-1} className="tubu-mg-question" data-matcher-focus>
      <Heading as="h2" variant="title-sm" font="ui">
        {text}
      </Heading>
    </div>
  );
}

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
      <Text variant="caption" tone="secondary" as="span" aria-hidden numeric>
        {matcherCopy('step.label', { n, total: MATCHER_FLOW_LENGTH })}
      </Text>
    </div>
  );
}

/** Câu đố có nguồn: chọn xong hiện đúng/sai, lời giải và tên miền nguồn (Mini App không mở trang ngoài Zalo nên không có liên kết). */
function TriviaStep({ trivia, chosen, onChoose, onNext }: { trivia: MatcherTrivia; chosen: number | undefined; onChoose: (i: number) => void; onNext: () => void }) {
  const done = chosen !== undefined;
  const right = chosen === trivia.answer;
  const host = sourceHost(trivia.sourceUrl);
  return (
    <div className="tubu-mg-panel" data-testid="matcher-trivia">
      <Text variant="caption" tone="brand" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
        {matcherCopy('trivia.kicker')}
      </Text>
      <Ask text={trivia.prompt} />
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
            {host && (
              <Text variant="caption" tone="tertiary" as="p">
                {matcherCopy('trivia.source', { host })}
              </Text>
            )}
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

/**
 * Bộ gợi ý: 2–4 dòng (ảnh, tên kèm phân loại, giá), mỗi dòng một câu "vì sao hợp", tổng tiền và MỘT nút "Thêm cả bộ vào giỏ" (một lệnh lô, máy chủ
 * thêm tất cả hoặc không món nào). Khoá `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lệnh; thêm xong nút thành "Xem giỏ". Khách chưa đăng nhập
 * đăng nhập Zalo ngay trên màn này (kết quả giữ nguyên) rồi bộ được thêm tiếp. Không có thưởng nào cho việc thêm giỏ.
 */
function MatcherResultView({ result, onAgain }: { result: MatcherResult; onAgain: () => void }) {
  const qc = useQueryClient();
  const navigate = useSmartNavigate();
  const phase = useAuthPhase();
  const login = useLoginWithNotice();
  const busy = useRef(false);
  const [add, setAdd] = useState<AddState>({ kind: 'idle' });
  const n = result.items.length;
  const now = Date.now();

  const addAll = async () => {
    if (busy.current || phase === 'loading') return;
    busy.current = true;
    setAdd({ kind: 'busy' });
    try {
      if (useAuthStore.getState().status !== 'authenticated') {
        await login();
        if (useAuthStore.getState().status !== 'authenticated') return setAdd({ kind: 'idle' });
      }
      await addCartItemsBatch(coreHttp, matcherCartLines(result.items), 'pdp', cartStorefrontSlug());
      void qc.invalidateQueries({ queryKey: ['cart'] });
      setAdd({ kind: 'added', n });
      trackEvent('matcher_add_all', 'miniapp', { itemCount: n });
    } catch {
      setAdd({ kind: 'error' });
    } finally {
      busy.current = false;
    }
  };

  if (n === 0) {
    return (
      <Panel id="matcher-result-empty" text={matcherCopy('result.empty')}>
        <Button fullWidth size="lg" onPress={onAgain}>
          {matcherCopy('result.again')}
        </Button>
      </Panel>
    );
  }

  const added = add.kind === 'added';
  return (
    <section className="tubu-mg-panel" aria-labelledby="matcher-result-title" data-testid="matcher-result" data-fallback={result.fallback}>
      <Text variant="caption" tone="brand" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
        {matcherCopy(result.fallback ? 'result.fallback' : 'result.kicker')}
      </Text>
      <Heading id="matcher-result-title" as="h2" variant="title-md" font="ui">
        {result.title}
      </Heading>
      {result.fallback && (
        <Text variant="body-sm" tone="secondary" as="p" data-testid="matcher-fallback-note">
          {matcherCopy('result.fallbackNote')}
        </Text>
      )}
      {result.water > 0 && (
        <Text variant="body-sm" tone="brand" as="p" data-testid="matcher-water">
          {matcherCopy('result.water', { n: result.water })}
        </Text>
      )}
      <ul className="tubu-mx-items" data-testid="matcher-items">
        {result.items.map((item) => (
          <li key={item.variationId}>
            <ProductTile view={matcherItemView(item, now)} variant="line" href={`/product/${encodeURIComponent(item.slug)}`} />
            <Text variant="caption" tone="secondary" as="p" className="tubu-mx-why">
              {matcherWhy(item)}
            </Text>
          </li>
        ))}
      </ul>
      <div className="tubu-mx-total" data-testid="matcher-total">
        <Text variant="body-sm" tone="secondary" as="span">
          {matcherCopy('result.total', { n })}
        </Text>
        <Text variant="price-md" as="span">
          <Money amount={matcherTotal(result.items)} />
        </Text>
      </div>
      <Button fullWidth size="lg" loading={add.kind === 'busy' || phase === 'loading'} onPress={added ? () => navigate(CART_PATH) : addAll}>
        {matcherCopy(added ? 'result.viewCart' : 'result.addAll')}
      </Button>
      <div role="status" aria-live="polite" data-testid="matcher-add-status">
        {added && (
          <Text variant="body-sm" tone="secondary" as="p">
            {matcherCopy('result.added', { n: add.n })}
          </Text>
        )}
        {add.kind === 'error' && (
          <Text variant="body-sm" tone="danger" as="p">
            {matcherCopy('result.addError')}
          </Text>
        )}
      </div>
      <button type="button" className="tubu-mg-link" onClick={onAgain} data-testid="matcher-again">
        {matcherCopy('result.again')}
      </button>
    </section>
  );
}

/**
 * "Chọn Chuẩn Xanh" trong Mini App (`/game/matcher`, cặp web `/vuon-xanh/chon-chuan-xanh`): mở đầu, 5 bước (3 câu nhu cầu, 2 câu đố có nguồn), rồi
 * bộ 2–4 món còn hàng do máy chủ chọn. Câu hỏi và kết quả lấy từ API (`/game/matcher`), logic bước ở app-core dùng chung với web. Chọn đáp án là
 * sang bước kế; quay lại giữ đáp án. Cờ `game.matcher_enabled` tắt thì nội dung trả 404 và màn chỉ báo đang tạm nghỉ.
 */
export default function MatcherFlow() {
  const phase = useAuthPhase();
  const location = useLocation();
  const navigate = useSmartNavigate();
  const contentQ = useQuery(matcherContentQuery(coreHttp));
  const [view, setView] = useState<View>({ kind: 'intro' });
  const [state, setState] = useState<MatcherState>(matcherStart);
  const [trivia, setTrivia] = useState<MatcherTrivia[]>([]);
  const startedAt = useRef(0);
  const submitting = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Đổi bước thì đưa tiêu điểm về câu mới: trình đọc màn hình đọc câu hỏi, bàn phím không kẹt ở nút đã biến mất.
  useEffect(() => {
    if (view.kind !== 'steps') return;
    rootRef.current?.querySelector<HTMLElement>('[data-matcher-focus]')?.focus({ preventScroll: true });
  }, [view.kind, state.index]);

  const content = contentQ.data;

  const start = () => {
    if (!content) return;
    const from = new URLSearchParams(location.search).get('from') ?? '';
    const entry: MatcherEntry = (MATCHER_ENTRIES as readonly string[]).includes(from) ? (from as MatcherEntry) : 'direct';
    startedAt.current = Date.now();
    setTrivia(pickMatcherTrivia(content.trivia, randomBytes(2).reduce((n, b) => n * 256 + b, 0)));
    setState(matcherStart());
    setView({ kind: 'steps' });
    trackEvent('matcher_started', 'miniapp', { entry });
  };

  const submit = async (s: MatcherState) => {
    if (!content || submitting.current) return;
    const answers = matcherAnswers(content.questions, s);
    if (!answers) return;
    submitting.current = true;
    setView({ kind: 'submitting' });
    try {
      const deviceId = phase === 'authenticated' ? miniDeviceId(browserStorage(), randomBytes) : undefined;
      const result = await postMatcherResult(coreHttp, { answers, ...(deviceId ? { deviceId } : {}) });
      trackEvent('matcher_completed', 'miniapp', { outcomeId: result.outcomeId, fallback: result.fallback, seconds: matcherSeconds(Date.now() - startedAt.current) });
      setView({ kind: 'result', result });
    } catch (err) {
      setView({ kind: 'failed', reason: classifyMatcherError(err) });
    } finally {
      submitting.current = false;
    }
  };

  const advance = (next: MatcherState) => {
    if (next === state) return;
    trackEvent('matcher_question_answered', 'miniapp', { index: state.index + 1 });
    setState(next);
    if (next.index >= MATCHER_FLOW_LENGTH) void submit(next);
  };

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
  let body: ReactNode;
  if (view.kind === 'result') {
    body = <MatcherResultView result={view.result} onAgain={again} />;
  } else if (loadFailure === 'disabled' || loadFailure === 'no_content' || (view.kind === 'failed' && view.reason !== 'network' && view.reason !== 'invalid')) {
    const reason = loadFailure ?? (view.kind === 'failed' ? view.reason : 'disabled');
    body = (
      <Panel id="matcher-off" text={matcherCopy(FAILURE_TEXT[reason])}>
        <button type="button" className="tubu-mg-link" onClick={() => navigate(GAME_PATH)}>
          {matcherCopy('error.home')}
        </button>
      </Panel>
    );
  } else if (loadFailure || view.kind === 'failed') {
    body = (
      <Panel
        id={loadFailure ? 'matcher-load-error' : 'matcher-result-error'}
        text={matcherCopy(loadFailure ? 'error.load' : FAILURE_TEXT[view.kind === 'failed' ? view.reason : 'network'])}
      >
        <Button fullWidth size="lg" onPress={loadFailure ? () => void contentQ.refetch() : retry}>
          {matcherCopy('error.retry')}
        </Button>
      </Panel>
    );
  } else if (view.kind === 'submitting') {
    body = <Panel id="matcher-submitting" text={matcherCopy('loading')} muted live />;
  } else if (view.kind === 'steps' && content) {
    const cur = matcherCurrent(state);
    let step: ReactNode = null;
    if (cur?.kind === 'trivia') {
      const t = trivia[cur.slot];
      step = t ? (
        <TriviaStep
          key={t.id}
          trivia={t}
          chosen={state.trivia[cur.slot]}
          onChoose={(i) => setState((s) => matcherChooseTrivia(s, i))}
          onNext={() => advance(matcherNext(content.questions, state))}
        />
      ) : null;
    } else if (cur) {
      const q = matcherQuestionAt(content.questions, state, cur.step);
      const picked = q ? state.answers[q.code] : undefined;
      step = q ? (
        <div className="tubu-mg-panel" data-testid={`matcher-question-${cur.step}`}>
          <Ask text={q.prompt} />
          <ul className="tubu-mg-options">
            {q.options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className="tubu-mg-option"
                  aria-pressed={picked === o.value}
                  onClick={() => advance(matcherAnswer(content.questions, state, o.value))}
                  data-value={o.value}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null;
    }
    body = (
      <>
        <StepBar index={state.index} onBack={() => (state.index === 0 ? setView({ kind: 'intro' }) : setState(matcherBack(state)))} />
        {step}
      </>
    );
  } else {
    body = (
      <Panel id="matcher-intro" text={matcherCopy('intro.sub')} muted>
        <Button fullWidth size="lg" loading={contentQ.isPending} onPress={start}>
          {matcherCopy('intro.start')}
        </Button>
      </Panel>
    );
  }

  return (
    <>
      <PageHeader title={gameCopy('game.matcher.title')} />
      <div ref={rootRef} className="tubu-mg-shell" data-testid="matcher" data-view={view.kind}>
        {body}
      </div>
    </>
  );
}
