import { lineDrops, linePoints, requestTotals, unitsToNextPoint, type WasteRateSnapshot } from './waste-points';

const snap = (unitsPerPoint: number, pointsPerGroup: number, dropsPerUnit = 0, gramsPerUnit: number | null = null): WasteRateSnapshot => ({ unitsPerPoint, pointsPerGroup, dropsPerUnit, gramsPerUnit });

describe('points formula (spec 11.2): floor(qty / N) * M per line, fractions do not carry', () => {
  it('linePoints', () => {
    expect(linePoints(11, snap(5, 1000))).toBe(2000);
    expect(linePoints(4, snap(5, 1000))).toBe(0);
    expect(linePoints(5, snap(5, 1000))).toBe(1000);
    expect(linePoints(7, snap(1, 1000))).toBe(7000);
    expect(linePoints(3, snap(1, 2000))).toBe(6000);
    expect(linePoints(0, snap(1, 1000))).toBe(0);
  });
  it('lineDrops is qty times dropsPerUnit', () => {
    expect(lineDrops(3, snap(1, 2000, 2))).toBe(6);
    expect(lineDrops(10, snap(1, 1000, 0))).toBe(0);
  });
  it('unitsToNextPoint is the full group size on an exact multiple', () => {
    expect(unitsToNextPoint(4, snap(5, 1000))).toBe(1);
    expect(unitsToNextPoint(5, snap(5, 1000))).toBe(5);
    expect(unitsToNextPoint(0, snap(5, 1000))).toBe(5);
    expect(unitsToNextPoint(9, snap(1, 1000))).toBe(1);
  });
  it('requestTotals sums lines, and grams is null as soon as one line has no weight', () => {
    expect(requestTotals([{ qty: 11, snap: snap(5, 1000, 0, 100) }, { qty: 3, snap: snap(1, 2000, 2, 50) }])).toEqual({ points: 8000, drops: 6, grams: 1250 });
    expect(requestTotals([{ qty: 11, snap: snap(5, 1000, 0, 100) }, { qty: 3, snap: snap(1, 2000, 2, null) }])).toEqual({ points: 8000, drops: 6, grams: null });
  });
});
