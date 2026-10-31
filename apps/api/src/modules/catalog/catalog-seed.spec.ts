import { SEED_PATTERN, seedHash, seededOrder, vnDateSeed } from './catalog-seed';

const row = (id: string, brandId: string | null = null) => ({ id, brandId });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const many = (n: number, brand = () => 'b') => Array.from({ length: n }, (_, i) => row(`p${String(i).padStart(2, '0')}`, brand()));

describe('SEED_PATTERN', () => {
  it('nhận ngày YYYYMMDD, từ chối dạng khác', () => {
    expect(SEED_PATTERN.test('20261101')).toBe(true);
    for (const bad of ['2026-11-01', '1234567', '123456789', 'abc', '', '20261301', '20261100', '20261132']) expect(SEED_PATTERN.test(bad)).toBe(false);
  });
});

describe('vnDateSeed', () => {
  it('ngày theo giờ Việt Nam, qua nửa đêm VN thì đổi ngày dù UTC chưa đổi; khớp SEED_PATTERN', () => {
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 16, 59, 59))).toBe('20261031');
    expect(vnDateSeed(Date.UTC(2026, 9, 31, 17, 0, 0))).toBe('20261101');
    expect(vnDateSeed(Date.UTC(2026, 11, 31, 17, 0, 0))).toBe('20270101');
    expect(SEED_PATTERN.test(vnDateSeed(Date.UTC(2026, 0, 5, 3, 0, 0)))).toBe(true);
  });
});

describe('seedHash', () => {
  it('xác định: cùng seed và id cho cùng số, là số nguyên không dấu 32-bit', () => {
    const h = seedHash('20261101', 'abc');
    expect(seedHash('20261101', 'abc')).toBe(h);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
  it('khác seed hoặc khác id cho số khác', () => {
    expect(seedHash('20261101', 'abc')).not.toBe(seedHash('20261102', 'abc'));
    expect(seedHash('20261101', 'abc')).not.toBe(seedHash('20261101', 'abd'));
  });
});

describe('seededOrder', () => {
  it('cùng seed → cùng thứ tự, dù đầu vào xáo khác nhau', () => {
    const rows = many(20);
    const a = ids(seededOrder(rows, '20261101'));
    expect(ids(seededOrder(rows, '20261101'))).toEqual(a);
    expect(ids(seededOrder([...rows].reverse(), '20261101'))).toEqual(a);
  });
  it('khác ngày → thứ tự khác, vẫn đủ món không trùng', () => {
    const rows = many(20);
    const a = ids(seededOrder(rows, '20261101'));
    const b = ids(seededOrder(rows, '20261102'));
    expect(b).not.toEqual(a);
    expect([...b].sort()).toEqual(ids(rows));
  });
  it('không quá 2 món liền nhau cùng nhãn khi còn món nhãn khác để xen', () => {
    const rows = [...many(6, () => 'A'), ...many(6, () => 'B').map((r) => ({ ...r, id: `b${r.id}` }))];
    for (const seed of ['20261101', '20261102', '20261103']) {
      const out = seededOrder(rows, seed);
      for (let i = 2; i < out.length; i++) {
        const run = out[i]!.brandId === out[i - 1]!.brandId && out[i]!.brandId === out[i - 2]!.brandId;
        expect({ seed, i, run }).toEqual({ seed, i, run: false });
      }
    }
  });
  it('một nhãn duy nhất: không xen được thì giữ thứ tự hash, không mất món', () => {
    const rows = many(8);
    const out = seededOrder(rows, '20261101');
    expect(out).toHaveLength(8);
    expect(ids(out)).toEqual([...rows].sort((x, y) => seedHash('20261101', x.id) - seedHash('20261101', y.id)).map((r) => r.id));
  });
  it('brandId null không bị coi là cùng một nhãn', () => {
    const rows = many(6, () => null as unknown as string).map((r) => ({ ...r, brandId: null }));
    expect(ids(seededOrder(rows, '20261101'))).toHaveLength(6);
  });
  it('đầu vào rỗng', () => {
    expect(seededOrder([], '20261101')).toEqual([]);
  });
});
