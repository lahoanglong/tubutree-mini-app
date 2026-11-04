import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser, warmPool } from './helpers';

describe('Lời mời quyền theo SĐT hết hạn sau 7 ngày (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rbac: RbacService;
  let boss: { id: string };
  const BACKFILL_SQL = readFileSync(join(__dirname, '../../prisma/migrations/20261105100100_role_grant_expires_backfill/migration.sql'), 'utf8');
  const DAY = 864e5;
  const newPhone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    rbac = new RbacService(prisma, undefined, moduleRef.get(SystemConfigService));
    boss = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const grantOf = (phone: string) => prisma.roleGrant.findFirstOrThrow({ where: { phone, revokedAt: null } });

  it('mời ADMIN cho số chưa có tài khoản → 400 và không có dòng grant nào', async () => {
    const phone = newPhone();
    await expect(rbac.addGrant(boss.id, phone, 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.roleGrant.count({ where: { phone } })).toBe(0);
  });

  it('mời STAFF cho số chưa có tài khoản → hạn ~7 ngày; người đó đăng nhập (applyGrants) trong hạn thì lên STAFF và hạn được bỏ', async () => {
    const phone = newPhone();
    await rbac.addGrant(boss.id, phone, 'STAFF', ['KHO']);
    const g = await grantOf(phone);
    expect(g.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect(g.expiresAt!.getTime()).toBeLessThan(Date.now() + 7.1 * DAY);
    expect((await rbac.listStaff()).pendingInvites.map((p) => p.phone)).toContain(phone);
    const user = await createUser(prisma, { role: 'CUSTOMER', phone });
    const raised = await rbac.applyGrants(user);
    expect(raised.role).toBe('STAFF');
    expect((await grantOf(phone)).expiresAt).toBeNull();
  });

  it('lời mời quá hạn: người đăng nhập sau đó không được nâng, và không còn trong danh sách chờ', async () => {
    const phone = newPhone();
    await rbac.addGrant(boss.id, phone, 'STAFF');
    await prisma.roleGrant.updateMany({ where: { phone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await rbac.listStaff()).pendingInvites.map((p) => p.phone)).not.toContain(phone);
    const user = await createUser(prisma, { role: 'CUSTOMER', phone });
    const out = await rbac.applyGrants(user);
    expect(out.role).toBe('CUSTOMER');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('CUSTOMER');
  });

  it('mời lại lời mời quá hạn thì gia hạn và dùng được', async () => {
    const phone = newPhone();
    await rbac.addGrant(boss.id, phone, 'STAFF');
    await prisma.roleGrant.updateMany({ where: { phone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await rbac.addGrant(boss.id, phone, 'STAFF');
    expect((await grantOf(phone)).expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    const user = await createUser(prisma, { role: 'CUSTOMER', phone });
    expect((await rbac.applyGrants(user)).role).toBe('STAFF');
  });

  it('thu hồi lời mời đang chờ bằng revokeGrant', async () => {
    const phone = newPhone();
    await rbac.addGrant(boss.id, phone, 'STAFF');
    await rbac.revokeGrant(boss.id, phone);
    expect((await rbac.listStaff()).pendingInvites.map((p) => p.phone)).not.toContain(phone);
  });

  class Rollback extends Error {}
  it('migration backfill: lời mời chưa áp được 7 ngày, grant của người đã có tài khoản giữ nguyên, chạy lại không đổi', async () => {
    const pending = newPhone();
    const applied = newPhone();
    await prisma.roleGrant.create({ data: { phone: pending, role: 'STAFF', grantedBy: boss.id } });
    await createUser(prisma, { role: 'STAFF', phone: applied });
    await prisma.roleGrant.create({ data: { phone: applied, role: 'STAFF', grantedBy: boss.id } });
    let out: Record<string, Date | null> = {};
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(BACKFILL_SQL);
        const first = await tx.roleGrant.findMany({ where: { phone: { in: [pending, applied] } } });
        const firstAt = Object.fromEntries(first.map((g) => [g.phone, g.expiresAt]));
        await tx.$executeRawUnsafe(BACKFILL_SQL);
        const second = await tx.roleGrant.findMany({ where: { phone: { in: [pending, applied] } } });
        expect(Object.fromEntries(second.map((g) => [g.phone, g.expiresAt]))).toEqual(firstAt);
        out = firstAt;
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(out[pending]!.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect(out[applied]).toBeNull();
  });
});
