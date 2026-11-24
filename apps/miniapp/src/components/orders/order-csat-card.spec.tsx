import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_CSAT_COPY } from '@tubutree/app-core/order-csat';

// Thẻ "Đơn này thế nào?" ở Chi tiết đơn đã giao (tubu-w30-01): cùng luật, chữ và props với web OrderCsatCard.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  post: vi.fn(),
  chat: false,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ chat: { enabled: mocks.chat } }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { OrderCsatCard, type OrderCsatCardProps } from './order-csat-card';

const order = (over: Partial<OrderCsatCardProps['order']> = {}): OrderCsatCardProps['order'] => ({
  id: 'o1',
  code: 'TB-1',
  status: 'DELIVERED',
  csatAsk: true,
  items: [
    { productSlug: 'da-viet', reviewId: 'r1', quantity: 1 },
    { productSlug: 'xa-phong', reviewable: true, quantity: 2 },
  ],
  ...over,
});

function renderCard(o = order(), onSupport = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['order', o.code], { ...o });
  const view = render(
    <QueryClientProvider client={qc}>
      <OrderCsatCard order={o} onSupport={onSupport} />
    </QueryClientProvider>,
  );
  return { ...view, qc, onSupport };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chat = false;
  mocks.post.mockResolvedValue({ recorded: true });
});

describe('OrderCsatCard (Mini App)', () => {
  it('máy chủ báo hỏi: một dòng tiêu đề với hai nút có tên truy cập, gom trong nhóm mang tên câu hỏi', () => {
    renderCard();
    const group = screen.getByRole('group', { name: ORDER_CSAT_COPY.title });
    expect(group).toBeTruthy();
    expect(screen.getByRole('button', { name: ORDER_CSAT_COPY.up }).textContent).toContain('👍');
    expect(screen.getByRole('button', { name: ORDER_CSAT_COPY.down }).textContent).toContain('👎');
  });

  it.each([
    ['API cũ không trả csatAsk', { csatAsk: undefined }],
    ['đã trả lời', { csatAsk: false }],
    ['đơn không còn ở trạng thái đã giao', { status: 'RETURNED' }],
  ])('%s → không có thẻ', (_n, over) => {
    renderCard(order(over));
    expect(screen.queryByTestId('order-csat')).toBeNull();
  });

  it('👍: ghi "up" từ miniapp, mở ô viết đánh giá của món đầu còn viết được cho đúng lần mua, đánh dấu bản đệm để quay lại không hỏi lại', async () => {
    const { qc } = renderCard();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ORDER_CSAT_COPY.up })));
    expect(mocks.post).toHaveBeenCalledWith('/orders/TB-1/csat', { answer: 'up', platform: 'miniapp' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-phong', { state: { reviewOrderId: 'o1' } });
    expect(qc.getQueryData<{ csatAsk?: boolean }>(['order', 'TB-1'])?.csatAsk).toBe(false);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(ORDER_CSAT_COPY.thanksUp);
  });

  it('👍 khi không còn món nào để viết → chỉ cảm ơn tại chỗ, focus vào dòng cảm ơn (nút vừa chạm đã biến mất)', async () => {
    renderCard(order({ items: [{ productSlug: 'da-viet', reviewId: 'r1', quantity: 1 }] }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ORDER_CSAT_COPY.up })));
    expect(mocks.navigate).not.toHaveBeenCalled();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(ORDER_CSAT_COPY.thanksUp);
    expect(document.activeElement).toBe(status);
  });

  it('👎 khi chat mở: ghi "down" rồi mở chat kèm mã đơn (chip "Về đơn …")', async () => {
    mocks.chat = true;
    const { onSupport } = renderCard();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ORDER_CSAT_COPY.down })));
    expect(mocks.post).toHaveBeenCalledWith('/orders/TB-1/csat', { answer: 'down', platform: 'miniapp' });
    expect(mocks.navigate).toHaveBeenCalledWith('/chat?order=TB-1');
    expect(onSupport).not.toHaveBeenCalled();
  });

  it('👎 khi chat chưa mở: đưa khách tới khối liên hệ, dòng xin lỗi chỉ chỗ nhắn', async () => {
    const { onSupport } = renderCard();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ORDER_CSAT_COPY.down })));
    expect(onSupport).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(ORDER_CSAT_COPY.thanksDown);
  });

  it('chạm đúp cùng nhịp chỉ ghi và đi một lần; lỗi mạng không chặn lối đi tiếp', async () => {
    mocks.post.mockRejectedValue(new Error('mạng'));
    renderCard();
    const up = screen.getByRole('button', { name: ORDER_CSAT_COPY.up });
    await act(async () => {
      fireEvent.click(up);
      fireEvent.click(up);
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });
});
