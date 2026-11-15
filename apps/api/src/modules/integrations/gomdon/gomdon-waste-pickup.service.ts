import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UnrecoverableError, type Queue } from 'bullmq';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeTracking } from '../../waste-exchange/waste-codes';
import { HOME_PICKUP_STATE, wasteGomdonCustomerId } from '../../waste-exchange/home-pickup/waste-home-pickup-text';
import { HOME_PICKUP_CARRIER, WasteHomePickupService } from '../../waste-exchange/home-pickup/waste-home-pickup.service';
import { GOMDON_ALERT_TEMPLATE, GomdonAlertService } from './gomdon-alert.service';
import { GomdonClient } from './gomdon.client';
import { GomdonDuplicateOrderError, GomdonRejectedError } from './gomdon.errors';
import { enqueueGomdonWasteCancel } from './gomdon-queue';
import { GOMDON_MAX_PARCEL_GRAMS } from './gomdon-weight';
import { isGomdonPickedUp } from './gomdon-status';
import type { GomdonCreateOrderBody, GomdonCreateOrderResponse } from './gomdon.types';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const nonEmpty = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const looksLikeCancelNotFound = (message: string | undefined) => !!message && /không tìm thấy|khong tim thay|not found/i.test(message);

const REQUEST_SELECT = {
  id: true,
  code: true,
  userId: true,
  method: true,
  status: true,
  gomdonOrderId: true,
  gomdonPartnerCode: true,
  gomdonStatus: true,
  declaredWeightGrams: true,
  shipFeeCodVnd: true,
  pickupAddress: true,
  shippingHistory: true,
  updatedAt: true,
} as const;
type RequestRow = Prisma.WasteRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

/**
 * Vận đơn Gomdon của phiếu shipper lấy rác tận nhà (WasteRequest HOME_PICKUP): bưu tá lấy ở nhà khách (source_*), giao về kho Tubu (dest_*).
 *
 * Giống GomdonOrderService: claim nguyên tử gomdonStatus → CREATING trước khi gọi API, lỗi CHẮC CHẮN chưa tạo thì nhả claim cho BullMQ thử lại,
 * lỗi KHÔNG RÕ thì NEEDS_MANUAL_CHECK và KHÔNG BAO GIỜ tạo lại (mỗi lần gọi lại là một vận đơn BestExpress thật). Khác đơn mua hàng: hết lượt mà
 * Gomdon vẫn từ chối thì tự huỷ phiếu và hoàn Điểm Xanh phí ship (khách không có đơn hàng nào để chờ), thay vì báo kho tạo vận đơn tay.
 */
@Injectable()
export class GomdonWastePickupService {
  private readonly logger = new Logger(GomdonWastePickupService.name);
  /** Claim CREATING trẻ hơn mốc này = tiến trình khác đang gọi Gomdon (timeout client 15 giây, dư an toàn). */
  static readonly CREATING_LEASE_MS = 2 * 60_000;
  protected persistRetryDelayMs = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gomdonClient: GomdonClient,
    private readonly alerts: GomdonAlertService,
    private readonly lifecycle: WasteHomePickupService,
    @InjectQueue(QUEUE_GOMDON_PUSH) private readonly pushQueue: Queue,
  ) {}

  /** Tạo vận đơn cho phiếu. Chỉ ném lỗi khi RETRY AN TOÀN; UnrecoverableError khi đã tạo mà không ghi được DB. */
  async pushRequest(requestId: string): Promise<string | null> {
    const req = await this.prisma.wasteRequest.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
    if (!req || req.method !== 'HOME_PICKUP') return null;
    if (req.gomdonOrderId || req.gomdonPartnerCode) return req.gomdonPartnerCode ?? req.gomdonOrderId;

    if (req.gomdonStatus === HOME_PICKUP_STATE.CREATING) {
      if (!this.leaseExpired(req)) {
        this.logger.warn(`Phiếu ${req.code}: đang có tiến trình khác tạo vận đơn Gomdon, bỏ qua lần chạy chồng.`);
        return null;
      }
      // Lần chạy trước đã claim nhưng chưa ghi được kết quả: Gomdon CÓ THỂ đã tạo vận đơn, tạo lại là trùng.
      await this.markNeedsManualCheck(req, 'Lần tạo vận đơn trước bị gián đoạn, không rõ Gomdon đã tạo chưa');
      return null;
    }
    if (req.gomdonStatus !== null) return null;
    if (req.status !== 'OPEN') {
      this.logger.log(`Phiếu ${req.code} đã ${req.status}, không tạo vận đơn Gomdon.`);
      return null;
    }

    // Dựng body TRƯỚC khi claim: dữ liệu hỏng không được bị hiểu nhầm là "không rõ đã tạo".
    const body = await this.buildBody(req);
    const claim = await this.prisma.wasteRequest.updateMany({
      where: { id: req.id, method: 'HOME_PICKUP', status: 'OPEN', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      data: { gomdonStatus: HOME_PICKUP_STATE.CREATING },
    });
    if (claim.count === 0) {
      this.logger.warn(`Phiếu ${req.code}: trạng thái vừa đổi bởi tiến trình khác (đã huỷ hoặc đã có vận đơn), bỏ qua lần tạo này.`);
      return null;
    }

    let res: GomdonCreateOrderResponse;
    try {
      res = await this.gomdonClient.createOrder(body);
    } catch (err) {
      if (err instanceof GomdonRejectedError) {
        await this.prisma.wasteRequest.updateMany({ where: { id: req.id, gomdonStatus: HOME_PICKUP_STATE.CREATING }, data: { gomdonStatus: null } });
        throw err;
      }
      if (err instanceof GomdonDuplicateOrderError) {
        await this.markNeedsManualCheck(
          req,
          `Gomdon báo ĐÃ CÓ đơn mang mã ${wasteGomdonCustomerId(req.code)} (order_customer_id phải duy nhất): ${err.message}`,
          `Tra Gomdon theo mã ${wasteGomdonCustomerId(req.code)}: vận đơn còn chạy thì webhook tự gắn mã; chưa có thì huỷ phiếu để hoàn điểm cho khách.`,
        );
        return null;
      }
      await this.markNeedsManualCheck(req, `Không rõ Gomdon đã tạo vận đơn chưa: ${err instanceof Error ? err.message : err}`);
      return null;
    }

    const gomdonId = nonEmpty(res.data?.id);
    const partnerCode = nonEmpty(res.data?.partner_code) ?? nonEmpty(res.data?.order_code) ?? gomdonId;
    if (!partnerCode) {
      await this.markNeedsManualCheck(req, 'Gomdon báo tạo thành công nhưng không trả id đơn/mã vận đơn');
      return null;
    }
    await this.persistCreated(req, gomdonId, partnerCode, res);
    this.logger.log(`Tạo vận đơn Gomdon thành công cho phiếu ${req.code} (mã vận đơn ${partnerCode}).`);

    // Phiếu đã bị đóng TRONG LÚC đang tạo vận đơn (hết hạn, khoá đường thu gom) → huỷ luôn vận đơn vừa tạo.
    const fresh = await this.prisma.wasteRequest.findUnique({ where: { id: req.id }, select: { status: true } });
    if (!fresh || fresh.status === 'CANCELLED' || fresh.status === 'EXPIRED') {
      this.logger.warn(`Phiếu ${req.code} đã đóng trong lúc tạo vận đơn ${partnerCode}, xếp lệnh huỷ vận đơn.`);
      await enqueueGomdonWasteCancel(this.pushQueue, req.id, req.code);
    }
    return partnerCode;
  }

  /**
   * Hết lượt thử (hoặc Gomdon từ chối dứt khoát): phiếu chưa có vận đơn nên huỷ phiếu, hoàn Điểm Xanh, báo khách.
   * Ném lỗi nếu chính bước này lỗi để job kết thúc 'failed', cron cứu hộ xếp lại.
   */
  async markFinalPushFailure(requestId: string, lastError: unknown): Promise<void> {
    const req = await this.prisma.wasteRequest.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
    if (!req || req.method !== 'HOME_PICKUP') return;
    if (req.gomdonOrderId || req.gomdonPartnerCode || req.status !== 'OPEN') return;
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    if (req.gomdonStatus === HOME_PICKUP_STATE.CREATING) {
      // CREATING lúc này nghĩa là không rõ đã tạo chưa: không hoàn điểm, không huỷ phiếu.
      await this.markNeedsManualCheck(req, `Không rõ Gomdon đã tạo vận đơn chưa (${reason})`);
      return;
    }
    if (req.gomdonStatus !== null) return;
    const res = await this.lifecycle.failAfterRejected(req.id, `Gomdon từ chối tạo vận đơn: ${reason}`);
    if (!res.closed) return;
    await this.alerts.alert(
      wasteGomdonCustomerId(req.code),
      `Không tạo được vận đơn Gomdon cho phiếu thu gom ${req.code} (${reason}). Hệ thống đã huỷ phiếu, hoàn ${res.refunded} Điểm Xanh phí ship và báo khách.`,
      GOMDON_ALERT_TEMPLATE,
    );
  }

  /** Huỷ vận đơn Gomdon của phiếu đã đóng (hết hạn, khoá đường thu gom, đóng khi vận đơn đang được tạo). Điểm Xanh đã hoàn lúc đóng phiếu, không hoàn ở đây. */
  async cancelOnGomdon(requestId: string, isLastAttempt: boolean): Promise<void> {
    const req = await this.prisma.wasteRequest.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
    if (!req || req.method !== 'HOME_PICKUP') return;
    if (req.status !== 'CANCELLED' && req.status !== 'EXPIRED') {
      this.logger.warn(`Bỏ qua huỷ vận đơn Gomdon: phiếu ${req.code} đang ${req.status}.`);
      return;
    }
    if (req.gomdonStatus === '2') return;
    const hasWaybill = Boolean(req.gomdonOrderId || req.gomdonPartnerCode);
    const id = wasteGomdonCustomerId(req.code);
    try {
      if (!hasWaybill) {
        if (req.gomdonStatus === HOME_PICKUP_STATE.CREATING) {
          if (this.leaseExpired(req)) {
            await this.markNeedsManualCheck(req, 'Lần tạo vận đơn trước bị gián đoạn khi phiếu đã đóng');
            return;
          }
          throw new Error('Vận đơn Gomdon đang được tạo, chưa có mã để huỷ');
        }
        if (req.gomdonStatus === HOME_PICKUP_STATE.NEEDS_MANUAL_CHECK) {
          await this.alerts.alert(id, `Phiếu thu gom ${req.code} đã đóng nhưng không rõ Gomdon đã tạo vận đơn chưa — tra Gomdon theo mã ${id} và huỷ tay nếu có.`);
        }
        return;
      }
      if (isGomdonPickedUp(req.gomdonStatus)) {
        await this.alerts.alert(id, `Phiếu thu gom ${req.code} đã đóng nhưng bưu tá đã lấy rác — liên hệ Gomdon/BestExpress và khách để xử lý rác đang về kho.`);
        return;
      }
      if (!req.gomdonOrderId) {
        await this.alerts.alert(id, `Phiếu thu gom ${req.code} đã đóng nhưng vận đơn ${req.gomdonPartnerCode} chưa có mã số Gomdon để huỷ qua API — HUỶ TAY trên Gomdon.`);
        return;
      }
      const res = await this.gomdonClient.cancelOrder(req.gomdonOrderId);
      if (!res.ok && looksLikeCancelNotFound(res.message)) {
        await this.alerts.alert(id, `Gomdon báo "${res.message}" khi huỷ vận đơn ${req.gomdonPartnerCode ?? req.gomdonOrderId} của phiếu ${req.code} — tra cổng Gomdon, còn chạy thì huỷ tay.`);
        return;
      }
      if (!res.ok) throw new Error(`Gomdon không huỷ được vận đơn: ${res.message ?? 'không rõ lý do'}`);
      const now = new Date();
      const history = Array.isArray(req.shippingHistory) ? req.shippingHistory : [];
      await this.prisma.wasteRequest.updateMany({
        where: { id: req.id, gomdonOrderId: req.gomdonOrderId },
        data: {
          gomdonStatus: '2',
          gomdonStatusAt: now,
          shippingHistory: [...history, { at: now.toISOString(), status: '2', carrier: HOME_PICKUP_CARRIER, code: req.gomdonPartnerCode }] as Prisma.InputJsonArray,
        },
      });
      this.logger.log(`Đã huỷ vận đơn Gomdon ${req.gomdonPartnerCode ?? req.gomdonOrderId} của phiếu ${req.code}.`);
    } catch (err) {
      if (!isLastAttempt) throw err;
      await this.alerts.alert(
        id,
        `Không huỷ được vận đơn Gomdon ${req.gomdonPartnerCode ?? req.gomdonOrderId ?? ''} của phiếu thu gom ${req.code} đã đóng (${err instanceof Error ? err.message : err}) — huỷ tay trên Gomdon để bưu tá không tới lấy rác.`,
        GOMDON_ALERT_TEMPLATE,
      );
    }
  }

  private leaseExpired(req: { updatedAt: Date }): boolean {
    return Date.now() - req.updatedAt.getTime() >= GomdonWastePickupService.CREATING_LEASE_MS;
  }

  /** CREATING → NEEDS_MANUAL_CHECK + báo CSKH. Không hoàn điểm, không huỷ phiếu: có thể vận đơn đã tồn tại. */
  private async markNeedsManualCheck(req: Pick<RequestRow, 'id' | 'code'>, reason: string, advice?: string): Promise<void> {
    try {
      await this.prisma.wasteRequest.updateMany({
        where: { id: req.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: HOME_PICKUP_STATE.CREATING },
        data: { gomdonStatus: HOME_PICKUP_STATE.NEEDS_MANUAL_CHECK },
      });
    } catch (err) {
      throw new UnrecoverableError(`Không ghi được NEEDS_MANUAL_CHECK cho phiếu ${req.code} (${reason}): ${err instanceof Error ? err.message : err}`);
    }
    const id = wasteGomdonCustomerId(req.code);
    await this.alerts.alert(id, `${reason}. ${advice ?? `KIỂM TRA GOMDON (mã ${id}) trước khi tạo vận đơn tay.`}`, GOMDON_ALERT_TEMPLATE);
  }

  /** Ghi mã vận đơn, thử lại tại chỗ khi DB chập chờn: để BullMQ retry thì lần sau thấy CREATING (không tạo trùng) nhưng MẤT mã vừa tạo. */
  private async persistCreated(req: RequestRow, gomdonId: string | null, partnerCode: string, res: GomdonCreateOrderResponse): Promise<void> {
    const statusNum = Number(res.data?.status ?? 1) || 1;
    const history = Array.isArray(req.shippingHistory) ? req.shippingHistory : [];
    const now = new Date();
    const data: Prisma.WasteRequestUpdateManyMutationInput = {
      gomdonOrderId: gomdonId,
      gomdonPartnerCode: partnerCode,
      gomdonStatus: String(statusNum),
      gomdonStatusAt: now,
      carrier: HOME_PICKUP_CARRIER,
      trackingCode: partnerCode,
      trackingNorm: normalizeTracking(partnerCode),
      shippingHistory: [...history, { at: now.toISOString(), status: String(statusNum), carrier: HOME_PICKUP_CARRIER, code: partnerCode }] as Prisma.InputJsonArray,
    };
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.prisma.wasteRequest.updateMany({ where: { id: req.id, gomdonStatus: HOME_PICKUP_STATE.CREATING }, data });
        if (r.count === 0) {
          const recovered = await this.prisma.wasteRequest.updateMany({
            where: { id: req.id, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: HOME_PICKUP_STATE.NEEDS_MANUAL_CHECK },
            data,
          });
          if (recovered.count === 0) {
            // Claim đã bị đổi khác (webhook tới trước): vẫn KHÔNG được làm mất mã vận đơn.
            await this.prisma.wasteRequest.updateMany({
              where: { id: req.id, gomdonOrderId: null, gomdonPartnerCode: null },
              data: { gomdonOrderId: gomdonId, gomdonPartnerCode: partnerCode, carrier: HOME_PICKUP_CARRIER, trackingCode: partnerCode, trackingNorm: normalizeTracking(partnerCode) },
            });
          }
        }
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 3 && this.persistRetryDelayMs > 0) await new Promise((r) => setTimeout(r, this.persistRetryDelayMs * attempt));
      }
    }
    this.logger.error(`ĐÃ TẠO vận đơn Gomdon cho phiếu ${req.code} (id=${gomdonId}, mã=${partnerCode}) nhưng KHÔNG GHI ĐƯỢC DB: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
    throw new UnrecoverableError(`Không ghi được mã vận đơn Gomdon ${partnerCode} cho phiếu ${req.code}`);
  }

  private async buildBody(req: RequestRow): Promise<GomdonCreateOrderBody> {
    const config = await this.gomdonClient.getConfig();
    const wh = config.defaultWarehouse;
    const a = isRecord(req.pickupAddress) ? req.pickupAddress : {};
    const [name, phone, street, ward, province] = [text(a.recipient), text(a.phone), text(a.street), text(a.ward), text(a.province)];
    if (!name || !phone || !street || !ward || !province || !req.declaredWeightGrams) {
      throw new GomdonRejectedError(`Phiếu ${req.code} thiếu thông tin địa chỉ lấy rác hoặc cân nặng`);
    }
    const weight = Math.min(req.declaredWeightGrams, GOMDON_MAX_PARCEL_GRAMS);
    const kg = (weight / 1000).toFixed(1);
    return {
      type: 1, // 1: giao hàng (từ nhà khách về kho Tubu)
      pickup_type: 2, // 2: bưu tá tới lấy tận địa chỉ gửi
      service_id: 12491, // 12491: Giao hàng tiết kiệm
      order_customer_id: wasteGomdonCustomerId(req.code),
      product_name: `Rác tái chế ${req.code}`,
      product_price: 0,
      product_number: 1,
      collect_amount: req.shipFeeCodVnd ?? 0,
      weight,
      width: 0,
      height: 0,
      length: 0,
      note: `Thu gom rác tái chế ${req.code} (~${kg}kg) giao về kho Tubu Tree`,
      source_name: name,
      source_phone: phone,
      source_address: street,
      source_ward: ward,
      source_province: province,
      dest_name: wh.name,
      dest_phone: wh.phone,
      dest_address: wh.address,
      dest_ward: wh.ward,
      dest_province: wh.province,
    };
  }
}
