// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';

// "Thử lại" của Nội dung bán hàng (ContentKitSheet) khi đã có dữ liệu mà lần tải lại lỗi: hai cú chạm cùng khung hình chỉ tải một lần (refetch mặc định
// huỷ lượt đang chạy rồi gửi lại, nên `isFetching` đọc từ lần vẽ trước không đủ); lượt tải trả Promise nên nút báo bận tới khi xong.

const mocks = vi.hoisted(() => ({ http: { get: vi.fn() }, share: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: mocks.share } }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { QueryClient } from '@tanstack/react-query';
import { ContentKitSheet } from './storefront-share';

const KIT = {
  productName: 'Dầu gội bồ kết',
  images: [],
  captions: ['Mua ngay'],
  usps: [],
  faqs: [],
  videoUrls: [],
  shareLink: `${SITE_URL}/san-pham/dau-goi`,
};

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const kitCalls = () => mocks.http.get.mock.calls.filter(([p]) => String(p).includes('/affiliate/content-kit/')).length;
const retry = () => byText(document.body, 'button', 'Thử lại') as HTMLButtonElement;

describe('ContentKitSheet: Thử lại khoá cùng khung hình', () => {
  it('hai cú chạm cùng khung hình chỉ tải lại một lần; nút báo bận bằng aria tới khi xong', async () => {
    mocks.http.get.mockReset().mockResolvedValue(KIT);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mounted = render(<ContentKitSheet open onClose={vi.fn()} productSlug="dau-goi" />, qc);
    await flush();
    mocks.http.get.mockRejectedValueOnce(new Error('Máy chủ bận'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['content-kit'] });
    });
    await flush(3);
    expect(kitCalls()).toBe(2);

    let finish!: (v: typeof KIT) => void;
    mocks.http.get.mockReturnValue(new Promise<typeof KIT>((r) => (finish = r)));
    const btn = retry();
    btn.focus();
    await act(async () => {
      btn.click();
      btn.click();
    });
    await flush(2);
    expect(kitCalls()).toBe(3);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(false);
    await act(async () => finish(KIT));
    await flush(3);
    expect(byText(document.body, 'button', 'Thử lại')).toBeNull();
  });
});
