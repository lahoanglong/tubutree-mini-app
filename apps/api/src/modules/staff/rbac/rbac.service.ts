import { Injectable, Logger } from '@nestjs/common';
import type { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  AFFILIATE: 1,
  DEALER: 2,
  STAFF: 3,
  ADMIN: 4,
};

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Áp grant theo SĐT khi login/refresh. CHỈ NÂNG role (không tự hạ — hạ qua revoke).
   * Trả user đã update (hoặc user gốc nếu không đổi).
   */
  async applyGrants(user: User): Promise<User> {
    if (!user.phone) return user;
    const grants = await this.prisma.roleGrant.findMany({
      where: { phone: user.phone, revokedAt: null },
      select: { role: true },
    });
    if (grants.length === 0) return user;
    // role cao nhất trong grant (STAFF/ADMIN)
    const best = grants.reduce<UserRole>(
      (acc, g) => (RANK[g.role] > RANK[acc] ? g.role : acc),
      'CUSTOMER',
    );
    if (RANK[best] <= RANK[user.role]) return user; // không nâng / không hạ
    this.logger.warn(`applyGrants: nâng user ${user.id} (${user.phone}) ${user.role} → ${best}`);
    return this.prisma.user.update({ where: { id: user.id }, data: { role: best } });
  }

  /** Admin thêm quyền theo SĐT. Không tạo grant trùng (cùng phone+role còn hiệu lực). */
  async addGrant(adminId: string, phone: string, role: 'STAFF' | 'ADMIN') {
    const normalized = phone.trim();
    const existing = await this.prisma.roleGrant.findFirst({
      where: { phone: normalized, role, revokedAt: null },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.roleGrant.create({ data: { phone: normalized, role, grantedBy: adminId } });
      this.logger.warn(`Admin ${adminId} cấp grant ${role} cho SĐT ${normalized}`);
    }
    // Áp ngay nếu user đã tồn tại
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    let applied = false;
    if (user) {
      const updated = await this.applyGrants(user);
      applied = updated.role !== user.role;
    }
    return { granted: role, applied };
  }

  /**
   * Thu hồi mọi grant STAFF/ADMIN theo SĐT. Nếu user đang STAFF/ADMIN thì hạ về role GỐC
   * (DEALER nếu có đơn đại lý đã duyệt, ngược lại CUSTOMER) — tránh xoá nhầm quyền đại lý khi
   * một đại lý từng được nâng tạm lên nhân viên.
   */
  async revokeGrant(adminId: string, phone: string) {
    const normalized = phone.trim();
    const { count } = await this.prisma.roleGrant.updateMany({
      where: { phone: normalized, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    let downgraded = false;
    if (user && (user.role === 'STAFF' || user.role === 'ADMIN')) {
      const base = await this.resolveBaseRole(user.id);
      await this.prisma.user.update({ where: { id: user.id }, data: { role: base } });
      downgraded = true;
      this.logger.warn(`Admin ${adminId} thu hồi quyền SĐT ${normalized}: ${user.role} → ${base}`);
    }
    return { revoked: count, downgraded };
  }

  /** Role gốc khi bỏ quyền nhân viên: DEALER nếu có đơn đại lý đã duyệt, ngược lại CUSTOMER. */
  private async resolveBaseRole(userId: string): Promise<'CUSTOMER' | 'DEALER'> {
    const dealerApp = await this.prisma.dealerApplication.findFirst({
      where: { userId, status: 'APPROVED' },
      select: { id: true },
    });
    return dealerApp ? 'DEALER' : 'CUSTOMER';
  }

  /** Danh sách nhân sự (user STAFF/ADMIN) + lời mời chờ (grant chưa gắn user). */
  async listStaff() {
    const members = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true, phone: true, fullName: true, avatarUrl: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const memberPhones = new Set(members.map((m) => m.phone).filter(Boolean) as string[]);
    const grants = await this.prisma.roleGrant.findMany({
      where: { revokedAt: null },
      select: { phone: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const pendingInvites = grants.filter((g) => !memberPhones.has(g.phone));
    return { members, pendingInvites };
  }
}
