import { describe, expect, it } from 'vitest';
import { isNewProduct, launchDateStart, NEW_PRODUCT_DAYS } from './product-badges';

const DAY = 864e5;
const NOW = Date.parse('2026-10-29T03:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('isNewProduct', () => {
  it('tạo cách đây 29 ngày thì còn là hàng mới', () => {
    expect(isNewProduct(ago(29), NOW)).toBe(true);
  });

  it('tạo cách đây 31 ngày thì hết là hàng mới', () => {
    expect(isNewProduct(ago(31), NOW)).toBe(false);
  });

  it('đúng mốc 30 ngày vẫn tính mới, quá một giây thì không', () => {
    expect(NEW_PRODUCT_DAYS).toBe(30);
    expect(isNewProduct(ago(30), NOW)).toBe(true);
    expect(isNewProduct(new Date(NOW - 30 * DAY - 1000).toISOString(), NOW)).toBe(false);
  });

  it('thiếu hoặc sai định dạng ngày tạo thì không dán nhãn', () => {
    expect(isNewProduct(undefined, NOW)).toBe(false);
    expect(isNewProduct(null, NOW)).toBe(false);
    expect(isNewProduct('', NOW)).toBe(false);
    expect(isNewProduct('không phải ngày', NOW)).toBe(false);
  });

  it('đồng hồ máy khách chậm vài phút so với máy chủ: SP vừa tạo vẫn mới', () => {
    expect(isNewProduct(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe(true);
  });

  it('nhận cả Date và số mili giây cho `now`', () => {
    expect(isNewProduct(ago(1), new Date(NOW))).toBe(true);
    expect(isNewProduct(ago(40), new Date(NOW))).toBe(false);
  });
});

describe('isNewProduct với mốc ngày mở bán (giờ Việt Nam)', () => {
  const LAUNCH = '2026-10-29';

  it('tạo trước 00:00 giờ VN của ngày mở bán thì không gắn Mới dù còn trong 30 ngày', () => {
    expect(isNewProduct('2026-10-28T16:59:59.000Z', NOW, LAUNCH)).toBe(false);
    expect(isNewProduct('2026-10-25T00:00:00.000Z', NOW, LAUNCH)).toBe(false);
  });

  it('tạo đúng 00:00 giờ VN của ngày mở bán hoặc sau đó thì theo luật 30 ngày', () => {
    expect(isNewProduct('2026-10-28T17:00:00.000Z', NOW, LAUNCH)).toBe(true);
    expect(isNewProduct('2026-10-29T02:00:00.000Z', NOW, LAUNCH)).toBe(true);
    expect(isNewProduct(ago(31), NOW, '2026-01-01')).toBe(false);
  });

  it('mốc rỗng, null hoặc thiếu: hành vi như cũ', () => {
    for (const none of ['', null, undefined]) {
      expect(isNewProduct(ago(5), NOW, none)).toBe(true);
      expect(isNewProduct(ago(31), NOW, none)).toBe(false);
    }
  });

  it('mốc sai dạng bị bỏ qua, không làm mất nhãn', () => {
    for (const bad of ['2026/10/29', '29-10-2026', '2026-10-29T00:00:00Z', 'mai', '2026-13-45', ' 2026-10-29']) {
      expect(isNewProduct(ago(5), NOW, bad)).toBe(true);
    }
  });

  it('launchDateStart trả 00:00 giờ VN hoặc null', () => {
    expect(launchDateStart('2026-10-29')).toBe(Date.parse('2026-10-28T17:00:00.000Z'));
    expect(launchDateStart('')).toBeNull();
    expect(launchDateStart('2026-02-30')).toBeNull();
  });
});
