import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { recordUserAdminEvent } from '../../../common/user-admin-events';
import { maskPhone } from '../../../common/mask-pii';
import { LAST_ADMIN_MESSAGE, assertAnotherActiveAdmin, lockAdminRoster } from '../../../common/admin-roster';
import { throwIfLockBusy } from '../../../common/lock-busy';
import { STAFF_PERMISSIONS, isStaffPermission, type StaffPermission } from '../../../common/staff-permissions';
import { MerchantFulfilmentService } from '../../merchant/merchant-fulfilment.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { activeGrantWhere } from './active-grant';
import { DEFAULT_GRANT_INVITE_TTL_DAYS, STAFF_GRANT_INVITE_TTL_DAYS_KEY, grantInviteTtlDays } from './grant-invite-config';
import { losesPartnerStore } from '../../merchant/partner-store';

const RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  AFFILIATE: 1,
  DEALER: 2,
  STAFF: 3,
  ADMIN: 4,
};

/** Nhóm việc theo thứ tự chuẩn của STAFF_PERMISSIONS, bỏ trùng; giá trị lạ ném 400 (DTO đã kiểm, đây là lớp phòng thủ cho nơi gọi khác). */
function normalizePermissions(raw: readonly string[]): StaffPermission[] {
  const unknown = raw.filter((p) => !isStaffPermission(p));
  if (unknown.length) throw new BadRequestException(`Nhóm việc không hợp lệ: ${unknown.join(', ')}.`);
  return STAFF_PERMISSIONS.filter((p) => raw.includes(p));
}

const samePermissions = (a: readonly string[], b: readonly string[]) => [...a].sort().join(',') === [...b].sort().join(',');

/** PrismaService hoặc client trong 1 $transaction — cho phép gộp nhiều bước vào 1 tx atomically. */
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly fulfilment?: MerchantFulfilmentService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** Hạn của lời mời mới (SĐT chưa có tài khoản): hiện tại + staff.grant_invite_ttl_days ngày. */
  private async inviteExpiry(): Promise<Date> {
    const raw = this.config ? await this.config.get<unknown>(STAFF_GRANT_INVITE_TTL_DAYS_KEY, DEFAULT_GRANT_INVITE_TTL_DAYS).catch(() => undefined) : undefined;
    return new Date(Date.now() + grantInviteTtlDays(raw ?? DEFAULT_GRANT_INVITE_TTL_DAYS) * 864e5);
  }

  /**
   * Áp grant theo SĐT khi login/refresh. CHỈ NÂNG role (không tự hạ — hạ qua revoke).
   * Trả user đã update (hoặc user gốc nếu không đổi).
   * Bước nâng khoá dòng users rồi đọc lại role và grant: bản `user` của người gọi có thể cũ, và admin hạ quyền cùng lúc
   * (setUserRole thu hồi grant trong tx của nó) thì grant vừa bị thu hồi không được dùng để nâng lại người đó.
   * Gọi với client gốc thì tự mở giao dịch; gọi với tx (addGrant) thì dùng luôn tx đó. Không có grant cao hơn thì không mở gì.
   */
  async applyGrants(user: User, db: Db = this.prisma, actorId: string | null = null, reason?: string): Promise<User> {
    if (!user.phone) return user;
    if (!('$transaction' in db)) return this.raiseFromGrants(user, db, actorId, reason);
    const peek = await db.roleGrant.findMany({
      where: { phone: user.phone, ...activeGrantWhere() },
      select: { role: true },
    });
    if (!this.highestGrant(peek, user.role)) return user;
    return db.$transaction((tx) => this.raiseFromGrants(user, tx, actorId, reason)).catch(throwIfLockBusy);
  }

  /** Role cao nhất trong grant (STAFF/ADMIN) nếu xếp hạng cao hơn `current`, ngược lại null. */
  private highestGrant(grants: { role: UserRole }[], current: UserRole): UserRole | null {
    const best = grants.reduce<UserRole>((acc, g) => (RANK[g.role] > RANK[acc] ? g.role : acc), 'CUSTOMER');
    return RANK[best] > RANK[current] ? best : null;
  }

  private async raiseFromGrants(stale: User, db: Prisma.TransactionClient, actorId: string | null, reason?: string): Promise<User> {
    // Thứ tự khoá ở mọi đường đổi quyền: lockAdminRoster, rồi role_grants, rồi users. Khoá grant của SĐT này trước (cùng thứ tự
    // với setUserRole/revokeGrant/addGrant) nên không có vòng chờ; sau khi giành được khoá, đọc lại role và grant cho đúng.
    await db.$queryRaw`SELECT "id" FROM "role_grants" WHERE "phone" = ${stale.phone} ORDER BY "id" FOR NO KEY UPDATE`;
    const [locked] = await db.$queryRaw<{ role: UserRole; staffPermissions: string[] }[]>`
      SELECT "role", "staffPermissions" FROM "users" WHERE "id" = ${stale.id} FOR NO KEY UPDATE`;
    const user: User = locked ? { ...stale, role: locked.role, staffPermissions: locked.staffPermissions } : stale;
    const now = new Date();
    const open = await db.roleGrant.findMany({
      where: { phone: user.phone!, revokedAt: null },
      select: { id: true, role: true, staffPermissions: true, expiresAt: true },
    });
    // Lời mời quá hạn là lời mời đã thu hồi: ghi lại để không ai (kể cả lần cấp sau) xoá hạn rồi dùng nó.
    const expiredIds = open.filter((g) => g.expiresAt && g.expiresAt <= now).map((g) => g.id);
    if (expiredIds.length) await db.roleGrant.updateMany({ where: { id: { in: expiredIds }, revokedAt: null }, data: { revokedAt: now } });
    const grants = open.filter((g) => !expiredIds.includes(g.id));
    if (grants.length === 0) return user;
    const best = this.highestGrant(grants, user.role);
    if (!best) return user; // không nâng / không hạ
    this.logger.warn(`applyGrants: nâng user ${user.id} (${maskPhone(user.phone!)}) ${user.role} → ${best}`);
    // Nhóm việc của lời mời chỉ có nghĩa với STAFF. Lời mời không ghi nhóm thì nhóm sau khi nâng lên STAFF là rỗng (không giữ nhóm cũ của user).
    const invitedPerms =
      best === 'STAFF' ? normalizePermissions(grants.filter((g) => g.role === 'STAFF').flatMap((g) => g.staffPermissions ?? [])) : [];
    // Từ vai trò khác lên STAFF thì nhóm luôn bị đặt lại theo lời mời (cùng luật setUserRole): nhóm sót lại từ vai trò cũ
    // không được sống lại thành quyền mà không ai gán. Người đã là STAFF không đi vào nhánh này (RANK không nâng).
    const resetPerms = best === 'STAFF';
    const oldPerms = user.staffPermissions ?? [];
    const updated = await db.user.update({
      where: { id: user.id },
      data: { role: best, ...(resetPerms ? { staffPermissions: invitedPerms } : {}) },
    });
    // Lời mời đã được áp thì hết là lời mời: bỏ hạn để về sau không có gì tự thu hồi quyền của người đã nhận.
    await db.roleGrant.updateMany({ where: { id: { in: grants.map((g) => g.id) }, expiresAt: { not: null } }, data: { expiresAt: null } });
    await recordUserAdminEvent(db, {
      userId: user.id,
      kind: 'ROLE',
      from: user.role,
      to: best,
      reason: reason ? `Cấp quyền theo SĐT: ${reason}` : 'Áp quyền cấp theo SĐT',
      actorId,
    });
    if (resetPerms && (invitedPerms.length || oldPerms.length)) {
      await recordUserAdminEvent(db, {
        userId: user.id,
        kind: 'STAFF_PERMISSIONS',
        from: oldPerms.join(','),
        to: invitedPerms.join(','),
        reason: invitedPerms.length ? 'Áp nhóm việc của lời mời' : 'Bỏ nhóm cũ khi nâng lên nhân viên',
        actorId,
      });
    }
    return updated;
  }

  /**
   * Admin thêm quyền theo SĐT. Không tạo grant trùng (cùng phone+role còn hiệu lực).
   * Bọc trong $transaction: tạo grant + áp role ngay là 1 thao tác atomic — tránh trạng thái
   * nửa vời (grant đã tạo nhưng role chưa nâng, hoặc ngược lại) nếu 1 bước lỗi giữa chừng.
   * `permissions` (chỉ với STAFF): nhóm việc của lời mời, chép sang user khi lời mời được áp và nâng user lên STAFF. Không truyền thì lời mời
   * không ghi nhóm, user được nâng lên STAFF với nhóm rỗng (nhóm cũ không sống lại); người đã là STAFF không đi qua bước nâng nên nhóm đang có giữ nguyên. Truyền lại cho lời mời đang chờ thì cập nhật nhóm của lời mời; người đã là STAFF mà admin chọn ít nhất
   * một nhóm thì nhóm cũ bị THAY bằng nhóm vừa chọn ngay (`permissionsChanged`), còn danh sách rỗng không xoá nhóm họ đang có.
   */
  async addGrant(adminId: string, phone: string, role: 'STAFF' | 'ADMIN', permissions?: readonly string[], reason?: string) {
    const normalized = phone.trim();
    const perms = role === 'STAFF' && permissions ? normalizePermissions(permissions) : [];
    return this.prisma.$transaction(async (tx) => {
      // Cùng luật với revokeGrant/setUserRole: không tự đổi quyền của chính mình. Thiếu chặn này, admin
      // vừa bị hạ quyền dùng access token cũ tự cấp lại ADMIN vĩnh viễn (ADMINOPS-1).
      const user = await tx.user.findUnique({ where: { phone: normalized } });
      if (user && user.id === adminId) {
        throw new BadRequestException('Không thể tự cấp quyền cho chính mình — nhờ một quản trị viên khác thực hiện.');
      }
      // Quyền quản trị là quyền toàn hệ thống: ai sau này đăng nhập bằng số này cũng thành ADMIN nếu lời mời còn treo, nên chỉ cấp cho người đã có tài khoản.
      if (!user && role === 'ADMIN') {
        throw new BadRequestException('Chỉ cấp quyền quản trị cho số điện thoại đã có tài khoản. Nhờ người đó đăng nhập Tubu Tree một lần trước.');
      }
      // Lời mời cũ đã quá hạn còn nằm trong chỉ mục duy nhất của grant đang mở: không thu hồi nó thì createMany bên dưới bị bỏ qua
      // và admin nhận "thành công" mà chẳng có gì được cấp.
      const nowAt = new Date();
      await tx.roleGrant.updateMany({
        where: { phone: normalized, role, revokedAt: null, expiresAt: { lte: nowAt } },
        data: { revokedAt: nowAt },
      });
      const existing = await tx.roleGrant.findFirst({
        where: { phone: normalized, role, ...activeGrantWhere() },
        select: { id: true, staffPermissions: true },
      });
      if (existing && role === 'STAFF' && permissions && !samePermissions(existing.staffPermissions ?? [], perms)) {
        await tx.roleGrant.update({ where: { id: existing.id }, data: { staffPermissions: perms } });
      }
      // Mời lại lời mời đang chờ (người chưa có tài khoản) là gia hạn một kỳ.
      if (existing && !user) await tx.roleGrant.update({ where: { id: existing.id }, data: { expiresAt: await this.inviteExpiry() } });
      if (!existing) {
        // findFirst rồi create trong $transaction READ COMMITTED không atomic: hai addGrant đồng thời cùng phone+role cùng qua
        // check "chưa có". ON CONFLICT DO NOTHING (skipDuplicates) trên partial unique index role_grants_active_phone_role_key
        // để bản thua là no-op; bắt P2002 trong tx sẽ làm Postgres huỷ tx (25P02) ở bước applyGrants ngay sau.
        const { count } = await tx.roleGrant.createMany({
          data: [{ phone: normalized, role, grantedBy: adminId, staffPermissions: perms, expiresAt: user ? null : await this.inviteExpiry() }],
          skipDuplicates: true,
        });
        if (count > 0) this.logger.warn(`Admin ${adminId} cấp grant ${role} cho SĐT ${maskPhone(normalized)}`);
      }
      // Áp ngay nếu user đã tồn tại
      let applied = false;
      let permissionsChanged = false;
      if (user) {
        // Bản đọc đầu tx có thể cũ: request thua createMany đã chờ bên thắng commit, nên role/nhóm của user có thể đã đổi.
        const fresh = (await tx.user.findUnique({ where: { id: user.id } })) ?? user;
        const updated = await this.applyGrants(fresh, tx, adminId, reason);
        applied = updated.role !== fresh.role;
        // applyGrants chỉ chép nhóm khi nâng vai trò; người đã là STAFF thì nhóm admin vừa chọn phải áp luôn kẻo bị bỏ qua âm thầm.
        if (!applied && updated.role === 'STAFF' && role === 'STAFF' && perms.length && !samePermissions(updated.staffPermissions ?? [], perms)) {
          await tx.user.update({ where: { id: user.id }, data: { staffPermissions: perms } });
          permissionsChanged = true;
          await recordUserAdminEvent(tx, {
            userId: user.id,
            kind: 'STAFF_PERMISSIONS',
            from: (updated.staffPermissions ?? []).join(','),
            to: perms.join(','),
            reason: reason ? `Chọn nhóm việc khi thêm nhân sự: ${reason}` : 'Admin chọn nhóm việc khi thêm nhân sự',
            actorId: adminId,
          });
        }
      }
      return { granted: role, applied, permissionsChanged };
    });
  }

  /**
   * Thu hồi mọi grant STAFF/ADMIN theo SĐT. Nếu user đang STAFF/ADMIN thì hạ về role GỐC
   * (DEALER nếu có đơn đại lý đã duyệt, ngược lại CUSTOMER) — tránh xoá nhầm quyền đại lý khi
   * một đại lý từng được nâng tạm lên nhân viên. Nếu vai trò gốc là CUSTOMER mà người này còn gian hàng đối tác vướng
   * mắc thì vẫn gỡ quyền và về CUSTOMER, gian hàng giữ nguyên và kết quả có `storeBlocked: true` (không bao giờ nâng quyền ở đây).
   * Bọc trong $transaction: revoke grant + hạ role là 1 thao tác atomic — tránh trạng thái nửa
   * vời (grant đã revoke nhưng role chưa hạ) nếu lỗi giữa chừng.
   */
  async revokeGrant(adminId: string, phone: string, reason?: string) {
    const normalized = phone.trim();
    // Đọc cấu hình đối soát trước khi mở tx (như AdminService.setUserRole): chỉ dùng khi người này rơi xuống CUSTOMER.
    const partnerCfg = await this.fulfilment?.settlementConfig();
    return this.prisma.$transaction(async (tx) => {
      await lockAdminRoster(tx);
      const { count } = await tx.roleGrant.updateMany({
        where: { phone: normalized, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Grant đã khoá ở lệnh trên; khoá tiếp dòng users (cùng thứ tự với applyGrants) rồi mới đọc role, để một lần applyGrants đang chạy
      // không nâng người này sau khi ta đã đọc role cũ.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "phone" = ${normalized} FOR NO KEY UPDATE`;
      const user = await tx.user.findUnique({ where: { phone: normalized } });
      // Cùng hai lối khoá tổ chức ra ngoài như AdminService.setUserRole: nút "Thu hồi" trong
      // app hiện ngay trên dòng của chính admin đang đăng nhập và không hỏi lại lần nào.
      if (user && user.id === adminId) {
        throw new BadRequestException('Không thể tự thu hồi quyền của chính mình — nhờ một quản trị viên khác thực hiện.');
      }
      if (user?.role === 'ADMIN') await assertAnotherActiveAdmin(tx, user.id, LAST_ADMIN_MESSAGE.revoke);
      let downgraded = false;
      let role: UserRole | null = null;
      let storeBlocked = false;
      if (user && (user.role === 'STAFF' || user.role === 'ADMIN')) {
        const base = await this.resolveBaseRole(user.id, tx);
        // Gian hàng khoá trước dòng users (cùng thứ tự với checkout). Việc gỡ quyền nhân viên không bao giờ bị gian hàng chặn và không
        // bao giờ nâng quyền: còn vướng mắc đối tác thì vai trò vẫn về đúng vai trò gốc, gian hàng giữ nguyên (storeBlocked), hết vướng
        // thì cờ tắt như bình thường.
        if (losesPartnerStore(user.role, base)) {
          if (!this.fulfilment || !partnerCfg) throw new Error('RbacService thiếu MerchantFulfilmentService để thu hồi cờ đối tác.');
          try {
            await this.fulfilment.clearPartnerOnRoleLoss(tx, user.id, adminId, partnerCfg, user.role);
          } catch (err) {
            if (!(err instanceof ConflictException)) throw err;
            storeBlocked = true;
            this.logger.warn(`Thu hồi quyền người dùng ${user.id} (${maskPhone(normalized)}): gian hàng đối tác còn vướng nên giữ nguyên gian hàng, vai trò về ${base}.`);
          }
        }
        role = base;
        // Gỡ quyền nhân viên không phải hạ CTV: dấu thu hồi chỉ do AdminService.setUserRole đặt hoặc xoá.
        await tx.user.update({
          where: { id: user.id },
          data: { role: base, ...(user.staffPermissions?.length ? { staffPermissions: [] } : {}) },
        });
        await recordUserAdminEvent(tx, { userId: user.id, kind: 'ROLE', from: user.role, to: base, reason: reason ? `Thu hồi quyền nhân viên: ${reason}` : 'Thu hồi quyền nhân viên', actorId: adminId });
        if (user.staffPermissions?.length) {
          await recordUserAdminEvent(tx, {
            userId: user.id,
            kind: 'STAFF_PERMISSIONS',
            from: user.staffPermissions.join(','),
            to: '',
            reason,
            actorId: adminId,
          });
        }
        downgraded = true;
        this.logger.warn(`Admin ${adminId} thu hồi quyền SĐT ${maskPhone(normalized)}: ${user.role} → ${base}${reason ? ` (lý do: ${reason})` : ''}`);
      }
      return { revoked: count, downgraded, role, ...(storeBlocked ? { storeBlocked } : {}) };
    }, { maxWait: 15_000, timeout: 60_000 }).catch(throwIfLockBusy);
  }

  /**
   * Thu hồi mọi RoleGrant (STAFF/ADMIN) xếp hạng CAO HƠN `role`. Dùng khi admin.setUserRole
   * hạ role của user trực tiếp qua User.role — trước đây KHÔNG gọi hàm này, nên hạ quyền qua
   * đường đó bị applyGrants (chỉ nâng không hạ, gọi ở mỗi lần refresh token) âm thầm phục hồi
   * ngay khi user đăng nhập lại, vì RoleGrant đang cấp vẫn còn hiệu lực (P0-3,
   * docs/2026-09-08-review-progress.md). So sánh dùng RANK — nếu không có grant nào xếp hạng
   * cao hơn (vd gán ADMIN), bỏ qua query, không tốn round-trip vô ích. Trả số grant đã thu hồi.
   */
  async revokeGrantsAbove(phone: string, role: UserRole, db: Db = this.prisma): Promise<number> {
    const above = (Object.keys(RANK) as UserRole[]).filter(
      (r) => (r === 'STAFF' || r === 'ADMIN') && RANK[r] > RANK[role],
    );
    if (above.length === 0) return 0;
    const { count } = await db.roleGrant.updateMany({
      where: { phone, revokedAt: null, role: { in: above as ('STAFF' | 'ADMIN')[] } },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * Role gốc khi bỏ quyền nhân viên: DEALER chỉ khi có đơn đại lý đã duyệt, ngược lại CUSTOMER. Đại lý cấp qua
   * AdminService.setUserRole (không có đơn) bỏ quyền nhân viên sẽ về CUSTOMER — metadata.dealerTierId không được tin vì không
   * bao giờ bị xoá khi hạ vai trò.
   */
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
      select: { id: true, phone: true, fullName: true, avatarUrl: true, role: true, staffPermissions: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const memberPhones = new Set(members.map((m) => m.phone).filter(Boolean) as string[]);
    const grants = await this.prisma.roleGrant.findMany({
      where: activeGrantWhere(),
      select: { phone: true, role: true, staffPermissions: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const pendingInvites = grants.filter((g) => !memberPhones.has(g.phone));
    return { members, pendingInvites };
  }
}
