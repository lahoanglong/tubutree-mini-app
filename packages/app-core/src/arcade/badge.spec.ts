import { afterEach, describe, expect, it } from 'vitest';
import { fillCopy, FORBIDDEN_TERMS } from '../shop-copy';
import { arcadeWindowAt } from './arcade-config';
import { arcadeWindowBadge } from './badge';

const vn = (time: string, day = '2026-11-15') => new Date(`${day}T${time}+07:00`);
const TIMEZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati'];
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('arcadeWindowBadge', () => {
  it('label cố định, nêu cả hai khung và giờ theo đúng hợp đồng', () => {
    const { label } = arcadeWindowBadge(vn('12:00:00'));
    expect(label).toBe('🌤️ Khung Giờ Sương Sớm (06:30–09:00) & 🌧️ Mưa Rào Tối (20:00–22:00): +1 lượt thưởng Game');
    expect(label).toBe(fillCopy('arcade.badge.label'));
  });

  it.each([
    ['06:29:59', null, 'arcade.badge.next.SUONG_SOM'],
    ['06:30:00', 'SUONG_SOM', 'arcade.badge.active.SUONG_SOM'],
    ['08:59:59', 'SUONG_SOM', 'arcade.badge.active.SUONG_SOM'],
    ['09:00:00', null, 'arcade.badge.next.MUA_RAO'],
    ['19:59:59', null, 'arcade.badge.next.MUA_RAO'],
    ['20:00:00', 'MUA_RAO', 'arcade.badge.active.MUA_RAO'],
    ['21:59:59', 'MUA_RAO', 'arcade.badge.active.MUA_RAO'],
    ['22:00:00', null, 'arcade.badge.next.SUONG_SOM'],
    ['00:00:00', null, 'arcade.badge.next.SUONG_SOM'],
    ['23:59:59', null, 'arcade.badge.next.SUONG_SOM'],
  ])('%s -> khung %s, gợi ý %s', (time, active, hintKey) => {
    const badge = arcadeWindowBadge(vn(time));
    expect(badge.activeWindow).toBe(active);
    expect(badge.hint).toBe(fillCopy(hintKey));
  });

  it('gợi ý ngoài khung nêu giờ mở của khung kế, trong khung nói đang có thêm lượt', () => {
    expect(arcadeWindowBadge(vn('10:00:00')).hint).toContain('20:00');
    expect(arcadeWindowBadge(vn('23:00:00')).hint).toContain('06:30');
    expect(arcadeWindowBadge(vn('07:00:00')).hint).toContain('thêm 1 lượt thưởng');
    expect(arcadeWindowBadge(vn('21:00:00')).hint).toContain('thêm 1 lượt thưởng');
  });

  it.each(TIMEZONES)('không đổi theo TZ %s', (tz) => {
    process.env.TZ = tz;
    expect(arcadeWindowBadge(vn('06:29:59')).activeWindow).toBeNull();
    expect(arcadeWindowBadge(vn('06:30:00')).activeWindow).toBe('SUONG_SOM');
    expect(arcadeWindowBadge(vn('22:00:00')).activeWindow).toBeNull();
    expect(arcadeWindowBadge(new Date('2026-11-14T23:30:00Z')).activeWindow).toBe('SUONG_SOM');
    expect(arcadeWindowBadge(new Date('2026-11-15T13:00:00Z')).activeWindow).toBe('MUA_RAO');
    expect(arcadeWindowBadge(vn('10:00:00')).hint).toBe(fillCopy('arcade.badge.next.MUA_RAO'));
  });

  it('khớp arcadeWindowAt từng phút trong một ngày và chữ không dính từ cấm', () => {
    const start = Date.parse('2026-11-14T17:00:00Z');
    for (let minute = 0; minute < 24 * 60; minute++) {
      const t = new Date(start + minute * 60_000);
      const badge = arcadeWindowBadge(t);
      expect(badge.activeWindow).toBe(arcadeWindowAt(t));
      for (const text of [badge.label, badge.hint]) {
        expect(text.trim()).not.toBe('');
        for (const { pattern } of FORBIDDEN_TERMS) expect(text, String(pattern)).not.toMatch(pattern);
      }
    }
  });
});
