import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type WasteActorRole, type WasteRequestStatus } from '@prisma/client';
import type {
  WasteReceiveRequest,
  WasteReceiveResultDTO,
  WasteUnmatchedCandidateDTO,
  WasteUnmatchedCreateRequest,
  WasteUnmatchedDTO,
  WasteUnmatchedReason,
  WasteUnmatchedResolveRequest,
  WasteUnmatchedStatus,
  WasteUnmatchedSuggestion,
} from '@tubutree/shared-types';
import { assertActiveAdmin, assertActiveStaff, type ActiveStaff } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { writeWasteEvent } from '../core/waste-events';
import { customerView } from '../core/waste-mask';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WASTE_UNMATCHED_OPEN_WHERE } from '../core/waste-queue-filters';
import { normalizeTracking } from '../waste-codes';
import { WASTE_RECEIVE_REPLAY_MS } from '../waste.constants';
import { evaluateMatch } from './waste-match';

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Bạn thử lại nhé';
const DROP_OFF_NOT_VIA_WAREHOUSE = 'Yêu cầu mang tới điểm nhận không nhận qua kho';
const ORDER_NOT_DELIVERED = 'Đơn gắn kèm chưa giao xong, chưa nhận kiện được';
const UNMATCHED_NOT_OPEN = 'Dòng hàng không rõ chủ không còn mở';
const UNMATCHED_NOT_FOUND = 'Không tìm thấy dòng hàng không rõ chủ';
const REQUEST_EXPIRED_REOPEN = 'Yêu cầu đã hết hạn, admin dùng Mở lại kèm dòng này';
const REQUEST_NOT_RECEIVABLE = 'Yêu cầu không ở trạng thái nhận được';
const UNMATCHED_LIST_LIMIT = 200;
const SUGGESTION_STALE = 'Gợi ý không còn khớp với kiện này, hãy tra mã và khớp tay';
/** Mỗi kiện hiện tối đa ngần này gợi ý; kiện trùng mã vận đơn nhiều yêu cầu hơn thì tra tay. */
export const UNMATCHED_CANDIDATES_MAX = 3;
/**
 * Dòng yêu cầu đọc cho MỖI mã vận đơn và MỖI SĐT của trang kiện (theo đúng thứ tự xếp hạng của `rankCandidates`), thay cho một trần chung cả trang:
 * tồn đọng ở một khoá không đẩy mất gợi ý của khoá khác, và trang 200 kiện đọc tối đa 200 × (4 + 7) dòng. Theo mã vận đơn: 3 gợi ý + 1 dòng dư
 * (kiện có thể gắn đúng một yêu cầu cùng mã). Theo SĐT: mỗi kiện bỏ yêu cầu gắn kiện và tối đa 3 yêu cầu đã gợi ý theo mã vận đơn, nên 3 + 1 + 3.
 */
export const CANDIDATE_ROWS_PER_TRACKING = UNMATCHED_CANDIDATES_MAX + 1;
export const CANDIDATE_ROWS_PER_PHONE = 2 * UNMATCHED_CANDIDATES_MAX + 1;

/**
 * Yêu cầu còn chờ nhận được gợi ý: Đang mở/Đang gửi, gửi kho/lấy tận nhà/túi kèm đơn; túi kèm đơn chỉ khi đơn đã giao hoặc hoàn (cùng luật nút
 * khớp). Bảng `waste_requests` alias `r`, `orders` alias `o` (LEFT JOIN theo `r."orderId"`).
 */
const CANDIDATE_ELIGIBLE_SQL = Prisma.sql`r."status" IN ('OPEN', 'IN_TRANSIT') AND r."method" IN ('MAIL_IN', 'HOME_PICKUP', 'PICKUP')
  AND NOT (r."method" = 'PICKUP' AND (r."orderId" IS NULL OR o."status" IS NULL OR o."status" NOT IN ('DELIVERED', 'RETURNED')))`;
/** Cùng thứ tự với `rankCandidates`: Đang gửi trước Đang mở, cũ trước mới, rồi theo id. */
const CANDIDATE_ORDER_SQL = Prisma.sql`(r."status" = 'IN_TRANSIT') DESC, r."createdAt" ASC, r."id" COLLATE "C" ASC`;

type CandidateRow = {
  id: string;
  code: string;
  userId: string;
  method: WasteUnmatchedCandidateDTO['method'];
  status: WasteUnmatchedCandidateDTO['status'];
  carrier: string | null;
  trackingCode: string | null;
  trackingNorm: string | null;
  createdAt: Date;
  user: { id: string; fullName: string | null; phone: string | null };
};

/** Kiện không có gợi ý: TR- tranh chấp (admin tự quyết) và mã vận đơn khớp nhiều yêu cầu (nút Nhận kiện đã từ chối đúng vì không rõ của ai). */
const NO_SUGGESTION_REASONS: ReadonlySet<string> = new Set(['TR_TRACKING_CONFLICT', 'TRACKING_MULTI']);

/**
 * Mã vận đơn chỉ là bằng chứng khi nhân viên đọc nó trên kiện (kiện nhập tay, MANUAL_ENTRY). Kiện do nút Nhận kiện ghi lại mang mã chép từ chính
 * yêu cầu vừa quét: gợi ý theo mã đó sẽ trỏ ngược về yêu cầu vừa bị từ chối đối chiếu SĐT. Mã trỏ tới yêu cầu của hơn một khách cũng không gợi ý.
 */
function trackingSuggestionAllowed<T extends { reason: string; trackingNorm: string | null }>(parcel: T): parcel is T & { trackingNorm: string } {
  return parcel.reason === 'MANUAL_ENTRY' && parcel.trackingNorm !== null;
}

/**
 * Gợi ý xếp hạng cho một kiện: trùng mã vận đơn trước (mạnh nhất), rồi cùng SĐT khách với yêu cầu gắn kèm kiện; trong mỗi nhóm, Đang gửi trước
 * Đang mở, cũ trước mới. Bỏ trùng theo yêu cầu (trùng mã vận đơn thắng). Hàm thuần để spec kiểm thứ tự.
 */
export function rankCandidates(
  parcel: { reason: string; trackingNorm: string | null; relatedRequestId: string | null },
  relatedPhone: string | null,
  pool: readonly (CandidateRow & { phone: string | null })[],
  /** Mã vận đơn mà các yêu cầu còn chờ thuộc hơn một khách, xét trên mọi dòng (pool chỉ giữ vài dòng đầu mỗi mã). */
  sharedTracking: ReadonlySet<string> = new Set(),
): (CandidateRow & { basis: WasteUnmatchedSuggestion })[] {
  if (NO_SUGGESTION_REASONS.has(parcel.reason)) return [];
  const order = (a: CandidateRow, b: CandidateRow) =>
    (a.status === 'IN_TRANSIT' ? 0 : 1) - (b.status === 'IN_TRANSIT' ? 0 : 1) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sameTracking =
    trackingSuggestionAllowed(parcel) && !sharedTracking.has(parcel.trackingNorm)
      ? pool.filter((r) => r.trackingNorm === parcel.trackingNorm && r.id !== parcel.relatedRequestId)
      : [];
  const byTracking = new Set(sameTracking.map((r) => r.userId)).size === 1 ? [...sameTracking].sort(order) : [];
  const taken = new Set(byTracking.map((r) => r.id));
  const byPhone =
    relatedPhone === null
      ? []
      : pool.filter((r) => r.phone === relatedPhone && r.id !== parcel.relatedRequestId && !taken.has(r.id)).sort(order);
  return [...byTracking.map((r) => ({ ...r, basis: 'TRACKING' as const })), ...byPhone.map((r) => ({ ...r, basis: 'PHONE' as const }))].slice(
    0,
    UNMATCHED_CANDIDATES_MAX,
  );
}

interface UnmatchedRow {
  id: string;
  receivedAt: Date;
  createdByUserId: string;
  carrier: string | null;
  trackingCode: string | null;
  trackingNorm: string | null;
  description: string;
  reason: string;
  relatedRequestId: string | null;
  status: WasteUnmatchedStatus;
  matchedRequestId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  resolveNote: string | null;
}

function toUnmatchedDTO(r: UnmatchedRow): WasteUnmatchedDTO {
  return {
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    createdByUserId: r.createdByUserId,
    carrier: r.carrier,
    trackingCode: r.trackingCode,
    description: r.description,
    reason: r.reason as WasteUnmatchedReason,
    relatedRequestId: r.relatedRequestId,
    status: r.status,
    matchedRequestId: r.matchedRequestId,
    resolvedByUserId: r.resolvedByUserId,
    resolvedAt: r.resolvedAt === null ? null : r.resolvedAt.toISOString(),
    resolveNote: r.resolveNote,
  };
}

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
          // A differing tracking code is only logged, never blocks the tick; a request the customer gave no code has nothing to differ from.
          trackingMismatch: parcelNorm === null || req.trackingNorm === null ? null : parcelNorm !== req.trackingNorm,
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

  async createUnmatched(callerUserId: string, body: WasteUnmatchedCreateRequest): Promise<WasteUnmatchedDTO> {
    const caller = callerUserId;
    const staff = await this.access.assertWarehouseActor(caller);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.wasteUnmatchedParcel.create({
        data: {
          createdByUserId: caller,
          carrier: body.carrier ?? null,
          trackingCode: body.trackingCode ?? null,
          trackingNorm: body.trackingCode ? normalizeTracking(body.trackingCode) : null,
          description: body.description.trim(),
          reason: 'MANUAL_ENTRY',
        },
      });
      await writeWasteEvent(tx, {
        kind: 'UNMATCHED_RECORDED',
        actorUserId: caller,
        actorRole: staff.role,
        meta: { unmatchedId: row.id, before: null, after: { status: 'OPEN' } },
      });
      return toUnmatchedDTO(row);
    });
  }

  async listUnmatched(viewerUserId: string, q: { status?: WasteUnmatchedStatus }): Promise<WasteUnmatchedDTO[]> {
    const viewer = await assertActiveStaff(this.prisma, viewerUserId);
    const status = q.status ?? 'OPEN';
    const rows = await this.prisma.wasteUnmatchedParcel.findMany({
      where: status === 'OPEN' ? WASTE_UNMATCHED_OPEN_WHERE : { status },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: UNMATCHED_LIST_LIMIT,
    });
    if (status !== 'OPEN') return rows.map(toUnmatchedDTO);
    const candidates = await this.candidatesFor(rows, viewer.role === 'ADMIN');
    return rows.map((r) => ({ ...toUnmatchedDTO(r), candidates: candidates.get(r.id) ?? [] }));
  }

  /**
   * Gợi ý yêu cầu còn chờ nhận (Đang mở/Đang gửi) cho mỗi kiện đang mở: trùng chính xác mã vận đơn đã chuẩn hoá, hoặc cùng SĐT khách với yêu cầu
   * gắn kèm kiện. Kiện TR- tranh chấp (hai khách cùng nhận một kiện) không có gợi ý: chỉ admin quyết bằng tra tay. Mang tới điểm nhận không nhận qua
   * kho; túi kèm đơn chỉ khi đơn đã giao/hoàn (cùng luật nút khớp). SĐT và tên khách che như hàng đợi yêu cầu khi người xem không phải admin.
   */
  private async candidatesFor(parcels: readonly UnmatchedRow[], isAdmin: boolean): Promise<Map<string, WasteUnmatchedCandidateDTO[]>> {
    const out = new Map<string, WasteUnmatchedCandidateDTO[]>();
    const eligible = parcels.filter((p) => !NO_SUGGESTION_REASONS.has(p.reason));
    const norms = [...new Set(eligible.filter(trackingSuggestionAllowed).map((p) => p.trackingNorm))];
    const relatedIds = [...new Set(eligible.map((p) => p.relatedRequestId).filter((id): id is string => !!id))];
    const related = relatedIds.length
      ? await this.prisma.wasteRequest.findMany({ where: { id: { in: relatedIds } }, select: { id: true, user: { select: { phone: true } } } })
      : [];
    const phoneOf = new Map(related.map((r) => [r.id, r.user.phone]));
    const phones = [...new Set(related.map((r) => r.user.phone).filter((p): p is string => !!p))];
    if (norms.length === 0 && phones.length === 0) return out;
    // Vài dòng đầu của từng mã vận đơn và từng SĐT (window function), không phải N dòng cũ nhất của cả trang: chỉ mục trackingNorm và users.phone.
    const [byTracking, byPhone] = await Promise.all([
      norms.length
        ? this.prisma.$queryRaw<{ id: string; key: string; shared: boolean }[]>`
            SELECT t."id", t."key", t."shared" FROM (
              SELECT r."id", r."trackingNorm" AS "key",
                ROW_NUMBER() OVER (PARTITION BY r."trackingNorm" ORDER BY ${CANDIDATE_ORDER_SQL}) AS "rn",
                MIN(r."userId") OVER (PARTITION BY r."trackingNorm") <> MAX(r."userId") OVER (PARTITION BY r."trackingNorm") AS "shared"
              FROM "waste_requests" r LEFT JOIN "orders" o ON o."id" = r."orderId"
              WHERE r."trackingNorm" = ANY(${norms}) AND ${CANDIDATE_ELIGIBLE_SQL}
            ) t WHERE t."rn" <= ${CANDIDATE_ROWS_PER_TRACKING}`
        : Promise.resolve([]),
      phones.length
        ? this.prisma.$queryRaw<{ id: string }[]>`
            SELECT t."id" FROM (
              SELECT r."id", ROW_NUMBER() OVER (PARTITION BY u."phone" ORDER BY ${CANDIDATE_ORDER_SQL}) AS "rn"
              FROM "waste_requests" r JOIN "users" u ON u."id" = r."userId" LEFT JOIN "orders" o ON o."id" = r."orderId"
              WHERE u."phone" = ANY(${phones}) AND ${CANDIDATE_ELIGIBLE_SQL}
            ) t WHERE t."rn" <= ${CANDIDATE_ROWS_PER_PHONE}`
        : Promise.resolve([]),
    ]);
    const sharedTracking = new Set(byTracking.filter((r) => r.shared).map((r) => r.key));
    const ids = [...new Set([...byTracking, ...byPhone].map((r) => r.id))];
    if (ids.length === 0) return out;
    const found = await this.prisma.wasteRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        userId: true,
        method: true,
        status: true,
        carrier: true,
        trackingCode: true,
        trackingNorm: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, phone: true } },
      },
    });
    const pool = found.map((r) => ({ ...r, phone: r.user.phone }));
    for (const p of eligible) {
      const norm = p.trackingNorm;
      const ranked = rankCandidates(
        { reason: p.reason, trackingNorm: norm, relatedRequestId: p.relatedRequestId },
        p.relatedRequestId ? (phoneOf.get(p.relatedRequestId) ?? null) : null,
        pool,
        sharedTracking,
      );
      out.set(
        p.id,
        ranked.map((r) => {
          const v = customerView(r.user, isAdmin);
          return {
            requestId: r.id,
            code: r.code,
            method: r.method,
            status: r.status,
            basis: r.basis,
            customerName: v.name,
            customerPhone: v.phone,
            carrier: r.carrier,
            trackingCode: r.trackingCode,
            createdAt: r.createdAt.toISOString(),
          };
        }),
      );
    }
    return out;
  }

  async resolveUnmatched(callerUserId: string, id: string, body: WasteUnmatchedResolveRequest): Promise<WasteUnmatchedDTO> {
    const caller = callerUserId;
    if (body.action === 'CLOSE') return this.closeUnmatched(caller, id, body.note);
    return this.matchUnmatched(caller, id, body.requestId, body.note, body.suggestion);
  }

  private async closeUnmatched(caller: string, id: string, note: string): Promise<WasteUnmatchedDTO> {
    const staff = await this.access.assertWarehouseActor(caller);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.wasteUnmatchedParcel.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedByUserId: caller, resolvedAt: now, resolveNote: note },
      });
      if (res.count !== 1) throw new ConflictException(UNMATCHED_NOT_OPEN);
      await writeWasteEvent(tx, {
        kind: 'UNMATCHED_CLOSED',
        actorUserId: caller,
        actorRole: staff.role,
        meta: { unmatchedId: id, note, before: { status: 'OPEN' }, after: { status: 'RESOLVED' } },
      });
      return toUnmatchedDTO(await tx.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id } }));
    });
  }

  private async matchUnmatched(
    caller: string,
    id: string,
    requestId: string,
    note: string,
    suggestion?: WasteUnmatchedSuggestion,
  ): Promise<WasteUnmatchedDTO> {
    const parcel = await this.prisma.wasteUnmatchedParcel.findUnique({ where: { id }, select: { reason: true, trackingNorm: true, relatedRequestId: true } });
    if (!parcel) throw new NotFoundException(UNMATCHED_NOT_FOUND);
    // A tracking conflict means two customers claim one parcel: only an admin decides it.
    const staff: ActiveStaff =
      parcel.reason === 'TR_TRACKING_CONFLICT' ? await assertActiveAdmin(this.prisma, caller) : await this.access.assertWarehouseActor(caller);
    const now = new Date();

    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${requestId} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          code: true,
          userId: true,
          method: true,
          status: true,
          orderId: true,
          trackingNorm: true,
          order: { select: { status: true } },
          user: { select: { phone: true } },
        },
      });
      if (!req) throw new NotFoundException(NOT_FOUND);
      if (req.method === 'DROP_OFF') throw new ConflictException(DROP_OFF_NOT_VIA_WAREHOUSE);
      if (req.method === 'PICKUP' && (req.orderId === null || !req.order || !['DELIVERED', 'RETURNED'].includes(req.order.status))) {
        throw new ConflictException(ORDER_NOT_DELIVERED);
      }
      // Bấm "Khớp & nhận" trên một gợi ý: gợi ý phải còn đúng lúc khoá (mã vận đơn hay SĐT khách có thể đã đổi từ lúc tải danh sách).
      if (suggestion !== undefined && !(await this.suggestionHolds(tx, suggestion, parcel, req))) throw new ConflictException(SUGGESTION_STALE);
      if (req.status === 'EXPIRED') throw new ConflictException(REQUEST_EXPIRED_REOPEN);
      if (req.status !== 'OPEN' && req.status !== 'IN_TRANSIT') throw new ConflictException(REQUEST_NOT_RECEIVABLE);

      const before: WasteRequestStatus = req.status;
      const upd = await tx.wasteRequest.updateMany({
        where: {
          id: requestId,
          method: req.method,
          status: { in: ['OPEN', 'IN_TRANSIT'] },
          ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}),
        },
        data: { status: 'RECEIVED', receivedAt: now },
      });
      if (upd.count !== 1) throw new ConflictException(RETRY);
      // Throwing here rolls the request change back with it.
      const res = await tx.wasteUnmatchedParcel.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'RESOLVED', matchedRequestId: requestId, resolvedByUserId: caller, resolvedAt: now, resolveNote: note },
      });
      if (res.count !== 1) throw new ConflictException(UNMATCHED_NOT_OPEN);
      const ev = await writeWasteEvent(tx, {
        kind: 'UNMATCHED_RESOLVED',
        actorUserId: caller,
        actorRole: staff.role,
        requestId,
        meta: {
          unmatchedId: id,
          note,
          matchBasis: 'MANUAL',
          ...(suggestion ? { suggestion } : {}),
          subjectUserId: req.userId,
          before: { status: before },
          after: { status: 'RECEIVED' },
        },
      });
      const unmatched = toUnmatchedDTO(await tx.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id } }));
      return { eventId: ev.id, req, unmatched };
    });

    try {
      await this.notifier.parcelReceived(done.req.userId, { id: done.req.id, code: done.req.code }, done.eventId);
    } catch (e) {
      this.logger.warn(`parcelReceived notify failed for ${done.req.id}: ${String(e)}`);
    }
    return done.unmatched;
  }

  private async suggestionHolds(
    tx: Prisma.TransactionClient,
    suggestion: WasteUnmatchedSuggestion,
    parcel: { reason: string; trackingNorm: string | null; relatedRequestId: string | null },
    req: { id: string; userId: string; trackingNorm: string | null; user: { phone: string | null } },
  ): Promise<boolean> {
    if (NO_SUGGESTION_REASONS.has(parcel.reason)) return false;
    if (suggestion === 'TRACKING') {
      if (!trackingSuggestionAllowed(parcel) || req.id === parcel.relatedRequestId || req.trackingNorm !== parcel.trackingNorm) return false;
      const peers = await tx.wasteRequest.findMany({ where: { trackingNorm: parcel.trackingNorm, status: { in: ['OPEN', 'IN_TRANSIT'] } }, select: { userId: true } });
      return peers.every((p) => p.userId === req.userId);
    }
    if (parcel.relatedRequestId === null || parcel.relatedRequestId === req.id || req.user.phone === null) return false;
    const related = await tx.wasteRequest.findUnique({ where: { id: parcel.relatedRequestId }, select: { user: { select: { phone: true } } } });
    return related?.user.phone === req.user.phone;
  }
}
