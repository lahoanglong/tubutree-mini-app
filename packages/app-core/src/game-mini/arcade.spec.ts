import { describe, expect, it } from 'vitest';
import {
  CONVEYOR_GOLDEN_BONUS,
  MERGE_MAX_MOVES,
  MINI_CONVEYOR_ART,
  conveyorDecode,
  conveyorEncode,
  conveyorMultiplier,
  conveyorTally,
  mergeCanMove,
  mergeLine,
  mergeReplay,
  mergeSlide,
  mergeTier,
  type MergeDir,
  type MiniConveyorBin,
  type MiniConveyorItem,
  type MiniTodayResponse,
} from '@tubutree/shared-types';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { ARCADE_MINI_COPY, ARCADE_MINI_COPY_MAX, arcadeCopy, type ArcadeMiniCopyKey } from './arcade-copy';
import { ARCADE_TONES, CONVEYOR_ART, GOLDEN_DROP_ART, MERGE_TIER_ART, type ArcadeShape } from './arcade-art';
import { arcadeBestKey, arcadeResultView, readArcadeBest, saveArcadeBest, swipeDir } from './arcade';
import { ARCADE_SOUND_KEY, createArcadeSynth, readSoundOn, saveSoundOn } from './arcade-sfx';
import { MINI_NEW_GAMES, miniGameCards } from './cards';
import {
  CONVEYOR_LEAD_MS,
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
} from './conveyor';
import { mergeGameMove, mergeGameSettle, mergeGameStart, mergeGameTier, mergeKeyDir, mergeTierName, type MergeGame } from './eco-merge';
import { miniIntroReward, miniProgressLabel } from './format';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const blockedStorage = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

/** Lưới 4×4 viết theo hàng cho dễ đọc. */
const grid = (...rows: number[][]) => rows.flat();

/** Bàn dựng sẵn để kiểm thắng/thua: ô hiển thị khớp đúng lưới. */
function boardOf(g: number[]): MergeGame {
  const base = mergeGameStart(1);
  const tiles = g.flatMap((value, cell) => (value > 0 ? [{ id: cell + 1, value, cell, state: 'idle' as const }] : []));
  return { ...base, grid: g, tiles, won: false, over: !mergeCanMove(g), nextId: 100 };
}

describe('Ghép Mầm Xanh: luật dồn và ghép', () => {
  it.each([
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    [[2, 0, 2, 4], [4, 4, 0, 0], 4],
    [[4, 4, 8, 0], [8, 8, 0, 0], 8],
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    [[0, 0, 0, 2], [2, 0, 0, 0], 0],
    [[2, 4, 8, 16], [2, 4, 8, 16], 0],
  ])('dồn %j thành %j, cộng %i điểm (mỗi ô ghép một lần mỗi nước)', (line, out, gained) => {
    const r = mergeLine(line);
    expect(r.out).toEqual(out);
    expect(r.gained).toBe(gained);
  });

  it.each([
    ['l', grid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0])],
    ['r', grid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 4])],
    ['u', grid([2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])],
    ['d', grid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 2])],
  ] as const)('vuốt %s: dồn đúng hướng', (dir, expected) => {
    const start = grid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 2]);
    const r = mergeSlide(start, dir);
    expect(r.grid).toEqual(expected);
    expect(r.moved).toBe(dir !== 'd');
  });

  it('bậc theo giá trị: 2 Hạt giống … 128 Cổ thụ, từ 256 là Rừng Tubu', () => {
    expect([2, 4, 8, 16, 32, 64, 128, 256, 512].map(mergeTier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);
    expect(mergeTier(0)).toBe(0);
    expect([2, 4, 8, 16, 32, 64, 128, 256].map(mergeTierName)).toEqual([
      'Hạt giống',
      'Mầm non',
      'Chồi lá',
      'Cây con',
      'Hoa xanh',
      'Quả lành',
      'Cổ thụ',
      'Rừng Tubu',
    ]);
  });

  it('bàn đầy không còn cặp nào: hết nước đi', () => {
    const g = boardOf(grid([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]));
    expect(g.over).toBe(true);
    expect(mergeGameMove(g, 'l')).toBe(g);
  });

  it('ghép tới 256 là thắng: lên bậc Rừng Tubu, không nhận thêm nước đi', () => {
    const g = boardOf(grid([128, 128, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]));
    const next = mergeGameMove(g, 'l');
    expect(next.won).toBe(true);
    expect(next.newTier).toBe(8);
    expect(next.score).toBe(256);
    expect(mergeGameTier(next)).toBe(8);
    expect(mergeGameMove(next, 'r')).toBe(next);
  });

  it('một nước: ô nguồn trượt vào chỗ ghép rồi biến mất, ô ghép nảy, ô mới mọc lên; dọn xong chỉ còn ô thật', () => {
    const g = boardOf(grid([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]));
    const next = mergeGameMove(g, 'l');
    expect(next.lastMerges).toBe(1);
    expect(next.tiles.filter((t) => t.state === 'gone').map((t) => t.cell)).toEqual([0, 0]);
    expect(next.tiles.find((t) => t.state === 'merged')).toMatchObject({ value: 4, cell: 0 });
    expect(next.tiles.filter((t) => t.state === 'new')).toHaveLength(1);
    const settled = mergeGameSettle(next);
    expect(settled.tiles.every((t) => t.state === 'idle')).toBe(true);
    expect(settled.tiles).toHaveLength(2);
    expect(mergeGameSettle(settled)).toBe(settled);
  });

  it('vuốt vào tường không đổi bàn: trả lại đúng ván cũ, không thêm vào bài nộp', () => {
    const g = boardOf(grid([2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]));
    expect(mergeGameMove(g, 'l')).toBe(g);
    expect(mergeGameMove(g, 'u')).toBe(g);
  });

  it('bài nộp của app chơi lại trên máy chủ ra cùng bàn, cùng điểm (cùng hạt giống, cùng thứ tự số ngẫu nhiên)', () => {
    for (const seed of [1, 42, 987_654_321, 4_294_967_295]) {
      let g = mergeGameStart(seed);
      const dirs: MergeDir[] = ['l', 'd', 'r', 'u', 'd', 'l', 'd', 'r'];
      for (let i = 0; i < 600 && !g.over && !g.won; i++) g = mergeGameSettle(mergeGameMove(g, dirs[(i * 7 + (i >> 3)) % dirs.length]!));
      const replay = mergeReplay(seed, g.path)!;
      expect(g.path.length).toBeGreaterThan(20);
      expect(replay.grid).toEqual(g.grid);
      expect(replay.score).toBe(g.score);
      expect(replay.moves).toBe(g.path.length);
      expect(replay.over).toBe(g.over);
      expect(replay.won).toBe(g.won);
    }
  });

  it('cùng hạt giống thì cùng bàn mở đầu; khác hạt giống thì (gần như luôn) khác', () => {
    expect(mergeGameStart(7).grid).toEqual(mergeGameStart(7).grid);
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => mergeGameStart(i + 1).grid.join(',')));
    expect(distinct.size).toBeGreaterThan(10);
  });

  it('chơi lại từ chối chuỗi sai dạng hoặc dài quá trần; chuỗi rỗng là ván chưa đi nước nào', () => {
    expect(mergeReplay(1, 'lx')).toBeNull();
    expect(mergeReplay(1, 'l'.repeat(MERGE_MAX_MOVES + 1))).toBeNull();
    expect(mergeReplay(1, '')).toMatchObject({ moves: 0, score: 0 });
  });

  it('phím mũi tên và WASD sang hướng vuốt', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'S', 'a', 'D', 'Enter'].map(mergeKeyDir)).toEqual(['u', 'd', 'l', 'r', 'u', 'd', 'l', 'r', null]);
  });
});

describe('cử chỉ vuốt', () => {
  it('theo trục trội, quãng ngắn là chạm', () => {
    expect(swipeDir(40, 5)).toBe('r');
    expect(swipeDir(-40, 10)).toBe('l');
    expect(swipeDir(5, -40)).toBe('u');
    expect(swipeDir(-3, 30)).toBe('d');
    expect(swipeDir(10, 12)).toBeNull();
  });

  it('Băng Chuyền: trái Tái chế, xuống Hữu cơ, phải Refill, lên không làm gì', () => {
    expect((['l', 'd', 'r', 'u'] as const).map(conveyorSwipeBin)).toEqual(['recycle', 'organic', 'refill', null]);
  });
});

const BINS: MiniConveyorBin[] = ['recycle', 'organic', 'refill'];
const items: MiniConveyorItem[] = Array.from({ length: 24 }, (_, i) => ({
  id: `m-${i}`,
  label: `Món ${i}`,
  art: 'can',
  bin: BINS[i % 3]!,
  golden: i === 5 || i === 11 || i === 20,
}));

describe('Băng Chuyền Xanh: lịch, phân loại, điểm', () => {
  const schedule = conveyorSchedule(items.length);

  it('24 món: món đầu ra ở 0,5 giây, nhanh dần, món cuối chạm thùng trước khi hết 30 giây', () => {
    expect(schedule[0]!.spawnAt).toBe(CONVEYOR_LEAD_MS);
    const last = schedule.at(-1)!;
    expect(last.spawnAt + last.travelMs).toBeLessThan(CONVEYOR_ROUND_MS);
    for (let i = 2; i < schedule.length; i++) {
      expect(schedule[i]!.spawnAt - schedule[i - 1]!.spawnAt).toBeLessThanOrEqual(schedule[i - 1]!.spawnAt - schedule[i - 2]!.spawnAt + 1);
      expect(schedule[i]!.travelMs).toBeLessThanOrEqual(schedule[i - 1]!.travelMs);
    }
  });

  it('lệnh áp cho món đầu băng; chưa có món nào thì không đổi gì', () => {
    const s0 = beltStart(items.length);
    expect(beltFront(s0, schedule, 0)).toBeNull();
    expect(beltSort(s0, items, schedule, 'recycle', 100)).toBe(s0);
    const s1 = beltSort(s0, items, schedule, 'recycle', 600);
    expect(s1.picks[0]).toBe('recycle');
    expect(s1.events.at(-1)).toMatchObject({ index: 0, kind: 'right', combo: 1 });
    expect(beltFront(s1, schedule, 600)).toBeNull();
  });

  it('món chạm thùng mà chưa phân là trôi mất, mất chuỗi; ván xong khi mọi món đã xử lý hoặc hết giờ', () => {
    let s = beltStart(items.length);
    s = beltSort(s, items, schedule, 'recycle', 600);
    s = beltTick(s, items, schedule, schedule[1]!.spawnAt + schedule[1]!.travelMs);
    expect(s.picks[1]).toBeNull();
    expect(s.tally).toMatchObject({ correct: 1, missed: 1, combo: 0 });
    expect(beltTick(s, items, schedule, schedule[1]!.spawnAt + schedule[1]!.travelMs)).toBe(s);
    expect(beltDone(s, 10_000)).toBe(false);
    expect(beltDone(s, CONVEYOR_ROUND_MS)).toBe(true);
    expect(beltAnswers(s).slice(0, 3)).toEqual(['recycle', null, null]);
    expect(beltResolved(s)).toBe(2);
  });

  it('chuỗi đúng tăng nhân điểm x2 → x5, món vàng +5; điểm khi chơi trùng điểm máy chủ đếm lại từ bài nộp', () => {
    expect([1, 2, 3, 5, 6, 9, 12, 30].map(conveyorMultiplier)).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
    let s = beltStart(items.length);
    for (let i = 0; i < items.length; i++) {
      const at = schedule[i]!.spawnAt + 10;
      s = beltTick(s, items, schedule, at);
      const pick = i === 8 ? BINS[(i + 1) % 3]! : items[i]!.bin;
      s = beltSort(s, items, schedule, pick, at);
    }
    expect(s.tally).toMatchObject({ correct: 23, wrong: 1, missed: 0, golden: 3 });
    const goldenEvent = s.events.find((e) => e.index === 20)!;
    expect(goldenEvent.gained).toBe(conveyorMultiplier(goldenEvent.combo) + CONVEYOR_GOLDEN_BONUS);
    const encoded = conveyorEncode(beltAnswers(s));
    const server = conveyorTally(items, conveyorDecode(encoded, 24)!);
    expect(server).toEqual({ correct: 23, wrong: 1, missed: 0, score: s.tally.score, bestCombo: s.tally.bestCombo, golden: 3 });
  });

  it('bài nộp sai dạng bị từ chối', () => {
    expect(conveyorDecode('r'.repeat(23), 24)).toBeNull();
    expect(conveyorDecode('rofx'.repeat(6), 24)).toBeNull();
    expect(conveyorDecode(42, 24)).toBeNull();
    expect(conveyorDecode('rof-'.repeat(6), 24)).toHaveLength(24);
  });
});

describe('kỷ lục, âm thanh, dòng kết quả', () => {
  it('kỷ lục: ván đầu không khoe "mới", điểm cao hơn mới ghi, kho bị chặn không làm vỡ màn', () => {
    const st = memoryStorage();
    expect(saveArcadeBest(st, 'eco_merge', 120)).toEqual({ best: 120, isNew: false, previous: 0 });
    expect(saveArcadeBest(st, 'eco_merge', 80)).toEqual({ best: 120, isNew: false, previous: 120 });
    expect(saveArcadeBest(st, 'eco_merge', 300)).toEqual({ best: 300, isNew: true, previous: 120 });
    expect(st.data.get(arcadeBestKey('eco_merge'))).toBe('300');
    expect(readArcadeBest(st, 'green_conveyor')).toBe(0);
    st.setItem(arcadeBestKey('green_conveyor'), 'hỏng');
    expect(readArcadeBest(st, 'green_conveyor')).toBe(0);
    expect(readArcadeBest(blockedStorage, 'eco_merge')).toBe(0);
    expect(saveArcadeBest(blockedStorage, 'eco_merge', 50).best).toBe(50);
  });

  it('âm thanh mặc định bật, nhớ lựa chọn tắt; không có AudioContext thì phát êm không lỗi', () => {
    const st = memoryStorage();
    expect(readSoundOn(st)).toBe(true);
    saveSoundOn(st, false);
    expect(st.data.get(ARCADE_SOUND_KEY)).toBe('off');
    expect(readSoundOn(st)).toBe(false);
    expect(readSoundOn(blockedStorage)).toBe(true);
    expect(() => saveSoundOn(blockedStorage, true)).not.toThrow();
    const synth = createArcadeSynth(() => true);
    expect(() => synth.play('combo')).not.toThrow();
    expect(() => synth.close()).not.toThrow();
  });

  it('dòng kết quả theo phần chấm của máy chủ; game nội dung thì không có', () => {
    expect(arcadeResultView({ game: 'eco_merge', score: 1234, maxTile: 64, moves: 210, won: false })).toEqual({
      headline: 'Quả lành',
      line: `${(1234).toLocaleString('vi-VN')} điểm · 210 nước ghép`,
      score: 1234,
    });
    expect(arcadeResultView({ game: 'eco_merge', score: 0, maxTile: 0, moves: 0, won: false })?.headline).toBe('Hạt giống');
    expect(arcadeResultView({ game: 'green_conveyor', score: 61, bestCombo: 14, golden: 2, missed: 3 })).toEqual({
      headline: null,
      line: '61 điểm · Chuỗi 14 · 2 món vàng',
      score: 61,
    });
    expect(arcadeResultView({ game: 'sort', items: [] })).toBeNull();
  });
});

const todayWith = (over: Partial<MiniTodayResponse> = {}): MiniTodayResponse => ({
  dayKey: '2026-11-28',
  games: [
    { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
    { game: 'green_conveyor', items: 24, timeLimitMs: 30_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
    { game: 'eco_merge', items: 8, timeLimitMs: 180_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 1, playedToday: 1 },
    { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
  ],
  rewardEligible: true,
  noRewardReason: null,
  caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
  dailyQuizDoneToday: false,
  ...over,
});

describe('thẻ "Chơi hôm nay" và chữ phần mở đầu', () => {
  it('thẻ theo thứ tự cố định: Đố Xanh trước, hai game mới ngay sau và có nhãn "Mới"; Chọn Chuẩn Xanh cuối khi cờ bật', () => {
    const cards = miniGameCards(todayWith(), true);
    expect(cards.map((c) => c.id)).toEqual(['daily_quiz', 'eco_merge', 'green_conveyor', 'sort', 'matcher']);
    expect(cards.filter((c) => c.badge).map((c) => c.id)).toEqual([...MINI_NEW_GAMES]);
    expect(cards.find((c) => c.id === 'eco_merge')).toMatchObject({ title: 'Ghép Mầm Xanh', badge: 'Mới', tone: 'leaf' });
    expect(cards.find((c) => c.id === 'eco_merge')!.status?.text).toBe('Còn 1 lượt thưởng');
    expect(cards.at(-1)).toMatchObject({ id: 'matcher', status: null, badge: null });
    expect(new Set(cards.map((c) => c.tone)).size).toBe(cards.length);
    expect(miniGameCards(todayWith(), false).map((c) => c.id)).not.toContain('matcher');
  });

  it('thưởng hứa trước của hai game mới theo đúng công thức máy chủ', () => {
    expect(miniIntroReward(todayWith(), 'green_conveyor').lines).toEqual(['Thưởng tới 10 Giọt nước, thêm 10 Điểm Xanh khi đúng từ 80%']);
    expect(miniIntroReward(todayWith(), 'eco_merge').lines).toEqual(['Thưởng tới 10 Giọt nước, thêm 10 Điểm Xanh khi ghép tới Cổ thụ']);
    expect(miniProgressLabel('eco_merge', 3, 8)).toBe('Bậc 3/8');
    expect(miniProgressLabel('green_conveyor', 5, 24)).toBe('5/24');
  });
});

describe('chữ và hình của game thao tác', () => {
  const keys = Object.keys(ARCADE_MINI_COPY) as ArcadeMiniCopyKey[];

  it.each(keys)('%s: không dùng thuật ngữ cấm, không dấu ba chấm', (key) => {
    for (const { pattern, use } of FORBIDDEN_TERMS) expect(ARCADE_MINI_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
    expect(ARCADE_MINI_COPY[key]).not.toMatch(/\.\.\.|…/);
  });

  it('chữ ngắn vừa ô và nút ở 360px (sau khi điền biến thường gặp)', () => {
    const sample: Record<string, string | number> = { score: '12.345', moves: 210, combo: 14, golden: 3, n: 5, tier: 'Rừng Tubu' };
    for (const [key, max] of Object.entries(ARCADE_MINI_COPY_MAX) as [ArcadeMiniCopyKey, number][]) {
      expect(arcadeCopy(key, sample).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('đủ hình cho 8 bậc và mọi món trên băng; mọi màu là tông có tên (không mã màu)', () => {
    expect(Object.keys(MERGE_TIER_ART).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Object.keys(CONVEYOR_ART).sort()).toEqual([...MINI_CONVEYOR_ART].sort());
    const shapes: ArcadeShape[] = [...Object.values(MERGE_TIER_ART).flat(), ...Object.values(CONVEYOR_ART).flat(), ...GOLDEN_DROP_ART];
    for (const s of shapes) {
      const tone = 'stroke' in s ? s.stroke : s.fill;
      expect(ARCADE_TONES).toContain(tone);
    }
  });
});
