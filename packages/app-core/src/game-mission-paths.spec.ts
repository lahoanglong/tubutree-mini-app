import { describe, expect, it } from 'vitest';
import { MISSION_PATHS } from './game-mission-paths';
import { PROFILE_REFERRAL_SECTION } from './profile-sections';


describe('MISSION_PATHS', () => {
  it('mỗi nền có đủ đích (trừ điểm danh, cuộn trong trang) và hai nền trỏ cùng đích', () => {
    const targets = ['catalog', 'delivered-orders', 'invite'] as const;
    for (const platform of ['miniapp', 'web'] as const) {
      expect(Object.keys(MISSION_PATHS[platform]).sort()).toEqual([...targets].sort());
    }
  });
  it('mời bạn dẫn tới khối mã giới thiệu ở Cá nhân, không sang Ví', () => {
    expect(MISSION_PATHS.miniapp.invite).toBe(`/profile?section=${PROFILE_REFERRAL_SECTION}`);
    expect(MISSION_PATHS.web.invite).toBe(`/tai-khoan?section=${PROFILE_REFERRAL_SECTION}`);
  });
});
