import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { NotificationFeedService } from '../notifications/notification-feed.service';
import { OrderCountsService } from '../orders/order-counts.service';
import { OrdersService } from '../orders/orders.service';
import { MeSummaryController } from './me-summary.controller';
import { MeSummaryService } from './me-summary.service';

type OrderRow = { userId: string; status: string };
type NoteRow = { userId: string; channel: string; status: string };
type SubRow = { userId: string; status: string };

const ORDERS: OrderRow[] = [
  ...['PENDING_PAYMENT', 'PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'CANCELLED', 'RETURNED'].map((status) => ({ userId: 'u1', status })),
  ...['PENDING_PAYMENT', 'SHIPPING', 'SHIPPING', 'DELIVERED'].map((status) => ({ userId: 'u2', status })),
];
const NOTES: NoteRow[] = [
  { userId: 'u1', channel: 'INAPP', status: 'SENT' },
  { userId: 'u1', channel: 'INAPP', status: 'SENT' },
  { userId: 'u1', channel: 'INAPP', status: 'READ' },
  { userId: 'u1', channel: 'ZNS', status: 'SENT' },
  { userId: 'u2', channel: 'INAPP', status: 'SENT' },
  { userId: 'u2', channel: 'INAPP', status: 'SENT' },
  { userId: 'u2', channel: 'INAPP', status: 'SENT' },
];
const SUBS: SubRow[] = [
  { userId: 'u1', status: 'ACTIVE' },
  { userId: 'u1', status: 'PAUSED' },
  { userId: 'u1', status: 'CANCELLED' },
  { userId: 'u2', status: 'ACTIVE' },
];

type Where = { userId?: string; status?: string | { in?: string[]; not?: string }; channel?: string };
const matches = (r: { userId: string; status: string; channel?: string }, w: Where) => {
  if (w.userId !== undefined && r.userId !== w.userId) return false;
  if (w.channel !== undefined && r.channel !== w.channel) return false;
  const s = w.status;
  if (s === undefined) return true;
  if (typeof s === 'string') return r.status === s;
  if (s.in) return s.in.includes(r.status);
  if (s.not !== undefined) return r.status !== s.not;
  return true;
};

function fakePrisma(opts: { failOn?: 'order' | 'note' | 'sub' } = {}) {
  const fail = (k: string) => (opts.failOn === k ? Promise.reject(new Error(`${k} down`)) : null);
  const groupBy = jest.fn(async ({ where }: { where: Where }) => {
    const failed = fail('order');
    if (failed) return failed;
    const by = new Map<string, number>();
    for (const r of ORDERS.filter((x) => matches(x, where))) by.set(r.status, (by.get(r.status) ?? 0) + 1);
    return [...by].map(([status, n]) => ({ status, _count: { _all: n } }));
  });
  const noteCount = jest.fn(async ({ where }: { where: Where }) => fail('note') ?? NOTES.filter((r) => matches(r, where)).length);
  const subCount = jest.fn(async ({ where }: { where: Where }) => fail('sub') ?? SUBS.filter((r) => matches(r, where)).length);
  const orderCount = jest.fn(async ({ where }: { where: Where }) => ORDERS.filter((r) => matches(r, where)).length);
  const prisma = {
    order: { groupBy, count: orderCount },
    notificationLog: { count: noteCount },
    subscription: { count: subCount },
  } as unknown as PrismaService;
  return { prisma, groupBy, noteCount, subCount };
}

describe('GET /me/summary (controller)', () => {
  const handler = MeSummaryController.prototype.get;

  it('là GET me/summary, cần đăng nhập (không @Public), không giới hạn role, không cache chung', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MeSummaryController)).toBe('me/summary');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MeSummaryController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
  });

  it('guard JWT toàn app áp lên route này: không mở công khai, khách chưa đăng nhập bị 401', () => {
    const reflector = new Reflector();
    expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, MeSummaryController])).toBeUndefined();
    expect(() => new JwtAuthGuard(reflector).handleRequest(null, false)).toThrow(UnauthorizedException);
  });

  it('đọc theo userId của token, không có tham số nào để hỏi khách khác', async () => {
    const get = jest.fn().mockResolvedValue({ ok: true });
    const out = await new MeSummaryController({ get } as unknown as MeSummaryService).get('u1');
    expect(get).toHaveBeenCalledWith('u1');
    expect(out).toEqual({ ok: true });
    expect(handler.length).toBe(1);
  });
});

describe('MeSummaryService.get', () => {
  it('đúng số theo trạng thái và chỉ của chính khách (u2 không lọt vào u1)', async () => {
    const { prisma, groupBy, noteCount, subCount } = fakePrisma();
    const out = await new MeSummaryService(prisma).get('u1');
    expect(out).toEqual({
      orders: { pending_payment: 2, processing: 2, shipping: 1, delivered: 3, closed: 2, active: 5 },
      unreadNotifications: 2,
      activeSubscriptions: 2,
    });
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(noteCount).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: 'u1', channel: 'INAPP' }) });
    expect(subCount).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: 'u1' }) });
  });

  it('khách khác nhận số của họ', async () => {
    const out = await new MeSummaryService(fakePrisma().prisma).get('u2');
    expect(out).toEqual({
      orders: { pending_payment: 1, processing: 0, shipping: 2, delivered: 1, closed: 0, active: 3 },
      unreadNotifications: 3,
      activeSubscriptions: 1,
    });
  });

  it('khách chưa có gì: mọi số là 0, đủ khoá', async () => {
    expect(await new MeSummaryService(fakePrisma().prisma).get('nobody')).toEqual({
      orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 },
      unreadNotifications: 0,
      activeSubscriptions: 0,
    });
  });

  it.each(['order', 'note', 'sub'] as const)('một phần (%s) lỗi thì cả lời gọi lỗi, không trả số giả 0', async (failOn) => {
    await expect(new MeSummaryService(fakePrisma({ failOn }).prisma).get('u1')).rejects.toThrow(`${failOn} down`);
  });

  it('khớp các endpoint cũ mà bản Mini đang Live còn gọi: status-counts, active-count, unread-count', async () => {
    const { prisma } = fakePrisma();
    const summary = await new MeSummaryService(prisma).get('u1');
    const counts = await new OrderCountsService(prisma).statusCounts('u1');
    const { count: active } = await OrdersService.prototype.activeCount.call({ prisma }, 'u1');
    const { count: unread } = await new NotificationFeedService(prisma).unreadCount('u1');
    const { active: summaryActive, ...tabs } = summary.orders;
    expect(tabs).toEqual(counts);
    expect(summaryActive).toBe(active);
    expect(summary.unreadNotifications).toBe(unread);
  });
});
