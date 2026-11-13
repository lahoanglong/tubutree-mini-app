// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { useWelcomeOffer } from './use-welcome-offer';

let mounted: Rendered[] = [];
function Probe({ enabled }: { enabled?: boolean }) {
  const offer = useWelcomeOffer(enabled);
  return <output>{offer ? `${offer.amount}/${offer.minOrder}` : 'none'}</output>;
}
const mount = async (enabled?: boolean) => {
  const r = render(<Probe enabled={enabled} />);
  mounted.push(r);
  await flush(3);
  return r.container;
};

beforeEach(() => {
  mocks.get.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('useWelcomeOffer', () => {
  it('mã chào mừng ở cấu hình công khai thành ưu đãi cho lời chia sẻ', async () => {
    mocks.get.mockResolvedValue({ newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 } } });
    expect((await mount()).textContent).toBe('30000/199000');
  });

  it('API cũ chưa có newCustomer hoặc lỗi mạng: null, lời chia sẻ dùng câu không số', async () => {
    mocks.get.mockResolvedValue({});
    expect((await mount()).textContent).toBe('none');
    mounted.pop()!.unmount();
    mocks.get.mockRejectedValue(new Error('offline'));
    expect((await mount()).textContent).toBe('none');
  });

  it('enabled false: không gọi API', async () => {
    expect((await mount(false)).textContent).toBe('none');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
