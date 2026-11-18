import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MssHealthService } from '../mss-health.service';
import { MssSignedRoute } from '../mss-inbound.guard';
import { MssCatalogQueue } from './mss-catalog.queue';
import type { MssPushStats } from '../../mss-catalog-sync/catalog-sync.service';
import { MSS_CATALOG_STATE_ID, MSS_PUSH_STATE_ID, MssCatalogService, type MssCatalogRunStats } from './mss-catalog.service';

export const MSS_DOORBELL_KINDS = ['product', 'category', 'bundle', 'stock'] as const;
export type MssDoorbellKind = (typeof MSS_DOORBELL_KINDS)[number];
/** Hợp đồng mục 1.3: tối đa 200 mã mỗi lần gọi. */
export const MSS_DOORBELL_MAX_IDS_PER_CALL = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface MssDoorbell {
  kind: MssDoorbellKind;
  ids: string[];
}

/** Thân chuông (mục 1.3) đọc bằng tay: chỉ lấy loại và danh sách mã, khoá lạ bỏ qua, nội dung khác trong thân không được tin. */
export function parseDoorbell(body: unknown): MssDoorbell | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== 'string' || !(MSS_DOORBELL_KINDS as readonly string[]).includes(b.kind)) return null;
  if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > MSS_DOORBELL_MAX_IDS_PER_CALL) return null;
  if (!b.ids.every((id): id is string => typeof id === 'string' && ID_RE.test(id))) return null;
  if (b.at !== undefined && (typeof b.at !== 'string' || !Number.isFinite(Date.parse(b.at)))) return null;
  return { kind: b.kind as MssDoorbellKind, ids: [...new Set(b.ids as string[])] };
}

export interface MssDoorbellReply {
  ok: true;
  queued: number;
  /** `disabled`: cờ chưa có hiệu lực; `kind`: Tubu chưa dùng loại này (danh mục, combo, tồn khi nguồn vẫn là Pancake). */
  ignored?: 'disabled' | 'kind';
}

/**
 * Chuông "nội dung đã đổi" từ MSS (sau MssInboundGuard). Không đọc nội dung trong thân: chỉ xếp các mã vào lượt kéo lại bằng GET, gộp
 * mọi chuông trong 10 giây, trả 202 ngay. Cờ chưa có hiệu lực thì vẫn 202 (MSS khỏi gửi lại) và không làm gì.
 */
@Controller('integrations/mss')
@MssSignedRoute()
@SkipThrottle()
export class MssCatalogDoorbellController {
  constructor(
    private readonly catalog: MssCatalogService,
    private readonly queue: MssCatalogQueue,
  ) {}

  @Post('catalog-changed')
  @HttpCode(202)
  async changed(@Body() body: unknown): Promise<MssDoorbellReply> {
    const bell = parseDoorbell(body);
    if (!bell) throw new BadRequestException({ error: 'invalid_body', message: 'invalid_body' });
    if (bell.kind !== 'product') return { ok: true, queued: 0, ignored: 'kind' };
    if (!(await this.catalog.effective())) return { ok: true, queued: 0, ignored: 'disabled' };
    const queued = await this.queue.ring(bell.ids);
    return { ok: true, queued };
  }
}

export interface MssCatalogOpsCard {
  /** Giá trị admin đặt cho `mss.catalog_enrichment_enabled`. */
  enabled: boolean;
  /** Bật + đủ biến + MSS công bố `catalog.enrichment` (theo lần dò sức khoẻ gần nhất, không gọi MSS). */
  effective: boolean;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastFullAt: string | null;
  watermark: string | null;
  lastStatus: string | null;
  lastTrigger: string | null;
  lastError: string | null;
  lastStats: MssCatalogRunStats | null;
  /** Số sản phẩm theo trạng thái dòng bổ sung; chỉ `published` được ghép lên web và Mini App. */
  published: number;
  unpublished: number;
  removed: number;
  /** Mã chuông báo đang chờ lượt kéo; null khi không đọc được Redis. */
  pending: number | null;
  /** Cờ `mss.stock_sync_enabled`: nhận tồn Pancake MSS đẩy sang. */
  stockSync: { enabled: boolean; effective: boolean };
  /** Lần MSS đẩy gần nhất (`POST /api/integrations/mss/catalog-sync`); null khi MSS chưa đẩy lần nào. */
  push: { at: string | null; status: string | null; error: string | null; stats: MssPushStats | null } | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

@Injectable()
export class MssCatalogOpsService {
  private readonly logger = new Logger(MssCatalogOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: MssHealthService,
    private readonly catalog: MssCatalogService,
    private readonly queue: MssCatalogQueue,
  ) {}

  async card(): Promise<MssCatalogOpsCard> {
    const [ops, state, push, counts, pending] = await Promise.all([
      this.health.opsCard(),
      this.prisma.mssCatalogSyncState.findUnique({ where: { id: MSS_CATALOG_STATE_ID } }),
      this.prisma.mssCatalogSyncState.findUnique({ where: { id: MSS_PUSH_STATE_ID } }),
      this.prisma.productMssEnrichment.groupBy({ by: ['state'], _count: { _all: true } }),
      this.queue.pendingCount(),
    ]);
    const flag = ops.flags.find((f) => f.flag === 'catalogEnrichment');
    const stock = ops.flags.find((f) => f.flag === 'stockSync');
    const count = (s: string) => counts.find((c) => c.state === s)?._count._all ?? 0;
    return {
      enabled: flag?.enabled ?? false,
      effective: flag?.effective ?? false,
      lastRunAt: iso(state?.lastRunAt),
      lastFinishedAt: iso(state?.lastFinishedAt),
      lastFullAt: iso(state?.lastFullAt),
      watermark: iso(state?.watermark),
      lastStatus: state?.lastStatus ?? null,
      lastTrigger: state?.lastTrigger ?? null,
      lastError: state?.lastError ?? null,
      lastStats: (state?.lastStats as MssCatalogRunStats | null | undefined) ?? null,
      published: count('published'),
      unpublished: count('unpublished'),
      removed: count('removed'),
      pending,
      stockSync: { enabled: stock?.enabled ?? false, effective: stock?.effective ?? false },
      push: push
        ? {
            at: iso(push.lastFinishedAt ?? push.lastRunAt),
            status: push.lastStatus,
            error: push.lastError,
            stats: (push.lastStats as MssPushStats | null | undefined) ?? null,
          }
        : null,
    };
  }

  /** "Kéo lại ngay": xếp một lượt kéo toàn bộ. Cờ chưa có hiệu lực thì 409, không gọi MSS. */
  async pullNow(adminId: string): Promise<{ queued: true }> {
    if (!(await this.catalog.effective())) {
      throw new ConflictException('Cờ mss.catalog_enrichment_enabled chưa có hiệu lực (chưa bật, thiếu biến MSS hoặc MSS chưa công bố năng lực catalog.enrichment).');
    }
    await this.queue.enqueue('full', 'admin');
    this.logger.log(`Admin ${adminId} xếp lượt kéo toàn bộ nội dung MSS.`);
    return { queued: true };
  }
}

@Controller('admin/mss/catalog')
@Roles('ADMIN')
export class MssCatalogAdminController {
  constructor(private readonly ops: MssCatalogOpsService) {}

  /** Thẻ "Nội dung từ MSS" ở màn Sức khoẻ hệ thống. Không gọi MSS. */
  @Get()
  card() {
    return this.ops.card();
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('pull')
  @HttpCode(202)
  pull(@CurrentUser('sub') adminId: string) {
    return this.ops.pullNow(adminId);
  }
}
