import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WasteCreateRequest, WasteEditRequest, WasteMethod, WasteRequestDetailDTO, WasteRequestSummaryDTO, WasteTrackingRequest } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteHoldService, type WasteHoldConfig } from '../core/waste-hold.service';
import { WASTE_MESSAGES } from '../core/waste-messages';
import { computeWastePublicFlags } from '../core/waste-public-config';
import { generateWasteCode, normalizeTracking } from '../waste-codes';
import { lockWasteCustomer, lockWasteTracking } from '../waste-locks';
import { WASTE_CONSENT_VERSION, WASTE_OPEN_STATUSES } from '../waste.constants';
import { toRequestDetail, toRequestSummary, WASTE_REQUEST_FULL_INCLUDE, WASTE_REQUEST_SUMMARY_INCLUDE, type WasteRequestFull } from './waste-request.mapper';

const CREATE_PRIOR_SELECT = { id: true, method: true, pointId: true, lines: { select: { itemId: true, declaredQty: true } } } as const;

@Injectable()
export class WasteRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly hold: WasteHoldService,
    private readonly config: WasteConfigService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  async list(userId: string): Promise<WasteRequestSummaryDTO[]> {
    const rows = await this.prisma.wasteRequest.findMany({
      where: { userId },
      include: WASTE_REQUEST_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toRequestSummary);
  }

  detail(userId: string, id: string): Promise<WasteRequestDetailDTO> {
    return this.loadDetail(this.prisma, userId, id);
  }

  byOrder(userId: string, orderId: string): Promise<WasteRequestDetailDTO> {
    return this.loadOwned(this.prisma, { orderId, userId });
  }

  async create(userId: string, idempotencyKey: string, body: WasteCreateRequest): Promise<WasteRequestDetailDTO> {
    const snap = await this.config.snapshot();
    const holdCfg: WasteHoldConfig = {
      laneDropoff: snap.laneDropoff,
      laneMailin: snap.laneMailin,
      lanePickup: snap.lanePickup,
      mailinMinPoints: snap.mailinMinPoints,
      pickupMinPoints: snap.pickupMinPoints,
      customerMonthlyCapPoints: snap.customerMonthlyCapPoints,
      maxOpenRequests: snap.maxOpenRequests,
      requestHoldDays: snap.requestHoldDays,
    };
    if (body.method === 'PICKUP') holdCfg.lanePickup = (await computeWastePublicFlags(this.systemConfig)).pickup;
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.prisma.$transaction((tx) => this.createInTx(tx, userId, idempotencyKey, body, holdCfg));
        return await this.loadDetail(this.prisma, userId, id);
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        const target = String((e as { meta?: { target?: unknown } })?.meta?.target ?? '');
        if (code === 'P2002' && target.includes('idempotencyKey')) {
          const prior = await this.prisma.wasteRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: CREATE_PRIOR_SELECT });
          if (!prior) throw e;
          if (!this.sameCreateContent(prior, body)) throw new ConflictException(WASTE_MESSAGES.IDEMPOTENCY_CONFLICT);
          return this.loadDetail(this.prisma, userId, prior.id);
        }
        if (code === 'P2002' && target.includes('code') && attempt === 0) continue;
        throw e;
      }
    }
  }

  async edit(userId: string, id: string, body: WasteEditRequest): Promise<WasteRequestDetailDTO> {
    const snap = await this.config.snapshot();
    const holdCfg: WasteHoldConfig = {
      laneDropoff: snap.laneDropoff,
      laneMailin: snap.laneMailin,
      lanePickup: snap.lanePickup,
      mailinMinPoints: snap.mailinMinPoints,
      pickupMinPoints: snap.pickupMinPoints,
      customerMonthlyCapPoints: snap.customerMonthlyCapPoints,
      maxOpenRequests: snap.maxOpenRequests,
      requestHoldDays: snap.requestHoldDays,
    };
    await this.prisma.$transaction((tx) => this.editInTx(tx, userId, id, body, holdCfg));
    return this.loadDetail(this.prisma, userId, id);
  }

  async setTracking(userId: string, id: string, body: WasteTrackingRequest): Promise<WasteRequestDetailDTO> {
    const carrier = body.carrier.trim();
    const trackingCode = body.trackingCode.trim();
    const norm = normalizeTracking(trackingCode);
    await this.prisma.$transaction(async (tx) => {
      await lockWasteTracking(tx);
      const rows = await tx.$queryRaw<
        { id: string; method: WasteMethod; status: string; carrier: string | null; trackingCode: string | null; trackingNorm: string | null }[]
      >`SELECT id, method::text AS method, status::text AS status, carrier, "trackingCode", "trackingNorm" FROM waste_requests WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
      if (row.method !== 'MAIL_IN') throw new ConflictException(WASTE_MESSAGES.NOT_MAIL_IN);
      if (row.status !== 'OPEN' && row.status !== 'IN_TRANSIT') throw new ConflictException(WASTE_MESSAGES.TRACKING_CLOSED);
      if (row.status === 'IN_TRANSIT' && row.carrier === carrier && row.trackingNorm === norm) return;
      const own = await tx.wasteRequest.findFirst({
        where: { userId, id: { not: id }, trackingNorm: norm, status: { in: [...WASTE_OPEN_STATUSES] } },
        select: { id: true },
      });
      if (own) throw new ConflictException(WASTE_MESSAGES.TRACKING_DUPLICATE_OWN);
      const first = row.status === 'OPEN';
      const updated = await tx.wasteRequest.updateMany({
        where: { id, userId, method: 'MAIL_IN', status: first ? 'OPEN' : 'IN_TRANSIT' },
        data: first
          ? { status: 'IN_TRANSIT', carrier, trackingCode, trackingNorm: norm, expiresAt: null, inTransitAt: new Date() }
          : { carrier, trackingCode, trackingNorm: norm },
      });
      if (updated.count !== 1) throw new ConflictException(WASTE_MESSAGES.TRACKING_CLOSED);
      await tx.$executeRaw`UPDATE waste_requests r SET "trackingConflict" = true, "updatedAt" = now()
        WHERE r."trackingNorm" = ${norm} AND r.status::text IN ('OPEN', 'IN_TRANSIT', 'RECEIVED') AND NOT r."trackingConflict"
          AND EXISTS (SELECT 1 FROM waste_requests o WHERE o."trackingNorm" = ${norm} AND o.status::text IN ('OPEN', 'IN_TRANSIT', 'RECEIVED') AND o."userId" <> r."userId")`;
      await writeWasteEvent(tx, {
        kind: first ? 'TRACKING_SET' : 'TRACKING_EDITED',
        actorUserId: userId,
        actorRole: 'CUSTOMER',
        requestId: id,
        meta: {
          before: { status: row.status, carrier: row.carrier, trackingCode: row.trackingCode },
          after: { status: 'IN_TRANSIT', carrier, trackingCode },
        },
      });
    });
    return this.loadDetail(this.prisma, userId, id);
  }

  async cancel(userId: string, id: string): Promise<WasteRequestDetailDTO> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; status: string; orderId: string | null; closeReason: string | null }[]
      >`SELECT id, status::text AS status, "orderId", "closeReason"::text AS "closeReason" FROM waste_requests WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
      if (row.status === 'CANCELLED' && row.closeReason === null && row.orderId === null) return;
      if (row.status !== 'OPEN' || row.orderId !== null) throw new ConflictException(WASTE_MESSAGES.NOT_CANCELLABLE);
      const updated = await tx.wasteRequest.updateMany({
        where: { id, userId, status: 'OPEN', orderId: null },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException(WASTE_MESSAGES.NOT_CANCELLABLE);
      await writeWasteEvent(tx, {
        kind: 'REQUEST_CANCELLED',
        actorUserId: userId,
        actorRole: 'CUSTOMER',
        requestId: id,
        meta: { before: { status: 'OPEN' }, after: { status: 'CANCELLED' } },
      });
    });
    return this.loadDetail(this.prisma, userId, id);
  }

  private async editInTx(tx: Prisma.TransactionClient, userId: string, id: string, body: WasteEditRequest, holdCfg: WasteHoldConfig): Promise<void> {
    await lockWasteCustomer(tx, userId);
    const now = new Date();
    const rows = await tx.$queryRaw<
      { id: string; method: WasteMethod; status: string; orderId: string | null; trackingCode: string | null; pointId: string; capDayKey: string; capMonthKey: string }[]
    >`SELECT id, method::text AS method, status::text AS status, "orderId", "trackingCode", "pointId", "capDayKey", "capMonthKey" FROM waste_requests WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
    if (row.status !== 'OPEN' || row.orderId !== null || row.trackingCode !== null) throw new ConflictException(WASTE_MESSAGES.NOT_EDITABLE);
    const result = await this.hold.validateAndHold(
      tx,
      {
        path: 'EDIT',
        userId,
        method: row.method,
        lines: body.lines,
        pointId: row.method === 'DROP_OFF' ? body.pointId ?? row.pointId : null,
        existing: { id, pointId: row.pointId, capDayKey: row.capDayKey, capMonthKey: row.capMonthKey },
        now,
      },
      holdCfg,
    );
    const beforeLines = await tx.wasteRequestLine.findMany({ where: { requestId: id }, select: { itemId: true, declaredQty: true }, orderBy: { id: 'asc' } });
    await tx.wasteRequestLine.deleteMany({ where: { requestId: id } });
    await tx.wasteRequestLine.createMany({
      data: result.lines.map((l) => ({
        requestId: id,
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        unitLabel: l.unitLabel,
        unitsPerPoint: l.unitsPerPoint,
        pointsPerGroup: l.pointsPerGroup,
        dropsPerUnit: l.dropsPerUnit,
        gramsPerUnit: l.gramsPerUnit,
        declaredQty: l.declaredQty,
      })),
    });
    const updated = await tx.wasteRequest.updateMany({
      where: { id, userId, status: 'OPEN', orderId: null, trackingCode: null },
      data: { pointId: result.pointId, estimatedPoints: result.estimatedPoints, estimatedDrops: result.estimatedDrops },
    });
    if (updated.count !== 1) throw new ConflictException(WASTE_MESSAGES.NOT_EDITABLE);
    await writeWasteEvent(tx, {
      kind: 'REQUEST_EDITED',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      requestId: id,
      pointId: result.pointId,
      meta: {
        before: { pointId: row.pointId, lines: beforeLines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })) },
        after: {
          pointId: result.pointId,
          lines: body.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })),
          estimatedPoints: result.estimatedPoints,
        },
      },
    });
  }

  private async createInTx(tx: Prisma.TransactionClient, userId: string, idempotencyKey: string, body: WasteCreateRequest, holdCfg: WasteHoldConfig): Promise<string> {
    await lockWasteCustomer(tx, userId);
    const now = new Date();
    const prior = await tx.wasteRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: CREATE_PRIOR_SELECT });
    if (prior) {
      if (!this.sameCreateContent(prior, body)) throw new ConflictException(WASTE_MESSAGES.IDEMPOTENCY_CONFLICT);
      return prior.id;
    }
    if (body.method === 'MAIL_IN' && !(body.packagingConsent === true && body.postagePaidConsent === true)) {
      throw new BadRequestException(WASTE_MESSAGES.MAILIN_CONSENT);
    }
    const result = await this.hold.validateAndHold(
      tx,
      { path: 'CREATE', userId, method: body.method, lines: body.lines, pointId: body.method === 'DROP_OFF' ? body.pointId ?? null : null, now },
      holdCfg,
    );
    let code: string | null = null;
    for (let i = 0; i < 5 && code === null; i++) {
      const candidate = generateWasteCode('TR');
      if (!(await tx.wasteRequest.findUnique({ where: { code: candidate }, select: { id: true } }))) code = candidate;
    }
    if (code === null) throw new ConflictException(WASTE_MESSAGES.RETRY);
    const created = await tx.wasteRequest.create({
      data: {
        code,
        userId,
        method: body.method,
        status: 'OPEN',
        pointId: result.pointId,
        estimatedPoints: result.estimatedPoints,
        estimatedDrops: result.estimatedDrops,
        capDayKey: result.capDayKey,
        capMonthKey: result.capMonthKey,
        expiresAt: result.expiresAt,
        idempotencyKey,
        consentAt: now,
        consentVersion: WASTE_CONSENT_VERSION,
        lines: {
          create: result.lines.map((l) => ({
            itemId: l.itemId,
            itemCode: l.itemCode,
            itemName: l.itemName,
            unitLabel: l.unitLabel,
            unitsPerPoint: l.unitsPerPoint,
            pointsPerGroup: l.pointsPerGroup,
            dropsPerUnit: l.dropsPerUnit,
            gramsPerUnit: l.gramsPerUnit,
            declaredQty: l.declaredQty,
          })),
        },
      },
      select: { id: true },
    });
    await writeWasteEvent(tx, {
      kind: 'REQUEST_CREATED',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      requestId: created.id,
      pointId: result.pointId,
      meta: {
        before: null,
        after: {
          method: body.method,
          pointId: result.pointId,
          estimatedPoints: result.estimatedPoints,
          lines: body.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })),
        },
      },
    });
    return created.id;
  }

  private sameCreateContent(
    prior: { method: WasteMethod; pointId: string; lines: { itemId: string; declaredQty: number }[] },
    body: WasteCreateRequest,
  ): boolean {
    if (prior.method !== body.method) return false;
    if (body.method === 'DROP_OFF' && prior.pointId !== body.pointId) return false;
    const key = (l: { itemId: string; declaredQty: number }) => `${l.itemId}:${l.declaredQty}`;
    const a = prior.lines.map(key).sort();
    const b = body.lines.map(key).sort();
    return a.length === b.length && a.every((k, i) => k === b[i]);
  }

  loadDetail(db: Prisma.TransactionClient, userId: string, id: string): Promise<WasteRequestDetailDTO> {
    return this.loadOwned(db, { id, userId });
  }

  private async loadOwned(db: Prisma.TransactionClient, where: Prisma.WasteRequestWhereInput): Promise<WasteRequestDetailDTO> {
    const row: WasteRequestFull | null = await db.wasteRequest.findFirst({ where, include: WASTE_REQUEST_FULL_INCLUDE });
    if (!row) throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
    const pointAvailable = (await this.access.availablePointIds(db, [row.pointId])).has(row.pointId);
    return toRequestDetail(row, pointAvailable);
  }
}
