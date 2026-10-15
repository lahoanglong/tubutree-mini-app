import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { DEFAULT_TREE_TYPE } from './game.constants';

/**
 * Bảo đảm user có gameProfile. Mini App mở Vườn Xanh bắn song song nhiều endpoint game nên với user mới
 * nhiều request cùng thấy "chưa có" rồi cùng create: request thua nhận P2002 (409 "Dữ liệu trùng") ngay lần mở
 * đầu. Bắt P2002 rồi đọc lại hàng của request thắng thay vì để lỗi lan ra khách.
 */
export async function ensureGameProfile(
  prisma: Pick<PrismaService, 'gameProfile'>,
  config: Pick<SystemConfigService, 'get'>,
  userId: string,
) {
  const existing = await prisma.gameProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  const target = await config.get<number>('game.tree_default_target', 600);
  try {
    return await prisma.gameProfile.create({
      data: {
        userId,
        ecoImpact: { progress: 0, target, treeType: DEFAULT_TREE_TYPE, treesPlanted: 0 } as object,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.gameProfile.findUniqueOrThrow({ where: { userId } });
    }
    throw e;
  }
}
