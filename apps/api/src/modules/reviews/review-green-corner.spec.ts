import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReviewsService, moderationAfterEdit, reviewImageVersions } from './reviews.service';
import { clipComment, readGreenCornerConfig, reviewMediaKey, type GreenCornerConfig } from './review-green-corner';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const analytics = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
const EXPIRES = new Date('2027-11-18T00:00:00.000Z');
const loyalty = { pointsExpiresAt: jest.fn(async () => EXPIRES) } as unknown as LoyaltyService;

const configOf = (values: Record<string, unknown>) =>
  ({ get: jest.fn(async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback)) }) as unknown as SystemConfigService;
const ON = configOf({ 'reviews.green_corner_enabled': true, 'reviews.photo_reward_points': 100, 'reviews.photo_reward_daily_cap': 3 });
const OFF = configOf({ 'reviews.green_corner_enabled': false });

/** Ảnh raster base64 nén như app gửi khi chưa có Cloudinary: tính là ảnh thật (isUploadedImage). */
const IMG = `data:image/jpeg;base64,${'A'.repeat(1000)}`;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', slug: 'khan-tre' }), update: jest.fn() },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
    order: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', code: 'TB-1', deliveredAt: new Date('2026-11-10T03:00:00Z') }]) },
    orderItem: { findFirst: jest.fn().mockResolvedValue({ id: 'li1' }), findMany: jest.fn().mockResolvedValue([]) },
    review: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', images: [], imageVersions: [], ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', images: [], imageVersions: [], ...data })),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    pointsTransaction: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn() },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  const prisma = { ...base, ...over } as typeof base;
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}
type MockPrisma = ReturnType<typeof makePrisma>;

const svc = (prisma: MockPrisma, config: SystemConfigService | undefined = ON) =>
  new ReviewsService(prisma as unknown as PrismaService, analytics, loyalty, config);

describe('readGreenCornerConfig', () => {
  it('mặc định: tắt, +100 điểm, 3 đánh giá/ngày', async () => {
    await expect(readGreenCornerConfig(configOf({}))).resolves.toEqual({ enabled: false, rewardPoints: 100, dailyCap: 3 });
  });

  it('chỉ boolean true mới bật; số lẻ, âm, quá trần rơi về mặc định; 0 hợp lệ', async () => {
    await expect(readGreenCornerConfig(configOf({ 'reviews.green_corner_enabled': 'true' }))).resolves.toMatchObject({ enabled: false });
    await expect(
      readGreenCornerConfig(configOf({ 'reviews.photo_reward_points': 1.5, 'reviews.photo_reward_daily_cap': -1 })),
    ).resolves.toMatchObject({ rewardPoints: 100, dailyCap: 3 });
    await expect(readGreenCornerConfig(configOf({ 'reviews.photo_reward_points': 50_000 }))).resolves.toMatchObject({ rewardPoints: 100 });
    await expect(
      readGreenCornerConfig(configOf({ 'reviews.photo_reward_points': 0, 'reviews.photo_reward_daily_cap': 0 })),
    ).resolves.toMatchObject({ rewardPoints: 0, dailyCap: 0 });
  });
});

describe('clipComment', () => {
  it('gộp khoảng trắng, cắt 120 ký tự kèm dấu …, chuỗi trống thành null', () => {
    expect(clipComment('  rất   tốt \n nhé ')).toBe('rất tốt nhé');
    expect(clipComment('   ')).toBeNull();
    expect(clipComment(null)).toBeNull();
    const out = clipComment('a'.repeat(200))!;
    expect(out).toHaveLength(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('moderationAfterEdit', () => {
  const on: GreenCornerConfig = { enabled: true, rewardPoints: 100, dailyCap: 3 };
  const off: GreenCornerConfig = { enabled: false, rewardPoints: 100, dailyCap: 3 };
  const NOW = new Date('2026-11-18T08:00:00Z');
  const visible = { imageVersions: reviewImageVersions([IMG]), videoUrl: null, isVisible: true, awaitingApproval: false, approvedAt: null };
  const approved = { ...visible, approvedAt: new Date('2026-11-18T03:00:00Z') };
  const pending = { ...visible, isVisible: false, awaitingApproval: true };
  const QUEUED = { awaitingApproval: true, isVisible: false, approvedAt: null, photoQueuedAt: NOW };

  it('cờ tắt và không đang chờ: không đổi gì (như cũ)', () => {
    expect(moderationAfterEdit(off, visible, { images: [] }, NOW)).toEqual({});
    expect(moderationAfterEdit(off, approved, { images: [IMG] }, NOW)).toEqual({});
  });

  it('cờ tắt mà đổi ảnh của đánh giá đã duyệt → bỏ mốc duyệt (bật lại cờ, dải Trang chủ không hiện ảnh chưa ai xem)', () => {
    expect(moderationAfterEdit(off, approved, { images: [IMG, IMG] }, NOW)).toEqual({ approvedAt: null });
    expect(moderationAfterEdit(on, { ...approved, isVisible: false }, { images: [IMG, IMG] }, NOW)).toEqual({ approvedAt: null });
  });

  it('đổi ảnh của đánh giá đang hiện → về hàng chờ, bỏ mốc duyệt cũ, ghi lúc vào hàng chờ', () => {
    expect(moderationAfterEdit(on, approved, { images: [IMG, IMG] }, NOW)).toEqual(QUEUED);
  });

  it('giữ nguyên ảnh, chỉ sửa chữ → vẫn hiện, giữ mốc duyệt', () => {
    expect(moderationAfterEdit(on, approved, { images: [IMG] }, NOW)).toEqual({});
  });

  it('admin đã ẩn: sửa không gỡ được lệnh ẩn', () => {
    expect(moderationAfterEdit(on, { ...visible, isVisible: false }, { images: [] }, NOW)).toEqual({});
    expect(moderationAfterEdit(on, { ...visible, isVisible: false }, { images: [IMG, IMG] }, NOW)).toEqual({});
  });

  it('đang chờ mà bỏ hết ảnh → hiện ngay như đánh giá chỉ chữ; còn ảnh thì vẫn chờ, kể cả khi cờ đã tắt', () => {
    expect(moderationAfterEdit(off, pending, { images: [] }, NOW)).toEqual({ awaitingApproval: false, isVisible: true });
    expect(moderationAfterEdit(off, pending, { images: [IMG] }, NOW)).toEqual(QUEUED);
  });
});

describe('ReviewsService.create khi Góc Sống Xanh bật', () => {
  it('có ảnh: chờ duyệt (không công khai), KHÔNG cộng điểm lúc gửi, lưu thẻ cảm nhận', async () => {
    const prisma = makePrisma();
    const out = await svc(prisma).create('u1', 'khan-tre', { rating: 5, images: [IMG], ecoTags: ['soft', 'baby_safe'], orderId: 'o1' } as never);
    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pointsEarned: 0,
        awaitingApproval: true,
        isVisible: false,
        photoQueuedAt: expect.any(Date),
        ecoTags: ['soft', 'baby_safe'],
      }),
    });
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ awaitingApproval: true, isVisible: false, updated: false });
  });

  it('chỉ chữ: hiện ngay, không cộng 5.000 như bảng cũ', async () => {
    const prisma = makePrisma();
    await svc(prisma).create('u1', 'khan-tre', { rating: 4, comment: 'mềm', orderId: 'o1' } as never);
    const data = prisma.review.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ pointsEarned: 0 });
    expect(data).not.toHaveProperty('awaitingApproval');
    expect(data).not.toHaveProperty('isVisible');
    expect(data).not.toHaveProperty('ecoTags');
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('đánh giá mới quá 3 ảnh → 400, không ghi gì', async () => {
    const prisma = makePrisma();
    await expect(svc(prisma).create('u1', 'khan-tre', { rating: 5, images: [IMG, IMG, IMG, IMG], orderId: 'o1' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('cờ tắt: 4 ảnh vẫn nhận và thưởng 10.000 lúc gửi như cũ', async () => {
    const prisma = makePrisma();
    await svc(prisma, OFF).create('u1', 'khan-tre', { rating: 5, images: [IMG, IMG, IMG, IMG], orderId: 'o1' } as never);
    const data = prisma.review.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ pointsEarned: 10_000 });
    expect(data).not.toHaveProperty('awaitingApproval');
  });

  it('sửa đánh giá đã hiện và đổi ảnh → về hàng chờ; không gửi ecoTags thì giữ thẻ cũ; không cộng điểm', async () => {
    const prisma = makePrisma();
    prisma.review.findUnique.mockResolvedValue({ id: 'r1', images: [IMG], videoUrl: null, isVisible: true, awaitingApproval: false, pointsEarned: 100 });
    prisma.$queryRaw.mockResolvedValue([
      { imageVersions: reviewImageVersions([IMG]), videoUrl: null, isVisible: true, awaitingApproval: false, approvedAt: new Date() },
    ]);
    await svc(prisma).create('u1', 'khan-tre', { rating: 5, images: [IMG, IMG], orderId: 'o1' } as never);
    const data = prisma.review.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ awaitingApproval: true, isVisible: false, approvedAt: null, photoQueuedAt: expect.any(Date) });
    expect(data).not.toHaveProperty('ecoTags');
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('sửa đọc trạng thái duyệt dưới khoá dòng: admin vừa ẩn (dù lúc mở form còn chờ) thì bỏ hết ảnh cũng không hiện lại', async () => {
    const prisma = makePrisma();
    prisma.review.findUnique.mockResolvedValue({ id: 'r1', images: [IMG], videoUrl: null, isVisible: false, awaitingApproval: true, pointsEarned: 0 });
    prisma.$queryRaw.mockResolvedValue([
      { imageVersions: reviewImageVersions([IMG]), videoUrl: null, isVisible: false, awaitingApproval: false, approvedAt: null },
    ]);
    await svc(prisma).create('u1', 'khan-tre', { rating: 3, comment: 'thôi', images: [], orderId: 'o1' } as never);
    const sql = (prisma.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain('FROM "reviews"');
    expect(sql).toContain('FOR UPDATE');
    const data = prisma.review.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('isVisible');
    expect(data).not.toHaveProperty('awaitingApproval');
  });
});

describe('ReviewsService.approve', () => {
  const pendingRow = (over: Record<string, unknown> = {}) => ({
    userId: 'u1',
    productId: 'p1',
    isVisible: false,
    awaitingApproval: true,
    approvedAt: null,
    photoQueuedAt: new Date('2026-11-18T02:00:00Z'),
    pointsEarned: 0,
    imageVersions: ['0123456789'],
    videoUrl: null,
    createdAt: new Date('2026-11-18T02:00:00Z'),
    ...over,
  });
  const KEY = reviewMediaKey(['0123456789'], null);
  const approvable = (row: Record<string, unknown> = pendingRow(), orderStatus = 'DELIVERED') => {
    const prisma = makePrisma();
    prisma.review.findUnique.mockResolvedValue({ userId: 'u1', productId: 'p1', orderId: 'o1' });
    prisma.$queryRaw.mockReset().mockResolvedValueOnce([{ status: orderStatus }]).mockResolvedValueOnce([row]);
    return prisma;
  };

  it('chờ duyệt có ảnh → hiện, +100 Điểm Xanh một dòng sổ REVIEW_PHOTO:<dòng đơn>, gộp vào pointsEarned để xoá/trả hàng thu hồi', async () => {
    const prisma = approvable();
    const out = await svc(prisma).approve('r1', KEY);
    expect(out).toEqual({ ok: true, isVisible: true, alreadyApproved: false, rewardPoints: 100, rewardSkipped: null });
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { isVisible: true, awaitingApproval: false, approvedAt: expect.any(Date), pointsEarned: { increment: 100 }, photoRewardPoints: 100 },
    });
    expect(prisma.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', delta: 100, reason: 'REVIEW_PHOTO:li1', refType: 'REVIEW', refId: 'r1', expiresAt: EXPIRES },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 100 } } });
    // Trần đếm các đánh giá được thưởng viết cùng ngày giờ VN với đánh giá này (18/11 VN = 17/11 17:00Z → 18/11 16:59:59.999Z).
    expect(prisma.review.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        photoRewardPoints: { gt: 0 },
        createdAt: { gte: new Date('2026-11-17T17:00:00.000Z'), lte: new Date('2026-11-18T16:59:59.999Z') },
      },
    });
  });

  it('đã đủ 3 đánh giá được thưởng của ngày viết → vẫn duyệt và hiện, không cộng (DAILY_CAP)', async () => {
    const prisma = approvable();
    prisma.review.count.mockResolvedValue(3);
    await expect(svc(prisma).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'DAILY_CAP' });
    expect(prisma.review.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isVisible: true, awaitingApproval: false, approvedAt: expect.any(Date) } });
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('dòng đơn đã nhận thưởng (xoá rồi viết lại) → không cộng lần hai', async () => {
    const prisma = approvable();
    prisma.pointsTransaction.findFirst.mockResolvedValue({ id: 'pt1' });
    await expect(svc(prisma).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'ALREADY_REWARDED' });
    expect(prisma.pointsTransaction.findFirst).toHaveBeenCalledWith({ where: { reason: 'REVIEW_PHOTO:li1', refType: 'REVIEW' }, select: { id: true } });
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('đánh giá đã nhận thưởng lúc gửi (bảng cũ) → không cộng thêm', async () => {
    const prisma = approvable(pendingRow({ pointsEarned: 10_000 }));
    await expect(svc(prisma).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'ALREADY_REWARDED' });
  });

  it('đã duyệt rồi → bấm lại không ghi gì', async () => {
    const prisma = approvable(pendingRow({ isVisible: true, awaitingApproval: false, approvedAt: new Date() }));
    await expect(svc(prisma).approve('r1', KEY)).resolves.toEqual({ ok: true, isVisible: true, alreadyApproved: true, rewardPoints: 0, rewardSkipped: null });
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it('đánh giá ảnh cũ không qua hàng chờ → được đưa lên dải (mốc duyệt) nhưng không thưởng', async () => {
    const prisma = approvable(pendingRow({ isVisible: true, awaitingApproval: false, photoQueuedAt: null }));
    await expect(svc(prisma).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'NOT_ENROLLED' });
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('đơn đã trả, hoặc dòng hàng có lần trả được duyệt → không thưởng (RETURNED)', async () => {
    const returnedOrder = approvable(pendingRow(), 'RETURNED');
    await expect(svc(returnedOrder).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'RETURNED' });
    const partial = approvable();
    partial.returnRequestItem.findMany.mockResolvedValue([{ orderItemId: 'li1' }]);
    partial.orderItem.findMany.mockResolvedValue([{ orderId: 'o1', variationId: 'v1' }]);
    partial.variation.findMany.mockResolvedValue([{ id: 'v1', productId: 'p1' }]);
    await expect(svc(partial).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'RETURNED' });
    expect(partial.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('cấu hình thưởng 0 điểm → duyệt không cộng (ZERO)', async () => {
    const prisma = approvable();
    const zero = configOf({ 'reviews.green_corner_enabled': true, 'reviews.photo_reward_points': 0 });
    await expect(svc(prisma, zero).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 0, rewardSkipped: 'ZERO' });
  });

  it('đánh giá chờ duyệt vẫn được thưởng khi cờ đã tắt (lời hứa lúc gửi giữ nguyên)', async () => {
    const prisma = approvable();
    await expect(svc(prisma, OFF).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 100, rewardSkipped: null });
  });

  it('khoá theo thứ tự: dòng đơn (FOR SHARE), khoá cặp, dòng đánh giá (FOR UPDATE), khoá trần', async () => {
    const prisma = approvable();
    await svc(prisma).approve('r1', KEY);
    const raw = prisma.$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));
    expect(raw[0]).toContain('FROM "orders"');
    expect(raw[0]).toContain('FOR SHARE');
    expect(raw[1]).toContain('FROM "reviews"');
    expect(raw[1]).toContain('FOR UPDATE');
    expect(prisma.$executeRaw.mock.calls.map((c) => c[1])).toEqual(['review-reward:u1:p1', 'review-photo-cap:u1']);
  });

  it('unique dòng sổ va chạm (lần duyệt khác vừa ghi) → 409, không nuốt lỗi', async () => {
    const prisma = approvable();
    prisma.pointsTransaction.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(svc(prisma).approve('r1', KEY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('khách đổi ảnh sau khi admin mở danh sách (dấu ảnh lệch) → 409, không hiện, không cộng', async () => {
    const prisma = approvable(pendingRow({ imageVersions: ['abcdef0123'] }));
    await expect(svc(prisma).approve('r1', KEY)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.review.update).not.toHaveBeenCalled();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('lỡ tay ẩn khỏi hàng chờ rồi duyệt lại → vẫn được thưởng (đã qua hàng chờ theo photoQueuedAt)', async () => {
    const prisma = approvable(pendingRow({ awaitingApproval: false, isVisible: false }));
    await expect(svc(prisma).approve('r1', KEY)).resolves.toMatchObject({ rewardPoints: 100, rewardSkipped: null });
  });

  it('"Hiện lại" đánh giá đang chờ đi qua approve: thưởng đúng một lần; không có dấu ảnh thì 409', async () => {
    const prisma = approvable();
    prisma.review.findUnique
      .mockResolvedValueOnce({ id: 'r1', productId: 'p1', awaitingApproval: true })
      .mockResolvedValueOnce({ userId: 'u1', productId: 'p1', orderId: 'o1' });
    await expect(svc(prisma).setVisibility('r1', true, KEY)).resolves.toEqual({ ok: true, isVisible: true });
    expect(prisma.pointsTransaction.create).toHaveBeenCalledTimes(1);
    const blind = makePrisma();
    blind.review.findUnique.mockResolvedValue({ id: 'r1', productId: 'p1', awaitingApproval: true });
    await expect(svc(blind).setVisibility('r1', true)).rejects.toBeInstanceOf(ConflictException);
    expect(blind.review.update).not.toHaveBeenCalled();
  });

  it('"Hiện lại" đánh giá đã ẩn kèm dấu ảnh: khớp thì hiện, khách đổi ảnh trong lúc bị ẩn thì 409', async () => {
    const ok = makePrisma();
    ok.review.findUnique.mockResolvedValue({ id: 'r1', productId: 'p1', awaitingApproval: false });
    ok.$queryRaw.mockResolvedValue([{ imageVersions: ['0123456789'], videoUrl: null }]);
    await expect(svc(ok).setVisibility('r1', true, KEY)).resolves.toEqual({ ok: true, isVisible: true });
    expect(ok.review.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isVisible: true } });
    const changed = makePrisma();
    changed.review.findUnique.mockResolvedValue({ id: 'r1', productId: 'p1', awaitingApproval: false });
    changed.$queryRaw.mockResolvedValue([{ imageVersions: ['abcdef0123'], videoUrl: null }]);
    await expect(svc(changed).setVisibility('r1', true, KEY)).rejects.toBeInstanceOf(ConflictException);
    expect(changed.review.update).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.remove với đánh giá đã qua hàng chờ', () => {
  const removable = (over: Record<string, unknown>) => {
    const prisma = makePrisma();
    Object.assign(prisma.review, { delete: jest.fn() });
    Object.assign(prisma.user, { updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    prisma.review.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', productId: 'p1', pointsEarned: 0, photoQueuedAt: null, ...over });
    prisma.pointsTransaction.findMany.mockResolvedValue([
      { id: 'c1', delta: 100, expiresAt: null, createdAt: new Date('2026-11-18T03:00:00Z'), reason: 'REVIEW_PHOTO:li1', refType: 'REVIEW', refId: 'r1' },
    ]);
    prisma.$queryRaw.mockImplementation(async (strings: string[]) => {
      const sql = strings.join('?');
      if (sql.includes('"pointsEarned"')) return [{ pointsEarned: 100 }];
      if (sql.includes('FROM "users"')) return [{ pointsBalance: 500 }];
      return [];
    });
    return prisma;
  };

  it('lần duyệt vừa cộng thưởng trong lúc chờ khoá: đọc lại điểm dưới khoá dòng và thu hồi đủ', async () => {
    const prisma = removable({ photoQueuedAt: new Date('2026-11-18T02:00:00Z') });
    await svc(prisma).remove('u1', 'USER', 'r1');
    const sql = prisma.$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));
    expect(sql[0]).toContain('FOR UPDATE');
    expect(sql[0]).toContain('"pointsEarned"');
    expect(prisma.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', delta: -100, reason: 'REVIEW_DELETE:p1', refType: 'REVIEW', refId: 'r1' },
    });
  });

  it('đánh giá chưa từng qua hàng chờ, không thưởng: như cũ, không khoá, không đọc sổ', async () => {
    const prisma = removable({});
    await svc(prisma).remove('u1', 'USER', 'r1');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });
});

describe('bảng thưởng cũ không bị trả lần hai vì dòng thu hồi thưởng ảnh', () => {
  it('thưởng cũ còn giữ 50 điểm, thêm dòng thu hồi -100 của thưởng Góc Sống Xanh cùng sản phẩm → vẫn coi là còn giữ, không thưởng lại', async () => {
    const prisma = makePrisma();
    prisma.pointsTransaction.findMany.mockImplementation(async ({ where }: { where: { reason: { in?: string[]; startsWith?: string } } }) => {
      if (where.reason.startsWith === 'REVIEW_PHOTO:') return [{ refId: 'r9' }];
      if (where.reason.in?.includes('REVIEW:khan-tre')) {
        return [
          { delta: 10_000, refId: 'r0' },
          { delta: -9_950, refId: 'r0' },
          { delta: -100, refId: 'r9' },
        ];
      }
      return [];
    });
    await svc(prisma, OFF).create('u1', 'khan-tre', { rating: 5, images: [IMG], orderId: 'o1' } as never);
    expect(prisma.review.create.mock.calls[0]![0].data).toMatchObject({ pointsEarned: 0 });
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.greenCorner (dải Trang chủ)', () => {
  const row = (id: string, productId: string, over: Record<string, unknown> = {}) => ({
    id,
    rating: 5,
    comment: 'Khăn mềm, bé dùng không bị đỏ da',
    imageVersions: ['0123456789'],
    ecoTags: ['soft', 'nope'],
    user: { fullName: 'Nguyễn Thị Lan' },
    product: { id: productId, slug: `sp-${productId}`, name: `Sản phẩm ${productId}` },
    ...over,
  });

  it('cờ tắt → enabled false, không truy vấn', async () => {
    const prisma = makePrisma();
    await expect(svc(prisma, OFF).greenCorner()).resolves.toEqual({ enabled: false, items: [] });
    expect(prisma.review.findMany).not.toHaveBeenCalled();
  });

  it('chỉ đánh giá đã duyệt, đang hiện, có ảnh, sản phẩm công khai; mỗi sản phẩm một đánh giá; ảnh qua đường dẫn API; tên che', async () => {
    const prisma = makePrisma();
    prisma.review.findMany.mockResolvedValue([row('r1', 'p1'), row('r2', 'p1'), row('r3', 'p2', { comment: null })]);
    const out = await svc(prisma).greenCorner();
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isVisible: true, approvedAt: { not: null }, imageVersions: { isEmpty: false }, product: { isActive: true, approvalStatus: 'APPROVED' } },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(out.enabled).toBe(true);
    expect(out.items.map((i) => i.id)).toEqual(['r1', 'r3']);
    expect(out.items[0]).toMatchObject({ image: '/reviews/r1/images/0?v=0123456789', ecoTags: ['soft'], product: { slug: 'sp-p1', name: 'Sản phẩm p1' } });
    expect(out.items[0]!.author).toBe('Lan N.');
    expect(out.items[1]!.comment).toBeNull();
  });

  it('tối đa 8 đánh giá', async () => {
    const prisma = makePrisma();
    prisma.review.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => row(`r${i}`, `p${i}`)));
    expect((await svc(prisma).greenCorner()).items).toHaveLength(8);
  });
});

describe('ReviewsService.canReview khi Góc Sống Xanh bật', () => {
  it('dòng đơn đầu đã nhận thưởng ảnh → rewardAvailable false, ALREADY_KEPT; không đọc sổ "đánh giá đầu tiên" cũ', async () => {
    const prisma = makePrisma();
    prisma.pointsTransaction.findFirst.mockResolvedValue({ id: 'pt1' });
    await expect(svc(prisma).canReview('u1', 'khan-tre')).resolves.toMatchObject({
      canReview: true,
      rewardAvailable: false,
      rewardUnavailableReason: 'ALREADY_KEPT',
    });
    expect(prisma.pointsTransaction.findMany).not.toHaveBeenCalled();
  });

  it('dòng đơn chưa nhận → rewardAvailable true', async () => {
    const prisma = makePrisma();
    await expect(svc(prisma).canReview('u1', 'khan-tre')).resolves.toMatchObject({ rewardAvailable: true, rewardUnavailableReason: null });
  });
});

describe('ReviewsService.listByProduct', () => {
  it('trả số đánh giá có ảnh (chip "Có ảnh") và thẻ cảm nhận đã lọc khoá lạ', async () => {
    const prisma = makePrisma();
    prisma.review.findMany.mockResolvedValue([
      { id: 'r1', rating: 5, comment: null, imageVersions: [], videoUrl: null, createdAt: new Date(), ecoTags: ['saving', 'x'], user: { fullName: 'An' } },
    ]);
    prisma.review.groupBy.mockResolvedValue([{ rating: 5, _count: { _all: 1 } }]);
    prisma.review.count.mockResolvedValueOnce(0).mockResolvedValueOnce(7);
    const out = await svc(prisma).listByProduct('khan-tre');
    expect(out.photoCount).toBe(7);
    expect(out.videoCount).toBe(0);
    expect(out.items[0]!.ecoTags).toEqual(['saving']);
  });
});
