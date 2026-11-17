import { useEffect, useRef, useState } from 'react';
import type { MiniChoiceItem } from '@tubutree/shared-types';
import { BOARD_TICK_MS, QUIZ_LETTERS, quizChoose, quizDone, quizNext, quizStart, quizTimeLeft, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { Button } from '../../ui/button';
import { Heading } from '../../ui/text';

/**
 * Đố Xanh Mỗi Ngày: 3 câu, mỗi câu 20 giây, 4 lựa chọn cao ≥ 48px. Chọn rồi bấm "Câu tiếp" (đổi được tới lúc bấm); hết giờ thì câu được chốt
 * với lựa chọn đang đánh dấu. Máy chủ giữ đáp án nên đúng/sai và "Vì sao" hiện ở màn kết quả.
 */
export default function MiniDailyQuiz({ content, onFinish, onStatus }: MiniBoardProps<{ items: MiniChoiceItem[] }>) {
  const items = content.items;
  const [p, setP] = useState(() => quizStart(items.length, Date.now()));
  const finished = useRef(false);
  const questionRef = useRef<HTMLDivElement>(null);
  const item = items[p.index];

  useEffect(() => {
    if (quizDone(p)) {
      if (!finished.current) {
        finished.current = true;
        onFinish(p.answers);
      }
      return;
    }
    const tick = () => {
      const left = quizTimeLeft(p, Date.now());
      onStatus({ msLeft: left, done: p.index, total: items.length });
      if (left <= 0) setP((cur) => (cur.index === p.index ? quizNext(cur, Date.now()) : cur));
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
  }, [p, items.length, onFinish, onStatus]);

  // Câu mới: đưa tiêu điểm về câu hỏi để trình đọc màn hình đọc câu kế, bàn phím đi tiếp từ đầu câu.
  useEffect(() => {
    if (p.index > 0) questionRef.current?.focus();
  }, [p.index]);

  if (!item) return null;
  const last = p.index === items.length - 1;
  return (
    <div className="tubu-mg-panel" data-testid="mini-quiz">
      <div ref={questionRef} tabIndex={-1} className="tubu-mg-question">
        <Heading as="h2" variant="title-sm" font="ui" data-testid="mini-quiz-prompt">
          {item.prompt}
        </Heading>
      </div>
      <ul className="tubu-mg-options" aria-label={gameCopy('quiz.optionsAria', { n: p.index + 1 })}>
        {item.options.map((opt, i) => (
          <li key={`${item.id}-${i}`}>
            <button
              type="button"
              className="tubu-mg-option"
              aria-pressed={p.chosen === i}
              data-testid={`mini-quiz-option-${i}`}
              onClick={() => setP((cur) => quizChoose(cur, i, item.options.length))}
            >
              <span className="tubu-mg-letter" aria-hidden>
                {QUIZ_LETTERS[i]}.
              </span>
              <span>{opt}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button fullWidth size="lg" disabled={p.chosen === null} onPress={() => setP((cur) => quizNext(cur, Date.now()))}>
        {gameCopy(last ? 'quiz.finish' : 'quiz.next')}
      </Button>
    </div>
  );
}
