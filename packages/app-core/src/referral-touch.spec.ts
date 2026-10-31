import { describe, expect, it } from 'vitest';
import { clickedAtParam, parseTouchMark, serializeTouchMark, touchMarkAfter, touchMarkMatches } from './referral-touch';

const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('clickedAtParam', () => {
  it('lúc bấm hợp lệ → ISO đúng lúc đó', () => {
    expect(clickedAtParam(NOW - 3600_000, NOW)).toEqual({ clickedAt: '2026-10-31T11:00:00.000Z' });
  });
  it('ở tương lai → kẹp về now, không bao giờ dài hơn', () => {
    expect(clickedAtParam(NOW + 86_400_000, NOW)).toEqual({ clickedAt: new Date(NOW).toISOString() });
  });
  it.each([undefined, null, 0, -5, NaN, Infinity])('không có lúc bấm hợp lệ (%s) → không gửi trường', (v) => {
    expect(clickedAtParam(v as number, NOW)).toEqual({});
  });
});

describe('dấu chạm theo người dùng', () => {
  it('khớp đúng người và mã (không phân biệt hoa thường)', () => {
    const mark = parseTouchMark(serializeTouchMark('u1', 'an123'));
    expect(touchMarkMatches(mark, 'u1', 'AN123')).toBe(true);
  });
  it('người đăng nhập sau (id khác) không thừa hưởng dấu', () => {
    const mark = parseTouchMark(serializeTouchMark('u1', 'AN123'));
    expect(touchMarkMatches(mark, 'u2', 'AN123')).toBe(false);
    expect(touchMarkMatches(mark, null, 'AN123')).toBe(false);
  });
  it('dấu dạng cũ (chỉ mã) hoặc hỏng → không có dấu', () => {
    expect(parseTouchMark('AN123')).toBeNull();
    expect(parseTouchMark('{"u":1}')).toBeNull();
    expect(parseTouchMark(null)).toBeNull();
  });
});

describe('touchMarkAfter: dấu đổi theo máy chủ', () => {
  const an = { userId: 'u1', code: 'AN123' };
  it('chạm CTV ghi công → dấu là mã đó (thay dấu mã khác)', () => {
    expect(touchMarkAfter({ userId: 'u1', code: 'X' }, 'u1', 'an123', 'ctv', true)).toEqual(an);
  });
  it('chạm brand ghi công mã khác → xoá dấu', () => {
    expect(touchMarkAfter(an, 'u1', 'BINH9', 'brand', true)).toBeNull();
  });
  it('chạm brand ghi công cùng mã đã có dấu → giữ dấu', () => {
    expect(touchMarkAfter(an, 'u1', 'AN123', 'brand', true)).toEqual(an);
  });
  it('máy chủ không ghi công (ok:false) → giữ nguyên dấu', () => {
    expect(touchMarkAfter(an, 'u1', 'BINH9', 'brand', false)).toEqual(an);
  });
  it('ca AN123 (ctv) → BINH9 (brand) → AN123 (brand): lần cuối phải gửi được', () => {
    let mark: ReturnType<typeof parseTouchMark> = null;
    mark = touchMarkAfter(mark, 'u1', 'AN123', 'ctv', true);
    expect(touchMarkMatches(mark, 'u1', 'AN123')).toBe(true);
    mark = touchMarkAfter(mark, 'u1', 'BINH9', 'brand', true);
    expect(touchMarkMatches(mark, 'u1', 'AN123')).toBe(false);
  });
});
