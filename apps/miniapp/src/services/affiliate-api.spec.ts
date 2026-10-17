import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { createCtvOrder, reportLaunchLinkClick, __resetLinkClickForTest } from './affiliate-api';
import { __resetEntrySourceForTest } from '../utils/entry-source';

const post = vi.mocked(api.post);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { id: 'o1', code: 'TUBU1' } });
});

describe('createCtvOrder — CTV lên đơn hộ khách', () => {
  it('gửi Idempotency-Key ở header (R5-CHECKOUT-1: gửi lại sau quá thời gian không tạo đơn thứ hai)', async () => {
    const dto = {
      items: [{ variationId: 'v1', quantity: 1 }],
      customer: {
        recipient: 'Nguyễn An', phone: '0901234567', province: 'Hà Nội', ward: 'Phường Ba Đình', street: '12 Lê Lợi',
        provinceCode: '84_VN01', wardCode: '84_VN0101',
      },
      paymentMethod: 'COD' as const,
    };
    await expect(createCtvOrder(dto, 'key-1')).resolves.toEqual({ id: 'o1', code: 'TUBU1' });
    expect(post).toHaveBeenCalledWith('/affiliate/orders', dto, { headers: { 'Idempotency-Key': 'key-1' } });
  });
});

describe('reportLaunchLinkClick — đếm lượt mở link CTV (D3-06)', () => {
  const launchWith = (search: string) => vi.stubGlobal('window', { location: { search, hash: '' } });

  beforeEach(() => {
    __resetEntrySourceForTest();
    __resetLinkClickForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetEntrySourceForTest();
  });

  it('mở app bằng link có l= → báo đúng một lần mã link', async () => {
    launchWith('?ref=ABCD1234&l=aB3_x-9');
    post.mockResolvedValue({ data: { counted: true } });
    reportLaunchLinkClick();
    reportLaunchLinkClick();
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/affiliate/click', { shortCode: 'aB3_x-9' });
  });

  it('link không có l= (mã giới thiệu thường) → không báo gì', () => {
    launchWith('?ref=ABCD1234');
    reportLaunchLinkClick();
    expect(post).not.toHaveBeenCalled();
  });

  it('mở app trần → không báo gì', () => {
    launchWith('');
    reportLaunchLinkClick();
    expect(post).not.toHaveBeenCalled();
  });

  it('API lỗi → nuốt lỗi, không văng ra màn hình', async () => {
    launchWith('?ref=ABCD1234&l=aB3_x-9');
    post.mockRejectedValue(new Error('500'));
    expect(() => reportLaunchLinkClick()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
