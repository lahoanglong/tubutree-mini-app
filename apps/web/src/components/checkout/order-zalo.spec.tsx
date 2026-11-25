// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({
  cfg: { orderZaloEnabled: true as boolean, tubuZaloPhone: '0899149229' },
  get: vi.fn(),
  post: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr-img" data-value={value} /> }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OrderZaloDetail } from './order-zalo';

const STATUS = { enabled: true, prechecked: true, choice: false, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
const ORDER = { code: 'TT001', status: 'SHIPPING', orderZaloConsent: false, orderZaloAvailable: true };
const CTA = 'Nhận thông báo Zalo cho đơn này';

let view: Rendered | null = null;
let qc: QueryClient;
const mountDetail = async (order: typeof ORDER & { orderZaloOn?: boolean }) => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  view = render(<OrderZaloDetail order={order} />, qc);
  await flush();
  return view.container;
};
const buttonByText = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;

beforeEach(() => {
  mocks.cfg.orderZaloEnabled = true;
  mocks.get.mockImplementation(async (path: string) => (path === '/config/order-zalo' ? STATUS : { orderZaloEnabled: mocks.cfg.orderZaloEnabled }));
  mocks.post.mockResolvedValue({ orderZaloConsent: true });
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('OrderZaloDetail (web)', () => {
  it('đơn còn bật được: một nút phụ đủ 44px; bấm đúp chỉ gọi một lần, đo sự kiện, đổi cache đơn sang đã bật', async () => {
    const root = await mountDetail(ORDER);
    qc.setQueryData(['order', 'TT001'], ORDER);
    const btn = buttonByText(root, CTA);
    expect(btn).not.toBeNull();
    expect(root.textContent).toContain('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này. Số nhận: 090•••4567');
    expect(unnamedControls(root)).toEqual([]);
    expect(smallTouchTargets(root)).toEqual([]);
    click(btn);
    click(btn);
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/orders/TT001/order-zalo-consent');
    expect(mocks.track).toHaveBeenCalledWith('order_zalo_consent_from_detail', {});
    expect(qc.getQueryData(['order', 'TT001'])).toMatchObject({ orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
  });

  it('máy chủ từ chối: báo lỗi tại chỗ (role="alert"), nút còn bấm lại được, không đo sự kiện bật', async () => {
    mocks.post.mockRejectedValue(new Error('Đơn này đã kết thúc nên không còn tin hành trình để báo qua Zalo.'));
    const root = await mountDetail(ORDER);
    click(buttonByText(root, CTA));
    await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(buttonByText(root, CTA)?.disabled).toBe(false);
    expect(mocks.track).not.toHaveBeenCalledWith('order_zalo_consent_from_detail', {});
  });

  it('đơn đã bật: dòng "Sẽ báo qua Zalo số …", link Cài đặt và lời mời kết bạn; không có nút bật', async () => {
    const root = await mountDetail({ ...ORDER, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
    expect(root.querySelector('[data-testid="order-zalo-on"]')?.textContent).toContain('Sẽ báo qua Zalo số 090•••4567');
    expect(root.querySelector('a[href="/tai-khoan/cai-dat"]')?.textContent).toBe('Tắt trong Cài đặt');
    expect(root.querySelector('a[href="https://zalo.me/0899149229"]')).not.toBeNull();
    expect(buttonByText(root, CTA)).toBeNull();
  });

  it('đơn có đồng ý nhưng máy chủ báo không gửi (khách đã tắt, đơn tặng): không hứa "Sẽ báo qua Zalo", chỉ lời mời kết bạn như cũ', async () => {
    const root = await mountDetail({ ...ORDER, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: false });
    expect(root.querySelector('[data-testid="order-zalo-on"]')).toBeNull();
    expect(root.querySelector('a[href="https://zalo.me/0899149229"]')).not.toBeNull();
    expect(buttonByText(root, CTA)).toBeNull();
  });

  it('cờ MSS tắt: không hỏi trạng thái Zalo, không có phần tử nào (giữ như cũ)', async () => {
    mocks.cfg.orderZaloEnabled = false;
    const root = await mountDetail(ORDER);
    expect(mocks.get.mock.calls.some(([p]) => p === '/config/order-zalo')).toBe(false);
    expect(root.innerHTML).toBe('');
  });

  it('máy chủ không cho bật (đơn đã giao, đại lý, không có số nào...): không có nút', async () => {
    const root = await mountDetail({ ...ORDER, orderZaloAvailable: false });
    expect(root.innerHTML).toBe('');
  });

  it('U4 lời mời kết bạn: câu "Nhận Bill…" có mã đơn, link zalo.me; khối QR chỉ hiện từ md (hidden md:flex), điện thoại không vẽ QR', async () => {
    const root = await mountDetail({ ...ORDER, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
    expect(root.textContent).toContain('Nhận Bill & theo dõi đơn TT001 miễn phí qua Zalo Tubu Tree');
    expect(root.querySelector('a[href="https://zalo.me/0899149229"]')).not.toBeNull();
    const qr = root.querySelector('[data-testid="order-zalo-friend-qr"]');
    expect(qr).not.toBeNull();
    expect(qr!.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
    expect(qr!.getAttribute('data-qr-value')).toBe('https://zalo.me/0899149229');
    expect(qr!.textContent).toContain('Hoặc quét mã bằng Zalo trên điện thoại');
    expect(root.querySelector('[data-testid="qr-img"]')).toBeNull();
  });

  it('U4 màn từ md: vẽ QR mã hoá đúng https://zalo.me/0899149229', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('min-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
    const root = await mountDetail({ ...ORDER, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
    expect(root.querySelector('[data-testid="order-zalo-friend-qr"] [data-testid="qr-img"]')?.getAttribute('data-value')).toBe('https://zalo.me/0899149229');
  });

  it('U2 máy chủ báo khách đã nhận tin Zalo đơn gần đây (friendKnown): không mời kết bạn, vẫn ghi số sẽ nhận tin', async () => {
    mocks.get.mockImplementation(async (path: string) => (path === '/config/order-zalo' ? { ...STATUS, friendKnown: true } : { orderZaloEnabled: true }));
    const root = await mountDetail({ ...ORDER, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
    expect(root.querySelector('[data-testid="order-zalo-on"]')?.textContent).toContain('Sẽ báo qua Zalo số 090•••4567');
    expect(root.querySelector('a[href="https://zalo.me/0899149229"]')).toBeNull();
    expect(root.querySelector('[data-testid="order-zalo-friend-qr"]')).toBeNull();
  });
});
