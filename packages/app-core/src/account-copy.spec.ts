import { describe, expect, it } from 'vitest';
import { formatDobDisplay, profileCopy } from './account-copy';

describe('formatDobDisplay', () => {
  it('đổi yyyy-MM-dd sang dd/MM/yyyy', () => {
    expect(formatDobDisplay('1990-05-01')).toBe('01/05/1990');
  });

  it.each([null, undefined, '', '1990-5-1', '01/05/1990', 'abc'])('giá trị %s không phải ngày thì trả rỗng', (v) => {
    expect(formatDobDisplay(v)).toBe('');
  });
});

describe('profileCopy', () => {
  it('câu xác nhận nêu ngày theo dd/MM/yyyy', () => {
    expect(profileCopy.dobConfirm('01/05/1990')).toBe('Ngày sinh 01/05/1990 chỉ đặt được một lần. Xác nhận?');
  });
});
