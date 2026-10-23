import { isWithinHours } from './chat-hours';
import { newConversationCode } from './conversation-code';

const HOURS = { start: '08:00', end: '21:00' };
// 07:59 giờ VN = 00:59 UTC
const vn = (hhmm: string) => new Date(`2026-10-23T${hhmm}:00+07:00`);

describe('isWithinHours', () => {
  it('theo giờ VN, nửa mở [start, end)', () => {
    expect(isWithinHours(vn('07:59'), HOURS)).toBe(false);
    expect(isWithinHours(vn('08:00'), HOURS)).toBe(true);
    expect(isWithinHours(vn('20:59'), HOURS)).toBe(true);
    expect(isWithinHours(vn('21:00'), HOURS)).toBe(false);
  });
});

describe('newConversationCode', () => {
  it('4 ký tự trong bảng không có 0 O 1 I', () => {
    for (let i = 0; i < 200; i++) expect(newConversationCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
  it('random = 0 và gần 1 vẫn trong bảng', () => {
    expect(newConversationCode(() => 0)).toBe('AAAA');
    expect(newConversationCode(() => 0.999999)).toBe('9999');
  });
});
