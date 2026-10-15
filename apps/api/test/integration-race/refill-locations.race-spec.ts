import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { RefillService } from '../../src/modules/refill/refill.service';
import { RefillLocationsService } from '../../src/modules/refill/refill-locations.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R8 trên Postgres thật: (1) câu SQL chuyển điểm nhận cũ (SystemConfig refill.pickup_*) sang bảng mới trong migration
 * chạy lại không sinh bản sao và an toàn trên DB trống/đã có dữ liệu; (2) khách chọn điểm khi gửi đổi vỏ, điểm sai/đã tắt
 * bị chặn, xoá điểm không làm hỏng yêu cầu cũ; (3) sắp xếp song song và cùng Idempotency-Key khác điểm.
 */
const MIGRATION = join(__dirname, '../../prisma/migrations/20261015070000_r8_refill_locations_table/migration.sql');
const SEED_MARKER = '-- Chuyển điểm nhận đang cấu hình ở SystemConfig refill.pickup_*';
const SEED_KEYS = ['refill.pickup_address', 'refill.pickup_hours', 'refill.pickup_phone'] as const;

describe('Điểm nhận vỏ chai (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refill: RefillService;
  let locations: RefillLocationsService;
  let savedConfig: Array<{ key: string; value: unknown; description: string | null; category: string }>;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RefillLocationsService,
        RefillService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    refill = moduleRef.get(RefillService);
    locations = moduleRef.get(RefillLocationsService);
    savedConfig = (await prisma.systemConfig.findMany({ where: { key: { in: [...SEED_KEYS] } } })).map((r) => ({
      key: r.key,
      value: r.value,
      description: r.description,
      category: r.category,
    }));
    await prisma.refillPickupLocation.deleteMany();
  });

  afterAll(async () => {
    await prisma.bottleReturn.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.refillPickupLocation.deleteMany();
    await prisma.systemConfig.deleteMany({ where: { key: { in: [...SEED_KEYS] } } });
    for (const r of savedConfig) {
      await prisma.systemConfig.create({ data: { key: r.key, value: r.value as never, description: r.description, category: r.category } });
    }
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await prisma.refillPickupLocation.deleteMany();
  });

  const newUser = async () => {
    const u = await createUser(prisma);
    createdUserIds.push(u.id);
    return u;
  };
  const setLegacy = async (values: Partial<Record<(typeof SEED_KEYS)[number], unknown>>) => {
    for (const key of SEED_KEYS) {
      const value = (key in values ? values[key] : '') as never;
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value, category: 'refill' } });
    }
  };
  // Mỗi lần dựng service mới để cache 60s của SystemConfigService không giữ giá trị của ca trước.
  const freshLocations = () => new RefillLocationsService(prisma, new SystemConfigService(prisma));

  describe('câu SQL chuyển điểm nhận cũ trong migration', () => {
    const seedSql = readFileSync(MIGRATION, 'utf-8').slice(readFileSync(MIGRATION, 'utf-8').indexOf(SEED_MARKER));
    const runSeed = () => prisma.$executeRawUnsafe(seedSql);
    const all = () => prisma.refillPickupLocation.findMany();

    it('tìm thấy đúng câu INSERT trong file migration', () => {
      expect(seedSql).toContain('INSERT INTO "refill_pickup_locations"');
      expect(seedSql).toContain('ON CONFLICT ("id") DO NOTHING');
    });

    it('có địa chỉ: tạo đúng một điểm đang bật, cắt khoảng trắng, giữ giờ và SĐT; ba khoá cũ nguyên vẹn', async () => {
      await setLegacy({ 'refill.pickup_address': '  12 Lê Lợi, Quận 1 \n', 'refill.pickup_hours': ' 8h–20h ', 'refill.pickup_phone': '0901234567' });

      await runSeed();

      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 'rpl-seed-default',
        name: 'Điểm nhận vỏ chính',
        address: '12 Lê Lợi, Quận 1',
        hours: '8h–20h',
        phone: '0901234567',
        isActive: true,
        sortOrder: 0,
      });
      const legacy = await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'refill.pickup_address' } });
      expect(legacy.value).toBe('  12 Lê Lợi, Quận 1 \n');
    });

    it('chạy lại nhiều lần (kể cả song song) vẫn đúng một dòng', async () => {
      await setLegacy({ 'refill.pickup_address': 'Kho Tubu' });

      await runSeed();
      await runSeed();
      await Promise.all([runSeed(), runSeed(), runSeed()]);

      expect(await all()).toHaveLength(1);
    });

    it('DB trống (khoá cũ rỗng, như prod mới migrate): không tạo gì', async () => {
      await setLegacy({});

      await runSeed();

      expect(await all()).toHaveLength(0);
    });

    it('không có dòng SystemConfig nào: không tạo gì và không lỗi', async () => {
      await prisma.systemConfig.deleteMany({ where: { key: { in: [...SEED_KEYS] } } });

      await expect(runSeed()).resolves.toBeDefined();

      expect(await all()).toHaveLength(0);
    });

    it('địa chỉ toàn khoảng trắng hoặc sai kiểu (số) → không tạo', async () => {
      await setLegacy({ 'refill.pickup_address': '   \t ' });
      await runSeed();
      await setLegacy({ 'refill.pickup_address': 12345 });
      await runSeed();

      expect(await all()).toHaveLength(0);
    });

    it('giờ/SĐT rỗng hoặc sai kiểu → NULL (app ẩn dòng đó)', async () => {
      await setLegacy({ 'refill.pickup_address': 'Kho Tubu', 'refill.pickup_hours': 7, 'refill.pickup_phone': '  ' });

      await runSeed();

      const [row] = await all();
      expect(row).toMatchObject({ address: 'Kho Tubu', hours: null, phone: null });
    });

    it('bảng đã có điểm do admin tạo: không chèn thêm điểm cũ', async () => {
      await setLegacy({ 'refill.pickup_address': 'Địa chỉ cũ' });
      await prisma.refillPickupLocation.create({ data: { name: 'Admin tạo', address: 'Mới', isActive: false } });

      await runSeed();

      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe('Admin tạo');
    });

    it('sau khi admin xoá/sửa điểm đã chuyển, chạy lại không hồi sinh điểm cũ đè lên bảng đã có dòng', async () => {
      await setLegacy({ 'refill.pickup_address': 'Kho Tubu' });
      await runSeed();
      await prisma.refillPickupLocation.update({ where: { id: 'rpl-seed-default' }, data: { address: 'Kho mới', isActive: false } });

      await runSeed();

      const [row] = await all();
      expect(row).toMatchObject({ address: 'Kho mới', isActive: false });
    });
  });

  describe('phần điểm nhận của /refill/me', () => {
    it('bảng chưa có dòng: đọc dự phòng ba khoá cũ; có điểm đang bật: trường cũ = điểm đầu tiên', async () => {
      await setLegacy({ 'refill.pickup_address': 'Địa chỉ cũ', 'refill.pickup_phone': '0912345678' });
      const svc = freshLocations();

      expect(await svc.publicView()).toEqual({
        pickupLocations: [],
        pickup: { address: 'Địa chỉ cũ', hours: null, phone: '0912345678' },
      });

      await prisma.refillPickupLocation.createMany({
        data: [
          { id: 'z-b', name: 'B', address: '2 B', sortOrder: 1 },
          { id: 'z-a', name: 'A', address: '1 A', sortOrder: 0 },
          { id: 'z-off', name: 'Tắt', address: '0 Off', sortOrder: -1, isActive: false },
        ],
      });

      const view = await freshLocations().publicView();
      expect(view.pickupLocations.map((l) => l.id)).toEqual(['z-a', 'z-b']);
      expect(view.pickup).toEqual({ address: '1 A', hours: null, phone: null });
    });

    it('admin tắt hết điểm: khách không thấy lại địa chỉ cũ trong SystemConfig', async () => {
      await setLegacy({ 'refill.pickup_address': 'Địa chỉ cũ đã đóng cửa' });
      await prisma.refillPickupLocation.create({ data: { name: 'Duy nhất', address: 'Mới', isActive: false } });

      const view = await freshLocations().publicView();

      expect(view).toEqual({ pickupLocations: [], pickup: { address: null, hours: null, phone: null } });
    });
  });

  describe('gửi đổi vỏ kèm điểm nhận', () => {
    it('lưu pickupLocationId, hiện ở lịch sử của khách và ở danh sách chờ duyệt của nhân viên', async () => {
      const a = await locations.create('admin', { name: 'Quận 1', address: '1 Lê Lợi' });
      const b = await locations.create('admin', { name: 'Thủ Đức', address: '2 Võ Văn Ngân' });
      const user = await newUser();

      const r = await refill.returnBottles(user.id, 2, `it-${randCode(8)}`, b.id);

      const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.pickupLocationId).toBe(b.id);
      const summary = await refill.getSummary(user.id);
      expect(summary.history[0]).toMatchObject({ id: r.id, pickupLocation: { id: b.id, name: 'Thủ Đức' } });
      const pending = (await refill.listPending()).find((p) => p.id === r.id);
      expect(pending?.pickupLocation).toEqual({ id: b.id, name: 'Thủ Đức', address: '2 Võ Văn Ngân' });
      expect(a.sortOrder).toBe(0);
      expect(b.sortOrder).toBe(1);
    });

    it('điểm đã tắt hoặc không có thật → 400, không tạo yêu cầu, không trừ hạn mức', async () => {
      const off = await locations.create('admin', { name: 'Đóng', address: 'X', isActive: false });
      const user = await newUser();

      await expect(refill.returnBottles(user.id, 2, undefined, off.id)).rejects.toThrow('đã ngừng nhận vỏ');
      await expect(refill.returnBottles(user.id, 2, undefined, 'khong-co')).rejects.toThrow('không còn trong danh sách');

      expect(await prisma.bottleReturn.count({ where: { userId: user.id } })).toBe(0);
    });

    it('bản app cũ không gửi điểm: gán điểm đầu tiên đang bật; chưa có điểm nào thì null', async () => {
      const user = await newUser();
      const none = await refill.returnBottles(user.id, 1);
      expect((await prisma.bottleReturn.findUniqueOrThrow({ where: { id: none.id } })).pickupLocationId).toBeNull();

      await locations.create('admin', { name: 'Tắt', address: 'X', isActive: false });
      const first = await locations.create('admin', { name: 'Đầu', address: 'Y' });
      await locations.create('admin', { name: 'Sau', address: 'Z' });
      const withDefault = await refill.returnBottles(user.id, 1);

      expect((await prisma.bottleReturn.findUniqueOrThrow({ where: { id: withDefault.id } })).pickupLocationId).toBe(first.id);
    });

    it('xoá cứng một điểm (DB tay) không hỏng yêu cầu cũ: pickupLocationId về NULL (ON DELETE SET NULL)', async () => {
      const loc = await locations.create('admin', { name: 'Sắp xoá', address: 'X' });
      const user = await newUser();
      const r = await refill.returnBottles(user.id, 1, undefined, loc.id);

      await prisma.refillPickupLocation.delete({ where: { id: loc.id } });

      const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.pickupLocationId).toBeNull();
      expect((await refill.getSummary(user.id)).history[0]).toMatchObject({ id: r.id, pickupLocation: null });
    });

    it('duyệt yêu cầu không đụng tới điểm nhận', async () => {
      const loc = await locations.create('admin', { name: 'Giữ', address: 'X' });
      const user = await newUser();
      const staff = await createUser(prisma, { role: 'STAFF' });
      createdUserIds.push(staff.id);
      const r = await refill.returnBottles(user.id, 2, undefined, loc.id);

      await refill.approveReturn(r.id, staff.id);

      const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: r.id } });
      expect(row).toMatchObject({ status: 'APPROVED', pickupLocationId: loc.id });
    });

    it('cùng Idempotency-Key gửi song song với hai điểm khác nhau: một yêu cầu duy nhất, kẻ thua nhận 409', async () => {
      const a = await locations.create('admin', { name: 'A', address: '1' });
      const b = await locations.create('admin', { name: 'B', address: '2' });
      const user = await newUser();
      const key = `it-${randCode(8)}`;

      const results = summarize(await Promise.allSettled([refill.returnBottles(user.id, 2, key, a.id), refill.returnBottles(user.id, 2, key, b.id)]));

      expect(results.errors).toHaveLength(1);
      expect(results.rejected[0]!.reason).toBeInstanceOf(ConflictException);
      expect(await prisma.bottleReturn.count({ where: { userId: user.id } })).toBe(1);
    });

    it('cùng key cùng điểm gửi song song: một yêu cầu, cả hai nhận cùng id', async () => {
      const a = await locations.create('admin', { name: 'A', address: '1' });
      const user = await newUser();
      const key = `it-${randCode(8)}`;

      const results = await Promise.all([refill.returnBottles(user.id, 2, key, a.id), refill.returnBottles(user.id, 2, key, a.id)]);

      expect(results[0].id).toBe(results[1].id);
      expect(await prisma.bottleReturn.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe('quản trị điểm nhận', () => {
    it('tạo song song nhiều điểm: đủ số dòng, thứ tự hiển thị ổn định (sortOrder, createdAt, id)', async () => {
      await Promise.all(Array.from({ length: 5 }, (_, i) => locations.create('admin', { name: `P${i}`, address: `Địa chỉ ${i}` })));

      const first = (await locations.listAll()).map((l) => l.id);
      const again = (await locations.listAll()).map((l) => l.id);

      expect(first).toHaveLength(5);
      expect(again).toEqual(first);
    });

    it('sắp xếp lại ghi sortOrder 0..n-1; danh sách cũ (thiếu điểm vừa thêm) bị 409 và không ghi gì', async () => {
      const a = await locations.create('admin', { name: 'A', address: '1' });
      const b = await locations.create('admin', { name: 'B', address: '2' });
      const c = await locations.create('admin', { name: 'C', address: '3', isActive: false });

      const after = await locations.reorder('admin', [c.id, a.id, b.id]);
      expect(after.map((l) => [l.id, l.sortOrder])).toEqual([
        [c.id, 0],
        [a.id, 1],
        [b.id, 2],
      ]);

      const d = await locations.create('admin', { name: 'D', address: '4' });
      await expect(locations.reorder('admin', [b.id, a.id, c.id])).rejects.toBeInstanceOf(ConflictException);
      expect((await locations.listAll()).map((l) => l.id)).toEqual([c.id, a.id, b.id, d.id]);
    });

    it('hai lần sắp xếp song song: kết quả cuối là đúng một trong hai thứ tự, không trộn', async () => {
      const ids = (await Promise.all(['A', 'B', 'C'].map((n, i) => locations.create('admin', { name: n, address: `${i}` })))).map((l) => l.id);
      const orderOne = [...ids].sort();
      const orderTwo = [...orderOne].reverse();

      await Promise.allSettled([locations.reorder('admin', orderOne), locations.reorder('admin', orderTwo)]);

      const final = (await locations.listAll()).map((l) => l.id);
      expect([orderOne, orderTwo]).toContainEqual(final);
      expect((await locations.listAll()).map((l) => l.sortOrder).sort()).toEqual([0, 1, 2]);
    });
  });
});
