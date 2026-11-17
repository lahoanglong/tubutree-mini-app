import { describe, expect, it } from 'vitest';
import { BADGE_IDS, type DailyMissionsResponse } from '@tubutree/shared-types';
import { DAILY_OFF, classifyDailyClaimError, parseBadges, parseDailyMissions } from './api';
import {
  GAME_DEVICE_KEY,
  badgeChips,
  badgeCount,
  checkInDotMovesToGarden,
  dailyBonusLine,
  dailyClaimToast,
  dailyProgress,
  dailyRows,
  gameDeviceId,
  gardenDotOn,
  profileDotOn,
} from './view';

const ON: DailyMissionsResponse = {
  enabled: true,
  dayKey: '2026-11-17',
  missions: [
    { id: 'DAILY_QUIZ', done: true, claimed: true },
    { id: 'DAILY_STORY', done: true, claimed: false },
    { id: 'DAILY_WATER', done: false, claimed: false },
  ],
  water: 5,
  bonusPoints: 10,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 35,
  pointsLeft: 100,
  quizPending: false,
};

describe('parseDailyMissions', () => {
  it('cờ tắt: trả DAILY_OFF dù body có rác', () => {
    expect(parseDailyMissions({ enabled: false, missions: 'x' })).toEqual(DAILY_OFF);
  });
  it('đúng dạng: giữ đủ trường', () => {
    expect(parseDailyMissions(ON)).toEqual(ON);
  });
  it.each([null, {}, { enabled: true }, { ...ON, missions: [{ id: 'DROP', done: true, claimed: false }] }, { ...ON, water: -1 }])('body lạ %# thì ném lỗi', (b) => {
    expect(() => parseDailyMissions(b)).toThrow();
  });
});

describe('parseBadges', () => {
  it('cờ tắt: rỗng', () => {
    expect(parseBadges({ enabled: false, badges: [{ id: 'FIRST_ORDER', earned: true }] })).toEqual({ enabled: false, badges: [] });
  });
  it('đủ 8 huy hiệu theo thứ tự gốc, bỏ mã lạ, thiếu thì coi như chưa đạt', () => {
    const r = parseBadges({ enabled: true, badges: [{ id: 'STREAK_7', earned: true, earnedAt: '2026-11-17T00:00:00.000Z' }, { id: 'HACK', earned: true }] });
    expect(r.badges.map((b) => b.id)).toEqual([...BADGE_IDS]);
    expect(r.badges.find((b) => b.id === 'STREAK_7')).toEqual({ id: 'STREAK_7', earned: true, earnedAt: '2026-11-17T00:00:00.000Z' });
    expect(r.badges.filter((b) => b.earned)).toHaveLength(1);
  });
  it('body lạ thì ném lỗi', () => {
    expect(() => parseBadges(null)).toThrow();
  });
});

describe('classifyDailyClaimError', () => {
  const http = (status: number, code?: string) => ({ status, code });
  it.each([
    [http(409, 'DAILY_CLAIMED'), 'stale'],
    [http(400, 'DAILY_NOT_DONE'), 'stale'],
    [http(400, 'DAILY_NOT_TODAY'), 'stale'],
    [http(403, 'DAILY_GUEST'), 'guest'],
    [http(404, 'DAILY_DISABLED'), 'disabled'],
    [http(404), 'disabled'],
    [http(500), 'network'],
    [new Error('mất mạng'), 'network'],
    [{ response: { status: 409, data: { code: 'DAILY_CLAIMED' } } }, 'stale'],
  ])('%j → %s', (err, want) => {
    expect(classifyDailyClaimError(err)).toBe(want);
  });
});

describe('dailyRows', () => {
  it('cờ tắt hoặc chưa tải: không có dòng', () => {
    expect(dailyRows(undefined)).toEqual([]);
    expect(dailyRows(DAILY_OFF)).toEqual([]);
  });
  it('mỗi nhiệm vụ một trạng thái: đã nhận, nhận được, chưa làm; chữ thưởng 💧 và đích của nút Làm', () => {
    const rows = dailyRows(ON);
    expect(rows.map((r) => [r.id, r.state, r.target])).toEqual([
      ['DAILY_QUIZ', 'claimed', 'checkin'],
      ['DAILY_STORY', 'claimable', 'catalog'],
      ['DAILY_WATER', 'todo', 'checkin'],
    ]);
    expect(rows[0]!.reward).toBe('+5 💧');
    expect(rows[1]!.aria).toBe('Nhận thưởng: Đọc câu chuyện một sản phẩm');
    expect(rows[2]!.aria).toBe('Làm nhiệm vụ: Tưới cây');
  });
  it('khách vãng lai: không hứa thưởng, việc đã làm là "done" (không nút Nhận)', () => {
    const rows = dailyRows({ ...ON, pointsBlocked: true });
    expect(rows.every((r) => r.reward === '')).toBe(true);
    expect(rows[1]!.state).toBe('done');
  });
});

describe('dailyProgress / dailyBonusLine / dailyClaimToast', () => {
  it('đếm việc đã làm trên 3', () => {
    expect(dailyProgress(ON)).toBe('2/3');
    expect(dailyProgress(DAILY_OFF)).toBe('');
  });
  it('dòng thưởng ngày: chưa nhận / đã nhận; khách vãng lai không có', () => {
    expect(dailyBonusLine(ON)).toBe('Xong cả 3 nhiệm vụ: +10 Điểm Xanh');
    expect(dailyBonusLine({ ...ON, bonusClaimed: true })).toBe('Đã nhận +10 Điểm Xanh hôm nay');
    expect(dailyBonusLine({ ...ON, pointsBlocked: true })).toBeNull();
  });
  it('báo sau khi nhận theo thưởng thật sau trần', () => {
    expect(dailyClaimToast({ water: 5, points: 0 })).toBe('Đã nhận +5 💧');
    expect(dailyClaimToast({ water: 5, points: 10 })).toBe('Đã nhận +5 💧 và +10 Điểm Xanh');
    expect(dailyClaimToast({ water: 0, points: 0 })).toMatch(/đã trao đủ/);
  });
});

describe('chấm nhắc', () => {
  it('Vườn Xanh: chỉ khi nhiệm vụ ngày bật; Đố Xanh chưa làm hoặc chưa điểm danh', () => {
    expect(gardenDotOn(undefined, { checkedInToday: false })).toBe(false);
    expect(gardenDotOn(DAILY_OFF, { checkedInToday: false })).toBe(false);
    expect(gardenDotOn(ON, { checkedInToday: true })).toBe(false);
    expect(gardenDotOn(ON, { checkedInToday: false })).toBe(true);
    expect(gardenDotOn({ ...ON, quizPending: true }, { checkedInToday: true })).toBe(true);
    expect(gardenDotOn(ON, undefined)).toBe(false);
  });
  it('điểm danh chuyển khỏi tab Ưu đãi chỉ khi nhiệm vụ ngày bật', () => {
    expect(checkInDotMovesToGarden(ON)).toBe(true);
    expect(checkInDotMovesToGarden(DAILY_OFF)).toBe(false);
    expect(checkInDotMovesToGarden(undefined)).toBe(false);
  });
  it('Cá nhân: có thông báo chưa đọc, và tab không mang số đơn đang xử lý', () => {
    expect(profileDotOn(ON, 3, 0)).toBe(true);
    expect(profileDotOn(ON, 3, 1)).toBe(false);
    expect(profileDotOn(ON, 0, 0)).toBe(false);
    expect(profileDotOn(DAILY_OFF, 3, 0)).toBe(false);
  });
});

describe('hàng huy hiệu', () => {
  const res = parseBadges({ enabled: true, badges: [{ id: 'PHOTO_REVIEW', earned: true, earnedAt: '2026-11-17T00:00:00.000Z' }] });
  it('đã đạt đứng trước, chưa đạt kèm điều kiện trong chữ đọc', () => {
    const chips = badgeChips(res);
    expect(chips).toHaveLength(8);
    expect(chips[0]).toMatchObject({ id: 'PHOTO_REVIEW', earned: true, aria: 'Đánh giá có ảnh, đã đạt' });
    expect(chips[1]).toMatchObject({ id: 'FIRST_ORDER', earned: false, aria: 'Đơn đầu tiên, chưa đạt. Nhận đơn hàng đầu tiên.' });
    expect(badgeCount(res)).toBe('1/8');
  });
  it('cờ tắt: không có hàng', () => {
    expect(badgeChips({ enabled: false, badges: [] })).toEqual([]);
    expect(badgeCount(undefined)).toBe('');
  });
});

describe('gameDeviceId', () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1);
  it('dùng mã đã lưu nếu đúng dạng, không thì tạo, lưu và giữ trong phiên', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const id = gameDeviceId(storage, bytes);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(data.get(GAME_DEVICE_KEY)).toBe(id);
    data.set(GAME_DEVICE_KEY, 'ab'.repeat(16));
    expect(gameDeviceId(storage, bytes)).toBe('ab'.repeat(16));
  });
  it('kho bị chặn: vẫn trả mã trong bộ nhớ, ổn định giữa các lần gọi', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const a = gameDeviceId(blocked, bytes);
    expect(gameDeviceId(blocked, bytes)).toBe(a);
    expect(gameDeviceId(null, bytes)).toBe(a);
  });
});
