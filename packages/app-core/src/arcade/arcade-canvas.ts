import { fillCopy } from '../shop-copy';
import type { ArcadeGameId } from './arcade-config';
import { createDewCatcher, DEW_CATCH_Y, DEW_HEARTS, DEW_ITEMS, type DewCatcherState, type DewCatcherStats, type DewEvent } from './dew-catcher';
import { createRefillRush, type RefillRushState, type RefillRushStats, type RushEvent, type RushStation } from './refill-rush';

// `fillStyle: unknown` vì canvas thật còn nhận gradient, pattern.
export interface ArcadeCtx2D {
  fillStyle: unknown; globalAlpha: number; font: string; textAlign: string; textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}
// Mọi trường đều tuỳ chọn để `Event` của DOM gán được.
export interface ArcadeEvent { clientX?: number; clientY?: number; key?: string; preventDefault?(): void }
export interface ArcadeCanvasLike {
  width: number; height: number;
  getContext(type: '2d'): ArcadeCtx2D | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(type: string, listener: (e: ArcadeEvent) => void): void;
  removeEventListener(type: string, listener: (e: ArcadeEvent) => void): void;
}
export type ArcadeTheme = Record<'bg' | 'surface' | 'forest' | 'sage' | 'cream' | 'ink' | 'accent' | 'danger', string>;
// `lives` null ở Refill; `multiplier` là hệ số combo (Dew) hoặc 2 khi Fever (Refill).
export interface ArcadeHud { score: number; secondsLeft: number; lives: number | null; combo: number; multiplier: number }
export interface ArcadeResult { gameId: ArcadeGameId; score: number; durationMs: number; stats: DewCatcherStats | RefillRushStats }
export interface ArcadeMountOptions {
  game: ArcadeGameId; canvas: ArcadeCanvasLike; theme: ArcadeTheme; reducedMotion?: boolean;
  raf(cb: (ts: number) => void): number;
  caf(id: number): void;
  now(): number;
  rng?: () => number;
  onEnd(result: ArcadeResult): void;
  onTick?(hud: ArcadeHud): void;
}

export const ARCADE_MAX_DT_MS = 50;
const BAYS: readonly (readonly [RushStation, string])[] = [['return', '⬅'], ['compost', '⬇'], ['refill', '➡']];
const bay = (i: number) => ({ x: 0.03 + i * 0.32, y: 0.66, w: 0.3, h: 0.24 });

export function mountArcade(o: ArcadeMountOptions) {
  const { canvas, theme } = o;
  const ctx = canvas.getContext('2d');
  const g = ctx as ArcadeCtx2D; // chỉ dùng sau khi `render` loại null
  const reduced = !!o.reducedMotion;
  let W = canvas.width || 1;
  let H = canvas.height || 1;
  let dpr = 1;
  let dew: ReturnType<typeof createDewCatcher> | null = null;
  let rush: ReturnType<typeof createRefillRush> | null = null;
  let frameId: number | null = null;
  let running = false;
  let dead = false;
  let ended = false;
  let last = 0;
  let px = 0.5;
  let keyDir = 0;
  let down: { x: number; y: number } | null = null;
  let hudKey = '';
  let cue: { text: string; x: number; y: number; age: number; color: string } | null = null;

  const txt = (t: string, x: number, y: number, size: number, color = theme.ink, align = 'center', a = 1) => {
    g.globalAlpha = a;
    g.font = `600 ${Math.round(size * W)}px system-ui, sans-serif`;
    g.textAlign = align;
    g.fillStyle = color;
    g.fillText(t, x * W, y * H, W * 0.9);
  };
  const box = (x: number, y: number, w: number, h: number, color: string, a = 1) => {
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(x * W, y * H, w * W, h * H);
  };
  const hudTop = (score: number, timeLeftMs: number) => {
    const secs = Math.ceil(timeLeftMs / 1000);
    txt(fillCopy('arcade.hud.score', { n: score }), 0.04, 0.05, 0.055, theme.forest, 'left');
    txt(fillCopy('arcade.hud.time', { n: secs }), 0.5, 0.05, 0.055, secs <= 5 ? theme.danger : theme.ink);
  };
  const bar = (x: number, y: number, w: number, frac: number, color: string) => {
    box(x, y, w, 0.013, theme.cream);
    box(x, y, w * frac, 0.013, color);
  };

  const drawDew = (s: DewCatcherState) => {
    hudTop(s.score, s.timeLeftMs);
    for (let i = 0; i < DEW_HEARTS; i++) txt(i < s.hearts ? '❤️' : '🤍', 0.84 + i * 0.055, 0.05, 0.045);
    if (s.combo > 0) txt(fillCopy('arcade.hud.combo', { n: s.multiplier }), 0.04, 0.1, 0.04, theme.accent, 'left');
    if (s.magnetMs > 0) txt(fillCopy('arcade.hud.magnet', { n: Math.ceil(s.magnetMs / 1000) }), 0.5, 0.1, 0.04, theme.accent);
    for (const it of s.items) {
      if (DEW_ITEMS[it.kind].hazard) txt('○', it.x, it.y, 0.13, theme.danger);
      txt(DEW_ITEMS[it.kind].emoji, it.x, it.y, 0.07);
    }
    const y = DEW_CATCH_Y + 0.02;
    box(s.paddleX - s.paddleW / 2, y + 0.03, s.paddleW, 0.01, theme.sage);
    txt('🍃', s.paddleX, y, s.paddleW * 0.8);
    if (s.magnetMs > 0) txt('○', s.paddleX, y, s.paddleW * 1.2, theme.accent);
  };
  const drawRush = (s: RefillRushState) => {
    const fever = s.feverMs > 0;
    hudTop(s.score, s.timeLeftMs);
    bar(0.04, 0.09, 0.92, fever ? 1 : s.bar / s.barMax, fever ? theme.accent : theme.forest);
    if (fever) txt(fillCopy('arcade.hud.fever'), 0.5, 0.13, 0.04, theme.accent);
    box(0, 0.3, 1, 0.18, theme.surface);
    if (s.item) {
      const left = Math.max(0, s.item.leftMs / s.item.limitMs);
      txt(s.item.emoji, 0.5, 0.39, 0.2);
      txt(s.item.label, 0.5, 0.53, 0.04);
      bar(0.25, 0.57, 0.5, left, left < 0.3 ? theme.danger : theme.forest);
    }
    BAYS.forEach(([station, arrow], i) => {
      const b = bay(i);
      box(b.x, b.y, b.w, b.h, theme.surface);
      txt(arrow, b.x + b.w / 2, b.y + b.h * 0.34, 0.06, theme.forest);
      txt(fillCopy(`arcade.station.${station}.short`), b.x + b.w / 2, b.y + b.h * 0.78, 0.04);
    });
  };

  const collect = (s: DewCatcherState | RefillRushState) => {
    const ev = (s.events as (DewEvent | RushEvent)[]).filter((e) => e.type !== 'dodge' && e.type !== 'fever').at(-1);
    if (!ev) return;
    if ('mult' in ev) {
      const text = ev.type === 'hit' ? '−❤️' : `+${ev.points}${ev.mult > 1 && !reduced ? ' ✦' : ''}`;
      cue = { text, x: ev.x, y: DEW_CATCH_Y - 0.04, age: 0, color: ev.type === 'hit' ? theme.danger : theme.forest };
    } else {
      const b = bay(BAYS.findIndex(([st]) => st === ev.station));
      cue = { text: ev.type === 'correct' ? `+${ev.points}` : fillCopy(`arcade.hud.${ev.type}`), x: b.x + b.w / 2, y: b.y - 0.03, age: 0, color: ev.type === 'correct' ? theme.forest : theme.danger };
    }
  };

  const render = (dt: number) => {
    if (!ctx || (!dew && !rush)) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.textBaseline = 'middle';
    box(0, 0, 1, 1, theme.bg);
    for (let i = 0; i < 5; i++) txt('🌲', (i + 0.5) / 5, 0.56 + (i % 2) * 0.03, 0.2, theme.ink, 'center', 0.16);
    box(0, 0.94, 1, 0.06, theme.sage, 0.4);
    const s = dew ? dew.state() : rush!.state();
    let hud: ArcadeHud;
    if (dew) {
      const d = s as DewCatcherState;
      drawDew(d);
      hud = { score: d.score, secondsLeft: Math.ceil(d.timeLeftMs / 1000), lives: d.hearts, combo: d.combo, multiplier: d.multiplier };
    } else {
      const r = s as RefillRushState;
      drawRush(r);
      hud = { score: r.score, secondsLeft: Math.ceil(r.timeLeftMs / 1000), lives: null, combo: r.streak, multiplier: r.feverMs > 0 ? 2 : 1 };
    }
    if (cue && (cue.age += dt) < 900) txt(cue.text, cue.x, cue.y - (reduced ? 0 : (cue.age / 1000) * 0.12), 0.05, cue.color, 'center', 1 - cue.age / 900);
    const key = JSON.stringify(hud);
    if (key !== hudKey) {
      hudKey = key;
      o.onTick?.(hud);
    }
  };

  const setPaddle = (x01: number) => {
    px = Math.min(1, Math.max(0, x01));
    dew?.setPaddleX(px);
  };
  const frame = () => {
    frameId = null;
    if (!running || dead) return;
    const t = o.now();
    const dt = Math.min(ARCADE_MAX_DT_MS, Math.max(0, t - last));
    last = t;
    collect((dew ?? rush)!.state());
    if (dew) {
      if (keyDir) setPaddle(px + (keyDir * 1.1 * dt) / 1000);
      dew.step(dt);
    } else rush!.step(dt);
    render(dt);
    const stats = dew ? dew.stats() : rush!.stats();
    if (!stats) {
      frameId = o.raf(frame);
      return;
    }
    ended = true;
    running = false;
    o.onEnd({ gameId: o.game, score: stats.score, durationMs: stats.durationMs, stats });
  };

  const rel = (e: ArcadeEvent) => {
    const r = canvas.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: ((e.clientX ?? 0) - r.left) / r.width, y: ((e.clientY ?? 0) - r.top) / r.height, w: r.width, h: r.height } : { x: 0.5, y: 0, w: 0, h: 0 };
  };
  const onDown = (e: ArcadeEvent) => {
    if (!running) return;
    if (dew) setPaddle(rel(e).x);
    else down = rel(e);
  };
  const onMove = (e: ArcadeEvent) => {
    if (running && dew) setPaddle(rel(e).x);
  };
  const onUp = (e: ArcadeEvent) => {
    const from = down;
    down = null;
    if (!running || !rush || !from) return;
    const p = rel(e);
    const dx = (p.x - from.x) * p.w;
    const dy = (p.y - from.y) * p.h;
    const tap = p.y < 0.66 ? null : p.x < 0.34 ? 'return' : p.x > 0.66 ? 'refill' : 'compost';
    const swipe = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'return' : 'refill') : dy > 0 ? 'compost' : null;
    const pick = Math.hypot(dx, dy) < Math.max(24, p.w * 0.1) ? tap : swipe;
    if (pick) rush.pick(pick);
  };
  const onKeyDown = (e: ArcadeEvent) => {
    if (!running) return;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const pick: RushStation | null = dir < 0 ? 'return' : dir > 0 ? 'refill' : e.key === 'ArrowDown' ? 'compost' : null;
    if (dew && dir) keyDir = dir;
    else if (rush && pick) rush.pick(pick);
    else return;
    e.preventDefault?.();
  };
  const onKeyUp = (e: ArcadeEvent) => {
    if ((e.key === 'ArrowLeft' && keyDir < 0) || (e.key === 'ArrowRight' && keyDir > 0)) keyDir = 0;
  };
  const handlers: [string, (e: ArcadeEvent) => void][] = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['keydown', onKeyDown], ['keyup', onKeyUp]];
  for (const [type, fn] of handlers) canvas.addEventListener(type, fn);

  const stop = () => {
    running = false;
    keyDir = 0;
    down = null;
    if (frameId !== null) o.caf(frameId);
    frameId = null;
  };
  return {
    start() {
      if (dead) return;
      stop();
      dew = o.game === 'dew_catcher' ? createDewCatcher({ rng: o.rng }) : null;
      rush = o.game === 'refill_rush' ? createRefillRush({ rng: o.rng }) : null;
      ended = false;
      cue = null;
      hudKey = '';
      px = 0.5;
      running = true;
      last = o.now();
      render(0);
      frameId = o.raf(frame);
    },
    pause: stop,
    resume() {
      if (running || dead || ended || (!dew && !rush)) return;
      running = true;
      last = o.now();
      frameId = o.raf(frame);
    },
    destroy() {
      dead = true;
      stop();
      for (const [type, fn] of handlers) canvas.removeEventListener(type, fn);
    },
    resize(cssW: number, cssH: number, ratio: number) {
      W = cssW > 0 ? cssW : W;
      H = cssH > 0 ? cssH : H;
      dpr = ratio > 0 ? ratio : 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (!running) render(0);
    },
  };
}
