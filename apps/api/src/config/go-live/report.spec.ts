import { exitCodeFor, formatReport, summarize } from './report';
import { fail, pass, warn } from './types';

const P = pass('Nhóm A', 'a.one', 'Mục một', 'ổn');
const W = warn('Nhóm A', 'a.two', 'Mục hai', 'hơi lạ', 'Làm việc X.');
const F = fail('Nhóm B', 'b.three', 'Mục ba', 'hỏng', 'Làm việc Y.');

describe('report', () => {
  it('đếm từng loại', () => {
    expect(summarize([P, W, F, F])).toEqual({ pass: 1, warn: 1, fail: 2 });
    expect(summarize([])).toEqual({ pass: 0, warn: 0, fail: 0 });
  });

  it('thoát 1 khi có FAIL, 0 khi chỉ có WARN hoặc PASS', () => {
    expect(exitCodeFor([P, W, F])).toBe(1);
    expect(exitCodeFor([P, W])).toBe(0);
    expect(exitCodeFor([P])).toBe(0);
    expect(exitCodeFor([])).toBe(0);
  });

  it('bảng có tiêu đề nhóm, thẻ trạng thái và cách sửa cho WARN/FAIL', () => {
    const text = formatReport([P, W, F]);
    expect(text).toContain('== Nhóm A ==');
    expect(text).toContain('== Nhóm B ==');
    expect(text).toContain('[PASS] a.one');
    expect(text).toContain('[WARN] a.two');
    expect(text).toContain('[FAIL] b.three');
    expect(text).toContain('cách sửa: Làm việc X.');
    expect(text).toContain('cách sửa: Làm việc Y.');
    expect(text).toContain('Tổng: 1 PASS, 1 WARN, 1 FAIL');
  });

  it('dòng PASS không có cách sửa', () => {
    expect(formatReport([P])).not.toContain('cách sửa');
  });

  it('kết luận theo mức nặng nhất', () => {
    expect(formatReport([P, W, F])).toContain('CHƯA ĐẠT');
    expect(formatReport([P, W])).toContain('ĐẠT, nhưng còn WARN');
    expect(formatReport([P])).toMatch(/Kết luận: ĐẠT\.$/);
  });

  it('gộp nhóm theo thứ tự xuất hiện, không lặp tiêu đề liên tiếp', () => {
    const text = formatReport([P, W, F]);
    expect(text.match(/== Nhóm A ==/g)).toHaveLength(1);
  });
});
