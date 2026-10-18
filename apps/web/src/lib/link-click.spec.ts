// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client-api', () => ({ apiFetch: mocks.apiFetch }));

import { reportLinkClick } from './link-click';

describe('reportLinkClick — đếm lượt mở link CTV (D3-06)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.apiFetch.mockReset().mockResolvedValue({ counted: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('mở web bằng link có l= → báo đúng một lần mã link, không cần đăng nhập', () => {
    reportLinkClick('?ref=ABCD1234&l=aB3_x-9');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/affiliate/click', { method: 'POST', body: { shortCode: 'aB3_x-9' }, auth: false });
  });

  it('cùng phiên trình duyệt mở lại/điều hướng với cùng link → không báo thêm', () => {
    reportLinkClick('?l=aB3_x-9');
    reportLinkClick('?l=aB3_x-9');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('link khác trong cùng phiên → báo riêng', () => {
    reportLinkClick('?l=aB3_x-9');
    reportLinkClick('?l=Zz9_y-1');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each([[''], ['?ref=ABCD1234'], ['?l='], ['?l=a b'], ['?l=ab'], ['?l=<x>'], [`?l=${'x'.repeat(33)}`]])(
    'không có mã link dùng được (%s) → không báo',
    (search) => {
      reportLinkClick(search);
      expect(mocks.apiFetch).not.toHaveBeenCalled();
    },
  );

  it('API lỗi → nuốt lỗi', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('500'));
    expect(() => reportLinkClick('?l=aB3_x-9')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('storage bị chặn (chế độ riêng tư) → vẫn báo, không ném', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => reportLinkClick('?l=aB3_x-9')).not.toThrow();
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });
});
