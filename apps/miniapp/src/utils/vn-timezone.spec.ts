import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatWalletTxTime } from '@tubutree/app-core/wallet-rules';
import { shippingEtaLabel } from '@tubutree/app-core/shipping-eta';
import { validateDobVn } from '@tubutree/app-core/dob-input';
import { formatDate, formatDateTime } from './format';

// vitest-global-setup ghim TZ=Asia/Ho_Chi_Minh cho cả worker, nên chỉ đổi múi giờ ở đây mới bắt được hàm đọc giờ máy.
describe.each(['America/New_York', 'UTC', 'Pacific/Auckland'])('giờ khách đọc theo Việt Nam khi máy ở %s', (tz) => {
  let before: string | undefined;
  beforeAll(() => {
    before = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });

  it('múi giờ máy thật sự đã đổi (kiểm chứng chính phép thử)', () => {
    const offset = new Date('2026-10-05T01:07:00.000Z').getTimezoneOffset();
    expect(offset).not.toBe(-420);
  });

  it('formatDate, formatDateTime', () => {
    expect(formatDateTime('2026-10-05T01:07:00.000Z')).toBe('08:07 05/10/2026');
    expect(formatDateTime('2026-10-05T17:30:00.000Z')).toBe('00:30 06/10/2026');
    expect(formatDate('2026-10-05T17:30:00.000Z')).toBe('06/10/2026');
  });

  it('giờ ví', () => {
    expect(formatWalletTxTime('2026-10-05T01:07:00.000Z')).toBe('05/10 08:07');
    expect(formatWalletTxTime('2026-10-05T17:30:00.000Z')).toBe('06/10 00:30');
  });

  it('ngày giao dự kiến lấy ngày lịch Việt Nam của "bây giờ"', () => {
    // 18:00 UTC ngày 05/10 đã là 01:00 ngày 06/10 ở Việt Nam.
    expect(shippingEtaLabel({ minDays: 1, maxDays: 3 }, new Date('2026-10-05T18:00:00.000Z'))).toBe('07/10 – 09/10');
  });

  it('ngày sinh: "hôm nay" theo ngày Việt Nam', () => {
    const now = new Date('2026-10-05T18:00:00.000Z');
    expect(validateDobVn('06/10/2026', now)).toEqual({ iso: '2026-10-06', error: null });
    expect(validateDobVn('07/10/2026', now).error).not.toBeNull();
  });
});
