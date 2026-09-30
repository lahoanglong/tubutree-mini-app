import { PurchasedItemsController } from './purchased-items.controller';
import type { PurchasedItemsService } from './purchased-items.service';

describe('PurchasedItemsController', () => {
  it('userId lấy từ JWT, cursor/limit/variationId từ query', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const ctrl = new PurchasedItemsController({ list } as unknown as PurchasedItemsService);
    await ctrl.list('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
    expect(list).toHaveBeenCalledWith('u1', { cursor: 'c', limit: 10, variationId: 'v1' });
  });
});
