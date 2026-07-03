# Nhân sự — Phase A: RBAC theo SĐT (allowlist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép admin cấp/thu hồi quyền STAFF/ADMIN **theo số điện thoại** (kể cả khi người đó chưa mở app), admin gán sẵn ban đầu qua seed; quyền tự áp khi user đăng nhập/refresh.

**Architecture:** Thêm bảng `RoleGrant` (allowlist phone→role). `RbacService.applyGrants(user)` chạy trong `AuthService.issueTokens` (login + refresh) → nâng role nếu grant cao hơn (không tự hạ). Admin quản lý qua controller mới trong module `staff`. UI hub admin trong Mini App (mục "Nhân sự").

**Tech Stack:** NestJS 10, Prisma 5 + PostgreSQL, class-validator, Jest (mock Prisma). FE: ZaUI + react-query + zustand. pnpm workspace.

## Global Constraints

- Auth bật mặc định qua global `JwtAuthGuard`; lấy user id bằng `@CurrentUser('sub') userId: string`; endpoint admin thêm `@Roles('ADMIN')`.
- RBAC chỉ quản STAFF/ADMIN qua `RoleGrant`; CTV/đại lý vẫn qua `DealerApplication` (không đụng).
- `applyGrants` **chỉ nâng** role (ADMIN>STAFF>DEALER>AFFILIATE>CUSTOMER), **không bao giờ tự hạ** (hạ chỉ khi admin `revoke`).
- Số điện thoại chuẩn hoá bằng `.trim()` (khớp cách `setUserRole` hiện có); phone lưu ở `User.phone` là chuỗi Zalo trả (đã là dạng dùng thống nhất trong DB).
- Đổi role có hiệu lực ở **lần refresh token kế** (JWT mang role) — chấp nhận theo spec.
- Copy tiếng Việt. Test theo pattern mock Prisma ở `admin.service.spec.ts`.
- Lệnh (chạy từ gốc repo):
  - test: `pnpm --filter @tubutree/api test -- <path>`
  - typecheck toàn repo: `pnpm -w turbo run typecheck` (hoặc `pnpm --filter @tubutree/api exec tsc -p tsconfig.json --noEmit`)
  - migrate dev: `pnpm --filter @tubutree/api exec prisma migrate dev --name staff_phase_a_rbac`
  - generate client: `pnpm --filter @tubutree/api prisma:generate`

---

## File Structure

- Create: `apps/api/src/modules/staff/rbac/rbac.service.ts` — applyGrants / addGrant / revokeGrant / listStaff.
- Create: `apps/api/src/modules/staff/rbac/rbac.service.spec.ts` — unit tests.
- Create: `apps/api/src/modules/staff/admin-staff.controller.ts` — endpoint admin RBAC.
- Create: `apps/api/src/modules/staff/dto/grant-role.dto.ts`, `dto/revoke-role.dto.ts`.
- Create: `apps/api/src/modules/staff/staff.module.ts` — cung cấp+export `RbacService`, khai báo controller.
- Modify: `apps/api/prisma/schema.prisma` — enum `RoleGrantRole` + model `RoleGrant`.
- Modify: `apps/api/src/modules/auth/auth.service.ts` — inject `RbacService`, gọi trong `issueTokens`.
- Modify: `apps/api/src/modules/auth/auth.module.ts` — import `StaffModule`.
- Modify: `apps/api/src/app.module.ts` — đăng ký `StaffModule`.
- Modify: `apps/api/prisma/seed.ts` — seed config `rbac.admin_phones` + seed `RoleGrant` admin idempotent.
- Create: `apps/miniapp/src/services/staff-api.ts` — gọi API admin RBAC.
- Create: `apps/miniapp/src/pages/admin.tsx` — hub admin (Phase A: mục "Nhân sự").
- Modify: `apps/miniapp/src/components/app.tsx` — route `/admin`.
- Modify: `apps/miniapp/src/pages/profile.tsx` — mục "Quản trị" (ADMIN) / "Nhân viên" (STAFF).

---

### Task 1: Schema — `RoleGrant` + enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (thêm sau `enum UserRole` khối ~19-25 và trước `model User`, hoặc cuối vùng "4.1 User & quyền")
- Create (tự sinh): `apps/api/prisma/migrations/<timestamp>_staff_phase_a_rbac/migration.sql`

- [ ] **Step 1: Thêm enum + model vào schema**

Trong `apps/api/prisma/schema.prisma`, thêm ngay dưới khối `enum UserRole { ... }` (kết thúc dòng ~25):

```prisma
enum RoleGrantRole {
  STAFF
  ADMIN
}

/// Cấp quyền theo SĐT — áp cả khi user CHƯA mở app. Khi login/refresh, auth áp grant
/// cao nhất còn hiệu lực nếu cao hơn role hiện tại. Chỉ quản STAFF/ADMIN (CTV/đại lý đi DealerApplication).
model RoleGrant {
  id        String        @id @default(cuid())
  phone     String
  role      RoleGrantRole
  grantedBy String // adminId, hoặc "seed" cho admin gán sẵn ban đầu
  note      String?
  revokedAt DateTime? // null = còn hiệu lực
  createdAt DateTime      @default(now())

  @@index([phone, revokedAt])
  @@map("role_grants")
}
```

- [ ] **Step 2: Tạo migration + generate client**

Run: `pnpm --filter @tubutree/api exec prisma migrate dev --name staff_phase_a_rbac`
Expected: migration mới tạo bảng `role_grants`, client regenerate không lỗi.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(staff): schema RoleGrant — allowlist phân quyền theo SĐT"
```

---

### Task 2: `RbacService.applyGrants` (nâng role khi login/refresh)

**Files:**
- Create: `apps/api/src/modules/staff/rbac/rbac.service.ts`
- Create: `apps/api/src/modules/staff/rbac/rbac.service.spec.ts`

**Interfaces:**
- Produces: `RbacService.applyGrants(user: User): Promise<User>` — trả user (đã update role nếu cần).
- Rank role dùng chung: `roleRank(role)` nội bộ.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/api/src/modules/staff/rbac/rbac.service.spec.ts`:

```typescript
import { RbacService } from './rbac.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { User } from '@prisma/client';

const mkUser = (over: Partial<User> = {}): User =>
  ({ id: 'u1', phone: '0900000001', role: 'CUSTOMER' } as User & typeof over);

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    roleGrant: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('RbacService.applyGrants', () => {
  it('không có phone → trả nguyên user, không query grant', async () => {
    const prisma = makePrisma();
    const svc = new RbacService(prisma);
    const user = mkUser({ phone: null });
    const out = await svc.applyGrants(user);
    expect(out).toBe(user);
    expect((prisma.roleGrant.findMany as jest.Mock)).not.toHaveBeenCalled();
  });

  it('không có grant → giữ nguyên role', async () => {
    const prisma = makePrisma();
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(out.role).toBe('CUSTOMER');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('grant STAFF cho khách → nâng lên STAFF', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: 'STAFF' } }),
    );
    expect(out.role).toBe('STAFF');
  });

  it('có cả STAFF và ADMIN → chọn ADMIN (cao nhất)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }, { role: 'ADMIN' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'ADMIN' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'ADMIN' } }));
    expect(out.role).toBe('ADMIN');
  });

  it('user đã ADMIN, grant STAFF → KHÔNG hạ (giữ ADMIN, không update)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser({ role: 'ADMIN' }));
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.role).toBe('ADMIN');
  });

  it('user đang DEALER, grant STAFF → nâng STAFF (STAFF > DEALER)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser({ role: 'DEALER' }));
    expect(out.role).toBe('STAFF');
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `pnpm --filter @tubutree/api test -- rbac.service.spec`
Expected: FAIL — `Cannot find module './rbac.service'`.

- [ ] **Step 3: Viết `RbacService` (chỉ applyGrants + helper)**

Tạo `apps/api/src/modules/staff/rbac/rbac.service.ts`:

```typescript
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
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `pnpm --filter @tubutree/api test -- rbac.service.spec`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff/rbac/rbac.service.ts apps/api/src/modules/staff/rbac/rbac.service.spec.ts
git commit -m "feat(staff): RbacService.applyGrants — nâng role theo grant, không tự hạ"
```

---

### Task 3: `RbacService` — addGrant / revokeGrant / listStaff

**Files:**
- Modify: `apps/api/src/modules/staff/rbac/rbac.service.ts`
- Modify: `apps/api/src/modules/staff/rbac/rbac.service.spec.ts`

**Interfaces:**
- `addGrant(adminId, phone, role: 'STAFF'|'ADMIN'): Promise<{ granted: RoleGrantRole; applied: boolean }>`
- `revokeGrant(adminId, phone): Promise<{ revoked: number; downgraded: boolean }>`
- `listStaff(): Promise<{ members: {...}[]; pendingInvites: {...}[] }>`

- [ ] **Step 1: Thêm test**

Thêm vào `rbac.service.spec.ts`:

```typescript
describe('RbacService.addGrant', () => {
  it('tạo grant + áp ngay nếu user đã tồn tại (role thấp hơn)', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'g1', role: 'STAFF' }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser()),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
      },
    });
    const out = await new RbacService(prisma).addGrant('admin1', ' 0900000001 ', 'STAFF');
    expect(prisma.roleGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '0900000001', role: 'STAFF', grantedBy: 'admin1' }) }),
    );
    expect(out.applied).toBe(true);
  });

  it('grant đã tồn tại (active, cùng role) → không tạo trùng', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'g1', role: 'STAFF' }),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(prisma.roleGrant.create).not.toHaveBeenCalled();
  });

  it('user chưa tồn tại → chỉ tạo grant, applied=false', async () => {
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'g1' }) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000002', 'STAFF');
    expect(out.applied).toBe(false);
  });
});

describe('RbacService.revokeGrant', () => {
  it('thu hồi grant + hạ user STAFF về CUSTOMER', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'CUSTOMER' })),
      },
    });
    const out = await new RbacService(prisma).revokeGrant('admin1', '0900000001');
    expect(prisma.roleGrant.updateMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'CUSTOMER' } }),
    );
    expect(out.downgraded).toBe(true);
  });

  it('user đang DEALER → thu hồi grant nhưng KHÔNG hạ (không phải STAFF/ADMIN)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'DEALER' })), update: jest.fn() },
    });
    const out = await new RbacService(prisma).revokeGrant('admin1', '0900000001');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.downgraded).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `pnpm --filter @tubutree/api test -- rbac.service.spec`
Expected: FAIL — `addGrant is not a function`.

- [ ] **Step 3: Bổ sung methods vào `RbacService`**

Thêm vào class `RbacService` (dưới `applyGrants`):

```typescript
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

  /** Thu hồi mọi grant STAFF/ADMIN theo SĐT + hạ user về CUSTOMER nếu đang STAFF/ADMIN. */
  async revokeGrant(adminId: string, phone: string) {
    const normalized = phone.trim();
    const { count } = await this.prisma.roleGrant.updateMany({
      where: { phone: normalized, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    let downgraded = false;
    if (user && (user.role === 'STAFF' || user.role === 'ADMIN')) {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: 'CUSTOMER' } });
      downgraded = true;
      this.logger.warn(`Admin ${adminId} thu hồi quyền SĐT ${normalized}: ${user.role} → CUSTOMER`);
    }
    return { revoked: count, downgraded };
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
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `pnpm --filter @tubutree/api test -- rbac.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff/rbac/rbac.service.ts apps/api/src/modules/staff/rbac/rbac.service.spec.ts
git commit -m "feat(staff): addGrant/revokeGrant/listStaff — quản lý nhân sự theo SĐT"
```

---

### Task 4: DTO + controller admin + module `staff`

**Files:**
- Create: `apps/api/src/modules/staff/dto/grant-role.dto.ts`
- Create: `apps/api/src/modules/staff/dto/revoke-role.dto.ts`
- Create: `apps/api/src/modules/staff/admin-staff.controller.ts`
- Create: `apps/api/src/modules/staff/staff.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTO**

Tạo `apps/api/src/modules/staff/dto/grant-role.dto.ts`:

```typescript
import { IsIn, IsString, Matches } from 'class-validator';

export class GrantRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  @IsIn(['STAFF', 'ADMIN'])
  role!: 'STAFF' | 'ADMIN';
}
```

Tạo `apps/api/src/modules/staff/dto/revoke-role.dto.ts`:

```typescript
import { IsString, Matches } from 'class-validator';

export class RevokeRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;
}
```

- [ ] **Step 2: Controller admin**

Tạo `apps/api/src/modules/staff/admin-staff.controller.ts`:

```typescript
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RbacService } from './rbac/rbac.service';
import { GrantRoleDto } from './dto/grant-role.dto';
import { RevokeRoleDto } from './dto/revoke-role.dto';

@ApiTags('admin-staff')
@Roles('ADMIN')
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  list() {
    return this.rbac.listStaff();
  }

  @Post('grant')
  grant(@CurrentUser('sub') adminId: string, @Body() dto: GrantRoleDto) {
    return this.rbac.addGrant(adminId, dto.phone, dto.role);
  }

  @Post('revoke')
  revoke(@CurrentUser('sub') adminId: string, @Body() dto: RevokeRoleDto) {
    return this.rbac.revokeGrant(adminId, dto.phone);
  }
}
```

- [ ] **Step 3: Module `staff`**

Tạo `apps/api/src/modules/staff/staff.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RbacService } from './rbac/rbac.service';
import { AdminStaffController } from './admin-staff.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminStaffController],
  providers: [RbacService],
  exports: [RbacService],
})
export class StaffModule {}
```

> Kiểm tra `apps/api/src/prisma/prisma.module.ts` tồn tại và export `PrismaService`. Nếu `PrismaModule` là `@Global()`, vẫn import an toàn (idempotent) hoặc bỏ `imports` nếu global — xác nhận theo module hiện có (VD `admin.module.ts`).

- [ ] **Step 4: Đăng ký `StaffModule` vào `app.module.ts`**

Trong `apps/api/src/app.module.ts`, thêm `StaffModule` vào mảng `imports` (cạnh `AdminModule`):

```typescript
import { StaffModule } from './modules/staff/staff.module';
// ... trong imports: [ ..., AdminModule, StaffModule, ... ]
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @tubutree/api exec tsc -p tsconfig.json --noEmit`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/staff apps/api/src/app.module.ts
git commit -m "feat(staff): module staff + controller admin RBAC (grant/revoke/list)"
```

---

### Task 5: Gắn `applyGrants` vào luồng auth (login + refresh)

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts` (nếu có — thêm mock RbacService)

- [ ] **Step 1: Import StaffModule vào AuthModule**

Trong `apps/api/src/modules/auth/auth.module.ts`, thêm `StaffModule` vào `imports`:

```typescript
import { StaffModule } from '../staff/staff.module';
// imports: [ ..., StaffModule ]
```

- [ ] **Step 2: Inject RbacService + gọi trong issueTokens**

Trong `apps/api/src/modules/auth/auth.service.ts`:

Thêm import: `import { RbacService } from '../staff/rbac/rbac.service';`

Thêm vào constructor (cuối danh sách tham số):

```typescript
    private readonly rbac: RbacService,
```

Sửa đầu `issueTokens` — áp grant trước khi tạo payload:

```typescript
  private async issueTokens(user: User): Promise<LoginResponse> {
    // Áp quyền theo SĐT (allowlist) — chạy cho cả login lẫn refresh ⇒ đổi role có hiệu lực
    // ở lần refresh kế. Không có phone / không có grant → trả nguyên user.
    user = await this.rbac.applyGrants(user);

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      zaloId: user.zaloId ?? undefined,
      affiliateEnabled: user.role === 'AFFILIATE' || user.role === 'ADMIN',
      dealerEnabled: user.role === 'DEALER',
    };
    // ... phần còn lại giữ nguyên
```

- [ ] **Step 3: Sửa test auth hiện có (nếu constructor đổi)**

Kiểm tra `apps/api/src/modules/auth/auth.service.spec.ts`. Nếu có, thêm mock `RbacService` vào chỗ khởi tạo `new AuthService(...)`:

```typescript
const rbac = { applyGrants: jest.fn(async (u) => u) } as unknown as import('../staff/rbac/rbac.service').RbacService;
// new AuthService(prisma, jwt, config, zalo, rbac)
```

Nếu file spec dùng helper factory, thêm `rbac` vào cuối. (Nếu không có auth.service.spec.ts, bỏ qua step này.)

- [ ] **Step 4: Chạy test auth + typecheck**

Run: `pnpm --filter @tubutree/api test -- auth.service.spec`
Expected: PASS (hoặc "No tests found" nếu không có — chấp nhận).

Run: `pnpm --filter @tubutree/api exec tsc -p tsconfig.json --noEmit`
Expected: không lỗi (không còn báo thiếu tham số constructor).

- [ ] **Step 5: Kiểm tra không lặp vòng phụ thuộc (AuthModule → StaffModule → PrismaModule; StaffModule KHÔNG import AuthModule)**

Run: `pnpm --filter @tubutree/api exec nest build` **hoặc** khởi động nhanh: `pnpm --filter @tubutree/api start` rồi Ctrl-C khi thấy "Nest application successfully started".
Expected: app boot không lỗi circular dependency.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(auth): áp RoleGrant theo SĐT trong issueTokens (login + refresh)"
```

---

### Task 6: Seed admin gán sẵn (config + RoleGrant idempotent)

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Bối cảnh:** prod KHÔNG chạy `prisma db seed`; admin thực nhập SĐT qua config/hub. Seed chỉ tạo config key rỗng + (dev) 1 grant placeholder. Idempotent.

- [ ] **Step 1: Thêm seed config + grant**

Trong `apps/api/prisma/seed.ts`, thêm (trong hàm seed chính, dùng `prisma.systemConfig.upsert` và `prisma.roleGrant`):

```typescript
  // ── RBAC nhân sự (Phase A) ──
  await prisma.systemConfig.upsert({
    where: { key: 'rbac.admin_phones' },
    update: {},
    create: {
      key: 'rbac.admin_phones',
      value: [] as unknown as object, // nhập SĐT admin thật qua hub/DB; giữ rỗng để không cấp nhầm
      description: 'Danh sách SĐT admin gán sẵn (tham chiếu; grant thực nằm ở role_grants)',
      category: 'rbac',
    },
  });

  // Grant admin gán sẵn — dev only. Đổi SĐT bên dưới thành SĐT admin thật khi seed dev.
  const seedAdminPhones = (process.env.SEED_ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const phone of seedAdminPhones) {
    const has = await prisma.roleGrant.findFirst({ where: { phone, role: 'ADMIN', revokedAt: null } });
    if (!has) {
      await prisma.roleGrant.create({ data: { phone, role: 'ADMIN', grantedBy: 'seed' } });
    }
  }
```

> Xác nhận tên field `SystemConfig`: dùng `key/value/description/category` (khớp migration bank config §2). `value` là `Json` → truyền mảng/obj trực tiếp.

- [ ] **Step 2: Chạy seed dev thử (tùy chọn, cần DB dev)**

Run: `SEED_ADMIN_PHONES=0900000000 pnpm --filter @tubutree/api prisma:seed`
Expected: chạy không lỗi; chạy lần 2 vẫn không tạo trùng (idempotent).

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(staff): seed config rbac.admin_phones + grant admin (idempotent, env SEED_ADMIN_PHONES)"
```

---

### Task 7: FE — service `staff-api.ts`

**Files:**
- Create: `apps/miniapp/src/services/staff-api.ts`

- [ ] **Step 1: Viết service**

Tạo `apps/miniapp/src/services/staff-api.ts`:

```typescript
import { api } from './api';

export type StaffRole = 'STAFF' | 'ADMIN';

export interface StaffMember {
  id: string;
  phone: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: StaffRole;
  createdAt: string;
}
export interface PendingInvite {
  phone: string;
  role: StaffRole;
  createdAt: string;
}
export interface StaffListResponse {
  members: StaffMember[];
  pendingInvites: PendingInvite[];
}

export const listStaff = () => api.get<StaffListResponse>('/admin/staff').then((r) => r.data);

export const grantStaff = (phone: string, role: StaffRole) =>
  api.post<{ granted: StaffRole; applied: boolean }>('/admin/staff/grant', { phone, role }).then((r) => r.data);

export const revokeStaff = (phone: string) =>
  api.post<{ revoked: number; downgraded: boolean }>('/admin/staff/revoke', { phone }).then((r) => r.data);
```

> Xác nhận `api` (axios instance) export ở `apps/miniapp/src/services/api.ts` (đã dùng ở `dealer-api.ts`).

- [ ] **Step 2: Typecheck FE**

Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 3: Commit**

```bash
git add apps/miniapp/src/services/staff-api.ts
git commit -m "feat(miniapp): staff-api — gọi API admin RBAC"
```

---

### Task 8: FE — hub admin `/admin` (mục Nhân sự) + route + entry profile

**Files:**
- Create: `apps/miniapp/src/pages/admin.tsx`
- Modify: `apps/miniapp/src/components/app.tsx` (thêm route + lazy import)
- Modify: `apps/miniapp/src/pages/profile.tsx` (mục điều hướng theo role)

- [ ] **Step 1: Trang admin (Phase A — Nhân sự)**

Tạo `apps/miniapp/src/pages/admin.tsx` (bám pattern gate-role của `dealer.tsx`: dùng `useAuthStore` để chặn non-admin, ZaUI, react-query, immersive back-button nếu chuẩn dự án):

```tsx
import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, ShieldCheck, Trash2 } from 'lucide-react';
import { listStaff, grantStaff, revokeStaff, type StaffRole } from '../services/staff-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';

export default function AdminPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') {
    return (
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text>Chỉ quản trị viên mới truy cập được trang này.</Text>
        </Box>
      </Page>
    );
  }
  return <AdminHub />;
}

function AdminHub() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const staffQ = useQuery({ queryKey: ['admin-staff'], queryFn: listStaff });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');

  const grantM = useMutation({
    mutationFn: () => grantStaff(phone.trim(), role),
    onSuccess: (r) => {
      openSnackbar({ text: r.applied ? 'Đã cấp quyền & áp ngay.' : 'Đã lưu quyền (sẽ áp khi họ mở app).', type: 'success' });
      setSheetOpen(false);
      setPhone('');
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const revokeM = useMutation({
    mutationFn: (p: string) => revokeStaff(p),
    onSuccess: () => {
      openSnackbar({ text: 'Đã thu hồi quyền.', type: 'success' });
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page">
      <Box p={4} flex flexDirection="column" style={{ gap: 16 }}>
        <Box flex justifyContent="space-between" alignItems="center">
          <Text.Title>Nhân sự</Text.Title>
          <Button size="small" prefixIcon={<UserPlus size={16} />} onClick={() => setSheetOpen(true)}>
            Thêm
          </Button>
        </Box>

        {staffQ.isLoading && <Skeleton style={{ height: 80, borderRadius: 12 }} />}
        {staffQ.isError && <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(staffQ.error)}</Text>}

        {staffQ.data && (
          <>
            {staffQ.data.members.map((m) => (
              <Box key={m.id} flex justifyContent="space-between" alignItems="center"
                   style={{ padding: 12, background: '#fff', borderRadius: 12 }}>
                <Box>
                  <Text bold>{m.fullName ?? 'Chưa có tên'}</Text>
                  <Text size="small" style={{ color: '#888' }}>
                    {m.phone ?? '—'} · {m.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                  </Text>
                </Box>
                {m.phone && (
                  <Button size="small" variant="tertiary" prefixIcon={<Trash2 size={16} />}
                          onClick={() => revokeM.mutate(m.phone!)}>Thu hồi</Button>
                )}
              </Box>
            ))}

            {staffQ.data.pendingInvites.length > 0 && (
              <>
                <Text bold style={{ marginTop: 8 }}>Chờ mở app</Text>
                {staffQ.data.pendingInvites.map((p) => (
                  <Box key={p.phone} flex justifyContent="space-between" alignItems="center"
                       style={{ padding: 12, background: '#f6f6f6', borderRadius: 12 }}>
                    <Text size="small">{p.phone} · {p.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}</Text>
                    <Button size="small" variant="tertiary" onClick={() => revokeM.mutate(p.phone)}>Huỷ</Button>
                  </Box>
                ))}
              </>
            )}
          </>
        )}
      </Box>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Thêm nhân sự theo SĐT</Text.Title>
          <Input type="number" placeholder="Số điện thoại (VD 09xxxxxxxx)" value={phone}
                 onChange={(e) => setPhone(e.target.value)} />
          <Box flex style={{ gap: 8 }}>
            <Button variant={role === 'STAFF' ? 'primary' : 'secondary'} onClick={() => setRole('STAFF')}
                    prefixIcon={<UserPlus size={16} />}>Nhân viên</Button>
            <Button variant={role === 'ADMIN' ? 'primary' : 'secondary'} onClick={() => setRole('ADMIN')}
                    prefixIcon={<ShieldCheck size={16} />}>Quản trị</Button>
          </Box>
          <Button fullWidth loading={grantM.isPending} disabled={!/^0\d{8,10}$/.test(phone.trim())}
                  onClick={() => grantM.mutate()}>Lưu quyền</Button>
        </Box>
      </Sheet>
    </Page>
  );
}
```

> Xác nhận: `getErrorMessage` export ở `services/api.ts`; `Skeleton` ở `components/ui/skeleton`; props ZaUI (`Button variant/prefixIcon`, `Sheet autoHeight`, `Input`) — đối chiếu cách dùng trong `dealer.tsx` và chỉnh cho khớp API ZaUI thực tế nếu khác. Nếu dự án có `back-button.tsx` immersive dùng ở các trang gate-role, thêm cho nhất quán.

- [ ] **Step 2: Route `/admin`**

Trong `apps/miniapp/src/components/app.tsx`:

Thêm lazy import cạnh các import trang khác:

```tsx
const AdminPage = lazy(() => import('../pages/admin'));
```

Thêm route trong `<AnimationRoutes>` (cạnh `/brand-owner`):

```tsx
                <Route path="/admin" element={<AdminPage />} />
```

> Đối chiếu cách các trang khác được import (nếu file dùng `React.lazy`/`lazy` — theo dòng `Suspense`/`RouteFallback` đã có ở app.tsx).

- [ ] **Step 3: Entry trong profile theo role**

Trong `apps/miniapp/src/pages/profile.tsx`, thêm mục điều hướng hiển thị theo `user.role` (dùng `useNavigate` + `useAuthStore` như các mục hiện có). Chèn cạnh các mục "Đại lý"/"CTV":

```tsx
{user?.role === 'ADMIN' && (
  <MenuRow icon={<ShieldCheck size={20} />} label="Quản trị" onClick={() => navigate('/admin')} />
)}
{(user?.role === 'STAFF' || user?.role === 'ADMIN') && (
  <MenuRow icon={<CalendarClock size={20} />} label="Nhân viên" onClick={() => navigate('/staff')} />
)}
```

> `MenuRow`/cấu trúc mục menu: dùng ĐÚNG component/markup mà `profile.tsx` đang dùng cho các mục khác (đọc file trước khi sửa; đây là minh hoạ vị trí + điều kiện role). Route `/staff` sẽ có ở Phase B — Phase A có thể tạm ẩn mục "Nhân viên" hoặc để trỏ `/admin`. Import icon từ `lucide-react`.

- [ ] **Step 4: Typecheck + build FE**

Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit`
Expected: không lỗi.

Run: `pnpm --filter @tubutree/miniapp build`
Expected: build thành công.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/admin.tsx apps/miniapp/src/components/app.tsx apps/miniapp/src/pages/profile.tsx
git commit -m "feat(miniapp): hub admin /admin (Nhân sự) + entry profile theo role"
```

---

### Task 9: Verify Phase A end-to-end

- [ ] **Step 1: Chạy toàn bộ test api**

Run: `pnpm --filter @tubutree/api test`
Expected: tất cả PASS (bao gồm rbac.service.spec).

- [ ] **Step 2: Typecheck toàn repo**

Run: `pnpm -w turbo run typecheck`
Expected: không lỗi.

- [ ] **Step 3: Kiểm thử thủ công (mô tả — chạy khi có DB dev)**

1. Seed `SEED_ADMIN_PHONES=<sđt test>`; đăng nhập app bằng SĐT đó → sau refresh role = ADMIN → thấy mục "Quản trị".
2. Vào /admin → Thêm SĐT một tài khoản khác làm STAFF → user đó refresh → role STAFF.
3. Thu hồi → user đó refresh → role về CUSTOMER.
4. Thêm SĐT chưa mở app → hiện ở "Chờ mở app"; khi họ mở app + chia sẻ SĐT → tự thành STAFF.

- [ ] **Step 4: Commit (nếu có chỉnh sửa nhỏ)**

```bash
git add -A && git commit -m "test(staff): verify Phase A RBAC"
```

---

## Self-Review (đã kiểm)

- **Spec coverage:** RBAC theo SĐT (§4.1), admin gán sẵn (seed), thêm nhân viên trước khi mở app (RoleGrant + applyGrants), thu hồi (revoke + hạ role), UI hub admin Nhân sự (§7.2), áp role ở refresh kế (§2, §10) — đều có task. CTV/đại lý giữ nguyên (không task, đúng chủ ý). Ca/chấm công/lương thuộc Phase B/C/D — ngoài phạm vi plan này.
- **Placeholder scan:** Không có TODO/TBD. Các ghi chú "> Xác nhận…" là chỉ dẫn đối chiếu component/prop thực tế, kèm code minh hoạ đầy đủ — không phải placeholder logic.
- **Type consistency:** `RoleGrantRole = STAFF|ADMIN`; `addGrant(role: 'STAFF'|'ADMIN')`; `applyGrants(user): Promise<User>`; FE `StaffRole = 'STAFF'|'ADMIN'` khớp API. `listStaff` trả `{members, pendingInvites}` khớp FE `StaffListResponse`.
- **Ambiguity:** phone chuẩn hoá `.trim()` nhất quán; regex `^0\d{8,10}$` dùng ở cả DTO lẫn FE.
