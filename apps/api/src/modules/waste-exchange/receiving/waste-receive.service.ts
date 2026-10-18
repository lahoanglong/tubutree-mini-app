import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { WasteActorRole, WasteRequestStatus } from '@prisma/client';
import type { WasteReceiveRequest, WasteReceiveResultDTO, WasteUnmatchedReason } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { normalizeTracking } from '../waste-codes';
import { WASTE_RECEIVE_REPLAY_MS } from '../waste.constants';
import { evaluateMatch } from './waste-match';

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Vui lòng thử lại';
const DROP_OFF_NOT_VIA_WAREHOUSE = 'Yêu cầu mang tới điểm nhận không nhận qua kho';
const ORDER_NOT_DELIVERED = 'Đơn gắn kèm chưa giao xong, chưa nhận kiện được';

type ReceivedRequest = {
  id: string;
  code: string;
  userId: string;
  carrier: string | null;
  trackingCode: string | null;
  trackingNorm: string | null;
};
type TxResult =
  | { kind: 'ALREADY'; receivedAt: Date }
  | { kind: 'RECEIVED'; eventId: string; receivedAt: Date; req: ReceivedRequest }
  | { kind: 'UNMATCHED'; reason: WasteUnmatchedReason; parcelRequestId?: string; req: ReceivedRequest };

@Injectable()
export class WasteReceiveService {
  private readonly logger = new Logger(WasteReceiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async receive(callerUserId: string, requestId: string, body: WasteReceiveRequest): Promise<WasteReceiveResultDTO> {
    const caller = callerUserId;
    const id = requestId;
    // No waste.enabled check: the warehouse keeps receiving while the programme is off.
    const staff = await this.access.assertWarehouseActor(caller);
    const now = new Date();

    const done = await this.prisma.$transaction(async (tx): Promise<TxResult> => {
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          userId: true,
          method: true,
          status: true,
          pointId: true,
          orderId: true,
          trackingNorm: true,
          trackingCode: true,
          carrier: true,
          receivedAt: true,
          order: { select: { status: true } },
        },
      });
      if (!req) throw new NotFoundException(NOT_FOUND);
      await this.access.assertWarehouseActor(caller, tx);

      if (req.method === 'DROP_OFF') throw new ConflictException(DROP_OFF_NOT_VIA_WAREHOUSE);
      if (req.method === 'PICKUP' && (req.orderId === null || !req.order || !['DELIVERED', 'RETURNED'].includes(req.order.status))) {
        throw new ConflictException(ORDER_NOT_DELIVERED);
      }

      const m = await evaluateMatch(tx, req, body.match);
      const unmatched = (reason: WasteUnmatchedReason, parcelRequestId?: string): TxResult => ({
        kind: 'UNMATCHED',
        reason,
        ...(parcelRequestId === undefined ? {} : { parcelRequestId }),
        req,
      });
      if (!m.ok && m.reason === 'TR_TRACKING_CONFLICT') return unmatched('TR_TRACKING_CONFLICT', m.relatedRequestId);

      const status: WasteRequestStatus = req.status;
      if (status === 'RECEIVED') {
        const last = await tx.wasteEvent.findFirst({
          where: { requestId: id, kind: 'PARCEL_RECEIVED' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (
          last?.actorUserId === caller &&
          now.getTime() - last.createdAt.getTime() < WASTE_RECEIVE_REPLAY_MS &&
          m.ok &&
          (last.meta as { matchBasis?: string } | null)?.matchBasis === m.basis
        ) {
          return { kind: 'ALREADY', receivedAt: req.receivedAt ?? last.createdAt };
        }
        return unmatched('NOT_RECEIVABLE');
      }
      if (status === 'EXPIRED') return unmatched('EXPIRED_REQUEST');
      if (status !== 'OPEN' && status !== 'IN_TRANSIT') return unmatched('NOT_RECEIVABLE');

      if (!m.ok) return unmatched(m.reason, m.relatedRequestId);
      const res = await tx.wasteRequest.updateMany({
        where: {
          id,
          method: req.method,
          status: { in: ['OPEN', 'IN_TRANSIT'] },
          ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}),
        },
        data: {
          status: 'RECEIVED',
          receivedAt: now,
          ...(body.receivedWeightGrams !== undefined ? { receivedWeightGrams: body.receivedWeightGrams } : {}),
        },
      });
      if (res.count !== 1) throw new ConflictException(RETRY);
      const parcelNorm = body.match?.parcelTracking ? normalizeTracking(body.match.parcelTracking) : null;
      const ev = await writeWasteEvent(tx, {
        kind: 'PARCEL_RECEIVED',
        actorUserId: caller,
        actorRole: staff.role,
        requestId: id,
        pointId: req.pointId,
        meta: {
          matchBasis: m.basis,
          phoneMatchConfirmed: body.match?.phoneMatchConfirmed ?? false,
          parcelTrackingNorm: parcelNorm,
          // A differing tracking code is only logged, never blocks the tick.
          trackingMismatch: parcelNorm === null ? null : parcelNorm !== req.trackingNorm,
          subjectUserId: req.userId,
          before: { status },
          after: { status: 'RECEIVED' },
        },
      });
      return { kind: 'RECEIVED', eventId: ev.id, receivedAt: now, req };
    });

    if (done.kind === 'ALREADY') return { outcome: 'ALREADY_RECEIVED', receivedAt: done.receivedAt.toISOString() };
    if (done.kind === 'RECEIVED') {
      try {
        await this.notifier.parcelReceived(done.req.userId, { id: done.req.id, code: done.req.code }, done.eventId);
      } catch (e) {
        this.logger.warn(`parcelReceived notify failed for ${done.req.id}: ${String(e)}`);
      }
      return { outcome: 'RECEIVED', requestId: id, receivedAt: done.receivedAt.toISOString() };
    }
    return this.writeUnmatched(caller, staff.role, done.req, done.reason, now, done.parcelRequestId);
  }

  /** Runs in its own transaction, opened only after the receive transaction resolved. */
  private async writeUnmatched(
    caller: string,
    actorRole: WasteActorRole,
    req: ReceivedRequest,
    reason: WasteUnmatchedReason,
    now: Date,
    parcelRequestId?: string,
  ): Promise<WasteReceiveResultDTO> {
    return this.prisma.$transaction(async (tx): Promise<WasteReceiveResultDTO> => {
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${req.id} FOR UPDATE`;
      const prev = await tx.wasteEvent.findFirst({
        where: {
          requestId: req.id,
          kind: 'PARCEL_UNMATCHED',
          actorUserId: caller,
          createdAt: { gt: new Date(now.getTime() - WASTE_RECEIVE_REPLAY_MS) },
        },
        orderBy: { createdAt: 'desc' },
      });
      const prevId = (prev?.meta as { unmatchedId?: string } | null)?.unmatchedId;
      if (prevId) {
        const earlier = await tx.wasteUnmatchedParcel.findUnique({ where: { id: prevId }, select: { id: true, status: true, reason: true } });
        if (earlier && earlier.status === 'OPEN') {
          return { outcome: 'UNMATCHED', unmatchedId: earlier.id, reason: earlier.reason as WasteUnmatchedReason };
        }
      }
      const row = await tx.wasteUnmatchedParcel.create({
        data: {
          createdByUserId: caller,
          carrier: req.carrier,
          trackingCode: req.trackingCode,
          trackingNorm: req.trackingNorm,
          description: `Kiện của yêu cầu ${req.code}`,
          reason,
          relatedRequestId: req.id,
        },
      });
      await writeWasteEvent(tx, {
        kind: 'PARCEL_UNMATCHED',
        actorUserId: caller,
        actorRole,
        requestId: req.id,
        meta: {
          unmatchedId: row.id,
          reason,
          parcelRequestId: parcelRequestId ?? null,
          subjectUserId: req.userId,
          before: null,
          after: { unmatchedId: row.id },
        },
      });
      return { outcome: 'UNMATCHED', unmatchedId: row.id, reason };
    });
  }
}
