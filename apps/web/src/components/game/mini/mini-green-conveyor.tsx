'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Leaf, Recycle, RefreshCw, type LucideIcon } from 'lucide-react';
import { CONVEYOR_GOLDEN_BONUS, CONVEYOR_MAX_MULTIPLIER, conveyorEncode, conveyorMultiplier, type MiniConveyorBin, type MiniConveyorItem } from '@tubutree/shared-types';
import { type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import { CONVEYOR_ART, GOLDEN_DROP_ART } from '@tubutree/app-core/game-mini/arcade-art';
import {
  CONVEYOR_ROUND_MS,
  beltAnswers,
  beltDone,
  beltFront,
  beltResolved,
  beltSort,
  beltStart,
  beltTick,
  conveyorSchedule,
  conveyorSwipeBin,
  type BeltEvent,
  type BeltState,
} from '@tubutree/app-core/game-mini/conveyor';
import { Icon, Text } from '@/components/mini';
import { arcadeHaptic } from './arcade-platform';
import { useArcadeSound, useSwipe, useWindowKeys } from './mini-arcade-hooks';
import { ArcadeArt, SoundToggle } from './mini-arcade-ui';
import './mini-arcade.css';

type ConveyorContent = { seed: number; bins: MiniConveyorBin[]; items: MiniConveyorItem[] };

const BIN_ICON: Record<MiniConveyorBin, LucideIcon> = { recycle: Recycle, organic: Leaf, refill: RefreshCw };
const BIN_KEY: Record<string, MiniConveyorBin> = { ArrowLeft: 'recycle', ArrowDown: 'organic', ArrowRight: 'refill' };
const binForKey = (key: string): MiniConveyorBin | null => BIN_KEY[key] ?? null;
/** Nhịp vẽ lại React (vị trí món chạy bằng hoạt ảnh CSS, không cần vẽ mỗi khung hình). */
const RENDER_MS = 50;
const STATUS_MS = 250;
/** Món đã xử lý còn hiện chừng này để bay vào thùng hoặc mờ đi (vẫn trôi theo băng trong lúc đó). */
const EXIT_MS = 420;
const FLASH_MS = 300;

const leveledUp = (combo: number) => conveyorMultiplier(combo) > conveyorMultiplier(combo - 1);

/**
 * Băng Chuyền Xanh: 24 món trôi xuống 3 thùng trong 30 giây, nhanh dần. Vuốt trái/xuống/phải trên băng, chạm thẳng thùng, hoặc phím mũi tên;
 * lệnh luôn áp cho món đầu băng. Món trôi bằng hoạt ảnh CSS (`transform`) đặt theo lịch, React chỉ vẽ lại vài chục lần mỗi giây để thêm
 * món mới và hiệu ứng. Đúng liền tay tăng nhân điểm (x2 → x5), món vàng +5; sai hay để trôi thì rung màn và mất chuỗi.
 */
export default function MiniGreenConveyor({ content, onFinish, onStatus }: MiniBoardProps<ConveyorContent>) {
  const items = content.items;
  const schedule = useMemo(() => conveyorSchedule(items.length), [items.length]);
  const [belt, setBelt] = useState<BeltState>(() => beltStart(items.length));
  const beltRef = useRef(belt);
  const [clock, setClock] = useState(0);
  const startRef = useRef<number | null>(null);
  const sound = useArcadeSound();
  const synth = sound.synth;
  const finished = useRef(false);
  /** Độ trễ hoạt ảnh của từng món, chốt một lần lúc món lên băng: đổi `animation-delay` khi hoạt ảnh đang chạy sẽ làm món nhảy cóc. */
  const laneDelay = useRef(new Map<number, number>());

  const elapsed = () => (startRef.current === null ? 0 : performance.now() - startRef.current);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish([conveyorEncode(beltAnswers(beltRef.current))]);
  }, [onFinish]);

  const commit = useCallback(
    (next: BeltState) => {
      const prev = beltRef.current;
      if (next === prev) return;
      beltRef.current = next;
      setBelt(next);
      for (const ev of next.events) {
        if (prev.events.includes(ev)) continue;
        if (ev.kind === 'right') {
          synth.play(ev.golden ? 'golden' : leveledUp(ev.combo) ? 'combo' : 'right');
          arcadeHaptic(ev.golden || leveledUp(ev.combo) ? 'combo' : 'tap');
        } else {
          synth.play('wrong');
          arcadeHaptic('wrong');
        }
      }
    },
    [synth],
  );

  useEffect(() => {
    let raf = 0;
    let lastRender = -Infinity;
    let lastStatus = -Infinity;
    startRef.current = performance.now();
    const status = (t: number) => onStatus({ msLeft: Math.max(0, CONVEYOR_ROUND_MS - t), done: beltResolved(beltRef.current), total: items.length });
    const frame = () => {
      const t = elapsed();
      commit(beltTick(beltRef.current, items, schedule, t));
      if (t - lastRender >= RENDER_MS) {
        lastRender = t;
        setClock(t);
      }
      if (t - lastStatus >= STATUS_MS) {
        lastStatus = t;
        status(t);
      }
      if (beltDone(beltRef.current, t)) {
        status(t);
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- một vòng lặp cho cả ván, dựng một lần
  }, []);

  const sortInto = (bin: MiniConveyorBin) => {
    if (finished.current) return;
    commit(beltSort(beltRef.current, items, schedule, bin, elapsed()));
  };
  useWindowKeys(binForKey, sortInto);
  const swipe = useSwipe((dir) => {
    const bin = conveyorSwipeBin(dir);
    if (bin) sortInto(bin);
  });

  const front = beltFront(belt, schedule, clock);
  const frontItem = front === null ? null : items[front];
  const exits = new Map<number, BeltEvent>(belt.events.filter((ev) => clock - ev.at < EXIT_MS).map((ev) => [ev.index, ev]));
  const last = belt.events[belt.events.length - 1] ?? null;
  const flash = last && clock - last.at < FLASH_MS ? last : null;
  // Hai tên hoạt ảnh luân phiên để lần rung sau chạy lại ngay cả khi lần trước chưa tắt.
  const shake = flash && flash.kind !== 'right' ? (belt.tally.wrong + belt.tally.missed) % 2 === 0 ? 'a' : 'b' : undefined;
  const mult = conveyorMultiplier(belt.tally.combo);
  const recent = last && clock - last.at < EXIT_MS ? last : null;
  const burst = recent && recent.kind === 'right' && (recent.golden || leveledUp(recent.combo)) ? recent : null;

  return (
    <div className="tubu-mg-panel tubu-ar-conveyor" data-testid="mini-green-conveyor" data-shake={shake}>
      <div className="tubu-ar-hud">
        <div className="tubu-ar-stat">
          <Text variant="caption" tone="secondary" as="span">
            {arcadeCopy('conveyor.score')}
          </Text>
          <Text variant="label" as="span" numeric data-testid="conveyor-score">
            {belt.tally.score}
          </Text>
        </div>
        <div className="tubu-ar-combo" data-mult={mult} role="img" aria-label={arcadeCopy('conveyor.comboAria', { n: mult, c: belt.tally.combo })} data-testid="conveyor-combo">
          <span className="tubu-ar-combo-flame" aria-hidden>
            <Icon icon={mult >= 3 ? Flame : Leaf} size="sm" tone="current" />
          </span>
          <span className="tubu-ar-combo-bar" aria-hidden>
            {Array.from({ length: CONVEYOR_MAX_MULTIPLIER }, (_, i) => (
              <span key={i} className="tubu-ar-combo-seg" data-on={i < mult} />
            ))}
          </span>
          <span className="tubu-ar-combo-label" aria-hidden>
            {arcadeCopy('conveyor.combo', { n: mult })}
          </span>
        </div>
        <SoundToggle on={sound.on} onToggle={sound.toggle} />
      </div>
      <div
        className="tubu-ar-belt"
        role="application"
        tabIndex={0}
        aria-label={arcadeCopy('conveyor.beltAria')}
        data-testid="conveyor-belt"
        {...swipe}
      >
        <span className="tubu-ar-belt-track" aria-hidden />
        {items.map((item, i) => {
          const slot = schedule[i]!;
          if (slot.spawnAt > clock) return null;
          const exit = exits.get(i);
          if (belt.picks[i] !== undefined && !exit) return null;
          if (!laneDelay.current.has(i)) laneDelay.current.set(i, slot.spawnAt - clock);
          return (
            <div
              key={item.id}
              className="tubu-ar-lane"
              style={{ animationDuration: `${slot.travelMs}ms`, animationDelay: `${laneDelay.current.get(i)}ms` }}
              aria-hidden
            >
              <div
                className="tubu-ar-item"
                data-testid="conveyor-item"
                data-bin={item.bin}
                data-front={i === front}
                data-golden={item.golden}
                data-exit={exit?.kind}
                data-to={exit?.bin ?? undefined}
              >
                <ArcadeArt shapes={CONVEYOR_ART[item.art]} className="tubu-ar-item-art" />
                {item.golden && <ArcadeArt shapes={GOLDEN_DROP_ART} className="tubu-ar-item-gold" />}
                <span className="tubu-ar-item-label">{item.label}</span>
              </div>
            </div>
          );
        })}
        {burst && (
          <span key={burst.at} className="tubu-ar-burst" data-to={burst.bin ?? undefined} data-golden={burst.golden} aria-hidden>
            {burst.golden ? arcadeCopy('conveyor.golden', { n: CONVEYOR_GOLDEN_BONUS }) : arcadeCopy('conveyor.combo', { n: conveyorMultiplier(burst.combo) })}
          </span>
        )}
        <span className="tubu-ar-sr" aria-live="polite">
          {frontItem ? arcadeCopy(frontItem.golden ? 'conveyor.frontGolden' : 'conveyor.front', { item: frontItem.label }) : arcadeCopy('conveyor.empty')}
        </span>
      </div>
      <ul className="tubu-ar-bins" aria-label={arcadeCopy('conveyor.binsAria')}>
        {content.bins.map((bin) => (
          <li key={bin}>
            <button
              type="button"
              className="tubu-ar-bin"
              data-bin={bin}
              data-flash={flash && flash.bin === bin ? flash.kind : undefined}
              data-testid={`conveyor-bin-${bin}`}
              aria-label={arcadeCopy('conveyor.binAria', { item: frontItem?.label ?? '', bin: arcadeCopy(`conveyor.bin.${bin}`) })}
              onClick={() => sortInto(bin)}
            >
              <Icon icon={BIN_ICON[bin]} tone="current" />
              <span className="tubu-ar-bin-label">{arcadeCopy(`conveyor.bin.${bin}`)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Text variant="caption" tone="secondary" as="p">
        {arcadeCopy('conveyor.hint')}
      </Text>
    </div>
  );
}
