import { describe, expect, it } from 'vitest';
import { createBlockedHint, defaultPointId, missingItemsReason, parseQtyInput, readLastPointId, timelineCaption, wasteItemIconKey, writeLastPointId } from './waste-copy';

describe('parseQtyInput', () => {
  it('chỉ giữ chữ số và kẹp vào khoảng', () => {
    expect(parseQtyInput('30', 0, 999)).toBe(30);
    expect(parseQtyInput('3o0', 0, 999)).toBe(30);
    expect(parseQtyInput('5000', 0, 999)).toBe(999);
    expect(parseQtyInput('', 0, 999)).toBe(0);
    expect(parseQtyInput('abc', 1, 9)).toBe(1);
    expect(parseQtyInput('0', 1, 9)).toBe(1);
  });
});

describe('missingItemsReason', () => {
  it('món chỉ kho nhận thì nói rõ', () => {
    expect(missingItemsReason([{ name: 'Vỏ hộp sữa', warehouseOnly: true }])).toBe('Đại lý không nhận Vỏ hộp sữa, món này chỉ kho TP.HCM nhận');
  });
  it('món khác thì như cũ, trộn thì ghi cả hai', () => {
    expect(missingItemsReason([{ name: 'Pin' }])).toBe('Điểm này không nhận: Pin');
    expect(missingItemsReason([{ name: 'Vỏ chai', warehouseOnly: true }, { name: 'Pin' }])).toBe('Đại lý không nhận Vỏ chai, món này chỉ kho TP.HCM nhận. Điểm này không nhận: Pin');
  });
});

describe('createBlockedHint', () => {
  const ok = { selected: true, needsPoint: true, pointChosen: true, consentsOk: true };
  it('nêu đúng việc khách còn thiếu theo thứ tự', () => {
    expect(createBlockedHint({ ...ok, selected: false })).toMatch(/cách giao/);
    expect(createBlockedHint({ ...ok, pointChosen: false })).toMatch(/điểm nhận/);
    expect(createBlockedHint({ ...ok, consentsOk: false })).toMatch(/đồng ý/);
    expect(createBlockedHint(ok)).toBeNull();
    expect(createBlockedHint({ ...ok, needsPoint: false, pointChosen: false })).toBeNull();
  });
});

describe('timelineCaption', () => {
  it('đánh số bước và nói hoàn tất', () => {
    const steps = ['Đã tạo', 'Mang tới điểm', 'Điểm nhận đếm', 'Cộng điểm'];
    expect(timelineCaption(steps, 1)).toBe('Bước 2/4: Mang tới điểm');
    expect(timelineCaption(steps, 4)).toBe('Hoàn tất');
  });
});

describe('điểm nhận chọn sẵn', () => {
  const pts = [
    { id: 'a', quotaFull: false, acceptedItemIds: ['x'], distanceKm: 4 },
    { id: 'b', quotaFull: false, acceptedItemIds: ['x', 'y'], distanceKm: 2 },
    { id: 'c', quotaFull: true, acceptedItemIds: ['x'], distanceKm: 1 },
    { id: 'd', quotaFull: false, acceptedItemIds: ['x'], distanceKm: null },
  ];
  it('ưu tiên điểm lần trước nếu còn dùng được', () => {
    expect(defaultPointId(pts, ['x'], 'd')).toBe('d');
    expect(defaultPointId(pts, ['x'], 'c')).toBe('b');
  });
  it('không có điểm lần trước thì lấy điểm gần nhất dùng được, bỏ điểm hết hạn mức và điểm thiếu món', () => {
    expect(defaultPointId(pts, ['x', 'y'], null)).toBe('b');
    expect(defaultPointId(pts, ['x'], null)).toBe('b');
  });
  it('không có vị trí và không có lần trước thì để khách tự chọn', () => {
    expect(defaultPointId(pts.map((p) => ({ ...p, distanceKm: null })), ['x'], null)).toBeNull();
  });
  it('lưu điểm lần trước chịu được kho lưu hỏng', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    writeLastPointId(store, 'p1');
    expect(readLastPointId(store)).toBe('p1');
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readLastPointId(broken)).toBeNull();
    expect(() => writeLastPointId(broken, 'p1')).not.toThrow();
    expect(readLastPointId(undefined)).toBeNull();
  });
});

describe('wasteItemIconKey', () => {
  it('biểu tượng theo mã món, mã lạ không có', () => {
    expect(wasteItemIconKey('MILK_CARTON')).toBe('milk');
    expect(wasteItemIconKey('KHAC')).toBeNull();
  });
});
