import { Brain, Lightbulb } from 'lucide-react';
import type { AnswerResult, QuizItem } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { Button } from '../ui/button';
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
}: {
  quiz: QuizItem[] | undefined;
  currentQuiz: QuizItem | undefined;
  answeredCount: number;
  reveal: QuizReveal | null;
  pending: boolean;
  onAnswer: (quizId: string, choice: number) => void;
  onNext: () => void;
}) {
  return (
    <GameCard title="Câu đố Sống Xanh hôm nay" icon={Brain}>
      {currentQuiz ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Text variant="caption" tone="tertiary">
              {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
              {quiz && quiz.length > 1 ? ` · Câu ${answeredCount + 1}/${quiz.length}` : ''}
            </Text>
            <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
              +{formatDrops(currentQuiz.waterReward)}
            </Text>
          </div>
          <QuizBlock
            q={currentQuiz}
            reveal={reveal && reveal.quizId === currentQuiz.id ? reveal : null}
            onAnswer={(choice) => onAnswer(currentQuiz.id, choice)}
            pending={pending}
          />
          {reveal && reveal.quizId === currentQuiz.id && (
            <div
              role="status"
              style={{
                marginTop: 12,
                padding: 12,
                background: reveal.isCorrect ? 'var(--color-bg-subtle)' : 'var(--color-status-warning-bg)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <Text variant="body-sm" tone={reveal.isCorrect ? 'brand' : 'warning'} as="div" style={{ fontWeight: 600 }}>
                {reveal.isCorrect ? `Chính xác! +${formatDrops(reveal.waterEarned)}` : 'Chưa đúng — cùng học nhé 🌿'}
              </Text>
              {reveal.explanation && (
                <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                  <Icon icon={Lightbulb} size="sm" tone="muted" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>Bạn có biết: {reveal.explanation}</span>
                </Text>
              )}
              <Button fullWidth onPress={onNext} style={{ marginTop: 10 }}>
                {answeredCount + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Text variant="body-sm" tone="tertiary" as="div">
          Bạn đã hoàn thành câu đố hôm nay 🎉
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
