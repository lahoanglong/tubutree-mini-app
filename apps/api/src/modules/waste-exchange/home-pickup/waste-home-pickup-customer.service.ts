import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  WASTE_HOME_PICKUP_MAX_GRAMS,
  WASTE_HOME_PICKUP_MIN_GRAMS,
  type WasteCreateRequest,
  type WastePickupQuoteRequest,
  type WastePickupQuoteResponse,
} from '@tubutree/shared-types';
import type { Queue } from 'bullmq';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { GomdonClient } from '../../integrations/gomdon/gomdon.client';
import { enqueueGomdonWastePush } from '../../integrations/gomdon/gomdon-queue';
import { GOMDON_STATE, isGomdonPickedUp } from '../../integrations/gomdon/gomdon-status';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { applyPointsDelta } from '../../loyalty/points-ledger';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteHoldService, type WasteHoldConfig } from '../core/waste-hold.service';
import { WASTE_MESSAGES } from '../core/waste-messages';
import { computeWastePublicFlags } from '../core/waste-public-config';
import { generateWasteCode } from '../waste-codes';
import { lockWasteCustomer } from '../waste-locks';
import { WASTE_PICKUP_FEE_REF_TYPE, wastePickupFeeReason } from './waste-home-pickup-ledger';
import { HOME_PICKUP_CARRIER, HOME_PICKUP_ROW_SELECT, WasteHomePickupService } from './waste-home-pickup.service';

const PRIOR_SELECT = {
  id: true,
  code: true,
  method: true,
  status: true,
  pointId: true,
  gomdonOrderId: true,
  gomdonStatus: true,
  declaredWeightGrams: true,
  pickupAddress: true,
  lines: { select: { itemId: true, declaredQty: true } },
} as const;

type Prior = Prisma.WasteRequestGetPayload<{ select: typeof PRIOR_SELECT }>;
type AddressRow = { id: string; recipient: string; phone: string; province: string; ward: string; street: string; provinceCode: string; wardCode: string };

interface Prepared {
  address: AddressRow;
  shipFeeVnd: number;
  holdCfg: WasteHoldConfig;
  rulesVersion: string;
  windowDays: number | null;
}

/**
 * Gomdon chỉ ghi `collect_amount` là "tiền thu hộ", chưa nói thu ở người gửi hay người nhận. Vận đơn lấy rác có người nhận là kho Tubu,
 * nên phần phí còn lại sau khi trừ Điểm Xanh có thể bị đòi ở kho thay vì ở khách. Tới khi Gomdon xác nhận thu được ở người gửi
 * thì chỉ cho đặt khi Điểm Xanh trả đủ phí ship (không còn phần COD).
 */
const HOME_PICKUP_COD_ENABLED = false;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function assertWeight(grams: unknown): asserts grams is number {
  if (typeof grams !== 'number' || !Number.isInteger(grams) || grams < WASTE_HOME_PICKUP_MIN_GRAMS || grams > WASTE_HOME_PICKUP_MAX_GRAMS) {
    throw new BadRequestException(WASTE_MESSAGES.HOME_PICKUP_WEIGHT(WASTE_HOME_PICKUP_MIN_GRAMS, WASTE_HOME_PICKUP_MAX_GRAMS));
  }
}

/**
 * Phía khách của phiếu shipper lấy tận nhà: báo phí, tạo phiếu (một transaction giữ chỗ + trừ Điểm Xanh + ghi phiếu, rồi xếp job Gomdon) và huỷ.
 * Gọi Gomdon báo phí / kiểm tra địa chỉ luôn nằm NGOÀI transaction; tạo vận đơn thật là việc của job (GomdonWastePickupService).
 */
@Injectable()
export class WasteHomePickupCustomerService {
  private readonly logger = new Logger(WasteHomePickupCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly hold: WasteHoldService,
    private readonly systemConfig: SystemConfigService,
    private readonly gomdon: GomdonClient,
    private readonly loyalty: LoyaltyService,
    private readonly lifecycle: WasteHomePickupService,
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
  ) {}

  async isHomePickup(userId: string, id: string): Promise<boolean> {
    const row = await this.prisma.wasteRequest.findFirst({ where: { id, userId }, select: { method: true } });
    return row?.method === 'HOME_PICKUP';
  }

  async quote(userId: string, body: WastePickupQuoteRequest): Promise<WastePickupQuoteResponse> {
    assertWeight(body.declaredWeightGrams);
    const address = await this.loadAddress(userId, body.addressId);
    const check = await this.gomdon.checkAddress(address.province, address.ward);
    const fee = await this.gomdon.quoteShopFeeDetailed({ weight: body.declaredWeightGrams, productPrice: 0 });
    const snap = await this.config.snapshot();
    const holdCfg = await this.holdConfig(snap);
    const evaluated = await this.hold.evaluate(
      this.prisma,
      { path: 'CREATE', userId, method: 'HOME_PICKUP', lines: body.lines, pointId: null, pickupProvince: address.province, now: new Date() },
      holdCfg,
    );
    const pointsAvailable = await this.usablePoints(userId);
    const pointsApplicable = Math.min(fee.fee, pointsAvailable);
    const shortfall = fee.fee - pointsApplicable;
    return {
      shipFeeVnd: fee.fee,
      estimated: fee.estimated,
      estimatedPoints: evaluated.result.estimatedPoints,
      minPoints: snap.pickupMinPoints,
      pointsAvailable,
      pointsApplicable,
      remainingFeeVnd: shortfall,
      addressOk: check.ok,
      addressMessage: check.ok ? null : check.message ?? WASTE_MESSAGES.HOME_PICKUP_ADDRESS_UNRECOGNIZED,
      blocked: evaluated.messages[0] ?? (!HOME_PICKUP_COD_ENABLED && shortfall > 0 ? WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(shortfall) : null),
    };
  }

  /** Trả id phiếu (mới tạo, hoặc phiếu cũ khi cùng khoá idempotency và cùng nội dung). */
  async create(userId: string, idempotencyKey: string, body: WasteCreateRequest): Promise<string> {
    const prepared = await this.prepare(userId, body);
    for (let attempt = 0; ; attempt++) {
      try {
        const done = await this.prisma.$transaction((tx) => this.createInTx(tx, userId, idempotencyKey, body, prepared));
        await this.enqueuePush(done.id, done.code, done.shouldPush);
        return done.id;
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        const target = String((e as { meta?: { target?: unknown } })?.meta?.target ?? '');
        if (code === 'P2002' && target.includes('idempotencyKey')) {
          const prior = await this.prisma.wasteRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: PRIOR_SELECT });
          if (!prior) throw e;
          if (!this.sameContent(prior, body)) throw new ConflictException(WASTE_MESSAGES.IDEMPOTENCY_CONFLICT);
          await this.enqueuePush(prior.id, prior.code, this.needsPush(prior));
          return prior.id;
        }
        if (code === 'P2002' && target.includes('code') && attempt === 0) continue;
        throw e;
      }
    }
  }

  /**
   * Khách huỷ phiếu. Đã có vận đơn: gọi huỷ bên Gomdon, được thì mới đóng phiếu và hoàn điểm; Gomdon từ chối thì giữ phiếu và nói rõ cho khách.
   * Chưa có vận đơn: đóng ngay và hoàn điểm; job tạo vận đơn thấy phiếu đã đóng thì không tạo.
   */
  async cancel(userId: string, id: string): Promise<void> {
    const row = await this.prisma.wasteRequest.findFirst({ where: { id, userId }, select: { ...HOME_PICKUP_ROW_SELECT, method: true } });
    if (!row || row.method !== 'HOME_PICKUP') throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
    if (row.status === 'CANCELLED') return;
    if (row.status !== 'OPEN') {
      throw new ConflictException(row.status === 'IN_TRANSIT' || isGomdonPickedUp(row.gomdonStatus) ? WASTE_MESSAGES.HOME_PICKUP_PICKED_UP : WASTE_MESSAGES.NOT_CANCELLABLE);
    }
    if (isGomdonPickedUp(row.gomdonStatus)) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_PICKED_UP);

    const hasWaybill = Boolean(row.gomdonOrderId || row.gomdonPartnerCode);
    if (!hasWaybill) {
      if (row.gomdonStatus === GOMDON_STATE.CREATING) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_CREATING);
      if (row.gomdonStatus === GOMDON_STATE.NEEDS_MANUAL_CHECK) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_MANUAL_CHECK);
      const res = await this.lifecycle.closeOpen(id, {
        to: 'CANCELLED',
        closeReason: null,
        actorUserId: userId,
        actorRole: 'CUSTOMER',
        eventKind: 'REQUEST_CANCELLED',
        cause: 'Khách huỷ khi chưa có vận đơn',
        where: { gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      });
      if (!res.closed) await this.settleLostRace(id, userId, WASTE_MESSAGES.HOME_PICKUP_CREATING);
      return;
    }

    if (!row.gomdonOrderId) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_MANUAL_CHECK);
    if (row.gomdonStatus !== '2') {
      let ok: boolean;
      try {
        const res = await this.gomdon.cancelOrder(row.gomdonOrderId);
        ok = res.ok;
        if (!ok) this.logger.warn(`Gomdon không huỷ vận đơn ${row.gomdonOrderId} của phiếu ${row.code}: ${res.message ?? 'không rõ lý do'}`);
      } catch (e) {
        this.logger.error(`Gọi huỷ vận đơn Gomdon của phiếu ${row.code} lỗi: ${e instanceof Error ? e.message : e}`);
        throw new ServiceUnavailableException(WASTE_MESSAGES.HOME_PICKUP_CARRIER_BUSY);
      }
      if (!ok) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_CANCEL_REFUSED);
    }
    const now = new Date();
    const history = Array.isArray(row.shippingHistory) ? row.shippingHistory : [];
    const res = await this.lifecycle.closeOpen(id, {
      to: 'CANCELLED',
      closeReason: null,
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      eventKind: 'REQUEST_CANCELLED',
      cause: 'Khách huỷ, Gomdon đã huỷ vận đơn',
      data:
        row.gomdonStatus === '2'
          ? undefined
          : {
              gomdonStatus: '2',
              gomdonStatusAt: now,
              shippingHistory: [...history, { at: now.toISOString(), status: '2', carrier: HOME_PICKUP_CARRIER, code: row.gomdonPartnerCode }] as Prisma.InputJsonArray,
            },
      where: { gomdonOrderId: row.gomdonOrderId },
    });
    if (!res.closed) await this.settleLostRace(id, userId, WASTE_MESSAGES.NOT_CANCELLABLE);
  }

  /** Lần đóng thua một bên khác: đã CANCELLED (webhook huỷ, khách bấm hai lần) thì xong, còn lại báo khách không huỷ được. */
  private async settleLostRace(id: string, userId: string, message: string): Promise<void> {
    const now = await this.prisma.wasteRequest.findFirst({ where: { id, userId }, select: { status: true } });
    if (now?.status === 'CANCELLED') return;
    throw new ConflictException(message);
  }

  private async prepare(userId: string, body: WasteCreateRequest): Promise<Prepared> {
    if (!body.pickupAddressId) throw new BadRequestException(WASTE_MESSAGES.HOME_PICKUP_NEED_ADDRESS);
    assertWeight(body.declaredWeightGrams);
    const address = await this.loadAddress(userId, body.pickupAddressId);
    const check = await this.gomdon.checkAddress(address.province, address.ward);
    if (!check.ok) throw new BadRequestException(WASTE_MESSAGES.HOME_PICKUP_ADDRESS_UNRECOGNIZED);
    if (!(await this.gomdon.isConfigured())) throw new ServiceUnavailableException(WASTE_MESSAGES.HOME_PICKUP_UNAVAILABLE);
    const fee = await this.gomdon.quoteShopFeeDetailed({ weight: body.declaredWeightGrams, productPrice: 0 });
    // Phí ước lượng (Gomdon không trả lời) không được dùng để trừ Điểm Xanh thật.
    if (fee.estimated) throw new ServiceUnavailableException(WASTE_MESSAGES.HOME_PICKUP_FEE_UNAVAILABLE);
    const snap = await this.config.snapshot();
    return {
      address,
      shipFeeVnd: fee.fee,
      holdCfg: await this.holdConfig(snap),
      rulesVersion: snap.rulesVersion,
      // Đọc ngoài transaction: lần trượt cache cấu hình trong tx xin kết nối pool thứ hai khi tx đang giữ một.
      windowDays: body.usePointsForShipFee === true ? await this.loyalty.returnWindowDays() : null,
    };
  }

  private async holdConfig(snap: Awaited<ReturnType<WasteConfigService['snapshot']>>): Promise<WasteHoldConfig> {
    return {
      laneDropoff: snap.laneDropoff,
      laneMailin: snap.laneMailin,
      lanePickup: (await computeWastePublicFlags(this.systemConfig)).pickup,
      mailinMinPoints: snap.mailinMinPoints,
      pickupMinPoints: snap.pickupMinPoints,
      customerMonthlyCapPoints: snap.customerMonthlyCapPoints,
      maxOpenRequests: snap.maxOpenRequests,
      requestHoldDays: snap.requestHoldDays,
    };
  }

  private async loadAddress(userId: string, addressId: string): Promise<AddressRow> {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
      select: { id: true, recipient: true, phone: true, province: true, ward: true, street: true, provinceCode: true, wardCode: true },
    });
    if (!address) throw new BadRequestException(WASTE_MESSAGES.HOME_PICKUP_ADDRESS_NOT_FOUND);
    return address;
  }

  /** Điểm Xanh dùng được để trả phí ship: điểm thường trừ phần còn khoá chờ đổi/trả (cùng luật checkout), cộng lô quy đổi không hết hạn. */
  private async usablePoints(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pointsBalance: true, pointsConvertedBalance: true } });
    if (!user) return 0;
    const locked = user.pointsBalance > 0 ? (await this.loyalty.lockedOrderPoints(userId, new Date())).locked : 0;
    return Math.max(0, user.pointsBalance - locked) + user.pointsConvertedBalance;
  }

  private async createInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
    body: WasteCreateRequest,
    p: Prepared,
  ): Promise<{ id: string; code: string; shouldPush: boolean }> {
    await lockWasteCustomer(tx, userId);
    const now = new Date();
    const prior = await tx.wasteRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: PRIOR_SELECT });
    if (prior) {
      if (!this.sameContent(prior, body)) throw new ConflictException(WASTE_MESSAGES.IDEMPOTENCY_CONFLICT);
      return { id: prior.id, code: prior.code, shouldPush: this.needsPush(prior) };
    }
    if (body.consentVersion !== undefined && body.consentVersion !== p.rulesVersion) throw new BadRequestException(WASTE_MESSAGES.RULES_UPDATED);
    const result = await this.hold.validateAndHold(
      tx,
      { path: 'CREATE', userId, method: 'HOME_PICKUP', lines: body.lines, pointId: null, pickupProvince: p.address.province, now },
      p.holdCfg,
    );

    const fee = p.shipFeeVnd;
    let standardUse = 0;
    let convertedUse = 0;
    if (body.usePointsForShipFee === true && fee > 0 && p.windowDays !== null) {
      // Khoá dòng khách rồi mới tính phần dùng được: hai lần tạo phiếu / đặt đơn song song không cùng tiêu một số điểm.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { pointsBalance: true, pointsConvertedBalance: true } });
      const lock = await this.loyalty.lockedOrderPoints(userId, now, tx, p.windowDays);
      standardUse = Math.min(fee, Math.max(0, (user?.pointsBalance ?? 0) - lock.locked));
      convertedUse = Math.min(fee - standardUse, user?.pointsConvertedBalance ?? 0);
    }
    const pointsUsed = standardUse + convertedUse;
    const codVnd = fee - pointsUsed;
    if (!HOME_PICKUP_COD_ENABLED && codVnd > 0) throw new BadRequestException(WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(codVnd));

    let code: string | null = null;
    for (let i = 0; i < 5 && code === null; i++) {
      const candidate = generateWasteCode('TR');
      if (!(await tx.wasteRequest.findUnique({ where: { code: candidate }, select: { id: true } }))) code = candidate;
    }
    if (code === null) throw new ConflictException(WASTE_MESSAGES.RETRY);

    const a = p.address;
    const created = await tx.wasteRequest.create({
      data: {
        code,
        userId,
        method: 'HOME_PICKUP',
        status: 'OPEN',
        pointId: result.pointId,
        estimatedPoints: result.estimatedPoints,
        estimatedDrops: result.estimatedDrops,
        capDayKey: result.capDayKey,
        capMonthKey: result.capMonthKey,
        expiresAt: result.expiresAt,
        idempotencyKey,
        consentAt: now,
        consentVersion: p.rulesVersion,
        declaredWeightGrams: body.declaredWeightGrams ?? null,
        shipFeeVnd: fee,
        shipFeePointsUsed: pointsUsed,
        shipFeeCodVnd: codVnd,
        pickupAddress: {
          addressId: a.id,
          recipient: a.recipient,
          phone: a.phone,
          street: a.street,
          ward: a.ward,
          province: a.province,
          provinceCode: a.provinceCode,
          wardCode: a.wardCode,
        },
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

    for (const [lot, amount] of [['STANDARD', standardUse], ['CONVERTED', convertedUse]] as const) {
      if (amount <= 0) continue;
      const applied = await applyPointsDelta(tx, {
        userId,
        delta: -amount,
        lot,
        reason: wastePickupFeeReason(code),
        refType: WASTE_PICKUP_FEE_REF_TYPE,
        refId: created.id,
      });
      if (!applied.applied) throw new ConflictException(WASTE_MESSAGES.HOME_PICKUP_POINTS_CHANGED);
    }

    await writeWasteEvent(tx, {
      kind: 'REQUEST_CREATED',
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      requestId: created.id,
      pointId: result.pointId,
      meta: {
        before: null,
        after: {
          method: 'HOME_PICKUP',
          pointId: result.pointId,
          estimatedPoints: result.estimatedPoints,
          declaredWeightGrams: body.declaredWeightGrams ?? null,
          shipFeeVnd: fee,
          shipFeePointsUsed: pointsUsed,
          shipFeeCodVnd: codVnd,
          lines: body.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })),
        },
      },
    });
    return { id: created.id, code, shouldPush: true };
  }

  /** Cùng khoá idempotency phải cùng nội dung: cùng món và số lượng, cùng địa chỉ lấy, cùng cân nặng khai. */
  private sameContent(prior: Prior, body: WasteCreateRequest): boolean {
    if (prior.method !== 'HOME_PICKUP') return false;
    const snapshot = isRecord(prior.pickupAddress) ? prior.pickupAddress : {};
    if (snapshot.addressId !== body.pickupAddressId) return false;
    if (prior.declaredWeightGrams !== (body.declaredWeightGrams ?? null)) return false;
    const key = (l: { itemId: string; declaredQty: number }) => `${l.itemId}:${l.declaredQty}`;
    const a = prior.lines.map(key).sort();
    const b = body.lines.map(key).sort();
    return a.length === b.length && a.every((k, i) => k === b[i]);
  }

  private needsPush(prior: Prior): boolean {
    return prior.status === 'OPEN' && prior.gomdonOrderId === null && prior.gomdonStatus === null;
  }

  /** Job có jobId ổn định theo mã phiếu và tự bỏ qua phiếu đã có vận đơn nên xếp lại là an toàn; lỗi xếp hàng chỉ ghi log, cron cứu hộ xếp lại. */
  private async enqueuePush(id: string, code: string, should: boolean): Promise<void> {
    if (!should || !this.gomdonQueue) return;
    try {
      await enqueueGomdonWastePush(this.gomdonQueue, id, code);
    } catch (e) {
      this.logger.error(`Xếp job tạo vận đơn Gomdon cho phiếu ${code} lỗi: ${e instanceof Error ? e.message : e}`);
    }
  }
}
