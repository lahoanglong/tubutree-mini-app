import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MINI_GAME_RULES, type MiniSortBin, type MiniSortItem } from '@tubutree/shared-types';
import {
  BOARD_TICK_MS,
  binUnderPoint,
  DRAG_SLOP_PX,
  sortBinsFor,
  sortDone,
  sortPlace,
  sortStart,
  type BinRect,
  type MiniBoardProps,
} from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { Text } from '../../ui/text';

interface Drag {
  pointerId: number;
  x0: number;
  y0: number;
  moved: boolean;
}

/**
 * Đúng Thùng: 45 giây, 10 món lần lượt. Hai cách chơi cùng lúc: kéo thẻ vào thùng (Pointer Events, `touch-action: none` chỉ trên thẻ nên
 * ngoài thẻ trang vẫn cuộn được), hoặc chạm thẻ rồi chạm thùng / chạm thẳng thùng (đường cho trình đọc màn hình và bàn phím). Thả ra ngoài
 * mọi thùng thì thẻ về chỗ. Chạm đúp thùng không bỏ hai món (`sortPlace` khoá theo chỉ số món và 300ms).
 */
export default function MiniSort({ content, onFinish, onStatus }: MiniBoardProps<{ bins: MiniSortBin[]; items: MiniSortItem[] }>) {
  const items = content.items;
  const bins = sortBinsFor(content.bins);
  const [p, setP] = useState(() => sortStart(items.length));
  const [startedAt] = useState(() => Date.now());
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [hover, setHover] = useState<MiniSortBin | null>(null);
  const [selected, setSelected] = useState(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const binEls = useRef(new Map<MiniSortBin, HTMLButtonElement>());
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;
  const item = items[p.index];

  const finish = (answers: (MiniSortBin | null)[]) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(answers);
  };

  useEffect(() => {
    if (sortDone(p)) finish(p.answers);
    // Chỉ chạy khi tiến độ đổi; `finish` tự khoá một lần.
  }, [p]);

  useEffect(() => {
    const limit = MINI_GAME_RULES.sort.timeLimitMs;
    const tick = () => {
      const left = Math.max(0, startedAt + limit - Date.now());
      onStatus({ msLeft: left, done: latest.current.index, total: items.length });
      if (left <= 0) finish(latest.current.answers);
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
    // Đồng hồ của cả ván chạy một lần từ lúc dựng.
  }, [startedAt, items.length, onStatus]);

  const place = (bin: MiniSortBin) => {
    if (finished.current) return;
    setP((cur) => sortPlace(cur, latest.current.index, bin, Date.now()));
    setSelected(false);
  };

  const rects = (): BinRect[] =>
    bins.flatMap((bin) => {
      const el = binEls.current.get(bin);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ bin, left: r.left, top: r.top, right: r.right, bottom: r.bottom }];
    });

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary || finished.current) return;
    // Chạm kéo trên điện thoại không bắn `click` sau khi thả: cử chỉ mới bắt đầu thì bỏ cờ chặn của lần kéo trước.
    suppressClick.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
    d.moved = true;
    setOffset({ dx, dy });
    setHover(binUnderPoint(rects(), e.clientX, e.clientY));
  };
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setOffset(null);
    setHover(null);
    if (!d.moved) return;
    // Kéo xong trình duyệt vẫn bắn `click` lên thẻ: bỏ cú đó để thẻ về chỗ không bị tính là chọn.
    suppressClick.current = true;
    if (cancelled) return;
    const bin = binUnderPoint(rects(), e.clientX, e.clientY);
    if (bin) place(bin);
  };

  if (!item) return null;
  return (
    <div className="tubu-mg-panel" data-testid="mini-sort">
      <div className="tubu-mg-stage">
        <button
          key={item.id}
          type="button"
          className="tubu-mg-card"
          data-testid="mini-sort-card"
          data-dragging={offset !== null}
          data-selected={selected}
          aria-pressed={selected}
          aria-label={gameCopy('sort.itemAria', { item: item.label })}
          style={offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            setSelected((s) => !s);
          }}
        >
          {item.emoji && (
            <span className="tubu-mg-emoji" aria-hidden>
              {item.emoji}
            </span>
          )}
          <Text variant="body-md" as="span" style={{ fontWeight: 'var(--type-label-weight)' }}>
            {item.label}
          </Text>
        </button>
        <Text variant="caption" tone="secondary" as="p">
          {gameCopy('sort.hint')}
        </Text>
      </div>
      <ul className="tubu-mg-bins" data-count={bins.length} aria-label={gameCopy('sort.binsAria')}>
        {bins.map((bin) => (
          <li key={bin}>
            <button
              type="button"
              ref={(el) => {
                if (el) binEls.current.set(bin, el);
                else binEls.current.delete(bin);
              }}
              className="tubu-mg-bin"
              data-bin={bin}
              data-hover={hover === bin}
              data-testid={`mini-sort-bin-${bin}`}
              aria-label={gameCopy('sort.binAria', { item: item.label, bin: gameCopy(`sort.bin.${bin}`) })}
              onClick={() => place(bin)}
            >
              <span aria-hidden>{gameCopy(`sort.bin.${bin}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
