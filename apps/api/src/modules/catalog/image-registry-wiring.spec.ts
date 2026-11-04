import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ImageRegistryModule } from './image-registry.module';
import { ImageRegistryStale } from './image-registry-stale';
import { ImageResizeService } from './image-resize.service';
import { PublicImageService } from './public-image.service';
import { CatalogModule } from './catalog.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersModule } from '../orders/orders.module';
import { OrderStatusService } from '../orders/order-status.service';
import { MerchantModule } from '../merchant/merchant.module';
import { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { StaffModule } from '../staff/staff.module';
import { RbacService } from '../staff/rbac/rbac.service';
import { SystemConfigModule } from '../system-config/system-config.module';
import { SystemConfigService } from '../system-config/system-config.service';

type ModuleClass = new () => unknown;
type Replace = Map<unknown, ModuleClass | null>;

/**
 * Dựng lại một module thật với đúng danh sách `imports` mà nó khai báo (đọc từ metadata của @Module) và chỉ các provider ta cần thử.
 * Module nặng (Prisma, Orders…) được thay bằng bản giả ở `replace`; còn ImageRegistryModule giữ nguyên là module thật, nên xoá dòng
 * `imports` đó khỏi module thật thì provider @Optional() nhận `undefined` và test này đỏ.
 */
function shadowOf(real: ModuleClass, providers: unknown[], replace: Replace = new Map()): ModuleClass {
  const imports = (Reflect.getMetadata('imports', real) as unknown[]).flatMap((m) => (replace.has(m) ? (replace.get(m) ? [replace.get(m)] : []) : [m]));
  class Shadow {}
  Module({ imports: imports as never[], providers: providers as never[], exports: providers as never[] })(Shadow);
  return Shadow;
}

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: OrderStatusService, useValue: {} },
    { provide: PublicImageService, useValue: {} },
  ],
  exports: [PrismaService, OrderStatusService, PublicImageService],
})
class StubInfraModule {}

describe('ImageRegistryStale: nối dây DI thật giữa các module', () => {
  async function compile() {
    const ShadowMerchant = shadowOf(MerchantModule, [MerchantFulfilmentService], new Map<unknown, ModuleClass | null>([[PrismaModule, null], [OrdersModule, null]]));
    const ShadowStaff = shadowOf(StaffModule, [RbacService], new Map<unknown, ModuleClass | null>([[MerchantModule, ShadowMerchant]]));
    const ShadowConfig = shadowOf(SystemConfigModule, [SystemConfigService]);
    const ShadowCatalog = shadowOf(CatalogModule, [ImageResizeService], new Map<unknown, ModuleClass | null>(
      (Reflect.getMetadata('imports', CatalogModule) as unknown[]).filter((m) => m !== ImageRegistryModule).map((m) => [m, null]),
    ));
    const moduleRef = await Test.createTestingModule({ imports: [StubInfraModule, ShadowCatalog, ShadowMerchant, ShadowStaff, ShadowConfig] }).compile();
    return moduleRef;
  }

  it('RbacService, SystemConfigService, MerchantFulfilmentService và ImageResizeService cùng một ImageRegistryStale', async () => {
    const ref = await compile();
    const stale = ref.get(ImageRegistryStale, { strict: false });
    const held = (svc: unknown, field: string) => (svc as Record<string, unknown>)[field];
    expect(stale).toBeInstanceOf(ImageRegistryStale);
    expect(held(ref.get(ImageResizeService, { strict: false }), 'stale')).toBe(stale);
    expect(held(ref.get(RbacService, { strict: false }), 'imageStale')).toBe(stale);
    expect(held(ref.get(SystemConfigService, { strict: false }), 'imageStale')).toBe(stale);
    expect(held(ref.get(MerchantFulfilmentService, { strict: false }), 'imageStale')).toBe(stale);
    await ref.close();
  });
});
