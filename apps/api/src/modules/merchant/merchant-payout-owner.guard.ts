import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { storeHasPayouts } from './partner-store';

/**
 * Cổng hẹp cho chủ gian hàng vai trò CUSTOMER (đã mất tư cách đối tác nhưng gian hàng còn phiếu đối soát): chỉ gắn lên các route
 * xem gian hàng, hàng trả về, nhận hàng trả và bảng kê. Vai trò khác đã qua RolesGuard của lớp nên đi thẳng. Dịch vụ phía sau vẫn tự
 * kiểm chủ sở hữu và phiếu, guard chỉ chặn sớm để CUSTOMER không tới được các nhánh khác.
 */
@Injectable()
export class MerchantPayoutOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    if (!user || user.role !== 'CUSTOMER') return true;
    const store = await this.prisma.storefront.findFirst({ where: { ownerUserId: user.sub }, select: { id: true } });
    if (store && (await storeHasPayouts(this.prisma, store.id))) return true;
    throw new ForbiddenException('Bạn không có quyền truy cập tài nguyên này.');
  }
}
