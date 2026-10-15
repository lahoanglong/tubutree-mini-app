import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RefillLocationsService, MAX_REFILL_LOCATIONS, REFILL_LOCATIONS_CREATE_LOCK_KEY } from './refill-locations.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

type Row = {
  id: string;
  name: string;
  address: string;
  hours: string | null;
  phone: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const row = (over: Partial<Row> = {}): Row => ({
  id: 'l1',
  name: 'Cửa hàng Quận 1',
  address: '12 Lê Lợi, Quận 1',
  hours: '8h–20h',
  phone: '0901234567',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const location = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _count: 0, _max: { sortOrder: null } }),
    create: jest.fn().mockImplementation(async ({ data }: { data: Partial<Row> }) => row({ id: 'new', ...data })),
    update: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => row({ id: where.id, ...data })),
    ...(over.refillPickupLocation as object),
  };
  const base: Record<string, unknown> = { refillPickupLocation: location, $executeRaw: jest.fn().mockResolvedValue(1) };
  base.$transaction = jest.fn().mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : arg));
  return { ...base, ...over, refillPickupLocation: location } as unknown as PrismaService & { refillPickupLocation: typeof location };
}

describe('RefillLocationsService.publicView — điểm nhận khách thấy', () => {
  it('có điểm đang bật: trả danh sách theo thứ tự và trường pickup cũ lấy từ điểm đầu tiên', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findMany.mockResolvedValue([
      row({ id: 'a', name: 'A', address: '1 A', hours: null, phone: null }),
      row({ id: 'b', name: 'B', address: '2 B', sortOrder: 1 }),
    ]);
    const svc = new RefillLocationsService(prisma, makeConfig({ 'refill.pickup_address': 'Địa chỉ cũ' }));

    const view = await svc.publicView();

    expect(view.pickupLocations.map((l) => l.id)).toEqual(['a', 'b']);
    expect(view.pickupLocations[0]).toEqual({ id: 'a', name: 'A', address: '1 A', hours: null, phone: null });
    expect(view.pickup).toEqual({ address: '1 A', hours: null, phone: null });
    expect(prisma.refillPickupLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('bảng chưa có dòng nào: dự phòng đọc ba khoá SystemConfig cũ, danh sách mới rỗng', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(
      prisma,
      makeConfig({ 'refill.pickup_address': '  Kho Tubu  ', 'refill.pickup_hours': '8h–17h', 'refill.pickup_phone': '0912345678' }),
    );

    const view = await svc.publicView();

    expect(view.pickupLocations).toEqual([]);
    expect(view.pickup).toEqual({ address: 'Kho Tubu', hours: '8h–17h', phone: '0912345678' });
  });

  it('khoá cũ trống hoặc sai kiểu → từng trường null', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(prisma, makeConfig({ 'refill.pickup_address': 123, 'refill.pickup_hours': '   ' }));

    const view = await svc.publicView();

    expect(view.pickup).toEqual({ address: null, hours: null, phone: null });
  });

  it('admin đã tắt hết điểm (bảng có dòng): KHÔNG hiện lại địa chỉ cũ trong SystemConfig', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.count.mockResolvedValue(2);
    const svc = new RefillLocationsService(prisma, makeConfig({ 'refill.pickup_address': 'Địa chỉ cũ đã đóng cửa' }));

    const view = await svc.publicView();

    expect(view.pickupLocations).toEqual([]);
    expect(view.pickup).toEqual({ address: null, hours: null, phone: null });
  });
});

describe('RefillLocationsService.create', () => {
  it('thêm vào cuối danh sách (sortOrder = lớn nhất + 1), mặc định đang bật, ghi log người làm', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.aggregate.mockResolvedValue({ _count: 2, _max: { sortOrder: 4 } });
    const svc = new RefillLocationsService(prisma, makeConfig());

    await svc.create('admin1', { name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân' });

    expect(prisma.refillPickupLocation.create).toHaveBeenCalledWith({
      data: { name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân', hours: null, phone: null, isActive: true, sortOrder: 5 },
    });
  });

  it('bảng trống: điểm đầu tiên có sortOrder 0; giờ/SĐT rỗng lưu null', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(prisma, makeConfig());

    await svc.create('admin1', { name: 'A', address: 'B', hours: '', phone: '', isActive: false });

    expect(prisma.refillPickupLocation.create).toHaveBeenCalledWith({
      data: { name: 'A', address: 'B', hours: null, phone: null, isActive: false, sortOrder: 0 },
    });
  });

  it('khoá advisory của việc tạo được lấy trong transaction, trước khi đếm trần và lấy sortOrder lớn nhất', async () => {
    const prisma = makePrisma();
    const order: string[] = [];
    (prisma.$executeRaw as unknown as jest.Mock).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push(`lock:${strings.join('?')}:${values.join(',')}`);
      return 1;
    });
    prisma.refillPickupLocation.aggregate.mockImplementation(async () => {
      order.push('aggregate');
      return { _count: 0, _max: { sortOrder: null } };
    });
    prisma.refillPickupLocation.create.mockImplementation(async ({ data }: { data: Partial<Row> }) => {
      order.push('create');
      return row({ id: 'new', ...data });
    });
    const svc = new RefillLocationsService(prisma, makeConfig());

    await svc.create('admin1', { name: 'A', address: 'B' });

    expect(order).toEqual([`lock:SELECT pg_advisory_xact_lock(hashtext(?)):${REFILL_LOCATIONS_CREATE_LOCK_KEY}`, 'aggregate', 'create']);
  });

  it(`quá ${MAX_REFILL_LOCATIONS} điểm → 400, không tạo`, async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.aggregate.mockResolvedValue({ _count: MAX_REFILL_LOCATIONS, _max: { sortOrder: 49 } });
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.create('admin1', { name: 'A', address: 'B' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.refillPickupLocation.create).not.toHaveBeenCalled();
  });
});

describe('RefillLocationsService.update', () => {
  it('chỉ ghi các trường được gửi; chuỗi rỗng ở giờ/SĐT xoá về null', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findUnique.mockResolvedValue(row());
    const svc = new RefillLocationsService(prisma, makeConfig());

    await svc.update('admin1', 'l1', { hours: '', phone: null, isActive: false });

    expect(prisma.refillPickupLocation.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { hours: null, phone: null, isActive: false },
    });
  });

  it('không tồn tại → 404', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.update('admin1', 'zzz', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.refillPickupLocation.update).not.toHaveBeenCalled();
  });

  it('không có trường nào để sửa → 400', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findUnique.mockResolvedValue(row());
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.update('admin1', 'l1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RefillLocationsService.reorder', () => {
  const withRows = (ids: string[]) => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findMany.mockResolvedValue(ids.map((id, i) => row({ id, sortOrder: i })));
    return prisma;
  };

  it('đánh lại sortOrder 0..n-1 theo thứ tự gửi, trong một giao dịch, khoá hàng theo thứ tự id', async () => {
    const prisma = withRows(['a', 'b', 'c']);
    const svc = new RefillLocationsService(prisma, makeConfig());

    await svc.reorder('admin1', ['c', 'a', 'b']);

    expect(prisma.$transaction).toHaveBeenCalled();
    const calls = prisma.refillPickupLocation.update.mock.calls.map((c) => [c[0].where.id, c[0].data.sortOrder]);
    expect(calls).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 0],
    ]);
  });

  it('danh sách thiếu một điểm (admin khác vừa thêm) → 409, không ghi gì', async () => {
    const prisma = withRows(['a', 'b', 'c']);
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.reorder('admin1', ['a', 'b'])).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.refillPickupLocation.update).not.toHaveBeenCalled();
  });

  it('có id không tồn tại → 409, không ghi gì', async () => {
    const prisma = withRows(['a', 'b']);
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.reorder('admin1', ['a', 'zzz'])).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.refillPickupLocation.update).not.toHaveBeenCalled();
  });

  it('id lặp → 400', async () => {
    const prisma = withRows(['a', 'b']);
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.reorder('admin1', ['a', 'a'])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RefillLocationsService.resolveForReturn — điểm khách chọn khi gửi yêu cầu', () => {
  it('id hợp lệ và đang bật → trả id', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findUnique.mockResolvedValue({ id: 'b', isActive: true });
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.resolveForReturn(prisma as never, 'b')).resolves.toBe('b');
  });

  it('id không tồn tại → 400 bảo chọn lại', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.resolveForReturn(prisma as never, 'zzz')).rejects.toThrow('Điểm nhận vỏ không còn trong danh sách');
  });

  it('điểm đã tắt → 400, không âm thầm gán điểm khác', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findUnique.mockResolvedValue({ id: 'b', isActive: false });
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.resolveForReturn(prisma as never, 'b')).rejects.toThrow('đã ngừng nhận vỏ');
  });

  it('khách (bản app cũ) không gửi id → điểm đầu tiên đang bật, đúng điểm app cũ đang hiện', async () => {
    const prisma = makePrisma();
    prisma.refillPickupLocation.findMany.mockResolvedValue([{ id: 'first' }]);
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.resolveForReturn(prisma as never, undefined)).resolves.toBe('first');
    expect(prisma.refillPickupLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, take: 1, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('không gửi id và không có điểm nào đang bật → null', async () => {
    const prisma = makePrisma();
    const svc = new RefillLocationsService(prisma, makeConfig());

    await expect(svc.resolveForReturn(prisma as never, undefined)).resolves.toBeNull();
  });
});
