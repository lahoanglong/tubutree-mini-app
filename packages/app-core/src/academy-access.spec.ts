import { describe, expect, it } from 'vitest';
import { canSeeAcademy } from './account-copy';
import { canUseAcademy } from './academy-access';

describe('canUseAcademy', () => {
  it('CTV, đại lý, nhân viên, admin được vào', () => {
    for (const r of ['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']) expect(canUseAcademy(r)).toBe(true);
  });
  it('khách thường, vai lạ hoặc chưa có vai thì không', () => {
    for (const r of ['CUSTOMER', 'x', '', null, undefined]) expect(canUseAcademy(r)).toBe(false);
  });
});

describe('canSeeAcademy (tên cũ ở account-copy)', () => {
  it('cho cùng kết quả với canUseAcademy ở mọi vai', () => {
    for (const r of ['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN', 'CUSTOMER', 'x', '', null, undefined]) {
      expect(canSeeAcademy(r), String(r)).toBe(canUseAcademy(r));
    }
  });
});
