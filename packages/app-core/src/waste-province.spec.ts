import { describe, expect, it } from 'vitest';
import { sameProvince } from './waste-province';

describe('sameProvince', () => {
  it('mã địa chỉ 84_VN79 và mã điểm nhận 79 là cùng một tỉnh', () => {
    expect(sameProvince('84_VN79', '79')).toBe(true);
    expect(sameProvince('79', '84_VN79')).toBe(true);
    expect(sameProvince('84_VN79', '84_VN79')).toBe(true);
    expect(sameProvince('79', '79')).toBe(true);
  });
  it('khác tỉnh thì không khớp, không nhầm 7 với 79', () => {
    expect(sameProvince('84_VN01', '79')).toBe(false);
    expect(sameProvince('84_VN7', '79')).toBe(false);
  });
  it('mã lạ so nguyên chuỗi', () => {
    expect(sameProvince('hcm', 'hcm')).toBe(true);
    expect(sameProvince('hcm', '79')).toBe(false);
  });
});
