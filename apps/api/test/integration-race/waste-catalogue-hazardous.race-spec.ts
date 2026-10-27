import { Test, type TestingModule } from '@nestjs/testing';
import type { SystemConfig } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteCatalogueService } from '../../src/modules/waste-exchange/customer/waste-catalogue.service';
import { setConfig, warmPool } from './helpers';
import { cleanupWaste, createWasteItem } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled'];

let moduleRef: TestingModule;
let prisma: PrismaService;
let catalogue: WasteCatalogueService;
let savedConfig: SystemConfig[];
const reg = { itemIds: [] as string[] };

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [SystemConfigService, WasteConfigService, WasteAccessService, WasteCatalogueService],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  catalogue = moduleRef.get(WasteCatalogueService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
});

afterAll(async () => {
  if (prisma) {
    await cleanupWaste(prisma, reg);
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  }
  await moduleRef?.close();
});

describe('catalogue khách giấu món nguy hại chưa ACTIVE (real Postgres)', () => {
  it('pin Sắp nhận không có trong catalogue; món thường Sắp nhận vẫn có; bật ACTIVE thì pin hiện; đưa về Sắp nhận thì mất', async () => {
    const pin = await createWasteItem(prisma, { hazardous: true, status: 'COMING_SOON' });
    const plain = await createWasteItem(prisma, { hazardous: false, status: 'COMING_SOON' });
    const hidden = await createWasteItem(prisma, { hazardous: false, status: 'HIDDEN' });
    reg.itemIds.push(pin.id, plain.id, hidden.id);
    const ids = async () => (await catalogue.publicItems()).map((i) => i.id);
    const before = await ids();
    expect(before).toContain(plain.id);
    expect(before).not.toContain(pin.id);
    expect(before).not.toContain(hidden.id);
    expect((await catalogue.listItems()).map((i) => i.id)).not.toContain(pin.id);

    await prisma.wasteItem.update({ where: { id: pin.id }, data: { status: 'ACTIVE' } });
    expect(await ids()).toContain(pin.id);

    await prisma.wasteItem.update({ where: { id: pin.id }, data: { status: 'COMING_SOON' } });
    expect(await ids()).not.toContain(pin.id);
  });
});
