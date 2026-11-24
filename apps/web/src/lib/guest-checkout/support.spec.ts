import { describe, expect, it } from 'vitest';
import { TUBU_ZALO_PHONE } from '@tubutree/app-core/order-zalo';
import { guestSupportHandoff } from './support';

describe('guestSupportHandoff: một chạm sang Zalo của Tubu kèm mã đơn', () => {
  it('có OA: mở chat OA, câu chép chỉ mang mã đơn', () => {
    expect(guestSupportHandoff('TUBU2026112412345', { oaUrl: 'https://zalo.me/1234567890', zaloPhone: '0912345678' })).toEqual({
      href: 'https://zalo.me/1234567890',
      message: 'Hỗ trợ đơn TUBU2026112412345',
    });
  });

  it('OA chưa cấu hình: số Zalo Tubu ở cấu hình công khai; số sai khuôn hay thiếu thì số mặc định', () => {
    expect(guestSupportHandoff('TB777', { oaUrl: null, zaloPhone: '0987654321' }).href).toBe('https://zalo.me/0987654321');
    expect(guestSupportHandoff('TB777', { oaUrl: null, zaloPhone: 'javascript:alert(1)' }).href).toBe(`https://zalo.me/${TUBU_ZALO_PHONE}`);
    expect(guestSupportHandoff('TB777', { oaUrl: null }).href).toBe(`https://zalo.me/${TUBU_ZALO_PHONE}`);
  });

  it('đường dẫn không mang mã đơn, SĐT hay khoá theo dõi; câu chép chuẩn hoá chữ hoa', () => {
    const h = guestSupportHandoff(' tubu2026112412345 ', { oaUrl: null, zaloPhone: '0899149229' });
    expect(h.message).toBe('Hỗ trợ đơn TUBU2026112412345');
    expect(h.href).not.toMatch(/TUBU|#k=|\?/i);
  });

  it('mã sai khuôn (chuỗi lạ, khoá theo dõi dán nhầm) thì không chép gì, liên kết vẫn mở', () => {
    for (const code of ['', 'TB 1', `TB777#k=${'A'.repeat(43)}`, 'x'.repeat(41)]) {
      const h = guestSupportHandoff(code, { oaUrl: null });
      expect(h.message, code).toBeNull();
      expect(h.href).toBe(`https://zalo.me/${TUBU_ZALO_PHONE}`);
    }
  });
});
