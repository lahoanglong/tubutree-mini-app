import { OpsInboxService, INBOX_COUNT_CONCURRENCY } from './ops-inbox.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Mọi model trả 0 / null; đếm số lần chạm DB bằng `calls`, số việc chạy cùng lúc bằng `peak`. */
function harness(env: Record<string, unknown> = {}, delayMs = 0) {
  const calls = { n: 0 };
  let running = 0;
  const peak = { n: 0 };
  const tick = async <T>(v: T, measured: boolean): Promise<T> => {
    calls.n += 1;
    if (measured) {
      running += 1;
      peak.n = Math.max(peak.n, running);
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (measured) running -= 1;
    return v;
  };
  // `peak` chỉ đo bảng orders: mỗi hộp chạm orders tối đa một câu tại một thời điểm, nên đỉnh đó bằng số hộp đang chạy cùng lúc.
  const model = (name: string) =>
    new Proxy({}, { get: (_t, op) => (op === 'count' ? () => tick(0, name === 'order') : () => tick(null, name === 'order')) });
  const prisma = new Proxy({ $queryRaw: () => tick([{ n: 0 }], false) }, { get: (t, k) => (k in t ? (t as never)[k] : model(String(k))) }) as unknown as PrismaService;
  const settle = jest.fn(async () => 2);
  const merchant = { countOverdue: jest.fn(async () => 0), countStoresToSettle: settle } as unknown as MerchantFulfilmentService;
  const config = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as unknown as SystemConfigService;
  const svc = new OpsInboxService(prisma, merchant, config, { get: (k: string) => env[k] ?? '' } as never);
  return { svc, calls, peak, settle };
}

const ADMIN = { role: 'ADMIN' };
const KHO = { role: 'STAFF', staffPermissions: ['KHO'] };
const KE_TOAN = { role: 'STAFF', staffPermissions: ['KE_TOAN'] };

describe('OpsInboxService — cache 20 giây theo phạm vi người xem (L3-04)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cùng phạm vi gọi hai lần chỉ đếm một lần', async () => {
    const { svc, calls } = harness();
    const a = await svc.counts(ADMIN);
    const afterFirst = calls.n;
    expect(afterFirst).toBeGreaterThan(10);
    const b = await svc.counts(ADMIN);
    expect(calls.n).toBe(afterFirst);
    expect(b).toEqual(a);
  });

  it('hai người cùng thấy một tập hộp (cùng nhóm quyền) dùng chung kết quả; khác nhóm thì đếm riêng và không lộ hộp của nhau', async () => {
    const { svc, calls } = harness();
    await svc.counts(KHO);
    const afterKho = calls.n;
    await svc.counts({ role: 'STAFF', staffPermissions: ['KHO'] });
    expect(calls.n).toBe(afterKho);

    const toan = await svc.counts(KE_TOAN);
    expect(calls.n).toBeGreaterThan(afterKho);
    const kho = await svc.counts(KHO);
    const khoKeys = kho.items.map((i) => i.key);
    const toanKeys = toan.items.map((i) => i.key);
    expect(khoKeys).toContain('pancakeAttention');
    expect(khoKeys).not.toContain('customerRefunds');
    expect(toanKeys).toContain('customerRefunds');
    expect(toanKeys).not.toContain('pancakeAttention');

    const admin = await svc.counts(ADMIN);
    expect(admin.items.length).toBeGreaterThan(khoKeys.length);
    expect(admin.items.map((i) => i.key)).toContain('paymentUnlinkedClosed');
    expect(khoKeys).not.toContain('paymentUnlinkedClosed');
  });

  it('hết hạn (TTL mặc định 20 giây) thì đếm lại', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, calls } = harness();
    await svc.counts(ADMIN);
    const first = calls.n;
    now += 19_999;
    await svc.counts(ADMIN);
    expect(calls.n).toBe(first);
    now += 2;
    await svc.counts(ADMIN);
    expect(calls.n).toBeGreaterThan(first);
  });

  it('TTL đọc từ env: OPS_INBOX_CACHE_TTL_MS=0 tắt cache (môi trường test cần số mới ngay sau thao tác)', async () => {
    const { svc, calls } = harness({ OPS_INBOX_CACHE_TTL_MS: 0 });
    await svc.counts(ADMIN);
    const first = calls.n;
    await svc.counts(ADMIN);
    expect(calls.n).toBe(first * 2);
  });

  it('nhiều tab mở cùng lúc: các lượt đang chờ dùng chung một lượt đếm', async () => {
    const { svc, calls } = harness({}, 2);
    await svc.counts(ADMIN);
    const single = calls.n;
    const { svc: svc2, calls: calls2 } = harness({}, 2);
    await Promise.all([svc2.counts(ADMIN), svc2.counts(ADMIN), svc2.counts(ADMIN), svc2.counts(ADMIN)]);
    expect(calls2.n).toBe(single);
  });

  it('lượt đếm lỗi không bị nhớ: lượt sau đếm lại', async () => {
    const { svc, settle } = harness({ OPS_INBOX_CACHE_TTL_MS: 20_000, OPS_STORES_TO_SETTLE_TTL_MS: 0 });
    settle.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.counts(ADMIN)).rejects.toThrow('db down');
    await expect(svc.counts(ADMIN)).resolves.toBeDefined();
  });

  it('chỉ tối đa 4 truy vấn đếm chạy cùng lúc', async () => {
    expect(INBOX_COUNT_CONCURRENCY).toBe(4);
    const { svc, peak } = harness({}, 3);
    await svc.counts(ADMIN);
    expect(peak.n).toBeGreaterThan(1);
    expect(peak.n).toBeLessThanOrEqual(4);
  });
});

describe('OpsInboxService — lượt tính treo không chặn mãi', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lượt đang chạy được dùng chung tối đa 30 giây; quá hạn mà vẫn treo thì request sau tự tính lượt mới', async () => {
    let now = 9_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, settle } = harness({ OPS_STORES_TO_SETTLE_TTL_MS: 0 });
    settle.mockImplementationOnce(() => new Promise<number>(() => undefined));
    void svc.counts(ADMIN);
    await new Promise((r) => setImmediate(r));
    expect(settle).toHaveBeenCalledTimes(1);

    now += 29_000;
    void svc.counts(ADMIN);
    await new Promise((r) => setImmediate(r));
    expect(settle).toHaveBeenCalledTimes(1);

    now += 2_000;
    await expect(svc.counts(ADMIN)).resolves.toBeDefined();
    expect(settle).toHaveBeenCalledTimes(2);
  });
});

describe('OpsInboxService — merchantToSettle có cache 60 giây riêng', () => {
  afterEach(() => jest.restoreAllMocks());

  it('hộp việc hết hạn 20 giây vẫn không dựng lại bảng kê của mọi gian hàng; qua 60 giây mới dựng lại', async () => {
    let now = 5_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, settle } = harness();
    await svc.counts(ADMIN);
    expect(settle).toHaveBeenCalledTimes(1);
    now += 30_000;
    await svc.counts(ADMIN);
    expect(settle).toHaveBeenCalledTimes(1);
    now += 31_000;
    await svc.counts(KE_TOAN);
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it('OPS_STORES_TO_SETTLE_TTL_MS=0 tắt cache riêng này', async () => {
    const { svc, settle } = harness({ OPS_INBOX_CACHE_TTL_MS: 0, OPS_STORES_TO_SETTLE_TTL_MS: 0 });
    await svc.counts(ADMIN);
    await svc.counts(ADMIN);
    expect(settle).toHaveBeenCalledTimes(2);
  });
});
