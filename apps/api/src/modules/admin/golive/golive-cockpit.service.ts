import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as path from 'node:path';
import type { BackupSnapshot } from '../../../config/go-live/backup-checks';
import { collectBackupSnapshot, collectDbSnapshot, collectRedisSnapshot, listExpectedMigrations } from '../../../config/go-live/collect';
import type { DbSnapshot } from '../../../config/go-live/db-checks';
import type { RedisSnapshot } from '../../../config/go-live/redis-checks';
import { summarize, type Summary } from '../../../config/go-live/report';
import { runGoLiveCheck } from '../../../config/go-live/run';
import { describeError } from '../../../config/go-live/secrets';
import type { Env } from '../../../config/go-live/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { ingredientNames } from '../../catalog/ingredient-names';
import { RefillPairsService } from '../../catalog/refill/refill-pairs.service';
import { CATALOG_STATE_KEY } from '../../ops/ops-state';
import { readCompanyIdentity } from '../../system-config/company-config';
import { SystemConfigService } from '../../system-config/system-config.service';
import { buildCards, type CockpitCard } from './golive-cards';
import { cockpitMetrics, evaluateCockpitExtras, type CockpitExtrasSnapshot } from './golive-extras';
import { buildHandover, type HandoverBoard } from './golive-handover';
import { scrubSecrets, secretValues } from './golive-secret-scrub';

export interface GoLiveCockpit {
  generatedAt: string;
  /** Luôn `post-deploy`: bảng kiểm chạy trong API đang phục vụ, nên migration chưa áp là lỗi thật. */
  phase: 'post-deploy';
  summary: Summary;
  cards: CockpitCard[];
  /** Khoá và quyết định bên thứ 3 còn chờ bàn giao: chỉ tên biến và đã/chưa điền, không có giá trị. */
  handover: HandoverBoard;
}

/** Nhiều admin mở bảng cùng lúc (hoặc bấm tải lại liên tục) chỉ chạy bộ kiểm một lần trong khoảng này. */
export const COCKPIT_CACHE_MS = 15_000;

/**
 * `src/modules/admin/golive` → `apps/api/prisma/migrations`. Bản build (`dist/modules/admin/golive`) và mã nguồn (jest) cùng độ sâu, image chạy
 * ở `/app/apps/api` với cả thư mục prisma, nên cùng một đường tương đối.
 */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../prisma/migrations');

/**
 * Bảng kiểm Giờ G: chạy đúng bộ kiểm `go-live:check` (DB đọc trong transaction READ ONLY, Redis chỉ lệnh đọc, backup chỉ liệt kê) bằng kết nối
 * của API, cộng các dòng riêng (catalog, Refill, Pancake, pháp lý) rồi chia 6 thẻ. Không ghi gì, không gọi bên thứ ba, không trả giá trị bí mật.
 */
@Injectable()
export class GoLiveCockpitService {
  private readonly logger = new Logger(GoLiveCockpitService.name);
  private cache: { at: number; value: GoLiveCockpit } | null = null;
  private inflight: Promise<GoLiveCockpit> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly refill: RefillPairsService,
  ) {}

  async cockpit(opts: { fresh?: boolean } = {}, env: Env = process.env, now: () => Date = () => new Date()): Promise<GoLiveCockpit> {
    if (!opts.fresh && this.cache && now().getTime() - this.cache.at < COCKPIT_CACHE_MS) return this.cache.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.build(env, now()).finally(() => {
      this.inflight = null;
    });
    const value = await this.inflight;
    this.cache = { at: now().getTime(), value };
    return value;
  }

  private async build(env: Env, now: Date): Promise<GoLiveCockpit> {
    const snaps: { db: DbSnapshot | null; redis: RedisSnapshot | null; backup: BackupSnapshot | null } = { db: null, redis: null, backup: null };
    const results = await runGoLiveCheck(
      { env, phase: 'post-deploy' },
      {
        db: async () => (snaps.db = await collectDbSnapshot(this.prisma, await listExpectedMigrations(MIGRATIONS_DIR))),
        redis: async () => (snaps.redis = await collectRedisSnapshot(env.REDIS_URL ?? 'redis://localhost:6379', this.prisma)),
        backup: async () => (snaps.backup = await collectBackupSnapshot(env, now)),
      },
    );
    const extras = await this.extras(env);
    results.push(...evaluateCockpitExtras(extras, snaps.db, now));
    const value: GoLiveCockpit = {
      generatedAt: now.toISOString(),
      phase: 'post-deploy',
      summary: summarize(results),
      cards: buildCards(results, cockpitMetrics(extras, snaps, now)),
      handover: buildHandover(results, env),
    };
    return scrubSecrets(value, secretValues(env));
  }

  /** Số đếm cho các dòng riêng. Bảng cặp Refill lỗi thì dòng đó báo "không đọc được" thay vì làm hỏng cả bảng. */
  private async extras(env: Env): Promise<CockpitExtrasSnapshot> {
    const tubuActive = { storefrontId: null, isActive: true } satisfies Prisma.ProductWhereInput;
    const [products, activeVariations, unlinkedVariations, customStory, refill, catalogState, lastWebhook, lastPush, company] = await Promise.all([
      this.prisma.product.findMany({ where: tubuActive, select: { ingredients: true } }),
      this.prisma.variation.count({ where: { isActive: true, product: tubuActive } }),
      this.prisma.variation.count({ where: { isActive: true, pancakeId: null, product: tubuActive } }),
      this.prisma.product.count({ where: { ...tubuActive, NOT: { storyConfig: { equals: Prisma.DbNull } } } }),
      this.refillCounts(),
      this.prisma.opsHealthState.findUnique({ where: { key: CATALOG_STATE_KEY }, select: { lastOkAt: true, lastErrorAt: true } }),
      this.prisma.pancakeWebhookEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      this.prisma.order.findFirst({
        where: { pancakePushStatus: 'SYNCED', pancakeLastAttemptAt: { not: null } },
        orderBy: { pancakeLastAttemptAt: 'desc' },
        select: { pancakeLastAttemptAt: true },
      }),
      readCompanyIdentity(this.config),
    ]);
    return {
      catalog: {
        activeProducts: products.length,
        activeVariations,
        missingIngredients: products.filter((p) => ingredientNames(p.ingredients).length === 0).length,
        customStory,
        unlinkedVariations,
      },
      refill,
      pancake: {
        configured: Boolean(env.PANCAKE_API_KEY?.trim() && env.PANCAKE_SHOP_ID?.trim()),
        lastWebhookAt: lastWebhook?.receivedAt ?? null,
        lastPushOkAt: lastPush?.pancakeLastAttemptAt ?? null,
        catalogLastOkAt: catalogState?.lastOkAt ?? null,
        catalogLastErrorAt: catalogState?.lastErrorAt ?? null,
      },
      company: { hasRegistrationNumber: company.registrationNumber !== null, hasBctNoticeUrl: company.bctNoticeUrl !== null },
    };
  }

  private async refillCounts(): Promise<CockpitExtrasSnapshot['refill']> {
    try {
      const o = await this.refill.adminOverview();
      const n = (s: string) => o.rows.filter((r) => r.status === s).length;
      return { enabled: o.enabled, paired: n('auto') + n('manual'), near: n('near'), size: n('size'), ambiguous: n('ambiguous') };
    } catch (err) {
      this.logger.warn(`Bảng kiểm Giờ G: không đọc được bảng cặp Refill (${describeError(err)})`);
      return null;
    }
  }
}
