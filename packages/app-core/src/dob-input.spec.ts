import { describe, expect, it } from 'vitest';
import { DOB_ERRORS, maskDobInput, validateDobVn } from './dob-input';

const NOW = new Date(2026, 10, 1, 9, 30);

describe('maskDobInput', () => {
  it('thêm dấu / khi gõ số liền nhau', () => {
    expect(maskDobInput('05')).toBe('05');
    expect(maskDobInput('0503')).toBe('05/03');
    expect(maskDobInput('05031990')).toBe('05/03/1990');
  });
  it('bỏ ký tự lạ và giới hạn 8 số', () => {
    expect(maskDobInput('05a/03-1990999')).toBe('05/03/1990');
  });
  it('gõ ngày/tháng một số rồi / thì tự thêm số 0', () => {
    expect(maskDobInput('5/3/1990')).toBe('05/03/1990');
    expect(maskDobInput('5/')).toBe('05');
    expect(maskDobInput('05/3/')).toBe('05/03');
  });
  it('xoá lùi về dấu / không bị dính lại', () => {
    expect(maskDobInput('05/')).toBe('05');
    expect(maskDobInput('05/0')).toBe('05/0');
  });
});

describe('maskDobInput sửa giữa ô và dấu ngăn khác', () => {
  const prev = '05/03/1990';
  it('xoá chữ số đầu không bị đệm số 0 lại', () => {
    expect(maskDobInput('0/03/1990', prev)).toBe('0/03/1990');
    expect(maskDobInput('05/0/1990', prev)).toBe('05/0/1990');
  });
  it('chèn giữa hoặc bôi đen thay không đổi năm', () => {
    expect(maskDobInput('05/103/1990', prev)).toBe('05/103/1990');
    expect(maskDobInput('05/0/1990', prev)).toBe('05/0/1990');
    expect(maskDobInput('05/03/11990', prev).slice(0, 6)).toBe('05/03/');
  });
  it('gõ tiến: dấu ngăn vừa gõ ở cuối ô thì thêm số 0', () => {
    expect(maskDobInput('5/', '5')).toBe('05');
    expect(maskDobInput('05/3/', '05/3')).toBe('05/03');
    expect(maskDobInput('5.', '5')).toBe('05');
  });
  it('gõ từng ký tự hết 8 số vẫn ra dd/mm/yyyy', () => {
    let v = '';
    for (const ch of '05031990') v = maskDobInput(v + ch, v);
    expect(v).toBe('05/03/1990');
    v = '';
    for (const ch of '5.3.1990') v = maskDobInput(v + ch, v);
    expect(v).toBe('05/03/1990');
  });
  it('coi . - khoảng trắng như /', () => {
    expect(maskDobInput('5.3.1990')).toBe('05/03/1990');
    expect(maskDobInput('5-3-1990')).toBe('05/03/1990');
    expect(maskDobInput('5 3 1990')).toBe('05/03/1990');
    expect(maskDobInput('05.03.1990')).toBe('05/03/1990');
  });
  it('gõ liền 8 số vẫn ra dd/mm/yyyy', () => {
    expect(maskDobInput('05031990')).toBe('05/03/1990');
  });
});

describe('validateDobVn', () => {
  it('để trống thì không lỗi, không có ngày', () => {
    expect(validateDobVn('', NOW)).toEqual({ iso: null, error: null });
  });
  it('đủ ngày hợp lệ trả về ISO yyyy-mm-dd', () => {
    expect(validateDobVn('05/03/1990', NOW)).toEqual({ iso: '1990-03-05', error: null });
  });
  it('gõ dở thì báo nhập đủ dd/mm/yyyy', () => {
    expect(validateDobVn('05/03', NOW)).toEqual({ iso: null, error: DOB_ERRORS.incomplete });
    expect(DOB_ERRORS.incomplete).toMatch(/dd\/mm\/yyyy|ngày\/tháng\/năm/);
    expect(DOB_ERRORS.incomplete).toMatch(/2 số/);
  });
  it('29/02 chỉ có ở năm nhuận', () => {
    expect(validateDobVn('29/02/2000', NOW).iso).toBe('2000-02-29');
    expect(validateDobVn('29/02/1996', NOW).iso).toBe('1996-02-29');
    expect(validateDobVn('29/02/1900', NOW)).toEqual({ iso: null, error: DOB_ERRORS.notReal });
    expect(validateDobVn('29/02/2023', NOW)).toEqual({ iso: null, error: DOB_ERRORS.notReal });
  });
  it('ngày không có thật', () => {
    expect(validateDobVn('31/04/1990', NOW).error).toBe(DOB_ERRORS.notReal);
    expect(validateDobVn('00/01/1990', NOW).error).toBe(DOB_ERRORS.notReal);
    expect(validateDobVn('10/13/1990', NOW).error).toBe(DOB_ERRORS.notReal);
  });
  it('không cho ngày tương lai, hôm nay vẫn được', () => {
    expect(validateDobVn('02/11/2026', NOW)).toEqual({ iso: null, error: DOB_ERRORS.future });
    expect(validateDobVn('01/11/2026', NOW).iso).toBe('2026-11-01');
    expect(validateDobVn('01/01/2999', NOW).error).toBe(DOB_ERRORS.future);
  });
  it('năm quá xa (trước 1900) báo kiểm tra lại năm', () => {
    expect(validateDobVn('01/01/1850', NOW)).toEqual({ iso: null, error: DOB_ERRORS.tooOld });
  });
  it('dùng ngày theo giờ máy, không lệch múi giờ khi khuya', () => {
    const lateNight = new Date(2026, 10, 1, 23, 59);
    expect(validateDobVn('01/11/2026', lateNight).iso).toBe('2026-11-01');
  });
});
