import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useServerGuestConfig } from '@/components/checkout/server-guest-config';

const mocks = vi.hoisted(() => ({ get: vi.fn(), revalidate: [] as (number | undefined)[] }));

vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: (init?: { revalidate?: number }) => {
    mocks.revalidate.push(init?.revalidate);
    return { get: (path: string) => mocks.get(path) };
  },
}));

import CheckoutLayout, { metadata } from './layout';

function Probe() {
  const value = useServerGuestConfig();
  return <pre data-testid="server-guest-config">{value === undefined ? 'undefined' : JSON.stringify(value)}</pre>;
}
const seen = async () => {
  const html = renderToStaticMarkup(await CheckoutLayout({ children: <Probe /> }));
  const raw = html.match(/<pre data-testid="server-guest-config">([^<]*)<\/pre>/)?.[1] ?? '';
  const text = raw.replace(/&quot;/g, '"');
  return text === 'undefined' ? undefined : JSON.parse(text);
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.revalidate = [];
});

describe('/thanh-toan layout: cờ đặt không đăng nhập đọc sẵn ở máy chủ (P2-6)', () => {
  it('chỉ đưa xuống đúng hai trường trang cần (cờ và quà đơn đầu), không cả cấu hình công khai; đọc lại sau tối đa 60 giây', async () => {
    mocks.get.mockResolvedValue({
      freeshipThreshold: 199_000,
      webGuestCheckoutEnabled: true,
      newCustomer: { welcomeVoucher: { amount: 30_000, minOrder: 0 }, other: 1 },
    });
    expect(await seen()).toEqual({ webGuestCheckoutEnabled: true, newCustomer: { welcomeVoucher: { amount: 30_000 } } });
    expect(mocks.get).toHaveBeenCalledWith('/config/public');
    expect(mocks.revalidate).toEqual([60]);
  });

  it('cờ không phải đúng boolean true (API cũ, chuỗi "true"): tắt; không có quà đơn đầu thì null', async () => {
    mocks.get.mockResolvedValue({ webGuestCheckoutEnabled: 'true' });
    expect(await seen()).toEqual({ webGuestCheckoutEnabled: false, newCustomer: { welcomeVoucher: null } });
  });

  it('không đọc được cấu hình: undefined, trang chờ bản của trình duyệt như trước', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    expect(await seen()).toBeUndefined();
  });

  it('API treo: quá 2 giây thì undefined (trang chờ bản của trình duyệt), không giữ cả trang', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockReturnValue(new Promise(() => undefined));
      const pending = seen();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('giữ tiêu đề riêng và chặn lập chỉ mục', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
