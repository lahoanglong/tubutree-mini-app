import { ConflictException } from '@nestjs/common';

const STATUS_LABEL_VI: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Giao thành công',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
};

/**
 * setStatus thua race thì bail êm và trả đơn ở trạng thái mới (webhook/cron cần vậy). Người bấm tay thì phải biết
 * lần bấm của mình không có hiệu lực, nếu không màn báo xong trong khi đơn vẫn ở trạng thái khác.
 */
export function assertReachedStatus(
  result: { status: string; pancakeAttention?: string | null },
  target: string,
): void {
  if (result.status === target) return;
  const label = STATUS_LABEL_VI[result.status] ?? result.status;
  const pancake = target === 'CANCELLED' && result.pancakeAttention ? ' Đơn đã vào Cần xử lý Pancake.' : '';
  throw new ConflictException(`Đơn vừa chuyển sang «${label}» trong lúc bạn thao tác nên chưa đổi được. Tải lại đơn rồi thử lại.${pancake}`);
}
