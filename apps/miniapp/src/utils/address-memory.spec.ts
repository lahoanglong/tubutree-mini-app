import { describe, it, expect } from 'vitest';
import {
  LAST_GEO_KEY,
  ZALO_PREFILL_ASKED_KEY,
  hasAskedZaloPrefill,
  isLegacyGeo,
  markZaloPrefillAsked,
  pickLastGeo,
  recallLastGeo,
  rememberLastGeo,
} from './address-memory';
import type { StorageLike } from './recently-viewed';
import type { AddressDTO } from '../services/shop-api';

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

const HCM = { province: 'TP. Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Bến Nghé', wardCode: '84_VN79_001' };

function addr(over: Partial<AddressDTO>): AddressDTO {
  return {
    id: 'a', recipient: 'A', phone: '0900000000', street: '1 X', district: '', districtCode: '', isDefault: false,
    ...HCM, ...over,
  };
}

describe('rememberLastGeo / recallLastGeo (nhớ tỉnh + phường lần trước)', () => {
  it('ghi rồi đọc lại đúng 4 trường', () => {
    const s = memoryStorage();
    rememberLastGeo(HCM, s);
    expect(recallLastGeo(s)).toEqual(HCM);
    expect(Object.keys(JSON.parse(s.data[LAST_GEO_KEY]!)).sort()).toEqual(['province', 'provinceCode', 'ward', 'wardCode']);
  });

  it('chưa lưu gì → null', () => {
    expect(recallLastGeo(memoryStorage())).toBeNull();
  });

  it('thiếu mã tỉnh hoặc mã phường → không ghi (tránh điền sẵn nửa vời)', () => {
    const s = memoryStorage();
    rememberLastGeo({ ...HCM, wardCode: '' }, s);
    rememberLastGeo({ ...HCM, provinceCode: '' }, s);
    expect(LAST_GEO_KEY in s.data).toBe(false);
  });

  it("mã '00' (địa chỉ cũ chưa có mã Pancake thật) không được nhớ", () => {
    const s = memoryStorage();
    rememberLastGeo({ ...HCM, provinceCode: '00' }, s);
    rememberLastGeo({ ...HCM, wardCode: '00' }, s);
    expect(LAST_GEO_KEY in s.data).toBe(false);
  });

  it('JSON hỏng / sai kiểu → null, không throw', () => {
    const s = memoryStorage();
    s.data[LAST_GEO_KEY] = '{not json';
    expect(recallLastGeo(s)).toBeNull();
    s.data[LAST_GEO_KEY] = JSON.stringify({ province: 1, provinceCode: '84_VN79', ward: 'x', wardCode: 'y' });
    expect(recallLastGeo(s)).toBeNull();
    s.data[LAST_GEO_KEY] = JSON.stringify({ province: 'a', provinceCode: '00', ward: 'x', wardCode: '84_VN79_001' });
    expect(recallLastGeo(s)).toBeNull();
  });

  it('không có storage (null) hoặc storage ném lỗi → không crash', () => {
    expect(() => rememberLastGeo(HCM, null)).not.toThrow();
    expect(recallLastGeo(null)).toBeNull();
    const boom: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
    };
    expect(() => rememberLastGeo(HCM, boom)).not.toThrow();
    expect(recallLastGeo(boom)).toBeNull();
  });
});

describe('pickLastGeo (dự phòng từ sổ địa chỉ đã lưu)', () => {
  it('ưu tiên địa chỉ mặc định', () => {
    const list = [addr({ id: '1', provinceCode: '84_VN01', wardCode: '84_VN01_1', province: 'HN', ward: 'P1' }), addr({ id: '2', isDefault: true })];
    expect(pickLastGeo(list)).toEqual(HCM);
  });

  it('không có mặc định → lấy địa chỉ đầu có mã hợp lệ, bỏ qua mã 00', () => {
    const list = [addr({ id: '1', provinceCode: '00' }), addr({ id: '2', province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'P2', wardCode: '84_VN48_2' })];
    expect(pickLastGeo(list)).toEqual({ province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'P2', wardCode: '84_VN48_2' });
  });

  it('rỗng / undefined / toàn mã 00 → null', () => {
    expect(pickLastGeo([])).toBeNull();
    expect(pickLastGeo(undefined)).toBeNull();
    expect(pickLastGeo([addr({ wardCode: '00' })])).toBeNull();
  });
});

describe('cờ đã xin thông tin Zalo (chỉ xin 1 lần ở đơn đầu)', () => {
  it('mặc định chưa xin; đánh dấu xong thì nhớ', () => {
    const s = memoryStorage();
    expect(hasAskedZaloPrefill(s)).toBe(false);
    markZaloPrefillAsked(s);
    expect(s.data[ZALO_PREFILL_ASKED_KEY]).toBe('1');
    expect(hasAskedZaloPrefill(s)).toBe(true);
  });

  it('storage hỏng vẫn nhớ trong phiên (không xin lại mỗi lần mở form)', () => {
    const boom: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
    };
    markZaloPrefillAsked(boom);
    expect(hasAskedZaloPrefill(boom)).toBe(true);
  });
});

describe('khoá theo tài khoản (máy dùng chung / đổi tài khoản)', () => {
  it('tỉnh/phường người trước lưu không điền sẵn cho tài khoản khác', () => {
    const s = memoryStorage();
    rememberLastGeo(HCM, s, 'u1');
    expect(recallLastGeo(s, 'u1')).toEqual(HCM);
    expect(recallLastGeo(s, 'u2')).toBeNull();
    expect(recallLastGeo(s)).toBeNull();
  });

  it('tài khoản khác vẫn được xin quyền Zalo dù người trước đã xin', () => {
    const s = memoryStorage();
    markZaloPrefillAsked(s, 'u1');
    expect(hasAskedZaloPrefill(s, 'u1')).toBe(true);
    expect(hasAskedZaloPrefill(s, 'u2')).toBe(false);
  });

  it('storage hỏng: cờ trong bộ nhớ cũng tách theo tài khoản', () => {
    const boom: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
    };
    markZaloPrefillAsked(boom, 'u9');
    expect(hasAskedZaloPrefill(boom, 'u9')).toBe(true);
    expect(hasAskedZaloPrefill(boom, 'u10')).toBe(false);
  });
});

describe('isLegacyGeo — địa chỉ không gửi được sang Pancake', () => {
  it('mã "00", mã tỉnh trước 2025, thiếu phường → cũ; mã 84_VN đủ tỉnh + phường → mới', () => {
    expect(isLegacyGeo({ provinceCode: '00', wardCode: '00' })).toBe(true);
    expect(isLegacyGeo({ provinceCode: '79', wardCode: '26734' })).toBe(true);
    expect(isLegacyGeo({ provinceCode: '84_VN79', wardCode: '' })).toBe(true);
    expect(isLegacyGeo({ provinceCode: '84_VN79', wardCode: '84_VN79_001' })).toBe(false);
  });
});
