import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkCaps, remainingQty } from './waste-caps';

const items = new Map([
  ['carton', { id: 'carton', name: 'Thùng carton', unitLabel: 'thùng', dailyCapQty: 20, monthlyCapQty: 60 }],
  ['film', { id: 'film', name: 'Màng xốp', unitLabel: 'túi', dailyCapQty: null, monthlyCapQty: 10 }],
]);
const usage = (o: Partial<{ day: [string, number][]; month: [string, number][]; points: number }> = {}) => ({
  itemDay: new Map(o.day ?? []), itemMonth: new Map(o.month ?? []), pointsMonth: o.points ?? 0, openCount: 0, pickupPendingCode: null,
});

describe('remainingQty', () => {
  it('null cap = unlimited; never negative', () => {
    expect(remainingQty(null, 99)).toBeNull();
    expect(remainingQty(20, 5)).toBe(15);
    expect(remainingQty(20, 25)).toBe(0);
  });
});

describe('checkCaps (spec 11.2; 5.3)', () => {
  const base = { items, monthlyCapPoints: 60_000, checkDay: true };
  it('exactly at every cap passes', () => {
    expect(checkCaps({ ...base, lines: [{ itemId: 'carton', declaredQty: 15 }], usage: usage({ day: [['carton', 5]], month: [['carton', 45]], points: 45_000 }), estimatedPoints: 15_000 })).toEqual([]);
  });
  it('day cap first, then month cap, then points cap, all reported', () => {
    expect(checkCaps({ ...base, lines: [{ itemId: 'carton', declaredQty: 16 }], usage: usage({ day: [['carton', 5]], month: [['carton', 45]], points: 45_000 }), estimatedPoints: 16_000 })).toEqual([
      { code: 'ITEM_DAY_CAP', itemId: 'carton', remaining: 15 },
      { code: 'ITEM_MONTH_CAP', itemId: 'carton', remaining: 15 },
      { code: 'POINTS_MONTH_CAP', remaining: 15_000 },
    ]);
  });
  it('checkDay false skips the day cap (MAIL_IN, PICKUP, REOPEN)', () => {
    expect(checkCaps({ ...base, checkDay: false, lines: [{ itemId: 'carton', declaredQty: 21 }], usage: usage(), estimatedPoints: 21_000 })).toEqual([]);
  });
  it('an item without a day cap is limited by month only', () => {
    expect(checkCaps({ ...base, lines: [{ itemId: 'film', declaredQty: 11 }], usage: usage(), estimatedPoints: 0 })).toEqual([{ code: 'ITEM_MONTH_CAP', itemId: 'film', remaining: 10 }]);
  });
});

describe('waste code reads calendar time through common/vn-time.ts (spec 15.1)', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };
  it('no non-spec file under modules/waste-exchange calls Date setHours or getMonth', () => {
    const root = join(__dirname, '..');
    const offenders = walk(root).filter((f) => /\.(setHours|getMonth)\(/.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
