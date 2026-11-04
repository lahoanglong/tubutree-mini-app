import { describe, it, expect } from 'vitest';
import { pickLastGeo, recallLastGeo, rememberLastGeo, LAST_GEO_KEY, type GeoStorageLike } from './address-geo-memory';

const hcm = { province: 'TP HCM', provinceCode: '84_VN701', ward: 'Bến Nghé', wardCode: '84_VN7010001' };
const hn = { province: 'Hà Nội', provinceCode: '84_VN101', ward: 'Ba Đình', wardCode: '84_VN1010001' };

function mem(): GeoStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('address-geo-memory', () => {
  it('nhớ và đọc lại theo từng tài khoản', () => {
    const s = mem();
    rememberLastGeo(hcm, s, 'u1');
    expect(s.data.has(`${LAST_GEO_KEY}:u1`)).toBe(true);
    expect(recallLastGeo(s, 'u1')).toEqual(hcm);
    expect(recallLastGeo(s, 'u2')).toBeNull();
  });
  it('không nhớ mã địa giới cũ', () => {
    const s = mem();
    rememberLastGeo({ ...hcm, wardCode: '00' }, s);
    expect(s.data.size).toBe(0);
  });
  it('pickLastGeo ưu tiên địa chỉ mặc định, bỏ địa chỉ mã cũ', () => {
    const legacy = { province: 'X', provinceCode: '79', ward: 'Y', wardCode: '00', isDefault: true };
    expect(pickLastGeo([legacy, { ...hcm, isDefault: false }, { ...hn, isDefault: true }])).toEqual(hn);
    expect(pickLastGeo([legacy])).toBeNull();
    expect(pickLastGeo(undefined)).toBeNull();
  });
});
