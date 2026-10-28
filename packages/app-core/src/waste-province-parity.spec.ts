import { describe, expect, it } from 'vitest';
import * as shared from '../../shared-types/src/waste-province';
import * as core from './waste-province';

// app-core giữ bản sao riêng (shared-types là CJS, import giá trị kéo thư viện vào web); spec này buộc hai bản cho cùng kết quả.
const CODES = ['84_VN79', '79', '84_VN01', '01', '1', '84_VN7', '7', '84_VN', '84_VNabc', 'hcm', '', '84_VN079', '  79', '84_vn79'];

describe('provinceKey / sameProvince: app-core khớp shared-types', () => {
  it.each(CODES)('provinceKey(%j)', (c) => {
    expect(core.provinceKey(c)).toBe(shared.provinceKey(c));
  });
  it('sameProvince cùng kết quả trên mọi cặp', () => {
    for (const a of CODES) for (const b of CODES) expect(core.sameProvince(a, b)).toBe(shared.sameProvince(a, b));
  });
});
