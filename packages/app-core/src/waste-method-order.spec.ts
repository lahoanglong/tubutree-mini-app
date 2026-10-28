import { describe, expect, it } from 'vitest';
import type { WastePreviewDTO } from '@tubutree/shared-types';
import { isMethodLocked, orderWasteMethods } from './waste-method-order';

const pv = (...codes: string[]) => ({ blocks: codes.map((code) => ({ code })) }) as unknown as WastePreviewDTO;
const ALL = ['DROP_OFF', 'PICKUP', 'MAIL_IN'] as const;

describe('orderWasteMethods', () => {
  it('thứ tự gốc; tỉnh chưa có điểm nhận thì Gửi về kho lên đầu', () => {
    const open = { DROP_OFF: pv(), PICKUP: pv(), MAIL_IN: pv() };
    expect(orderWasteMethods(ALL, open, false)).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN']);
    expect(orderWasteMethods(ALL, open, true)).toEqual(['MAIL_IN', 'PICKUP', 'DROP_OFF']);
  });
  it('thẻ khoá xếp cuối, giữ thứ tự tương đối; NEED_PROVINCE không tính là khoá', () => {
    expect(orderWasteMethods(ALL, { DROP_OFF: pv('BELOW_MIN'), PICKUP: pv('NEED_PROVINCE'), MAIL_IN: pv() }, false)).toEqual(['PICKUP', 'MAIL_IN', 'DROP_OFF']);
    expect(isMethodLocked(pv('NEED_PROVINCE'))).toBe(false);
  });
  it('chưa đủ kết quả xem trước thì không xếp lại, để thẻ không nhảy chỗ', () => {
    expect(orderWasteMethods(ALL, { DROP_OFF: pv('BELOW_MIN'), PICKUP: undefined, MAIL_IN: pv() }, false)).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN']);
  });
  it('chỉ giữ các cách đang bật', () => {
    expect(orderWasteMethods(['MAIL_IN', 'DROP_OFF'], { DROP_OFF: pv(), MAIL_IN: pv() }, false)).toEqual(['DROP_OFF', 'MAIL_IN']);
  });
  it('xem trước lỗi vẫn tính là đã có kết quả, thẻ khoá khác vẫn xuống cuối', () => {
    expect(orderWasteMethods(ALL, { DROP_OFF: pv('BELOW_MIN'), PICKUP: undefined, MAIL_IN: pv() }, false, ['PICKUP'])).toEqual(['PICKUP', 'MAIL_IN', 'DROP_OFF']);
  });
  it('thẻ đang lỗi không bị xếp cuối theo kết quả cũ của tỉnh khác', () => {
    expect(orderWasteMethods(ALL, { DROP_OFF: pv(), PICKUP: pv(), MAIL_IN: pv('NO_POINT') }, false, ['MAIL_IN'])).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN']);
    expect(orderWasteMethods(ALL, { DROP_OFF: pv('BELOW_MIN'), PICKUP: pv(), MAIL_IN: pv('NO_POINT') }, false, ['MAIL_IN'])).toEqual(['PICKUP', 'MAIL_IN', 'DROP_OFF']);
  });
});
