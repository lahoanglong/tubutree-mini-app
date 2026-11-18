'use client';

import { useEffect, useRef, useState } from 'react';
import { MINI_GAME_RULES, type MiniKitchenSwap } from '@tubutree/shared-types';
import { BOARD_TICK_MS, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { kitchenDoneCount, kitchenIsLast, kitchenNext, kitchenStart, kitchenSwap, kitchenSwapped, type KitchenProgress } from '@tubutree/app-core/game-mini/kitchen';
import { kitchenCopy, kitchenCornerName } from '@tubutree/app-core/game-mini/kitchen-copy';
import { Button, Heading, Text } from '@/components/mini';
import './mini-kitchen-swap.css';

/**
 * Căn Bếp Xanh: 45 giây cho cả ván, 3 góc nhà (mỗi góc một món đang giấu vỏ nhựa dùng một lần hay chất tẩy mạnh). Ở mỗi món khách chạm 1 trong 3
 * sản phẩm Tubu để đổi; đổi xong là khoá, thẻ "Về sản phẩm này" hiện điều bao bì ghi (không nói đúng hay sai: máy chủ chấm lúc nộp), rồi "Góc
 * tiếp". Hết giờ thì nộp các món đã đổi, món chưa đổi là bỏ trống. Thẻ chọn chỉ có tên sản phẩm (ảnh sản phẩm chỉ qua bộ thẻ sản phẩm chung, ở
 * màn kết quả).
 */
export default function MiniKitchenSwapBoard({ content, onFinish, onStatus }: MiniBoardProps<{ swaps: MiniKitchenSwap[] }>) {
  const { swaps } = content;
  const [p, setP] = useState<KitchenProgress>(() => kitchenStart(swaps.length));
  const [startedAt] = useState(() => Date.now());
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;
  const sceneRef = useRef<HTMLDivElement>(null);
  const factRef = useRef<HTMLDivElement>(null);
  const limit = MINI_GAME_RULES.kitchen_swap.timeLimitMs;

  const finish = (answers: readonly (string | null)[]) => {
    if (finished.current) return;
    finished.current = true;
    onFinish([...answers]);
  };

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, startedAt + limit - Date.now());
      onStatus({ msLeft: left, done: kitchenDoneCount(latest.current), total: swaps.length });
      if (left <= 0) finish(latest.current.answers);
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- đồng hồ của cả ván chạy một lần từ lúc dựng
  }, [startedAt, onStatus]);

  // Góc mới: tiêu điểm về món để trình đọc màn hình đọc góc kế, bàn phím đi tiếp từ đầu góc.
  useEffect(() => {
    if (p.index > 0) sceneRef.current?.focus();
  }, [p.index]);

  // Đổi xong thì lựa chọn biến mất: tiêu điểm sang thẻ "Về sản phẩm này" để bàn phím đi tiếp tới "Góc tiếp" thay vì rơi về đầu trang.
  const swappedNow = (p.answers[p.index] ?? null) !== null;
  useEffect(() => {
    if (swappedNow) factRef.current?.focus();
  }, [swappedNow, p.index]);

  const swap = swaps[p.index];
  if (!swap) return null;

  const pick = (slug: string) => {
    if (finished.current) return;
    const next = kitchenSwap(latest.current, slug, swap.options.map((o) => o.product.slug));
    if (next === latest.current) return;
    latest.current = next;
    setP(next);
    onStatus({ msLeft: Math.max(0, startedAt + limit - Date.now()), done: kitchenDoneCount(next), total: swaps.length });
  };

  const advance = () => {
    if (finished.current) return;
    const cur = latest.current;
    if (!kitchenSwapped(cur)) return;
    if (kitchenIsLast(cur)) {
      finish(cur.answers);
      return;
    }
    const next = kitchenNext(cur);
    latest.current = next;
    setP(next);
  };

  const given = p.answers[p.index] ?? null;
  const chosen = given === null ? null : (swap.options.find((o) => o.product.slug === given) ?? null);
  const corner = kitchenCornerName(swap.corner);
  return (
    <div className="tubu-mg-panel" data-testid="mini-kitchen">
      <ol className="tubu-mg-kitchen-corners" aria-label={kitchenCopy('cornersAria')}>
        {swaps.map((s, i) => {
          const name = kitchenCornerName(s.corner);
          const done = p.answers[i] !== null;
          return (
            <li
              key={s.id}
              className="tubu-mg-kitchen-corner"
              data-state={done ? 'done' : i === p.index ? 'current' : 'todo'}
              aria-current={i === p.index ? 'step' : undefined}
              aria-label={kitchenCopy(done ? 'cornerDoneAria' : 'cornerTodoAria', { corner: name })}
              data-testid={`mini-kitchen-corner-${i}`}
            >
              <span className="tubu-mg-kitchen-corner-mark" aria-hidden>
                {done ? '✓' : i + 1}
              </span>
              <span className="tubu-mg-kitchen-corner-name" aria-hidden>
                {name}
              </span>
            </li>
          );
        })}
      </ol>

      <div ref={sceneRef} tabIndex={-1} className="tubu-mg-question tubu-mg-kitchen-scene" data-swapped={chosen ? 'true' : undefined} data-testid="mini-kitchen-scene">
        <span className="tubu-mg-chip" data-tone="brand">
          {kitchenCopy('corner.step', { n: p.index + 1, m: swaps.length })} · {corner}
        </span>
        <div className="tubu-mg-kitchen-item">
          {swap.emoji && (
            <span className="tubu-mg-kitchen-emoji" aria-hidden>
              {swap.emoji}
            </span>
          )}
          <Heading as="h2" variant="title-sm" font="ui" className="tubu-mg-kitchen-item-name" data-testid="mini-kitchen-item">
            {swap.item}
          </Heading>
        </div>
        <Text variant="body-sm" tone="secondary" as="p" data-testid="mini-kitchen-hidden">
          <strong>{kitchenCopy('hidden')}: </strong>
          {swap.hidden}
        </Text>
      </div>

      {chosen ? (
        <div ref={factRef} tabIndex={-1} className="tubu-mg-question tubu-mg-kitchen-fact" data-testid="mini-kitchen-fact">
          <Text variant="body-sm" as="p" style={{ fontWeight: 'var(--type-label-weight)' }} data-testid="mini-kitchen-swapped">
            {kitchenCopy('swapped', { name: chosen.product.name })}
          </Text>
          <Text variant="caption" tone="secondary" as="p">
            {kitchenCopy('label')}
          </Text>
          <Text variant="body-sm" as="p" data-testid="mini-kitchen-fact-text">
            {chosen.fact}
          </Text>
        </div>
      ) : (
        <>
          <Text variant="caption" tone="secondary" as="p">
            {kitchenCopy('pick')}
          </Text>
          <ul className="tubu-mg-options" aria-label={kitchenCopy('optionsAria', { item: swap.item })}>
            {swap.options.map((o, i) => (
              <li key={o.product.slug}>
                <button type="button" className="tubu-mg-option" data-testid={`mini-kitchen-option-${i}`} onClick={() => pick(o.product.slug)}>
                  <span>{o.product.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Button fullWidth size="lg" disabled={!chosen} onPress={advance}>
        {kitchenCopy(kitchenIsLast(p) ? 'finish' : 'next')}
      </Button>
    </div>
  );
}
