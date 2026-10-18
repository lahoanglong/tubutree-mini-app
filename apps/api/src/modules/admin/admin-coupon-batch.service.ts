import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { actorLabel, assertCouponInput, SYSTEM_ACTOR, type CouponActor } from './coupon-input-rules';

/** Trần mã mỗi lô: một lần in thẻ; lô lớn hơn thì chia nhiều tiền tố. */
export const COUPON_BATCH_MAX = 2000;
/** Tiền tố = tên lô (vd SHOPEE10): chữ in hoa và số, để mã in ra gõ lại được. */
export const BATCH_PREFIX_RE = /^[A-Z0-9]{2,16}$/;
/** Bỏ 0/O/1/I: khách gõ tay mã in trên thẻ hay đọc nhầm. 32^8 ≈ 1,1 nghìn tỉ mã, throttle /coupons/claim chặn dò. */
export const CARD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CARD_CODE_LENGTH = 8;
const BATCH_LOCK = 'coupon-batch';
const MAX_FILL_ROUNDS = 5;
const MINIAPP_BASE_URL_KEY = 'app.miniapp_base_url';

export function cardCode(prefix: string): string {
  let tail = '';
  for (let i = 0; i < CARD_CODE_LENGTH; i++) tail += CARD_CODE_ALPHABET[randomInt(CARD_CODE_ALPHABET.length)];
  return `${prefix}-${tail}`;
}

/** Link in vào QR: mở Mini App với `?claim=` (miniapp/hooks/use-coupon-claim). Chưa có URL gốc thì đường dẫn tương đối. */
export function claimUrl(base: string, code: string): string {
  return `${base.trim().replace(/\/+$/, '')}/?claim=${encodeURIComponent(code)}`;
}

export interface CouponBatchInput {
  prefix: string;
  quantity: number;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  startAt: string;
  endAt: string;
  newCustomerOnly?: boolean;
}

export interface BatchCode {
  code: string;
  url: string;
  claimed: boolean;
  used: boolean;
  isActive: boolean;
}

export interface BatchSummary {
  batch: string;
  total: number;
  claimed: number;
  used: number;
  active: number;
  type: string;
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  newCustomerOnly: boolean;
  startAt: Date;
  endAt: Date;
}

/**
 * Lô mã in thẻ bỏ hộp hàng sàn (D2-03): N mã CLAIM duy nhất cùng cấu hình, mỗi mã một lượt nhận và một lượt dùng (thẻ nào
 * về tay khách nào thì của khách đó). Admin xuất CSV (mã, link nhận) để in QR, xem số đã nhận/đã dùng theo lô và tắt cả lô
 * khi thẻ bị lộ. Mã chung một mã cho cả đợt (vd theo sàn) tạo ở form voucher thường với phạm vi CLAIM.
 */
@Injectable()
export class AdminCouponBatchService {
  private readonly logger = new Logger(AdminCouponBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async create(input: CouponBatchInput, actor: CouponActor = SYSTEM_ACTOR) {
    const batch = input.prefix.trim().toUpperCase();
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    assertCouponInput({ ...input, startAt, endAt });
    const base = await this.claimUrlBase();

    const codes = await this.prisma.$transaction(
      async (tx) => {
        // Bấm "Tạo lô" hai lần cùng tiền tố: lần sau chờ ở đây rồi thấy lô đã có, không gộp thành lô gấp đôi.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BATCH_LOCK}), hashtext(${batch}))`;
        if ((await tx.coupon.count({ where: { batch } })) > 0) {
          throw new ConflictException(`Tiền tố ${batch} đã dùng cho một lô khác. Chọn tiền tố khác (vd thêm tháng: ${batch}11).`);
        }
        const row = (code: string): Prisma.CouponCreateManyInput => ({
          code,
          type: input.type,
          value: input.value,
          minOrder: input.minOrder,
          maxDiscount: input.maxDiscount,
          startAt,
          endAt,
          usageLimit: 1,
          perUserLimit: 1,
          scope: 'CLAIM',
          newCustomerOnly: input.newCustomerOnly ?? false,
          batch,
        });
        let created = 0;
        for (let round = 0; round < MAX_FILL_ROUNDS && created < input.quantity; round++) {
          const fresh = new Set<string>();
          while (fresh.size < input.quantity - created) fresh.add(cardCode(batch));
          // Mã ngẫu nhiên trùng mã đã có (rất hiếm) bị ON CONFLICT bỏ qua; vòng sau sinh bù đúng số thiếu.
          const inserted = await tx.coupon.createMany({ data: [...fresh].map(row), skipDuplicates: true });
          created += inserted.count;
        }
        if (created < input.quantity) throw new InternalServerErrorException('Không sinh đủ mã duy nhất cho lô. Vui lòng thử lại.');
        return tx.coupon.findMany({ where: { batch }, orderBy: { code: 'asc' }, select: { code: true } });
      },
      { timeout: 60_000 },
    );
    this.logger.warn(`${actorLabel(actor)} tạo lô mã ${batch} (${codes.length} mã): ${JSON.stringify(input)}`);
    return {
      batch,
      created: codes.length,
      claimUrlBase: base || null,
      codes: codes.map((c): BatchCode => ({ code: c.code, url: claimUrl(base, c.code), claimed: false, used: false, isActive: true })),
    };
  }

  /** Các lô gần nhất kèm số mã, số thẻ đã có khách nhận, số đã dùng cho đơn. */
  async list(): Promise<BatchSummary[]> {
    return this.prisma.$queryRaw<BatchSummary[]>`
      SELECT c.batch,
             COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM coupon_claims cc WHERE cc."couponId" = c.id))::int AS "claimed",
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM coupon_redemptions r WHERE r."couponId" = c.id))::int AS "used",
             COUNT(*) FILTER (WHERE c."isActive")::int AS "active",
             (array_agg(c.type::text))[1] AS "type",
             (array_agg(c.value))[1] AS "value",
             (array_agg(c."minOrder"))[1] AS "minOrder",
             (array_agg(c."maxDiscount"))[1] AS "maxDiscount",
             bool_or(c."newCustomerOnly") AS "newCustomerOnly",
             MIN(c."startAt") AS "startAt",
             MAX(c."endAt") AS "endAt"
        FROM coupons c
       WHERE c.batch IS NOT NULL
       GROUP BY c.batch
       ORDER BY MIN(c."startAt") DESC, c.batch
       LIMIT 200`;
  }

  async codes(rawBatch: string) {
    const batch = rawBatch.trim().toUpperCase();
    const [rows, base] = await Promise.all([
      this.prisma.coupon.findMany({
        where: { batch },
        orderBy: { code: 'asc' },
        select: { code: true, isActive: true, _count: { select: { claims: true, redemptions: true } } },
      }),
      this.claimUrlBase(),
    ]);
    if (rows.length === 0) throw new NotFoundException('Không tìm thấy lô mã.');
    return {
      batch,
      claimUrlBase: base || null,
      codes: rows.map(
        (r): BatchCode => ({
          code: r.code,
          url: claimUrl(base, r.code),
          claimed: r._count.claims > 0,
          used: r._count.redemptions > 0,
          isActive: r.isActive,
        }),
      ),
    };
  }

  /** Tắt cả lô khi thẻ bị lộ (hoặc bật lại). Lượt đã dùng giữ nguyên. */
  async setActive(rawBatch: string, isActive: boolean) {
    const batch = rawBatch.trim().toUpperCase();
    const res = await this.prisma.coupon.updateMany({ where: { batch }, data: { isActive } });
    if (res.count === 0) throw new NotFoundException('Không tìm thấy lô mã.');
    return { batch, updated: res.count };
  }

  async claimBase(): Promise<{ claimUrlBase: string | null }> {
    return { claimUrlBase: (await this.claimUrlBase()) || null };
  }

  private async claimUrlBase(): Promise<string> {
    const raw: unknown = await this.config.get<string>(MINIAPP_BASE_URL_KEY, '');
    return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  }
}
