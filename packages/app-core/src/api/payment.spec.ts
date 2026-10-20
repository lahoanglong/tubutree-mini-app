import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverNow, syncServerClock } from '../server-clock';
import { fakeHttp } from './fake-http';
import { getBankQr } from './payment';

describe('payment — hợp đồng gọi API', () => {
  it('GET /payments/bank-qr/:code', async () => {
    const { http, calls } = fakeHttp();
    await getBankQr(http, 'TUBU1');
    expect(calls).toEqual([{ method: 'get', path: '/payments/bank-qr/TUBU1' }]);
  });

  describe('giờ máy chủ', () => {
    afterEach(() => {
      vi.useRealTimers();
      syncServerClock(new Date().toISOString());
    });

    it('bank-qr trả serverNow: đồng bộ đồng hồ máy chủ để hạn chuyển khoản đếm đúng', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
      const { http } = fakeHttp(() => ({ orderCode: 'TUBU1', serverNow: '2026-10-18T09:50:00.000Z' }));
      const qr = await getBankQr(http, 'TUBU1');
      expect(qr.orderCode).toBe('TUBU1');
      expect(serverNow()).toBe(Date.parse('2026-10-18T09:50:00.000Z'));
    });

    it('thiếu serverNow: giữ độ lệch đang có', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
      syncServerClock('2026-10-18T09:55:00.000Z');
      await getBankQr(fakeHttp(() => ({ orderCode: 'TUBU1' })).http, 'TUBU1');
      expect(serverNow()).toBe(Date.parse('2026-10-18T09:55:00.000Z'));
    });
  });
});
