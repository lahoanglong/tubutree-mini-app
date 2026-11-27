import { RunLease } from '../../common/cron-leader/run-lease';
import { ExternalClaimPollService } from './external-claim-poll.service';
import { ingestAndApply } from './external-order.sync';

jest.mock('./external-order.sync', () => ({ ingestAndApply: jest.fn() }));

const SOURCE_MAP = { marketplaceIds: { '-3': 'shopee', '-4': 'lazada', '-9': 'tiktok' }, chatSources: [] };

type ListCall = { sinceEpochSec: number; orderSources: string[]; page: number; pageSize: number };

function setup(opts: {
  enabled?: unknown;
  map?: unknown;
  list?: (call: ListCall) => Promise<unknown[]>;
  renew?: () => Promise<boolean>;
}) {
  const lease = { renew: jest.fn(opts.renew ?? (async () => true)), release: jest.fn(async () => undefined) };
  jest.spyOn(RunLease, 'tryAcquire').mockResolvedValue(lease as unknown as RunLease);
  const listUpdatedOrders = jest.fn(opts.list ?? (async () => []));
  const client = { isConfigured: () => true, listUpdatedOrders };
  const config = {
    get: jest.fn(async (key: string, fallback: unknown) => {
      if (key === 'pancake.external_poll_enabled') return opts.enabled ?? true;
      if (key === 'pancake.order_source_map') return opts.map ?? SOURCE_MAP;
      return fallback;
    }),
  };
  const service = new ExternalClaimPollService({} as never, client as never, config as never, {} as never, { recalcTier: jest.fn() } as never);
  const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
  return { service, listUpdatedOrders, lease, warn };
}

const orders = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

describe('ExternalClaimPollService.pollOnce', () => {
  beforeEach(() => {
    jest.mocked(ingestAndApply).mockReset().mockResolvedValue({ result: 'STORED' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gọi Pancake riêng từng nguồn, mỗi lần đúng một order_sources (Pancake chỉ lọc theo giá trị cuối khi gửi nhiều)', async () => {
    const { service, listUpdatedOrders, lease } = setup({
      list: async (c) => (c.orderSources[0] === '-3' ? orders(17, 's') : c.orderSources[0] === '-4' ? orders(4, 'l') : []),
    });
    const now = new Date('2026-11-27T03:00:00.000Z');

    await expect(service.pollOnce(now)).resolves.toEqual({ pages: 3, ingested: 21 });

    expect(listUpdatedOrders.mock.calls.map(([c]) => c.orderSources)).toEqual([['-3'], ['-4'], ['-9']]);
    for (const [c] of listUpdatedOrders.mock.calls) {
      expect(c).toMatchObject({ sinceEpochSec: Math.floor(now.getTime() / 1000) - 7200, page: 1, pageSize: 50 });
    }
    expect(ingestAndApply).toHaveBeenCalledTimes(21);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('nguồn có trang đầy thì kéo trang sau của chính nguồn đó, rồi mới sang nguồn kế', async () => {
    const { service, listUpdatedOrders } = setup({
      list: async (c) => (c.orderSources[0] === '-3' ? (c.page === 1 ? orders(50, 'a') : orders(3, 'b')) : []),
    });

    await expect(service.pollOnce()).resolves.toEqual({ pages: 4, ingested: 53 });
    expect(listUpdatedOrders.mock.calls.map(([c]) => `${c.orderSources[0]}#${c.page}`)).toEqual(['-3#1', '-3#2', '-4#1', '-9#1']);
  });

  it('lỗi ở một nguồn được ghi cảnh báo kèm mã nguồn và không chặn các nguồn sau', async () => {
    const { service, listUpdatedOrders, warn, lease } = setup({
      list: async (c) => {
        if (c.orderSources[0] === '-4') throw new Error('Pancake 502');
        return c.orderSources[0] === '-9' ? orders(2, 't') : [];
      },
    });

    await expect(service.pollOnce()).resolves.toEqual({ pages: 2, ingested: 2 });
    expect(listUpdatedOrders.mock.calls.map(([c]) => c.orderSources[0])).toEqual(['-3', '-4', '-9']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nguồn -4'));
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('mất khoá giữa chừng thì dừng hẳn, không gọi thêm nguồn nào', async () => {
    const { service, listUpdatedOrders, lease } = setup({ renew: async () => false, list: async () => orders(1, 'x') });

    await expect(service.pollOnce()).resolves.toEqual({ pages: 1, ingested: 1 });
    expect(listUpdatedOrders).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('gia hạn khoá ném lỗi cũng coi như mất khoá: dừng hẳn', async () => {
    const { service, listUpdatedOrders } = setup({
      renew: async () => {
        throw new Error('DB tạm mất kết nối');
      },
      list: async () => orders(1, 'x'),
    });

    await expect(service.pollOnce()).resolves.toEqual({ pages: 1, ingested: 1 });
    expect(listUpdatedOrders).toHaveBeenCalledTimes(1);
  });

  it('chỉ đếm đơn được lưu mới (STORED)', async () => {
    jest.mocked(ingestAndApply).mockResolvedValueOnce({ result: 'STORED' } as never).mockResolvedValue({ result: 'STALE' } as never);
    const { service } = setup({ list: async (c) => (c.orderSources[0] === '-3' ? orders(3, 's') : []) });

    await expect(service.pollOnce()).resolves.toEqual({ pages: 3, ingested: 1 });
  });

  it('cờ tắt thì không giành khoá, không gọi Pancake', async () => {
    const { service, listUpdatedOrders } = setup({ enabled: false });

    await expect(service.pollOnce()).resolves.toBeNull();
    expect(RunLease.tryAcquire).not.toHaveBeenCalled();
    expect(listUpdatedOrders).not.toHaveBeenCalled();
  });
});
