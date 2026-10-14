import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionStateService } from '../auth/session-state.service';

/**
 * Admin khoá / mở khoá tài khoản (farm voucher, lừa COD, spam cộng đồng). Khoá có hiệu lực ngay: thu hồi
 * mọi refresh token, chốt sessionsRevokedAt để token vừa xoay mất ân hạn, và JwtStrategy từ chối access
 * token đã cấp. Ai khoá, lúc nào, vì sao nằm trên chính dòng users (blockedById/blockedAt/blockedReason).
 */
@Injectable()
export class UserBlockService {
  private readonly logger = new Logger(UserBlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionStateService,
  ) {}

  async block(adminId: string, userId: string, rawReason: string) {
    const reason = rawReason.trim();
    if (!reason) throw new BadRequestException('Cần ghi lý do khoá tài khoản.');
    if (userId === adminId) {
      throw new BadRequestException('Không thể tự khoá tài khoản của chính mình.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
      const now = new Date();
      const updated = await tx.user.update({
        where: { id: userId },
        data: { isBlocked: true, blockedAt: now, blockedReason: reason, blockedById: adminId, sessionsRevokedAt: now },
        select: { id: true, isBlocked: true, blockedAt: true, blockedReason: true },
      });
      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { ...updated, revokedSessions: count };
    });
    this.sessions.invalidate(userId);
    this.logger.warn(`Admin ${adminId} khoá user ${userId} (thu hồi ${result.revokedSessions} phiên): ${reason}`);
    return result;
  }

  async unblock(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, metadata: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const meta = user.metadata as Record<string, unknown> | null;
    if (meta && typeof meta === 'object' && meta.anonymizedAt) {
      throw new BadRequestException('Tài khoản đã được xoá theo yêu cầu của chủ tài khoản, không mở khoá được.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null },
      select: { id: true, isBlocked: true, blockedAt: true, blockedReason: true },
    });
    this.sessions.invalidate(userId);
    this.logger.warn(`Admin ${adminId} mở khoá user ${userId}.`);
    return updated;
  }
}
