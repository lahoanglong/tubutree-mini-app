import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { createValidationPipe } from '../../common/validation-pipe';
import { NotificationsController } from './notifications.controller';
import { NotificationListQuery } from './dto/notification-list-query.dto';
import type { NotificationsService } from './notifications.service';
import type { NotificationFeedService } from './notification-feed.service';

function setup() {
  const list = jest.fn().mockResolvedValue([{ id: 'n1' }]);
  const unreadCount = jest.fn().mockResolvedValue({ count: 7 });
  const ctrl = new NotificationsController({} as NotificationsService, { list, unreadCount } as unknown as NotificationFeedService);
  return { ctrl, list, unreadCount };
}

describe('NotificationsController: danh sách và đếm chưa đọc', () => {
  it('GET me/notifications không tham số: gọi feed với query rỗng, vẫn trả mảng', async () => {
    const { ctrl, list } = setup();
    await expect(ctrl.list('u1', {})).resolves.toEqual([{ id: 'n1' }]);
    expect(list).toHaveBeenCalledWith('u1', {});
  });

  it('GET me/notifications/unread-count trả { count } của chính người gọi', async () => {
    const { ctrl, unreadCount } = setup();
    await expect(ctrl.unreadCount('u1')).resolves.toEqual({ count: 7 });
    expect(unreadCount).toHaveBeenCalledWith('u1');
  });

  it('unread-count là GET và khai báo trước mọi GET có tham số đường dẫn', () => {
    const proto = NotificationsController.prototype as unknown as Record<string, () => void>;
    const meta = (name: string, key: string) => Reflect.getMetadata(key, proto[name]!);
    expect(meta('unreadCount', PATH_METADATA)).toBe('unread-count');
    expect(meta('unreadCount', METHOD_METADATA)).toBe(RequestMethod.GET);
    const names = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    const getParametric = names.filter((n) => meta(n, METHOD_METADATA) === RequestMethod.GET && String(meta(n, PATH_METADATA)).includes(':'));
    for (const n of getParametric) expect(names.indexOf('unreadCount')).toBeLessThan(names.indexOf(n));
  });
});

describe('NotificationListQuery (kiểm tra tham số phân trang)', () => {
  const pipe = createValidationPipe();
  const run = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: NotificationListQuery, data: undefined });
  const messages = async (query: Record<string, unknown>): Promise<string[]> => {
    try {
      await run(query);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return ((e as BadRequestException).getResponse() as { message: string[] }).message;
    }
    return [];
  };

  it('không tham số, hoặc đủ before/beforeId/limit hợp lệ → qua; limit chuỗi được đổi thành số', async () => {
    await expect(run({})).resolves.toMatchObject({});
    await expect(run({ before: '2026-10-28T03:00:00.000Z', beforeId: 'n9', limit: '20' })).resolves.toMatchObject({ limit: 20, beforeId: 'n9' });
  });

  it.each([
    [{ limit: '51' }],
    [{ limit: '0' }],
    [{ limit: 'abc' }],
    [{ before: 'hôm qua' }],
    [{ beforeId: 'n9' }],
    [{ cursor: 'x' }],
  ])('tham số sai %j → 400 với câu tiếng Việt', async (query) => {
    const msgs = await messages(query);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]).not.toMatch(/must be|should not exist/);
  });
});
