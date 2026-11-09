import { useEffect, useRef } from 'react';
import { Brain, Lightbulb } from 'lucide-react';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type { AnswerResult, QuizItem } from '@tubutree/app-core/api/game';
import { ui } from '@/lib/guest-ui';
import { ErrorState } from '@/components/ui/error-state';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatDrops } from './format';
import { GameCard } from './game-card';
import { categoryLabel, difficultyLabel } from './game-utils';

export type QuizReveal = AnswerResult & { quizId: string; choice: number };

// 🎉 và 🌿 trong lời nhắn kết quả là lời chúc (nội dung game); nhãn phân loại dùng emoji của game-utils.
export function QuizCard({
  quiz,
  currentQuiz,
  answeredCount,
  reveal,
  pending,
  onAnswer,
  onNext,
  loadError,
  onRetry,
  answeredToday,
}: {
  quiz: QuizItem[] | undefined;
  currentQuiz: QuizItem | undefined;
  answeredCount: number;
  reveal: QuizReveal | null;
  pending: boolean;
  onAnswer: (quizId: string, choice: number) => void;
  onNext: () => void;
  /** Tải câu đố lỗi: khác với "chưa có câu" và "đã làm xong". */
  loadError?: boolean;
  onRetry?: () => void;
  /** Số câu đã làm hôm nay (từ hồ sơ): danh sách câu rỗng mà đã làm ít nhất một câu = đã hoàn thành. */
  answeredToday?: number;
}) {
  const t = gameMoreCopy.quiz;
  const shownReveal = currentQuiz && reveal && reveal.quizId === currentQuiz.id ? reveal : null;
  const currentQuizId = currentQuiz?.id;
  const revealed = shownReveal !== null;

  // Khoá đồng bộ: `pending` chỉ đổi sau lần vẽ kế, hai cú bấm cùng nhịp vào đáp án sẽ gửi đáp án hai lần.
  // Nhả khi sang câu khác, hoặc khi lượt trả lời xong mà không ra đáp án (lỗi) để chọn lại được.
  // Dựa vào việc trang cha vẽ ra `pending=true` ít nhất một lần cho mỗi lượt gửi (isPending của mutation luôn vậy).
  const answeringQuizIdRef = useRef<string | null>(null);
  useEffect(() => {
    answeringQuizIdRef.current = null;
  }, [currentQuizId]);
  useEffect(() => {
    if (!pending && !revealed) answeringQuizIdRef.current = null;
  }, [pending, revealed]);
  const answer = (choice: number) => {
    if (!currentQuiz || pending || shownReveal || answeringQuizIdRef.current === currentQuiz.id) return;
    answeringQuizIdRef.current = currentQuiz.id;
    onAnswer(currentQuiz.id, choice);
  };
  // Cùng lý do cho "Câu tiếp theo"/"Hoàn thành": mỗi đáp án (mỗi đối tượng reveal, trang cha tạo mới sau mỗi lượt
  // trả lời) chỉ sang câu kế một lần. Dựa vào việc trang cha xoá `reveal` khi gọi onNext (nextQuiz ở cả hai trang làm vậy).
  const nextedRevealRef = useRef<QuizReveal | null>(null);
  const next = () => {
    if (!shownReveal || nextedRevealRef.current === shownReveal) return;
    nextedRevealRef.current = shownReveal;
    onNext();
  };

  return (
    <GameCard title="Câu đố Sống Xanh hôm nay" icon={Brain}>
      {currentQuiz ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-caption tabular-nums text-stone-600">
              {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
              {quiz && quiz.length > 1 ? ` · Câu ${answeredCount + 1}/${quiz.length}` : ''}
            </span>
            <span className="text-caption font-semibold tabular-nums text-forest-700">+{formatDrops(currentQuiz.waterReward)}</span>
          </div>
          <QuizBlock q={currentQuiz} reveal={shownReveal} onAnswer={answer} pending={pending} />
          {shownReveal && (
            <div role="status" className={`mt-3 rounded-control p-3 ${shownReveal.isCorrect ? 'bg-forest-50' : 'bg-warning-bg'}`}>
              <div className={`text-sm font-semibold tabular-nums ${shownReveal.isCorrect ? 'text-forest-700' : 'text-warning-fg'}`}>
                {shownReveal.isCorrect ? `Chính xác! +${formatDrops(shownReveal.waterEarned)}` : 'Chưa đúng — cùng học nhé 🌿'}
              </div>
              {shownReveal.explanation && (
                <div className="mt-1 flex gap-1.5 text-caption text-stone-700">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
                  <span>Bạn có biết: {shownReveal.explanation}</span>
                </div>
              )}
              <button type="button" onClick={next} className={`${ui.btnPrimary} mt-2.5 w-full`}>
                {answeredCount + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
              </button>
            </div>
          )}
        </>
      ) : loadError && quiz === undefined ? (
        <ErrorState variant="inline" title={t.loadErrorTitle} message={t.loadErrorBody} onRetry={() => onRetry?.()} />
      ) : quiz === undefined ? (
        <p role="status" className="text-sm text-stone-600">
          {t.loading}
        </p>
      ) : (
        <p className="text-sm text-stone-600">{quiz.length > 0 || (answeredToday ?? 0) > 0 ? t.done : t.empty}</p>
      )}
    </GameCard>
  );
}

function QuizBlock({
  q,
  reveal,
  onAnswer,
  pending,
}: {
  q: { question: string; options: string[] };
  reveal: (AnswerResult & { choice: number }) | null;
  onAnswer: (choice: number) => void;
  pending: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-stone-900">{q.question}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((opt, i) => {
          // Sau khi reveal: tô xanh đáp án đúng, tô đỏ lựa chọn sai của khách.
          let tone = '';
          if (reveal) {
            if (i === reveal.correct) tone = '!border-forest-600 !bg-forest-600 !text-stone-0';
            else if (i === reveal.choice) tone = '!border-danger-fg !bg-danger-bg !text-danger-fg';
          }
          return (
            <button
              key={i}
              type="button"
              disabled={pending || !!reveal}
              aria-pressed={reveal ? i === reveal.choice : false}
              onClick={() => onAnswer(i)}
              // Đáp án dài phải xuống dòng thay vì bị cắt.
              className={`${miniBtnSecondary} h-auto whitespace-normal py-2 ${tone}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
