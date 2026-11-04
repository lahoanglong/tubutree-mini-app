import type { Prisma } from '@prisma/client';

/**
 * Điều kiện của một role_grants còn hiệu lực: chưa thu hồi và chưa quá hạn. Lời mời quá hạn coi như đã thu hồi, nên MỌI chỗ
 * hỏi "SĐT này còn grant không" phải dùng điều kiện này, không tự viết `revokedAt: null` (bỏ sót hạn thì lời mời cũ sống lại).
 */
export function activeGrantWhere(now: Date = new Date()): Prisma.RoleGrantWhereInput {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

// config/go-live/collect.ts chạy riêng nên tự viết cùng điều kiện bằng SQL: sửa ở đây thì sửa cả bên đó.
