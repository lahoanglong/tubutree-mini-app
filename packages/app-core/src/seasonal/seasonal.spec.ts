import { describe, expect, it } from 'vitest';
import { SEASONAL_THEMES as API_THEMES, normalizeSeasonalTheme as apiNormalize } from '../../../../apps/api/src/modules/system-config/seasonal-theme';
import { ADVENT_DAYS, adventDayKeys, adventTileClock, adventView, adventYear, msUntilNextVnDay, vnDayKeyOf } from './advent';
import { BURST_FLAKES, SNOWFLAKES, TREE_ART, XMAS_ICONS } from './christmas-art';
import { christmasCopy } from './christmas-copy';
import { adventLeadLine, christmasHeroView, giftPreview, readSnowOff, settleOpening, shouldClaim, type HeroInput, writeSnowOff } from './christmas-hero';
import { normalizeSeasonalTheme, readSeasonHint, SEASONAL_THEMES, seasonHasHomeTheme, writeSeasonHint } from './seasonal-theme';

const vn = (iso: string) => Date.parse(`${iso}+07:00`);

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe('theme.seasonal', () => {
  it('cùng danh sách và cùng luật chuẩn hoá với API', () => {
    expect(SEASONAL_THEMES).toEqual(API_THEMES);
    for (const v of ['none', 'christmas', 'tet', 'CHRISTMAS', '', null, undefined, 1, true, { a: 1 }]) expect(normalizeSeasonalTheme(v)).toBe(apiNormalize(v));
  });

  it('giá trị lạ hay API cũ không trả là none; chỉ christmas có giao diện Trang chủ (tet chưa có, không tải chunk)', () => {
    expect(normalizeSeasonalTheme(undefined)).toBe('none');
    expect(normalizeSeasonalTheme('halloween')).toBe('none');
    expect(seasonHasHomeTheme('christmas')).toBe(true);
    expect(seasonHasHomeTheme('none')).toBe(false);
    expect(seasonHasHomeTheme('tet')).toBe(false);
  });

  it('nhớ mùa lần trước để giữ chỗ; bộ nhớ bị chặn thì không vỡ', () => {
    const s = memory();
    expect(readSeasonHint(s)).toBe('none');
    writeSeasonHint(s, 'christmas');
    expect(readSeasonHint(s)).toBe('christmas');
    s.setItem('tubu_season_hint', 'rác');
    expect(readSeasonHint(s)).toBe('none');
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(readSeasonHint(broken)).toBe('none');
    expect(() => writeSeasonHint(broken, 'christmas')).not.toThrow();
    expect(readSeasonHint(null)).toBe('none');
  });

  it('nút ❄️ nhớ lựa chọn tắt tuyết', () => {
    const s = memory();
    expect(readSnowOff(s)).toBe(false);
    writeSnowOff(s, true);
    expect(readSnowOff(s)).toBe(true);
    writeSnowOff(s, false);
    expect(readSnowOff(s)).toBe(false);
  });
});

describe('lịch quà 12 ngày (giờ VN +07:00)', () => {
  it('12 ô từ 14/12 tới Giáng sinh 25/12', () => {
    const keys = adventDayKeys(2026);
    expect(keys).toHaveLength(ADVENT_DAYS);
    expect(keys[0]).toBe('2026-12-14');
    expect(keys[11]).toBe('2026-12-25');
  });

  it('ngày đổi đúng 00:00 giờ VN, không theo UTC hay giờ máy', () => {
    expect(vnDayKeyOf(Date.parse('2026-12-15T16:59:59Z'))).toBe('2026-12-15');
    expect(vnDayKeyOf(Date.parse('2026-12-15T17:00:00Z'))).toBe('2026-12-16');
    expect(msUntilNextVnDay(vn('2026-12-15T23:59:00'))).toBe(60_000);
    expect(msUntilNextVnDay(vn('2026-12-16T00:00:00'))).toBe(86_400_000);
  });

  it('tháng 1 vẫn là lịch năm trước (đã qua hết), không hiện lịch năm sau', () => {
    expect(adventYear('2027-01-03')).toBe(2026);
    expect(adventYear('2026-12-01')).toBe(2026);
    const v = adventView({ nowMs: vn('2027-01-03T09:00:00'), checkInDays: [] });
    expect(v.phase).toBe('after');
    expect(v.tiles.every((t) => t.state === 'missed')).toBe(true);
    expect(v.nextIndex).toBe(-1);
    expect(v.msToNextUnlock).toBe(0);
  });

  it('trước ô đầu (28/11): mọi ô khoá, ô 1 là ô kế, số ngày còn lại và giờ mở đúng 00:00 14/12 giờ VN', () => {
    const now = vn('2026-11-28T18:00:00');
    const v = adventView({ nowMs: now, checkInDays: ['2026-11-27'] });
    expect(v.phase).toBe('before');
    expect(v.daysUntilStart).toBe(16);
    expect(v.tiles.every((t) => t.state === 'locked')).toBe(true);
    expect(v.nextIndex).toBe(0);
    expect(v.tiles[0]!.isNext).toBe(true);
    expect(now + v.msToNextUnlock).toBe(vn('2026-12-14T00:00:00'));
    expect(adventLeadLine({ phase: v.phase, daysUntilStart: v.daysUntilStart, firstLabel: v.tiles[0]!.dateLabel })).toBe('Lịch quà 12 ngày mở từ 14/12 · còn 16 ngày');
  });

  it('giữa lịch: ô đã điểm danh xanh, ngày lỡ mờ, hôm nay mở được, ngày mai đếm giờ', () => {
    const v = adventView({ nowMs: vn('2026-12-16T21:30:00'), checkInDays: ['2026-12-10', '2026-12-14'] });
    expect(v.phase).toBe('during');
    expect(v.tiles.slice(0, 4).map((t) => t.state)).toEqual(['claimed', 'missed', 'open', 'locked']);
    expect(v.todayIndex).toBe(2);
    expect(v.tiles[2]!.isToday).toBe(true);
    expect(v.nextIndex).toBe(3);
    expect(v.claimed).toBe(1);
    expect(adventTileClock(v.msToNextUnlock)).toBe('02:30');
  });

  it('đã nhận hôm nay (máy chủ báo checkedInToday, checkInDays của API cũ thiếu): ô hôm nay xanh', () => {
    const v = adventView({ nowMs: vn('2026-12-16T08:00:00'), checkInDays: undefined, claimedToday: true });
    expect(v.tiles[2]!.state).toBe('claimed');
    expect(v.claimed).toBe(1);
  });

  it('nhận thiếu một phần (Điểm Xanh xong, giọt nước lỗi): checkInDays có hôm nay nhưng ô vẫn mở như thẻ cây', () => {
    const v = adventView({ nowMs: vn('2026-12-16T08:00:00'), checkInDays: ['2026-12-14', '2026-12-16'], claimedToday: false });
    expect(v.tiles.slice(0, 3).map((t) => t.state)).toEqual(['claimed', 'missed', 'open']);
  });

  it('23:59 giờ VN ngày 25/12 vẫn là ô 12; 00:00 ngày 26 thì hết lịch', () => {
    expect(adventView({ nowMs: vn('2026-12-25T23:59:59'), checkInDays: [] }).todayIndex).toBe(11);
    const after = adventView({ nowMs: vn('2026-12-26T00:00:00'), checkInDays: ['2026-12-25'] });
    expect(after.phase).toBe('after');
    expect(after.tiles[11]!.state).toBe('claimed');
  });

  it('đồng hồ ô: giờ:phút làm tròn lên, từ 24 giờ trở lên để trống', () => {
    expect(adventTileClock(0)).toBe('');
    expect(adventTileClock(1)).toBe('00:01');
    expect(adventTileClock(5 * 3_600_000 + 11 * 60_000 + 1)).toBe('05:12');
    expect(adventTileClock(86_400_000 - 1_000)).toBe('');
    expect(adventTileClock(2 * 86_400_000)).toBe('');
  });
});

describe('thẻ cây thông rung quà: một lần mỗi ngày', () => {
  const status = { checkedInToday: false, todayPoints: 1000, todayWater: 10, pointsDone: false, waterDone: false };
  const base: HeroInput = { authed: true, status, statusFailed: false, phase: 'idle', gift: null, advent: null };

  it('chưa nhận: nút rung cây; rung xong hộp rơi và nút thành Mở quà kèm phần thưởng sắp nhận', () => {
    expect(christmasHeroView(base).cta).toEqual({ label: 'Rung cây nhận quà', action: 'shake', busy: false });
    const dropped = christmasHeroView({ ...base, phase: 'dropped' });
    expect(dropped.cta).toEqual({ label: 'Mở quà', action: 'open', busy: false });
    expect(dropped.gift).toBe('closed');
    expect(dropped.line).toBe('Nhận +1.000 Điểm Xanh · +10 giọt nước');
  });

  it('chỉ gọi điểm danh khi đã đăng nhập, hộp đã rơi và máy chủ chưa báo đã nhận hôm nay', () => {
    expect(shouldClaim({ ...base, phase: 'dropped' })).toBe(true);
    expect(shouldClaim({ ...base, phase: 'idle' })).toBe(false);
    expect(shouldClaim({ ...base, phase: 'opening' })).toBe(false);
    expect(shouldClaim({ ...base, phase: 'dropped', status: { ...status, checkedInToday: true } })).toBe(false);
    expect(shouldClaim({ ...base, phase: 'dropped', authed: false })).toBe(false);
    // Trạng thái lỗi tải: máy chủ tự chặn trùng ngày (unique userId+dayKey), nên vẫn cho mở.
    expect(shouldClaim({ ...base, phase: 'dropped', status: null })).toBe(true);
  });

  it('đã nhận hôm nay: không còn nút, hộp mở sẵn và đếm tới quà mới', () => {
    const v = christmasHeroView({ ...base, status: { ...status, checkedInToday: true } });
    expect(v.cta).toBeNull();
    expect(v.gift).toBe('open');
    expect(v.nextClock).toBe(true);
    expect(v.line).toBe(christmasCopy.doneToday);
  });

  it('mở xong: giữ dòng phần thưởng đã chụp lúc mở (máy chủ trả 0 cho phần đã xong)', () => {
    const v = christmasHeroView({ ...base, phase: 'opened', status: { ...status, checkedInToday: true, todayPoints: 0 }, gift: 'Nhận +1.000 Điểm Xanh · +10 giọt nước' });
    expect(v.title).toBe(christmasCopy.opened);
    expect(v.line).toBe('Nhận +1.000 Điểm Xanh · +10 giọt nước');
    expect(v.cta).toBeNull();
  });

  it('khách chưa đăng nhập: mở hộp thấy lời chúc và nút đăng nhập, không cụt đường', () => {
    const v = christmasHeroView({ ...base, authed: false, status: null, phase: 'opened' });
    expect(v.title).toBe(christmasCopy.guestWish);
    expect(v.line).toBe(christmasCopy.guestLead);
    expect(v.cta).toEqual({ label: christmasCopy.login, action: 'login', busy: false });
  });

  it('lượt mở: đã nhận → opened; lời gọi xong mà chưa nhận (lỗi, thiếu phần) → hộp đóng để bấm lại; còn chạy → chờ', () => {
    expect(settleOpening({ pending: true, claimedToday: false })).toBeNull();
    expect(settleOpening({ pending: false, claimedToday: true })).toBe('opened');
    expect(settleOpening({ pending: true, claimedToday: true })).toBe('opened');
    expect(settleOpening({ pending: false, claimedToday: false })).toBe('dropped');
    expect(settleOpening({ pending: false, claimedToday: true, failed: true })).toBe('dropped');
  });

  it('lỗi tải trạng thái: nói rõ và vẫn cho rung', () => {
    const v = christmasHeroView({ ...base, status: undefined, statusFailed: true });
    expect(v.line).toBe(christmasCopy.loadFailed);
    expect(v.cta?.action).toBe('shake');
  });

  it('khách vãng lai Zalo (pointsBlocked): dòng quà chỉ hứa giọt nước', () => {
    expect(giftPreview({ ...status, todayPoints: 0, pointsBlocked: 'GUEST' })).toBe('Nhận +10 giọt nước');
  });
});

describe('hình và chữ', () => {
  it('tuyết toàn màn 18–24 bông, cố định giữa các lần dựng (hai app cùng hình)', () => {
    expect(SNOWFLAKES.length).toBeGreaterThanOrEqual(18);
    expect(SNOWFLAKES.length).toBeLessThanOrEqual(24);
    expect(SNOWFLAKES.filter((f) => f.needle).length).toBeGreaterThan(0);
    for (const f of [...SNOWFLAKES, ...BURST_FLAKES]) {
      expect(Number.isFinite(f.x + f.size + f.dur + f.delay + f.drift + f.opacity)).toBe(true);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(100);
      expect(f.dur).toBeGreaterThan(0);
      expect(f.opacity).toBeGreaterThan(0);
      expect(f.opacity).toBeLessThanOrEqual(1);
    }
    expect(SNOWFLAKES.every((f) => f.delay <= 0)).toBe(true);
  });

  it('đường vẽ không có NaN', () => {
    for (const d of [...TREE_ART.tiers, ...TREE_ART.snow, TREE_ART.star, ...Object.values(XMAS_ICONS)]) expect(d).not.toMatch(/NaN|undefined/);
    expect(TREE_ART.tiers).toHaveLength(3);
  });

  it('chữ vừa thẻ 288px ở 320px', () => {
    const MAX: Partial<Record<keyof typeof christmasCopy, number>> = { title: 14, shake: 20, open: 10, opening: 16, shaking: 16, login: 20, guestWish: 22, opened: 22, doneToday: 22, subtitle: 48, guestLead: 56, loadFailed: 56 };
    for (const [k, max] of Object.entries(MAX)) expect((christmasCopy[k as keyof typeof christmasCopy] as string).length, k).toBeLessThanOrEqual(max!);
    expect(christmasCopy.nextGift('05:12:09').length).toBeLessThanOrEqual(24);
    expect(christmasCopy.adventLabel(12, 12)).toBe('Lịch quà 12 ngày, đã mở 12/12');
  });
});
