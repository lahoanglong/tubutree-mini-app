import { NotificationsService } from './notifications.service';
import { notificationCategory } from './notification-categories';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

function setup(user: Record<string, unknown> | null) {
  const create = jest.fn().mockResolvedValue({ id: 'log-1' });
  const update = jest.fn().mockImplementation(async ({ data }: { data: Record<string, boolean> }) => ({
    notifyPromo: true,
    notifyGarden: true,
    ...data,
  }));
  const prisma = {
    notificationTemplate: {
      findUnique: jest.fn().mockResolvedValue({ code: 'X', channel: 'ZNS', bodyTemplate: 'x', zaloTemplateId: 'zt' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findUniqueOrThrow: jest.fn().mockResolvedValue(user),
      update,
    },
    notificationLog: { create, count: jest.fn().mockResolvedValue(0) },
  } as unknown as PrismaService;
  const sendTemplate = jest.fn().mockResolvedValue({ ok: true });
  const analytics = { recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService;
  const svc = new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, analytics);
  return { svc, create, sendTemplate, update };
}

const optedOut = { id: 'u1', phone: '0900000000', notifyPromo: false, notifyGarden: false };

describe('Phân loại tin (C-022)', () => {
  it.each([
    'CART_ABANDONED',
    'PRICE_DROP_ALERT',
    'VOUCHER_EXPIRING',
    'WELCOME_VOUCHER',
    'BIRTHDAY_VOUCHER',
    'WINBACK_VOUCHER',
    'SECOND_ORDER_VOUCHER',
    'REORDER_REMINDER',
    'TIER_DROP_NOTICE',
    'STOREFRONT_TRENDING_PRODUCTS',
  ])('%s là tin khuyến mãi', (code) => {
    expect(notificationCategory(code)).toBe('PROMO');
  });

  it.each(['GAME_CHECKIN_REMINDER', 'GAME_TREE_THIRSTY', 'GAME_WATER_GIFT'])('%s là nhắc Vườn Xanh', (code) => {
    expect(notificationCategory(code)).toBe('GARDEN');
  });

  // Tin kéo khách quay lại khi bài có thích/bình luận: không phải tin giao dịch nên khách phải tắt được (cùng công tắc với nhắc Vườn).
  it.each(['COMMUNITY_POST_LIKED', 'COMMUNITY_POST_COMMENTED', 'COMMUNITY_NEW_ANSWER'])('%s khách tắt được cùng công tắc Vườn Xanh', (code) => {
    expect(notificationCategory(code)).toBe('GARDEN');
  });

  it.each([
    'ORDER_CONFIRMED',
    'ORDER_CANCELLED',
    'RETURN_APPROVED',
    'POINTS_EXPIRING',
    'SUBSCRIPTION_ORDER_FAILED',
    'COMMUNITY_BEST_ANSWER',
    'ACCOUNT_DELETION_REQUESTED',
    // Khách tự bấm "Nhắc tôi" → đây là tin khách yêu cầu, không phải tiếp thị.
    'FLASH_STARTING',
    // Phần thưởng khách tự kiếm qua giới thiệu: mã vẫn phát, khách phải được biết mình có.
    'MILESTONE_VOUCHER',
    // Mời đánh giá đơn khách đã nhận (C-017).
    'REVIEW_REQUEST',
    // Thông báo kiểm duyệt về bài của chính khách: khách phải được biết bài đã bị ẩn.
    'COMMUNITY_POST_HIDDEN',
  ])('%s là tin giao dịch, luôn gửi', (code) => {
    expect(notificationCategory(code)).toBe('TRANSACTIONAL');
  });
});

describe('NotificationsService.notify tôn trọng tuỳ chọn của khách (C-022)', () => {
  it('đã tắt khuyến mãi → không ghi tin trong app, không gửi ZNS', async () => {
    const { svc, create, sendTemplate } = setup(optedOut);
    await svc.notify('u1', 'CART_ABANDONED', {});
    await svc.notify('u1', 'WINBACK_VOUCHER', {});
    expect(create).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('đã tắt công tắc Vườn → không báo thích/bình luận bài viết, nhưng báo bài bị ẩn vẫn gửi', async () => {
    const { svc, create } = setup(optedOut);
    await svc.notify('u1', 'COMMUNITY_POST_LIKED', { title: 'A' });
    await svc.notify('u1', 'COMMUNITY_POST_COMMENTED', { title: 'A', author: 'B' });
    expect(create).not.toHaveBeenCalled();
    await svc.notify('u1', 'COMMUNITY_POST_HIDDEN', { title: 'A', reason: 'x' });
    expect(create).toHaveBeenCalled();
  });

  it('đã tắt nhắc Vườn → bỏ qua nhắc tưới cây', async () => {
    const { svc, create } = setup(optedOut);
    await svc.notify('u1', 'GAME_TREE_THIRSTY', {});
    expect(create).not.toHaveBeenCalled();
  });

  it('đã tắt cả hai → tin đơn hàng vẫn gửi đủ (INAPP + ZNS)', async () => {
    const { svc, create, sendTemplate } = setup(optedOut);
    await svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'T1' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('chưa tắt → tin khuyến mãi vẫn gửi', async () => {
    const { svc, create, sendTemplate } = setup({ ...optedOut, notifyPromo: true });
    await svc.notify('u1', 'PRICE_DROP_ALERT', { product: 'A' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('đã tắt khuyến mãi nhưng tự bấm "Nhắc tôi" giờ vàng → vẫn nhận nhắc', async () => {
    const { svc, create } = setup(optedOut);
    await svc.notify('u1', 'FLASH_STARTING', { product: 'A' });
    expect(create).toHaveBeenCalled();
  });

  it('không tìm thấy user → không gửi tin khuyến mãi', async () => {
    const { svc, create } = setup(null);
    await svc.notify('u1', 'CART_ABANDONED', {});
    expect(create).not.toHaveBeenCalled();
  });
});

describe('Tuỳ chọn thông báo lưu trên server (C-022)', () => {
  it('getPrefs đọc từ cột của user', async () => {
    const { svc } = setup(optedOut);
    await expect(svc.getPrefs('u1')).resolves.toEqual({ notifyPromo: false, notifyGarden: false });
  });

  it('updatePrefs chỉ ghi trường được gửi lên', async () => {
    const { svc, update } = setup(optedOut);
    const res = await svc.updatePrefs('u1', { notifyPromo: false });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { notifyPromo: false },
      select: { notifyPromo: true, notifyGarden: true },
    });
    expect(res).toEqual({ notifyPromo: false, notifyGarden: true });
  });
});
