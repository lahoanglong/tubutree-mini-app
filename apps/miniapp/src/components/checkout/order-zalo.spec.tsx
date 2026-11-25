import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openWebview: vi.fn(),
  copyText: vi.fn(),
  notify: vi.fn(),
  trackEvent: vi.fn(),
  cfg: { orderZaloEnabled: true as boolean, tubuZaloPhone: '0899149229' as string | undefined },
  navigate: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('zmp-sdk/apis', () => ({ openWebview: mocks.openWebview }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));

import { OrderZaloDetail, OrderZaloFriend } from './order-zalo';

let qc: QueryClient;
function wrap(ui: ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cfg.orderZaloEnabled = true;
  mocks.cfg.tubuZaloPhone = '0899149229';
});

describe('OrderZaloFriend', () => {
  it('câu mời có mã đơn; chạm "Mở Zalo Tubu Tree" mở zalo.me/<số> và đo nguồn bấm', async () => {
    mocks.openWebview.mockResolvedValue(undefined);
    wrap(<OrderZaloFriend code="TUBU2026111557909" from="success" />);
    expect(screen.getByText('Kết bạn Zalo với Tubu Tree để nhận hành trình đơn TUBU2026111557909.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    await waitFor(() => expect(mocks.openWebview).toHaveBeenCalledWith({ url: 'https://zalo.me/0899149229' }));
    expect(mocks.trackEvent).toHaveBeenCalledWith('order_zalo_friend_click', 'miniapp', { from: 'success' });
    expect(screen.queryByRole('button', { name: 'Chép số' })).toBeNull();
  });

  it('Zalo chặn mở liên kết: hiện số để khách tự tìm, nút "Chép số" chép đúng số', async () => {
    mocks.openWebview.mockRejectedValue(new Error('blocked'));
    mocks.copyText.mockResolvedValue(true);
    wrap(<OrderZaloFriend code="TT001" from="order_detail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    const copy = await screen.findByRole('button', { name: 'Chép số' });
    expect(screen.getByText(/0899149229/)).toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã chép số', type: 'success' }));
    expect(mocks.copyText).toHaveBeenCalledWith('0899149229');
  });

  it('số cấu hình hỏng: dùng số mặc định thay vì mở liên kết lạ', async () => {
    mocks.cfg.tubuZaloPhone = 'https://evil.example';
    mocks.openWebview.mockResolvedValue(undefined);
    wrap(<OrderZaloFriend code="TT001" from="success" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    await waitFor(() => expect(mocks.openWebview).toHaveBeenCalledWith({ url: 'https://zalo.me/0899149229' }));
  });
});

describe('OrderZaloDetail (bật Zalo ở chi tiết đơn)', () => {
  const STATUS = { enabled: true, prechecked: true, choice: false, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
  const order = { code: 'TT001', status: 'SHIPPING', orderZaloConsent: false, orderZaloAvailable: true };

  beforeEach(() => {
    mocks.get.mockResolvedValue(STATUS);
    mocks.post.mockResolvedValue({ orderZaloConsent: true });
  });

  it('đơn còn bật được: một nút phụ; bấm thì gọi đúng endpoint, đo sự kiện, báo xong và chuyển sang dòng "Sẽ báo qua Zalo"', async () => {
    wrap(<OrderZaloDetail order={order} />);
    const btn = await screen.findByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' });
    expect(screen.getByText('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này. Số nhận: 090•••4567')).toBeInTheDocument();
    qc.setQueryData(['order', 'TT001'], order);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã bật thông báo Zalo cho đơn này', type: 'success' }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/orders/TT001/order-zalo-consent');
    expect(mocks.trackEvent).toHaveBeenCalledWith('order_zalo_consent_from_detail', 'miniapp', {});
    expect(qc.getQueryData(['order', 'TT001'])).toMatchObject({ orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
  });

  it('máy chủ từ chối (đơn vừa giao xong): báo đúng lời máy chủ, không đo sự kiện bật', async () => {
    mocks.post.mockRejectedValue(new Error('Đơn này đã kết thúc nên không còn tin hành trình để báo qua Zalo.'));
    wrap(<OrderZaloDetail order={order} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.trackEvent).not.toHaveBeenCalledWith('order_zalo_consent_from_detail', 'miniapp', {});
  });

  it('đơn đã bật: dòng số sẽ nhận tin, lối tắt sang Cài đặt và lời mời kết bạn; không có nút bật', async () => {
    wrap(<OrderZaloDetail order={{ ...order, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true }} />);
    expect(await screen.findByText(/Sẽ báo qua Zalo số 090•••4567/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt trong Cài đặt' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings');
    expect(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toBeNull();
  });

  it('đơn có đồng ý nhưng máy chủ báo không gửi (khách đã tắt, đơn tặng): không hứa "Sẽ báo qua Zalo", chỉ lời mời kết bạn như cũ', async () => {
    wrap(<OrderZaloDetail order={{ ...order, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: false }} />);
    expect(await screen.findByRole('button', { name: 'Mở Zalo Tubu Tree' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.queryByText(/Sẽ báo qua Zalo/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nhận thông báo Zalo cho đơn này' })).toBeNull();
  });

  it('cờ MSS tắt: không hỏi máy chủ, không có nút hay dòng nào (giữ như cũ)', async () => {
    mocks.cfg.orderZaloEnabled = false;
    const { container } = wrap(<OrderZaloDetail order={order} />);
    await Promise.resolve();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('máy chủ không cho bật (đơn đã giao, đại lý, không có số nào...): không có nút', async () => {
    const { container } = wrap(<OrderZaloDetail order={{ ...order, orderZaloAvailable: false }} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
