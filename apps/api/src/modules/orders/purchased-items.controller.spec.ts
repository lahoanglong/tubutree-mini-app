import { PurchasedItemsController } from './purchased-items.controller';
import type { PurchasedItemsService } from './purchased-items.service';
import type { RepurchaseDueService } from './repurchase-due.service';

describe('PurchasedItemsController', () => {
  it('userId lấy từ JWT, cursor/limit/variationId từ query', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const ctrl = new PurchasedItemsController({ list } as unknown as PurchasedItemsService, {} as RepurchaseDueService);
    await ctrl.list('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
    expect(list).toHaveBeenCalledWith('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
  });

  it('GET /me/repurchase-due: userId lấy từ JWT, trả nguyên kết quả service', async () => {
    const forUser = jest.fn().mockResolvedValue({ item: null });
    const ctrl = new PurchasedItemsController({} as PurchasedItemsService, { forUser } as unknown as RepurchaseDueService);
    await expect(ctrl.due('u1')).resolves.toEqual({ item: null });
    expect(forUser).toHaveBeenCalledWith('u1');
  });
});
