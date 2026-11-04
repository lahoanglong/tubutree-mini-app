import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionStateService } from '../auth/session-state.service';
import { ImageRegistryStale } from '../catalog/image-registry-stale';
import { recordUserAdminEvent } from '../../common/user-admin-events';
import { LAST_ADMIN_MESSAGE, assertAnotherActiveAdmin, lockAdminRoster } from '../../common/admin-roster';

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
    @Optional() @Inject(ImageRegistryStale) private readonly imageStale?: ImageRegistryStale,
  ) {}

  async block(adminId: string, userId: string, rawReason: string) {
    const reason = rawReason.trim();
    if (!reason) throw new BadRequestException('Cần ghi lý do khoá tài khoản.');
    if (userId === adminId) {
      throw new BadRequestException('Không thể tự khoá tài khoản của chính mình.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await lockAdminRoster(tx);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isBlocked: true } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
      if (user.role === 'ADMIN' && !user.isBlocked) await assertAnotherActiveAdmin(tx, userId, LAST_ADMIN_MESSAGE.block);
      // Khoá dòng rồi mới lấy giờ (xem AuthService.revokeAllSessions).
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
      const now = new Date();
      const updated = await tx.user.update({
        where: { id: userId },
        data: { isBlocked: true, blockedAt: now, blockedReason: reason, blockedById: adminId, sessionsRevokedAt: now },
        select: { id: true, isBlocked: true, blockedAt: true, blockedReason: true },
      });
      await recordUserAdminEvent(tx, { userId, kind: 'BLOCK', reason, actorId: adminId });
      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { ...updated, revokedSessions: count };
    });
    this.sessions.invalidate(userId);
    // Gian hàng của người bị khoá/mở khoá đổi trạng thái hiển thị, danh sách ảnh cho /img phải nạp lại.
    this.imageStale?.markStale();
    this.logger.warn(`Admin ${adminId} khoá user ${userId} (thu hồi ${result.revokedSessions} phiên): ${reason}`);
    return result;
  }

  async unblock(adminId: string, userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, metadata: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const meta = user.metadata as Record<string, unknown> | null;
    if (meta && typeof meta === 'object' && meta.anonymizedAt) {
      throw new BadRequestException('Tài khoản đã được xoá theo yêu cầu của chủ tài khoản, không mở khoá được.');
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null },
        select: { id: true, isBlocked: true, blockedAt: true, blockedReason: true },
      }),
      recordUserAdminEvent(this.prisma, { userId, kind: 'UNBLOCK', reason, actorId: adminId }),
    ]);
    this.sessions.invalidate(userId);
    this.imageStale?.markStale();
    this.logger.warn(`Admin ${adminId} mở khoá user ${userId}.`);
    return updated;
  }

  /**
   * Cắt mọi phiên đăng nhập (nghi lộ phiên, thiết bị mất) mà không khoá tài khoản: khách đăng nhập lại được ngay.
   * Cùng cơ chế với khoá: thu hồi refresh token, chốt sessionsRevokedAt để access token đã cấp mất hiệu lực.
   */
  async revokeSessions(adminId: string, userId: string, rawReason: string) {
    const reason = rawReason.trim();
    if (!reason) throw new BadRequestException('Cần ghi lý do cắt phiên đăng nhập.');
    if (userId === adminId) {
      throw new BadRequestException('Không tự cắt phiên của chính mình. Dùng Đăng xuất mọi thiết bị trong Cài đặt.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      // Khoá dòng rồi mới lấy giờ, giữ khoá tới commit (xem AuthService.revokeAllSessions).
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
      const now = new Date();
      const marked = await tx.user.updateMany({ where: { id: userId }, data: { sessionsRevokedAt: now } });
      if (marked.count === 0) throw new NotFoundException('Không tìm thấy người dùng.');
      const { count } = await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await recordUserAdminEvent(tx, { userId, kind: 'SESSIONS_REVOKED', to: String(count), reason, actorId: adminId });
      return { id: userId, revokedSessions: count };
    });
    this.sessions.invalidate(userId);
    this.logger.warn(`Admin ${adminId} cắt ${result.revokedSessions} phiên của user ${userId}: ${reason}`);
    return result;
  }
}
