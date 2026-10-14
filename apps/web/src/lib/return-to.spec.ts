// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loginHref,
  rememberPendingAdd,
  rememberReturnTo,
  safeReturnPath,
  takePendingAdd,
  takeReturnTo,
} from './return-to';

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('safeReturnPath — chỉ đường dẫn nội bộ', () => {
  it('nhận đường dẫn tuyệt đối trong site, kèm query/hash', () => {
    expect(safeReturnPath('/gio-hang')).toBe('/gio-hang');
    expect(safeReturnPath('/san-pham/dau-goi?ref=abc#mo-ta')).toBe('/san-pham/dau-goi?ref=abc#mo-ta');
  });

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['https://evil.com'],
    ['javascript:alert(1)'],
    ['gio-hang'],
    ['/\t/evil.com'],
    ['/a\nb'],
    [''],
    ['/dang-nhap'],
    ['/dang-nhap/callback?code=1'],
  ])('từ chối %j', (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it('từ chối null/undefined và đường dẫn quá dài', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('loginHref', () => {
  it('mã hoá returnTo; không hợp lệ thì về /dang-nhap trơn', () => {
    expect(loginHref('/gio-hang')).toBe('/dang-nhap?returnTo=%2Fgio-hang');
    expect(loginHref('//evil.com')).toBe('/dang-nhap');
    expect(loginHref()).toBe('/dang-nhap');
  });
});

describe('returnTo qua sessionStorage', () => {
  it('ghi một lần, đọc một lần', () => {
    rememberReturnTo('/thanh-toan');
    expect(takeReturnTo()).toBe('/thanh-toan');
    expect(takeReturnTo()).toBeNull();
  });

  it('ghi null xoá giá trị cũ (đăng nhập dở lần trước không kéo khách về trang lạ)', () => {
    rememberReturnTo('/gio-hang');
    rememberReturnTo(null);
    expect(takeReturnTo()).toBeNull();
  });

  it('giá trị bị sửa thành URL ngoài site thì bị bỏ', () => {
    sessionStorage.setItem('tubu_return_to', 'https://evil.com');
    expect(takeReturnTo()).toBeNull();
  });

  it('storage bị chặn thì không ném lỗi', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(takeReturnTo()).toBeNull();
    expect(takePendingAdd(['v1'])).toBeNull();
    spy.mockRestore();
  });
});

describe('món chờ thêm vào giỏ', () => {
  it('trả đúng món thuộc trang hiện tại rồi xoá', () => {
    rememberPendingAdd({ variationId: 'v2', quantity: 3 });
    expect(takePendingAdd(['v1', 'v2'])).toEqual({ variationId: 'v2', quantity: 3 });
    expect(takePendingAdd(['v1', 'v2'])).toBeNull();
  });

  it('món của trang khác được giữ lại cho trang đó', () => {
    rememberPendingAdd({ variationId: 'x9', quantity: 1 });
    expect(takePendingAdd(['v1'])).toBeNull();
    expect(takePendingAdd(['x9'])).toEqual({ variationId: 'x9', quantity: 1 });
  });

  it('quá 30 phút thì bỏ — không tự thêm hàng vào giỏ của lần ghé cũ', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    rememberPendingAdd({ variationId: 'v1', quantity: 2 });
    vi.setSystemTime(new Date('2026-10-01T00:31:00Z'));
    expect(takePendingAdd(['v1'])).toBeNull();
    expect(sessionStorage.getItem('tubu_pending_add')).toBeNull();
  });

  it('số lượng hỏng thì về 1', () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v1', quantity: -4, at: Date.now() }));
    expect(takePendingAdd(['v1'])).toEqual({ variationId: 'v1', quantity: 1 });
  });
});
