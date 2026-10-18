import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { WasteReopenRequest, WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService } from '../core/waste-hold.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { lockWasteCustomer } from '../waste-locks';
import { loadAdminRequestDetail } from './waste-admin-detail.mapper';

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Vui lòng thử lại';
const NOT_REOPENABLE = 'Chỉ mở lại được yêu cầu gửi kho hoặc thu kèm đơn đã hết hạn';
const UNMATCHED_NOT_OPEN = 'Dòng hàng không rõ chủ không còn mở';

@Injectable()
export class WasteAdminRequestsService {
  private readonly logger = new Logger(WasteAdminRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly access: WasteAccessService,
    private readonly hold: WasteHoldService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async reopen(adminUserId: string, id: string, body: WasteReopenRequest): Promise<WasteRequestAdminDetailDTO> {
    await assertActiveAdmin(this.prisma, adminUserId);
    const cfg = await this.config.snapshot();
    const now = new Date();
    const pre = await this.prisma.wasteRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!pre) throw new NotFoundException(NOT_FOUND);

    const done = await this.prisma.$transaction(async (tx) => {
      await lockWasteCustomer(tx, pre.userId);
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({ where: { id }, include: { lines: true } });
      if (!req) throw new NotFoundException(NOT_FOUND);
      // An account merge moved the request to another customer after the unlocked pre-read.
      if (req.userId !== pre.userId) throw new ConflictException(RETRY);
      if (req.status !== 'EXPIRED' || req.method === 'DROP_OFF' || (req.method === 'PICKUP' && req.orderId === null)) {
        throw new ConflictException(NOT_REOPENABLE);
      }

      await this.hold.validateAndHold(
        tx,
        {
          path: 'REOPEN',
          userId: req.userId,
          method: req.method,
          lines: req.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })),
          pointId: req.pointId,
          existing: { id, pointId: req.pointId, capDayKey: req.capDayKey, capMonthKey: req.capMonthKey },
          now,
        },
        cfg,
      );

      const res = await tx.wasteRequest.updateMany({
        where: { id, status: 'EXPIRED', ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}) },
        data: { status: 'RECEIVED', receivedAt: now, closedAt: null, closeReason: null },
      });
      if (res.count !== 1) throw new ConflictException(RETRY);

      if (body.unmatchedId) {
        const um = await tx.wasteUnmatchedParcel.updateMany({
          where: { id: body.unmatchedId, status: 'OPEN' },
          data: { status: 'RESOLVED', matchedRequestId: id, resolvedByUserId: adminUserId, resolvedAt: now, resolveNote: body.reason },
        });
        if (um.count !== 1) throw new ConflictException(UNMATCHED_NOT_OPEN);
      }

      const ev = await writeWasteEvent(tx, {
        kind: 'REQUEST_REOPENED',
        actorUserId: adminUserId,
        actorRole: 'ADMIN',
        requestId: id,
        pointId: req.pointId,
        meta: {
          reason: body.reason,
          unmatchedId: body.unmatchedId ?? null,
          subjectUserId: req.userId,
          before: { status: 'EXPIRED', closeReason: req.closeReason },
          after: { status: 'RECEIVED' },
        },
      });
      return { eventId: ev.id, userId: req.userId, code: req.code };
    });

    try {
      await this.notifier.parcelReceived(done.userId, { id, code: done.code }, done.eventId);
    } catch (e) {
      this.logger.warn(`parcelReceived notify failed for ${id}: ${String(e)}`);
    }
    return loadAdminRequestDetail(this.prisma, this.access, id, true);
  }
}
