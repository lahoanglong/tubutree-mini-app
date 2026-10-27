import { cancelReasonNote } from './cancel-reasons';

describe('cancelReasonNote', () => {
  it('mã hợp lệ → ghi chú; thiếu mã → null', () => {
    expect(cancelReasonNote('CHANGED_MIND', undefined)).toMatch(/^Khách huỷ: /);
    expect(cancelReasonNote(undefined, 'x')).toBeNull();
  });

  it('tên thuộc tính của Object (constructor, toString, __proto__) không phải mã lý do', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(cancelReasonNote(code, 'x')).toBeNull();
    }
  });
});
