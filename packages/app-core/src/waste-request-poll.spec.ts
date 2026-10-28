import { describe, expect, it } from 'vitest';
import { wasteRequestRefetchMs } from './waste-request-poll';

describe('wasteRequestRefetchMs', () => {
  it('đang mở mã QR: 5 giây một lần', () => expect(wasteRequestRefetchMs('OPEN', true)).toBe(5_000));
  it('yêu cầu còn chờ (OPEN) mà không mở QR: 15 giây một lần', () => expect(wasteRequestRefetchMs('OPEN', false)).toBe(15_000));
  it('chưa có dữ liệu, đã xong hay đã huỷ: không hỏi lại', () => {
    for (const status of [undefined, 'COMPLETED', 'CANCELLED', 'EXPIRED']) expect(wasteRequestRefetchMs(status, true)).toBe(false);
  });
});
