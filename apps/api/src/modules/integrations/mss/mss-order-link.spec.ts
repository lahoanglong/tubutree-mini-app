import { verifyGuestLookupKey } from '../../checkout/guest/guest-track-link';
import { MSS_DETAIL_URL_MAX, orderDetailUrl, type OrderDetailUrlInput } from './mss-order-link';
import { MSS_ORDER_LINK_ORIGIN } from './mss-order-event.recorder';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 2, 0, 0);
const SECRET = 'x'.repeat(43);
const HASH = 'a'.repeat(64);
const GUEST = { zaloId: 'guest_w_abcdefghijklmnop', phone: null, mergedIntoId: null };
const ACCOUNT = { zaloId: 'zalo_1234567890', phone: '0901234567', mergedIntoId: null };

const make = (over: Partial<OrderDetailUrlInput> = {}): OrderDetailUrlInput => ({
  origin: MSS_ORDER_LINK_ORIGIN,
  code: 'TB7K4M',
  guestTokenHash: null,
  owner: ACCOUNT,
  secret: SECRET,
  now: NOW,
  guestLinks: true,
  ...over,
});
const keyOf = (url: string) => url.split('#k=')[1]!;

describe('orderDetailUrl: link xem đơn trong tin Zalo của người mua (w37-01)', () => {
  it('đơn tài khoản: đúng chuỗi tracking_url đang gửi trước w37 (46 ký tự với mã ngắn), không khoá', () => {
    const url = orderDetailUrl(make());
    expect(url).toBe('https://tubutree.com/tai-khoan/don-hang/TB7K4M');
    expect(url).toHaveLength(46);
    // Đơn vãng lai đã về tài khoản thật (chủ đơn là tài khoản): cũng link tài khoản, không ký khoá.
    expect(orderDetailUrl(make({ guestTokenHash: HASH }))).toBe('https://tubutree.com/tai-khoan/don-hang/TB7K4M');
  });

  it('khách vãng lai còn sống: /don/<mã>#k=<43 ký tự>, khoá mở được đơn tới +59 ngày, hết ở +61 ngày, chỉ đúng mã và đúng băm', () => {
    const url = orderDetailUrl(make({ guestTokenHash: HASH, owner: GUEST }))!;
    expect(url).toMatch(/^https:\/\/tubutree\.com\/don\/TB7K4M#k=[A-Za-z0-9_-]{43}$/);
    expect(url).toHaveLength(77);
    const key = keyOf(url);
    expect(verifyGuestLookupKey(key, 'TB7K4M', HASH, SECRET, NOW + 59 * DAY)).toBe(true);
    expect(verifyGuestLookupKey(key, 'TB7K4M', HASH, SECRET, NOW + 61 * DAY)).toBe(false);
    expect(verifyGuestLookupKey(key, 'TB7K4N', HASH, SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey(key, 'TB7K4M', 'b'.repeat(64), SECRET, NOW)).toBe(false);
    expect(verifyGuestLookupKey(key, 'TB7K4M', HASH, 'y'.repeat(43), NOW)).toBe(false);
  });

  it('chủ đơn có SĐT, zaloId Zalo thật, hay dòng khách đã nâng: link tài khoản, không bao giờ ký khoá', () => {
    for (const owner of [
      { ...GUEST, phone: '0901234567' },
      { ...GUEST, zaloId: 'zalo_real_123' },
    ]) {
      expect(orderDetailUrl(make({ guestTokenHash: HASH, owner }))).toBe('https://tubutree.com/tai-khoan/don-hang/TB7K4M');
    }
  });

  it('dòng khách đã gộp, khách Mini theo deviceId (không có khoá đơn web), chủ đơn đã xoá: không link (như trước w37)', () => {
    const merged = { zaloId: 'guest_w_abcdefghijklmnop_merged_1700000000000', phone: null, mergedIntoId: 'target-1' };
    expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: merged }))).toBeNull();
    expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: { ...GUEST, mergedIntoId: 'target-1' } }))).toBeNull();
    expect(orderDetailUrl(make({ guestTokenHash: null, owner: GUEST }))).toBeNull();
    expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: { zaloId: null, phone: null, mergedIntoId: null } }))).toBeNull();
  });

  it('guestLinks tắt (cổng bill đóng): khách vãng lai không link nào; đơn tài khoản vẫn link tài khoản', () => {
    expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: GUEST, guestLinks: false }))).toBeNull();
    expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: GUEST, guestLinks: false, secret: undefined }))).toBeNull();
    expect(orderDetailUrl(make({ guestLinks: false }))).toBe('https://tubutree.com/tai-khoan/don-hang/TB7K4M');
    expect(orderDetailUrl(make({ guestTokenHash: HASH, guestLinks: false }))).toBe('https://tubutree.com/tai-khoan/don-hang/TB7K4M');
  });

  it('thiếu bí mật: khách vãng lai nhận trang tra cứu điền sẵn mã (/don?ma=), không ký bằng bí mật dev', () => {
    for (const secret of [undefined, '']) {
      expect(orderDetailUrl(make({ guestTokenHash: HASH, owner: GUEST, secret }))).toBe('https://tubutree.com/don?ma=TB7K4M');
    }
  });

  it('độ dài ≤ 120 với mã 7 và 20 ký tự; mã quá dài cho trần thì null (bỏ khoá link, không bỏ tin)', () => {
    for (const code of ['TB7K4MX', 'TB-2611251234-ABCDEF']) {
      for (const over of [{}, { guestTokenHash: HASH, owner: GUEST }]) {
        const url = orderDetailUrl(make({ code, ...over }))!;
        expect(url.length).toBeLessThanOrEqual(MSS_DETAIL_URL_MAX);
        expect(url).toContain(`/${code}`);
      }
    }
    // Link tài khoản = 40 ký tự gốc + mã; link khách = 71 + mã. Đúng 120 còn nhận, 121 thì bỏ.
    expect(orderDetailUrl(make({ code: 'X'.repeat(80) }))).toHaveLength(120);
    expect(orderDetailUrl(make({ code: 'X'.repeat(81) }))).toBeNull();
    expect(orderDetailUrl(make({ code: 'X'.repeat(49), guestTokenHash: HASH, owner: GUEST }))).toHaveLength(120);
    expect(orderDetailUrl(make({ code: 'X'.repeat(50), guestTokenHash: HASH, owner: GUEST }))).toBeNull();
  });

  it('không mang PII: link không chứa SĐT người mua, băm khoá hay bí mật', () => {
    for (const over of [{}, { guestTokenHash: HASH, owner: GUEST }, { guestTokenHash: HASH, owner: GUEST, secret: undefined }]) {
      const url = orderDetailUrl(make(over))!;
      expect(url).not.toContain('0901234567');
      expect(url).not.toContain(HASH);
      expect(url).not.toContain(SECRET);
    }
  });
});
