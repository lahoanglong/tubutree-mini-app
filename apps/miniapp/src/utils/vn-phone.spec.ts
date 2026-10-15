import { describe, expect, it } from 'vitest';
import { parseTypedVnPhone } from './vn-phone';

describe('parseTypedVnPhone — cùng luật SĐT người nhận với máy chủ (R5-CHECKOUT-2)', () => {
  it.each([
    ['0922222221', '0922222221'],
    ['+84922222221', '0922222221'],
    ['84922222221', '0922222221'],
    ['+84 92 222 2221', '0922222221'],
    ['092.222.2221', '0922222221'],
    ['092-222-2221', '0922222221'],
    [' 0922 222 221 ', '0922222221'],
  ])('%j → %j', (raw, expected) => {
    expect(parseTypedVnPhone(raw)).toBe(expected);
  });

  it.each(['', 'abc', '922222221', '0922 222 22', '09222222211', '+840922222221', '0012345678', 'tel: 0922222221'])('%j → null', (raw) => {
    expect(parseTypedVnPhone(raw)).toBeNull();
  });
});
