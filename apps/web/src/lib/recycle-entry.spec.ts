import { describe, expect, it } from 'vitest';
import { notificationAction } from '@/components/account/notification-view';
import { buildAccountMenu } from '@/components/account/account-menu';
import { isWebRouteReady } from './route-map';

// Kiểm với route map THẬT (không giả resolver): mọi lối vào đổi rác phải tới được khi lane recycle đã bỏ pending.
describe('lối vào đổi rác trên route map thật', () => {
  it.each([
    '/doi-rac',
    '/doi-rac/quy-dinh',
    '/doi-rac/tao',
    '/doi-rac/diem-nhan',
    '/doi-rac/yeu-cau',
    '/doi-rac/yeu-cau/abc',
    '/doi-rac/yeu-cau/abc/sua',
    '/doi-rac/xong/abc',
    '/doi-rac/quay',
  ])('%s đã mở', (p) => {
    expect(isWebRouteReady(p)).toBe(true);
  });

  it('thông báo WASTE dẫn tới đúng trang /doi-rac, id mã hoá như Mini App', () => {
    const to = (code: string, data: Record<string, string>) => notificationAction(code, data)?.to;
    expect(to('WASTE_POINTS_CREDITED', { request_id: 'req-1' })).toBe('/doi-rac/xong/req-1');
    expect(to('WASTE_PERK_REVIEWED', {})).toBe('/doi-rac/quay');
    expect(to('WASTE_PICKUP_STARTED', { request_id: 'r/2' })).toBe('/doi-rac/yeu-cau/r%2F2');
    expect(to('WASTE_SHIP_LOCKED', {})).toBe('/doi-rac');
    expect(to('REFILL_RETURN_CREDITED', {})).toBe('/doi-rac');
  });

  it('menu hub tài khoản có mục Đổi rác lấy quà', () => {
    const groups = buildAccountMenu({
      role: 'CUSTOMER',
      aiEnabled: false,
      claimEnabled: false,
      cashbackEnabled: false,
      dealer: undefined,
      ownedBrandName: undefined,
      isReady: isWebRouteReady,
    });
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/doi-rac')?.label).toBe('Đổi rác lấy quà');
  });
});
