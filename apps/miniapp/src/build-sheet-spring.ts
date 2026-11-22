import { createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type Ref } from 'react';

/**
 * Thay `@react-spring/web` (~40 KB sau nén, kèm core/shared/animated/rafz) cho đúng một nơi dùng trong bản build: `zmp-ui/esm/components/sheet/content.js`.
 * `build-vendor-shims.ts` chặn build nếu module khác nhập gói này. Chỉ làm phần Sheet dùng, đúng ngữ nghĩa react-spring 9.5.5 trong cách Sheet gọi:
 *   - `useSpring(() => ({ transformAmount, movingAmount, config }))`: dạng hàm nên props (gồm `config`) chỉ đọc ở lần dựng đầu. Sheet luôn dựng
 *     với `config.duration = ANIMATION_DURATION` (200 ms) vì không dùng snapPoints; có `duration` thì react-spring chạy theo thời gian với
 *     easing mặc định `easings.linear`, bỏ qua tension/friction/velocity.
 *   - `api.start({ key: đích })` chạy từ giá trị hiện tại tới đích trong `duration`, đang chạy dở thì chạy tiếp từ chỗ đang đứng; `api.set` đặt ngay.
 *   - `to([a, b], fn)` là giá trị suy ra; `animated.div` ghi thẳng `style` lên DOM mỗi khung hình, không dựng lại React.
 */

/** react-spring khi props không có `duration`: Sheet không đi nhánh này (không snapPoints), giữ cùng thời lượng cho chắc. */
const FALLBACK_DURATION_MS = 200;

type Listener = () => void;

interface Readable {
  get(): unknown;
  subscribe(listener: Listener): () => void;
}

export class SpringValue implements Readable {
  private value: number;
  private readonly listeners = new Set<Listener>();
  private frame = 0;

  constructor(value: number) {
    this.value = value;
  }

  get(): number {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: number): void {
    this.stop();
    this.write(value);
  }

  start(goal: number, duration: number): void {
    this.stop();
    const from = this.value;
    if (from === goal) return;
    if (!(duration > 0)) {
      this.write(goal);
      return;
    }
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const p = Math.min(1, (now - t0) / duration);
      this.write(p === 1 ? goal : from + (goal - from) * p);
      this.frame = p === 1 ? 0 : requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private write(value: number): void {
    this.value = value;
    this.listeners.forEach((l) => l());
  }
}

class Interpolation implements Readable {
  constructor(
    private readonly sources: readonly SpringValue[],
    private readonly fn: (...values: number[]) => unknown,
  ) {}

  get(): unknown {
    return this.fn(...this.sources.map((s) => s.get()));
  }

  subscribe(listener: Listener): () => void {
    const offs = this.sources.map((s) => s.subscribe(listener));
    return () => offs.forEach((off) => off());
  }
}

export function to(sources: readonly SpringValue[], fn: (...values: number[]) => unknown): Interpolation {
  return new Interpolation(sources, fn);
}

/** `config.stiff` của react-spring: Sheet trải vào config rồi ghi đè `duration`, nên chỉ cần có mặt. */
export const config = { stiff: { tension: 210, friction: 20 } };

type SpringProps = Record<string, unknown> & { config?: { duration?: number } };
type Goals = Record<string, number>;

export interface SpringApi {
  start(goals: Goals): void;
  set(goals: Goals): void;
  stop(): void;
}

export function useSpring(init: () => SpringProps): [Record<string, SpringValue>, SpringApi] {
  const ref = useRef<[Record<string, SpringValue>, SpringApi] | null>(null);
  if (!ref.current) {
    const { config: cfg, ...initial } = init();
    const duration = typeof cfg?.duration === 'number' ? cfg.duration : FALLBACK_DURATION_MS;
    const values: Record<string, SpringValue> = {};
    for (const [key, v] of Object.entries(initial)) values[key] = new SpringValue(Number(v) || 0);
    const each = (goals: Goals, fn: (value: SpringValue, goal: number) => void) => {
      for (const [key, goal] of Object.entries(goals)) {
        const value = values[key];
        if (value) fn(value, goal);
      }
    };
    ref.current = [
      values,
      {
        start: (goals) => each(goals, (value, goal) => value.start(goal, duration)),
        set: (goals) => each(goals, (value, goal) => value.set(goal)),
        stop: () => Object.values(values).forEach((value) => value.stop()),
      },
    ];
  }
  const api = ref.current[1];
  useEffect(() => () => api.stop(), [api]);
  return ref.current;
}

function isReadable(v: unknown): v is Readable {
  return v instanceof SpringValue || v instanceof Interpolation;
}

type AnimatedStyle = Record<string, unknown>;

function resolveStyle(style: AnimatedStyle | undefined): CSSProperties | undefined {
  if (!style) return style;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(style)) out[key] = isReadable(v) ? v.get() : v;
  return out as CSSProperties;
}

type AnimatedDivProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'> & { style?: AnimatedStyle };

const AnimatedDiv = forwardRef(function AnimatedDiv({ style, ...rest }: AnimatedDivProps, forwarded: Ref<HTMLDivElement>) {
  const node = useRef<HTMLDivElement | null>(null);
  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      node.current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) (forwarded as { current: HTMLDivElement | null }).current = el;
    },
    [forwarded],
  );
  // Ghi giá trị mới lên DOM ngay khi nó đổi; lần dựng lại sau React đặt đúng giá trị hiện tại nên hai đường ghi không giẫm nhau.
  useLayoutEffect(() => {
    const offs: (() => void)[] = [];
    for (const [key, v] of Object.entries(style ?? {})) {
      if (!isReadable(v)) continue;
      offs.push(
        v.subscribe(() => {
          if (node.current) (node.current.style as unknown as Record<string, string>)[key] = String(v.get() ?? '');
        }),
      );
    }
    return () => offs.forEach((off) => off());
  });
  return createElement('div', { ...rest, style: resolveStyle(style), ref: setNode });
});

export const animated = { div: AnimatedDiv };
