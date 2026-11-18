import { useEffect, useRef, useState } from 'react';
import type { MiniChoiceItem } from '@tubutree/shared-types';
import { BOARD_TICK_MS, ORIGIN_TURN_MS, quizChoose, quizDone, quizNext, quizStart, quizTimeLeft, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { Button } from '../../ui/button';
import { Heading } from '../../ui/text';

/**
 * Đoán Xuất Xứ: 5 lượt, mỗi lượt 12 giây, chọn 1 trong 4 vùng (lưới nút 2×2, cao ≥ 56px) rồi bấm "Lượt tiếp"; hết giờ thì lượt được chốt với vùng
 * đang chọn. Lượt cuối là sản phẩm đang bán (máy chủ xếp), màn kết quả có thẻ sản phẩm đó. Bản đồ minh hoạ chỉ có ở web từ 1024px.
 */
export default function MiniOrigin({ content, onFinish, onStatus }: MiniBoardProps<{ items: MiniChoiceItem[] }>) {
  const items = content.items;
  const [p, setP] = useState(() => quizStart(items.length, Date.now()));
  const finished = useRef(false);
  const promptRef = useRef<HTMLDivElement>(null);
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
      const left = quizTimeLeft(p, Date.now(), ORIGIN_TURN_MS);
      onStatus({ msLeft: left, done: p.index, total: items.length });
      if (left <= 0) setP((cur) => (cur.index === p.index ? quizNext(cur, Date.now()) : cur));
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
  }, [p, items.length, onFinish, onStatus]);

  // Lượt mới: tiêu điểm về đề để trình đọc màn hình đọc lượt kế.
  useEffect(() => {
    if (p.index > 0) promptRef.current?.focus();
  }, [p.index]);

  if (!item) return null;
  const last = p.index === items.length - 1;
  return (
    <div className="tubu-mg-panel" data-testid="mini-origin">
      <div ref={promptRef} tabIndex={-1} className="tubu-mg-question tubu-mg-prompt">
        {item.product && (
          <span className="tubu-mg-chip" data-tone="brand">
            {gameCopy('origin.productTurn')}
          </span>
        )}
        <Heading as="h2" variant="title-sm" font="ui" data-testid="mini-origin-prompt">
          {item.prompt}
        </Heading>
      </div>
      <ul className="tubu-mg-grid" data-cols="2" aria-label={gameCopy('origin.optionsAria', { n: p.index + 1 })}>
        {item.options.map((opt, i) => (
          <li key={`${item.id}-${i}`}>
            <button
              type="button"
              className="tubu-mg-option"
              data-center="true"
              aria-pressed={p.chosen === i}
              data-testid={`mini-origin-option-${i}`}
              onClick={() => setP((cur) => quizChoose(cur, i, item.options.length))}
            >
              {opt}
            </button>
          </li>
        ))}
      </ul>
      <Button fullWidth size="lg" disabled={p.chosen === null} onPress={() => setP((cur) => quizNext(cur, Date.now()))}>
        {gameCopy(last ? 'quiz.finish' : 'origin.next')}
      </Button>
    </div>
  );
}
