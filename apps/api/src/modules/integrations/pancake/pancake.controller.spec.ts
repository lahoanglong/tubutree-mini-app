import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { CATALOG_SYNC_RUNNING, CatalogSyncBusyError } from './pancake-sync.service';
import { PancakeController } from './pancake.controller';

describe('PancakeController.runSync — lỗi Pancake báo bằng tiếng Việt, không "Internal server error" (R2-ADMINOPS-8)', () => {
  const make = (err: unknown) =>
    new PancakeController({ syncProducts: jest.fn().mockRejectedValue(err) } as never, {} as never);

  it('Pancake trả 500 (lỗi axios) → 503 kèm lý do', async () => {
    const res = make(Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true })).runSync();
    await expect(res).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(res).rejects.toThrow(/Không đồng bộ được danh mục Pancake.*status code 500/);
  });

  it('đang có lượt đồng bộ khác (replica này hay replica khác) → 409 CATALOG_SYNC_RUNNING, không phải 201 {synced:0} (R4-SYNC-6)', async () => {
    const res = make(new CatalogSyncBusyError()).runSync();
    await expect(res).rejects.toBeInstanceOf(ConflictException);
    await expect(res).rejects.toMatchObject({ response: { code: CATALOG_SYNC_RUNNING } });
  });

  it('lỗi đã là HttpException (đang có lượt đồng bộ khác) → giữ nguyên', async () => {
    const original = new ServiceUnavailableException('Đang có lượt đồng bộ khác chạy.');
    await expect(make(original).runSync()).rejects.toBe(original);
  });
});

describe('PancakeController.runSync — trả SKU Pancake báo giá 0đ cho người bấm đồng bộ (W131)', () => {
  const make = (zero: unknown) =>
    new PancakeController({ syncProducts: jest.fn().mockResolvedValue(7), lastZeroPrice: jest.fn().mockReturnValue(zero) } as never, {} as never);
  const sku = { pancakeId: 'v1', sku: 'S-1', productName: 'Lau sàn quế 500ml', kind: 'PRICE_KEPT', keptPrice: 89_000 };

  it('có SKU 0đ: trả đếm theo loại và danh sách; synced/stockOverwritten giữ nguyên', async () => {
    const res = await make({ scope: 'FULL', updatedAt: 'x', count: 1, keptCount: 1, newCount: 0, skus: [sku], truncated: false }).runSync('1');
    expect(res).toEqual({ synced: 7, stockOverwritten: true, zeroPriceAnomalies: { count: 1, keptCount: 1, newCount: 0, skus: [sku] } });
  });

  it('chưa có kết quả 0đ (null) → đếm 0, danh sách rỗng, không ném', async () => {
    expect(await make(null).runSync()).toEqual({ synced: 7, stockOverwritten: false, zeroPriceAnomalies: { count: 0, keptCount: 0, newCount: 0, skus: [] } });
  });
});
