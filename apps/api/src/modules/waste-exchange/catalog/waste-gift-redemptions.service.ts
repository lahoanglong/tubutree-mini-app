import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, WasteGiftRedemption } from '@prisma/client';
import type {
  AdminGiftRedemptionRowDTO,
  GiftRedemptionDTO,
  GiftRedemptionsQuery,
  WasteDeskGiftFulfilRequest,
  WasteGiftCancelRequest,
} from '@tubutree/shared-types';
import { assertActiveAdmin, assertActiveStaff } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { toGiftRedemptionDTO } from '../../loyalty/loyalty.service';
import { RewardPointsService } from '../../wallet/reward-points.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { wasteGiftOverdueWhere } from '../core/waste-queue-filters';
import { customerView } from '../core/waste-mask';
import { canonicalWasteLookup, lookupMissMeta } from '../waste-codes';

const CODE_NOT_FOUND = 'Không tìm thấy mã';
const ALREADY_HANDLED = 'Lượt đổi quà này đã được trao hoặc đã huỷ.';

@Injectable()
export class WasteGiftRedemptionsService {
  private readonly logger = new Logger(WasteGiftRedemptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
    private readonly rewards: RewardPointsService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async fulfilAtDesk(callerUserId: string, body: WasteDeskGiftFulfilRequest): Promise<GiftRedemptionDTO> {
    const cfg = await this.config.snapshot();
    const access = await this.access.assertPointAccess(callerUserId, body.pointId, { programmeEnabled: cfg.enabled });
    if (access.kind === 'PARTNER' && !access.giftHandoverEnabled) {
      throw new ForbiddenException('Điểm nhận này chưa được bật trao quà; khách nhận quà tại kho Tubu.');
    }
    const code = canonicalWasteLookup(body.code);
    const row = await this.prisma.wasteGiftRedemption.findUnique({ where: { code } });
    if (!row) {
      await writeWasteEvent(this.prisma, { kind: 'LOOKUP_MISS', actorUserId: callerUserId, actorRole: access.actorRole, pointId: body.pointId, meta: lookupMissMeta(body.code) });
      throw new NotFoundException(CODE_NOT_FOUND);
    }
    return this.markFulfilled({ code, status: 'READY' }, row, callerUserId, access.actorRole, body.pointId);
  }

  async fulfilById(callerUserId: string, id: string, body: { code: string }): Promise<GiftRedemptionDTO> {
    const staff = await this.access.assertWarehouseActor(callerUserId);
    const wh = await this.access.warehousePoint();
    if (!wh) throw new ConflictException('Chưa có kho Tubu đang hoạt động.');
    const row = await this.prisma.wasteGiftRedemption.findUnique({ where: { id } });
    if (!row || row.code !== canonicalWasteLookup(body.code)) {
      await writeWasteEvent(this.prisma, { kind: 'LOOKUP_MISS', actorUserId: callerUserId, actorRole: staff.role, pointId: wh.id, meta: lookupMissMeta(body.code) });
      throw new NotFoundException(CODE_NOT_FOUND);
    }
    return this.markFulfilled({ id, status: 'READY' }, row, callerUserId, staff.role, wh.id);
  }

  async cancel(adminUserId: string, id: string, body: WasteGiftCancelRequest): Promise<GiftRedemptionDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const row = await this.prisma.wasteGiftRedemption.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy lượt đổi quà.');
    if (row.status !== 'READY') throw new ConflictException('Chỉ huỷ được lượt đổi quà đang chờ nhận.');

    if (body.refundPoints === undefined) {
      const [flags, reversed] = await Promise.all([
        this.prisma.wasteUserFlags.findUnique({ where: { userId: row.userId }, select: { blockedAt: true } }),
        this.prisma.wasteRequest.count({ where: { userId: row.userId, status: 'REVERSED' } }),
      ]);
      if (flags?.blockedAt || reversed > 0) {
        throw new BadRequestException('Khách đang bị khoá hoặc từng bị thu hồi điểm đổi rác: hãy chọn rõ có hoàn điểm hay không.');
      }
    }
    const refund = body.refundPoints ?? true;
    const refundedPoints = refund ? row.pointsCost : 0;
    // grant() inside a transaction needs the expiry read beforehand: reading config under the held row lock would ask the pool for a second connection.
    const expiresAt = await this.rewards.expiresAt();

    const dto = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wasteGiftRedemption.updateMany({
        where: { id, status: 'READY' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: admin.id, cancelReason: body.reason, refundedPoints },
      });
      if (count !== 1) throw new ConflictException(ALREADY_HANDLED);
      if (refund) {
        const ok = await this.rewards.grant(row.userId, row.pointsCost, `GIFT_REFUND:${row.code}`, 'GIFT_REFUND', row.id, tx, expiresAt);
        if (!ok) {
          this.logger.error(`Không ghi được điểm hoàn GIFT_REFUND cho lượt đổi quà ${row.id} (user=${row.userId}, điểm=${row.pointsCost}): dòng sổ đã tồn tại.`);
          throw new InternalServerErrorException('Không ghi được điểm hoàn cho lượt đổi quà, thao tác đã huỷ.');
        }
      }
      await tx.$executeRaw`UPDATE "waste_gifts" SET "stock" = "stock" + 1 WHERE "id" = ${row.giftId} AND "stock" IS NOT NULL`;
      await writeWasteEvent(tx, {
        kind: 'GIFT_CANCELLED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        giftRedemptionId: row.id,
        meta: {
          giftId: row.giftId,
          subjectUserId: row.userId,
          reason: body.reason,
          before: { status: 'READY' },
          after: { status: 'CANCELLED', refundedPoints },
        },
      });
      return this.reload(tx, row.id);
    });

    await this.notifier.giftCancelled(row.userId, { id: row.id, giftName: row.giftName }, refundedPoints);
    return dto;
  }

  async queue(viewerUserId: string, q: GiftRedemptionsQuery): Promise<AdminGiftRedemptionRowDTO[]> {
    const viewer = await assertActiveStaff(this.prisma, viewerUserId);
    const isAdmin = viewer.role === 'ADMIN';
    const now = new Date();
    const where: Prisma.WasteGiftRedemptionWhereInput = q.overdue ? wasteGiftOverdueWhere(now) : { status: q.status ?? 'READY' };
    const rows = await this.prisma.wasteGiftRedemption.findMany({
      where,
      orderBy: [{ claimExpiresAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    return rows.map((row) => {
      const view = customerView(row.user, isAdmin, isAdmin);
      return {
        id: row.id,
        giftId: row.giftId,
        giftKind: row.giftKind,
        giftName: row.giftName,
        pointsCost: row.pointsCost,
        status: row.status,
        codeLast2: row.code ? row.code.slice(-2) : null,
        ...(isAdmin ? { code: row.code } : {}),
        customerName: view.name,
        customerPhone: view.phone,
        ...(isAdmin ? { userId: view.userId } : {}),
        claimExpiresAt: row.claimExpiresAt?.toISOString() ?? null,
        overdue: row.status === 'READY' && row.claimExpiresAt !== null && row.claimExpiresAt < now,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private markFulfilled(
    where: Prisma.WasteGiftRedemptionWhereInput,
    row: WasteGiftRedemption,
    callerUserId: string,
    actorRole: 'POINT_STAFF' | 'STAFF' | 'ADMIN',
    pointId: string,
  ): Promise<GiftRedemptionDTO> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wasteGiftRedemption.updateMany({
        where,
        data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledByUserId: callerUserId, fulfilledPointId: pointId },
      });
      if (count !== 1) throw new ConflictException(ALREADY_HANDLED);
      await writeWasteEvent(tx, {
        kind: 'GIFT_FULFILLED',
        actorUserId: callerUserId,
        actorRole,
        pointId,
        giftRedemptionId: row.id,
        meta: { giftId: row.giftId, subjectUserId: row.userId, before: { status: 'READY' }, after: { status: 'FULFILLED' } },
      });
      return this.reload(tx, row.id);
    });
  }

  private async reload(tx: Prisma.TransactionClient, id: string): Promise<GiftRedemptionDTO> {
    const r = await tx.wasteGiftRedemption.findUniqueOrThrow({ where: { id } });
    return toGiftRedemptionDTO(r, { claimPoint: null, couponCode: null });
  }
}
