import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverNow, syncServerClock } from '../server-clock';
import { fakeHttp } from './fake-http';
import { cancelFlashReminder, fetchActiveFlashSales, fetchFlashSlotItems, fetchFlashSlots, fetchUpcomingFlashSales, setFlashReminder } from './flash-sale';

describe('flash-sale — hợp đồng gọi API', () => {
  it('danh sách và nhắc giờ vàng', async () => {
    const { http, calls } = fakeHttp();
    await fetchActiveFlashSales(http);
    await fetchUpcomingFlashSales(http);
    await setFlashReminder(http, 'it1');
    await cancelFlashReminder(http, 'it1');
    expect(calls).toEqual([
      { method: 'get', path: '/flash-sales/active', opts: { anonymous: true } },
      { method: 'get', path: '/flash-sales/upcoming' },
      { method: 'post', path: '/flash-sales/items/it1/remind' },
      { method: 'delete', path: '/flash-sales/items/it1/remind' },
    ]);
  });

  it('khung giờ và món của khung: công khai, không cần phiên', async () => {
    const { http, calls } = fakeHttp();
    await fetchFlashSlots(http);
    await fetchFlashSlotItems(http, 's1');
    expect(calls).toEqual([
      { method: 'get', path: '/flash-sales/slots', opts: { anonymous: true } },
      { method: 'get', path: '/flash-sales/slots/s1/items', opts: { anonymous: true } },
    ]);
  });

  describe('giờ máy chủ', () => {
    afterEach(() => {
      vi.useRealTimers();
      syncServerClock(new Date().toISOString());
    });

    it('danh sách đang chạy trả serverNow: đồng bộ đồng hồ máy chủ', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
      const serverIso = '2026-10-18T09:50:00.000Z';
      const { http } = fakeHttp(() => [{ itemId: 'i1', serverNow: serverIso }]);
      await fetchActiveFlashSales(http);
      expect(serverNow()).toBe(Date.parse(serverIso));
    });

    it('API cũ không trả serverNow hoặc danh sách rỗng: giữ độ lệch đang có', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
      syncServerClock('2026-10-18T09:55:00.000Z');
      await fetchActiveFlashSales(fakeHttp(() => [{ itemId: 'i1' }]).http);
      await fetchActiveFlashSales(fakeHttp(() => []).http);
      await fetchActiveFlashSales(fakeHttp().http);
      expect(serverNow()).toBe(Date.parse('2026-10-18T09:55:00.000Z'));
    });
  });

  describe('giờ máy chủ của khung giờ', () => {
    afterEach(() => {
      vi.useRealTimers();
      syncServerClock(new Date().toISOString());
    });

    it('slots và món của khung đều đồng bộ đồng hồ máy chủ, kể cả khi danh sách rỗng', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
      await fetchFlashSlots(fakeHttp(() => ({ serverNow: '2026-11-01T09:50:00.000Z', slots: [] })).http);
      expect(serverNow()).toBe(Date.parse('2026-11-01T09:50:00.000Z'));
      await fetchFlashSlotItems(fakeHttp(() => ({ serverNow: '2026-11-01T09:40:00.000Z', slot: {}, items: [] })).http, 's1');
      expect(serverNow()).toBe(Date.parse('2026-11-01T09:40:00.000Z'));
    });
  });
});
