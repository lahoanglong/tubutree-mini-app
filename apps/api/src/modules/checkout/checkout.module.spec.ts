import 'reflect-metadata';
import { CartModule } from '../cart/cart.module';
import { WasteCatalogModule } from '../waste-exchange/catalog/waste-catalog.module';
import { WasteGiftAttachService } from '../waste-exchange/catalog/waste-gift-attach.service';
import { WasteCoreModule } from '../waste-exchange/core/waste-core.module';
import { WasteHoldService } from '../waste-exchange/core/waste-hold.service';
import { WasteCustomerModule } from '../waste-exchange/customer/waste-customer.module';
import { WasteRequestsService } from '../waste-exchange/customer/waste-requests.service';
import { CheckoutModule } from './checkout.module';
import { CheckoutService } from './checkout.service';

const importsOf = (m: object) => (Reflect.getMetadata('imports', m) ?? []) as unknown[];
const exportsOf = (m: object) => (Reflect.getMetadata('exports', m) ?? []) as unknown[];

describe('nối DI đổi rác kèm đơn', () => {
  it('CheckoutModule nạp đủ module đổi rác, mỗi module xuất đúng service CheckoutService cần', () => {
    expect(importsOf(CheckoutModule)).toEqual(expect.arrayContaining([WasteCoreModule, WasteCustomerModule, WasteCatalogModule]));
    expect(exportsOf(WasteCoreModule)).toContain(WasteHoldService);
    expect(exportsOf(WasteCustomerModule)).toContain(WasteRequestsService);
    expect(exportsOf(WasteCatalogModule)).toContain(WasteGiftAttachService);
  });

  it('CartModule nạp WasteCatalogModule để CartController đọc quà hiện vật chờ gắn đơn', () => {
    expect(importsOf(CartModule)).toContain(WasteCatalogModule);
  });

  it('ba service đổi rác của CheckoutService nằm đúng vị trí và đều @Optional (spec race dựng module tối giản không vỡ DI)', () => {
    const types = Reflect.getMetadata('design:paramtypes', CheckoutService) as unknown[];
    const optional = Reflect.getMetadata('optional:paramtypes', CheckoutService) as number[];
    for (const dep of [WasteHoldService, WasteRequestsService, WasteGiftAttachService]) {
      const at = types.indexOf(dep);
      expect(at).toBeGreaterThan(-1);
      expect(optional).toContain(at);
    }
  });
});
