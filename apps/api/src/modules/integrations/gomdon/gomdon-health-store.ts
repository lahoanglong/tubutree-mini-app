import type { PrismaService } from '../../../prisma/prisma.service';
import type { GomdonHealthStore, GomdonLoginRecord } from './gomdon-health';

/** Dòng ops_health_states giữ trạng thái đăng nhập Gomdon chung: lastOkAt = đăng nhập được, lastErrorAt/lastError = bị từ chối. */
export const GOMDON_LOGIN_STATE_KEY = 'gomdon.login';

/**
 * Bản ghi chung trong DB cho GomdonHealth (R4-SYNC-4). Mỗi mốc chỉ tiến (GREATEST) ngay trong câu ghi: hai replica ghi song song,
 * hay một lần đăng nhập tốt cũ ghi muộn, không làm lùi mốc — "bị từ chối" luôn so đúng hai mốc mới nhất.
 */
export class PrismaGomdonHealthStore implements GomdonHealthStore {
  constructor(private readonly prisma: Pick<PrismaService, '$executeRaw' | 'opsHealthState'>) {}

  async load(): Promise<GomdonLoginRecord | null> {
    const row = await this.prisma.opsHealthState.findUnique({
      where: { key: GOMDON_LOGIN_STATE_KEY },
      select: { lastOkAt: true, lastErrorAt: true, lastError: true },
    });
    return row ? { okAt: row.lastOkAt, rejectedAt: row.lastErrorAt, rejectedMessage: row.lastError } : null;
  }

  async recordOk(at: Date): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "ops_health_states" ("key", "lastOkAt", "updatedAt")
      VALUES (${GOMDON_LOGIN_STATE_KEY}, ${at}, ${at})
      ON CONFLICT ("key") DO UPDATE
        SET "lastOkAt" = GREATEST("ops_health_states"."lastOkAt", EXCLUDED."lastOkAt"),
            "updatedAt" = GREATEST("ops_health_states"."updatedAt", EXCLUDED."updatedAt")`;
  }

  async recordRejected(at: Date, message: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "ops_health_states" ("key", "lastErrorAt", "lastError", "updatedAt")
      VALUES (${GOMDON_LOGIN_STATE_KEY}, ${at}, ${message}, ${at})
      ON CONFLICT ("key") DO UPDATE
        SET "lastError" = CASE
              WHEN "ops_health_states"."lastErrorAt" IS NULL OR EXCLUDED."lastErrorAt" >= "ops_health_states"."lastErrorAt"
                THEN EXCLUDED."lastError"
              ELSE "ops_health_states"."lastError"
            END,
            "lastErrorAt" = GREATEST("ops_health_states"."lastErrorAt", EXCLUDED."lastErrorAt"),
            "updatedAt" = GREATEST("ops_health_states"."updatedAt", EXCLUDED."updatedAt")`;
  }
}
