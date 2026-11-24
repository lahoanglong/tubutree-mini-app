// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_CSAT_COPY } from '@tubutree/app-core/order-csat';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Thẻ "Đơn này thế nào?" ở Chi tiết đơn đã giao (tubu-w30-01): cùng luật, chữ và props với Mini OrderCsatCard.

const mocks = vi.hoisted(() => ({ push: vi.fn(), post: vi.fn(), chat: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, chat: { enabled: mocks.chat } }) }));

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

let view: Rendered | null = null;
function mount(o = order(), onSupport = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['order', o.code], { ...o });
  view = render(<OrderCsatCard order={o} onSupport={onSupport} />, qc);
  return { el: view.container, qc, onSupport };
}
const button = (el: HTMLElement, name: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chat = false;
  mocks.post.mockResolvedValue({ recorded: true });
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('OrderCsatCard (web)', () => {
  it('máy chủ báo hỏi: nhóm mang tên câu hỏi, hai nút có tên truy cập và đủ vùng chạm 44px', () => {
    const { el } = mount();
    const group = el.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(ORDER_CSAT_COPY.title);
    expect(button(el, ORDER_CSAT_COPY.up)?.textContent).toContain('👍');
    expect(button(el, ORDER_CSAT_COPY.down)?.textContent).toContain('👎');
    expect(unnamedControls(el)).toEqual([]);
    expect(smallTouchTargets(el)).toEqual([]);
  });

  it.each([
    ['API cũ không trả csatAsk', { csatAsk: undefined }],
    ['đã trả lời', { csatAsk: false }],
    ['đơn không còn ở trạng thái đã giao', { status: 'RETURNED' }],
  ])('%s → không có thẻ', (_n, over) => {
    const { el } = mount(order(over));
    expect(el.querySelector('[data-testid="order-csat"]')).toBeNull();
  });

  it('👍: ghi "up" từ web, mở ô viết đánh giá của món đầu còn viết được cho đúng lần mua, đánh dấu bản đệm', async () => {
    const { el, qc } = mount();
    click(button(el, ORDER_CSAT_COPY.up));
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/orders/TB-1/csat', { answer: 'up', platform: 'web' });
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/xa-phong?danh-gia=o1#danh-gia');
    expect(qc.getQueryData<{ csatAsk?: boolean }>(['order', 'TB-1'])?.csatAsk).toBe(false);
    expect(el.querySelector('[role="group"]')).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toBe(ORDER_CSAT_COPY.thanksUp);
  });

  it('👍 khi không còn món nào để viết → chỉ cảm ơn tại chỗ, focus vào dòng cảm ơn', async () => {
    const { el } = mount(order({ items: [{ productSlug: 'da-viet', reviewId: 'r1', quantity: 1 }] }));
    click(button(el, ORDER_CSAT_COPY.up));
    await flush();
    expect(mocks.push).not.toHaveBeenCalled();
    const status = el.querySelector('[role="status"]');
    expect(status?.textContent).toBe(ORDER_CSAT_COPY.thanksUp);
    expect(document.activeElement).toBe(status);
  });

  it('👎 khi chat mở: ghi "down" rồi mở chat kèm mã đơn', async () => {
    mocks.chat = true;
    const { el, onSupport } = mount();
    click(button(el, ORDER_CSAT_COPY.down));
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/orders/TB-1/csat', { answer: 'down', platform: 'web' });
    expect(mocks.push).toHaveBeenCalledWith('/ho-tro/chat?order=TB-1');
    expect(onSupport).not.toHaveBeenCalled();
  });

  it('👎 khi chat chưa mở: đưa khách tới khối liên hệ, dòng xin lỗi chỉ chỗ nhắn', async () => {
    const { el, onSupport } = mount();
    click(button(el, ORDER_CSAT_COPY.down));
    await flush();
    expect(onSupport).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(el.querySelector('[role="status"]')?.textContent).toBe(ORDER_CSAT_COPY.thanksDown);
  });

  it('chạm đúp cùng nhịp chỉ ghi và đi một lần; lỗi mạng không chặn lối đi tiếp', async () => {
    mocks.post.mockRejectedValue(new Error('mạng'));
    const { el } = mount();
    const up = button(el, ORDER_CSAT_COPY.up)!;
    act(() => {
      up.click();
      up.click();
    });
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
