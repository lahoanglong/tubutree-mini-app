import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WASTE_SEED_GIFTS, WASTE_SEED_ITEMS, wasteGiftUpsertArgs, wasteItemUpsertArgs,
} from './waste-seed-data';

const SQL = readFileSync(join(__dirname, '../../../prisma/migrations/20261020000000_waste_exchange/migration.sql'), 'utf-8');
const SEED = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');

const item = (id: string, code: string, name: string, unitLabel: string, n: number, m: number, drops: number, day: number | null, month: number | null, status: 'ACTIVE' | 'COMING_SOON', prep: string | null, sort: number, hazardous: boolean, warehouseOnly = false) =>
  ({ id, code, name, unitLabel, unitsPerPoint: n, pointsPerGroup: m, dropsPerUnit: drops, dailyCapQty: day, monthlyCapQty: month, status, prepInstructions: prep, sortOrder: sort, hazardous, warehouseOnly });

const EXPECTED_ITEMS = [
  item('wi-carton', 'CARTON', 'Thùng carton cũ', 'thùng', 1, 1000, 0, 10, 60, 'ACTIVE', 'Gấp phẳng, giữ khô và sạch.', 10, false),
  item('wi-bubble-wrap', 'BUBBLE_WRAP', 'Nilon chống sốc', 'túi lớn', 1, 1000, 0, 10, 60, 'ACTIVE', 'Túi còn nguyên, khô, không dính băng keo hay nhãn.', 20, false),
  item('wi-milk-carton', 'MILK_CARTON', 'Vỏ hộp sữa sạch', 'vỏ', 5, 1000, 0, 50, 300, 'ACTIVE', 'Rửa sạch, để ráo, ép dẹt.', 30, false, true),
  item('wi-tubu-bottle', 'TUBU_BOTTLE', 'Vỏ chai, hộp Tubu Tree', 'vỏ', 1, 2000, 2, null, 20, 'ACTIVE', 'Vỏ chai hoặc hộp Tubu Tree đã dùng hết, rửa sạch, để ráo.', 40, false, true),
  item('wi-battery', 'BATTERY', 'Pin đã dùng', 'viên', 10, 1000, 0, 20, 50, 'COMING_SOON', 'Dán băng keo hai đầu cực. Không nhận pin phồng, chảy nước, pin xe điện hay ắc quy.', 50, true),
];

const gift = (id: string, kind: 'VOUCHER' | 'TREE', name: string, description: string, label: string | null, cost: number, sort: number, v: [ 'FREESHIP' | 'AMOUNT' | 'PERCENT', number, number, number | null ] | null) =>
  ({
    id, kind, name, description, label, pointsCost: cost, status: 'ACTIVE' as const, sortOrder: sort,
    voucherType: v ? v[0] : null, voucherValue: v ? v[1] : null, voucherMinOrder: v ? v[2] : null, voucherMaxDiscount: v ? v[3] : null, voucherValidDays: v ? 30 : null,
  });

const EXPECTED_GIFTS = [
  gift('reward-freeship', 'VOUCHER', 'Miễn phí vận chuyển', 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.', 'Phổ biến', 20_000, 10, ['FREESHIP', 0, 99000, null]),
  gift('reward-discount-50k', 'VOUCHER', 'Giảm 50.000đ', 'Giảm ngay 50.000đ cho đơn hàng từ 300.000đ', 'Tiết kiệm', 50_000, 20, ['AMOUNT', 50000, 300000, null]),
  gift('reward-percent-15pct', 'VOUCHER', 'Giảm 15%', 'Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ', 'Đặc quyền', 75_000, 30, ['PERCENT', 15, 250000, 80000]),
  gift('reward-discount-100k', 'VOUCHER', 'Giảm 100.000đ', 'Giảm ngay 100.000đ cho đơn hàng từ 600.000đ', 'HOT', 100_000, 40, ['AMOUNT', 100000, 600000, null]),
  gift('gift-tree', 'TREE', 'Góp quỹ trồng cây', 'Dùng Điểm Xanh góp vào quỹ trồng cây của Tubu Tree.', null, 0, 50, null),
];

const FORBIDDEN = /cây\s+thật|\bmua (1 )?cây\b|CO2|CO₂|hấp thụ|giảm khí thải|tái chế|Mã chứng nhận|PanNature|Rừng Xanh Lên|Voucher|Mã ưu đãi|TubuXu|Cổng đối tác|Kênh Đối Tác|\/merchant|(?<![\p{L}_])xu(?![\p{L}_])/iu;
// case-sensitive on purpose: only the lowercase form is banned, "Điểm Xanh" is the required spelling (spec 16.1)
const FORBIDDEN_LOWERCASE = /điểm Xanh/u;

describe('waste reference data constants', () => {
  it('items match contract section 6 (ids, rates, caps, status, hazardous) and only milk cartons and Tubu bottles are warehouse-only', () => {
    expect(WASTE_SEED_ITEMS).toEqual(EXPECTED_ITEMS);
  });
  it('gifts match contract section 6 and keep the legacy ids', () => {
    expect(WASTE_SEED_GIFTS).toEqual(EXPECTED_GIFTS);
  });
  it('gift names are the mockup 16 names: no "Voucher", no "Mã giảm giá" prefix, sortOrder 10/20/30/40 (decision 6)', () => {
    const vouchers = WASTE_SEED_GIFTS.filter((g) => g.kind === 'VOUCHER');
    expect(vouchers.map((g) => [g.id, g.name, g.sortOrder])).toEqual([
      ['reward-freeship', 'Miễn phí vận chuyển', 10],
      ['reward-discount-50k', 'Giảm 50.000đ', 20],
      ['reward-percent-15pct', 'Giảm 15%', 30],
      ['reward-discount-100k', 'Giảm 100.000đ', 40],
    ]);
    for (const g of WASTE_SEED_GIFTS) {
      expect(g.name).not.toMatch(/voucher/i);
      expect(g.name).not.toMatch(/^mã giảm giá/i);
    }
  });
  it('the three monthly caps of the first three items equal 60000 points, as spec 5.1 requires', () => {
    const points = WASTE_SEED_ITEMS.slice(0, 3).map((i) => Math.floor(i.monthlyCapQty! / i.unitsPerPoint) * i.pointsPerGroup);
    expect(points).toEqual([60_000, 60_000, 60_000]);
  });
  it('customer-visible text contains no forbidden word', () => {
    const texts = [
      ...WASTE_SEED_ITEMS.flatMap((i) => [i.name, i.unitLabel, i.prepInstructions ?? '']),
      ...WASTE_SEED_GIFTS.flatMap((g) => [g.name, g.description, g.label ?? '']),
    ];
    expect(texts.filter((t) => FORBIDDEN.test(t) || FORBIDDEN_LOWERCASE.test(t))).toEqual([]);
    expect(texts.filter((t) => t.includes("'"))).toEqual([]);
  });
  it('upsert args never overwrite an existing row', () => {
    expect(wasteItemUpsertArgs(WASTE_SEED_ITEMS[0]!)).toEqual({ where: { id: 'wi-carton' }, update: {}, create: WASTE_SEED_ITEMS[0] });
    expect(wasteGiftUpsertArgs(WASTE_SEED_GIFTS[4]!)).toEqual({ where: { id: 'gift-tree' }, update: {}, create: WASTE_SEED_GIFTS[4] });
  });
  it('seeds no receiving point and copies no legacy refill pickup location (spec 11.7, 13.1, 18.2 question 10)', () => {
    expect(SQL).not.toMatch(/INSERT\s+INTO\s+"waste_points"/i);
    expect(SQL).not.toMatch(/refill_pickup_locations|rpl-seed-default/);
    expect(SEED).not.toMatch(/wastePoint\.(create|createMany|upsert)\(/);
  });
});

// Hàng pin trong migration gốc (20261020000000) còn là Sắp nhận; migration 20261027000000 mới đưa lên mức hiện hành, nên phần so khớp migration gốc dùng giá trị cũ.
const ORIGINAL_BATTERY = { unitsPerPoint: 1, pointsPerGroup: 1000, dailyCapQty: null, monthlyCapQty: null, status: 'COMING_SOON', prepInstructions: null };

const q = (v: string | number | boolean | null) => (v === null ? 'NULL' : typeof v === 'string' ? `'${v}'` : String(v));
const cols = (names: string[]) => names.map((c) => `"${c}"`).join(', ');

function renderItems(): string {
  const names = ['id', 'code', 'name', 'unitLabel', 'unitsPerPoint', 'pointsPerGroup', 'dropsPerUnit', 'dailyCapQty', 'monthlyCapQty', 'status', 'prepInstructions', 'sortOrder', 'hazardous'];
  const rows = WASTE_SEED_ITEMS.map((raw) => {
    const i = raw.id === 'wi-battery' ? { ...raw, ...ORIGINAL_BATTERY } : raw;
    return `  (${names.map((n) => q((i as unknown as Record<string, string | number | boolean | null>)[n]!)).join(', ')}, NOW())`;
  });
  return `INSERT INTO "waste_items" (${cols(names)}, "updatedAt") VALUES\n${rows.join(',\n')}\nON CONFLICT DO NOTHING;`;
}
function renderGifts(): string {
  const names = ['id', 'kind', 'name', 'description', 'label', 'pointsCost', 'status', 'sortOrder', 'voucherType', 'voucherValue', 'voucherMinOrder', 'voucherMaxDiscount', 'voucherValidDays'];
  const rows = WASTE_SEED_GIFTS.map((g) => `  (${names.map((n) => q((g as unknown as Record<string, string | number | boolean | null>)[n]!)).join(', ')}, NOW())`);
  return `INSERT INTO "waste_gifts" (${cols(names)}, "updatedAt") VALUES\n${rows.join(',\n')}\nON CONFLICT DO NOTHING;`;
}

describe('waste reference data in the migration and in seed.ts', () => {
  const a = SQL.indexOf('-- BEGIN WASTE SEED DATA');
  const b = SQL.indexOf('-- END WASTE SEED DATA');
  const body = a >= 0 && b > a ? SQL.slice(a, b).split('\n').filter((l) => !l.startsWith('--')).join('\n').trim() : '';

  it('migration section equals the rendering of the constants (so prod and dev seed the same rows)', () => {
    expect(a).toBeGreaterThanOrEqual(0);
    expect(body).toBe(`${renderItems()}\n${renderGifts()}`);
  });
  it('migration 20261027000000 bỏ CHECK nguy hại và nạp mức tính điểm của pin, giữ Sắp nhận, chỉ động tới món BATTERY', () => {
    const sql = readFileSync(join(__dirname, '../../../prisma/migrations/20261027000000_waste_battery_ready/migration.sql'), 'utf-8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join(' ').replace(/\s+/g, ' ').trim();
    const battery = WASTE_SEED_ITEMS.find((i) => i.code === 'BATTERY')!;
    expect(sql).toContain('ALTER TABLE "waste_items" DROP CONSTRAINT IF EXISTS "waste_items_hazardous_not_active_chk";');
    expect(sql).toContain(`SET "unitsPerPoint" = ${battery.unitsPerPoint}, "pointsPerGroup" = ${battery.pointsPerGroup}, "dailyCapQty" = ${battery.dailyCapQty}, "monthlyCapQty" = ${battery.monthlyCapQty}, "prepInstructions" = '${battery.prepInstructions}'`);
    expect(sql).toContain(`WHERE "code" = 'BATTERY' AND "hazardous" = true;`);
    expect(sql.match(/UPDATE/g)).toHaveLength(1);
    expect(sql).not.toMatch(/"status"/);
    expect(battery.status).toBe('COMING_SOON');
    expect(sql).not.toMatch(/waste_point_items|INSERT/i);
    expect(battery.warehouseOnly).toBe(false);
  });
  it('no seed tuple can be mistaken for a notification template tuple by the template spec', () => {
    expect(body.match(/\('[^']+', '([A-Z_]+)', '[A-Z]+', '([^']*)'\)/g)).toBeNull();
  });
  it('seed.ts calls seedWasteReferenceData exactly once, after the template block', () => {
    expect(SEED.match(/await seedWasteReferenceData\(\)/g)).toHaveLength(1);
    expect(SEED.indexOf('await seedWasteReferenceData()')).toBeGreaterThan(SEED.indexOf('NOTIFICATION_TEMPLATES.length} templates'));
    expect(SEED).toContain('wasteItemUpsertArgs');
  });
});
