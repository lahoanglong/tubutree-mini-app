import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { PUBLIC_CACHE_POLICY_KEY } from '../../../common/decorators/public-cache.decorator';
import { RefillPairsController } from './refill-pairs.controller';
import type { RefillPairsService } from './refill-pairs.service';

describe('RefillPairsController.landing (GET /catalog/refill-pairs/landing)', () => {
  it('công khai, Cache-Control CATALOG như danh mục, trả thẳng kết quả của service', async () => {
    const handler = RefillPairsController.prototype.landing;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBe('CATALOG');
    const body = { enabled: true, pairs: [] };
    const refill = { landing: jest.fn().mockResolvedValue(body) };
    await expect(new RefillPairsController(refill as unknown as RefillPairsService).landing()).resolves.toBe(body);
    expect(refill.landing).toHaveBeenCalledTimes(1);
  });

  it('/mine vẫn theo khách: không công khai, không cache chung', () => {
    const handler = RefillPairsController.prototype.mine;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBeUndefined();
  });
});
