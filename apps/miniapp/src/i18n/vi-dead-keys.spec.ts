import { describe, expect, it } from 'vitest';
import { vi } from './vi';

/** D8-18: hai câu `${n} điểm` thô không qua formatPoints, không màn nào dùng (nhãn thật ở utils/checkout-rules.ts). */
describe('vi.checkout không giữ câu điểm chết (D8-18)', () => {
  it.each(['pointsUse', 'pointsAvailable'])('%s đã xoá', (key) => {
    expect(Object.keys(vi.checkout)).not.toContain(key);
  });
});
