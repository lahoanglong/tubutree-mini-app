import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { homeQuizQuestions, pickKitProducts, type HomeQuizAnswers } from '@tubutree/app-core/arcade/home-quiz';
import { completeHomeQuiz, type HomeQuizResult } from '@tubutree/app-core/api/home-quiz';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { vi } from '../../i18n/vi';
import { coreHttp } from '../../services/core-http';
import { fetchProducts } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { ProductCard } from '../ui/product-card';
import { ProductTileSkeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';
import { useKitQuickAdd } from './use-kit-quick-add';
// Không import css/home-quiz.css: sheet chỉ được HomeQuizCard nạp lười và thẻ đã nạp CSS đó. Import ở đây làm chunk sheet import tĩnh chunk lười home-below,
// trái luật scripts/ci/mini-lazy-chunks.cjs.

/** Đủ rộng để món khớp từ khoá nằm ngoài top bán chạy vẫn lọt vào, vẫn là một request. */
const QUIZ_FETCH_LIMIT = 40;
const PRODUCTS_STALE_MS = 60_000;
const SKELETON_ROWS = [0, 1, 2];

type Claim = { status: 'idle' | 'saving' | 'saved' | 'error'; result?: HomeQuizResult };

export interface HomeQuizSheetProps {
  open: boolean;
  /** Khách thật đã đăng nhập (luật `useRealUser`, thẻ tính và truyền xuống). */
  real: boolean;
  onClose: () => void;
  /** Quà đã ghi xong (kể cả "đã nhận từ trước"): thẻ mời đổi dòng phụ và vá cache trạng thái dù Trang chủ không tải trạng thái mini game. */
  onClaimed?: () => void;
}

/**
 * Sheet ba câu của Chẩn đoán tổ ấm: chạm một đáp án là tự sang câu kế (có tiến độ "Câu 1/3" và nút Quay lại), xong thì tải sản phẩm đang bán thật và hiện 2–3 món
 * `pickKitProducts` chọn, mỗi món một chạm vào giỏ. Đã đăng nhập thì nhận quà Giọt nước đúng một lần (`completeHomeQuiz`); khách xem đủ kết quả và có nút đăng nhập,
 * đăng nhập xong thì quà tự được ghi.
 */
export function HomeQuizSheet({ open, real, onClose, onClaimed }: HomeQuizSheetProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useLoginWithNotice();
  const questions = useMemo(() => homeQuizQuestions(), []);
  const [answers, setAnswers] = useState<Partial<HomeQuizAnswers>>({});
  const [step, setStep] = useState(0);
  const [claim, setClaim] = useState<Claim>({ status: 'idle' });
  const claimStarted = useRef(false);
  const stepRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  const questionId = useId();
  const { add, picker } = useKitQuickAdd();

  const done = step >= questions.length;
  const complete = done ? (answers as HomeQuizAnswers) : null;

  const productsQ = useQuery({
    queryKey: ['products', 'home-quiz'],
    queryFn: () => fetchProducts({ limit: QUIZ_FETCH_LIMIT, sort: 'best_seller' }),
    enabled: open && done,
    staleTime: PRODUCTS_STALE_MS,
  });
  const picks = useMemo(() => (complete && productsQ.data ? pickKitProducts(complete, productsQ.data.data) : []), [complete, productsQ.data]);

  const claimGift = useCallback(
    (a: HomeQuizAnswers) => {
      setClaim({ status: 'saving' });
      completeHomeQuiz(coreHttp, a).then(
        (result) => {
          setClaim({ status: 'saved', result });
          onClaimed?.();
          // Số Giọt nước ở Vườn đổi theo quà này.
          void queryClient.invalidateQueries({ queryKey: ['game'] });
        },
        () => setClaim({ status: 'error' }),
      );
    },
    [queryClient, onClaimed],
  );
  // Một lần cho cả đời thẻ: vẽ lại, Strict Mode, mở lại hay làm lại bộ câu hỏi không gửi thêm (quà chỉ có một lần cho mỗi tài khoản); riêng sau lỗi thì "Làm lại"
  // mở khoá (xem `retake`). Khách (kể cả tài khoản khách theo thiết bị, máy chủ không phát quà cho họ) không gửi gì; đăng nhập thật xong ngay trên kết quả thì `real` đổi
  // và quà tự được ghi.
  useEffect(() => {
    if (!complete || !real || claimStarted.current) return;
    claimStarted.current = true;
    claimGift(complete);
  }, [complete, real, claimGift]);

  // Sang câu kế thì đưa focus về tiêu đề câu hỏi: nút vừa bấm đã biến mất, trình đọc màn hình cần nghe câu mới.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  const choose = (id: keyof HomeQuizAnswers, value: string) => {
    haptic('light');
    setAnswers((prev) => ({ ...prev, [id]: value }));
    // Tuyệt đối theo bước đang vẽ: hai cú chạm cùng nhịp vào một câu chỉ sang câu kế một lần.
    setStep(step + 1);
  };
  const retake = () => {
    setAnswers({});
    setStep(0);
    // Lần nhận quà vừa lỗi chưa tính: hoàn thành lần sau phải gửi lại. Đã gửi được (hay đang gửi) thì giữ nguyên, quà chỉ có một lần.
    if (claim.status === 'error') {
      claimStarted.current = false;
      setClaim({ status: 'idle' });
    }
  };
  const browse = () => {
    onClose();
    navigate('/browse');
  };

  const current = done ? null : questions[step]!;
  const granted = claim.status === 'saved' && claim.result && !claim.result.alreadyClaimed && claim.result.granted > 0 ? claim.result.granted : 0;
  const alreadyClaimed = claim.status === 'saved' && claim.result?.alreadyClaimed === true;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={fillCopy('homeQuiz.card.title')}
        footer={
          step > 0 ? (
            <Button variant="ghost" fullWidth onPress={done ? retake : () => setStep(step - 1)}>
              {fillCopy(done ? 'homeQuiz.result.retake' : 'homeQuiz.back')}
            </Button>
          ) : undefined
        }
      >
        {current ? (
          <div ref={stepRef} role="group" aria-labelledby={questionId} tabIndex={-1} className="tubu-hqz-body tubu-hqz-question" data-testid="home-quiz-step">
            <Text variant="caption" tone="secondary" numeric>
              {fillCopy('homeQuiz.step', { n: step + 1, m: questions.length })}
            </Text>
            <Heading as="h3" variant="title-sm" font="ui" id={questionId}>
              {current.title}
            </Heading>
            <ul className="tubu-hqz-options">
              {current.options.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    className="tubu-hqz-option tubu-press"
                    aria-pressed={answers[current.id] === option.value}
                    onClick={() => choose(current.id, option.value)}
                  >
                    <span aria-hidden className="tubu-hqz-emoji">
                      {option.emoji}
                    </span>
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="tubu-hqz-body" data-testid="home-quiz-result">
            <div aria-live="polite" className="tubu-hqz-body">
              <Heading as="h3" variant="title-sm" font="ui">
                {fillCopy('homeQuiz.result.title')}
              </Heading>
              {granted > 0 && (
                <Text variant="body-sm" tone="brand" as="p" numeric>
                  {fillCopy('homeQuiz.result.granted', { n: granted })}
                </Text>
              )}
              {alreadyClaimed && (
                <Text variant="body-sm" tone="secondary" as="p">
                  {fillCopy('homeQuiz.result.claimed')}
                </Text>
              )}
              {claim.status === 'error' && (
                <>
                  <Text variant="body-sm" tone="danger" as="p">
                    {fillCopy('homeQuiz.result.error')}
                  </Text>
                  <Button variant="secondary" onPress={() => complete && claimGift(complete)}>
                    {vi.common.retry}
                  </Button>
                </>
              )}
            </div>
            {!real && (
              <Button variant="secondary" onPress={() => login()}>
                {fillCopy('homeQuiz.result.guest')}
              </Button>
            )}
            {productsQ.isLoading && (
              <div className="tubu-hqz-list" aria-busy data-testid="home-quiz-loading">
                {SKELETON_ROWS.map((row) => (
                  <ProductTileSkeleton key={row} variant="line" />
                ))}
              </div>
            )}
            {productsQ.isError && (
              <ErrorState
                variant="inline"
                title={fillCopy('homeQuiz.card.title')}
                message={fillCopy('homeQuiz.result.loadError')}
                onRetry={() => productsQ.refetch()}
                retrying={productsQ.isFetching}
              />
            )}
            {productsQ.isSuccess && picks.length === 0 && (
              <EmptyState art="leaf" variant="inline" heading={fillCopy('homeQuiz.result.empty')} ctaLabel={fillCopy('homeQuiz.result.browse')} onCta={browse} />
            )}
            {picks.length > 0 && (
              <ul className="tubu-hqz-list" data-testid="home-quiz-picks">
                {picks.map((product) => (
                  <li key={product.id} className="tubu-hqz-pick">
                    <ProductCard product={product} variant="line" showWishlist={false} listSource="home_quiz" />
                    <Button variant="secondary" fullWidth onPress={() => add(product)}>
                      {fillCopy('homeQuiz.result.addAll')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </BottomSheet>
      {picker}
    </>
  );
}
