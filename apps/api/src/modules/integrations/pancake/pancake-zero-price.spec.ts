import {
  ZERO_PRICE_LIST_CAP,
  ZERO_PRICE_LOG_CAP,
  ZERO_PRICE_STATE_KEY,
  ZeroPriceCollector,
  classifyZeroPrice,
  isGiftMarked,
  parseZeroPrice,
  readZeroPrice,
  recordZeroPrice,
  summarizeZeroPrice,
  zeroPriceLogLine,
  type ZeroPriceAnomaly,
} from './pancake-zero-price';

const sold = { retailPrice: 89_000, isActive: true, pancakeHold: null };
const input = (over: Record<string, unknown> = {}) => ({ retail: 0, removed: false, gift: false, prev: sold, ...over }) as Parameters<typeof classifyZeroPrice>[0];
const anomaly = (id: string, over: Partial<ZeroPriceAnomaly> = {}): ZeroPriceAnomaly => ({
  pancakeId: id,
  sku: `SKU-${id}`,
  productName: `Sản phẩm ${id}`,
  kind: 'PRICE_KEPT',
  keptPrice: 89_000,
  ...over,
});

describe('classifyZeroPrice — chỉ số 0 tường minh mới là "Pancake báo giá 0đ"', () => {
  it.each([[0], ['0'], ['0.00']])('retail_price=%p trên biến thể đang bán giá dương → PRICE_KEPT', (retail) => {
    expect(classifyZeroPrice(input({ retail }))).toBe('PRICE_KEPT');
  });

  it('biến thể mới (chưa có dòng) hoặc chưa từng có giá dương → NEW_AT_ZERO', () => {
    expect(classifyZeroPrice(input({ prev: null }))).toBe('NEW_AT_ZERO');
    expect(classifyZeroPrice(input({ prev: { retailPrice: 0, isActive: false, pancakeHold: 'NO_PRICE' } }))).toBe('NEW_AT_ZERO');
  });

  it.each([[undefined], [null], [-5], [Number.NaN], ['abc'], [{}], [89_000], ['79.000'], ['0.000']])('retail_price=%p không phải 0 ("0.000" khớp mẫu ngăn nghìn nên không đọc được) → không báo', (retail) => {
    expect(classifyZeroPrice(input({ retail }))).toBeNull();
  });

  it('biến thể Pancake đã xoá, quà tặng có cờ, hoặc admin tắt tay → không báo', () => {
    expect(classifyZeroPrice(input({ removed: true }))).toBeNull();
    expect(classifyZeroPrice(input({ gift: true }))).toBeNull();
    expect(classifyZeroPrice(input({ prev: { ...sold, isActive: false, pancakeHold: null } }))).toBeNull();
  });

  it('biến thể do chính đồng bộ ngừng (REMOVED) rồi Pancake trả lại với giá 0đ → vẫn báo, vì lượt này mở bán lại theo giá cũ', () => {
    expect(classifyZeroPrice(input({ prev: { ...sold, isActive: false, pancakeHold: 'REMOVED' } }))).toBe('PRICE_KEPT');
  });

  it('isGiftMarked: chỉ `is_gift === true`, chuỗi/số không tính', () => {
    expect(isGiftMarked({ is_gift: true })).toBe(true);
    for (const x of [false, 'true', 1, null, undefined]) expect(isGiftMarked({ is_gift: x })).toBe(false);
  });
});

describe('ZeroPriceCollector', () => {
  it('ghi sau cùng thắng: cùng mã biến thể báo rồi hết báo thì thành "đã sửa"', () => {
    const c = new ZeroPriceCollector();
    c.note('a', anomaly('a'));
    c.note('b', anomaly('b'));
    c.note('c', null);
    expect(c.found.map((x) => x.pancakeId)).toEqual(['a', 'b']);
    expect([...c.resolved]).toEqual(['c']);
    c.note('a', null);
    c.note('c', anomaly('c'));
    expect(c.found.map((x) => x.pancakeId)).toEqual(['b', 'c']);
    expect([...c.resolved]).toEqual(['a']);
  });
});

describe('summarizeZeroPrice / zeroPriceLogLine', () => {
  it('đếm theo loại, cắt danh sách lưu ở trần nhưng giữ count thật', () => {
    const many = Array.from({ length: ZERO_PRICE_LIST_CAP + 5 }, (_, i) => anomaly(String(i), i % 2 ? { kind: 'NEW_AT_ZERO', keptPrice: null } : {}));
    const s = summarizeZeroPrice(many, 'FULL', new Date('2026-11-13T01:00:00.000Z'));
    expect(s).toMatchObject({ scope: 'FULL', count: ZERO_PRICE_LIST_CAP + 5, truncated: true, updatedAt: '2026-11-13T01:00:00.000Z' });
    expect(s.skus).toHaveLength(ZERO_PRICE_LIST_CAP);
    expect(s.keptCount + s.newCount).toBe(s.count);
  });

  it('dòng log có JSON đọc lại được: sự kiện, số đếm, SKU, và `more` khi bị cắt', () => {
    const many = Array.from({ length: ZERO_PRICE_LOG_CAP + 3 }, (_, i) => anomaly(String(i)));
    const line = zeroPriceLogLine(summarizeZeroPrice(many, 'INCREMENTAL'));
    const json = JSON.parse(line.slice(line.indexOf('{"event"')));
    expect(json).toMatchObject({ event: 'pancake.zeroPriceAnomalies', scope: 'INCREMENTAL', count: ZERO_PRICE_LOG_CAP + 3, more: 3 });
    expect(json.skus).toHaveLength(ZERO_PRICE_LOG_CAP);
    expect(json.skus[0]).toEqual({ sku: 'SKU-0', pancakeId: '0', kind: 'PRICE_KEPT', keptPrice: 89_000 });
    expect(line).toContain(`${ZERO_PRICE_LOG_CAP + 3} biến thể`);
  });
});

describe('parseZeroPrice — cột Json đọc phòng thủ', () => {
  it.each([[null], [undefined], ['x'], [5], [{}], [{ skus: 'x' }]])('%p → null', (d) => {
    expect(parseZeroPrice(d)).toBeNull();
  });

  it('bỏ phần tử sai dạng, giữ phần tử đúng; ngày hỏng không ném', () => {
    const s = parseZeroPrice({ scope: 'FULL', updatedAt: 'không phải ngày', skus: [anomaly('a'), null, { sku: 'x' }, 5] })!;
    expect(s.skus.map((x) => x.pancakeId)).toEqual(['a']);
    expect(s.scope).toBe('FULL');
    expect(s.updatedAt).toBe(new Date(0).toISOString());
  });

  it('count lưu lớn hơn số SKU lưu được (đã cắt) thì giữ số thật', () => {
    const s = parseZeroPrice({ scope: 'FULL', updatedAt: '2026-11-13T00:00:00.000Z', count: 300, keptCount: 200, newCount: 100, skus: [anomaly('a')] })!;
    expect(s).toMatchObject({ count: 300, keptCount: 200, newCount: 100, truncated: true });
  });
});

describe('recordZeroPrice / readZeroPrice — hàng ops_health_states', () => {
  const NOW = new Date('2026-11-13T02:00:00.000Z');
  function store(initial: unknown = null) {
    let detail: unknown = initial;
    const findUnique = jest.fn(async () => (detail === null ? null : { detail }));
    const upsert = jest.fn(async ({ update }: { update: { detail: unknown } }) => {
      detail = update.detail;
    });
    return { prisma: { opsHealthState: { findUnique, upsert } } as never, findUnique, upsert, get: () => detail as ReturnType<typeof summarizeZeroPrice> };
  }

  it('lượt quét toàn bộ trọn vẹn: thay hẳn danh sách cũ, kể cả khi lượt này rỗng (SKU đã sửa trên Pancake biến mất)', async () => {
    const s = store(summarizeZeroPrice([anomaly('old')], 'FULL'));
    await recordZeroPrice(s.prisma, { replace: true, found: [anomaly('new')], resolved: new Set() }, NOW);
    expect(s.upsert.mock.calls[0]![0]).toMatchObject({ where: { key: ZERO_PRICE_STATE_KEY } });
    expect(s.get().skus.map((x) => x.pancakeId)).toEqual(['new']);
    await recordZeroPrice(s.prisma, { replace: true, found: [], resolved: new Set() }, NOW);
    expect(s.get()).toMatchObject({ count: 0, skus: [], scope: 'FULL' });
    expect(s.findUnique).not.toHaveBeenCalled();
  });

  it('lượt tăng dần: gộp SKU mới vào danh sách cũ, thay bản ghi cùng mã, gỡ SKU đã hết 0đ', async () => {
    const s = store(summarizeZeroPrice([anomaly('a'), anomaly('b', { keptPrice: 50_000 }), anomaly('c')], 'FULL'));
    await recordZeroPrice(
      s.prisma,
      { replace: false, found: [anomaly('b', { keptPrice: 60_000 }), anomaly('d')], resolved: new Set(['a', 'zzz']) },
      NOW,
    );
    const ids = s.get().skus.map((x) => `${x.pancakeId}:${x.keptPrice}`);
    expect(ids).toEqual(['c:89000', 'b:60000', 'd:89000']);
    expect(s.get()).toMatchObject({ count: 3, scope: 'FULL' });
  });

  it('lượt tăng dần không có gì để báo hay gỡ → không đọc, không ghi', async () => {
    const s = store(summarizeZeroPrice([anomaly('a')], 'FULL'));
    expect(await recordZeroPrice(s.prisma, { replace: false, found: [], resolved: new Set() }, NOW)).toBeNull();
    expect(s.findUnique).not.toHaveBeenCalled();
    expect(s.upsert).not.toHaveBeenCalled();
  });

  it('lượt tăng dần chỉ đọc SKU không nằm trong danh sách (danh sách không đổi) → không ghi lại', async () => {
    const s = store(summarizeZeroPrice([anomaly('a')], 'FULL'));
    await recordZeroPrice(s.prisma, { replace: false, found: [], resolved: new Set(['khac']) }, NOW);
    expect(s.findUnique).toHaveBeenCalledTimes(1);
    expect(s.upsert).not.toHaveBeenCalled();
  });

  it('chưa có hàng nào: lượt tăng dần tạo danh sách mới; readZeroPrice trả rỗng khi chưa từng ghi', async () => {
    const s = store(null);
    expect((await readZeroPrice(s.prisma)).count).toBe(0);
    await recordZeroPrice(s.prisma, { replace: false, found: [anomaly('x')], resolved: new Set() }, NOW);
    expect(await readZeroPrice(s.prisma)).toMatchObject({ count: 1, scope: 'INCREMENTAL' });
  });
});
