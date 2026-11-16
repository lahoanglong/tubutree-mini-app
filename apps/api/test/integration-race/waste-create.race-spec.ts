jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { WasteLineInput, WasteMethod } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteRequestsService } from '../../src/modules/waste-exchange/customer/waste-requests.service';
import { WasteHomePickupCustomerService } from '../../src/modules/waste-exchange/home-pickup/waste-home-pickup-customer.service';
import { WasteHomePickupService } from '../../src/modules/waste-exchange/home-pickup/waste-home-pickup.service';
import { createUser as createItUser, deleteItData, randCode, setConfig, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWastePoint, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'waste.lane_pickup_enabled'];
let moduleRef: TestingModule;
let prisma: PrismaService;
let svc: WasteRequestsService;
let savedConfig: { key: string; value: unknown }[] = [];
const userIds: string[] = [];
const pointIds: string[] = [];
const itemIds: string[] = [];
const storefrontIds: string[] = [];

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const randKey = () => `it-${randCode(12)}`;
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
async function createUser(data: Parameters<typeof createItUser>[1] = {}) {
  const u = await createItUser(prisma, data);
  userIds.push(u.id);
  return u;
}
const customer = () => createUser({ phone: phone() });
const customerLock = (u: { id: string }) => Prisma.sql`SELECT pg_advisory_xact_lock(731001, hashtext(${u.id}))`;
const trackingLock = Prisma.sql`SELECT pg_advisory_xact_lock(731002, 0)`;
const errorsOf = (rs: PromiseSettledResult<unknown>[]) =>
  rs.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
const reasonOf = (r: PromiseSettledResult<unknown>) => String(((r as PromiseRejectedResult).reason as Error)?.message);
async function scene(itemOver: Parameters<typeof createWasteItem>[1] = {}) {
  const wh = await createWarehouse(prisma);
  const u = await customer();
  const owner = await customer();
  const item = await createWasteItem(prisma, itemOver);
  itemIds.push(item.id);
  const point = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id, itemIds: [item.id] });
  pointIds.push(point.id);
  if (point.createdStorefront && point.ownerStorefrontId) storefrontIds.push(point.ownerStorefrontId);
  return { u, owner, item, point, wh };
}
const create = (u: { id: string }, key: string, lines: WasteLineInput[], method: WasteMethod = 'DROP_OFF', pointId?: string) =>
  svc.create(u.id, key, { method, lines, pointId, consent: true, ...(method === 'MAIL_IN' ? { packagingConsent: true, postagePaidConsent: true } : {}) });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [SystemConfigService, WasteConfigService, WasteAccessService, WasteHoldService, WasteRequestsService],
  }).compile();
  prisma = moduleRef.get(PrismaService);
  svc = moduleRef.get(WasteRequestsService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'waste.lane_pickup_enabled', true);
  clearConfigCache();
});

afterAll(async () => {
  await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
  for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  clearConfigCache();
  await cleanupWaste(prisma, { pointIds, itemIds, storefrontIds });
  await deleteItData(prisma, { userIds });
  await moduleRef.close();
});

describe('waste create races (real Postgres, spec 17.3)', () => {
  const free = { dailyCapQty: null, monthlyCapQty: null };
  const openFixture = (u: { id: string }, item: { id: string }, point: { id: string }) =>
    createWasteRequest(prisma, { userId: u.id, method: 'DROP_OFF', status: 'OPEN', pointId: point.id, lines: [{ itemId: item.id, declaredQty: 1 }] });
  for (const [label, first] of [['A then B', 'A'], ['B then A', 'B']] as const) {
    const race = (u: { id: string }, a: () => Promise<unknown>, b: () => Promise<unknown>) =>
      first === 'A' ? raceWithHold(prisma, customerLock(u), a, b) : raceWithHold(prisma, customerLock(u), b, a);
    it(`day cap: create x create (${label}) -> one succeeds, total within 10`, async () => {
      const { u, item, point } = await scene({ dailyCapQty: 10, monthlyCapQty: null });
      const lines = [{ itemId: item.id, declaredQty: 6 }];
      const rs = await race(u, () => create(u, randKey(), lines, 'DROP_OFF', point.id), () => create(u, randKey(), lines, 'DROP_OFF', point.id));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toContain('hôm nay bạn chỉ còn mang tới điểm nhận được 4');
      expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(1);
    });
    it(`month cap: create x create (${label})`, async () => {
      const { u, item, point } = await scene({ dailyCapQty: null, monthlyCapQty: 10 });
      const lines = [{ itemId: item.id, declaredQty: 6 }];
      const rs = await race(u, () => create(u, randKey(), lines, 'DROP_OFF', point.id), () => create(u, randKey(), lines, 'DROP_OFF', point.id));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toContain('tháng này bạn chỉ còn gửi được 4');
      expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(1);
    });
    it(`points cap: create x create (${label})`, async () => {
      const { u, item, point } = await scene(free);
      const lines = [{ itemId: item.id, declaredQty: 40 }];
      const rs = await race(u, () => create(u, randKey(), lines, 'DROP_OFF', point.id), () => create(u, randKey(), lines, 'DROP_OFF', point.id));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toBe('Tháng này bạn chỉ còn 20.000 Điểm Xanh trong trần đổi rác');
      expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(1);
    });
    it(`open cap: create x create at 1 open (${label}) -> max 2 open, loser gets 409 WASTE_MAX_OPEN`, async () => {
      const { u, item, point } = await scene(free);
      await openFixture(u, item, point);
      const lines = [{ itemId: item.id, declaredQty: 1 }];
      const rs = await race(u, () => create(u, randKey(), lines, 'DROP_OFF', point.id), () => create(u, randKey(), lines, 'DROP_OFF', point.id));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toBe('Bạn đang có 2 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm');
      const rejResp = ((rs[1] as PromiseRejectedResult).reason as { getResponse?: () => unknown }).getResponse?.();
      expect(rejResp).toMatchObject({ statusCode: 409, code: 'WASTE_MAX_OPEN', openCount: 2, max: 2 });
      expect(await prisma.wasteRequest.count({ where: { userId: u.id, status: 'OPEN' } })).toBe(2);
    });
    it(`PICKUP create x create (${label}) -> one row`, async () => {
      const { u, item } = await scene(free);
      const lines = [{ itemId: item.id, declaredQty: 10 }];
      const rs = await race(u, () => create(u, randKey(), lines, 'PICKUP'), () => create(u, randKey(), lines, 'PICKUP'));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toContain('Bạn đã có yêu cầu thu kèm TR-');
      expect(await prisma.wasteRequest.count({ where: { userId: u.id, method: 'PICKUP' } })).toBe(1);
    });
    it(`same key in parallel (${label}) -> one row, both answers carry the same id, one event`, async () => {
      const { u, item, point } = await scene(free);
      const key = randKey();
      const lines = [{ itemId: item.id, declaredQty: 3 }];
      const rs = await race(u, () => create(u, key, lines, 'DROP_OFF', point.id), () => create(u, key, lines, 'DROP_OFF', point.id));
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(errorsOf(rs)).toEqual([]);
      const ids = rs.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
      expect(ids[0]).toBe(ids[1]);
      expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(1);
      expect(await prisma.wasteEvent.count({ where: { requestId: ids[0], kind: 'REQUEST_CREATED' } })).toBe(1);
    });
  }
  it('MAIL_IN and PICKUP replays at max open (2) ignore pointId and return the request just created, no new event', async () => {
    const { u, item } = await scene(free);
    const k1 = randKey();
    const k2 = randKey();
    const mail = await create(u, k1, [{ itemId: item.id, declaredQty: 15 }], 'MAIL_IN', 'x1');
    const pick = await create(u, k2, [{ itemId: item.id, declaredQty: 10 }], 'PICKUP', 'x1');
    expect(await prisma.wasteRequest.count({ where: { userId: u.id, status: 'OPEN' } })).toBe(2);
    await expect(create(u, k1, [{ itemId: item.id, declaredQty: 15 }], 'MAIL_IN', 'x2')).resolves.toMatchObject({ id: mail.id });
    await expect(create(u, k2, [{ itemId: item.id, declaredQty: 10 }], 'PICKUP', 'x2')).resolves.toMatchObject({ id: pick.id });
    expect(await prisma.wasteEvent.count({ where: { requestId: { in: [mail.id, pick.id] }, kind: 'REQUEST_CREATED' } })).toBe(2);
  });
  it('W179-B cross-method race: HOME_PICKUP create × checkout createPickupInTx (inlinePickup) at 1 open -> exactly one succeeds, total OPEN = 2', async () => {
    const { u, item, point } = await scene(free);
    await openFixture(u, item, point);
    await prisma.user.update({ where: { id: u.id }, data: { pointsBalance: 30_000 } });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Lan IT',
        phone: u.phone!,
        province: 'Thành phố Hồ Chí Minh',
        district: '',
        ward: 'Phường Bến Nghé',
        street: '1 Lê Lợi',
        provinceCode: '79',
        districtCode: '',
        wardCode: '26734',
      },
    });
    const configSvc = moduleRef.get(WasteConfigService);
    const sysCfg = moduleRef.get(SystemConfigService);
    const holdSvc = moduleRef.get(WasteHoldService);
    const homeLifecycle = new WasteHomePickupService(prisma, configSvc, { homePickupClosed: async () => undefined } as never, { evaluateAndLock: async () => ({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) } as never);
    const homeCustomer = new WasteHomePickupCustomerService(
      prisma,
      configSvc,
      holdSvc,
      sysCfg,
      {
        checkAddress: async () => ({ ok: true }),
        isConfigured: async () => true,
        quoteShopFeeDetailed: async () => ({ fee: 20_000, estimated: false }),
      } as never,
      {
        returnWindowDays: async () => 7,
        lockedOrderPoints: async () => ({ locked: 0, lockedReturn: 0, lockedUntil: null }),
      } as never,
      homeLifecycle,
    );
    const prepared = await svc.prepareInlinePickup();
    const lines = [{ itemId: item.id, declaredQty: 10 }];

    const rs = await raceWithHold(
      prisma,
      customerLock(u),
      () =>
        homeCustomer.create(u.id, randKey(), {
          method: 'HOME_PICKUP',
          lines,
          consent: true,
          pickupAddressId: addr.id,
          declaredWeightGrams: 2000,
          usePointsForShipFee: true,
        }),
      () => prisma.$transaction((tx) => svc.createPickupInTx(tx, u.id, randKey(), lines, prepared, 'Thành phố Hồ Chí Minh')),
    );
    expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const loser = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
      statusCode: 409,
      code: 'WASTE_MAX_OPEN',
      openCount: 2,
      max: 2,
    });
    expect(await prisma.wasteRequest.count({ where: { userId: u.id, status: 'OPEN' } })).toBe(2);
  });
  it('a different body under the same key is 409 and writes nothing', async () => {
    const { u, item, point } = await scene(free);
    const key = randKey();
    await create(u, key, [{ itemId: item.id, declaredQty: 3 }], 'DROP_OFF', point.id);
    await expect(create(u, key, [{ itemId: item.id, declaredQty: 4 }], 'DROP_OFF', point.id)).rejects.toThrow('Mã chống gửi lặp này đã dùng cho một yêu cầu khác');
    expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(1);
  });
  it('DROP_OFF at a PARTNER whose OWNER lost the partner store is 409 (spec 17.3)', async () => {
    const { u, item, point } = await scene(free);
    await prisma.storefront.update({ where: { id: point.ownerStorefrontId! }, data: { type: 'CTV', isPartner: false } });
    await expect(create(u, randKey(), [{ itemId: item.id, declaredQty: 3 }], 'DROP_OFF', point.id)).rejects.toThrow('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(0);
  });
  it('a battery line (COMING_SOON hazardous item) is 409 and writes nothing', async () => {
    const { u, item, point } = await scene({ status: 'COMING_SOON', hazardous: true });
    await expect(create(u, randKey(), [{ itemId: item.id, declaredQty: 1 }], 'DROP_OFF', point.id)).rejects.toThrow('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
    expect(await prisma.wasteRequest.count({ where: { userId: u.id } })).toBe(0);
  });
});
