import { useEffect, useRef, useState } from 'react';
import { MINI_BASKET_PICK, MINI_GAME_RULES, type MiniBasketTask } from '@tubutree/shared-types';
import { BOARD_TICK_MS, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { basketFull, basketReady, basketToggle } from '@tubutree/app-core/game-mini/basket-board';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { Button } from '../../ui/button';
import { Heading, Text } from '../../ui/text';

/**
 * Giỏ Đúng Việc: 45 giây, một đề (một việc nhà), 6 sản phẩm thật, chọn đúng 3 rồi bấm "Xong" (đổi ý được tới lúc bấm; món thứ tư không chọn
 * được). Hết giờ thì nộp các món đang chọn. Thẻ chọn chỉ có tên sản phẩm: ảnh sản phẩm chỉ được vẽ qua bộ thẻ sản phẩm chung, mà thẻ đó là liên
 * kết sang trang sản phẩm (rời ván); màn kết quả hiện bộ đúng bằng thẻ sản phẩm có ảnh và giá.
 */
export default function MiniBasket({ content, onFinish, onStatus }: MiniBoardProps<{ task: MiniBasketTask }>) {
  const { task } = content;
  const slugs = task.products.map((p) => p.slug);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [startedAt] = useState(() => Date.now());
  const [fullHint, setFullHint] = useState(false);
  const finished = useRef(false);
  const latest = useRef(picked);
  latest.current = picked;

  const finish = (answers: readonly string[]) => {
    if (finished.current) return;
    finished.current = true;
    onFinish([...answers]);
  };

  useEffect(() => {
    const limit = MINI_GAME_RULES.basket.timeLimitMs;
    const tick = () => {
      const left = Math.max(0, startedAt + limit - Date.now());
      onStatus({ msLeft: left, done: latest.current.length, total: MINI_BASKET_PICK });
      if (left <= 0) finish(latest.current);
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
    // Đồng hồ của cả ván chạy một lần từ lúc dựng.
  }, [startedAt, onStatus]);

  const toggle = (slug: string) => {
    if (finished.current) return;
    const cur = latest.current;
    const next = basketToggle(cur, slug, slugs);
    setFullHint(next === cur && !cur.includes(slug) && basketFull(cur));
    if (next === cur) return;
    latest.current = next;
    setPicked(next);
    onStatus({ msLeft: Math.max(0, startedAt + MINI_GAME_RULES.basket.timeLimitMs - Date.now()), done: next.length, total: MINI_BASKET_PICK });
  };

  const full = basketFull(picked);
  return (
    <div className="tubu-mg-panel" data-testid="mini-basket">
      <Heading as="h2" variant="title-sm" font="ui" data-testid="mini-basket-task">
        {task.task}
      </Heading>
      <ul className="tubu-mg-grid" data-cols="2" aria-label={gameCopy('basket.gridAria')}>
        {task.products.map((p, i) => {
          const on = picked.includes(p.slug);
          return (
            <li key={p.slug}>
              <button
                type="button"
                className="tubu-mg-tile"
                data-state={on ? 'selected' : 'idle'}
                data-testid={`mini-basket-item-${i}`}
                aria-pressed={on}
                aria-disabled={!on && full ? true : undefined}
                onClick={() => toggle(p.slug)}
              >
                <span className="tubu-mg-tile-check" aria-hidden>
                  {on ? '✓' : ''}
                </span>
                <span className="tubu-mg-tile-label">{p.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Text variant="caption" tone="secondary" as="p" className="tubu-mg-hint" aria-live="polite" data-testid="mini-basket-hint">
        {fullHint ? gameCopy('basket.full') : ''}
      </Text>
      <Button fullWidth size="lg" disabled={!basketReady(picked)} onPress={() => finish(latest.current)}>
        {gameCopy('basket.done')}
      </Button>
    </div>
  );
}
