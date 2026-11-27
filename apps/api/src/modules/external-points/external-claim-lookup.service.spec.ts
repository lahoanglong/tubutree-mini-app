import { ExternalClaimLookupService } from './external-claim-lookup.service';
import { ingestAndApply } from './external-order.sync';

jest.mock('./external-order.sync', () => ({ ingestAndApply: jest.fn() }));

const SOURCE_MAP = { marketplaceIds: { '-3': 'shopee', '-4': 'lazada', '-9': 'tiktok' }, chatSources: [] };
const NOW = new Date('2026-11-27T03:00:00.000Z');

function setup(opts: { enabled?: unknown; configured?: boolean; search?: (text: string) => Promise<unknown[]> } = {}) {
  const searchOrders = jest.fn(opts.search ?? (async () => []));
  const client = { isConfigured: () => opts.configured ?? true, searchOrders };
  const config = {
    get: jest.fn(async (key: string, fallback: unknown) => {
      if (key === 'pancake.external_lookup_enabled') return opts.enabled ?? true;
      if (key === 'pancake.order_source_map') return SOURCE_MAP;
      return fallback;
    }),
  };
  const service = new ExternalClaimLookupService({} as never, client as never, config as never, {} as never);
  const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
  return { service, searchOrders, warn };
}

const ingestedIds = () => jest.mocked(ingestAndApply).mock.calls.map(([, , data]) => (data as Record<string, unknown>)['id']);

describe('ExternalClaimLookupService.lookupAndIngest', () => {
  beforeEach(() => {
    jest.mocked(ingestAndApply).mockReset().mockResolvedValue({ result: 'STORED', kind: 'MARKETPLACE' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('cờ tắt hoặc Pancake chưa cấu hình: không gọi Pancake, trả false', async () => {
    for (const s of [setup({ enabled: false }), setup({ enabled: 'true' }), setup({ configured: false })]) {
      await expect(s.service.lookupAndIngest('SPXVN0123456789', NOW)).resolves.toBe(false);
      expect(s.searchOrders).not.toHaveBeenCalled();
    }
    expect(ingestAndApply).not.toHaveBeenCalled();
  });

  it('chỉ nạp đơn mang ĐÚNG mã (vị từ orderCarriesCode), bỏ đơn chỉ có chữ giống trong ghi chú', async () => {
    const { service, searchOrders } = setup({
      search: async () => [
        { id: 'A', marketplace_id: -3, partner: { extend_code: 'SPXVN0123456789' } },
        { id: 'B', marketplace_id: -3, note: 'khách hỏi SPXVN0123456789', partner: { extend_code: 'SPXVN9999999999' } },
      ],
    });
    await expect(service.lookupAndIngest('SPXVN0123456789', NOW)).resolves.toBe(true);
    expect(searchOrders).toHaveBeenCalledWith('SPXVN0123456789', { timeoutMs: 5_000 });
    expect(ingestedIds()).toEqual(['A']);
  });

  it('W44: khách gửi mã đơn trên sàn (id của đơn sàn, không có invoice_info_list) thì tra ra và nạp đúng đơn', async () => {
    const { service } = setup({
      search: async () => [
        { id: '350000000000017', marketplace_id: -4, partner: { extend_code: 'BESVN0000000017VNA' } },
        { id: '350000000000018', marketplace_id: -4, partner: { extend_code: 'BESVN0000000018VNA' } },
        { id: '350000000000017', note: 'đơn POS trùng số' },
      ],
    });
    await expect(service.lookupAndIngest('350000000000017', NOW)).resolves.toBe(true);
    expect(ingestedIds()).toEqual(['350000000000017']);
    const [, , data, map, now] = jest.mocked(ingestAndApply).mock.calls[0]!;
    expect((data as Record<string, unknown>)['marketplace_id']).toBe(-4);
    expect(map).toEqual(SOURCE_MAP);
    expect(now).toBe(NOW);
  });

  it('đơn khớp mã nhưng không phải đơn ngoài (đơn app): không tính là tra được', async () => {
    jest.mocked(ingestAndApply).mockResolvedValue({ result: 'NOT_EXTERNAL', kind: null } as never);
    const { service } = setup({ search: async () => [{ id: 'A', marketplace_id: -3, partner: { extend_code: 'SPXVN0123456789' } }] });
    await expect(service.lookupAndIngest('SPXVN0123456789', NOW)).resolves.toBe(false);
  });

  it('3 lỗi liên tiếp thì nghỉ 5 phút: trong lúc nghỉ không gọi Pancake, hết nghỉ thì gọi lại', async () => {
    const { service, searchOrders, warn } = setup({ search: async () => Promise.reject(new Error('timeout')) });
    for (let i = 0; i < 3; i++) await expect(service.lookupAndIngest('SPXVN0123456789', NOW)).resolves.toBe(false);
    expect(searchOrders).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(service.lookupAndIngest('SPXVN0123456789', new Date(NOW.getTime() + 4 * 60_000))).resolves.toBe(false);
    expect(searchOrders).toHaveBeenCalledTimes(3);
    await expect(service.lookupAndIngest('SPXVN0123456789', new Date(NOW.getTime() + 5 * 60_000))).resolves.toBe(false);
    expect(searchOrders).toHaveBeenCalledTimes(4);
  });

  it('một lần tra thành công xoá đếm lỗi', async () => {
    let fail = true;
    const { service, searchOrders, warn } = setup({ search: async () => (fail ? Promise.reject(new Error('x')) : []) });
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    fail = false;
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    fail = true;
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    expect(warn).not.toHaveBeenCalled();
    await service.lookupAndIngest('SPXVN0123456789', NOW);
    expect(searchOrders).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('nạp lỗi không ném ra ngoài: trả false và ghi log', async () => {
    jest.mocked(ingestAndApply).mockRejectedValue(new Error('db down'));
    const { service, warn } = setup({ search: async () => [{ id: 'A', marketplace_id: -3, partner: { extend_code: 'SPXVN0123456789' } }] });
    await expect(service.lookupAndIngest('SPXVN0123456789', NOW)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
