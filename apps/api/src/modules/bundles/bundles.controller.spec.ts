import 'reflect-metadata';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { BundlesController } from './bundles.controller';

describe('BundlesController', () => {
  const svc = { forProduct: jest.fn().mockResolvedValue({ combos: [], addons: [] }), homeCombos: jest.fn().mockResolvedValue([]) };
  const ctrl = new BundlesController(svc as never);

  it('hai route đều công khai và cache chung CATALOG', () => {
    for (const name of ['forProduct', 'homeCombos'] as const) {
      const fn = BundlesController.prototype[name];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, fn)).toBe('CATALOG');
    }
  });

  it('đường dẫn: products/:slug/bundles và bundles/combos', () => {
    expect(Reflect.getMetadata('path', BundlesController.prototype.forProduct)).toBe('products/:slug/bundles');
    expect(Reflect.getMetadata('path', BundlesController.prototype.homeCombos)).toBe('bundles/combos');
  });

  it('chuyển slug và limit xuống service', async () => {
    await ctrl.forProduct('sp-a');
    expect(svc.forProduct).toHaveBeenCalledWith('sp-a');
    await ctrl.homeCombos(3);
    expect(svc.homeCombos).toHaveBeenCalledWith(3);
  });
});
