import { describe, expect, it } from 'vitest';
import { ARCADE_MAX_SCORE_PER_SEC, ARCADE_MIN_DURATION_MS, arcadeScoreTier } from './arcade-config';
import {
  createDewCatcher,
  DEW_CATCH_Y,
  DEW_DURATION_MS,
  DEW_HEARTS,
  DEW_ITEMS,
  DEW_MAGNET_MS,
  DEW_MIN_DX,
  DEW_MIN_SPAWN_MS,
  DEW_PADDLE_W,
  dewMultiplier,
  type DewCatcherState,
  type DewEvent,
  type DewKind,
} from './dew-catcher';

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Mỗi vật rơi lấy ba số từ rng theo thứ tự: đòi độc hại, loại vật, vị trí ngang.
const KIND_ROLL: Record<DewKind, number> = { chem: 0.25, dust: 0.75, dew: 0.3, berry: 0.8, oil: 0.95 };
function scripted(kinds: DewKind[]): () => number {
  const seq = kinds.flatMap((k, i) => [DEW_ITEMS[k].hazard ? 0.1 : 0.9, KIND_ROLL[k], i % 2 ? 0.9 : 0.1]);
  let i = 0;
  return () => seq[i++ % seq.length]!;
}
const GOOD3: DewKind[] = ['dew', 'dew', 'dew'];

type Policy = 'catch' | 'avoid' | 'hit';
/** Người chơi hoàn hảo: luôn nhìn vật thấp nhất chưa qua hàng hứng; vật tốt thì hứng, vật độc thì né hoặc đâm tuỳ `hazards`; `skip` là loại vật cũng né. */
function bot(e: ReturnType<typeof createDewCatcher>, hazards: Policy = 'avoid', skip: DewKind[] = []) {
  const s = e.state();
  const next = s.items.filter((i) => i.y < DEW_CATCH_Y).sort((a, b) => b.y - a.y)[0];
  if (!next) return s;
  const dodge = (DEW_ITEMS[next.kind].hazard && hazards !== 'hit') || skip.includes(next.kind);
  e.setPaddleX(dodge ? (next.x < 0.5 ? 0.9 : 0.1) : next.x);
  return s;
}
function run(e: ReturnType<typeof createDewCatcher>, until: (s: DewCatcherState) => boolean, hazards: Policy = 'avoid', stepMs = 16) {
  const events: DewEvent[] = [];
  for (let i = 0; i < 20_000; i++) {
    bot(e, hazards);
    e.step(stepMs);
    const s = e.state();
    events.push(...s.events);
    if (s.over || until(s)) return { state: s, events };
  }
  throw new Error('không dừng');
}

describe('trạng thái đầu và quy đổi hệ số', () => {
  it('40 giây, 3 tim, chưa có vật, stats null khi còn chơi', () => {
    const e = createDewCatcher({ rng: mulberry32(1) });
    const s = e.state();
    expect(DEW_DURATION_MS).toBe(40_000);
    expect(s).toMatchObject({ timeLeftMs: 40_000, score: 0, hearts: DEW_HEARTS, combo: 0, multiplier: 1, magnetMs: 0, over: false, items: [], events: [] });
    expect(DEW_HEARTS).toBe(3);
    expect(e.stats()).toBeNull();
  });

  it('hệ số x1 → x2 → x3 → x5 ở ngưỡng 5, 12, 25', () => {
    const at = [0, 4, 5, 11, 12, 24, 25, 100].map(dewMultiplier);
    expect(at).toEqual([1, 1, 2, 2, 3, 3, 5, 5]);
  });

  it('bảng vật: điểm 10/25/30, hai vật độc, nhãn và emoji', () => {
    expect(DEW_ITEMS.dew).toMatchObject({ emoji: '💧', label: 'Giọt Sương Mai', points: 10, hazard: false });
    expect(DEW_ITEMS.berry).toMatchObject({ emoji: '🌰', label: 'Quả Bồ Hòn Hữu Cơ', points: 25, hazard: false });
    expect(DEW_ITEMS.oil).toMatchObject({ emoji: '🌿', label: 'Tinh Dầu Tràm Trà', points: 30, hazard: false });
    expect(DEW_ITEMS.chem).toMatchObject({ emoji: '🧪', label: 'Giọt Hoá Chất Tẩy Mạnh (SLS/Paraben)', hazard: true });
    expect(DEW_ITEMS.dust).toMatchObject({ emoji: '💨', label: 'Bụi Mịn', hazard: true });
  });
});

describe('xác định được khi truyền rng', () => {
  it('cùng rng và cùng thao tác cho cùng trạng thái từng bước', () => {
    const a = createDewCatcher({ rng: mulberry32(42) });
    const b = createDewCatcher({ rng: mulberry32(42) });
    for (let i = 0; i < 1500; i++) {
      bot(a);
      bot(b);
      a.step(16);
      b.step(16);
      expect(a.state()).toEqual(b.state());
    }
  });

  it('rng khác cho ván khác', () => {
    const play = (seed: number) => {
      const e = createDewCatcher({ rng: mulberry32(seed) });
      return run(e, () => false).state.score;
    };
    expect(new Set([1, 2, 3, 4, 5].map(play)).size).toBeGreaterThan(1);
  });

  it('một lần step 40 giây bằng đúng 1600 lần step 25 ms (engine tự chia nhỏ nên dt lớn không bỏ sót va chạm)', () => {
    const kinds = Array(60).fill('berry') as DewKind[];
    const big = createDewCatcher({ rng: scripted(kinds) });
    const small = createDewCatcher({ rng: scripted(kinds) });
    big.setPaddleX(0.164);
    small.setPaddleX(0.164);
    big.step(40_000);
    for (let i = 0; i < 1600; i++) small.step(25);
    expect(big.stats()).toEqual(small.stats());
    expect(big.stats()!.score).toBeGreaterThan(0);
    expect(big.stats()).toMatchObject({ endedBy: 'time', durationMs: 40_000 });
  });

  it('dt không hợp lệ (0, âm, NaN) không làm gì', () => {
    const e = createDewCatcher({ rng: mulberry32(3) });
    for (const dt of [0, -50, NaN]) e.step(dt);
    expect(e.state()).toMatchObject({ timeLeftMs: 40_000, items: [], over: false });
  });
});

describe('điểm và combo', () => {
  it('hệ số áp theo số vật đã hứng liên tiếp: 5 vật x1, 7 vật x2, 13 vật x3, rồi x5', () => {
    const e = createDewCatcher({ rng: scripted(Array(60).fill('dew') as DewKind[]) });
    const { events, state } = run(e, (s) => s.combo >= 30);
    const catches = events.filter((ev) => ev.type === 'catch');
    expect(catches.slice(0, 30).map((c) => c.mult)).toEqual([...Array(5).fill(1), ...Array(7).fill(2), ...Array(13).fill(3), ...Array(5).fill(5)]);
    // 5×10 + 7×20 + 13×30 + 5×50
    expect(state.score).toBe(50 + 140 + 390 + 250);
    expect(state.multiplier).toBe(5);
  });

  it('điểm vật nhân hệ số hiện tại: Quả Bồ Hòn 25, Tinh Dầu 30 ở x1', () => {
    const e = createDewCatcher({ rng: scripted(['berry', 'oil', 'dew']) });
    const { events } = run(e, (s) => s.combo >= 3);
    expect(events.filter((ev) => ev.type === 'catch').map((c) => c.points)).toEqual([25, 30, 10]);
  });

  it('vật tốt rơi sót không gãy combo và không mất tim', () => {
    const e = createDewCatcher({ rng: scripted(Array(30).fill('dew') as DewKind[]) });
    run(e, (s) => s.combo >= 1);
    const scoreAfterFirst = e.state().score;
    e.setPaddleX(0.5);
    const crossed = new Set<number>();
    for (let i = 0; i < 300; i++) {
      e.step(16);
      for (const it of e.state().items) if (it.y > DEW_CATCH_Y + 0.02) crossed.add(it.id);
    }
    expect(crossed.size).toBeGreaterThanOrEqual(2);
    expect(e.state()).toMatchObject({ combo: 1, score: scoreAfterFirst, hearts: DEW_HEARTS });
  });
});

describe('vật độc: mất tim, gãy combo, né', () => {
  const kinds: DewKind[] = [...GOOD3, 'chem', ...GOOD3, 'dust', ...GOOD3, 'chem', 'dew', 'dew', 'dew'];

  it('chạm vật độc mất 1 tim, gãy combo và hệ số về x1', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { state, events } = run(e, (s) => s.hearts < DEW_HEARTS, 'hit');
    expect(state.hearts).toBe(2);
    expect(state.combo).toBe(0);
    expect(state.multiplier).toBe(1);
    expect(events.filter((ev) => ev.type === 'hit')).toHaveLength(1);
    expect(events.filter((ev) => ev.type === 'catch')).toHaveLength(3);
  });

  it('sau khi gãy combo, vật tiếp theo tính lại x1', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { events } = run(e, (s) => s.hearts === 2 && s.combo >= 1, 'hit');
    const catches = events.filter((ev) => ev.type === 'catch');
    expect(catches.at(-1)).toMatchObject({ mult: 1, points: 10 });
  });

  it('hết tim kết thúc ván, kèm stats, và không bao giờ trước 5 giây', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { state } = run(e, () => false, 'hit');
    expect(state.over).toBe(true);
    const stats = e.stats()!;
    expect(stats).toMatchObject({ endedBy: 'hearts', heartsLeft: 0 });
    expect(stats.durationMs).toBeGreaterThanOrEqual(ARCADE_MIN_DURATION_MS);
    expect(Number.isInteger(stats.durationMs)).toBe(true);
  });

  it('dodgedHazards đếm vật độc rơi qua hàng hứng mà không chạm', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { state, events } = run(e, () => false, 'avoid');
    const dodges = events.filter((ev) => ev.type === 'dodge').length;
    expect(state.hearts).toBe(DEW_HEARTS);
    expect(dodges).toBeGreaterThanOrEqual(3);
    expect(e.stats()).toMatchObject({ dodgedHazards: dodges, endedBy: 'time' });
    expect(events.filter((ev) => ev.type === 'hit')).toHaveLength(0);
  });

  it('né vật độc không gãy combo', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { state, events } = run(e, (s) => s.combo >= 6, 'avoid');
    expect(events.some((ev) => ev.type === 'dodge')).toBe(true);
    expect(state.combo).toBeGreaterThanOrEqual(6);
  });
});

describe('nam châm', () => {
  const kinds: DewKind[] = ['dew', 'dew', 'dew', 'oil', ...(Array(40).fill('dew') as DewKind[])];

  it('Tinh Dầu Tràm Trà bật nam châm 4 giây rồi tắt', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    const { state } = run(e, (s) => s.magnetMs > 0);
    expect(DEW_MAGNET_MS).toBe(4_000);
    expect(state.magnetMs).toBe(4_000);
    e.step(2_000);
    expect(e.state().magnetMs).toBe(2_000);
    e.step(2_000);
    expect(e.state().magnetMs).toBe(0);
  });

  it('khi bật, sương trôi về phía lá; khi tắt thì đứng yên theo chiều ngang', () => {
    const e = createDewCatcher({ rng: scripted(kinds) });
    run(e, (s) => s.magnetMs > 0);
    e.setPaddleX(0.5);
    for (let i = 0; i < 200 && e.state().items.filter((x) => x.kind === 'dew').length === 0; i++) e.step(16);
    const dew = e.state().items.find((x) => x.kind === 'dew')!;
    e.step(100);
    const pulled = e.state().items.find((x) => x.id === dew.id)!;
    expect(Math.abs(pulled.x - 0.5)).toBeLessThan(Math.abs(dew.x - 0.5));

    const off = createDewCatcher({ rng: scripted(kinds) });
    off.setPaddleX(0.5);
    for (let i = 0; i < 400 && off.state().items.length === 0; i++) off.step(16);
    const still = off.state().items[0]!;
    off.step(100);
    expect(off.state().items.find((x) => x.id === still.id)!.x).toBe(still.x);
  });

  it('có nam châm thì sương xa lá vẫn hứng được, không có thì trượt', () => {
    const withMagnet = createDewCatcher({ rng: scripted(kinds) });
    run(withMagnet, (s) => s.magnetMs > 0);
    withMagnet.setPaddleX(0.5);
    const scoreBefore = withMagnet.state().score;
    for (let i = 0; i < 150; i++) withMagnet.step(16);
    expect(withMagnet.state().score).toBeGreaterThan(scoreBefore);

    const without = createDewCatcher({ rng: scripted(['dew', 'dew', 'dew', 'dew', 'dew']) });
    without.setPaddleX(0.5);
    for (let i = 0; i < 400; i++) without.step(16);
    expect(without.state().score).toBe(0);
  });

  it('hứng thêm Tinh Dầu làm mới về 4 giây, không cộng dồn', () => {
    const e = createDewCatcher({ rng: scripted([...kinds.slice(0, 4), 'dew', 'oil', ...(Array(40).fill('dew') as DewKind[])]) });
    run(e, (s) => s.magnetMs > 0);
    let oils = 0;
    let last = e.state().magnetMs;
    for (let i = 0; i < 1500 && oils < 1; i++) {
      bot(e);
      e.step(16);
      const m = e.state().magnetMs;
      if (m > last) oils++;
      expect(m).toBeLessThanOrEqual(DEW_MAGNET_MS);
      last = m;
    }
    expect(oils).toBe(1);
  });
});

describe('luật rơi: độc hại, khoảng cách, tốc độ', () => {
  /** Quan sát mọi vật qua các khung hình (mỗi vật hiện ≥ 1 giây nên khung 16 ms không bỏ sót vật nào). Né cả Tinh Dầu để nam châm không dời vị trí vật. */
  function observeSpawns(rng: () => number) {
    const e = createDewCatcher({ rng });
    const seen = new Map<number, { kind: DewKind; x: number; at: number }>();
    let now = 0;
    while (!e.state().over) {
      bot(e, 'avoid', ['oil']);
      e.step(16);
      now += 16;
      for (const it of e.state().items) if (!seen.has(it.id)) seen.set(it.id, { kind: it.kind, x: it.x, at: now });
    }
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  it.each<[string, () => number]>([['luôn đòi vật độc', () => 0], ...[1, 2, 3, 4, 5, 6].map((s): [string, () => number] => [`seed ${s}`, mulberry32(s)])])(
    'vật độc không quá 25% ở mọi thời điểm và không quá 2 liền (%s)',
    (_n, rng) => {
      const spawns = observeSpawns(rng);
      expect(spawns.length).toBeGreaterThan(30);
      let hazards = 0;
      let run = 0;
      spawns.forEach((s, i) => {
        const hazard = DEW_ITEMS[s.kind].hazard;
        hazards += hazard ? 1 : 0;
        run = hazard ? run + 1 : 0;
        expect(hazards / (i + 1)).toBeLessThanOrEqual(0.25);
        expect(run).toBeLessThanOrEqual(2);
      });
    },
  );

  it('vật độc có xuất hiện khi rng cho phép (không bị khoá hẳn)', () => {
    const spawns = observeSpawns(mulberry32(7));
    expect(spawns.some((s) => DEW_ITEMS[s.kind].hazard)).toBe(true);
  });

  it('ba vật đầu không bao giờ là vật độc', () => {
    const spawns = observeSpawns(() => 0);
    expect(spawns.slice(0, 3).every((s) => !DEW_ITEMS[s.kind].hazard)).toBe(true);
  });

  it.each([1, 2, 3])('hai vật liên tiếp cách nhau ít nhất DEW_MIN_SPAWN_MS và lệch ngang tối thiểu (seed %i)', (seed) => {
    const spawns = observeSpawns(mulberry32(seed));
    for (let i = 1; i < spawns.length; i++) {
      expect(spawns[i]!.at - spawns[i - 1]!.at).toBeGreaterThanOrEqual(DEW_MIN_SPAWN_MS - 16);
      expect(Math.abs(spawns[i]!.x - spawns[i - 1]!.x)).toBeGreaterThanOrEqual(DEW_MIN_DX - 1e-9);
    }
    for (const s of spawns) {
      expect(s.x).toBeGreaterThanOrEqual(0.08 - 1e-9);
      expect(s.x).toBeLessThanOrEqual(0.92 + 1e-9);
    }
  });

  it('tốc độ rơi tăng dần theo thời gian', () => {
    const speedAt = (seconds: number) => {
      const e = createDewCatcher({ rng: mulberry32(9) });
      e.setPaddleX(0.5);
      while (e.state().timeLeftMs > 40_000 - seconds * 1000) e.step(16);
      for (let i = 0; i < 500 && e.state().items.length === 0; i++) e.step(16);
      const it = e.state().items[0]!;
      e.step(100);
      const after = e.state().items.find((x) => x.id === it.id)!;
      return (after.y - it.y) / 0.1;
    };
    const early = speedAt(1);
    const late = speedAt(34);
    expect(early).toBeGreaterThan(0.45);
    expect(late).toBeGreaterThan(early * 1.5);
    expect(late).toBeLessThan(1.1);
  });
});

describe('kết thúc ván và stats', () => {
  it('hết 40 giây: endedBy time, durationMs đúng 40000, stats đủ trường', () => {
    const e = createDewCatcher({ rng: mulberry32(11) });
    const { state } = run(e, () => false);
    const stats = e.stats()!;
    expect(state.over).toBe(true);
    expect(stats.endedBy).toBe('time');
    expect(stats.durationMs).toBe(40_000);
    expect(stats.heartsLeft).toBe(DEW_HEARTS);
    expect(Object.keys(stats).sort()).toEqual(['dewCaught', 'dodgedHazards', 'durationMs', 'endedBy', 'heartsLeft', 'maxCombo', 'score']);
    expect(stats.score).toBe(state.score);
    expect(stats.dewCaught).toBeGreaterThan(20);
    expect(stats.maxCombo).toBe(stats.dewCaught);
  });

  it('sau khi hết ván, step không đổi gì', () => {
    const e = createDewCatcher({ rng: mulberry32(11), durationMs: 6_000 });
    const { state } = run(e, () => false);
    e.step(5_000);
    expect(e.state().score).toBe(state.score);
    expect(e.stats()).toMatchObject({ durationMs: 6_000 });
  });

  it('lá bị kẹp trong [nửa bề rộng, 1 − nửa bề rộng], bỏ qua giá trị không hợp lệ', () => {
    const e = createDewCatcher({ rng: mulberry32(1) });
    e.setPaddleX(-3);
    expect(e.state().paddleX).toBeCloseTo(DEW_PADDLE_W / 2);
    e.setPaddleX(9);
    expect(e.state().paddleX).toBeCloseTo(1 - DEW_PADDLE_W / 2);
    e.setPaddleX(0.4);
    e.setPaddleX(NaN);
    expect(e.state().paddleX).toBe(0.4);
    expect(e.state().paddleW).toBe(DEW_PADDLE_W);
  });

  it('state() là bản chụp: sửa nó không ảnh hưởng engine', () => {
    const e = createDewCatcher({ rng: scripted(['dew', 'dew', 'dew']) });
    for (let i = 0; i < 100; i++) e.step(16);
    const s = e.state();
    s.items.forEach((it) => (it.y = 99));
    s.score = 999;
    expect(e.state().score).toBe(0);
    expect(e.state().items.every((it) => it.y < 2)).toBe(true);
  });
});

describe('khớp trần điểm mỗi giây của máy chủ', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('người chơi hoàn hảo (seed %i) không vượt trần và đạt mốc khá', (seed) => {
    const e = createDewCatcher({ rng: mulberry32(seed) });
    run(e, () => false);
    const stats = e.stats()!;
    const cap = Math.ceil((stats.durationMs / 1000) * ARCADE_MAX_SCORE_PER_SEC.dew_catcher);
    expect(stats.score).toBeLessThanOrEqual(cap);
    expect(stats.score).toBeLessThanOrEqual(cap * 0.85);
    expect(arcadeScoreTier('dew_catcher', stats.score)).not.toBe('base');
  });

  it('ván đâm hết tim: điểm vẫn trong trần của durationMs thực', () => {
    const e = createDewCatcher({ rng: mulberry32(5) });
    run(e, () => false, 'hit');
    const stats = e.stats()!;
    expect(stats.score).toBeLessThanOrEqual(Math.ceil((stats.durationMs / 1000) * ARCADE_MAX_SCORE_PER_SEC.dew_catcher));
  });

  it('hàng hứng nằm trong khung và dưới đáy khung vật', () => {
    expect(DEW_CATCH_Y).toBeGreaterThan(0.5);
    expect(DEW_CATCH_Y).toBeLessThan(1);
  });
});
