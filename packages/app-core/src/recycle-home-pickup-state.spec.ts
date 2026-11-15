import { describe, expect, it } from 'vitest';
import { WASTE_HOME_PICKUP_MAX_GRAMS, WASTE_HOME_PICKUP_MIN_GRAMS } from '../../shared-types/src/waste';
import {
  HOME_PICKUP_WEIGHT_CHIPS_GRAMS,
  defaultHomePickupWeight,
  estimateLinesGrams,
  homePickupBatteryBlocked,
  homePickupCreateBody,
  homePickupEnabled,
  homePickupKgLabel,
  homePickupQuoteRequest,
  isHcmProvince,
  pickHomePickupAddress,
} from './recycle-home-pickup-state';

describe('isHcmProvince: cùng bảng ca với spec của máy chủ', () => {
  it.each(['Thành phố Hồ Chí Minh', 'TP. Hồ Chí Minh', 'TP.HCM', 'tp hcm', 'Hồ Chí Minh', 'Ho Chi Minh City', 'THÀNH PHỐ HỒ CHÍ MINH', ' Sài Gòn '])('nhận %s', (v) => {
    expect(isHcmProvince(v)).toBe(true);
  });
  it.each(['Hà Nội', 'Bình Dương', 'Thành phố Thủ Đức', 'Đồng Nai', 'Tỉnh Hồ Chí Minh Xa', '', null, undefined])('từ chối %s', (v) => {
    expect(isHcmProvince(v as string | null | undefined)).toBe(false);
  });
});

describe('chip số kg', () => {
  it('nằm trong khoảng máy chủ nhận và tăng dần', () => {
    for (const g of HOME_PICKUP_WEIGHT_CHIPS_GRAMS) {
      expect(g).toBeGreaterThanOrEqual(WASTE_HOME_PICKUP_MIN_GRAMS);
      expect(g).toBeLessThanOrEqual(WASTE_HOME_PICKUP_MAX_GRAMS);
    }
    expect([...HOME_PICKUP_WEIGHT_CHIPS_GRAMS]).toEqual([...HOME_PICKUP_WEIGHT_CHIPS_GRAMS].sort((a, b) => a - b));
    expect(HOME_PICKUP_WEIGHT_CHIPS_GRAMS[0]).toBe(WASTE_HOME_PICKUP_MIN_GRAMS);
    expect(HOME_PICKUP_WEIGHT_CHIPS_GRAMS[HOME_PICKUP_WEIGHT_CHIPS_GRAMS.length - 1]).toBe(WASTE_HOME_PICKUP_MAX_GRAMS);
  });
  it('nhãn kg dùng dấu phẩy kiểu Việt', () => {
    expect(homePickupKgLabel(500)).toBe('0,5');
    expect(homePickupKgLabel(2000)).toBe('2');
    expect(homePickupKgLabel(10_000)).toBe('10');
  });
  it('mặc định: mức nhỏ nhất không thấp hơn ước lượng, chưa ước được thì 1 kg, quá mức lớn nhất thì 10 kg', () => {
    expect(defaultHomePickupWeight(0)).toBe(1000);
    expect(defaultHomePickupWeight(Number.NaN)).toBe(1000);
    expect(defaultHomePickupWeight(300)).toBe(500);
    expect(defaultHomePickupWeight(1500)).toBe(2000);
    expect(defaultHomePickupWeight(5000)).toBe(5000);
    expect(defaultHomePickupWeight(99_999)).toBe(10_000);
  });
  it('ước lượng gram từ các dòng, món thiếu gram không góp', () => {
    const items = [{ id: 'a', gramsPerUnit: 200 }, { id: 'b', gramsPerUnit: null }, { id: 'c', gramsPerUnit: 50 }];
    expect(estimateLinesGrams([{ itemId: 'a', declaredQty: 5 }, { itemId: 'b', declaredQty: 9 }, { itemId: 'c', declaredQty: 2 }, { itemId: 'zz', declaredQty: 3 }], items)).toBe(1100);
  });
});

describe('homePickupEnabled', () => {
  it('cần cả cờ công khai, cờ của khách và không bị khoá vận chuyển', () => {
    expect(homePickupEnabled({ cfgPickup: true, lanePickup: true, shipLocked: false })).toBe(true);
    expect(homePickupEnabled({ cfgPickup: false, lanePickup: true, shipLocked: false })).toBe(false);
    expect(homePickupEnabled({ cfgPickup: true, lanePickup: false, shipLocked: false })).toBe(false);
    expect(homePickupEnabled({ cfgPickup: true, lanePickup: true, shipLocked: true })).toBe(false);
  });
});

describe('Pin cũ ngoài TP.HCM', () => {
  const items = [{ id: 'carton', hazardous: false }, { id: 'battery', hazardous: true }];
  it('chặn khi có Pin trong các dòng và tỉnh không phải TP.HCM', () => {
    expect(homePickupBatteryBlocked([{ itemId: 'battery', declaredQty: 10 }], items, 'Hà Nội')).toBe(true);
    expect(homePickupBatteryBlocked([{ itemId: 'battery', declaredQty: 10 }], items, undefined)).toBe(true);
  });
  it('không chặn ở TP.HCM, hoặc khi không có Pin', () => {
    expect(homePickupBatteryBlocked([{ itemId: 'battery', declaredQty: 10 }], items, 'Thành phố Hồ Chí Minh')).toBe(false);
    expect(homePickupBatteryBlocked([{ itemId: 'carton', declaredQty: 5 }], items, 'Hà Nội')).toBe(false);
  });
});

describe('chọn địa chỉ', () => {
  const list = [{ id: 'a' }, { id: 'b', isDefault: true }, { id: 'c' }];
  it('giữ cái khách chọn, không thì mặc định, rồi cái đầu', () => {
    expect(pickHomePickupAddress(list, 'c')?.id).toBe('c');
    expect(pickHomePickupAddress(list, 'gone')?.id).toBe('b');
    expect(pickHomePickupAddress(list, null)?.id).toBe('b');
    expect(pickHomePickupAddress([{ id: 'a' }, { id: 'c' }], null)?.id).toBe('a');
    expect(pickHomePickupAddress([], null)).toBeNull();
  });
});

describe('thân báo phí và thân tạo đơn', () => {
  const lines = [{ itemId: 'item-milk', declaredQty: 5 }, { itemId: 'item-carton', declaredQty: 3 }];
  const form = { addressId: 'addr-1', weightGrams: 2000 };
  it('báo phí: xếp món theo itemId, thiếu địa chỉ / kg / món thì null', () => {
    expect(homePickupQuoteRequest(form, lines)).toEqual({
      addressId: 'addr-1',
      declaredWeightGrams: 2000,
      lines: [{ itemId: 'item-carton', declaredQty: 3 }, { itemId: 'item-milk', declaredQty: 5 }],
    });
    expect(homePickupQuoteRequest({ ...form, addressId: null }, lines)).toBeNull();
    expect(homePickupQuoteRequest({ ...form, weightGrams: null }, lines)).toBeNull();
    expect(homePickupQuoteRequest(form, [])).toBeNull();
  });
  it('tạo đơn: đúng thân HOME_PICKUP, kèm phiên bản thể lệ nếu có', () => {
    expect(homePickupCreateBody({ form, lines, consentVersion: 'v3' })).toEqual({
      method: 'HOME_PICKUP',
      lines: [{ itemId: 'item-carton', declaredQty: 3 }, { itemId: 'item-milk', declaredQty: 5 }],
      consent: true,
      consentVersion: 'v3',
      pickupAddressId: 'addr-1',
      declaredWeightGrams: 2000,
      usePointsForShipFee: true,
    });
    expect(homePickupCreateBody({ form, lines })).not.toHaveProperty('consentVersion');
    expect(homePickupCreateBody({ form: { ...form, addressId: null }, lines })).toBeNull();
  });
  it('phí ship chỉ trả bằng Điểm Xanh: luôn gửi usePointsForShipFee true, không có ô chọn cách trả', () => {
    expect(homePickupCreateBody({ form, lines })?.usePointsForShipFee).toBe(true);
    expect(homePickupCreateBody({ form: { ...form, weightGrams: 500 }, lines })?.usePointsForShipFee).toBe(true);
  });
});
