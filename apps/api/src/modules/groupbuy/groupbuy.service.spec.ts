import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GroupBuyService } from './groupbuy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'prod1', isActive: true, basePrice: 100000, salePrice: null, name: 'X', slug: 'x', thumbnail: null }) },
    groupBuy: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'gb1', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    groupBuyMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    coupon: { create: jest.fn().mockResolvedValue({}) },
  };
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : Promise.all(arg as unknown[]),
    );
  return { ...base, ...over } as unknown as PrismaService;
}

const HOUR = 3600 * 1000;
function group(extra: Record<string, unknown> = {}) {
  return {
    id: 'gb1',
    productId: 'prod1',
    initiatorId: 'u0',
    targetSize: 3,
    currentSize: 1,
    unitPrice: 85000,
    basePrice: 100000,
    status: 'OPEN',
    expiresAt: new Date(Date.now() + 24 * HOUR),
    ...extra,
  };
}

describe('GroupBuyService.create', () => {
  it('sản phẩm không tồn tại/ngừng bán → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(new GroupBuyService(prisma, makeConfig()).create('u1', 'pX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tạo nhóm OPEN: giá nhóm = base × (1−pct), người tạo tự tham gia (currentSize 1)', async () => {
    const prisma = makePrisma();
    const svc = new GroupBuyService(prisma, makeConfig({ 'groupbuy.discount_pct': 15, 'groupbuy.target_size': 3 }));
    const r = await svc.create('u1', 'prod1');
    const data = (prisma.groupBuy.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ productId: 'prod1', initiatorId: 'u1', targetSize: 3, currentSize: 1, unitPrice: 85000, basePrice: 100000, status: 'OPEN' });
    expect(data.members.create).toMatchObject({ userId: 'u1' }); // người tạo là thành viên đầu tiên
    expect(r.unitPrice).toBe(85000);
  });
});

describe('GroupBuyService.join', () => {
  it('nhóm không tồn tại → NotFound', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gbX')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhóm không OPEN → throw', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group({ status: 'SUCCESS' }));
    await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nhóm hết hạn → throw', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group({ expiresAt: new Date(Date.now() - HOUR) }));
    await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đã là thành viên → throw', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group());
    (prisma.groupBuyMember.findUnique as jest.Mock).mockResolvedValue({ id: 'm1' });
    await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('join chưa đủ target → tăng currentSize, vẫn OPEN, không cấp coupon', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ currentSize: 1, targetSize: 3 })) // pre-check
      .mockResolvedValueOnce(group({ currentSize: 2, targetSize: 3 })); // re-read trong tx
    const r = await new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1');
    expect(r.status).toBe('OPEN');
    expect(r.currentSize).toBe(2);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(prisma.groupBuyMember.create).toHaveBeenCalled();
  });

  it('join đủ target → SUCCESS + cấp coupon giảm giá cho TẤT CẢ thành viên', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ currentSize: 2, targetSize: 3 }))
      .mockResolvedValueOnce(group({ currentSize: 3, targetSize: 3 }));
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }, { userId: 'u1' }]);
    const r = await new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1');
    expect(r.status).toBe('SUCCESS');
    expect(prisma.coupon.create).toHaveBeenCalledTimes(3); // mỗi thành viên 1 coupon
    const c = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(c.value).toBe(15000); // basePrice 100000 − unitPrice 85000
  });

  it('join đủ target → mã coupon TẤT ĐỊNH theo (nhóm,user) + đánh dấu couponsGrantedAt', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ id: 'gbABC', currentSize: 2, targetSize: 3 }))
      .mockResolvedValueOnce(group({ id: 'gbABC', currentSize: 3, targetSize: 3 }));
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'userZZZ' }]);
    await new GroupBuyService(prisma, makeConfig()).join('u1', 'gbABC');
    const code = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data.code as string;
    // tất định: KHÔNG số ngẫu nhiên — chạy lại cho ra đúng mã này (để @unique chặn cấp trùng)
    expect(code).toBe(`GBUY-GBABC-USERZZZ`);
    // cấp xong không lỗi → đánh dấu đã phát coupon
    const marked = (prisma.groupBuy.update as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.couponsGrantedAt,
    );
    expect(marked).toBeTruthy();
  });

  it('grant coupon gặp P2002 (đã có) → coi như đã cấp, KHÔNG re-notify, vẫn đánh dấu granted', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ currentSize: 2, targetSize: 3 }))
      .mockResolvedValueOnce(group({ currentSize: 3, targetSize: 3 }));
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }]);
    (prisma.coupon.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const svc = new GroupBuyService(prisma, makeConfig(), notifications as never);
    const r = await svc.join('u1', 'gb1');
    expect(r.status).toBe('SUCCESS'); // P2002 không làm hỏng flow
    expect(notifications.notify).not.toHaveBeenCalled(); // đã cấp trước đó → không spam thông báo lại
    const marked = (prisma.groupBuy.update as jest.Mock).mock.calls.find((c) => c[0]?.data?.couponsGrantedAt);
    expect(marked).toBeTruthy();
  });

  it('grant coupon lỗi thật (không phải P2002) → KHÔNG đánh dấu granted (để reconcile thử lại)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ currentSize: 2, targetSize: 3 }))
      .mockResolvedValueOnce(group({ currentSize: 3, targetSize: 3 }));
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }]);
    (prisma.coupon.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const r = await new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1');
    expect(r.status).toBe('SUCCESS'); // join vẫn thành công (lỗi cấp coupon không chặn)
    const marked = (prisma.groupBuy.update as jest.Mock).mock.calls.find((c) => c[0]?.data?.couponsGrantedAt);
    expect(marked).toBeFalsy(); // chưa cấp đủ → không đánh dấu
  });

  it('race: increment guard count=0 (nhóm vừa đủ) → throw, rollback', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group({ currentSize: 2, targetSize: 3 }));
    (prisma.groupBuy.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GroupBuyService.listOpen / expireGroups', () => {
  it('listOpen: chỉ nhóm OPEN còn hạn', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([
      { ...group(), product: { name: 'X', slug: 'x', thumbnail: null }, _count: { members: 2 } },
    ]);
    const r = await new GroupBuyService(prisma, makeConfig()).listOpen();
    expect(r).toHaveLength(1);
    const where = (prisma.groupBuy.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.expiresAt).toHaveProperty('gt');
  });

  it('expireGroups: đánh dấu OPEN quá hạn → FAILED, trả số lượng', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.updateMany as jest.Mock).mockResolvedValue({ count: 4 });
    const n = await new GroupBuyService(prisma, makeConfig()).expireGroups();
    expect(n).toBe(4);
    const call = (prisma.groupBuy.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where.status).toBe('OPEN');
    expect(call.data.status).toBe('FAILED');
  });
});

describe('GroupBuyService.reconcileSuccessfulGroups', () => {
  it('nhóm SUCCESS chưa phát coupon (couponsGrantedAt null) → cấp lại cho mọi thành viên + đánh dấu', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([group({ id: 'gbX', status: 'SUCCESS' })]);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }]);
    const n = await new GroupBuyService(prisma, makeConfig()).reconcileSuccessfulGroups();
    expect(n).toBe(1);
    // chỉ quét nhóm SUCCESS chưa granted
    const where = (prisma.groupBuy.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('SUCCESS');
    expect(where.couponsGrantedAt).toBeNull();
    expect(prisma.coupon.create).toHaveBeenCalledTimes(2); // 2 thành viên
    const marked = (prisma.groupBuy.update as jest.Mock).mock.calls.find((c) => c[0]?.data?.couponsGrantedAt);
    expect(marked).toBeTruthy();
  });

  it('không có nhóm cần reconcile → trả 0, không cấp coupon', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([]);
    const n = await new GroupBuyService(prisma, makeConfig()).reconcileSuccessfulGroups();
    expect(n).toBe(0);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });
});
