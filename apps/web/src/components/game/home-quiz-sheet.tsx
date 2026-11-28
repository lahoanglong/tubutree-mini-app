'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProducts, type ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { completeHomeQuiz, type HomeQuizResult } from '@tubutree/app-core/api/game';
import { homeQuizQuestions, pickKitProducts, type HomeQuizAnswers } from '@tubutree/app-core/arcade/home-quiz';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { guestQuickAddLogin, useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { Button, Heading, ProductCard, ProductTileSkeleton, Text } from '@/components/mini';
import { Sheet } from '@/components/ui/sheet';

const KIT_LIMIT = 40;
const KIT_SHOWN = 3;
const KIT_SKELETONS = [0, 1, 2] as const;
const STALE = 60_000;
export const HOME_QUIZ_KEY = ['products', 'home-quiz'] as const;

const currentPath = () => `${window.location.pathname}${window.location.search}`;

type ClaimState = 'idle' | 'saving' | 'error';

export interface HomeQuizSheetProps {
  onClose: () => void;
  /** Quà đã nhận (một lần mỗi tài khoản, kể cả khi máy chủ đã báo từ trước): giữ ở thẻ để mở lại sheet không gọi máy chủ lần nữa. */
  claimed: HomeQuizResult | null;
  onClaimed: (result: HomeQuizResult) => void;
}

/**
 * Sheet ba câu của Chẩn đoán tổ ấm: chạm một đáp án là sang câu kế (có "Câu n/3" và Quay lại), xong thì tải danh sách đang bán, `pickKitProducts`
 * chọn 2-3 món và vẽ bằng `ProductCard` biến thể `line` kèm "+ Thêm vào giỏ" một chạm (đường giỏ nhanh dùng chung, thông báo vẽ trong sheet vì
 * thông báo nổi nằm dưới sheet). Đã đăng nhập: gọi `completeHomeQuiz` đúng một lần khi xong ba câu; khách thấy đủ kết quả và lối đăng nhập.
 * Chỉ dựng khi sheet mở nên không có request nào trước đó.
 */
export function HomeQuizSheet({ onClose, claimed, onClaimed }: HomeQuizSheetProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const authed = useAuthPhase() === 'authenticated';
  const questions = useMemo(() => homeQuizQuestions(), []);
  const [answers, setAnswers] = useState<Partial<HomeQuizAnswers>>({});
  const [stage, setStage] = useState(0);
  const done = stage >= questions.length;
  const guest = useMemo(() => ({ login: guestQuickAddLogin(router) }), [router]);
  const quick = useQuickAdd(undefined, HOME_QUIZ_KEY, { inlineNotice: true, guest });

  const products = useQuery({
    queryKey: HOME_QUIZ_KEY,
    queryFn: () => fetchProducts(coreHttp, { limit: KIT_LIMIT, sort: 'best_seller' }),
    enabled: done,
    staleTime: STALE,
  });
  const kit = useMemo(
    () => (done && products.data ? pickKitProducts(answers as HomeQuizAnswers, products.data.data, KIT_SHOWN) : []),
    [done, products.data, answers],
  );

  const [claim, setClaim] = useState<ClaimState>('idle');
  const claiming = useRef(false);
  const claimedRef = useRef(claimed);
  claimedRef.current = claimed;
  const submitClaim = async () => {
    if (claiming.current || claimedRef.current) return;
    claiming.current = true;
    setClaim('saving');
    try {
      const result = await completeHomeQuiz(coreHttp, answers as HomeQuizAnswers);
      onClaimed(result);
      setClaim('idle');
      if (result.granted > 0) void qc.invalidateQueries({ queryKey: ['game'] });
    } catch {
      setClaim('error');
    } finally {
      claiming.current = false;
    }
  };
  const submitRef = useRef(submitClaim);
  submitRef.current = submitClaim;
  useEffect(() => {
    if (done && authed) void submitRef.current();
  }, [done, authed]);

  const choose = (id: keyof HomeQuizAnswers, value: string, from: number) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    // Hai cú chạm sát nhau cùng đọc `from` cũ: chỉ cú đầu được sang câu kế, không nhảy qua một câu.
    setStage((s) => (s === from ? s + 1 : s));
  };
  const restart = () => {
    setAnswers({});
    setStage(0);
  };

  // Như Reel Trang chủ: khách chưa đăng nhập cũng đi qua `quickAdd` (cờ giỏ khách bật thì vào giỏ trình duyệt, nhiều phân loại mở bảng chọn; tắt thì nhớ món rồi sang đăng nhập).
  const add = (p: ProductCardData) => quick.quickAdd(p);

  const question = questions[stage];
  // Lần đầu có quà thì nói số Giọt nước; đã nhận từ trước thì chỉ một dòng nói vậy (không khoe lại).
  const reward = claimed && claimed.granted > 0 ? fillCopy('homeQuiz.result.granted', { n: claimed.granted }) : '';
  const alreadyClaimed = claimed?.alreadyClaimed === true && !reward ? fillCopy('homeQuiz.result.claimed') : '';
  return (
    <Sheet open onClose={onClose} title={fillCopy('homeQuiz.card.title')}>
      {question ? (
        <div data-testid="home-quiz-question" className="flex flex-col gap-3">
          <Text variant="caption" tone="tertiary" as="p" numeric>
            {fillCopy('homeQuiz.step', { n: stage + 1, m: questions.length })}
          </Text>
          <Heading variant="title-sm" font="ui" as="h3" id={`home-quiz-q-${question.id}`}>
            {question.title}
          </Heading>
          <div role="group" aria-labelledby={`home-quiz-q-${question.id}`} className="flex flex-col gap-2">
            {question.options.map((o) => (
              <Button
                key={o.value}
                fullWidth
                variant={answers[question.id] === o.value ? 'primary' : 'secondary'}
                aria-pressed={answers[question.id] === o.value}
                onPress={() => choose(question.id, o.value, stage)}
              >
                <span aria-hidden="true">{o.emoji}</span> {o.label}
              </Button>
            ))}
          </div>
          {stage > 0 && (
            <div>
              <Button variant="ghost" onPress={() => setStage((s) => Math.max(0, s - 1))}>
                {fillCopy('homeQuiz.back')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div data-testid="home-quiz-result" className="flex flex-col gap-3">
          <Heading variant="title-sm" font="ui" as="h3">
            {fillCopy('homeQuiz.result.title')}
          </Heading>

          {products.isLoading && (
            <div data-testid="home-quiz-loading" aria-busy="true" className="flex flex-col gap-2">
              {KIT_SKELETONS.map((i) => (
                <ProductTileSkeleton key={i} variant="line" />
              ))}
            </div>
          )}
          {products.isError && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <Text variant="body-sm" tone="danger" as="p">
                {loadErrorText(products.error)}
              </Text>
              <Button variant="secondary" onPress={() => void products.refetch()}>
                {gameNewbieCopy.loadError.retry}
              </Button>
            </div>
          )}
          {products.isSuccess && kit.length === 0 && (
            <div data-testid="home-quiz-empty" className="flex flex-col items-start gap-2">
              <Text variant="body-sm" tone="secondary" as="p">
                {fillCopy('homeQuiz.result.empty')}
              </Text>
              <Button
                variant="secondary"
                onPress={() => {
                  onClose();
                  router.push('/san-pham');
                }}
              >
                {fillCopy('homeQuiz.result.shop')}
              </Button>
            </div>
          )}
          {kit.length > 0 && (
            // Thẻ `line` chỉ còn ảnh, tên (tối đa 2 dòng) và giá trên cả hàng; nút thêm giỏ ở hàng riêng bên dưới, rộng hết hàng. Để nút trong thẻ thì ở sheet 360px
            // nó chiếm gần nửa hàng, tên bị cắt còn một nửa và giá gạch thành vệt.
            <ul data-testid="home-quiz-kit" className="m-0 flex list-none flex-col gap-3 p-0">
              {kit.map((p) => (
                <li key={p.id} className="flex flex-col gap-2">
                  <ProductCard product={p} variant="line" />
                  <Button
                    fullWidth
                    variant="secondary"
                    loading={quick.busyId === p.id}
                    aria-label={`${fillCopy('homeQuiz.result.addAll')}: ${p.name}`}
                    onPress={() => void add(p)}
                  >
                    {fillCopy('homeQuiz.result.addAll')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div role="status" className="flex flex-col gap-2">
            {quick.notice && (
              <div className="flex flex-wrap items-center gap-x-3">
                <Text variant="body-sm" tone={quick.notice.ok ? 'success' : 'danger'} as="p">
                  {quick.notice.text}
                </Text>
                {quick.notice.ok && (
                  <Link href="/gio-hang" className={ui.btnText}>
                    {fillCopy('homeQuiz.result.cart')}
                  </Link>
                )}
              </div>
            )}
            {reward && (
              <Text variant="body-sm" tone="brand" as="p" numeric>
                {reward}
              </Text>
            )}
            {alreadyClaimed && (
              <Text variant="body-sm" tone="secondary" as="p">
                {alreadyClaimed}
              </Text>
            )}
          </div>

          {authed && claim === 'error' && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <Text variant="body-sm" tone="danger" as="p">
                {fillCopy('homeQuiz.result.error')}
              </Text>
              <Button variant="secondary" onPress={() => void submitClaim()}>
                {gameNewbieCopy.loadError.retry}
              </Button>
            </div>
          )}
          {!authed && (
            <Link href={loginHref(currentPath())} className={`${ui.btnPrimary} py-2 text-center`}>
              {fillCopy('homeQuiz.result.guest')}
            </Link>
          )}
          <div>
            <Button variant="ghost" onPress={restart}>
              {fillCopy('homeQuiz.result.retake')}
            </Button>
          </div>
        </div>
      )}
      {quick.feedback}
    </Sheet>
  );
}
