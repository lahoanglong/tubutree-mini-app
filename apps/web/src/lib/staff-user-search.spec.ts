import { describe, it, expect } from 'vitest';
import { staffUserSearchProblem, STAFF_USER_SEARCH_HINT, STAFF_USER_MAX_PAGE } from './staff-user-search';

describe('staffUserSearchProblem (CSKH phải tìm mới thấy khách)', () => {
  it.each(['0912345678', '+84 912 345 678', '0912.345.678', 'Lan', 'Nguyễn Văn An', 'cmw206272002sluukpajmhopd'])('cho qua %s', (s) => {
    expect(staffUserSearchProblem(s)).toBeNull();
  });
  it.each(['', '   ', 'An'])('từ khoá thiếu hoặc quá ngắn (%j) → nêu gợi ý', (s) => {
    expect(staffUserSearchProblem(s)).toBe(STAFF_USER_SEARCH_HINT);
  });
  it.each(['0912', '09123456', '123456789012'])('SĐT không đủ 10 số (%s) → nói rõ cần đủ 10 số', (s) => {
    expect(staffUserSearchProblem(s)).toContain('đủ 10 số');
  });
  it('trần trang khớp máy chủ', () => {
    expect(STAFF_USER_MAX_PAGE).toBe(5);
  });
});
