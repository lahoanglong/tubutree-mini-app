import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SetStatusOutcome } from './order-status.service';

const STATUS_LABEL_VI: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Giao thành công',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
};

/** Truyền vào setStatus; giữ `flipped: true` khi setStatus thoát sớm vì đơn đã ở đúng đích (lặp lại là thành công). */
export function manualOutcome(): SetStatusOutcome {
  return { flipped: true, heldReasons: [] };
}

/**
 * setStatus thua race thì bail êm và trả đơn ở trạng thái mới (webhook/cron cần vậy). Người bấm tay phải biết lần bấm của mình
 * không có hiệu lực, nếu không màn báo xong trong khi đơn vẫn ở trạng thái khác. Chỉ dựa vào `outcome.flipped`: so trạng thái
 * trả về với đích là sai, vì lần thắng đọc lại đơn sau mọi việc hậu commit và webhook có thể đã đẩy đơn đi tiếp.
 */
export async function assertManualStatusChange(
  prisma: Pick<PrismaService, 'order'>,
  before: { id: string; status: string; pancakeAttention?: string | null },
  target: string,
  outcome: SetStatusOutcome,
): Promise<void> {
  if (outcome.flipped) return;
  const now = await prisma.order.findUniqueOrThrow({ where: { id: before.id }, select: { status: true, pancakeAttention: true } });
  if (now.status === target) return;
  const what =
    now.status === before.status
      ? 'Đơn vừa thay đổi thanh toán hoặc vận chuyển'
      : `Đơn vừa chuyển sang «${STATUS_LABEL_VI[now.status] ?? now.status}»`;
  const flagged = target === 'CANCELLED' && !!now.pancakeAttention && now.pancakeAttention !== (before.pancakeAttention ?? null);
  throw new ConflictException(
    `${what} trong lúc bạn thao tác nên chưa đổi được. Tải lại đơn rồi thử lại.${flagged ? ' Đơn đã vào Cần xử lý Pancake.' : ''}`,
  );
}
