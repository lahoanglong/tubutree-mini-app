import { describe, expect, it } from 'vitest';
import { ARCADE_MAX_SCORE_PER_SEC, ARCADE_MIN_DURATION_MS } from './arcade-config';
import {
  createRefillRush,
  RUSH_DURATION_MS,
  RUSH_FEVER_MS,
  RUSH_FEVER_STEPS,
  RUSH_GAP_MS,
  RUSH_ITEMS,
  RUSH_LATE_PENALTY_MS,
  RUSH_POINTS,
  RUSH_STATIONS,
  RUSH_WRONG_PENALTY_MS,
  rushLimitMs,
  type RefillRushState,
  type RushEvent,
  type RushStation,
} from './refill-rush';

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Engine = ReturnType<typeof createRefillRush>;
/** Tới khi có vật trên băng chuyền; trả trạng thái lúc đó. */
function untilItem(e: Engine): RefillRushState {
  for (let i = 0; i < 400; i++) {
    const s = e.state();
    if (s.item) return s;
    e.step(16);
  }
  throw new Error('không có vật');
}
const wrongStation = (s: RushStation): RushStation => RUSH_STATIONS.find((x) => x !== s)!;
/** Trả lời đúng `n` vật liên tiếp, gom sự kiện. */
function answerRight(e: Engine, n: number) {
  const events: RushEvent[] = [];
  for (let i = 0; i < n; i++) {
    const s = untilItem(e);
    e.pick(s.item!.station);
    events.push(...e.state().events);
  }
  return events;
}

describe('danh mục vật và trạm', () => {
  it('ba trạm, mỗi trạm có từ 4 vật với emoji và tên ngắn không rỗng, không trùng tên', () => {
    expect([...RUSH_STATIONS].sort()).toEqual(['compost', 'refill', 'return']);
    const labels: string[] = [];
    for (const station of RUSH_STATIONS) {
      expect(RUSH_ITEMS[station].length).toBeGreaterThanOrEqual(4);
      for (const [emoji, label] of RUSH_ITEMS[station]) {
        expect(emoji.length).toBeGreaterThan(0);
        expect(label.trim()).not.toBe('');
        expect(label.length).toBeLessThanOrEqual(34);
        labels.push(label);
      }
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('thời hạn mỗi vật giảm dần từ 3,2 giây xuống 1,5 giây và kẹp trong khoảng đó', () => {
    expect(rushLimitMs(0)).toBe(3_200);
    expect(rushLimitMs(1)).toBe(1_500);
    expect(rushLimitMs(-5)).toBe(3_200);
    expect(rushLimitMs(9)).toBe(1_500);
    const limits = [0, 0.25, 0.5, 0.75, 1].map(rushLimitMs);
    expect(limits).toEqual([...limits].sort((a, b) => b - a));
    expect(new Set(limits).size).toBe(5);
  });
});

describe('trạng thái đầu', () => {
  it('45 giây, chưa có vật ngay, stats null khi còn chơi, vật đầu hiện sau chừng 0,6 giây', () => {
    const e = createRefillRush({ rng: mulberry32(1) });
    expect(RUSH_DURATION_MS).toBe(45_000);
    expect(e.state()).toMatchObject({ timeLeftMs: 45_000, score: 0, streak: 0, bar: 0, barMax: RUSH_FEVER_STEPS, feverMs: 0, item: null, over: false });
    expect(e.stats()).toBeNull();
    e.step(500);
    expect(e.state().item).toBeNull();
    e.step(150);
    const item = e.state().item!;
    expect(RUSH_STATIONS).toContain(item.station);
    expect(item.limitMs).toBe(rushLimitMs(1 - 44_400 / 45_000));
    expect(item.limitMs).toBeLessThanOrEqual(3_200);
    expect(item.limitMs).toBeGreaterThan(3_100);
    expect(item.leftMs).toBeLessThan(item.limitMs);
    expect(RUSH_ITEMS[item.station].some(([emoji, label]) => emoji === item.emoji && label === item.label)).toBe(true);
  });

  it('xác định được: cùng rng và cùng thao tác cho cùng trạng thái', () => {
    const a = createRefillRush({ rng: mulberry32(8) });
    const b = createRefillRush({ rng: mulberry32(8) });
    for (let i = 0; i < 2000; i++) {
      for (const e of [a, b]) {
        const it = e.state().item;
        if (it && i % 3 === 0) e.pick(i % 2 ? it.station : wrongStation(it.station));
        e.step(16);
      }
      expect(a.state()).toEqual(b.state());
    }
  });

  it('không lặp lại đúng vật vừa xong dù rng cứng một giá trị', () => {
    const e = createRefillRush({ rng: () => 0 });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = untilItem(e);
      seen.push(`${s.item!.station}:${s.item!.label}`);
      e.pick(s.item!.station);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });
});

describe('đúng, sai, quá hạn', () => {
  it('đúng trạm: +10 điểm, chuỗi và thanh Fever tăng, không mất giờ, trả true', () => {
    const e = createRefillRush({ rng: mulberry32(2) });
    const s = untilItem(e);
    const before = s.timeLeftMs;
    expect(e.pick(s.item!.station)).toBe(true);
    expect(e.state()).toMatchObject({ score: RUSH_POINTS, streak: 1, bar: 1, correct: 1, wrong: 0, item: null, timeLeftMs: before });
    expect(e.state().events).toEqual([{ type: 'correct', station: s.item!.station, points: RUSH_POINTS }]);
  });

  it('sai trạm: trừ 2 giây, gãy chuỗi, xả thanh Fever, trả false', () => {
    const e = createRefillRush({ rng: mulberry32(2) });
    answerRight(e, 3);
    const s = untilItem(e);
    const before = s.timeLeftMs;
    expect(e.pick(wrongStation(s.item!.station))).toBe(false);
    expect(RUSH_WRONG_PENALTY_MS).toBe(2_000);
    expect(e.state()).toMatchObject({ score: 30, streak: 0, bar: 0, correct: 3, wrong: 1, item: null, timeLeftMs: before - RUSH_WRONG_PENALTY_MS });
    expect(e.state().events[0]).toMatchObject({ type: 'wrong' });
    expect(e.state().maxStreak).toBe(3);
  });

  it('quá hạn là sai nhẹ: trừ 1 giây, gãy chuỗi, tính vào wrong và timedOut', () => {
    const e = createRefillRush({ rng: mulberry32(3) });
    const s = untilItem(e);
    const before = e.state().timeLeftMs;
    const limit = s.item!.leftMs;
    const events: RushEvent[] = [];
    for (let i = 0; i < 400 && !events.some((ev) => ev.type === 'late'); i++) {
      e.step(16);
      events.push(...e.state().events);
    }
    expect(events.filter((ev) => ev.type === 'late')).toHaveLength(1);
    const after = e.state();
    expect(RUSH_LATE_PENALTY_MS).toBe(1_000);
    expect(after).toMatchObject({ wrong: 1, streak: 0, bar: 0, item: null, score: 0 });
    // giờ trôi thực + 1 giây phạt: nhỏ hơn mức trừ của một lần sai
    expect(before - after.timeLeftMs).toBeGreaterThanOrEqual(limit + RUSH_LATE_PENALTY_MS - 16);
    expect(before - after.timeLeftMs).toBeLessThan(limit + RUSH_LATE_PENALTY_MS + 40);
  });

  it('nghỉ 400 ms giữa hai vật, vật mới có thời hạn ngắn hơn khi ván trôi', () => {
    const e = createRefillRush({ rng: mulberry32(4) });
    const first = untilItem(e);
    e.pick(first.item!.station);
    expect(RUSH_GAP_MS).toBe(400);
    e.step(RUSH_GAP_MS - 20);
    expect(e.state().item).toBeNull();
    e.step(40);
    expect(e.state().item).not.toBeNull();
    for (let i = 0; i < 12; i++) answerRight(e, 1);
    for (let i = 0; i < 400 && e.state().timeLeftMs > 20_000; i++) e.step(16);
    const later = untilItem(e).item!;
    expect(later.limitMs).toBeLessThan(first.item!.limitMs);
  });

  it('không có vật hoặc sau khi hết ván thì pick không làm gì', () => {
    const e = createRefillRush({ rng: mulberry32(4) });
    expect(e.pick('return')).toBe(false);
    expect(e.state()).toMatchObject({ score: 0, wrong: 0, timeLeftMs: 45_000 });
  });
});

describe('Fever Xanh', () => {
  it('đúng 5 vật liên tiếp mở Fever 4 giây x2 điểm, thanh về 0, feverCount tăng', () => {
    const e = createRefillRush({ rng: mulberry32(5) });
    const events = answerRight(e, RUSH_FEVER_STEPS);
    expect(events.filter((ev) => ev.type === 'fever')).toHaveLength(1);
    const s = e.state();
    expect(s).toMatchObject({ feverMs: RUSH_FEVER_MS, bar: 0, feverCount: 1, streak: 5, score: 50 });
    expect(RUSH_FEVER_MS).toBe(4_000);
    const next = untilItem(e);
    e.pick(next.item!.station);
    expect(e.state().score).toBe(50 + RUSH_POINTS * 2);
    expect(e.state().events[0]).toMatchObject({ type: 'correct', points: 20 });
  });

  it('trong Fever trả lời đúng không đẩy thanh Fever; hết Fever thanh đếm lại từ 0', () => {
    const e = createRefillRush({ rng: mulberry32(5) });
    answerRight(e, 5);
    answerRight(e, 2);
    expect(e.state().bar).toBe(0);
    while (e.state().feverMs > 0) e.step(100);
    expect(e.state().feverMs).toBe(0);
    answerRight(e, 2);
    expect(e.state()).toMatchObject({ bar: 2, feverCount: 1 });
  });

  it('Fever tự hết sau 4 giây, điểm trở về x1', () => {
    const e = createRefillRush({ rng: mulberry32(6) });
    answerRight(e, 5);
    e.step(RUSH_FEVER_MS);
    expect(e.state().feverMs).toBe(0);
    const before = e.state().score;
    answerRight(e, 1);
    expect(e.state().score).toBe(before + RUSH_POINTS);
  });

  it('sai trong Fever xả Fever và gãy chuỗi; quá hạn cũng xả', () => {
    const e = createRefillRush({ rng: mulberry32(7) });
    answerRight(e, 5);
    const s = untilItem(e);
    e.pick(wrongStation(s.item!.station));
    expect(e.state()).toMatchObject({ feverMs: 0, streak: 0, bar: 0 });

    const late = createRefillRush({ rng: mulberry32(7) });
    answerRight(late, 5);
    untilItem(late);
    for (let i = 0; i < 400 && late.state().feverMs > 0 && late.state().wrong === 0; i++) late.step(16);
    expect(late.state().wrong).toBe(1);
    expect(late.state()).toMatchObject({ feverMs: 0, streak: 0 });
  });

  it('chuỗi đứt giữa chừng thì phải đủ 5 liên tiếp mới có Fever', () => {
    const e = createRefillRush({ rng: mulberry32(9) });
    answerRight(e, 4);
    const s = untilItem(e);
    e.pick(wrongStation(s.item!.station));
    answerRight(e, 4);
    expect(e.state()).toMatchObject({ feverCount: 0, bar: 4 });
    answerRight(e, 1);
    expect(e.state().feverCount).toBe(1);
  });
});

describe('kết thúc ván và thống kê', () => {
  function playToEnd(e: Engine, policy: 'right' | 'wrong' | 'idle') {
    for (let i = 0; i < 30_000 && !e.state().over; i++) {
      const it = e.state().item;
      if (it && policy !== 'idle') e.pick(policy === 'right' ? it.station : wrongStation(it.station));
      e.step(16);
    }
    return e.stats()!;
  }

  it('đúng hết: ván chạy trọn 45 giây, stats đủ trường', () => {
    const stats = playToEnd(createRefillRush({ rng: mulberry32(10) }), 'right');
    expect(stats.durationMs).toBe(45_000);
    expect(stats.wrong).toBe(0);
    expect(stats.timedOut).toBe(0);
    expect(stats.correct).toBeGreaterThan(50);
    expect(stats.maxStreak).toBe(stats.correct);
    expect(stats.feverCount).toBeGreaterThan(5);
    expect(Object.keys(stats).sort()).toEqual(['correct', 'durationMs', 'feverCount', 'maxStreak', 'score', 'timedOut', 'wrong']);
    expect(Number.isInteger(stats.score)).toBe(true);
    expect(Number.isInteger(stats.durationMs)).toBe(true);
  });

  it('sai hết: hết giờ sớm nhưng không dưới 5 giây; quá hạn hết: ván kết thúc và đếm timedOut', () => {
    const wrong = playToEnd(createRefillRush({ rng: mulberry32(10) }), 'wrong');
    expect(wrong.score).toBe(0);
    expect(wrong.correct).toBe(0);
    expect(wrong.durationMs).toBeGreaterThanOrEqual(ARCADE_MIN_DURATION_MS);
    expect(wrong.durationMs).toBeLessThan(RUSH_DURATION_MS);
    const idle = playToEnd(createRefillRush({ rng: mulberry32(10) }), 'idle');
    expect(idle.timedOut).toBe(idle.wrong);
    expect(idle.timedOut).toBeGreaterThan(5);
    expect(idle.durationMs).toBeGreaterThanOrEqual(ARCADE_MIN_DURATION_MS);
  });

  it('hết ván: pick và step không đổi gì nữa', () => {
    const e = createRefillRush({ rng: mulberry32(11), durationMs: 5_000 });
    const stats = playToEnd(e, 'right');
    expect(e.pick('return')).toBe(false);
    e.step(10_000);
    expect(e.stats()).toEqual(stats);
    expect(e.state().over).toBe(true);
  });

  it('chuỗi tối đa ghi nhận trước lúc gãy', () => {
    const e = createRefillRush({ rng: mulberry32(12) });
    answerRight(e, 7);
    const s = untilItem(e);
    e.pick(wrongStation(s.item!.station));
    answerRight(e, 2);
    expect(e.state()).toMatchObject({ streak: 2, maxStreak: 7 });
  });

  it('state() là bản chụp: sửa vật trong đó không ảnh hưởng engine', () => {
    const e = createRefillRush({ rng: mulberry32(13) });
    const s = untilItem(e);
    s.item!.station = wrongStation(s.item!.station);
    s.score = 999;
    expect(e.state().score).toBe(0);
    expect(e.pick(e.state().item!.station)).toBe(true);
  });

  it('dt không hợp lệ không làm gì', () => {
    const e = createRefillRush({ rng: mulberry32(1) });
    for (const dt of [0, -10, NaN]) e.step(dt);
    expect(e.state()).toMatchObject({ timeLeftMs: 45_000, item: null });
  });
});

describe('khớp trần điểm mỗi giây của máy chủ', () => {
  it.each([1, 2, 3, 4, 5])('trả lời đúng tức thì (seed %i) không vượt trần và còn dư ít nhất 25%', (seed) => {
    const e = createRefillRush({ rng: mulberry32(seed) });
    for (let i = 0; i < 100_000 && !e.state().over; i++) {
      const it = e.state().item;
      if (it) e.pick(it.station);
      e.step(1);
    }
    const stats = e.stats()!;
    const cap = Math.ceil((stats.durationMs / 1000) * ARCADE_MAX_SCORE_PER_SEC.refill_rush);
    expect(stats.score).toBeLessThanOrEqual(cap * 0.75);
  });

  it('mọi nhịp khung hình cho điểm tối đa dưới trần', () => {
    for (const frame of [1, 8, 16, 33, 50]) {
      const e = createRefillRush({ rng: mulberry32(3) });
      for (let i = 0; i < 100_000 && !e.state().over; i++) {
        const it = e.state().item;
        if (it) e.pick(it.station);
        e.step(frame);
      }
      const stats = e.stats()!;
      expect(stats.score, `khung ${frame} ms`).toBeLessThanOrEqual(Math.ceil((stats.durationMs / 1000) * ARCADE_MAX_SCORE_PER_SEC.refill_rush));
    }
  });
});
