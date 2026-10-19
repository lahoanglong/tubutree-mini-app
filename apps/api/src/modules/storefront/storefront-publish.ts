import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const TAKEN_DOWN_MESSAGE = 'Gian hàng đang bị Tubu Tree gỡ đăng';

/** Chủ không tự đăng lại được gian hàng đang bị admin gỡ; lý do admin nhập được nói thẳng để chủ biết phải sửa gì. */
export function takenDownError(reason: string | null | undefined): ForbiddenException {
  return new ForbiddenException(`${TAKEN_DOWN_MESSAGE}${reason ? `: ${reason}` : ''}. Liên hệ CSKH để được xem xét lại.`);
}

/**
 * Điều kiện để chủ đăng gian hàng: chưa bị admin gỡ, và có ít nhất 1 sản phẩm (gian hàng rỗng không có gì để khách xem, nên tạo
 * xong ở trạng thái nháp tới khi có hàng). Gỡ đăng (isPublished false) không qua đây: chủ luôn tự ẩn được gian hàng của mình.
 */
export async function assertCanPublish(
  db: Pick<PrismaService, 'storefrontItem'>,
  sf: { id: string; takenDownAt: Date | null; takenDownReason: string | null },
): Promise<void> {
  if (sf.takenDownAt) throw takenDownError(sf.takenDownReason);
  const items = await db.storefrontItem.count({ where: { collection: { storefrontId: sf.id } } });
  if (items === 0) throw new BadRequestException('Thêm ít nhất 1 sản phẩm vào gian hàng trước khi đăng.');
}

/**
 * Lệnh đăng ghi kèm điều kiện `takenDownAt: null` ngay trong WHERE: admin gỡ chen giữa lúc đọc và lúc ghi thì lệnh trượt (P2025)
 * thay vì đăng đè lên lệnh gỡ.
 */
export const PUBLISH_WHERE_NOT_TAKEN_DOWN = { takenDownAt: null } as const;

/** P2025 của lệnh đăng có điều kiện = admin vừa gỡ gian hàng này. */
export function isLostToTakeDown(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}
