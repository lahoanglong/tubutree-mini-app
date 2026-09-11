import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  AFFILIATE: 1,
  DEALER: 2,
  STAFF: 3,
  ADMIN: 4,
};

/** PrismaService hoặc client trong 1 $transaction — cho phép gộp nhiều bước vào 1 tx atomically. */
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Áp grant theo SĐT khi login/refresh. CHỈ NÂNG role (không tự hạ — hạ qua revoke).
   * Trả user đã update (hoặc user gốc nếu không đổi).
   */
  async applyGrants(user: User, db: Db = this.prisma): Promise<User> {
    if (!user.phone) return user;
    const grants = await db.roleGrant.findMany({
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
    return db.user.update({ where: { id: user.id }, data: { role: best } });
  }

  /**
   * Admin thêm quyền theo SĐT. Không tạo grant trùng (cùng phone+role còn hiệu lực).
   * Bọc trong $transaction: tạo grant + áp role ngay là 1 thao tác atomic — tránh trạng thái
   * nửa vời (grant đã tạo nhưng role chưa nâng, hoặc ngược lại) nếu 1 bước lỗi giữa chừng.
   */
  async addGrant(adminId: string, phone: string, role: 'STAFF' | 'ADMIN') {
    const normalized = phone.trim();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.roleGrant.findFirst({
        where: { phone: normalized, role, revokedAt: null },
        select: { id: true },
      });
      if (!existing) {
        try {
          await tx.roleGrant.create({ data: { phone: normalized, role, grantedBy: adminId } });
          this.logger.warn(`Admin ${adminId} cấp grant ${role} cho SĐT ${normalized}`);
        } catch (err) {
          // findFirst rồi create trong 1 $transaction READ COMMITTED (mặc định) vẫn không atomic —
          // 2 request addGrant() đồng thời cho CÙNG phone+role có thể cùng qua check "chưa có
          // grant" trước khi tx đầu commit. Partial unique index role_grants_active_phone_role_key
          // (phone,role WHERE revokedAt IS NULL) chặn ở DB, request thua ăn P2002 → coi như ĐÃ cấp
          // (idempotent), tiếp tục áp role cho user thay vì rollback/throw lỗi DB thô.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        }
      }
      // Áp ngay nếu user đã tồn tại
      const user = await tx.user.findUnique({ where: { phone: normalized } });
      let applied = false;
      if (user) {
        const updated = await this.applyGrants(user, tx);
        applied = updated.role !== user.role;
      }
      return { granted: role, applied };
    });
  }

  /**
   * Thu hồi mọi grant STAFF/ADMIN theo SĐT. Nếu user đang STAFF/ADMIN thì hạ về role GỐC
   * (DEALER nếu có đơn đại lý đã duyệt, ngược lại CUSTOMER) — tránh xoá nhầm quyền đại lý khi
   * một đại lý từng được nâng tạm lên nhân viên.
   * Bọc trong $transaction: revoke grant + hạ role là 1 thao tác atomic — tránh trạng thái nửa
   * vời (grant đã revoke nhưng role chưa hạ) nếu lỗi giữa chừng.
   */
  async revokeGrant(adminId: string, phone: string) {
    const normalized = phone.trim();
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.roleGrant.updateMany({
        where: { phone: normalized, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const user = await tx.user.findUnique({ where: { phone: normalized } });
      // Cùng hai lối khoá tổ chức ra ngoài như AdminService.setUserRole: nút "Thu hồi" trong
      // app hiện ngay trên dòng của chính admin đang đăng nhập và không hỏi lại lần nào.
      if (user && user.id === adminId) {
        throw new BadRequestException('Không thể tự thu hồi quyền của chính mình — nhờ một quản trị viên khác thực hiện.');
      }
      if (user?.role === 'ADMIN') {
        const admins = await tx.user.count({ where: { role: 'ADMIN' } });
        if (admins <= 1) {
          throw new BadRequestException('Đây là quản trị viên cuối cùng — cấp quyền cho người khác trước khi thu hồi.');
        }
      }
      let downgraded = false;
      if (user && (user.role === 'STAFF' || user.role === 'ADMIN')) {
        const base = await this.resolveBaseRole(user.id, tx);
        await tx.user.update({ where: { id: user.id }, data: { role: base } });
        downgraded = true;
        this.logger.warn(`Admin ${adminId} thu hồi quyền SĐT ${normalized}: ${user.role} → ${base}`);
      }
      return { revoked: count, downgraded };
    });
  }

  /**
   * Thu hồi mọi RoleGrant (STAFF/ADMIN) xếp hạng CAO HƠN `role`. Dùng khi admin.setUserRole
   * hạ role của user trực tiếp qua User.role — trước đây KHÔNG gọi hàm này, nên hạ quyền qua
   * đường đó bị applyGrants (chỉ nâng không hạ, gọi ở mỗi lần refresh token) âm thầm phục hồi
   * ngay khi user đăng nhập lại, vì RoleGrant đang cấp vẫn còn hiệu lực (P0-3,
   * docs/2026-09-08-review-progress.md). So sánh dùng RANK — nếu không có grant nào xếp hạng
   * cao hơn (vd gán ADMIN), bỏ qua query, không tốn round-trip vô ích. Trả số grant đã thu hồi.
   */
  async revokeGrantsAbove(phone: string, role: UserRole): Promise<number> {
    const above = (Object.keys(RANK) as UserRole[]).filter(
      (r) => (r === 'STAFF' || r === 'ADMIN') && RANK[r] > RANK[role],
    );
    if (above.length === 0) return 0;
    const { count } = await this.prisma.roleGrant.updateMany({
      where: { phone, revokedAt: null, role: { in: above as ('STAFF' | 'ADMIN')[] } },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Role gốc khi bỏ quyền nhân viên: DEALER nếu có đơn đại lý đã duyệt, ngược lại CUSTOMER. */
  private async resolveBaseRole(userId: string, db: Db = this.prisma): Promise<'CUSTOMER' | 'DEALER'> {
    const dealerApp = await db.dealerApplication.findFirst({
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
