import { Brain, Lightbulb } from 'lucide-react';
import {  } from '@tubutree/app-core/game-newbie';
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
}) {
  const t = gameMoreCopy.quiz;
  const shownReveal = currentQuiz && reveal && reveal.quizId === currentQuiz.id ? reveal : null;
  return (
    <GameCard title="Câu đố Sống Xanh hôm nay" icon={Brain}>
      {currentQuiz ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-caption text-stone-600">
              {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
              {quiz && quiz.length > 1 ? ` · Câu ${answeredCount + 1}/${quiz.length}` : ''}
            </span>
            <span className="text-caption font-semibold text-forest-700">+{formatDrops(currentQuiz.waterReward)}</span>
          </div>
          <QuizBlock q={currentQuiz} reveal={shownReveal} onAnswer={(choice) => onAnswer(currentQuiz.id, choice)} pending={pending} />
          {shownReveal && (
            <div role="status" className={`mt-3 rounded-control p-3 ${shownReveal.isCorrect ? 'bg-forest-50' : 'bg-warning-bg'}`}>
              <div className={`text-sm font-semibold ${shownReveal.isCorrect ? 'text-forest-700' : 'text-warning-fg'}`}>
                {shownReveal.isCorrect ? `Chính xác! +${formatDrops(shownReveal.waterEarned)}` : 'Chưa đúng — cùng học nhé 🌿'}
              </div>
              {shownReveal.explanation && (
                <div className="mt-1 flex gap-1.5 text-caption text-stone-700">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
                  <span>Bạn có biết: {shownReveal.explanation}</span>
                </div>
              )}
              <button type="button" onClick={onNext} className={`${ui.btnPrimary} mt-2.5 w-full`}>
                {answeredCount + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
              </button>
            </div>
          )}
        </>
      ) : loadError && quiz === undefined ? (
        <ErrorState variant="inline" title={t.loadErrorTitle} message={t.loadErrorBody} onRetry={() => onRetry?.()} />
      ) : (
        <p className="text-sm text-stone-600">{quiz && quiz.length > 0 ? t.done : t.empty}</p>
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
