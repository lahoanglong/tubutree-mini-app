import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http';
import { FORBIDDEN_TERMS } from './shop-copy';
import { ORDER_CSAT_COPY, orderCsatChatPath, orderCsatNext, showOrderCsat, submitOrderCsat } from './order-csat';

const line = (over: Record<string, unknown> = {}) => ({ productSlug: 'xa-phong', quantity: 1, reviewable: true, ...over });

describe('showOrderCsat', () => {
  it('chỉ đơn đã giao mà máy chủ báo hỏi; API cũ không trả csatAsk thì ẩn', () => {
    expect(showOrderCsat({ status: 'DELIVERED', csatAsk: true })).toBe(true);
    expect(showOrderCsat({ status: 'DELIVERED', csatAsk: false })).toBe(false);
    expect(showOrderCsat({ status: 'DELIVERED' })).toBe(false);
    expect(showOrderCsat({ status: 'RETURNED', csatAsk: true })).toBe(false);
  });
});

describe('orderCsatNext', () => {
  it('👍: ô viết đánh giá của món đầu tiên còn lối "Viết đánh giá" (bỏ món đã đánh giá, đã trả, đã gỡ)', () => {
    const o = {
      status: 'DELIVERED',
      items: [
        line({ productSlug: 'da-viet', reviewId: 'r1' }),
        line({ productSlug: 'da-tra', returnedQty: 1 }),
        line({ productSlug: 'da-go', productPublic: false }),
        line({ productSlug: 'con-viet' }),
      ],
    };
    expect(orderCsatNext('up', o, false)).toEqual({ kind: 'review', slug: 'con-viet' });
  });

  it('👍 khi không còn món nào để viết mới → chỉ cảm ơn', () => {
    expect(orderCsatNext('up', { status: 'DELIVERED', items: [line({ reviewId: 'r1' }), line({ reviewable: false })] }, true)).toEqual({ kind: 'thanks' });
  });

  it('👎: chat mở → chat kèm mã đơn; chat chưa mở → khối liên hệ', () => {
    const o = { status: 'DELIVERED', items: [line()] };
    expect(orderCsatNext('down', o, true)).toEqual({ kind: 'chat' });
    expect(orderCsatNext('down', o, false)).toEqual({ kind: 'support' });
  });
});

describe('orderCsatChatPath', () => {
  it('đúng route chat của từng nền tảng (route-map: /chat ↔ /ho-tro/chat), mã đơn được mã hoá', () => {
    expect(orderCsatChatPath('miniapp', 'TB-12')).toBe('/chat?order=TB-12');
    expect(orderCsatChatPath('web', 'TB 1&x')).toBe('/ho-tro/chat?order=TB%201%26x');
  });
});

describe('submitOrderCsat', () => {
  it('POST /orders/:code/csat với câu trả lời và nền tảng', async () => {
    const post = vi.fn().mockResolvedValue({ recorded: true });
    await expect(submitOrderCsat({ post } as unknown as HttpClient, 'TB/1', 'down', 'miniapp')).resolves.toEqual({ recorded: true });
    expect(post).toHaveBeenCalledWith('/orders/TB%2F1/csat', { answer: 'down', platform: 'miniapp' });
  });
});

describe('ORDER_CSAT_COPY', () => {
  it('giữ trong ngân sách độ dài ghi ở khai báo', () => {
    expect(ORDER_CSAT_COPY.title.length).toBeLessThanOrEqual(20);
    expect(ORDER_CSAT_COPY.up.length).toBeLessThanOrEqual(16);
    expect(ORDER_CSAT_COPY.down.length).toBeLessThanOrEqual(16);
    expect(ORDER_CSAT_COPY.thanksUp.length).toBeLessThanOrEqual(40);
    expect(ORDER_CSAT_COPY.thanksDown.length).toBeLessThanOrEqual(80);
  });

  it('không dùng thuật ngữ cấm', () => {
    for (const text of Object.values(ORDER_CSAT_COPY)) {
      for (const t of FORBIDDEN_TERMS) expect(t.pattern.test(text), `${text} ~ ${t.pattern}`).toBe(false);
    }
  });
});
