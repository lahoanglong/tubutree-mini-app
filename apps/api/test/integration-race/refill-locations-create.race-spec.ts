import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MAX_REFILL_LOCATIONS, RefillLocationsService } from '../../src/modules/refill/refill-locations.service';
import { summarize, warmPool } from './helpers';

/**
 * Tạo điểm nhận vỏ đồng thời trên Postgres thật. Đếm trần 50 và lấy sortOrder lớn nhất là đọc-rồi-ghi ở Read Committed;
 * không có khoá thì nhiều admin cùng thấy "còn chỗ" (vượt trần) và cùng lấy max+1 (trùng sortOrder).
 */
describe('Tạo điểm nhận vỏ song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let locations: RefillLocationsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RefillLocationsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma, 30);
    locations = moduleRef.get(RefillLocationsService);
    await prisma.refillPickupLocation.deleteMany();
  });

  afterAll(async () => {
    await prisma.refillPickupLocation.deleteMany();
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await prisma.refillPickupLocation.deleteMany();
  });

  const seed = (count: number) =>
    prisma.refillPickupLocation.createMany({
      data: Array.from({ length: count }, (_, i) => ({ id: `seed-${String(i).padStart(2, '0')}`, name: `Seed ${i}`, address: `Địa chỉ ${i}`, sortOrder: i })),
    });
  const createMany = (count: number, prefix: string) =>
    Promise.allSettled(Array.from({ length: count }, (_, i) => locations.create('admin', { name: `${prefix}${i}`, address: `Địa chỉ ${prefix}${i}` })));
  const sortOrders = async () => (await prisma.refillPickupLocation.findMany({ orderBy: { sortOrder: 'asc' }, select: { sortOrder: true } })).map((r) => r.sortOrder);

  it(`đang có ${MAX_REFILL_LOCATIONS - 5} điểm, 15 admin tạo cùng lúc: đúng 5 thành công, 10 bị 400, tổng đúng ${MAX_REFILL_LOCATIONS}`, async () => {
    await seed(MAX_REFILL_LOCATIONS - 5);

    const results = summarize(await createMany(15, 'R'));

    expect(results.fulfilled).toHaveLength(5);
    expect(results.rejected).toHaveLength(10);
    for (const r of results.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(await prisma.refillPickupLocation.count()).toBe(MAX_REFILL_LOCATIONS);
    expect(await sortOrders()).toEqual(Array.from({ length: MAX_REFILL_LOCATIONS }, (_, i) => i));
  });

  it(`đã đủ ${MAX_REFILL_LOCATIONS} điểm: mọi lần tạo song song đều bị 400, không dòng nào được thêm`, async () => {
    await seed(MAX_REFILL_LOCATIONS);

    const results = summarize(await createMany(10, 'F'));

    expect(results.fulfilled).toHaveLength(0);
    expect(results.rejected).toHaveLength(10);
    expect(await prisma.refillPickupLocation.count()).toBe(MAX_REFILL_LOCATIONS);
  });

  it('còn đúng một chỗ, 12 admin tạo cùng lúc: chỉ một người thành công', async () => {
    await seed(MAX_REFILL_LOCATIONS - 1);

    const results = summarize(await createMany(12, 'L'));

    expect(results.fulfilled).toHaveLength(1);
    expect(results.rejected).toHaveLength(11);
    expect(await prisma.refillPickupLocation.count()).toBe(MAX_REFILL_LOCATIONS);
  });

  it('bảng trống, 20 admin tạo cùng lúc: đủ 20 điểm, sortOrder 0..19 không trùng và danh sách hiển thị đúng thứ tự đó', async () => {
    const results = summarize(await createMany(20, 'E'));

    expect(results.errors).toEqual([]);
    expect(await sortOrders()).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const listed = await locations.listAll();
    expect(listed.map((l) => l.sortOrder)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const returned = results.fulfilled.map((f) => (f.value as { sortOrder: number }).sortOrder).sort((a, b) => a - b);
    expect(returned).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('tạo song song nối tiếp sau điểm đã có (có khoảng trống sortOrder): mọi điểm mới lớn hơn max cũ và không trùng nhau', async () => {
    await prisma.refillPickupLocation.createMany({
      data: [
        { id: 'gap-a', name: 'A', address: '1', sortOrder: 3 },
        { id: 'gap-b', name: 'B', address: '2', sortOrder: 10 },
      ],
    });

    const results = summarize(await createMany(8, 'G'));

    expect(results.errors).toEqual([]);
    expect(await sortOrders()).toEqual([3, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
});
