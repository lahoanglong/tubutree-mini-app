import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GroupBuyService } from './groupbuy.service';
import { CouponsService } from '../coupons/coupons.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'prod1', isActive: true, approvalStatus: 'APPROVED', basePrice: 100000, salePrice: null, name: 'X', slug: 'x', thumbnail: null }) },
    user: { findUnique: jest.fn().mockResolvedValue({ phone: '0912345678', zaloId: 'z1' }) },
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
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  (base.groupBuy as { count?: jest.Mock }).count = jest.fn().mockResolvedValue(0);
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : Promise.all(arg as unknown[]),
    );
  return { ...base, ...over } as unknown as PrismaService;
}

const HOUR = 3600 * 1000;
const expired = (id: string) => ({ id, product: { name: 'Nước rửa chén', slug: 'nuoc-rua-chen' } });
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

describe('GroupBuyService — chống tự làm đủ nhóm bằng tài khoản khách (MONEY-4, ENGAGE-8)', () => {
  const guest = { phone: null, zaloId: 'guest_dev1' };

  it('tài khoản khách (chưa đăng nhập Zalo/chưa SĐT) không mở được nhóm', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(guest);
    await expect(new GroupBuyService(prisma, makeConfig()).create('g1', 'prod1')).rejects.toThrow('đăng nhập Zalo');
    expect(prisma.groupBuy.create).not.toHaveBeenCalled();
  });

  it('tài khoản khách không tham gia được nhóm (không được đếm là thành viên)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group());
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(guest);
    await expect(new GroupBuyService(prisma, makeConfig()).join('g2', 'gb1')).rejects.toThrow('đăng nhập Zalo');
    expect(prisma.groupBuyMember.create).not.toHaveBeenCalled();
  });

  it('sản phẩm chưa duyệt (PENDING_REVIEW) không mở được nhóm', async () => {
    const prisma = makePrisma();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: 'prod1', isActive: true, approvalStatus: 'PENDING_REVIEW', basePrice: 100000, salePrice: null });
    await expect(new GroupBuyService(prisma, makeConfig()).create('u1', 'prod1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mã cấp khi nhóm thành công chỉ áp cho đúng sản phẩm của nhóm (applyTo.productIds)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    await new GroupBuyService(prisma, makeConfig({ 'groupbuy.target_size': 1 })).create('u1', 'prod1');
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ type: 'PERCENT', value: 15, maxDiscount: 15000, minOrder: 85000, applyTo: { productIds: ['prod1'] } });
  });
});

describe('GroupBuyService.create', () => {
  it('hàng gian hàng đối tác tự giao (D4) → không mở được nhóm mua chung', async () => {
    const prisma = makePrisma();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      id: 'prod1', isActive: true, approvalStatus: 'APPROVED', fulfilment: 'MERCHANT', basePrice: 75000, salePrice: null,
    });
    await expect(new GroupBuyService(prisma, makeConfig()).create('u1', 'prod1')).rejects.toThrow(
      'Sản phẩm do gian hàng đối tác tự giao, chưa hỗ trợ mua chung.',
    );
    expect(prisma.groupBuy.create).not.toHaveBeenCalled();
  });

  it('Q8 S2: hàng Tubu giao hộ của gian hàng đối tác → không mở được nhóm mua chung (mã nhóm là chương trình của Tubu)', async () => {
    const prisma = makePrisma();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      id: 'prod1', name: 'Mật ong rừng', isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU', storefrontId: 'sf-doi-tac', basePrice: 75000, salePrice: null,
    });
    await expect(new GroupBuyService(prisma, makeConfig()).create('u1', 'prod1')).rejects.toMatchObject({
      response: {
        code: 'PARTNER_GOODS_NOT_ELIGIBLE',
        message: 'Sản phẩm "Mật ong rừng" là hàng của gian hàng đối tác, không mở mua chung được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.',
      },
    });
    expect(prisma.groupBuy.create).not.toHaveBeenCalled();
  });

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
    expect(r.status).toBe('OPEN');
  });

  it('targetSize (config) = 1: nhóm đủ người NGAY khi tạo → SUCCESS + initiator nhận coupon ngay (không kẹt OPEN mãi)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    const svc = new GroupBuyService(prisma, makeConfig({ 'groupbuy.discount_pct': 15, 'groupbuy.target_size': 1 }));
    const r = await svc.create('u1', 'prod1');
    expect(r.status).toBe('SUCCESS');
    // Lật OPEN→SUCCESS đúng 1 lần (guard count=1) rồi cấp coupon cho initiator.
    const flip = (prisma.groupBuy.updateMany as jest.Mock).mock.calls.find((c) => c[0]?.data?.status === 'SUCCESS');
    expect(flip).toBeTruthy();
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    const markedGranted = (prisma.groupBuy.update as jest.Mock).mock.calls.find((c) => c[0]?.data?.couponsGrantedAt);
    expect(markedGranted).toBeTruthy();
  });

  // P0-2 (docs/2026-09-08-review-progress.md): coupon thu được không có minOrder/product
  // restriction → bất kỳ đơn nào cũng dùng được, không cần mua gì cả (discount = min(value,
  // subtotal) trên MỌI giỏ hàng). Bắt buộc minOrder = unitPrice để coupon chỉ đổi được khi
  // đơn thật ≥ đúng giá trị nhóm mua chung (không còn là "tiền miễn phí").
  it('coupon cấp cho thành viên PHẢI có minOrder = unitPrice của nhóm (không phải tiền miễn phí)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    const svc = new GroupBuyService(prisma, makeConfig({ 'groupbuy.discount_pct': 15, 'groupbuy.target_size': 1 }));
    await svc.create('u1', 'prod1');
    expect(prisma.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minOrder: 85000, value: 15, maxDiscount: 15000 }) }),
    );
  });

  it('user đã có đủ số nhóm OPEN tối đa (chống spam mở nhóm hàng loạt) → BadRequest, KHÔNG tạo nhóm mới', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.count as jest.Mock).mockResolvedValue(2);
    const svc = new GroupBuyService(prisma, makeConfig({ 'groupbuy.max_open_per_user': 2 }));
    await expect(svc.create('u1', 'prod1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.groupBuy.create).not.toHaveBeenCalled();
  });

  it('trần số nhóm OPEN chỉ đếm nhóm khách còn thấy (sản phẩm đang bán, không phải hàng đối tác), như danh sách', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.count as jest.Mock).mockResolvedValue(0);
    await new GroupBuyService(prisma, makeConfig()).create('u1', 'prod1');
    expect((prisma.groupBuy.count as jest.Mock).mock.calls[0][0]).toEqual({
      where: { initiatorId: 'u1', status: 'OPEN', product: { storefrontId: null, isActive: true, approvalStatus: 'APPROVED' } },
    });
  });

  it('D4-04: đếm nhóm OPEN và tạo nhóm nằm trong cùng một transaction, giữ khoá advisory theo khách', async () => {
    const prisma = makePrisma();
    await new GroupBuyService(prisma, makeConfig()).create('u1', 'prod1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const order = [
      ...(prisma.$executeRaw as unknown as jest.Mock).mock.invocationCallOrder,
      ...(prisma.groupBuy.count as jest.Mock).mock.invocationCallOrder,
      ...(prisma.groupBuy.create as jest.Mock).mock.invocationCallOrder,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(((prisma.$executeRaw as unknown as jest.Mock).mock.calls[0] as unknown[]).join(' ')).toContain('u1');
  });

  it('còn dưới trần số nhóm OPEN → vẫn tạo được bình thường', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.count as jest.Mock).mockResolvedValue(1);
    const svc = new GroupBuyService(prisma, makeConfig({ 'groupbuy.max_open_per_user': 2 }));
    await expect(svc.create('u1', 'prod1')).resolves.toBeDefined();
    expect(prisma.groupBuy.create).toHaveBeenCalled();
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

  it('sản phẩm của nhóm đã ngừng bán (tắt hoặc chưa duyệt) → từ chối, không thêm thành viên', async () => {
    for (const state of [{ isActive: false, approvalStatus: 'APPROVED' }, { isActive: true, approvalStatus: 'REJECTED' }]) {
      const prisma = makePrisma();
      (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group());
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ name: 'X', slug: 'x', storefrontId: null, ...state });
      await expect(new GroupBuyService(prisma, makeConfig()).join('u1', 'gb1')).rejects.toThrow('ngừng bán');
      expect(prisma.groupBuyMember.create).not.toHaveBeenCalled();
    }
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
    expect(c).toMatchObject({ type: 'PERCENT', value: 15, maxDiscount: 15000 }); // basePrice 100000 − unitPrice 85000
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

  it('D5-04: GROUP_BUY_SUCCESS mang tên sản phẩm, mã coupon của chính người nhận và hạn dùng (giờ VN)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T10:00:00.000Z'));
    try {
      const prisma = makePrisma();
      (prisma.groupBuy.findUnique as jest.Mock)
        .mockResolvedValueOnce(group({ id: 'gbABC', currentSize: 2, targetSize: 3 }))
        .mockResolvedValueOnce(group({ id: 'gbABC', currentSize: 3, targetSize: 3 }));
      (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'userZZZ' }]);
      (prisma.product as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'prod1', isActive: true, approvalStatus: 'APPROVED', basePrice: 100000, salePrice: null, name: 'Nước rửa chén', slug: 'nuoc-rua-chen', thumbnail: null,
      });
      const notify = jest.fn().mockResolvedValue(undefined);
      await new GroupBuyService(prisma, makeConfig(), { notify } as never).join('u1', 'gbABC');
      expect(notify).toHaveBeenCalledWith('userZZZ', 'GROUP_BUY_SUCCESS', {
        discount: '15.000',
        product: 'Nước rửa chén',
        code: 'GBUY-GBABC-USERZZZ',
        expires: '16/11/2026',
      });
    } finally {
      jest.useRealTimers();
    }
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

  it('race: 2 request tham gia đồng thời CÙNG user (double-click/retry) đều qua check `existing` → P2002 trên @@unique([groupBuyId,userId]) → BadRequest thân thiện (không rơi vào lỗi 409 chung)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group());
    (prisma.groupBuyMember.create as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
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

  // ENGAGE-9: listOpen luôn trả joined=false nên người mở nhóm vẫn thấy nút "Tham gia" và bấm ra lỗi "đã tham gia".
  it('listOpen(userId): joined theo thành viên thật, isOwner cho người mở nhóm', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValueOnce([
      { ...group({ id: 'mine', initiatorId: 'u1' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 1 } },
      { ...group({ id: 'joined', initiatorId: 'u9' }), product: { name: 'B', slug: 'b', thumbnail: null }, _count: { members: 2 } },
      { ...group({ id: 'other', initiatorId: 'u9' }), product: { name: 'C', slug: 'c', thumbnail: null }, _count: { members: 2 } },
    ]);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ groupBuyId: 'mine' }, { groupBuyId: 'joined' }]);
    const r = await new GroupBuyService(prisma, makeConfig()).listOpen('u1');
    expect(r.map((g) => [g.id, g.joined, g.isOwner])).toEqual([
      ['mine', true, true],
      ['joined', true, false],
      ['other', false, false],
    ]);
    expect(prisma.groupBuyMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', groupBuyId: { in: ['mine', 'joined', 'other'] } },
      select: { groupBuyId: true },
    });
  });

  it('R2-BUYERMINI-4: listOpen(userId) kèm nhóm đã đủ người của chính mình (còn hạn dùng mã) và mã giảm của mình', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { ...group({ id: 'open1', initiatorId: 'u9' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 1 } },
      ])
      .mockResolvedValueOnce([
        { ...group({ id: 'cmgroupdone1234', initiatorId: 'cmuserowner5678', status: 'SUCCESS' }), product: { name: 'B', slug: 'b', thumbnail: null }, _count: { members: 3 } },
      ]);
    const r = await new GroupBuyService(prisma, makeConfig()).listOpen('cmuserowner5678');
    expect(r.map((g) => [g.id, g.status, g.joined, g.couponCode ?? null])).toEqual([
      ['open1', 'OPEN', false, null],
      ['cmgroupdone1234', 'SUCCESS', true, 'GBUY-DONE1234-WNER5678'],
    ]);
    const successWhere = (prisma.groupBuy.findMany as jest.Mock).mock.calls[1][0].where;
    expect(successWhere).toMatchObject({ status: 'SUCCESS', members: { some: { userId: 'cmuserowner5678' } } });
  });

  it('getGroup: nhóm đã đủ người trả mã giảm của thành viên đang xem; người ngoài nhóm không có mã', async () => {
    const prisma = makePrisma();
    const svc = new GroupBuyService(prisma, makeConfig());
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue({
      ...group({ id: 'cmgroupdone1234', status: 'SUCCESS' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 3 }, members: [{ id: 'm' }],
    });
    expect(await svc.getGroup('cmgroupdone1234', 'cmuserowner5678')).toMatchObject({ couponCode: 'GBUY-DONE1234-WNER5678' });
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue({
      ...group({ id: 'cmgroupdone1234', status: 'SUCCESS' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 3 }, members: [],
    });
    expect((await svc.getGroup('cmgroupdone1234', 'u2')).couponCode).toBeUndefined();
  });

  it('listOpen không có user (khách chưa đăng nhập): joined=false, isOwner=false, không truy vấn thành viên', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([
      { ...group({ initiatorId: 'u1' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 1 } },
    ]);
    const r = await new GroupBuyService(prisma, makeConfig()).listOpen();
    expect(r[0]).toMatchObject({ joined: false, isOwner: false });
    expect(prisma.groupBuyMember.findMany).not.toHaveBeenCalled();
  });

  it('getGroup/create: người mở nhóm có isOwner=true', async () => {
    const prisma = makePrisma();
    const svc = new GroupBuyService(prisma, makeConfig());
    const created = await svc.create('u1', 'prod1');
    expect(created).toMatchObject({ joined: true, isOwner: true });
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue({
      ...group({ initiatorId: 'u1' }), product: { name: 'A', slug: 'a', thumbnail: null }, _count: { members: 1 }, members: [{ id: 'm' }],
    });
    expect(await svc.getGroup('gb1', 'u1')).toMatchObject({ joined: true, isOwner: true });
    expect(await svc.getGroup('gb1', 'u2')).toMatchObject({ isOwner: false });
  });

  it('expireGroups: đánh dấu OPEN quá hạn → FAILED, trả số lượng', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([expired('gbA'), expired('gbB')]);
    const n = await new GroupBuyService(prisma, makeConfig()).expireGroups();
    expect(n).toBe(2);
    const call = (prisma.groupBuy.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'gbA', status: 'OPEN' });
    expect(call.where.expiresAt).toHaveProperty('lte');
    expect(call.data.status).toBe('FAILED');
  });

  // R2-ENGAGE-10: nhóm hết hạn chuyển FAILED trong im lặng, khách chờ mà không biết kết quả.
  describe('báo thành viên khi nhóm hết hạn (R2-ENGAGE-10)', () => {
    it('mỗi thành viên (kể cả người mở nhóm) nhận GROUP_BUY_FAILED kèm tên sản phẩm và slug', async () => {
      const prisma = makePrisma();
      (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([expired('gbA')]);
      (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }]);
      const notify = jest.fn().mockResolvedValue(undefined);
      await new GroupBuyService(prisma, makeConfig(), { notify } as never).expireGroups();
      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledWith('u0', 'GROUP_BUY_FAILED', { product: 'Nước rửa chén', product_slug: 'nuoc-rua-chen' });
      expect(notify).toHaveBeenCalledWith('uA', 'GROUP_BUY_FAILED', { product: 'Nước rửa chén', product_slug: 'nuoc-rua-chen' });
    });

    it('chỉ báo nhóm do CHÍNH lần quét này chuyển FAILED (cron/instance khác đã chuyển rồi thì không báo lại)', async () => {
      const prisma = makePrisma();
      (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([expired('gbA'), expired('gbB')]);
      (prisma.groupBuy.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }]);
      const notify = jest.fn().mockResolvedValue(undefined);
      const n = await new GroupBuyService(prisma, makeConfig(), { notify } as never).expireGroups();
      expect(n).toBe(1);
      expect(prisma.groupBuyMember.findMany).toHaveBeenCalledTimes(1);
      expect((prisma.groupBuyMember.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ groupBuyId: 'gbB' });
    });

    it('thông báo lỗi không làm hỏng việc đóng nhóm và không chặn thành viên còn lại', async () => {
      const prisma = makePrisma();
      (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([expired('gbA')]);
      (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }]);
      const notify = jest.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(undefined);
      const n = await new GroupBuyService(prisma, makeConfig(), { notify } as never).expireGroups();
      expect(n).toBe(1);
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('không có dịch vụ thông báo (khởi tạo trực tiếp) vẫn đóng nhóm bình thường', async () => {
      const prisma = makePrisma();
      (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([expired('gbA')]);
      expect(await new GroupBuyService(prisma, makeConfig()).expireGroups()).toBe(1);
    });
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

describe('Q8 review vòng 3 S2: nhóm đã mở trên hàng của gian hàng đối tác không thành công được', () => {
  const partnerProduct = { id: 'prod1', name: 'Mật ong rừng', slug: 'mat-ong-rung', storefrontId: 'sf-doi-tac', isActive: true, approvalStatus: 'APPROVED' };
  const NOT_ELIGIBLE = {
    response: {
      code: 'PARTNER_GOODS_NOT_ELIGIBLE',
      message: 'Sản phẩm "Mật ong rừng" là hàng của gian hàng đối tác, không mở mua chung được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.',
    },
  };

  it('tham gia nhóm OPEN của hàng đối tác → từ chối, không thêm thành viên; nhóm đóng (FAILED) và các thành viên nhận GROUP_BUY_FAILED', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock).mockResolvedValue(group({ currentSize: 2, targetSize: 3 }));
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(partnerProduct);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }]);
    const notify = jest.fn().mockResolvedValue(undefined);
    await expect(new GroupBuyService(prisma, makeConfig(), { notify } as never).join('u1', 'gb1')).rejects.toMatchObject(NOT_ELIGIBLE);
    expect(prisma.groupBuyMember.create).not.toHaveBeenCalled();
    expect(prisma.groupBuy.updateMany).toHaveBeenCalledWith({ where: { id: 'gb1', status: 'OPEN' }, data: { status: 'FAILED' } });
    expect(notify.mock.calls).toEqual([
      ['u0', 'GROUP_BUY_FAILED', { product: 'Mật ong rừng', product_slug: 'mat-ong-rung' }],
      ['uA', 'GROUP_BUY_FAILED', { product: 'Mật ong rừng', product_slug: 'mat-ong-rung' }],
    ]);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });

  it('nhóm vừa đủ người nhưng sản phẩm đã thành hàng đối tác → không cấp mã, nhóm FAILED, báo thành viên', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findUnique as jest.Mock)
      .mockResolvedValueOnce(group({ currentSize: 2, targetSize: 3 }))
      .mockResolvedValueOnce(group({ currentSize: 3, targetSize: 3 }));
    (prisma.product.findUnique as jest.Mock)
      .mockResolvedValueOnce({ ...partnerProduct, storefrontId: null })
      .mockResolvedValue(partnerProduct);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }, { userId: 'u1' }]);
    const notify = jest.fn().mockResolvedValue(undefined);
    const r = await new GroupBuyService(prisma, makeConfig(), { notify } as never).join('u1', 'gb1');
    expect(r.status).toBe('FAILED');
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(prisma.groupBuy.updateMany).toHaveBeenLastCalledWith({ where: { id: 'gb1', status: 'SUCCESS' }, data: { status: 'FAILED' } });
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledWith('u1', 'GROUP_BUY_FAILED', { product: 'Mật ong rừng', product_slug: 'mat-ong-rung' });
  });

  it('đối soát nhóm SUCCESS chưa phát mã trên hàng đối tác → không cấp mã, nhóm FAILED, báo thành viên', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([group({ id: 'gbX', status: 'SUCCESS' })]);
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(partnerProduct);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u0' }, { userId: 'uA' }]);
    const notify = jest.fn().mockResolvedValue(undefined);
    expect(await new GroupBuyService(prisma, makeConfig(), { notify } as never).reconcileSuccessfulGroups()).toBe(0);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(prisma.groupBuy.updateMany).toHaveBeenCalledWith({ where: { id: 'gbX', status: 'SUCCESS' }, data: { status: 'FAILED' } });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('danh sách nhóm đang mở không gồm nhóm của hàng đối tác', async () => {
    const prisma = makePrisma();
    await new GroupBuyService(prisma, makeConfig()).listOpen();
    expect((prisma.groupBuy.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({ status: 'OPEN', product: { storefrontId: null } });
  });

  it('danh sách chỉ gồm nhóm của sản phẩm đang bán (cả nhóm đang mở lẫn nhóm đã đủ người của mình)', async () => {
    const prisma = makePrisma();
    await new GroupBuyService(prisma, makeConfig()).listOpen('u1');
    const calls = (prisma.groupBuy.findMany as jest.Mock).mock.calls;
    expect(calls[0][0].where.product).toMatchObject({ isActive: true, approvalStatus: 'APPROVED' });
    expect(calls[1][0].where.product).toEqual({ isActive: true, approvalStatus: 'APPROVED' });
  });
});

describe('D11-05: mã mua chung giảm đúng % trên biến thể khách mua, không chỉ trên biến thể rẻ nhất', () => {
  const variations = [
    { retailPrice: 120000, salePrice: null },
    { retailPrice: 430000, salePrice: null },
  ];

  async function grantedCoupon() {
    const prisma = makePrisma();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      id: 'prod1', isActive: true, approvalStatus: 'APPROVED', basePrice: 120000, salePrice: null, name: 'X', slug: 'x', thumbnail: null,
    });
    (prisma.variation.findMany as jest.Mock).mockResolvedValue(variations);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    await new GroupBuyService(prisma, makeConfig({ 'groupbuy.discount_pct': 15, 'groupbuy.target_size': 1 })).create('u1', 'prod1');
    return (prisma.coupon.create as jest.Mock).mock.calls[0][0].data as Record<string, unknown>;
  }

  async function discountOn(data: Record<string, unknown>, lines: { total: number }[]) {
    const row = { id: 'c1', ...data, startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 864e5), usageLimit: null };
    const prisma = {
      coupon: { findUnique: jest.fn().mockResolvedValue(row) },
      couponRedemption: { count: jest.fn().mockResolvedValue(0) },
      user: { findUnique: jest.fn().mockResolvedValue({ phone: '0912345678', zaloId: 'z1' }) },
    } as unknown as PrismaService;
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const r = await new CouponsService(prisma).validateAndCompute(String(data.code), 'u1', subtotal, lines.map((l) => ({ productId: 'prod1', ...l })));
    return r.discount;
  }

  it('sản phẩm 2 biến thể 120k/430k → mua biến thể 430k được giảm 64.500đ (15%)', async () => {
    expect(await discountOn(await grantedCoupon(), [{ total: 430000 }])).toBe(64500);
  });

  it('mua biến thể rẻ 120k vẫn giảm 18.000đ (15%)', async () => {
    expect(await discountOn(await grantedCoupon(), [{ total: 120000 }])).toBe(18000);
  });

  it('không bao giờ giảm quá 15% giá thật của biến thể đắt nhất, kể cả mua nhiều', async () => {
    expect(await discountOn(await grantedCoupon(), [{ total: 430000 * 5 }])).toBe(64500);
  });

  it('đối soát cấp lại mã cho nhóm cũ vẫn ra cùng mức giảm (suy % từ giá nhóm đã lưu)', async () => {
    const prisma = makePrisma();
    (prisma.groupBuy.findMany as jest.Mock).mockResolvedValue([group({ id: 'gbX', status: 'SUCCESS', basePrice: 120000, unitPrice: 102000 })]);
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    (prisma.variation.findMany as jest.Mock).mockResolvedValue(variations);
    await new GroupBuyService(prisma, makeConfig()).reconcileSuccessfulGroups();
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(await discountOn(data, [{ total: 430000 }])).toBe(64500);
  });

  it('sản phẩm không có biến thể đang bán → giữ mức giảm theo giá nhóm như cũ', async () => {
    const prisma = makePrisma();
    (prisma.groupBuyMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'u1' }]);
    await new GroupBuyService(prisma, makeConfig({ 'groupbuy.target_size': 1 })).create('u1', 'prod1');
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data as Record<string, unknown>;
    expect(await discountOn(data, [{ total: 100000 }])).toBe(15000);
  });
});
