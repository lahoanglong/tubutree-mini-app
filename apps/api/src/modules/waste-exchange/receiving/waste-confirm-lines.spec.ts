import { BadRequestException, ConflictException } from '@nestjs/common';
import { validateConfirmLines, type WasteStoredLine } from './waste-confirm-lines';

const L = (o: Partial<WasteStoredLine> = {}): WasteStoredLine => ({
  id: 'l1',
  itemId: 'wi-carton',
  declaredQty: 10,
  unitsPerPoint: 1,
  pointsPerGroup: 1000,
  dropsPerUnit: 0,
  gramsPerUnit: null,
  ...o,
});

const STALE = 'Khách vừa sửa yêu cầu, vui lòng tra lại mã';
const CLAMP = 'Số thực nhận phải là số nguyên từ 0 tới số khai';
const NEED_REASON = 'Dòng nhận thiếu phải có lý do';

describe('validateConfirmLines (spec 15.5 step 5, 11.2)', () => {
  it('1. full receipt', () => {
    expect(validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }])).toEqual([
      { lineId: 'l1', itemId: 'wi-carton', declaredQty: 10, receivedQty: 10, shortfallReason: null, pointsAwarded: 10_000, drops: 0 },
    ]);
  });

  it('2. multi-line total', () => {
    const stored = [
      L({ id: 'l2', itemId: 'wi-milk-carton', declaredQty: 12, unitsPerPoint: 5 }),
      L({ id: 'l3', itemId: 'wi-tubu-bottle', declaredQty: 3, pointsPerGroup: 2000, dropsPerUnit: 2 }),
    ];
    const out = validateConfirmLines(stored, [
      { itemId: 'wi-tubu-bottle', declaredQty: 3, receivedQty: 3 },
      { itemId: 'wi-milk-carton', declaredQty: 12, receivedQty: 12 },
    ]);
    expect(out.map((l) => l.lineId)).toEqual(['l2', 'l3']);
    expect(out[0]?.pointsAwarded).toBe(2000);
    expect(out[1]?.pointsAwarded).toBe(6000);
    expect(out[1]?.drops).toBe(6);
    expect(out.reduce((s, l) => s + l?.pointsAwarded, 0)).toBe(8000);
  });

  it('3. a fraction of a group is not carried', () => {
    const [l] = validateConfirmLines(
      [L({ itemId: 'wi-milk-carton', declaredQty: 12, unitsPerPoint: 5 })],
      [{ itemId: 'wi-milk-carton', declaredQty: 12, receivedQty: 4, shortfallReason: 'DIRTY' }],
    );
    expect(l?.pointsAwarded).toBe(0);
    expect(l?.shortfallReason).toBe('DIRTY');
  });

  describe('4. body must match the stored lines', () => {
    const expect409 = (fn: () => unknown) => {
      expect(fn).toThrow(ConflictException);
      expect(fn).toThrow(STALE);
    };
    it('missing body line', () => {
      expect409(() => validateConfirmLines([L(), L({ id: 'l2', itemId: 'wi-can' })], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }]));
    });
    it('extra body line', () => {
      expect409(() =>
        validateConfirmLines([L()], [
          { itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 },
          { itemId: 'wi-can', declaredQty: 1, receivedQty: 1 },
        ]),
      );
    });
    it('itemId not stored', () => {
      expect409(() => validateConfirmLines([L()], [{ itemId: 'wi-can', declaredQty: 10, receivedQty: 10 }]));
    });
    it('duplicated itemId', () => {
      expect409(() =>
        validateConfirmLines([L(), L({ id: 'l2', itemId: 'wi-can' })], [
          { itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 },
          { itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 },
        ]),
      );
    });
    it('declaredQty edited', () => {
      expect409(() => validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 9, receivedQty: 9 }]));
    });
  });

  describe('5. receivedQty clamp', () => {
    it.each([11, -1, 2.5])('rejects %p', (receivedQty) => {
      const fn = () => validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty, shortfallReason: 'WET' }]);
      expect(fn).toThrow(BadRequestException);
      expect(fn).toThrow(CLAMP);
    });
  });

  it('6. short without a reason is refused, with a reason is kept', () => {
    const bad = () => validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 7 }]);
    expect(bad).toThrow(BadRequestException);
    expect(bad).toThrow(NEED_REASON);
    const [l] = validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 7, shortfallReason: 'WET' }]);
    expect(l?.shortfallReason).toBe('WET');
  });

  it('7. full receipt ignores a stray reason', () => {
    const [l] = validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10, shortfallReason: 'WET' }]);
    expect(l?.shortfallReason).toBeNull();
  });

  describe('8. pin (hazardous = xử lý riêng, vẫn nhận và cộng điểm)', () => {
    const pin = L({ itemId: 'wi-battery', unitsPerPoint: 10, pointsPerGroup: 1000, declaredQty: 25 });
    it('nhận đủ 25 viên: 2 nhóm 10 viên = 2.000 điểm', () => {
      const [l] = validateConfirmLines([pin], [{ itemId: 'wi-battery', declaredQty: 25, receivedQty: 25 }]);
      expect(l?.pointsAwarded).toBe(2000);
      expect(l?.shortfallReason).toBeNull();
    });
    it('nhận thiếu 15 viên vì sai loại: 1 nhóm = 1.000 điểm, vẫn phải có lý do', () => {
      const [l] = validateConfirmLines([pin], [{ itemId: 'wi-battery', declaredQty: 25, receivedQty: 15, shortfallReason: 'DAMAGED' }]);
      expect(l?.pointsAwarded).toBe(1000);
      expect(() => validateConfirmLines([pin], [{ itemId: 'wi-battery', declaredQty: 25, receivedQty: 15 }])).toThrow(NEED_REASON);
    });
    it('đếm 0 kèm WRONG_TYPE (pin phồng, chảy nước) cũng được, không cộng điểm', () => {
      const [l] = validateConfirmLines([pin], [{ itemId: 'wi-battery', declaredQty: 25, receivedQty: 0, shortfallReason: 'WRONG_TYPE' }]);
      expect(l?.pointsAwarded).toBe(0);
    });
  });

  it('9. battery mixed into a carton line', () => {
    expect(validateConfirmLines([L()], [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 0, shortfallReason: 'FOREIGN_OBJECT' }])).toEqual([
      { lineId: 'l1', itemId: 'wi-carton', declaredQty: 10, receivedQty: 0, shortfallReason: 'FOREIGN_OBJECT', pointsAwarded: 0, drops: 0 },
    ]);
  });
});
