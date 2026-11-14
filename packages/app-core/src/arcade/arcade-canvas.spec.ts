import { describe, expect, it } from 'vitest';
import { fillCopy } from '../shop-copy';
import { ARCADE_MAX_DT_MS, mountArcade, type ArcadeCanvasLike, type ArcadeCtx2D, type ArcadeHud, type ArcadeMountOptions, type ArcadeResult, type ArcadeTheme } from './arcade-canvas';
import type { ArcadeGameId } from './arcade-config';
import { DEW_PADDLE_W } from './dew-catcher';
import { createRefillRush, RUSH_ITEMS, RUSH_STATIONS, type RushStation } from './refill-rush';

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const THEME: ArcadeTheme = { bg: '<bg>', surface: '<surface>', forest: '<forest>', sage: '<sage>', cream: '<cream>', ink: '<ink>', accent: '<accent>', danger: '<danger>' };
const RECT = { left: 10, top: 20, width: 400, height: 600 };

interface Op { op: 'rect' | 'text' | 'transform'; fill: unknown; alpha: number; font: string; align: string; args: number[]; text?: string }

class FakeCtx implements ArcadeCtx2D {
  fillStyle: unknown = '<unset>';
  globalAlpha = 1;
  font = '';
  textAlign = '';
  textBaseline = '';
  ops: Op[] = [];
  private push(op: Op['op'], args: number[], text?: string) {
    this.ops.push({ op, fill: this.fillStyle, alpha: this.globalAlpha, font: this.font, align: this.textAlign, args, text });
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.push('transform', [a, b, c, d, e, f]);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.push('rect', [x, y, w, h]);
  }
  fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.push('text', maxWidth === undefined ? [x, y] : [x, y, maxWidth], text);
  }
}

function makeCanvas(hasCtx = true) {
  const ctx = new FakeCtx();
  const listeners = new Map<string, Set<(e: never) => void>>();
  const canvas = {
    width: 400,
    height: 600,
    hasCtx,
    getContext: (): ArcadeCtx2D | null => (canvas.hasCtx ? ctx : null),
    getBoundingClientRect: () => RECT,
    addEventListener: (type: string, fn: (e: never) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: never) => void) => void listeners.get(type)?.delete(fn),
  } satisfies ArcadeCanvasLike & { hasCtx: boolean };
  const listenerCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { canvas, ctx, listeners, listenerCount };
}

function setup(game: ArcadeGameId, extra: Partial<ArcadeMountOptions> = {}, seed = 7, hasCtx = true) {
  let t = 1_000;
  let nextId = 1;
  const pending = new Map<number, (ts: number) => void>();
  const cancelled: number[] = [];
  const ticks: ArcadeHud[] = [];
  const ends: ArcadeResult[] = [];
  const cv = makeCanvas(hasCtx);
  const api = mountArcade({
    game,
    canvas: cv.canvas,
    theme: THEME,
    rng: mulberry32(seed),
    raf: (cb) => {
      pending.set(nextId, cb);
      return nextId++;
    },
    caf: (id) => {
      cancelled.push(id);
      pending.delete(id);
    },
    now: () => t,
    onEnd: (r) => ends.push(r),
    onTick: (h) => ticks.push(h),
    ...extra,
  });
  const frame = (ms = 16) => {
    t += ms;
    const cbs = [...pending.values()];
    pending.clear();
    for (const cb of cbs) cb(t);
  };
  const frames = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) frame(ms);
  };
  const emit = (type: string, e: object) => {
    for (const fn of cv.listeners.get(type) ?? []) fn(e as never);
  };
  const keys = (type: 'keydown' | 'keyup', key: string) => {
    let prevented = 0;
    emit(type, { key, preventDefault: () => prevented++ });
    return prevented;
  };
  const at = (fx: number, fy: number) => ({ clientX: RECT.left + fx * RECT.width, clientY: RECT.top + fy * RECT.height });
  const tap = (fx: number, fy: number) => {
    emit('pointerdown', at(fx, fy));
    emit('pointerup', at(fx, fy));
  };
  const drag = (fx: number, fy: number, dx: number, dy: number) => {
    emit('pointerdown', at(fx, fy));
    const end = at(fx, fy);
    emit('pointerup', { clientX: end.clientX + dx, clientY: end.clientY + dy });
  };
  const ops = () => cv.ctx.ops;
  const clear = () => {
    cv.ctx.ops.length = 0;
  };
  const texts = () => ops().filter((o) => o.op === 'text');
  const textOf = (s: string) => texts().filter((o) => o.text === s);
  return { api, cv, pending, cancelled, ticks, ends, frame, frames, emit, keys, at, tap, drag, ops, clear, texts, textOf, now: () => t, advance: (ms: number) => (t += ms) };
}

/** Trạm của vật đầu tiên mà engine nhận được từ cùng rng: đoán trước để biết thao tác nào là đúng. */
function firstStation(seed: number): RushStation {
  const probe = createRefillRush({ rng: mulberry32(seed) });
  while (!probe.state().item) probe.step(16);
  return probe.state().item!.station;
}
const other = (st: RushStation): RushStation => RUSH_STATIONS.find((s) => s !== st)!;
const lastTick = (h: { ticks: ArcadeHud[] }) => h.ticks.at(-1)!;

describe('khởi động và vẽ', () => {
  it.each(['dew_catcher', 'refill_rush'] as const)('%s: start đặt transform dpr 1, vẽ nền bằng màu theme trước, mọi màu đều từ theme', (game) => {
    const h = setup(game);
    expect(h.ops()).toHaveLength(0);
    h.api.start();
    expect(h.ops()[0]).toMatchObject({ op: 'transform', args: [1, 0, 0, 1, 0, 0] });
    expect(h.ops()[1]).toMatchObject({ op: 'rect', args: [0, 0, 400, 600], fill: THEME.bg });
    const colors = new Set(Object.values(THEME));
    for (const o of h.ops().filter((x) => x.op !== 'transform')) {
      expect(colors.has(o.fill as string), `${o.op} ${o.text ?? ''} ${String(o.fill)}`).toBe(true);
      expect(o.alpha).toBeGreaterThanOrEqual(0);
      expect(o.alpha).toBeLessThanOrEqual(1);
    }
    for (const o of h.texts()) expect(o.args[2] ?? 1).toBeGreaterThan(0);
  });

  it('Dew: HUD điểm, thời gian, 3 tim và vợt', () => {
    const h = setup('dew_catcher');
    h.api.start();
    const texts = h.texts().map((o) => o.text);
    expect(texts).toContain(fillCopy('arcade.hud.score', { n: 0 }));
    expect(texts).toContain(fillCopy('arcade.hud.time', { n: 40 }));
    expect(h.textOf('❤️')).toHaveLength(3);
    expect(texts).toContain('🍃');
  });

  it('Rush: HUD, ba trạm kèm nhãn ngắn, thanh Fever', () => {
    const h = setup('refill_rush');
    h.api.start();
    const texts = h.texts().map((o) => o.text);
    expect(texts).toContain(fillCopy('arcade.hud.time', { n: 45 }));
    for (const st of RUSH_STATIONS) expect(texts).toContain(fillCopy(`arcade.station.${st}.short`));
    expect(h.ops().some((o) => o.op === 'rect' && o.fill === THEME.cream)).toBe(true);
  });

  it('ctx null: start, frame, resize không ném lỗi', () => {
    const h = setup('dew_catcher', {}, 7, false);
    expect(() => {
      h.api.resize(300, 400, 2);
      h.api.start();
      h.frames(5);
      h.api.resize(310, 400, 2);
    }).not.toThrow();
    expect(h.ticks).toHaveLength(0);
  });
});

describe('onTick', () => {
  it('Dew: hud đầu ván, chỉ gọi lại khi hud đổi', () => {
    const h = setup('dew_catcher');
    h.api.start();
    expect(h.ticks).toEqual([{ score: 0, secondsLeft: 40, lives: 3, combo: 0, multiplier: 1 }]);
    h.frames(10);
    expect(h.ticks).toHaveLength(1);
    h.frames(100, 16);
    for (let i = 1; i < h.ticks.length; i++) expect(h.ticks[i]).not.toEqual(h.ticks[i - 1]);
    expect(h.ticks.length).toBeGreaterThan(1);
  });

  it('Rush: lives null, 45 giây, hệ số 1', () => {
    const h = setup('refill_rush');
    h.api.start();
    expect(h.ticks).toEqual([{ score: 0, secondsLeft: 45, lives: null, combo: 0, multiplier: 1 }]);
  });

  it('không có onTick vẫn chạy bình thường', () => {
    const h = setup('refill_rush', { onTick: undefined });
    expect(() => {
      h.api.start();
      h.frames(20);
    }).not.toThrow();
  });
});

describe('resize', () => {
  it('đặt kích thước pixel theo dpr, trước start chưa vẽ', () => {
    const h = setup('dew_catcher');
    h.api.resize(200, 300, 2);
    expect(h.cv.canvas.width).toBe(400);
    expect(h.cv.canvas.height).toBe(600);
    expect(h.ops()).toHaveLength(0);
  });

  it('đang tạm dừng thì resize vẽ lại ngay với transform dpr và toạ độ theo CSS px', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.api.pause();
    h.clear();
    h.api.resize(200, 300, 2);
    expect(h.ops()[0]).toMatchObject({ op: 'transform', args: [2, 0, 0, 2, 0, 0] });
    expect(h.ops()[1]).toMatchObject({ op: 'rect', args: [0, 0, 200, 300], fill: THEME.bg });
  });

  it('đang chạy thì khung kế tiếp vẽ theo kích thước mới', () => {
    const h = setup('refill_rush');
    h.api.start();
    h.api.resize(200, 300, 3);
    expect(h.cv.canvas.width).toBe(600);
    h.clear();
    h.frame();
    expect(h.ops()[0]).toMatchObject({ op: 'transform', args: [3, 0, 0, 3, 0, 0] });
    expect(h.ops()[1]).toMatchObject({ op: 'rect', args: [0, 0, 200, 300] });
  });

  it('dpr lẻ được làm tròn pixel; tham số sai giữ giá trị cũ', () => {
    const h = setup('dew_catcher');
    h.api.resize(201, 300, 1.5);
    expect([h.cv.canvas.width, h.cv.canvas.height]).toEqual([302, 450]);
    h.api.resize(0, -5, 0);
    expect([h.cv.canvas.width, h.cv.canvas.height]).toEqual([201, 300]);
  });
});

describe('Dew: vợt', () => {
  const paddleX = (h: ReturnType<typeof setup>) => h.textOf('🍃').at(-1)!.args[0]!;
  const settle = (h: ReturnType<typeof setup>, n = 1) => {
    h.clear();
    h.frames(n);
    return paddleX(h);
  };

  it('chạm và kéo đặt vợt theo vị trí con trỏ trong khung, trừ lề trái của canvas', () => {
    const h = setup('dew_catcher');
    h.api.start();
    expect(settle(h)).toBeCloseTo(200, 5);
    h.emit('pointerdown', h.at(0.75, 0.8));
    expect(settle(h)).toBeCloseTo(300, 5);
    h.emit('pointermove', h.at(0.3, 0.8));
    expect(settle(h)).toBeCloseTo(120, 5);
  });

  it('con trỏ ngoài khung bị kẹp trong biên của vợt', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.emit('pointermove', { clientX: -5_000, clientY: 0 });
    expect(settle(h)).toBeCloseTo((DEW_PADDLE_W / 2) * 400, 5);
    h.emit('pointermove', { clientX: 9_000, clientY: 0 });
    expect(settle(h)).toBeCloseTo((1 - DEW_PADDLE_W / 2) * 400, 5);
  });

  it('chưa start hoặc đang tạm dừng thì bỏ qua con trỏ', () => {
    const h = setup('dew_catcher');
    h.emit('pointerdown', h.at(0.9, 0.8));
    h.api.start();
    expect(settle(h)).toBeCloseTo(200, 5);
    h.api.pause();
    h.emit('pointermove', h.at(0.9, 0.8));
    h.api.resume();
    expect(settle(h)).toBeCloseTo(200, 5);
  });

  it('phím mũi tên đưa vợt đi 1,1 bề rộng mỗi giây, preventDefault, keyup dừng lại', () => {
    const h = setup('dew_catcher');
    h.api.start();
    expect(h.keys('keydown', 'ArrowLeft')).toBe(1);
    expect(settle(h, 12)).toBeCloseTo((0.5 - 1.1 * 0.192) * 400, 1);
    expect(h.keys('keyup', 'ArrowLeft')).toBe(0);
    const stopped = settle(h);
    expect(settle(h, 5)).toBeCloseTo(stopped, 5);
    expect(h.keys('keydown', 'ArrowRight')).toBe(1);
    expect(settle(h, 5)).toBeGreaterThan(stopped);
  });

  it('keyup của mũi tên ngược chiều không dừng vợt; phím khác và ArrowDown không bị chặn', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.keys('keydown', 'ArrowLeft');
    const a = settle(h, 3);
    h.keys('keyup', 'ArrowRight');
    expect(settle(h, 3)).toBeLessThan(a);
    h.keys('keyup', 'ArrowLeft');
    expect(h.keys('keydown', 'ArrowDown')).toBe(0);
    expect(h.keys('keydown', 'a')).toBe(0);
    expect(h.keys('keydown', 'Enter')).toBe(0);
  });

  it('phím khi chưa chạy không bị chặn và không đi vợt', () => {
    const h = setup('dew_catcher');
    expect(h.keys('keydown', 'ArrowLeft')).toBe(0);
    h.api.start();
    expect(settle(h, 5)).toBeCloseTo(200, 5);
  });

  it('sự kiện phím không có preventDefault vẫn xử lý được', () => {
    const h = setup('dew_catcher');
    h.api.start();
    expect(() => h.emit('keydown', { key: 'ArrowLeft' })).not.toThrow();
  });
});

describe('Rush: chọn trạm bằng chạm, vuốt và phím', () => {
  const TAP_X: Record<RushStation, number> = { return: 0.18, compost: 0.5, refill: 0.82 };
  const methods: [string, (h: ReturnType<typeof setup>, st: RushStation) => void][] = [
    ['chạm vào ô trạm', (h, st) => h.tap(TAP_X[st], 0.78)],
    ['vuốt', (h, st) => h.drag(0.5, 0.5, st === 'return' ? -120 : st === 'refill' ? 120 : 0, st === 'compost' ? 120 : 0)],
    ['phím mũi tên', (h, st) => void h.keys('keydown', st === 'return' ? 'ArrowLeft' : st === 'refill' ? 'ArrowRight' : 'ArrowDown')],
  ];
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it('mỗi hạt giống phủ đủ ba trạm', () => {
    expect(new Set(seeds.map(firstStation))).toEqual(new Set(RUSH_STATIONS));
  });

  it.each(methods)('%s: thao tác đúng trạm của vật được điểm, sai trạm bị phạt', (_name, input) => {
    for (const seed of seeds) {
      const st = firstStation(seed);
      const right = setup('refill_rush', {}, seed);
      right.api.start();
      right.frames(45);
      input(right, st);
      right.frame();
      expect(lastTick(right), `đúng seed ${seed} ${st}`).toMatchObject({ score: 10, combo: 1 });

      const wrong = setup('refill_rush', {}, seed);
      wrong.api.start();
      wrong.frames(45);
      input(wrong, other(st));
      wrong.frame();
      expect(lastTick(wrong), `sai seed ${seed} ${st}`).toMatchObject({ score: 0, combo: 0 });
      expect(lastTick(wrong).secondsLeft).toBeLessThanOrEqual(43);
    }
  });

  function ready(seed = 3) {
    const h = setup('refill_rush', {}, seed);
    h.api.start();
    h.frames(45);
    return { h, st: firstStation(seed) };
  }

  it('chạm phía trên vùng trạm, hoặc nhả mà chưa bấm xuống thì không chọn gì', () => {
    const { h } = ready();
    h.tap(0.5, 0.4);
    h.emit('pointerup', h.at(0.5, 0.8));
    h.drag(0.5, 0.5, 0, -150);
    h.frame();
    expect(h.ticks.at(-1)!.score).toBe(0);
    expect(h.ticks.at(-1)!.secondsLeft).toBeGreaterThanOrEqual(44);
  });

  it('kéo ngắn dưới 24 px ở vùng trạm vẫn tính là chạm', () => {
    const { h, st } = ready();
    h.drag(TAP_X[st], 0.78, 8, 6);
    h.frame();
    expect(lastTick(h).score).toBe(10);
  });

  it('chưa start hoặc đang tạm dừng thì bỏ qua thao tác', () => {
    const early = setup('refill_rush', {}, 3);
    early.tap(TAP_X[firstStation(3)], 0.78);
    early.api.start();
    early.frames(45);
    early.frame();
    expect(lastTick(early).score).toBe(0);

    const { h, st } = ready();
    h.api.pause();
    h.tap(TAP_X[st], 0.78);
    h.keys('keydown', 'ArrowLeft');
    h.api.resume();
    h.frame();
    expect(lastTick(h).score).toBe(0);
  });

  it('phím mũi tên bị preventDefault để trang không cuộn; phím khác thì không', () => {
    const { h } = ready();
    expect(h.keys('keydown', 'ArrowDown')).toBe(1);
    expect(h.keys('keydown', 'Escape')).toBe(0);
  });
});

describe('vòng đời', () => {
  const runToEnd = (h: ReturnType<typeof setup>) => {
    for (let i = 0; i < 3_000 && h.ends.length === 0; i++) h.frame(50);
  };

  it.each(['dew_catcher', 'refill_rush'] as const)('%s: onEnd đúng một lần với kết quả khớp thống kê, rồi dừng vẽ', (game) => {
    const h = setup(game);
    h.api.start();
    runToEnd(h);
    expect(h.ends).toHaveLength(1);
    const r = h.ends[0]!;
    expect(r.gameId).toBe(game);
    expect(r.score).toBe(r.stats.score);
    expect(r.durationMs).toBe(r.stats.durationMs);
    expect(r.durationMs).toBeGreaterThanOrEqual(5_000);
    expect(r.durationMs).toBeLessThanOrEqual(game === 'dew_catcher' ? 40_000 : 45_000);
    expect(h.pending.size).toBe(0);
    const drawn = h.ops().length;
    h.frames(10);
    h.api.resume();
    h.keys('keydown', 'ArrowLeft');
    expect(h.pending.size).toBe(0);
    expect(h.ends).toHaveLength(1);
    expect(h.ops().length).toBe(drawn);
  });

  it('start lại sau khi hết ván mở ván mới và báo kết thúc lần nữa', () => {
    const h = setup('refill_rush');
    h.api.start();
    runToEnd(h);
    h.api.start();
    expect(lastTick(h)).toMatchObject({ score: 0, secondsLeft: 45 });
    expect(h.pending.size).toBe(1);
    for (let i = 0; i < 3_000 && h.ends.length < 2; i++) h.frame(50);
    expect(h.ends).toHaveLength(2);
  });

  it('start hai lần liên tiếp chỉ giữ một vòng lặp và đặt lại ván', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.frames(30);
    h.api.start();
    expect(h.pending.size).toBe(1);
    expect(h.cancelled).toHaveLength(1);
    expect(lastTick(h).secondsLeft).toBe(40);
  });

  it('mỗi khung hình tiến tối đa ARCADE_MAX_DT_MS dù tab bị treo lâu', () => {
    expect(ARCADE_MAX_DT_MS).toBe(50);
    const h = setup('dew_catcher');
    h.api.start();
    h.frames(20, 5_000);
    expect(lastTick(h).secondsLeft).toBe(39);
  });

  it('đồng hồ chạy lùi không làm ván tiến hay ném lỗi', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.frames(10);
    const before = lastTick(h);
    expect(() => h.frame(-5_000)).not.toThrow();
    h.frames(3, 0);
    expect(lastTick(h)).toEqual(before);
  });

  it('pause huỷ khung hình đang chờ; resume bỏ qua thời gian đã nghỉ', () => {
    const h = setup('dew_catcher');
    h.api.start();
    h.frames(5);
    const id = [...h.pending.keys()][0]!;
    h.api.pause();
    expect(h.cancelled).toContain(id);
    expect(h.pending.size).toBe(0);
    h.frames(10);
    h.advance(600_000);
    h.api.resume();
    expect(h.pending.size).toBe(1);
    h.frame();
    expect(lastTick(h).secondsLeft).toBe(40);
    h.api.resume();
    expect(h.pending.size).toBe(1);
  });

  it('resume khi chưa start hoặc sau destroy không tạo vòng lặp', () => {
    const h = setup('dew_catcher');
    h.api.resume();
    expect(h.pending.size).toBe(0);
    h.api.start();
    h.api.destroy();
    h.api.resume();
    h.api.start();
    expect(h.pending.size).toBe(0);
  });

  it('destroy gỡ đủ listener, huỷ khung hình đang chờ và không vẽ nữa', () => {
    const h = setup('refill_rush');
    expect(h.cv.listenerCount()).toBe(5);
    h.api.start();
    h.frames(3);
    h.api.destroy();
    expect(h.cv.listenerCount()).toBe(0);
    expect(h.pending.size).toBe(0);
    expect(h.cancelled).toHaveLength(1);
    const drawn = h.ops().length;
    h.frames(5);
    expect(h.ops().length).toBe(drawn);
  });

  it('chỉ đăng ký các sự kiện cần: pointerdown/move/up và keydown/up', () => {
    const h = setup('dew_catcher');
    expect([...h.cv.listeners.keys()].sort()).toEqual(['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup']);
  });
});

const LABEL_STATION = new Map<string, RushStation>(RUSH_STATIONS.flatMap((st) => RUSH_ITEMS[st].map(([, label]) => [label, st] as const)));
const KEY_OF: Record<RushStation, string> = { return: 'ArrowLeft', refill: 'ArrowRight', compost: 'ArrowDown' };
const TIME_TEXT = new Map(Array.from({ length: 46 }, (_, n) => [fillCopy('arcade.hud.time', { n }), n] as const));

describe('Rush: người chơi máy trả lời đúng mọi vật', () => {
  function playPerfect() {
    const h = setup('refill_rush');
    h.api.start();
    const time: { n: number; fill: unknown }[] = [];
    const fever: unknown[] = [];
    let items = 0;
    for (let i = 0; i < 4_000 && h.ends.length === 0; i++) {
      h.clear();
      h.frame();
      for (const o of h.texts()) {
        if (TIME_TEXT.has(o.text!)) time.push({ n: TIME_TEXT.get(o.text!)!, fill: o.fill });
        if (o.text === fillCopy('arcade.hud.fever')) fever.push(o.fill);
      }
      const item = h.texts().find((o) => LABEL_STATION.has(o.text!));
      if (item) {
        items++;
        h.keys('keydown', KEY_OF[LABEL_STATION.get(item.text!)!]);
      }
    }
    return { h, time, fever, items };
  }

  it('đếm ngược đổi sang màu danger đúng từ giây thứ 5 trở xuống', () => {
    const { time } = playPerfect();
    expect(time.some((t) => t.n >= 6)).toBe(true);
    expect(time.some((t) => t.n <= 5 && t.n >= 1)).toBe(true);
    for (const t of time) expect(t.fill, `còn ${t.n} giây`).toBe(t.n <= 5 ? THEME.danger : THEME.ink);
  });

  it('đủ 5 vật đúng liên tiếp thì Fever hiện chữ màu accent và hệ số hud lên 2', () => {
    const { h, fever } = playPerfect();
    expect(fever.length).toBeGreaterThan(0);
    for (const fill of fever) expect(fill).toBe(THEME.accent);
    expect(Math.max(...h.ticks.map((t) => t.multiplier))).toBe(2);
    expect(Math.min(...h.ticks.map((t) => t.multiplier))).toBe(1);
    expect(Math.max(...h.ticks.map((t) => t.combo))).toBeGreaterThanOrEqual(5);
  });

  it('chạy trọn 45 giây, không sai lần nào, hud cuối bằng kết quả gửi đi', () => {
    const { h, items } = playPerfect();
    expect(h.ends).toHaveLength(1);
    const r = h.ends[0]!;
    expect(r.durationMs).toBe(45_000);
    expect(r.stats).toMatchObject({ wrong: 0, timedOut: 0 });
    expect(items).toBe((r.stats as { correct: number }).correct);
    expect(lastTick(h).score).toBe(r.score);
    expect(h.now() - 1_000).toBeGreaterThanOrEqual(45_000);
    expect(h.now() - 1_000).toBeLessThan(45_000 + 16);
  });
});

describe('Dew: tim', () => {
  it('luôn đủ 3 tim vẽ ra, tim đỏ khớp hud.lives và chỉ giảm', () => {
    const h = setup('dew_catcher');
    h.api.start();
    let prev = 3;
    for (let i = 0; i < 3_000 && h.ends.length === 0; i++) {
      h.clear();
      h.frame(50);
      const red = h.textOf('❤️').length;
      expect(red + h.textOf('🤍').length).toBe(3);
      expect(red).toBeLessThanOrEqual(prev);
      expect(red).toBe(lastTick(h).lives);
      prev = red;
    }
    expect(h.ends).toHaveLength(1);
  });
});

describe('reducedMotion', () => {
  function playRush(reducedMotion: boolean) {
    const seed = 3;
    const h = setup('refill_rush', { reducedMotion }, seed);
    h.api.start();
    h.frames(45);
    h.keys('keydown', { return: 'ArrowLeft', refill: 'ArrowRight', compost: 'ArrowDown' }[firstStation(seed)]);
    const cueY: number[] = [];
    const cueAlpha: number[] = [];
    for (const ms of [16, 100, 100]) {
      h.clear();
      h.frame(ms);
      const cue = h.textOf('+10')[0];
      cueY.push(cue?.args[1] ?? NaN);
      cueAlpha.push(cue?.alpha ?? NaN);
    }
    return { cueY, cueAlpha };
  }

  it('cue điểm nổi lên và mờ dần; reducedMotion giữ yên chỗ nhưng vẫn mờ dần', () => {
    const moving = playRush(false);
    expect(moving.cueY[1]).toBeLessThan(moving.cueY[0]!);
    expect(moving.cueY[2]).toBeLessThan(moving.cueY[1]!);
    const still = playRush(true);
    expect(still.cueY[1]).toBe(still.cueY[0]);
    expect(still.cueY[2]).toBe(still.cueY[0]);
    for (const r of [moving, still]) {
      expect(r.cueAlpha[0]).toBeLessThan(1);
      expect(r.cueAlpha[1]).toBeLessThan(r.cueAlpha[0]!);
      expect(r.cueAlpha[2]).toBeLessThan(r.cueAlpha[1]!);
    }
  });

  /** Người chơi máy: mỗi khung đưa vợt tới món tốt thấp nhất còn hứng được, đọc từ chính các lệnh vẽ. */
  function playDewBot(reducedMotion: boolean, seed: number) {
    const h = setup('dew_catcher', { reducedMotion }, seed);
    h.api.start();
    const cues: string[] = [];
    for (let i = 0; i < 1_200 && h.ends.length === 0; i++) {
      h.clear();
      h.frame();
      for (const o of h.texts()) if (o.fill === THEME.forest && o.text!.startsWith('+')) cues.push(o.text!);
      const good = h.texts().filter((o) => ['💧', '🌰', '🌿'].includes(o.text!) && o.args[1]! < 0.84 * 600);
      const target = good.sort((a, b) => b.args[1]! - a.args[1]!)[0];
      if (target) h.emit('pointermove', { clientX: RECT.left + target.args[0]!, clientY: 0 });
    }
    return { cues, ends: h.ends };
  }

  it('Dew: cue có dấu ✦ khi combo nhân điểm, bỏ dấu ✦ khi reducedMotion', () => {
    const normal = playDewBot(false, 3);
    const reduced = playDewBot(true, 3);
    expect(normal.cues.some((c) => c.endsWith(' ✦'))).toBe(true);
    expect(reduced.cues.some((c) => c.includes('✦'))).toBe(false);
    expect(normal.cues.map((c) => c.replace(' ✦', ''))).toEqual(reduced.cues);
  });
});
