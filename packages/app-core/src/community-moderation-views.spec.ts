import { describe, expect, it } from 'vitest';
import { COMMUNITY_VIEWS, communityViewLabel, communityViewsFor, reportsTabCount } from './community-moderation-views';

describe('community-moderation-views (R-75)', () => {
  it('web admin thấy đủ 5 mục theo thứ tự; nhân viên không thấy "Sự kiện"', () => {
    expect(communityViewsFor({ platform: 'web', isAdmin: true }).map((v) => v.k)).toEqual(['pending', 'reports', 'published', 'unanswered', 'events']);
    expect(communityViewsFor({ platform: 'web', isAdmin: false }).map((v) => v.k)).toEqual(['pending', 'reports', 'published', 'unanswered']);
  });

  it('Mini chỉ có ba mục xử lý nhanh, dùng nhãn ngắn; bộ ba nằm trong bộ năm của web', () => {
    const mini = communityViewsFor({ platform: 'mini', isAdmin: true });
    expect(mini.map((v) => v.k)).toEqual(['pending', 'reports', 'events']);
    expect(mini.map((v) => communityViewLabel(v, 'mini'))).toEqual(['Chờ duyệt', 'Báo cáo', 'Sự kiện']);
    expect(communityViewLabel(COMMUNITY_VIEWS[1]!, 'web')).toBe('Báo cáo vi phạm');
  });

  it('Mini không có mục dành cho nhân viên (chỉ ADMIN vào được trang)', () => {
    expect(communityViewsFor({ platform: 'mini', isAdmin: false }).map((v) => v.k)).toEqual(['pending', 'reports']);
  });

  it('số tab Báo cáo: ưu tiên số hộp việc; chưa có thì độ dài danh sách, đủ trần 50 ghi "50+"; 0 hoặc chưa biết thì ẩn', () => {
    expect(reportsTabCount(73, undefined)).toBe(73);
    expect(reportsTabCount(undefined, 7)).toBe(7);
    expect(reportsTabCount(undefined, 50)).toBe('50+');
    expect(reportsTabCount(0, 3)).toBeUndefined();
    expect(reportsTabCount(undefined, 0)).toBeUndefined();
    expect(reportsTabCount(undefined, undefined)).toBeUndefined();
  });
});
