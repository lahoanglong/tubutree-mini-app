import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { WasteExchangeModule } from './waste-exchange.module';
import { WasteCatalogModule } from './catalog/waste-catalog.module';
import { WasteCoreModule } from './core/waste-core.module';
import { WasteCustomerModule } from './customer/waste-customer.module';
import { WastePickupModule } from './pickup/waste-pickup.module';
import { WasteReceivingModule } from './receiving/waste-receiving.module';

describe('WasteExchangeModule', () => {
  it('imports the five lane modules and declares nothing itself', () => {
    expect(Reflect.getMetadata('imports', WasteExchangeModule)).toEqual([WasteCoreModule, WasteCustomerModule, WasteReceivingModule, WasteCatalogModule, WastePickupModule]);
    expect(Reflect.getMetadata('controllers', WasteExchangeModule)).toBeUndefined();
    expect(Reflect.getMetadata('providers', WasteExchangeModule)).toBeUndefined();
  });
  it('the lane modules compile; only Waste* providers must resolve inside the graph', async () => {
    const outside = (token: unknown) => (typeof token === 'function' && token.name.startsWith('Waste') ? undefined : {});
    await expect(Test.createTestingModule({ imports: [WasteExchangeModule] }).useMocker(outside).compile()).resolves.toBeDefined();
  });
  it('is registered once in AppModule', () => {
    const src = readFileSync(join(__dirname, '../../app.module.ts'), 'utf-8');
    expect(src.match(/WasteExchangeModule/g)).toHaveLength(2);
    expect(src).toMatch(/imports:\s*\[[\s\S]*WasteExchangeModule,/);
  });
});
