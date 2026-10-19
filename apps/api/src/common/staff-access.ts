import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export interface ActiveStaff {
  id: string;
  role: 'STAFF' | 'ADMIN';
  phone: string | null;
}

type StaffDb = Pick<PrismaService, 'user'> | Prisma.TransactionClient;

const STAFF_MESSAGE = 'Chỉ nhân viên hoặc quản trị viên mới làm được thao tác này.';
const ADMIN_MESSAGE = 'Chỉ quản trị viên mới làm được thao tác này.';

/** Đọc lại vai trò từ DB ở mỗi lần gọi: người vừa bị hạ quyền, khoá hoặc gộp tài khoản mất quyền ngay lượt sau. */
async function assertActive(db: StaffDb, userId: string, roles: readonly string[], message: string): Promise<ActiveStaff> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isBlocked: true, mergedIntoId: true, phone: true },
  });
  if (!user || !roles.includes(user.role) || user.isBlocked || user.mergedIntoId !== null) {
    throw new ForbiddenException(message);
  }
  return { id: user.id, role: user.role as 'STAFF' | 'ADMIN', phone: user.phone };
}

export function assertActiveStaff(db: StaffDb, userId: string, message?: string): Promise<ActiveStaff> {
  return assertActive(db, userId, ['STAFF', 'ADMIN'], message ?? STAFF_MESSAGE);
}

export function assertActiveAdmin(db: StaffDb, userId: string): Promise<ActiveStaff> {
  return assertActive(db, userId, ['ADMIN'], ADMIN_MESSAGE);
}
