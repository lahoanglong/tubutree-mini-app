import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { WasteFeeBankConfirmResultDTO } from '@tubutree/shared-types';
import type { Queue } from 'bullmq';
import { assertBankRefUnusedByWasteFee } from '../../../common/bank-ref';
import { assertActiveAdmin } from '../../../common/staff-access';
import { endOfVnDay } from '../../../common/vn-time';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { enqueueGomdonWastePush } from '../../integrations/gomdon/gomdon-queue';
import { buildVietQrPayload } from '../../integrations/payment/vietqr';
import { SystemConfigService } from '../../system-config/system-config.service';
import { creditWalletUnlessAnonymized } from '../../wallet/wallet-anonymized-guard';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WASTE_MESSAGES } from '../core/waste-messages';
import { loadAdminRequestDetail } from '../receiving/waste-admin-detail.mapper';
import { WASTE_PICKUP_FEE_REF_TYPE } from './waste-home-pickup-ledger';

const DAY_MS = 86_400_000;

export const wasteFeeMemo = (code: string): string => `WR${code.replace(/-/g, '')}`;

export interface WasteFeeBankQrResponse {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  paymentDeadline: string | null;
  serverNow: string;
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}

/**
 * Gói 178-E: chuyển khoản VietQR cho phần phí lấy rác tận nhà còn thiếu (sau khi trừ Điểm Xanh).
 * - Sinh mã VietQR động phía máy chủ gắn với đúng một phiếu (`memo = WR<mã bỏ gạch>`), không phải nạp Ví tổng quát.
 * - Kế toán xác nhận tay qua `confirmFeeBankPaid`: dùng chung không gian khoá `bankRef` với đơn hàng & công nợ đại lý,
 *   số tiền khớp `shipFeeCashVnd`, CAS `shipFeeCashPaidAt: null -> now` rồi mới xếp hàng đẩy vận đơn Gomdon.
 * - Tiền về sau khi phiếu đã đóng (khách tự huỷ / quá hạn `FEE_UNPAID`): cộng thẳng về Ví Tubu (`WASTE_FEE_REFUND`), không mở lại phiếu.
 */
@Injectable()
export class WasteFeeBankService {
  private readonly logger = new Logger(WasteFeeBankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly config: WasteConfigService,
    private readonly access: WasteAccessService,
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
  ) {}

  async getFeeQr(userId: string, requestId: string): Promise<WasteFeeBankQrResponse> {
    const req = await this.prisma.wasteRequest.findFirst({
      where: { id: requestId, userId },
      select: {
        id: true,
        code: true,
        method: true,
        status: true,
        expiresAt: true,
        shipFeeCashVnd: true,
        shipFeeCashMethod: true,
        shipFeeCashPaidAt: true,
        shipFeeCashRefundedVnd: true,
      },
    });
    if (!req || req.method !== 'HOME_PICKUP') throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
    if (req.shipFeeCashMethod !== 'BANK_TRANSFER' || (req.shipFeeCashVnd ?? 0) <= 0) {
      throw new BadRequestException('Yêu cầu này không thanh toán phí bằng chuyển khoản.');
    }

    const paid = req.shipFeeCashPaidAt !== null;
    const refunded = (req.shipFeeCashRefundedVnd ?? 0) > 0;
    if (!paid && req.status !== 'OPEN') {
      throw new BadRequestException('Yêu cầu đã đóng, không còn chờ chuyển khoản.');
    }

    const [bin, accountNo, accountName, bankName] = await Promise.all([
      this.systemConfig.get<string>('payment.bank_bin', ''),
      this.systemConfig.get<string>('payment.bank_account_no', ''),
      this.systemConfig.get<string>('payment.bank_account_name', ''),
      this.systemConfig.get<string>('payment.bank_name', ''),
    ]);
    const configured = !!bin && !!accountNo;
    if (!configured && !paid) {
      const missing = [!bin && 'payment.bank_bin', !accountNo && 'payment.bank_account_no'].filter(Boolean).join(', ');
      this.logger.error(`Không tạo được QR chuyển khoản phí thu gom cho ${req.code}: thiếu cấu hình ${missing}.`);
      throw new ServiceUnavailableException('Chưa tạo được mã chuyển khoản lúc này. Bạn thử lại sau ít phút nhé.');
    }

    const amount = req.shipFeeCashVnd!;
    const memo = wasteFeeMemo(req.code);
    const qrString = configured ? buildVietQrPayload({ bin, accountNo, amount, addInfo: memo }) : '';
    const qrImageUrl = configured
      ? `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(accountName)}`
      : '';

    return {
      orderCode: req.code,
      amount,
      paymentStatus: refunded ? 'REFUNDED' : paid ? 'PAID' : 'UNPAID',
      paymentDeadline: !paid && req.expiresAt ? req.expiresAt.toISOString() : null,
      serverNow: new Date().toISOString(),
      bank: { bin, name: bankName, accountNo, accountName },
      memo,
      qrString,
      qrImageUrl,
    };
  }

  async confirmFeeBankPaid(
    requestId: string,
    input: { amount: number; bankRef: string; actorId: string },
  ): Promise<WasteFeeBankConfirmResultDTO> {
    await assertActiveAdmin(this.prisma, input.actorId);
    const bankRef = input.bankRef.trim();
    if (!bankRef || bankRef.length > 64) {
      throw new BadRequestException('Cần nhập mã giao dịch ngân hàng hợp lệ.');
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Số tiền xác nhận không hợp lệ.');
    }
    const snap = await this.config.snapshot();

    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${requestId} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          code: true,
          userId: true,
          pointId: true,
          method: true,
          status: true,
          shipFeeCashVnd: true,
          shipFeeCashMethod: true,
          shipFeeCashPaidAt: true,
          shipFeeCashRefundedVnd: true,
          shipFeeBankRef: true,
        },
      });
      if (!req) throw new NotFoundException('Không tìm thấy mã');
      if (req.method !== 'HOME_PICKUP' || req.shipFeeCashMethod !== 'BANK_TRANSFER' || (req.shipFeeCashVnd ?? 0) <= 0) {
        throw new BadRequestException('Yêu cầu này không chờ chuyển khoản phí lấy rác.');
      }

      if (req.shipFeeCashPaidAt !== null) {
        if (req.shipFeeBankRef && req.shipFeeBankRef.toLowerCase() === bankRef.toLowerCase()) {
          const late = req.status === 'CANCELLED' || req.status === 'EXPIRED';
          return {
            outcome: (late ? 'CREDITED_LATE_TO_WALLET' : 'ALREADY_PAID') as WasteFeeBankConfirmResultDTO['outcome'],
            shouldPush: false,
            code: req.code,
          };
        }
        throw new ConflictException('Phiếu này đã được xác nhận thanh toán trước đó.');
      }

      await assertBankRefUnusedByWasteFee(tx, bankRef, requestId);

      const expected = req.shipFeeCashVnd!;
      if (input.amount !== expected) {
        throw new BadRequestException(
          `Số tiền xác nhận (${input.amount.toLocaleString('vi-VN')}đ) phải đúng bằng phần phí còn thiếu (${expected.toLocaleString('vi-VN')}đ).`,
        );
      }

      const now = new Date();
      if (req.status === 'OPEN') {
        const nextExpiresAt = endOfVnDay(new Date(now.getTime() + snap.requestHoldDays * DAY_MS));
        const flip = await tx.wasteRequest.updateMany({
          where: { id: req.id, status: 'OPEN', shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null },
          data: { shipFeeCashPaidAt: now, shipFeeBankRef: bankRef, expiresAt: nextExpiresAt },
        });
        if (flip.count !== 1) throw new ConflictException(WASTE_MESSAGES.RETRY);
        await writeWasteEvent(tx, {
          kind: 'FEE_BANK_PAID',
          actorUserId: input.actorId,
          actorRole: 'ADMIN',
          requestId: req.id,
          pointId: req.pointId,
          meta: {
            subjectUserId: req.userId,
            amount: expected,
            bankRef,
            lateRefundedToWallet: false,
            before: { shipFeeCashPaidAt: null, shipFeeBankRef: null },
            after: { shipFeeCashPaidAt: now.toISOString(), shipFeeBankRef: bankRef },
          },
        });
        return { outcome: 'PAID' as const, shouldPush: true, code: req.code };
      }

      if (req.status === 'CANCELLED' || req.status === 'EXPIRED') {
        const flip = await tx.wasteRequest.updateMany({
          where: {
            id: req.id,
            status: { in: ['CANCELLED', 'EXPIRED'] },
            shipFeeCashMethod: 'BANK_TRANSFER',
            shipFeeCashPaidAt: null,
            shipFeeCashRefundedVnd: null,
          },
          data: { shipFeeCashPaidAt: now, shipFeeBankRef: bankRef, shipFeeCashRefundedVnd: expected },
        });
        if (flip.count !== 1) throw new ConflictException(WASTE_MESSAGES.RETRY);
        const credit = await creditWalletUnlessAnonymized(tx, {
          userId: req.userId,
          delta: expected,
          type: 'WASTE_FEE_REFUND',
          refType: WASTE_PICKUP_FEE_REF_TYPE,
          refId: req.id,
          reason: `Hoàn phí thu gom chuyển khoản muộn · ${req.code}`,
        });
        if (!credit.credited) {
          await tx.wasteRequest.update({ where: { id: req.id }, data: { shipFeeCashRefundedVnd: null } });
        }
        await writeWasteEvent(tx, {
          kind: 'FEE_BANK_PAID',
          actorUserId: input.actorId,
          actorRole: 'ADMIN',
          requestId: req.id,
          pointId: req.pointId,
          meta: {
            subjectUserId: req.userId,
            amount: expected,
            bankRef,
            lateRefundedToWallet: credit.credited,
            ...(credit.anonymizedAt ? { cashRefundSkippedAnonymized: credit.anonymizedAt } : {}),
            before: { status: req.status, shipFeeCashPaidAt: null, shipFeeCashRefundedVnd: null },
            after: {
              status: req.status,
              shipFeeCashPaidAt: now.toISOString(),
              shipFeeCashRefundedVnd: credit.credited ? expected : null,
              shipFeeBankRef: bankRef,
            },
          },
        });
        return { outcome: 'CREDITED_LATE_TO_WALLET' as const, shouldPush: false, code: req.code };
      }

      throw new ConflictException('Trạng thái phiếu không cho phép xác nhận phí.');
    });

    if (done.shouldPush && this.gomdonQueue) {
      await enqueueGomdonWastePush(this.gomdonQueue, requestId, done.code).catch((err) =>
        this.logger.error(`Xếp job Gomdon sau xác nhận phí cho ${done.code} lỗi: ${err instanceof Error ? err.message : err}`),
      );
    }

    return {
      outcome: done.outcome,
      request: await loadAdminRequestDetail(this.prisma, this.access, requestId, true),
    };
  }
}
