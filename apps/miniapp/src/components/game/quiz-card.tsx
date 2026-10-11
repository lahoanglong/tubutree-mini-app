import { Box, Text, Button } from 'zmp-ui';
import type { AnswerResult, QuizItem } from '../../services/game-api';
import { formatDrops } from '../../utils/format';
import { GameCard } from './game-card';
import { categoryLabel, difficultyLabel } from './game-utils';

export type QuizReveal = AnswerResult & { quizId: string; choice: number };

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
    <GameCard title="🧠 Quiz Sống Xanh hôm nay">
      {currentQuiz ? (
        <>
          <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 6 }}>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
              {categoryLabel(currentQuiz.category)} · {difficultyLabel(currentQuiz.difficulty)}
              {quiz && quiz.length > 1 ? ` · Câu ${answeredCount + 1}/${quiz.length}` : ''}
            </Text>
            <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
              +{formatDrops(currentQuiz.waterReward)}
            </Text>
          </Box>
          <QuizBlock
            q={currentQuiz}
            reveal={reveal && reveal.quizId === currentQuiz.id ? reveal : null}
            onAnswer={(choice) => onAnswer(currentQuiz.id, choice)}
            pending={pending}
          />
          {reveal && reveal.quizId === currentQuiz.id && (
            <Box
              mt={3}
              p={3}
              style={{
                background: reveal.isCorrect ? 'var(--leaf-50)' : 'var(--warning-bg)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <Text size="small" bold style={{ color: reveal.isCorrect ? 'var(--leaf-700)' : 'var(--warning)' }}>
                {reveal.isCorrect ? `Chính xác! +${formatDrops(reveal.waterEarned)}` : 'Chưa đúng — cùng học nhé 🌿'}
              </Text>
              {reveal.explanation && (
                <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                  💡 Bạn có biết: {reveal.explanation}
                </Text>
              )}
              <Button fullWidth size="small" onClick={onNext} style={{ marginTop: 10, background: 'var(--leaf-600)' }}>
                {answeredCount + 1 >= (quiz?.length ?? 1) ? 'Hoàn thành' : 'Câu tiếp theo'}
              </Button>
            </Box>
          )}
        </>
      ) : (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          Bạn đã hoàn thành quiz hôm nay 🎉
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
    <Box>
      <Text size="small" style={{ marginBottom: 8 }}>
        {q.question}
      </Text>
      <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {q.options.map((opt, i) => {
          // Sau khi reveal: tô xanh đáp án đúng, tô đỏ lựa chọn sai của user.
          let bg: string | undefined;
          let color: string | undefined;
          if (reveal) {
            if (i === reveal.correct) {
              bg = 'var(--leaf-600)';
              color = 'var(--neutral-0)';
            } else if (i === reveal.choice) {
              bg = 'var(--danger-bg)';
              color = 'var(--danger)';
            }
          }
          return (
            <Button
              key={i}
              size="small"
              variant="secondary"
              disabled={pending || !!reveal}
              onClick={() => onAnswer(i)}
              style={bg ? { background: bg, color } : undefined}
            >
              {opt}
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}
