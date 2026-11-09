import { useEffect, useRef } from 'react';
import { Brain, Lightbulb } from 'lucide-react';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type { AnswerResult, QuizItem } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
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

  // Khoá đồng bộ: `pending` chỉ đổi sau lần vẽ kế, hai cú chạm cùng nhịp vào đáp án sẽ gửi đáp án hai lần.
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Text variant="caption" tone="tertiary" numeric>
              {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
              {quiz && quiz.length > 1 ? ` · Câu ${answeredCount + 1}/${quiz.length}` : ''}
            </Text>
            <Text variant="caption" tone="brand" numeric style={{ fontWeight: 600 }}>
              +{formatDrops(currentQuiz.waterReward)}
            </Text>
          </div>
          <QuizBlock q={currentQuiz} reveal={shownReveal} onAnswer={answer} pending={pending} />
          {shownReveal && (
            <div
              role="status"
              style={{
                marginTop: 12,
                padding: 12,
                background: shownReveal.isCorrect ? 'var(--color-bg-subtle)' : 'var(--color-status-warning-bg)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <Text variant="body-sm" tone={shownReveal.isCorrect ? 'brand' : 'warning'} as="div" numeric style={{ fontWeight: 600 }}>
                {shownReveal.isCorrect ? `Chính xác! +${formatDrops(shownReveal.waterEarned)}` : 'Chưa đúng — cùng học nhé 🌿'}
              </Text>
              {shownReveal.explanation && (
                <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                  <Icon icon={Lightbulb} size="sm" tone="muted" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>Bạn có biết: {shownReveal.explanation}</span>
                </Text>
              )}
              <Button fullWidth onPress={next} style={{ marginTop: 10 }}>
                {answeredCount + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
              </Button>
            </div>
          )}
        </>
      ) : loadError && quiz === undefined ? (
        <ErrorState variant="inline" title={t.loadErrorTitle} message={t.loadErrorBody} onRetry={() => onRetry?.()} />
      ) : quiz === undefined ? (
        <div role="status">
          <Text variant="body-sm" tone="tertiary" as="div">
            {t.loading}
          </Text>
        </div>
      ) : (
        <Text variant="body-sm" tone="tertiary" as="div">
          {quiz.length > 0 || (answeredToday ?? 0) > 0 ? t.done : t.empty}
        </Text>
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
      <Text variant="body-sm" as="div" style={{ marginBottom: 8 }}>
        {q.question}
      </Text>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
        {q.options.map((opt, i) => {
          // Sau khi reveal: tô xanh đáp án đúng, tô đỏ lựa chọn sai của user.
          let tone: { background: string; color: string } | undefined;
          if (reveal) {
            if (i === reveal.correct) {
              tone = { background: 'var(--color-action-primary-bg)', color: 'var(--color-action-primary-fg)' };
            } else if (i === reveal.choice) {
              tone = { background: 'var(--color-status-danger-bg)', color: 'var(--color-status-danger-fg)' };
            }
          }
          return (
            <Button
              key={i}
              fullWidth
              variant="secondary"
              disabled={pending || !!reveal}
              aria-pressed={reveal ? i === reveal.choice : false}
              onPress={() => onAnswer(i)}
              // Đáp án dài phải xuống dòng thay vì bị cắt "…": ZaUI đặt height cố định + nowrap.
              style={{ height: 'auto', whiteSpace: 'normal', padding: '8px 12px', ...tone }}
            >
              {opt}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
