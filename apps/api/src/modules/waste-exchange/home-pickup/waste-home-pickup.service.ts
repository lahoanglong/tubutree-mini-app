import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, WasteActorRole, WasteCloseReason, WasteRequestStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { enqueueGomdonWasteCancel } from '../../integrations/gomdon/gomdon-queue';
import { gomdonRank, isGomdonTerminal } from '../../integrations/gomdon/gomdon-status';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WasteShipLockService } from '../core/waste-ship-lock.service';
import { normalizeTracking } from '../waste-codes';
import { closeHomePickupRequest } from './waste-home-pickup-ledger';

export const HOME_PICKUP_CARRIER = 'BestExpress';

/** Gomdon mã 3 = bưu tá đã lấy rác. Từ bậc này trở đi phiếu không còn huỷ/hoàn điểm tự động được. */
const PICKED_UP_RANK = gomdonRank('3');

const GOMDON_STATUS_NAME: Record<number, string> = {
  1: 'tạo đơn thành công',
  2: 'đơn huỷ',
  3: 'đã lấy hàng',
  4: 'đang vận chuyển đến bưu cục nhận',
  5: 'đang đi giao hàng',
  6: 'đang chuyển hoàn',
  7: 'giao thành công',
  8: 'đã hoàn hàng',
  9: 'đơn hỏng, mất hàng',
  10: 'lấy hàng không thành công',
  11: 'giao hàng thất bại',
  12: 'hoàn hàng thất bại',
};

const CLOSED_BY_CARRIER_TEXT = 'đơn vị vận chuyển đã huỷ vận đơn nên Tubu đã đóng yêu cầu. Điểm Xanh dùng để trả phí shipper (nếu có) đã được hoàn lại';
const PUSH_REJECTED_TEXT =
  'Tubu chưa đặt được shipper tới lấy rác (đơn vị vận chuyển không nhận đơn) nên đã huỷ yêu cầu. Điểm Xanh dùng để trả phí shipper (nếu có) đã được hoàn lại';

export interface HomePickupRow {
  id: string;
  code: string;
  userId: string;
  pointId: string;
  status: WasteRequestStatus;
  gomdonOrderId: string | null;
  gomdonPartnerCode: string | null;
  gomdonStatus: string | null;
  gomdonStatusAt: Date | null;
  shipFeePointsUsed: number | null;
  shipFeeCashVnd?: number | null;
  shipFeeCashPaidAt?: Date | null;
  shippingHistory: unknown;
}

export const HOME_PICKUP_ROW_SELECT = {
  id: true,
  code: true,
  userId: true,
  pointId: true,
  status: true,
  gomdonOrderId: true,
  gomdonPartnerCode: true,
  gomdonStatus: true,
  gomdonStatusAt: true,
  shipFeePointsUsed: true,
  shipFeeCashVnd: true,
  shipFeeCashPaidAt: true,
  shippingHistory: true,
} as const;

/** Phần của một webhook Gomdon mà phiếu thu gom cần (đã đọc xong từ payload). */
export interface HomePickupGomdonEvent {
  status: number;
  eventTime: Date | null;
  gomdonOrderId: string | null;
  partnerCode: string | null;
}

export interface HomePickupWebhookResult {
  outcome: 'PROCESSED' | 'IGNORED';
  reason?: string;
  /** Việc cần người xử lý (6/8/9/11/12, huỷ hoặc lấy hàng không đúng lúc); webhook service gửi qua kênh báo động Gomdon. */
  alert?: string;
}

export interface CloseOpenArgs {
  to: 'CANCELLED' | 'EXPIRED';
  closeReason: WasteCloseReason | null;
  actorUserId: string | null;
  actorRole: WasteActorRole;
  eventKind: 'REQUEST_CANCELLED' | 'REQUEST_EXPIRED';
  cause: string;
  /** Cột gomdon* ghi cùng lúc với việc đóng. */
  data?: Prisma.WasteRequestUpdateManyMutationInput;
  /** Điều kiện thêm (vd gomdonStatus vẫn như lúc đọc): không khớp thì coi như bên khác đã xử lý. */
  where?: Prisma.WasteRequestWhereInput;
  /** Có thì báo khách bằng mẫu "yêu cầu đã đóng" với câu này. */
  notifyDetail?: string;
}

export interface CloseOpenResult {
  closed: boolean;
  refunded: number;
  refundedCashVnd?: number;
}

const asHistory = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Vòng đời phiếu shipper lấy tận nhà (HOME_PICKUP): đóng phiếu chưa có hàng tới kho kèm hoàn Điểm Xanh phí ship, và áp trạng thái Gomdon từ webhook.
 * Không gọi Gomdon: gọi API là việc của GomdonWastePickupService và của luồng huỷ phía khách.
 */
@Injectable()
export class WasteHomePickupService {
  private readonly logger = new Logger(WasteHomePickupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
    private readonly shipLock: WasteShipLockService,
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
  ) {}

  /** Đóng phiếu còn OPEN (chưa bưu tá lấy) và hoàn Điểm Xanh trả phí ship trong CÙNG transaction; `closed:false` = phiếu đã sang trạng thái khác. */
  async closeOpen(requestId: string, a: CloseOpenArgs): Promise<CloseOpenResult> {
    const row = await this.prisma.wasteRequest.findUnique({
      where: { id: requestId },
      select: { id: true, code: true, userId: true, pointId: true, method: true, shipFeePointsUsed: true },
    });
    if (!row || row.method !== 'HOME_PICKUP') return { closed: false, refunded: 0 };
    const now = new Date();
    const refundExpiresAt = await this.config.pointExpiresAt(now);
    const res = await this.prisma.$transaction((tx) =>
      closeHomePickupRequest(tx, {
        req: { id: row.id, userId: row.userId, code: row.code, pointId: row.pointId, shipFeePointsUsed: row.shipFeePointsUsed },
        from: ['OPEN'],
        to: a.to,
        closeReason: a.closeReason,
        now,
        refundExpiresAt,
        data: a.data,
        where: a.where,
        event: {
          kind: a.eventKind,
          actorUserId: a.actorUserId,
          actorRole: a.actorRole,
          meta: { cause: a.cause, before: { status: 'OPEN' }, after: { status: a.to, closeReason: a.closeReason } },
        },
      }),
    );
    if (res.closed && a.notifyDetail) await this.notifier.homePickupClosed(row.userId, { id: row.id, code: row.code }, a.notifyDetail, now);
    return res;
  }

  /** Gomdon từ chối tạo vận đơn dứt khoát (hoặc hết lượt thử): huỷ phiếu, hoàn điểm, báo khách. Không đụng phiếu đã có vận đơn. */
  failAfterRejected(requestId: string, cause: string): Promise<CloseOpenResult> {
    return this.closeOpen(requestId, {
      to: 'CANCELLED',
      closeReason: null,
      actorUserId: null,
      actorRole: 'SYSTEM',
      eventKind: 'REQUEST_CANCELLED',
      cause,
      data: { gomdonStatus: 'FAILED' },
      where: { gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      notifyDetail: PUSH_REJECTED_TEXT,
    });
  }

  /**
   * Áp một webhook Gomdon lên phiếu: bỏ qua sự kiện cũ/trùng (gomdonRank + created_time), ghi lịch sử, rồi
   *  - 1: giữ OPEN; 3, 4, 5, 7: sang IN_TRANSIT (kho đối chiếu theo mã vận đơn rồi tự nhận, không có API nhận nội bộ);
   *  - 2 / 10 khi bưu tá chưa lấy: đóng phiếu (10 tính là PICKUP_NO_SHOW) và hoàn điểm; đã lấy rồi thì chỉ ghi và báo người xử lý;
   *  - 6, 8, 9, 11, 12: chỉ ghi và báo người xử lý.
   * `backfill`: phiếu chưa có mã vận đơn nào (lần tạo bị mất phản hồi nhưng Gomdon đã tạo): điền mã từ webhook.
   */
  async applyWebhook(req: HomePickupRow, ev: HomePickupGomdonEvent): Promise<HomePickupWebhookResult> {
    const newStatus = String(ev.status);
    const cur = req.gomdonStatus;
    const changed = cur !== newStatus;
    if (req.gomdonOrderId && ev.gomdonOrderId && req.gomdonOrderId !== ev.gomdonOrderId) {
      return { outcome: 'IGNORED', reason: `vận đơn Gomdon ${ev.gomdonOrderId} khác vận đơn đang gắn ${req.gomdonOrderId}` };
    }

    const fillId = !req.gomdonOrderId ? ev.gomdonOrderId : null;
    // API tạo đơn chỉ trả id nội bộ Gomdon nên phiếu lưu id đó làm mã tạm; webhook mang mã BestExpress thật thì nâng lên.
    const placeholderCode = req.gomdonPartnerCode !== null && req.gomdonPartnerCode === (req.gomdonOrderId ?? ev.gomdonOrderId);
    const upgradeCode = placeholderCode && ev.partnerCode !== null && ev.partnerCode !== req.gomdonPartnerCode;
    const partnerCode = upgradeCode ? ev.partnerCode : (req.gomdonPartnerCode ?? ev.partnerCode ?? ev.gomdonOrderId);
    const fillCode = (!req.gomdonPartnerCode || upgradeCode) && partnerCode ? partnerCode : null;
    const idData: Prisma.WasteRequestUpdateManyMutationInput = {
      ...(fillId ? { gomdonOrderId: fillId } : {}),
      ...(fillCode ? { gomdonPartnerCode: fillCode, trackingCode: fillCode, trackingNorm: normalizeTracking(fillCode), carrier: HOME_PICKUP_CARRIER } : {}),
    };

    if (changed) {
      const rCur = gomdonRank(cur);
      const rNew = gomdonRank(newStatus);
      const sameRankOlder = rNew === rCur && rCur > 0 && ev.eventTime !== null && req.gomdonStatusAt !== null && ev.eventTime < req.gomdonStatusAt;
      if (isGomdonTerminal(cur) || rNew < rCur || sameRankOlder) {
        if (Object.keys(idData).length > 0) await this.prisma.wasteRequest.updateMany({ where: { id: req.id, gomdonOrderId: req.gomdonOrderId, gomdonPartnerCode: req.gomdonPartnerCode }, data: idData });
        return { outcome: 'IGNORED', reason: `status ${newStatus} cũ hơn trạng thái hiện tại ${cur} của phiếu ${req.code}` };
      }
    } else {
      if (Object.keys(idData).length > 0) await this.prisma.wasteRequest.updateMany({ where: { id: req.id, gomdonOrderId: req.gomdonOrderId, gomdonPartnerCode: req.gomdonPartnerCode }, data: idData });
      return { outcome: 'IGNORED', reason: `status ${newStatus} đã ghi cho phiếu ${req.code} (sự kiện trùng)` };
    }

    const at = ev.eventTime ?? new Date();
    const statusData: Prisma.WasteRequestUpdateManyMutationInput = {
      ...idData,
      gomdonStatus: newStatus,
      gomdonStatusAt: at,
      shippingHistory: [...asHistory(req.shippingHistory), { at: at.toISOString(), status: newStatus, carrier: HOME_PICKUP_CARRIER, code: partnerCode }] as Prisma.InputJsonArray,
    };
    const name = GOMDON_STATUS_NAME[ev.status] ?? newStatus;
    const notPickedUp = gomdonRank(cur) < PICKED_UP_RANK;

    if (req.status === 'OPEN' && notPickedUp && (ev.status === 2 || ev.status === 10)) {
      const noShow = ev.status === 10;
      const res = await this.closeOpen(req.id, {
        to: noShow ? 'EXPIRED' : 'CANCELLED',
        closeReason: noShow ? 'PICKUP_NO_SHOW' : null,
        actorUserId: null,
        actorRole: 'SYSTEM',
        eventKind: noShow ? 'REQUEST_EXPIRED' : 'REQUEST_CANCELLED',
        cause: `Gomdon ${newStatus}: ${name}`,
        data: statusData,
        where: { gomdonStatus: cur },
        notifyDetail: noShow ? undefined : CLOSED_BY_CARRIER_TEXT,
      });
      if (!res.closed) throw new Error(`Trạng thái phiếu ${req.code} vừa đổi — xử lý lại event`);
      if (noShow) {
        await this.enqueueWaybillCancel(req.id, req.code, req.gomdonOrderId ?? ev.gomdonOrderId);
        await this.afterNoShow(req);
      }
      return { outcome: 'PROCESSED' };
    }

    const data: Prisma.WasteRequestUpdateManyMutationInput = { ...statusData };
    if (req.status === 'OPEN' && [3, 4, 5, 7].includes(ev.status)) {
      data.status = 'IN_TRANSIT';
      data.inTransitAt = at;
      data.expiresAt = null;
    }
    const r = await this.prisma.wasteRequest.updateMany({ where: { id: req.id, status: req.status, gomdonStatus: cur }, data });
    if (r.count === 0) throw new Error(`Trạng thái phiếu ${req.code} vừa đổi — xử lý lại event`);

    // Phiếu đã đóng (hết hạn/khoá/huỷ) khi vận đơn vừa hiện ra còn sống: huỷ vận đơn để bưu tá không tới lấy cho phiếu đã hoàn điểm.
    if ((req.status === 'CANCELLED' || req.status === 'EXPIRED') && (ev.status === 1 || ev.status === 10)) {
      await this.enqueueWaybillCancel(req.id, req.code, req.gomdonOrderId ?? ev.gomdonOrderId);
    }
    return { outcome: 'PROCESSED', alert: this.alertFor(req, ev.status, name) };
  }

  /** Xếp lệnh huỷ vận đơn Gomdon của phiếu đã đóng; job tự bỏ qua vận đơn đã huỷ / bưu tá đã lấy. Lỗi xếp hàng chỉ ghi log, cron cứu hộ xếp lại. */
  private async enqueueWaybillCancel(requestId: string, code: string, gomdonOrderId: string | null): Promise<void> {
    if (!gomdonOrderId || !this.gomdonQueue) return;
    await enqueueGomdonWasteCancel(this.gomdonQueue, requestId, code).catch((e) =>
      this.logger.error(`Xếp lệnh huỷ vận đơn Gomdon của phiếu ${code} lỗi: ${e instanceof Error ? e.message : e}`),
    );
  }

  private alertFor(req: HomePickupRow, status: number, name: string): string | undefined {
    const paidCash = (req.shipFeeCashVnd ?? 0) > 0 && req.shipFeeCashPaidAt != null ? req.shipFeeCashVnd! : 0;
    const cashClause = paidCash > 0 ? ` và ${paidCash.toLocaleString('vi-VN')}đ phí đã thu` : '';
    if ([6, 8, 9, 11, 12].includes(status)) {
      return `Gomdon báo "${name}" cho phiếu thu gom ${req.code} (Điểm Xanh phí ship${cashClause} KHÔNG tự hoàn). Kiểm tra với Gomdon/BestExpress và liên hệ khách.`;
    }
    if ((status === 2 || status === 10) && req.status !== 'CANCELLED' && req.status !== 'EXPIRED') {
      return `Gomdon báo "${name}" cho phiếu thu gom ${req.code} nhưng phiếu đang ${req.status}${gomdonRank(req.gomdonStatus) >= PICKED_UP_RANK ? ' và bưu tá đã lấy rác' : ''}: Điểm Xanh phí ship${cashClause} KHÔNG tự hoàn, cần người kiểm tra.`;
    }
    if ([3, 4, 5, 7].includes(status) && (req.status === 'CANCELLED' || req.status === 'EXPIRED')) {
      return `Gomdon báo "${name}" cho phiếu thu gom ${req.code} nhưng phiếu đã đóng (${req.status}) và điểm phí ship${cashClause ? ' / phí đã thu' : ''} đã hoàn: kiểm tra rác đang về kho với khách.`;
    }
    return undefined;
  }

  /** Bưu tá không lấy được: đây là một lần "hụt" trong chuỗi khoá đường thu gom; đánh giá sau commit như hết hạn IN_TRANSIT của PICKUP. */
  private async afterNoShow(req: HomePickupRow): Promise<void> {
    try {
      const cfg = await this.config.snapshot();
      await this.shipLock.evaluateAndLock(req.userId, { shortfallLockPct: cfg.shortfallLockPct, shortfallLockStreak: cfg.shortfallLockStreak });
    } catch (e) {
      this.logger.error(`Đánh giá khoá đường thu gom sau lần bưu tá không lấy được của ${req.code} lỗi: ${e instanceof Error ? e.message : e}`);
    }
  }
}
