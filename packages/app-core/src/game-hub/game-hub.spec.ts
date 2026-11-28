import { describe, expect, it, vi } from 'vitest';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import type { ArcadeStatus } from '../api/game';
import { gameCopy } from '../game-mini/copy';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { buildHubCards, hubCardLabel, type HubInput } from './cards';
import { GAME_HUB_COPY, GAME_HUB_COPY_MAX, hubCopy, type GameHubCopyKey } from './copy';
import { skyPhase, treeStage, treeStageLabel, vnHour } from './scene';
import { clearHubReturn, hasHubReturn, HUB_RETURN_KEY, HUB_RETURN_TTL_MS, markHubReturn, type HubReturnStorage } from './hub-return';
import { createSfx, SFX_CUES, SFX_GESTURE_EVENTS, SFX_MUTED_KEY, unlockSfxOnGesture, type SfxAudio, type SfxStorage } from './sfx';

const keys = Object.keys(GAME_HUB_COPY) as GameHubCopyKey[];
const sample = { n: 1234, stage: 'đã ra quả' };

describe('GAME_HUB_COPY', () => {
  it('không có thuật ngữ cấm (kể cả "Hot")', () => {
    for (const key of keys) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(GAME_HUB_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
    }
  });

  it('cùng tập khoá với ngân sách và điền được trong ngân sách độ dài', () => {
    expect(Object.keys(GAME_HUB_COPY_MAX).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(hubCopy(key, sample).length, key).toBeLessThanOrEqual(GAME_HUB_COPY_MAX[key]);
  });
});

const arcade = (over: Partial<ArcadeStatus['games']> = {}): ArcadeStatus => ({
  games: { dew_catcher: { bestScore: 1520, plays: 4, used: 1, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 3, cap: 3 }, ...over },
  window: null,
  windowBonus: false,
  nextWindowAt: null,
  quizClaimed: false,
});

function today(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-28',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 0, playedToday: 2 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: false,
    ...over,
  };
}

const input = (over: Partial<HubInput> = {}): HubInput => ({
  real: true,
  arcade: arcade(),
  guestBest: null,
  mini: today(),
  matcher: false,
  wheelCost: null,
  ...over,
});

describe('buildHubCards', () => {
  it('hai game hành động luôn có mặt cùng game mini (lỗi cũ: cờ game mini bật thì sảnh arcade biến mất)', () => {
    expect(buildHubCards(input()).map((c) => c.id)).toEqual(['dew_catcher', 'refill_rush', 'daily_quiz', 'sort']);
    expect(buildHubCards(input({ mini: null })).map((c) => c.id)).toEqual(['dew_catcher', 'refill_rush']);
  });

  it('khách thật: kỷ lục và lượt thưởng arcade từ máy chủ, hết lượt thì "Đã nhận đủ hôm nay"', () => {
    const [dew, rush] = buildHubCards(input());
    expect(dew!.best).toBe('Kỷ lục 1.520');
    expect(dew!.status).toEqual({ text: gameCopy('row.left', { n: 2 }), tone: 'brand' });
    expect(dew!.cta).toBe('Chơi');
    expect(rush!.best).toBeNull();
    expect(rush!.status).toEqual({ text: gameCopy('row.full'), tone: 'secondary' });
  });

  it('khách chơi thử: kỷ lục trên máy, nút "Chơi thử", không hứa lượt thưởng', () => {
    const [dew] = buildHubCards(input({ real: false, arcade: undefined, guestBest: { dew_catcher: 300 } }));
    expect(dew!.best).toBe('Kỷ lục 300');
    expect(dew!.cta).toBe('Chơi thử');
    expect(dew!.status?.text).toBe(gameCopy('row.trial'));
  });

  it('trạng thái arcade chưa tải: không đoán lượt còn lại', () => {
    expect(buildHubCards(input({ arcade: undefined }))[0]!.status).toBeNull();
  });

  it('game mini dùng đúng dòng trạng thái của "Chơi hôm nay" và hứa đủ hai loại thưởng', () => {
    const cards = buildHubCards(input());
    const quiz = cards.find((c) => c.id === 'daily_quiz')!;
    expect(quiz.status?.text).toBe(gameCopy('row.full'));
    expect(quiz.reward).toBe('+💧 và Điểm Xanh');
    expect(quiz.action).toEqual({ kind: 'mini', game: 'daily_quiz' });
    expect(buildHubCards(input({ mini: today({ rewardEligible: false, noRewardReason: 'NOT_LOGGED_IN' }) })).find((c) => c.id === 'sort')!.cta).toBe('Chơi thử');
  });

  it('huy hiệu duy nhất là "Mới" (PO 28/11): game hành động không mang huy hiệu khung giờ thưởng', () => {
    const games = [...today().games, { game: 'eco_merge' as const, items: 8, timeLimitMs: 180_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 }];
    const cards = buildHubCards(input({ mini: today({ games }) }));
    expect(cards.find((c) => c.id === 'dew_catcher')!.badge).toBeNull();
    expect(new Set(cards.flatMap((c) => (c.badge ? [c.badge.text] : [])))).toEqual(new Set(['Mới']));
  });

  it('mùa Noel đổi tên Hứng Sương và Băng Chuyền ở sảnh, giữ thưởng, thứ tự và hành động; mùa thường giữ tên cũ', () => {
    const games = [...today().games, { game: 'green_conveyor' as const, items: 24, timeLimitMs: 30_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 }];
    const plain = buildHubCards(input({ mini: today({ games }) }));
    const xmas = buildHubCards(input({ mini: today({ games }), xmas: true }));
    const title = (cards: typeof plain, id: string) => cards.find((c) => c.id === id)?.title;
    expect(title(plain, 'dew_catcher')).toBe('Hứng Sương Tinh Khiết');
    expect(title(xmas, 'dew_catcher')).toBe('Hứng Bông Tuyết & Hộp Quà Xanh');
    expect(xmas.map((c) => c.id)).toEqual(plain.map((c) => c.id));
    expect(xmas.map((c) => [c.reward, c.cta, c.action])).toEqual(plain.map((c) => [c.reward, c.cta, c.action]));
    expect(title(plain, 'green_conveyor')).toBe('Băng Chuyền Xanh');
    expect(title(xmas, 'green_conveyor')).toBe('Xưởng Gói Quà Ông Già Noel Xanh');
    expect(title(xmas, 'refill_rush')).toBe(title(plain, 'refill_rush'));
  });

  it('mã game chưa có giao diện (chưa vào `PLAYABLE_MINI_GAMES`) không hiện', () => {
    const mini = today({
      games: [
        { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
        { game: 'unknown_game' as never, items: 1, timeLimitMs: 1, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 1, playedToday: 0 },
      ],
    });
    expect(buildHubCards(input({ mini })).map((c) => c.id)).toEqual(['dew_catcher', 'refill_rush', 'sort']);
  });

  it('Chọn Chuẩn Xanh và Vòng quay ở cuối, vòng quay ghi giá lượt', () => {
    const cards = buildHubCards(input({ matcher: true, wheelCost: 10_000 }));
    expect(cards.slice(-2).map((c) => c.id)).toEqual(['matcher', 'wheel']);
    expect(cards.at(-1)!.status?.text).toBe('10.000 Điểm Xanh mỗi lượt');
    expect(cards.at(-1)!.action).toEqual({ kind: 'wheel' });
  });

  it('tên đọc của thẻ là chữ nút + tên game nhìn thấy', () => {
    expect(hubCardLabel(buildHubCards(input())[0]!)).toBe('Chơi Hứng Sương Tinh Khiết');
  });
});

describe('scene', () => {
  it('giờ VN không phụ thuộc múi giờ của máy', () => {
    expect(vnHour(new Date('2026-11-28T00:30:00Z'))).toBe(7);
    expect(vnHour(new Date('2026-11-28T20:00:00Z'))).toBe(3);
  });

  it('pha bầu trời theo giờ VN', () => {
    const at = (utcHour: number) => skyPhase(new Date(Date.UTC(2026, 10, 28, utcHour)));
    expect(at(22)).toBe('dawn'); // 05:00 VN
    expect(at(2)).toBe('day'); // 09:00
    expect(at(9)).toBe('dusk'); // 16:00
    expect(at(12)).toBe('night'); // 19:00
    expect(at(21)).toBe('night'); // 04:00
  });

  it('giai đoạn cây theo tiến độ, héo thắng mọi mốc', () => {
    expect([0, 24, 25, 59, 60, 99, 100].map((p) => treeStage(p, false))).toEqual(['sprout', 'sprout', 'sapling', 'sapling', 'tree', 'tree', 'bloom']);
    expect(treeStage(100, true)).toBe('wilted');
    expect(treeStageLabel('bloom')).toBe('đã ra quả');
  });
});

function fakeAudio() {
  const tones: Array<{ type: string; started: number }> = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const audio: SfxAudio = {
    currentTime: 0,
    destination: {},
    state: 'running',
    createOscillator: () => {
      const osc = { type: '', frequency: param(), connect: vi.fn(), start: (t: number) => void tones.push({ type: osc.type, started: t }), stop: vi.fn() };
      return osc;
    },
    createGain: () => ({ gain: param(), connect: vi.fn() }),
  };
  return { audio, tones };
}

function memoryStorage(init: Record<string, string> = {}): SfxStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...init };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('createSfx', () => {
  it('mặc định có âm, phát đủ nốt của tín hiệu và chỉ tạo AudioContext ở lần phát đầu', () => {
    const { audio, tones } = fakeAudio();
    const make = vi.fn(() => audio);
    const sfx = createSfx({ audio: make, storage: () => memoryStorage() });
    expect(make).not.toHaveBeenCalled();
    expect(sfx.play('win')).toBe(true);
    sfx.play('water');
    expect(make).toHaveBeenCalledTimes(1);
    expect(tones).toHaveLength(SFX_CUES.win.length + SFX_CUES.water.length);
  });

  it('tắt tiếng lưu trên máy và không phát gì; báo cho nơi đang nghe', () => {
    const { audio, tones } = fakeAudio();
    const store = memoryStorage();
    const sfx = createSfx({ audio: () => audio, storage: () => store });
    const listener = vi.fn();
    sfx.subscribe(listener);
    sfx.setMuted(true);
    expect(store.data[SFX_MUTED_KEY]).toBe('1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sfx.play('pop')).toBe(false);
    expect(tones).toHaveLength(0);
    expect(createSfx({ audio: () => audio, storage: () => memoryStorage({ [SFX_MUTED_KEY]: '1' }) }).isMuted()).toBe(true);
  });

  it('máy bật giảm chuyển động: chưa chọn thì mặc định im; đã chọn bật hoặc tắt thì theo lựa chọn đã lưu', () => {
    const { audio, tones } = fakeAudio();
    const quiet = createSfx({ audio: () => audio, storage: () => memoryStorage(), reducedMotion: () => true });
    expect(quiet.isMuted()).toBe(true);
    expect(quiet.play('win')).toBe(false);
    expect(tones).toHaveLength(0);
    expect(createSfx({ audio: () => audio, storage: () => memoryStorage({ [SFX_MUTED_KEY]: '0' }), reducedMotion: () => true }).isMuted()).toBe(false);
    expect(createSfx({ audio: () => audio, storage: () => memoryStorage({ [SFX_MUTED_KEY]: '1' }), reducedMotion: () => false }).isMuted()).toBe(true);
    const store = memoryStorage();
    const chosen = createSfx({ audio: () => audio, storage: () => store, reducedMotion: () => true });
    chosen.setMuted(false);
    expect(store.data[SFX_MUTED_KEY]).toBe('0');
    expect(chosen.play('pop')).toBe(true);
    const broken = createSfx({
      audio: () => audio,
      storage: () => memoryStorage(),
      reducedMotion: () => {
        throw new Error('matchMedia');
      },
    });
    expect(broken.isMuted()).toBe(false);
  });

  it('không có WebAudio hay kho lưu bị chặn: không ném lỗi', () => {
    const blocked: SfxStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const sfx = createSfx({ audio: () => null, storage: () => blocked });
    expect(sfx.isMuted()).toBe(false);
    expect(sfx.play('harvest')).toBe(false);
    expect(() => sfx.setMuted(true)).not.toThrow();
    expect(sfx.isMuted()).toBe(true);
    const throwing = createSfx({
      audio: () => {
        throw new Error('NotAllowedError');
      },
      storage: () => null,
    });
    expect(throwing.play('pop')).toBe(false);
  });

  it('cú chạm tạo và đánh thức AudioContext trước, tiếng đến sau API dùng lại đúng nó; đang tắt tiếng thì chạm không tạo gì', () => {
    const { audio } = fakeAudio();
    const resume = vi.fn(() => Promise.resolve());
    const suspended: SfxAudio = { ...audio, state: 'suspended', resume };
    const make = vi.fn(() => suspended);
    const sfx = createSfx({ audio: make, storage: () => memoryStorage() });
    const handlers = new Map<string, () => void>();
    unlockSfxOnGesture({ addEventListener: (type, fn) => void handlers.set(type, fn) }, sfx);
    expect([...handlers.keys()]).toEqual([...SFX_GESTURE_EVENTS]);
    handlers.get('touchend')!();
    expect(make).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(sfx.play('water')).toBe(true);
    expect(make).toHaveBeenCalledTimes(1);

    const mutedMake = vi.fn(() => suspended);
    const muted = createSfx({ audio: mutedMake, storage: () => memoryStorage({ [SFX_MUTED_KEY]: '1' }) });
    muted.unlock();
    expect(mutedMake).not.toHaveBeenCalled();
    expect(() =>
      createSfx({
        audio: () => {
          throw new Error('NotAllowedError');
        },
        storage: () => null,
      }).unlock(),
    ).not.toThrow();
  });
});

describe('hub-return', () => {
  const store = () => {
    const data = new Map<string, string>();
    const s: HubReturnStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
    return { data, get: () => s };
  };

  it('thẻ Sảnh Game đặt dấu, Vườn Xanh mở lại trong hạn thì về Sảnh Game; đọc không xoá, xoá rồi thì hết', () => {
    const s = store();
    expect(hasHubReturn(s.get, 1_000)).toBe(false);
    markHubReturn(s.get, 1_000);
    expect(s.data.get(HUB_RETURN_KEY)).toBe('1000');
    expect(hasHubReturn(s.get, 1_000 + HUB_RETURN_TTL_MS - 1)).toBe(true);
    expect(hasHubReturn(s.get, 1_000 + HUB_RETURN_TTL_MS - 1)).toBe(true);
    clearHubReturn(s.get);
    expect(hasHubReturn(s.get, 2_000)).toBe(false);
  });

  it('quá hạn, giá trị hỏng hay đồng hồ lùi thì về tab mặc định; kho bị chặn không ném lỗi', () => {
    const s = store();
    markHubReturn(s.get, 1_000);
    expect(hasHubReturn(s.get, 1_000 + HUB_RETURN_TTL_MS)).toBe(false);
    expect(hasHubReturn(s.get, 999)).toBe(false);
    s.data.set(HUB_RETURN_KEY, 'abc');
    expect(hasHubReturn(s.get, 1_000)).toBe(false);
    const blocked = () => {
      throw new Error('SecurityError');
    };
    expect(() => markHubReturn(blocked)).not.toThrow();
    expect(hasHubReturn(blocked)).toBe(false);
    expect(() => clearHubReturn(blocked)).not.toThrow();
    expect(hasHubReturn(() => null)).toBe(false);
  });
});
