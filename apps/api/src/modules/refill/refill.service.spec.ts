import { BadRequestException, ConflictException } from '@nestjs/common';
import { RefillService } from './refill.service';
import { RefillLocationsService } from './refill-locations.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makeNotifications(): NotificationsService {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    refillPickupLocation: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    gameProfile: { upsert: jest.fn().mockResolvedValue({}) },
    bottleReturn: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'br1', createdAt: new Date(), ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'br1', userId: 'u1', quantity: 3, seedsAwarded: 150, status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({ id: 'br1', status: 'APPROVED' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    notificationLog: {
      create: jest.fn().mockResolvedValue({ id: 'nl1' }),
    },
  };
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : Promise.all(arg as unknown[]),
    );
  return { ...base, ...over } as unknown as PrismaService;
}

/** RefillService thật với RefillLocationsService thật, cùng prisma/config giả. */
function newRefill(prisma: PrismaService, config: SystemConfigService, notifications: NotificationsService): RefillService {
  return new RefillService(prisma, config, notifications, new RefillLocationsService(prisma, config));
}

describe('RefillService.returnBottles', () => {
  it('số vỏ <= 0 → throw', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig(), makeNotifications());
    await expect(svc.returnBottles('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
  });

  it('vượt trần tháng → throw', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 18 } });
    const svc = newRefill(prisma, makeConfig({ 'refill.monthly_cap_bottles': 20 }), makeNotifications());
    await expect(svc.returnBottles('u1', 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('race 2 đổi vỏ song song đụng Serializable (P2034) → báo thử lại, không phải 500', async () => {
    const prisma = makePrisma({
      $transaction: jest.fn().mockRejectedValue({ code: 'P2034', message: 'serialization failure' }),
    });
    const svc = newRefill(prisma, makeConfig(), makeNotifications());
    await expect(svc.returnBottles('u1', 3)).rejects.toThrow('Hệ thống đang bận xử lý, vui lòng thử lại.');
  });

  it('gọi $transaction với isolationLevel Serializable (chống TOCTOU đọc SUM tháng rồi insert)', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig(), makeNotifications());
    await svc.returnBottles('u1', 3);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('gửi đổi vỏ hợp lệ → tạo đơn PENDING (chưa cộng 💧 ngay)', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig({ 'refill.seeds_per_bottle': 50, 'refill.monthly_cap_bottles': 20 }), makeNotifications());
    const r = await svc.returnBottles('u1', 3);
    expect(r.seedsAwarded).toBe(150);
    expect(r.quantity).toBe(3);
    expect(r.status).toBe('PENDING');
    expect(r.monthlyRemaining).toBe(17);
    expect(prisma.gameProfile.upsert).not.toHaveBeenCalled(); // chưa cộng 💧 ngay
    const created = (prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ userId: 'u1', quantity: 3, seedsAwarded: 150, status: 'PENDING' });
  });
});

describe('RefillService.returnBottles — Idempotency-Key (R2-ENGAGE-12)', () => {
  const existingRow = { id: 'br0', userId: 'u1', quantity: 3, declaredQuantity: null, seedsAwarded: 150, status: 'PENDING' };

  it('cùng key đã có yêu cầu → trả lại yêu cầu đó, không tạo dòng mới', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(existingRow);
    (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 3 } });
    const svc = newRefill(prisma, makeConfig({ 'refill.monthly_cap_bottles': 20 }), makeNotifications());

    const r = await svc.returnBottles('u1', 3, 'key-1');

    expect(r).toMatchObject({ id: 'br0', quantity: 3, seedsAwarded: 150, status: 'PENDING', monthlyRemaining: 17 });
    expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
    expect(prisma.bottleReturn.findUnique).toHaveBeenCalledWith({ where: { userId_idempotencyKey: { userId: 'u1', idempotencyKey: 'key-1' } } });
  });

  it('cùng key nhưng số vỏ khác → 409, không tạo thêm', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(existingRow);
    const svc = newRefill(prisma, makeConfig(), makeNotifications());

    await expect(svc.returnBottles('u1', 5, 'key-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
  });

  it('key mới → tạo dòng kèm idempotencyKey (đã trim)', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = newRefill(prisma, makeConfig(), makeNotifications());

    await svc.returnBottles('u1', 2, '  key-2  ');

    expect((prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ idempotencyKey: 'key-2' });
  });

  it('không key hoặc key toàn khoảng trắng → không tra key, lưu idempotencyKey undefined', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig(), makeNotifications());

    await svc.returnBottles('u1', 2, '   ');

    expect(prisma.bottleReturn.findUnique).not.toHaveBeenCalled();
    expect((prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data.idempotencyKey).toBeUndefined();
  });

  it('đụng Serializable lần đầu rồi chạy lại thấy dòng của request thắng → trả kết quả đó thay vì báo bận', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(existingRow);
    (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 3 } });
    const realTx = prisma.$transaction as unknown as jest.Mock;
    const impl = realTx.getMockImplementation()!;
    realTx.mockRejectedValueOnce({ code: 'P2034' }).mockImplementation(impl);
    const svc = newRefill(prisma, makeConfig(), makeNotifications());

    const r = await svc.returnBottles('u1', 3, 'key-1');

    expect(r.id).toBe('br0');
    expect(realTx).toHaveBeenCalledTimes(2);
  });

  it('đụng độ liên tục hết số lần chạy lại → báo bận, không 500', async () => {
    const prisma = makePrisma({ $transaction: jest.fn().mockRejectedValue({ code: 'P2002' }) });
    const svc = newRefill(prisma, makeConfig(), makeNotifications());

    await expect(svc.returnBottles('u1', 3, 'key-1')).rejects.toThrow('Hệ thống đang bận xử lý, vui lòng thử lại.');
  });
});

describe('RefillService.approveReturn', () => {
  it('duyệt đơn PENDING → chuyển APPROVED + cộng 💧', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig(), makeNotifications());
    const r = await svc.approveReturn('br1', 'staff1');
    expect(r.status).toBe('APPROVED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const up = (prisma.gameProfile.upsert as jest.Mock).mock.calls[0][0];
    expect(up.where).toEqual({ userId: 'u1' });
    expect(up.update.totalSeeds).toEqual({ increment: 150 });
  });

  // ENGAGE-13: duyệt không ghi ai duyệt và không có chỗ nhập số vỏ thực nhận.
  describe('nhân viên đối chiếu số vỏ thực nhận (ENGAGE-13)', () => {
    const approvedData = (prisma: PrismaService) =>
      (prisma.bottleReturn.updateMany as jest.Mock).mock.calls[0][0].data as Record<string, unknown>;

    it('ghi người duyệt và thời điểm duyệt', async () => {
      const prisma = makePrisma();
      await newRefill(prisma, makeConfig(), makeNotifications()).approveReturn('br1', 'staff1');
      expect(approvedData(prisma)).toMatchObject({ status: 'APPROVED', reviewedBy: 'staff1', reviewedAt: expect.any(Date) });
    });

    it('không nhập số thực nhận → nhận đủ số khách khai (tương thích bản app cũ), không có declaredQuantity', async () => {
      const prisma = makePrisma();
      await newRefill(prisma, makeConfig(), makeNotifications()).approveReturn('br1', 'staff1');
      const data = approvedData(prisma);
      expect(data).not.toHaveProperty('quantity');
      expect(data).not.toHaveProperty('seedsAwarded');
      expect(data).not.toHaveProperty('declaredQuantity');
    });

    it('nhận ít hơn khai (khai 3, nhận 2) → quantity = 2, giữ số khai ở declaredQuantity, 💧 theo 2 vỏ', async () => {
      const prisma = makePrisma();
      await newRefill(prisma, makeConfig(), makeNotifications()).approveReturn('br1', 'staff1', 2);
      expect(approvedData(prisma)).toMatchObject({ quantity: 2, declaredQuantity: 3, seedsAwarded: 100 });
      const up = (prisma.gameProfile.upsert as jest.Mock).mock.calls[0][0];
      expect(up.update.totalSeeds).toEqual({ increment: 100 });
    });

    it('nhập nhiều hơn khai → kẹp về số khai, không thưởng quá', async () => {
      const prisma = makePrisma();
      await newRefill(prisma, makeConfig(), makeNotifications()).approveReturn('br1', 'staff1', 9);
      expect(approvedData(prisma)).not.toHaveProperty('quantity');
      expect(approvedData(prisma)).not.toHaveProperty('declaredQuantity');
      const up = (prisma.gameProfile.upsert as jest.Mock).mock.calls[0][0];
      expect(up.update.totalSeeds).toEqual({ increment: 150 });
    });

    it.each([0, -1, 1.5])('số thực nhận %s không hợp lệ → 400, không cộng 💧 (không nhận được vỏ nào thì dùng Từ chối)', async (bad) => {
      const prisma = makePrisma();
      await expect(
        newRefill(prisma, makeConfig(), makeNotifications()).approveReturn('br1', 'staff1', bad),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gameProfile.upsert).not.toHaveBeenCalled();
    });

    it('báo khách qua mẫu REFILL_APPROVED với số vỏ ghi nhận, 💧 và ghi chú khi số nhận khác số khai', async () => {
      const prisma = makePrisma();
      const notifications = makeNotifications();
      await newRefill(prisma, makeConfig(), notifications).approveReturn('br1', 'staff1', 2);
      expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFILL_APPROVED', {
        quantity: '2',
        seeds: '100',
        note: ' (bạn khai 3 vỏ)',
      });
    });

    it('nhận đủ → ghi chú rỗng', async () => {
      const notifications = makeNotifications();
      await newRefill(makePrisma(), makeConfig(), notifications).approveReturn('br1', 'staff1');
      expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFILL_APPROVED', { quantity: '3', seeds: '150', note: '' });
    });

    it('gửi thông báo lỗi vẫn không làm hỏng việc duyệt đã commit', async () => {
      const notifications = { notify: jest.fn().mockRejectedValue(new Error('down')) } as unknown as NotificationsService;
      await expect(
        newRefill(makePrisma(), makeConfig(), notifications).approveReturn('br1', 'staff1'),
      ).resolves.toMatchObject({ ok: true, status: 'APPROVED' });
    });
  });
});

describe('RefillService.rejectReturn (ENGAGE-13)', () => {
  it('ghi người từ chối, thời điểm và lý do; báo khách kèm lý do qua mẫu REFILL_REJECTED', async () => {
    const prisma = makePrisma();
    const notifications = makeNotifications();
    await newRefill(prisma, makeConfig(), notifications).rejectReturn('br1', 'staff1', 'Vỏ chai chưa rửa sạch');
    const data = (prisma.bottleReturn.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'REJECTED', reviewedBy: 'staff1', reviewedAt: expect.any(Date), rejectionReason: 'Vỏ chai chưa rửa sạch',
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFILL_REJECTED', {
      quantity: '3',
      reason: ': Vỏ chai chưa rửa sạch',
    });
  });

  it('không nêu lý do → rejectionReason null và câu báo không có đoạn lý do', async () => {
    const prisma = makePrisma();
    const notifications = makeNotifications();
    await newRefill(prisma, makeConfig(), notifications).rejectReturn('br1', 'staff1');
    expect((prisma.bottleReturn.updateMany as jest.Mock).mock.calls[0][0].data.rejectionReason).toBeNull();
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFILL_REJECTED', { quantity: '3', reason: '' });
  });
});

describe('RefillService.listPending (ENGAGE-13)', () => {
  it('cũ nhất trước (yêu cầu cũ không bị đẩy ra ngoài khi > 100 hàng chờ), tối đa 100/trang', async () => {
    const prisma = makePrisma();
    await newRefill(prisma, makeConfig(), makeNotifications()).listPending();
    const arg = (prisma.bottleReturn.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'PENDING' });
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(arg.take).toBe(100);
    expect(arg).not.toHaveProperty('cursor');
  });

  it('có cursor → trang kế sau dòng cuối của trang trước', async () => {
    const prisma = makePrisma();
    await newRefill(prisma, makeConfig(), makeNotifications()).listPending({ cursor: 'br9', take: 30 });
    const arg = (prisma.bottleReturn.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.cursor).toEqual({ id: 'br9' });
    expect(arg.skip).toBe(1);
    expect(arg.take).toBe(30);
  });

  it('take > 100 bị kẹp về 100; take không hợp lệ (0) dùng mặc định 100', async () => {
    const prisma = makePrisma();
    const svc = newRefill(prisma, makeConfig(), makeNotifications());
    await svc.listPending({ take: 5000 });
    await svc.listPending({ take: 0 });
    const takes = (prisma.bottleReturn.findMany as jest.Mock).mock.calls.map((c) => c[0].take);
    expect(takes).toEqual([100, 100]);
  });
});

describe('RefillService.getSummary — điểm nhận vỏ (ENGAGE-13)', () => {
  it('lịch sử kèm số khai ban đầu và lý do từ chối để khách hiểu vì sao số vỏ/💧 khác dự kiến', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.findMany as jest.Mock).mockResolvedValue([
      { id: 'h1', quantity: 2, seedsAwarded: 100, status: 'APPROVED', createdAt: new Date('2026-03-15'), declaredQuantity: 3, rejectionReason: null },
      { id: 'h2', quantity: 1, seedsAwarded: 50, status: 'REJECTED', createdAt: new Date('2026-03-14'), declaredQuantity: null, rejectionReason: 'Vỏ chưa rửa sạch' },
    ]);
    const r = await newRefill(prisma, makeConfig(), makeNotifications()).getSummary('u1');
    expect(r.history[0]).toMatchObject({ id: 'h1', quantity: 2, declaredQuantity: 3, rejectionReason: null });
    expect(r.history[1]).toMatchObject({ id: 'h2', declaredQuantity: null, rejectionReason: 'Vỏ chưa rửa sạch' });
  });

  it('trả địa chỉ/giờ/SĐT điểm nhận từ SystemConfig', async () => {
    const cfg = makeConfig({
      'refill.pickup_address': ' 12 Nguyễn Huệ, Q1 ',
      'refill.pickup_hours': '8h–20h hằng ngày',
      'refill.pickup_phone': '0899 149 229',
    });
    const r = await newRefill(makePrisma(), cfg, makeNotifications()).getSummary('u1');
    expect(r.pickup).toEqual({ address: '12 Nguyễn Huệ, Q1', hours: '8h–20h hằng ngày', phone: '0899 149 229' });
  });

  it('chưa cấu hình / để trống / sai kiểu → null từng trường (UI tự ẩn)', async () => {
    const r = await newRefill(makePrisma(), makeConfig({ 'refill.pickup_address': '   ', 'refill.pickup_hours': 5 }), makeNotifications()).getSummary('u1');
    expect(r.pickup).toEqual({ address: null, hours: null, phone: null });
  });
});

// C-026: mốc "đầu tháng" của hạn mức đổi chai phải là 00:00 ngày 1 giờ VN dù host chạy UTC.
describe('RefillService.getSummary — đầu tháng theo giờ VN (C-026)', () => {
  it('03:00 ngày 1/10 giờ VN → đếm từ 2026-09-30T17:00Z, không phải 2026-10-01T00:00Z hay đầu tháng 9', async () => {
    const prisma = makePrisma();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T20:00:00Z'));
    try {
      await newRefill(prisma, makeConfig(), makeNotifications()).getSummary('u1');
    } finally {
      jest.useRealTimers();
    }
    const calls = (prisma.bottleReturn.aggregate as jest.Mock).mock.calls;
    const gtes = calls.map((c) => (c[0].where.createdAt?.gte as Date | undefined)?.toISOString());
    expect(gtes).toContain('2026-09-30T17:00:00.000Z');
  });
});

describe('RefillService — nhiều điểm nhận vỏ (R8)', () => {
  const locationsMock = (prisma: PrismaService) =>
    (prisma as unknown as { refillPickupLocation: { findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock } }).refillPickupLocation;
  const createdData = (prisma: PrismaService) => (prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data as Record<string, unknown>;

  describe('returnBottles gắn điểm nhận', () => {
    it('khách chọn điểm đang bật → lưu pickupLocationId vào yêu cầu', async () => {
      const prisma = makePrisma();
      (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(null);
      locationsMock(prisma).findUnique.mockResolvedValue({ id: 'loc2', isActive: true });

      await newRefill(prisma, makeConfig(), makeNotifications()).returnBottles('u1', 2, 'k1', 'loc2');

      expect(locationsMock(prisma).findUnique).toHaveBeenCalledWith({ where: { id: 'loc2' }, select: { id: true, isActive: true } });
      expect(createdData(prisma)).toMatchObject({ pickupLocationId: 'loc2' });
    });

    it('điểm đã tắt hoặc không tồn tại → 400, không tạo yêu cầu', async () => {
      const prisma = makePrisma();
      (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(null);
      locationsMock(prisma).findUnique.mockResolvedValue({ id: 'loc2', isActive: false });
      const svc = newRefill(prisma, makeConfig(), makeNotifications());

      await expect(svc.returnBottles('u1', 2, 'k1', 'loc2')).rejects.toBeInstanceOf(BadRequestException);

      locationsMock(prisma).findUnique.mockResolvedValue(null);
      await expect(svc.returnBottles('u1', 2, 'k2', 'gone')).rejects.toThrow('Điểm nhận vỏ không còn trong danh sách');
      expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
    });

    it('bản app cũ không gửi điểm → gán điểm đầu tiên đang bật (điểm app đó đang hiện)', async () => {
      const prisma = makePrisma();
      locationsMock(prisma).findMany.mockResolvedValue([{ id: 'first' }]);

      await newRefill(prisma, makeConfig(), makeNotifications()).returnBottles('u1', 2);

      expect(createdData(prisma)).toMatchObject({ pickupLocationId: 'first' });
    });

    it('không gửi điểm và chưa có điểm nào đang bật → pickupLocationId null', async () => {
      const prisma = makePrisma();

      await newRefill(prisma, makeConfig(), makeNotifications()).returnBottles('u1', 2);

      expect(createdData(prisma)).toMatchObject({ pickupLocationId: null });
    });

    it('id điểm toàn khoảng trắng coi như không gửi', async () => {
      const prisma = makePrisma();

      await newRefill(prisma, makeConfig(), makeNotifications()).returnBottles('u1', 2, undefined, '   ');

      expect(locationsMock(prisma).findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency-Key và điểm nhận', () => {
    const existing = { id: 'br0', userId: 'u1', quantity: 3, declaredQuantity: null, seedsAwarded: 150, status: 'PENDING', pickupLocationId: 'loc1' };
    const replay = (prisma: PrismaService) => {
      (prisma.bottleReturn.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 3 } });
      return newRefill(prisma, makeConfig(), makeNotifications());
    };

    it('cùng key nhưng khách đổi sang điểm khác → 409, không âm thầm giữ điểm cũ', async () => {
      const prisma = makePrisma();
      await expect(replay(prisma).returnBottles('u1', 3, 'k1', 'loc2')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
    });

    it('cùng key cùng điểm → trả lại yêu cầu cũ', async () => {
      const prisma = makePrisma();
      await expect(replay(prisma).returnBottles('u1', 3, 'k1', 'loc1')).resolves.toMatchObject({ id: 'br0' });
    });

    it('cùng key, lần gửi lại không nêu điểm (bản app cũ) → trả lại yêu cầu cũ', async () => {
      const prisma = makePrisma();
      await expect(replay(prisma).returnBottles('u1', 3, 'k1')).resolves.toMatchObject({ id: 'br0' });
    });
  });

  describe('getSummary', () => {
    it('trả danh sách điểm đang bật và giữ trường pickup cũ = điểm đầu tiên', async () => {
      const prisma = makePrisma();
      locationsMock(prisma).findMany.mockResolvedValue([
        { id: 'a', name: 'Quận 1', address: '1 Lê Lợi', hours: '8h–20h', phone: '0901234567' },
        { id: 'b', name: 'Thủ Đức', address: '2 Võ Văn Ngân', hours: null, phone: null },
      ]);

      const r = await newRefill(prisma, makeConfig(), makeNotifications()).getSummary('u1');

      expect(r.pickupLocations.map((l) => l.id)).toEqual(['a', 'b']);
      expect(r.pickup).toEqual({ address: '1 Lê Lợi', hours: '8h–20h', phone: '0901234567' });
    });

    it('lịch sử kèm điểm đã chọn (null ở dòng cũ)', async () => {
      const prisma = makePrisma();
      (prisma.bottleReturn.findMany as jest.Mock).mockResolvedValue([
        { id: 'h1', quantity: 2, seedsAwarded: 100, status: 'PENDING', createdAt: new Date('2026-03-15'), declaredQuantity: null, rejectionReason: null, pickupLocation: { id: 'a', name: 'Quận 1' } },
        { id: 'h0', quantity: 1, seedsAwarded: 50, status: 'APPROVED', createdAt: new Date('2026-03-01'), declaredQuantity: null, rejectionReason: null, pickupLocation: null },
      ]);

      const r = await newRefill(prisma, makeConfig(), makeNotifications()).getSummary('u1');

      expect(r.history[0]).toMatchObject({ id: 'h1', pickupLocation: { id: 'a', name: 'Quận 1' } });
      expect(r.history[1]).toMatchObject({ id: 'h0', pickupLocation: null });
      const arg = (prisma.bottleReturn.findMany as jest.Mock).mock.calls[0][0];
      expect(arg.include).toEqual({ pickupLocation: { select: { id: true, name: true } } });
    });
  });

  it('listPending kèm tên và địa chỉ điểm nhận để nhân viên biết vỏ sẽ về đâu', async () => {
    const prisma = makePrisma();

    await newRefill(prisma, makeConfig(), makeNotifications()).listPending();

    const arg = (prisma.bottleReturn.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.include.pickupLocation).toEqual({ select: { id: true, name: true, address: true } });
    expect(arg.include.user).toBeDefined();
  });
});
