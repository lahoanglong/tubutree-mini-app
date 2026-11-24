import type { HttpClient } from './http';
import { orderLineReviewSlot, reviewFocusIndex, type ReviewLine } from './order-line-review';

/**
 * Thẻ "Đơn này thế nào?" ở Chi tiết đơn đã giao (Mini App `OrderCsatCard`, web cùng tên): một chạm 👍 hay 👎. 👍 mở ô viết đánh giá của món
 * đầu tiên còn lối "Viết đánh giá" (cùng luật với nút dưới từng món); 👎 mở chat hỗ trợ kèm mã đơn để CS gỡ vấn đề trước khi khách chấm 1★,
 * chat chưa mở thì đưa khách tới khối liên hệ của trang. Máy chủ giữ câu trả lời đầu tiên của mỗi đơn (POST /orders/:code/csat) và báo hỏi
 * hay không bằng `csatAsk` của GET /orders/:code. Chữ nằm ở đây (không ở shop-copy) để chỉ trang Chi tiết đơn tải.
 */

export type OrderCsatAnswer = 'up' | 'down';
export type OrderCsatPlatform = 'miniapp' | 'web';

/** Chữ của thẻ; độ dài tối đa ghi kèm để vừa một dòng 375px cạnh hai nút (tiêu đề) hay hai dòng (lời cảm ơn). */
export const ORDER_CSAT_COPY = {
  /** ≤ 20 ký tự. */
  title: 'Đơn này thế nào?',
  /** Tên truy cập của nút 👍 / 👎 (nút chỉ có biểu tượng), ≤ 16 ký tự. */
  up: 'Hài lòng',
  down: 'Chưa hài lòng',
  /** 👍 khi không còn món nào để viết đánh giá, ≤ 40 ký tự. */
  thanksUp: 'Cảm ơn bạn đã cho Tubu biết!',
  /** 👎 khi chat chưa mở: trang cuộn tới khối liên hệ ngay sau đó, ≤ 80 ký tự. */
  thanksDown: 'Tubu xin lỗi vì đơn chưa ổn. Nhắn Tubu ở mục Liên hệ để được hỗ trợ ngay.',
} as const;

/** Thẻ chỉ hiện khi máy chủ báo hỏi (`csatAsk`; API cũ không trả thì ẩn) và đơn đang ở trạng thái đã giao. */
export function showOrderCsat(o: { status: string; csatAsk?: boolean }): boolean {
  return o.status === 'DELIVERED' && o.csatAsk === true;
}

export type OrderCsatNext = { kind: 'review'; slug: string } | { kind: 'chat' } | { kind: 'support' } | { kind: 'thanks' };

/** Chạm xong đi đâu: `review` (ô viết đánh giá của món đầu còn viết được), `chat` (chat hỗ trợ kèm mã đơn), `support` (khối liên hệ), `thanks`. */
export function orderCsatNext(answer: OrderCsatAnswer, o: { status: string; items: readonly ReviewLine[] }, chatReady: boolean): OrderCsatNext {
  if (answer === 'down') return chatReady ? { kind: 'chat' } : { kind: 'support' };
  const i = reviewFocusIndex(o);
  const slot = i >= 0 ? orderLineReviewSlot(o.status, o.items[i]!) : null;
  return slot?.kind === 'write' ? { kind: 'review', slug: slot.slug } : { kind: 'thanks' };
}

/** Chat hỗ trợ kèm mã đơn (cùng đường với `SupportContact`): chat hiện chip "Về đơn …" và gắn mã đơn vào tin đầu tiên khách gửi. */
export function orderCsatChatPath(platform: OrderCsatPlatform, code: string): string {
  return `${platform === 'miniapp' ? '/chat' : '/ho-tro/chat'}?order=${encodeURIComponent(code)}`;
}

/** Ghi câu trả lời; gửi lại hay chạm ở thiết bị khác thì máy chủ giữ lần đầu (`recorded: false`). */
export const submitOrderCsat = (http: HttpClient, code: string, answer: OrderCsatAnswer, platform: OrderCsatPlatform) =>
  http.post<{ recorded: boolean }>(`/orders/${encodeURIComponent(code)}/csat`, { answer, platform });
