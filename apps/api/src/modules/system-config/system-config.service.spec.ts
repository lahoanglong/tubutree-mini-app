import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(opts: {
  existing?: { value: unknown } | null;
  findUnique?: jest.Mock;
  upsert?: jest.Mock;
  historyCreate?: jest.Mock;
}) {
  const findUnique = opts.findUnique ?? jest.fn().mockResolvedValue(opts.existing ?? null);
  const upsert = opts.upsert ?? jest.fn().mockResolvedValue({});
  const historyCreate = opts.historyCreate ?? jest.fn().mockResolvedValue({});
  const base: Record<string, unknown> = {
    systemConfig: { findUnique, upsert },
    systemConfigHistory: { create: historyCreate },
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
  return { prisma: base as unknown as PrismaService, findUnique, upsert, historyCreate };
}

describe('SystemConfigService.get', () => {
  it('trả giá trị từ DB khi có row, và cache lại cho lần gọi sau', async () => {
    const { prisma, findUnique } = makePrisma({
      findUnique: jest.fn().mockResolvedValue({ value: 200000 }),
    });
    const service = new SystemConfigService(prisma);
    expect(await service.get<number>('shipping.free_threshold')).toBe(200000);
    expect(await service.get<number>('shipping.free_threshold')).toBe(200000);
    expect(findUnique).toHaveBeenCalledTimes(1); // lần 2 lấy từ cache, không query lại
  });

  it('không có row + không fallback → NotFoundException', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await expect(service.get('missing.key')).rejects.toThrow(NotFoundException);
  });

  it('không có row + có fallback → trả fallback VÀ cache lại (không query DB lần sau)', async () => {
    const { prisma, findUnique } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    expect(await service.get('shipping.free_threshold', 200000)).toBe(200000);
    expect(await service.get('shipping.free_threshold', 200000)).toBe(200000);
    // Trước fix: mỗi lần get() key vắng mặt đều query DB (route @Public /config/public bị ảnh hưởng).
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('SystemConfigService.set', () => {
  it('chặn ghi value null/undefined để tránh crash nơi khác đọc get<T>() không validate runtime', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await expect(service.set('wallet.withdraw_min', null as unknown as number, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('chặn đổi kiểu dữ liệu so với giá trị hiện tại (number → string)', async () => {
    const { prisma, upsert } = makePrisma({ existing: { value: 100000 } });
    const service = new SystemConfigService(prisma);
    await expect(service.set('wallet.withdraw_min', 'khong-phai-so' as unknown as number, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cho phép ghi cùng kiểu dữ liệu, ghi history đúng oldValue/newValue', async () => {
    const { prisma, upsert, historyCreate } = makePrisma({ existing: { value: 100000 } });
    const service = new SystemConfigService(prisma);
    await service.set('wallet.withdraw_min', 150000, 'admin1');
    expect(historyCreate).toHaveBeenCalledWith({
      data: { key: 'wallet.withdraw_min', oldValue: 100000, newValue: 150000, changedBy: 'admin1' },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'wallet.withdraw_min' },
        update: { value: 150000, updatedBy: 'admin1' },
      }),
    );
  });

  it('key chưa tồn tại + không có dấu chấm → category = misc (không phải chính key đó)', async () => {
    const { prisma, upsert } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await service.set('maintenanceMode', true, 'admin1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: 'maintenanceMode', value: true, category: 'misc', updatedBy: 'admin1' },
      }),
    );
  });

  it('key có dấu chấm → category = phần trước dấu chấm đầu tiên', async () => {
    const { prisma, upsert } = makePrisma({ existing: null });
    const service = new SystemConfigService(prisma);
    await service.set('shipping.free_threshold', 200000, 'admin1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: 'shipping.free_threshold', value: 200000, category: 'shipping', updatedBy: 'admin1' },
      }),
    );
  });

  it('set() xoá cache của key để lần get() tiếp theo đọc giá trị mới', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ value: 100000 }) // get() ban đầu
      .mockResolvedValueOnce({ value: 100000 }) // set() đọc existing trong transaction
      .mockResolvedValueOnce({ value: 150000 }); // get() sau khi set() xoá cache
    const { prisma } = makePrisma({ findUnique });
    const service = new SystemConfigService(prisma);
    expect(await service.get<number>('wallet.withdraw_min')).toBe(100000);
    await service.set('wallet.withdraw_min', 150000, 'admin1');
    expect(await service.get<number>('wallet.withdraw_min')).toBe(150000);
  });
});

/**
 * Kiểm tra kiểu không cứu được lỗi ĐƠN VỊ. Mô tả trong seed ghi "User nhận 70%" nhưng giá trị
 * thật là 0.7 — admin nâng lên 80% rất dễ gõ "80": hoa hồng 50.000đ thành 4.000.000đ cộng thẳng
 * vào ví rút được, và sau khi đã trả thì không đòi lại được.
 */
describe('SystemConfigService.set — biên đơn vị cho khoá nhạy cảm', () => {
  function mk() {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: 0.7 }), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { svc: new SystemConfigService(prisma), tx };
  }

  it('tỉ lệ chia hoa hồng gõ 80 thay vì 0.8 → từ chối, không ghi gì', async () => {
    const { svc, tx } = mk();
    await expect(svc.set('cashback.merchant_user_share', 80, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('tỉ lệ âm → từ chối (trước đây trừ ngược vào ví user)', async () => {
    const { svc } = mk();
    await expect(svc.set('cashback.merchant_user_share', -0.5, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('0.8 hợp lệ → ghi bình thường', async () => {
    const { svc, tx } = mk();
    await svc.set('cashback.merchant_user_share', 0.8, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalled();
  });

  it('cùng hậu tố _pct nhưng khác đơn vị: groupbuy nhận 15 (phần trăm nguyên), subscribe từ chối 15', async () => {
    const a = mk();
    await a.svc.set('groupbuy.discount_pct', 15, 'admin1');
    expect(a.tx.systemConfig.upsert).toHaveBeenCalled();

    const b = mk();
    await expect(b.svc.set('subscribe.discount_pct', 15, 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('khoá không nằm trong bảng → không bị ràng buộc thêm', async () => {
    const { svc, tx } = mk();
    await svc.set('shipping.free_threshold', 500000, 'admin1');
    expect(tx.systemConfig.upsert).toHaveBeenCalled();
  });
});
