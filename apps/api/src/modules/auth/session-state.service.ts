import { Injectable } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SessionState {
  role: UserRole;
  isBlocked: boolean;
  /** Nhóm việc STAFF (CSKH, KHO) — bản ghi cũ/mock không có cột coi như rỗng. */
  staffPermissions?: string[];
}

/** Cờ suy ra từ role, dùng chung cho token mới cấp và request.user. */
export function roleClaims(role: UserRole) {
  return { affiliateEnabled: role === 'AFFILIATE' || role === 'ADMIN', dealerEnabled: role === 'DEALER' };
}

const MAX_ENTRIES = 10_000;

/**
 * Role và trạng thái khoá hiện tại của user, đọc từ DB cho mỗi request có JWT. Access token sống
 * JWT_ACCESS_TTL (15 phút) nên tin role trong token nghĩa là hạ quyền/khoá chỉ có hiệu lực sau 15 phút;
 * cache vài giây ở đây giới hạn độ trễ đó mà không thêm một truy vấn cho từng request. Cache theo tiến
 * trình: invalidate() chỉ xoá bản của tiến trình gọi, tiến trình khác tự hết hạn sau TTL_MS.
 */
@Injectable()
export class SessionStateService {
  static readonly TTL_MS = 5_000;
  private readonly cache = new Map<string, { expiresAt: number; state: SessionState | null }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<SessionState | null> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > now) return hit.state;
    const state = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBlocked: true, staffPermissions: true },
    });
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(userId, { expiresAt: now + SessionStateService.TTL_MS, state });
    return state;
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
